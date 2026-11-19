import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MEMORY_RULES } from "../../memory/prompt.ts";
import { hasStartup, startupDetails } from "../../shared/model-context/startup.ts";
import { buildAgentPrompt } from "../src/prompts.ts";
import { buildMemoryBlock, buildReadOnlyMemoryBlock } from "../src/memory.ts";
import { preloadSkills } from "../src/skill-loader.ts";
import { AGENT_STARTUP, AGENT_STARTUP_OWNER, INHERITED_STARTUP, agentStartupMessage, inheritAgentSystem } from "../src/system-inheritance.ts";
import type { AgentConfig } from "../src/types.ts";

const config: AgentConfig = { name: "child", description: "fixture", extensions: false, skills: false, systemPrompt: "CUSTOM_ROLE", promptMode: "append" };
const env = { isGitRepo: true, branch: "ORIGINAL_BRANCH", platform: "test-platform" };
function parent(sm: SessionManager, effective?: string): ExtensionContext {
  const current = getCurrentSystemMessage(sm.getBranch().flatMap(e => e.type === "message" && e.message.role === "system" ? [e.message] : []));
  return { cwd: "/parent", sessionManager: sm, getSystemPrompt: () => effective ?? (current ? getSystemMessageText(current) : "") } as unknown as ExtensionContext;
}

test("append/replace preserve custom rules, worktree and workflow contracts; full extras only ordinary startup", () => {
  for (const promptMode of ["append", "replace"] as const) {
    const built = buildAgentPrompt({ ...config, promptMode }, "/child", env, "PARENT_OPAQUE_RULE", {
      memoryBlock: { rules: "MEMORY_PERMISSION", startupContext: "FULL_MEMORY_BODY" },
      skillBlocks: [{ name: "full", content: "FULL_SKILL_BODY" }], worktreeBase: "/parent", workflowChild: true,
    });
    assert.equal(built.systemPrompt.includes("PARENT_OPAQUE_RULE"), promptMode === "append");
    for (const rule of ["CUSTOM_ROLE", '<active_agent name="child"/>', "MEMORY_PERMISSION", "<worktree_isolation>", "Work only inside it", "<workflow_child>"]) assert.ok(built.systemPrompt.includes(rule), rule);
    assert.doesNotMatch(built.systemPrompt, /ORIGINAL_BRANCH|test-platform|FULL_MEMORY_BODY|FULL_SKILL_BODY/);
    for (const data of ["Git repository: yes", "ORIGINAL_BRANCH", "test-platform", "FULL_MEMORY_BODY", "FULL_SKILL_BODY"]) assert.ok(built.startupContext.includes(data), data);
    const normal = buildAgentPrompt({ ...config, promptMode }, "/child", undefined);
    assert.equal(normal.startupContext, "");
    assert.doesNotMatch(normal.systemPrompt, /workflow_child/);
  }
});

test("per-agent snapshots retain original 200-line content, scopes, safety and readonly noncreation; resume does not read bodies", () => {
  const box = mkdtempSync(join(tmpdir(), "agent-prompt-memory-"));
  try {
    const readonly = buildReadOnlyMemoryBlock("reader", "project", box);
    assert.match(readonly.rules, /read-only access/);
    assert.equal(readonly.startupContext?.includes("No memory is available"), true);
    assert.throws(() => readFileSync(join(box, ".pi")), { code: "ENOENT" });
    const writable = buildMemoryBlock("writer", "local", box);
    assert.match(writable.rules, /Memory scope: local/);
    assert.match(writable.rules, /Read, Write, and Edit/);
    const dir = join(box, ".pi/agent-memory-local/writer");
    const body = Array.from({ length: 201 }, (_, i) => `line-${i + 1}`).join("\n");
    writeFileSync(join(dir, "MEMORY.md"), body);
    const first = buildMemoryBlock("writer", "local", box);
    assert.ok(first.startupContext?.includes("line-200"));
    assert.ok(!first.startupContext?.includes("line-201"));
    assert.match(first.startupContext ?? "", /truncated at 200 lines/);
    assert.ok(!first.rules.includes("line-1"));
    // A directory where the file was makes a reread fail, so absence is observable.
    rmSync(join(dir, "MEMORY.md")); mkdirSync(join(dir, "MEMORY.md"));
    assert.equal(buildMemoryBlock("writer", "local", box, false).startupContext, undefined);
    assert.throws(() => buildMemoryBlock("../unsafe", "project", box), /Unsafe agent name/);
    const linked = join(box, ".pi/agent-memory/linked");
    mkdirSync(join(box, ".pi/agent-memory"), { recursive: true }); symlinkSync(dir, linked);
    assert.throws(() => buildMemoryBlock("linked", "project", box), /symlinked/);
    assert.ok(!buildReadOnlyMemoryBlock("linked", "project", box).startupContext?.includes("line-1"));
  } finally { rmSync(box, { recursive: true, force: true }); }
});

test("explicit preload retains full bodies and original missing/unsafe/symlink behavior", () => {
  const box = mkdtempSync(join(tmpdir(), "agent-prompt-skill-"));
  const previousHome = process.env.HOME;
  process.env.HOME = box;
  try {
    mkdirSync(join(box, ".pi/skills/full"), { recursive: true });
    const body = "---\nname: full\ndescription: test\n---\n" + "全文".repeat(1000) + "\nFINAL_SKILL_LINE";
    writeFileSync(join(box, ".pi/skills/full/SKILL.md"), body);
    symlinkSync(join(box, ".pi/skills/full"), join(box, ".pi/skills/linked"));
    const loaded = preloadSkills(["full", "absent-cps-fixture", "../unsafe", "linked"], box);
    assert.equal(loaded[0]?.content, body);
    assert.match(loaded[1]?.content ?? "", /not found/); assert.match(loaded[2]?.content ?? "", /path traversal/);
    assert.match(loaded[3]?.content ?? "", /not found/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    rmSync(box, { recursive: true, force: true });
  }
});

test("known old mixed Memory moves only original index, retains fixed and opaque rules; unknown named sections are untouched", () => {
  const sm = SessionManager.inMemory("/parent");
  const legacy = MEMORY_RULES.replace("the startup snapshot contains metadata only and is not refreshed automatically", "the index below contains metadata only");
  sm.appendMessage({ role: "system", content: "OPAQUE_PREAMBLE", timestamp: 0, sections: {
    project_memory: `<project_memory>\n${legacy}\n\n<!-- pi-project-memory: derived index; refresh to rebuild -->\nMemories: 1; shown: 1.\n- [topic](topic.md) (project): ORIGINAL_INDEX\nCUSTOM_SUFFIX_RULE\n</project_memory>`,
    "session-overview": "OPAQUE_SAME_NAME", third_party: "THIRD_PARTY_RULE", skills: "NATIVE_SKILL_DIRECTORY", tools: "TOOL_RULES", project_context: "AGENTS_RULES",
  } });
  const inherited = inheritAgentSystem(parent(sm));
  for (const rule of ["OPAQUE_PREAMBLE", "CUSTOM_SUFFIX_RULE", "THIRD_PARTY_RULE", "NATIVE_SKILL_DIRECTORY", "TOOL_RULES", "AGENTS_RULES", "OPAQUE_SAME_NAME", "Use project memory"]) assert.ok(inherited.systemPrompt.includes(rule), rule);
  assert.ok(!inherited.systemPrompt.includes("ORIGINAL_INDEX"));
  assert.ok(inherited.startup[0]?.content.includes("ORIGINAL_INDEX"));
  assert.throws(() => inheritAgentSystem(parent(sm, "FORCED_DIFFERENT_AUTHORITY")), /Unsupported parent system source/);
  const opaque = SessionManager.inMemory("/parent");
  opaque.appendMessage({ role: "system", content: "base", timestamp: 0, sections: { project_memory: "CUSTOM_MEMORY_RULE", "session-overview": "CUSTOM_OVERVIEW_RULE" } });
  assert.equal(inheritAgentSystem(parent(opaque, "OPAQUE_EFFECTIVE_CONTRACT")).systemPrompt, "OPAQUE_EFFECTIVE_CONTRACT");
});

test("parent ordinary B survives append/nested/compaction without broadening conversation or transferring Trellis identity", () => {
  const sm = SessionManager.inMemory("/parent");
  sm.appendMessage({ role: "system", content: "PARENT_RULE", timestamp: 0 });
  const local = agentStartupMessage("/parent:parent", "PARENT_ENV\nPARENT_PER_AGENT_MEMORY\nPARENT_EXPLICIT_SKILL");
  sm.appendCustomMessageEntry(local.customType, local.content, local.display, local.details);
  sm.appendCustomMessageEntry("trellis-task-state", "<session-overview>\nPARENT_CLI_KEY\n</session-overview>\n<trellis-workflow>\nFULL_WORKFLOW\n</trellis-workflow>\nCURRENT_TASK_STATE", false,
    startupDetails("trellis", "same-source-different-child-key", ["overview", "workflow"]));
  sm.appendCustomMessageEntry("project-memory-startup", "ORIGINAL_PROJECT_INDEX", false, startupDetails("project_memory", "project-common-dir", ["index"]));
  sm.appendCustomMessageEntry("unrelated-third-party", "DO_NOT_INHERIT_UNSELECTED_HISTORY", false);
  const view = inheritAgentSystem(parent(sm));
  const rendered = view.startup.map(p => p.content).join("\n");
  for (const item of ["PARENT_ENV", "PARENT_PER_AGENT_MEMORY", "PARENT_EXPLICIT_SKILL", "PARENT_CLI_KEY", "FULL_WORKFLOW", "ORIGINAL_PROJECT_INDEX"]) assert.ok(rendered.includes(item), item);
  assert.doesNotMatch(rendered, /CURRENT_TASK_STATE|DO_NOT_INHERIT_UNSELECTED_HISTORY/);
  const child = SessionManager.inMemory("/child");
  child.appendMessage({ role: "system", content: view.systemPrompt, timestamp: 0 });
  for (const item of view.startup) child.appendCustomMessageEntry(item.customType, item.content, false, item.details);
  assert.equal(hasStartup(child.getBranch(), "trellis-task-state", "trellis", "same-source-different-child-key", "overview"), false);
  assert.equal(hasStartup(child.getBranch(), "project-memory-startup", "project_memory", "project-common-dir", "index"), true);
  assert.equal(hasStartup(child.getBranch(), AGENT_STARTUP, AGENT_STARTUP_OWNER, "/parent:parent", "materials"), false);
  const nested = inheritAgentSystem(parent(child));
  assert.deepEqual(nested.startup.map(p => p.content), view.startup.map(p => p.content));
  assert.equal(nested.startup.filter(p => p.customType === INHERITED_STARTUP).length, 3);
  child.appendCompaction("summary", child.getLeafId()!, 1, undefined, true);
  const compacted = inheritAgentSystem(parent(child));
  assert.equal(compacted.systemPrompt, "PARENT_RULE");
  assert.deepEqual(compacted.startup.map(p => p.content), view.startup.map(p => p.content));
});
