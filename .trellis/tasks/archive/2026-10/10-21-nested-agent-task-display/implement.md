# 实施计划：嵌套 Agent 任务展示

## 授权边界

当前仅完成计划，不实施产品代码。用户审阅并明确批准本计划后，才可执行 `task.py start`、修改产品代码、运行验证并提交。

## 变更边界

- **最小行为缺口**：Footer 仅显示根任务、Task UI 对运行态使用 spinner 且行中重复状态文本；这使嵌套 Agent 层级不可见或不一致。
- **实际所有者**：任务树派生属于 `extensions/task-ui/model.ts` 与 `overview.ts`；静态字形和行布局属于 `presentation.ts`；更新时钟属于 `owner.ts` 与 `panel.ts`。
- **预期修改**：仅限 `extensions/task-ui/` 的上述生产文件和其聚焦测试。若实现时确认 `agent-tasks/source.ts` 已完全提供短名与 `parentKey`，不修改它。
- **明确不做**：不改变 Agent 管理 API、真实 ID、任务 source 生命周期、调度、workflow 卡片或内联 tool card。

## 阶段 1：共享静态表示与树派生

1. 在 `presentation.ts` 将任务状态映射固定为静态字形，运行/启动统一为 `●`。
2. 调整 `taskLine()` 和 `taskStatusLine()`：树连接符在前，字形紧随其后，Agent 短名随后；移除普通状态文字和 Agent 类型冗余。
3. 从 `TaskPanelModel` 提取或新增纯树行构建单元，使 overview 与 panel 使用相同的 `parentKey`、循环容错和前缀规则；保留 panel 的折叠、选择与详情逻辑。
4. 更新或新增 `panel.test.ts` 断言：嵌套 Agent 行为 `└─ ● general-purpose-N`、不同状态字形、非 Agent 可辨识性、窄宽度及既有导航/折叠不变。

**阶段检查**：

```sh
node --test extensions/task-ui/__tests__/panel.test.ts
```

通过检查后审阅实际 diff，并提交本阶段的生产代码与对应测试。

## 阶段 2：Footer 层级和静态刷新

1. 将 `TaskOverviewModel` 的保留与渲染输入扩展为完整根组树，而非仅根节点。
2. 实现有界的深度优先 Footer 行选择：活动子 Agent 需与其祖先共同可见；无法容纳时输出显式 hidden 汇总。
3. 保留终态 linger、会话重置、孤儿/循环容错和宽度安全。
4. 在 `owner.ts` 与 `panel.ts` 移除 spinner 专用的 250ms 刷新；保留时长和完成态过期所需更新。
5. 更新或新增 `overview.test.ts`：嵌套子 Agent 可见、父子前缀/字形一致、预算截断可解释、无 spinner 帧、禁用动画配置不影响静态字形、时长与 linger 仍更新。

**阶段检查**：

```sh
node --test extensions/task-ui/__tests__/overview.test.ts extensions/task-ui/__tests__/panel.test.ts
```

通过检查后审阅实际 diff，并提交本阶段的生产代码与对应测试。

## 阶段 3：集成复核

1. 检查共享 Footer 发布仍仅通过 `createWidgetClient()`；不引入 `setFooter`/`setWidget` 的直接调用。
2. 自审共享树提取不会改变 panel 的 selection、collapse、cycle/orphan 容错或 detail I/O 边界。
3. 运行现有 SDK 链接与临时 Agent 配置隔离下的相关测试；按测试规范先确认 SDK 路径和临时目录，完成后仅清理本次创建的目录。
4. 运行静态检查与全量检查。

**计划验证命令**：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/task-ui/__tests__/overview.test.ts extensions/task-ui/__tests__/panel.test.ts
result=$?
rm -rf "$agent_dir"
(exit "$result")

pnpm typecheck
pnpm check
git diff --check
```

验证时记录实际执行的命令、环境、退出码、失败原因及重跑关系；未执行项必须标为未执行，不能视为通过。

## 审查策略

主会话直接实现：改动范围集中、现有测试已覆盖实际 Task UI owner/panel 边界。完成各阶段后执行主会话自审；最终阶段安排独立 `trellis-check` 审查，因为 Footer 与 Task panel 共享模型且涉及可见的跨界面一致性。

独立审查应重点检查：树预算是否始终保留祖先、静态字形是否真的移除了所有 spinner 更新路径、窄宽度与终态 linger 是否回归、以及非 Agent 行是否仍可辨识。

## 实施与验证记录

### 已完成

- 提交 `d1e5d6c feat(task-ui): unify nested agent display`：共享 `parentKey` 树投影；Footer 展示嵌套行与 `+N hidden` 截断；生命周期字形改为静态；移除 Footer 与任务面板的 spinner 专用刷新；任务面板改为树枝、字形、短名顺序。
- 独立 `trellis-check` 审查发现 `starting` 使用 warning 而非设计要求的 accent；已在 `3645504 fix(task-ui): keep starting agents accent` 修复，并新增状态颜色断言。
- `8c36278 chore(trellis): update context loading resources` 是用户要求单独提交的 Trellis resource 更新，不属于本功能实现。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `node --test extensions/task-ui/__tests__/presentation.test.ts extensions/task-ui/__tests__/overview.test.ts extensions/task-ui/__tests__/panel.test.ts` | PASS，53/53；首次运行中的旧 spinner/文字断言失败后已更新，最终重跑通过。 |
| `pnpm typecheck` | PASS。 |
| `pnpm check` | PASS，1619/1619，退出码 0。 |
| `git diff --check` | PASS。 |
| 独立 `trellis-check` | 完成。审查范围为 `d1e5d6c`；其唯一 P2 发现已由 `3645504` 关闭。修复后再次运行 `presentation.test.ts` 10/10 和 `pnpm typecheck`，均通过。 |

### 限制

未执行真实交互 TUI 截图验证；现有 Task UI owner/panel 组件测试覆盖了宽度、树层级、时钟、终态 linger 和生命周期边界。

