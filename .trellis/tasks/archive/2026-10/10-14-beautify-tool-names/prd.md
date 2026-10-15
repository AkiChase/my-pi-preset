# Beautify 工具标题保留真实名称

## 目标

用户不应靠文件路径、命令或任务描述猜测工具类型。Beautify 自己绘制的每个工具标题都应保留真实注册工具名，大小写原样；参数、描述和统计作为后续信息。未覆盖工具保持插件原有渲染或 Pi 默认渲染。

## 授权与状态

- 用户认可上述展示规则，并同意进入任务规划。
- 用户已明确批准按本 PRD 开始实施；授权包括本范围验证和阶段本地提交，不包含 push、安装、个人同步、reload 或归档。
- 轻量单阶段任务，PRD 同时承载执行计划；无阻塞产品问题。

## 已确认事实

- `extensions/beautify/tools/shared.ts:8-12`：read 标题只有路径，bash 以 `$` 开头，find/grep 有注册名前缀。
- `extensions/beautify/tools/shared.ts:23-30`：折叠和展开共用标题；折叠调用 `summary`。
- `extensions/beautify/layout.ts:45-65`：标题作为整体进行中间截断，不能只补前缀而让真实工具名在长标题下再次消失。
- `extensions/beautify/index.ts:13-19`：覆盖 read/bash/find/grep；适配 get_subagent_result/jobs；其他工具直接 `next()`。
- `extensions/beautify/tools/optional.ts:19-28,46-50`：未知结果保留原 renderer/fallback；识别结果时标题来自 contract，可能为 Agent、描述或 job 信息，而非工具名。
- 已安装 `@juicesharp/rpiv-ask-user-question/ask-user-question.ts:378-379`：注册名 `ask_user_question`，label 为 `Ask User Question`，未注册 renderCall。Pi 默认调用渲染传入真实 toolName，不使用该 label；小写属于注册名本身，并非 Beautify 转小写。

## 范围与要求

### R1 明确工具身份

Beautify 自有标题统一显示准确注册名：`read`、`bash`、`find`、`grep`、`get_subagent_result`、`jobs`。不转换成 Read/Bash 等展示别名，不翻译、不替换下划线。参数、路径/offset、command、job/agent 描述和统计保留在工具名之后。不要重复 find/grep 已有前缀。

### R2 宽度与状态

等待、成功、错误、折叠、展开状态均遵守名称规则。在可容纳完整工具名的实际内容宽度下，优先保留完整名称，剩余宽度用于参数和统计；不能因长路径或描述的中间省略丢掉名称。宽度不足时安全截断，不越界，不承诺不可能容纳的完整字符串。保留控制字符清洗、ANSI 背景/颜色所有权和展开交互。

### R3 未覆盖与委托边界

`ask_user_question` 等未覆盖工具继续 `next()`；不接管第三方交互界面，不修改其包或 Pi SDK。get_subagent_result/jobs 未识别 payload 继续委托原 renderer，或使用现有 fallback；不为统一名称覆盖原 renderer 的合法标题。此任务保证的是 Beautify 自有标题，不是任意第三方自定义 renderer 的外观。

## 验收标准

- [x] AC1：六种覆盖工具在 Beautify 自有标题中均出现准确注册名，find/grep 没有重复名称。
- [x] AC2：read 保留路径/offset；bash 保留命令及 timeout；检索适配保留有用描述/状态/统计。
- [x] AC3：长路径、长命令、长描述下，当内容宽度足够时名称完整；窄宽度、中文和 ANSI 输出不越界。
- [x] AC4：等待/成功/错误、折叠/展开回归通过。
- [x] AC5：未覆盖工具 resolver 透传，ask_user_question 的注册名及交互不变；未知检索 envelope 的委托与 fallback 回归通过。
- [x] AC6：相关 focused tests、typecheck 与全量测试通过，记录具体命令与未执行的真实 TUI 验证。

## 单阶段实施与提交检查点（已批准）

1. 实施前加载 trellis-before-dev，读取 preset repository/extension/testing/documentation 规范及相关 guides。
2. 主会话直接实施共享标题组成及截断预算；更新两个 optional adapter 自有标题的名称组成，保持 contract 内容和委托边界。
3. 补充 `extensions/beautify/__tests__/` 名称、宽度、各状态与透传/委托回归；按需同步用户功能说明，仅选择本任务文档 hunks。
4. 主会话按 trellis-check 自检：本任务是显示层局部变化，不更改工具执行/API或跨模块契约，采用主实施→主自检，不宣称独立评审。
5. 检查实际 diff、运行验证，通过后立即提交本阶段精确文件/hunks，保留并行修改；实施批准包含本范围本地 commit。无 push、安装、个人同步、reload、归档或 journal 授权。

计划命令（不获取依赖）：

```bash
node --test 'extensions/beautify/__tests__/*.test.ts'
pnpm run typecheck
pnpm run test
git diff --check
```

## 风险与排除项

- 工具名占用横向空间；参数和统计在窄宽度下可能更早省略，这是身份优先的预期权衡。
- 不改模型侧工具名称/参数/执行结果，不增加全局工具 renderer 接管，不追求第三方 UI 样式统一。
- 当前 README、docs 和 specs 存在并行工作，不覆盖或混入其他任务修改。
- 离线组件测试不等同真实 tmux/问卷视觉验收；未执行时如实报告。

## 实施结果

单阶段实施与主会话自检完成，产品提交为 `7abd9fe`。最终 focused 71/71 自然退出，strict typecheck 与 full 699/699 通过；后续真实 tmux/问卷终端验收 89/89 PASS、error=null、exit 0。详见 [验证记录](research/main-verification.md) 和 [终端验收](research/terminal-acceptance.md)。

## 收尾（2026-10-15）

用户已接受交付并授权收尾。本任务在 main 直接实施，未使用独立 feature branch 或 PR；归档使用明确的 `--skip-branch-validation`，不宣称 PR 已合并。保留上述历史验收证据，不将其视作后续 runtime 工具迁移后的重新测试；工具 API 改名及适配由已完成的 runtime-task-tools 任务承接。本次仅更新任务完成记录、归档和 journal，无产品改动，无 push、安装、个人同步或 reload。既有开发规范已覆盖标题宽度与委托约束，无需新增 spec。
