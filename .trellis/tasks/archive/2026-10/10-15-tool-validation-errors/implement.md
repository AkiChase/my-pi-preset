# 实施计划：Tool 输入校验与错误反馈

全部阶段的公共约束：
- 每阶段先写/改负例测试，再改产品；schema 收紧与其错误文案同阶段提交。
- 不执行 `pnpm install`、个人 `sync`、`reload`、`push`；不改第三方包；不改 Pi 宿主。
- 每阶段完成即自检并提交本阶段相关文件，不夹带其他任务的 dirty（Memory candidate、TaskPanel planning、邻任务改动）。
- 与 `10-15-builtin-pi-trellis` 的 owner 冲突：开始 S4 前先确认 pi-trellis 是否已迁入本仓库。若已迁入，改迁后位置；若未迁入，改 `../pi-trellis/` 并记录该任务需 rebase 该结论。

## 前置检查（0）
- [x] 确认当前 `git status` 中与本任务无关的 dirty 文件清单，实施时不动它们。
- [x] 确认 pi-trellis 迁入任务状态，确定 S4 的 owner 位置。
- [x] 确认用户配置与 agent frontmatter 中 `thinking` 的实际取值，决定枚举化是否安全。

## S1 基础参数与结果：bash / monitor / task_manage（R1/R2/R4，A1/A2/A3/A6/A7/A8）
- [x] `extensions/process-tasks/tools/bash-params.ts`、`tools/bash.ts`：对象与 timeout 声明收紧；运行时补正数/上限检查；未知键二次检查。
- [x] `tools/bash.ts` 结果补齐内置 `outputSchema` 对应的 `structuredContent`（成功与非零退出）；非零退出恒定回显退出码；区分主动取消与其他信号终止。
- [x] `tools/monitor.ts`：对象与 `ws` 收紧；源判定改为“字段是否提供”；冲突错误指出字段。
- [x] `extensions/runtime-tasks/facade.ts`：字段描述与 Number+multipleOf:1（避免宿主整数转换）；保留白名单与元数据结构。
- [x] `extensions/runtime-tasks/contracts.ts`：`validateRuntimeTaskParams` 返回值携带字段名与新文案（保留错误码枚举）。
- [ ] 测试：`extensions/process-tasks/__tests__/{waits,monitor,bash-results,jobs-read}.test.ts` 补负例与 `structuredContent` 断言；`extensions/runtime-tasks/__tests__/{public-process,contracts}.test.ts` 补字段级文案断言；`extensions/beautify/__tests__/retrieval.test.ts` 确认契约识别未破坏。
- [ ] 自检：`node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts`
- [ ] 提交本阶段文件。

## S2 Subagent 输入与失败标记（R1/R2/R3，A1/A2/A4/A6）
- [x] `extensions/agent-tasks/src/index.ts`：新增失败结果 helper 并替换失败分支（agent 不存在、模型不存在、schedule 冲突、resume 无效、steering 失败、范围校验）；`thinking` 枚举；`prompt`/`description` 非空；resume 与启动参数冲突前置一次性拒绝。
- [x] `extensions/agent-tasks/src/nested-tools.ts`：字段收紧与枚举同步。
- [x] `extensions/agent-tasks/src/invocation-config.ts`：被 frontmatter 覆盖时，把实际生效值写入可见文本（不改优先级）。
- [x] 测试：`extensions/agent-tasks/__tests__/input-errors.test.ts` 覆盖空 steering、nested resume 冲突、未知字段与可见覆盖值；`tool-waits.test.ts`、`auxiliary-lifecycle.test.ts` 的 `isError` 语义保持。
- [x] 自检：agent-tasks 全量 230/230（自然退出）。
- [x] 提交 `f108932`、`09aa0af`。

## S3 Workflow 错误分类与保留（R3，A5）
- [x] `extensions/agent-tasks/src/workflow/worker-source.ts`：作者错误（未知 opts、非法 effort/schema/resume 组合、helper 文本/集合/边界/嵌套引用校验）不再被 `parallel`/`pipeline` 吞成 `null`；子任务失败保持 `null` 容错但记录分支/阶段/原因。
- [x] `extensions/agent-tasks/src/workflow/task.ts`：失败原因进入最终结果与通知，可经 `task_manage output` 读到；诊断前置以避过通知/预览截断。
- [x] 测试：新增 `workflow-failures.test.ts`（真实 worker 通道）与 `workflow-failure-host.test.ts`（真实 extension/通知/管理工具）。
- [x] 自检：agent-tasks 全量 230/230（自然退出）；worker 模板 `vm.Script` 可解析。
- [x] 提交 `10a150c`、`5fbf096`。

## S4 Memory 与 pi-trellis dispatch（R1/R2/R3，A1/A2/A6/A9）
- [x] `extensions/memory/tools.ts`：对象收紧；`description`/`query` 长度与 `policy.ts` 一致；保留现有 `isError`、revision 冲突文案与脱敏行为；tool labels 小写下划线。
- [x] `node --test extensions/memory/__tests__/*.test.ts` 补长度一致性与未知字段负例。
- [x] `../pi-trellis/lib/subagent-rpc.ts`：参数由对象 `anyOf` 改为普通对象 + `additionalProperties: false`，动作依赖与 stop 禁用字段移到 `execute()` 校验；抽出可测的 `validateDispatchParams()`；启动不确定文案保留“可能已存在执行”。
- [x] `../pi-trellis` 负例补充：新增 `tests/dispatch-params.test.mjs`；`tests/dispatch.test.mjs` 旧 stop 空字段改为拒绝并保留无 RPC/租约 running 断言；既有不变量断言未弱化。
- [x] 自检：定向 47/47、Python 32/32；邻仓全量 554/555（viewer SIGKILL 待定性）。
- [x] 提交本阶段文件（两仓分别提交：本仓 `b516d0f`/`19d7701`，邻仓 `596955a`）。

## S5 整体验证与收口（A9/A10）
- [ ] 本仓库：隔离环境执行 `pnpm check`（现有 SDK，临时 agent dir，不安装依赖），并按需补跑自然退出的 focused suite。
- [ ] 真实宿主边界：校验类断言通过真实 `validateToolArguments`/`runToolCall` 验证，不只直接调用 `execute()`。
- [ ] 记录 PASS / FAIL / NOT_RUN：真实 PTY、在线模型质量、个人配置写与 reload 一律 NOT_RUN 并说明原因。
- [ ] 检查 `git diff --check`、新增文件空白、`python3 .trellis/scripts/get_context.py --mode packages`。
- [ ] 独立 check（`trellis-check` 或人工独立审查）→ 主会话复核 → 阶段/最终本地提交。

## 验证命令（实施后按实际文件确认）
```sh
node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/*.test.ts
node --test extensions/memory/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
sdk_dir="$(node -e 'const fs=require("node:fs");const p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
rm -rf "$agent_dir"
```
pi-trellis 侧：
```sh
env -u TRELLIS_CONTEXT_ID npm test
python3 -B -m unittest discover -s tests/python -p 'test_*.py'
```
以上为验证入口；实际结果见下方阶段进度，不能把计划命令当执行证据。

## 阶段进度（2026-10-15）
- S1 初稿 `9cf9694`，S2 初稿 `f108932`，S3 初稿 `10a150c` 已提交；独立审查发现的遗漏已补修完毕（见下）。
- Memory schema/160 codepoint 上限与小写下划线显示 label：`b516d0f` + `19d7701`；Memory 63/63，自然退出的宿主边界/worker 18/18。
- 独立审查：agent schema/message/nested resume/可见覆盖值、workflow author 分类与通知、bash signal/truncation 有需补修项。
- `70b87d5` 修 bash signal/退出码/UTF-8 与 detach 截断，并用 Number+multipleOf:1 防止 task_manage/Memory 宿主整数转换吞小数；真实 validator 数字和字符串 1.5 均拒绝；process/runtime/Memory/beautify 自然退出 580/580。
- 本仓 pnpm check 首次 FAIL（retained-child 初始化等待）；该文件单独 9/9，未改产品/fixture；补修后全量复跑 **1036/1036，exit 0**。
- pi-trellis 尚未迁入，S4 owner 为 `../pi-trellis/lib/subagent-rpc.ts`；已提交 `596955a`，迁入任务需包含该提交。
- 原始测试日志仅在 /tmp，不入库；最终保留最小结论。
- 最终独立审查：`5fbf096` 无阻塞缺陷；已修正其指出的模型可见契约文案、bash detach 注释与 effort 取值漂移。

## 精确边界
- 只提交本任务相关 hunks；保留工作区中既有的 Memory、TaskPanel、`10-15-builtin-pi-trellis` 等未提交改动。
- 不 push、不改写历史；用户已授权最终检查通过后自行收尾本 task（archive/deactivate/journal），不再逐项询问。未完成前保持 in_progress。
- 用户已批准实施本计划；范围变更（新增输出 schema、引入错误码词表、修改第三方包或宿主）需重新批准。
