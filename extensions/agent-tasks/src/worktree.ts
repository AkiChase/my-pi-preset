/**
 * worktree.ts — Git worktree isolation for agents.
 *
 * Creates a temporary git worktree so the agent works on an isolated copy of the repo.
 * On completion, if no changes were made, the worktree is cleaned up.
 * If changes exist, a branch is created and returned in the result.
 *
 * Every git call goes through `pi.exec` (async) rather than `execFileSync`: a
 * worktree copy can take seconds, and a session that spawns several isolated
 * agents at once would otherwise serialize them all on the TUI's event loop.
 */

import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface WorktreeInfo {
  /** Absolute path to the worktree directory (the copied repo's root). */
  path: string;
  /** Branch name created for this worktree (if changes exist). */
  branch: string;
  /** Commit SHA that the worktree was created from. */
  baseSha: string;
  /**
   * Where the agent should work inside the worktree: the equivalent of the
   * cwd the worktree was created from. Equals `path` when that cwd was the
   * repo root; points at the copied subdirectory when it was deeper (e.g. a
   * monorepo package), so the requested scoping survives isolation.
   */
  workPath: string;
}

/**
 * Project-wide switch for worktree isolation (`worktreeIsolation` in
 * agent-tasks.json). Default `true` — unchanged behaviour.
 *
 * The `"off"` isolation value gives a model a legal way to decline a worktree,
 * but it still depends on the model choosing it. This is the deterministic half
 * of the same fix: on a large repo where every worktree costs real time and
 * disk (#184), turning it off means no caller can create one, whatever it
 * passes.
 */
let worktreeIsolationEnabled = true;

export function setWorktreeIsolationEnabled(enabled: boolean): void {
  worktreeIsolationEnabled = enabled;
}

export function isWorktreeIsolationEnabled(): boolean {
  return worktreeIsolationEnabled;
}

export interface WorktreeCleanupResult {
  /** Whether changes were found in the worktree. */
  hasChanges: boolean;
  /** Kept for recovery, including unknown/unsaved state after cancellation. */
  preserved?: boolean;
  /** Branch name if changes were committed. */
  branch?: string;
  /** Worktree path if it was kept. */
  path?: string;
}

/**
 * Run git and return its trimmed stdout, throwing on failure so callers keep
 * the try/catch control flow `execFileSync` gave them.
 *
 * `pi.exec` never rejects — it reports failure in the result — and a command
 * killed by its timeout comes back as `killed` with an exit code of 0, so both
 * have to be checked to reproduce `execFileSync`'s "throws on anything but a
 * clean exit".
 */
export interface WorktreeOptions {
  signal?: AbortSignal;
  /** Cleanup bookkeeping only; also receives paths left by a partial add. */
  onCreated?: (worktree: WorktreeInfo) => void;
}
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Worktree operation cancelled");
}
async function git(pi: ExtensionAPI, cwd: string, args: string[], timeout: number, signal?: AbortSignal): Promise<string> {
  checkCancelled(signal);
  const result = await pi.exec("git", args, { cwd, timeout, signal });
  checkCancelled(signal);
  if (result.killed || result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed (exit ${result.code})`);
  }
  return result.stdout.trim();
}

/**
 * Create a temporary git worktree for an agent.
 * Returns the worktree path, or undefined if not in a git repo.
 */
export async function createWorktree(
  pi: ExtensionAPI,
  cwd: string,
  agentId: string,
  options: WorktreeOptions = {},
): Promise<WorktreeInfo | undefined> {
  // Verify we're in a git repo with at least one commit (HEAD must exist)
  let baseSha: string;
  let subdir: string;
  try {
    await git(pi, cwd, ["rev-parse", "--is-inside-work-tree"], 5000, options.signal);
    baseSha = await git(pi, cwd, ["rev-parse", "HEAD"], 5000, options.signal);
    // Where cwd sits inside the repo ("" at the root): the agent must work at
    // the same subdirectory inside the copy, or a monorepo-package cwd would
    // silently widen to the whole repo. realpath both sides — git emits
    // resolved paths while cwd may arrive through a symlink (macOS /tmp).
    const topLevel = await git(pi, cwd, ["rev-parse", "--show-toplevel"], 5000, options.signal);
    subdir = relative(realpathSync(topLevel), realpathSync(cwd));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return undefined;
  }

  const branch = `pi-agent-${agentId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join(tmpdir(), `pi-agent-${agentId}-${suffix}`);

  const worktree = { path: worktreePath, branch, baseSha, workPath: subdir ? join(worktreePath, subdir) : worktreePath };
  try {
    await git(pi, cwd, ["worktree", "add", "--detach", worktreePath, "HEAD"], 30000, options.signal);
    return worktree;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return undefined;
  } finally {
    // An interrupted add may have copied files/registered a tree. Do not launch
    // another git command on a closing host, or force-remove unknown changes.
    options.onCreated?.(worktree);
  }
}

/**
 * Clean up a worktree after agent completion.
 * - If no changes: remove worktree entirely.
 * - If changes exist: create a branch, commit changes, return branch info.
 */
export async function cleanupWorktree(
  pi: ExtensionAPI,
  cwd: string,
  worktree: WorktreeInfo,
  agentDescription: string,
  options: WorktreeOptions = {},
): Promise<WorktreeCleanupResult> {
  if (!existsSync(worktree.path)) {
    return { hasChanges: false };
  }

  let savedBranch: string | undefined;
  try {
    // Check for uncommitted changes in the worktree
    const status = await git(pi, worktree.path, ["status", "--porcelain"], 10000, options.signal);

    if (status) {
      // Changes exist — stage, commit, and create a branch
      await git(pi, worktree.path, ["add", "-A"], 10000, options.signal);
      // Truncate description for commit message (no shell sanitization needed — pi.exec uses argv)
      const safeDesc = agentDescription.slice(0, 200);
      const commitMsg = `pi-agent: ${safeDesc}`;
      await git(pi, worktree.path, ["commit", "--no-verify", "-m", commitMsg], 10000, options.signal);
    } else {
      const currentSha = await git(pi, worktree.path, ["rev-parse", "HEAD"], 5000, options.signal);

      if (currentSha === worktree.baseSha) {
        // No changes — remove worktree
        await removeWorktree(pi, cwd, worktree.path, options);
        return { hasChanges: false };
      }
    }

    // Create a branch pointing to the worktree's HEAD.
    // If the branch already exists, append a suffix to avoid overwriting previous work.
    let branchName = worktree.branch;
    try {
      await git(pi, worktree.path, ["branch", branchName], 5000, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Branch already exists — use a unique suffix
      branchName = `${worktree.branch}-${Date.now()}`;
      await git(pi, worktree.path, ["branch", branchName], 5000, options.signal);
    }
    // Update branch name in worktree info for the caller
    worktree.branch = branchName;
    savedBranch = branchName;

    // Remove the worktree (branch persists in main repo)
    await removeWorktree(pi, cwd, worktree.path, options);

    return {
      hasChanges: true,
      branch: worktree.branch,
      path: worktree.path,
    };
  } catch {
    // Unknown/unsaved changes are artifacts, not disposable runtime. Even a
    // failed commit/branch/remove must retain the path and any generated branch.
    return { hasChanges: true, branch: savedBranch, path: worktree.path, preserved: true };
  }
}

/**
 * Remove only a clean/saved worktree; never force an unknown state.
 */
async function removeWorktree(pi: ExtensionAPI, cwd: string, worktreePath: string, options: WorktreeOptions): Promise<void> {
  // Git's non-forced removal also protects changes made after our status check.
  await git(pi, cwd, ["worktree", "remove", worktreePath], 10000, options.signal);
}

/**
 * Prune any orphaned worktrees (crash recovery).
 */
export async function pruneWorktrees(pi: ExtensionAPI, cwd: string): Promise<void> {
  try {
    await git(pi, cwd, ["worktree", "prune"], 5000);
  } catch { /* ignore */ }
}
