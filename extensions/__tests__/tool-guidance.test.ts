import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BeforeAgentStartEvent, ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import toolGuidance, { OPTIONAL_TOOL_PARAMETERS_GUIDELINE as rule } from "../tool-guidance.ts";

const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { normalizeBuildSystemPromptOptions, buildSystemPrompt } = await import(
  pathToFileURL(join(dirname(sdkEntry), "core/system-prompt.js")).href
) as {
  normalizeBuildSystemPromptOptions(input: Partial<NormalizedBuildSystemPromptOptions>): NormalizedBuildSystemPromptOptions;
  buildSystemPrompt(input: NormalizedBuildSystemPromptOptions): string;
};

function fixture(input: Partial<NormalizedBuildSystemPromptOptions> = {}) {
  let handler: ((event: BeforeAgentStartEvent) => void) | undefined;
  toolGuidance({ on(event: string, callback: typeof handler) {
    assert.equal(event, "before_agent_start");
    handler = callback;
  } } as unknown as ExtensionAPI);
  const options = normalizeBuildSystemPromptOptions({ cwd: process.cwd(), ...input });
  const run = () => handler!({ type: "before_agent_start", messageType: "user", prompt: "inspect", systemPrompt: "", systemPromptOptions: options });
  return { options, run };
}

test("single official guideline stays inside rules near tool usage and before docs", () => {
  const f = fixture({ selectedTools: ["peer"], toolSnippets: { peer: "Peer tool" }, toolGuidelines: { peer: ["Peer usage"] }, promptGuidelines: ["Unrelated rule"] });
  f.run(); f.run();
  assert.deepEqual(f.options.promptGuidelines, ["Unrelated rule", rule]);
  const prompt = buildSystemPrompt(f.options);
  assert.equal(prompt.split(rule).length - 1, 1);
  const start = prompt.indexOf("<rules>"), end = prompt.indexOf("</rules>");
  assert.ok(start < prompt.indexOf(rule) && prompt.indexOf(rule) < end);
  assert.ok(prompt.indexOf("Peer usage") < prompt.indexOf(rule));
  assert.ok(end < prompt.indexOf("<docs>"));
  assert.match(prompt, /Peer tool/);
  assert.match(prompt, /Unrelated rule/);
});

test("generic guidance does not expose hidden tool instructions or mutate loadout", () => {
  const f = fixture({ selectedTools: ["hidden", "external"], hiddenTools: ["hidden"], toolGuidelines: { hidden: ["Hidden private usage"], external: ["External usage"] } });
  const selected = [...f.options.selectedTools], hidden = [...f.options.hiddenTools];
  f.run();
  const prompt = buildSystemPrompt(f.options);
  assert.doesNotMatch(prompt, /Hidden private usage/);
  assert.match(prompt, /External usage/);
  assert.equal(prompt.split(rule).length - 1, 1);
  assert.deepEqual(f.options.selectedTools, selected);
  assert.deepEqual(f.options.hiddenTools, hidden);
});

test("custom and forced system prompts remain authoritative", () => {
  for (const input of [{ customPrompt: "Custom instructions" }, { forceSystemPrompt: "Forced instructions" }]) {
    const f = fixture(input);
    f.run();
    const prompt = buildSystemPrompt(f.options);
    assert.doesNotMatch(prompt, /Omit unused optional tool parameters/);
    assert.match(prompt, /Custom instructions|Forced instructions/);
  }
});

test("an existing exact guideline is reused without modifying other entries", () => {
  const f = fixture({ promptGuidelines: [rule, "Peer rule"] });
  f.run();
  assert.deepEqual(f.options.promptGuidelines, [rule, "Peer rule"]);
});
