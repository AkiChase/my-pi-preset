# Herdr State Extension Contract

## 1. Scope / Trigger

Use this contract when changing `extensions/herdr-state.ts`. It is a top-level Pi package extension that directly reports Pi lifecycle and explicit human-attention state to a Herdr-managed pane. It must not become a compatibility bridge for a separately installed legacy reporter or a generic terminal-host abstraction.

## 2. Signatures

```text
Environment: HERDR_ENV=1, HERDR_SOCKET_PATH=<nonempty>, HERDR_PANE_ID=<nonempty>
Methods: pane.report_agent_session, pane.report_agent
States: working | blocked | idle
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

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing/incomplete Herdr environment | Do not create a reporter or register state side effects. |
| Non-TUI session | Do not report a pane state. |
| Missing/relative session file with valid ID | Use `agent_session_id`. |
| Missing both path and ID | Omit the session report rather than inventing values. |
| Socket creation/write/error/timeout/rejected seam | Swallow the failure; retain Pi lifecycle behavior. |
| Malformed questionnaire event | Ignore it. |
| Nested questionnaire end before all starts close | Keep Blocked until the counter reaches zero. |
| Shutdown before initial session send resolves | Do not publish the deferred initial state. |

## 5. Good / Base / Bad Cases

- **Good:** a TUI session starts busy, then opens an input dialog → report `working`, then `blocked` with its title.
- **Good:** two questionnaire mounts overlap → one blocked lifecycle remains until the second release.
- **Base:** Pi runs in print mode or without a Herdr pane → no network side effect.
- **Good:** a socket is unavailable → requests may fail, but the Pi handler returns normally.
- **Bad:** emit a private event for another local extension to perform the socket request → this splits ownership and creates installation coupling.
- **Bad:** leave a cmux/other-host fallback in this extension → it changes the integration contract and duplicates unrelated host behavior.

## 6. Tests Required

`extensions/__tests__/herdr-state.test.ts` must drive a typed fake `ExtensionAPI` and injected transport seam to assert:

- session/path-or-ID payloads, direct protocol methods, sequence-bearing states, and Windows endpoint/path behavior;
- working/blocked/idle transitions for agent lifecycle and standard prompts;
- questionnaire label, overlap counting and generic-custom-UI silence;
- transport rejection, non-TUI silence, state coalescing, shutdown/late-event fencing, and shutdown during pending startup;
- package manifest discovery plus user-document links after entry/page rename.

Use the current installed Herdr template as protocol comparison evidence; do not test with a real personal pane, reload, or destructive user-directory prune unless separately authorized.

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
