# Cross-Layer Thinking Guide

## Map Ownership Before Editing

The useful flows in this repository are:

```text
pi-preset.json → sync plan → pi user packages / agent JSON → extension load → README
package.json pi.extensions → top-level wrapper → nested library registrations
SDK prompt events → blocked-signal watcher → optional host sink → release/shutdown
process exit → lifecycle transition → notification + registry → panel/footer
```

For each changed arrow, record the input shape, owner, failure mode and observable output. Follow [Sync Guidelines](../preset/sync-guidelines.md) and [Extension Guidelines](../preset/extension-guidelines.md), rather than adding a second interpretation at the consumer.

## Local Boundary Checks

- **Package source:** published npm/git sources are validated by `readManifest`; `--dev` is a separate script-checkout override. Trace both directions, dry-run, unselected domains, removal failure and managed-clone refusal in [sync.mjs](../../../scripts/sync.mjs) and [sync.test.mjs](../../../scripts/sync.test.mjs). Do not globally alias git and local identities.
- **JSON → writes:** nested settings/file leaves differ from flat dotted keybinding IDs. Check tombstones, preservation, malformed JSON and reread-under-lock; a whole planning-snapshot write could destroy package updates.
- **Resource → registration:** a nested `index.ts` is a library here, not an extension entry. Check the package glob, [manifest regression](../../../scripts/pi-manifest.test.mjs), wrapper capture and conflicts together before changing discovery.
- **Execution → rendering:** [task-composition.ts](../../../extensions/task-composition.ts) 只组合执行后端与任务 UI；[beautify.ts](../../../extensions/beautify.ts) 独立通过公开 resolver 美化四类工具，不替换参数、execute 或模型结果，不新增 `bash` 注册。
- **Events → effects:** [watchPrompts](../../../extensions/blocked-signal.ts) owns prompt pairing/label normalization; host sinks own their gated side effects. Its [tests](../../../extensions/__tests__/blocked-signal.test.ts) cover late IDs, shutdown and sink failure. Do not copy optional payload casts into each sink.
- **Completion → view:** [lifecycle.ts](../../../extensions/process-tasks/lifecycle.ts) owns idempotent terminal state, [registry.ts](../../../extensions/process-tasks/registry.ts) owns backend retention and [TaskPanel](../../../extensions/task-ui/panel.ts) retains only immutable selected metadata and a bounded detail snapshot. Verify late exits, replacement and disposal, not merely the happy-path panel text.

## Change Checklist

- Identify all affected consumers and use the existing parser/config/type/state owner.
- Test malformed/empty input, repeated operations and failure paths relevant to the changed boundary; do not assume a successful start proves cleanup.
- Compare final JSON, mock pi calls, emitted effects or rendered width with the intended outcome.
- Apply every relevant row of the [README matrix](../preset/documentation.md).
- Keep development integrations separate: this repository does not own a second upstream template tree to synchronize.
