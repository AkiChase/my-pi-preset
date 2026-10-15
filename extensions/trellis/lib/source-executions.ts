import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { atomicJson, runtimeDirectory } from "./bindings.ts";
import { canonicalPath, taskSlug } from "./config.ts";
import { checkedPath } from "./initialization/engine.ts";
import { isTrellisRole, type TrellisRole } from "./task-context.ts";

export interface SourceIdentity { sourceRoot: string; repositoryIdentity: string; taskDir: string }
export interface SourceExecution extends SourceIdentity {
	version: 1; mode: "source"; requestId: string; role: TrellisRole; agentId?: string;
	state: "starting" | "running" | "completed" | "failed" | "unknown";
	ownerPid: number; ownerToken: string; createdAt: string; error?: string;
}
export function sourceExecutionFile(identity: SourceIdentity): string {
	taskSlug(identity.taskDir);
	const root = canonicalPath(identity.sourceRoot);
	if (root !== identity.sourceRoot || canonicalPath(identity.repositoryIdentity) !== identity.repositoryIdentity) throw new Error("Invalid source execution identity");
	runtimeDirectory(root);
	return checkedPath(root, `.trellis/.runtime/pi-trellis/source-executions/${createHash("sha256").update(identity.taskDir).digest("hex")}.json`);
}
export function parseSourceExecution(value: unknown, identity: SourceIdentity): SourceExecution {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source execution record");
	const r = value as SourceExecution;
	if (r.version !== 1 || r.mode !== "source" || !isTrellisRole(r.role) || !["starting", "running", "completed", "failed", "unknown"].includes(r.state) || !Number.isSafeInteger(r.ownerPid) || r.ownerPid <= 0) throw new Error("Invalid source execution state/owner");
	for (const key of ["sourceRoot", "repositoryIdentity", "taskDir"] as const) if (r[key] !== identity[key]) throw new Error("Source execution identity mismatch");
	for (const key of ["requestId", "ownerToken", "createdAt"] as const) if (typeof r[key] !== "string" || !r[key] || r[key].length > 256 || /[\0\r\n]/.test(r[key])) throw new Error("Invalid source execution identifier");
	if (r.agentId !== undefined && (typeof r.agentId !== "string" || !r.agentId || r.agentId.length > 1024 || /[\0\r\n]/.test(r.agentId))) throw new Error("Invalid source agent id");
	if (r.error !== undefined && (typeof r.error !== "string" || r.error.length > 4096)) throw new Error("Invalid source execution error");
	return r;
}
export function readSourceExecution(identity: SourceIdentity): SourceExecution | undefined {
	const file = sourceExecutionFile(identity);
	try {
		const info = lstatSync(file);
		if (!info.isFile() || info.size > 65536) throw new Error("Source execution must be a bounded regular file");
		return parseSourceExecution(JSON.parse(readFileSync(file, "utf8")), identity);
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export function writeSourceExecution(record: SourceExecution): void {
	parseSourceExecution(record, record);
	atomicJson(sourceExecutionFile(record), record);
}
export function sourceActive(record: SourceExecution | undefined): boolean { return !!record && ["starting", "running", "unknown"].includes(record.state); }

/** Terminal events may be observed by a new host; no PID/stop reply is terminal evidence. */
export function sourceExecutionForAgent(sourceRoot: string, repositoryIdentity: string, agentId: string, onDiagnostic?: (message: string) => void): SourceExecution | undefined {
	const directory = checkedPath(sourceRoot, ".trellis/.runtime/pi-trellis/source-executions");
	let names: string[];
	try { names = readdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	if (names.length > 4096) throw new Error("Source execution lookup limit reached");
	for (const name of names) {
		if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
		let raw: any;
		try {
			const path = checkedPath(sourceRoot, `.trellis/.runtime/pi-trellis/source-executions/${name}`);
			const info = lstatSync(path);
			if (!info.isFile() || info.size > 65536) throw new Error("Invalid source execution lookup file");
			raw = JSON.parse(readFileSync(path, "utf8"));
			const identity = { sourceRoot, repositoryIdentity, taskDir: raw?.taskDir };
			if (sourceExecutionFile(identity) !== path) throw new Error("Source execution filename mismatch");
			const record = parseSourceExecution(raw, identity);
			if (record.agentId === agentId && sourceActive(record)) return record;
		} catch (error) { onDiagnostic?.(`Source execution discovery skipped invalid record ${name}: ${String(error).slice(0, 512)}`); /* Direct task reads still fail closed. */ }
	}
	return undefined;
}
