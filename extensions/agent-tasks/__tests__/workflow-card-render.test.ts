import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderWorkflowCard, type WorkflowCardInput } from "../src/ui/workflow-card.ts";
import { themeSdk } from "../../beautify/__tests__/renderer-host.mjs";

test("workflow component folds to a summary and computes expanded trees at actual width", () => {
  const input: WorkflowCardInput = {
    task: { status: "running", workflowName: "review", description: "检查很长的改动描述".repeat(15), startTime: 0 },
    now: 42000, agentCount: 2,
    progress: [
      { type: "workflow_phase", index: 0, title: "Review" },
      { type: "workflow_agent", index: 0, phaseIndex: 0, label: "bugs", state: "done", tokens: 1200 },
      { type: "workflow_agent", index: 1, phaseIndex: 0, label: "security", state: "progress" },
      { type: "workflow_log", message: "LOG DETAIL" },
    ],
  };
  const snapshot = structuredClone(input);
  const folded = renderWorkflowCard(input, themeSdk.theme, false);
  const expanded = renderWorkflowCard(input, themeSdk.theme, true);
  for (const width of [8, 20, 40, 80, 140, 40]) {
    const summary = folded.render(width).map(plain);
    const detail = expanded.render(width).map(plain);
    assert.ok([...summary, ...detail].every(line => visibleWidth(line) <= width));
    assert.doesNotMatch(summary.join("\n"), /bugs|security|LOG DETAIL/);
    if (width >= 40) {
      assert.match(summary.join("\n"), /running.*1\/2/);
      assert.match(detail.join("\n"), /bugs/);
      assert.match(detail.join("\n"), /LOG DETAIL/);
    }
    if (width >= 20) assert.match(summary[0]!, /^subagent_workflow/);
  }
  assert.deepEqual(input, snapshot);
});
