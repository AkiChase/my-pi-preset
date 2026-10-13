# bg-tasks interaction research

Read-only research by trellis-research `85d4b974-af18-44c`. Parent verified `extensions/bg-tasks/ui.ts`, `shortcuts.ts`, `input.ts`, and `lifecycle.ts:250–339` directly. No code or tests changed/run.

## Behavior to align

- Foreground bash exposes detachable launch slots. `ctrl+shift+b` / `/bg` releases every active foreground launch without aborting the parent turn (`lifecycle.ts:263–305`). The process/log continue and the tool returns a background ID/path (`tools/bash.ts:198–209,281–289`).
- Early detach is currently delayed by the first two-second race (`tools/bash.ts:182–195,253–279`); do not treat that delay as an intended new UX contract.
- Turn cancellation stops a newly launched foreground process unless it already detached (`tools/bash.ts:166–179`). Cancelling `jobs attach(wait:true)` releases the wait only (`tools/jobs.ts:295–323`). The panel itself has no wait/attach action.
- Typed non-extension input currently detaches foreground launch slots before aborting the parent and resubmitting a follow-up (`input.ts:8–33`). User subsequently chose explicit-only handoff, so this input interception must be removed; ordinary messages stay on native Pi handling. Existing behavior is baseline evidence, not the new contract.
- Footer only counts background shell/monitor tasks (`registry.ts:81–103`). One dual-column overlay opens from Shift+Down or /bg-list. Repeated opens are ignored. Immediate details, Tab focus, list/output navigation, x silent selected stop, c absolute log-path copy, Esc close (`ui.ts:61–63,89–127,148–223`).
- Panel rows linger four seconds; selected metadata is retained without runtime hooks across roster/sweep. Registry expires metadata after ten minutes, sweep each minute, no proactive log deletion (`ui.ts:13–22,73–83`, `registry.ts:58–79`, `types.ts:17–19`).
- Ordinary background completion delivers visible waking message; deliberate stop suppresses final notification. Active attaches suppress completion, cancelled waits restore notification eligibility (`notify.ts:85–96,149–196`, `lifecycle.ts:194–207`, `tools/jobs.ts:275–308`).
- Session replacement/shutdown closes overlay, stops timers, silently stops jobs; replacement clears state (`index.ts:109–148`).

## Shared-panel boundary

Current `BgTaskPanel` directly depends on `BackgroundRegistry`, `Job`, process termination, statSync and readLogSlice. A mixed panel must use source adapters rather than cast agent sessions to shell Jobs. Share task identity/read models, panel selection/focus/scrolling, entry/shortcut ownership and foreground-wait coordination; preserve each backend's execution, stopping, logs/session resources and retention.

SDK keeps the later extension shortcut for duplicate chords and warns (`pi-coding-agent/dist/core/extensions/runner.js:449–477`). Catching registration errors cannot coordinate duplicate shortcuts. One owner must dispatch Shift+Down and detach across both backends. Avoid upstream raw listeners consuming shared overlay keys; terminal listeners precede focused components (`pi-coding-agent/dist/modes/interactive/interactive-mode.js:2017–2059`).

## Validation templates

Existing UI tests cover immediate detail/focus/tail-follow/selected stop/disposal (`__tests__/ui.test.ts:38–200`). Foreground survival (`bash-survive.test.ts:43–77`), all-slot control (`take-control.test.ts:32–80`), concurrent wait suppression (`jobs.test.ts:164–209`), notification tests (`notify.test.ts:166–268`), footer visibility (`progress.test.ts:77–104`) can be extended to mixed providers without invoking real models.

## Exclusions and cautions

The source-observed `jobs attach(wait:false)` feedback/notification-consumption edge case is not an intended parity requirement. Monitor-wake task owns progress wake/batching and explicit-stop pending output handling; leave stream behavior outside this UI task. Preserve README/AGENTS preexisting work and current explicit extension manifest.

## Product decisions remaining

One shared panel, context-sensitive Esc, manual-only agent detachment, stopping old session-owned work, and no input-triggered detachment are now approved. Still choose feature compatibility, child/workflow visibility and agent retention/navigation depth.
