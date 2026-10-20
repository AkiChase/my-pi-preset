import type { TaskIdentity } from "../task-ui/types.ts";

/** Per-run fence identifier; only workflows expose it as a public execution ID. */
export function executionId(identity: Pick<TaskIdentity, "taskId" | "runId">, kind: "subagent" | "workflow"): string {
  return kind === "workflow" ? identity.taskId
    : `exec_${Buffer.from(JSON.stringify([identity.taskId, identity.runId])).toString("base64url")}`;
}
export function parseExecutionId(value: unknown): TaskIdentity | undefined {
  if (typeof value !== "string") return undefined;
  if (/^wf_[a-z0-9-]{6,}$/.test(value)) return Object.freeze({ sourceId: "agent", taskId: value, runId: value });
  if (!/^exec_[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const pair: unknown = JSON.parse(Buffer.from(value.slice(5), "base64url").toString("utf8"));
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => typeof v !== "string" || !v.trim())) return undefined;
    const identity = Object.freeze({ sourceId: "agent", taskId: pair[0] as string, runId: pair[1] as string });
    return executionId(identity, "subagent") === value ? identity : undefined;
  } catch { return undefined; }
}
