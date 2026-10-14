# Testing Guidelines

## Commands and Isolation

Use `node:test` and `node:assert/strict`. Put tests in `extensions/<name>/__tests__/*.test.ts`, `extensions/__tests__/`, or `scripts/*.test.mjs`; preserve the package test discovery globs.

| Command | Purpose |
| --- | --- |
| `pnpm link-sdk` | Resolve the already installed SDK |
| `pnpm typecheck` | Link SDK and run strict no-emit TypeScript |
| `pnpm test` | Link SDK and run the complete configured test suite |
| `pnpm check` | Typecheck and complete test suite |
| `node --test <focused files>` | Focused regression, without forced exit |

`pnpm install` is dependency setup, not a test. Do not install or download tools to turn an unavailable check into a claimed pass.

Tests must be offline and must not read/write real personal configuration, credentials, memory, or sessions. Use temporary agent/config/cwd/log directories and fake package commands. Owned local shell processes are allowed when isolated and reliably cleaned up.

Some existing tests invoke default config loaders. Isolate the entire invocation, not only fixtures you know about:

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

The SDK path points to an existing installation. If absent, report the environment blocker. Scope destructive cleanup to a directory created by the test, and preserve the actual exit code.

## Regression Design

- Exercise actual registered tools, components, parsers, and lifecycle methods where practical. Stub expensive external boundaries with typed seams; do not copy the production algorithm into a fixture.
- Test observable results, side-effect order, final files, and cleanup. String matching a handler's source or checking that a promise resolved is not proof of host behavior.
- Cover malformed/empty input, budgets and Unicode boundaries, repeated operations, partial setup failure, cancellation before/after awaits, synchronous reentrancy, and stale completion as relevant.
- Demonstrate that a regression fails when the defective behavior is restored when practical. Do not weaken unrelated assertions to accommodate a fix.
- Keep source transformation test-only, scoped, and in-memory. Production must still pass the actual host loader; Node-only import success cannot establish host compatibility.
- Distinguish wait release, terminal metadata, and actual execution exit. Verify owned processes, workers, timers, listeners, and descriptors are released; `unref()` or a terminal status alone is insufficient.
- Never equate cancelling non-cooperative third-party code with forcibly stopping it. Test the owned cleanup and fencing guarantees, and report the remaining boundary.

## Selecting Checks

Run focused tests without `--test-force-exit` for lifecycle/resource changes. The configured full suite currently uses forced exit; its success does not prove natural shutdown. Run affected broader suites and `pnpm check` for product changes, and rerun checks after relevant edits.

UI changes need actual SDK component/focus/setter tests. Use narrow/wide text, control characters, resize, themes, delegation order, and failure rollback as applicable. A history fixture does not establish compatibility with an installed third-party history extension.

Real terminal validation is a separate evidence layer. For an authorized isolated run, use a unique tmux server, temporary HOME/agent/config/cwd/session directories, an existing CLI, explicit extension loading, bounded condition-based waits, raw-frame verification after resize, and cleanup of only owned processes/resources. Keep reusable step-by-step procedures in Chinese under `docs/testing/tmux.md`. Component tests do not prove terminal appearance or physical IME behavior; scripted local providers do not prove online model quality.

Documentation-only changes require local targets/anchors, current command/config claims, JSONL references, and whitespace checks including untracked files. Do not run installation or real terminal tests merely to validate prose.

## Reporting

Record exact commands, relevant inputs, exit codes, and unavailable checks. Use PASS, FAIL, and NOT_RUN distinctly; a driver catching an error and exiting zero does not establish acceptance. Do not call simulated provider/UI tests real visual or online validation.

Put reusable test procedures in `docs/testing/`, plugin-specific coverage and commands in `docs/extensions/`, and historical reports/logs in task research. Keep this file focused on testing requirements rather than accumulating completed task stages or PASS counts.
