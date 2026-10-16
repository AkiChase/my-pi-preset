# Testing Guidelines

## Before Development and Delivery

Read [development constraints](../development/index.md), approved task artifacts and complete relevant tests/fixtures. Choose checks by behavior and side effects, not file count. Review final source, staged/unstaged/untracked and relevant committed changes. Rerun affected checks after edits; historical PASS counts do not establish current acceptance.

## Commands and Isolation

Use `node:test` and `node:assert/strict`. Tests live in `extensions/<name>/__tests__/*.test.ts`, `extensions/__tests__/` or `scripts/*.test.mjs`; preserve configured discovery globs.

| Command | Purpose |
| --- | --- |
| `pnpm link-sdk` | Resolve the already installed SDK |
| `pnpm typecheck` | Link SDK and run strict no-emit TypeScript |
| `pnpm test` | Link SDK and run the full configured suite with file concurrency 8 |
| `pnpm check` | Typecheck and full suite |
| `node --test <focused files>` | Focused regressions without forced exit |

Dependency setup (`pnpm install`) is not a test and requires authorization. Missing tools/SDK mean an environment blocker, not permission to download replacements. Tests are offline and cannot read/write personal config, credentials, memory or sessions. Use temporary agent/config/cwd/log directories and fake package commands; owned local processes must be isolated and cleaned up.

Some tests invoke default config loaders: isolate the entire invocation, not only known fixtures. With an existing linked SDK:

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

Guard setup failure before using derived paths. Scope cleanup to self-created directories and retain exit status. Installed SDK resolution is not installation authorization.

## Regression Design

- Exercise actual registered tools, components, parsers and lifecycle methods. Stub expensive external boundaries with typed seams; do not copy production algorithms into fixtures. Assert observables, side-effect order, resulting files and cleanup; handler-source string matching or resolved promises do not prove host behavior.
- Cover malformed/empty input, budgets/Unicode boundaries, repeats, partial setup failure, cancellation before/after awaits, synchronous reentrancy and stale completion as applicable. Demonstrate regression failure with restored defective behavior when practical; never weaken unrelated expectations to fit a fix.
- Keep source transformations test-only, scoped and in-memory. Product must pass the real host loader; Node-only import success is insufficient.
- Distinguish wait release, terminal metadata and actual execution exit. Verify processes, workers, timers, listeners and descriptors are released; `unref()` is insufficient. Test owned cleanup/fencing, not a false claim that cancelling a promise forcibly stops third-party code.
- Preserve first failures; diagnose product versus fixture issues from actual source/output, then rerun scoped repairs. A changed label or fixture exit zero is not proof of success.

## Selecting Checks

Lifecycle/resource changes require focused natural-exit tests, without `--test-force-exit`. The configured full suite uses forced exit; its success cannot establish natural shutdown. Run affected broader suites and `pnpm check` for product changes.

| Changed behavior | Required evidence |
| --- | --- |
| Entry/resource declaration | `scripts/pi-manifest.test.mjs` and affected actual-host loading tests |
| Sync/config/package switching | `scripts/sync.test.mjs`: selection/pruning, protected leaves, matching no-write, fresh rereads, removal failure, checkout/ref/path cases and piped-installer rejection |
| Editor/UI/renderers | Actual SDK component/focus/setter tests, narrow/wide text, controls, resize/themes, delegation order and rollback |
| Execution/results/notifications | Actual owner and registered-boundary tests, cancellation/reentrancy/stale session, sink failure and owned cleanup |
| Documentation-only | Links/anchors, current command/config claims, active JSONL, language, untracked whitespace and actual spec discovery |

Inspect real filenames/coverage before selecting focused files; this matrix is not a claim that every behavior is covered. A history fixture does not establish installed third-party input-history compatibility. Component tests do not prove terminal appearance, physical IME or arbitrary plugin combinations. Scripted local providers do not establish online model quality.

Reusable authorized CLI/TUI procedures are in [tmux testing](tmux.md). Documentation work does not authorize real terminal/provider execution, installers, personal sync/reload or dependency fetching.

## Focused Plugin Checks

Run selected commands under the same temporary agent-dir/existing SDK isolation above, without forced exit. These are verification entry points, not historical PASS claims:

```sh
node --test extensions/session-assist/session-name/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts
node --test extensions/at-path-completion/__tests__/*.test.ts
node --test extensions/beautify/__tests__/*.test.ts extensions/task-ui/__tests__/editor.test.ts
node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/*.test.ts
```

- Session naming: actual SDK projection, conservative input counting, the two-request session quota (no third request, no refund), manual title protection and cancellation; fake providers do not prove title quality.
- Path completion: native negative control, Tab/Enter/unique candidates, asynchronous cancellation, actual host setters/reset, editor/history/undo/paste preservation, later wrappers and safe fallback. Native fd integration uses disposable paths and temporary HOME for `~/`; verify scoped ignored paths, quoting, recursion and result limits without scanning personal home or installing fd. The guarded `tryTriggerAutocomplete(false)` seam in `compat.ts` needs actual-host semantics regression on SDK upgrades, not function-existence proof.
- Beautify: actual loader/resolver/ToolExecutionComponent, image ownership, registered `process_manage`/`agent_manage` v2 metadata across actions/types, exact parameter/result identity matching, unknown/error fallback, partial/final state and wait release without stopping execution, mouse hit regions, terminal-column/background continuity and highlighting budgets/races. Expanded management results use returned content only, without backend I/O or consumption. Editor tests preserve the live receiver/focus/cursor/history/undo/paste and later wrappers through setter/reset failures; independent history fixtures are not the installed input-history package.
- Task UI/processes: `panel.test.ts`, `mixed-waits.test.ts`, `lifecycle.test.ts` and `sdk-runtime.test.ts` cover bounded source snapshots, selection/scroll, shared overlay ownership, viewing without wait release, detach without PID replacement, cleanup ordering and actual SDK lifecycle/reload with typed expensive-boundary seams. Process `activation`, `monitor-*`, `waits` and `lifecycle` tests cover registered commands/WS, sink failures, synchronous shutdown during setup/notifications, quiet reminders/deadlines, TERM→KILL and retained logs. Preserve specific cancellation/late-event tests when selecting smaller suites.
- Tool validation: use registered schemas with the actual `validateToolArguments` boundary. Assert unknown field paths and zero execution effects; cover number and string fractions for `Number({ multipleOf: 1 })`, whitespace-only prompt/message, resume-option conflicts and frontmatter requested/effective values in returned content. For bash, assert nonzero output still includes exit code, spontaneous signals are errors while explicit cancellation is not, and Chinese/emoji output does not falsely claim byte truncation. Workflow tests must compare author-error propagation with tolerated child/thunk nulls and check retained final notification/output reasons.
- Tool usage guidance: registered multiline guidelines must replace inherited guidance and produce one named rule group in the real installed SDK assembler. Preserve unrelated tools and exclude disabled/hidden tools. Test-only file-URL access to the installed assembler is introspection, not a supported product import. Bash coverage includes removed-field refusal before spawn, immediate-background/wait-threshold exclusion, non-interactive explicit-threshold refusal, threshold detach without process termination, natural foreground completion and background notification; keep configured defaults accurate.
- Agent backend: `tool-waits`, `backend-waits`, `runner-cancellation`, `worktree-lifecycle`, `auxiliary-lifecycle`, `loading` and `workflow` tests cover registered interfaces/frontmatter, parent/child guards, bind races, worker natural exit, scheduler ownership, late noncooperative completion and retained artifacts. Source transformation stays restricted to the test-only in-memory `extensions/agent-tasks/__tests__/source-loader.mjs`; real Pi still loads production through its host loader. Fake Git/RPC/session seams are not actual worktree/provider end-to-end evidence.

- Trellis: logic tests only, as `.mjs` under `extensions/trellis/__tests__/` (root `test` globs `extensions/**/__tests__/*.test.mjs`). Do not add real Pi host, mounted overlay, TUI rendering or menu-flow tests; drive extension handlers through a fake `pi` object instead. Build the initialized project once and copy it per case (`copyRuntimeFixture` in `runtime-fixture.mjs`, shared `mockPython` router) rather than running a full init per case; rewrite or delete the copied operation record so assertions fail for the intended reason. Python unit tests run through `python-worktree.test.mjs`. Fixtures must not depend on any external checkout or its Git history.

```sh
node --test extensions/trellis/__tests__/*.test.mjs extensions/shared/scroll-panel/__tests__/*.test.ts
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
```

Full natural-exit integration may use `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"` under isolation; it is separate from the forced-exit package suite. Inspect current tests and limitations before selecting checks, rather than blindly reusing an old matrix. Existing detailed developer notes in extension TESTING files are not user docs or current acceptance; dated results belong in task evidence.

## Runtime Management Migration Checks

Use the runtime-tasks, process-tasks, task-ui, Agent tool-waits/backend-waits/loading and Beautify suites under isolated agent configuration without force-exit. Cover canonical execution handles, stale resume requests versus admitted waits, cross-group refusal, target ownership, child fallback/deny/narrow/depth, and exact result consumption/notification fencing. Loader waits use finite wall-clock budgets, not rapid setImmediate iteration counts that expire before disk I/O under full-suite contention. Run Trellis dispatch fake-pi tests and the configured pnpm check separately.

Test public tool labels and registered renderCall through the shared heading component with narrow/wide Unicode, plain/control text, folded/expanded and no Beautify activation/global theme. Compare public v2 identities across launch/list/results/notifications; historical renderer fallback is not a legacy execution alias. Monitor tests must assert host and direct-call rejection before registry/source effects, positive finite optional times and command/ws XOR, while preserving cadence, silence, termination and session cleanup.

## Shared Widget Display Checks

Run `node --test extensions/shared/widget-display/__tests__/*.test.ts extensions/__tests__/widget-*.test.ts scripts/pi-manifest.test.mjs` under the isolation rules above. Also run affected consumer tests when changing their integration. The boundary test enforces the [shared widget contract](../development/widget-display.md); detailed scenarios belong in test code. Fake UI sinks do not establish real terminal appearance.

## Reporting and Documentation Gates

Record exact commands, relevant inputs/environments, exit codes and unavailable checks. Distinguish PASS, FAIL and NOT_RUN. Driver exception capture followed by exit zero is not success: inspect case errors and output. Verify actual OS cleanup, not merely panel closure/terminal metadata.

Check local relative Markdown links/anchors, affected active JSONL parse/existence, spec language, new-file whitespace and `git diff --check`. Run `python3 .trellis/scripts/get_context.py --mode packages --json` after layer changes and verify substantive indexes, not only directory discovery. Do not rewrite archived evidence to repair current navigation. Empty unused role manifests remain a task-validate diagnostic even when an approved direct start uses allow-empty; dispatched roles need real curated references.

All reusable developer/test methods belong here or tmux.md, including plugin-specific coverage. Dated commands, results and failure/rerun relationships belong in the task implementation record; raw logs use an owned repository-external temporary directory. Only selected minimal long-term evidence belongs in evidence/, and research/ is reserved for authorized research-agent findings. User docs contain functionality/usage/configuration, not testing tutorials or internal contracts. Adding a method does not authorize or prove its execution. Self-review is not independent review; execution completion is not acceptance, commit/push or lifecycle authorization.
