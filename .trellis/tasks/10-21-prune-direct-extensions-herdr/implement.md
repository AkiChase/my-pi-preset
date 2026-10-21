# 实施计划：统一清理手工扩展并直连 Herdr

## Authorization and Constraints

- 用户已审阅并批准本实施计划；任务已启动并按阶段执行。
- 用户明确选择全量 prune 手工扩展；不保留 cmux 支持，也不保留遗留 Herdr 脚本的运行时兼容逻辑。
- 默认工作流允许每个已验证阶段创建本地提交；不授权 push、依赖安装、实际个人 Pi 同步、reload 或 Herdr 集成安装。
- 所有命令输出使用本次任务在仓库外创建的临时目录；仅将最终命令、退出码、失败和 rerun 关系记录到本文件。

## Stage 1 — Add the direct-extension sync domain

### Scope

1. Extend `scripts/sync.mjs` with the `extensions` domain, strict `preserve.extensions` parsing, safe direct-entry discovery, planning, dry-run output and filesystem application.
2. Update `pi-preset.json` with an explicit empty `preserve.extensions` list.
3. Extend `scripts/sync.test.mjs` with isolated temporary agent-dir coverage for selection, merge, prune, dry run, directory entry deletion, preserve behavior, failure reporting and root-package fail-closed behavior.
4. Update the README synchronization command/semantics documentation, including that this domain applies only to user direct extension entries and the full-prune scope.

### Verification

```sh
node --test scripts/sync.test.mjs scripts/pi-manifest.test.mjs
pnpm typecheck
```

Review the plan table and actual temporary directory contents for every prune test. Run `git diff --check` and inspect the staged/untracked diff before committing.

### Commit checkpoint

Commit only after Stage 1 checks pass and self-review confirms that unselected `extensions` does not inspect or mutate the user extension directory.

## Stage 2 — Replace the event bridge with a direct Herdr state extension

### Scope

1. Replace `extensions/blocked-signal.ts` with `extensions/herdr-state.ts` using the direct v9-compatible Herdr socket protocol and a lifecycle-owned, fail-open state reporter.
2. Replace the existing test file with direct reporter/transport tests: session reference reporting, state precedence, standard dialogs, ask-user lifecycle, nesting, shutdown fencing, socket error behavior and Windows/Unix absolute session paths.
3. Remove cmux-specific code and all internal use of `herdr:blocked` from the preset extension.
4. Rename and update user documentation (`README.md`, `docs/index.md`, and the extension page) for Herdr-only operation and the required prune-then-reload migration sequence.
5. Verify the explicit `package.json` extension glob and package-manifest tests still discover the new top-level entry and no deleted documentation link remains.

### Verification

```sh
node --test extensions/__tests__/herdr-state.test.ts scripts/pi-manifest.test.mjs
pnpm typecheck
pnpm test
```

Run the affected lifecycle test without forced exit first. Then isolate a temporary agent dir and run the full `pnpm check` according to `.trellis/spec/testing/index.md`. Verify local Markdown links/anchors and `git diff --check`.

### Commit checkpoint

Commit only after direct Herdr state tests, declaration discovery, full typecheck/test suite and documentation review pass. The commit must include coupled code, tests and docs.

## Final Check / Acceptance Review

1. Read the final PRD, design and implementation record against the actual diff.
2. Execute `/skill:trellis-check` (self-review or independently dispatched check based on final risk assessment), including sync file safety, lifecycle cleanup/fencing, user-visible docs and command behavior.
3. Record exact commands, temporary environment, exit codes, failures and reruns below; do not erase an earlier failure after a rerun passes.
4. Perform final Git review; commit any verified remaining scoped changes. Do not archive the task without separate finish-work authorization.

## Risk Register

| Risk | Prevention / Validation |
| --- | --- |
| Full prune removes external direct integrations | Explicit user decision, clear scope documentation, dry-run visibility and isolated removal tests. |
| Pi discovery mismatch deletes unrelated content | Restrict discovery to direct logical entries; fail closed when the user extension root itself is an extension package; never recurse arbitrary JSON. |
| Direct socket state blocks or leaks after reload | Fail-open transport seam, activation-local state, timeout cleanup, queued newest-state behavior and session-shutdown fencing tests. |
| New and legacy Herdr reporters coexist | Document prune-before-reload migration; do not add permanent compatibility logic as explicitly requested. |
| cmux behavior accidentally remains | Remove source/test/doc references and search the final tree for `CMUX_`, `createCmuxSink` and `herdr:blocked`. |

## Execution Record

### Stage 1 — direct user-extension sync domain

- **Result:** PASS after main-session implementation, self-review, and an independent `trellis-check` review.
- **Behavior delivered:** added the `extensions` domain; merge keeps direct roots; prune removes unpreserved direct entries; the extension root package layout fails closed; arbitrary JSON, unknown files, hidden entries, and `node_modules` remain outside the deletion set. The manifest now accepts an empty `preserve.extensions` list.
- **Independent review:** the reviewer added coverage for directory symlinks, unavailable roots, and direct-entry discovery. Main verified the installed Pi discovery implementation and corrected the scanner so hidden entries remain excluded, matching Pi's own auto-discovery rule. The task requirement was also aligned with the deliberate rule not to infer or delete unrelated files.
- **Checks:**
  - `node --test scripts/sync.test.mjs scripts/pi-manifest.test.mjs` — PASS, 26 tests, exit 0.
  - `pnpm typecheck` — PASS, exit 0.
  - `git diff --check` — PASS.
- **Earlier failure retained:** during independent review, a first rerun failed only because the unreadable-root fixture's temporary-directory cleanup occurred before its permissions were restored (`ENOTEMPTY`); the fixture cleanup order was fixed and the rerun passed.
- **Raw output:** was kept in the owned external directory `/tmp/my-pi-preset-prune-extensions.2SznWq` during verification and removed after final review; no raw logs were copied into the repository.
- **Commit checkpoint:** `74327e1 feat(sync): prune direct user extensions`。

### Stage 2 — direct Herdr state extension

- **Result:** PASS after main-session implementation and an independent `trellis-check` review.
- **Behavior delivered:** replaced the event-forwarding extension with `extensions/herdr-state.ts`, which directly reports session, working, blocked and idle state through the Herdr protocol. The implementation owns prompt/questionnaire tracking, state coalescing, socket retry/failure isolation and shutdown fencing. It intentionally contains no compatibility branch for the old hand-placed reporter and no non-Herdr host path.
- **Checks:**
  - `node --test extensions/__tests__/herdr-state.test.ts scripts/pi-manifest.test.mjs` — PASS.
  - `pnpm check` under an owned temporary user agent directory — PASS, 1,619 tests, exit 0.
  - independent `trellis-check` protocol/template, lifecycle, documentation-link and diff review — PASS; no scoped defects found.
  - `git diff --check` — PASS.
- **Known limit:** no real Herdr socket server and no real Pi reload were invoked; direct protocol behavior is covered with the typed transport seam and compared against the local Herdr v9 template.
- **Raw output:** main-session output was kept in `/tmp/my-pi-preset-prune-extensions.2SznWq` during verification and removed after final review. The independent review used its own external temporary directory; no raw logs were copied into the repository.

- **Spec capture:** added `.trellis/spec/development/direct-user-extensions.md` and `.trellis/spec/development/herdr-state.md`, linked from the development index. They record the CLI/env contracts, destructive boundaries, error matrices and required regression assertions.
- **Task context:** `check.jsonl` validates with three curated entries. `implement.jsonl` remains intentionally empty because implementation was performed by the main session; task start used `--allow-empty-context` accordingly.
- **Commit checkpoint:** `98e9e61 feat(herdr): report Pi state directly`.

- **Final Git review:** completed after `bcff5c5 docs(spec): capture extension sync and Herdr contracts`; working tree was clean and `git diff --check` passed. The implementation commits are `74327e1`, `98e9e61`, and `bcff5c5`.

_The real host migration remains intentionally unrun._
