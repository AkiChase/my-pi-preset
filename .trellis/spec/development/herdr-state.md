# Herdr State Extension Contract

## 1. Scope / Trigger

Use this contract when changing `extensions/herdr-state.ts` or its nested core helper. The top-level Pi package extension owns Herdr TUI's direct socket reporting and herdr-core's explicit questionnaire attention supplement. It must not become a compatibility bridge for a separately installed legacy reporter or a generic terminal-host abstraction.

## 2. Signatures

```text
Herdr TUI environment: HERDR_ENV=1, HERDR_SOCKET_PATH=<nonempty>, HERDR_PANE_ID=<nonempty>
Socket methods: pane.report_agent_session, pane.report_agent
Socket states: working | blocked | idle
Core environment: HC_TERMINAL_ID=<nonempty>, HC_TERMINAL_SOCKET=<nonempty>
Core receiver: public tui.terminal.setProgramStatus(status: ProgramStatus)
Native states: idle | working | blocked | done | error | clear
Optional questionnaire events: rpiv:ask-user:prompt, rpiv:ask-user:blocked
```

The extension is active only for TUI sessions. It loads through the package's `extensions/*.ts` manifest pattern.

## 3. Contracts

- `pane.report_agent_session` and `pane.report_agent` carry `pane_id`, `source: "herdr:pi"`, `agent: "pi"`, and a monotonically increasing activation-local `seq`.
- Prefer an absolute session file path (`path.posix.isAbsolute` or `path.win32.isAbsolute`); otherwise use a nonempty session ID. Do not emit a fabricated reference.
- Reported state priority is `blocked` > `working` > `idle`.
- Standard non-custom Pi prompts block. Generic custom UI remains quiet; an active `rpiv:ask-user:blocked` lifetime marks the question as blocked and supplies the first question's sanitized header/question label.
- The reporter uses short socket attempts and one retry. Every transport, parse, callback, or reporter failure is fail-open: Pi lifecycle, tools, and UI must continue.
- Mutable sequence/session/pending state belongs to one extension factory activation. Shutdown fences late events and async startup completion; no later state is published after shutdown.
- Windows uses Herdr's named-pipe endpoint spelling. No non-Herdr terminal CLI, host adapter, or private cross-extension blocked event is part of this contract.
- Complete Herdr TUI environment takes precedence over core; incomplete pane environment may select a complete core environment. Core helpers live below `extensions/herdr-state/`, never as independently discovered entries.
- Core leaves Pi's lifecycle reporter, environment overrides, encoding, negotiation and replay intact. Capture the public terminal with an immediately completed, unmounted `ctx.ui.custom` factory, not editor-focus polling, stdout interception or a private cache getter.
- A core activation starts with an unknown native snapshot. Only an actual native setter call arms it; initial Idle may predate extension binding and native dedup may suppress replay. Never guess Idle or borrow a previous activation's snapshot. Existing waits across reload are not retroactively guaranteed.
- Core forwards native statuses unchanged without attention and preserves native Blocked kind/message. Explicit peer waits merge Blocked/kind=question with the earliest active wait's sanitized label; release restores the latest complete native value, including Done/Error. Clear passes through and invalidates the snapshot; release/shutdown must not resurrect it.
- Named peer IDs are nonempty strings: repeated begin/end is idempotent; unknown ends cannot release another ID. Interleaved and late labels stay associated with their ID. Anonymous legacy events use a separate bounded counter/ordered slot, not named-wait release. Unmatched label storage is bounded.
- Core capture, descriptor lease and subscriptions belong to the current session activation. Partial setup and synchronous reentry release acquired resources; shutdown wins late capture. Restore only a still-owned descriptor/status; a retired wrapper retained by a later owner only forwards native calls and clears its attention/snapshot resources. Publication rejection can follow synchronous shutdown, a newer native update or later ownership: before fallback, recheck admission, current descriptor and snapshot identity. Never send a cleared snapshot or overwrite the newer value.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/incomplete environments | Do not create a reporter or register state side effects. |
| Non-TUI session | Do not report a pane state. |
| Missing/relative session file with valid ID | Use `agent_session_id`. |
| Missing both path and ID | Omit the session report rather than inventing values. |
| Socket creation/write/error/timeout/rejected seam | Swallow the failure; retain Pi lifecycle behavior. |
| Malformed questionnaire event | Ignore it. |
| Nested questionnaire end before all starts close | Keep Blocked until the counter reaches zero. |
| Shutdown before initial session send resolves | Do not publish the deferred initial state. |
| Core capture/preflight/subscription failure | Keep native reporting; release partial ownership, no raw OSC fallback. |
| Native baseline unknown | Record new explicit attention but do not fabricate a status before a real setter call. |
| Native Blocked or clear | Preserve native priority; clear invalidates the snapshot. |
| Malformed peer ID, duplicate/unknown end | Ignore it without releasing another named or anonymous owner. |
| Later descriptor owner or shutdown during setup | Do not replace the later owner; retire old delegates and release late acquisitions. |
| PI_PROGRAM_STATUS=0 or unsupported terminal | No extra OSC; original terminal negotiation remains authoritative. |

## 5. Good / Base / Bad Cases

- **Good:** a TUI session starts busy, then opens an input dialog → report `working`, then `blocked` with its title.
- **Good:** two questionnaire mounts overlap → one blocked lifecycle remains until the second release.
- **Base:** Pi runs in print mode or without a Herdr pane → no network side effect.
- **Good:** a socket is unavailable → requests may fail, but the Pi handler returns normally.
- **Bad:** emit a private event for another local extension to perform the socket request → this splits ownership and creates installation coupling.
- **Bad:** leave a cmux/other-host fallback in this extension → it changes the integration contract and duplicates unrelated host behavior.
- **Good:** native Error arrives while a core question is open → retain questionnaire attention, then restore the exact Error/message on release.
- **Base:** a receiver is installed after initial native Idle → no fabricated snapshot; the next actual Working update arms the supplement.
- **Bad:** disable Pi's native reporter and duplicate compaction/login/outcome logic, or read its private lastReport to claim hot-loaded wait coverage.

## 6. Tests Required

`extensions/__tests__/herdr-state.test.ts` must drive a typed fake `ExtensionAPI` and injected transport seam to assert:

- session/path-or-ID payloads, direct protocol methods, sequence-bearing states, and Windows endpoint/path behavior;
- working/blocked/idle transitions for agent lifecycle and standard prompts;
- questionnaire label, overlap counting and generic-custom-UI silence;
- transport rejection, non-TUI silence, state coalescing, shutdown/late-event fencing, and shutdown during pending startup;
- package manifest discovery plus user-document links after entry/page rename.

Use the current installed Herdr template as protocol comparison evidence; do not test with a real personal pane, reload, or destructive user-directory prune unless separately authorized.

Core tests in `extensions/herdr-state/__tests__/core-state.test.ts` and `core-sdk.test.ts` must verify ID pairing, priority, complete native restoration, clear, unknown baseline, descriptor/later-owner/reentry and partial/late setup cleanup. SDK introspection is test-only: drive the actual installed ProgramStatusReporter and ProcessTerminal, not copied lifecycle algorithms. Prove delayed support and restart replay retain merged/native cache values, disabled/unsupported silence, and natural cleanup of listeners without force-exit. Restart can retain outstanding DA query debt; settle the correct number of sentinels rather than weakening unsupported-terminal assertions.

Protocol fixtures are not Pi/rpiv end-to-end evidence. For accepted real-terminal tests, use unique scratch core/Pi config and offline providers with explicit extensions; verify normal new-model questionnaire, reload/next run, original dialog priority, generic-custom silence and actual process exit. Record versions, commands, failures/reruns and unrun third-party/online limitations in the task, not here.

## 7. Wrong vs Correct

### Wrong

```ts
pi.events.emit("herdr:blocked", { active: true, label });
```

A separate hand-placed extension now owns the socket state, so the preset cannot provide a complete integration by itself.

### Correct

```ts
const reporter = createHerdrReporter();
if (reporter) watchHerdrState(pi, reporter);
```

The package extension owns both attention tracking and its direct, fail-open Herdr transport.
