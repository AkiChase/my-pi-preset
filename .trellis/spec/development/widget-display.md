# Shared Widget Display

## Registration

Declare each built-in editor-region widget in `extensions/shared/widget-display/contracts.ts`'s `SLOTS`, with its region and order. Create one `createWidgetClient(pi, slot)` inside the consumer's extension factory; publish through `client.set(ctx, content)`, withdraw with `undefined`, and retire with `client.dispose()`.

Only `extensions/shared/widget-display/owner.ts`, loaded by `extensions/widget-display.ts`, may call host `ctx.ui.setWidget`. Consumers must not bypass it, including when the owner is unavailable.

## Ordering and ownership

Above-editor slots place Recap before Trellis; foreground hints remain below the editor. Updating content must not change slot order or rebuild unrelated slot components. Empty slots do not occupy space.

Consumers retain their own content validity checks. Withdraw only owned content; stale sessions and retired clients must not affect current publication. Use the current session context, not an import-time global UI owner.

This layer manages editor-region widgets only, not status, header, footer, editor, messages or overlays. It does not control unintegrated third-party widget ordering or modify their content.
