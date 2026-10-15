# 设计：Tool 输入校验与错误反馈

## 1. 分层职责

| 层次 | 负责 | 不负责 |
| --- | --- | --- |
| `parameters` schema（宿主校验） | 类型、枚举、数值范围、字符串长度、禁止未知字段、嵌套对象形状 | 跨参数依赖、运行时状态、被宿主静默转换的规则 |
| `execute()` 前置校验 | 整数性、正数性、互斥/依赖、目标状态、授权与绑定、上游记录一致性 | 重复实现 schema 已能表达的静态规则 |
| `content` + `isError` | agent 可纠正的失败说明与失败标记 | 结构化错误码、UI 细节 |

原则：**能在 schema 表达的，不在运行时重复；宿主会静默修正的，必须在运行时补查。**

## 2. Schema 收紧规则

1. 固定参数对象统一声明 `additionalProperties: false`；嵌套对象（如 monitor 的 `ws`）同样收紧。
2. 有限取值使用枚举（`StringEnum` 或 `Type.Union(Type.Literal)`），例如 `thinking`、`action`、`task_type`。
3. 整数语义使用 `Type.Number({ multipleOf: 1, minimum, maximum })`，而不是 `Type.Integer`：宿主会先把后者的 `1.5` 转成 `1`，运行时无法恢复原值。真实 validator 已验证 Number 保留数值/字符串小数并按 multipleOf 拒绝；整数数字字符串仍可转换。直接调用保留 safe-integer 检查。
4. 字符串补充 `minLength` / `maxLength`，长度上限必须与运行时策略一致（Memory 的 320 与 160 不一致必须收敛为一个值）。
5. 不使用 `oneOf` / `if-then` 等严格模式不支持的组合表达互斥；互斥放运行时。

已验证：`additionalProperties: false` 在宿主校验中生效并给出字段路径；该形态通过严格模式转换（`makeStrictJsonSchema` 接受 `additionalProperties: false`，拒绝对象 `anyOf`）。**因此 `../pi-trellis/lib/subagent-rpc.ts` 现有的对象 `anyOf` 不能原样保留为严格模式形态**，需改为普通对象 + 运行时校验。

## 3. 各 owner 的改动契约

### 3.1 process-tasks（bash / monitor）
- `extensions/process-tasks/tools/bash-params.ts`：收紧对象；timeout 为正数；字段描述保留动态默认值。
- `extensions/process-tasks/tools/bash.ts`：
  - 运行时补整数/正数与非有限值检查，并处理乘 1000 后超出 Node timer 上限的 timeout（改为分段或上限钳制并说明）。
  - 未知键在 `execute()` 再查一次，覆盖绕过宿主的程序调用路径。
  - 前台结果补齐 `structuredContent`：`{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`，成功与非零退出都返回；字符串截断语义与内置保持一致。
  - 非零退出：模型可见文本始终包含退出码，不再依赖日志是否为空。
  - signal 终止与 Esc 取消区分：保留“主动取消不算失败”，其余信号按失败标记并说明信号。
- `extensions/process-tasks/tools/monitor.ts`：对象与 `ws` 收紧；源判定改为按**字段是否提供**判断，而非按值是否为空；错误文本指出冲突字段。

### 3.2 runtime-tasks（task_manage）
- `extensions/runtime-tasks/facade.ts`：schema 字段补 `apply 条件` 描述；`offset/limit/context` 改 `Type.Integer`；保留按 action 的现有白名单与 `details.runtimeTask` 结构不变。
- `extensions/runtime-tasks/contracts.ts`：`validateRuntimeTaskParams` 的返回从单一字符串改为可携带字段名的结果，错误文本列出非法字段、该 action 允许的字段集、以及是否需要移除；错误码枚举保持不变（现有消费者继续工作）。

### 3.3 agent-tasks
- `extensions/agent-tasks/src/index.ts`：新增明确的失败结果 helper（`content` + `isError: true`），仅替换失败分支，不改成功分支；`thinking` 改枚举；`prompt`/`description`/steering `message` 补非空约束；resume 与启动参数冲突在执行开始时一次性拒绝，避免先校验后忽略。
- `extensions/agent-tasks/src/nested-tools.ts`：同步字段收紧；嵌套已标记 `isError`，保持。
- `extensions/agent-tasks/src/invocation-config.ts`：调用参数被 agent frontmatter 覆盖时，把实际生效值写入工具结果的可见文本；不改变优先级语义。
- `extensions/agent-tasks/src/workflow/worker-source.ts`：区分**脚本作者错误**（未知 `opts`、非法 effort/schema/resume 组合）与**子任务失败**；作者错误继续传播（不被 `parallel`/`pipeline` 吞成 `null`），子任务失败保持 `null` 语义但记录分支、阶段与原因。
- `extensions/agent-tasks/src/workflow/runtime.ts`、`task.ts`：把分支失败原因汇总进最终返回值/通知，供 `task_manage output` 读取；不修改脚本返回值本身。

设计约束：`parallel`/`pipeline` 的容错是文档化语义（脚本用 `.filter(Boolean)` 而非 try/catch），因此**不改成抛错**；只把可纠正的调用错误（参数拼写、非法枚举）从“分支失败”类别中移出。

### 3.4 Memory
- `extensions/memory/tools.ts`：对象收紧；`description` 长度与 `policy.ts` 对齐；`query` 长度声明与策略一致。
- `extensions/memory/policy.ts`、`store.ts`：保留现有 `isError` 与 revision 冲突文案；文件系统错误保留安全错误码（`io`），不回显原始路径/凭证。

### 3.5 pi-trellis（`../pi-trellis/`）
- `lib/subagent-rpc.ts`：`trellis_dispatch` 参数从对象 `anyOf` 改为普通对象 + `additionalProperties: false`，把现有 `action/agent/prompt` 依赖与 stop 的禁用字段移到 `execute()` 明确校验；错误文本指出字段与允许值。
- 保留全部既有守卫（根目录、runtime manifest、adapter 配置、绑定、递归派发、in_progress 前置）；启动不确定的错误必须保持“可能已存在执行”的表述，不得改写成“没有启动”。
- 抽出小型可测的参数校验函数，便于直接单测；RPC 超时与 spawn 不确定路径文案明确保留处置指引。

## 4. 错误消息约定（不引入错误码）

统一的是**结构位置**与**信息完备性**，不是文案模板：

- 位置：`isError: true` + `content` 文本；`details` 保持各 owner 现状。
- 内容必须回答四问：哪个字段/前置条件、期望什么、如何修正、是否已产生副作用。
- 泛化禁止：不得用“操作失败”替代已知原因；不得把已知原因替换为无信息文案。
- 多错误可一次列出，但上限有限，避免淹没上下文。
- 保留既有安全边界：不回显凭证、原始未净化路径或不受信内容。

## 5. 数据流与兼容性

- 输入：模型参数 → `prepareArguments`（仅 ask-user-question 使用，本次不动）→ 宿主 schema 校验 → `execute()` 运行时校验 → 副作用 → 结果。
- 结果：`content`（模型）+ `details`（UI/状态）+ `structuredContent`（仅 bash，程序调用）。
- 兼容：task_manage 的 `details.runtimeTask`、Memory 的 `details.error`、beautify 的 `taskManageContract` 识别逻辑必须保持可解析；bash 新增 `structuredContent` 只增不改 `details.runtimeLaunch`。

## 6. 验证策略

- 负例优先：未知字段、非法枚举、非整数、非正数、互斥字段、过期 run_id、不存在 agent、非 in_progress 任务。
- 断言副作用缺失：拒绝后无 spawn、无 Memory 写、无输出消费、无 RPC 发出。
- 结果契约：失败结果 `isError === true` 且 `content` 含字段名；bash 成功与非零退出的 `structuredContent` 形状一致。
- 宿主边界：校验类断言走真实 `validateToolArguments`，不只调用 `execute()`。
- workflow：作者错误传播 vs 子任务失败容错的对照用例。
- pi-trellis：`npm test`（含 `tests/dispatch.test.mjs`、`tests/source-executions.test.mjs`）与 Python 测试。

## 7. 回滚与风险

- 每阶段独立提交，schema 收紧与 emitter 改动同阶段落地，避免出现“声明已收紧、文案未更新”的中间态。
- 若某工具因未知字段收紧导致既有合法调用被打断，优先修正调用方（提示/测试/fixture），不通过放宽 schema 回退。
- `thinking` 枚举化若与现有配置冲突，需先确认配置取值再实施，必要时保留未知值并给出可见警告而非静默降级。
