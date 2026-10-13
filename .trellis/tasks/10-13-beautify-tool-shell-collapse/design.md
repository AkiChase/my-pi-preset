# 六工具单行展示设计

## 范围与结构

原四类 renderer 修复与新增两类适配共享一个外壳/单行组合机制，作为一个任务验收。新文件建议 tools/get-subagent-result.ts、tools/jobs.ts、tools/retrieval-contracts.ts；公共机制仍在 shared/layout，入口仅新增两个可选 resolver 分支。不 import agent-tasks/process-tasks 私有模块；不修改后端 metadata。

## 默认外壳

适配时默认 renderShell=default，宿主 Box 提供状态背景、整行填充、留白、outputPad 和 MouseRegion。render(width) 使用宿主传入内宽，不再减 outputPad 或补空格。未知格式委托时保 next 的 renderShell，不能用 default 再嵌套原 self 外壳造成双框。实施核验 Pi 1.2 在 renderer 前选 shell 且 renderShell 无 context，因此仅 next 明确 self 的可选 adapter 保静态 self、已知格式用公开 Box，未知格式用 Container；其余全用 default host Box。该局部机制不改产品范围、SDK 或工具结果。

## 每调用组合状态

context.state 使用 beautify 命名空间；call/result slot 分别缓存组件与原renderer lastComponent，避免把自有组件交给委托 renderer。call 在收缩态是唯一可见行；result 收缩态返回空组件，并同步更新同一个 call component 的摘要。actual-host 同轮 call→result→render 必须测试，结果到达不依赖下一次 invalidate。

展开时 call 完整标题，result 已返回正文。Read 不再隐藏 call 后在 result 重复路径。高亮保留 revision/WeakRef/LRU/关闭机制，按新的内宽计算。

## 可选 resolver 与委托

registerToolRenderer 只匹配固定六个名字，其余直接 next；不存在工具时没有调用、没有注册或激活副作用。新增两工具捕获 next 原renderer，通过完整参数/返回信封 guard 决定 adapter 或 delegate。不要启动时快照工具清单，需支持动态注册/恢复历史。

结果未到达若参数形状符合，先单行调用态；结果未知时转回原 call/result 组合。call component 与 result slot 必须同一轮切换，避免既有单行标题和原正文重叠。若 next 为 undefined，委托组件采用宿主等价通用标题和10行预览/hint，expanded全文；该未知格式例外不承诺单行。只使用公开API，不调用host私有createResultFallback。若委托renderer有生命周期缓存，独立保留原state/lastComponent并正确invalidate，不触碰其私有字段。

同名同形工具无法严格辨别来源；解析只用于可读摘要，状态为返回快照，不用于控制/消费动作。外部renderer可能自行限制展开长度，未知格式委托不承诺全文。已知两种结果直接绘制已返回全文。

## 契约解析

### get_subagent_result

实际 source extensions/agent-tasks/src/index.ts:2842 起：textResult，无专用renderer。formatRetrievedAgent固定 Agent/Type+Status+stats/Description 前缀，正文可含任意文本。只解析头部，不扫描正文关键词；可选tokens/cost/context等字段严格识别，未知字段保守省略。not found与wait released/cancelled仅识别完整固定信封。参数agent_id/wait/verbose校验；waiting取调用未结束事实，不猜agent状态。当前返回snapshot无runId，不对后续resume做推断。

### jobs

extensions/process-tasks/tools/jobs.ts各action details=undefined；attach streamLog可能只有原始partial日志。参数action/jobId/pattern校验；通过action限定的返回头部解析：list格式/empty（名称／命令有歧义只报告可靠记录数，不猜状态计数）、output byte range/no output、search总hits/groups、stats固定标签、attach final stopped-following/finished/current-status、kill固定返回。名称/命令可含括号等，避免宽泛regex误取字段，无法可靠解析即delegate或省略。

attach partial直接标following/waiting，不根据日志内容猜job状态；expanded呈现当前partial，不累积自造日志历史。final返回覆盖partial，与后端实际返回一致。kill仅报告工具返回，不把同步逻辑stopped冒充OS真实退出。

### Bash

process-tasks/tools/bash.ts的background details也为空；只有完整固定后台信封可识别，正文关键词不改变显示分支。无需为显示增加后端字段。未知正文仍用通用output行数+全文，不冒称后台。

## 单行布局

label/关键状态/可靠计数/次要元数据/hint分别预算；关键字段优先，标题保有意义头尾，提示来自keyHint。只有一行；极窄屏逐级省略，不拆offset、不超宽、不强保所有信息。清理外部ANSI/OSC/C0后加SDK样式。output range是实际bytes，不把字符数当日志byte数；get_result文本行数不能冒充tool uses或tokens。

## 验证与风险

新增actual-host背景、行数、call→result同步、mouse、keybinding、partial/final、delegate切换和原renderer槽隔离测试。参数及header fixtures从实际工具输出生成或对照，不只复制regex常量。运行actual registered get_result/jobs路径时通过既有离线harness，不启动模型/网络，不额外消费结果。未知格式保留多行原展示是兼容策略，不作为单行缺陷。

主要风险是非结构化文本合同漂移与委托state生命周期；因此保守降级、无私有依赖并记录版本证据。default Box有上下留白，不将空白行算正文。真实PTY当前未授权，不将自动组件快照称真实终端验收。回退只动任务owning显示文件，后端和其他工作不回退。
