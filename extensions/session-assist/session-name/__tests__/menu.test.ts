import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, flush, reply } from "./harness.ts";
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

it("navigation/shutdown releases pending dialogs before late host completion", async t => {
    for (const event of ["session_before_switch", "session_before_tree", "session_before_fork", "session_shutdown", "session_start", "session_tree"]) {
        for (const step of ["select", "input"]) {
            const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
            const path = join(h.directory, "session-name.json"); writeFileSync(path, '{"automatic":true,"interval":8}');
            const before = readFileSync(path, "utf8");
            h.choose(step === "select" ? gate.promise : "Set interval", step === "input" ? gate.promise : undefined);
            let complete = false; const pending = h.command("config").then(() => { complete = true; });
            await flush(); await h.emit(event); await flush(); assert.equal(complete, true);
            assert.equal((step === "select" ? h.menus : h.inputDialogs).at(-1)!.signal?.aborted, true);
            gate.resolve(step === "select" ? "Disable automatic naming" : "3"); await pending; await flush();
            assert.equal(readFileSync(path, "utf8"), before); assert.deepEqual(h.notices, []);
        }
    }
});
it("replacement retires old input, observes its rejection and saves only the latest choice", async t => {
    const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
    h.choose("Set interval", gate.promise); const old = h.command("config"); await flush();
    h.choose("Disable automatic naming"); const current = h.command("config"); await old; await current;
    gate.reject(new Error("old host failure")); await flush();
    assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")), { automatic: false });
    assert.equal(h.inputDialogs[0].signal?.aborted, true); assert.deepEqual(h.notices, ["Session-name configuration saved."]);
});
it("selected-field patch retains external known/unknown values and updates runtime configuration", async t => {
    const h = harness(t); await h.start(); const path = join(h.directory, "session-name.json");
    const gate = deferred<string | undefined>(); h.choose("Set interval", gate.promise); const pending = h.command("config"); await flush();
    writeFileSync(path, JSON.stringify({ automatic: false, interval: 8, external: { keep: true } }));
    gate.resolve("3"); await pending;
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { automatic: false, interval: 3, external: { keep: true } });
    await h.user("first"); await h.settled(); assert.equal(h.requests.length, 0, "runtime uses the fresh automatic=false value");
});
it("naming activity and external title changes do not cancel configuration ownership", async t => {
    const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
    h.choose("Set interval", gate.promise); const pending = h.command("config"); await flush();
    await h.user("first"); await h.emit("agent_start"); await h.settled();
    assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await flush(); await h.externalName("Manual title");
    assert.equal(h.inputDialogs[0].signal?.aborted, false);
    gate.resolve("2"); await pending;
    assert.equal(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")).interval, 2);
});
it("unknown choices, empty input, host errors and corrupted config never write", async t => {
    for (const kind of ["unknown", "empty", "host", "config"]) {
        const h = harness(t); await h.start(); const path = join(h.directory, "session-name.json");
        writeFileSync(path, kind === "config" ? "broken" : '{"interval":8}'); const before = readFileSync(path, "utf8");
        const gate = deferred<string | undefined>();
        if (kind === "unknown") h.choose("invented");
        else if (kind === "empty") h.choose("Set interval", "");
        else if (kind === "config") h.choose("Disable automatic naming");
        else h.choose(gate.promise);
        const pending = h.command("config"); if (kind === "host") { await flush(); gate.reject(new Error("host failure")); }
        await pending; assert.equal(readFileSync(path, "utf8"), before); assert.equal(h.notices.length, 1);
    }
});

it("manager and session identity changes fence late choices without navigation events", async t => {
    for (const identity of ["manager", "session"]) {
        const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
        h.choose(gate.promise); const pending = h.command("config"); await flush();
        if (identity === "manager") {
            const manager = h.ctx.sessionManager;
            // A different manager exposing the same session id must not inherit the old dialog.
            Object.assign(h.ctx, { sessionManager: new Proxy(manager, {}) });
        } else {
            h.manager.getSessionId = () => "other-session";
        }
        gate.resolve("Disable automatic naming"); await pending;
        assert.deepEqual(h.notices, []);
        assert.equal(h.menus[0].signal?.aborted, true);
        assert.throws(() => readFileSync(join(h.directory, "session-name.json")), /ENOENT/);
    }
});
it("abort-listener synchronous replacement owns the slot after the outer replacement retires", async t => {
    const h = harness(t); await h.start(); const oldGate = deferred<string | undefined>();
    h.choose(oldGate.promise); const old = h.command("config"); await flush();
    const latestGate = deferred<string | undefined>(); let latest: Promise<void> | undefined;
    h.menus[0].signal!.addEventListener("abort", () => {
        h.choose("Set interval", latestGate.promise); latest = h.command("config");
    }, { once: true });
    h.choose("Disable automatic naming"); const superseded = h.command("config");
    await old; await superseded; await flush();
    assert.equal(h.menus.length, 2, "superseded outer flow never opens a dialog");
    assert.equal(h.inputDialogs[0].signal?.aborted, false);
    latestGate.resolve("4"); await latest;
    oldGate.reject(new Error("late retired host rejection")); await flush();
    assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")), { interval: 4 });
    assert.deepEqual(h.notices, ["Session-name configuration saved."]);
});
it("save notification can synchronously reopen configuration without old cleanup retiring it", async t => {
    const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
    const notify = h.ctx.ui.notify; let latest: Promise<void> | undefined;
    h.ctx.ui.notify = ((text: string, severity) => {
        notify(text, severity);
        if (!latest) { h.choose("Set interval", gate.promise); latest = h.command("config"); }
    }) as typeof notify;
    h.choose("Disable automatic naming"); await h.command("config"); await flush();
    assert.equal(h.inputDialogs[0].signal?.aborted, false);
    gate.resolve("5"); await latest;
    assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")), { automatic: false, interval: 5 });
    assert.equal(h.notices.length, 2);
});
it("resolved host value followed by same-tick navigation never commits or opens the next step", async t => {
    const h = harness(t); await h.start(); const gate = deferred<string | undefined>();
    h.choose(gate.promise, "2"); const pending = h.command("config"); await flush();
    gate.resolve("Set interval"); await h.emit("session_before_fork"); await pending;
    assert.equal(h.inputDialogs.length, 0); assert.deepEqual(h.notices, []);
    assert.throws(() => readFileSync(join(h.directory, "session-name.json")), /ENOENT/);
    h.choose("Set interval", "2"); await h.command("config");
    assert.equal(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")).interval, 2,
        "a cancelled before-fork event does not destroy activation");
});
it("manual naming keeps a pending config open and disabling cancels only the naming wait", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    const gate = deferred<string | undefined>(); h.choose(gate.promise); const config = h.command("config"); await flush();
    const manual = h.command(); await flush();
    assert.equal(h.requests.length, 2); assert.equal(h.menus[0].signal?.aborted, false);
    gate.resolve("Disable automatic naming"); await config; await manual;
    assert.equal(h.requests[1].signal?.aborted, true);
    assert.deepEqual(h.notices, ["Session-name configuration saved."]);
    h.requests[0].resolve(reply("late automatic")); h.requests[1].reject(new Error("late manual")); await flush();
    assert.equal(h.manager.getSessionName(), undefined);
    h.choose("Enable automatic naming"); await h.command("config"); await h.settled();
    assert.equal(h.requests.length, 2, "disabling does not refund the consumed first chance");
});
