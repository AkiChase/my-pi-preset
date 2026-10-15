# Tool 参数校验与错误反馈统一

## 目标与用户价值
自有 tools 与 `../pi-trellis/` 的调用错误，应让 agent 能看出错在哪个参数、期望什么、怎么改，而不是静默忽略或只给一句无法纠正的笼统文案。范围限定输入侧。

## 背景与已确认事实
- 当前宿主 Pi 1.2.0 自动执行 `parameters` schema 校验，失败发生在 `execute()` 之前并返回模型可见文本；`execute()` 抛异常同样进入模型可见结果。返回文本不会自动标记失败，必须 `isError: true`。
- 默认开放 `Type.Object` 接受未知字段；声明 `additionalProperties: false` 后实测会拒绝，并报出字段路径（含嵌套，如 `ws.protcols`）。`Type.Integer` 不阻止小数，实测 `1.5` 被静默转成 `1`（`pi-ai/dist/utils/validation.js` 的 `Value.Convert` + 可选 null 归一）。
- 宿主会做类型转换（字符串数字变数字、可选 null 视为省略），运行时收到的是转换后的值，不是原始 JSON。
- 输出侧契约不属于本次范围。`outputSchema` 描述 `structuredContent`，宿主当前不校验返回值；`structuredContent` 不发给模型，仅在工具声明 `outputSchema` 且返回它时交给 codemode 脚本。
- 现有错误数据约定已存在但不统一：`details.runtimeTask.error_code`（枚举）与 `details.error`（码字符串），均配合 `isError: true`；另有一批失败分支完全未标记失败。

## 已发现的具体缺陷（含证据锚点）
1. **未知字段静默忽略**：`extensions/process-tasks/tools/bash-params.ts:13`、`extensions/process-tasks/tools/monitor.ts:51`、`extensions/agent-tasks/src/index.ts:1677`、`extensions/memory/tools.ts:23,33,43,54` 均为开放对象；executor 也不拒绝未知键，`{"command":"…","timeuot":1}` 会被执行而非报错。
2. **失败被当作成功返回**：`extensions/agent-tasks/src/index.ts:91` 的 `textResult()` 从不设置 `isError`，却被用于 agent 不存在、模型不存在、schedule 冲突、resume 目标无效、steering 失败等分支（`:1862,1893,2009-2020,2049-2053,2945-2948,2980`）。
3. **workflow 吞掉可纠正原因**：`extensions/agent-tasks/src/workflow/worker-source.ts:450-481` 的 `opts` 校验错误清晰（`modle` 未识别），但 `parallel()`（`:568-570`）与 `pipeline()`（`:599-601`）捕获普通异常返回 `null`；宿主侧 agent 失败同样变 `null`（`workflow/runtime.ts:1119-1133`），最终通知只见返回值。
4. **声明与语义不一致**：`extensions/agent-tasks/src/index.ts:1700` 的 `thinking` 为任意字符串，非法值靠类型断言传递；`extensions/memory/tools.ts:43` 声明 `description` 最长 320，实际策略限制 160（`extensions/memory/policy.ts:27`）。
5. **错误信息不可纠正**：`extensions/runtime-tasks/contracts.ts:90` 仅返回 `Inapplicable field for <action>.`，不指出字段与允许集；`extensions/process-tasks/spawn.ts:116-124` 把 spawn 失败简化成一条无原因文案。
6. **bash override 丢失结构化输出**：`extensions/process-tasks/tools/bash.ts:66` 用 `...originalBash` 继承了内置 bash 的 `outputSchema`（`output/truncated/full_output_path/exit_code/wall_time_seconds`），但 `execute` 只返回 `content` 与 `details`，`structuredContent` 缺失，脚本侧只能拿到文本。
7. **monitor 源判定与前台结果**：`extensions/process-tasks/tools/monitor.ts:78-84` 把空字符串当作“未提供”，可同时传 `command` 与非空判定失败的 `ws`；`extensions/process-tasks/tools/bash.ts:235-241` 非零退出时若日志已有输出，则不回显退出码；所有 signal 死亡一律按主动取消处理。

## 需求
- **R1 输入 schema 补完**：自有 tools 与 `../pi-trellis/lib/subagent-rpc.ts` 的固定参数对象声明禁止未知字段；能静态表达的枚举、数值范围、长度约束补齐；字段描述写明单位与适用条件。仅使用 TypeBox 能表达、且宿主严格模式可接受的形态。
- **R2 运行时校验**：schema 无法表达或会被静默转换的规则，在 `execute()` 首个副作用之前检查，包括参数的整数性与正数性、互斥与依赖、目标状态（agent 运行中、run_id 未过期、任务 in_progress）、授权与绑定。运行时规则不得与 schema 声明矛盾。
- **R3 错误消息**：所有拒绝分支返回 `isError: true`，说明进入模型可见 `content`，内容覆盖“哪里错、期望什么、怎么改、是否已产生副作用”。不得只写入 `details`、日志或 UI。已知原因不得被泛化文案取代或被 `null` 吞掉。
- **R4 bash 结构化输出修复**：override 在成功与非零退出两种情况下都返回与内置声明一致的 `structuredContent`；signal 终止与非零退出在模型可见结果中可区分。

## 非目标
- 不统一 `details` 整体形状，不迁移 task_manage / Memory 的既有错误码位置。
- 不新增全局错误码词表。
- 不声明新的 `outputSchema`，不扩大 `structuredContent` 覆盖面（仅修复 R4 的既有声明）。
- 不修改 Pi 宿主、不新增全局 `tool_call` 拦截器、不修改第三方包（pi-web-access、rpiv-ask-user-question 等）。
- 不改 success 路径的既有业务语义与 UI 渲染契约。

## 验收标准
- A1：对每个受改工具，传入拼写错误或未知参数时，调用在 `execute()` 之前被拒绝，且错误文本包含出错字段路径。
- A2：各工具原有合法性检查（例：`notify` 需 `run_in_background=true`）仍生效，且不再出现 schema 与运行时规则互相矛盾的情形。
- A3：`1.5` 之类的非整数分页/上下文参数通过 Number+multipleOf:1 在宿主校验前保留并拒绝（不得先转成整数）；直接调用由 safe-integer 守卫拒绝；非正 timeout 被拒绝。
- A4：agent 不存在、模型不存在、resume 无效、schedule 冲突、steering 失败等分支返回 `isError: true`，不被宿主计为成功。
- A5：workflow 中拼错的 `opts` 与非法 effort 不再以 `null` 静默结束；失败原因可从最终通知与 `task_manage output` 读到。
- A6：被拒绝的调用不产生副作用（不 spawn 进程、不写 Memory、不消费 task 输出、不发 RPC），并有测试断言。
- A7：bash 成功与非零退出均返回符合内置 `outputSchema` 的 `structuredContent`；非零退出在模型可见结果中包含退出码；signal 终止不被表述为普通成功。
- A8：monitor 同时收到 `command` 与非空 `ws` 时必须报错，且错误指出冲突字段。
- A9：既有回归（process 的 `waits/monitor/lifecycle`、agent 的 `tool-waits/backend-waits`、beautify 的 `task_manage` 契约、memory tools）全部通过；`../pi-trellis` 的 `npm test` 与 Python 测试通过。
- A10：无法真实执行的项目（真实 PTY、在线模型质量、个人配置写）明确记为 NOT_RUN，不以模拟结果替代。

## 关键决策
- 错误码不作为统一目标；已有枚举保留，仅作为现有 UI 消费者的数据，不要求新工具新增。
- 输出 schema 与 `structuredContent` 只在 R4 修复既有破损声明，不扩展。
- schema 校验交给宿主，项目不重复实现同一套静态校验；运行时只补宿主无法表达或会静默转换的规则。
- 危险默认值（未知字段放行、小数取整）通过声明与运行时双层收紧；整数语义用 Number+multipleOf:1，避免 Type.Integer 宿主转换先丢失小数。

## 风险与依赖
- 收紧未知字段可能暴露既有调用方（含测试 fixture 与角色内存提示）传入的多余字段；需要逐工具确认并修正提示或测试，不通过放宽 schema 处理。
- `task_manage` 的 `details.runtimeTask` 是 Beautify 的显式契约，改动必须保持结构兼容。
- 与 `10-15-builtin-pi-trellis`（把 pi-trellis 迁入本仓库）存在 owner 冲突：两任务都触及 dispatch 参数校验。若该任务先落地，本次应改为在迁入后位置修改，不保留重复实现。
- `thinking` 改为枚举可能影响用户配置中的自由文本值；需要确认现有配置与 agent frontmatter 是否只使用合法等级。

## 待确认
无阻塞项。owner 顺序作为实施前置检查处理。
