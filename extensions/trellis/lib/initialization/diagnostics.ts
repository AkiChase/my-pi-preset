import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { discoverProject } from "../project-state.ts";
import { containsPath } from "../config.ts";
import { binarySkillFile, checkedPath, digest, packageRoot, validateUsername, packageProvenance, type PackageProvenance, type InstalledManifest } from "./engine.ts";
import { reviewSkills } from "./skills.ts";

/** Deployment-check scope: the project directory only. No session/task identity. */
export interface DiagnosticScope {
	cwd: string;
	isProjectTrusted?: boolean;
}
export interface DiagnosticItem {
	id: string;
	category: string;
	status: "pass" | "issue" | "blocked" | "skipped" | "cancelled";
	severity: "error" | "warning" | "info";
	summary: string;
	evidence: string[];
	impact: string;
	advice: string;
}
export interface DiagnosticResult {
	schemaVersion: 1;
	scope: DiagnosticScope & { executionRoot?: string };
	items: DiagnosticItem[];
	omitted: number;
	omittedCategories?: string[];
	/** Static orchestration facts only, NOT publication or execution authority. */
	facts: {
		project: "fresh" | "existing" | "unsafe";
		packageValid: boolean;
		manifest?: InstalledManifest;
		runtimeStaticValid: boolean;
		resourcesRestorable: boolean;
		developer?: string;
		operation?: "incomplete" | "complete";
		operationInvalid: boolean;
		locked: boolean;
		managedMarker: boolean;
	};
}
export const DIAGNOSTIC_LIMITS = Object.freeze({ file: 4 * 1024 * 1024, record: 1024 * 1024, text: 8 * 1024 * 1024, inventory: 64 * 1024 * 1024, entries: 512, items: 64, report: 16 * 1024 });
const MANIFEST = ".trellis/.pi-trellis.json", OPERATION = ".trellis/.runtime/init-operation.json", LOCK = ".trellis/.runtime/init.lock";
const TEMPLATE_TARGETS: Record<string, string> = {
	"workflow.md": ".trellis/workflow.md", "config.yaml": ".trellis/config.yaml", "trellis.gitignore": ".trellis/.gitignore", "workspace-index.md": ".trellis/workspace/index.md",
	"spec/index.md": ".trellis/spec/index.md", "spec/guides/index.md": ".trellis/spec/guides/index.md", "spec/guides/code-reuse-thinking-guide.md": ".trellis/spec/guides/code-reuse-thinking-guide.md", "spec/guides/cross-layer-thinking-guide.md": ".trellis/spec/guides/cross-layer-thinking-guide.md",
};
function object(value: unknown): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function fields(value: unknown, keys: string[], label: string): asserts value is Record<string, any> {
	if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error(`Malformed ${label} schema`);
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
const mode = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0o777;
function safePath(path: unknown): asserts path is string {
	if (typeof path !== "string" || path.length > 8192 || !path || isAbsolute(path) || /[\\\p{C}\p{Zl}\p{Zp}]/u.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) throw Error("Invalid bounded resource path");
}
const clean = (value: string, limit = 500) => value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ").slice(0, limit);
const identity = (s: Stats) => [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(":");
class Cancelled extends Error {}
/** S1 has byte budgets/cooperative checkpoints, NOT a hard wall-clock deadline. S2 owns the terminable worker. */
export class DiagnosticReader {
	textBytes = 0;
	inventoryBytes = 0;
	signal?: AbortSignal;
	constructor(signal?: AbortSignal) { this.signal = signal; }
 path(root: string, path: string) { this.root(root); safePath(path); return checkedPath(root, path); }
	checkpoint() { if (this.signal?.aborted) throw new Cancelled("Check cancelled"); }
	root(root: string) {
		this.checkpoint();
		if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw Error("Diagnostic root changed or is unsafe");
	}
	stat(root: string, path: string) {
		this.root(root); const file = checkedPath(root, path);
		try { return lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	}
	file(root: string, path: string, limit = DIAGNOSTIC_LIMITS.file, inventory = false, binary = false): { data: Buffer; text?: string; sha256: string; mode: number; bytes: number } | undefined {
		this.checkpoint(); safePath(path); const file = checkedPath(root, path), before = this.stat(root, path);
		if (!before) return undefined;
		if (!before.isFile() || before.size > limit) throw Error(`Expected regular file no larger than ${limit} bytes`);
		const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
		try {
			// Recheck routes before consuming the opened descriptor, not only afterwards.
			// This detects persistent ancestor replacement; it is not an openat/OS sandbox.
			this.root(root); checkedPath(root, path);
			const opened = fstatSync(fd);
			if (!opened.isFile() || identity(opened) !== identity(before)) throw Error("File changed during open");
			const chunks: Buffer[] = [], hasher = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let length = 0;
			for (;;) {
				this.checkpoint();
				const remaining = (inventory ? DIAGNOSTIC_LIMITS.inventory - this.inventoryBytes : DIAGNOSTIC_LIMITS.text - this.textBytes);
				if (remaining < 0) throw Error("Diagnostic read byte budget exceeded");
				// At most one sentinel byte beyond the shared cap, not one chunk per file.
				const count = readSync(fd, buffer, 0, Math.min(buffer.length, limit + 1 - length, remaining + 1), null);
				if (!count) break;
				length += count;
				if (inventory) this.inventoryBytes += count; else this.textBytes += count;
				if (length > limit || (inventory ? this.inventoryBytes > DIAGNOSTIC_LIMITS.inventory : this.textBytes > DIAGNOSTIC_LIMITS.text)) throw Error("Diagnostic read byte budget exceeded");
				const part = buffer.subarray(0, count);
				// Even fixed Python/role resources are text; NUL and malformed UTF-8 never pass.
				chunks.push(Buffer.from(part)); hasher.update(part);
			}
			if (length !== before.size || identity(fstatSync(fd)) !== identity(before) || identity(this.stat(root, path)!) !== identity(before) || checkedPath(root, path) !== file) throw Error("File changed during bounded read");
			const bytes = Buffer.concat(chunks, length);
			// Only skill assets are byte/hash/mode-checked without text validation.
			if (!binary && (!isUtf8(bytes) || bytes.includes(0))) throw Error("Invalid UTF-8 or NUL bytes");
			return { data: bytes, ...(inventory || binary ? {} : { text: bytes.toString("utf8") }), sha256: hasher.digest("hex"), mode: before.mode & 0o777, bytes: length };
		} finally { closeSync(fd); }
	}
	json(root: string, path: string, limit = DIAGNOSTIC_LIMITS.file): unknown {
		const file = this.file(root, path, limit); if (!file) return undefined;
		// Never echo JSON parser excerpts (settings can contain secrets).
		try { return JSON.parse(file.text!); } catch { throw Error(file.bytes ? "Invalid JSON" : "File is empty; expected JSON"); }
	}
}
export function diagnosticExecutionRoot(cwd: string): string {
	const found = discoverProject(cwd);
	return realpathSync(found.root ?? found.gitRoot ?? resolve(cwd));
}
/** Static diagnostic projection only: never use these facts as execution/publication authority.
 * S2 must use the shared strict provenance reader seam before any runtime execution. */
type PackageSnapshot = PackageProvenance;
/** Static provenance snapshot only. No unbounded engine validators, dynamic imports or project code. */
function packageSnapshot(reader: DiagnosticReader): PackageSnapshot { return packageProvenance(reader); }
function manifestEnvelope(value: unknown): asserts value is InstalledManifest {
	fields(value, ["schemaVersion", "runtimeReleaseId", "files", "templates", ...(object(value) && value.schemaVersion === 3 ? ["skills"] : [])], "project resource manifest");
	if (![2, 3].includes(value.schemaVersion) || typeof value.runtimeReleaseId !== "string" || value.runtimeReleaseId.length !== 86 || !/^pi-trellis-runtime-v1-[a-f0-9]{64}$/.test(value.runtimeReleaseId) || !object(value.files) || !Object.keys(value.files).length || Object.keys(value.files).length > DIAGNOSTIC_LIMITS.entries || !object(value.templates) || !Object.keys(value.templates).length || Object.keys(value.templates).length > DIAGNOSTIC_LIMITS.entries) throw Error("Invalid/nonempty managed project manifest required");
	for (const [path, row] of Object.entries(value.files)) {
		safePath(path); fields(row, ["sha256", "mode", "kind", "source"], "project resource entry");
		if (!hash(row.sha256) || !mode(row.mode) || !["runtime", "agent"].includes(row.kind)) throw Error("Invalid resource fingerprint/kind");
		safePath(row.source);
	}
	if (value.schemaVersion === 3) {
		if (!object(value.skills) || Object.keys(value.skills).length > DIAGNOSTIC_LIMITS.entries) throw Error("Invalid skill provenance map");
		for (const [path, row] of Object.entries(value.skills)) {
			safePath(path); fields(row, ["sha256", "mode", "source"], "project skill entry");
			if (!hash(row.sha256) || !mode(row.mode)) throw Error("Invalid skill fingerprint");
			safePath(row.source);
		}
	}
	for (const [path, row] of Object.entries(value.templates)) {
		safePath(path); fields(row, ["origin", "sha256", "mode", "source"], "template provenance");
		if (row.origin === "package-default") {
			if (!hash(row.sha256) || !mode(row.mode)) throw Error("Invalid template fingerprint");
			safePath(row.source);
		} else if (row.origin === "preserved-project") {
			fields(row.source, ["kind", "revision"], "preserved template source");
			if (row.source.kind !== "project-snapshot" || !(row.source.revision === null || typeof row.source.revision === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(row.source.revision) && [40, 64].includes(row.source.revision.length)) || !(row.sha256 === null && row.mode === null) && (!hash(row.sha256) || !mode(row.mode))) throw Error("Invalid preserved template provenance");
		} else throw Error("Unknown template origin");
	}
}
function manifestSnapshot(value: unknown, pkg: PackageSnapshot): InstalledManifest {
	manifestEnvelope(value);
	if (![2, 3].includes(value.schemaVersion) || typeof value.runtimeReleaseId !== "string" || !/^pi-trellis-runtime-v1-[a-f0-9]{64}$/.test(value.runtimeReleaseId) || value.runtimeReleaseId.length !== 86 || !object(value.files) || !object(value.templates)) throw Error("Invalid managed project manifest");
	// Same rule as Update: absent skill rows are planned additions; unknown or wrong-source rows are rejected.
	for (const [path, row] of Object.entries(value.skills ?? {})) if (!Object.hasOwn(pkg.skills, path) || row.source !== pkg.skills[path].source) throw Error(`Unknown or invalid skill provenance: ${path}`);
	// An older release may lack rows for package-added files; the current release must match exactly.
	const older = value.runtimeReleaseId !== pkg.release;
	if (Object.keys(value.files).some(path => !Object.hasOwn(pkg.files, path)) || !older && Object.keys(value.files).length !== Object.keys(pkg.files).length || Object.keys(value.templates).length !== Object.keys(pkg.templates).length) throw Error("Incomplete or unknown managed resource entries");
	for (const [path, expected] of Object.entries(pkg.files)) {
		if (older && !Object.hasOwn(value.files, path)) continue;
		const row = value.files[path]; fields(row, ["sha256", "mode", "kind", "source"], "project resource entry");
		if (!hash(row.sha256) || !mode(row.mode) || row.source !== expected.source || row.kind !== expected.kind) throw Error(`Invalid resource provenance: ${path}`);
		// Roles are never hash-checked by dispatch, so a stale role row is a safe update, not damage;
		// only executable runtime rows must match the current package bytes and mode exactly.
		if (expected.kind === "runtime" && (row.sha256 !== expected.sha256 || row.mode !== expected.mode)) throw Error(`Malformed project resource provenance: ${path}`);
	}
	for (const [path, expected] of Object.entries(pkg.templates)) {
		const row = value.templates[path]; fields(row, ["origin", "sha256", "mode", "source"], "template provenance");
		if (row.origin === "package-default") {
			if (row.source !== expected.source || !hash(row.sha256) || !mode(row.mode)) throw Error(`Malformed package template provenance: ${path}`);
		} else if (row.origin === "preserved-project") {
			fields(row.source, ["kind", "revision"], "preserved template source");
			if (row.source.kind !== "project-snapshot" || !(row.source.revision === null || typeof row.source.revision === "string" && [40, 64].includes(row.source.revision.length) && /^[a-f0-9]+$/.test(row.source.revision))) throw Error(`Malformed preserved template source: ${path}`);
			if (!(row.sha256 === null && row.mode === null) && (!hash(row.sha256) || !mode(row.mode))) throw Error(`Invalid template fingerprint: ${path}`);
		} else throw Error(`Unknown template origin: ${path}`);
	}
	return value as InstalledManifest;
}
function operationSnapshot(value: unknown, root: string): "incomplete" | "complete" {
	fields(value, ["schemaVersion", "status", "plan", "completed"], "initialization operation");
	if (value.schemaVersion !== 1 || !["incomplete", "complete"].includes(value.status) || !object(value.plan) || value.plan.root !== root || !Array.isArray(value.completed) || value.completed.length > 256) throw Error("Invalid initialization operation envelope/root");
	fields(value.plan, ["schemaVersion", "root", "user", "releaseId", "operation", "workspaceReused", "task", "taskReused", "actions", "guards", "planHash"], "initialization plan envelope");
	validateUsername(value.plan.user);
	if (value.plan.schemaVersion !== 1 || typeof value.plan.releaseId !== "string" || value.plan.releaseId.length !== 86 || !/^pi-trellis-runtime-v1-[a-f0-9]{64}$/.test(value.plan.releaseId) || !["initialize", "identity"].includes(value.plan.operation) || typeof value.plan.workspaceReused !== "boolean" || typeof value.plan.taskReused !== "boolean" || !Array.isArray(value.plan.actions) || value.plan.actions.length > 256 || !object(value.plan.guards) || Object.keys(value.plan.guards).length > 512 || !hash(value.plan.planHash)) throw Error("Invalid initialization plan envelope");
	safePath(value.plan.task);
	if (!value.plan.task.startsWith(".trellis/tasks/")) throw Error("Invalid initialization task route");
	const paths = new Set<string>();
	for (const action of value.plan.actions) {
		fields(action, ["path", "original", "output", "mode", "kind"], "initialization action envelope");
		safePath(action.path);
		if (paths.has(action.path) || !mode(action.mode) || typeof action.output !== "string" || !["runtime", "agent", "skill", "template", "identity", "workspace", "task", "root", "manifest"].includes(action.kind)) throw Error("Invalid initialization action envelope");
		if (action.original !== null) { fields(action.original, ["sha256", "mode"], "initialization fingerprint"); if (!hash(action.original.sha256) || !mode(action.original.mode)) throw Error("Invalid initialization fingerprint"); }
		paths.add(action.path);
	}
	for (const [path, fingerprint] of Object.entries(value.plan.guards)) {
		safePath(path);
		if (fingerprint !== null) { fields(fingerprint, ["sha256", "mode"], "initialization guard"); if (!hash(fingerprint.sha256) || !mode(fingerprint.mode)) throw Error("Invalid initialization guard"); }
	}
	if (new Set(value.completed).size !== value.completed.length || value.completed.some((p: unknown) => typeof p !== "string" || !paths.has(p)) || value.status === "complete" && value.completed.length !== paths.size) throw Error("Invalid initialization completion entries");
	const { planHash, ...body } = value.plan;
	if (digest(JSON.stringify(body)) !== planHash) throw Error("Initialization plan envelope hash mismatch");
	// Do not reconstruct outputs, resolve action destinations or revalidate historical user task bytes.
	return value.status;
}
export function collectDiagnostics(scope: DiagnosticScope, options: { signal?: AbortSignal; reader?: DiagnosticReader } = {}): DiagnosticResult {
	const reader = options.reader ?? new DiagnosticReader(options.signal), result: DiagnosticResult = { schemaVersion: 1, scope: { ...scope }, items: [], omitted: 0, facts: { project: "unsafe", packageValid: false, runtimeStaticValid: false, resourcesRestorable: false, operationInvalid: false, locked: false, managedMarker: false } };
	const add = (id: string, category: string, status: DiagnosticItem["status"], summary: string, evidence: string[] = [], impact = "", advice = "", severity: DiagnosticItem["severity"] = status === "issue" ? "error" : "info") => {
		if (result.items.length === DIAGNOSTIC_LIMITS.items) {
			result.omitted++;
			const categories = result.omittedCategories ??= [];
			const label = clean(category, 32);
			if (categories.length < 16 && !categories.includes(label)) categories.push(label);
			return;
		}
		result.items.push({ id, category: clean(category, 32), status, severity, summary: clean(summary), evidence: evidence.slice(0, 12).map(v => clean(v)), impact: clean(impact), advice: clean(advice) });
	};
	const attempt = (id: string, category: string, location: string, action: () => void, impact: string, advice: string) => {
		try { reader.checkpoint(); action(); } catch (error) { add(id, category, error instanceof Cancelled ? "cancelled" : "issue", error instanceof Error ? error.message : "Read failed", [location], impact, advice); }
	};
	let root: string | undefined, pkg: PackageSnapshot | undefined;
	attempt("project", "project", scope.cwd, () => {
		root = diagnosticExecutionRoot(scope.cwd); result.scope.executionRoot = root;
		if (!lstatSync(root).isDirectory()) throw Error("Project root is not a directory");
		const marker = reader.stat(root, ".trellis");
		if (marker && !marker.isDirectory()) throw Error("Trellis marker must be a local directory");
		result.facts.project = marker ? "existing" : "fresh";
		add("project", "project", "pass", marker ? "Project discovered" : "Not initialized", [root], marker ? "" : "No project runtime is authorized.", marker ? "" : "Use /trellis-init and explicitly confirm Initialize project.");
	}, "Project discovery is unsafe; local project checks are blocked.", "Inspect this marker/path; Check does not skip to an ancestor.");
	attempt("package", "package", packageRoot, () => { pkg = packageSnapshot(reader); result.facts.packageValid = true; add("package", "package", "pass", "Package provenance verified (static)"); }, "Package damage is separate from project damage; execution remains unverified.", "Review the installed package/source provenance; do not repair project files to bypass it.");
	if (root && result.facts.project !== "unsafe") {
		attempt("operation", "initialization", OPERATION, () => {
			const value = reader.json(root!, OPERATION); if (value === undefined) { add("operation", "initialization", "pass", "No interrupted initialization record"); return; }
			try { result.facts.operation = operationSnapshot(value, root!); } catch (error) { result.facts.operationInvalid = true; throw error; }
			add("operation", "initialization", result.facts.operation === "incomplete" ? "issue" : "pass", result.facts.operation === "incomplete" ? "Initialization is incomplete" : "Completed initialization audit envelope is valid", [OPERATION], result.facts.operation === "incomplete" ? "Runtime execution is blocked; partial files are preserved." : "Historical outputs/tasks were not revalidated.", "Recovery output safety/retryability was not checked; no recovery was executed.");
		}, "Runtime execution is blocked; recovery content was not executed.", "Review the operation record before explicitly selecting a supported retry.");
		// Any unsafe/unreadable operation must block even if its JSON never parsed.
		if (result.items.some(i => i.id === "operation" && i.status !== "pass")) result.facts.operationInvalid = result.facts.operation !== "incomplete";
		attempt("lock", "initialization", LOCK, () => {
			result.facts.locked = !!reader.stat(root!, LOCK);
			const file = reader.file(root!, LOCK, DIAGNOSTIC_LIMITS.record); if (!file) { add("lock", "initialization", "pass", "No initialization lock"); return; }
			result.facts.locked = true;
			if (file.bytes) {
				let value: unknown; try { value = JSON.parse(file.text!); } catch { throw Error("Invalid lock JSON; owner is unknown"); }
				fields(value, ["schemaVersion", "pid", "planHash"], "initialization lock"); if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !hash(value.planHash)) throw Error("Invalid PID lock envelope");
			}
			add("lock", "initialization", "issue", file.bytes ? "Initialization PID lock exists" : "Resource lock exists (legal empty lock)", [LOCK], "Concurrent state is uncertain; no stale-owner inference or lock removal.", "Inspect the owner before explicit resource changes.", "warning");
		}, "Lock ownership is unknown; no lock was removed.", "Inspect the existing lock; an invalid lock does not authorize recovery.");
		attempt("marker", "project", ".trellis/.runtime/pi-trellis/binding.json", () => {
			result.facts.managedMarker = !!reader.stat(root!, ".trellis/.runtime/pi-trellis/binding.json");
			if (result.facts.managedMarker) add("marker", "project", "issue", "This directory is a managed task worktree checkout", [".trellis/.runtime/pi-trellis/binding.json"], "Check reports the deployment of the source project; runtime probes are skipped here.", "Run /trellis-init → Check project from the source project checkout.", "warning");
		}, "Managed checkout marker could not be read safely.", "Run /trellis-init → Check project from the source project checkout.");
		let raw: unknown;
		attempt("manifest", "resources", MANIFEST, () => {
			raw = reader.json(root!, MANIFEST);
			if (raw === undefined) { add("manifest", "resources", result.facts.project === "fresh" ? "skipped" : "issue", result.facts.project === "fresh" ? "No manifest: project is not initialized" : "No managed project manifest", [MANIFEST], "No project code is authorized.", "Use /trellis-init; review and explicitly confirm Initialize project or Adopt project."); return; }
			manifestEnvelope(raw);
			if (!pkg) { add("manifest", "resources", "blocked", "Manifest provenance blocked by package validation", [MANIFEST], "Only its envelope was checked; no execution authorization.", "Review the package error first."); return; }
			result.facts.manifest = manifestSnapshot(raw, pkg);
			add("manifest", "resources", raw.runtimeReleaseId === pkg.release ? "pass" : "issue", raw.runtimeReleaseId === pkg.release ? "Nonempty manifest provenance verified" : "Unsupported project runtime release", [MANIFEST], raw.runtimeReleaseId === pkg.release ? "" : "Old project code remains unauthorized.", raw.runtimeReleaseId === pkg.release ? "" : "Review an explicit resource update; Check does not upgrade.");
		}, "Manifest is not execution authority; fixed inventory checks continue independently.", "Review the manifest and explicitly reconcile/update through the supported menu.");
		for (const configRoot of [root!]) {
			for (const path of [".trellis/config.yaml", ".pi/pi-trellis.json", ".pi/settings.json"]) attempt(`config:${configRoot}:${path}`, "configuration", join(configRoot, path), () => {
				const file = reader.file(configRoot, path); if (!file) { add(`config:${configRoot}:${path}`, "configuration", "pass", `Optional configuration absent: ${path}`); return; }
				if (path.endsWith(".json")) { let value: unknown; try { value = JSON.parse(file.text!); } catch { throw Error("Invalid configuration JSON"); } if (!object(value)) throw Error("Configuration JSON must be an object"); }
				add(`config:${configRoot}:${path}`, "configuration", "pass", `${path.endsWith(".json") ? "JSON parsed" : "YAML text safely read (not parsed)"}: ${path}`, [], "Effective values/consumer fallback were not probed.");
			}, "This present configuration could not be safely consumed; effective settings are unverified.", "Inspect the indicated file without publishing or creating configuration locks.");
		}
		attempt("developer", "identity", join(root!, ".trellis/.developer"), () => {
			const file = reader.file(root!, ".trellis/.developer", DIAGNOSTIC_LIMITS.record);
			if (!file) { add("developer", "identity", "skipped", "Local developer identity not set", [], "Environment/main-checkout effective identity was not probed."); return; }
			const names = file.text!.split(/\r?\n/).filter(line => line.startsWith("name=")); if (names.length !== 1) throw Error("Developer identity is malformed");
			const name = validateUsername(names[0].slice(5)); result.facts.developer = name;
			add("developer", "identity", "pass", `Developer: ${name}`, [join(root!, ".trellis/.developer")], "Local identity only; runtime fallback was not probed.");
			attempt("workspace", "identity", `.trellis/workspace/${name}`, () => {
				if (!reader.stat(root!, `.trellis/workspace/${name}`)?.isDirectory()) throw Error("Corresponding local workspace is missing");
				const index = reader.file(root!, `.trellis/workspace/${name}/index.md`); if (!index?.bytes) throw Error("Workspace index is missing or empty");
				add("workspace", "identity", "pass", "Corresponding workspace/index safely read", [], "No journal/history enumeration or write-permission test.");
			}, "Local identity workspace is incomplete; journal capability is unverified.", "Review this identity's workspace without switching identity or changing history.");
		}, "Local developer identity cannot select a workspace.", "Review .developer; Check does not guess a replacement identity.");
		// Fixed, metadata-only routes: do not infer paths from an untrusted manifest.
		let templateRoutesValid = true;
		if (result.facts.project === "existing") attempt("template-routes", "resources", ".trellis template routes", () => {
			const errors: string[] = [];
			for (const path of Object.values(TEMPLATE_TARGETS)) {
				try { reader.stat(root!, path); } catch (error) { templateRoutesValid = false; if (error instanceof Cancelled) throw error; errors.push(`${path}: ${error instanceof Error ? error.message : "Unsafe route"}`); }
			}
			if (errors.length) add("template-routes", "resources", "issue", "Editable template route is unsafe", errors, "Static runtime path safety is incomplete; no execution authorization.", "Inspect the local route; custom document bytes are not hash failures.");
			else add("template-routes", "resources", "pass", "Fixed editable template routes checked (metadata only)");
		}, "Template route checks are incomplete.", "Inspect local editable routes without replacing user bytes.");
		// Fixed package inventory, never paths from an untrusted project manifest. Fresh projects do not produce a missing-file avalanche.
		if (!pkg && result.facts.project === "existing") add("inventory:runtime", "resources", "blocked", "Fixed resource inventory unavailable: package validation failed", [], "Runtime/role byte comparison was not performed.", "Review the package cause; independent required documents are still checked.");
		if (pkg && result.facts.project === "existing") {
			let runtimeValid = true, restorable = !!result.facts.manifest;
			for (const kind of ["runtime", "agent"] as const) {
				const problems: string[] = []; let total = 0, inventoryCancelled = false;
				for (const [path, expected] of Object.entries(pkg.files).filter(([, r]) => r.kind === kind)) {
					try {
						const actual = reader.file(root, path, DIAGNOSTIC_LIMITS.file, true), installed = result.facts.manifest?.files[path];
						if (!actual) { total++; if (problems.length < 12) problems.push(`Missing: ${path}`); if (kind === "runtime") runtimeValid = false; continue; }
						if (actual.sha256 !== expected.sha256 || actual.mode !== expected.mode) {
							total++; if (problems.length < 12) problems.push(`${actual.sha256 !== expected.sha256 ? "Hash mismatch" : "Mode mismatch"}: ${path}`);
							if (kind === "runtime") runtimeValid = false;
							if (!installed || actual.sha256 !== installed.sha256 || actual.mode !== installed.mode) restorable = false;
						}
					} catch (error) { if (error instanceof Cancelled) { inventoryCancelled = true; runtimeValid = false; restorable = false; break; } total++; restorable = false; if (kind === "runtime") runtimeValid = false; if (problems.length < 12) problems.push(`${path}: ${error instanceof Error ? error.message : "read failed"}`); }
				}
				add(`inventory:${kind}`, "resources", inventoryCancelled ? "cancelled" : total ? "issue" : "pass", inventoryCancelled ? "Inventory cancelled; checks not completed" : total ? `${total} fixed ${kind} resource problem(s)${total > problems.length ? `; ${total - problems.length} path details omitted` : ""}` : `Fixed ${kind} inventory verified (static)`, problems, kind === "runtime" && total ? "Runtime bytes/modes do not authorize execution." : total ? "Missing/modified roles affect dispatch or explicit update conflicts; customization alone does not prove runtime failure." : "", total ? "Review these fixed paths; explicitly update/restore resources. Custom bytes are never overwritten by Check." : "", kind === "agent" ? "warning" : total ? "error" : "info");
			}
			result.facts.resourcesRestorable = restorable;
			// Project skills: same classification as Update resources; never part of runtime validity.
			if (result.facts.manifest) attempt("inventory:skill", "resources", ".pi/skills", () => {
				const review = reviewSkills(root!, result.facts.manifest!.skills ?? {}, pkg!.skills, path => {
					try { const file = reader.file(root!, path, DIAGNOSTIC_LIMITS.file, true, binarySkillFile(path)); return file ? { sha256: file.sha256, mode: file.mode } : null; }
					catch (error) { if (error instanceof Cancelled) throw error; return { sha256: "unreadable", mode: -1 }; }
				});
				const problems = review.rows.filter(row => row.state !== "Current"), conflicts = review.conflicts.length;
				if (!problems.length) { add("inventory:skill", "resources", "pass", "Project skills match the package (static)"); return; }
				add("inventory:skill", "resources", "issue", `${problems.length} project skill item(s) need attention${conflicts ? `; ${conflicts} preserved conflict(s)` : ""}${problems.length > 12 ? `; ${problems.length - 12} path details omitted` : ""}`, problems.slice(0, 12).map(row => `${row.state}: ${row.path}`), "Skills load through Pi project discovery; runtime execution is unaffected.", conflicts ? "Resolve modified/unmanaged skill files (rename, move or restore), then choose /trellis-init → Update resources." : "Choose /trellis-init → Update resources, then /reload or start a new session.", "warning");
			}, "Project skill state is unverified; runtime execution is unaffected.", "Inspect .pi/skills; Check never changes skill files.");
			result.facts.runtimeStaticValid = runtimeValid && templateRoutesValid && result.facts.manifest?.runtimeReleaseId === pkg.release && !result.facts.operationInvalid && result.facts.operation !== "incomplete" && !result.facts.locked;
		}
		// Required editable entries have no package-integrity dependency.
		if (result.facts.project === "existing") {
			attempt("documents", "resources", ".trellis/workflow.md; .trellis/spec/index.md; .trellis/spec/guides/index.md", () => {
				const missing: string[] = [], unreadable: string[] = [];
				for (const path of [".trellis/workflow.md", ".trellis/spec/index.md", ".trellis/spec/guides/index.md"]) {
					try { const file = reader.file(root!, path); if (!file?.bytes) missing.push(path); }
					catch (error) { if (error instanceof Cancelled) throw error; unreadable.push(`${path}: ${error instanceof Error ? error.message : "read failed"}`); }
				}
				if (missing.length || unreadable.length) add("documents", "resources", "issue", "Required workflow/spec entry missing, empty or unreadable", [...missing, ...unreadable], "Workflow/guideline discovery is incomplete.", "Review/restore required entries explicitly; user document custom bytes are not hash failures.");
				else add("documents", "resources", "pass", "Required workflow/spec entries safely read", [], "Customized user documents are preserved; Phase Index was not probed.");
			}, "Workflow/spec entry could not be safely read.", "Inspect the indicated local entries; custom document hashes are not enforced.");
		}
	}
	const cancelled = options.signal?.aborted;
	add("runtime-probe", "runtime", cancelled ? "cancelled" : "blocked", "Python runtime probe not performed (static collector)", [], "Static provenance is not proof of a working runtime.", "Use the bounded runtime probe.");
	add("effective-config", "configuration", cancelled ? "cancelled" : "skipped", "Effective configuration/identity consumer parsing not probed (static collector)");
	add("host-resources", "host", "skipped", "Host loaded resources/custom agent-dir state is not publicly verified", [], "Project trust was supplied only when visible; no settings manager/resource resolver was created.");
	return result;
}

/** Persist only bounded, sanitized presentation data, never collector facts or controllers. */
export interface DiagnosticReportLine {
	text: string;
	tone: "text" | "accent" | "error" | "warning" | "success" | "muted";
}
export interface DiagnosticReport {
	version: 1;
	compact: DiagnosticReportLine[];
	expanded: DiagnosticReportLine[];
}
export function buildDiagnosticReport(result: DiagnosticResult): DiagnosticReport {
	const groups = [
		{ label: "Error", plural: "Errors", icon: "✗", tone: "error", items: result.items.filter(i => i.status === "issue" && i.severity !== "warning") },
		{ label: "Warning", plural: "Warnings", icon: "⚠", tone: "warning", items: result.items.filter(i => i.status === "issue" && i.severity === "warning") },
		{ label: "Blocked", plural: "Blocked", icon: "⊘", tone: "warning", items: result.items.filter(i => i.status === "blocked") },
		{ label: "Skipped", plural: "Skipped", icon: "—", tone: "muted", items: result.items.filter(i => i.status === "skipped") },
		{ label: "Cancelled", plural: "Cancelled", icon: "—", tone: "muted", items: result.items.filter(i => i.status === "cancelled") },
		{ label: "Passed", plural: "Passed", icon: "✓", tone: "success", items: result.items.filter(i => i.status === "pass") },
	] as const;
	const [errors, warnings, blocked, skipped, cancelled, passed] = groups;
	const partial = blocked.items.length + skipped.items.length > 0;
	const outcome = errors.items.length ? "Needs attention" : warnings.items.length ? "Warnings found" : "No errors found";
	const title = `Check project · ${outcome}${cancelled.items.length ? " · Cancelled" : partial ? " · Verification incomplete" : ""}${result.omitted ? " · Results incomplete" : ""}`;
	const tone = errors.items.length ? "error" : warnings.items.length || blocked.items.length ? "warning" : partial || cancelled.items.length || result.omitted ? "accent" : "success";
	const header: DiagnosticReportLine[] = [
		{ text: title, tone },
		{ text: `${errors.icon} Errors ${errors.items.length}   ${warnings.icon} Warnings ${warnings.items.length}   ${passed.icon} Passed ${passed.items.length}`, tone: "text" },
		{ text: `⊘ Blocked ${blocked.items.length}   — Skipped ${skipped.items.length}   — Cancelled ${cancelled.items.length}`, tone: "muted" },
		{ text: `Project: ${clean(result.scope.executionRoot ?? result.scope.cwd, 1000)}`, tone: "muted" },
		{ text: "Scope: Trellis deployment in this project", tone: "muted" },
	];
	const make = (expanded: boolean): DiagnosticReportLine[] => {
		const lines = [...header];
		let omitted = result.omitted, hidden = 0;
		const categories = new Set((result.omittedCategories ?? []).slice(0, 16).map(c => clean(c, 32)));
		let bytes = Buffer.byteLength(lines.map(l => l.text).join("\n"));
		const append = (block: DiagnosticReportLine[]) => {
			const size = Buffer.byteLength(block.map(l => l.text).join("\n")) + 1;
			if (bytes + size > DIAGNOSTIC_LIMITS.report - 2048) return false;
			lines.push(...block); bytes += size; return true;
		};
		for (const group of groups) {
			if (!group.items.length) continue;
			if (!expanded && group.label === "Passed") {
				append([{ text: `\n✓ Passed: ${clean([...new Set(group.items.map(i => clean(i.category, 32)))].join(", "), 256)}`, tone: "success" }]);
				continue;
			}
			append([{ text: `\n${group.plural}`, tone: group.tone }]);
			for (const [index, item] of group.items.entries()) {
				if (!expanded && index >= (group.label === "Error" || group.label === "Warning" ? 3 : 2)) { hidden++; continue; }
				const block: DiagnosticReportLine[] = [{ text: `${group.icon} [${group.label}] ${clean(item.summary, expanded ? 500 : 180)}`, tone: group.tone }];
				if (expanded && group.label !== "Passed") {
					block.push(...item.evidence.slice(0, 12).map(v => ({ text: `  Location/evidence: ${clean(v)}`, tone: "muted" as const })));
				}
				if (expanded && item.impact) block.push({ text: `  Impact: ${clean(item.impact)}`, tone: "muted" });
				if (item.advice && (expanded || group.label === "Error" || group.label === "Warning" || group.label === "Blocked")) block.push({ text: `  Next: ${clean(item.advice, expanded ? 500 : 180)}`, tone: "text" });
				if (!append(block)) { omitted++; categories.add(clean(item.category, 32)); }
			}
		}
		if (!expanded) lines.push({ text: `\nExpand for evidence and check details${hidden ? ` (${hidden} more items hidden)` : ""}.`, tone: "muted" });
		if (omitted) {
			lines[0] = { ...lines[0], text: lines[0].text.includes("Results incomplete") ? lines[0].text : `${lines[0].text} · Results incomplete`, tone: errors.items.length ? "error" : "warning" };
			lines.push({ text: `\n${omitted} diagnostic item(s) omitted by the report budget; additional checks/details are not displayed. Omitted categories: ${clean([...categories].join(", "), 200) || "not recorded"}.`, tone: "warning" });
		}
		lines.push({ text: "\nRead-only: no files were changed.", tone: "muted" });
		return lines;
	};
	const expanded = make(true), compact = make(false);
	// Detail-budget omissions must remain visible before the user expands the message.
	if (expanded[0].text.includes("Results incomplete") && !compact[0].text.includes("Results incomplete")) {
		compact[0] = { ...expanded[0] };
		compact.splice(compact.length - 1, 0, { text: "Some diagnostic details were omitted by the report budget; expand for the omission summary.", tone: "warning" });
	}
	return { version: 1, compact, expanded };
}

/** Bounded English fallback, without persisted ANSI colors. */
export function formatDiagnostics(result: DiagnosticResult): string {
	return buildDiagnosticReport(result).expanded.map(line => line.text).join("\n");
}
