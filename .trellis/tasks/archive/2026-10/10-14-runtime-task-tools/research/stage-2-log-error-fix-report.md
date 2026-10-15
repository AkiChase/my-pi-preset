# 阶段 2 N1 日志错误修复报告（2026-10-15）

## 最小实现

修改 4 个产品 owner 文件：

- `extensions/process-tasks/log-search.ts`：stream 和 readline 两个 emitter 都由本次扫描的 `fail` handler 接住；失败关闭 readline 并 destroy stream。Promise 只在实际 stream `close` 后 settle，包含 readline setup 失败与已扫描部分行之后失败。创建 stream 同步失败没有资源可关闭时明确返回 fallback。无 global uncaughtException、无 detached cleanup、无提前 resolve。
- 同文件保留 bounded tail fallback。失败 stream 的 count/hits 先清空，避免 partial streamed hits 与 fallback 双重计数；只有 fallback 也不可读才产生 `log_error`。可读空文件是成功的空扫描，不扫描合成的 `(no output yet)` 文本。
- `extensions/process-tasks/output.ts`：原 bounded read 的 fd owner 抽为 `readBoundedTailOrThrow`（open→fstat→有界 read→finally close；拒绝非文件）。原 `readBoundedTail` 包装仍保既有 no-output fallback，Bash/通知/进度调用者不切换合同；search 使用明确失败路径。
- `extensions/process-tasks/search.ts`：内部结果保 `count` 并沿用已有 `log_error`，不新增公共 error code/schema。target 不可读时不返回 successful `No matches`。global 每个可读日志仍扫描／计数／显示匹配，任何不可读日志明确 `Search incomplete`、失败路径/task_id、`isError=true`。
- `extensions/process-tasks/management.ts`：最小透传 `error_code`；target 的失败响应也带已冻结目标身份／状态。await 后原 closed/object-identity 围栏优先于日志失败，继续拒绝发布旧结果；无重新 admission、无额外 registry。

没有修改 runtime facade；当前 activation 的唯一 process search capability 已在自身结果中完整保留 global partial hits + errors，facade 沿用现有 failure 透传。

## 新回归与错误／资源观测

新增 `extensions/runtime-tasks/__tests__/log-errors.test.ts`（10 个测试）和 subprocess-only `log-error-probe.mjs`。后者使用实际 `BackgroundRegistry`、source、management、facade、**registerRuntimeTaskTool 所注册的 definition**；未复制搜索算法、未直接调私有 scan 函数。

6 个正常存活／后续工具案例：

1. 实际不存在的日志路径：stream ENOENT 与 fallback open ENOENT，返回 typed log_error。
2. 实际目录：stream EISDIR／平台路径错误或 fallback fstat 非文件，typed log_error，目录保留。
3. unreadable seam：真实 fs ReadStream 已 open 后 destroy(EACCES)，同一路径 sync fallback open EACCES；确认已有真实 fd 关闭，宿主自然退出0。
4. partial seam：真实 stream 已 open、readline 已接收 `needle partial` 后 destroy；fallback 使用保留的真实文件，count=1，没有 partial hit 泄漏或双计数。
5. readline setup throw seam：createReadStream 已创建后 setup 抛错，仍等真实 stream close，fallback 成功。
6. readline emitter 独立 error seam：真实 Interface 在实际行回调 emit(error)，不依赖 input error；同 owner cleanup，fallback 成功。

每个正常案例均断言全部实际 ReadStream.closed，sync fallback/output 的 openSync/closeSync fd 集合为空才可返回；故不是只 assert destroy 被调用。不可读案例另执行 global mixed-log search，断言 `isError/log_error/count=1`、incomplete、保留 good hit 与 bad path，不伪装整个 scope 无匹配。随后同 registered definition 的正常 case-insensitive regex/context 查询与 byte page output 可用，全部已存在日志 byte-equal、不消费失败 search 的 terminal outcome。

另 4 个 subprocess case：missing-log search 开始后立即 close／replace，分别 target/global；均返回 closed、无旧匹配、实际 stream fd 已关闭。原 `process.test.ts` 的 4 个成功流 R3 close/replacement case 与 output/wait nonconsume 等也重新通过。

probe 保留可选、**test-only** `RUNTIME_LOG_SEARCH_BASELINE` in-memory load hook，供 main 后续单 owner mutation 复核；本次先红后绿直接发生在产品修改之前，没有启用 hook、没有 disk product restore。无生产 hook/配置依赖。

## 红测：真实原始错误

在任何产品修改前写入新测试，然后执行：

```sh
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d /tmp/runtime-log-red.XXXXXX)"
PI_CODING_AGENT_DIR="$agent_dir" node --test --test-name-pattern='registered search missing log' \
  extensions/runtime-tasks/__tests__/log-errors.test.ts
result=$?
rm -rf "$agent_dir"
exit "$result"
```

**实际 FAIL，test 0/1 pass、exit1**。stderr 保留原始未处理事件：

```text
node:events:486
      throw er; // Unhandled 'error' event
Error: ENOENT: no such file or directory, open '.../runtime-log-error-BS76NK/bad.log'
Emitted 'error' event on Interface instance at:
    at ReadStream.onerror (node:internal/readline/interface:259:10)
Node.js v24.14.1
AssertionError: 1 !== 0
```

子进程没有返回工具结果。此红测是已知 owning 缺陷，不是 fixture 错误，也不标成 PASS。修复后首轮严格检查＋43/43 小范围 owning 回归直接通过，无中间产品修补／fixture失败。随后加强 sync fallback fd 观测，最终重跑定向与全量如下。

## 最终验证

Node `v24.14.1`，使用 ancestor 已有 node_modules / SDK `1.2.0`，无安装/link。整个测试调用 `PI_CODING_AGENT_DIR` 临时目录，只清理自身 temp；子测试每个 subprocess 还有自身 temp dir。无 force-exit / 强制 process.exit / 在线 provider。

最终单条命令（job `bpgib3iwh`，日志 `/tmp/pi-bg/bpgib3iwh.log`）：

```sh
set -eu
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d /tmp/runtime-log-validation.XXXXXX)"
trap 'rm -rf "$agent_dir"' EXIT
export PI_CODING_AGENT_DIR="$agent_dir"
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/*.test.ts \
  extensions/process-tasks/__tests__/*.test.ts \
  extensions/agent-tasks/__tests__/tool-waits.test.ts \
  extensions/agent-tasks/__tests__/runner-cancellation.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts \
  extensions/beautify/__tests__/retrieval.test.ts
node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"
git diff --check
```

- **strict/noEmit PASS**。
- **focused 503/503 PASS，66 suites，0 fail/cancelled/skipped，15.332s，自然 exit0**。
- **full 725/725 PASS，72 suites，0 fail/cancelled/skipped，22.707s，自然 exit0**。前次 715 不是当前计数；新增10实际 subprocess回归已被 configured glob 收集。
- `git diff --check` PASS。检查了 scoped tracked diff 与 untracked search/management 当前全文，保留已有改名注释／R3围栏，不整文件回退。

前一轮小范围 job `bpfceb0r8` 日志 `/tmp/pi-bg/bpfceb0r8.log`：strict PASS、43/43 PASS、6 suites、2.057s、自然 exit0。日志有原测试的 intentional offline notification sink warning，断言含错误隔离；不是 suite failure，也不是 N1 崩溃。

## 最终输入 SHA-256

```text
a86d5b77d34a751ba97367802685f39e6988bcf5846224a38d7ee189572e890f  extensions/process-tasks/log-search.ts
18f8ac8560c1f88c38ee5a3a13e0460bebbcc1d93f2f1c50e585cfc0acd2460a  extensions/process-tasks/output.ts
ba7f91c2c4202242be839d9bd08a2fa591c089dfa4ac2f45f6e90decb8fec91c  extensions/process-tasks/search.ts
04233545538beb1af8343ef072d2407661d2a720243accb930259189f93ef6ac  extensions/process-tasks/management.ts
2647a7d15de11743103dfbb98ec632d433bef15f56a86f342da83da1044b647c  extensions/runtime-tasks/__tests__/log-errors.test.ts
03be44bcdbaca16e714a4b915c627440b20dc9c89c8f7b68b14ce752e8f87f04  extensions/runtime-tasks/__tests__/log-error-probe.mjs
```
