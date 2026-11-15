# 实施计划

执行者：主会话直接实现；每阶段自审 + 聚焦测试后提交。最终阶段派 `trellis-check` 独立复审（届时补 `check.jsonl`）。启动使用 `task.py start --allow-empty-context`（implement 不派发）。

测试统一在隔离环境运行：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs");const p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')"
agent_dir="$(mktemp -d)"; PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" <cmd>; r=$?; rm -rf "$agent_dir"; (exit $r)
```

## 阶段 1：公共层 + spec

- [ ] `shared/tool-arguments.ts`：`nullable`/`defaultable`/`numeric` 构造、`parseSentinelArguments` 与分支 helper；旧 helper 暂留。
- [ ] 公共层单测（新文件 `extensions/__tests__/tool-arguments.test.ts` 或就近）：哨兵映射、数字边界、不适用/必填/D10、未声明字段字面 `"null"`、真 null 拒绝。
- [ ] 改写 `.trellis/spec/development/sdk-compatibility.md`。
- 验证：`node --test <新测试>`；`pnpm typecheck`。提交 `refactor(shared): add string sentinel tool controls`。

## 阶段 2：agent-tasks

- [ ] `invocation-config.ts`、`tool-contract.ts`、`index.ts`（subagent_run、subagent_workflow、subagent_message、agent 卡片读取）、`nested-tools.ts`、`parent-messaging.ts`。
- [ ] `tool-guidance.ts`、`index.ts` 中引用参数的提示、`skills/subagents/references/*.md`。
- [ ] `trellis/index.ts` 钩子的 `isolated`→`tools`。
- [ ] 测试：`agent-tasks/__tests__/{nullable-schema,tool-contract,input-errors,parent-messaging,tool-waits}.test.ts`（`nullable-schema` 改名 `sentinel-schema`），`builtin-skills-smoke.mjs`、`host-loading-smoke.mjs` 如涉及；trellis 钩子相关测试。
- 验证：上述聚焦测试 + `pnpm typecheck`。提交 `feat(agent-tasks): replace nullable controls with string sentinels`。

## 阶段 3：runtime-tasks + monitor + beautify

- [ ] `runtime-tasks/tools.ts`（字段表、D9、`case`/`detail` 映射、使用说明）。
- [ ] `process-tasks/tools/monitor.ts`（schema、解析、说明）。
- [ ] `beautify/tools/{management,monitor}.ts`。
- [ ] 测试：`runtime-tasks/__tests__/{nullable-controls,contracts,process-input,process,execution-id,agent,prompt,public-process}`、`process-tasks/__tests__/{monitor-schema,monitor,monitor-input,monitor-config}`、`beautify/__tests__/{tools,expanded-parameters,secondary-parameters,registered-agent}`。
- 验证：聚焦测试 + `pnpm typecheck`。提交 `feat(runtime-tasks): adopt string sentinels for management and monitor`。

## 阶段 4：trellis_dispatch + memory_write + 文档

- [ ] `trellis/lib/subagent-rpc.ts`、`trellis/protocol/worktree-execution.md:53`。
- [ ] `memory/tools.ts`。
- [ ] `docs/extensions/beautify.md:17`、`docs/extensions/task-composition.md:101` 字段名。
- [ ] 删除旧 `nullableControl`/`parseControlArguments`；新增"所有已注册工具 schema 无 `type: "null"`"测试。
- [ ] 测试：`trellis/__tests__/{dispatch-params,dispatch}.test.mjs`、`memory/__tests__/{tool-schema,tools}.test.ts`、`scripts/pi-manifest.test.mjs`。
- 若 trellis 资源哈希/provenance 受影响（protocol 文档），按 `trellis-resource-provenance.md` 同阶段更新。
- 验证：聚焦测试 + 完整 `pnpm check`。提交 `feat(trellis,memory): adopt string sentinels`。

## 阶段 5：E2E 与复审

- [ ] 用仓库外临时目录：`pi -p --no-session -ne -e <workspace extensions/*.ts> --model mp-messages-2/claude-opus-5.5 "<场景>"`，场景：新建只读 Explore 子代理取结果；`process_manage` wait/output；`agent_manage list`；monitor 启停。记录工具调用参数与结果。
- [ ] 一个 GPT Responses 渠道（运行时用 `pi --list-models` 选可用路由）复验子代理新建与 `process_manage wait`。
- [ ] `trellis-check` 独立复审；修复后重跑 `pnpm check`。
- [ ] 在本文件记录命令、模型、结果与失败/重跑关系；原始输出留在临时目录，验证后清理。
- E2E 会产生真实模型调用费用；仅在本阶段运行。

## 进度记录

- 阶段 1 完成：`07b22e1`。`node --test extensions/__tests__/tool-arguments.test.ts` 6/6；`pnpm typecheck` 通过。
- 阶段 2 与 3 合并提交：agent-tasks 测试通过共享 fixture（`completeToolCall`）直接调用 `agent_manage`，两阶段无法单独变绿。实施中的决定：
  - monitor 的 `timeout_ms`/`wake_absent_ms` 收窄为正整数字符串（原先接受小数毫秒），与「可选数字 = 十进制整数字符串」的统一约定一致；小数毫秒没有实际用途。
  - `subagent_workflow.args` 仍是任意 JSON 数据，不是控制字段；说明改为「无参数时用 `{}`」，避免模型写 null 后被部分渠道编码成字符串。
  - `process_manage.pattern` 只要求非空（不 trim），保持原有「空白正则合法」行为。
  - 测试 fixture（`completeToolCall`、`processInput`、`monitorInput`）把未给字段和 JSON null 填为 `"null"`、数字转为字符串，代表宿主强制转换后的模型调用；不做旧字段名映射。
  - 提交 `019b59c`。聚焦套件（runtime/process/agent-tasks/beautify/task-ui/trellis）全部通过。
- 阶段 4：`trellis_dispatch`（`action` 必填，去掉 `""`/null；`task` 用 `"default"`）、`memory_write`（`expectedRevision` 用 `"null"` 创建，直接调用传 JSON null 拒绝）、协议文档 stop 示例、用户文档字段名、删除 `nullableControl`/`parseControlArguments` 及其测试；新增 `extensions/__tests__/tool-schema-sentinels.test.ts`（加载全部入口 + 嵌套工具 + reply_to_parent + trellis_dispatch，断言无 JSON null）。
  - `pnpm check`（隔离 `PI_CODING_AGENT_DIR`）：exit 0，1874/1874 通过。
