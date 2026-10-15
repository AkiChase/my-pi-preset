import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export interface ProjectIdentity { id: string; name: string; root: string; kind: "git" | "directory" }
export type GitProbe = (cwd: string) => Promise<string | null>;

// Only Git's explicit not-a-repository diagnostic permits the non-Git fallback.
export const probeGit: GitProbe = (cwd) => new Promise((fulfill, reject) => {
  execFile("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { timeout: 2000, maxBuffer: 4096, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } },
    (error, stdout, stderr) => {
      if (!error) fulfill(stdout.trim());
      else if (!error.killed && error.code === 128 && /^fatal: not a git repository(?: \(or any of the parent directories\))?:/m.test(stderr.trim())) fulfill(null);
      else reject(new Error("Project identity failed: Git probe error or timeout."));
    });
});

export async function projectIdentity(cwd: string, probe: GitProbe = probeGit): Promise<ProjectIdentity> {
  const directory = await realpath(cwd);
  const common = await probe(directory);
  const root = common === null ? directory : await realpath(resolve(directory, common));
  const name = basename(common === null ? root : basename(root) === ".git" ? dirname(root) : root)
    .replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "project";
  const kind = common === null ? "directory" : "git";
  const hash = createHash("sha256").update(`${kind}\0${root}`).digest("hex");
  return { id: `${name}-${hash}`, name, root, kind };
}
