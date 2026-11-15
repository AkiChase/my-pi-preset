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

（实施时填写）
