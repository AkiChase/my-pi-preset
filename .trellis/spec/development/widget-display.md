# Shared Widget Display

## Registration

Declare each built-in editor-region widget in `extensions/shared/widget-display/contracts.ts`'s `SLOTS`, with its region and order. Create one `createWidgetClient(pi, slot)` inside the consumer's extension factory; publish through `client.set(ctx, content)`, withdraw with `undefined`, and retire with `client.dispose()`.

Only `extensions/shared/widget-display/owner.ts`, loaded by `extensions/widget-display.ts`, may call host `ctx.ui.setWidget`. Consumers must not bypass it, including when the owner is unavailable.

## Ordering and ownership

Above-editor slots place Recap before Trellis; the read-only Agent/workflow root overview uses the below-editor `agent_overview` slot. Updating content must not change slot order or rebuild unrelated slot components. Empty slots do not occupy space.

Public widget components receive `render(width)`, not the dock's allocated height. The Agent overview conservatively limits rows using total terminal height (at most five task rows plus a hidden-count row); this is not a guarantee against the host's further clipping in an extremely crowded editor dock. Do not widen the internal compatibility seam or bypass the central publisher to obtain height.

Consumers retain their own content validity checks. Withdraw only owned content; stale sessions and retired clients must not affect current publication. Use the current session context, not an import-time global UI owner.

This layer manages editor-region widgets only, not status, header, footer, editor, messages or overlays. It does not control unintegrated third-party widget ordering or modify their content.
