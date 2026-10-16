import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import * as hostTui from "@earendil-works/pi-tui";
import { type Component } from "@earendil-works/pi-tui";
const { ScrollView, VStack } = hostTui;
type ScrollView = hostTui.ScrollView;

// The overlay host only calls render(width). This is the single owner of the explicitly
// approved internal bounded-layout dependency (renderLayoutFrame/getScrollViewBox). Consumers
// build their tree from the public pi-tui imports and keep their own state and lifecycle.
//
// The bundled Pi CLI embeds pi-tui and only maps `import` specifiers to that copy, so
// import.meta.resolve cannot find the package there. The internal layout module is then loaded
// from the pi-tui installed next to the running CLI. Layout nodes are recognised through a
// Symbol.for protocol rather than class identity, so that module can lay out the host's public
// ScrollView/VStack; the behavioural self-test below proves this before any panel opens.
export interface NativeBox {
	component: Component;
	rect: { x: number; y: number; width: number; height: number };
	clip: { x: number; y: number; width: number; height: number };
	children: NativeBox[];
	scrollView?: ScrollView;
}
export interface NativeFrame { root: NativeBox; width: number; height: number; lines: string[] }
export interface NativeLayout {
	render(root: Component, width: number, height: number, requestRender: () => void): NativeFrame;
	scrollBox(frame: NativeFrame, scroll: ScrollView): NativeBox;
}
export class NativeLayoutError extends Error {
	constructor(cause: unknown, label = "Panel") {
		super(`${label} unavailable: the host's native bounded ScrollView layout is incompatible. Update Pi or report this compatibility error; no custom scrollbar fallback is used.`, { cause });
	}
}
/** Present any layout failure under the consumer's own label, keeping the original cause. */
export function layoutError(cause: unknown, label: string): NativeLayoutError {
	return new NativeLayoutError(cause instanceof NativeLayoutError ? cause.cause : cause, label);
}
function validRect(rect: NativeBox["rect"] | undefined): rect is NativeBox["rect"] {
	return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) && rect.width >= 0 && rect.height >= 0;
}
/**
 * Locate the pi-tui entry that carries the internal layout module: the module resolver first,
 * then the package installed beside the running launcher (bundled CLI).
 */
export function locateTuiEntry(resolve: () => string, launcher: string | undefined, realpath: (path: string) => string = realpathSync): string {
	try { return resolve(); }
	catch (cause) {
		if (!launcher) throw cause;
		try { return pathToFileURL(createRequire(realpath(launcher)).resolve("@earendil-works/pi-tui")).href; }
		catch (fallback) { throw new Error("Cannot locate @earendil-works/pi-tui from the module resolver or the running Pi launcher", { cause: [cause, fallback] }); }
	}
}
let loaded: Promise<NativeLayout> | undefined;
export function loadNativeLayout(): Promise<NativeLayout> {
	return loaded ??= resolveNativeLayout().catch(cause => { loaded = undefined; throw new NativeLayoutError(cause); });
}
async function resolveNativeLayout(): Promise<NativeLayout> {
	if (typeof ScrollView !== "function" || typeof VStack !== "function") throw new Error("Host TUI lacks ScrollView/VStack");
	const entry = locateTuiEntry(() => import.meta.resolve("@earendil-works/pi-tui"), process.argv[1]);
	const internal = await import(new URL("./layout.js", entry).href);
	if (typeof internal.renderLayoutFrame !== "function" || typeof internal.getScrollViewBox !== "function") throw new Error("Missing layout capabilities");
	const native: NativeLayout = {
		render(root, width, height, requestRender) {
			try {
				const frame = internal.renderLayoutFrame(root, width, height, requestRender);
				if (frame?.width !== width || frame?.height !== height || !Array.isArray(frame.lines) || frame.lines.length !== height || !frame.lines.every((line: unknown) => typeof line === "string") || frame.root?.component !== root || !validRect(frame.root?.rect) || !validRect(frame.root?.clip) || frame.root.rect.x !== 0 || frame.root.rect.y !== 0 || frame.root.rect.width !== width || frame.root.rect.height !== height || frame.root.clip.x !== 0 || frame.root.clip.y !== 0 || frame.root.clip.width !== width || frame.root.clip.height !== height || !Array.isArray(frame.root.children)) throw new Error("Invalid bounded frame");
				return frame;
			} catch (cause) { throw new NativeLayoutError(cause); }
		},
		scrollBox(frame, scroll) {
			try {
				const box = internal.getScrollViewBox(frame, scroll);
				const child = box?.children?.[0];
				if (box?.scrollView !== scroll || !validRect(box?.rect) || !validRect(box?.clip) || !Array.isArray(box.children) || box.children.length !== 1 || !validRect(child?.rect) || box.rect.height !== scroll.viewportHeight || !Number.isSafeInteger(scroll.scrollTop) || scroll.scrollTop < 0) throw new Error("Missing native ScrollView geometry");
				const { rect, clip } = box;
				if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > frame.width || rect.y + rect.height > frame.height || clip.x !== rect.x || clip.y !== rect.y || clip.width !== rect.width || clip.height !== rect.height || child.rect.x !== rect.x || child.rect.width !== scroll.getContentWidth(rect.width) || scroll.scrollTop > Math.max(0, child.rect.height - rect.height)) throw new Error("Invalid native ScrollView bounds");
				return box;
			} catch (cause) { throw new NativeLayoutError(cause); }
		},
	};
	// Verify that the located layout module lays out the host's public components: real
	// layout-node recognition, cropping, scrollbar and scrolling, not just exports.
	const child = { render: () => Array.from({ length: 10 }, (_, i) => String(i)), invalidate() {} };
	const scroll = new ScrollView(child, { scrollbar: "always", follow: "none", overscroll: "contain" });
	const root = new VStack([{ component: scroll, basis: 0, grow: 1 }]);
	let frame = native.render(root, 4, 3, () => {});
	if (native.scrollBox(frame, scroll).rect.height !== 3 || scroll.viewportHeight !== 3 || !frame.lines[0].includes("┃")) throw new Error("Native scrollbar not allocated");
	scroll.scrollBy(2);
	frame = native.render(root, 4, 3, () => {});
	if (scroll.scrollTop !== 2 || !stripVTControlCharacters(frame.lines[0]).startsWith("2")) throw new Error("Native viewport not scrollable");
	return native;
}
