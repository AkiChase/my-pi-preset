import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, UIPromptEndEvent, UIPromptStartEvent } from "@earendil-works/pi-coding-agent";
import {
  askUserLabel,
  cmuxCliPath,
  createCmuxSink,
  createHerdrSink,
  herdrPresent,
  promptLabel,
  type PromptSink,
  sanitizeLabel,
  watchPrompts,
} from "../blocked-signal.ts";

type Emitted = { channel: string; data: unknown };

/** Minimal stand-in for the slice of ExtensionAPI this extension touches. */
function createFakePi() {
  const emitted: Emitted[] = [];
  const busHandlers = new Map<string, ((data: unknown) => void)[]>();
  const lifecycleHandlers = new Map<string, ((event: unknown) => void)[]>();

  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
      },
      on(channel: string, handler: (data: unknown) => void) {
        busHandlers.set(channel, [...(busHandlers.get(channel) ?? []), handler]);
        return () => {};
      },
    },
    on(event: string, handler: (e: unknown) => void) {
      lifecycleHandlers.set(event, [...(lifecycleHandlers.get(event) ?? []), handler]);
      return () => {};
    },
  };

  return {
    pi: pi as unknown as ExtensionAPI,
    fireBus(channel: string, data: unknown) {
      for (const handler of busHandlers.get(channel) ?? []) handler(data);
    },
    fire(event: string, data: unknown) {
      for (const handler of lifecycleHandlers.get(event) ?? []) handler(data);
    },
    blockedEvents() {
      return emitted.filter((e) => e.channel === "herdr:blocked").map((e) => e.data);
    },
  };
}

function start(kind: UIPromptStartEvent["kind"], title?: string): UIPromptStartEvent {
  return { type: "ui_prompt_start", reason: "ui_prompt", kind, ...(title ? { title } : {}) };
}

function end(kind: UIPromptEndEvent["kind"]): UIPromptEndEvent {
  return { type: "ui_prompt_end", reason: "ui_prompt", kind };
}

/** Records what each sink saw, so watcher tests do not depend on either host. */
function recordingSink(): PromptSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    block(label, kind) {
      calls.push(`block:${kind}:${label}`);
    },
    release() {
      calls.push("release");
    },
  };
}

describe("watchPrompts", () => {
  it("brackets a prompt with one block and one release", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);

    fake.fire("ui_prompt_start", start("confirm", "Delete branch?"));
    fake.fire("ui_prompt_end", end("confirm"));

    assert.deepEqual(sink.calls, ["block:confirm:Delete branch?", "release"]);
  });

  it("labels a titleless questionnaire from the ask-user payload", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);

    fake.fireBus("rpiv:ask-user:prompt", {
      questions: [{ header: "Auth method" }, { header: "Library" }],
    });
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("ui_prompt_start", start("custom"));

    assert.deepEqual(sink.calls, ["block:custom:Auth method"]);
  });

  it("does not reuse a stale ask-user label for the next prompt", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);

    fake.fireBus("rpiv:ask-user:prompt", { questions: [{ header: "Auth method" }] });
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("ui_prompt_start", start("custom"));
    fake.fire("ui_prompt_end", end("custom"));
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    fake.fire("ui_prompt_start", start("custom"));
    fake.fireBus("rpiv:ask-user:blocked", { active: true });

    assert.equal(sink.calls.at(-1), "block:custom:Waiting for input");
  });

  it("ignores an unpaired end so a host is not released twice", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);

    fake.fire("ui_prompt_end", end("select"));
    assert.deepEqual(sink.calls, []);
  });

  it("releases a prompt still open at shutdown", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);

    fake.fire("ui_prompt_start", start("input", "Token"));
    fake.fire("session_shutdown", {});

    assert.deepEqual(sink.calls, ["block:input:Token", "release"]);
  });

  it("keeps browsers quiet even after a prompt payload without a mounted question", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);
    fake.fireBus("rpiv:ask-user:prompt", { questions: [{ header: "Failed mount" }] });
    fake.fire("ui_prompt_start", start("custom", "Viewer"));
    fake.fire("ui_prompt_end", end("custom"));
    assert.deepEqual(sink.calls, []);
  });

  it("counts overlapping questionnaire lifetimes without double-blocking", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("ui_prompt_start", start("custom"));
    fake.fire("ui_prompt_end", end("custom"));
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    assert.deepEqual(sink.calls, ["block:custom:Waiting for input"]);
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    assert.deepEqual(sink.calls, ["block:custom:Waiting for input", "release"]);
  });

  it("coalesces a questionnaire and standard input, including a question opened over a browser", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);
    fake.fire("ui_prompt_start", start("custom"));
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("ui_prompt_end", end("custom"));
    fake.fire("ui_prompt_start", start("input", "Answer"));
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    assert.deepEqual(sink.calls, ["block:custom:Waiting for input"]);
    fake.fire("ui_prompt_end", end("input"));
    assert.deepEqual(sink.calls, ["block:custom:Waiting for input", "release"]);
  });

  it("fences late events after shutdown and tolerates malformed attention payloads", () => {
    const fake = createFakePi();
    const sink = recordingSink();
    watchPrompts(fake.pi, [sink]);
    for (const payload of [null, {}, { active: "true" }]) fake.fireBus("rpiv:ask-user:blocked", payload);
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("session_shutdown", {});
    fake.fire("session_shutdown", {});
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fire("ui_prompt_start", start("input"));
    assert.deepEqual(sink.calls, ["block:custom:Waiting for input", "release"]);
  });

  it("keeps going when one sink throws", () => {
    const fake = createFakePi();
    const healthy = recordingSink();
    const broken: PromptSink = {
      block() {
        throw new Error("host gone");
      },
      release() {
        throw new Error("host gone");
      },
    };
    watchPrompts(fake.pi, [broken, healthy]);

    fake.fire("ui_prompt_start", start("editor"));
    fake.fire("ui_prompt_end", end("editor"));

    assert.deepEqual(healthy.calls, ["block:editor:Waiting for text", "release"]);
  });
});

describe("herdr sink", () => {
  it("emits the blocked pair herdr counts on", () => {
    const fake = createFakePi();
    const sink = createHerdrSink(fake.pi);

    sink.block("Auth method", "custom");
    sink.release();
    sink.release();

    assert.deepEqual(fake.blockedEvents(), [{ active: true, label: "Auth method" }, { active: false }]);
  });
});

describe("cmux sink", () => {
  function fakeCli() {
    const calls: string[][] = [];
    const pending: ((stdout: string) => void)[] = [];
    const run = (args: string[], onDone?: (stdout: string) => void) => {
      calls.push(args);
      if (onDone) pending.push(onDone);
    };
    return { calls, run, settle: (id: string) => pending.shift()?.(JSON.stringify({ id })) };
  }

  it("skips the kinds cmux already patches", () => {
    const cli = fakeCli();
    const sink = createCmuxSink(cli.run);

    for (const kind of ["confirm", "select", "input"] as const) {
      sink.block("x", kind);
      sink.release();
    }

    assert.deepEqual(cli.calls, []);
  });

  it("notifies for a questionnaire and dismisses it by id", () => {
    const cli = fakeCli();
    const sink = createCmuxSink(cli.run);

    sink.block("Auth method", "custom");
    cli.settle("n1");
    sink.release();

    assert.deepEqual(cli.calls, [
      ["notify", "--title", "pi is waiting", "--body", "Auth method", "--json"],
      ["dismiss-notification", "--id", "n1"],
    ]);
  });

  it("dismisses an id that arrives after the answer", () => {
    const cli = fakeCli();
    const sink = createCmuxSink(cli.run);

    sink.block("Auth method", "custom");
    sink.release();
    cli.settle("n1");

    assert.deepEqual(cli.calls.at(-1), ["dismiss-notification", "--id", "n1"]);
  });

  it("does not assign an old notification reply to a new attention segment", () => {
    const cli = fakeCli();
    const sink = createCmuxSink(cli.run);
    sink.block("First", "custom");
    sink.release();
    sink.block("Second", "custom");
    cli.settle("old");
    cli.settle("new");
    sink.release();
    assert.deepEqual(cli.calls.slice(2), [
      ["dismiss-notification", "--id", "old"],
      ["dismiss-notification", "--id", "new"],
    ]);
  });

  it("still notifies for a questionnaire that overlaps a cmux-patched dialog", () => {
    const fake = createFakePi();
    const cli = fakeCli();
    watchPrompts(fake.pi, [createCmuxSink(cli.run)]);
    fake.fire("ui_prompt_start", start("input", "Token"));
    fake.fireBus("rpiv:ask-user:blocked", { active: true });
    fake.fireBus("rpiv:ask-user:blocked", { active: false });
    fake.fire("ui_prompt_end", end("input"));
    cli.settle("n1");
    assert.deepEqual(cli.calls, [
      ["notify", "--title", "pi is waiting", "--body", "Waiting for input", "--json"],
      ["dismiss-notification", "--id", "n1"],
    ]);
  });

  it("stays quiet when no notification was posted", () => {
    const cli = fakeCli();
    createCmuxSink(cli.run).release();
    assert.deepEqual(cli.calls, []);
  });
});

describe("host detection", () => {
  it("requires herdr's full pane environment", () => {
    assert.equal(herdrPresent({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s", HERDR_PANE_ID: "w1:p1" }), true);
    assert.equal(herdrPresent({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/s" }), false);
    assert.equal(herdrPresent({}), false);
  });

  it("needs cmux's socket, workspace and bundled cli, and honors its opt-out", () => {
    const env = { CMUX_SOCKET_PATH: "/s", CMUX_WORKSPACE_ID: "w", CMUX_BUNDLED_CLI_PATH: "/bin/cmux" };
    assert.equal(cmuxCliPath(env), "/bin/cmux");
    assert.equal(cmuxCliPath({ ...env, CMUX_PI_HOOKS_DISABLED: "1" }), undefined);
    assert.equal(cmuxCliPath({ ...env, CMUX_BUNDLED_CLI_PATH: "" }), undefined);
    assert.equal(cmuxCliPath({ CMUX_SOCKET_PATH: "/s", CMUX_BUNDLED_CLI_PATH: "/bin/cmux" }), undefined);
  });
});

describe("label helpers", () => {
  it("flattens and truncates", () => {
    assert.equal(sanitizeLabel("  multi\n  line  "), "multi line");
    assert.equal(sanitizeLabel(""), undefined);
    assert.equal(sanitizeLabel(undefined), undefined);
    assert.equal(sanitizeLabel("x".repeat(80))?.length, 60);
  });

  it("falls back from header to question text, and ignores the other questions", () => {
    assert.equal(askUserLabel({ questions: [{ question: "Which library?" }] }), "Which library?");
    assert.equal(askUserLabel({ questions: [{ header: "Auth method" }, { header: "Library" }] }), "Auth method");
    assert.equal(askUserLabel({ questions: [] }), undefined);
    assert.equal(askUserLabel(undefined), undefined);
  });

  it("prefers a prompt title over the ask-user label", () => {
    assert.equal(promptLabel(start("custom", "Pick a file"), "Auth method"), "Pick a file");
    assert.equal(promptLabel(start("select"), "Auth method"), "Waiting for a choice");
  });
});
