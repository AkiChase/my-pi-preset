import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { TaskBrowser } from "./component.ts";
import { layoutError, loadNativeLayout } from "../../../shared/scroll-panel/native-layout.ts";

export function registerTaskBrowserCommand(pi: ExtensionAPI, dependencies: {
	findRoot: (cwd: string, ctx: ExtensionCommandContext) => string | undefined;
	currentTask: (root: string, ctx: ExtensionCommandContext) => string | undefined;
}): void {
	pi.registerCommand("trellis-task-viewer", {
		description: "Browse Trellis tasks and planning documents (read-only)",
		handler: async (args, ctx) => {
			const notice = (content: string) => {
				if (ctx.hasUI) ctx.ui.notify(content, "info");
				else pi.sendMessage({ customType: "trellis-task-status", content, display: true });
			};
			if (args.trim()) { notice("Usage: /trellis-task-viewer — browse tasks without changing them."); return; }
			if (ctx.mode !== "tui") { notice("/trellis-task-viewer requires interactive terminal mode. Custom task browsing is unavailable in RPC, print, and JSON modes."); return; }
			let root: string | undefined;
			try { root = dependencies.findRoot(ctx.cwd, ctx); }
			catch (error) { notice(`Trellis browsing unavailable: ${String(error)}. Run /trellis-init → Check project, or /reload.`); return; }
			if (!root) { notice("No Trellis project found. Open /trellis-task-viewer inside a project with .trellis/tasks."); return; }
			try {
				const nativeLayout = await loadNativeLayout();
				await ctx.ui.custom<void>((tui, _theme, _keys, done) => new TaskBrowser(
					root, tui, () => ctx.ui.theme, () => done(), () => dependencies.currentTask(root, ctx), nativeLayout,
					error => notice(error.message),
				), { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 } });
			} catch (error) { notice(layoutError(error, "Task viewer").message); }
		},
	});
}
