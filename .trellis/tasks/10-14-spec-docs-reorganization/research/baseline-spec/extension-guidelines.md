# Extension Development Guidelines

## Entry Points and Dependencies

- Keep one top-level `extensions/<name>.ts` entry per independent extension. Put helpers and tests in nested directories. `package.json` declares `extensions/*.ts`; nested `index.ts` files are libraries, not separately discovered entries.
- Preserve the manifest regression in `scripts/pi-manifest.test.mjs`. Declare any shipped skills, prompts, or themes explicitly; a manifest disables convention discovery for undeclared resource types.
- Use host-provided SDK imports and public contracts. Verify exact installed declarations and behavior before implementation; an import working under Node does not prove it works under the host loader.
- An authorized internal compatibility seam must be narrow, documented in the plugin's `docs/` page, guarded at runtime, and covered by actual-host regression tests. Do not silently expand it or modify the SDK.

## Tools, Events, and State

- Keep one execution owner for each tool. Rendering adapters must not re-register execution or change model-visible results merely to change appearance.
- Validate schemas and untrusted input before effects. Report failed operations through the actual tool error contract, not successful text describing an error. Bound model output and expose truncation and continuation clearly.
- Separate execution state, result delivery, and UI snapshots. Ending a wait is not stopping execution; reporting a terminal state is not proof that a process or promise exited.
- Scope mutable state to one factory activation or operation. Avoid import-time mutable singletons. Capture origin identity for asynchronous work and recheck it after awaits and before side effects.
- Treat optional integrations as optional: gate by capability/environment, isolate sink failures, and preserve ordinary behavior when absent.
- Before extracting shared logic, identify its actual owner and semantics. Share behavior that must stay consistent, not superficially similar parsing or state with different meanings.

## Lifecycle and Resource Ownership

- Do not start long-lived processes, watchers, sockets, or timers in the factory. Embedded loading may occur without a session. Start resources in the owning session/command/tool operation.
- Every process, listener, timer, worker, dialog, and pending callback needs a cleanup owner. `unref()` is not disposal.
- Close admission and old notifications before cancelling waits and stopping execution. Cleanup must be idempotent, isolate individual failures, and retain the owner of any late cleanup.
- Partial setup failure must release resources already created, not merely remove a registry entry. Synchronous callbacks may reenter shutdown; recheck admission and identity after publishing or wiring callbacks.
- A cancellable before-switch event is not final shutdown. Do not permanently dispose a still-active session when switching is cancelled.
- Never revive a closed activation, reopen its dialog, or send its late result to a new session. Reload may reset UI before shutdown; cleanup must not reinstall the old UI.
- Cancel owned execution and verify actual exit. Bound shutdown waits where necessary and report limitations honestly: non-cooperative in-process provider code cannot be forcibly terminated by cancelling its promise. This exception does not excuse leaks of owned processes, workers, sockets, or timers.
- Preserve logs and unknown/uncommitted worktree output on cancellation or failed saving. Do not force-remove unknown work or launch detached cleanup to bypass lifecycle ownership.

## Editor and UI Safety

- Prefer public `ctx.ui` dialogs and host components. Guard terminal-only custom screens with TUI mode; dialog-capable RPC is not a terminal renderer.
- Keep each custom instance bound to one interaction and finish through its completion callback. Do not nest replacement dialogs or manually hide an SDK-owned custom interaction to finish it.
- Preserve the live editor, its receiver, history, undo, paste, cursor, and focus. Do not recreate it by copying text or read private editing state.
- Preflight capabilities before mutation. Roll back partial installation; test the actual mounted component, focus, and continued editing, not just restored method names.
- Restore only properties still owned by the extension. Later wrappers must remain usable; retired delegates must not retain old session resources. Avoid global raw-key listeners when local component handling suffices.
- Honor application keybindings and delegate keys not owned by the component. Propagate focus and cursor markers for IME placement.

## Rendering and Bounded Data

- Use the injected theme and SDK column-width utilities, not string length or hard-coded terminal colors. Respect the width supplied to `render(width)` and host padding ownership.
- Strip external terminal controls before applying SDK styling. Do not strip legitimate host-generated style resets from rendered output indiscriminately.
- Keep rendering free of file I/O and expensive repeated layout. Cache by content and width; invalidate on theme/content changes. Clamp scroll and selection after resize.
- Read only bounded data for previews. UI retains immutable metadata and bounded snapshots, not backend controllers or full logs. Expose paths/ranges for full data when appropriate.
- For optional tool renderers, recognize a narrow verified envelope and delegate unknown formats to the original renderer. Preserve call/result state ownership, partial-to-final semantics, and host shell/background behavior.

## Before Handoff

Check entry discovery, representative consumers, malformed inputs, cancellation, partial failure, reentrancy, resize, and cleanup. Run focused natural-exit tests and affected broader checks under the [testing guidelines](testing-guidelines.md). Record plugin-specific design and regression explanations in Chinese under `docs/`, not as new feature chapters here.
