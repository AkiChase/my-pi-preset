# 技术设计

## 前置基线
前置已核实完成并接受归档至archive/2026-10/10-14-builtin-recap，产品b48e37b；最终报告明确限定验收范围。当前material增加了namespace原始身份和标签清理，抽取保留这些最终细节。先抽取，后改变命名。不得修改前置任务状态或混入它的并行代码。

## 共享材料所有权
将recap/material.ts的稳定算法及对应测试归属提取到shared/material.ts（最终文件命名实施时核实）。Recap传自己的maxContextChars；命名传固定32000。参数/结果仍表达材料text、identity、empty、chars，不包含插件状态。共享实现保留完整相关内容的身份计算，而非仅对截断后文本计算，避免被预算隐藏的变化逃过失效检查。三个命名场景使用同一构造器。命名prompt独立，请求可使用generateText已有textMaterial seam，不影响Recap请求或主对话。

## 两阶段自动调度
使用版本化session级额度状态，区分等待首次、等待第二阈值、结束。只记录累计有效输入数、最后计数的用户消息ID、机会阶段和首次输入锚点（不保存增长的ID列表）；不以标题是否为空或owned判断是否已消费。输入阈值为首条之后N条，延迟settled可跨阈值，但同一边界不并发两个自动请求，不补发历史机会。请求开始前保存机会消耗，失败/取消不回滚。

session级状态取整个session按append顺序最新的有效v2记录，不能只从当前branch恢复。已读现有SDK session-manager公开声明及实现：getEntries()按append顺序返回全session（不含header）的浅副本，不受当前leaf影响；getSessionName()同样取全session最新session_info。使用这些公共接口可保持跨branch额度，材料仍来自buildSessionProjection()当前有效分支。有效输入只按本次input候选归因计数（候选记录交付前分支，历史消息天然排除），最后计数ID作为额外边界。2026-10-15用户决定：不必保守，多一次自动重命名可以接受，旧v1或无法读取的v2状态直接视为新会话、重新获得两次机会；手动标题（Pi `/name`等外部改名或`/session-name`手动生成）与来源不明标题一律不再自动覆盖。

## 手动与并发
manual不消费或重置自动额度，保留waitForIdle及manualPending优先权。直接生成成功仍可取得标题ownership；外部改名撤销ownership。所有请求维持operation epoch/controller与runtime/session/branch/material/title身份验证；共享材料身份替换旧prepareConversation指纹，不能以“提取共享”删掉安全门禁。空上下文不发送；模型缺失及非法输出显示原因，自动机会失败不形成循环。

## 配置与文案
automatic/interval兼容，默认true/8。N仅控制尚未启动的第二机会阈值，不重置首次锚点/额度。保留坏JSON拒绝覆盖和原子保存。菜单说明第二次自动命名等待输入数；失败文案分别说明等待第二机会或自动已结束，手动失败只说明旧标题保留。

## 风险与回滚
跨模块抽取必须证明Recap材料等价；session级状态迁移是主要风险，需要独立审查和实际SDK离线fixture。状态版本化，不靠回滚文件清理会话历史；不改个人会话。技术合同如无法实现已确认session级上限，先报告阻塞，不降级为branch级次数。
