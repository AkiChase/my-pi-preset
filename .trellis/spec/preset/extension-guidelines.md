# Extension Guidelines

## Explicit Entries and Single Ownership

[package.json](../../../package.json) declares `"pi": { "extensions": ["extensions/*.ts"] }`. This glob loads every top-level `.ts`, not nested directories. Keep helper modules and tests nested; a new top-level helper would become an extension entry. Declare any future shipped skills/prompts/themes explicitly in `pi`; declaration disables their convention discovery too.

[pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) asserts complete top-level coverage, no nested entries and resource declarations. Do not remove it or replace the glob with recursive discovery. That would load [bg-tasks/index.ts](../../../extensions/bg-tasks/index.ts) separately from its wrapper and register tools/shortcuts twice.

[bash-unified.ts](../../../extensions/bash-unified.ts) is the single composition point for bg-tasks execution and pretty rendering:

```ts
// Existing SDK-derived type; do not invent a parallel tool interface.
type ToolDef = Parameters<ExtensionAPI["registerTool"]>[0];
```

Its proxy captures bg-tasks' `bash`, forwards other registrations with the original receiver, fails if capture is missing, then injects the captured definition into pretty. Only one final `bash` is registered. Preserve this ownership; do not also install pretty or patty as standalone pi packages ([manifest conflicts](../../../pi-preset.json)). Pretty's deep source import follows its pi entry, not a potentially stale `dist` build; revisit that boundary if its exports change.

## SDK Types and Configuration

- Use SDK types and `import type` for type-only imports; preserve strict/noEmit checking. Do not mask problems with `any` or `@ts-ignore`; explain any unavoidable suppression or boundary cast.
- Example of a justified cast: [shortcuts.ts](../../../extensions/bg-tasks/shortcuts.ts) hands configured chords to SDK registration and catches rejection, rather than duplicating the SDK key table. One invalid chord must not prevent other bindings.
- Built-in action IDs in `keybindings.json` and extension raw shortcut chords are different surfaces. bg-tasks' current defaults are exactly `ctrl+shift+b` and `shift+down`, asserted by [shortcuts.test.ts](../../../extensions/bg-tasks/__tests__/shortcuts.test.ts); no blind kill-latest shortcut exists.
- [config.ts](../../../extensions/bg-tasks/config.ts) resolves file/environment input at load time and stores config on each registry. Reuse `DEFAULTS`, `envNameFor` and parser bounds; do not add an import-time mutable singleton. Malformed input warns/falls back, while registration uses resolved values. [config.test.ts](../../../extensions/bg-tasks/__tests__/config.test.ts) covers defaults, malformed input and precedence.

## Session and Resource Ownership

[bg-tasks/index.ts](../../../extensions/bg-tasks/index.ts) owns session replacement/shutdown: stop ticker/sweep, close the panel and silently terminate running jobs; replacement clears registry state instead of reviving it. [index.test.ts](../../../extensions/bg-tasks/__tests__/index.test.ts) asserts empty replacement, no state snapshots and no orphan process/notification.

Use [lifecycle.ts](../../../extensions/bg-tasks/lifecycle.ts) for terminal transitions and cancellation, not tool-local copies. `markTerminal` is idempotent, freezes `endedAt` and releases runtime hooks; `completeJob` checks terminal state before notifying. This prevents a late exit after silent termination from notifying the new session. Retention belongs to [registry.ts](../../../extensions/bg-tasks/registry.ts), not notification delivery or rendering.

Optional host effects must be gated and isolated. [blocked-signal.ts](../../../extensions/blocked-signal.ts) pairs prompt block/release, releases on shutdown, suppresses duplicate host notifications and bounds CLI calls. Its [tests](../../../extensions/__tests__/blocked-signal.test.ts) use fake SDK events/sinks, including late notification IDs and sink failure.

## Monitor 事件与停止

修改 monitor 或共享任务面板的执行接入时，另读 [Monitor 契约](./monitor-contract.md)。源回调先于启动接线，stdout/stderr 默认合并但独立解析完整行；时间／缓冲归 session，面板只调用共享停止能力。absent/resumed 不变更 Job 运行状态或消费结果标记，不把实时进度再次回读成失败尾部。该文档记录接口、错误矩阵和必须保留的离线断言。

## Safe Terminal Rendering

Follow [BgTaskPanel](../../../extensions/bg-tasks/ui.ts): strip terminal controls from logs, bound reads via `readLogSlice`, show omitted-byte ranges, and size with SDK `visibleWidth`/`truncateToWidth`, not string length. Preserve selected final metadata without retaining runtime hooks. `openBgListPanel` permits one interactive overlay and disposes in `finally`; component `dispose` stops timers/input. [ui.test.ts](../../../extensions/bg-tasks/__tests__/ui.test.ts) covers wide/control text, narrow resizing, duplicate opens and timer disposal.

[status-bar.ts](../../../extensions/status-bar.ts) also uses display-column widths and returns its unsubscribe as `dispose`. New widgets must identify their cleanup owner; `unref()` alone is not disposal. Avoid unbounded full-log rendering, nested replacement dialogs and global listeners that outlive the interaction.
