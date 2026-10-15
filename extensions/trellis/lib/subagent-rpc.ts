import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { acquireBindingLock, sameIdentity } from "./bindings.ts";
import { activeExecution, processToken, readExecution, writeExecution, worktreeSnapshot, type ExecutionRecord } from "./executions.ts";
import { queryWorktree, requireMaterials, type MaterialRole } from "./worktree-query.ts";
import { canonicalPath, validateText } from "./config.ts";
import { assembleDispatchPrompt, isTrellisRole, readTaskRecord, type TrellisRole } from "./task-context.ts";
import { readSourceExecution, sourceActive, sourceExecutionFile, sourceExecutionForAgent, writeSourceExecution, type SourceExecution } from "./source-executions.ts";

import { adapterConfigured } from "./adapter-resources.ts";
import { verifyRuntime } from "./initialization/engine.ts";

export type DispatchParams =
	| { action: "dispatch"; agent: TrellisRole; prompt: string; task?: string }
	| { action: "stop"; task?: string };

/** Validate direct callers as well as host-normalized arguments before any query or RPC. */
export function validateDispatchParams(input: unknown): DispatchParams {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("trellis_dispatch input must be an object with action, agent, task and prompt fields only");
	const args = input as Record<string, unknown>;
	for (const key of Reflect.ownKeys(args)) {
		if (typeof key !== "string" || !["action", "agent", "task", "prompt"].includes(key)) throw new Error(`Unknown trellis_dispatch field ${String(key)}; remove it (allowed: action, agent, task, prompt)`);
	}
	const action = args.action === "" || args.action === undefined ? "dispatch" : args.action;
	if (action !== "dispatch" && action !== "stop") throw new Error("action must be dispatch or stop; omit it or use an empty string for dispatch");
	if (action === "stop") {
		for (const key of ["agent", "prompt"]) {
			if (Object.hasOwn(args, key)) throw new Error(`${key} is a dispatch-only field; remove it for stop (stop accepts action and task only)`);
		}
	}
	const task = args.task === "" ? undefined : args.task;
	if (task !== undefined) validateText(task, "task");
	const optionalTask = task === undefined ? {} : { task };
	if (action === "stop") return { action, ...optionalTask };
	if (!isTrellisRole(args.agent)) throw new Error("agent must be trellis-implement, trellis-check or trellis-research for dispatch");
	// Prompt is prose, not a CLI identifier: preserve newlines/tabs and spacing.
	if (typeof args.prompt !== "string" || !args.prompt.trim() || args.prompt.includes("\0")) throw new Error("prompt must be non-empty text without NUL for dispatch");
	return { action, agent: args.agent, prompt: args.prompt, ...optionalTask };
}

interface RpcReply { success: boolean; data?: { id?: string; version?: number }; error?: string }
export function rpc(pi: ExtensionAPI, method: string, payload: Record<string, unknown>, timeout = 15000): Promise<RpcReply> {
	return new Promise((done, reject) => {
		const requestId = typeof payload.requestId === "string" ? payload.requestId : randomUUID();
		const timer = setTimeout(() => { off(); reject(new Error(`Subagent ${method} reply timed out; execution may already exist`)); }, timeout);
		const off = pi.events.on(`subagents:rpc:${method}:reply:${requestId}`, (reply) => { clearTimeout(timer); off(); done(reply as RpcReply); });
		try { pi.events.emit(`subagents:rpc:${method}`, { ...payload, requestId }); } catch (error) { clearTimeout(timer); off(); reject(error); }
	});
}

export function registerDispatchTool(pi: ExtensionAPI, activeTask: (ctx: ExtensionContext) => Promise<string | undefined>): void {
	let shuttingDown = false;
	let sourceIdentity: { sourceRoot: string; repositoryIdentity: string } | undefined;
	const pending = new Map<string, { record: SourceExecution; state: "completed" | "failed" | "unknown"; error?: string }>();
	let retry: ReturnType<typeof setTimeout> | undefined;
	const publishPending = (lockHeld = false) => {
		if (!sourceIdentity || !pending.size) return;
		let release: (() => void) | undefined;
		try {
			if (!lockHeld) release = acquireBindingLock(sourceIdentity.sourceRoot);
			for (const [key, update] of pending) {
				const disk = readSourceExecution(update.record);
				if (disk?.requestId === update.record.requestId && sourceActive(disk)) writeSourceExecution({ ...disk, state: update.state, error: update.error });
				pending.delete(key);
			}
		} catch {
			// Keep evidence queued while spawn/management holds the source lock.
			if (!retry) { retry = setTimeout(() => { retry = undefined; publishPending(); }, 25); retry.unref(); }
		} finally { release?.(); }
	};
	const queueSource = (record: SourceExecution, state: "completed" | "failed" | "unknown", error?: string) => {
		const previous = pending.get(record.requestId);
		if (!previous || previous.state === "unknown") pending.set(record.requestId, { record, state, error: error?.slice(0, 4096) });
		publishPending();
	};
	const sourceOwned = new Map<string, SourceExecution>();
	const owned = new Map<string, { binding: import("./bindings.ts").WorktreeBinding; record: ExecutionRecord }>();
	const early = new Map<string, { state: "completed" | "failed"; error?: string }>();
	let diagnosticCount = 0;
	const off = ["subagents:completed", "subagents:failed"].map((event) => pi.events.on(event, (data: any) => {
		if (typeof data?.id !== "string") return;
		const state = event === "subagents:completed" ? "completed" : "failed";
		const current = owned.get(data.id);
		if (!current) {
			try {
				const record = sourceOwned.get(data.id) ?? (sourceIdentity && sourceExecutionForAgent(sourceIdentity.sourceRoot, sourceIdentity.repositoryIdentity, data.id, (message) => { if (diagnosticCount++ < 8) console.warn(message); }));
				if (record) {
					queueSource(record, state, typeof data.error === "string" ? data.error : undefined);
					sourceOwned.delete(data.id); return;
				}
			} catch { /* retain conservative lease if lookup/write fails */ }
			if (early.size >= 128) early.delete(early.keys().next().value!); early.set(data.id, { state, error: data.error }); return;
		}
		try {
			const disk = readExecution(current.binding);
			if (disk?.requestId === current.record.requestId) {
				let finalSnapshot: string | undefined;
				try { finalSnapshot = worktreeSnapshot(current.binding); } catch { /* no snapshot means verification is not current */ }
				writeExecution(current.binding, { ...current.record, state, error: data.error, finalSnapshot });
			}
		} finally { owned.delete(data.id); }
	}));
	pi.on("session_shutdown", () => {
		shuttingDown = true;
		off.forEach((unsubscribe) => unsubscribe());
		for (const { binding, record } of owned.values()) {
			try { writeExecution(binding, { ...record, state: "unknown", error: "Host session shut down; verify/stop the provider execution before reuse" }); } catch { /* runtime persists conservative prior lease */ }
		}
		for (const record of sourceOwned.values()) {
			queueSource(record, "unknown", "Host session shut down; verify provider execution before reuse");
		}
		sourceOwned.clear(); early.clear(); owned.clear();
	});
	pi.registerTool({
		name: "trellis_dispatch", label: "Trellis Dispatch",
		description: "Dispatch an approved Trellis role in the shared source directory when unbound, or its prepared managed worktree when bound. Never creates worktrees or falls back from a binding. Returns a real agent ID. Stop requests provider cancellation and retains occupancy until terminal evidence. Main coordinates shared-directory edits and phases. Use task_manage status/output/wait with the returned agent ID as task_id (optional exact run_id); successful final retrieval consumes that run. Use subagent_message with agent_id/message to steer a running agent.",
		parameters: { type: "object", properties: { action: { type: "string", enum: ["dispatch", "stop", ""], description: "dispatch (default when omitted or empty) or stop an existing execution" }, agent: { type: "string", enum: ["trellis-implement", "trellis-check", "trellis-research", ""], description: "Required non-empty Trellis role for dispatch; omit entirely for stop" }, task: { type: "string", description: "Optional approved task reference; omitted or empty uses the local/active task" }, prompt: { type: "string", description: "Required non-empty dispatch instructions; newlines/tabs are preserved, NUL is forbidden; omit entirely for stop" } }, additionalProperties: false } as unknown as Parameters<ExtensionAPI["registerTool"]>[0]["parameters"],
		executionMode: "sequential",
		async execute(_id, input, signal, _update, ctx) {
			if (shuttingDown) throw new Error("Host session shut down; reload before execution");
			const args = validateDispatchParams(input);
			const action = args.action;
			const { source, local } = await queryWorktree(ctx.cwd, undefined, false, signal);
			if (canonicalPath(process.cwd()) !== source.root || canonicalPath(ctx.cwd) !== source.root) throw new Error("Dispatch from a Pi host opened at the source project root; provider role discovery/config must not silently fall back to generic agents");
			if (!verifyRuntime(source.root)) throw new Error("Supported Pi Trellis runtime manifest required before dispatch; no child was started");
			if (!await adapterConfigured(source.root)) throw new Error("Persist the my-pi-preset package (its extensions/trellis.ts entry) in source/user settings (not only a one-shot -e path), so child sessions can load the context adapter");
			const task = args.task ?? local?.taskDir ?? await activeTask(ctx);
			if (!task) throw new Error("No approved active task");
			const { binding: initialBinding } = await queryWorktree(ctx.cwd, task, false, signal);
			const identity = { sourceRoot: source.root, repositoryIdentity: source.commonDir, taskDir: task };
			sourceIdentity = identity;
			let sourceRecord = readSourceExecution(identity);
			if (sourceRecord?.agentId) {
				const observed = early.get(sourceRecord.agentId);
				if (observed) { queueSource(sourceRecord, observed.state, typeof observed.error === "string" ? observed.error : undefined); early.delete(sourceRecord.agentId); }
				// Remember validated task identity so corrupt neighbors cannot block its terminal.
				if (sourceActive(sourceRecord)) sourceOwned.set(sourceRecord.agentId, sourceRecord);
			}
			sourceRecord = readSourceExecution(identity);
			if (action === "stop") {
				const managed = initialBinding && readExecution(initialBinding);
				if (sourceActive(sourceRecord) && managed && ["starting", "running", "unknown"].includes(managed.state)) throw new Error("Conflicting source and managed executions; inspect records");
				const execution = sourceActive(sourceRecord) ? sourceRecord : managed;
				if (!execution?.agentId) throw new Error(`No known agent id; inspect unknown startup before recovery${!initialBinding ? `: ${sourceExecutionFile(identity)}` : ""}`);
				const reply = await rpc(pi, "stop", { agentId: execution.agentId });
				if (!reply.success) throw new Error(reply.error || "Stop failed; lease retained");
				return { content: [{ type: "text", text: "Stop requested through provider. Lease retained until terminal evidence; directory/code preserved." }], details: { agentId: execution.agentId } };
			}
			if (!isTrellisRole(args.agent)) throw new Error("Unknown Trellis role");
			if (readTaskRecord(source.root, task).status !== "in_progress") throw new Error("Source task must be in_progress before dispatch");
			// Preserve custom agents; reject config that would silently defeat cwd/context rather than overwrite it.
			const definition = readFileSync(join(source.root, ".pi/agents", `${args.agent}.md`), "utf8");
			const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(definition)?.[1];
			const name = header && /^name:\s*(.+)$/m.exec(header)?.[1].trim();
			const isolation = header && /^isolation:\s*(.+)$/m.exec(header)?.[1].trim();
			const extensions = header && /^extensions:\s*(.+)$/m.exec(header)?.[1].trim();
			if (!header || name !== args.agent || isolation !== "off" || extensions !== "true" || /^\s*(?:isolated:\s*true|enabled:\s*false)\s*$/m.test(header)) throw new Error("Agent definition disables required context or conflicts with existing-directory execution; require isolation: off and extensions: true (custom file preserved)");
			const tools = header && /^tools:\s*(.+)$/m.exec(header)?.[1].split(",").map((name) => name.trim());
			const required = args.agent === "trellis-research" ? ["read", "write", "bash", "find", "grep"] : ["read", "write", "edit", "bash", "find", "grep"];
			if (!tools || required.some((name) => !tools.includes(name))) throw new Error("Custom agent tool list omits required role capabilities; file is preserved");
			const ping = await rpc(pi, "ping", {}, 3000); if (!ping.success) throw new Error(ping.error || "Subagent provider unavailable");
			const release = acquireBindingLock(source.root);
			try {
				publishPending(true);
				if (sourceActive(readSourceExecution(identity))) throw new Error(`Task has running/unknown source execution; inspect ${sourceExecutionFile(identity)} (no automatic recovery)`);
				if (!initialBinding) {
					const selectedRole = args.agent.slice("trellis-".length) as MaterialRole;
					const assertSource = async () => {
						const latest = await queryWorktree(ctx.cwd, task, false, signal, false, selectedRole);
						if (latest.binding) throw new Error("Task became bound before source dispatch; inspect and retry");
						if (readTaskRecord(source.root, task).status !== "in_progress") throw new Error("Source task must be in_progress before dispatch");
						if (sourceActive(readSourceExecution(identity))) throw new Error("Task already has running/unknown source execution");
						return requireMaterials(latest);
					};
					const facts = await assertSource();
					const prompt = assembleDispatchPrompt({ prompt: `Shared directory: Other agents may be working here. Stay within your assigned scope, preserve unrelated changes, and report overlapping edits to the main agent.\n\n${args.prompt}`, contextId: `pi-source-${randomUUID()}`, role: args.agent, materials: facts, executionRoot: source.root });
					const final = await assertSource();
					if (final.sourceFingerprint !== facts.sourceFingerprint) throw new Error("Source materials changed during prompt rendering; inspect and retry dispatch");
					signal?.throwIfAborted();
					if (shuttingDown) throw new Error("Host session shut down before spawn");
					const record: SourceExecution = { ...identity, version: 1, mode: "source", requestId: randomUUID(), role: args.agent, state: "starting", ownerPid: process.pid, ownerToken: processToken, createdAt: new Date().toISOString() };
					writeSourceExecution(record);
					try {
						const reply = await rpc(pi, "spawn", { requestId: record.requestId, type: args.agent, prompt, options: { cwd: source.root, isolation: "off" } });
						if (!reply.success || typeof reply.data?.id !== "string" || !reply.data.id) throw new Error(reply.error || "Spawn returned no valid agent id");
						record.agentId = reply.data.id;
						if (shuttingDown) throw new Error("Host session shut down during spawn; execution may already exist");
						const finished = early.get(record.agentId); early.delete(record.agentId);
						record.state = finished?.state ?? "running"; record.error = typeof finished?.error === "string" ? finished.error.slice(0, 4096) : undefined;
						writeSourceExecution(record);
						if (!finished) sourceOwned.set(record.agentId, record);
						return { content: [{ type: "text", text: `Agent ID: ${record.agentId}\nDirectory: ${source.root}\nShared source directory — no filesystem isolation. Coordinate overlapping edits.\nUse task_manage status/output/wait with this ID as task_id; subagent_message uses agent_id/message for running agents.` }], details: { agentId: record.agentId, mode: "source", cwd: source.root } };
					} catch (error) { record.state = "unknown"; record.error = String(error).slice(0, 4096); writeSourceExecution(record); throw error; }
				}
				const selectedRole = args.agent.slice("trellis-".length) as MaterialRole;
				const latest = await queryWorktree(ctx.cwd, task, true, signal, true, selectedRole);
				if (!latest.binding || !sameIdentity(latest.binding, initialBinding)) throw new Error("Binding changed before dispatch");
				const executionBinding = latest.binding;
				const facts = requireMaterials(latest);
				if (!await adapterConfigured(executionBinding.worktreePath)) throw new Error("Persist the my-pi-preset package (its extensions/trellis.ts entry) in target/user settings so the managed child can load the context adapter; no child was started");
				if (activeExecution(executionBinding)) throw new Error("Worktree already has running/unknown execution; do not dispatch concurrently");
				const targetFingerprint = worktreeSnapshot(executionBinding);
				const prompt = assembleDispatchPrompt({ prompt: `Review base: ${executionBinding.baseCommit}\n\n${args.prompt}`, contextId: executionBinding.contextId, role: args.agent, materials: facts, executionRoot: executionBinding.worktreePath });
				const final = await queryWorktree(ctx.cwd, task, true, signal, true, selectedRole);
				if (!final.binding || !sameIdentity(final.binding, executionBinding) || requireMaterials(final).sourceFingerprint !== facts.sourceFingerprint || worktreeSnapshot(executionBinding) !== targetFingerprint) throw new Error("Materials or execution checkout changed during prompt rendering; inspect and retry dispatch");
				signal?.throwIfAborted();
				if (shuttingDown) throw new Error("Host session shut down before spawn");
				const binding = executionBinding;
				const record: ExecutionRecord = { bindingId: binding.bindingId, requestId: randomUUID(), role: args.agent, state: "starting", ownerPid: process.pid, ownerToken: processToken, createdAt: new Date().toISOString(), materialRevision: facts.revision, sourceFingerprint: facts.sourceFingerprint, targetFingerprint };
				writeExecution(binding, record);
				try {
					// No call-time abort forwarded: cancellation of waiting cannot prove the detached child stopped.
					const reply = await rpc(pi, "spawn", { requestId: record.requestId, type: args.agent, prompt, options: { cwd: binding.worktreePath, isolation: "off" } });
					if (!reply.success || typeof reply.data?.id !== "string" || !reply.data.id) throw new Error(reply.error || "Spawn returned no valid agent id");
					record.agentId = reply.data.id;
					if (shuttingDown) throw new Error("Host session shut down during spawn; execution may already exist");
					const finished = early.get(record.agentId!); early.delete(record.agentId!);
					record.state = finished?.state ?? "running"; record.error = finished?.error;
					if (finished) { try { record.finalSnapshot = worktreeSnapshot(binding); } catch { /* unverified snapshot */ } }
					writeExecution(binding, record);
					if (!finished) owned.set(record.agentId!, { binding, record });
					return { content: [{ type: "text", text: `Agent ID: ${record.agentId}\nWorktree: ${binding.worktreePath}\nBinding: ${binding.bindingId}\nUse task_manage status/output/wait with this ID as task_id; subagent_message uses agent_id/message for running agents. No automatic next phase or cleanup.` }], details: { agentId: record.agentId, bindingId: binding.bindingId, mode: "managed", cwd: binding.worktreePath } };
				} catch (error) { record.state = "unknown"; record.error = String(error); writeExecution(binding, record); throw error; }
			} finally { release(); }
		},
	});
}
