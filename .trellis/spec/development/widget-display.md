# Shared Widget Display

## Required owner and boundaries

`extensions/widget-display.ts` loads the factory in `extensions/shared/widget-display/owner.ts`. The owner alone publishes the two preset host widgets, one per `aboveEditor`/`belowEditor` region. Built-in consumers use `createWidgetClient(pi, slot)` and must not call host `ctx.ui.setWidget` directly. Recap, Trellis and foreground hints are being migrated together; the owner does not manage status, header, footer, editor, messages or overlays.

Declare new built-in widgets in `contracts.ts`'s `SLOTS`: region and ordering belong to the central registry, not arbitrary consumer priority values. Recap precedes Trellis within the above-editor composite regardless of publication or refresh order. Foreground hints remain below the editor. Empty regions are removed; do not keep an invisible placeholder to manipulate host insertion order.

## Consumer contract

Create one client per factory activation. Publish using the current `ExtensionContext`; use `undefined` to withdraw content and `dispose()` to retire the client. A boolean false means unavailable, retired or unsupported; never fall back to direct host widget publication. Consumers retain their own request/material/backend validity and must not publish stale results. Content can be text lines or a synchronous component factory; factories are TUI-only, RPC supports text lines, and print/JSON publishes nothing.

The session manager object and session ID jointly identify a session. Leases bind a slot to one consumer activation and owner generation. Cross-extension communication uses the public versioned event bus protocol with synchronous acknowledgement, not facade object identity or an import-time global UI singleton. Independent loader graphs and event buses must remain isolated. No unbounded queue when the owner is absent.

## Lifecycle and rendering

Owner/client admission closes before cleanup. Setter, factory and dispose callbacks can reenter session changes/shutdown: recheck origin, generation and content revision before installation; obsolete cleanup must not clear a newer publication. Dispose at most once, isolate cleanup/sink failures and release event subscriptions on runtime retirement. Do not close on cancellable before-switch alone.

A slot update must not reconstruct unrelated components or change slot order. Rendering uses host theme and terminal width semantics, without I/O or external state lookup. Preserve the SDK's text-line padding/truncation and existing consumer behavior; verify narrow widths, Unicode and theme invalidation. Do not access the SDK's private widget Maps/containers or wrap third-party `setWidget` methods.

The composite's position relative to unintegrated third-party widgets still depends on Pi insertion order. Guarantee internal built-in ordering only; never delete or republish third-party widgets to force position.

## Checks

See [testing guidelines](../testing/index.md). A production source-boundary test must reject direct host `setWidget` calls outside the shared owner after all consumers are migrated. The migration checkpoint and any temporary exceptions must be explicit, never imply that legacy consumers already comply.
