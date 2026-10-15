# 阶段 2 N1 日志错误独立复查（2026-10-15）

## 结论

**PASS（仅 N1 scoped independent review）。** 原 missing-log search 的 readline 未处理 `error`／宿主退出问题已解决；本轮未发现 N1 范围内的阻塞问题。实际注册工具的不可读日志现在返回 `isError=true`／`log_error`，mixed global search 保留可读日志匹配并明确 incomplete。stream／readline 两个 emitter 的失败处理归同一 operation owner；真实流关闭后才 fallback／发布。R3 的 close／replacement 优先级在正常与日志错误路径均独立通过。

这不是整个任务的最终验收、source 整合或独立全量结论。R1/R2/R4 沿用上一轮报告，本轮不重复研究；main 负责 integration/docs/tmux/最终验收。实施者 725/725 不作为本轮独立结论。

## 实际 owner 检查

| 合同 | 独立判断与证据 |
| --- | --- |
| 两个 error emitter 的 owner | `log-search.ts` 的 `fail` 同时订阅 stream 和 readline；标 failed、close Interface、destroy 输入。没有全局 uncaughtException／unhandledRejection handler，没有 detached cleanup。|
| 实际 fd close 顺序 | scanner 只由 stream `close` resolve，setup throw 也经过 fail→close；新 subprocess 断言所有真实 ReadStream.closed，sync openSync/closeSync 集合清空才收到工具结果。本轮额外 probe 在 fallback openSync **开始时**断言所有 stream.closed，不只是检测 destroy 被调用。|
| 不可读与空文件区别 | `readBoundedTailOrThrow` 使用 open→fstat→bounded read→finally close，拒绝非文件；空文件返回 `""`。包装 `readBoundedTail` 保留普通预览的 no-output 兼容合同。search 不扫描合成 `(no output yet)`。|
| partial reset | stream 失败后先清空 group.count/hits，再用新 collector 扫 bounded tail；partial subprocess 实际先发 `needle partial` 再 fail，最终 count=1，仅 fallback hit 与正确 context，无 partial hit 或双计数。|
| truthful target/global error | search 保 errors 与已有 `log_error`；target 不返回 successful No matches；global 保留 good hit/count=1 与 bad path/task_id，正文 incomplete，metadata 错误由 management→taskResult→facade 原样透传为 isError。|
| R3 优先级 | management await 后先核 reg.closed／确切 job 对象 identity，target 再核捕获 job；错误流四个 target/global×close/replace subprocess 均返回 closed，不泄旧匹配。原正常流四个组合亦通过。|
| 空扫描 | 本轮额外实际 registered-tool probe 对可读零字节日志使用 `no output yet|^$`，stream 与故意失败后 fallback 两种均 success/count=0，不消费 terminal，日志 bytes 保留，真实 stream/sync fd 已关闭。|

资源 listener 均附属于本次 stream/Interface，无全局 retained emitter；真实 missing/directory/partial/setup/readline 失败及后续工具成功、subprocess 自然退出是实测证据。没有发现生产 orphan stream 路径。

## 独立执行：strict + 20/20 focused

Node `v24.14.1`；既有 SDK `1.2.0`，路径 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent`。ancestor node_modules 已可解析，无安装或 link。

实际验证命令核心如下（整次调用设置临时 agent dir，trap 只清理自身目录）：

```sh
set -eu
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d /tmp/runtime-log-independent-validation.XXXXXX)"
trap 'rm -rf "$agent_dir"' EXIT
export PI_CODING_AGENT_DIR="$agent_dir"
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/log-errors.test.ts \
  extensions/runtime-tasks/__tests__/process.test.ts
git diff --check
```

**strict/noEmit PASS；20 tests/20 pass，0 fail/cancelled/skipped，2.022s，自然 exit0，无 force-exit。** Job `baxmj381r`，完整日志 `/tmp/pi-bg/baxmj381r.log` 已实际读完。该命令还记录 Node/SDK version、HEAD/status、6 文件 SHA-256。日志中的 `offline sink held` 是既有 notification isolation fixture，不是 suite failure 或 N1 未处理错误。

实际通过的 10 个 subprocess：

- `registered search missing log has owned cleanup and a usable subsequent tool`
- `registered search directory log has owned cleanup and a usable subsequent tool`
- `registered search unreadable log has owned cleanup and a usable subsequent tool`
- `registered search partial log has owned cleanup and a usable subsequent tool`
- `registered search setup log has owned cleanup and a usable subsequent tool`
- `registered search readline log has owned cleanup and a usable subsequent tool`
- `registered missing-log search preserves close fence (target)`
- `registered missing-log search preserves replace fence (target)`
- `registered missing-log search preserves close fence (global)`
- `registered missing-log search preserves replace fence (global)`

另通过 runtime process 的 10 个测试：list/status/search nonconsume＋output bytes；multiple retrievals；missing output log 状态；invalid-log wait nonconsume；正常 stream 四个 target/global×close/replace；invalid regex；directory 不作为成功空日志。

## 独立基线红测与补充空日志 probe

本轮额外命令使用临时 `/tmp/runtime-log-independent-probe.XXXXXX`，`git show HEAD:extensions/process-tasks/log-search.ts` 保存至其 `baseline-log-search.ts`。当前产品不回退，只有 subprocess 的现有 test-only `RUNTIME_LOG_SEARCH_BASELINE` hook 单 owner 内存恢复。随后在 **正常当前产品**中跑实际 registered definition 的空文件 probe。

实际执行的 Node assertion body 如下；外层为 `set -eu`、目标 cwd、临时 PI_CODING_AGENT_DIR、trap 清理与上述 `git show`：

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
const dir = process.env.PI_CODING_AGENT_DIR;
const red = spawnSync(process.execPath,
  ["extensions/runtime-tasks/__tests__/log-error-probe.mjs", "missing"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, RUNTIME_LOG_SEARCH_BASELINE: join(dir, "baseline-log-search.ts") },
  });
assert.equal(red.error, undefined); assert.equal(red.signal, null); assert.equal(red.status, 1);
assert.match(red.stderr, /Unhandled .error. event/);
assert.match(red.stderr, /Emitted .error. event on Interface/); assert.match(red.stderr, /ENOENT/);
console.log("INDEPENDENT_BASELINE_RED_EXPECTED_EXIT=1 Interface/ENOENT");
const { BackgroundRegistry } = await import("./extensions/process-tasks/state.ts");
const { DEFAULTS } = await import("./extensions/process-tasks/config.ts");
const { add, createRunningJob } = await import("./extensions/process-tasks/registry.ts");
const { createProcessTaskSource } = await import("./extensions/process-tasks/source.ts");
const { createRuntimeTaskFacade, registerRuntimeTaskTool } = await import("./extensions/runtime-tasks/facade.ts");
const create = fs.createReadStream, open = fs.openSync, close = fs.closeSync;
const streams = [], fds = new Set(); let failing = false, fallbackCount = 0;
fs.createReadStream = (...args) => {
  const stream = create(...args); streams.push(stream);
  if (failing) stream.once("open", () => stream.destroy(new Error("offline stream read error")));
  return stream;
};
fs.openSync = (...args) => {
  if (args[0] === join(dir, "empty.log") && failing) {
    assert.ok(streams.every(s => s.closed), "actual streams closed before fallback starts");
    fallbackCount++;
  }
  const fd = open(...args); fds.add(fd); return fd;
};
fs.closeSync = fd => { const result = close(fd); fds.delete(fd); return result; };
syncBuiltinESMExports();
const { createProcessManagement } = await import("./extensions/process-tasks/management.ts");
const reg = new BackgroundRegistry({ ...DEFAULTS, logDir: dir });
const path = join(dir, "empty.log"); fs.writeFileSync(path, "");
const job = createRunningJob({ id: "empty", command: "offline", pid: 0, logPath: path, toolCallId: "empty" });
job.status = "completed"; add(reg, job);
const source = createProcessTaskSource(reg);
const facade = createRuntimeTaskFacade([createProcessManagement(reg, source)]);
let tool; registerRuntimeTaskTool({ registerTool(def) { tool = def; } }, facade);
try {
  for (const forceError of [false, true]) {
    failing = forceError;
    const result = await tool.execute("independent-empty", {
      action: "search", task_id: job.id, pattern: "no output yet|^$",
    }, undefined, undefined, { cwd: dir });
    assert.notEqual(result.isError, true);
    assert.equal(result.details.runtimeTask.error_code, undefined);
    assert.equal(result.details.runtimeTask.count, 0);
    assert.match(result.content[0].text, /No matches/); assert.notEqual(job.outcomeSurfaced, true);
    assert.ok(streams.every(s => s.closed)); assert.equal(fds.size, 0);
    assert.equal(fs.readFileSync(path, "utf8"), "");
    console.log("INDEPENDENT_EMPTY_" + (forceError ? "FALLBACK" : "STREAM") + "_PASS count=0 actual_fds_closed");
  }
  assert.equal(fallbackCount, 1);
  console.log("INDEPENDENT_FALLBACK_AFTER_ACTUAL_CLOSE_PASS");
} finally {
  facade.close(); source.dispose(); reg.coordinator.dispose();
  fs.createReadStream = create; fs.openSync = open; fs.closeSync = close;
  syncBuiltinESMExports();
}
```

输出：

```text
INDEPENDENT_BASELINE_RED_EXPECTED_EXIT=1 Interface/ENOENT
INDEPENDENT_EMPTY_STREAM_PASS count=0 actual_fds_closed
INDEPENDENT_EMPTY_FALLBACK_PASS count=0 actual_fds_closed
INDEPENDENT_FALLBACK_AFTER_ACTUAL_CLOSE_PASS
```

外层自然 exit0；baseline subprocess **预期 exit1** 是原缺陷红证据，不称其为产品测试 PASS。当前新 tests 的 green 不是因全局 handler 或 force-exit 吞掉崩溃。空日志补充目前仅为本轮临时 probe，非新增持久 suite；main 可在后续 owning 测试维护时纳入，不影响本轮已实际验证的 PASS。

## 输入一致性与限制

以下 SHA-256 在测试前和补充 probe 后相同，并与实施者报告一致：

```text
a86d5b77d34a751ba97367802685f39e6988bcf5846224a38d7ee189572e890f  extensions/process-tasks/log-search.ts
18f8ac8560c1f88c38ee5a3a13e0460bebbcc1d93f2f1c50e585cfc0acd2460a  extensions/process-tasks/output.ts
ba7f91c2c4202242be839d9bd08a2fa591c089dfa4ac2f45f6e90decb8fec91c  extensions/process-tasks/search.ts
04233545538beb1af8343ef072d2407661d2a720243accb930259189f93ef6ac  extensions/process-tasks/management.ts
2647a7d15de11743103dfbb98ec632d433bef15f56a86f342da83da1044b647c  extensions/runtime-tasks/__tests__/log-errors.test.ts
03be44bcdbaca16e714a4b915c627440b20dc9c89c8f7b68b14ce752e8f87f04  extensions/runtime-tasks/__tests__/log-error-probe.mjs
```

- missing path／directory 是真实文件系统案例；EACCES、partial、setup、独立 readline error 是 deterministic boundary seam，真实流/fd 仍被观测。不声称跨平台或真实权限矩阵。
- bounded fallback 仍可能只包含尾部，路径明确 `(log tail)`／truncation；不声称 transient stream failure 后全历史扫描完成。
- 当前 composition 的 process search capability 内聚合 good/bad logs 已实测；任意第三方多个 search capability 的组合不是本轮验证范围。
- 独立 full suite、pnpm check（会 link／force exit）、tmux/CLI、在线模型、source 整合、外部 pi-trellis、物理交互 **NOT_RUN by this reviewer**。
- 无 N1 产品修复建议或阻塞 finding；main 应检查本报告及实际输入，并在整合后执行其 fresh checks。只读 review PASS 不自动完成／归档任务。
