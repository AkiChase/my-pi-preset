import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { collectDiagnostics, DiagnosticReader, DIAGNOSTIC_LIMITS, type DiagnosticResult } from "./diagnostics.ts";
import { packageProvenance, verifyRuntime, validateUsername, digest } from "./engine.ts";
import { DIAGNOSTIC_CLOSURE } from "./diagnostic-bootstrap.ts";

const reader = new DiagnosticReader();
const scope = workerData.scope;
let result: DiagnosticResult;
const snapshots = new Map<string, ReturnType<DiagnosticReader["file"]>>();
const routes = new Map<string, { root: string; path: string; limit?: number }>();
const original = reader.file.bind(reader);
reader.file = (root, path, limit, inventory) => { const file = original(root, path, limit, inventory); if (!inventory) { snapshots.set(join(root, path), file); routes.set(join(root, path), { root, path, limit }); } return file; };
const text = (root: string, path: string, error: string | null = null) => {
	const file = snapshots.get(join(root, path));
	return { text: file?.text ?? null, error };
};
const currentError = (id: string) => result.items.find(i => i.id === id && i.status !== "pass" && i.status !== "skipped")?.summary ?? null;
let manifestDigest: string | undefined;
let captured: Record<string, { data: string; sha256: string; mode: number; origin: string; package: boolean }> | undefined;
try {
	result = collectDiagnostics(scope, { reader });
	parentPort!.postMessage({ type: "static", result });
	const root = result.scope.executionRoot;
	if (!root || result.facts.project !== "existing") throw Error("No initialized execution root");
	if (result.facts.managedMarker || currentError("marker")) throw Error("Managed task worktree checkout; run Check from the source project");
	if (currentError("operation")) throw Error("Initialization audit is invalid/incomplete; runtime execution blocked");
	// Execution authority comes ONLY from this shared strict owner. Never runtimeStaticValid.
	const pkg = packageProvenance(reader);
	const manifest = verifyRuntime(root, reader, pkg);
	if (!manifest || !Object.keys(manifest.files).length) throw Error("Nonempty current strict manifest required");
	manifestDigest = digest(JSON.stringify(manifest));
	captured = {};
	for (const [name, path] of Object.entries(DIAGNOSTIC_CLOSURE)) {
		const deployed = `.trellis/scripts/${path}`, expected = manifest.files[deployed];
		if (!expected || expected.kind !== "runtime") throw Error(`Required deployment source missing: ${path}`);
		const source = reader.file(root, deployed, DIAGNOSTIC_LIMITS.file, true);
		if (!source || source.sha256 !== expected.sha256 || source.mode !== expected.mode) throw Error(`Captured deployment source changed: ${path}`);
		captured[name] = { data: source.data.toString("base64"), sha256: source.sha256, mode: source.mode, origin: join(root, deployed), package: path.endsWith("/__init__.py") };
	}
	let workspace = text(root, `.trellis/workspace/${result.facts.developer}/index.md`, currentError("workspace"));
	if (workerData.developer) {
		try {
			const name = validateUsername(workerData.developer.trim());
			const file = reader.file(root, `.trellis/workspace/${name}/index.md`);
			workspace = { text: file?.text ?? null, error: file?.bytes ? null : "Effective developer workspace index is missing" };
		} catch { workspace = { text: null, error: "Effective developer workspace cannot be safely read" }; }
	}
	const consumerSnapshots = {
		config: text(root, ".trellis/config.yaml", currentError(`config:${root}:.trellis/config.yaml`)),
		identity: text(root, ".trellis/.developer", currentError("developer")), workflow: text(root, ".trellis/workflow.md", currentError("documents")), workspace,
	};
	parentPort!.postMessage({ type: "capture", root, sources: captured, snapshots: consumerSnapshots, usage: { text: reader.textBytes, inventory: reader.inventoryBytes } });
	parentPort!.on("message", message => {
		if (message?.type !== "recheck") return;
		try {
			const current = verifyRuntime(root, reader, pkg);
			if (!current || digest(JSON.stringify(current)) !== manifestDigest) throw Error("Runtime/manifest changed during probe");
			for (const [path, before] of snapshots) {
				// Absolute paths are local to previously authorized roots/stores. No new ref discovery.
				const route = routes.get(path)!;
				const after = original(route.root, route.path, route.limit);
				if (before?.sha256 !== after?.sha256 || before?.mode !== after?.mode) throw Error("Consumer snapshot changed during probe");
			}
			parentPort!.postMessage({ type: "rechecked", valid: true, usage: { text: reader.textBytes, inventory: reader.inventoryBytes } });
		} catch (error) { parentPort!.postMessage({ type: "rechecked", valid: false, reason: error instanceof Error ? error.message : "Recheck failed" }); }
	});
} catch (error) {
	parentPort!.postMessage({ type: "blocked", reason: error instanceof Error ? error.message : "Strict execution gate failed", usage: { text: reader.textBytes, inventory: reader.inventoryBytes } });
}
