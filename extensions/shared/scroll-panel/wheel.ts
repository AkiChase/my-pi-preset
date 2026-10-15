import type { ScrollView, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { NativeBox } from "./native-layout.ts";

type Rect = NativeBox["clip"];

export function contains(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/**
 * Route a host-normalized wheel event to a native ScrollView whose clip contains it.
 * Every wheel event is consumed, including fixed regions and edges: an unhandled overlay
 * wheel would otherwise scroll the main transcript. Non-wheel events are left unhandled.
 * The host already normalizes and accelerates wheelDelta, so it is applied as-is.
 */
export function consumeWheel(event: TuiMouseEvent, clip: Rect, scroll: Pick<ScrollView, "scrollBy">): TuiMouseEventResult | undefined {
	if (event.type !== "wheel") return undefined;
	if (contains(clip, event.x, event.y)) scroll.scrollBy(event.wheelDelta ?? 0);
	return { handled: true };
}
