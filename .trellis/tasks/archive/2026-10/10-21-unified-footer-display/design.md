# 统一展示层设计

## 1. 边界

本任务扩展现有 shared/widget-display，而非新建一套平行的 Footer 排序系统。保留目录和入口，避免资源重命名影响现有消费者。用户文档可说明该层现在管理编辑器两侧 widget 和底部 Footer。

最小行为缺口：当前 Agent 概览只能通过 belowEditor 发布，Status Bar 自己独占 Footer；两者无法在同一注册表中排序。改动实际位于共享层的区域路由和 Footer 发布边界，不在 Task UI 内通过坐标、私有容器或复制指标逻辑绕过。

## 2. 所有权

| 模块 | 职责 |
| --- | --- |
| contracts.ts | 中心 region／group／item、两层 order、block／inline 与 overflow／separator、有限发布及 Footer 宿主能力类型 |
| client.ts | 消费者 activation／session handle；发布与撤销自身 slot |
| owner.ts 与必要的同目录 helper | 单一组合与宿主发布；widget 两区域及 Footer 路由；组件和订阅清理 |
| status-bar.ts | location／context／usage 内容及共享指标快照，不再调用 setFooter 或注册开关 |
| task-ui/owner.ts | 原 Agent 概览内容发布，继续走已有 agent_overview client |

Footer 是 preset 内部区域，不将字符串 `footer` 传给 SDK 的 setWidget options。宿主适配只使用公开 setFooter；aboveEditor／belowEditor 继续使用 setWidget。

## 3. 数据流

```text
Recap / Trellis ───────┐
Status Bar 三个 slot ─┼─ createWidgetClient → 同步 bus admission → session-bound lease
Task UI 概览 ─────────┘                                      │
                                                    中心 registry 区域路由
                                                          │
                             aboveEditor / belowEditor → setWidget
                             footer → 有序组合 component → setFooter
```

注册和 bus listener 属于 extension activation；宿主发布、组件构建和请求渲染属于真实 session。使用 manager 对象 + session id + activation 身份，不用 cwd、字符串 id 或 pi.events facade 作为唯一键。不新增 import-time 共享可变单例。

## 4. Footer 宿主适配

共享 owner 在 TUI 持有一个 Footer composite，slot 变化请求重绘或更新自身组件，不为每次 token／Agent 刷新反复替换整个 Footer。宿主 factory 提供 TUI、theme 与 ReadonlyFooterDataProvider；Status Bar 需要最后一个参数，因此为 Footer slot 提供明确、类型化的 factory 数据，不通过模块 singleton 或私有 SDK 访问获得。

优先保留现有 WidgetContent 接口对既有 widget 消费者的兼容，新增仅 Footer 所需的类型化内容形式／factory 上下文。最终接口在 S1 验证真实 SDK setter／loader 行为后确定，并在同一阶段耦合迁移全部消费者，不留下任意数字优先级或双重宿主发布路径。

Footer provider 的可用性与组件挂载分开处理：指标 slot 可能在 factory 运行前发布，必须在宿主数据具备后构建。consumer-before-owner 和 owner-before-consumer 的 lifecycle 顺序都须可用；沿用现有 SESSION_START handshake，不让任意 captured ctx 激活旧会话。

## 5. 状态栏拆分

按当前 render 的三行边界拆为 location／context block groups 和 usage inline group，而不是把每个字段拆为独立扩展。usage 明确发布 tokens／cache_metrics／task_summary 三个 items；外部 setStatus 的未识别数据由兼容尾部项保留，不另注册执行插件。

- Git poll／cache、usage snapshot、request hit rate、cache metrics 继续共享一份业务状态，避免每个 slot 重复扫描或启动轮询。
- FooterDataProvider 的 branch subscription 有唯一清理 owner。
- 指标和样式辅助函数尽量保持不变；变化主要是输出从三行 component 变为三个有序内容槽。
- 发布内容不是已经缓存的主题字符串；主题 invalidate 后按新 theme 绘制。
- 删除 installed／enabled 等只服务原开关的状态时，仍保留正确的 activation／session 初始化语义。

## 6. 布局与跨插件组合

采用 `region → group → item`，相同 region 只表示相同宿主区域，不自动混排。插件通过独立 item 加入相同 group；共享 group 不共享发布 handle。一个 item 只能有一个有效 lease；未知目标和重复占用拒绝，不根据加载顺序自动创建 group。

中心 group 声明 region、区域内 order、layout（block／inline），inline 另声明 overflow（wrap／truncate）和 separator。item 声明 group 和组内 order。消费者不覆盖 group 的布局／溢出／分隔策略；两个 order 只在自身层内比较，不兼任窄屏保留优先级。

Footer group 顺序 location 10 → context 20 → usage 30 → agent_overview 40。location／context／agent_overview 是 block，各自目前一个 item；usage 是 inline，items 固定 tokens 10 → cache_metrics 20 → task_summary 30。token／费用一起由 tokens item 输出；optimizer aggregate 和 latest-request rate 属于 cache_metrics。未知第三方 setStatus 继续走兼容尾部项，保留清理、可见性及稳定 key 顺序，不要求第三方修改其发布方式，也不把任意外部 key 自动注册成中心 item。

block 将组内 item 的组件行纵向组合，保留每个 item 多行输出。inline 按 item order 合并文本片段，由组 owner 处理 separator 和 overflow：truncate 保持单物理行；wrap 使用 SDK wrapTextWithAnsi 等 helper 返回多行，保留 ANSI／Unicode 列宽。inline item 内容应是有限文本片段，不能发送任意交互／多行组件并让组合层猜如何横向合并；外部控制字符与换行按明确文本边界清理，软换行只由组布局产生。

空 item 不留 separator，空 group 不占位；组间无新增空行。usage 默认 truncate，保留原有状态栏窄屏行为。wrap 作为明确可用能力在真实组合回归中验证，不声称 Pi 原生 setStatus 自动换行。

aboveEditor 保持 Recap 10 → Trellis 20，二者是 block group，各自一个独立 item。belowEditor 保留区域能力，暂无内置内容；测试使用受控注册 seam 验证，不添加虚构产品 item。

保留现有文字列宽 helper、组件自身换行和概览最多五行策略；不强制截断 block，不改宿主 dock 高度，不获取私有 allocated-height，不承诺任意插件组合下都不裁剪。

## 7. 生命周期与失败

- 清理先关闭 admission／mount 有效性，再释放所有 owned entry；dispose 重入不能删除较新内容。
- 一个 slot 的 factory／render／invalidate／dispose 异常不得破坏其他 slot 或非展示执行。
- 缺失共享 owner：client 安全失败，不恢复直接 setWidget／setFooter。
- 缺失 Status Bar：Agent 可作为 Footer slot 自身显示；缺失 Task UI：仅显示三行指标。完整 preset 正常场景必须四组顺序一致。
- RPC 不接受新增 Footer component 能力；保留已有 widget 文本路线。Task UI 原来已限定 TUI，不回退 Agent 区域。
- shutdown／reload 必须遵循 SDK 的 runtime UI 清理与 setter 行为，避免旧 activation 清除后安装的第三方 footer。公开 API 若不能证明仍拥有宿主组件，不以盲目 setFooter(undefined) 清除未知内容；由真实 SDK 生命周期回归验证清理路径。
- 所有 setFooter 生产调用只允许共享显示 owner／明确的同目录宿主适配 helper；边界测试以唯一拥有者集合而非所有 shared 文件豁免来表达。

## 8. 文档与范围

更新 `.trellis/spec/development/widget-display.md`、相关 index、测试指南及 docs/extensions/widget-display.md、状态栏页面、task-composition.md；查找所有当前 `/statusbar` 引用后定点移除。原始归档材料不重写。

预期产品改动为 shared/widget-display 的 contracts／client／owner（必要 helper）、status-bar.ts 及其 tests；Task UI 内容业务无需更改，必要时只做类型接入和相关 fixture 调整。不改 backend、任务面板、工具 rendering 或其他会话任务。

## 9. 验证与回滚

S1 耦合变更包含共享协议、宿主适配、状态栏拆分、Agent 迁移、文档规范、测试，不能单独提交一套无法工作的契约。先 focused 自然退出／typecheck，再独立审查和完整验证。

S2 使用真实安装 CLI 的隔离 tmux 加载本地入口与最小 offline fixture，验证有／无 Agent、宽／窄宽度和 resize。截图产物为本次拥有的外部临时路径；必要时将真实 ANSI capture 渲染为 PNG，并明确标注类型，不能称 capture-pane 文本为截图。

回滚采用本任务 scoped commit 的普通 revert／修复提交；不重写历史，不重置其他未提交内容，不修改个人安装。若核心 SDK 能力或所有权清理无法通过公开接口证明，记录阻塞并停止，不转用私有布局。
