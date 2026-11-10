# SDK Compatibility Boundaries

## 1. Scope / Trigger

SDK upgrades may change public imports, required render/exec fields, host fixture state and persistence semantics. Diagnose loader failures separately from product behavior before altering execution/UI owners.

## 2. Signatures

Import `Type`, `Static` and `TSchema` from host-provided `typebox`; keep `StringEnum` and AI utilities in `pi-ai`. `ExecResult.truncated: boolean` is independent of `killed`. Forward complete SDK `MessageRenderOptions`/`ToolRenderContext`, including injected `keyText` and `keyHint`; do not replace them with global hints in production.

## 3. Contracts

Keep schema JSON unchanged when changing its builder import. A validated tool boundary may accept `unknown` but must parse before capability effects; an SDK `StringEnum`/TypeBox inference mismatch is not permission to bypass validation.

`preserveHandoff` temporarily suppresses only redundant writes equal to the live editor's displayed `getText()` or optional `getExpandedText()` during synchronous same-instance handoff. Distinct text forwards, and descriptor restoration returns normal `setText` behavior.

## 4. Validation / Failure Matrix

Required missing/undefined properties without defaults reject, including required-nullable controls; nullable means explicit `null` is allowed, not that omission supplies it. Caller envelopes remain unchanged and refusals have zero origin/job effects.

SDK1.5.1 failed persistent appends roll back entries/index/leaf. Preserve conservative unconfirmed handling for a non-atomic tolerated host rather than assuming every host rolls back.

## 5. Good / Base / Bad Cases

- Base: fixtures return `{ code: 0, stdout: "", stderr: "", killed: false, truncated: false }`.
- Good: a host handoff passes expanded collapsed-paste text but leaves the live cursor/paste/history intact.
- Bad: add schema defaults for required fields to make stale tests pass, or globally ignore repeated `setText` after the handoff lease ends.

## 6. Tests Required

Actual SDK editor/reset/overlay/Footer fixture hosts provide their dialog/overlay registries and delegate to SDK methods, never copy their algorithms. Runtime quit `dispose()` must wait for `modelRuntime.settleCredentialWrites()` after abort/shutdown/session disposal; replacements preserve their actual ordering without that wait.

Exercise public loader/schema identity, required refusal/nonmutation/zero effects, handoff rollback/restoration, actual atomic EISDIR rollback and separately identified non-atomic fake-host protection. Concrete coverage lives in `agent-tasks/__tests__/tool-waits.test.ts`, `worktree-lifecycle.test.ts`, `beautify/__tests__/editor.test.ts`, `task-ui/__tests__/sdk-runtime.test.ts`, the registered Process/Memory scalar suites and `session-assist/recap/__tests__/sdk-runtime.test.ts`. See [testing](../testing/index.md) for isolation and evidence boundaries.

## 7. Wrong vs Correct

Wrong: suppress a real collapsed-paste regression by adjusting cursor expectations or use an external Type export shim as acceptance.

Correct: adapt the transient public-text guard, retain the failing state-preservation assertions, and pass the installed SDK's unshimmed checks plus natural-exit lifecycle suites. These are not physical terminal/IME or bundled-launcher acceptance.
