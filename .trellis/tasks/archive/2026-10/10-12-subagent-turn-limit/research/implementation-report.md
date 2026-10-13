# 子代理轮次接口实施报告

## 范围与结果

在 `/Users/jyxc-dz-0101322/tools/my-pi-preset-subagent-turn-limit`、`feat/subagent-turn-limit` 实施；未提交、合并、改变 task 生命周期、修改个人配置或其他 checkout，也未派发子代理。

按 implement.md 的 1–5 顺序完成审计、行为红测、局部修复、旧测试调整、中文文档与验证。步骤 6–7 的独立审查、规范更新、提交确认及合并由主会话决定，未执行。无 design.md，按计划采用已批准方案。

## 改动文件

- `extensions/agent-tasks/src/index.ts`：删除根 Agent schema 字段；模型 schedule 不持久化轮次预算；resume 按实际存储类型计算当前用户上限；invocation 显示有效值。
- `extensions/agent-tasks/src/nested-tools.ts`：删除嵌套 Agent schema 字段。
- `extensions/agent-tasks/src/invocation-config.ts`：不读取模型 `max_turns`，保留 agent frontmatter 限额。
- `extensions/agent-tasks/src/agent-manager.ts`：新建快照补入真实有效上限，resume 更新同一快照，保留内部显式限制与 runner 执行机制。
- `extensions/agent-tasks/src/source.ts`：轮次统计读取 record.maxTurns，避免没有 invocation 的可信调用显示为无限。
- `extensions/agent-tasks/__tests__/tool-waits.test.ts`：实际已注册工具验证 schema、前台／后台新建与 resume 旧参数忽略、配置变化、通知／source／invocation 一致、frontmatter 0／4、默认无限、模型 schedule 不持久化预算且按触发时配置执行。旧通知关联及 group 测试改用用户 defaultMaxTurns 配置，保留全部原回合数／限额／关联／消费断言。
- `extensions/agent-tasks/__tests__/backend-waits.test.ts`：实际 nested tool + manager 验证新建／resume 忽略旧参数；实际 scheduler + 临时 ScheduleStore 重载 + RPC + manager 验证可信显式限额和读模型保留。
- `README.md`：中文说明模型接口删除、用户／内部限制保留、schedule 触发时配置、既有持久文件边界及离线回归。
- `extensions/agent-tasks/PROVENANCE.md`：中文记录有意接口偏离，澄清早期阶段保留 model max_turns 是历史状态。

## 红绿证据

完整日志保存在本目录 `evidence/`。SDK 始终只读使用 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules`；每次命令设独立 `mktemp -d` 的 PI_CODING_AGENT_DIR 并删除。

1. 第一次定向运行因本 checkout 尚未链接 SDK 而报 ERR_MODULE_NOT_FOUND，属于环境准备失败，不计产品红测。运行 `PI_SDK_DIR=… pnpm link-sdk` 后正常解析，未安装 SDK。
2. 未修复实现：
   - `node --test --test-name-pattern='model Agent schema|legacy model turn|model scheduled delegation' extensions/agent-tasks/__tests__/tool-waits.test.ts`：**4 tests，0 pass，4 fail**。schema actual true、旧上限 actual 1 vs user 7、schedule 文件仍有 max_turns。前台红测提前 assertion 失败后的关闭曾产生 unhandled rejection；后续 fixture 显式捕获／收束 pending tool promise，不隐藏行为断言。
   - `node --test --test-name-pattern='nested actual delegation' extensions/agent-tasks/__tests__/backend-waits.test.ts`：**1 test，0 pass，1 fail**，actual 1 vs user 7。
3. schema／resolver／schedule／resume 修复后，同 5 项定向回归：**5 tests，5 pass，0 fail**，自然退出。
4. 审计扩展回归：可信 RPC 无 invocation 时 source 显示 undefined vs effective 4，定向 **2 tests，1 pass，1 fail**；修复 source 读取 record.maxTurns 后在最终完整测试通过。
5. 中间 agent 全量 **111 tests，110 pass，1 fail**：新 frontmatter fixture 写在 ctx.cwd，但现有根 discovery 使用 process.cwd，未读到临时文件。将 fixture 改到临时 agent-dir/agents，不修改生产 discovery；最终同测试通过。中间 strict 发现 3 处 fixture 类型问题（TSchema.properties 与 RPC consumeResult facade），已修正，无 any／ignore。

## 最终验证

公共环境：`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules PI_CODING_AGENT_DIR="$agent_dir"`，agent_dir 为临时目录。

| 命令 | 最终结果 |
| --- | --- |
| `pnpm check` | strict typecheck 通过；**529 tests，529 pass，0 fail，0 skipped**，约 19.8s；完整项目脚本原本包含 force-exit，未修改脚本，不把此作为自然退出证据 |
| `node --test extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/pretty-compat/__tests__/editor.test.ts` | **507 tests，507 pass，0 fail，0 skipped**，约 15.7s，不带 force-exit，自然退出 |
| `node --test extensions/agent-tasks/__tests__/*.test.ts` | **111 tests，111 pass，0 fail，0 skipped**，约 14.5s，不带 force-exit，自然退出 |
| `git diff --check` | 通过 |

日志中的 ExperimentalWarning 和故障注入测试 cleanup 报告是已存在／预期 fixture 输出；最终无失败或取消测试。SDK hard loader、worker、runner 软／硬限额、workflow、shared waits、process 与 Pretty 断言继续运行，不仅检查字符串。

## 验收与待决定事项

已验证：两处 schema 删除；fresh／resume／nested／模型 schedule 旧字段无效且不能新写入 schedule 绕过；用户 defaultMaxTurns、frontmatter（含 0）、可信 scheduler／RPC 上限保留；有效显示／通知一致；默认无限；README／provenance 中文同步；严格检查与相关自然退出测试通过。

既有 schedule JSON 无来源标记，无法区分历史模型字段和可信 scheduler 字段。为保留用户／内部持久化限制，本次不清洗既有文件；README 已明确说明。若主会话认为应迁移历史模型计划，需要先决定来源标记／迁移政策，不能无差别删除内部限制。本实现不声称历史来源无法识别的计划字段已失效。

未运行在线模型、真实 TUI、真实 git 或 host install/reload；不据离线 seam 推定在线模型自主行为。工作树原有未跟踪 Trellis 基础设施保留不动；新增本研究及证据只属任务产物，不加入 preset。主会话应派发独立 trellis-check，决定是否接受上述既有计划边界，再决定规范更新和提交范围。
