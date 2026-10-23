# 设计：内部浮层交互运行时

## 模块分类与加载边界

统一职责与加载规则，不要求所有模块具有相同的目录或入口形式。

| 类型 | 代码位置与加载方式 | 示例 |
| --- | --- | --- |
| 需要 Pi 自动加载并注册生命周期的服务 | `extensions/*.ts` 薄入口与内部实现目录 | `extensions/widget-display.ts` → `extensions/shared/widget-display/owner.ts` |
| 用户功能扩展 | `extensions/*.ts` 入口与功能实现目录 | Memory、Trellis |
| 由使用方显式调用的共享库 | 仅位于 `extensions/shared/`，不独立注册或加载 | scroll-panel、tool-arguments、本任务的 interaction |

根 `package.json` 通过 `extensions/*.ts` 发现入口。`extensions/widget-display.ts` 保持不变，让 Pi 加载 Widget Display 的唯一发布所有者；实现仍位于 `extensions/shared/widget-display/`。

交互运行时不独立注册会话生命周期，不持有全局会话所有者，不需要根入口。使用方在既有生命周期内提供 `isCurrent()`、取消信号与关闭请求，共享运行器只管理本次交互的资源。

本任务不新增 `extensions/platform/`，不迁移已有共享目录，不添加 `extensions/interaction.ts`，不创建 npm/workspace 包。后续对话流程能力仍可使用这一内部模块边界，但不属于本期交付。

## 目标与边界

抽取一次 TUI 自定义浮层的生命周期控制，不抽取面板领域逻辑或通用菜单系统。共享层负责安全安装、关闭请求延迟、所有权失效、取消信号与释放；Memory 和 Task UI 继续负责状态、面板、原生布局、异步读取、通知文案与业务副作用。

## 责任划分

| 模块 | 责任 |
| --- | --- |
| `shared/interaction` | `ctx.ui.custom()` 安装与关闭时序、交互级 `AbortSignal`、类型化结果、幂等清理、所有权失效 |
| `shared/scroll-panel` | 原生布局加载、兼容性验证、滚轮路由 |
| `shared/widget-display` | widget/footer 发布、租约、组合、TUI/RPC 边界 |
| Memory | 操作标识、cwd/origin 检查、存储读取、MemoryPanel、通知与命令准入 |
| Task UI | 生命周期、版本与交互标识检查、布局读取、TaskPanel、任务源与状态发布 |

## 内部接口契约

共享层导出小型浮层运行器，接收：

- 使用方提供的 `isCurrent()`，表达扩展激活、会话与操作所有权；
- 可选外部 `AbortSignal`；
- TUI 能力要求与浮层选项；
- 使用宿主提供的 TUI、主题、键位管理器创建组件的工厂；
- 显式完成或关闭请求，以及可选完成值。

结果使用可辨识联合类型：

- `completed`：所有权有效，交互正常完成；
- `cancelled`：所有权有效，用户正常关闭；
- `stale`：所有者被替换、外部信号中止、宿主释放或会话失效；
- `unsupported`：缺少所需 TUI 或自定义浮层能力；
- `error`：所有权有效时发生的非取消错误。

共享运行时不代替使用方的业务状态机。使用方仍需在业务异步等待之后，以及写入或通知之前，重新检查自身领域状态和所有权。

## 安装与关闭状态机

```text
已创建 → 安装中 → 已安装 → 关闭中 → 已结束
            │        │
            └─记录关闭请求─┘
```

- 安装期间调用 `requestClose()` 只记录请求，不调用宿主 `done()`。
- 只有 `onHandle` 确认本浮层已安装，才允许执行该浮层的 `done()`。
- 所有权失效、外部信号中止、组件释放和正常完成经过同一幂等收尾路径。
- 收尾先中止交互信号，再安全释放组件，最后在已安装条件下调用 `done()`；各步骤只执行一次。
- 组件工厂、宿主调用、释放和完成过程中的失败按 `error` 或 `stale` 分类，不向新会话投递旧交互行为。

该时序保留 Memory 和 Task UI 现有测试保护的宿主行为：安装前调用完成方法可能关闭其他顶层浮层。

## 使用方迁移

### Memory

`registerMemoryCommand()` 继续持有 `operation` 标识、cwd、origin 和 `closePanel` 准入控制。共享运行器接管 installed/closeRequested/ended/finish 等生命周期细节；详情与刷新仍保留序号检查及 `check()`，防止迟到结果覆盖新状态。

### Task UI

`createTaskUIOwner().openPanel()` 继续在共享运行器外调用 `loadNativeLayout()`，保留 `interaction` 标识、`lifecycle` 和 `epoch` 检查。布局加载成功后，使用运行器管理浮层安装和释放。TaskPanel 的 `done` 回调接入关闭请求，不改变面板输入或显示逻辑。

## 兼容性与回滚

- 只使用 Pi 公开界面与扩展契约，不引入运行时依赖。
- 不改变 `package.json` 的包与资源声明。
- 能力不可用时返回 `unsupported`，由使用方决定现有提示或降级策略。
- 回滚时恢复两个使用方的本地生命周期逻辑，删除没有使用方的共享模块；不涉及数据迁移或持久化格式变化。

## 验证策略

新增共享运行时单元测试，并保留或扩展使用方测试：

- Memory 命令测试已覆盖 `done before install`、同步重入关闭、迟到读取与并发准入。
- Task UI 面板测试已覆盖 `onHandle` 前生命周期关闭不得调用 `done()`，以及同步关闭重入。
- 新测试覆盖结果分类、重复关闭和释放、外部所有权失效、不支持的模式。

模拟界面测试不证明真实终端外观、IME 或任意第三方浮层组合。本阶段验证安装 SDK 的对应边界行为，并如实记录未验证路径。
