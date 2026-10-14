# Code Reuse Checklist

1. Search actual owners, callers and tests before adding helpers, constants or state.
2. Compare semantics, not syntax: execution, result delivery and UI snapshots are different; settings leaves and literal keybinding IDs are different.
3. Extend a shared owner only when consumers need the same invariant. Preserve deliberate optional integration and renderer fallback boundaries.
4. Avoid speculative frameworks or extraction based only on repetition. Identify negative regressions proving preservation for each consumer.
5. Search callers again and review actual diffs after edits.

Authoritative contracts: [development](../development/index.md). Verification: [testing](../testing/index.md).
