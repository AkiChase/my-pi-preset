# 内部交互运行时

## 目标

在 `extensions/shared/interaction/` 建立内部共享的交互生命周期模块，让 Pi 扩展安全地管理自定义浮层，减少取消、所有权失效、安装时序与资源释放逻辑的重复实现。

## 背景

- `extensions/shared/widget-display/` 已负责多个扩展的 widget/footer 发布、会话所有权、宿主设置方法重入、内容组合及 TUI/RPC 行为，本任务不重复或替换这些能力。
- `extensions/shared/scroll-panel/` 已负责原生有界 `ScrollView` 布局发现与兼容性检查，继续作为面板的布局与滚动依赖。
- `extensions/memory/command.ts` 与 `extensions/task-ui/owner.ts` 分别实现了 `ctx.ui.custom()` 浮层的安装确认、延迟关闭、释放及所有权检查。
- `extensions/session-assist/recap/index.ts` 已实现带取消信号的选择与输入流程，并在异步等待后重新检查会话和版本；该流程不在本期迁移范围内。

## 需求

1. 新模块位于 `extensions/shared/interaction/`，由使用方显式调用，不作为 Pi 独立加载入口。仅依赖 Pi 公开 API 和通用 TypeScript 工具，不依赖具体扩展的领域状态。
2. 使用可辨识的结果类型，区分正常完成、用户取消、所有权失效、能力或模式不支持，以及真实故障。
3. 安全管理 `ctx.ui.custom()` 生命周期：必须等待 `onHandle` 确认本浮层已安装，才允许执行 `done()`，防止提前关闭其他浮层。
4. 接收使用方提供的所有权检查与取消信号，防止所有者或会话变化后，过期异步回调继续更新界面或执行副作用。
5. 领域状态、持久化、确认策略、面板渲染和错误文案仍由使用方负责。
6. 不改变或吸收现有 Widget Display 与 scroll-panel 的职责。
7. 增加针对安装时序、取消与失效分类、资源清理的测试。
8. 将 Memory 和 Task UI 的全屏浮层生命周期接入共享模块，不改变现有可见界面与领域行为。

## 不在范围内

- 独立发布 npm/Pi 包，或建立 workspace 包。
- 对话流程辅助模块与 Recap 配置迁移；留待后续任务。
- 替换 `extensions/shared/widget-display/` 或 `extensions/shared/scroll-panel/`。
- 通用声明式菜单或页面 DSL。
- 编辑器接管抽象。
- 重新设计面板外观、滚动行为或业务流程。
- 新增 `extensions/platform/`、迁移已有共享目录或添加 `extensions/interaction.ts`。

## 验收标准

- [x] 交互代码位于 `extensions/shared/interaction/`，不配置或发布为独立依赖。
- [x] 使用方可以运行 TUI 浮层，并取得 `completed`、`cancelled`、`stale`、`unsupported` 或 `error` 类型结果。
- [x] `onHandle` 前的关闭请求不会提前调用 `done()`。
- [x] 所有权或会话失效时，中止受控工作，阻止过期界面更新与副作用。
- [x] Memory 和 Task UI 保持现有全屏浮层行为，包括安装前关闭与同步重入安全性。
- [x] Widget Display 和 scroll-panel 的既有契约保持不变。
- [x] 迁移行为有对应回归测试，相关既有检查通过。

用户已确认本期工作无问题并授权收尾。验收依据为实施记录中的自动化与安装 SDK 边界测试；未声称已完成额外真实终端、IME 或第三方组合验证。

## 已确定的设计决策

- 首期仅做浮层运行时，迁移 Memory 和 Task UI；对话流程与 Recap 延后。
- 模块始终作为内部模块使用，不提取为独立发布包。
- 根入口继续承担 Pi 资源发现边界，`extensions/widget-display.ts` 保留为 Widget Display 服务的薄入口。
- 统一职责与加载规则，而不是强求不同生命周期模型拥有相同的目录和入口形式。
