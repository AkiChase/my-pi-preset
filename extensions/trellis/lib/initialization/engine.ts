import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Dirent } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { readTaskRecord } from "../task-context.ts";
import { containsPath } from "../config.ts";
import { resourceRoot } from "../paths.ts";
import { provenanceText, type ProvenanceReader } from "./provenance-reader.ts";

/** Trellis resource root; logical manifest sources (runtime/..., agents/..., resources/templates/...) are relative to it. */
export const packageRoot = resourceRoot;
const MANIFEST = ".trellis/.pi-trellis.json";
const OPERATION = ".trellis/.runtime/init-operation.json";
const LOCK = ".trellis/.runtime/init.lock";
const MAX_BYTES = 4 * 1024 * 1024;
export const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export interface Fingerprint { sha256: string; mode: number }
export type TemplateProvenance =
	| (Fingerprint & { origin: "package-default"; source: string })
	| ((Fingerprint | { sha256: null; mode: null }) & { origin: "preserved-project"; source: { kind: "project-snapshot"; revision: string | null } });
/** Last-published Trellis skill file: update guard and diagnostics only, never execution authority. */
export type SkillRecord = Fingerprint & { source: string };
export interface InstalledManifest {
	/** Schema 2 (previous release) has no skills map; every write publishes schema 3. */
	schemaVersion: 2 | 3; runtimeReleaseId: string;
	files: Record<string, Fingerprint & { kind: "runtime" | "agent"; source: string }>;
	templates: Record<string, TemplateProvenance>;
	/** Schema 3 only. Rows may be absent (skill not deployed yet); unknown rows are rejected. */
	skills?: Record<string, SkillRecord>;
}
export interface FileAction {
	path: string; original: Fingerprint | null; output: string; mode: number;
	kind: "runtime" | "agent" | "skill" | "template" | "identity" | "workspace" | "task" | "root" | "manifest";
}
export interface InitPlan {
	schemaVersion: 1; root: string; user: string; releaseId: string; operation: "initialize" | "identity";
	workspaceReused: boolean; task: string; taskReused: boolean;
	actions: FileAction[]; guards: Record<string, Fingerprint | null>; planHash: string;
}
interface Operation { schemaVersion: 1; status: "incomplete" | "complete"; plan: InitPlan; completed: string[] }
export interface Inspection {
	root: string; state: "fresh" | "supported" | "ready" | "incomplete" | "unsupported" | "conflict";
	developer?: string; workspaces: string[]; gitSuggestion?: string; diagnostics: string[];
	releaseId: string; manifest?: InstalledManifest;
}

export function validateUsername(value: string): string {
	if (typeof value !== "string" || !value || value !== value.trim() || value === "." || value === ".." || Buffer.byteLength(value) > 255 || /[/\\\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) {
		throw new Error("Username must be a non-empty single directory segment (no separators, dot segments, controls or surrounding whitespace; maximum 255 bytes).");
	}
	return value;
}
export function usernameSlug(value: string): string {
	return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "user";
}

/** Root symlinks are canonicalized once; managed paths and every existing ancestor must be local. */
export function checkedPath(root: string, path: string): string {
	if (!path || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error(`Unsafe managed path: ${path}`);
	const target = resolve(root, path);
	if (!containsPath(root, target) || target === root) throw new Error(`Managed path leaves project: ${path}`);
	const parts = relative(root, target).split("/");
	let parent = root;
	for (let i = 0; i < parts.length; i++) {
		parent = join(parent, parts[i]);
		let info;
		try { info = lstatSync(parent); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
		if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile() && !info.isDirectory())) throw new Error(`Managed path is symlinked or nonregular: ${path}`);
	}
	return target;
}
function bytes(root: string, path: string): Buffer | undefined {
	const target = checkedPath(root, path);
	try {
		const info = lstatSync(target);
		if (!info.isFile() || info.size > MAX_BYTES) throw new Error(`Expected bounded regular file: ${path}`);
		return readFileSync(target);
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function fingerprint(root: string, path: string): Fingerprint | null {
	const value = bytes(root, path);
	return value === undefined ? null : { sha256: digest(value), mode: lstatSync(checkedPath(root, path)).mode & 0o777 };
}
function same(a: Fingerprint | null, b: Fingerprint | null): boolean { return a?.sha256 === b?.sha256 && a?.mode === b?.mode; }
function parse<T>(root: string, path: string): T | undefined {
	const value = bytes(root, path);
	return value === undefined ? undefined : JSON.parse(value.toString("utf8"));
}
export const defaultProvenanceReader: ProvenanceReader = {
	file(root, path, _limit, _inventory, binary = false) { const data = bytes(root, path); return data === undefined ? undefined : { data, ...(binary ? {} : { text: provenanceText(data) }), bytes: data.length, sha256: digest(data), mode: lstatSync(checkedPath(root, path)).mode & 0o777 }; },
	json(root, path) { const data = bytes(root, path); return data === undefined ? undefined : JSON.parse(provenanceText(data)); },
	stat(root, path) { try { return lstatSync(checkedPath(root, path)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
	path: checkedPath,
};
export function runtimeBaseline(reader: ProvenanceReader = defaultProvenanceReader) {
	const baseline = reader.json(packageRoot, "resources/runtime-baseline.json");
	if (!object(baseline) || baseline.schemaVersion !== 1 || baseline.pythonMinimum !== "3.10" || !object(baseline.files) || !Object.keys(baseline.files).length || Object.keys(baseline.files).length > 512 || typeof baseline.releaseId !== "string") throw new Error("Unsupported package runtime baseline");
	for (const [path, record] of Object.entries(baseline.files)) {
	 if (!path.endsWith(".py") || !object(record) || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256) || record.sha256.length !== 64) throw Error("Malformed package runtime inventory");
	 if (reader.file(packageRoot, `runtime/${path}`, MAX_BYTES, true)?.sha256 !== record.sha256) throw new Error(`Package runtime hash mismatch: ${path}`);
	}
	const hashes = Object.fromEntries(Object.keys(baseline.files).sort().map(path => [path, baseline.files[path].sha256]));
	if (baseline.releaseId !== "pi-trellis-runtime-v1-" + digest(JSON.stringify({ files: hashes, schemaVersion: 1 }))) throw new Error("Package runtime release identity mismatch");
	return baseline as { schemaVersion: 1; releaseId: string; pythonMinimum: string; files: Record<string, { sha256: string }> };
}
function python(args: string[], root: string): string {
	return execFileSync(process.env.TRELLIS_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-B", ...args], {
		cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 15000, maxBuffer: MAX_BYTES,
	});
}
function probePython(root: string): void {
	python(["-c", "import sys; assert sys.version_info >= (3,10), 'Python 3.10 or later is required'"], root);
}
function developer(root: string): string | undefined {
	const value = bytes(root, ".trellis/.developer");
	if (value === undefined) return undefined;
	const names = value.toString("utf8").split(/\r?\n/).filter(line => line.startsWith("name="));
	if (names.length !== 1) throw new Error("Developer identity is malformed");
	return validateUsername(names[0].slice(5));
}
function object(value: unknown): value is Record<string, any> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: unknown, keys: string[], label: string): asserts value is Record<string, any> {
	if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Malformed ${label} schema`);
}
function checkFingerprint(value: Fingerprint | null): void {
	if (value === null) return;
	fields(value, ["sha256", "mode"], "fingerprint");
	if (typeof value.sha256 !== "string" || value.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777) throw new Error("Invalid fingerprint");
}
export function packageResources(reader: ProvenanceReader = defaultProvenanceReader, baseline = runtimeBaseline(reader)): InstalledManifest["files"] {
	const files: InstalledManifest["files"] = {};
	for (const [path, record] of Object.entries(baseline.files)) {
		const source = `runtime/${path}`;
		files[`.trellis/scripts/${path}`] = { sha256: record.sha256, mode: reader.stat(packageRoot, source)!.mode & 0o777, kind: "runtime", source };
	}
	const agents = reader.json(packageRoot, "resources/agent-baseline.json");
	if (!object(agents) || !object(agents.files)) throw Error("Malformed package role baseline");
	for (const role of ["implement", "check", "research"]) {
		const source = `agents/trellis-${role}.md`, sha256 = reader.file(packageRoot, source, MAX_BYTES, true)?.sha256;
		if (!sha256 || sha256 !== agents.files[role]?.adapted) throw new Error(`Package role hash mismatch: ${role}`);
		files[`.pi/agents/trellis-${role}.md`] = { sha256, mode: 0o644, kind: "agent", source };
	}
	return files;
}
export function defaultTemplates(reader: ProvenanceReader = defaultProvenanceReader): Record<string, Fingerprint & { origin: "package-default"; source: string }> {
	return Object.fromEntries(Object.entries(templateTargets).map(([source, target]) => [target, {
		origin: "package-default", sha256: digest(template(source, reader)), mode: 0o644, source: `resources/templates/${source}`,
	}]));
}
/** Deployed project skill folder root; package sources live under `skills/`. */
export const SKILL_ROOT = ".pi/skills";
/** `assets/` may hold binary files: byte/hash/mode checks only, no text validation. */
export const binarySkillFile = (path: string) => path.split("/").includes("assets");
/** `.pi/skills/<name>` for a deployed skill target. */
export const skillFolder = (target: string) => target.split("/").slice(0, 3).join("/");
/** Complete package skill trees from the skill baseline, hash-verified. Insertion order is publication
 * order: each folder's supporting files precede its SKILL.md, so a new folder is discoverable last. */
export function packageSkills(reader: ProvenanceReader = defaultProvenanceReader): Record<string, SkillRecord> {
	const baseline = reader.json(packageRoot, "resources/skill-baseline.json");
	if (!object(baseline) || baseline.schemaVersion !== 1 || !object(baseline.files) || !Object.keys(baseline.files).length || Object.keys(baseline.files).length > 256) throw new Error("Malformed package skill baseline");
	const entry = (path: string) => path.split("/").length === 2 && path.endsWith("/SKILL.md");
	const paths = Object.keys(baseline.files).sort((a, b) => a.split("/")[0].localeCompare(b.split("/")[0]) || Number(entry(a)) - Number(entry(b)) || a.localeCompare(b));
	const skills: Record<string, SkillRecord> = {};
	for (const path of paths) {
		const record = baseline.files[path], parts = path.split("/");
		if (parts.length < 2 || !/^trellis-[a-z0-9-]+$/.test(parts[0]) || parts.some(part => !part || part === "." || part === ".." || part.includes("\\")) || !object(record) || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error("Malformed package skill inventory");
		const source = `skills/${path}`, file = reader.file(packageRoot, source, MAX_BYTES, true, binarySkillFile(path));
		if (!file || file.sha256 !== record.sha256) throw new Error(`Package skill hash mismatch: ${path}`);
		// Git tracks only the executable bit; publish normalized modes independent of package umask.
		skills[`${SKILL_ROOT}/${path}`] = { sha256: file.sha256, mode: file.mode & 0o111 ? 0o755 : 0o644, source };
	}
	for (const name of new Set(paths.map(path => path.split("/")[0]))) if (!skills[`${SKILL_ROOT}/${name}/SKILL.md`]) throw new Error(`Package skill entry missing: ${name}`);
	return skills;
}
/** Skill rows grant nothing: only known package targets with their exact logical source. Missing rows are allowed. */
export function validateSkillRecords(value: unknown, expected: Record<string, SkillRecord>): asserts value is Record<string, SkillRecord> {
	if (!object(value) || Object.keys(value).length > Object.keys(expected).length) throw new Error("Malformed project skill provenance");
	for (const [path, row] of Object.entries(value)) {
		if (!Object.hasOwn(expected, path)) throw new Error(`Unknown managed skill entry: ${path}`);
		fields(row, ["sha256", "mode", "source"], "project skill entry");
		if (row.source !== expected[path].source) throw new Error(`Malformed project skill provenance: ${path}`);
		checkFingerprint({ sha256: row.sha256, mode: row.mode });
	}
}
/** Files and foreign entries (symlinks, specials, non-directory folder) below one skill folder; undefined when absent. Bounded. */
export function skillFolderEntries(root: string, folder: string): { files: string[]; foreign: string[] } | undefined {
	if (dirname(folder) !== SKILL_ROOT) throw new Error(`Invalid skill folder: ${folder}`);
	// Ancestors must be local directories; the folder itself may be a symlink, reported as foreign.
	const parent = checkedPath(root, SKILL_ROOT);
	let info;
	try { info = lstatSync(join(parent, basename(folder))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	if (!info.isDirectory()) return { files: [], foreign: [folder] };
	const result = { files: [] as string[], foreign: [] as string[] };
	let visited = 0;
	const walk = (path: string, depth: number) => {
		for (const item of readdirSync(checkedPath(root, path), { withFileTypes: true }) as Dirent[]) {
			if (++visited > 4096 || depth > 16) throw new Error(`Skill folder inventory exceeds safety bound: ${folder}`);
			const child = `${path}/${item.name}`;
			if (item.isDirectory()) walk(child, depth + 1);
			else (item.isFile() ? result.files : result.foreign).push(child);
		}
	};
	walk(folder, 0);
	return result;
}
export interface PackageProvenance { release: string; files: InstalledManifest["files"]; templates: InstalledManifest["templates"]; skills: Record<string, SkillRecord> }
export function packageProvenance(reader: ProvenanceReader = defaultProvenanceReader): PackageProvenance {
	const baseline = runtimeBaseline(reader);
	return { release: baseline.releaseId, files: packageResources(reader, baseline), templates: defaultTemplates(reader), skills: packageSkills(reader) };
}
export function validateManifest(manifest: unknown, pkg: PackageProvenance = packageProvenance()): asserts manifest is InstalledManifest {
	const schema = object(manifest) ? manifest.schemaVersion : undefined;
	fields(manifest, ["schemaVersion", "runtimeReleaseId", "files", "templates", ...(schema === 3 ? ["skills"] : [])], "project resource manifest");
	if (![2, 3].includes(manifest.schemaVersion) || manifest.runtimeReleaseId !== pkg.release || !object(manifest.files) || !object(manifest.templates)) throw new Error("Unsupported project runtime release; explicit upgrade is not available");
	// Skills are independent of runtime authority: customized or missing skills never block execution.
	if (manifest.schemaVersion === 3) validateSkillRecords(manifest.skills, pkg.skills);
	const expected = pkg.files;
	if (Object.keys(manifest.files).length !== Object.keys(expected).length) throw new Error("Incomplete or unknown managed resource entries");
	for (const [path, record] of Object.entries(expected)) {
		const installed = manifest.files[path];
		fields(installed, ["sha256", "mode", "kind", "source"], "project resource entry");
		// Roles are read by dispatch without hash checks: only runtime rows are executed, so only they
		// need the exact current bytes. Role/template rows must stay well-formed and belong to the
		// package, while a stale fingerprint is a safe update, never a blocked project.
		for (const key of Object.keys(record) as (keyof typeof record)[]) {
			if (key !== "sha256" && key !== "mode" && installed[key] !== record[key]) throw new Error(`Malformed project resource provenance: ${path}`);
		}
		if (typeof installed.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(installed.sha256) || !Number.isInteger(installed.mode) || installed.mode < 0 || installed.mode > 0o777) throw new Error(`Malformed project resource provenance: ${path}`);
		if (record.kind === "runtime" && (installed.sha256 !== record.sha256 || installed.mode !== record.mode)) throw new Error(`Malformed project resource provenance: ${path}`);
	}
	const defaults = pkg.templates;
	if (Object.keys(manifest.templates).length !== Object.keys(defaults).length) throw new Error("Incomplete or unknown template provenance entries");
	for (const [path, record] of Object.entries(defaults)) {
		const installed = manifest.templates[path];
		fields(installed, ["origin", "sha256", "mode", "source"], "template provenance");
		if (installed.origin === "package-default") {
			if (installed.source !== record.source || typeof installed.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(installed.sha256) || !Number.isInteger(installed.mode) || installed.mode < 0 || installed.mode > 0o777) throw new Error(`Malformed package template provenance: ${path}`);
			// A stale fingerprint is a safe update, never a blocked project.
		} else if (installed.origin === "preserved-project") {
			// Diagnostic provenance only: no arbitrary source path, executable or output authority.
			fields(installed.source, ["kind", "revision"], "preserved template source");
			if (installed.source.kind !== "project-snapshot" || !(installed.source.revision === null || typeof installed.source.revision === "string" && [40, 64].includes(installed.source.revision.length) && !/[^a-f0-9]/.test(installed.source.revision))) throw new Error(`Malformed preserved template source: ${path}`);
			if (installed.sha256 === null && installed.mode === null) continue;
			checkFingerprint({ sha256: installed.sha256, mode: installed.mode });
		} else throw new Error(`Unknown template origin: ${path}`);
	}
}
export function verifyRuntime(root: string, reader: ProvenanceReader = defaultProvenanceReader, pkg?: PackageProvenance): InstalledManifest | undefined {
	const operation = reader.json(root, OPERATION);
	if (operation !== undefined) {
		fields(operation, ["schemaVersion", "status", "plan", "completed"], "initialization operation");
		if (operation.schemaVersion !== 1 || operation.status !== "complete") throw new Error("Initialization operation is incomplete or invalid; runtime execution is blocked");
	}
	return verifiedManifest(root, reader, pkg);
}
function verifiedManifest(root: string, reader: ProvenanceReader = defaultProvenanceReader, pkg?: PackageProvenance): InstalledManifest | undefined {
	const manifest = reader.json(root, MANIFEST);
	if (manifest === undefined) return undefined;
	validateManifest(manifest, pkg ?? packageProvenance(reader));
	for (const [path, record] of Object.entries(manifest.files)) {
		reader.path(root, path);
		if (record.kind === "runtime" && !same(reader.file(root, path, MAX_BYTES, true) ?? null, record)) throw new Error(`Project runtime is missing or modified: ${path}`);
	}
	for (const path of Object.keys(manifest.templates)) reader.path(root, path);
	return manifest;
}
function readOperation(root: string): Operation | undefined {
	const record = parse<Operation>(root, OPERATION);
	if (record === undefined) return undefined;
	fields(record, ["schemaVersion", "status", "plan", "completed"], "initialization operation");
	if (record.schemaVersion !== 1 || !["incomplete", "complete"].includes(record.status) || !Array.isArray(record.completed) || record.completed.length > 256 || record.completed.some(p => typeof p !== "string")) throw new Error("Malformed initialization operation record");
	if (!object(record.plan) || record.plan.root !== root) throw new Error("Initialization operation belongs to another project");
	validatePlan(record.plan, record.status === "incomplete");
	if (new Set(record.completed).size !== record.completed.length || record.completed.some(path => !record.plan.actions.some(action => action.path === path))) throw new Error("Invalid initialization completion steps");
	return record;
}
export function inspect(rootInput: string): Inspection {
	const root = realpathSync(resolve(rootInput));
	const baseline = runtimeBaseline();
	const result: Inspection = { root, state: "conflict", workspaces: [], diagnostics: [], releaseId: baseline.releaseId };
	try {
		if (!lstatSync(root).isDirectory() || root === realpathSync(homedir())) throw new Error("Initialization requires a project directory, not HOME");
		if (bytes(root, ".trellis/.runtime/pi-trellis/binding.json")) throw new Error("Initialize from the source project, not a managed worktree");
		probePython(root);
		const operation = readOperation(root);
		try { lstatSync(checkedPath(root, LOCK)); result.diagnostics.push("Initialization lock exists; never removed automatically. Inspect its owner before retrying."); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		if (operation?.status === "incomplete") { result.state = "incomplete"; result.diagnostics.push("Interrupted initialization: only an unchanged recorded operation can be retried."); }
		else {
			const manifest = verifyRuntime(root);
			result.manifest = manifest;
			result.developer = developer(root);
			if (manifest) result.state = result.developer ? "ready" : "supported";
			else {
				let exists = true;
				try { lstatSync(checkedPath(root, ".trellis")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; exists = false; }
				result.state = exists ? "unsupported" : "fresh";
				if (exists) result.diagnostics.push("Existing Trellis project has no supported manifest. General migration is not available.");
			}
		}
		const workspace = checkedPath(root, ".trellis/workspace");
		try {
			const entries = readdirSync(workspace, { withFileTypes: true });
			if (entries.length > 512) throw new Error("Workspace candidate inventory exceeds 512 entries");
			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
				try { validateUsername(entry.name); checkedPath(root, `.trellis/workspace/${entry.name}`); if (result.workspaces.length < 20) result.workspaces.push(entry.name); }
				catch { if (result.diagnostics.length < 24) result.diagnostics.push("Skipped unsafe workspace candidate (invalid name or symlink)."); }
			}
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
		try {
			const suggestion = execFileSync("git", ["config", "user.name"], { cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout: 3000, maxBuffer: 4096 }).replace(/\r?\n$/, "");
			try { validateUsername(suggestion); if (!result.workspaces.includes(suggestion)) result.gitSuggestion = suggestion; } catch { result.diagnostics.push("Git username suggestion is unsafe and was skipped."); }
		} catch { /* Git identity is an optional suggestion. */ }
	} catch (error) { result.state = "conflict"; result.diagnostics.push(String(error)); }
	return result;
}

const templateTargets: Record<string, string> = {
	"workflow.md": ".trellis/workflow.md", "config.yaml": ".trellis/config.yaml", "trellis.gitignore": ".trellis/.gitignore", "workspace-index.md": ".trellis/workspace/index.md",
	"spec/index.md": ".trellis/spec/index.md", "spec/guides/index.md": ".trellis/spec/guides/index.md", "spec/guides/code-reuse-thinking-guide.md": ".trellis/spec/guides/code-reuse-thinking-guide.md", "spec/guides/cross-layer-thinking-guide.md": ".trellis/spec/guides/cross-layer-thinking-guide.md",
};
export function template(path: string, reader: ProvenanceReader = defaultProvenanceReader): Buffer {
	const value = reader.file(packageRoot, `resources/templates/${path}`, MAX_BYTES, true)?.data;
	const baseline = reader.json(packageRoot, "resources/template-baseline.json");
	if (!value || !object(baseline) || baseline.schemaVersion !== 1 || !object(baseline.files) || baseline.files[path]?.sha256 !== digest(value)) throw new Error(`Package template hash mismatch: ${path}`);
	return value;
}
export function appendBlock(original: Buffer | undefined, block: Buffer, start: string, end: string): Buffer {
	const text = original?.toString("utf8") ?? "", body = block.toString("utf8").trimEnd();
	const starts = text.split(start).length - 1, ends = text.split(end).length - 1;
	if (starts || ends) {
		if (starts !== 1 || ends !== 1 || text.indexOf(end) < text.indexOf(start) || text.slice(text.indexOf(start), text.indexOf(end) + end.length) !== body) throw new Error("Existing managed block is customized, repeated or malformed");
		return original!;
	}
	// Reject incomplete/unknown marker spellings as well as exact duplicate blocks.
	if (/TRELLIS:|pi-trellis:ignore:/.test(text)) throw new Error("Unknown managed block marker");
	return Buffer.concat([original ?? Buffer.alloc(0), Buffer.from(text && !text.endsWith("\n") ? "\n" : ""), block]);
}
export function replaceBlock(original: Buffer | undefined, block: Buffer, start: string, end: string): Buffer {
	const value = original ?? Buffer.alloc(0), first = value.indexOf(start), last = value.indexOf(end);
	if (first === -1 && last === -1) return appendBlock(original, block, start, end);
	// Repeat detection searches from the next byte so self-overlapping marker spellings also conflict.
	if (first === -1 || last < first || value.indexOf(start, first + 1) !== -1 || value.indexOf(end, last + 1) !== -1) throw new Error("Existing managed block is repeated, incomplete or malformed");
	const prefix = value.subarray(0, first), suffix = value.subarray(last + Buffer.byteLength(end));
	if ([prefix, suffix].some(part => /TRELLIS:|pi-trellis:ignore:/.test(part.toString("utf8")))) throw new Error("Unknown managed block marker outside owned block");
	return Buffer.concat([prefix, Buffer.from(block.toString("utf8").trimEnd()), suffix]);
}
export function projectRevision(root: string): string | null {
	try {
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
		const value = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
		return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : null;
	} catch { return null; }
}
export function journalAttributes(attributes: Buffer | undefined, rule: Buffer): Buffer {
	const lines = attributes?.toString("utf8").split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#")) ?? [];
	const exact = lines.filter(line => line.trim().split(/\s+/)[0] === ".trellis/workspace/*/journal-*.md");
	if (exact.length > 1 || exact.some(line => line.trim() !== rule.toString("utf8").trim()) || lines.some(line => /journal|\*/.test(line.split(/\s+/)[0]) && /(?:^|\s)[!-]?merge(?:=|\s|$)/.test(line) && !/\smerge=union\s*$/.test(line))) throw new Error("Conflicting journal merge attributes");
	return exact.length ? attributes! : Buffer.concat([attributes ?? Buffer.alloc(0), Buffer.from(attributes?.length && attributes.at(-1) !== 10 ? "\n" : ""), rule]);
}
function skeleton(root: string, user: string, stamp: string, operation: InitPlan["operation"]) {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp) || !Number.isFinite(Date.parse(stamp))) throw new Error("Invalid initialization timestamp");
	return JSON.parse(python(["-c", [
		"import sys,json", "sys.path.insert(0,sys.argv[1])", "from common.developer import developer_skeleton", "from common.task_store import task_skeleton",
		"user,today,stamp,slug,kind=sys.argv[2:]", "task=task_skeleton(slug, 'Bootstrap Project Guidelines' if kind=='initialize' else 'Join the Project', '', user,user,today,'P1')",
		"task.update(status='in_progress',dev_type='docs',relatedFiles=['.trellis/spec/'] if kind=='initialize' else [])",
		"print(json.dumps({'developer':developer_skeleton(user,today,stamp),'task':task}))",
	].join("\n"), join(packageRoot, "runtime"), user, stamp.slice(0, 10), stamp, operation === "initialize" ? "bootstrap-guidelines" : `join-${usernameSlug(user)}`, operation], root));
}
function reusedTask(root: string, task: string, user: string, id: string): void {
	const record = readTaskRecord(root, task), prd = bytes(root, `${task}/prd.md`);
	if (record.creator !== user || record.assignee !== user || record.id !== id || record.name !== id || !["planning", "in_progress", "completed"].includes(String(record.status)) || typeof record.title !== "string" || !record.title.trim() || typeof record.description !== "string" || !prd?.length || ["children", "subtasks", "relatedFiles"].some(key => !Array.isArray(record[key]) || !(record[key] as unknown[]).every(value => typeof value === "string"))) throw new Error(`Onboarding task collision or incomplete skeleton: ${task}`);
}
/** Recorded hashes detect drift, not authority. Reconstruct all permitted output from package sources. */
function validatePlan(plan: InitPlan, verifyExisting = true): void {
	fields(plan, ["schemaVersion", "root", "user", "releaseId", "operation", "workspaceReused", "task", "taskReused", "actions", "guards", "planHash"], "initialization plan");
	if (plan.schemaVersion !== 1 || !["initialize", "identity"].includes(plan.operation) || typeof plan.root !== "string" || !Array.isArray(plan.actions) || plan.actions.length > 256 || !object(plan.guards) || Object.keys(plan.guards).length > 512) throw new Error("Invalid initialization plan");
	if (realpathSync(plan.root) !== plan.root || !lstatSync(plan.root).isDirectory() || plan.root === realpathSync(homedir()) || bytes(plan.root, ".trellis/.runtime/pi-trellis/binding.json")) throw new Error("Initialization requires a canonical source project, not HOME or a managed worktree");
	validateUsername(plan.user);
	if (plan.releaseId !== runtimeBaseline().releaseId || typeof plan.taskReused !== "boolean" || typeof plan.workspaceReused !== "boolean") throw new Error("Invalid plan result fields");
	const expectedTask = `.trellis/tasks/00-${plan.operation === "initialize" ? "bootstrap-guidelines" : `join-${usernameSlug(plan.user)}`}`;
	if (plan.task !== expectedTask) throw new Error("Initialization plan has an invalid task route");
	const { planHash, ...body } = plan;
	if (digest(JSON.stringify(body)) !== planHash || Buffer.byteLength(json(plan)) > MAX_BYTES) throw new Error("Initialization plan hash or size is invalid");
	const seen = new Map<string, FileAction>();
	for (const action of plan.actions) {
		fields(action, ["path", "original", "output", "mode", "kind"], "file action");
		if (typeof action.path !== "string" || typeof action.output !== "string" || !Number.isInteger(action.mode) || action.mode < 0 || action.mode > 0o777 || seen.has(action.path)) throw new Error("Invalid/duplicate file action");
		checkedPath(plan.root, action.path); seen.set(action.path, action); checkFingerprint(action.original);
		if (!Object.hasOwn(plan.guards, action.path) || Buffer.from(action.output, "base64").toString("base64") !== action.output || !same(action.original, plan.guards[action.path])) throw new Error("File action has invalid bytes or original guard");
		if (action.kind !== "root" && action.original !== null) throw new Error("Initialization may only create missing resources; existing user files are never recovery authority");
	}
	for (const [path, value] of Object.entries(plan.guards)) { checkedPath(plan.root, path); checkFingerprint(value); }
	const allowed = new Set<string>();
	function requireOutput(path: string, value: Buffer | string, kind: FileAction["kind"], mode = 0o644, preserve = false) {
		allowed.add(path);
		const action = seen.get(path);
		if (!action && preserve && Object.hasOwn(plan.guards, path) && plan.guards[path] !== null) return;
		if (!action || action.kind !== kind || action.mode !== mode || action.output !== Buffer.from(value).toString("base64")) throw new Error(`Noncanonical or missing initialization output: ${path}`);
	}
	const identity = seen.get(".trellis/.developer");
	const stamp = identity && /^name=[^\n]+\ninitialized_at=([^\n]+)\n$/.exec(Buffer.from(identity.output, "base64").toString("utf8"))?.[1];
	if (!stamp) throw new Error("Missing canonical developer output");
	const generated = skeleton(plan.root, plan.user, stamp, plan.operation);
	requireOutput(".trellis/.developer", generated.developer[".developer"], "identity");
	for (const name of ["journal-1.md", "index.md"]) requireOutput(`.trellis/workspace/${plan.user}/${name}`, generated.developer[name], "workspace", 0o644, true);
	for (const [name, value] of [["task.json", json(generated.task)], ["prd.md", template(`tasks/${plan.operation === "initialize" ? "bootstrap" : "join"}-prd.md`)] ] as const) {
		if (plan.taskReused) {
			allowed.add(`${plan.task}/${name}`);
			if (seen.has(`${plan.task}/${name}`) || !plan.guards[`${plan.task}/${name}`]) throw new Error("Reused task cannot authorize writes");
		} else requireOutput(`${plan.task}/${name}`, value, "task");
	}
	if (plan.taskReused && verifyExisting) reusedTask(plan.root, plan.task, plan.user, generated.task.id);
	allowed.add(MANIFEST);
	const resources = packageResources();
	if (plan.operation === "initialize") {
		for (const [path, resource] of Object.entries(resources)) requireOutput(path, readFileSync(checkedPath(packageRoot, resource.source)), resource.kind, resource.mode);
		const skills = packageSkills(), order = new Map(plan.actions.map((action, index) => [action.path, index]));
		for (const [path, resource] of Object.entries(skills)) {
			requireOutput(path, readFileSync(checkedPath(packageRoot, resource.source)), "skill", resource.mode);
			// A new skill folder becomes discoverable only after its supporting files exist.
			if (order.get(path)! > order.get(`${skillFolder(path)}/SKILL.md`)!) throw new Error(`Skill entry must publish after its supporting files: ${path}`);
		}
		const templates = defaultTemplates();
		for (const [path, resource] of Object.entries(templates)) requireOutput(path, readFileSync(checkedPath(packageRoot, resource.source)), "template", resource.mode);
		requireOutput(MANIFEST, json({ schemaVersion: 3, runtimeReleaseId: plan.releaseId, files: resources, templates, skills } satisfies InstalledManifest), "manifest");
		if (plan.actions.at(-1)?.path !== MANIFEST) throw new Error("Manifest must publish after required outputs");
		for (const [path, source] of [["AGENTS.md", "agents-block.md"], [".gitignore", "root.gitignore-block.txt"], [".gitattributes", "journal.gitattributes"]]) {
			allowed.add(path);
			if (!Object.hasOwn(plan.guards, path)) throw new Error("Missing root file guard");
			const action = seen.get(path);
			if (!action) {
				if (plan.guards[path] === null) throw new Error("Missing root file output");
				if (verifyExisting) {
					const current = bytes(plan.root, path);
					if (!current || (path === ".gitattributes" ? !current.toString("utf8").split(/\r?\n/).some(line => line === template(source).toString("utf8").trimEnd()) : !appendBlock(current, template(source), path === "AGENTS.md" ? "<!-- TRELLIS:START -->" : "# pi-trellis:ignore:start", path === "AGENTS.md" ? "<!-- TRELLIS:END -->" : "# pi-trellis:ignore:end").equals(current))) throw new Error("Missing canonical root block");
				}
				continue;
			}
			if (action.kind !== "root" || action.mode !== (action.original?.mode ?? 0o644)) throw new Error("Invalid root action ownership");
			const output = Buffer.from(action.output, "base64"), block = template(source);
			if (!output.subarray(-block.length).equals(block)) throw new Error("Root recovery may only append the canonical block");
			const prefix = output.subarray(0, output.length - block.length);
			const originals = [prefix, ...(prefix.at(-1) === 10 ? [prefix.subarray(0, prefix.length - 1)] : [])];
			if (action.original === null ? prefix.length !== 0 : !originals.some(value => digest(value) === action.original!.sha256)) throw new Error("Root recovery would replace user bytes");
			if (path === ".gitattributes" && !journalAttributes(prefix, block).equals(output)) throw new Error("Invalid root attribute append");
			if (path !== ".gitattributes" && /TRELLIS:|pi-trellis:ignore:/.test(prefix.toString("utf8"))) throw new Error("Root recovery cannot append duplicate or unknown managed blocks");
		}
	} else {
		if (verifyExisting) {
			try { if (!verifiedManifest(plan.root)) throw new Error("Supported runtime manifest required"); }
			catch (error) { throw new Error(`Project changed since preview or runtime is unsupported: ${String(error)}`); }
		}
		if (!plan.guards[MANIFEST] || seen.has(MANIFEST)) throw new Error("Identity setup must preserve the supported manifest");
		for (const [path, record] of Object.entries(resources)) if (record.kind === "runtime") {
			allowed.add(path);
			if (!same(plan.guards[path], record) || seen.has(path)) throw new Error("Identity setup must guard and preserve the runtime");
		}
	}
	if (Object.keys(plan.guards).some(path => !allowed.has(path)) || plan.actions.some(action => !allowed.has(action.path))) throw new Error("Initialization action exceeds operation ownership");
}
function verifyOutputs(plan: InitPlan, beforeManifest = false): void {
	if (runtimeBaseline().releaseId !== plan.releaseId) throw new Error("Package runtime changed before publication");
	for (const action of plan.actions) {
		if (beforeManifest && action.path === MANIFEST) continue;
		if (!same(fingerprint(plan.root, action.path), { sha256: digest(Buffer.from(action.output, "base64")), mode: action.mode })) throw new Error(`Initialization output is missing or modified: ${action.path}`);
	}
	if (plan.taskReused) reusedTask(plan.root, plan.task, plan.user, plan.task.split("/00-")[1]);
	for (const name of ["journal-1.md", "index.md"]) if (!bytes(plan.root, `.trellis/workspace/${plan.user}/${name}`)) throw new Error("Initialization workspace output is missing");
}
function recheck(plan: InitPlan, retry: boolean): void {
	for (const [path, original] of Object.entries(plan.guards)) {
		const actual = fingerprint(plan.root, path);
		if (same(actual, original)) continue;
		const action = retry ? plan.actions.find(a => a.path === path) : undefined;
		if (action && same(actual, { sha256: digest(Buffer.from(action.output, "base64")), mode: action.mode })) continue;
		throw new Error(`Project changed since preview; preserved without overwrite: ${path}`);
	}
}
export function plan(rootInput: string, userInput: string): InitPlan | undefined {
	const state = inspect(rootInput), user = validateUsername(userInput), root = state.root;
	if (state.state === "incomplete") {
		const operation = readOperation(root)!;
		if (operation.plan.user !== user || operation.plan.releaseId !== state.releaseId) throw new Error("Retry must use the recorded developer and package release");
		recheck(operation.plan, true); return operation.plan;
	}
	if (state.state === "ready") {
		if (state.developer !== user) throw new Error(`Developer conflict: actual ${state.developer}; requested ${user}. Existing identity preserved.`);
		return undefined;
	}
	if (!["fresh", "supported"].includes(state.state)) throw new Error(state.diagnostics.join("\n") || "Project is not supported for initialization");
	const operation: InitPlan["operation"] = state.state === "fresh" ? "initialize" : "identity";
	const actions: FileAction[] = [], guards: Record<string, Fingerprint | null> = {};
	const files: InstalledManifest["files"] = {};
	if (state.manifest) {
		for (const [path, record] of Object.entries(state.manifest.files)) {
			if (record.kind === "runtime") guards[path] = fingerprint(root, path);
		}
	}
	function add(path: string, content: Buffer | string, kind: FileAction["kind"], mode = 0o644, preserve = false) {
		const value = Buffer.isBuffer(content) ? content : Buffer.from(content);
		const original = fingerprint(root, path); guards[path] = original;
		if (preserve && original) return;
		if (original && kind !== "root" && kind !== "manifest") throw new Error(`Unknown existing file would collide: ${path}`);
		if (!same(original, { sha256: digest(value), mode: original?.mode ?? mode })) actions.push({ path, original, output: value.toString("base64"), mode: original?.mode ?? mode, kind });
	}
	if (operation === "initialize") {
		for (const [target, resource] of Object.entries(packageResources())) {
			add(target, readFileSync(checkedPath(packageRoot, resource.source)), resource.kind, resource.mode);
			files[target] = resource;
		}
		// Never mix package files into, or claim, an existing same-name skill folder.
		const skills = packageSkills();
		for (const folder of new Set(Object.keys(skills).map(skillFolder))) {
			if (skillFolderEntries(root, folder)) throw new Error(`Skill folder exists and is not managed by Trellis; preserved without changes: ${folder}. Move or rename it, then initialize again.`);
		}
		for (const [target, resource] of Object.entries(skills)) add(target, readFileSync(checkedPath(packageRoot, resource.source)), "skill", resource.mode);
		for (const [source, target] of Object.entries(templateTargets)) add(target, template(source), "template");
		for (const [path, source, start, end] of [["AGENTS.md", "agents-block.md", "<!-- TRELLIS:START -->", "<!-- TRELLIS:END -->"], [".gitignore", "root.gitignore-block.txt", "# pi-trellis:ignore:start", "# pi-trellis:ignore:end"]]) {
			add(path, appendBlock(bytes(root, path), template(source), start, end), "root");
		}
		add(".gitattributes", journalAttributes(bytes(root, ".gitattributes"), template("journal.gitattributes")), "root");
	}
	const generated = skeleton(root, user, new Date().toISOString(), operation);
	add(".trellis/.developer", generated.developer[".developer"], "identity");
	const workspacePath = `.trellis/workspace/${user}`;
	let workspaceReused = false;
	try { workspaceReused = lstatSync(checkedPath(root, workspacePath)).isDirectory(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
	for (const name of ["journal-1.md", "index.md"]) add(`${workspacePath}/${name}`, generated.developer[name], "workspace", 0o644, true);
	const task = `.trellis/tasks/00-${operation === "initialize" ? "bootstrap-guidelines" : `join-${usernameSlug(user)}`}`;
	let taskReused = false;
	try {
		lstatSync(checkedPath(root, task));
		reusedTask(root, task, user, generated.task.id);
		guards[`${task}/task.json`] = fingerprint(root, `${task}/task.json`); guards[`${task}/prd.md`] = fingerprint(root, `${task}/prd.md`); taskReused = true;
	} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	if (!taskReused) { add(`${task}/task.json`, json(generated.task), "task"); add(`${task}/prd.md`, template(`tasks/${operation === "initialize" ? "bootstrap" : "join"}-prd.md`), "task"); }
	guards[MANIFEST] = fingerprint(root, MANIFEST);
	if (operation === "initialize") add(MANIFEST, json({ schemaVersion: 3, runtimeReleaseId: state.releaseId, files, templates: defaultTemplates(), skills: packageSkills() } satisfies InstalledManifest), "manifest");
	const body = { schemaVersion: 1 as const, root, user, releaseId: state.releaseId, operation, workspaceReused, task, taskReused, actions, guards };
	const result = { ...body, planHash: digest(JSON.stringify(body)) }; validatePlan(result); return result;
}
function atomic(root: string, path: string, value: Buffer, mode: number, expected: Fingerprint | null): void {
	const target = checkedPath(root, path); mkdirSync(dirname(target), { recursive: true }); checkedPath(root, path);
	if (!same(fingerprint(root, path), expected)) throw new Error(`Concurrent change preserved: ${path}`);
	const temporary = `${target}.${randomUUID()}.pi-trellis-tmp`;
	let fd: number | undefined;
	try {
		fd = openSync(temporary, "wx", mode); writeFileSync(fd, value); fchmodSync(fd, mode); closeSync(fd); fd = undefined;
		checkedPath(root, path); if (!same(fingerprint(root, path), expected)) throw new Error(`Concurrent change preserved: ${path}`);
		renameSync(temporary, target);
	} finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
}
/** Under the lock: a planned skill folder may contain only this plan's files (a retry's own partial output). */
function assertSkillFoldersOwned(plan: InitPlan): void {
	const planned = new Set(plan.actions.filter(action => action.kind === "skill").map(action => action.path));
	for (const folder of new Set([...planned].map(skillFolder))) {
		const entries = skillFolderEntries(plan.root, folder);
		const foreign = entries ? [...entries.foreign, ...entries.files.filter(path => !planned.has(path))] : [];
		if (foreign.length) throw new Error(`Unmanaged content in skill folder preserved without changes: ${foreign.slice(0, 3).join(", ")}`);
	}
}
/** Explicitly approved apply only. No rollback deletes; injected failure is test-only. */
export function apply(plan: InitPlan, options: { afterWrite?: (path: string, count: number) => void } = {}): Inspection {
	validatePlan(plan);
	if (realpathSync(plan.root) !== plan.root || runtimeBaseline().releaseId !== plan.releaseId) throw new Error("Initialization root/package changed");
	const prior = readOperation(plan.root), retry = prior?.status === "incomplete";
	checkedPath(plan.root, LOCK);
	// A present lock is never auto-deleted or guessed stale.
	try { lstatSync(checkedPath(plan.root, LOCK)); throw new Error("Initialization is locked; inspect the existing lock before retrying"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	if (retry && prior.plan.planHash !== plan.planHash) throw new Error("A different initialization operation is incomplete");
	recheck(plan, retry);
	mkdirSync(checkedPath(plan.root, ".trellis/.runtime"), { recursive: true }); checkedPath(plan.root, LOCK);
	const fd = openSync(checkedPath(plan.root, LOCK), "wx", 0o600);
	try {
		writeFileSync(fd, json({ schemaVersion: 1, pid: process.pid, planHash: plan.planHash })); closeSync(fd);
		const current = readOperation(plan.root);
		if (current?.status === "incomplete" && current.plan.planHash !== plan.planHash) throw new Error("Initialization record changed under lock");
		recheck(plan, retry);
		assertSkillFoldersOwned(plan);
		const record: Operation = { schemaVersion: 1, status: "incomplete", plan, completed: current?.plan.planHash === plan.planHash ? current.completed : [] };
		const save = () => atomic(plan.root, OPERATION, Buffer.from(json(record)), 0o600, fingerprint(plan.root, OPERATION));
		save();
		let count = 0;
		for (const action of plan.actions) {
			if (action.path === MANIFEST) verifyOutputs(plan, true);
			recheck(plan, true);
			const value = Buffer.from(action.output, "base64"), actual = fingerprint(plan.root, action.path), output = { sha256: digest(value), mode: action.mode };
			if (!same(actual, output)) atomic(plan.root, action.path, value, action.mode, action.original);
			if (!record.completed.includes(action.path)) record.completed.push(action.path);
			save(); options.afterWrite?.(action.path, ++count);
		}
		recheck(plan, true);
		verifyOutputs(plan);
		if (developer(plan.root) !== plan.user || !verifiedManifest(plan.root)) throw new Error("Initialization incomplete: persisted identity/runtime did not verify");
		record.status = "complete"; save();
		const result = inspect(plan.root);
		if (result.state !== "ready" || result.developer !== plan.user) throw new Error("Initialization result did not verify");
		return result;
	} finally { try { unlinkSync(checkedPath(plan.root, LOCK)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
}
