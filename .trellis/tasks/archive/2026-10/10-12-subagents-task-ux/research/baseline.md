# Baseline and prior UX decisions

## Repository snapshot

Planning began with preexisting changes to AGENTS.md and README.md and untracked .cursor/, .gitattributes, .pi/, and .trellis/. Preserve unrelated edits. Product source has not been changed for this task.

## Current documented bg-tasks contract

`README.md:264–321` describes:

- Footer-only counts for background shell tasks and monitors; no permanent above-editor task block. Foreground bash is excluded and gets a detach hint after two seconds.
- `ctrl+shift+b` / `/bg` detaches; `shift+down` / `/bg-list` opens one dual-column overlay.
- Selection immediately shows detail/output, without Enter or another dialog. Arrows/j/k move list or scroll output; Tab switches focus; x stops selected task, c copies the log path, Esc closes the overlay.
- No retry, deletion, or log cleanup buttons.
- Terminal rows disappear after four seconds except the selected detail retained for that panel instance. Registry retention is ten minutes, swept once a minute; disk logs are not proactively deleted.
- Documented keys are configurable in bg-tasks.json; Ctrl+B is intentionally not registered because of the built-in editor action.

These are documentation anchors, not substitutes for the separate source/test investigation.

## Historical decisions retrieved

Read-only `trellis mem context 01a12e7e-eab --grep "ctrl+shift+b" --turns 2 --around 0 --max-chars 8500` retrieved a prior implementation summary and review briefing for the bg-tasks redesign. Session `01a12e7e-eab2-76ee-9bdb-f973ae456112` describes one themed dual-column overlay, immediate details, scoped keys rather than a persistent keyboard listener, selection identity surviving roster shrink, explicitly bounded output, and disposal on session replacement/shutdown. This confirms why the existing design changed away from nested select/editor flows. Current source/tests remain authoritative.

## Adjacent task boundary

`.trellis/tasks/10-12-monitor-wake/prd.md` is independently planning monitor event batching, inactivity wakeups and explicit-stop notifications. It explicitly excludes task UI/widgets/shortcuts. This task should not change monitor stream delivery or conflate UI unification with event-wake changes.

## Workflow/spec caveat

The current AGENTS.md and some .trellis/spec/preset documents disagree about whether custom AGENTS rules remain or have moved into specs. Follow the actual project instructions supplied in AGENTS.md for this task; do not edit workflow infrastructure to reconcile this unrelated discrepancy.

## Outstanding product decision

Separate execution engines/plugins are approved. A shared panel/entry versus two panels with matching controls is not yet approved. The visual complaint about rows appearing only after Down/Left remains a user report, not a reproduced rendering defect.
