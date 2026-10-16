import assert from "node:assert/strict";
import { it } from "node:test";
import { buildMaterial } from "../../shared/material.ts";
import { STATE_TYPE } from "../index.ts";
import { deferred, flush, harness, reply } from "./harness.ts";

it("passive material change before timer admission abandons stale window rather than generating new unobserved material", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled();
    h.manager.appendCustomMessageEntry("passive", "new context", false);
    await h.clock.tick(300000); assert.equal(h.requests.length, 0); await h.clock.tick(600000); assert.equal(h.requests.length, 0);
    const manual = h.command(); await flush(); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await manual;
});
it("manual wait survives normal settlement activity but navigation/input/shutdown cancel admission", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); const gate = deferred<void>(); h.setWait(gate.promise);
    const command = h.command(); await flush(); await h.emit("message_update", { assistantMessageEvent: { type: "text_delta", delta: "normal output" } });
    await h.settled(); gate.resolve(); await flush(); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await command;
    const next = deferred<void>(); h.setWait(next.promise); const cancelled = h.command(); await flush(); await h.emit("session_before_switch"); next.resolve(); await cancelled;
    assert.equal(h.requests.length, 1);
});
it("manual compact terminal without before handles pre-hook failure once, attempted failure never revives unchanged material", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled();
    await h.emit("session_compact_failed", { reason: "manual", willRetry: false, aborted: false }); await h.clock.tick(300000);
    assert.equal(h.requests.length, 1); h.requests[0].reject(new Error("ordinary failure")); await flush();
    await h.emit("session_before_compact", { reason: "manual" }); await h.emit("session_compact_failed", { reason: "manual", willRetry: false, aborted: true });
    await h.clock.tick(600000); assert.equal(h.requests.length, 1);
});
it("automatic unavailable defaults warn once; empty session never requests; manual and restore errors have actual consequence", async t => {
    const h = harness(t, { initial: true, config: {} }); await h.start(); await h.clock.tick(0); assert.equal(h.requests.length, 0);
    assert.match(h.notices[0], /model must be explicitly.*thinking must be explicitly/); assert.match(h.notices[0], /No recap was saved/);
    await h.clock.tick(600000); assert.equal(h.notices.length, 1);
    await h.command(); assert.equal(h.notices.length, 2);
    const empty = harness(t); await empty.start(); await empty.clock.tick(600000); await empty.command(); assert.equal(empty.requests.length, 0); assert.match(empty.notices[0], /No conversation/);
});
it("widget synchronous shutdown reentry cannot leave late installed widget, public callbacks get no live model context", async t => {
    const h = harness(t); await h.start(); await h.user(); const command = h.command(); await flush();
    h.setOnWidget(() => { h.setOnWidget(undefined); void h.emit("session_shutdown"); }); h.requests[0].resolve(reply()); await command;
    assert.equal(h.widgets.filter(Boolean).length, 1); assert.equal(h.widgets.at(-1), undefined); assert.equal(h.clock.timers.size, 0);
    assert.equal(h.manager.buildSessionProjection().messages.some(m => m.role === "custom" && m.customType === STATE_TYPE), false);
});
it("owned manual cancellation releases continuation before host wait ends and handles its late rejection", async t => {
    for (const event of ["input", "session_before_tree", "session_before_switch", "session_before_fork", "session_shutdown", "session_start"]) {
        const h = harness(t); await h.start(); await h.user(); h.setIdle(false);
        const gate = deferred<void>(); h.setWait(gate.promise); let completed = false;
        const command = h.command().then(() => { completed = true; }); await flush();
        await h.emit(event, event === "input" ? { text: "handled", source: "extension" } : {}); await flush();
        assert.equal(completed, true, event); assert.equal(h.requests.length, 0); assert.equal(h.ctx.isIdle(), false);
        gate.reject(new Error("late host waiter rejection")); await flush(); await command;
    }
});
it("new manual and config commands release replaced manual waits without parallel requests", async t => {
    const h = harness(t); await h.start(); await h.user(); const oldGate = deferred<void>(); h.setWait(oldGate.promise);
    let oldCompleted = false; const old = h.command().then(() => { oldCompleted = true; }); await flush();
    h.setWait(Promise.resolve()); const next = h.command(); await flush(); assert.equal(oldCompleted, true); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await next; oldGate.reject(new Error("replaced waiter")); await old; await flush();
    const configGate = deferred<void>(); h.setWait(configGate.promise); const waiting = h.command(); await flush();
    h.selections.push(undefined); await h.command("config"); await waiting; assert.equal(h.requests.length, 1);
    configGate.reject(new Error("config replaced waiter")); await flush();
});
it("newer publication created during stale-install rollback is not removed by the outer clearing setter", async t => {
    const h = harness(t); await h.start(); await h.user(); let current: Parameters<typeof h.ctx.ui.setWidget>[1];
    let stage = "install";
    h.ctx.ui.setWidget = (_key, content) => {
        current = undefined;
        if (content && stage === "install") {
            stage = "nested hide"; void h.emit("input", { text: "handled", source: "extension" }); stage = "rollback";
        } else if (!content && stage === "rollback") {
            stage = "done";
            h.manager.appendCustomEntry(STATE_TYPE, { version: 1, text: "newer rollback owner", material: buildMaterial(h.manager, 32000).identity });
            void h.emit("session_tree"); void h.clock.tick(0);
        }
        current = typeof content === "function" ? content : undefined;
    };
    const command = h.command(); await flush(); h.requests[0].resolve(reply("stale")); await command; await flush();
    assert.equal(typeof current, "function");
    if (typeof current === "function") {
        const component = current({ requestRender() {} } as unknown as Parameters<typeof current>[0], { fg: (_color: string, text: string) => text } as Parameters<typeof current>[1]);
        assert.match(component.render(120).join("\n"), /newer rollback owner/);
    }
});
it("synchronously nested newer publication survives an outer setter's late install", async t => {
    const h = harness(t); await h.start(); await h.user(); let current: Parameters<typeof h.ctx.ui.setWidget>[1]; let inject = true;
    h.ctx.ui.setWidget = (_key, content) => {
        current = undefined;
        if (content && inject) {
            inject = false;
            h.manager.appendCustomEntry(STATE_TYPE, { version: 1, text: "newer owned", material: buildMaterial(h.manager, 32000).identity });
            void h.emit("session_tree"); void h.clock.tick(0);
        }
        current = typeof content === "function" ? content : undefined;
    };
    const command = h.command(); await flush(); h.requests[0].resolve(reply("outer stale")); await command; await flush();
    assert.equal(typeof current, "function");
    if (typeof current === "function") {
        // Execute the published factory using typed public callback parameters, not a duplicate Recap renderer.
        const component = current({ requestRender() {} } as unknown as Parameters<typeof current>[0], { fg: (_color: string, text: string) => text } as Parameters<typeof current>[1]);
        assert.match(component.render(120).join("\n"), /newer owned/);
    }
});
