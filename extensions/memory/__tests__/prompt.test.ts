import assert from "node:assert/strict";
import { it } from "node:test";
import type { TestContext } from "node:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import type { AssistantMessage, Model, ToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import memory from "../../memory.ts";
import { MemoryStore } from "../store.ts";
import { projectIdentity } from "../identity.ts";
import { setEnabled } from "../config.ts";
import { MEMORY_RULES, MEMORY_SECTION, MEMORY_STARTUP } from "../prompt.ts";
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
  const requests: { prompt: string; sections: Record<string, string | null>; messages: unknown[] }[] = [];
  const optionsSeen: NormalizedBuildSystemPromptOptions[] = [];
  const errors: unknown[] = [];
  const plan: Pick<ToolCall, "name" | "arguments">[] = [];
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("memory-fixture", { api: "openai-responses", baseUrl: "http://offline.invalid", apiKey: "offline",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 400_000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (_model, context) => {
      requests.push({ messages: structuredClone(context.messages), prompt: getCurrentSystemPrompt(context.messages), sections: { ...getCurrentSystemMessage(context.messages)?.sections } });
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const call = plan.shift(); const message = reply();
        if (call) { message.content = [{ type: "toolCall", id: `tool-${requests.length}`, ...call }]; message.stopReason = "toolUse"; }
        stream.push({ type: "done", reason: call ? "toolUse" : "stop", message }); stream.end(message);
      });
      return stream;
    },
  });
  const model = runtime.getModel("memory-fixture", "fixture") as Model<"openai-responses">;
  assert.ok(model);
  const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
  t.after(() => { for (const session of sessions) session.dispose(); });
  const sessionDir = join(root, "sessions"); fs.mkdirSync(sessionDir);
  async function create(manager = SessionManager.create(cwd, sessionDir), withTools = false) {
    const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } });
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
      extensionFactories: [seed, memory, observer, (pi) => { pi.on("session_before_compact", event => ({ compaction: { summary: "Fixture summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 1 } })); }], systemPrompt: "Offline fixture" });
    await loader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager: settings,
      modelRuntime: runtime, model, sessionManager: manager, noTools: withTools ? "builtin" : "all" });
    sessions.push(session); await session.bindExtensions({ mode: "print", onError: error => { errors.push(error); } }); return session;
  }
  let prompts = 0;
  async function run(session: Awaited<ReturnType<typeof createAgentSession>>["session"], custom = false) {
    const content = `Independent request ${++prompts}`;
    if (custom) await session.sendCustomMessage({ customType: "memory-review", content, display: false }, { triggerTurn: true });
    else await session.prompt(content);
    assert.deepEqual(errors, [], "no swallowed extension lifecycle failures");
    assert.equal(requests.length, prompts, "exactly one local model request per submitted prompt, no extraction calls");
    const last = requests.at(-1)!;
    assert.match(last.prompt, /Unrelated extension section/); assert.match(last.prompt, /Unrelated append/);
    assert.doesNotMatch(last.prompt, /Stale owned section/);
    return last;
  }
  return { agentDir, cwd, store, requests, optionsSeen, plan, create, run, sessionDir };
}
function assertOwn(request: { prompt: string; sections: Record<string, string | null> }) {
  assert.equal(Object.keys(request.sections).filter(key => key === MEMORY_SECTION).length, 1);
  assert.equal(request.prompt.split("<project_memory>").length - 1, 1);
  assert.equal(request.sections[MEMORY_SECTION]!, `<project_memory>\n${MEMORY_RULES}\n</project_memory>`);
  assert.match(request.prompt, /dated observations/);
}


// Public typed registration/lifecycle seam supplements provider tests without copying prompt algorithms.
function lifecycle(t: TestContext, append?: (manager: SessionManager, customType: string, data: unknown) => void) {
  const f = fixture(t); isolate(t, f.agentDir);
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const pi = { appendEntry(customType: string, data: unknown) { if (append) append(manager, customType, data); else manager.appendCustomEntry(customType, data); }, registerCommand() {}, registerTool() {}, on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); return () => {}; } } as unknown as ExtensionAPI;
  memory(pi);
  const manager = SessionManager.inMemory(f.project.root);
  const ctx = { cwd: f.project.root, sessionManager: manager } as unknown as ExtensionContext;
  const emit = (name: string, context = ctx, event: unknown = {}) => handlers.get(name)!(event, context);
  const options = (): NormalizedBuildSystemPromptOptions => ({ cwd: ctx.cwd, sections: { peer: "Keep peer", project_memory: "old owned" }, appendSystemPrompt: "Keep append",
    selectedTools: [], hiddenTools: [], toolSnippets: {}, toolGuidelines: {}, promptGuidelines: [], contextFiles: [], skills: [] });
  const prompt = (opts = options(), context = ctx) => {
    const returned = emit("before_agent_start", context, { type: "before_agent_start", messageType: "user", prompt: "test", systemPrompt: "", systemPromptOptions: opts } satisfies BeforeAgentStartEvent);
    const message = (returned as { message?: { content: string } } | undefined)?.message;
    return { ...opts, snapshot: message?.content };
  };
  return { ...f, ctx, manager, emit, prompt, options };
}


const text = (message: unknown): string => {
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? "").join("") : "";
};
const snapshots = (messages: unknown[]) => messages.filter(message => text(message).startsWith("# Project memory startup snapshot"));
const content = (request: { messages: unknown[] }) => request.messages.map(text).join("\n");

it("actual SDK persists one ordinary metadata snapshot; later runs and fresh file-resumed factories do not scan or broadcast", async t => {
  const h = await sdkFixture(t);
  await h.store.write({ ...input(), description: "Initial metadata", body: "BODY_ONLY_SENTINEL_ONE" });
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const session = await h.create(); assert.equal(scan.mock.callCount(), 0, "session_start does not scan");
  const first = await h.run(session); assertOwn(first);
  assert.doesNotMatch(first.prompt, /Initial metadata|BODY_ONLY/);
  assert.match(content(first), /Initial metadata/); assert.doesNotMatch(content(first), /BODY_ONLY/);
  assert.equal(snapshots(first.messages).length, 1); assert.equal(text(first.messages.at(-2)), "Independent request 1");
  assert.equal(scan.mock.callCount(), 1);
  const old = h.store.read("preference");
  await h.store.write({ ...input(), expectedRevision: old.revision, description: "Changed metadata", body: "BODY_ONLY_SENTINEL_TWO" });
  fs.writeFileSync(join(h.store.directory, "MEMORY.md"), "NOT_AN_INDEX_SECRET_BODY");
  const afterWrite = scan.mock.callCount();
  const second = await h.run(session); assertOwn(second);
  assert.equal(scan.mock.callCount(), afterWrite); assert.equal(snapshots(second.messages).length, 1);
  assert.match(content(second), /Initial metadata/); assert.doesNotMatch(content(second), /Changed metadata|BODY_ONLY|NOT_AN_INDEX/);
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages, "ordinary update preserves complete request prefix");
  const file = session.sessionManager.getSessionFile()!; assert.ok(fs.existsSync(file)); session.dispose();
  fs.writeFileSync(join(h.store.directory, "preference.md"), header({ ...h.store.read("preference").metadata, description: "Resumed fresh metadata" }) + "RESUME_BODY_SENTINEL");
  const resumed = await h.create(SessionManager.open(file, h.sessionDir));
  const third = await h.run(resumed); assertOwn(third);
  assert.equal(scan.mock.callCount(), afterWrite); assert.equal(snapshots(third.messages).length, 1);
  assert.match(content(third), /Initial metadata/); assert.doesNotMatch(content(third), /Resumed fresh metadata|RESUME_BODY/);
  const entries = resumed.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === MEMORY_STARTUP);
  assert.equal(entries.length, 1); assert.ok(entries.every(entry => entry.type === "custom_message" && !entry.display));
  assert.equal(fs.readFileSync(join(h.store.directory, "MEMORY.md"), "utf8"), "NOT_AN_INDEX_SECRET_BODY");
});

it("actual SDK empty startup keeps fixed rules across disable/re-enable and invalid config without scans", async t => {
  const h = await sdkFixture(t); const session = await h.create();
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const empty = await h.run(session); assertOwn(empty); assert.match(content(empty), /No memories yet/);
  for (const type of ["user:", "feedback:", "project:", "reference:"]) assert.ok(empty.prompt.includes(type));
  await setEnabled(h.agentDir, false);
  assertOwn(await h.run(session)); await setEnabled(h.agentDir, true); assertOwn(await h.run(session));
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":"CONFIG_SECRET_SENTINEL"}');
  const invalid = await h.run(session); assertOwn(invalid); assert.doesNotMatch(content(invalid), /CONFIG_SECRET_SENTINEL|unavailable \(config\)/);
  assert.equal(scan.mock.callCount(), 1); assert.equal(snapshots(invalid.messages).length, 1);
});

it("startup disabled creates only a non-model record; later enable, resume and custom-triggered starts never inject an index", async t => {
  const h = await sdkFixture(t); await setEnabled(h.agentDir, false);
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const session = await h.create(); const first = await h.run(session, true); assertOwn(first);
  assert.equal(snapshots(first.messages).length, 0);
  const skipped = session.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === MEMORY_STARTUP);
  assert.equal(skipped.length, 1);
  await setEnabled(h.agentDir, true);
  const second = await h.run(session, true); assertOwn(second); assert.equal(snapshots(second.messages).length, 0);
  const resumed = await h.create(SessionManager.open(session.sessionManager.getSessionFile()!, h.sessionDir));
  assert.equal(snapshots((await h.run(resumed)).messages).length, 0); assert.equal(scan.mock.callCount(), 0);
});

it("actual SDK custom-triggered startup provides once and external changes do not update it", async t => {
  const h = await sdkFixture(t); const session = await h.create();
  const first = await h.run(session, true); assertOwn(first); assert.match(content(first), /No memories yet/);
  await h.store.write({ ...input(), description: "Custom fresh metadata", body: "CUSTOM_BODY_SENTINEL" });
  const second = await h.run(session, true); assertOwn(second);
  assert.equal(snapshots(second.messages).length, 1); assert.doesNotMatch(content(second), /Custom fresh metadata|CUSTOM_BODY/);
});

it("startup scan errors are one bounded diagnostic; explicit list/read report current failures rather than cached success", async t => {
  for (const code of ["secret", "metadata", "capacity", "unavailable"]) {
    const h = await sdkFixture(t); await h.store.write(input());
    const path = join(h.store.directory, "preference.md");
    const secret = "sk-" + "Z".repeat(30);
    if (code === "secret") fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("Communication preference", secret));
    if (code === "metadata") fs.writeFileSync(path, "---\n" + "RAW_SECRET_PATH".repeat(200));
    if (code === "capacity") for (let n = 0; n < 2001; n++) fs.writeFileSync(join(h.store.directory, `unknown-${n}`), "");
    const session = await h.create(); // initialize first, then remove the directory to test scan IO failure
    if (code === "unavailable") fs.renameSync(h.store.directory, h.store.directory + "-moved");
    const first = await h.run(session); assertOwn(first);
    assert.match(content(first), new RegExp(`unavailable \\(${code}\\)`));
    assert.doesNotMatch(content(first), /Communication preference|RAW_SECRET_PATH/); assert.ok(!content(first).includes(secret));
    assert.ok(!content(first).includes(h.agentDir));
    const scan = t.mock.method(MemoryStore.prototype, "scan");
    const second = await h.run(session); assert.equal(scan.mock.callCount(), 0); assert.equal(snapshots(second.messages).length, 1);
    assert.throws(() => h.store.list(), /secret rule|frontmatter|2000|ENOENT/);
    if (code === "secret" || code === "metadata" || code === "unavailable") assert.throws(() => h.store.read("preference"));
  }
});

it("actual SDK bounded startup overflow includes no bodies and omitted entries remain discoverable", async t => {
  const h = await sdkFixture(t);
  for (let n = 0; n < 230; n++) fs.writeFileSync(join(h.store.directory, `entry-${n}.md`), header({ name: `entry-${n}`, description: "四".repeat(160), type: "reference", created: "2026-10-15T00:00:00.000Z", updated: "2026-10-15T00:00:00.000Z" }) + "UNINJECTED_BODY");
  const request = await h.run(await h.create()); assertOwn(request);
  assert.match(content(request), /Omitted \d+ memories/); assert.doesNotMatch(content(request), /UNINJECTED_BODY/);
  assert.ok(Buffer.byteLength(text(snapshots(request.messages)[0])) <= INDEX_BYTES + 256);
  assert.equal(h.store.list("entry-229").total, 1);
});

it("actual SDK compaction and inherited fork history do not resend; a branch before startup may initialize", async t => {
  const h = await sdkFixture(t); const session = await h.create();
  await h.run(session); for (let n = 0; n < 3; n++) await h.run(session);
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  await session.compact();
  const compacted = await h.run(session); assertOwn(compacted); assert.equal(scan.mock.callCount(), 0);
  assert.equal(session.sessionManager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === MEMORY_STARTUP).length, 1);
  assert.equal(snapshots(compacted.messages).length, 0, "snapshot left active model window; no automatic re-broadcast");
  const forkManager = SessionManager.open(session.sessionManager.getSessionFile()!, h.sessionDir);
  forkManager.createBranchedSession(forkManager.getLeafId()!);
  const fork = await h.create(forkManager); await h.run(fork); assert.equal(scan.mock.callCount(), 0);
  const beforeStartup = forkManager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user")!;
  await fork.navigateTree(beforeStartup.id);
  const reset = await h.run(fork); assert.equal(snapshots(reset.messages).length, 1); assert.equal(scan.mock.callCount(), 1);
});

it("actual SDK legacy mixed memory section in branch prevents duplicate startup after upgrade", async t => {
  const h = await sdkFixture(t); const manager = SessionManager.create(h.cwd, h.sessionDir);
  manager.appendMessage({ role: "system", content: "", sections: { project_memory: "# Project memory\nRead relevant bodies on demand; the index below contains metadata only.\nOLD_SNAPSHOT" }, timestamp: Date.now() });
  manager.appendMessage(reply());
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const request = await h.run(await h.create(manager)); assertOwn(request);
  assert.equal(snapshots(request.messages).length, 0); assert.equal(scan.mock.callCount(), 0);
});

it("startup failure is reported once; ordinary runs never retry initialization even after repair", async t => {
  const h = await sdkFixture(t); fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":"STARTUP_SECRET_SENTINEL"}');
  const session = await h.create(); const failed = await h.run(session); assertOwn(failed);
  assert.match(content(failed), /unavailable \(config\)/); assert.doesNotMatch(content(failed), /STARTUP_SECRET_SENTINEL/);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":true}');
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const second = await h.run(session); assertOwn(second); assert.equal(snapshots(second.messages).length, 1); assert.equal(scan.mock.callCount(), 0);
});

it("public lifecycle shutdown, changed cwd and overlapping initialization fence all late writes", async t => {
  const h = lifecycle(t); const otherCwd = join(h.root, "other"); fs.mkdirSync(otherCwd);
  const old = h.emit("session_start"); const newCtx = { ...h.ctx, cwd: otherCwd } as ExtensionContext;
  const fresh = h.emit("session_start", newCtx);
  await assert.rejects(Promise.resolve(old), /closed/); await fresh;
  assert.equal(Object.hasOwn(h.prompt().sections, MEMORY_SECTION), false, "stale cwd cannot retain an owned section");
  assert.match(h.prompt(h.options(), newCtx).snapshot!, /No memories yet/);
  const dirs = fs.readdirSync(join(h.agentDir, "memory", "projects"));
  const pendingCwd = join(h.root, "pending"); fs.mkdirSync(pendingCwd);
  const pending = h.emit("session_start", { ...h.ctx, cwd: pendingCwd } as ExtensionContext);
  h.emit("session_shutdown"); await assert.rejects(Promise.resolve(pending), /closed/);
  assert.equal(Object.hasOwn(h.prompt(h.options(), newCtx).sections, MEMORY_SECTION), false);
  assert.deepEqual(fs.readdirSync(join(h.agentDir, "memory", "projects")), dirs);
  await h.emit("session_start"); assert.equal(h.prompt().snapshot, undefined);
});

it("public-root symlink startup refusal is bounded and cannot write through canonicalized ancestors", async t => {
  const h = lifecycle(t); const alias = join(h.root, "alias"); fs.symlinkSync(h.agentDir, alias);
  process.env.PI_CODING_AGENT_DIR = alias;
  const before = fs.readdirSync(h.agentDir); await h.emit("session_start");
  const opts = h.prompt(); assert.equal(opts.sections[MEMORY_SECTION], MEMORY_RULES);
  assert.match(opts.snapshot!, /unavailable \(path\)/); assert.ok(!opts.snapshot!.includes(alias));
  assert.deepEqual(fs.readdirSync(h.agentDir), before);
});

it("shutdown fences a late failed initialization without exposing its raw error", async t => {
  const h = lifecycle(t); const absent = { ...h.ctx, cwd: join(h.root, "does-not-exist-secret") } as ExtensionContext;
  const pending = h.emit("session_start", absent); h.emit("session_shutdown");
  await assert.rejects(Promise.resolve(pending), /closed/); assert.equal(h.prompt(h.options(), absent).snapshot, undefined);
});

it("actual SDK registered list/read return real-time external changes and errors without refreshing the startup snapshot", async t => {
  const h = await sdkFixture(t); await h.store.write({ ...input(), description: "Initial tool metadata", body: "Initial body" });
  const session = await h.create(undefined, true); const first = await h.run(session); assertOwn(first);
  const path = join(h.store.directory, "preference.md");
  fs.writeFileSync(path, header({ ...h.store.read("preference").metadata, description: "Externally changed metadata" }) + "CURRENT_EXTERNAL_BODY");
  h.plan.push({ name: "memory_list", arguments: { query: "", offset: 0, limit: 20 } }); await session.prompt("List now");
  assert.equal(h.requests.length, 3);
  const listed = h.requests.at(-1)!; assertOwn(listed);
  assert.equal(snapshots(listed.messages).length, 1);
  assert.match(text(snapshots(listed.messages)[0]), /Initial tool metadata/);
  const listResult = listed.messages.findLast(message => (message as { role: string }).role === "toolResult")!;
  assert.match(text(listResult), /Externally changed metadata/); assert.doesNotMatch(text(listResult), /CURRENT_EXTERNAL_BODY/);
  h.plan.push({ name: "memory_read", arguments: { name: "preference" } }); await session.prompt("Read now");
  assert.equal(h.requests.length, 5); const readResult = h.requests.at(-1)!.messages.findLast(message => (message as { role: string }).role === "toolResult")!;
  assert.match(text(readResult), /CURRENT_EXTERNAL_BODY/); assert.match(text(readResult), /"revision":"[a-f0-9]{64}"/);
  fs.writeFileSync(path, "RAW_UNTRUSTED_BROKEN_METADATA");
  h.plan.push({ name: "memory_list", arguments: { query: "", offset: 0, limit: 20 } }); await session.prompt("List broken storage");
  const failure = h.requests.at(-1)!.messages.findLast(message => (message as { role: string }).role === "toolResult") as { isError: boolean };
  assert.equal(failure.isError, true); assert.doesNotMatch(text(failure), /Initial tool metadata|RAW_UNTRUSTED/);
  assert.equal(h.requests.length, 7); assert.equal(snapshots(h.requests.at(-1)!.messages).length, 1);
});

it("returned but unpersisted startup drafts retry; only a confirmed current-branch message stops scanning", async t => {
  const h = lifecycle(t); await h.emit("session_start");
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  const first = h.prompt(); const second = h.prompt();
  assert.equal(scan.mock.callCount(), 2); assert.equal(first.snapshot, second.snapshot);
  const opts = h.options();
  const returned = h.emit("before_agent_start", h.ctx, { type: "before_agent_start", messageType: "user", prompt: "test", systemPrompt: "", systemPromptOptions: opts }) as { message: { customType: string; content: string; display: boolean; details: unknown } };
  const message = returned.message;
  h.manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
  assert.equal(h.prompt().snapshot, undefined); assert.equal(scan.mock.callCount(), 3);
});

it("actual SDK isolated reload keeps startup history and never rereads the index", async t => {
  const h = await sdkFixture(t); const session = await h.create(); const first = await h.run(session);
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  await session.reload(); const next = await h.run(session); assertOwn(next);
  assert.equal(scan.mock.callCount(), 0); assert.equal(snapshots(next.messages).length, 1);
  assert.deepEqual(snapshots(next.messages), snapshots(first.messages));
});

it("failed non-atomic disabled marker append remains unconfirmed in this activation and retries without empty model messages", async t => {
  let fail = true;
  const h = lifecycle(t, (manager, customType, data) => {
    manager.appendCustomEntry(customType, data);
    if (fail) throw new Error("FAKE_HOST_FAILED_AFTER_MEMORY_APPEND");
  });
  await setEnabled(h.agentDir, false); await h.emit("session_start");
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  assert.equal(h.prompt().snapshot, undefined); assert.equal(h.manager.getBranch().length, 1);
  fail = false;
  assert.equal(h.prompt().snapshot, undefined); assert.equal(h.manager.getBranch().length, 2, "retry ignores unconfirmed failed entry but preserves raw history");
  assert.equal(h.prompt().snapshot, undefined); assert.equal(h.manager.getBranch().length, 2);
  await setEnabled(h.agentDir, true);
  assert.equal(h.prompt().snapshot, undefined); assert.equal(scan.mock.callCount(), 0);
});

it("actual SDK explicit access repairs unavailable initialization, without a second startup diagnostic or snapshot", async t => {
  const h = await sdkFixture(t);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":"STARTUP_SECRET_SENTINEL"}');
  const session = await h.create(undefined, true); const failed = await h.run(session); assertOwn(failed);
  assert.match(content(failed), /unavailable \(config\)/);
  fs.writeFileSync(join(h.agentDir, "memory.json"), '{"enabled":true}');
  const scan = t.mock.method(MemoryStore.prototype, "scan");
  h.plan.push({ name: "memory_list", arguments: { query: "", offset: 0, limit: 20 } });
  await session.prompt("Retry list explicitly");
  assert.equal(h.requests.length, 3); assert.equal(scan.mock.callCount(), 1);
  const request = h.requests.at(-1)!; assertOwn(request);
  const result = request.messages.findLast(message => (message as { role: string }).role === "toolResult") as { isError: boolean };
  assert.equal(result.isError, false); assert.match(text(result), /"entries":\[\]/);
  assert.equal(snapshots(request.messages).length, 1); assert.match(text(snapshots(request.messages)[0]), /unavailable \(config\)/);
});
