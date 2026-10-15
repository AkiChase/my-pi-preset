import assert from "node:assert/strict";
import { it } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixture } from "./helpers.ts";
import { projectIdentity } from "../identity.ts";

it("own Git repo, subdirectory and worktree share real common-dir identity; nonGit real paths isolated", async t => {
  const { root } = fixture(t); const repo = join(root, "repo"); fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdio: "pipe" });
  git("init"); git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
  const worktree = join(root, "worktree"); git("worktree", "add", "--detach", worktree);
  const child = join(repo, "child"); fs.mkdirSync(child);
  assert.equal((await projectIdentity(repo)).id, (await projectIdentity(child)).id);
  assert.equal((await projectIdentity(repo)).id, (await projectIdentity(worktree)).id);
  const first = join(root, "nongit-a"), second = join(root, "nongit-b"); fs.mkdirSync(first); fs.mkdirSync(second);
  assert.notEqual((await projectIdentity(first)).id, (await projectIdentity(second)).id);
  fs.symlinkSync(first, join(root, "alias")); assert.equal((await projectIdentity(first)).id, (await projectIdentity(join(root, "alias"))).id);
});
it("Git permission/error/timeout is not downgraded to nonGit", async t => {
  const { root } = fixture(t);
  await assert.rejects(projectIdentity(root, async () => { throw new Error("permission"); }), /permission/);
  await assert.rejects(projectIdentity(root, async () => { throw new Error("timeout"); }), /timeout/);
});
