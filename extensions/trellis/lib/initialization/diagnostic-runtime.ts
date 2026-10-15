import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { diagnosticEnvironment, runDiagnosticProcess, diagnosticJSON } from "./diagnostic-runner.ts";
import { DIAGNOSTIC_BOOTSTRAP } from "./diagnostic-bootstrap.ts";
import type { DiagnosticScope, DiagnosticResult, DiagnosticItem } from "./diagnostics.ts";

const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string[]): asserts v is Record<string, any> {
	if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error("Invalid diagnostic response schema");
}
function validatePayload(v: unknown, mode: "environment" | "context"): asserts v is Record<string, any> {
	if (mode === "environment") {
		exact(v, ["version", "isolated", "noSite", "noBytecode", "utf8"]);
		if (!Array.isArray(v.version) || v.version.length !== 3 || !v.version.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0) || v.version[0] < 3 || v.version[0] === 3 && v.version[1] < 10 || [v.isolated, v.noSite, v.noBytecode, v.utf8].some(n => n !== true)) throw Error("Python environment flags/version were not proved");
		return;
	}
	exact(v, ["configuration", "identity", "workflow"]);
	exact(v.configuration, ["readError", "parserIssues", "ignored", "limits", "journalLines", "autoCommit", "packageCount", "specScopeKind", "hooks"]);
	const cfg = v.configuration;
	const nullableText = (n: unknown) => n === null || typeof n === "string" && n.length <= 8192;
	if (!nullableText(cfg.readError) || !Array.isArray(cfg.parserIssues) || cfg.parserIssues.length > 64 || !Array.isArray(cfg.ignored) || cfg.ignored.length > 64 || cfg.ignored.some((n: unknown) => typeof n !== "string" || n.length > 500)) throw Error("Invalid configuration facts");
	for (const n of cfg.parserIssues) { exact(n, ["line", "reason"]); if (!Number.isSafeInteger(n.line) || n.line < 1 || typeof n.reason !== "string" || n.reason.length > 500) throw Error("Invalid parser issue"); }
	exact(cfg.limits, ["max_file_bytes", "max_artifact_bytes", "max_total_bytes"]);
	for (const n of Object.values(cfg.limits)) if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw Error("Invalid effective Python limit");
	if (typeof cfg.journalLines !== "number" || !Number.isFinite(cfg.journalLines) || typeof cfg.autoCommit !== "boolean" || !Number.isSafeInteger(cfg.packageCount) || cfg.packageCount < 0 || !["list", "string", "default"].includes(cfg.specScopeKind)) throw Error("Invalid effective configuration values");
	exact(cfg.hooks, ["after_create", "after_start", "after_deactivate", "after_archive"]);
	for (const n of Object.values(cfg.hooks)) if (!Number.isSafeInteger(n) || (n as number) < 0) throw Error("Invalid hook shape/count");
	exact(v.identity, ["developer", "source", "error", "workspace", "workspaceError"]);
	if (!nullableText(v.identity.developer) || !nullableText(v.identity.error) || !nullableText(v.identity.workspaceError) || !["environment", "local", "unresolved"].includes(v.identity.source) || typeof v.identity.workspace !== "boolean") throw Error("Invalid identity facts");
	exact(v.workflow, ["phaseBytes", "error"]);
	if (!Number.isSafeInteger(v.workflow.phaseBytes) || v.workflow.phaseBytes < 0 || !nullableText(v.workflow.error)) throw Error("Invalid workflow facts");
}
/** Public lifecycle seam: caller owns abort/generation and publication. This function never notifies. */
export async function runDiagnostics(scope: DiagnosticScope, options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<DiagnosticResult> {
	const deadline = performance.now() + Math.min(options.deadlineMs ?? 20000, 20000), workDeadline = deadline - 2000;
	let result: DiagnosticResult = { schemaVersion: 1, scope: { ...scope }, items: [], omitted: 0, facts: { project: "unsafe", packageValid: false, runtimeStaticValid: false, resourcesRestorable: false, operationInvalid: false, locked: false, managedMarker: false } };
	const add = (id: string, category: string, status: DiagnosticItem["status"], summary: string, evidence: string[] = [], impact = "", advice = "") => {
		if (result.items.length >= 64) { result.omitted++; return; }
		const clean = (v: string) => v.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ").slice(0, 500);
		result.items.push({ id, category, status, severity: status === "issue" ? "error" : "info", summary: clean(summary), evidence: evidence.slice(0, 12).map(clean), impact: clean(impact), advice: clean(advice) });
	};
	let worker: Worker | undefined, workerTimer: ReturnType<typeof setTimeout> | undefined;
	let cancelWait: (() => void) | undefined;
	let workerFailure: Error | undefined;
	const rememberFailure = () => { workerFailure = Error("Diagnostic worker failed before terminal proof"); };
	const abort = () => cancelWait?.();
	options.signal?.addEventListener("abort", abort);
	try {
		if (options.signal?.aborted) throw Error("aborted");
		worker = new Worker(new URL("./diagnostic-worker.ts", import.meta.url), { workerData: { scope, developer: process.env.TRELLIS_DEVELOPER }, execArgv: [] });
		worker.on("error", rememberFailure);
		const wait = (type: string) => new Promise<any>((resolve, reject) => {
			if (workerFailure) { reject(workerFailure); return; }
			const finish = (error?: Error, value?: unknown) => {
				worker!.removeListener("message", message); worker!.removeListener("error", failed); worker!.removeListener("exit", exited);
				if (workerTimer) clearTimeout(workerTimer); cancelWait = undefined;
				error ? reject(error) : resolve(value);
			};
			const message = (v: any) => {
				if (v?.type === "static") { result = v.result; result.items = result.items.filter(i => !["runtime-probe", "effective-config"].includes(i.id)); }
				if (v?.type === type || v?.type === "blocked") finish(undefined, v);
			};
			const failed = () => finish(Error("Diagnostic worker failed"));
			const exited = () => finish(Error("Diagnostic worker exited before completion"));
			cancelWait = () => finish(Error("aborted"));
			worker!.on("message", message); worker!.on("error", failed); worker!.on("exit", exited);
			workerTimer = setTimeout(() => finish(Error("Diagnostic worker deadline exceeded")), Math.max(0, workDeadline - performance.now()));
			if (options.signal?.aborted) cancelWait();
		});
		const captured = await wait("capture");
		// Collecting static facts may consume the budget, but must never fake a runtime pass.
		if (performance.now() >= workDeadline) throw Error("Diagnostic worker deadline exceeded");
		const root = result.scope.executionRoot ?? scope.cwd;
		const protocolScope = { executionRoot: root };
		const env = diagnosticEnvironment(process.env.TRELLIS_DEVELOPER);
		const invoke = async (mode: "environment" | "context") => {
			const requestId = randomUUID();
			const input = Buffer.from(JSON.stringify({ schemaVersion: 1, requestId, scope: protocolScope, mode, sources: mode === "context" ? captured.sources : {}, snapshots: mode === "context" ? captured.snapshots : {}, developer: process.env.TRELLIS_DEVELOPER ?? null }));
			const execution = await runDiagnosticProcess({ executable: process.env.TRELLIS_PYTHON || "python3", argv: ["-I", "-S", "-B", "-X", "utf8", "-c", DIAGNOSTIC_BOOTSTRAP], cwd: root, env, input, signal: options.signal, deadline: workDeadline, timeout: mode === "environment" ? 3000 : 5000 });
			const value = diagnosticJSON(execution); exact(value, ["schemaVersion", "requestId", "scope", "mode", "payload"]);
			if (value.schemaVersion !== 1 || value.requestId !== requestId || value.mode !== mode || JSON.stringify(value.scope) !== JSON.stringify(protocolScope)) throw Error("Diagnostic response scope/request mismatch");
			validatePayload(value.payload, mode);
			return value.payload;
		};
		let environmentValid = false;
		try { const v = await invoke("environment"); add("python", "runtime", "pass", `Isolated Python ${v.version.join(".")} environment completed`); environmentValid = true; }
		catch (error) { add("python", "runtime", options.signal?.aborted ? "cancelled" : "issue", error instanceof Error ? error.message : "Python environment probe failed", [], "Environment failure does not hide independent static checks.", "Check the configured interpreter; no installation or repair was performed."); }
		if (captured.type === "blocked" || !environmentValid) {
			add("runtime-probe", "runtime", options.signal?.aborted ? "cancelled" : "blocked", "Runtime probe blocked", [captured.reason ?? "Python environment proof unavailable"], "No project loader was executed; static facts are not execution authority.", "Review the strict gate cause and explicitly update resources when appropriate.");
			add("effective-config", "configuration", "blocked", "Effective configuration/identity consumer not executed");
		} else {
			try {
				const v = await invoke("context");
				const recheck = wait("rechecked"); worker.postMessage({ type: "recheck" }); const checked = await recheck;
				if (!checked.valid) throw Error(checked.reason ?? "Snapshot consistency unverified");
				add("runtime-probe", "runtime", "pass", "Verified deployed runtime config/identity/workflow consumers completed");
				const cfg = v.configuration, warnings = [...cfg.ignored, ...cfg.parserIssues.map((i: any) => `Line ${i.line}: ${i.reason}`), ...(cfg.readError ? [cfg.readError] : [])];
				add("effective-config", "configuration", warnings.length ? "issue" : "pass", warnings.length ? "Configuration has ignored/fallback declarations" : "Shared Python configuration consumers completed", warnings, `Python context limits: ${JSON.stringify(cfg.limits)}; journal lines: ${cfg.journalLines}; auto-commit: ${cfg.autoCommit}. Hooks parsed/counts only; none executed.`, warnings.length ? "Review the indicated declarations; unknown fields are benign." : "");
				for (const row of result.items) {
					if (row.id === "developer") row.impact = "Local identity only; effective consumer result is reported separately.";
					if (row.id.startsWith("config:")) row.impact = "Safely read static snapshot; shared consumer result is reported separately.";
					if (row.id === "documents") row.impact = "Customized document bytes preserved; shared Phase Index consumer reported separately.";
				}
				add("ts-context-limits", "configuration", "skipped", "Current Pi path-only dispatch has no TS context-limit consumer", [], "No duplicate TS parser was invented; Python limits do not authorize native material reads.");
				const id = v.identity;
				add("effective-identity", "identity", id.error || id.developer && (!id.workspace || id.workspaceError) ? "issue" : id.developer ? "pass" : "blocked", id.developer ? `Effective developer: ${id.developer} (${id.source})` : "Effective developer unresolved; main-checkout fallback not proved", [id.error, id.workspaceError].filter(Boolean), id.developer ? "Only the effective workspace index was read; no history enumeration." : "Set up developer identity via /trellis-init.");
				add("phase-consumer", "context", v.workflow.error || !v.workflow.phaseBytes ? "issue" : "pass", v.workflow.phaseBytes ? "Shared Pi Phase Index consumer completed" : "Workflow Phase Index unavailable", v.workflow.error ? [v.workflow.error] : []);
			} catch (error) { add("runtime-probe", "runtime", options.signal?.aborted ? "cancelled" : "blocked", error instanceof Error ? error.message : "Consumer probe failed", [], "Runtime completion/snapshot proof unavailable; not a passed capability.", "Review this bounded probe failure without changing project state."); }
		}
	} catch (error) {
		add("runtime-probe", "runtime", options.signal?.aborted ? "cancelled" : "blocked", error instanceof Error ? error.message : "Diagnostic failed", [], "Independent results obtained before the failure are retained.");
	} finally {
		options.signal?.removeEventListener("abort", abort); if (workerTimer) clearTimeout(workerTimer);
		if (worker) { await worker.terminate(); worker.removeListener("error", rememberFailure); }
	}
	return result;
}
