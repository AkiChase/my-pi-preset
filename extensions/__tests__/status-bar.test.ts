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
	let renders = 0;
	let sessionId = "status-bar-test";
	const sessionManager = {
		getSessionId: () => sessionId,
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
					{ requestRender() { renders++; } } as never,
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
		get renders() { return renders; },
		emit(event: string, payload: unknown = {}) {
			for (const handler of handlers.get(event) ?? []) handler(payload as never, context);
		},
		switchSession(id: string) {
			sessionId = id;
			for (const handler of handlers.get("session_start") ?? []) handler({} as never, context);
		},
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

/** Run one prompt with a single assistant step using controlled timestamps. */
function prompt(f: ReturnType<typeof fixture>, clock: { now: number }, timings: { ttft: number; decode: number; output: number }) {
	f.emit("agent_start");
	f.emit("before_provider_request", { payload: {} });
	f.emit("message_start", { message: { role: "assistant" } });
	clock.now += timings.ttft;
	f.emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } });
	clock.now += timings.decode;
	f.emit("message_end", { message: { role: "assistant", stopReason: "stop", usage: { output: timings.output } } });
}

function withClock<T>(run: (clock: { now: number }) => T): T {
	const original = Date.now;
	const clock = { now: 1_000_000 };
	Date.now = () => clock.now;
	try {
		return run(clock);
	} finally {
		Date.now = original;
	}
}

const usageLine = (f: ReturnType<typeof fixture>) => f.render()[2]!;

void it("shows nothing before the first prompt and a placeholder while the first prompt runs", () => {
	const f = fixture(cachedRequest);
	try {
		assert.doesNotMatch(stripTerminalSequences(usageLine(f)), /⚡/);
		assert.match(stripTerminalSequences(usageLine(f)), /↑100 R900\s+│\s+req 90%/, "an empty throughput slot adds no separator");
		const before = f.renders;
		f.emit("agent_start");
		assert.ok(f.renders > before, "starting a prompt redraws the footer");
		assert.match(stripTerminalSequences(usageLine(f)), /R900\s+│\s+⚡ …\s+│\s+req 90%/);
		assert.match(usageLine(f), /\u001b\[90m⚡ …/, "placeholder is dim");
	} finally {
		f.dispose();
	}
});

void it("updates TPS and TTFT only when the prompt settles and dims the previous value meanwhile", () => withClock(clock => {
	const f = fixture(cachedRequest);
	try {
		prompt(f, clock, { ttft: 1200, decode: 2000, output: 136 });
		assert.doesNotMatch(stripTerminalSequences(usageLine(f)), /t\/s/, "no value before settle");
		const before = f.renders;
		f.emit("agent_settled", { aborted: false });
		assert.ok(f.renders > before, "settling redraws the footer");
		assert.match(stripTerminalSequences(usageLine(f)), /R900\s+│\s+⚡68 t\/s · TTFT 1\.2s\s+│\s+req 90%/);
		assert.match(usageLine(f), /\u001b\[97m68 t\/s/, "settled value uses normal text color");

		prompt(f, clock, { ttft: 500, decode: 1000, output: 200 });
		assert.match(usageLine(f), /\u001b\[90m⚡68 t\/s · TTFT 1\.2s/, "running prompt shows the previous value dim");
		f.emit("agent_settled", { aborted: false });
		assert.match(stripTerminalSequences(usageLine(f)), /⚡200 t\/s · TTFT 0\.5s/);
	} finally {
		f.dispose();
	}
}));

void it("clears the runtime-only throughput on session switch", () => withClock(clock => {
	const f = fixture(cachedRequest);
	try {
		prompt(f, clock, { ttft: 1000, decode: 1000, output: 100 });
		f.emit("agent_settled", { aborted: false });
		assert.match(stripTerminalSequences(usageLine(f)), /⚡100 t\/s/);
		f.switchSession("another-session");
		assert.doesNotMatch(stripTerminalSequences(usageLine(f)), /⚡/);
	} finally {
		f.dispose();
	}
}));
