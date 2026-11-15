# SDK Compatibility Boundaries

## 1. Scope / Trigger

SDK upgrades may change public imports, required render/exec fields, host fixture state and persistence semantics. Diagnose loader failures separately from product behavior before altering execution/UI owners.

## 2. Signatures

Import `Type`, `Static` and `TSchema` from host-provided `typebox`; keep `StringEnum` and AI utilities in `pi-ai`. `ExecResult.truncated: boolean` is independent of `killed`. Forward complete SDK `MessageRenderOptions`/`ToolRenderContext`, including injected `keyText` and `keyHint`; do not replace them with global hints in production.

## 3. Contracts

Keep schema JSON unchanged when changing its builder import. A validated tool boundary may accept `unknown` but must parse before capability effects; an SDK `StringEnum`/TypeBox inference mismatch is not permission to bypass validation.

Model tool schemas never use the JSON `null` type, including nested objects, numbers and booleans. Some providers encode a model's `null` as the string `"null"`, which passes a string branch as a real value. Every field stays required with `additionalProperties: false`; controls use two string sentinels from `extensions/shared/tool-arguments.ts`:

| Sentinel | Meaning | Builders |
| --- | --- | --- |
| `"null"` | Not applicable, nothing selected, unset | `sentinelString`, `nullableEnum`, `integerString(["null"])`, `nullableObject` |
| `"default"` | Use the configured or built-in default | `defaultableEnum`, `integerString(["default"])`, `sentinelString` with a defaultable spec |

Do not introduce per-field sentinels (`"none"`, `"all"`, `"tail"`, `"new"`) or use `""` as a sentinel. Former boolean controls are semantic enums whose field name is a dimension noun (`execution: foreground|background`), not a yes/no name with non-boolean values. Optional integers are decimal strings parsed with their original bounds; optional arrays use `[]`.

`parseControls()` separates sentinels from real values; each tool then applies branch rules: a field that does not apply to the current mode/action accepts only `"null"` (`rejectInapplicable`); a defaultable field that applies treats `"null"` and `"default"` alike; a required field rejects sentinels as missing (`requireValue`). Sentinels mean something only on declared control fields; elsewhere `"null"` is literal text. pi coerces JSON `null` to `"null"` before validation; direct parser calls with JSON `null` reject with a field-specific hint.

The convention covers model tool entry points only. Agent frontmatter, workflow `agent()` options, RPC and manager options and persisted configuration keep their own names; tool parsers map new fields to those contracts.

`preserveHandoff` temporarily suppresses only redundant writes equal to the live editor's displayed `getText()` or optional `getExpandedText()` during synchronous same-instance handoff. Distinct text forwards, and descriptor restoration returns normal `setText` behavior.

## 4. Validation / Failure Matrix

Required missing/undefined properties without defaults reject, including sentinel controls; a sentinel must be written explicitly, omission never supplies it. JSON `null`, `""` in a control, `"default"` in a nullable-only enum or integer field and any non-`"null"` value in an inapplicable field reject with the field name and the expected sentinel. Caller envelopes remain unchanged and refusals have zero origin/job effects.

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
