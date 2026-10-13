# Subagents vendor and lifecycle research

Read-only research by trellis-research `60aeaea0-2f8a-46e`. Source prefix `P` below is `/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/@tintinweb/pi-subagents`. Parent directly verified P/package.json, P/src/agent-manager.ts:570–639 and 1108–1217, and P/src/index.ts:1070–1144. No product files changed, no actual pnpm check run.

## Exact artifact / vendor scope

- P/package.json identifies `@tintinweb/pi-subagents` `0.20.0`, repository https://github.com/tintinweb/pi-subagents.git, MIT. The researcher reports cached npm artifact gitHead `13106ab6f608b3acc54185da5299ee7fbaabb6b9`, integrity matching installed lock metadata, and 183 files byte-identical to installed artifact. Record tarball URL/integrity directly when copying; no source has been vendored yet.
- MIT notice is P/LICENSE:1–13; preserve it and provenance with copy layout and intentional deviations.
- Runtime entry is src/index.ts (P/package.json:62–65), not dist. Reported source inventory: 56 files, 20,938 lines, 915,711 bytes (~1 MB). Complete source includes workflow workers/UI/helpers; package is ~2.7 MB including dist.
- Runtime dependencies: croner ^10.0.1 and nanoid ^5.1.16. SDK peers >=1.1.0 and typebox *. Preset must provide actual runtime imports, not rely on upstream standalone install. SDK-link helper currently handles only @earendil-works/*; TypeBox development resolution needs explicit treatment.
- Source uses .js import specifiers targeting .ts files and parameter properties. Pi loads via its extension loader; repository node:test compatibility requires adaptation or a narrow loader boundary. The researcher reports a virtual relocated TS CompilerHost check with zero strict diagnostics, but that is not real checkout validation and does not prove native node import compatibility.
- npm artifact has no upstream tests/config despite Vitest scripts. Exact-commit upstream test retrieval remains open; repository tests must be offline node:test rather than adding an upstream test framework without reason.

## Detachment boundary

- Fresh foreground waits on spawnAndWait, spanning queue gate, worktree startup, child promise; cancellation propagates parent signal into manager abort (P/src/index.ts:2129–2251, P/src/agent-manager.ts:746–781,1041–1102). Foreground completion consumes the result to suppress completion notifications (manager:971–987).
- Detached launch omits parent signal; foreground/background pools differ and nested/workflow children are excluded from top-level slots (index:2030–2126, manager:97–162,550–575).
- Queued foreground cancellation listener currently remains attached after startup and cannot be removed by the running path alone (manager:579–610). Detach must cover queue, asynchronous worktree startup, running execution and completion races.
- Foreground resume uses a separate inline resumeAgent path without equivalent per-run controller/promise/pool wiring; normalize it for detachable waits rather than restarting the same agent (manager:1108–1298, index:1971–2027).
- get_subagent_result(wait:true) aborts the wait only, preserves task/result notification eligibility (index:2753–2809, abortable.ts:13–42). Startup may have status running but no record.promise; result wait must account for startup rather than incorrectly return early (manager:380–385,1078–1082).
- A safe detachable wait releases caller, removes parent links, retains task identity/activity/transcript hooks, changes background/consumption state and settles once. Flipping isBackground alone is insufficient: pool ownership is captured at startup and current foreground tool finally deletes activity and marks finished (manager:687–704,971–987; index:2237–2251).

## Shared panel / integration boundary

- Expose immutable agent/workflow task snapshots and lookup/subscription/control capabilities. Keep mutable records, controllers, promises, sessions and manager lifecycle inside the backend.
- Existing global/RPC surface is insufficient: no complete list/change/detach/workflow interface. created/onComplete notifications alone miss queue cancellations and owned workflow children (index:571–625,741–752,1350,2104; cross-extension-rpc.ts:99–196; manager:1409–1418).
- ConversationViewer has useful live/Markdown/scroll logic but currently owns overlay sizing/chrome, steering editor, Esc and two-press x. Do not embed it unchanged beneath a shared pane that owns Tab/Esc/x (ui/conversation-viewer.ts:158–289,481–499).
- Preserve workflow stop/pause/resume, child skip/retry/conversation through advanced detail or /agents; do not flatten into process semantics (ui/workflow-dialog.ts:283–343,677–1040; ui/workflow-menu.ts:69–136).
- Do not rely on upstream widgetMode off for shared footer counts: upstream also clears status and filters work; counts should come from adapter independently (ui/agent-widget.ts:322–330,561–611).

## Compatibility / safety

Preserve tools, workflows (pipeline/parallel/schema/gates/replay/control), scheduling, custom types, mentions, memory, nesting, steering/resume, worktrees, settings and usage unless a later explicit product decision changes scope. Existing /agents management UI is separate from the new shared task overview.

Upstream session_before_switch only clears selected completed records/stops scheduler; live and unconsumed records remain. Shutdown stops workflows/agents and fleet but has additional timer/group/widget cleanup risks (index:1090–1122). The user subsequently selected stopping all old session-owned execution on switch; implementation must replace this upstream behavior explicitly and test late-event isolation, queued starts, workflow workers and disk transcript preservation.

Original visibility complaint remains un-reproduced. Fleet intends rows before focus activation; startup/session eligibility and repaint/layout are hypotheses, not established bugs (ui/fleet-list.ts:204–260,307–361,457–487).

## Validation priorities

- Same identity/output and independent cancellation across detach.
- Queue/startup/resume/completion races; later parent Esc must not kill detached task.
- One inline result OR one completion path, never duplicate/lost notification; cancelled background wait stays eligible.
- Mixed panel immediate details, selected-only stop, keyboard/focus isolation, timer/subscription disposal and counts with old widgets disabled.
- Migration removes upstream registration, preserves wrapper-only discovery, and retains compatible configurations/management commands.

## Product decisions still open

- Agent foreground timeout resolved: manual-only detachment; elapsed time never auto-backgrounds agents. Existing bash timeout behavior stays unchanged.
- User resolved typed-input handoff: ordinary message submission must not detach shell/agent tasks; remove bg-tasks' input-owned detach/abort/resubmit and keep native Pi handling. Agent-targeted mentions/steering remain separately routed.
- Background pool accounting when an already-running foreground agent detaches.
- Workflow grouping resolved: hierarchical workflow groups expanded by default, with in-panel collapse/expand and immediate group/child detail. Terminal child retention and nested non-workflow hierarchy policy remain open.
- Session switch resolved: stop all old running/queued execution across backends and prevent cross-session notifications; preserve disk artifacts without task revival. Legacy widget/fleet option handling remains open.
