# Cross-Layer Checklist

For each changed boundary, trace input origin/shape, validation, authoritative state, side effects, error output and tests.

- Trace manifest → sync → config → load and execution → delivery → view without merging their ownership.
- Preserve origin/session identity after awaits, admission during reentrancy and cleanup after partial setup failure.
- Distinguish cancelling a wait, requesting cancellation, terminal metadata and actual process/resource exit.
- Check fresh config rereads under lock and source-switch failure ordering; previews cannot authorize writes.
- Verify optional integrations, renderer delegation, live-editor ownership and later-wrapper preservation.
- Assert rejected inputs preserve personal config, active editors and unrelated work; fixtures are not real provider/terminal evidence.

Concrete contracts: [development](../development/index.md). Evidence boundaries: [testing](../testing/index.md). Keep this a short checklist, not another implementation manual.
