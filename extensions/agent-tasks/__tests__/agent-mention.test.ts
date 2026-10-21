import assert from "node:assert/strict";
import { it } from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { AgentManager } from "../src/agent-manager.ts";
import { createMentionProvider } from "../src/ui/agent-mention.ts";
import { matchesResumeKey, resumeKey } from "../src/mention.ts";

void it("explicit agent autocomplete displays and inserts compact hyphenated resume keys", async () => {
  const delegated = { items: [{ value: "@README.md", label: "README.md" }], prefix: "@" };
  const current = {
    async getSuggestions() { return delegated; },
    applyCompletion() { throw new Error("not needed by this test"); },
  } as unknown as AutocompleteProvider;
  const manager = {
    listAgents: () => [{
      id: "agent_general_purpose_0_12345678",
      type: "general-purpose",
      parentAgentId: undefined,
      registryIndex: 0,
      status: "interrupted",
    }],
  } as unknown as AgentManager;
  const provider = createMentionProvider(current, () => ({
    manager,
    types: [{ name: "general-purpose", description: "General work" }],
  }), () => true);

  const resume = "@agent:resume:";
  const resumeSuggestions = await provider.getSuggestions([resume], 0, resume.length, {} as never);
  assert.deepEqual(resumeSuggestions, {
    prefix: resume,
    items: [{
      value: "@agent:resume:general-purpose-0 ",
      label: "general-purpose-0",
      description: "resume · interrupted",
    }, ...delegated.items],
  });

  assert.equal(resumeKey("general-purpose", 0), "general-purpose-0");
  assert.equal(resumeKey("General purpose!", 2), "general-purpose-2");
  assert.equal(matchesResumeKey("general-purpose", 0, "GENERAL-PURPOSE-0"), true);
  assert.equal(matchesResumeKey("general-purpose", 0, "general_purpose_0"), false);

  const create = "@agent:create:g";
  const createSuggestions = await provider.getSuggestions([create], 0, create.length, {} as never);
  assert.deepEqual(createSuggestions, {
    prefix: create,
    items: [{
      value: "@agent:create:general-purpose ",
      label: "@agent:create:general-purpose",
      description: "create · General work",
    }, ...delegated.items],
  });

  assert.equal(await provider.getSuggestions(["@README"], 0, "@README".length, {} as never), delegated);
});
