# child-context 跨 graph 定向修复

## 范围与复现

按本轮授权，仅修改 `extensions/agent-tasks/src/child-context.ts`、`__tests__/host-loading-smoke.mjs`、`__tests__/loading.test.ts`、agent `PROVENANCE.md` 和本文。不改 `index.ts`／`agent-runner.ts`、process-tasks／task-ui／bash-unified／README，不写主任务进度、不提交或操作任务生命周期。阶段 2A 并行工作保持原样。

环境：Node `v24.14.1`，实际安装的 Pi SDK `1.1.0`；使用现有 SDK 链接，不安装另一套 SDK。实际生产调用为 `agent-runner.ts` 中 `runInChildSessionContext(() => loader.reload())`，worktree 的 resource loader 使用不同的 `configCwd`。Pi 1.1.0 `core/extensions/loader.js` 的 `useExtensionCacheCwd` 在 cwd 改变时调用 `clearExtensionCache`，之后 `loadExtensionModule` 使用新 jiti（`moduleCache: false`）加载整个 graph。旧模块局部 `new AsyncLocalStorage<boolean>()` 不能让新 graph 看见原 guard。

旧 host smoke 只验证同 cwd：缓存 factory 使用原 graph，子工具里没有 Agent，不能证明 worktree 路径。先扩展真实 host smoke、保留旧 guard 运行测试，**0/1 pass，1 fail**，错误为 `different cwd (worktree): no child agent tools`；实际不同 cwd 子工具多出 `Agent`、`SubagentWorkflow`、`get_subagent_result`、`steer_subagent`，同 cwd 断言已先通过。manager registry 的 first-owner 仅避免 root slot 被替换，不避免构造 child manager／注册根工具与 handlers。

## 实现

- 保持 `inChildSessionContext`／`runInChildSessionContext` 签名及 bash-unified 的原导出桥接，不要求改 caller。
- 增加有意命名的 `Symbol.for("my-pi-preset:agent-tasks:child-session-context:v1")`，仅用于 vendor family 的 child marker process capability。
- 用带计算 symbol 属性的 `ChildContextGlobal` 声明 `AsyncLocalStorage<boolean>` slot；复用前执行 `instanceof AsyncLocalStorage` 检查。不新增 `any`／`@ts-ignore`；异常 slot 显式 TypeError，不悄悄覆盖既有 scope。
- graph 新建时复用同一 ALS；`run(true, fn)` 仍按异步作用域隔离，不采用全局 mutable boolean 或 env toggle。
- 共享 slot 不存 coordinator、manager、controller 或执行记录。任何 child shutdown 不 disable/delete 它；原根关闭后仍可供新加载使用。这不是 UI coordinator 或执行管理器单例。

## 回归矩阵

真实 host `loadExtensionsCached` 使用同一个临时 probe entry、传入不同临时 cwd，不进行 `process.chdir()` 或环境 cwd 写入，不调用 git／模型／真实 createAgentSession。wrapper 以 spawn 的 cwd／env 配置独立进程，临时 agent-dir 最后为空。测试仍使用原有 vendor-src 局部 Node transform；生产不引入 build/dist。

| 用例 | 旧实现 | 修复后 |
| --- | --- | --- |
| 根工具／pretty bash 参数和 renderer | 通过 | 通过 |
| guard 内同 cwd 子加载 | 通过 | 通过 |
| guard 内不同临时 cwd 子加载 | 注册根 agent/workflow，硬断言失败 | 无 Agent／SubagentWorkflow／结果／steering 工具 |
| 两种 cwd 子关闭 | 原 smoke 只证实同 cwd | 均保留原根 registry；无根 manager command/handlers |
| cache cwd 改变后重复父加载两次 | 未执行 | 根工具图有效，每 factory 工具／命令／快捷键无重复；非所有者关闭不影响原根 |
| child await 未结束时独立根 cwd 加载 | 未执行 | 独立根仍为根；随后 nested async child 在新 graph 仍为子 |
| 原根关闭／重新根加载／关闭 | 原 smoke 只验证初次释放 | 原根释放；重载可重新取得并释放 registry，marker 仍有效 |
| 独立根 ALS、嵌套 await、异常退出 | 无覆盖 | 无关 ALS 值不变，根 continuation 不泄漏 child marker，正常／拒绝退出还原作用域 |

handler 断言直接检查 root-only `input`、`session_before_switch`、`tool_execution_start`；另外比较 `session_start`／`session_shutdown` 数量，child 正好少 agent owner 的一个 handler，保留 process／pretty／composition 自有 handlers。不删除旧 hard assertions，新 probe 检测重复工具之外也检测同 factory 的重复 command／shortcut 注册。

## 实际命令与结果

### 1. 修复前复现

```sh
agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/agent-tasks/__tests__/loading.test.ts
result=$?
rm -rf "$agent_dir"
exit "$result"
```

结果：exit 1，1 test，0 pass／1 fail，错误与实际额外工具见上文；没有 force-exit。

### 2. 最终定向自然退出

```sh
agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$agent_dir" node --test \
  extensions/agent-tasks/__tests__/loading.test.ts \
  extensions/agent-tasks/__tests__/foundation.test.ts \
  extensions/agent-tasks/__tests__/workflow.test.ts
result=$?
rm -rf "$agent_dir"
exit "$result"
```

结果：exit 0，**6 tests、6 pass、0 fail**，自然退出约 1.5 秒；包含真实 inline worker 返回／stub RPC／abort。初次 marker 修复时尚未添加独立 ALS 用例，定向 5/5 通过；最终加上独立 ALS 用例为 6/6。仅有 Node `stripTypeScriptTypes` experimental warning，无模型或 git 活动。

### 3. strict 与完整检查

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm typecheck
result=$?
rm -rf "$agent_dir"
exit "$result"
```

首次 guard 修改后的 strict 通过。随后新增测试初版误用 `Promise.withResolvers`，真实 strict 在本次允许修改的 `loading.test.ts` 报两处 TS2550（项目 ES2023 lib）；已改为有类型的局部 deferred helper，没有修改 tsconfig 或 process 文件。

最终执行同样的隔离准备，并将命令替换为：

```sh
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
```

结果：exit 0，真实 strict typecheck 通过，**335 tests、335 pass、0 fail**；包含当时并行 stage2A 工作树，未发现需要绕开或修复的 process type errors。`pnpm check` 的已有全量 test script 带 `--test-force-exit`，因此它不是自然退出证明；自然退出由上述不带该参数的定向 6 tests 证明。不执行个人配置读写或真实安装。

### 4. 空白、链接与任务上下文

```sh
git diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/10-12-subagents-task-ux
```

均 exit 0；context 校验 `implement.jsonl`／`check.jsonl` 各 17 entries 通过。agent vendor 与 task research 当前为未跟踪文件，另用局部 Python 检查本次五个文件的尾部空白／最终换行及两份 Markdown 的相对链接，全部通过；不将 `git diff --check` 当成未跟踪文件检查。

## 验收与未验证边界

本修复补强 PRD AC1 的子加载身份／根 registry 所有权和 AC12 的离线／strict 验证；仅此定向范围已满足。不同 temp cwd 模拟 worktree loader 行为，不代表真实 git worktree／运行中的 agent session 已测试。

阶段 3 的 actual session epoch、运行／队列／nested／worker 生命周期、晚到通知／worktree cleanup 仍未实施或验收；没有用本次无 `session_start` 的 shutdown 测试声称完整 AC9 通过。Stage2A 拥有 README 与 composition 注释更新；其原有“同 graph 桥接”注释可在整合时改为“保留桥接导出、marker 跨 graph 稳定”，本次未越界编辑。
