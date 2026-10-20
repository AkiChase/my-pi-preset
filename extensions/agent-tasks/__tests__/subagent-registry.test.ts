import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import {
  allocatePersistentAgent,
  loadSubagentRegistry,
  markRunningAgentsInterrupted,
  registryLocatorForRootSession,
  updatePersistentAgent,
} from "../src/subagent-registry.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "agent-registry-"));
  const rootSessionFile = join(dir, "root.jsonl");
  writeFileSync(rootSessionFile, "{}\n");
  const locator = registryLocatorForRootSession(rootSessionFile);
  return { dir, locator, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

void it("persists readable IDs with parent-local indexes", () => {
  const test = fixture();
  try {
    const values = ["aaaaaaaa-0000-0000-0000-000000000000", "aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000"];
    const uuid = () => values.shift() ?? "cccccccc-0000-0000-0000-000000000000";
    const top = allocatePersistentAgent(test.locator, "Explore Agent", undefined, { uuid, now: () => 1 });
    const sibling = allocatePersistentAgent(test.locator, "Plan", undefined, { uuid, now: () => 2 });
    const child = allocatePersistentAgent(test.locator, "Explore", top.agentId, { uuid, now: () => 3 });

    assert.equal(top.agentId, "agent_explore_agent_0_aaaaaaaa");
    assert.equal(sibling.agentId, "agent_plan_1_aaaaaaaa");
    assert.match(child.agentId, /^agent_explore_0_bbbbbbbb$/);
    assert.equal(child.parentAgentId, top.agentId);

    const registry = loadSubagentRegistry(test.locator)!;
    assert.equal(registry.nextIndexByParent.root, 2);
    assert.equal(registry.nextIndexByParent[top.agentId], 1);
    assert.deepEqual(Object.keys(registry.agents).sort(), [top.agentId, sibling.agentId, child.agentId].sort());
    assert.doesNotThrow(() => JSON.parse(readFileSync(test.locator.registryFile, "utf8")));
  } finally { test.dispose(); }
});

void it("retries UUID suffix collisions", () => {
  const test = fixture();
  try {
    writeFileSync(test.locator.registryFile, JSON.stringify({
      version: 1,
      rootSessionFile: test.locator.rootSessionFile,
      agents: {
        agent_explore_1_aaaaaaaa: {
          agentId: "agent_explore_1_aaaaaaaa", type: "Explore", index: 1, parentAgentId: null,
          status: "completed", createdAt: 1, updatedAt: 1,
        },
      },
      nextIndexByParent: { root: 1 },
    }));
    const ids = ["aaaaaaaa-0000-0000-0000-000000000000", "bbbbbbbb-0000-0000-0000-000000000000"];
    const entry = allocatePersistentAgent(test.locator, "Explore", undefined, { uuid: () => ids.shift()! });
    assert.equal(entry.agentId, "agent_explore_1_bbbbbbbb");
  } finally { test.dispose(); }
});

void it("records session files and marks only active entries interrupted on shutdown", () => {
  const test = fixture();
  try {
    const active = allocatePersistentAgent(test.locator, "Explore", undefined, { uuid: () => "11111111-0000-0000-0000-000000000000" });
    const done = allocatePersistentAgent(test.locator, "Plan", undefined, { uuid: () => "22222222-0000-0000-0000-000000000000" });
    updatePersistentAgent(test.locator, active.agentId, { status: "running", sessionFile: join(test.dir, "child.jsonl") });
    updatePersistentAgent(test.locator, done.agentId, { status: "completed" });

    assert.equal(markRunningAgentsInterrupted(test.locator), 1);
    const registry = loadSubagentRegistry(test.locator)!;
    assert.deepEqual(registry.agents[active.agentId], {
      ...registry.agents[active.agentId],
      status: "interrupted",
      interruptionReason: "pi_exit",
      sessionFile: join(test.dir, "child.jsonl"),
    });
    assert.equal(registry.agents[done.agentId]?.status, "completed");
  } finally { test.dispose(); }
});

void it("rejects invalid persisted status, interruption, path, and counter values", () => {
  const test = fixture();
  try {
    const writeRegistry = (entry: Record<string, unknown>, next = 1) => writeFileSync(test.locator.registryFile, JSON.stringify({
      version: 1,
      rootSessionFile: test.locator.rootSessionFile,
      agents: { agent_explore_0_aaaaaaaa: entry },
      nextIndexByParent: { root: next },
    }));
    const valid = {
      agentId: "agent_explore_0_aaaaaaaa", type: "Explore", index: 0, parentAgentId: null,
      status: "completed", createdAt: 1, updatedAt: 1,
    };

    writeRegistry({ ...valid, status: "unknown" });
    assert.throws(() => loadSubagentRegistry(test.locator), /Invalid subagent registry entry/);
    writeRegistry({ ...valid, interruptionReason: "pi_exit" });
    assert.throws(() => loadSubagentRegistry(test.locator), /Invalid subagent registry entry/);
    writeRegistry({ ...valid, sessionFile: "relative-child.jsonl" });
    assert.throws(() => loadSubagentRegistry(test.locator), /Invalid subagent registry entry/);
    writeFileSync(test.locator.registryFile, JSON.stringify({
      version: 1,
      rootSessionFile: test.locator.rootSessionFile,
      agents: { agent_explore_0_aaaaaaaa: valid },
      nextIndexByParent: { unknown_parent: 0 },
    }));
    assert.throws(() => loadSubagentRegistry(test.locator), /Invalid subagent registry index state/);
  } finally { test.dispose(); }
});
void it("refuses a missing persistent root session", () => {
  const test = fixture();
  try {
    rmSync(test.locator.rootSessionFile);
    assert.throws(() => allocatePersistentAgent(test.locator, "Explore", undefined), /parent session JSONL/i);
  } finally { test.dispose(); }
});
