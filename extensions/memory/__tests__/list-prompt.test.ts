import assert from "node:assert/strict";
import { it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { registerMemoryTools } from "../tools.ts";

// Test-only access to the real installed assembler, never a product import.
const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { buildSystemPrompt } = await import(pathToFileURL(join(dirname(sdkEntry), "core/system-prompt.js")).href) as {
  buildSystemPrompt(options: { cwd: string; selectedTools: string[]; hiddenTools?: string[];
    toolSnippets: Record<string, string>; toolGuidelines: Record<string, string[]> }): string;
};

it("registered memory_list has one explicit usage group in actual SDK assembly, preserving peers and hidden/disabled omission", () => {
  const tools = new Map<string, ToolDefinition>();
  registerMemoryTools({ registerTool(tool: ToolDefinition) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI,
    () => { throw new Error("prompt assembly must not read storage"); });
  const tool = tools.get("memory_list")!;
  assert.equal(tool.promptGuidelines!.length, 1);
  const options = { cwd: process.cwd(), selectedTools: [tool.name, "peer"],
    toolSnippets: { memory_list: tool.promptSnippet!, peer: "Peer index" },
    toolGuidelines: { memory_list: tool.promptGuidelines!, peer: ["Peer guideline"] } };
  const prompt = buildSystemPrompt(options);
  assert.match(prompt, /<tools>[\s\S]*- memory_list: List project memory metadata/);
  assert.match(prompt, /<rules>[\s\S]*- memory_list usage:\n  - Always provide query, offset and limit/);
  assert.equal(prompt.split("memory_list usage:").length - 1, 1);
  assert.match(prompt, /query="".*offset=0.*limit=20/);
  assert.match(prompt, /metadata only.*8KiB/); assert.match(prompt, /nextOffset until it is null/);
  assert.match(prompt, /Peer index/); assert.match(prompt, /Peer guideline/);
  assert.doesNotMatch(prompt, /Default 20|nullable|optional/);
  const examples = [...prompt.matchAll(/First page: (\{[^\n]+\})/g)]; assert.equal(examples.length, 1);
  for (const example of examples) {
    const args = JSON.parse(example[1]); assert.deepEqual(Object.keys(args), ["query", "offset", "limit"]);
    assert.doesNotThrow(() => validateToolArguments(tool, { type: "toolCall", id: "example", name: tool.name, arguments: args }));
  }
  const disabled = buildSystemPrompt({ ...options, selectedTools: ["peer"] });
  const hidden = buildSystemPrompt({ ...options, hiddenTools: ["memory_list"] });
  for (const omitted of [disabled, hidden]) {
    assert.doesNotMatch(omitted, /memory_list usage:|- memory_list:/);
    assert.match(omitted, /Peer index/); assert.match(omitted, /Peer guideline/);
  }
});
