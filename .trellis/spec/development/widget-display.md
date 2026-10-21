# Shared Widget and Footer Display

## Registration

Declare built-in persistent content in `extensions/shared/widget-display/contracts.ts` using `GROUPS` and `ITEMS` (`REGISTRY` combines them). The hierarchy is **region → group → item**:

- A region selects the host surface: `aboveEditor`, `belowEditor`, or preset-internal `footer`. Never pass `footer` to SDK widget placement.
- A group declares its region, region-local `order`, and `layout`. Inline groups also declare `overflow` (`wrap` or `truncate`) and `separator`.
- An item declares its group and group-local `order`. Several plugins may share a group through distinct items; each item has one active publishing lease. Unknown items and competing owners are rejected.

Create one `createWidgetClient(pi, item)` per owned item inside the consumer activation. Publish through `client.set(ctx, content)`, withdraw with `undefined`, and retire with `client.dispose()`. Consumers do not override group layout or pass arbitrary priorities. Ordering is not a narrow-screen retention priority.

Only `extensions/shared/widget-display/owner.ts`, loaded by `extensions/widget-display.ts`, may reference the host `setWidget` and `setFooter` setters in production expressions. Missing shared ownership is publication failure, never permission for direct setter fallback.

## Composition

Above-editor groups order Recap before Trellis. Footer groups order location → context → usage → Agent/workflow overview. The usage inline group orders tokens/cost → cache metrics → task summary → compatible external statuses. No built-in content currently uses belowEditor; retain the region capability without placeholders.

Block items render vertically and may return multiple lines. Preserve component wrapping, invalidation and width-safe output; do not globally truncate block output. Inline content uses the typed `kind: "inline"` factory and `renderText(width)` fragment interface; arbitrary component rows are not horizontal fragments. Explicit line breaks and external terminal controls (including BEL- and ST-terminated OSC sequences) are sanitized at the fragment boundary while supported ANSI styling is preserved. Empty detection uses visible text, so ANSI-styled whitespace does not add a separator. Separators and overflow styling use the current theme. The group owns separators and overflow, using SDK ANSI/Unicode helpers. Empty items leave no separator; empty groups occupy no rows. Group boundaries add no blank rows.

Usage defaults to truncation, preserving its existing narrow-screen behavior. Wrap remains an explicit supported inline capability. Pi 1.3.0 native Footer joins `setStatus` values and truncates; SDK `Text` wraps. Do not conflate those behaviors or remove native component multiline support.

Footer-specific factories receive the public `ReadonlyFooterDataProvider` from the shared host factory. Keep business calculation/caches in consumers, not the composition layer; do not duplicate session scans or branch subscriptions per fragment. Preserve unknown third-party `setStatus` text through the compatible external-status item, without treating external keys as new registered items.

## Ownership and Modes

Bind leases to activation, sessionManager object and session ID. Consumers retain their own content validity checks. Stale contexts, late factories and retired clients cannot replace or withdraw newer content; updating one item must not rebuild unrelated components. Isolate factory/render/invalidate/dispose failures.

The actual SDK disposes a custom Footer when replacing it. Use that ownership signal to retire the old surface: later third-party takeover must not be cleared or reclaimed by stale refresh/shutdown. Reset and session transitions must be regression-tested against the installed SDK; do not use private widget maps or layout containers.

Footer components are TUI-only. Preserve existing RPC text widgets in aboveEditor/belowEditor; reject unsupported factories and Footer publication, without moving content to another region. Display failures do not change task execution or saved content.

Public components receive width, not allocated dock height. Agent overview conservatively limits roots to at most five rows plus a hidden-count row using total terminal height; extreme host clipping is still possible. Do not expand private compatibility seams to obtain dock height.

This layer does not own Header, messages, pending input, Working indicators, editor or overlays. It does not reorder unintegrated third-party widgets or rewrite their content. The unified Footer has no `/statusbar` user switch.
