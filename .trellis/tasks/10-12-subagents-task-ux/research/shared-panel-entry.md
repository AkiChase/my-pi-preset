# Shared overview removal and empty-editor Down entry

## Approved behavior

User selected removal of upstream above-editor AgentWidget and below-editor FleetView rather than an opt-in legacy mode, then requested Down as an additional opener when the prompt is empty and tasks exist. User subsequently approved the name Task Panel and inclusion of foreground/background/queued tasks: foreground-only work must also enable Down. Viewing the panel never changes execution/wait mode. The existing explicit opener remains: source/default/tests currently use Shift+Down, not Shift+J (`extensions/bg-tasks/config.ts:105`, `shortcuts.ts:62–73`, `__tests__/shortcuts.test.ts:30`). No remap was requested. Task code is unchanged.

## Required focus/ownership guards

- Exactly empty prompt (not trim-empty): spaces or multiline text count as content.
- Editor owns keyboard; no shared panel, select/confirm/menu or other overlay may be active.
- Eligible task rows exist, including foreground-only work. Provider query must include shell/monitor/agent/workflow rather than checking only one registry; eligibility detail will be finalized with retention policy.
- Act on Down press, not release. Consume only if opening the panel. Once the panel opens, it owns navigation and the opener must be inactive.
- A single session-scoped registration and unsubscribe owner; close/reload/switch/shutdown cannot leave duplicate hooks.
- Normal Up/Left behavior remains untouched. No old FleetView activation mode remains.

## API/source evidence

Installed pi ExtensionUIContext exposes onTerminalInput and getEditorText (`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:82,137`). This requires a conditional terminal-input hook, not unconditionally registering bare Down as an extension shortcut. Bare shortcut registration would claim a built-in navigation chord and lacks a normal-editing fallback.

Installed upstream fleet-list.ts:307–361 illustrates press filtering and focus gates. Its setUICtx unsubscribes before re-registering (:159–165), and dispose unsubscribes (:181–194). But its editorHasFocus implementation reads TUI-private focusedComponent (:363–376) and falls back to accepting unknown focus. Do not silently copy that fail-open behavior. Design should prefer an existing public/editor-local capability or isolate/document a conservative compatibility shim with overlay tests. Removing the old widget also removes the place that originally captured the TUI instance; the new hook needs an explicit focus-state source rather than relying on removed rendering.

This user-requested guarded listener is an intentional exception to the prior bg-tasks design's avoidance of persistent keyboard listeners: only the opener is session-scoped; panel navigation and controls remain interaction-owned. Update the actual extension spec during implementation to document its guards and teardown contract, not a blanket permission for global navigation listeners.

## Migration handling to specify

Old widgetMode/fleetView values must not resurrect old UI or disable shared counts. Remove corresponding old settings-menu choices and listeners. Preserve unrelated settings and management functionality; ignore or warn/document obsolete widget/fleet settings without modifying real user files as part of automated checks.
