# Code Reuse Thinking Guide

## Search the Owner First

Before adding a helper or changing a shared value, search related symbols, tests and README:

```sh
rg -n 'loadConfig|DEFAULTS|shortcutTaskPanel' extensions scripts README.md pi-preset.json
rg -n 'completeJob|markTerminal|terminateJobSilently' extensions/bg-tasks
```

Ask whether the existing owner can serve the new consumer without widening the task. Do not automatically extract every similar line: share behavior that must stay consistent, not incidental syntax with different semantics.

## Existing Reuse Points

| Need | Owner / evidence |
| --- | --- |
| Config defaults, environment names, validation | [config.ts](../../../extensions/bg-tasks/config.ts): `DEFAULTS`, `envNameFor`, `loadConfig`; per-registry config, not a mutable global singleton |
| Completion, silent termination and abort cleanup | [lifecycle.ts](../../../extensions/bg-tasks/lifecycle.ts): `completeJob`, `markTerminal`, `terminateJobSilently`; do not reimplement a tool's exit path |
| Job lookup, log paths, age-based retention | [registry.ts](../../../extensions/bg-tasks/registry.ts); notification delivery does not own eviction |
| Bounded/paged output and tails | [output.ts](../../../extensions/bg-tasks/output.ts): `readLogSlice`, `readBoundedTail`, `readTailLines`; avoid a new unbounded file read for display |
| One-line labels/durations | [format.ts](../../../extensions/bg-tasks/format.ts); terminal display width still belongs to SDK utilities |
| Sync JSON path/leaf operations | [sync.mjs](../../../scripts/sync.mjs): `splitPath`, `leafEntries`, `getPath`, `setPath`, `unsetPath`, `buildConfigPlan`; keep keybinding IDs flat |
| Host prompt labels and pairing | [blocked-signal.ts](../../../extensions/blocked-signal.ts): `sanitizeLabel`, `askUserLabel`, `promptLabel`, `watchPrompts`; sinks consume the normalized contract |

## Avoid False Abstractions

- Do not merge `[]` (disable binding) and `null` (remove override), or nested settings paths and literal dotted action IDs, because they look like JSON everywhere.
- Keep the installer bootstrap dependency-free; do not import extension/SDK code into sync for a trivial shared constant.
- When defaults or config fields change, search descriptions, environment-name/bounds handling, tests and README. Prefer existing generated descriptions over another literal timeout/log directory.
- Keep runtime job state separate from the panel's metadata snapshot; retaining a full job object would retain teardown hooks the viewer does not need.
- Preserve vendor provenance and local ownership; do not create a second upstream-copy synchronization mechanism.

Before hand-off, confirm consumers use the real owner, regression tests exercise divergence/cleanup, and a proposed abstraction stays within the approved behavior change. Record unrelated refactor opportunities instead of implementing them opportunistically.
