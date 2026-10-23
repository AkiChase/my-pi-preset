# 实施计划：内部浮层交互运行时

## 约束

- 模块仅供内部使用，位于 `extensions/shared/interaction/`，不提取为独立包。
- 本任务仅覆盖浮层运行时及 Memory、Task UI 迁移，不包含对话流程与 Recap。
- 不新增平台目录或交互根入口，不移动 Widget Display 与 scroll-panel。
- 保留当前 README、`docs/` 等无关未提交修改，不恢复、修改或纳入本任务提交。
- 代码、注释、提交消息使用英文；任务文档正文使用中文，保留标识符、命令、路径和原始证据。

## 阶段一：共享运行时与契约

1. 在 `extensions/shared/interaction/` 增加最小类型契约与浮层运行器。
2. 实现能力预检、取消信号关联、使用方所有权检查、`onHandle` 前延迟关闭、幂等清理。
3. 增加针对正常完成、用户关闭、失效、不支持、工厂异常与重复释放的测试。
4. 验证后提交本阶段代码与测试。

**验证点：** 严格类型检查与共享模块测试通过；尚未迁移使用方，不改变扩展的可见行为。

## 阶段二：迁移 Memory

1. 使用共享运行器替换 `extensions/memory/command.ts` 的浮层安装与收尾逻辑。
2. 保留操作标识、cwd/origin 检查、详情与刷新序号、原生布局错误文案、非 TUI 行为。
3. 保留或补充 `extensions/memory/__tests__/command.test.ts` 对安装前关闭、同步重入、迟到读取与并发准入的行为断言。
4. 验证后提交本阶段迁移与测试。

**验证点：** Memory 相关测试通过，不出现 `done before install` 或重复调用 `done()`。

## 阶段三：迁移 Task UI

1. 使用共享运行器替换 `extensions/task-ui/owner.ts` 的 installed/closeRequested/completed 生命周期逻辑。
2. 保留生命周期、版本与交互标识检查、布局加载边界、TaskPanel 释放及 status/widget 行为。
3. 保留或补充 `extensions/task-ui/__tests__/panel.test.ts` 对延迟 `onHandle`、关闭重入、原生布局失败的覆盖。
4. 验证后提交本阶段迁移与测试。

**验证点：** Task UI 相关测试通过，关闭或同步重入不会复活浮层或关闭无关交互。

## 最终检查

1. 检查共享契约、两个使用方、结果分类与清理路径，确认 Widget Display 和 scroll-panel 未被改变。
2. 运行相关自然退出测试，不使用 `--test-force-exit`；运行 `pnpm typecheck` 与 `pnpm check`。
3. 记录实际命令、环境、退出码、失败原因、重跑关系和未运行限制。
4. 检查最终 Git 差异，保留所有无关修改。不推送、不安装依赖、不自动归档任务。

## 计划验证命令

```sh
node --test extensions/shared/interaction/__tests__/*.test.ts \
  extensions/memory/__tests__/command.test.ts \
  extensions/task-ui/__tests__/panel.test.ts \
  extensions/task-ui/__tests__/lifecycle.test.ts
pnpm typecheck
pnpm check
```

运行时按测试规范使用临时 `PI_CODING_AGENT_DIR` 与已安装 SDK 隔离。不通过安装依赖绕过环境问题。

## 风险

- `ctx.ui.custom()` 在 `onHandle` 前完成的宿主语义是关键兼容约束，抽象不能丢失这项保护。
- 两个使用方的所有权语义不同，共享运行器必须接收使用方的 `isCurrent()`，不能猜测会话和生命周期状态。
- 吸收面板或领域状态会扩大范围，并与 scroll-panel、Widget Display 职责重叠。

## 当前授权状态

用户已批准按上述范围开始实现。主会话直接实施，每阶段独立审查后提交；未使用的 `implement.jsonl` 保持为空，启动使用 `--allow-empty-context`，不将其描述为全部上下文验证通过。

## 实施与验证记录

### 阶段一

- 提交：`dcdd529`，新增共享浮层运行时及测试。
- 主会话运行共享测试、`pnpm typecheck`：均退出码 0。
- 独立审查发现安装后宿主失败未关闭浮层，以及 `done()` 抛异常导致等待不结束；增加回归并修复。修复前安装失败回归退出码 1，修复后共享测试 8/8、类型检查退出码 0。
- 所有权谓词抛异常的独立复现退出码 1；主会话将异常纳入 `error` 结果，随后重跑共享测试与类型检查均退出码 0。

### 阶段二

- 提交：`2f05295`，Memory 使用共享运行器，保留本地命令准入和存储读取策略。
- 独立审查发现用户取消后、命令等待恢复前的排队读取仍可执行。修复前回归退出码 1；修复后同步检查共享交互信号，阻止迟到读取。
- 独立检查共享模块与全部 Memory 测试：80/80，自然退出码 0；类型检查退出码 0；`pnpm check`：1685/1685，退出码 0。

### 阶段三

- 完成 Task UI 迁移，保留本地任务源、布局、状态发布职责。
- 首次共享模块与全部 Task UI 测试：120/121，退出码 1。延迟安装测试上下文缺失 `hasUI`，能力预检拒绝后测试读取未创建面板；已补齐测试上下文。
- 独立审查补充会话变化主动中止旧交互、能力预检提示和异常释放准入保护。首轮独立测试 124/125，退出码 1，另一原生不兼容测试上下文同样缺失 `hasUI`；补齐后 125/125 自然退出码 0。
- 独立 `pnpm check`：1689/1689，退出码 0。

### 最终验证

- 新增安装 SDK 的实际 `showExtensionCustom()` 边界测试，覆盖组件焦点与输入转发、关闭自身浮层句柄、不关闭后来叠加的浮层。
- 所有权谓词异常增加正式回归测试，覆盖创建前与安装过程中的类型化错误。
- `node --test extensions/shared/interaction/__tests__/*.test.ts extensions/memory/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts`：198/198，自然退出码 0。
- `PI_CODING_AGENT_DIR=/tmp/pi-interaction-JFq4FT/agent pnpm check`：类型检查通过，全套 1690/1690，退出码 0。
- `git diff --check`：退出码 0。
- 已审查实际差异；未修改 Widget Display、scroll-panel、manifest 或用户文档。既有开发规范已覆盖本次所有权与公开宿主 API 约束，不为一次实现增加重复规范。

### 验证环境与限制

- 使用已安装 SDK；测试配置目录为本次创建的仓库外临时目录 `/tmp/pi-interaction-JFq4FT/agent`，原始日志与审查输出位于同一运行目录。
- 没有安装依赖、推送或执行个人配置同步。
- 尚未验证真实终端外观、IME、任意第三方浮层组合。模拟宿主与安装 SDK 测试不等于这些路径已通过。
