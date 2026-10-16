import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { managementTool } from "../tools.ts";
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
    registerMonitorTool({ registerTool: (def: Parameters<ExtensionAPI["registerTool"]>[0]) => { tools.push(def); } } as unknown as ExtensionAPI, new BackgroundRegistry({ ...DEFAULTS, monitorFlushMs: cadence }));
    tools.push(managementTool("process", []).tool, managementTool("agent", []).tool);
    const toolSnippets = Object.fromEntries(tools.map(t => [t.name, t.promptSnippet!]));
    const toolGuidelines = Object.fromEntries(tools.map(t => [t.name, t.promptGuidelines!]));
    const selectedTools = tools.map(t => t.name);
    const prompt = buildSystemPrompt({ cwd: process.cwd(), selectedTools: [...selectedTools, "peer"], toolSnippets: { ...toolSnippets, peer: "Peer index" }, toolGuidelines: { ...toolGuidelines, peer: ["Peer guideline"] } });
    for (const heading of ["Process_manage usage:", "Agent_manage usage:", "Monitor usage:"]) assert.equal(prompt.split(heading).length - 1, 1);
    assert.match(prompt, new RegExp(`${cadence}ms cadence`));
    assert.match(prompt, /process_manage manages both/); assert.match(prompt, /execution_id/);
    assert.match(prompt, /Peer index/); assert.match(prompt, /Peer guideline/);
    assert.doesNotMatch(prompt, /task_manage/);
    const hidden = buildSystemPrompt({ cwd: process.cwd(), selectedTools, hiddenTools: selectedTools, toolSnippets, toolGuidelines });
    assert.doesNotMatch(hidden, /Monitor usage:|Agent_manage usage:|Process_manage usage:/);
  }
});
