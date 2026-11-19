import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, normalizeContext } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, Model, TranscriptContext } from "@earendil-works/pi-ai";
import { stream as openai } from "@earendil-works/pi-ai/api/openai-responses";
import { stream as anthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import memory from "../../../memory.ts";
import { MemoryStore } from "../../../memory/store.ts";
import { projectIdentity } from "../../../memory/identity.ts";
import { input } from "../../../memory/__tests__/helpers.ts";
import { apply, plan } from "../../../trellis/lib/initialization/engine.ts";

// The Trellis producer stays fake-pi: no native Trellis host/TUI is mounted.
// Its actual returned draft is then delivered by the real SDK append boundary.
process.env.TRELLIS_PI_CONTEXT = "full";
const { default: trellis, __internals } = await import("../../../trellis/index.ts");
type Payload = { input?: unknown[]; messages?: unknown[]; system?: unknown; tools?: unknown };
const base = { id: "prefix-fixture", name: "Fixture", reasoning: false, input: ["text"] as const,
  contextWindow: 400_000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

async function serialize(context: TranscriptContext, api: "openai-responses" | "anthropic-messages", mid: boolean, caching = false): Promise<Payload> {
  let payload: Payload | undefined, fetches = 0;
  const options = { apiKey: "offline-fixture", maxRetries: 0, cacheRetention: caching ? "short" as const : "none" as const,
    fetch: async () => { fetches++; throw new Error("Unexpected HTTP request"); },
    onPayload: (value: unknown) => { payload = structuredClone(value) as Payload; throw new Error("Captured offline payload"); } };
  const common = { ...base, input: ["text"] as ("text")[], baseUrl: "https://offline.invalid/v1", compat: { supportsMidConvoSystemMessages: mid } };
  const result = api === "openai-responses"
    ? await openai({ ...common, api, provider: "openai" }, context, options).result()
    : await anthropic({ ...common, api, provider: "anthropic" }, context, options).result();
  assert.equal(fetches, 0); assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "Captured offline payload"); assert.ok(payload, "public hook sees the actual serialized API payload");
  return payload;
}
function assertPrefix(first: Payload, later: Payload) {
  assert.deepEqual(later.system, first.system); assert.deepEqual(later.tools, first.tools);
  const before = first.input ?? first.messages!, after = later.input ?? later.messages!;
  assert.deepEqual(after.slice(0, before.length), before);
}
function fakeTrellis(cwd: string) {
  const handlers = new Map<string, unknown>(), previous = process.cwd();
  const pi = { on: (name: string, handler: unknown) => { handlers.set(name, handler); return () => {}; },
    registerCommand: () => {}, registerTool: () => {}, registerMessageRenderer: () => {}, getAllTools: () => [],
    events: { on: () => () => {}, emit: () => {} }, sendMessage: () => { throw new Error("Unpersisted Trellis draft"); } };
  try { process.chdir(cwd); trellis(pi as unknown as ExtensionAPI); } finally { process.chdir(previous); }
  return {
    before: handlers.get("before_agent_start") as (event: BeforeAgentStartEvent, ctx: ExtensionContext) => Promise<BeforeAgentStartEventResult | undefined>,
    invalidate: handlers.get("tool_result") as (event: unknown, ctx: ExtensionContext) => Promise<void>,
  };
}
function fixtureBox() {
  const retained = process.env.CONTEXT_PREFIX_RUN_DIR;
  const root = realpathSync(mkdtempSync(join(retained ?? tmpdir(), "prefix-sdk-")));
  const agentDir = join(root, "agent"), cwd = join(root, "cwd"); mkdirSync(agentDir); mkdirSync(cwd);
  return { root, agentDir, cwd, cleanup: () => { if (!retained) rmSync(root, { recursive: true, force: true }); } };
}
async function mainFixture(t: TestContext, api: "openai-responses" | "anthropic-messages", mid: boolean) {
  const f = fixtureBox(), cwd = f.cwd, previous = process.env.PI_CODING_AGENT_DIR;
  const contexts: TranscriptContext[] = [], payloads: Payload[] = [], errors: unknown[] = [];
  const originalScan = MemoryStore.prototype.scan;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  t.after(() => {
    session?.dispose(); MemoryStore.prototype.scan = originalScan;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    writeFileSync(join(f.root, "capture.json"), JSON.stringify({ contexts, payloads, errors: errors.map(String) }, null, 2)); f.cleanup();
  });
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  execFileSync("git", ["init", "-b", "startup-branch"], { cwd, stdio: "ignore" });
  const initialization = plan(cwd, "PrefixDeveloper"); assert.ok(initialization); apply(initialization);
  const store = new MemoryStore(f.agentDir, await projectIdentity(cwd)); store.initialize(); await store.write(input("initial-topic"));
  const producer = fakeTrellis(cwd);
  let ctx: ExtensionContext, listNext = false, scans = 0;
  MemoryStore.prototype.scan = function (this: MemoryStore) { scans++; return originalScan.call(this); };
  const runtime = await ModelRuntime.create({ authPath: join(f.agentDir, "auth.json"), modelsPath: null,
    modelsStorePath: join(f.agentDir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider("prefix-local", { api: "openai-responses", apiKey: "offline", baseUrl: "https://offline.invalid",
    models: [{ ...base, input: ["text"], compat: { supportsMidConvoSystemMessages: mid } }],
    streamSimple: (_model, context) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          contexts.push(normalizeContext({ messages: structuredClone(context.messages) }));
          payloads.push(await serialize(context, api, mid));
          const call = listNext; listNext = false;
          const message: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "prefix-local", model: base.id,
            content: call ? [{ type: "toolCall", id: `list-${contexts.length}`, name: "memory_list", arguments: { query: "", offset: 0, limit: 20 } }] : [{ type: "text", text: "Local answer" }],
            timestamp: Date.now(), stopReason: call ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "done", reason: call ? "toolUse" : "stop", message }); stream.end(message);
        } catch (error) {
          errors.push(error);
          const message: AssistantMessage = { role: "assistant", api: "openai-responses", provider: "prefix-local", model: base.id, content: [], timestamp: Date.now(), stopReason: "error", errorMessage: String(error),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "error", reason: "error", error: message }); stream.end(message);
        }
      })();
      return stream;
    } });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd, agentDir: f.agentDir, settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true, systemPrompt: "Fixed fixture policy",
    extensionFactories: [memory, pi => { pi.on("before_agent_start", async (event, current) => { ctx = current; return producer.before(event, current); }); }] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await createAgentSession({ cwd, agentDir: f.agentDir, resourceLoader: loader, settingsManager: settings,
    modelRuntime: runtime, model: runtime.getModel("prefix-local", base.id) as Model<"openai-responses">,
    sessionManager: SessionManager.create(cwd, join(f.root, "sessions")), noTools: "builtin" }));
  await session.bindExtensions({ mode: "print", onError: error => { errors.push(error); } });
  const run = async (prompt: string) => { await session!.prompt(prompt); assert.deepEqual(errors, []); };
  await run("First request"); assert.equal(scans, 1);
  const first = contexts[0]!, serialized = payloads[0]!;
  const startup = session.sessionManager.getBranch().filter(e => e.type === "custom_message");
  assert.equal(startup.length, 2, "Memory and Trellis both return persisted ordinary startup in the same SDK event");
  assert.ok(startup.some(e => e.content.toString().includes("<trellis-workflow>")));
  assert.doesNotMatch(getCurrentSystemPrompt(first.messages), /initial-topic|Journal:|<trellis-workflow>/);
  assert.doesNotMatch(startup.map(e => e.content).join("\n"), /\n(?:Developer|Git): /);
  const frozen = JSON.stringify(startup);
  await store.write(input("external-topic", "External body")); const afterWrite = scans;
  const task = ".trellis/tasks/prefix-test", dir = join(cwd, task); mkdirSync(dir);
  writeFileSync(join(dir, "task.json"), JSON.stringify({ name: "prefix-test", status: "planning" })); writeFileSync(join(dir, "prd.md"), "Task material");
  const key = __internals.contextKey(cwd, ctx!);
  mkdirSync(join(cwd, ".trellis/.runtime/sessions"), { recursive: true });
  writeFileSync(join(cwd, ".trellis/.runtime/sessions", `${key}.json`), JSON.stringify({ current_task: task }));
  await producer.invalidate({ toolName: "bash", input: { command: "task.py active" } }, ctx!); await run("Task changed");
  assert.equal(scans, afterWrite); assertPrefix(serialized, payloads[1]!);
  assert.deepEqual(contexts[1]!.messages.slice(0, first.messages.length), first.messages);
  const later = session.sessionManager.getBranch().filter(e => e.type === "custom_message");
  assert.equal(JSON.stringify(later.slice(0, 2)), frozen); assert.equal(later.length, 3);
  assert.match(later.at(-1)!.content.toString(), /Status: planning/); assert.doesNotMatch(later.at(-1)!.content.toString(), /<session-overview>/);
  await run("Unchanged task"); assert.equal(scans, afterWrite); assert.equal(session.sessionManager.getBranch().filter(e => e.type === "custom_message").length, 3);
  listNext = true; await run("Explicit list"); assert.ok(scans > afterWrite);
  assert.ok(JSON.stringify(contexts.at(-1)!.messages).includes("external-topic"), "explicit read is fresh without broadcasting a new startup index");
  for (let i = 1; i < payloads.length; i++) {
    assertPrefix(payloads[i - 1]!, payloads[i]!);
    assert.deepEqual(contexts[i]!.messages.slice(0, contexts[i - 1]!.messages.length), contexts[i - 1]!.messages);
  }
  // Cache-enabled headers/declarations are stable too; exact historical bytes
  // above use retention:none so movable provider cache_control anchors do not
  // masquerade as preset history rewrites.
  const cached = await serialize(first, api, mid, true), cachedLater = await serialize(contexts.at(-1)!, api, mid, true);
  assert.deepEqual(cachedLater.system ?? cachedLater.input?.[0], cached.system ?? cached.input?.[0]); assert.deepEqual(cachedLater.tools, cached.tools);
}
for (const api of ["openai-responses", "anthropic-messages"] as const) for (const mid of [false, true]) {
  test(`actual SDK Memory + fake-pi Trellis serialize append-only ${api} prefix (mid-system=${mid})`, { timeout: 60_000 }, t => mainFixture(t, api, mid));
}

test("actual unshimmed child live/disk requests retain both provider wire prefixes", { timeout: 60_000 }, async t => {
  const f = fixtureBox(), home = join(f.root, "home"); mkdirSync(home); t.after(f.cleanup);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../agent-tasks/__tests__/system-inheritance-smoke.mjs", import.meta.url))],
    { cwd: f.root, env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: f.agentDir }, encoding: "utf8", timeout: 50_000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
  const requests = JSON.parse(readFileSync(join(f.root, "requests.json"), "utf8")) as Message[][];
  const children = requests.filter(r => getCurrentSystemPrompt(r).includes('<active_agent name="prefix-child"/>'));
  assert.equal(children.length, 6);
  for (const api of ["openai-responses", "anthropic-messages"] as const) for (const mid of [false, true]) {
    let previous = await serialize(normalizeContext({ messages: children[0]! }), api, mid);
    for (const child of children.slice(1, 3)) {
      const next = await serialize(normalizeContext({ messages: child }), api, mid); assertPrefix(previous, next); previous = next;
    }
  }
});
