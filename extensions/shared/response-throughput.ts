/**
 * Per-prompt response throughput: decode tokens/second and time to first token.
 *
 * A "prompt" spans from the first `agent_start` after idle to `agent_settled`,
 * so automatic retries and queued continuations aggregate into one result.
 * Each assistant message inside it is one step measured from three instants:
 * request dispatch (`before_provider_request`, falling back to `message_start`),
 * the first content delta and `message_end`.
 *
 * Pure state machine: callers pass timestamps, nothing here touches the UI.
 */

/** Steps shorter than this are bursts, not a measurable decode rate. */
export const MIN_DECODE_MS = 200;
/** Steps with fewer output tokens carry too little signal for a rate. */
export const MIN_DECODE_TOKENS = 8;

const CONTENT_DELTAS = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);
const DISCARDED_STOPS = new Set(["error", "aborted"]);

export type ThroughputResult = {
	/** Token-weighted decode rate; undefined when no step qualified. */
	tps: number | undefined;
	/** Mean time to first token in milliseconds. */
	ttftMs: number;
};

export type ThroughputSnapshot = {
	running: boolean;
	last: ThroughputResult | undefined;
};

type Step = { requestAt: number; firstAt: number | undefined };

export class ThroughputTracker {
	private running = false;
	private last: ThroughputResult | undefined;
	private pendingRequestAt: number | undefined;
	private step: Step | undefined;
	private outputTokens = 0;
	private decodeMs = 0;
	private ttftTotalMs = 0;
	private ttftCount = 0;

	snapshot(): ThroughputSnapshot {
		return { running: this.running, last: this.last };
	}

	/** Returns true when the visible snapshot changed. */
	agentStart(): boolean {
		if (this.running) return false;
		this.running = true;
		this.pendingRequestAt = undefined;
		this.step = undefined;
		this.outputTokens = 0;
		this.decodeMs = 0;
		this.ttftTotalMs = 0;
		this.ttftCount = 0;
		return true;
	}

	providerRequest(now: number): void {
		// Requests outside a run (for example cache warming) are not responses.
		if (this.running) this.pendingRequestAt = now;
	}

	messageStart(role: string, now: number): void {
		if (!this.running || role !== "assistant") return;
		this.step = { requestAt: this.pendingRequestAt ?? now, firstAt: undefined };
		this.pendingRequestAt = undefined;
	}

	messageUpdate(deltaType: string, now: number): void {
		if (this.step && this.step.firstAt === undefined && CONTENT_DELTAS.has(deltaType)) this.step.firstAt = now;
	}

	messageEnd(message: { role: string; stopReason?: string; usage?: { output?: number } }, now: number): void {
		if (message.role !== "assistant") return;
		const step = this.step;
		this.step = undefined;
		if (!step || step.firstAt === undefined) return;
		if (message.stopReason && DISCARDED_STOPS.has(message.stopReason)) return;
		this.ttftTotalMs += Math.max(0, step.firstAt - step.requestAt);
		this.ttftCount++;
		const output = message.usage?.output ?? 0;
		const decode = now - step.firstAt;
		if (output >= MIN_DECODE_TOKENS && decode >= MIN_DECODE_MS) {
			this.outputTokens += output;
			this.decodeMs += decode;
		}
	}

	/** Returns true when the visible snapshot changed. */
	agentSettled(): boolean {
		if (!this.running) return false;
		this.running = false;
		this.step = undefined;
		this.pendingRequestAt = undefined;
		if (this.ttftCount > 0) {
			this.last = {
				tps: this.decodeMs > 0 ? (this.outputTokens * 1000) / this.decodeMs : undefined,
				ttftMs: this.ttftTotalMs / this.ttftCount,
			};
		}
		return true;
	}

	reset(): void {
		this.running = false;
		this.last = undefined;
		this.step = undefined;
		this.pendingRequestAt = undefined;
	}
}

export function formatTps(tps: number | undefined): string {
	return tps === undefined ? "–" : String(Math.round(tps));
}

export function formatTtft(ms: number): string {
	const seconds = ms / 1000;
	const tenths = Math.round(seconds * 10) / 10;
	return tenths < 10 ? `${tenths.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
