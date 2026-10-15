import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMaterial } from "../../shared/material.ts";
import { LEGACY_STATE_TYPE, MATERIAL_BUDGET, STATE_TYPE } from "../index.ts";
import { TITLE_PROMPT } from "../title.ts";
import { flush, harness, reply } from "./harness.ts";

const latestQuota = (h: ReturnType<typeof harness>) => (h.manager.getEntries().findLast(entry =>
    entry.type === "custom" && entry.customType === STATE_TYPE) as { data: { quota: { phase: string; count: number; anchor: number | null } } } | undefined)?.data.quota;

it("stored quota keeps only a count and the last counted message id", async t => {
    const h = harness(t); await h.start(); await h.inputs(3);
    const quota = latestQuota(h) as unknown as Record<string, unknown>;
    const last = h.manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user")!;
    assert.deepEqual(Object.keys(quota).sort(), ["anchor", "count", "lastCountedId", "phase"]);
    assert.equal(quota.count, 3); assert.equal(quota.lastCountedId, last.id);
});
it("names after the first input and N=8 more inputs, then never automatically again", async t => {
    const h = harness(t); await h.start();
    await h.user("first"); await h.settled(); assert.equal(h.requests.length, 1);
    assert.equal(latestQuota(h)?.phase, "second");
    h.requests[0].resolve(reply()); await flush();
    assert.equal(h.manager.getSessionName(), "New title");
    await h.settled(); await h.settled(); assert.equal(h.requests.length, 1);
    await h.inputs(7); assert.equal(h.requests.length, 1);
    await h.user("ninth"); await h.settled(); assert.equal(h.requests.length, 2);
    assert.equal(latestQuota(h)?.phase, "finished");
    h.requests[1].resolve(reply("Second title")); await flush();
    assert.equal(h.manager.getSessionName(), "Second title");
    await h.inputs(60); await h.settled();
    assert.equal(h.requests.length, 2);
});
it("requests send shared current material directly without a current title", async t => {
    const h = harness(t, { existing: "Old title" }); await h.start();
    writeFileSync(join(h.directory, "recap.json"), "not json");
    h.manager.appendMessage({ role: "user", content: "x".repeat(40_000), timestamp: 1 });
    await h.user("目标：修复 parser"); await h.settled();
    assert.equal(h.requests.length, 0, "unknown title remains protected");
    const manual = h.command(); await flush();
    const expected = buildMaterial(h.manager, MATERIAL_BUDGET);
    assert.equal(h.requests[0].text, expected.text);
    assert.ok(expected.chars <= 32_000); assert.match(expected.text, /^\[Earlier context omitted\]/);
    assert.equal(h.requests[0].systemPrompt, TITLE_PROMPT);
    assert.doesNotMatch(TITLE_PROMPT, /currentTitle|unchanged/i);
    assert.equal(h.requests[0].text.includes("Old title"), false);
    h.requests[0].resolve(reply("Old title")); await manual;
    assert.equal(h.manager.getSessionName(), "Old title");
});
it("empty material sends nothing: manual shows a notice and automatic keeps its chance", async t => {
    const h = harness(t); await h.start();
    await h.command(); assert.equal(h.requests.length, 0);
    assert.match(h.notices.at(-1)!, /No conversation available; previous title kept/);
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
    assert.deepEqual([latestQuota(h)?.phase, latestQuota(h)?.count, latestQuota(h)?.anchor], ["second", 2, 2]);
    // A batched first boundary keeps the second threshold at the (N+1)th counted input.
    h.requests[0].resolve(reply()); await flush();
    await h.inputs(6); assert.equal(h.requests.length, 1);
    await h.inputs(1); assert.equal(h.requests.length, 2);
});
it("failures consume each started chance and explain the remaining automatic attempts", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    h.requests[0].reject(new Error("Provider rejected reasoning level")); await flush();
    assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /Automatic session naming failed: Provider rejected reasoning level; previous title kept\. One automatic attempt remains after 8 more user inputs/);
    await h.settled(); await h.settled(); assert.equal(h.requests.length, 1);
    await h.inputs(7); assert.equal(h.requests.length, 1);
    await h.user("ninth"); await h.settled(); assert.equal(h.requests.length, 2);
    h.requests[1].resolve({ ...reply(), stopReason: "error", errorMessage: "Provider overloaded" }); await flush();
    assert.match(h.notices.at(-1)!, /Provider overloaded; previous title kept\. Automatic naming is finished for this session/);
    assert.doesNotMatch(h.notices.join("\n"), /retry after/i);
    await h.inputs(30); assert.equal(h.requests.length, 2);
    assert.equal(h.manager.getSessionName(), undefined);
});
it("manual failures show returned SDK details safely and preserve existing titles", async t => {
    const h = harness(t, { existing: "Protected title" }); await h.start(); await h.user("data"); await h.settled();
    const manual = h.command(); await flush();
    h.requests[0].resolve({ ...reply(), stopReason: "error", errorMessage: 'Invalid reasoning api_key="private-key" headers={"trace":"private-trace"} payload={"messages":["private-body"]} stack="private-stack" Authorization: Basic private-basic' });
    await manual;
    assert.equal(h.manager.getSessionName(), "Protected title");
    assert.match(h.notices.at(-1)!, /refresh failed: Invalid reasoning api_key=\[redacted\].*; previous title kept\.$/);
    for (const value of ["private-key", "private-trace", "private-body", "private-stack", "private-basic"]) assert.equal(h.notices.at(-1)!.includes(value), false);
});
it("a started automatic request cancelled by new input consumes its chance without notices", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    await h.user("new"); assert.equal(h.requests[0].signal?.aborted, true);
    h.requests[0].resolve(reply("stale")); await flush(); assert.equal(h.manager.getSessionName(), undefined);
    await h.settled(); assert.equal(h.requests.length, 1);
    await h.inputs(7); assert.equal(h.requests.length, 2);
    await h.emit("session_shutdown"); h.requests[1].resolve(reply("late")); await flush();
    assert.equal(h.manager.getSessionName(), undefined); assert.deepEqual(h.notices, []);
});
it("aborted boundaries count delivery but do not start or consume a chance", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled(true); await h.settled(true);
    assert.equal(h.requests.length, 0); assert.equal(latestQuota(h)?.phase, "first");
    await h.user("after abort"); await h.settled(); assert.equal(h.requests.length, 1);
    assert.equal(latestQuota(h)?.anchor, 2);
    h.requests[0].resolve(reply()); await flush();
    await h.inputs(6); assert.equal(h.requests.length, 1);
    await h.user("ninth"); await h.settled(true); assert.equal(h.requests.length, 1);
    await h.settled(); assert.equal(h.requests.length, 2);
});
it("first-failure notice reports actual remaining inputs and a missing model keeps the chance unstarted", async t => {
    const h = harness(t); await h.start();
    const ctx = h.ctx as unknown as { model: unknown }; const model = ctx.model; ctx.model = undefined;
    await h.user("first"); await h.settled(); await h.user("second"); await h.settled();
    assert.equal(h.requests.length, 0); assert.deepEqual(h.notices, []); assert.equal(latestQuota(h)?.phase, "first");
    ctx.model = model; await h.user("third"); await h.settled(); assert.equal(h.requests.length, 1);
    h.requests[0].reject(new Error("down")); await flush();
    // Anchor 3 with N=8: the second chance is due at the 9th counted input, six more.
    assert.match(h.notices.at(-1)!, /One automatic attempt remains after 6 more user inputs/);
    await h.inputs(5); assert.equal(h.requests.length, 1);
    await h.inputs(1); assert.equal(h.requests.length, 2);
});
it("manual title stops automatic naming without consuming chances; later automatic titles resume it", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    h.requests[0].resolve(reply()); await flush();
    await h.inputs(3);
    const manual = h.command(); await flush(); h.requests[1].resolve(reply("Manual")); await manual;
    assert.equal(latestQuota(h)?.phase, "second");
    await h.inputs(30); assert.equal(h.requests.length, 2);
    assert.equal(h.manager.getSessionName(), "Manual");
    await h.emit("session_shutdown");
    const reloaded = harness(t, { manager: h.manager }); await reloaded.start();
    await reloaded.inputs(30); assert.equal(reloaded.requests.length, 0, "manual title stays protected after reload");
});
it("unknown existing titles stay protected, including after a successful manual refresh", async t => {
    const h = harness(t, { existing: "Manual" }); await h.start(); await h.inputs(12);
    assert.equal(h.requests.length, 0); assert.equal(latestQuota(h)?.phase, "first");
    const manual = h.command(); await flush(); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await manual;
    assert.equal(h.manager.getSessionName(), "New title");
    await h.inputs(20); assert.equal(h.requests.length, 1);
});
it("late response cannot overwrite external rename and the cancelled chance is not refunded", async t => {
    const h = harness(t); await h.start(); await h.user("first"); await h.settled();
    await h.externalName("User name"); h.requests[0].resolve(reply()); await flush();
    assert.equal(h.manager.getSessionName(), "User name"); assert.deepEqual(h.notices, []);
    assert.equal(latestQuota(h)?.phase, "second");
    await h.inputs(20); assert.equal(h.requests.length, 1);
    assert.equal(h.manager.getSessionName(), "User name");
});
it("branch navigation, reload and resume restore session-level quota from the whole session", async t => {
    const h = harness(t); await h.start();
    const root = h.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "intro" }], api: "openai-responses", provider: "fake", model: "fake",
        stopReason: "stop", timestamp: 1, usage: reply().usage });
    await h.user("first"); await h.settled(); h.requests[0].resolve(reply()); await flush();
    await h.emit("session_before_tree"); h.manager.branch(root); await h.emit("session_tree");
    assert.equal(h.manager.getBranch().some(entry => entry.type === "custom"), false, "branch omits stored state");
    await h.settled(); assert.equal(h.requests.length, 1);
    await h.inputs(3);
    await h.emit("session_shutdown");
    const reloaded = harness(t, { manager: h.manager }); await reloaded.start();
    await reloaded.inputs(4); assert.equal(reloaded.requests.length, 0);
    await reloaded.inputs(1); assert.equal(reloaded.requests.length, 1);
    reloaded.requests[0].reject(new Error("offline")); await flush();
    await reloaded.emit("session_shutdown");
    const resumed = harness(t, { manager: h.manager }); await resumed.start();
    await resumed.inputs(20); assert.equal(resumed.requests.length, 0);
});
it("legacy v1 or unreadable v2 state restarts the two automatic chances", async t => {
    const legacy = harness(t);
    legacy.manager.appendCustomEntry(LEGACY_STATE_TYPE, { progress: { version: 1, count: 3, evaluated: 3, retryAt: 0, observedIds: [] },
        ownership: { version: 1, titleEntryId: null, title: null, owned: false } });
    await legacy.start(); await legacy.inputs(1); assert.equal(legacy.requests.length, 1);
    const corrupt = harness(t);
    corrupt.manager.appendCustomEntry(STATE_TYPE, { version: 2, quota: "broken" });
    await corrupt.start(); await corrupt.inputs(1); assert.equal(corrupt.requests.length, 1);
    const stalled = harness(t);
    stalled.manager.appendCustomEntry(STATE_TYPE, { version: 2, quota: { phase: "second", count: 4, anchor: null, lastCountedId: null } });
    await stalled.start(); await stalled.inputs(1); assert.equal(stalled.requests.length, 1);
});
it("legacy automatically owned title can be renamed by the restarted automatic chances", async t => {
    const h = harness(t);
    const title = h.manager.appendSessionInfo("Legacy owned");
    h.manager.appendCustomEntry(LEGACY_STATE_TYPE, { progress: { version: 1, count: 1, evaluated: 1, retryAt: 0, observedIds: [] },
        ownership: { version: 1, titleEntryId: title, title: "Legacy owned", owned: true } });
    await h.start(); await h.inputs(1); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply("Renamed")); await flush();
    assert.equal(h.manager.getSessionName(), "Renamed");
});
it("config cancellation preserves state; disabled automatic still permits manual and re-enabling grants nothing new", async t => {
    const h = harness(t); await h.start(); h.choose(undefined); await h.command("config");
    h.choose("Disable automatic naming"); await h.command("config");
    assert.equal(JSON.parse(readFileSync(join(h.directory, "session-name.json"), "utf8")).automatic, false);
    await h.user("first"); await h.settled(); assert.equal(h.requests.length, 0);
    h.choose("Enable automatic naming"); await h.command("config");
    await h.user("second"); await h.settled(); assert.equal(h.requests.length, 1);
    h.requests[0].reject(new Error("offline")); await flush();
    h.choose("Set interval", "1"); await h.command("config");
    let menu = "";
    const select = h.ctx.ui.select;
    h.ctx.ui.select = (async (title: string, options: string[]) => { menu = title; return select(title, options); }) as typeof select;
    h.choose(undefined); await h.command("config");
    assert.match(menu, /N=1, 1 automatic attempt left in this session/);
    await h.settled(); assert.equal(h.requests.length, 1, "second chance needs a new input after the first chance started");
    await h.inputs(1); assert.equal(h.requests.length, 2);
    h.choose("Disable automatic naming"); await h.command("config");
    h.choose("Enable automatic naming"); await h.command("config");
    await h.inputs(10); assert.equal(h.requests.length, 2);
    await h.command("config");
    assert.match(menu, /automatic attempts finished in this session/);
    const manual = h.command(); await flush(); h.requests[2].resolve(reply()); await manual;
    assert.equal(h.manager.getSessionName(), "New title");
    await h.command("config");
    assert.match(menu, /automatic paused for the current title/);
});
it("duplicate ambiguous/transformed candidates and historical user messages are never guessed", async t => {
    const h = harness(t); h.manager.appendMessage({ role: "user", content: "old history", timestamp: 1 }); await h.start();
    await h.user("duplicate"); await h.user("duplicate");
    await h.user("before transform", "interactive", false);
    h.manager.appendMessage({ role: "user", content: "after transform", timestamp: 2 });
    await h.settled(); assert.equal(h.requests.length, 0);
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
    await h.inputs(8); assert.equal(h.requests.length, 1);
});
it("pending explicit manual refresh takes precedence over due automatic settlement without consuming it", async t => {
    const h = harness(t); await h.start(); await h.user("first");
    let idle!: () => void;
    h.ctx.waitForIdle = () => new Promise<void>(resolve => { idle = resolve; });
    const manual = h.command(); await flush();
    await h.settled(); assert.equal(h.requests.length, 0);
    assert.equal(latestQuota(h)?.phase, "first");
    idle(); await flush(); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(reply()); await manual;
    assert.ok(h.notices.some(text => text.startsWith("Session name:")));
});
