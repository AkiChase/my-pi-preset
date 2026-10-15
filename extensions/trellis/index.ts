/**
 * pi-trellis — a user-level Pi extension activated within supported Trellis projects.
 *
 * Scope (see design doc §2):
 *   M1  session / task context injection via systemPrompt sections + per-turn state message
 *   M2  active-task status in the footer
 *   M3  role-specific JSONL/artifact material handed to trellis-* subagents
 *   M4  explicit initialization and manifest-managed project resources
 *   M5  skills: deployed to project .pi/skills by /trellis-init; Pi discovers them natively
 *
 * No Trellis runtime implementation is copied into this TypeScript extension.
 * Bundled agent documents retain their upstream license; see licenses/trellis-AGPL-3.0.txt
 * (adapter code: licenses/pi-trellis-MIT.txt).
 * It talks to Trellis through documented surfaces only: the `task.py` / `get_context.py` CLIs, the
 * TRELLIS_CONTEXT_ID environment variable, and on-disk paths under `.trellis/`.
 * Optional UI/context discovery degrades rather than taking a session down.
 * Dispatch validates source authority and hands paths/read obligations to roles.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { assembleDispatchPrompt, dispatchAuthority, stripDispatchClaims, isTrellisRole, parseDispatchFacts, readTaskRecord, resolveTaskPath, type DispatchFacts } from "./lib/task-context.ts";
import { queryWorktree, requireMaterials, requireSourcePath, type MaterialRole } from "./lib/worktree-query.ts";
import { registerDispatchTool } from "./lib/subagent-rpc.ts";
import { readBinding, readMarker, sameIdentity, type WorktreeBinding } from "./lib/bindings.ts";
import { canonicalPath, containsPath } from "./lib/config.ts";
import { registerInitCommand } from "./lib/initialization/command.ts";
import { runDiagnostics } from "./lib/initialization/diagnostic-runtime.ts";
import { registerTaskBrowserCommand } from "./lib/task-browser/command.ts";
import { readCurrentTaskIdentity } from "./lib/task-browser/reader.ts";
import { checkedPath } from "./lib/initialization/engine.ts";
import { resourceRoot } from "./lib/paths.ts";
import { findProjectRoot, requireProjectRuntime } from "./lib/project-state.ts";

/** The slice of pi's Theme this extension uses. Narrow on purpose: `ctx.ui.theme` is always present, even in the no-op UI. */
type ThemeColorToken = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text";
interface ExtensionTheme {
	fg(color: ThemeColorToken, text: string): string;
	bold(text: string): string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Window in which a `get_context.py` result is reused instead of re-spawning python. */
const CONTEXT_TTL_MS = 1500;

/**
 * Window in which the active task is reused. This exists for the negative
 * case: with no session pointer on disk every lookup would otherwise spawn
 * `task.py current` once per turn. Any `task.py` call invalidates it, so the
 * footer and the injected state still react immediately to a real change.
 */
const TASK_TTL_MS = 10000;

/** Hard cap on the workflow excerpt that enters the system prompt. */
const WORKFLOW_MAX_CHARS = 14000;

/** Compact footer budget in visible terminal columns, measured before theming. */
const STATUS_MAX_COLUMNS = 34;

/**
 * Where the active task is shown: `widget` takes its own line above the editor
 * (themed, room to breathe), `status` is the one-line footer chip shared with
 * every other extension's status, `off` shows nothing.
 */
const DISPLAY_MODE = (() => {
	const raw = process.env.TRELLIS_PI_STATUS?.trim().toLowerCase();
	return raw === "status" || raw === "off" ? raw : "widget";
})();

const PYTHON = process.env.TRELLIS_PYTHON || (process.platform === "win32" ? "python" : "python3");

/**
 * `full` / `compact` force the injection size; anything else auto-selects
 * (compact when there is no UI: subagent sessions and `pi -p`). Useful when
 * `pi -p` drives the real workflow in CI and wants the whole payload.
 */
const CONTEXT_MODE = process.env.TRELLIS_PI_CONTEXT?.trim().toLowerCase();

const SECTION_OVERVIEW = "session-overview";
const SECTION_WORKFLOW = "trellis-workflow";
const STATE_MESSAGE_TYPE = "trellis-task-state";
const STATUS_KEY = "trellis";
const WIDGET_KEY = "trellis";
const AGENT_PREFIX = "trellis-";
const ACTIVE_TASK_MARKER = "Active task:";

// ---------------------------------------------------------------------------
// Module state
//
// Session identity is explicit; never republish an id into a shared process.env.
// A caller-provided id pins sessions intentionally; children receive facts in their prompt.
const pinnedContextId = process.env.TRELLIS_CONTEXT_ID?.trim();
const keyBySession = new Map<string, string>();
const taskBySession = new Map<string, string>();
// Display provenance only, never authorization or an active-pointer override.
const roleBySession = new Map<string, string>();
const authorityBySession = new Map<string, DispatchFacts>();
// Remember immutable native identity, not just a reused source/target pathname.
const bindingBySession = new Map<string, WorktreeBinding | null>();
const sourceRootBySession = new Map<string, string>();
const authorityErrors = new Map<string, string>();

/** cacheKey -> memoized prompt sections. Must stay byte-stable for the process lifetime. */
const sectionCache = new Map<string, { overview?: string; workflow?: string }>();
/** cacheKey -> last state text handed to the model, for dedup. */
const lastStateSent = new Map<string, string>();
/** session/root/context -> cached `get_context.py --mode default` payload. */
const contextCache = new Map<string, { at: number; value: Promise<TrellisContext | undefined> }>();
/** cacheKey -> cached active task, including cached absence. */
const taskCache = new Map<string, { at: number; value: Promise<ActiveTask | undefined> }>();
const taskErrors = new Map<string, string>();
/** root -> parsed workflow.md, invalidated by mtime. */
const workflowCache = new Map<string, { mtimeMs: number; head: string; states: Map<string, string> }>();

let warnedMissingAgentTool = false;
let warnedBrokenCli = false;

// ---------------------------------------------------------------------------
// Types (shapes we read, not shapes we own)
// ---------------------------------------------------------------------------

interface TrellisTaskNode {
	dir?: string;
	name?: string;
	status?: string;
	parent?: string | null;
	children?: unknown[];
}

interface TrellisContext {
	developer?: string;
	git?: { isRepo?: boolean; branch?: string; isClean?: boolean; uncommittedChanges?: number };
	tasks?: { active?: TrellisTaskNode[]; directory?: string };
	journal?: { file?: string; lines?: number; nearLimit?: boolean };
}

interface ActiveTask {
	/** Repo-relative task directory, e.g. `.trellis/tasks/00-bootstrap`. */
	dir: string;
	status: string;
	title?: string;
	/** Linked child tasks, for parent tasks. */
	children: number;
	/** Which planning artifacts exist on disk. */
	artifacts: { prd: boolean; design: boolean; implement: boolean };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Walk up from `cwd` looking for a `.trellis/` directory.
 *
 * Resolve every event from its current cwd. Pi 1.2 keeps cwd fixed for an
 * AgentSession; the runner also guards unexpected foreign-cwd events rather
 * than inheriting another project's context.
 */
function findRoot(cwd: string | undefined): string | undefined {
	return findProjectRoot(cwd || process.cwd());
}

function scriptPath(root: string, name: string): string {
	return join(root, ".trellis", "scripts", name);
}

function requireRuntime(root: string): void {
	requireProjectRuntime(root);
}

function runtimeDiagnostic(error: unknown): string {
	return `Trellis runtime execution is blocked: ${String(error)}. Run /trellis-init → Check project to inspect this project; explicit initialization or reconciliation is required (no automatic migration).`;
}

/** Recognize known runtime invocations, not arbitrary shell behavior or file reads. */
function invokesRuntime(command: string): boolean {
	const tokens = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s;&|()]+|[;&|()\n]+/g) ?? [];
	let words: string[] = [];
	const invocation = (input: string[]): boolean => {
		const words = input.map(word => word.replace(/^(["'])(.*)\1$/s, "$2"));
		while (words.length) {
			if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || ["env", "command", "exec", "sudo", "nohup", "time"].includes(basename(words[0])) || words[0].startsWith("-")) {
				const option = words.shift();
				if (["-u", "--unset", "-C", "--chdir"].includes(option ?? "")) words.shift();
			} else break;
		}
		const executable = basename(words[0] ?? "");
		const script = /^(?:task|get_context|init_developer|get_developer|add_session|worktree)\.py$/;
		if (script.test(executable)) return true;
		if (/^python(?:\d+(?:\.\d+)*)?$/.test(executable)) {
			return words.slice(1).some(word => script.test(basename(word))) || words.some(word => /\b(?:common\.(?:active_task|paths|session_context|packages_context|developer|task_store)|pi_trellis_worktree)\b|\bfrom\s+common\s+import\s+(?:active_task|paths|session_context|packages_context|developer|task_store)\b/.test(word));
		}
		if (executable === "trellis" && words.slice(1).some(word => /^(?:task|context|journal|init|worktree)$/.test(word))) return true;
		if (["bash", "sh", "zsh", "fish"].includes(executable)) {
			const index = words.findIndex(word => /^-[a-z]*c[a-z]*$/.test(word));
			return index >= 0 && !!words[index + 1] && invokesRuntime(words[index + 1]);
		}
		return false;
	};
	for (const token of tokens) {
		if (/^[;&|()\n]+$/.test(token)) {
			if (invocation(words)) return true;
			words = [];
		} else words.push(token);
	}
	return invocation(words);
}

function shortHash(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/** Trellis resource root (`extensions/trellis/`) holding bundled runtime-consumed materials. */
function packageDir(): string {
	return resourceRoot;
}

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

function sessionIdentity(root: string, ctx: ExtensionContext): string {
	return `${root}::${ctx.sessionManager.getSessionId()}`;
}

function contextKey(root: string, ctx: ExtensionContext): string {
	const identity = sessionIdentity(root, ctx);
	const cached = keyBySession.get(identity);
	if (cached) return cached;
	if (pinnedContextId && !/^[A-Za-z0-9_-]{1,128}$/.test(pinnedContextId)) throw new Error("Invalid explicit TRELLIS_CONTEXT_ID");
	const pinned = pinnedContextId && /^[A-Za-z0-9_-]{1,128}$/.test(pinnedContextId) ? pinnedContextId : undefined;
	const key = pinned ?? `pi-${shortHash(ctx.sessionManager.getSessionFile() || identity)}`;
	keyBySession.set(identity, key);
	return key;
}

function cacheKeyFor(root: string, key: string): string {
	return `${key}::${root}`;
}

// ---------------------------------------------------------------------------
// Trellis CLI
// ---------------------------------------------------------------------------

function runScript(
	root: string,
	key: string,
	script: string,
	args: string[],
	timeoutMs = 15000,
): Promise<{ code: number; stdout: string } | undefined> {
	return runPython(root, key, [scriptPath(root, script), ...args], timeoutMs);
}

function runPython(
	root: string, key: string, args: string[], timeoutMs = 15000,
): Promise<{ code: number; stdout: string } | undefined> {
	requireRuntime(root);
	const env: NodeJS.ProcessEnv = { ...process.env, TRELLIS_CONTEXT_ID: key, PYTHONDONTWRITEBYTECODE: "1", GIT_OPTIONAL_LOCKS: "0" };
	for (const name of Object.keys(env)) if (name.startsWith("GIT_") && name !== "GIT_OPTIONAL_LOCKS") delete env[name];
	return new Promise((done) => {
		try {
			execFile(
				PYTHON,
				args,
				{
					cwd: root,
					timeout: timeoutMs,
					env,
					maxBuffer: 8 * 1024 * 1024,
					windowsHide: true,
				},
				(err, stdout) => {
					const text = typeof stdout === "string" ? stdout : String(stdout ?? "");
					if (err && typeof (err as { code?: unknown }).code !== "number") {
						// Spawn failure (python missing, timeout kill): no usable result.
						done(undefined);
						return;
					}
					done({ code: (err as { code?: number } | null)?.code ?? 0, stdout: text });
				},
			);
		} catch {
			done(undefined);
		}
	});
}

/** Parse the first top-level JSON object in `text`, tolerating leading notices. */
function parseJson<T>(text: string): T | undefined {
	const start = text.indexOf("{");
	if (start < 0) return undefined;
	try {
		return JSON.parse(text.slice(start)) as T;
	} catch {
		return undefined;
	}
}

/**
 * Caches the promise, not the result: a fan-out of subagent sessions starts
 * concurrently, and caching only settled values would let each one spawn its
 * own python process.
 */
function loadContext(root: string, key: string): Promise<TrellisContext | undefined> {
	const cacheKey = cacheKeyFor(root, key);
	const cached = contextCache.get(cacheKey);
	if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.value;

	const value = runScript(root, key, "get_context.py", ["--mode", "default", "--json"])
		.then((result) => (result ? parseJson<TrellisContext>(result.stdout) : undefined))
		.catch(() => undefined);
	contextCache.set(cacheKey, { at: Date.now(), value });
	return value;
}

// ---------------------------------------------------------------------------
// Active task (read from disk; python is the fallback)
// ---------------------------------------------------------------------------

/**
 * Resolve the active task without spawning python.
 *
 * The session pointer file is a Trellis implementation detail, not a public
 * contract, so every read is defensive and a miss simply degrades to the CLI.
 */
function readActiveTaskFromDisk(root: string, key: string): ActiveTask | undefined {
	try {
		const pointer = checkedPath(root, `.trellis/.runtime/sessions/${key}.json`);
		if (existsSync(pointer) && (!lstatSync(pointer).isFile() || lstatSync(pointer).size > 1024 * 1024)) return undefined;
		if (!existsSync(pointer)) return undefined;
		const data = parseJson<{ current_task?: unknown }>(readFileSync(pointer, "utf8"));
		const dir = typeof data?.current_task === "string" ? data.current_task : undefined;
		if (!dir) return undefined;
		const record = readTaskRecord(root, dir);
		// Match the fixed runtime's bounded identity fields before exposing a path.
		// The material loader's object check alone is not task authorization.
		if (!Object.keys(record).length || !["id", "name", "title", "status"].some(name => Object.hasOwn(record, name))) return undefined;
		for (const name of ["id", "name", "title", "status"]) {
			const value = record[name];
			if (Object.hasOwn(record, name) && (typeof value !== "string" || !value.trim() || value.length > (name === "status" ? 128 : 8192))) return undefined;
		}
		const status = typeof record.status === "string" && record.status ? record.status : "task_error";
		return {
			dir,
			status,
			title: typeof record?.title === "string" ? record.title : undefined,
			children: Array.isArray(record?.children) ? record.children.length : 0,
			artifacts: readArtifacts(root, dir),
		};
	} catch {
		return undefined;
	}
}

function readArtifacts(root: string, dir: string): ActiveTask["artifacts"] {
	const has = (name: string) => {
		try {
			return existsSync(join(root, dir, name));
		} catch {
			return false;
		}
	};
	return { prd: has("prd.md"), design: has("design.md"), implement: has("implement.md") };
}

function readActiveTask(root: string, key: string): Promise<ActiveTask | undefined> {
	const cacheKey = cacheKeyFor(root, key);
	const cached = taskCache.get(cacheKey);
	if (cached && Date.now() - cached.at < TASK_TTL_MS) return cached.value;

	const value = resolveActiveTask(root, key).catch(error => { taskErrors.set(cacheKey, String(error)); return undefined; });
	taskCache.set(cacheKey, { at: Date.now(), value });
	return value;
}

function invalidateTask(root: string, key: string): void {
	taskCache.delete(cacheKeyFor(root, key));
	taskErrors.delete(cacheKeyFor(root, key));
}

async function resolveActiveTask(root: string, key: string): Promise<ActiveTask | undefined> {
	taskErrors.delete(cacheKeyFor(root, key));
	const fromDisk = readActiveTaskFromDisk(root, key);
	if (fromDisk) return fromDisk;

	const result = await runScript(root, key, "task.py", ["current", "--json"], 10000);
	if (!result) throw new Error("Task CLI is unavailable");
	const data = parseJson<{
		current_task?: { dir?: unknown; status?: unknown; title?: unknown; children?: unknown } | null;
		source?: unknown; stale?: unknown; error?: unknown; state?: unknown;
	}>(result.stdout);
	if (result.code !== 0 || data?.source !== `session:${key}` || data.stale || data.error) {
		if (data?.error || data?.stale || (result.code !== 0 && !["no-task"].includes(String(data?.state)))) taskErrors.set(cacheKeyFor(root, key), String(data?.error || "Task pointer or CLI is invalid"));
		return undefined;
	}
	const task = data.current_task;
	if (!task || typeof task.dir !== "string") return undefined;
	resolveTaskPath(root, task.dir);
	return {
		dir: task.dir,
		status: typeof task.status === "string" && task.status ? task.status : "task_error",
		title: typeof task.title === "string" ? task.title : undefined,
		children: Array.isArray(task.children) ? task.children.length : 0,
		artifacts: readArtifacts(root, task.dir),
	};
}

// ---------------------------------------------------------------------------
// Project task count (cosmetic, read-only; never cached with the startup context)
// ---------------------------------------------------------------------------

function readUnfinishedTaskCount(root: string): number | undefined {
	try {
		const store = join(root, ".trellis", "tasks");
		let archive = join(realpathSync(store), "archive");
		let archiveExists = true;
		try { lstatSync(archive); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			archiveExists = false;
		}
		if (archiveExists) archive = realpathSync(archive);
		const seen = new Set<string>();
		let count = 0;
		// Match Trellis's immediate task-directory enumeration, not child links.
		for (const name of readdirSync(store)) {
			if (name === "archive") continue;
			const dir = join(".trellis", "tasks", name);
			if (!statSync(join(root, dir)).isDirectory()) continue;
			const task = resolveTaskPath(root, dir);
			const actual = realpathSync(task);
			if (containsPath(archive, actual) || seen.has(actual)) continue;
			seen.add(actual);
			const file = join(task, "task.json");
			try { lstatSync(file); }
			catch (error) {
				// A directory without a record is not a task; other errors are unknown.
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (!statSync(file).isFile()) return undefined;
			const record = readTaskRecord(root, dir);
			if (record.status !== undefined && (typeof record.status !== "string" || !record.status.trim())) return undefined;
			if (record.status !== "completed") count++;
		}
		return count;
	} catch {
		// Never describe unreadable/invalid or partially enumerated data as zero.
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// workflow.md
// ---------------------------------------------------------------------------

/**
 * Split `workflow.md` into the stable head (everything before the first
 * per-turn breadcrumb block) and the breadcrumb blocks themselves.
 *
 * Breadcrumbs are `[workflow-state:<status>] ... [/workflow-state:<status>]`.
 * Platform-scoped blocks are bracket lines listing platform names; blocks that
 * do not name Pi are dropped so the model never reads another platform's
 * instructions.
 */
function loadWorkflow(root: string): { head: string; states: Map<string, string> } | undefined {
	const file = join(root, ".trellis", "workflow.md");
	let mtimeMs: number;
	try {
		mtimeMs = statSync(file).mtimeMs;
	} catch {
		return undefined;
	}

	const cached = workflowCache.get(root);
	if (cached && cached.mtimeMs === mtimeMs) return cached;

	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}

	const lines = text.split("\n");
	const states = new Map<string, string>();
	const headLines: string[] = [];
	let headDone = false;

	// A bracket line is a platform scope only when its exact close tag exists.
	// That distinguishes `[Kilo]` (a block) from `[x]`, `[1]`, or `[link](...)`.
	const closeTags = new Set<string>();
	for (const line of lines) {
		const match = /^\[\/(.+)\]$/.exec(line.trim());
		if (match) closeTags.add(match[1]);
	}

	/** Name of the platform block currently being skipped, if any. */
	let skipping: string | undefined;
	/** Status name of the breadcrumb block currently being collected. */
	let stateName: string | undefined;
	let stateLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		if (stateName !== undefined) {
			if (trimmed === `[/workflow-state:${stateName}]`) {
				states.set(stateName, stateLines.join("\n").trim());
				stateName = undefined;
				stateLines = [];
			} else {
				stateLines.push(line);
			}
			continue;
		}

		const stateOpen = /^\[workflow-state:([^\]]+)\]$/.exec(trimmed);
		if (stateOpen) {
			headDone = true;
			stateName = stateOpen[1];
			stateLines = [];
			continue;
		}

		if (headDone) continue;

		if (skipping !== undefined) {
			if (trimmed === `[/${skipping}]`) skipping = undefined;
			continue;
		}

		const platforms = platformList(trimmed, closeTags);
		if (platforms) {
			if (!platforms.some((name) => name.toLowerCase() === "pi")) {
				skipping = trimmed.slice(1, -1);
			}
			continue;
		}
		if (/^\[\/.+\]$/.test(trimmed) && closeTags.has(trimmed.slice(2, -1))) continue; // close of a kept block

		headLines.push(line);
	}

	let head = headLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
	if (head.length > WORKFLOW_MAX_CHARS) {
		head = `${head.slice(0, WORKFLOW_MAX_CHARS)}\n\n[...truncated by pi-trellis; read .trellis/workflow.md for the rest]`;
	}

	const parsed = { mtimeMs, head, states };
	workflowCache.set(root, parsed);
	return parsed;
}

/**
 * Recognize a platform-scope bracket line such as
 * `[Claude Code, Cursor, Pi, ZCode]`, returning the platform names.
 *
 * The test is structural, not lexical: the line must have a matching `[/...]`
 * close tag somewhere in the document. Markdown checkboxes, footnote markers
 * and link labels have none, so they stay in the prose.
 */
function platformList(trimmed: string, closeTags: Set<string>): string[] | undefined {
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
	const inner = trimmed.slice(1, -1);
	if (!inner || inner.startsWith("/") || inner.includes("[") || inner.includes("]")) return undefined;
	if (inner.startsWith("workflow-state:")) return undefined;
	if (!closeTags.has(inner)) return undefined;
	return inner.split(",").map((part) => part.trim());
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderOverview(root: string, key: string, context: TrellisContext | undefined, role?: string, protocolPath = join(packageDir(), "protocol/worktree-execution.md"), executionRoot = root): string {
	const lines: string[] = [
		"Trellis-managed project. Snapshot taken when this session started;",
		`live task state arrives as <${STATE_MESSAGE_TYPE}> messages.`,
		"",
		`Project root (source materials/CLI): ${root}`,
		`Execution root (product code/tests): ${executionRoot}`,
		`Trellis context id: ${key}`,
	];

	if (context?.developer) lines.push(`Developer: ${context.developer}`);

	const git = context?.git;
	if (git?.isRepo) {
		const bits = [git.branch || "unknown branch"];
		if (git.isClean === false && typeof git.uncommittedChanges === "number") {
			bits.push(`${git.uncommittedChanges} uncommitted`);
		}
		lines.push(`${executionRoot === root ? "Git" : "Source Git (not execution checkout)"}: ${bits.join(", ")}`);
	}

	const journal = context?.journal;
	if (journal?.file) {
		const near = journal.nearLimit ? ", near line limit — consider rotating" : "";
		lines.push(`Journal: ${journal.file} (${journal.lines ?? "?"} lines${near})`);
	}

	const active = context?.tasks?.active ?? [];
	if (active.length > 0) {
		lines.push("", "Active tasks at startup:");
		for (const task of active) {
			const name = task.dir || task.name || "?";
			const kids = Array.isArray(task.children) && task.children.length > 0
				? `, ${task.children.length} child task(s)`
				: "";
			lines.push(`  - ${name} [${task.status ?? "unknown"}${kids}]`);
		}
	} else {
		lines.push("", "No active tasks at startup.");
	}

	lines.push(
		"",
		`Task directory: ${context?.tasks?.directory ?? ".trellis/tasks"}`,
		"Trellis CLI (run from the project root):",
		`  ${PYTHON} ./.trellis/scripts/task.py current --json`,
		`  ${PYTHON} ./.trellis/scripts/get_context.py --mode default --json`,
		`  ${PYTHON} ./.trellis/scripts/get_context.py --mode phase --step <N.N>`,
		`  ${PYTHON} ./.trellis/scripts/get_context.py --mode packages`,
		...(role ? [
			`Task execution role: ${role}; work only in the supplied execution directory and approved task scope.`,
			"Directly and fully read source task artifacts, workflow, role JSONL and selected references in the supplied order; paginate truncated reads. Path/hash facts are not a complete-injection/read proof.",
		] : [
			existsSync(scriptPath(root, "worktree.py")) ? "Worktree management: python3 .trellis/scripts/worktree.py <command> --task <task>; use --help, preview then approved --confirm." : "Worktree CLI not deployed (python3 .trellis/scripts/worktree.py): explicit install/update required; no automatic repair.",
			"Dispatch/stop: trellis_dispatch; unbound tasks use the shared source directory, bound tasks require their prepared managed worktree. Main coordinates overlapping edits and phases.",
			"Never use temporary worktree isolation or silently fall back to source for managed execution.",
			existsSync(protocolPath) ? `Before the first managed operation, read protocol: ${protocolPath}` : `Worktree protocol missing: ${protocolPath}; explicitly repair package installation before management.`,
		]),
		`Trellis CLI calls use TRELLIS_CONTEXT_ID=${key}; pi-trellis scopes each bash call explicitly.`,
	);

	return lines.join("\n");
}

function renderWorkflowSection(head: string): string {
	return [
		head,
		"",
		"---",
		"Excerpt of .trellis/workflow.md (stable part only; platform blocks that do not name Pi were removed).",
		"Per-phase detail is not included here — load it on demand:",
		`  ${PYTHON} ./.trellis/scripts/get_context.py --mode phase --step <N.N>`,
		"Read .trellis/workflow.md directly when you need the full document.",
	].join("\n");
}

function renderState(root: string, task: ActiveTask | undefined, states: Map<string, string> | undefined, diagnostic?: string): string {
	const lines: string[] = [];
	if (task) {
		const title = task.title ? ` — ${task.title}` : "";
		lines.push(`${ACTIVE_TASK_MARKER} ${task.dir}${title}`);
		lines.push(`Status: ${task.status}`);
	} else if (diagnostic) {
		lines.push(`Status: task_error\nTask diagnostic: ${diagnostic}`);
	} else {
		lines.push("No active task for this session.");
	}

	const breadcrumb = states?.get(diagnostic ? "task_error" : task ? task.status : "no_task");
	if (breadcrumb) lines.push("", breadcrumb);

	if (task) {
		try {
			const binding = readBinding(root, task.dir) ?? readMarker(root);
			if (binding) lines.push(`Task worktree: ${binding.worktreePath} (${binding.preparationState})`);
		} catch { lines.push("Task worktree binding needs inspection."); }
		lines.push(
			"",
			`Task artifacts: ${task.dir}/prd.md, ${task.dir}/design.md, ${task.dir}/implement.md (whichever exist).`,
		);
	}
	return lines.join("\n");
}

function renderCount(theme: ExtensionTheme, count: number | undefined): string {
	return theme.fg(count === undefined ? "muted" : count > 0 ? "accent" : "dim", `(${count ?? "?"})`);
}

/** Sanitize and clip plain footer text in terminal columns before styling. */
function compactText(text: string, budget: number): string {
	const plain = stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
	// The host helper preserves graphemes but adds resets on truncation. Remove
	// those before applying the footer's semantic theme color to the whole text.
	return stripVTControlCharacters(truncateToWidth(plain, budget, "…"));
}

function renderStatus(theme: ExtensionTheme, task: ActiveTask | undefined, count: number | undefined): string {
	const label = theme.fg("muted", "trellis") + renderCount(theme, count);
	if (!task) return label;
	const prefix = `trellis(${count ?? "?"}): `;
	const separator = " ▸ ";
	const remaining = STATUS_MAX_COLUMNS - visibleWidth(prefix + separator);
	const status = compactText(task.status, Math.max(1, remaining - 1));
	const slug = compactText(basename(task.dir), Math.max(1, remaining - visibleWidth(status)));
	return label + theme.fg("dim", ": ") + theme.fg("text", slug) +
		theme.fg("dim", separator) + theme.fg(statusColor(task.status), status);
}

/** Theme token used for a status name, so the colour carries meaning. */
function statusColor(status: string): ThemeColorToken {
	switch (status) {
		case "in_progress":
			return "accent";
		case "planning":
			return "warning";
		case "completed":
			return "success";
		case "task_error":
			return "error";
		default:
			return "muted";
	}
}

/**
 * One themed line for the widget above the editor.
 *
 * The widget gets its own row, so unlike the footer chip there is no need to
 * fight other extensions for width: the task name is shown in full and the
 * planning artifacts fit alongside it.
 */
function renderWidget(theme: ExtensionTheme, task: ActiveTask | undefined, count: number | undefined): string[] {
	const label = theme.fg("muted", "▸ trellis") + renderCount(theme, count);
	if (!task) return [label];
	const dot = theme.fg("dim", " · ");
	const parts: string[] = [
		label,
		theme.bold(theme.fg("text", basename(task.dir))),
		theme.fg(statusColor(task.status), task.status),
	];

	if (task.children > 0) {
		parts.push(theme.fg("muted", `${task.children} subtask${task.children === 1 ? "" : "s"}`));
	}

	const artifact = (label: string, present: boolean) =>
		present ? theme.fg("success", `${label} ✓`) : theme.fg("dim", `${label} ·`);
	parts.push(
		[
			artifact("prd", task.artifacts.prd),
			artifact("design", task.artifacts.design),
			artifact("impl", task.artifacts.implement),
		].join(" "),
	);

	return [parts.join(dot)];
}

// ---------------------------------------------------------------------------
// M4 — agent definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared per-event work
// ---------------------------------------------------------------------------

interface Session {
	root: string;
	executionRoot: string;
	key: string;
	cacheKey: string;
	identity: string;
}

function session(ctx: ExtensionContext, allowAuthorityError = false): Session | undefined {
	const executionRoot = findRoot(ctx.cwd);
	if (!executionRoot) return undefined;
	requireRuntime(executionRoot);
	const identity = sessionIdentity(executionRoot, ctx);
	if (!allowAuthorityError && authorityErrors.has(identity)) throw new Error(authorityErrors.get(identity));
	const root = authorityBySession.get(identity)?.sourceRoot ?? sourceRootBySession.get(identity) ?? executionRoot;
	requireRuntime(root);
	const key = contextKey(executionRoot, ctx);
	return { root, executionRoot, key, cacheKey: `${identity}::${root}::${key}`, identity };
}

async function inheritDispatchTask(current: Session, facts: DispatchFacts): Promise<void> {
	// Isolate before authority validation, including caller-pinned parent keys.
	const key = `pi-child-${shortHash(current.identity)}`;
	keyBySession.set(current.identity, key);
	authorityErrors.set(current.identity, "Dispatched source authority has not been verified; no local pointer fallback");
	const native = await queryWorktree(current.executionRoot, facts.taskDir, false, undefined, false, facts.role.slice("trellis-".length) as MaterialRole);
	const priorBinding = bindingBySession.get(current.identity);
	if (priorBinding && (!native.local || !sameIdentity(priorBinding, native.local))) throw new Error("Managed binding changed since child startup");
	const m = requireMaterials(native);
	if (native.local) {
		if (!native.binding || native.local.worktreePath !== canonicalPath(current.executionRoot) || native.binding.preparationState !== "ready" || facts.contextId !== native.binding.contextId) throw new Error("Child managed binding/context mismatch");
	} else if (native.binding || native.source.root !== canonicalPath(current.executionRoot)) throw new Error("Unbound child must execute at its native source root");
	const expected = dispatchAuthority(m, native.local?.worktreePath ?? native.source.root);
	if (JSON.stringify(expected) !== JSON.stringify(dispatchAuthorityFromFacts(facts))) throw new Error("Dispatched authority paths/fingerprint differ from native source; no target fallback");
	requireRuntime(m.sourceRoot);
	invalidateTask(m.sourceRoot, key);
	resolveTaskPath(m.sourceRoot, facts.taskDir);
	readTaskRecord(m.sourceRoot, facts.taskDir);
	const result = await runPython(m.sourceRoot, key, ["-c", [
		"import sys",
		"from pathlib import Path",
		"sys.path.insert(0, str(Path.cwd() / '.trellis/scripts'))",
		"from common.active_task import set_active_task",
		"active = set_active_task(sys.argv[1], Path.cwd())",
		"sys.exit(0 if active and active.task_path == sys.argv[1] else 1)",
	].join("\n"), facts.taskDir]);
	if (!result || result.code !== 0) throw new Error("Could not bind dispatched task to source child session; no parent context inherited");
	bindingBySession.set(current.identity, native.binding ? { ...native.binding } : null);
	authorityBySession.set(current.identity, facts);
	authorityErrors.delete(current.identity);
	invalidateTask(m.sourceRoot, key);
}
function dispatchAuthorityFromFacts(f: DispatchFacts) {
	return { sourceRoot: f.sourceRoot, materialRoot: f.materialRoot, executionRoot: f.executionRoot, taskPath: f.taskPath,
		specRoot: f.specRoot, workflowPath: f.workflowPath, requirementsFingerprint: f.requirementsFingerprint,
		artifacts: f.artifacts, manifest: f.manifest, references: f.references };
}

async function requireChildAuthority(current: Session): Promise<void> {
	const facts = authorityBySession.get(current.identity);
	if (!facts) return;
	try {
		const native = await queryWorktree(current.executionRoot, facts.taskDir);
		const expected = bindingBySession.get(current.identity);
		if (native.source.root !== facts.sourceRoot || (expected
			? !native.local || !native.binding || !sameIdentity(expected, native.local) || !sameIdentity(expected, native.binding)
			: expected !== null || native.local || native.binding || native.source.root !== canonicalPath(current.executionRoot))) throw new Error("Child source/binding authority disappeared or changed; no pointer fallback");
		// Only identity and path presence are rechecked. Source content/lifecycle
		// changes are main-review evidence, not automatic cancellation conditions.
		requireSourcePath(facts.sourceRoot, facts.taskDir, facts.taskPath, true);
		requireSourcePath(facts.sourceRoot, ".trellis/spec", facts.specRoot, true);
		for (const file of facts.artifacts) requireSourcePath(facts.sourceRoot, file === facts.workflowPath ? ".trellis/workflow.md" : `${facts.taskDir}/${basename(file)}`, file);
		if (facts.manifest) requireSourcePath(facts.sourceRoot, `${facts.taskDir}/${facts.role.slice("trellis-".length)}.jsonl`, facts.manifest);
		for (const ref of facts.references) requireSourcePath(facts.sourceRoot, ref.label, ref.path);
		readTaskRecord(facts.sourceRoot, facts.taskDir);
	} catch (error) { authorityErrors.set(current.identity, String(error)); throw error; }
}

async function sessionTask(current: Session): Promise<ActiveTask | undefined> {
	if (authorityErrors.has(current.identity)) throw new Error(authorityErrors.get(current.identity));
	return readActiveTask(current.root, current.key);
}

/**
 * Repaint the project display, with optional active-task details.
 * Clear the unselected surface, or both when unsupported/disabled. The count
 * is reread on existing refresh events independently of active-task caches.
 */
async function refreshDisplay(ctx: ExtensionContext, known?: Session): Promise<void> {
	try {
		if (!ctx.hasUI) return;
		const current = known ?? session(ctx);
		if (!current || DISPLAY_MODE === "off") {
			clearDisplay(ctx);
			return;
		}

		const task = await sessionTask(current);
		requireRuntime(current.root);
		const count = readUnfinishedTaskCount(current.root);
		const theme = ctx.ui.theme as ExtensionTheme;
		if (DISPLAY_MODE === "status") {
			ctx.ui?.setWidget?.(WIDGET_KEY, undefined);
			ctx.ui?.setStatus?.(STATUS_KEY, renderStatus(theme, task, count));
			return;
		}

		ctx.ui?.setStatus?.(STATUS_KEY, undefined);
		ctx.ui?.setWidget?.(WIDGET_KEY, renderWidget(theme, task, count), {
			placement: "aboveEditor",
		});
	} catch {
		clearDisplay(ctx);
	}
}

function clearDisplay(ctx: ExtensionContext): void {
	try {
		ctx.ui?.setStatus?.(STATUS_KEY, undefined);
		ctx.ui?.setWidget?.(WIDGET_KEY, undefined);
	} catch {
		// The display is cosmetic. Never let it surface.
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * Pure helpers, exported for tests only. Not a stable API — the extension's
 * contract is its event handlers.
 */
export const __internals = {
	findRoot,
	loadWorkflow,
	platformList,
	renderOverview,
	renderWorkflowSection,
	renderState,
	renderStatus,
	renderWidget,
	statusColor,
	readUnfinishedTaskCount,
	readActiveTaskFromDisk,
	contextKey,
	loadContext,
	shortHash,
};

export default function (pi: ExtensionAPI): void {
	// One extension instance publishes at most its latest Check. A newer Check,
	// session replacement, or shutdown aborts the old run and suppresses its report.
	let checkGeneration = 0, checkController: AbortController | undefined, checkClosed = false;
	const cancelCheck = () => { checkGeneration++; checkController?.abort(); checkController = undefined; };
	registerInitCommand(pi, async (ctx, root) => {
		contextCache.clear(); taskCache.clear(); taskErrors.clear(); workflowCache.delete(root);
		sectionCache.clear(); lastStateSent.clear();
		await refreshProjectDisplay(ctx);
	}, async (_ctx, scope, options) => {
		if (checkClosed) return undefined;
		cancelCheck();
		const generation = checkGeneration, controller = new AbortController();
		checkController = controller;
		const relay = () => controller.abort();
		options.signal?.addEventListener("abort", relay, { once: true });
		if (options.signal?.aborted) controller.abort();
		try {
			const result = await runDiagnostics(scope, { signal: controller.signal });
			return !checkClosed && generation === checkGeneration && !controller.signal.aborted ? result : undefined;
		} finally {
			options.signal?.removeEventListener("abort", relay);
			if (checkController === controller) checkController = undefined;
		}
	});
	let registeredRoot: string | undefined;
	let startupCwd: string | undefined;
	const refreshProjectDisplay = async (ctx: ExtensionContext, known?: Session) => {
		try {
			if ((registeredRoot && findRoot(ctx.cwd) !== registeredRoot) || (!registeredRoot && startupCwd !== undefined && ctx.cwd !== startupCwd)) { clearDisplay(ctx); return; }
			await refreshDisplay(ctx, known);
		} catch { clearDisplay(ctx); }
	};
	const registerProjectCapabilities = (root: string) => {
		if (registeredRoot) return;
		registeredRoot = root;
		registerTaskBrowserCommand(pi, {
			findRoot: (cwd, ctx) => {
				try {
					const found = findRoot(cwd);
					if (!found || found !== registeredRoot) throw new Error("Project changed; reload before browsing Trellis tasks");
					requireRuntime(found);
					const current = ctx ? session(ctx) : undefined;
					return current?.root ?? found;
				} catch (error) { clearDisplay(ctx); throw error; }
			},
			currentTask: (root, ctx) => readCurrentTaskIdentity(root, session(ctx)?.key ?? contextKey(root, ctx)),
		});
		const guardedPi = Object.create(pi) as ExtensionAPI;
		guardedPi.registerTool = tool => pi.registerTool({ ...tool, execute: async (...args) => {
			const ctx = args[4];
			try {
				if (findRoot(ctx.cwd) !== registeredRoot) throw new Error("Project changed; reload before Trellis dispatch");
				const current = session(ctx);
				if (current && roleBySession.has(current.identity)) throw new Error("Task roles must not recursively dispatch; return findings to main");
				requireRuntime(registeredRoot!);
			} catch (error) { clearDisplay(ctx); throw error; }
			return tool.execute(...args);
		} });
		registerDispatchTool(guardedPi, async (ctx) => {
			const current = session(ctx);
			if (current?.executionRoot !== registeredRoot) throw new Error("Project changed; reload before Trellis dispatch");
			return current ? (await sessionTask(current))?.dir : undefined;
		});
	};

	// ---- M1 / M4 / M2: session bootstrap -----------------------------------

	pi.on("session_start", async (_event, ctx) => {
		cancelCheck(); checkClosed = false;
		startupCwd ??= ctx.cwd;
		if (!registeredRoot && ctx.cwd !== startupCwd) {
			clearDisplay(ctx);
			if (ctx.hasUI) ctx.ui.notify("Project changed; reload to activate Trellis in this project", "warning");
			return;
		}
		let current: Session | undefined;
		try { current = session(ctx); }
		catch (error) { if (ctx.hasUI) ctx.ui.notify(runtimeDiagnostic(error), "error"); clearDisplay(ctx); return; }
		if (!current) {
			if (ctx.hasUI) clearDisplay(ctx);
			return;
		}
		if (registeredRoot && registeredRoot !== current.executionRoot) {
			clearDisplay(ctx);
			if (ctx.hasUI) ctx.ui.notify("Project changed; reload to activate Trellis in this project", "warning");
			return;
		}
		registerProjectCapabilities(current.executionRoot);
		// Startup precedes the dispatch prompt. Authenticate a managed marker through
		// native source binding facts, retain registration at the actual checkout,
		// and isolate before any CLI can observe a stale target/parent pointer.
		try {
			const linkedCheckout = existsSync(join(current.executionRoot, ".git")) && lstatSync(join(current.executionRoot, ".git")).isFile();
			if ((readMarker(current.executionRoot) || linkedCheckout) && !authorityBySession.has(current.identity)) {
				keyBySession.set(current.identity, `pi-child-${shortHash(current.identity)}`);
				authorityErrors.set(current.identity, "Managed child awaits a complete verified source authority header; no target pointer fallback");
				const native = await queryWorktree(current.executionRoot);
				if (!native.local) {
					// A source repository can also use a .git file (submodule or
					// separate git-dir). Native source identity distinguishes it from
					// an unbound linked target; restore only that verified source key.
					if (native.source.root !== canonicalPath(current.executionRoot)) throw new Error("Invalid source startup identity");
					keyBySession.set(current.identity, current.key);
					authorityErrors.delete(current.identity);
					current = session(ctx)!;
				} else {
					if (native.local.worktreePath !== canonicalPath(current.executionRoot)) throw new Error("Invalid managed startup identity");
					bindingBySession.set(current.identity, { ...native.local });
					sourceRootBySession.set(current.identity, native.source.root);
					current = session(ctx, true)!;
				}
			}
		} catch (error) {
			keyBySession.set(current.identity, `pi-child-${shortHash(current.identity)}`);
			authorityErrors.set(current.identity, `Managed startup authority failed: ${String(error)}; no pointer fallback`);
			if (ctx.hasUI) ctx.ui.notify(runtimeDiagnostic(error), "error");
			clearDisplay(ctx); return;
		}

		// Behavioural version check: if the CLI contract moved, say so once
		// instead of degrading silently.
		const probe = await loadContext(current.root, current.key);
		if (!probe && ctx.hasUI && !warnedBrokenCli) {
			warnedBrokenCli = true;
			ctx.ui?.notify?.(
				"pi-trellis: get_context.py did not return usable JSON — Trellis context injection is degraded. Check the Trellis version.",
				"warning",
			);
		}

		// Q2: detect the public subagent_run entry, independently of RPC readiness.
		// Headless child sessions need not expose a launch tool.
		if (ctx.hasUI && !warnedMissingAgentTool) {
			try {
				const hasAgentTool = pi.getAllTools().some((tool) => tool.name === "subagent_run");
				if (!hasAgentTool) {
					warnedMissingAgentTool = true;
					ctx.ui?.notify?.(
						"pi-trellis：未检测到 subagent_run。请确认 my-pi-preset 的 Task Composition 已启用并重载会话",
						"warning",
					);
				}
			} catch {
				// Tool enumeration is best-effort.
			}
		}

		await refreshProjectDisplay(ctx, current);
	});

	// ---- M1: prompt sections -----------------------------------------------

	pi.on("before_agent_start", async (event, ctx) => {
		let initial: Session | undefined;
		try { initial = session(ctx, true); }
		catch (error) {
			let identity: string | undefined;
			try { const root = findRoot(ctx.cwd); if (root) identity = sessionIdentity(root, ctx); } catch { /* unsafe discovery grants no context */ }
			if (identity && (authorityBySession.has(identity) || sourceRootBySession.has(identity))) pi.sendMessage({ customType: STATE_MESSAGE_TYPE, content: `Status: task_error\nTrellis context diagnostic: ${runtimeDiagnostic(error)}`, display: false });
			clearDisplay(ctx); return;
		}
		try {
			let current = initial;
			if (!current || (registeredRoot && current.executionRoot !== registeredRoot) || (!registeredRoot && startupCwd !== undefined && ctx.cwd !== startupCwd)) { clearDisplay(ctx); return; }
			const prompt = "prompt" in event ? event.prompt : "";
			const facts = parseDispatchFacts(prompt);
			if (!facts && /^Active task:/.test(prompt)) {
				keyBySession.set(current.identity, `pi-child-${shortHash(current.identity)}`);
				authorityErrors.set(current.identity, "Incomplete/invalid source authority header; no pointer fallback");
			}
			const priorAuthority = authorityBySession.get(current.identity);
			if (facts && priorAuthority && taskBySession.get(current.identity) === facts.taskDir && roleBySession.get(current.identity) === facts.role && JSON.stringify(priorAuthority) !== JSON.stringify(facts)) {
				authorityErrors.set(current.identity, "Dispatch authority changed within this child session; main must review/re-dispatch, no pointer fallback");
			}
			if (facts && (taskBySession.get(current.identity) !== facts.taskDir || roleBySession.get(current.identity) !== facts.role)) {
				await inheritDispatchTask(current, facts);
				taskBySession.set(current.identity, facts.taskDir);
				roleBySession.set(current.identity, facts.role);
				sectionCache.delete(current.cacheKey);
				current = session(ctx)!;
			}
			if (authorityErrors.has(current.identity)) throw new Error(authorityErrors.get(current.identity));
			await requireChildAuthority(current);

			const sections = event.systemPromptOptions?.sections;
			if (!sections) return;

			// Headless sessions (subagents, `pi -p`) get the compact payload: the
			// workflow excerpt is the largest block and the least useful to a
			// single-purpose agent. TRELLIS_PI_CONTEXT overrides the guess.
			const compact = CONTEXT_MODE === "compact" || (CONTEXT_MODE !== "full" && !ctx.hasUI);

			let cached = sectionCache.get(current.cacheKey);
			if (!cached) {
				cached = {};
				sectionCache.set(current.cacheKey, cached);
			}

			if (cached.overview === undefined) {
				const context = await loadContext(current.root, current.key);
				cached.overview = renderOverview(current.root, current.key, context, roleBySession.get(current.identity), undefined, current.executionRoot);
			}
			sections[SECTION_OVERVIEW] = cached.overview;

			if (!compact) {
				if (cached.workflow === undefined) {
					const workflow = loadWorkflow(current.root);
					cached.workflow = workflow ? renderWorkflowSection(workflow.head) : "";
				}
				if (cached.workflow) sections[SECTION_WORKFLOW] = cached.workflow;
			}

			// Volatile state never enters the prompt: a section that changes every
			// turn invalidates the provider's prefix cache from byte zero.
			const task = await sessionTask(current);
			const state = renderState(current.root, task, loadWorkflow(current.root)?.states, taskErrors.get(cacheKeyFor(current.root, current.key)));
			if (lastStateSent.get(current.cacheKey) !== state) {
				lastStateSent.set(current.cacheKey, state);
				pi.sendMessage({
					customType: STATE_MESSAGE_TYPE,
					content: state,
					display: false,
				});
			}
		} catch (error) {
			if (initial && (authorityBySession.has(initial.identity) || sourceRootBySession.has(initial.identity))) authorityErrors.set(initial.identity, String(error));
			delete event.systemPromptOptions?.sections?.[SECTION_OVERVIEW];
			delete event.systemPromptOptions?.sections?.[SECTION_WORKFLOW];
			const content = `Status: task_error\nTrellis context diagnostic: ${runtimeDiagnostic(error)}`;
			const identity = `${ctx.cwd}::${ctx.sessionManager.getSessionId()}::error`;
			if (lastStateSent.get(identity) !== content) {
				lastStateSent.set(identity, content);
				pi.sendMessage({ customType: STATE_MESSAGE_TYPE, content, display: false });
			}
			clearDisplay(ctx);
		}
	});

	// ---- M3 / session isolation: tool_call ---------------------------------

	pi.on("tool_call", async (event, ctx) => {
		// Discovery is not authorization. Unsupported roots still allow ordinary
		// read/search commands and non-Trellis agents, but cannot execute runtime.
		const input = event.input as { command?: unknown; subagent_type?: unknown };
		const trellisExecution = (["bash", "monitor"].includes(event.toolName) && typeof input.command === "string" && invokesRuntime(input.command)) ||
			(event.toolName === "subagent_run" && isTrellisRole(input.subagent_type));
		let root: string | undefined;
		try { root = findRoot(ctx.cwd); }
		catch (error) {
			clearDisplay(ctx);
			if (trellisExecution) return { block: true, reason: `${runtimeDiagnostic(error)} No command or child was started.` };
			return;
		}
		if ((registeredRoot && root !== registeredRoot) || (!registeredRoot && startupCwd !== undefined && ctx.cwd !== startupCwd)) {
			clearDisplay(ctx);
			if (trellisExecution) return { block: true, reason: "Project changed; reload before Trellis execution. No command or child was started." };
			return;
		}
		if (!root) return;
		try { requireRuntime(root); }
		catch (error) {
			clearDisplay(ctx);
			if (trellisExecution) return { block: true, reason: `${runtimeDiagnostic(error)} No command or child was started.` };
			return;
		}
		try {
			const current = session(ctx);
			if (!current) return;
			await requireChildAuthority(current);

			if (["bash", "monitor"].includes(event.toolName)) {
				const input = event.input as { command?: unknown };
				if (typeof input.command !== "string") return;
				// Scope every shell, including indirect CLI invocations, without a process-global mutation.
				const prefix = `export TRELLIS_CONTEXT_ID=${current.key}\n`;
				let command = input.command.startsWith(prefix) ? input.command.slice(prefix.length) : input.command;
				if (current.root !== current.executionRoot && invokesRuntime(command)) {
					// Never move a mixed product/runtime shell to source. Only a single
					// invocation is root-scoped; callers split shell pipelines explicitly.
					const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
					const open = `(cd ${quote(current.root)}\n`;
					if (command.startsWith(open) && command.endsWith("\n)")) command = command.slice(open.length, -2);
					if (/[\r\n;&|()<>`$]/.test(command)) return { block: true, reason: "Mixed runtime/product shell cannot be retargeted to source safely. Run the Trellis CLI as a separate single invocation; product commands retain execution cwd." };
					const words = (command.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? []).map(word => word.replace(/^(["'])(.*)\1$/s, "$2"));
					const scripts = words.filter(word => /^(?:task|get_context|init_developer|get_developer|add_session|worktree)\.py$/.test(basename(word)));
					if (scripts.length !== 1 || ![`.trellis/scripts/${basename(scripts[0])}`, `./.trellis/scripts/${basename(scripts[0])}`, scriptPath(current.root, basename(scripts[0]))].includes(scripts[0]) || words.some(word => /^(?:--cwd|--chdir|--directory)(?:=|$)|^-C/.test(word))) return { block: true, reason: "Managed runtime invocation must use the source .trellis/scripts CLI without cwd overrides. Absolute target/foreign scripts, inline runtime code and global CLI commands are not source-authoritative; split or correct the invocation." };
					command = `${open}${command}\n)`;
				}
				if (!command.startsWith(prefix)) input.command = `${prefix}${command}`;
				return;
			}

			if (event.toolName !== "subagent_run") return;
			const input = event.input as { subagent_type?: unknown; prompt?: unknown; isolated?: unknown; isolation?: unknown };
			if (!isTrellisRole(input.subagent_type) || typeof input.prompt !== "string") return;
			// Ordinary subagent_run cannot promise task materials from a separately-created temporary tree.
			if (input.isolation === "worktree") return { block: true, reason: "pi-trellis task agents need the current prepared checkout. Temporary worktree isolation cannot see its uncommitted task materials; no agent was started." };
			if (isTrellisRole(input.subagent_type)) {
				try { if (readMarker(current.root)) return { block: true, reason: "This is a managed task worktree. Dispatch through trellis_dispatch from the source host so directory occupancy is reserved; no ordinary child was started." }; }
				catch (error) { return { block: true, reason: `Worktree marker cannot be verified: ${String(error)}. No child was started.` }; }
			}
			if (roleBySession.has(current.identity)) return { block: true, reason: "Task roles must not recursively dispatch other roles; return findings to main." };
			const task = await sessionTask(current);
			if (taskErrors.has(cacheKeyFor(current.root, current.key))) throw new Error(taskErrors.get(cacheKeyFor(current.root, current.key)));
			if (task) {
				try {
					if (readBinding(current.root, task.dir) || readMarker(current.root)) return { block: true, reason: "This task is bound to a worktree. Ordinary subagent_run cannot select or reserve its directory; use python3 .trellis/scripts/worktree.py prepare --task <task> (preview, then approved --confirm), then trellis_dispatch. No child was started." };
				} catch (error) { return { block: true, reason: `Worktree binding cannot be verified: ${String(error)}. No child was started.` }; }
			}
			if (!task) return { block: true, reason: "No validated active source task; no child was started." };
			const selectedRole = input.subagent_type.slice("trellis-".length) as MaterialRole;
			const initial = await queryWorktree(current.executionRoot, task.dir, false, undefined, false, selectedRole);
			if (initial.binding || initial.local || initial.source.root !== canonicalPath(current.executionRoot)) throw new Error("Ordinary dispatch must be unbound at its native source root");
			const materials = requireMaterials(initial);
			const prompt = assembleDispatchPrompt({ prompt: input.prompt, contextId: `pi-child-${shortHash(current.identity + Date.now() + input.prompt)}`, role: input.subagent_type, materials, executionRoot: initial.source.root });
			const final = await queryWorktree(current.executionRoot, task.dir, false, undefined, false, selectedRole);
			if (final.binding || final.local || requireMaterials(final).sourceFingerprint !== materials.sourceFingerprint) throw new Error("Source materials/binding changed during prompt rendering");
			input.prompt = prompt;
		} catch (error) {
			if (["bash", "monitor"].includes(event.toolName) && typeof (event.input as { command?: unknown }).command === "string") {
				return { block: true, reason: `Trellis runtime/context cannot be verified: ${String(error)}. No command was started.` };
			}
			if (event.toolName === "subagent_run") {
				const input = event.input as { subagent_type?: unknown; prompt?: unknown };
				if (isTrellisRole(input.subagent_type) && typeof input.prompt === "string") {
					input.prompt = stripDispatchClaims(input.prompt);
					return { block: true, reason: `Trellis source authority cannot be verified: ${String(error)}. No child was started.` };
				}
			}
		}
	});

	// ---- M2: status refresh ------------------------------------------------

	pi.on("tool_result", async (event, ctx) => {
		try {
			if (!["bash", "monitor"].includes(event.toolName)) return;
			const command = (event.input as { command?: unknown }).command;
			if (typeof command !== "string" || !/(?:task|get_context|init_developer|add_session)\.py/.test(command)) return;
			const current = session(ctx);
			if (current) {
				invalidateTask(current.root, current.key);
				contextCache.delete(cacheKeyFor(current.root, current.key));
				sectionCache.delete(current.cacheKey); lastStateSent.delete(current.cacheKey);
			}
			await refreshProjectDisplay(ctx, current);
		} catch {
			clearDisplay(ctx);
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		await refreshProjectDisplay(ctx);
	});

	// ---- Cleanup -----------------------------------------------------------

	pi.on("session_shutdown", (_event, ctx) => {
		cancelCheck(); checkClosed = true;
		clearDisplay(ctx);
		let root: string | undefined;
		try { root = findRoot(ctx.cwd); } catch { return; }
		if (!root) return;
		// Cleanup is bookkeeping, not runtime execution; unsupported roots must
		// not throw here or retain a previously supported session's binding memo.
		const identity = sessionIdentity(root, ctx), key = keyBySession.get(identity);
		const materialRoot = authorityBySession.get(identity)?.sourceRoot ?? sourceRootBySession.get(identity) ?? root;
		keyBySession.delete(identity);
		taskBySession.delete(identity);
		sourceRootBySession.delete(identity);
		authorityBySession.delete(identity); bindingBySession.delete(identity); authorityErrors.delete(identity);
		roleBySession.delete(identity);
		if (key) {
			const cacheKey = `${identity}::${materialRoot}::${key}`;
			contextCache.delete(cacheKeyFor(materialRoot, key)); taskCache.delete(cacheKeyFor(materialRoot, key)); taskErrors.delete(cacheKeyFor(materialRoot, key));
			sectionCache.delete(cacheKey);
			lastStateSent.delete(cacheKey);
		}
	});
}
