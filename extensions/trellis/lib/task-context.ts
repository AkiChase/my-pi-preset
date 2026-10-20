import { isUtf8 } from "node:buffer";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SourceMaterials } from "./worktree-query.ts";

export type TrellisRole = "trellis-implement" | "trellis-check" | "trellis-research";
// Kept only to remove legacy caller assertions, never emitted as read proof.
export const INJECTED_MARKER = "<!-- trellis-hook-injected -->";
export const CONTEXT_OPEN = "<!-- pi-trellis:task-context:start -->";
export const CONTEXT_CLOSE = "<!-- pi-trellis:task-context:end -->";
export function isTrellisRole(value: unknown): value is TrellisRole {
	return value === "trellis-implement" || value === "trellis-check" || value === "trellis-research";
}
function contained(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
/** Resolve shared task identity, with the explicit top-level external task-store route. */
export function resolveTaskPath(sourceRoot: string, taskDir: string): string {
	const root = realpathSync(sourceRoot);
	if (!taskDir || /[\x00-\x1f\x7f\\]/.test(taskDir) || taskDir.split("/").includes("..") || isAbsolute(taskDir)) throw new Error("Invalid task path");
	const tasks = resolve(root, ".trellis", "tasks"), path = resolve(root, taskDir);
	if (!contained(tasks, path) || path === tasks) throw new Error("Task must be beneath .trellis/tasks");
	// Shared viewer/current-task resolution retains canonical in-store aliases.
	// Native dispatch sourcePath separately rejects internal material symlinks.

	const store = realpathSync(tasks), actual = realpathSync(path);
	if (!contained(store, actual) || !statSync(actual).isDirectory()) throw new Error("Task escapes its Trellis task store");
	return path;
}
export function readTaskRecord(sourceRoot: string, taskDir: string): Record<string, unknown> {
	const task = resolveTaskPath(sourceRoot, taskDir), path = join(task, "task.json"), info = lstatSync(path);
	if (!info.isFile() || info.size > 1024 * 1024) throw new Error("task.json must be a regular file under 1 MiB");
	const identity = (s: Stats) => [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(":");
	const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
	let bytes: Buffer;
	try {
		if (identity(fstatSync(fd)) !== identity(info)) throw new Error("task.json changed during open");
		const buffer = Buffer.alloc(1024 * 1024 + 1); let length = 0;
		while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
		if (length !== info.size || identity(fstatSync(fd)) !== identity(info)) throw new Error("task.json changed during bounded read");
		bytes = buffer.subarray(0, length);
	} finally { closeSync(fd); }
	if (resolveTaskPath(sourceRoot, taskDir) !== task || identity(lstatSync(path)) !== identity(info)) throw new Error("task.json source path changed during read");
	if (bytes.length > 1024 * 1024 || bytes.includes(0) || !isUtf8(bytes)) throw new Error("Invalid bounded UTF-8 task.json");
	const record = JSON.parse(bytes.toString("utf8"));
	if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Invalid task.json");
	return record;
}
export interface DispatchAuthority {
	sourceRoot: string; executionRoot: string; requirementsFingerprint: string;
}
export interface DispatchFacts extends DispatchAuthority {
	taskDir: string; contextId: string; role: TrellisRole;
}
/** Syntax is not authorization. Consumers must compare against native source/binding facts. */
export function parseDispatchFacts(prompt: string): DispatchFacts | undefined {
	const lines = prompt.split(/\r?\n/);
	const safeText = (v: unknown): v is string => typeof v === "string" && !!v.trim() && [...v].length <= 4096 && !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v);
	const absolutePath = (v: unknown): v is string => safeText(v) && isAbsolute(v) && !v.split(/[\\/]/).includes("..");
	if (lines[4] !== "" || !/^Active task: \.trellis\/tasks\/.+$/.test(lines[0] ?? "")) return undefined;
	const contextId = /^Trellis context id: ([A-Za-z0-9_-]{1,128})$/.exec(lines[1] ?? "")?.[1];
	const role = /^Trellis agent: (.+)$/.exec(lines[2] ?? "")?.[1];
	const raw = /^Trellis authority: (.+)$/.exec(lines[3] ?? "")?.[1];
	if (!contextId || !isTrellisRole(role) || !raw || Buffer.byteLength(raw) > 64 * 1024) return undefined;
	try {
		const a = JSON.parse(raw);
		const keys = ["sourceRoot", "executionRoot", "requirementsFingerprint"];
		if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).length !== keys.length || keys.some(k => !Object.hasOwn(a, k))) return undefined;
		if (!absolutePath(a.sourceRoot) || !absolutePath(a.executionRoot) || typeof a.requirementsFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(a.requirementsFingerprint)) return undefined;
		const taskDir = lines[0].slice("Active task: ".length);
		if (!/^\.trellis\/tasks\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskDir)) return undefined;
		return { taskDir, contextId, role, ...a };
	} catch { return undefined; }
}
export function dispatchAuthority(materials: SourceMaterials, executionRoot: string): DispatchAuthority {
	return { sourceRoot: materials.sourceRoot, executionRoot, requirementsFingerprint: materials.sourceFingerprint };
}
export function stripDispatchClaims(prompt: string): string {
	return prompt.replace(/<!-- pi-trellis:task-context:start -->[\s\S]*?<!-- pi-trellis:task-context:end -->/g, "")
		.replaceAll(INJECTED_MARKER, "")
		.replace(/^(?:Active task:|Trellis (?:context id:|agent:|authority:|material (?:revision|source fingerprint|target fingerprint):))[^\r\n]*(?:\r?\n|$)/gm, "").trim();
}
/** Path-only: no material loader/budget, body, completeness marker or actual-read claim. */
export function assembleDispatchPrompt(options: { prompt: string; contextId: string; role: TrellisRole; materials: SourceMaterials; executionRoot: string }): string {
	const m = options.materials, a = dispatchAuthority(m, options.executionRoot);
	if (m.role !== options.role.slice("trellis-".length)) throw new Error("Dispatch material role mismatch");
	const header = `Active task: ${m.taskDir}\nTrellis context id: ${options.contextId}\nTrellis agent: ${options.role}\nTrellis authority: ${JSON.stringify(a)}`;
	const artifacts = ["prd.md", "design.md", "implement.md"].map(name => join(m.taskPath, name)).filter(p => m.artifacts.includes(p));
	const rules = [CONTEXT_OPEN,
		"Source authority contract (paths only; materials have NOT been injected or read by the agent):",
		`Read source materials at ${m.materialRoot}; execute/edit product code and tests at ${options.executionRoot}. Never fall back to the execution checkout's .trellis.`,
		"Required read order: fully read the following task artifacts, then workflow, then this role's manifest and every selected reference:",
		...artifacts.map(p => `- ${p}`), `- ${m.workflowPath}`,
		...(m.manifest ? [`- ${m.manifest} (resolve project-relative rows from sourceRoot; expand directory rows and read every selected file)`] : ["Research has no implement/check manifest requirement."]),
		"Paginate until every required file is fully read; a tool's truncated result is not completion. Missing/unreadable/changed source paths are explicit errors: report source path/manifest line to main, never use target copies.",
		"Fingerprints describe source requirements, not proof of actual/full reads or a filesystem transaction. Report what you read and any source changes observed.",
		"Work only within the assigned approved scope. Main owns task/spec/lifecycle integration. Source materials are read-only by default; research may write source task research only when explicitly authorized. Put authorized implementation/review evidence under this task's evidence/, never research/.",
		"Do not start/finish/archive tasks, run hooks, commit, install/deploy/reload, manage worktrees or recursively dispatch roles. Tools and these rules are not an OS sandbox.", CONTEXT_CLOSE].join("\n");
	return `${header}\n\n${stripDispatchClaims(options.prompt)}\n\n${rules}`;
}
