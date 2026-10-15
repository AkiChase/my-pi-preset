import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { canonicalPath, containsPath } from "./config.ts";
import { atomicJson, runtimeDirectory, type WorktreeBinding } from "./bindings.ts";

export interface ExecutionRecord {
	bindingId: string; requestId: string; agentId?: string; role: string;
	state: "starting" | "running" | "completed" | "failed" | "stopped" | "unknown";
	ownerPid: number; ownerToken: string; createdAt: string; error?: string; finalSnapshot?: string;
	materialRevision?: string; sourceFingerprint?: string; targetFingerprint?: string;
}
export const processToken = randomUUID();
export function executionFile(binding: WorktreeBinding): string {
	const directory = runtimeDirectory(binding.sourceRoot);
	const file = join(directory, `execution-${binding.bindingId}.json`);
	if (!/^[A-Za-z0-9-]+$/.test(binding.bindingId) || !containsPath(directory, canonicalPath(file))) throw new Error("Execution record escapes runtime");
	return file;
}
export function readExecution(binding: WorktreeBinding): ExecutionRecord | undefined {
	const file = executionFile(binding);
	try {
		const stat = lstatSync(file);
		if (!stat.isFile() || stat.size > 65536) throw new Error("Invalid execution record file");
		const record = JSON.parse(readFileSync(file, "utf8")) as ExecutionRecord;
		if (record.bindingId !== binding.bindingId || typeof record.requestId !== "string" || !["starting", "running", "completed", "failed", "stopped", "unknown"].includes(record.state) || !Number.isSafeInteger(record.ownerPid)) throw new Error("Invalid execution record");
		for (const key of ["materialRevision", "sourceFingerprint", "targetFingerprint"] as const) {
			if (record[key] !== undefined && (typeof record[key] !== "string" || !(key === "materialRevision" ? /^[A-Za-z0-9-]{1,80}$/ : /^[a-f0-9]{64}$/).test(record[key]))) throw new Error("Invalid execution material facts");
		}
		return record;
	} catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export function writeExecution(binding: WorktreeBinding, record: ExecutionRecord): void { atomicJson(executionFile(binding), record); }
export function activeExecution(binding: WorktreeBinding): boolean {
	const record = readExecution(binding);
	return !!record && ["starting", "running", "unknown"].includes(record.state);
}
export function worktreeSnapshot(binding: WorktreeBinding): string {
	const hash = createHash("sha256");
	let count = 0;
	const walk = (directory: string, prefix = "") => {
		for (const name of readdirSync(directory).sort()) {
			const rel = prefix ? `${prefix}/${name}` : name;
			if (rel === ".git" || rel === ".pi" || rel === "node_modules" || rel.startsWith(".trellis/.runtime")) continue;
			if (++count > 10000) throw new Error("Snapshot file limit reached");
			const path = join(directory, name), stat = lstatSync(path);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) walk(path, rel);
			else if (stat.isFile()) { hash.update(rel); hash.update(String(stat.size)); if (stat.size < 4 * 1024 * 1024) hash.update(readFileSync(path)); else hash.update(String(stat.mtimeMs)); }
		}
	};
	walk(binding.worktreePath);
	return hash.digest("hex");
}
