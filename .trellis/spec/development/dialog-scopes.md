# Owned Dialog Scopes

## 1. Scope / Trigger

Use `extensions/shared/interaction/dialog.ts` for consumer-called multi-step native dialogs that share cancellation and ownership. Create one owner per business purpose inside a factory. Do not add a Pi entry, global lifecycle subscriptions or domain configuration to the library. Overlay ownership stays in `overlay.ts`.

## 2. Signatures

- `createDialogOwner(): DialogOwner`
- `owner.run<T>(ctx, { isCurrent, signal?, onSettled? }, callback): Promise<InteractionResult<T>>`
- `owner.cancel(): void`
- Callback scope: `signal`, `isCurrent()`, `checkpoint()`, `select(title, options, {timeout?}?)`, `input(title, placeholder?, {timeout?}?)`, `confirm(title, message, {timeout?}?)`.
- `InteractionResult<T>` lives in `result.ts`; overlay re-exports it for existing imports.

## 3. Contracts

Each run replaces its owner's previous execution. Every dialog checks admission before and after the host wait and inherits the execution signal. Native steps return values directly; the complete flow returns a tagged result. Owner cancellation and replacement retire the execution; retired cleanup cannot clear a replacement.

Consumers choose invalidation events and must call cancel for prompt wait release. A predicate alone cannot signal changes while nothing is progressing. Predicates, signal abort listeners and notifications can synchronously reenter run/cancel: recheck identity after predicates, and perform no old-flow work after a reentrant terminal notification.

`onSettled` is synchronous, current-slot and domain-admission guarded. It owns domain settlement only, not runtime cleanup. Retired scopes reject subsequent steps/checkpoints. Cancel releases waits and observes late rejections; it cannot preempt arbitrary callback code or undo writes. Checkpoint after non-dialog awaits and before effects. Preserve save-internal admission when provided; it is not a transaction.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| select/input returns undefined | cancelled |
| input returns empty string | normal value; domain validates it |
| confirm returns false | normal false; Esc cannot be distinguished from refusal |
| cancel/replacement/external abort/false admission | stale |
| no UI or requested dialog method missing | unsupported |
| ordinary host/business/admission/hook exception | error, unless already retired |
| normal callback return | completed |

Do not classify arbitrary AbortError as cancellation. Private per-execution exits end the flow; swallowing one cannot restore success or revive the scope. Do not put broad business catch handlers around dialog steps.

## 5. Good / Base / Bad Cases

Base: a single select callback uses a factory-local owner. Good: multi-step configuration uses direct scope results, local validation, checkpoint and fresh selected-field patch saving. Keep naming request cancellation independent from configuration ownership. Bad: manually duplicate per-step signal/admission or infer confirm cancellation from false.

## 6. Tests Required

Run shared `dialog.test.ts` and `sdk-dialog.test.ts`, affected consumer suites and typecheck under isolated configuration. Assert current-only settlement, synchronous predicate/abort/notification reentry, old cleanup versus new run, late rejection observation, cancel before/after host resolution, retired steps, empty input, false confirmation, unsupported and ordinary errors. Installed SDK native dialog tests establish signal/result/component cleanup, not real terminal appearance. See [testing guidelines](../testing/index.md).

Consumers: Recap preserves model/auth revalidation, fresh patch saves and current-only scheduling; Session Name preserves quota/title ownership, manager/session fences, selected-field fresh saves, malformed refusal and independent request cancellation.

## 7. Wrong vs Correct

Wrong: `await flow.select(...); catch { /* ignore */ }; saveOldSnapshot()`.

Correct: handle the full run result at its boundary; use `flow.checkpoint()` before saving and a store's admitted callback where available. Save a selected-field patch onto freshly validated configuration, not an old whole-file snapshot.
