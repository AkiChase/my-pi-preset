import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { verifyRuntime } from "./initialization/engine.ts";
import { resourceRoot } from "./paths.ts";
import { parseBinding, sameIdentity, type WorktreeBinding } from "./bindings.ts";
import { canonicalPath, taskSlug } from "./config.ts";

export type MaterialRole = "implement" | "check" | "research";
export interface QueryIssue { code: string; message: string; nextAction: string; role?: string; path?: string; manifest?: string; line?: number }
export interface SourceMaterials {
	state: "valid"; role: MaterialRole; sourceRoot: string; materialRoot: string; taskDir: string; taskPath: string;
	specRoot: string; workflowPath: string; artifacts: string[]; manifest: string | null;
	references: { label: string; path: string; sha256: string; bytes: number }[];
	sourceFingerprint: string; revision: string; issues: QueryIssue[];
}
export interface WorktreeQuery {
	ok: true; source: { root: string; commonDir: string; worktrees: { path: string; head: string; branch: string | null; bare: boolean }[] };
	local: WorktreeBinding | null; binding?: WorktreeBinding | null;
	materials?: SourceMaterials | { state: "invalid"; role: MaterialRole; issues: QueryIssue[] }; issues: QueryIssue[];
}
export class WorktreeQueryError extends Error {
	issues: QueryIssue[];
	stderr: string;
	constructor(message: string, issues: QueryIssue[] = [], stderr = "") {
		super([message, ...issues.map(i => `${i.code}: ${i.message}${i.path ? ` (${i.path})` : ""}${i.manifest ? ` [${i.manifest}${i.line ? `:${i.line}` : ""}]` : ""}. ${i.nextAction}`), stderr.trim()].filter(Boolean).join("\n"));
		this.name = "WorktreeQueryError"; this.issues = issues; this.stderr = stderr;
	}
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && [...v].length <= 4096 && !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const role = (v: unknown): v is MaterialRole => ["implement", "check", "research"].includes(v as string);
function path(v: unknown): asserts v is string {
	if (!text(v) || !isAbsolute(v) || canonicalPath(v) !== v) throw new Error("Invalid canonical authority path");
}
function contained(root: string, value: string): boolean {
	const r = relative(root, value); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
}
function sourcePath(root: string, label: string): string {
	if (!text(label) || isAbsolute(label) || label.includes("\\") || label.split("/").includes("..")) throw new Error("Invalid source material label");
	const lexical = join(root, label), store = join(root, ".trellis/tasks");
	if (!contained(root, lexical)) throw new Error("Material leaves source root");
	for (let p = lexical; p !== root; p = dirname(p)) if (p !== store && lstatSync(p).isSymbolicLink()) throw new Error("Unauthorized source material symlink");
	const actual = realpathSync(lexical);
	if (!contained(root, actual) && !(contained(store, lexical) && contained(realpathSync(store), actual))) throw new Error("Material leaves source/task store");
	return actual;
}
/** Recheck path authority/presence only, without hashing live content or changing requirements. */
export function requireSourcePath(root: string, label: string, expected: string, directory = false): void {
	path(expected);
	if (sourcePath(root, label) !== expected) throw new Error(`Source material authority changed: ${label}`);
	const info = lstatSync(expected);
	if (directory ? !info.isDirectory() : !info.isFile()) throw new Error(`Required source material is unavailable: ${label}`);
}
function issues(value: unknown): QueryIssue[] {
	if (!Array.isArray(value) || value.length > 2048) throw new Error("Invalid query issues");
	for (const i of value) {
		if (!object(i) || !text(i.code) || !text(i.message) || !text(i.nextAction) ||
			["role", "path", "manifest"].some(k => i[k] !== undefined && !text(i[k])) ||
			(i.line !== undefined && (!Number.isSafeInteger(i.line) || i.line < 1))) throw new Error("Invalid structured query issue");
	}
	return value;
}
/** Validate the native envelope, not a TypeScript assertion or a caller's prompt. */
export function parseWorktreeQuery(value: unknown, task?: string, selectedRole?: MaterialRole): WorktreeQuery {
	if (!object(value)) throw new WorktreeQueryError("Invalid native query envelope");
	const diagnostics = issues(value.issues);
	if (value.ok !== true) throw new WorktreeQueryError(text(value.error) ? value.error : "Native worktree query failed", diagnostics);
	if (!object(value.source)) throw new Error("Invalid query source");
	path(value.source.root); path(value.source.commonDir);
	if (!Array.isArray(value.source.worktrees) || value.source.worktrees.length > 10000) throw new Error("Invalid query worktrees");
	for (const row of value.source.worktrees) {
		if (!object(row)) throw new Error("Invalid Git worktree row");
		path(row.path);
		if (typeof row.head !== "string" || (row.branch !== null && typeof row.branch !== "string") || typeof row.bare !== "boolean") throw new Error("Invalid Git worktree facts");
	}
	for (const key of ["local", "binding"]) {
		if (key === "local" && !Object.hasOwn(value, key)) throw new Error("Missing query local identity");
		if (Object.hasOwn(value, key) && value[key] === undefined) throw new Error(`Invalid query ${key} identity`);
		if (value[key] !== undefined && value[key] !== null) {
			const b = parseBinding(value[key]);
			if (b.sourceRoot !== value.source.root || b.repositoryIdentity !== value.source.commonDir || (key === "binding" && task !== undefined && b.taskDir !== task)) throw new Error("Query binding source/task identity mismatch");
		}
	}
	if (task !== undefined && !Object.hasOwn(value, "binding")) throw new Error("Missing selected task binding fact");
	if (value.local && value.binding && !sameIdentity(value.local, value.binding)) throw new Error("Conflicting local/source binding");
	const m = value.materials;
	if (m !== undefined) {
		if (!object(m) || !role(m.role) || (selectedRole && m.role !== selectedRole)) throw new Error("Invalid query material role");
		issues(m.issues);
		if (m.state === "invalid") {
			if (!m.issues.length || !diagnostics.length) throw new Error("Invalid material result lacks diagnostics");
		} else {
			if (m.state !== "valid" || m.issues.length || diagnostics.length || Buffer.byteLength(JSON.stringify(m)) > 512 * 1024) throw new Error("Invalid material readiness/authority bound");
			for (const k of ["sourceRoot", "materialRoot", "taskPath", "specRoot", "workflowPath"]) path(m[k]);
			taskSlug(m.taskDir);
			if (m.sourceRoot !== value.source.root || m.materialRoot !== m.sourceRoot || (task !== undefined && task !== m.taskDir) ||
				m.taskPath !== sourcePath(m.sourceRoot, m.taskDir) || m.specRoot !== sourcePath(m.sourceRoot, ".trellis/spec") ||
				m.workflowPath !== sourcePath(m.sourceRoot, ".trellis/workflow.md")) throw new Error("Query authority paths do not match source task/spec/workflow");
			if (!hash(m.sourceFingerprint) || m.revision !== m.sourceFingerprint) throw new Error("Invalid source requirements fingerprint");
			const expected = [join(m.taskPath, "task.json"), m.workflowPath, join(m.taskPath, "prd.md")];
			if (!Array.isArray(m.artifacts) || m.artifacts.length < 3 || m.artifacts.length > 5) throw new Error("Invalid required artifact paths");
			m.artifacts.forEach((p: unknown, i: number) => { path(p); if (i < 3 ? p !== expected[i] : ![join(m.taskPath, "design.md"), join(m.taskPath, "implement.md")].includes(p)) throw new Error("Invalid artifact authority"); if (!lstatSync(p).isFile()) throw new Error("Artifact is not a regular source file"); });
			if (new Set(m.artifacts).size !== m.artifacts.length) throw new Error("Duplicate artifacts");
			if (m.role === "research" ? m.manifest !== null : m.manifest !== join(m.taskPath, `${m.role}.jsonl`)) throw new Error("Invalid selected manifest path");
			if (m.manifest && (m.manifest !== sourcePath(m.sourceRoot, `${m.taskDir}/${m.role}.jsonl`) || !lstatSync(m.manifest).isFile())) throw new Error("Manifest is not a regular source file");
			if (!lstatSync(m.taskPath).isDirectory() || !lstatSync(m.specRoot).isDirectory()) throw new Error("Task/spec authority must be directories");
			if (!Array.isArray(m.references) || m.references.length > 512 || (m.role === "research" ? m.references.length !== 0 : m.references.length === 0)) throw new Error("Invalid material references");
			const seen = new Set();
			for (const r of m.references) {
				if (!object(r) || !text(r.label) || isAbsolute(r.label) || r.label.includes("\\") || r.label.split(/[\\/]/).includes("..") || !hash(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes < 0 || r.bytes > 16 * 1024 * 1024) throw new Error("Invalid raw material reference");
				path(r.path);
				if (r.path !== sourcePath(m.sourceRoot, r.label) || seen.has(r.path)) throw new Error("Invalid reference source authority");
				if (!lstatSync(r.path).isFile()) throw new Error("Reference is not a regular source file");
				seen.add(r.path);
			}
		}
	} else if (selectedRole) throw new Error("Missing role material facts");
	return value as WorktreeQuery;
}
export function requireMaterials(result: WorktreeQuery): SourceMaterials {
	if (!result.materials || result.materials.state !== "valid") throw new WorktreeQueryError("Source role materials unavailable", result.issues);
	return result.materials;
}
/** Python owns Git identity/readiness. Read-only even inside the host source lock. */
export function queryWorktree(cwd: string, task?: string, ready = false, signal?: AbortSignal, supportedRelease = false, selectedRole?: MaterialRole): Promise<WorktreeQuery> {
	if (selectedRole !== undefined && !role(selectedRole)) return Promise.reject(new WorktreeQueryError("Invalid query role; use implement, check or research"));
	if (ready && (!task || !selectedRole)) return Promise.reject(new WorktreeQueryError("Ready query requires explicit task and role"));
	const script = join(resourceRoot, "runtime/query-worktree.py");
	const args = ["-B", script, "--cwd", cwd];
	if (task !== undefined) args.push("--task", task);
	if (selectedRole !== undefined) args.push("--role", selectedRole);
	if (ready) args.push("--ready");
	if (ready && supportedRelease) return queryWorktree(cwd, task, false, signal).then(result => {
		if (result.binding && !verifyRuntime(result.binding.worktreePath)) throw new Error("Supported target runtime manifest required before dispatch");
		return executeQuery(cwd, args, task, selectedRole, signal);
	});
	return executeQuery(cwd, args, task, selectedRole, signal);
}
function executeQuery(cwd: string, args: string[], task?: string, selectedRole?: MaterialRole, signal?: AbortSignal): Promise<WorktreeQuery> {
	const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", GIT_OPTIONAL_LOCKS: "0" };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_") && key !== "GIT_OPTIONAL_LOCKS") delete env[key];
	return new Promise((done, reject) => execFile(process.env.TRELLIS_PYTHON || (process.platform === "win32" ? "python" : "python3"), args, {
		cwd, env, signal, timeout: 30000, maxBuffer: 1024 * 1024,
	}, (error, stdout, stderr) => {
		try {
			const result = parseWorktreeQuery(JSON.parse(String(stdout)), task, selectedRole);
			if (error) throw new WorktreeQueryError(error.message, result.issues, String(stderr));
			done(result);
		} catch (failure) {
			if (failure instanceof WorktreeQueryError) { failure.stderr = String(stderr); if (String(stderr).trim()) failure.message += `\n${String(stderr).trim()}`; reject(failure); }
			else reject(new WorktreeQueryError(`Native worktree query failed: ${String(failure)}`, [], String(stderr)));
		}
	}));
}
