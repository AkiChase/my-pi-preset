import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_TYPE } from "../index.ts";
import { buildMaterial } from "../../shared/material.ts";
import { deferred, flush, harness, reply } from "./harness.ts";

it("normal final settled starts full idle delay; agent_end/silence/tools/retry cannot open eligibility and tokens do not churn timers", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run();
    const created = h.clock.created;
    for (const type of ["text_delta", "thinking_delta", "toolcall_delta"]) for (let i = 0; i < 100; i++) await h.emit("message_update", { assistantMessageEvent: { type, delta: "x" } });
    await h.emit("tool_execution_start", { toolCallId: "outer" }); await h.emit("tool_execution_start", { toolCallId: "outer/1" });
    await h.clock.tick(600000); await h.emit("tool_execution_end", { toolCallId: "outer/1" }); await h.emit("tool_execution_update", { toolCallId: "outer" });
    await h.emit("agent_end"); await h.clock.tick(600000);
    assert.equal(h.requests.length, 0); assert.equal(h.clock.created, created);
    await h.settled(); await h.clock.tick(299999); assert.equal(h.requests.length, 0);
    await h.clock.tick(1); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await flush();
    assert.equal(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE).length, 1);
    await h.settled(); await h.clock.tick(600000); assert.equal(h.requests.length, 1); assert.equal(h.clock.timers.size, 0);
});
it("aborted settled and observed handled input/cancelled navigation stay paused until next normal run", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(true); await h.clock.tick(600000); assert.equal(h.requests.length, 0);
    await h.run(); await h.settled(); await h.emit("input", { text: "handled", source: "extension" }); await h.clock.tick(600000); assert.equal(h.requests.length, 0);
    for (const event of ["session_before_tree", "session_before_switch", "session_before_fork"]) {
        await h.run(); await h.settled(); await h.emit(event); await h.clock.tick(600000); assert.equal(h.requests.length, 0);
    }
    const manual = h.command(); await flush(); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await manual;
    await h.run(); await h.user("new material"); await h.settled(); await h.clock.tick(300000); assert.equal(h.requests.length, 2); h.requests[1].resolve(reply()); await flush();
});
it("failures and unavailable configurations consume each window once, reveal safe reason and preserve saved state", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(); await h.clock.tick(300000);
    h.requests[0].resolve({ ...reply(), stopReason: "error", errorMessage: "Unsupported reasoning; api_key=secretvalue" }); await flush();
    assert.match(h.notices.at(-1)!, /Unsupported reasoning/); assert.doesNotMatch(h.notices.at(-1)!, /secretvalue/); assert.match(h.notices.at(-1)!, /No recap was saved/);
    await h.clock.tick(900000); assert.equal(h.requests.length, 1);
    await h.run(); await h.settled(); h.setAvailable(false); await h.clock.tick(300000); assert.match(h.notices.at(-1)!, /unavailable/);
    h.setAvailable(true); await h.clock.tick(600000); assert.equal(h.requests.length, 1);
    await h.run(); await h.settled(); await h.clock.tick(300000); h.requests[1].resolve(reply()); await flush();
    const stored = h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE);
    await h.user("changed"); await h.run(); await h.settled(); await h.clock.tick(300000); h.requests[2].reject(new Error("Provider overloaded")); await flush();
    assert.match(h.notices.at(-1)!, /Provider overloaded.*Saved recap was not overwritten/);
    assert.deepEqual(h.manager.getBranch().filter(e => e.type === "custom" && e.customType === STATE_TYPE), stored);
});
it("passive material edits before/after awaits invalidate stale output, neutral metadata does not", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(); await h.clock.tick(300000);
    const user = h.manager.getBranch().find(e => e.type === "message" && e.message.role === "user")!;
    h.manager.appendContextEdit(user.id, { content: "passively edited" }); h.requests[0].resolve(reply("stale")); await flush(); assert.equal(h.widgets.length, 0);
    await h.run(); await h.settled(); await h.clock.tick(300000);
    h.manager.appendCustomEntry("other-neutral", { value: "state" }); h.manager.appendSessionInfo("neutral name");
    h.requests[1].resolve(reply("fresh")); await flush(); assert.equal(h.widgets.filter(Boolean).length, 1);
});
it("input cancellation and old finally cannot clear newer request; shutdown closes dialogs/timers/late effects idempotently", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(); await h.clock.tick(300000);
    await h.user("next"); assert.equal(h.requests[0].options.signal?.aborted, true);
    await h.run(); await h.settled(); await h.clock.tick(300000); assert.equal(h.requests.length, 2);
    h.requests[0].resolve(reply("old")); await flush(); h.requests[1].resolve(reply("new")); await flush();
    assert.equal(h.widgets.filter(Boolean).length, 1);
    await h.user("late"); await h.run(); await h.settled(); await h.clock.tick(300000);
    await h.emit("session_shutdown"); await h.emit("session_shutdown"); h.requests[2].resolve(reply("closed")); await flush();
    assert.equal(h.clock.timers.size, 0); assert.equal(h.widgets.filter(Boolean).length, 1); assert.equal(h.notices.length, 0);
});
it("restore and automatic reuse valid state, while each explicit command refreshes", async t => {
    const h = harness(t, { initial: true }); await h.start(); await h.clock.tick(0); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply("restored")); await flush();
    const command = h.command(); await flush(); assert.equal(h.requests.length, 2); h.requests[1].resolve(reply("explicit refresh")); await command;
    writeFileSync(join(h.directory, "recap.json"), '{"automatic":false}'); await h.emit("session_tree"); await h.clock.tick(0);
    assert.equal(h.requests.length, 2); assert.equal(h.widgets.filter(Boolean).length, 3);
    h.manager.appendMessage({ role: "user", content: "stale", timestamp: 2 }); await h.emit("session_tree"); await h.clock.tick(0); assert.equal(h.requests.length, 2);
});
it("manual compaction one full delayed check handles terminal before idle cleanup and abandons busy without polling", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled();
    await h.emit("session_before_compact", { reason: "manual" }); h.setIdle(false);
    const kept = h.manager.getBranch().find(e => e.type === "message")!; h.manager.appendCompaction("compacted goal", kept.id, 100);
    await h.emit("session_compact", { reason: "manual", willRetry: false }); await h.clock.tick(299999); assert.equal(h.requests.length, 0);
    h.setIdle(true); await h.clock.tick(1); assert.equal(h.requests.length, 1); h.requests[0].resolve(reply()); await flush();
    await h.user("more"); await h.run(); await h.settled(); await h.emit("session_before_compact", { reason: "manual" });
    await h.emit("session_compact_failed", { reason: "manual", willRetry: false, aborted: true }); h.setIdle(false);
    await h.clock.tick(300000); h.setIdle(true); await h.clock.tick(600000); assert.equal(h.requests.length, 1);
    await h.run(); await h.settled(); await h.emit("session_before_compact", { reason: "threshold" }); await h.emit("session_compact", { reason: "threshold", willRetry: false });
    await h.clock.tick(600000); assert.equal(h.requests.length, 1);
    await h.settled(); await h.clock.tick(300000); assert.equal(h.requests.length, 2); h.requests[1].resolve(reply()); await flush();
});
it("pending queue guard abandons check until next normal settled; background continuation cancels request", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(); h.setPending(true); await h.clock.tick(300000);
    h.setPending(false); await h.clock.tick(600000); assert.equal(h.requests.length, 0);
    await h.run(); await h.settled(); await h.clock.tick(300000); assert.equal(h.requests.length, 1);
    await h.emit("before_agent_start"); h.requests[0].resolve(reply("late background")); await flush(); assert.equal(h.widgets.length, 0);
});
it("configuration fresh patch keeps active request snapshot, automatic toggle only reuses unattempted window remaining delay", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled(); await h.clock.tick(100000);
    h.selections.push("Toggle automatic"); await h.command("config"); assert.equal(h.clock.timers.size, 0);
    await h.clock.tick(100000); h.selections.push("Toggle automatic"); await h.command("config"); await h.clock.tick(99999); assert.equal(h.requests.length, 0);
    await h.clock.tick(1); assert.equal(h.requests.length, 1);
    h.selections.push("Set thinking", "off"); await h.command("config"); assert.equal(h.requests[0].options.reasoning, "high");
    h.requests[0].resolve(reply()); await flush();
    h.selections.push("Toggle automatic"); await h.command("config"); h.selections.push("Toggle automatic"); await h.command("config"); await h.clock.tick(600000); assert.equal(h.requests.length, 1);
    assert.equal(JSON.parse(readFileSync(join(h.directory, "recap.json"), "utf8")).thinking, "off");
});
it("cancelled or late config dialogs never write across session/navigation fences; unknown args only warn", async t => {
    const h = harness(t); await h.start(); const path = join(h.directory, "recap.json"); const before = readFileSync(path, "utf8");
    h.selections.push(undefined); await h.command("config"); assert.equal(readFileSync(path, "utf8"), before);
    const d = deferred<string | undefined>(); h.selections.push(d.promise); const command = h.command("config"); await flush(); await h.emit("session_before_fork"); d.resolve("Toggle automatic"); await command;
    assert.equal(readFileSync(path, "utf8"), before);
    await h.command("status"); assert.match(h.notices.at(-1)!, /Use \/recap or \/recap config\./);
});
it("strict model/auth/thinking availability never falls back and off omits reasoning", async t => {
    const h = harness(t, { initial: true, config: { model: "fixture/model", thinking: "minimal" } }); await h.start(); await h.clock.tick(0); assert.equal(h.requests.length, 0); assert.match(h.notices[0], /does not support thinking/);
    h.selections.push("Set thinking", "off"); await h.command("config"); const pending = h.command(); await flush(); assert.equal(h.requests[0].options.reasoning, undefined); h.requests[0].resolve(reply()); await pending;
    await h.user("auth missing"); h.setAuth(false); const manual = h.command(); await manual; assert.match(h.notices.at(-1)!, /no configured authentication/);
});
it("total 120 second deadline is owned and late noncooperative provider never writes; no loop", async t => {
    const h = harness(t); await h.start(); await h.user(); await h.run(); await h.settled();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        await h.clock.tick(300000); assert.equal(h.requests[0].options.timeoutMs, 120000);
        mock.timers.tick(119999); await flush(); assert.equal(h.notices.length, 0);
        mock.timers.tick(1); await flush(); assert.match(h.notices[0], /Request timed out/);
        h.requests[0].resolve(reply("late")); await flush(); assert.equal(h.widgets.length, 0);
        await h.clock.tick(600000); assert.equal(h.requests.length, 1);
    } finally { mock.timers.reset(); }
});
it("persistence reentry rechecks material and shutdown before showing", async t => {
    const h = harness(t); await h.start(); await h.user(); const command = h.command(); await flush();
    h.setOnAppend(() => { h.manager.appendMessage({ role: "user", content: "reentrant", timestamp: 3 }); });
    h.requests[0].resolve(reply()); await command; assert.equal(h.widgets.length, 0);
    const material = buildMaterial(h.manager, 32000); assert.ok(material.identity);
});
