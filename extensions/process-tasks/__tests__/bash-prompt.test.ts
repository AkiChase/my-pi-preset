import { it } from "node:test";
import assert from "node:assert/strict";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Test-only introspection of the installed SDK assembler, not a product import.
const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { buildSystemPrompt } = await import(pathToFileURL(join(dirname(sdkEntry), "core/system-prompt.js")).href) as {
    buildSystemPrompt(options: { cwd: string; selectedTools: string[]; hiddenTools?: string[];
        toolSnippets: Record<string, string>; toolGuidelines: Record<string, string[]> }): string;
};
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBashTool } from "../tools/bash.ts";
import { BackgroundRegistry } from "../state.ts";
import { DEFAULTS } from "../config.ts";

it("registered bash replaces inherited guidance in the actual SDK system prompt", () => {
    let tool!: Parameters<ExtensionAPI["registerTool"]>[0];
    const original = createBashToolDefinition(process.cwd());
    registerBashTool({ registerTool: (def: typeof tool) => { tool = def; } } as never,
        new BackgroundRegistry({ ...DEFAULTS, timeoutMs: 5500 }),
        { ...original, promptSnippet: "OLD_BASH_INDEX", promptGuidelines: ["OLD_BASH_GUIDANCE"] });
    assert.equal(tool.promptGuidelines!.length, 1);
    const prompt = buildSystemPrompt({ cwd: process.cwd(), selectedTools: ["bash", "peer"],
        toolSnippets: { bash: tool.promptSnippet!, peer: "Peer index" },
        toolGuidelines: { bash: tool.promptGuidelines!, peer: ["Peer guideline"] } });
    assert.match(prompt, /<tools>[\s\S]*- bash: Run finite shell commands/);
    assert.match(prompt, /<rules>[\s\S]*- Bash usage:\n  -/);
    assert.equal(prompt.split("Bash usage:").length - 1, 1);
    assert.match(prompt, /default: 5\.5s/);
    assert.match(prompt, /Peer index/); assert.match(prompt, /Peer guideline/);
    assert.doesNotMatch(prompt, /OLD_BASH|notify parameter|timeout parameter/);
    const disabled = buildSystemPrompt({ cwd: process.cwd(), selectedTools: ["peer"],
        toolSnippets: { bash: tool.promptSnippet!, peer: "Peer index" }, toolGuidelines: { bash: tool.promptGuidelines! } });
    assert.doesNotMatch(disabled, /Bash usage:/);
    const hidden = buildSystemPrompt({ cwd: process.cwd(), selectedTools: ["bash"], hiddenTools: ["bash"],
        toolSnippets: { bash: tool.promptSnippet! }, toolGuidelines: { bash: tool.promptGuidelines! } });
    assert.doesNotMatch(hidden, /Bash usage:/);
});
