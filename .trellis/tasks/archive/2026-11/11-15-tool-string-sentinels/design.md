# 设计：工具参数字符串哨兵

## 1. 边界

- **只改模型工具入口**：schema、模型可见文案、工具解析层、读取原始工具参数的渲染器与 `tool_call` 钩子。
- **不改内部契约**：agent 文件 frontmatter（`run_in_background`/`isolated`/`inherit_context` 等）、`AgentManager`/RPC/workflow `agent()` 选项、持久化执行配置、`task-ui` 执行配置展示。工具解析层输出的仍是现有内部参数形状（如 `AgentToolParams.run_in_background?: boolean`），新字段只在入口处映射。
- 这样各工具 `execute` 主体与下游几乎不动，改动集中在 schema + 解析。

## 2. 公共层（`extensions/shared/tool-arguments.ts`）

替换 `nullableControl()` / `parseControlArguments()`：

```ts
export const NULL = "null", DEFAULT = "default";

// Schema builders (no JSON null anywhere)
nullable(schema)            // anyOf: [schema, {type:"string", enum:["null"]}]；对字符串 enum 直接把 "null" 并入 enum
defaultable(schema)         // 同上，哨兵为 "default"，另并入 "null"（D10）
numeric({ sentinels })      // {type:"string", pattern:"^(null|default|[0-9]+)$" 按声明哨兵生成}

// Field spec drives parsing
type ControlKind = "nullable" | "defaultable";
interface FieldSpec { kind?: ControlKind; numeric?: { min: number } }

parseSentinelArguments(value, specs: Record<string, FieldSpec>): {
  present: Record<string, unknown>;     // 真实值（数字已转换）
  sentinel: Record<string, "null" | "default">; // 原始哨兵，供分支白名单判断
}
```

解析步骤：
1. 对象检查、未知字段拒绝、缺失/`undefined` 拒绝（行为与现有一致）。
2. 每个控制字段：值为 `"null"` 或（defaultable 字段的）`"default"` → 记入 `sentinel`；数字字段按 `^[0-9]+$` 转安全整数并校验 `min`，失败报 `` `limit` must be a positive integer string, "default" or "null". `` 这类指向字段的错误。
3. 返回后由各工具做分支判断：
   - **不适用**字段：`sentinel[field] === "null"` 才通过；`"default"` 或真实值报 `` `model` does not apply to resume; set it to "null". ``。
   - **适用且有默认**字段：`"null"`/`"default"` 都视为未提供（D10）。
   - **必填**字段：哨兵即缺失。
   - 提供共享 helper `requireNotApplicable(parsed, fields, context)`、`optionalValue(parsed, field)`，避免各工具重复写。
4. 哨兵仅对声明了该 kind 的字段生效；未声明字段（如 `prompt`、`message`）里的 `"null"` 是字面文本（D4）。

`"null"` 与真 `null`：pi `coerce: true` 在校验前把真 `null` 转为 `"null"`；解析层直接调用（测试、`assert*` 路径）时，真 `null` 不再被接受，错误提示用 `"null"`（D8）。

## 3. 各工具映射

### subagent_run（顶层 + 嵌套共用 `tool-contract.ts`）
- 模式：`resume` 为 `"null"` → 新建；否则恢复。
- 新建：`description`/`subagent_type` 必填；`model`/`thinking`/`execution`/`tools`/`context`/`isolation` defaultable。
- 恢复：`description`/`subagent_type`/`model`/`thinking`/`tools`/`context`/`isolation` 必须为 `"null"`；`execution` 顶层 defaultable，嵌套不适用（嵌套恢复原本不接受 `run_in_background`）。
- 映射：`execution: foreground→run_in_background:false, background→true`；`tools: builtin→isolated:true, full→false`；`context: inherit→inherit_context:true, fresh→false`；`"default"`→不设。
- schema 构造从 `invocation-config.ts` 的 `thinkingParam()`/`isolationParam()` 改为 defaultable；新增 `executionParam()`/`toolsParam()`/`contextParam()` 共享给嵌套工具，防止漂移。

### subagent_workflow
- 四个字段 nullable；来源三选一 + 重放规则不变，只是判断从"属性存在"改为"非 `"null"`"。

### subagent_message / reply_to_parent
- `reply` 必填 enum `skip|wait|notify`；`skip` 映射为原无 reply。`MESSAGE_REPLY_MODES` 内部保持 `wait|notify`，入口映射。
- `request_id` nullable。

### process_manage / agent_manage（`runtime-tasks/tools.ts`）
- 保留 `fields` 动作表，扩展为 `{ field: "required" | "optional" }`，未列字段即不适用（只接受 `"null"`）。
- `offset` nullable 数字（`"null"` = 尾部）；`limit`/`context` defaultable 数字；`case`/`detail` defaultable enum；`task_type`/`kind` nullable enum（`"null"` = 不过滤）。
- 映射：`case: insensitive→ignore_case:true`；`detail: full→verbose:true`。下游 `ManagementParams` 不变。
- D9：`status|output|wait|stop` 要求 `agent_id`、`execution_id` 恰好一个非 `"null"`；workflow 目标 `detail` 只能是 `"null"`/`"default"`/`"summary"`。
- `fields` 表同时供 `validateManagementParams` 与使用说明，避免文案与校验漂移。

### monitor
- `command` nullable string；`ws` = `anyOf[对象, enum["null"]]`；`ws.protocols` 必填数组（`[]` → 不传）；`timeout_ms`/`wake_absent_ms` nullable 正整数字符串（`exclusiveMinimum: 0` → min 1）。
- 传给下游的 `timeout_ms: number | null` 不变。

### trellis_dispatch（手写 JSON schema）
- `action` 必填 `dispatch|stop`；`agent` 角色 enum + `"null"`；`task` string + `"default"`（D10 下 `"null"` 同 default）；`prompt` string + `"null"`。
- `stop` 时 `agent`/`prompt` 必须 `"null"`。不复用 TypeBox 构造（该文件刻意手写 schema），但复用 `parseSentinelArguments`。

### memory_write
- `expectedRevision`：`anyOf[Revision, enum["null"]]`；`"null"` = 创建。

## 4. 跨扩展读取原始参数

| 位置 | 处理 |
|---|---|
| `trellis/index.ts:1236-1239` | `isolation === "worktree"` 不变；`isolated` 改为 `tools`（仅类型声明/读取处）；`subagent_type: "null"` 不是 Trellis 角色，`isTrellisRole` 天然返回 false |
| `beautify/tools/management.ts:10` | 选取第一个非 `"null"` 的 id |
| `beautify/tools/monitor.ts:17` | 先把 `"null"` → null、数字字符串 → number 再比较 |
| agent 卡片渲染器（`agent-tasks/src/index.ts` `agentCardRenderers` 及相关） | 读取 `execution` 等新字段；哨兵不显示 |

## 5. 文案

- 所有字段描述采用一致句式：`"null" when <不适用条件>`、`"default" uses <默认来源>`；示例中每个未用字段写 `"null"`/`"default"`。
- `tool-guidance.ts` 中 "Set unused controls to null" 一类规则改写为两层词汇规则（"null" = 不适用，"default" = 按配置），并保留各工具示例。
- 技能参考文档（`skills/subagents/references/*.md`）中的工具调用示例同步；workflow 脚本 `agent()` 选项示例**不改**（内部契约）。
- spec：`sdk-compatibility.md` §4 改写；在 §3 增加"模型工具哨兵约定"（两词汇、分支规则、D10、内部契约不变）。

## 6. 兼容与回滚

- 协议不兼容变更，仅影响模型调用；无持久化迁移。会话历史中的旧工具调用只用于展示，渲染器需容忍旧字段（不报错，按旧值显示或忽略）。
- 回滚：按阶段提交，任一阶段可单独 revert；公共层阶段保留旧 helper 直到最后一个工具迁移完再删除。

## 7. 风险

- 新字段名（`execution`/`tools`/`context`/`case`/`detail`）未经线上探测；E2E 验收覆盖 Claude 与 GPT 渠道，若出现填错再调整描述，命名变更需回到用户确认。
- `context` 在 `subagent_run`（fresh/inherit）与 `process_manage`（行数）含义不同，但分属不同工具；描述中写清。
