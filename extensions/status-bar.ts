import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// A unified three-line status bar that replaces pi's built-in footer.
//
// Why a custom footer instead of another `setStatus()` entry: pi renders every
// extension status on one shared line below the footer, so each extension that
// publishes one adds another line of unaligned text. Taking over
// `ctx.ui.setFooter()` is the only way to lay all of it out together.
//
// Conflict surface (checked against the installed package set):
//   - setFooter: nothing else uses it, so this extension owns the footer. If a
//     second extension ever calls setFooter, the last one to call it wins and
//     this layout silently disappears -- that is the only real conflict.
//   - setStatus: pi-cache-optimizer ("pi-cache-stats"), extensions/bg-tasks
//     ("background-jobs") and pi-pretty ("fff") publish statuses. The built-in
//     footer drew them; a custom footer must draw them itself or they vanish.
//     `renderChips()` below does that: known keys get a compact chip, unknown
//     keys fall through to their raw (sanitized) text so a newly installed
//     extension is never swallowed.
//   - setWidget: pi-subagents renders above the editor, not in the footer, so
//     it is unaffected.
//
// Layout (width permitting):
//   ~/tools/pi-trellis  main ●2 +1 ↑2   session name
//   ▰▰▰▰▰▰▱▱▱▱▱▱▱▱ 39% 157k/400k (auto)        mp-messages·claude-opus-5·medium
//   ↑112 ↓30k R5.3M W260k H83% $0.42   ⛁ 96% 1.2M/1.3M   ⚙ 2 jobs
//
// `H` is the hit rate of the latest request; ⛁ is pi-cache-optimizer's session
// running total, which is why it carries the token pair the percentage comes
// from.
//
// Before the first response nothing has a value yet, so the spend line draws a
// dim skeleton (`↑– ↓– $–  │  ⛁ –`) instead of collapsing to whichever single
// chip happens to exist -- a lone red `⛁0%` reads as an error when it only
// means "no requests yet".

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

/** Hit-rate coloring, shared by the H field and the cache chip. */
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
	let enabled = true;

	// Shared across footer instances so a session switch does not restart the
	// git poll from scratch.
	let git: GitState | null = null;
	let gitFetchedAt = 0;
	let gitInFlight = false;

	const refreshGit = async (cwd: string, onChange: () => void) => {
		if (gitInFlight) return;
		gitInFlight = true;
		try {
			const result = await pi.exec("git", ["status", "--porcelain=v2", "--branch"], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			});
			const next = result.code === 0 ? parseGitStatus(result.stdout) : null;
			const changed = JSON.stringify(next) !== JSON.stringify(git);
			git = next;
			if (changed) onChange();
		} catch {
			// Not a repo, git missing, or the call timed out: drop the git chip
			// rather than surfacing an error in the status bar.
			if (git !== null) {
				git = null;
				onChange();
			}
		} finally {
			gitFetchedAt = Date.now();
			gitInFlight = false;
		}
	};

	const buildFooter = (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider): Component & { dispose?(): void } => {
		const unsubscribe = footerData.onBranchChange(() => {
			// A ref change invalidates the counts too, so force the next render
			// to re-run git instead of waiting out the poll interval.
			gitFetchedAt = 0;
			tui.requestRender();
		});

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
		const divider = () => paint("borderMuted", "│");

		const gitChip = (): string => {
			if (!git?.branch) return "";
			const parts = [paint("accent", git.detached ? `⌀ ${git.branch}` : git.branch)];
			if (git.conflicts) parts.push(field("✖", String(git.conflicts), "error"));
			if (git.modified) parts.push(field("●", String(git.modified), "warning"));
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
		const renderChips = (): string[] => {
			// Cache first (it belongs with the token counts to its left), then the
			// rest alphabetically so chip order stays stable between renders.
			const statuses = [...footerData.getExtensionStatuses()].sort(([a], [b]) => {
				if (a === CACHE_STATUS_KEY) return -1;
				if (b === CACHE_STATUS_KEY) return 1;
				return a.localeCompare(b);
			});

			const chips: string[] = [];
			for (const [key, text] of statuses) {
				if (!text?.trim()) continue;
				if (key === CACHE_STATUS_KEY) {
					const { chip, percent } = parseCacheStatus(text);
					// `dim` for "no measurement yet" / "off": those states are not a
					// bad hit rate and must not borrow the error color.
					chips.push(paint(percent === null ? "dim" : hitRateColor(percent), chip));
					continue;
				}
				// Foreign text: `muted` rather than `dim` so a status that another
				// extension considers important stays readable.
				chips.push(paint("muted", sanitize(text)));
			}
			return chips;
		};

		return {
			dispose: unsubscribe,
			invalidate() {
				statsCache = undefined;
			},
			render(width: number): string[] {
				const sm = ctx?.sessionManager;
				const cwd = sm?.getCwd() ?? ctx?.cwd ?? process.cwd();

				// Kick the poll from render: the footer is the only consumer, so it
				// stops as soon as the footer stops drawing.
				if (Date.now() - gitFetchedAt > GIT_REFRESH_MS) {
					void refreshGit(cwd, () => tui.requestRender());
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
				if ((totals.cacheRead || totals.cacheWrite) && latestCacheHitRate !== undefined) {
					// `H` is the hit rate of the *latest* request, while the ⛁ chip is the
					// session running total -- the chip's token pair is what marks it as
					// cumulative. Single-letter label so it stays in the ↑ ↓ R W $ family.
					tokenParts.push(field("H", `${latestCacheHitRate.toFixed(0)}%`, hitRateColor(latestCacheHitRate)));
				}
				if (totals.cost) {
					const amount = totals.cost >= 1 ? totals.cost.toFixed(2) : totals.cost.toFixed(3);
					tokenParts.push(field("$", amount, "accent"));
				}

				// Groups are separated by a rule so the eye can tell pi's own numbers
				// from text that belongs to another extension.
				const groups: string[] = [];
				// Nothing spent yet: keep the line at its full shape with dim
				// placeholders, so the first response fills values in instead of
				// pushing a third line into existence.
				groups.push(tokenParts.length ? tokenParts.join(" ") : paint("dim", `↑${NO_VALUE} ↓${NO_VALUE} $${NO_VALUE}`));
				groups.push(...renderChips());

				const lines = [line1, line2];
				if (groups.length) lines.push(truncateToWidth(groups.join(`  ${divider()}  `), width, paint("dim", "…")));
				return lines;
			},
		};
	};

	// The footer component reads everything through `ctx` at render time, so the
	// context only has to be kept current -- the component itself is installed
	// once. `installed` keeps repeated events from rebuilding it (which would
	// drop the git cache and the branch subscription).
	let installed = false;

	const apply = (context: ExtensionContext, force = false) => {
		ctx = context;
		if (context.mode !== "tui") return; // setFooter is a no-op outside the TUI.
		if (installed && !force) return;
		context.ui.setFooter(enabled ? buildFooter : undefined);
		installed = true;
	};

	pi.on("session_start", async (_event, context) => {
		apply(context);
	});

	// After `/reload` the extension is re-instantiated without a fresh
	// session_start, so claim the footer at the next sign of life too.
	pi.on("turn_start", async (_event, context) => {
		apply(context);
	});

	pi.registerCommand("statusbar", {
		description: "Toggle the unified status bar (off restores pi's built-in footer)",
		handler: async (_args, context) => {
			enabled = !enabled;
			apply(context, true);
			context.ui.notify(enabled ? "Unified status bar enabled" : "Built-in footer restored", "info");
		},
	});
}
