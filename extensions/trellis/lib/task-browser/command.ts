import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TaskBrowser } from "./component.ts";
import { createTaskBrowserOwner, type BrowserMount } from "./owner.ts";
import { loadNativeLayout, type NativeLayout } from "../../../shared/scroll-panel/native-layout.ts";

export function registerTaskBrowserCommand(pi: ExtensionAPI, dependencies: {
	findRoot: (cwd: string, ctx: ExtensionContext) => string | undefined;
	currentTask: (root: string, ctx: ExtensionContext) => string | undefined;
}, options: {
	/** Replace expensive layout/component boundaries in fake-pi logic tests, never mount a real TUI. */
	loadLayout?: () => Promise<NativeLayout>;
	createComponent?: Parameters<typeof createTaskBrowserOwner>[0]["createComponent"];
} = {}) {
	const owner = createTaskBrowserOwner({
		findRoot: dependencies.findRoot,
		loadLayout: options.loadLayout ?? loadNativeLayout,
		createComponent: options.createComponent ?? ((args: BrowserMount) => new TaskBrowser(
			args.root, args.tui, () => args.ctx.ui.theme, args.done,
			() => dependencies.currentTask(args.root, args.ctx), args.layout, args.unavailable, args.hideHint,
		)),
	});
	pi.registerCommand("trellis-task-viewer", {
		description: "Browse Trellis tasks and planning documents (read-only)",
		handler: async (args, ctx) => {
			const notice = (content: string) => {
				try {
					if (ctx.hasUI) ctx.ui.notify(content, "info");
					else pi.sendMessage({ customType: "trellis-task-status", content, display: true });
				} catch { /* Cosmetic sinks cannot turn a refusal into an unhandled rejection. */ }
			};
			if (args.trim()) { notice("Usage: /trellis-task-viewer — browse tasks without changing them."); return; }
			if (ctx.mode !== "tui") { notice("/trellis-task-viewer requires interactive terminal mode. Custom task browsing is unavailable in RPC, print, and JSON modes."); return; }
			await owner.open(ctx);
		},
	});
	return owner;
}
