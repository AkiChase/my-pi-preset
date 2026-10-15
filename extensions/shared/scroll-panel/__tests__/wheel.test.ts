import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeLayoutError, layoutError } from "../native-layout.ts";
import { consumeWheel, contains } from "../wheel.ts";

const clip = { x: 2, y: 1, width: 4, height: 3 };

function scroller() {
	const calls: number[] = [];
	return { calls, scrollBy: (delta: number) => { calls.push(delta); return delta; } };
}

describe("scroll-panel wheel", () => {
	it("contains uses half-open rectangle bounds", () => {
		assert.equal(contains(clip, 2, 1), true);
		assert.equal(contains(clip, 5, 3), true);
		assert.equal(contains(clip, 6, 1), false);
		assert.equal(contains(clip, 2, 4), false);
		assert.equal(contains(clip, 1, 1), false);
	});

	it("scrolls by the host delta inside the clip and consumes the event", () => {
		const scroll = scroller();
		assert.deepEqual(consumeWheel({ type: "wheel", x: 3, y: 2, wheelDelta: -3 } as never, clip, scroll), { handled: true });
		assert.deepEqual(scroll.calls, [-3]);
	});

	it("consumes wheel events outside the clip without scrolling", () => {
		const scroll = scroller();
		assert.deepEqual(consumeWheel({ type: "wheel", x: 0, y: 0, wheelDelta: 2 } as never, clip, scroll), { handled: true });
		assert.deepEqual(scroll.calls, []);
	});

	it("treats a missing delta as zero", () => {
		const scroll = scroller();
		consumeWheel({ type: "wheel", x: 3, y: 2 } as never, clip, scroll);
		assert.deepEqual(scroll.calls, [0]);
	});

	it("leaves non-wheel events to the consumer", () => {
		const scroll = scroller();
		assert.equal(consumeWheel({ type: "press", x: 3, y: 2 } as never, clip, scroll), undefined);
		assert.deepEqual(scroll.calls, []);
	});
});

describe("scroll-panel layout errors", () => {
	it("relabels for the consumer and keeps the original cause", () => {
		const root = new Error("missing layout capabilities");
		const shared = new NativeLayoutError(root);
		assert.match(shared.message, /^Panel unavailable:/);
		const viewer = layoutError(shared, "Task viewer");
		assert.match(viewer.message, /^Task viewer unavailable:/);
		assert.equal(viewer.cause, root);
		assert.equal(layoutError(root, "Memory").cause, root);
	});
});
