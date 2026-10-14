import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flush, harness, reply } from "./harness.ts";

it("first settled genuine input names once; subsequent N=8 inputs reevaluate and same title advances progress", async t => {
    const h = harness(t); await h.start();
    await h.user("first"); await h.settled(); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await flush();
    assert.equal(h.manager.getSessionName(), "New title");
    for (let n = 0; n < 7; n++) { await h.user(`next ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 1);
    await h.user("eighth"); await h.settled(); assert.equal(h.requests.length, 2);
    h.requests[1].resolve(reply()); await flush(); await h.settled();
    assert.equal(h.requests.length, 2);
});
it("tool/custom/extension/slash/handled inputs do not count; steering/follow-up inputs do", async t => {
    const h = harness(t); await h.start();
    await h.user("notification", "extension"); await h.user("/skill:test"); await h.user("consumed", "interactive", false);
    h.manager.appendCustomMessageEntry("notification", "custom", true);
    await h.emit("agent_end"); await h.emit("turn_end"); await h.settled();
    assert.equal(h.requests.length, 0);
    await h.emit("input", { text: "steer", source: "interactive", streamingBehavior: "steer" });
    h.manager.appendMessage({ role: "user", content: "steer", timestamp: 1 });
    await h.emit("input", { text: "follow", source: "rpc", streamingBehavior: "followUp" });
    h.manager.appendMessage({ role: "user", content: "follow", timestamp: 2 });
    await h.settled(); assert.equal(h.requests.length, 1);
});
it("failure is visible and waits N additional user inputs rather than retrying each settled boundary", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    h.requests[0].reject(new Error("secret provider detail")); await flush();
    assert.equal(h.notices.length, 1); assert.match(h.notices[0], /failed/); assert.equal(h.notices[0].includes("secret"), false);
    await h.settled(); assert.equal(h.requests.length, 1);
    for (let n = 0; n < 7; n++) { await h.user(`retry ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 1);
    await h.user("retry eighth"); await h.settled(); assert.equal(h.requests.length, 2);
});
it("unknown existing and externally changed titles are protected until manual refresh succeeds", async t => {
    const h = harness(t, { existing: "Manual" }); await h.start(); await h.user("first"); await h.settled();
    assert.equal(h.requests.length, 0);
    const manual = h.command(); await flush(); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await manual;
    await h.externalName("User changed");
    for (let n = 0; n < 8; n++) { await h.user(`n ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 1);
    assert.equal(h.manager.getSessionName(), "User changed");
});
it("late response cannot overwrite external rename and expected own asynchronous event preserves ownership", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    await h.externalName("User name"); h.requests[0].resolve(reply()); await flush();
    assert.equal(h.manager.getSessionName(), "User name"); assert.deepEqual(h.notices, []);
    const manual = h.command(); await flush(); h.requests[1].resolve(reply()); await manual; await flush();
    for (let n = 0; n < 8; n++) { await h.user(`n ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 3);
});
it("new input/shutdown invalidate waits and do not display cancellation failures", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    await h.user("new"); assert.equal(h.requests[0].signal?.aborted, true);
    h.requests[0].resolve(reply("stale")); await flush(); assert.equal(h.manager.getSessionName(), undefined);
    await h.settled(); assert.equal(h.requests.length, 2);
    await h.emit("session_shutdown"); h.requests[1].resolve(reply("late")); await flush();
    assert.equal(h.manager.getSessionName(), undefined); assert.deepEqual(h.notices, []);
});
it("config cancellation preserves state; disabled automatic still permits manual refresh", async t => {
    const h = harness(t); await h.start(); h.choose(undefined); await h.command("config");
    h.choose("Disable automatic naming"); await h.command("config");
    assert.equal(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")).automatic, false);
    await h.user("first"); await h.settled(); assert.equal(h.requests.length, 0);
    const manual = h.command(); await flush(); h.requests[0].resolve(reply()); await manual;
    assert.equal(h.manager.getSessionName(), "New title");
});
it("duplicate ambiguous/transformed candidates and historical user messages are never guessed", async t => {
    const h = harness(t); h.manager.appendMessage({ role: "user", content: "old history", timestamp: 1 }); await h.start();
    await h.user("duplicate"); await h.user("duplicate");
    await h.user("before transform", "interactive", false);
    h.manager.appendMessage({ role: "user", content: "after transform", timestamp: 2 });
    await h.settled(); assert.equal(h.requests.length, 0);
});
it("branch restoration and reload retain progress but a same-title external entry revokes ownership", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled(); h.requests[0].resolve(reply()); await flush();
    await h.emit("session_start");
    for (let n = 0; n < 8; n++) { await h.user(`n ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 2); h.requests[1].resolve(reply()); await flush();
    await h.externalName("New title");
    for (let n = 0; n < 8; n++) { await h.user(`blocked ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 2);
});
it("aborted boundary counts delivery but does not issue an automatic request", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled(true);
    assert.equal(h.requests.length, 0); await h.user("after abort"); await h.settled(); assert.equal(h.requests.length, 1);
});
it("concurrent manual refreshes only permit the latest request to commit", async t => {
    const h = harness(t); await h.start(); await h.user("data");
    const first = h.command(); await flush(); const second = h.command(); await flush();
    h.requests[0].resolve(reply("First")); h.requests[1].resolve(reply("Second")); await Promise.all([first, second]);
    assert.equal(h.manager.getSessionName(), "Second");
});

it("extension transforms cannot reuse handled interactive attribution", async t => {
    const h = harness(t); await h.start();
    await h.user("handled original", "interactive", false);
    await h.user("plugin notification", "extension", false);
    h.manager.appendMessage({ role: "user", content: "handled original", timestamp: 1 });
    await h.settled(); assert.equal(h.requests.length, 0);
});
it("same-name reentrant external title entry is not adopted as automatic ownership", async t => {
    const h = harness(t, { reentrantSameName: true, synchronousNameEvent: true }); await h.start();
    await h.user("first"); await h.settled(); h.requests[0].resolve(reply()); await flush();
    for (let n = 0; n < 8; n++) { await h.user(`more ${n}`); await h.settled(); }
    assert.equal(h.requests.length, 1);
});
it("pending explicit manual refresh takes precedence over due automatic settlement", async t => {
    const h = harness(t); await h.start(); await h.user("first");
    let idle!: () => void;
    h.ctx.waitForIdle = () => new Promise<void>(resolve => { idle = resolve; });
    const manual = h.command(); await flush();
    await h.settled(); assert.equal(h.requests.length, 0);
    idle(); await flush(); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await manual;
    assert.ok(h.notices.some(text => text.startsWith("Session name:")));
});
