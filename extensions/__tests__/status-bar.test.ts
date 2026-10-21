import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import widgetDisplay from "../shared/widget-display/owner.ts";
import statusBar from "../status-bar.ts";

const colors: Partial<Record<ThemeColor, number>> = { accent: 36, text: 97, success: 32, warning: 33, dim: 90, muted: 37, borderMuted: 90, error: 31 };
const theme = {
	fg: (color: ThemeColor, text: string) => `\u001b[${colors[color] ?? 35}m${text}\u001b[39m`,
	style: (text: string, style: { fg: ThemeColor }) => `\u001b[${colors[style.fg] ?? 35}m${text}\u001b[39m`,
} as unknown as Theme;

type Entry = { type: "message"; message: { role: "assistant"; usage: { input: number; cacheRead: number; cacheWrite: number } } };

function fixture(entries: Entry[]) {
	const handlers = new Map<string, ((event: never, context: ExtensionContext) => unknown)[]>();
	const statuses = new Map<string, string>();
	let footer: { render(width: number): string[]; dispose?(): void } | undefined;
	const sessionManager = {
		getSessionId: () => "status-bar-test",
		getLeafId: () => "leaf",
		getEntries: () => entries,
		getCwd: () => "/tmp/status-bar-test",
		getSessionName: () => undefined,
	};
	const context = {
		hasUI: true,
		mode: "tui",
		cwd: "/tmp/status-bar-test",
		sessionManager,
		getContextUsage: () => undefined,
		ui: { theme,
			setFooter(factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0]) {
				footer?.dispose?.();
				footer = factory?.(
					{ requestRender() {} } as never,
					theme,
					{
						getExtensionStatuses: () => statuses,
						onBranchChange: () => () => {},
						getAvailableProviderCount: () => 1,
					} as never,
				) as typeof footer;
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		events: createEventBus(),
		on(event: string, handler: (event: never, context: ExtensionContext) => unknown) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
			return () => undefined;
		},
		registerCommand() {},
		getSettings: () => ({}),
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
	} as unknown as ExtensionAPI;

	widgetDisplay(pi);
	statusBar(pi);
	for (const handler of handlers.get("session_start") ?? []) handler({} as never, context);
	return {
		statuses,
		render(width = 240) {
			return footer!.render(width);
		},
		dispose() {
			for (const handler of handlers.get("session_shutdown") ?? []) handler({} as never, context);
		},
	};
}

const cachedRequest: Entry[] = [{
	type: "message",
	message: { role: "assistant", usage: { input: 100, cacheRead: 900, cacheWrite: 0 } },
}];

void it("places the optimizer session total before the concise latest-request rate", () => {
	const f = fixture(cachedRequest);
	try {
		f.statuses.set("pi-cache-stats", "Cache 1/1 · 160k/190k 84.2% · write 0");
		const line = stripTerminalSequences(f.render()[2]!);
		assert.match(line, /↑100 R900\s+│\s+⛁ 84% 160k\/190k · req 90%/);
		assert.doesNotMatch(line, /H90%/);
	} finally {
		f.dispose();
	}
});

void it("renders the latest-request rate without an optimizer status and remains width-safe", () => {
	const f = fixture(cachedRequest);
	try {
		const fullLine = stripTerminalSequences(f.render()[2]!);
		assert.match(fullLine, /↑100 R900\s+│\s+req 90%/);
		assert.doesNotMatch(fullLine, /⛁/);
		for (const width of [1, 20, 240]) {
			for (const line of f.render(width)) assert.ok(visibleWidth(line) <= width);
		}
	} finally {
		f.dispose();
	}
});
