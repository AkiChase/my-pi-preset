import assert from "node:assert/strict";
import { it } from "node:test";
import { SessionManager, createEventBus, type ExtensionAPI, type ExtensionContext, type ExtensionEvent } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import owner from "../owner.ts";
import { createWidgetClient } from "../client.ts";

function harness(mode = "tui") {
    const bus = createEventBus();
    const callbacks: { name: string; callback: (event: ExtensionEvent, ctx: ExtensionContext) => unknown }[] = [];
    const pi = () => ({ events: { on: bus.on, emit: bus.emit }, on(name: string, callback: (event: ExtensionEvent, ctx: ExtensionContext) => unknown) {
        const row = { name, callback }; callbacks.push(row); return () => { const i = callbacks.indexOf(row); if (i >= 0) callbacks.splice(i, 1); };
    } }) as unknown as ExtensionAPI;
    const widgets = new Map<string, Component | string[]>(); const writes: string[] = [];
    const theme = { fg: (_: string, text: string) => text };
    let onSet: (() => void) | undefined;
    let beforeSet: (() => void) | undefined;
    let deferred: (() => Component) | undefined;
    let defer = false;
    let fail = false;
    const ctx = { sessionManager: SessionManager.inMemory("/tmp"), hasUI: true, mode, ui: { theme,
        setWidget(key: string, content: unknown) {
            beforeSet?.();
            if (fail) throw new Error("sink failed");
            const old = widgets.get(key) as Component & { dispose?(): void } | undefined; widgets.delete(key); old?.dispose?.();
            let value: Component | string[] | undefined;
            if (typeof content === "function") {
                if (defer) deferred = () => content({ requestRender() {} }, theme);
                else value = content({ requestRender() {} }, theme);
            } else value = content as string[] | undefined;
            onSet?.(); if (value) widgets.set(key, value); writes.push(key);
        } } } as unknown as ExtensionContext;
    const api = pi(); owner(api);
    const client = (slot: "recap" | "trellis" | "agent_overview") => createWidgetClient(pi(), slot);
    const lines = () => [...widgets.values()].flatMap(value => Array.isArray(value) ? value : value.render(100));
    return { ctx, widgets, writes, lines, client, pi,
        setBeforeSet(fn: (() => void) | undefined) { beforeSet = fn; },
        setFail(value: boolean) { fail = value; },
        setDeferred(value: boolean) { defer = value; },
        finishDeferred() { return deferred?.(); },
        setOnSet(fn: (() => void) | undefined) { onSet = fn; },
        async emit(name: string, context = ctx) { for (const row of [...callbacks]) if (row.name === name) await row.callback({ type: name } as ExtensionEvent, context); } };
}
it("fixed slots ignore publish/update order, preserve other component identity and delete empty regions", async () => {
    const h = harness(); const trellis = h.client("trellis"), recap = h.client("recap"), hint = h.client("agent_overview");
    let creates = 0, disposes = 0;
    assert.equal(trellis.set(h.ctx, () => { creates++; return { render: () => ["Trellis"], invalidate() {}, dispose() { disposes++; } }; }), true);
    recap.set(h.ctx, ["Recap"]); assert.match(h.lines().join("\n"), /Recap[\s\S]*Trellis/); assert.equal(creates, 1); assert.equal(disposes, 0);
    recap.set(h.ctx, ["Updated recap"]); assert.equal(creates, 1); assert.equal(h.writes.length, 1);
    hint.set(h.ctx, ["Background"]); assert.equal(h.widgets.size, 2);
    recap.set(h.ctx, undefined); assert.deepEqual(h.lines().map(line => line.trim()), ["Trellis", "Background"]);
    trellis.dispose(); assert.equal(disposes, 1); hint.dispose(); assert.equal(h.widgets.size, 0); await h.emit("session_shutdown");
});
it("missing owner and different buses fail without direct host writes", () => {
    const bus = createEventBus(); const client = createWidgetClient({ events: bus, on: () => () => {} } as unknown as ExtensionAPI, "recap");
    const h = harness(); assert.equal(client.set(h.ctx, ["absent"]), false); assert.equal(h.writes.length, 0); client.dispose();
});
it("shutdown fences late handles and synchronous late setter installation", async () => {
    const h = harness(); const recap = h.client("recap");
    h.setOnSet(() => { h.setOnSet(undefined); void h.emit("session_shutdown"); });
    assert.equal(recap.set(h.ctx, ["late"]), false); assert.equal(h.widgets.size, 0); assert.equal(recap.set(h.ctx, ["later"]), false);
    await h.emit("session_shutdown");
});
it("new manager retires old handles even when the session id matches", async () => {
    const h = harness(); const old = h.client("recap"); old.set(h.ctx, ["old"]);
    const manager = SessionManager.inMemory("/tmp"); const id = h.ctx.sessionManager.getSessionId(); manager.getSessionId = () => id;
    const fresh = { ...h.ctx, sessionManager: manager }; await h.emit("session_start", fresh);
    const newer = h.client("recap"); newer.set(fresh, ["new"]); old.dispose(); assert.match(h.lines().join("\n"), /new/);
    assert.equal(old.set(h.ctx, ["stale"]), false); assert.match(h.lines().join("\n"), /new/); await h.emit("session_shutdown", fresh);
});
it("RPC publishes ordered text only and rejects component factories", async () => {
    const h = harness("rpc"); const trellis = h.client("trellis"), recap = h.client("recap");
    trellis.set(h.ctx, ["Trellis"]); assert.equal(recap.set(h.ctx, () => ({ render: () => ["invisible"], invalidate() {} })), false);
    recap.set(h.ctx, ["Recap"]); assert.deepEqual(h.lines(), ["Recap", "Trellis"]); await h.emit("session_shutdown");
});
it("competing activation cannot steal even an empty leased slot; dispose permits a new owner", async () => {
    const h = harness(); const a = h.client("recap"), b = h.client("recap"); a.set(h.ctx, undefined);
    assert.equal(b.set(h.ctx, ["steal"]), false); a.dispose(); assert.equal(b.set(h.ctx, ["accepted"]), true); await h.emit("session_shutdown");
});
it("factory reentry and disposal failure do not erase newer publication", async () => {
    const h = harness(); const recap = h.client("recap");
    recap.set(h.ctx, () => { recap.set(h.ctx, ["newer"]); return { render: () => ["old"], invalidate() {}, dispose() { throw new Error("cleanup"); } }; });
    assert.match(h.lines().join("\n"), /newer/); assert.doesNotMatch(h.lines().join("\n"), /old/); await h.emit("session_shutdown");
});
it("failed host mount is retryable and does not rebuild unrelated slots on a normal update", async () => {
    const h = harness(); const recap = h.client("recap"); let creates = 0, disposes = 0;
    h.setFail(true);
    assert.equal(recap.set(h.ctx, () => { creates++; return { render: () => ["retry"], invalidate() {}, dispose() { disposes++; } }; }), false);
    h.setFail(false);
    assert.equal(recap.set(h.ctx, () => { creates++; return { render: () => ["retry"], invalidate() {}, dispose() { disposes++; } }; }), true);
    assert.deepEqual(h.lines(), ["retry"]); assert.equal(creates, 1);
    await h.emit("session_shutdown"); assert.equal(disposes, 1);
});
it("deferred factory after shutdown neither constructs nor resurrects a component", async () => {
    const h = harness(); const recap = h.client("recap"); let creates = 0;
    h.setDeferred(true);
    recap.set(h.ctx, () => { creates++; return { render: () => ["late"], invalidate() {} }; });
    await h.emit("session_shutdown");
    assert.deepEqual(h.finishDeferred()?.render(80), []); assert.equal(creates, 0);
});
it("old setter returning after a nested session start cannot overwrite the new publication", async () => {
    const h = harness(); const old = h.client("recap"), freshClient = h.client("recap");
    const fresh = { ...h.ctx, sessionManager: SessionManager.inMemory("/tmp") };
    h.setOnSet(() => { h.setOnSet(undefined); void h.emit("session_start", fresh); freshClient.set(fresh, ["fresh"]); });
    assert.equal(old.set(h.ctx, ["old"]), false);
    assert.match(h.lines().join("\n"), /fresh/); assert.doesNotMatch(h.lines().join("\n"), /old/);
    old.dispose(); assert.match(h.lines().join("\n"), /fresh/); await h.emit("session_shutdown", fresh);
});
it("both regions close before dispose reentry; old cleanup does not clear the newer region", async () => {
    const h = harness(); const old = h.client("recap"), hint = h.client("agent_overview"), newer = h.client("agent_overview");
    const fresh = { ...h.ctx, sessionManager: SessionManager.inMemory("/tmp") }; let disposes = 0;
    old.set(h.ctx, () => ({ render: () => ["old"], invalidate() {}, dispose() { disposes++; newer.set(fresh, ["new hint"]); } }));
    hint.set(h.ctx, ["old hint"]); await h.emit("session_start", fresh);
    assert.match(h.lines().join("\n"), /new hint/); assert.doesNotMatch(h.lines().join("\n"), /old/); assert.equal(disposes, 1);
    await h.emit("session_shutdown", fresh);
});
it("nested builds for an unrelated slot do not duplicate the currently building factory", async () => {
    const h = harness(); const recap = h.client("recap"), trellis = h.client("trellis"); let creates = 0, disposes = 0;
    recap.set(h.ctx, () => { creates++; trellis.set(h.ctx, ["Trellis"]); return { render: () => ["Recap"], invalidate() {}, dispose() { disposes++; } }; });
    assert.equal(creates, 1); assert.match(h.lines().join("\n"), /Recap[\s\S]*Trellis/);
    await h.emit("session_shutdown"); assert.equal(disposes, 1);
});
it("factory errors remove only the bad slot and permit retry", async () => {
    const h = harness(); const recap = h.client("recap"), trellis = h.client("trellis");
    trellis.set(h.ctx, ["Trellis"]); recap.set(h.ctx, () => { throw new Error("factory"); });
    assert.deepEqual(h.lines().map(x => x.trim()), ["Trellis"]);
    assert.equal(recap.set(h.ctx, ["retry"]), true); assert.match(h.lines().join("\n"), /retry/); await h.emit("session_shutdown");
});
it("withdraw dispose reentry retains the newer same-slot publication exactly once", async () => {
    const h = harness(); const recap = h.client("recap"); let disposes = 0;
    recap.set(h.ctx, () => ({ render: () => ["old"], invalidate() {}, dispose() { disposes++; recap.set(h.ctx, ["new"]); } }));
    assert.equal(recap.set(h.ctx, undefined), false); assert.match(h.lines().join("\n"), /new/); assert.equal(disposes, 1);
    await h.emit("session_shutdown"); assert.equal(disposes, 1);
});
it("session IDs can legitimately return on session_start while old handles remain fenced", async () => {
    const h = harness(); const old = h.client("recap"); const manager = h.ctx.sessionManager; const first = manager.getSessionId();
    old.set(h.ctx, ["old"]); manager.getSessionId = () => "second"; await h.emit("session_start");
    manager.getSessionId = () => first; await h.emit("session_start");
    const fresh = h.client("recap"); assert.equal(fresh.set(h.ctx, ["fresh"]), true);
    old.dispose(); assert.match(h.lines().join("\n"), /fresh/); await h.emit("session_shutdown");
});
it("print mode performs no host writes", async () => {
    const h = harness("print"); assert.equal(h.client("recap").set(h.ctx, ["none"]), false); assert.equal(h.writes.length, 0); await h.emit("session_shutdown");
});
it("text respects Unicode widths, padding, ten-line truncation and invalidation", async () => {
    const h = harness(); const recap = h.client("recap"); recap.set(h.ctx, Array.from({length: 12}, () => "中文🙂 long line"));
    const component = [...h.widgets.values()][0] as Component;
    assert.equal(component.render(8).length > 10, true); component.invalidate();
    assert.match(component.render(80).join("\n"), /widget truncated/); await h.emit("session_shutdown");
});
it("a late or shutdown-reentrant acknowledgement is disposed instead of accepted", () => {
    let shutdown: (() => void) | undefined; let accept: ((value: import("../contracts.ts").WidgetHandle) => void) | undefined;
    let sets = 0, disposes = 0;
    const pi = { on(_name: string, cb: () => void) { shutdown = cb; return () => {}; }, events: { emit(_name: string, request: import("../contracts.ts").ConnectRequest) { accept = request.accept; shutdown?.(); request.accept({ set() { sets++; return true; }, dispose() { disposes++; } }); } } } as unknown as ExtensionAPI;
    const client = createWidgetClient(pi, "recap"), h = harness();
    assert.equal(client.set(h.ctx, ["late"]), false); assert.equal(sets, 0); assert.equal(disposes, 1);
    accept?.({ set() { sets++; return true; }, dispose() { disposes++; } }); assert.equal(disposes, 2);
});
it("a stale context on the same client cannot dispose its newer-session lease", async () => {
    const h = harness(); const recap = h.client("recap"); recap.set(h.ctx, ["old"]);
    const fresh = { ...h.ctx, sessionManager: SessionManager.inMemory("/tmp") }; await h.emit("session_start", fresh);
    assert.equal(recap.set(fresh, ["fresh"]), true);
    assert.equal(recap.set(h.ctx, ["stale"]), false); assert.match(h.lines().join("\n"), /fresh/);
    assert.equal(recap.set(fresh, ["still fresh"]), true); assert.match(h.lines().join("\n"), /still fresh/); await h.emit("session_shutdown", fresh);
});
it("setter throwing after factory creation rolls back and disposes exactly once", async () => {
    const h = harness(); const recap = h.client("recap"); let creates = 0, disposes = 0;
    h.setOnSet(() => { throw new Error("installed then failed"); });
    assert.equal(recap.set(h.ctx, () => { creates++; return { render: () => ["bad mount"], invalidate() {}, dispose() { disposes++; } }; }), false);
    assert.equal(disposes, 1); h.setOnSet(undefined);
    assert.equal(recap.set(h.ctx, ["retry"]), true); assert.match(h.lines().join("\n"), /retry/);
    await h.emit("session_shutdown"); assert.equal(creates, 1); assert.equal(disposes, 1);
});
it("factory switching sessions disposes its late result once and installs only the new slot", async () => {
    const h = harness(); const old = h.client("recap"), freshClient = h.client("recap"); let disposes = 0;
    const fresh = { ...h.ctx, sessionManager: SessionManager.inMemory("/tmp") };
    assert.equal(old.set(h.ctx, () => { void h.emit("session_start", fresh); freshClient.set(fresh, ["new"]); return { render: () => ["late"], invalidate() {}, dispose() { disposes++; } }; }), false);
    assert.equal(disposes, 1); assert.match(h.lines().join("\n"), /new/); assert.doesNotMatch(h.lines().join("\n"), /late/); await h.emit("session_shutdown", fresh);
});
it("render and invalidate exceptions do not break unrelated slots", async () => {
    const h = harness(); const recap = h.client("recap"), trellis = h.client("trellis");
    recap.set(h.ctx, () => ({ render() { throw new Error("render"); }, invalidate() { throw new Error("invalidate"); } })); trellis.set(h.ctx, ["safe"]);
    const component = [...h.widgets.values()][0] as Component; assert.doesNotThrow(() => component.invalidate()); assert.match(h.lines().join("\n"), /safe/); await h.emit("session_shutdown");
});
it("unsupported session_start clears prior widgets and rejects captured supported contexts", async () => {
    const h = harness(); const recap = h.client("recap"); recap.set(h.ctx, ["old"]);
    await h.emit("session_start", { ...h.ctx, hasUI: false }); assert.equal(h.widgets.size, 0);
    assert.equal(recap.set(h.ctx, ["stale"]), false); assert.equal(h.widgets.size, 0); await h.emit("session_shutdown");
});
it("RPC setter installation followed by failure is rolled back and retryable", async () => {
    const h = harness("rpc"); const recap = h.client("recap");
    h.setOnSet(() => { throw new Error("rpc sink"); }); assert.equal(recap.set(h.ctx, ["bad"]), false);
    h.setOnSet(undefined); assert.equal(recap.set(h.ctx, ["retry"]), true); assert.deepEqual(h.lines(), ["retry"]); await h.emit("session_shutdown");
});
it("the same client reconnects when a manager returns to a previous session ID", async () => {
    const h = harness(); const recap = h.client("recap"); const manager = h.ctx.sessionManager; const first = manager.getSessionId();
    await h.emit("session_start"); recap.set(h.ctx, ["first"]);
    manager.getSessionId = () => "second"; await h.emit("session_start");
    manager.getSessionId = () => first; await h.emit("session_start");
    assert.equal(recap.set(h.ctx, ["returned"]), true); assert.match(h.lines().join("\n"), /returned/); await h.emit("session_shutdown");
});
