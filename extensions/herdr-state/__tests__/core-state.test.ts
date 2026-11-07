import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgramStatus } from "@earendil-works/pi-tui";
import { askUserLabel } from "../../herdr-state.ts";
import { attachCoreAttention, herdrCorePresent, watchHerdrCoreState } from "../core.ts";
import { captureContext, fakePi, recordingTerminal } from "./helpers.ts";

const prompt = (id: string, header: string) => ({ toolCallId: id, questions: [{ header }] });
const blocked = (id: string, active: boolean) => ({ toolCallId: id, active });

function fixture() {
  const sink = recordingTerminal();
  const original = sink.terminal.setProgramStatus;
  const attention = attachCoreAttention(sink.terminal, askUserLabel);
  return { ...sink, original, attention };
}

describe("core questionnaire receiver", () => {
  it("waits for a real native baseline and restores the latest complete status", () => {
    const f = fixture();
    f.attention.prompt(prompt("a", "  Auth\n method  "));
    f.attention.blocked(blocked("a", true));
    assert.equal(f.calls.length, 0);
    f.terminal.setProgramStatus({ state: "working", app: "pi", message: "Session name" });
    assert.deepEqual(f.calls.at(-1), { state: "blocked", app: "pi", kind: "question", message: "Auth method" });
    f.terminal.setProgramStatus({ state: "done", app: "pi", message: "Completed" });
    f.terminal.setProgramStatus({ state: "error", app: "pi", message: "Provider failed" });
    assert.equal(f.calls.at(-1)?.state, "blocked");
    f.attention.blocked(blocked("a", false));
    assert.deepEqual(f.calls.at(-1), { state: "error", app: "pi", message: "Provider failed" });
    assert.ok(f.receivers.every((receiver) => receiver === f.terminal));
    f.attention.close();
    assert.equal(f.terminal.setProgramStatus, f.original);
  });

  it("passes through native status identity without questions and prioritizes every native Blocked kind", () => {
    const f = fixture();
    const working: ProgramStatus = { state: "working", app: "pi", message: "Compression" };
    f.terminal.setProgramStatus(working);
    assert.equal(f.calls.at(-1), working);
    f.attention.blocked(blocked("a", true));
    for (const kind of ["permission", "auth", "question"] as const) {
      const native: ProgramStatus = { state: "blocked", app: "pi", kind, message: `Native ${kind}` };
      f.terminal.setProgramStatus(native);
      assert.equal(f.calls.at(-1), native);
    }
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    assert.equal(f.calls.at(-1)?.kind, "question");
    f.attention.blocked(blocked("a", false));
    assert.deepEqual(f.calls.at(-1), { state: "working", app: "pi" });
    f.attention.close();
  });

  it("pairs overlapping named IDs idempotently and labels by the earliest active wait", () => {
    const f = fixture();
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    f.attention.prompt(prompt("b", "Second"));
    f.attention.prompt(prompt("a", "First"));
    f.attention.blocked(blocked("a", true));
    f.attention.blocked(blocked("b", true));
    const count = f.calls.length;
    f.attention.blocked(blocked("a", true));
    f.attention.blocked(blocked("missing", false));
    assert.equal(f.calls.length, count);
    assert.equal(f.calls.at(-1)?.message, "First");
    f.attention.blocked(blocked("a", false));
    assert.equal(f.calls.at(-1)?.message, "Second");
    f.attention.blocked(blocked("a", false));
    assert.equal(f.calls.at(-1)?.state, "blocked");
    f.attention.blocked(blocked("b", false));
    assert.equal(f.calls.at(-1)?.state, "working");
    f.attention.close();
  });

  it("keeps anonymous overlaps independent of named waits and consumes their label once", () => {
    const f = fixture();
    f.terminal.setProgramStatus({ state: "idle", app: "pi" });
    f.attention.prompt(prompt("a", "Named"));
    f.attention.blocked(blocked("a", true));
    f.attention.prompt({ questions: [{ header: "Anonymous" }] });
    f.attention.blocked({ active: true });
    f.attention.blocked({ active: true });
    f.attention.blocked({ active: false });
    assert.equal(f.calls.at(-1)?.message, "Named");
    f.attention.blocked(blocked("a", false));
    assert.equal(f.calls.at(-1)?.message, "Anonymous");
    f.attention.blocked({ active: false });
    assert.equal(f.calls.at(-1)?.state, "idle");
    f.attention.blocked({ active: true });
    assert.equal(f.calls.at(-1)?.message, "Waiting for input");
    f.attention.close();
    assert.equal(f.calls.at(-1)?.state, "idle");
  });

  it("does not revive a cleared native snapshot, including on shutdown", () => {
    const f = fixture();
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    f.attention.blocked(blocked("a", true));
    const clear: ProgramStatus = { state: "clear" };
    f.terminal.setProgramStatus(clear);
    assert.equal(f.calls.at(-1), clear);
    const count = f.calls.length;
    f.attention.blocked(blocked("a", false));
    f.attention.blocked(blocked("b", true));
    f.attention.close();
    assert.equal(f.calls.length, count);
    assert.equal(f.terminal.setProgramStatus, f.original);
  });

  it("ignores malformed peer payloads, supports a late ID label and never blocks on prompt alone", () => {
    const f = fixture();
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    const count = f.calls.length;
    for (const payload of [null, [], "true", { active: "true" }, { active: true, toolCallId: 1 }, { active: true, toolCallId: " " }]) {
      f.attention.prompt(payload);
      f.attention.blocked(payload);
    }
    f.attention.prompt({ questions: [null] });
    f.attention.prompt(prompt("a", "Only a prompt"));
    assert.equal(f.calls.length, count);
    f.attention.blocked(blocked("b", true));
    f.attention.prompt(prompt("b", "Late label"));
    assert.equal(f.calls.at(-1)?.message, "Late label");
    f.attention.close();
  });

  it("restores only its descriptor and retires a delegate retained by a later wrapper", () => {
    const f = fixture();
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    f.attention.blocked(blocked("a", true));
    const delegate = f.terminal.setProgramStatus;
    const later = function (status: ProgramStatus) { delegate.call(f.terminal, status); };
    f.terminal.setProgramStatus = later;
    const count = f.calls.length;
    f.attention.close();
    f.attention.close();
    assert.equal(f.terminal.setProgramStatus, later);
    assert.equal(f.calls.length, count);
    f.attention.blocked(blocked("b", true));
    const done: ProgramStatus = { state: "done", app: "pi" };
    later(done);
    assert.equal(f.calls.at(-1), done);
  });

  it("cleans up safely when publishing synchronously reenters close", () => {
    let close = () => {};
    const calls: ProgramStatus[] = [];
    const terminal = { setProgramStatus(status: ProgramStatus) {
      calls.push(status);
      if (status.state === "blocked") close();
    } };
    const original = terminal.setProgramStatus;
    const attention = attachCoreAttention(terminal, askUserLabel);
    close = () => attention.close();
    terminal.setProgramStatus({ state: "working", app: "pi" });
    attention.blocked(blocked("a", true));
    assert.deepEqual(calls.map((status) => status.state), ["working", "blocked", "working"]);
    assert.equal(terminal.setProgramStatus, original);
    attention.blocked(blocked("b", true));
    assert.equal(calls.length, 3);
  });

  it("fences rejected publications after synchronous retirement, newer native updates or later ownership", () => {
    for (const path of ["native-call", "peer-refresh"] as const) {
      for (const reentry of ["shutdown", "native-update", "later-owner"] as const) {
        const calls: ProgramStatus[] = [];
        let attention: ReturnType<typeof attachCoreAttention>;
        let first = true;
        const terminal = { setProgramStatus(status: ProgramStatus) {
          calls.push(status);
          if (status.state !== "blocked" || !first) return;
          first = false;
          if (reentry === "shutdown") attention.close();
          else if (reentry === "native-update") attention.blocked(blocked("a", false));
          else terminal.setProgramStatus = (value) => { calls.push(value); };
          terminal.setProgramStatus({ state: "error", app: "pi", message: "New owner/native value" });
          throw new Error("Sink rejected after synchronous reentry");
        } };
        attention = attachCoreAttention(terminal, askUserLabel);
        if (path === "peer-refresh") terminal.setProgramStatus({ state: "working", app: "pi" });
        attention.blocked(blocked("a", true));
        if (path === "native-call") assert.doesNotThrow(() => terminal.setProgramStatus({ state: "working", app: "pi" }));
        assert.equal(calls.at(-1)?.state, "error", `${path}/${reentry} keeps the newer value`);
        assert.ok(calls.every((status) => status !== undefined));
        attention.close();
      }
    }
  });

  it("fails open on optional publication rejection and refuses unsafe descriptors", () => {
    const calls: ProgramStatus[] = [];
    const terminal = { setProgramStatus(status: ProgramStatus) {
      if (status.state === "blocked") throw new Error("optional sink failure");
      calls.push(status);
    } };
    const attention = attachCoreAttention(terminal, askUserLabel);
    attention.blocked(blocked("a", true));
    assert.doesNotThrow(() => terminal.setProgramStatus({ state: "working", app: "pi" }));
    assert.equal(calls.at(-1)?.state, "working");
    attention.close();
    Object.defineProperty(terminal, "setProgramStatus", { configurable: false });
    assert.throws(() => attachCoreAttention(terminal, askUserLabel), /cannot safely shadow/);
  });
});

describe("core activation ownership", () => {
  it("captures without a mounted interaction and releases subscriptions on shutdown", async () => {
    const fake = fakePi();
    const sink = recordingTerminal();
    const original = sink.terminal.setProgramStatus;
    const capture = captureContext(sink.terminal);
    watchHerdrCoreState(fake.pi, askUserLabel);
    assert.equal(fake.subscribers(), 0);
    await fake.fire("session_start", capture.context);
    assert.equal(capture.captures(), 1);
    assert.equal(capture.completions(), 1);
    assert.equal(fake.subscribers(), 2);
    sink.terminal.setProgramStatus({ state: "working", app: "pi" });
    fake.emit("rpiv:ask-user:prompt", prompt("a", "Auth"));
    fake.emit("rpiv:ask-user:blocked", blocked("a", true));
    assert.equal(sink.calls.at(-1)?.message, "Auth");
    await fake.fire("session_shutdown", capture.context);
    assert.equal(sink.calls.at(-1)?.state, "working");
    assert.equal(sink.terminal.setProgramStatus, original);
    assert.equal(fake.subscribers(), 0);
    assert.equal(fake.registrations(), 0);
    const count = sink.calls.length;
    fake.emit("rpiv:ask-user:blocked", blocked("a", true));
    await fake.fire("session_start", capture.context);
    assert.equal(sink.calls.length, count);
  });

  it("is quiet outside TUI and after failed capture/descriptor preflight", async () => {
    for (const mode of ["rpc", "json", "print"] as const) {
      const fake = fakePi();
      const sink = recordingTerminal();
      const capture = captureContext(sink.terminal, { mode });
      watchHerdrCoreState(fake.pi, askUserLabel);
      await fake.fire("session_start", capture.context);
      assert.equal(capture.captures(), 0);
      assert.equal(fake.subscribers(), 0);
      await fake.fire("session_shutdown", capture.context);
    }
    for (const fail of [true, false]) {
      const fake = fakePi();
      const sink = recordingTerminal();
      if (!fail) Object.defineProperty(sink.terminal, "setProgramStatus", { configurable: false });
      const original = sink.terminal.setProgramStatus;
      const capture = captureContext(sink.terminal, { fail });
      watchHerdrCoreState(fake.pi, askUserLabel);
      await assert.doesNotReject(() => fake.fire("session_start", capture.context));
      assert.equal(fake.subscribers(), 0);
      assert.equal(sink.terminal.setProgramStatus, original);
      await fake.fire("session_shutdown", capture.context);
    }
  });

  it("does not install a late capture after shutdown", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fake = fakePi();
    const sink = recordingTerminal();
    const original = sink.terminal.setProgramStatus;
    const capture = captureContext(sink.terminal, { gate });
    watchHerdrCoreState(fake.pi, askUserLabel);
    const starting = fake.fire("session_start", capture.context);
    await fake.fire("session_shutdown", capture.context);
    release();
    await starting;
    assert.equal(sink.terminal.setProgramStatus, original);
    assert.equal(fake.subscribers(), 0);
  });

  it("rolls back partial subscriptions and synchronous setup shutdown", async () => {
    for (const failure of ["throw", "shutdown"] as const) {
      const sink = recordingTerminal();
      const original = sink.terminal.setProgramStatus;
      const capture = captureContext(sink.terminal);
      const fake = fakePi((channel) => {
        if (channel !== "rpiv:ask-user:blocked") return;
        if (failure === "throw") throw new Error("second subscription rejected");
        fake.fireSync("session_shutdown", capture.context);
      });
      watchHerdrCoreState(fake.pi, askUserLabel);
      await fake.fire("session_start", capture.context);
      assert.equal(sink.terminal.setProgramStatus, original);
      assert.equal(fake.subscribers(), 0);
      await fake.fire("session_shutdown", capture.context);
    }
  });

  it("never borrows the baseline across receiver/session activations", async () => {
    const fake = fakePi();
    const sink = recordingTerminal();
    const capture = captureContext(sink.terminal);
    watchHerdrCoreState(fake.pi, askUserLabel);
    await fake.fire("session_start", capture.context);
    sink.terminal.setProgramStatus({ state: "working", app: "pi" });
    fake.emit("rpiv:ask-user:blocked", blocked("a", true));
    await fake.fire("session_start", capture.context);
    assert.equal(fake.subscribers(), 2);
    assert.equal(sink.calls.at(-1)?.state, "working");
    const count = sink.calls.length;
    fake.emit("rpiv:ask-user:blocked", blocked("b", true));
    assert.equal(sink.calls.length, count);
    sink.terminal.setProgramStatus({ state: "done", app: "pi" });
    assert.equal(sink.calls.at(-1)?.state, "blocked");
    await fake.fire("session_shutdown", capture.context);
    assert.equal(sink.calls.at(-1)?.state, "done");
  });

  it("requires both core environment values", () => {
    assert.equal(herdrCorePresent({ HC_TERMINAL_ID: "t1", HC_TERMINAL_SOCKET: "/test.sock" }), true);
    for (const env of [{}, { HC_TERMINAL_ID: "t1" }, { HC_TERMINAL_SOCKET: "/test.sock" }]) {
      assert.equal(herdrCorePresent(env), false);
    }
  });
});
