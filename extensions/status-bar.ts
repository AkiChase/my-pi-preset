import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { createWidgetClient } from "./shared/widget-display/client.ts";
import type { Slot } from "./shared/widget-display/contracts.ts";

// Metrics belong to this consumer; regional composition belongs to the shared owner.

const CACHE_STATUS_KEY = "pi-cache-stats";
const GIT_REFRESH_MS = 3000;
const GIT_TIMEOUT_MS = 2000;
const BAR_WIDTH = 14;
const BAR_FILLED = "▰";
const BAR_EMPTY = "▱";
const NO_VALUE = "–";

/**
 * Thinking level gets the same color pi uses for its thinking indicator, so the
 * footer agrees with the rest of the UI instead of inventing a second scheme.
 */
const THINKING_COLOR: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

type GitState = {
	branch: string | null;
	detached: boolean;
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	ahead: number;
	behind: number;
};

type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
};

/** Match pi's own footer token formatting so the numbers stay recognizable. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const normalized = cwd.endsWith("/") && cwd.length > 1 ? cwd.slice(0, -1) : cwd;
	const normalizedHome = home.endsWith("/") && home.length > 1 ? home.slice(0, -1) : home;
	if (normalized === normalizedHome) return "~";
	if (normalized.startsWith(`${normalizedHome}/`)) return `~${normalized.slice(normalizedHome.length)}`;
	return normalized;
}

/** Statuses are single-line; an extension that embeds a newline must not break the layout. */
function sanitize(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * `git status --porcelain=v2 --branch` in one call: branch, upstream divergence
 * and per-file state. Parsed here so the footer never shells out per field.
 */
export function parseGitStatus(stdout: string): GitState {
	const state: GitState = {
		branch: null,
		detached: false,
		staged: 0,
		modified: 0,
		untracked: 0,
		conflicts: 0,
		ahead: 0,
		behind: 0,
	};

	// branch.oid precedes branch.head, so the short sha is remembered until the
	// head line reveals whether HEAD is detached and needs it.
	let shortOid: string | null = null;

	for (const line of stdout.split("\n")) {
		if (line.startsWith("# branch.oid ")) {
			const oid = line.slice("# branch.oid ".length).trim();
			if (oid && oid !== "(initial)") shortOid = oid.slice(0, 7);
			continue;
		}
		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			if (head === "(detached)") {
				state.detached = true;
			} else if (head) {
				state.branch = head;
			}
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = /\+(\d+) -(\d+)/.exec(line);
			if (match) {
				state.ahead = Number(match[1]);
				state.behind = Number(match[2]);
			}
			continue;
		}
		if (line.startsWith("1 ") || line.startsWith("2 ")) {
			// "<kind> <XY> ..." where X is the staged and Y the worktree status.
			const xy = line.slice(2, 4);
			if (xy[0] && xy[0] !== ".") state.staged++;
			if (xy[1] && xy[1] !== ".") state.modified++;
			continue;
		}
		if (line.startsWith("u ")) {
			state.conflicts++;
			continue;
		}
		if (line.startsWith("? ")) state.untracked++;
	}

	if (state.detached && !state.branch) state.branch = shortOid ?? "detached";
	return state;
}

/** Sum usage the way pi's footer does: every entry that carries usage counts. */
function collectUsage(entries: Iterable<any>): { totals: UsageTotals; latestCacheHitRate: number | undefined } {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let latestCacheHitRate: number | undefined;

	const add = (usage: any) => {
		if (!usage) return;
		totals.input += usage.input ?? 0;
		totals.output += usage.output ?? 0;
		totals.cacheRead += usage.cacheRead ?? 0;
		totals.cacheWrite += usage.cacheWrite ?? 0;
		totals.cost += usage.cost?.total ?? 0;
	};

	for (const entry of entries) {
		if (entry.type === "usage") {
			add(entry.usage);
		} else if (entry.type === "message" && entry.message?.role === "assistant") {
			add(entry.message.usage);
			const usage = entry.message.usage;
			const prompt = (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
			latestCacheHitRate = prompt > 0 ? ((usage?.cacheRead ?? 0) / prompt) * 100 : undefined;
		} else if (entry.type === "message" && entry.message?.role === "toolResult") {
			add(entry.message.usage);
		} else if (entry.type === "branch_summary" || entry.type === "compaction") {
			add(entry.usage);
		}
	}

	return { totals, latestCacheHitRate };
}

/** Inverse of a "1.21M" / "12.3k" / "840" token count. Null when unparseable. */
function parseTokenCount(text: string): number | null {
	const match = /^([\d.]+)([kKM]?)$/.exec(text);
	if (!match) return null;
	const value = Number.parseFloat(match[1]);
	if (!Number.isFinite(value)) return null;
	const scale = match[2] === "M" ? 1_000_000 : match[2] === "k" || match[2] === "K" ? 1000 : 1;
	return Math.round(value * scale);
}

/**
 * Compress pi-cache-optimizer's status into one chip. Its text is
 * "· <Label> <hits>/<reqs>·<cached>/<total> <pct>%·write <n>" with an optional
 * "Cache Optimizer disabled · " prefix and " ⚠️ compat" suffix.
 *
 * The chip shows the percentage next to the *token* pair it is computed from
 * (cachedInput/totalInput), not the request counter: `34/35` measures a
 * different thing (upstream counts a request as a hit on a single cached
 * token -- `stats-store.ts`, `cacheRead > 0`), it rides close to 100% in any
 * long session, and sitting beside `96%` it reads as that percentage's own
 * numerator/denominator. The token pair genuinely is that.
 *
 * `percent` is null whenever the number is not a measurement: upstream
 * hardcodes 0% when totalInputTokens is 0, so 0% would otherwise conflate
 * "nothing cached" with "nothing sent". The caller paints those states dim
 * rather than letting them borrow the error color.
 */
export function parseCacheStatus(status: string): { chip: string; percent: number | null } {
	const text = sanitize(status);
	const disabled = /cache optimizer disabled/i.test(text);
	const compat = /compat/.test(text);
	const suffix = compat ? " ⚠" : "";

	if (disabled) return { chip: `⛁ off${suffix}`, percent: null };

	// The token pair is the one immediately preceding the percentage; that
	// adjacency is what tells it apart from the request counter before it.
	const stats = /([\d.]+[kKM]?)\/([\d.]+[kKM]?) (\d+(?:\.\d+)?)%/.exec(text);
	if (!stats) {
		// Unrecognized shape: keep a bare percentage if there is one, else the text.
		const loose = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].at(-1);
		if (!loose) return { chip: text, percent: null };
		const percent = Math.round(Number(loose[1]));
		return { chip: `⛁ ${percent}%${suffix}`, percent };
	}

	const [, cached, total, pct] = stats;
	// Upstream formats every count in millions ("0.012M/0.020M"); re-format through
	// the footer's own scale so the pair matches the R/W numbers beside it.
	const cachedTokens = parseTokenCount(cached);
	const totalTokens = parseTokenCount(total);
	// A zero denominator means nothing has been sent yet, so the percentage
	// upstream reports is a placeholder rather than a hit rate.
	if (totalTokens === 0) return { chip: `⛁ ${NO_VALUE}${suffix}`, percent: null };

	const percent = Math.round(Number(pct));
	const pair = cachedTokens !== null && totalTokens !== null ? `${formatTokens(cachedTokens)}/${formatTokens(totalTokens)}` : `${cached}/${total}`;
	return { chip: `⛁ ${percent}% ${pair}${suffix}`, percent };
}

/** Hit-rate coloring, shared by the request field and the cache chip. */
function hitRateColor(percent: number): ThemeColor {
	if (percent >= 80) return "success";
	if (percent >= 50) return "warning";
	return "error";
}

/**
 * Split a path so the directory you are actually in can be emphasized while the
 * parents stay quiet.
 */
function splitPath(path: string): { parent: string; leaf: string } {
	const index = path.lastIndexOf("/");
	if (index < 0 || path === "/") return { parent: "", leaf: path };
	return { parent: path.slice(0, index + 1), leaf: path.slice(index + 1) };
}

function padBetween(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + 2 + rightWidth > width) {
		const available = width - leftWidth - 2;
		if (available <= 0) return truncateToWidth(left, width, "…");
		const truncated = truncateToWidth(right, available, "");
		const pad = " ".repeat(Math.max(1, width - leftWidth - visibleWidth(truncated)));
		return left + pad + truncated;
	}
	return left + " ".repeat(width - leftWidth - rightWidth) + right;
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let closed = false;
	let epoch = 0;
	let sessionId: string | undefined;
	const slots = ["location", "context", "tokens", "cache_metrics", "task_summary", "external_statuses"] as const satisfies readonly Slot[];
	const clients = slots.map(slot => createWidgetClient(pi, slot));

	// One Git snapshot/poll across metric items, fenced to the owning session.
	let git: GitState | null = null;
	let gitFetchedAt = 0;
	let gitInFlight = false;

	const refreshGit = async (cwd: string, onChange: () => void) => {
		if (gitInFlight) return;
		gitInFlight = true;
		const stamp = epoch;
		try {
			const result = await pi.exec("git", ["status", "--porcelain=v2", "--branch"], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			});
			if (closed || epoch !== stamp) return;
			const next = result.code === 0 ? parseGitStatus(result.stdout) : null;
			const changed = JSON.stringify(next) !== JSON.stringify(git);
			git = next;
			if (changed) onChange();
		} catch {
			// Not a repo, git missing, or the call timed out: drop the git chip
			// rather than surfacing an error in the status bar.
			if (!closed && epoch === stamp && git !== null) {
				git = null;
				onChange();
			}
		} finally {
			if (epoch === stamp) { gitFetchedAt = Date.now(); gitInFlight = false; }
		}
	};

	const buildMetrics = (tui: TUI, initialTheme: Theme, footerData: ReadonlyFooterDataProvider) => {
		const origin = ctx, stamp = epoch;
		let disposed = false;
		const live = () => !disposed && !closed && ctx?.sessionManager === origin?.sessionManager && epoch === stamp;
		const redraw = () => { if (live()) tui.requestRender(); };
		let theme = initialTheme;
		const unsubscribe = footerData.onBranchChange(() => {
			// A ref change invalidates the counts too, so force the next render
			// to re-run git instead of waiting out the poll interval.
			if (!live()) return;
			gitFetchedAt = 0;
			redraw();
		});

		if (!live()) { disposed = true; unsubscribe(); throw new Error("Retired metric subscription"); }

		let statsCache:
			| {
					key: string;
					totals: UsageTotals;
					latestCacheHitRate: number | undefined;
			  }
			| undefined;

		/**
		 * The footer renders on every frame while usage only changes when the
		 * session grows, so the entry scan is keyed on the session identity.
		 */
		const sessionStats = () => {
			const sm = ctx?.sessionManager;
			if (!sm) return { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, latestCacheHitRate: undefined };
			const key = `${sm.getSessionId()}:${sm.getLeafId()}:${sm.getEntries().length}`;
			if (statsCache?.key === key) return statsCache;
			const collected = collectUsage(sm.getEntries());
			statsCache = { key, ...collected };
			return statsCache;
		};

		// Every colored atom goes through here. `theme.fg()` throws on a token a
		// theme does not define, and a throw inside render would take down the TUI,
		// so an unknown token degrades to uncolored text instead.
		const paint = (token: ThemeColor, text: string): string => {
			if (!text) return ""; // Never emit an escape pair around nothing.
			try {
				return theme.fg(token, text);
			} catch {
				return text;
			}
		};
		// A label/value pair: the glyph recedes, the number carries the color.
		const field = (label: string, value: string, token: ThemeColor): string => paint("dim", label) + paint(token, value);

		const gitChip = (): string => {
			if (!git?.branch) return "";
			const parts = [paint("accent", git.detached ? `⌀ ${git.branch}` : git.branch)];
			if (git.conflicts) parts.push(field("✖", String(git.conflicts), "error"));
			if (git.modified) parts.push(field("~", String(git.modified), "warning"));
			if (git.staged) parts.push(field("+", String(git.staged), "success"));
			if (git.untracked) parts.push(field("?", String(git.untracked), "muted"));
			if (git.ahead) parts.push(field("↑", String(git.ahead), "accent"));
			if (git.behind) parts.push(field("↓", String(git.behind), "accent"));
			if (parts.length === 1) parts.push(paint("success", "✓"));
			return parts.join(" ");
		};

		const contextBar = (): string => {
			const usage = ctx?.getContextUsage();
			const window = usage?.contextWindow ?? ctx?.model?.contextWindow ?? 0;
			const tokens = usage?.tokens ?? null;
			const percent = usage?.percent ?? null;

			// Right after compaction the token count is unknown until the next
			// response; show the shape of the bar without inventing a number.
			if (percent === null || tokens === null) {
				return `${paint("borderMuted", BAR_EMPTY.repeat(BAR_WIDTH))}  ${paint("muted", "?")}${paint("borderMuted", "/")}${paint("dim", formatTokens(window))}`;
			}

			const clamped = Math.max(0, Math.min(100, percent));
			// Any context at all keeps one cell lit, so the bar never reads as empty
			// while tokens are in play.
			const filled = clamped > 0 ? Math.max(1, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH))) : 0;
			const level: ThemeColor = clamped > 85 ? "error" : clamped > 70 ? "warning" : "success";
			const bar = paint(level, BAR_FILLED.repeat(filled)) + paint("borderMuted", BAR_EMPTY.repeat(BAR_WIDTH - filled));
			const pct = theme.style(`${clamped.toFixed(0)}%`, { fg: level, bold: true });
			const used = `${paint("text", formatTokens(tokens))}${paint("borderMuted", "/")}${paint("dim", formatTokens(window))}`;
			// Two spaces after the track: the bar is a solid shape and a single space
			// lets the percentage read as its last cell.
			return `${bar}  ${pct} ${used}`;
		};

		const modelLabel = (): string => {
			const model = ctx?.model;
			if (!model) return paint("error", "no-model");
			const dot = paint("borderMuted", "·");
			const parts: string[] = [];
			if (footerData.getAvailableProviderCount() > 1) parts.push(paint("dim", model.provider));
			parts.push(paint("text", model.id));
			if (model.reasoning) {
				const level = ctx?.thinkingLevel ?? "off";
				parts.push(paint(THINKING_COLOR[level] ?? "muted", level));
			}
			return parts.join(dot);
		};

		/**
		 * Draw every `setStatus()` entry. Known keys are compressed; unknown keys
		 * pass through so an extension installed later is still visible here.
		 */
		const renderChips = (requestHitRate: string | undefined) => {
			// Cache first (it belongs with the token counts to its left), then the
			// rest alphabetically so chip order stays stable between renders.
			const statuses = [...footerData.getExtensionStatuses()].sort(([a], [b]) => {
				if (a === CACHE_STATUS_KEY) return -1;
				if (b === CACHE_STATUS_KEY) return 1;
				return a.localeCompare(b);
			});

			let cacheChip: string | undefined;
			const chips: string[] = [];
			let task = "";
			for (const [key, text] of statuses) {
				if (!text?.trim()) continue;
				if (key === CACHE_STATUS_KEY) {
					const { chip, percent } = parseCacheStatus(text);
					// `dim` for "no measurement yet" / "off": those states are not a
					// bad hit rate and must not borrow the error color.
					cacheChip = paint(percent === null ? "dim" : hitRateColor(percent), chip);
					continue;
				}
				if (key === "task-ui") {
					// The shared task owner already styles each semantic field.
					task = sanitize(text);
					continue;
				}
				// Foreign text: `muted` rather than `dim` so a status that another
				// extension considers important stays readable.
				chips.push(paint("muted", sanitize(text)));
			}

			// The latest-request rate belongs with the optional optimizer aggregate,
			// not cumulative R/W token totals. It still renders alone when the
			// optimizer extension is unavailable.
			const cacheMetrics = [cacheChip, requestHitRate].filter((chip): chip is string => chip !== undefined);
			return { cache: cacheMetrics.join(paint("dim", " · ")), task, external: chips.join(paint("borderMuted", "  │  ")) };
		};

		return {
			dispose() { if (disposed) return; disposed = true; unsubscribe(); },
			invalidate() {
				statsCache = undefined;
			},
			render(width: number) {
				if (!live()) return { location: "", context: "", tokens: "", cache_metrics: "", task_summary: "", external_statuses: "" };
				theme = ctx?.ui.theme ?? initialTheme;
				const sm = ctx?.sessionManager;
				const cwd = sm?.getCwd() ?? ctx?.cwd ?? process.cwd();

				// Kick the poll from render: the footer is the only consumer, so it
				// stops as soon as the footer stops drawing.
				if (Date.now() - gitFetchedAt > GIT_REFRESH_MS) {
					void refreshGit(cwd, redraw);
				}

				// Line 1: where am I -- path, git, session name.
				const { parent, leaf } = splitPath(formatCwd(cwd, process.env.HOME || process.env.USERPROFILE));
				const pathParts = [paint("dim", parent) + theme.style(leaf, { fg: "text", bold: true })];
				const chip = gitChip();
				if (chip) pathParts.push(chip);
				const sessionName = sm?.getSessionName();
				if (sessionName) pathParts.push(paint("borderMuted", "•") + " " + paint("muted", sessionName));
				const line1 = truncateToWidth(pathParts.join("  "), width, paint("dim", "…"));

				// Line 2: budget -- how much context is left, and who is spending it.
				const autoCompact = pi.getSettings().compaction?.enabled !== false;
				const left = autoCompact ? `${contextBar()} ${paint("dim", "(auto)")}` : contextBar();
				const line2 = padBetween(left, modelLabel(), width);

				// Line 3: spend -- cumulative tokens, cost, and extension chips.
				// Each field keeps its own color: cache reads are the win, cache writes
				// are the premium, cost is the number you came for.
				const { totals, latestCacheHitRate } = sessionStats();
				const tokenParts: string[] = [];
				if (totals.input) tokenParts.push(field("↑", formatTokens(totals.input), "muted"));
				if (totals.output) tokenParts.push(field("↓", formatTokens(totals.output), "text"));
				if (totals.cacheRead) tokenParts.push(field("R", formatTokens(totals.cacheRead), "success"));
				if (totals.cacheWrite) tokenParts.push(field("W", formatTokens(totals.cacheWrite), "warning"));
				if (totals.cost) {
					const amount = totals.cost >= 1 ? totals.cost.toFixed(2) : totals.cost.toFixed(3);
					tokenParts.push(field("$", amount, "accent"));
				}

				const tokens = tokenParts.length ? tokenParts.join(" ") : paint("dim", `↑${NO_VALUE} ↓${NO_VALUE} $${NO_VALUE}`);
				const requestHitRate = latestCacheHitRate === undefined ? undefined : field("req ", `${latestCacheHitRate.toFixed(0)}%`, hitRateColor(latestCacheHitRate));
				const chips = renderChips(requestHitRate);
				return { location: line1, context: line2, tokens, cache_metrics: chips.cache, task_summary: chips.task, external_statuses: chips.external };
			},
		};
	};

	type Metrics = ReturnType<typeof buildMetrics>;
	let shared: { model: Metrics; refs: number } | undefined;
	const apply = (context: ExtensionContext) => {
		if (closed) return;
		const changed = ctx?.sessionManager !== context.sessionManager || sessionId !== context.sessionManager.getSessionId();
		ctx = context; sessionId = context.sessionManager.getSessionId();
		if (changed) {
			epoch++; git = null; gitFetchedAt = 0; gitInFlight = false;
			shared?.model.dispose(); shared = undefined;
		}
		if (context.mode !== "tui") return;
		// One business model, scan cache and branch subscription across all six independently leased items.
		const stamp = epoch;
		slots.forEach((slot, index) => {
			if (closed || stamp !== epoch || ctx?.sessionManager !== context.sessionManager) return;
			const factory = (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider | undefined) => {
				if (!footerData) throw new Error("Footer data unavailable");
				const state = shared ??= { model: buildMetrics(tui, theme, footerData), refs: 0 };
				state.refs++;
				let disposed = false;
				return {
					render(width: number) { return disposed ? [] : [state.model.render(width)[slot]]; },
					renderText(width: number) { return disposed ? "" : state.model.render(width)[slot]; },
					invalidate() { state.model.invalidate(); },
					dispose() {
						if (disposed) return; disposed = true;
						if (--state.refs === 0) { state.model.dispose(); if (shared === state) shared = undefined; }
					},
				};
			};
			clients[index].set(context, slot === "location" || slot === "context" ? { kind: "footer", factory } : { kind: "inline", factory });
		});
	};
	pi.on("session_start", (_event, context) => { apply(context); });
	pi.on("turn_start", (_event, context) => {
		if (closed) return;
		if (!ctx) apply(context);
		else if (ctx.sessionManager === context.sessionManager && sessionId === context.sessionManager.getSessionId()) ctx = context;
	});
	pi.on("session_shutdown", () => {
		closed = true; epoch++;
		for (const client of clients) client.dispose();
		shared?.model.dispose(); shared = undefined; ctx = undefined;
	});
}
