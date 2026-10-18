# 技术设计

## 权威需求与授权
以 `prd.md` R1–R6/AC1–AC8 为准。用户已明确批准按三个阶段实施及逐阶段检查、本地提交；未批准真实终端/provider 验证、安装、同步、reload、push 或归档。父任务为唯一执行目标，原 Panel 子任务保留追溯。

## 1. 数据和执行所有权
保持 `extensions/task-composition.ts` 创建一个 TaskCoordinator、TaskLifecycle 和 Task UI owner。TaskSource 只提供 immutable TaskView、有界 detail 和精确 identity stop；UI 不获取 manager/session，不消费结果。

内部 TaskIdentity/key 保持原合同，公开 Agent execution_id 与 Process task_id 不混用。只改变展示投影：Agent 优先 description，workflow 补 meta.description，Process 优先非空 name/title 并安全回退。前台 description→Job.name 已存在，不重复接线；外部控制序列清理只作用于显示副本。

## 2. 模型与展示
在 task-ui 内新增或提炼共享 presentation helpers，供 Panel/overview 使用，不将 Beautify 工具块强制改为相同布局。包含 kind-aware 标题、状态/圆点、duration/token 格式、单行安全文本和保护 suffix 的终端宽度预算。

TaskPanelModel 继续管理 interaction-only metadata、真实 parentKey、折叠和 selected final pin；扩展树线 continuation/last-sibling、后代数量及折叠选择 reconciliation。稳定 key 作为身份，不以下标跨刷新保持选择。root/child 统计不求和。

概览只复用纯展示和非选中根组保留规则，不复用带 selected pin 的 Panel model。最多五个根项，小终端按总高度保守缩减并预留 hidden count；空态隐藏。Widget Component 仅有 render(width)，无法获知 dock 实际分配高度；用户已接受极端拥挤时宿主进一步裁剪及 hidden count/footer 可见性限制。不增加内部高度兼容入口、不改中心 owner/SDK/主布局，不引入新配置。

## 3. 全屏交互与原生滚动
owner 在打开前调用共享 loadNativeLayout，并在 await 后检查 activation/interaction。overlay 使用 100% width/maxHeight、top-left、margin 0，保留原 live editor 和宿主模式。

按 Memory 已有 onHandle 保护模式处理 setup/shutdown 重入：overlay 实际安装前不调用可能关闭其他 topmost overlay 的 done；完成一次性、dispose 幂等，关闭路径使用自己的 ownership token。

Panel list/detail 为同一 interaction 的两个状态，各持有独立 ScrollView，参数 follow:none、overscroll:contain、scrollbar:always，轨道 dim、滑块 accent。固定 header/footer+grow 正文使用 VStack，共享 adapter 求值实际宽高 frame。内部入口只在 native-layout.ts，业务组件不直接 import SDK layout.js；Symbol.for 行为校验按现有模块保留，不添加错误的 class identity 门禁。

render 只求布局/读取缓存，不调用 TaskSource.detail 或读文件。源变更/计时事件在渲染外刷新 immutable metadata 与唯一 selected bounded preview，必要时合并更新；保留最终缓存，不因源 sweep 丢失。完整 metadata 与阶段使用正文换行，不把长标题截断后当完整详情。

Fullscreen handleMouse 使用共享 consumeWheel：正文 clip 内转交标准化 delta，其余 wheel 也消费；Regular 不开启鼠标捕获。滚轮不改选择，键盘选择变更才 ensure-visible；刷新、折叠、返回、内容变化和 resize 根据稳定 identity/原生 scroll 状态收敛，不能每次渲染拉回。

Enter list→detail，Esc detail→list/list→close；方向键/jk、Home/End、左右树操作和 x/c/全局 detach 保留。移除 Tab 焦点与 PageUp/PageDown。Task viewer 的 Ctrl+C、document sections 不复制。行点击/拖动不实现。

## 4. Widget Display 与等待说明
在 shared/widget-display/contracts.ts 声明 Agent overview belowEditor 槽位，由 createWidgetClient 发布。Task UI owner 持有 client、订阅、clock/expiry；publish 前设置所有权，外部 setter 后复核 lifecycle。中心 owner 不可用时不直接 setWidget，不新建第二显示 owner。

删除 Process foreground_hint 槽位消费者、hint.ts 专有渲染/状态、show/clear/reset 接线；中心槽位、测试和用户文档同步清理。保留 registry source ticker/terminal sweep，不能因删除 hint 而停止耗时刷新。工具 quick-completion/partial 流转若共用 hinted 状态，应先分离执行语义再删展示字段。

共享底栏用 coordinator 实际等待信息及配置 shortcutBackground，未绑定回退 /task-detach；Panel 分离全局解除全部等待与 selected stop/path-copy。保持原 footer 活跃/排队计数，不以概览替换 Process 可见状态。

## 5. 生命周期与风险
保持 freeze→UI close→cancel waits→backend drain。所有 timer/subscription/widget/overlay 有 activation owner；空态停止无用 clock，shutdown/reset/迟到事件不复活，sink 失败不破坏执行。

高风险包括 TaskView 投影、selected retention、overlay setup 重入和 Widget Display 跨模块合同，实施阶段安排独立审查。共享 adapter 已有消费者不代表本 Panel 动态任务/树/真实鼠标通过。

内部 API 风险已获接受；宿主能力缺失明确拒绝打开，无 SDK 修改或手工 fallback。真实安装的 bundled CLI 与源码 loader 不同，实际验证必须区分，任何未运行项报告 NOT_RUN。

## 6. 回滚与排除
只回滚本任务 scoped 文件/hunks，保留已完成工具展示、handling clock、/task-detach、个人配置和其他任务。共享基础模块若需修复，先检查所有消费者并同步回归；不复制第二 adapter。

不改 /agents 高级管理/独立 viewer，不实施模型运行摘要/双向消息，不修改 token accounting、调度、通知、取消或公开工具 schema。
