# Clarify status-bar cache metrics

## Goal

Make cache hit-rate scopes concise and unambiguous in the unified status bar without adding a line or depending on `pi-cache-optimizer`.

## Confirmed Facts

- `extensions/status-bar.ts` owns the three-line footer and renders both Pi usage totals and extension status chips.
- `R` and `W` are current-session cumulative cache-read and cache-write token totals.
- The existing `H` field is the latest request's cache-read hit rate, so placing it beside cumulative `R` and `W` makes its scope easy to misread.
- The `⛁` chip is parsed from the optional `pi-cache-stats` status published by `pi-cache-optimizer`; it represents that plugin's current-session aggregate percentage and cached/total input-token pair.

## Requirements

- Keep all cache-related metrics on the existing third status-bar line; do not add a line.
- Replace the ambiguous standalone latest-request `H…%` label with concise `req …%` wording.
- When the `pi-cache-stats` extension status is available, render the compact sequence:
  `… R… W… │ ⛁…% …/… · req …%`.
- When that extension status is unavailable, render normally without an empty chip or placeholder; show `req …%` whenever Pi has sufficient latest-request cache usage to calculate it.
- Preserve existing percentage coloring and width truncation behavior.
- Do not change the cache optimizer plugin, its status protocol, other footer lines, or unrelated status chips.

## Acceptance Criteria

- [ ] A session that has both Pi cache usage and a `pi-cache-stats` status shows the optimizer aggregate before the concise `req` latest-request rate on one third-line group.
- [ ] The third line contains no standalone `H` cache-hit-rate label.
- [ ] Without a `pi-cache-stats` status, the footer renders without a `⛁` placeholder and can still show the latest-request `req` rate when calculable.
- [ ] Existing cache status parsing, hit-rate colors, and narrow-width truncation remain functional.
- [ ] Focused automated coverage validates the present/absent optimizer cases and the latest-request label.

## Out of Scope

- Changing cache accounting, cache warming, or the `pi-cache-optimizer` extension.
- Adding persistent settings or a user-configurable status-bar layout.
- Redesigning the first or second footer line.

## Authorization

- User authorized creation of this lightweight task and planning.
- User approved the reviewed plan and authorized implementation.
## Execution Record

- Implementation: moved the latest-request rate out of the cumulative Pi token group; it now renders as `req …%` alongside the optional `⛁` aggregate chip. The absent-plugin path renders the `req` chip without a placeholder.
- Focused regression: `PI_CODING_AGENT_DIR=<temporary directory> node --test extensions/__tests__/status-bar.test.ts` — PASS (2 tests).
- Type check: `PI_CODING_AGENT_DIR=<temporary directory> pnpm typecheck` — PASS.
- Full suite: `PI_CODING_AGENT_DIR=<temporary directory> pnpm test` — PASS (1,593 tests).
- Self-review: reviewed the scoped diff and `git diff --check`; no unrelated product changes, whitespace errors, or spec update need found.
