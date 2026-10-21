import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext, UIPromptEndEvent, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";
import {
  askUserLabel,
  createHerdrReporter,
  herdrPresent,
  herdrSocketEndpoint,
  isAbsoluteSessionPath,
  promptLabel,
  sanitizeLabel,
  type HerdrRequest,
  watchHerdrState,
} from "../herdr-state.ts";

type Handler = (event: unknown, context?: ExtensionContext) => unknown;

function createFakePi() {
  const busHandlers = new Map<string, ((data: unknown) => void)[]>();
  const lifecycleHandlers = new Map<string, Handler[]>();
  const pi = {
    events: {
      on(channel: string, handler: (data: unknown) => void) {
        busHandlers.set(channel, [...(busHandlers.get(channel) ?? []), handler]);
        return () => {};
      },
    },
    on(event: string, handler: Handler) {
      lifecycleHandlers.set(event, [...(lifecycleHandlers.get(event) ?? []), handler]);
      return () => {};
    },
  };
  return {
    pi: pi as unknown as ExtensionAPI,
    fireBus(channel: string, data: unknown) {
      for (const handler of busHandlers.get(channel) ?? []) handler(data);
    },
    async fire(event: string, data: unknown, context: ExtensionContext) {
      for (const handler of lifecycleHandlers.get(event) ?? []) await handler(data, context);
    },
  };
}

function context({ mode = "tui", idle = true, file = "/tmp/pi-session.jsonl", id = "session-id" }: {
  mode?: "tui" | "rpc" | "json" | "print";
  idle?: boolean;
  file?: string | undefined;
  id?: string | undefined;
} = {}) {
  return {
    mode,
    isIdle: () => idle,
    sessionManager: { getSessionFile: () => file, getSessionId: () => id },
  } as unknown as ExtensionContext;
}

function start(kind: UIPromptStartEvent["kind"], title?: string): UIPromptStartEvent {
  return { type: "ui_prompt_start", reason: "ui_prompt", kind, ...(title ? { title } : {}) };
}

function end(kind: UIPromptEndEvent["kind"]): UIPromptEndEvent {
  return { type: "ui_prompt_end", reason: "ui_prompt", kind };
}

function reporter(sent: HerdrRequest[]) {
  const value = createHerdrReporter(
    { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_PANE_ID: "w1:p1" },
    { send: async (request) => { sent.push(request); } },
  );
  assert.ok(value);
  return value;
}

function stateRequests(sent: HerdrRequest[]) {
  return sent.filter((request) => request.method === "pane.report_agent");
}

describe("direct Herdr reporter", () => {
  it("reports an absolute session path, then working, blocked and idle state", async () => {
    const sent: HerdrRequest[] = [];
    const fake = createFakePi();
    const sink = reporter(sent);
    watchHerdrState(fake.pi, sink);

    const idle = context({ idle: true });
    await fake.fire("session_start", { reason: "startup" }, idle);
    await sink.flush();
    assert.deepEqual(sent[0]?.params, {
      pane_id: "w1:p1", source: "herdr:pi", agent: "pi", seq: sent[0]?.params.seq,
      session_start_source: "startup", agent_session_path: "/tmp/pi-session.jsonl",
    });
    assert.equal(stateRequests(sent).at(-1)?.params.state, "idle");

    const busy = context({ idle: false });
    await fake.fire("agent_start", {}, busy);
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "working");

    await fake.fire("ui_prompt_start", start("confirm", "Delete branch?"), busy);
    await sink.flush();
    assert.deepEqual(stateRequests(sent).at(-1)?.params.state, "blocked");
    assert.equal(stateRequests(sent).at(-1)?.params.message, "Delete branch?");

    await fake.fire("ui_prompt_end", end("confirm"), busy);
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "working");

    await fake.fire("agent_settled", {}, idle);
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "idle");
  });

  it("uses a questionnaire label, counts nested waits, and ignores browser-only custom prompts", async () => {
    const sent: HerdrRequest[] = [];
    const fake = createFakePi();
    const sink = reporter(sent);
    watchHerdrState(fake.pi, sink);
    const busy = context({ idle: false });
    await fake.fire("session_start", {}, busy);
    await sink.flush();

    const beforeBrowser = stateRequests(sent).length;
    await fake.fire("ui_prompt_start", start("custom", "Viewer"), busy);
    await fake.fire("ui_prompt_end", end("custom"), busy);
    await sink.flush();
    assert.equal(stateRequests(sent).length, beforeBrowser);

    fake.fireBus("rpiv:ask-user:prompt", { questions: [{ header: "Auth method" }, { header: "Library" }] });
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "blocked");
    assert.equal(stateRequests(sent).at(-1)?.params.message, "Auth method");

    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "blocked");
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    await sink.flush();
    assert.equal(stateRequests(sent).at(-1)?.params.state, "working");
  });

  it("fences late events after shutdown", async () => {
    const sent: HerdrRequest[] = [];
    const fake = createFakePi();
    const sink = reporter(sent);
    watchHerdrState(fake.pi, sink);
    const busy = context({ idle: false });
    await fake.fire("session_start", {}, busy);
    await sink.flush();
    await fake.fire("session_shutdown", {}, busy);
    const before = sent.length;
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    await fake.fire("ui_prompt_start", start("input", "Token"), busy);
    await fake.fire("agent_start", {}, busy);
    await sink.flush();
    assert.equal(sent.length, before);
  });

  it("fences an initial state report when shutdown wins its async session report", async () => {
    const sent: HerdrRequest[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sink = createHerdrReporter(
      { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_PANE_ID: "w1:p1" },
      { send: async (request) => { sent.push(request); await gate; } },
    );
    assert.ok(sink);
    const fake = createFakePi();
    watchHerdrState(fake.pi, sink);
    const busy = context({ idle: false });
    const starting = fake.fire("session_start", {}, busy);
    await Promise.resolve();
    await fake.fire("session_shutdown", {}, busy);
    release?.();
    await starting;
    await sink.flush();
    assert.deepEqual(sent.map((request) => request.method), ["pane.report_agent_session"]);
  });

  it("is silent for non-TUI sessions and fails open when transport rejects", async () => {
    const silent: HerdrRequest[] = [];
    const fake = createFakePi();
    const sink = reporter(silent);
    watchHerdrState(fake.pi, sink);
    await fake.fire("session_start", {}, context({ mode: "print" }));
    await sink.flush();
    assert.deepEqual(silent, []);

    const failed = createHerdrReporter(
      { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_PANE_ID: "w1:p1" },
      { send: async () => { throw new Error("socket unavailable"); } },
    );
    assert.ok(failed);
    const failingPi = createFakePi();
    watchHerdrState(failingPi.pi, failed);
    await assert.doesNotReject(() => failingPi.fire("session_start", {}, context()));
    await assert.doesNotReject(() => failed.flush());
  });

  it("coalesces pending state reports and falls back to a session id", async () => {
    const sent: HerdrRequest[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let holdFirstState = false;
    let firstState = true;
    const sink = createHerdrReporter(
      { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_PANE_ID: "w1:p1" },
      { send: async (request) => {
        sent.push(request);
        if (holdFirstState && request.method === "pane.report_agent" && firstState) {
          firstState = false;
          await gate;
        }
      } },
    );
    assert.ok(sink);
    sink.updateSession(context({ file: "relative.jsonl", id: "fallback-id" }));
    await sink.reportSession();
    holdFirstState = true;
    sink.publish("working");
    sink.publish("blocked", "Waiting");
    sink.publish("idle");
    release?.();
    await sink.flush();
    assert.equal(sent[0]?.params.agent_session_id, "fallback-id");
    assert.deepEqual(stateRequests(sent).map((request) => request.params.state), ["working", "idle"]);
  });
});

describe("Herdr helpers", () => {
  it("requires the complete pane environment and builds platform-safe socket paths", () => {
    assert.equal(herdrPresent({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s", HERDR_PANE_ID: "w1:p1" }), true);
    assert.equal(herdrPresent({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s" }), false);
    assert.equal(herdrSocketEndpoint({ HERDR_SOCKET_PATH: "/s" }, "darwin"), "/s");
    assert.equal(herdrSocketEndpoint({ HERDR_SOCKET_PATH: "herdr" }, "win32"), String.raw`\\.\pipe\herdr`);
  });

  it("accepts absolute Unix and Windows session paths only", () => {
    assert.equal(isAbsoluteSessionPath("/tmp/session.jsonl"), true);
    assert.equal(isAbsoluteSessionPath("C:\\sessions\\one.jsonl"), true);
    assert.equal(isAbsoluteSessionPath("sessions/one.jsonl"), false);
  });

  it("sanitizes labels and preserves questionnaire fallback behavior", () => {
    assert.equal(sanitizeLabel("  multi\n  line  "), "multi line");
    assert.equal(sanitizeLabel(""), undefined);
    assert.equal(sanitizeLabel("x".repeat(80))?.length, 60);
    assert.equal(askUserLabel({ questions: [{ question: "Which library?" }] }), "Which library?");
    assert.equal(promptLabel(start("custom", "Pick a file"), "Auth method"), "Pick a file");
  });
});
