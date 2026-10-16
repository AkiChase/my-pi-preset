import assert from "node:assert/strict";
import { it } from "node:test";
import type { TestContext } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import memory from "../../memory.ts";
import { MemoryStore } from "../store.ts";
import { projectIdentity } from "../identity.ts";
import { setEnabled } from "../config.ts";
import { MEMORY_RULES, MEMORY_SECTION } from "../prompt.ts";
import { header, INDEX_BYTES } from "../policy.ts";
import { fixture, input } from "./helpers.ts";

function isolate(t: TestContext, agentDir: string) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
}
const reply = (): AssistantMessage => ({ role: "assistant", api: "openai-responses", provider: "memory-fixture", model: "fixture",
  content: [{ type: "text", text: "Local reply" }], timestamp: Date.now(), stopReason: "stop",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

async function sdkFixture(t: TestContext) {
  const { agentDir, project, root } = fixture(t);
  isolate(t, agentDir);
  const cwd = project.root;
  const store = new MemoryStore(agentDir, await projectIdentity(cwd)); store.initialize();
  const requests: { prompt: string; sections: Record<string, string | null> }[] = [];
  const optionsSeen: NormalizedBuildSystemPromptOptions[] = [];
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("memory-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 400_000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (_model, context) => {
      requests.push({ prompt: getCurrentSystemPrompt(context.messages), sections: { ...getCurrentSystemMessage(context.messages)?.sections } });
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { const message = reply(); stream.push({ type: "done", reason: "stop", message }); stream.end(message); });
      return stream;
    },
  });
  const model = runtime.getModel("memory-fixture", "fixture") as Model<"openai-responses">;
  assert.ok(model);
  const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
  t.after(() => { for (const session of sessions) session.dispose(); });
  const sessionDir = join(root, "sessions"); fs.mkdirSync(sessionDir);
  async function create(manager = SessionManager.create(cwd, sessionDir)) {
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const seed = (pi: ExtensionAPI) => pi.on("before_agent_start", event => {
      event.systemPromptOptions.sections.peer = "Unrelated extension section";
      event.systemPromptOptions.sections[MEMORY_SECTION] = "Stale owned section";
      event.systemPromptOptions.appendSystemPrompt = "Unrelated append";
      event.systemPromptOptions.promptGuidelines.push("Unrelated guideline");
      event.systemPromptOptions.toolSnippets.peer_tool = "Peer tool snippet";
      event.systemPromptOptions.toolGuidelines.peer_tool = ["Peer tool guideline"];
    });
    const observer = (pi: ExtensionAPI) => pi.on("before_agent_start", event => {
      optionsSeen.push(structuredClone(event.systemPromptOptions));
      assert.equal(event.systemPromptOptions.sections.peer, "Unrelated extension section");
      assert.equal(event.systemPromptOptions.appendSystemPrompt, "Unrelated append");
      assert.deepEqual(event.systemPromptOptions.promptGuidelines, ["Unrelated guideline"]);
      assert.equal(event.systemPromptOptions.toolSnippets.peer_tool, "Peer tool snippet");
      assert.deepEqual(event.systemPromptOptions.toolGuidelines.peer_tool, ["Peer tool guideline"]);
      assert.equal(event.systemPromptOptions.customPrompt, "Offline fixture");
      assert.equal(event.systemPromptOptions.cwd, cwd);
    });
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
      noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      extensionFactories: [seed, memory, observer], systemPrompt: "Offline fixture" });
    await loader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager: settings,
      modelRuntime: runtime, model, sessionManager: manager, noTools: "all" });
    sessions.push(session); await session.bindExtensions({ mode: "print" }); return session;
  }
  let prompts = 0;
  async function run(session: Awaited<ReturnType<typeof createAgentSession>>["session"], custom = false) {
    const content = `Independent request ${++prompts}`;
    if (custom) await session.sendCustomMessage({ customType: "memory-review", content, display: false }, { triggerTurn: true });
    else await session.prompt(content);
    assert.equal(requests.length, prompts, "exactly one local model request per submitted prompt, no extraction calls");
    const last = requests.at(-1)!;
    assert.match(last.prompt, /Unrelated extension section/); assert.match(last.prompt, /Unrelated append/);
    assert.doesNotMatch(last.prompt, /Stale owned section/);
    return last;
  }
  return { agentDir, cwd, store, requests, optionsSeen, create, run, sessionDir };
}
function assertOwn(request: { prompt: string; sections: Record<string, string | null> }) {
  assert.equal(Object.keys(request.sections).filter(key => key === MEMORY_SECTION).length, 1);
  assert.equal(request.prompt.split("<project_memory>").length - 1, 1);
  assert.match(request.sections[MEMORY_SECTION]!, /# Project memory/);
  assert.match(request.prompt, /dated observations/);
}

it("actual SDK fresh requests and file-resumed new factory inject metadata once, never bodies or extra model calls", async t => {
  const h = await sdkFixture(t);
  await h.store.write({ ...input(), description: "Initial metadata", body: "BODY_ONLY_SENTINEL_ONE" });
  const session = await h.create();
  const first = await h.run(session); assertOwn(first); assert.match(first.prompt, /Initial metadata/); assert.doesNotMatch(first.prompt, /BODY_ONLY_SENTINEL/);
  const old = h.store.read("preference");
  await h.store.write({ ...input(), expectedRevision: old.revision, description: "Changed metadata", body: "BODY_ONLY_SENTINEL_TWO" });
  fs.writeFileSync(join(h.store.directory, "MEMORY.md"), "NOT_AN_INDEX_SECRET_BODY");
  const second = await h.run(session); assertOwn(second); assert.match(second.prompt, /Changed metadata/);
  assert.doesNotMatch(second.prompt, /Initial metadata|BODY_ONLY_SENTINEL|NOT_AN_INDEX/);
  const file = session.sessionManager.getSessionFile(); assert.ok(file); assert.ok(fs.existsSync(file));
  session.dispose();
  fs.writeFileSync(join(h.store.directory, "preference.md"), header({ ...h.store.read("preference").metadata, description: "Resumed fresh metadata" }) + "RESUME_BODY_SENTINEL");
  const resumed = await h.create(SessionManager.open(file, h.sessionDir));
  const third = await h.run(resumed); assertOwn(third); assert.match(third.prompt, /Resumed fresh metadata/);
  assert.doesNotMatch(third.prompt, /Changed metadata|BODY_ONLY_SENTINEL|RESUME_BODY_SENTINEL/);
  assert.equal(h.requests.length, 3); assert.equal(h.optionsSeen.length, 3);
  assert.equal(fs.readFileSync(join(h.store.directory, "MEMORY.md"), "utf8"), "NOT_AN_INDEX_SECRET_BODY", "prompt generation has no index publication side effect");
});

it("actual SDK empty library retains rules; disabled removes current owned section and re-enable restores it", async t => {
  const h = await sdkFixture(t); const session = await h.create();
  const empty = await h.run(session); assertOwn(empty); assert.match(empty.prompt, /No memories yet/); assert.match(empty.prompt, /four types/);
  for (const type of ["user:", "feedback:", "project:", "reference:"]) assert.ok(empty.prompt.includes(type));
  assert.match(empty.prompt, /explicitly asks you to remember/); assert.match(empty.prompt, /daily logs, current tasks/);
  await setEnabled(h.agentDir, false);
  const disabled = await h.run(session);
  assert.equal(disabled.sections[MEMORY_SECTION] == null, true);
  assert.doesNotMatch(disabled.prompt, /<project_memory>|# Project memory|No memories yet/);
  assert.equal(Object.hasOwn(h.optionsSeen.at(-1)!.sections, MEMORY_SECTION), false);
  assert.match(disabled.prompt, /Unrelated extension section/);
  await setEnabled(h.agentDir, true);
  const enabled = await h.run(session); assertOwn(enabled); assert.match(enabled.prompt, /No memories yet/);
  assert.equal(h.requests.length, 3);
});

it("actual SDK custom-triggered runs refresh memory and invalid config is an error, not disabled", async t => {
  const h = await sdkFixture(t); const session = await h.create();
  const first = await h.run(session, true); assertOwn(first); assert.match(first.prompt, /No memories yet/);
  await h.store.write({ ...input(), description: "Custom run fresh metadata", body: "CUSTOM_BODY_SENTINEL" });
  const second = await h.run(session, true); assertOwn(second); assert.match(second.prompt, /Custom run fresh metadata/);
  assert.doesNotMatch(second.prompt, /CUSTOM_BODY_SENTINEL/);
  await setEnabled(h.agentDir, false);
  assert.equal((await h.run(session, true)).sections[MEMORY_SECTION] == null, true);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":false,"secret":"CONFIG_SECRET_SENTINEL"}');
  const invalid = await h.run(session, true); assertOwn(invalid);
  assert.match(invalid.prompt, /unavailable \(config\)/);
  assert.doesNotMatch(invalid.prompt, /CONFIG_SECRET_SENTINEL|Custom run fresh metadata/);
  assert.equal(h.requests.length, 4); assert.equal(h.optionsSeen.length, 4);
});

it("actual SDK errors and capacity diagnostics are bounded, do not leak paths/secrets or reuse cached metadata", async t => {
  const h = await sdkFixture(t); await h.store.write({ ...input(), description: "Previously valid metadata" });
  const session = await h.create(); assertOwn(await h.run(session));
  const path = join(h.store.directory, "preference.md"); const original = fs.readFileSync(path, "utf8");
  const secret = "sk-" + "Z".repeat(30);
  fs.writeFileSync(path, original.replace("Communication preference", secret).replace("Previously valid metadata", secret));
  const rejected = await h.run(session); assertOwn(rejected);
  assert.match(rejected.prompt, /unavailable \(secret\)/); assert.doesNotMatch(rejected.prompt, /Previously valid metadata/);
  assert.equal(rejected.prompt.includes(secret), false); assert.equal(rejected.sections[MEMORY_SECTION]!.includes(h.agentDir), false);
  fs.writeFileSync(path, "---\n" + "raw-untrusted-secret-path".repeat(200));
  const malformed = await h.run(session); assert.match(malformed.prompt, /unavailable \(metadata\)/); assert.doesNotMatch(malformed.prompt, /raw-untrusted/);
  fs.writeFileSync(path, original);
  for (let n = 0; n < 2001; n++) fs.writeFileSync(join(h.store.directory, `unknown-${n}`), "");
  const capacity = await h.run(session); assert.match(capacity.prompt, /unavailable \(capacity\)/);
  assert.doesNotMatch(capacity.prompt, /Previously valid metadata/);
  assert.ok(Buffer.byteLength(capacity.sections[MEMORY_SECTION]!) < Buffer.byteLength(MEMORY_RULES) + 512);
  const moved = `${h.store.directory}-untrusted-path`;
  fs.renameSync(h.store.directory, moved);
  try {
    const unavailable = await h.run(session);
    assert.match(unavailable.prompt, /unavailable \(unavailable\)/);
    assert.equal(unavailable.sections[MEMORY_SECTION]!.includes(moved), false);
    assert.equal(unavailable.sections[MEMORY_SECTION]!.includes(h.store.directory), false);
    assert.doesNotMatch(unavailable.prompt, /Previously valid metadata/);
  } finally { fs.renameSync(moved, h.store.directory); }
  for (let n = 0; n < 2001; n++) fs.unlinkSync(join(h.store.directory, `unknown-${n}`));
  for (let n = 0; n < 230; n++) {
    const meta = { ...h.store.read("preference").metadata, name: `entry-${String(n).padStart(3, "0")}`, description: "四".repeat(160) };
    fs.writeFileSync(join(h.store.directory, `${meta.name}.md`), header(meta) + "UNINJECTED_BODY");
  }
  const overflow = await h.run(session); assertOwn(overflow); assert.match(overflow.prompt, /Omitted \d+ memories; use memory_list/);
  assert.doesNotMatch(overflow.prompt, /UNINJECTED_BODY/);
  assert.ok(Buffer.byteLength(overflow.sections[MEMORY_SECTION]!) <= Buffer.byteLength(MEMORY_RULES) + INDEX_BYTES + 64);
  assert.equal(h.store.list("entry-229").total, 1);
});

it("actual SDK startup errors remain bounded and disabled still removes the diagnostic section", async t => {
  const h = await sdkFixture(t);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":"STARTUP_SECRET_SENTINEL"}');
  const session = await h.create();
  const failed = await h.run(session); assertOwn(failed);
  assert.match(failed.prompt, /unavailable \(config\)/); assert.doesNotMatch(failed.prompt, /STARTUP_SECRET_SENTINEL/);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":false}');
  const disabled = await h.run(session);
  assert.equal(disabled.sections[MEMORY_SECTION] == null, true); assert.doesNotMatch(disabled.prompt, /# Project memory|unavailable \(config\)/);
});

// Public typed registration/lifecycle seam supplements provider tests without copying prompt algorithms.
function lifecycle(t: TestContext) {
  const f = fixture(t); isolate(t, f.agentDir);
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const pi = { registerCommand() {}, registerTool() {}, on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); return () => {}; } } as unknown as ExtensionAPI;
  memory(pi);
  const ctx = { cwd: f.project.root } as ExtensionContext;
  const emit = (name: string, context = ctx, event: unknown = {}) => handlers.get(name)!(event, context);
  const options = (): NormalizedBuildSystemPromptOptions => ({ cwd: ctx.cwd, sections: { peer: "Keep peer", project_memory: "old owned" }, appendSystemPrompt: "Keep append",
    selectedTools: [], hiddenTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [], contextFiles: [], skills: [] });
  const prompt = (opts = options(), context = ctx) => {
    emit("before_agent_start", context, { type: "before_agent_start", messageType: "user", prompt: "test", systemPrompt: "", systemPromptOptions: opts } satisfies BeforeAgentStartEvent);
    assert.equal(opts.sections.peer, "Keep peer"); assert.equal(opts.appendSystemPrompt, "Keep append"); return opts;
  };
  return { ...f, ctx, emit, prompt, options };
}

it("startup failure remains safely diagnosable; shutdown does not revive it or inject into a changed cwd", async t => {
  const h = lifecycle(t);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":"raw-secret-invalid"}');
  await h.emit("session_start");
  let opts = h.prompt(); assert.match(opts.sections[MEMORY_SECTION], /unavailable \(config\)/); assert.doesNotMatch(opts.sections[MEMORY_SECTION], /raw-secret/);
  fs.unlinkSync(join(h.agentDir, "memory.json"));
  opts = h.prompt(); assert.match(opts.sections[MEMORY_SECTION], /unavailable \(config\)/);
  assert.equal(Object.hasOwn(h.prompt(h.options(), { cwd: join(h.root, "different") } as ExtensionContext).sections, MEMORY_SECTION), false);
  h.emit("session_shutdown"); await h.emit("session_start");
  assert.equal(Object.hasOwn(h.prompt().sections, MEMORY_SECTION), false);
});

it("public agentDir symlink startup refusal is visible without trusting canonicalized ancestors", async t => {
  const h = lifecycle(t); const alias = join(h.root, "alias"); fs.symlinkSync(h.agentDir, alias);
  process.env.PI_CODING_AGENT_DIR = alias;
  const before = fs.readdirSync(h.agentDir); await h.emit("session_start");
  const section = h.prompt().sections[MEMORY_SECTION]; assert.match(section, /unavailable \(path\)/);
  assert.equal(section.includes(alias), false); assert.deepEqual(fs.readdirSync(h.agentDir), before);
});

it("overlapping asynchronous initialization and shutdown fence old completions without prompt injection or filesystem writes", async t => {
  const h = lifecycle(t); const otherCwd = join(h.root, "other"); fs.mkdirSync(otherCwd);
  const old = h.emit("session_start");
  const newCtx = { cwd: otherCwd } as ExtensionContext;
  const fresh = h.emit("session_start", newCtx);
  await assert.rejects(Promise.resolve(old), /closed/); await fresh;
  assert.equal(Object.hasOwn(h.prompt().sections, MEMORY_SECTION), false);
  assert.match(h.prompt(h.options(), newCtx).sections[MEMORY_SECTION], /No memories yet/);
  const dirs = fs.readdirSync(join(h.agentDir, "memory", "projects"));
  const pendingCwd = join(h.root, "pending"); fs.mkdirSync(pendingCwd);
  const pending = h.emit("session_start", { cwd: pendingCwd } as ExtensionContext);
  h.emit("session_shutdown"); await assert.rejects(Promise.resolve(pending), /closed/);
  assert.equal(Object.hasOwn(h.prompt(h.options(), newCtx).sections, MEMORY_SECTION), false);
  assert.deepEqual(fs.readdirSync(join(h.agentDir, "memory", "projects")), dirs);
});

it("shutdown fences a late failed initialization without exposing its raw error", async t => {
  const h = lifecycle(t);
  const absent = { cwd: join(h.root, "does-not-exist-secret") } as ExtensionContext;
  const pending = h.emit("session_start", absent);
  h.emit("session_shutdown");
  await assert.rejects(Promise.resolve(pending), /closed/);
  assert.equal(Object.hasOwn(h.prompt(h.options(), absent).sections, MEMORY_SECTION), false);
});
