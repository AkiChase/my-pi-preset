import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { verifyRuntime } from "./initialization/engine.ts";

/** Discovery is read-only and never crosses the nearest Git worktree boundary. */
export function discoverProject(cwd: string): { root?: string; gitRoot?: string } {
	let dir = resolve(cwd);
	for (;;) {
		if (present(join(dir, ".trellis"))) return { root: dir };
		if (present(join(dir, ".git"))) return { gitRoot: dir };
		const parent = dirname(dir);
		if (parent === dir) return {};
		dir = parent;
	}
}

function present(path: string): boolean {
	try { lstatSync(path); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export function findProjectRoot(cwd: string): string | undefined {
	return discoverProject(cwd).root;
}

export function initializationRoot(cwd: string): string {
	const project = discoverProject(cwd);
	return project.root ?? project.gitRoot ?? resolve(cwd);
}

export function requireProjectRuntime(root: string): void {
	// A file, symlink or dangling marker is not a project runtime. Do not skip it
	// and accidentally activate an ancestor project instead.
	if (!lstatSync(join(root, ".trellis")).isDirectory()) throw new Error("Trellis marker must be a local directory");
	if (!verifyRuntime(root)) throw new Error("Unsupported Trellis runtime: supported project manifest is missing");
}
