import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, type TestContext } from "node:test";
import { ProcessTerminal, formatProgramStatus, type ProgramStatus, type Terminal } from "@earendil-works/pi-tui";
import { askUserLabel } from "../../herdr-state.ts";
import { attachCoreAttention } from "../core.ts";
import { recordingTerminal } from "./helpers.ts";

// Test-only introspection of the installed native owner, never a production import contract.
type NativeEvent = { type: "agent_start" } | { type: "agent_settled"; aborted: boolean } |
  { type: "compaction_start" } | { type: "compaction_end"; reason: "manual"; aborted: boolean; errorMessage?: string } |
  { type: "message_end"; message: { role: "assistant"; stopReason: "error" | "stop"; errorMessage?: string } };
interface NativeReporter {
  report(): void;
  reset(): void;
  handleEvent(event: NativeEvent): void;
  setBlocked(source: string, status: { kind: NonNullable<ProgramStatus["kind"]>; message: string } | undefined): void;
}
const sdkDist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { ProgramStatusReporter } = await import(pathToFileURL(join(sdkDist, "modes/interactive/program-status-reporter.js")).href) as {
  ProgramStatusReporter: new (terminal: () => Pick<Terminal, "setProgramStatus">, name: () => string | undefined) => NativeReporter;
};

const begin = (attention: ReturnType<typeof attachCoreAttention>, id = "question") => {
  attention.prompt({ toolCallId: id, questions: [{ header: "Auth method" }] });
  attention.blocked({ toolCallId: id, active: true });
};
const end = (attention: ReturnType<typeof attachCoreAttention>, id = "question") => attention.blocked({ toolCallId: id, active: false });

describe("actual installed native reporter", () => {
  it("observes real lifecycle, dialogs, compression, success, cancellation and final errors without recomputing them", () => {
    const sink = recordingTerminal();
    const reporter = new ProgramStatusReporter(() => sink.terminal, () => "Offline session");
    reporter.report();
    assert.deepEqual(sink.calls.at(-1), { state: "idle", app: "pi" });
    const attention = attachCoreAttention(sink.terminal, askUserLabel);
    begin(attention);
    const initial = sink.calls.length;
    reporter.report();
    reporter.reset();
    assert.equal(sink.calls.length, initial, "native dedup cannot provide an installation baseline");
    reporter.handleEvent({ type: "agent_start" });
    assert.equal(sink.calls.at(-1)?.message, "Auth method");
    reporter.handleEvent({ type: "compaction_start" });
    assert.equal(sink.calls.at(-1)?.state, "blocked");
    reporter.setBlocked("login", { kind: "auth", message: "Authenticate provider" });
    assert.deepEqual(sink.calls.at(-1), { state: "blocked", app: "pi", kind: "auth", message: "Authenticate provider" });
    reporter.setBlocked("login", undefined);
    end(attention);
    assert.deepEqual(sink.calls.at(-1), { state: "working", app: "pi", message: "Compacting context" });
    reporter.handleEvent({ type: "compaction_end", reason: "manual", aborted: false });
    begin(attention, "success");
    reporter.handleEvent({ type: "agent_settled", aborted: false });
    assert.equal(sink.calls.at(-1)?.state, "blocked");
    end(attention, "success");
    assert.deepEqual(sink.calls.at(-1), { state: "done", app: "pi", message: "Offline session" });
    reporter.handleEvent({ type: "agent_start" });
    begin(attention, "failure");
    reporter.handleEvent({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "First error\nSensitive detail" } });
    reporter.handleEvent({ type: "agent_settled", aborted: false });
    end(attention, "failure");
    assert.deepEqual(sink.calls.at(-1), { state: "error", app: "pi", message: "First error" });
    reporter.handleEvent({ type: "agent_start" });
    begin(attention, "cancel");
    reporter.handleEvent({ type: "agent_settled", aborted: true });
    end(attention, "cancel");
    assert.deepEqual(sink.calls.at(-1), { state: "idle", app: "pi" });
    attention.close();
  });

  it("arms a fresh reload receiver only on the next actual native change", () => {
    const sink = recordingTerminal();
    const reporter = new ProgramStatusReporter(() => sink.terminal, () => "Reload session");
    reporter.report();
    let attention = attachCoreAttention(sink.terminal, askUserLabel);
    reporter.handleEvent({ type: "agent_start" });
    begin(attention);
    end(attention);
    reporter.handleEvent({ type: "agent_settled", aborted: false });
    attention.close();
    reporter.reset(); // The SDK resets before binding the replacement runtime.
    attention = attachCoreAttention(sink.terminal, askUserLabel);
    const initial = sink.calls.length;
    begin(attention);
    reporter.report();
    assert.equal(sink.calls.length, initial);
    reporter.handleEvent({ type: "agent_start" });
    assert.equal(sink.calls.at(-1)?.state, "blocked");
    attention.close();
    assert.deepEqual(sink.calls.at(-1), { state: "working", app: "pi", message: "Reload session" });
  });
});

function terminalFixture(t: TestContext, override?: "0" | "1") {
  const old = process.env.PI_PROGRAM_STATUS;
  if (override === undefined) delete process.env.PI_PROGRAM_STATUS; else process.env.PI_PROGRAM_STATUS = override;
  const writes: string[] = [];
  t.mock.method(process.stdout, "write", (data: string | Uint8Array) => { writes.push(String(data)); return true; });
  t.mock.method(process.stdin, "setEncoding", () => process.stdin);
  t.mock.method(process.stdin, "resume", () => process.stdin);
  t.mock.method(process.stdin, "pause", () => process.stdin);
  if (typeof process.stdin.setRawMode === "function") t.mock.method(process.stdin, "setRawMode", () => process.stdin);
  t.mock.method(process, "kill", () => true);
  const beforeInput = process.stdin.listenerCount("data");
  const beforeResize = process.stdout.listenerCount("resize");
  const terminal = new ProcessTerminal();
  terminal.start(() => {}, () => {});
  const attention = attachCoreAttention(terminal, askUserLabel);
  t.after(() => {
    attention.close();
    terminal.stop();
    assert.equal(process.stdin.listenerCount("data"), beforeInput);
    assert.equal(process.stdout.listenerCount("resize"), beforeResize);
    if (old === undefined) delete process.env.PI_PROGRAM_STATUS; else process.env.PI_PROGRAM_STATUS = old;
    t.mock.restoreAll();
  });
  return { terminal, attention, writes, statuses: () => writes.filter((text) => text.startsWith("\x1b]7501;") && text !== "\x1b]7501;?\x1b\\") };
}

describe("actual ProcessTerminal negotiation and cache", () => {
  it("replays the merged cache on delayed support, then native cache after release and restart", (t) => {
    const f = terminalFixture(t);
    f.terminal.setProgramStatus({ state: "working", app: "pi", message: "Session" });
    begin(f.attention);
    assert.equal(f.statuses().length, 0);
    process.stdin.emit("data", "\x1b]7501;?\x1b\\");
    assert.equal(f.statuses().at(-1), formatProgramStatus({ state: "blocked", app: "pi", kind: "question", message: "Auth method" }));
    const done: ProgramStatus = { state: "done", app: "pi", message: "Session" };
    f.terminal.setProgramStatus(done);
    end(f.attention);
    assert.equal(f.statuses().at(-1), formatProgramStatus(done));
    f.terminal.stop();
    assert.equal(f.statuses().at(-1), formatProgramStatus({ state: "clear" }));
    f.terminal.start(() => {}, () => {});
    process.stdin.emit("data", "\x1b]7501;?\x1b\\");
    assert.equal(f.statuses().at(-1), formatProgramStatus(done));
    f.attention.close();
    assert.equal(Object.hasOwn(f.terminal, "setProgramStatus"), false);
  });

  it("adds no OSC when disabled or when DA confirms unsupported negotiation", (t) => {
    const f = terminalFixture(t, "0");
    process.stdin.emit("data", "\x1b[?62;22c"); // Settle this start's keyboard DA debt before restart.
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    begin(f.attention);
    end(f.attention);
    assert.equal(f.statuses().length, 0);
    assert.equal(f.writes.some((text) => text.includes("\x1b]7501;?")), false);
    f.attention.close();
    f.terminal.stop();
    delete process.env.PI_PROGRAM_STATUS;
    f.terminal.start(() => {}, () => {});
    const attention = attachCoreAttention(f.terminal, askUserLabel);
    try {
      f.terminal.setProgramStatus({ state: "working", app: "pi" });
      process.stdin.emit("data", "\x1b[?62;22c");
      begin(attention);
      end(attention);
      process.stdin.emit("data", "\x1b]7501;?\x1b\\");
      assert.equal(f.statuses().length, 0, "late support after the DA sentinel cannot enable reports");
    } finally { attention.close(); }
  });

  it("honors explicit support and clears the cache without resurrecting a questionnaire", (t) => {
    const f = terminalFixture(t, "1");
    f.terminal.setProgramStatus({ state: "working", app: "pi" });
    begin(f.attention);
    assert.match(f.statuses().at(-1)!, /state=blocked/);
    f.terminal.setProgramStatus({ state: "clear" });
    const count = f.statuses().length;
    end(f.attention);
    f.attention.close();
    f.terminal.stop();
    f.terminal.start(() => {}, () => {});
    assert.equal(f.statuses().length, count);
  });
});
