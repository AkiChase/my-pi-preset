import assert from "node:assert/strict";
import { it } from "node:test";
import { formatTps, formatTtft, MIN_DECODE_MS, MIN_DECODE_TOKENS, ThroughputTracker } from "../response-throughput.ts";

type End = { stopReason?: string; output?: number };

/** Drive one assistant step: request at `req`, first delta at `first`, end at `end`. */
function step(t: ThroughputTracker, req: number | undefined, start: number, first: number | undefined, end: number, result: End = {}) {
	if (req !== undefined) t.providerRequest(req);
	t.messageStart("assistant", start);
	t.messageUpdate("text_start", start);
	if (first !== undefined) {
		t.messageUpdate("thinking_delta", first);
		t.messageUpdate("text_delta", first + 50);
	}
	t.messageEnd({ role: "assistant", stopReason: result.stopReason ?? "stop", usage: { output: result.output ?? 100 } }, end);
}

void it("measures TTFT from the provider request and decode from the first content delta", () => {
	const t = new ThroughputTracker();
	assert.equal(t.agentStart(), true);
	assert.deepEqual(t.snapshot(), { running: true, last: undefined });
	step(t, 1000, 1400, 2200, 4200, { output: 100 });
	assert.equal(t.agentSettled(), true);
	assert.deepEqual(t.snapshot(), { running: false, last: { tps: 50, ttftMs: 1200 } });
});

void it("falls back to message_start when no provider request was observed", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, undefined, 1000, 1500, 2500, { output: 100 });
	t.agentSettled();
	assert.equal(t.snapshot().last?.ttftMs, 500);
});

void it("weights TPS by tokens and averages TTFT across steps", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1000, 2000, { stopReason: "toolUse", output: 100 }); // 100 tok / 1s
	step(t, 5000, 5000, 8000, 12000, { output: 300 }); // 300 tok / 4s
	t.agentSettled();
	const last = t.snapshot().last!;
	assert.equal(last.tps, 80); // 400 / 5s, not mean(100, 75)
	assert.equal(last.ttftMs, 2000);
});

void it("keeps short steps for TTFT but excludes them from TPS", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1000, 1000 + MIN_DECODE_MS - 1, { stopReason: "toolUse", output: 500 });
	step(t, 2000, 2000, 3000, 5000, { output: MIN_DECODE_TOKENS - 1 });
	step(t, 6000, 6000, 7000, 9000, { output: 200 });
	t.agentSettled();
	assert.deepEqual(t.snapshot().last, { tps: 100, ttftMs: 1000 });
});

void it("reports TTFT without TPS when no step qualifies for a rate", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1500, 1550, { output: 3 });
	t.agentSettled();
	assert.deepEqual(t.snapshot().last, { tps: undefined, ttftMs: 1500 });
	assert.equal(formatTps(t.snapshot().last!.tps), "–");
});

void it("discards errored, aborted and contentless steps", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 100, 5000, { stopReason: "error", output: 999 });
	step(t, 0, 0, 100, 5000, { stopReason: "aborted", output: 999 });
	step(t, 0, 0, undefined, 5000, { output: 999 });
	step(t, 6000, 6000, 7000, 8000, { output: 50 });
	t.agentSettled();
	assert.deepEqual(t.snapshot().last, { tps: 50, ttftMs: 1000 });
});

void it("keeps the previous result when a prompt yields no valid sample", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1000, 2000, { output: 100 });
	t.agentSettled();
	const previous = t.snapshot().last;
	t.agentStart();
	assert.deepEqual(t.snapshot(), { running: true, last: previous });
	step(t, 0, 0, 100, 900, { stopReason: "aborted" });
	t.agentSettled();
	assert.deepEqual(t.snapshot(), { running: false, last: previous });
});

void it("aggregates retries and continuations until settle, ignoring nested agent_start", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1000, 2000, { output: 100 });
	assert.equal(t.agentStart(), false, "a retry run inside the same prompt does not restart the aggregate");
	step(t, 3000, 3000, 6000, 7000, { output: 100 });
	t.agentSettled();
	assert.deepEqual(t.snapshot().last, { tps: 100, ttftMs: 2000 });
});

void it("ignores events outside a running prompt and non-assistant messages", () => {
	const t = new ThroughputTracker();
	t.providerRequest(0);
	step(t, 0, 0, 100, 2000);
	assert.equal(t.agentSettled(), false);
	assert.equal(t.snapshot().last, undefined);
	t.agentStart();
	t.providerRequest(0);
	t.messageStart("user", 10);
	t.messageEnd({ role: "user" }, 20);
	t.messageStart("assistant", 500);
	t.messageUpdate("text_delta", 1000);
	t.messageEnd({ role: "toolResult" }, 1100);
	t.messageEnd({ role: "assistant", stopReason: "stop", usage: { output: 100 } }, 2000);
	t.agentSettled();
	assert.deepEqual(t.snapshot().last, { tps: 100, ttftMs: 1000 });
});

void it("reset clears the result and any in-flight prompt", () => {
	const t = new ThroughputTracker();
	t.agentStart();
	step(t, 0, 0, 1000, 2000);
	t.agentSettled();
	t.agentStart();
	t.reset();
	assert.deepEqual(t.snapshot(), { running: false, last: undefined });
});

void it("formats rates and latencies compactly", () => {
	assert.equal(formatTps(68.4), "68");
	assert.equal(formatTtft(1234), "1.2s");
	assert.equal(formatTtft(9960), "10s");
	assert.equal(formatTtft(12400), "12s");
});
