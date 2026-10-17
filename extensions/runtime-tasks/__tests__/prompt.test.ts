import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { managementTool } from "../tools.ts";
import { registerBashTool } from "../../process-tasks/tools/bash.ts";
import { registerMonitorTool } from "../../process-tasks/tools/monitor.ts";
import { BackgroundRegistry } from "../../process-tasks/state.ts";
import { DEFAULTS } from "../../process-tasks/config.ts";
const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { buildSystemPrompt } = await import(pathToFileURL(join(dirname(entry), "core/system-prompt.js")).href) as {
  buildSystemPrompt(options: { cwd: string; selectedTools: string[]; hiddenTools?: string[]; toolSnippets: Record<string, string>; toolGuidelines: Record<string, string[]> }): string;
};
test("registered split tools and monitor contribute one group each through actual SDK prompt assembly", () => {
  for (const cadence of [0, 3500]) {
    const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = [];
    const registry = new BackgroundRegistry({ ...DEFAULTS, monitorFlushMs: cadence });
    const pi = { registerTool: (def: Parameters<ExtensionAPI["registerTool"]>[0]) => { tools.push(def); } } as unknown as ExtensionAPI;
    registerMonitorTool(pi, registry);
    registerBashTool(pi, registry, {} as Parameters<typeof registerBashTool>[2]);
    tools.push(managementTool("process", []).tool, managementTool("agent", []).tool);
    const toolSnippets = Object.fromEntries(tools.map(t => [t.name, t.promptSnippet!]));
    const toolGuidelines = Object.fromEntries(tools.map(t => [t.name, t.promptGuidelines!]));
    const selectedTools = tools.map(t => t.name);
    const prompt = buildSystemPrompt({ cwd: process.cwd(), selectedTools: [...selectedTools, "peer"], toolSnippets: { ...toolSnippets, peer: "Peer index" }, toolGuidelines: { ...toolGuidelines, peer: ["Peer guideline"] } });
    for (const heading of ["Process_manage usage:", "Agent_manage usage:", "Monitor usage:", "Bash usage:"]) assert.equal(prompt.split(heading).length - 1, 1);
    assert.match(prompt, new RegExp(`${cadence}ms cadence`));
    assert.match(prompt, /process_manage manages both/); assert.match(prompt, /execution_id/);
    assert.match(prompt, /set task_type to null in these targeted calls/);
    assert.doesNotMatch(prompt, /do not include task_type in these targeted calls/);
    const processRules = toolGuidelines.process_manage!.join("\n");
    assert.match(processRules, /Provide every exposed field/);
    assert.doesNotMatch(processRules, /\? means optional|Omit fields|Do not pass fields/);
    for (const example of processRules.matchAll(/: (\{"action"[^\n]+\})/g)) {
      const args = JSON.parse(example[1]!);
      assert.deepEqual(Object.keys(args), Object.keys(JSON.parse(JSON.stringify(tools.find(t => t.name === "process_manage")!.parameters)).properties));
    }
    assert.match(prompt, /Peer index/); assert.match(prompt, /Peer guideline/);
    assert.doesNotMatch(prompt, /task_manage/);
    const hidden = buildSystemPrompt({ cwd: process.cwd(), selectedTools, hiddenTools: selectedTools, toolSnippets, toolGuidelines });
    assert.doesNotMatch(hidden, /Monitor usage:|Agent_manage usage:|Process_manage usage:|Bash usage:/);
  }
});
