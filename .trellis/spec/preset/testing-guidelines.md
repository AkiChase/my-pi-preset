# Testing Guidelines

## Commands and SDK Setup

[package.json](../../../package.json) owns the commands:

```sh
pnpm install       # Checkout dependencies; not a validation step
pnpm link-sdk      # Rebuild SDK links after install or a pi update
pnpm typecheck     # link SDK, then tsc -p tsconfig.json
pnpm test          # link SDK, then node --test over extension/script tests
pnpm check         # typecheck + test; required before proposing a commit
```

[tsconfig.json](../../../tsconfig.json) uses strict, `noEmit`, type-only import enforcement and switch fallthrough checks, rooted at `extensions/**/*.ts` (including tests). Imported dependency `.ts` sources can also join the program; `.mjs` scripts are not typechecked. No build or separate lint command is currently defined. Do not use `any`/`@ts-ignore` to hide errors; document unavoidable suppressions/casts.

[link-pi-sdk.mjs](../../../scripts/link-pi-sdk.mjs) finds the installed `@earendil-works/*` SDK and links into checkout `node_modules`. Candidates include `PI_SDK_DIR`, releases under `PI_CODING_AGENT_DIR` (default agent installation), and the resolved `PI_BIN`/PATH executable. It does not download SDKs or write user configuration, leaves real installed directories alone, and exits unsuccessfully if no SDK is found. Report that as an environment blocker; do not install a second SDK version just to silence checks.

## Test Placement and Isolation Policy

Use `node:test` and `node:assert/strict`, without a third-party test framework. Tests live in `extensions/<ext>/__tests__/*.test.ts`, the existing `extensions/__tests__/*.test.ts` for standalone entries, or `scripts/*.test.mjs`; the package test glob covers both extension layouts.

**Project policy:** tests must be offline and must not read/write real `~/.pi` configuration or execute a real pi install. Use temporary agent/config/log directories, fake SDK/CLI surfaces, and clean up processes/timers/files in hooks or `finally`. Real local shell-process tests are allowed if they are isolated and identify only their own processes.

Some existing extension-factory tests call the default config loader. For a full check, redirect that loader rather than assuming it is inherently isolated. On a machine with the usual SDK links, an example is:

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

The SDK path intentionally reads an existing installation; the temporary agent path isolates user configuration. If links are absent, provide the actual SDK directory explicitly. Inject `loadConfig(agentDir, {})` for loader unit tests; do not silently inherit personal environment overrides when asserting defaults.

## Representative Regression Evidence

| Test | Contract to preserve |
| --- | --- |
| [pi-manifest.test.mjs](../../../scripts/pi-manifest.test.mjs) | Every top-level extension declared; no nested module/test entry; resource-type declarations |
| [sync.test.mjs](../../../scripts/sync.test.mjs) | Fake pi + temporary agent state, four domains, protected leaves/files and stateful `--dev` switches without real installs/network |
| [config.test.ts](../../../extensions/bg-tasks/__tests__/config.test.ts) | Fresh config directories, explicit environment input, precedence/warnings/defaults |
| [shortcuts.test.ts](../../../extensions/bg-tasks/__tests__/shortcuts.test.ts) | Exactly two defaults, remapping/unbinding, SDK rejection does not starve other bindings |
| [index.test.ts](../../../extensions/bg-tasks/__tests__/index.test.ts), [lifecycle.test.ts](../../../extensions/bg-tasks/__tests__/lifecycle.test.ts) | Empty session replacement, shutdown cleanup and idempotent terminal transitions |
| [ui.test.ts](../../../extensions/bg-tasks/__tests__/ui.test.ts) | Fake UI/clipboard, selection-specific kill, final snapshot, bounded/control-safe rendering, timer/overlay disposal |
| [blocked-signal.test.ts](../../../extensions/__tests__/blocked-signal.test.ts) | Fake events and host sinks, shutdown release, late notification IDs, host gates/failure isolation |

Test observable outcomes, not copied implementation constants alone: assert mock action order, final JSON, rendered bounds, emitted messages and resource disposal. When updating a regression, check that reverting the behavior would make it fail. Do not run install/sync against personal state as a substitute for these tests.
