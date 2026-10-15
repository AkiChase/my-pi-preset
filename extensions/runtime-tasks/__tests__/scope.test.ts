import { test } from "node:test";
import assert from "node:assert/strict";
import "../../agent-tasks/__tests__/source-loader.mjs";
import type { AgentSession, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
const { installExtensionToolScope } = await import("../../agent-tasks/src/agent-runner.ts");

test("live child tool scope keeps local manager, readmits only owned launch/message and honors deny/narrow/late tools", async () => {
  for (const denied of [false, true]) {
    const extension = { path: "/fixture/extensions/task-composition.ts", tools: new Map(["task_manage", "bash", "monitor", "subagent_run", "subagent_workflow", "subagent_message"].map(name => [name, {}])) };
    const all = [...extension.tools.keys()]; let active: string[] = [], turn: ((event: { type: string }) => void) | undefined;
    const agent: { beforeToolCall?: AgentSession["agent"]["beforeToolCall"] } = {};
    const session = { agent, getAllTools: () => all.map(name => ({ name })), getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names; }, subscribe: (callback: typeof turn) => { turn = callback; } } as unknown as AgentSession;
    installExtensionToolScope(session, { loader: { getExtensions: () => ({ extensions: [extension] }) } as unknown as DefaultResourceLoader,
      toolNames: ["bash"], disallowedSet: denied ? new Set(["task_manage", "subagent_message"]) : undefined, extNames: new Set(), narrowing: new Map(),
      readmitToolNames: new Set(denied ? ["subagent_run"] : ["subagent_run", "subagent_message"]),
    });
    assert.equal(active.includes("task_manage"), !denied); assert.ok(!active.includes("subagent_workflow"));
    assert.ok(active.includes("subagent_run")); assert.equal(active.includes("subagent_message"), !denied);
    extension.tools.set("late", {}); all.push("late"); turn!({ type: "turn_end" }); assert.ok(active.includes("late"));
    const call = (name: string) => agent.beforeToolCall!({ toolCall: { name } } as Parameters<NonNullable<typeof agent.beforeToolCall>>[0], undefined);
    assert.equal((await call("subagent_workflow"))?.block, true);
    assert.equal((await call("task_manage"))?.block === true, denied);
  }
});
