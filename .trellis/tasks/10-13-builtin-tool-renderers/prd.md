# 内置四类工具美化并移除 pi-pretty

## 目标与价值

自行维护 Read、Bash、Find、Grep 的工具展示与输入框外观，统一模块名为 beautify，不再依赖 pi-pretty；保留当前工具执行、输入历史和共享任务 UI，修复长路径摘要不合理折行。不是重写工具系统。

## 背景与确认状态

当前 preset 依赖 pi-pretty 0.7.0，通过 bash-unified/pretty-compat 组合后台 Bash 和 input-history。README 旧截图不能代表当前渲染效果。

用户已批准建任务、阅读并认可四类工具 PRD，后续要求输入框美化也由 preset 自行提供。鼠标片段原文复制经独立研究后，用户明确决定本次不做。用户随后明确批准按顺序实施 beautify 与入口重命名两个任务，无需逐项审批；当前任务已进入 in_progress。

用户已确认输入框采用上下横线、无左右竖边框、首行 ❯、续行不重复提示符。该外观不承诺改善原生终端复制。

## 需求

### R1 四类工具展示

- Read：文件路径摘要、实际返回文件行数、展开提示；展开后行号、竖线分隔、Shiki 语法高亮；长代码行以 `›` 截断。
- Bash：`$ 命令` 标题、输出行数、执行耗时、timeout、错误颜色、展开正文；后台返回 ID/log 文案仍完整可见，不误标为进程完成。
- Find：按目录分组，目录名着色加粗、文件名缩进、数量摘要。
- Grep：按文件分组，文件名着色加粗、行号、竖线、匹配高亮、数量摘要；区分 match 与 context、保留限制说明，尊重 literal/ignoreCase。
- 遵循 Pi 工具展开状态，不全局强制折叠。用户改键位后提示与实际展开键一致。

### R2 布局与正确性

- 折叠摘要保护文件名、offset、关键统计；长路径中间缩略，窄屏合理分行，避免 `:65` 被拆成路径尾冒号与独立数字。
- 展开提供完整路径。使用终端可见列宽，支持中文、ANSI、窗口宽度变化；不能依赖字符长度或 stdout 全局宽度造成超宽。
- Read offset 按输入 1-based 语义展示；续读/截断说明不冒充文件代码行，仍可读。
- 空输出、图片 note、无结果、失败、截断与未知 details 保守可读，不伪造状态、统计或删除不确定的原文。
- 高亮成功、未知语言、超限和失败降级有明确行为；异常不静默吞掉且诊断不泄露源文本。

### R3 执行与兼容

- 展示与执行分离，保留内置 Read/Find/Grep 和 process-tasks Bash 参数、执行、提示、结果及 structuredContent。
- 不额外读取文件/完整 job 日志，不修改模型可见结果，不新增 FFF 搜索执行。
- Read 图片交给 Pi 宿主，不重复绘制、破坏附件或因文本美化隐藏图片。
- 保留 input-history 搜索、回填、历史草稿、undo/paste、自动补全、IME；保留 task-ui Down 与显式面板入口、agent/process 生命周期。

### R4 自有输入框外观

- 输入框外观由 preset 维护，不依赖 Pretty，不机械移植 Pretty 的所有装饰。
- 采用上下横线、无左右竖边框、首行 ❯、续行不重复提示符；不替换或复制已有编辑器私有状态以实现装饰。
- 安装失败、未知编辑器或不支持安全装饰时保留原可用 UI，并可诊断降级。
- 不接管鼠标/选区/剪贴板，不承诺原生终端复制能消除边框或自动折行。

### R5 移除与维护

- 移除 pi-pretty runtime 依赖及仅服务 Pretty 的兼容接线；相关安全回归迁移后才能删除旧测试。
- 不再发放或读取 pi-pretty.json；不删除、清理或覆盖个人旧配置文件。
- 语法高亮显式声明所需直接 runtime 依赖；SDK 保持宿主 peer。
- 复用上游 MIT 片段时保留版权和来源记录。README、规范与 manifest/sync 边界同步更新。
- 不修改其他任务/无关 hunks；个人安装、同步、重载、提交、推送和归档须后续授权。

## 排除范围

- Pretty 的 LS、FFF、文件补全、用户消息前缀、Working/Thinking 动画、Claude 工具分组。
- Edit/Write diff 美化、恢复旧图的 Bash exit 摘要/Find 图标树。
- 鼠标任意片段语义复制、完整输入复制替代功能、宿主选区改造、终端鼠标协议接管。
- 其他 task-panel 重设计或后端执行系统重写。

## 验收标准

- [x] AC1（R1）：四类工具折叠/展开、颜色、统计、内容均由定向测试与实际宿主渲染 seam 验证。
- [x] AC2（R2）：offset、notice、match/context 统计正确；长路径、中文、ANSI、窄屏和窗口变化不超宽、不拆散 offset。
- [x] AC3（R2）：Read 高亮成功/未知/超限/失败降级覆盖；异步迟到结果不能覆盖新文本、折叠或关闭后的状态。
- [x] AC4（R3）：实际工具参数/execute/guidelines/原始结果/structuredContent 不被展示层改写；后台 Bash、错误与图片保持。
- [x] AC5（R3,R4）：输入历史、搜索/回填、草稿/undo/paste/补全、Task UI 快捷键及生命周期无回归；同实例装饰与安装清理失败安全。
- [x] AC6（R4）：确认后的输入框外观在有/无 input-history 和 Down opener 条件下工作，unsupported editor 原样可用；没有新增复制/鼠标接管。
- [x] AC7（R5）：Pretty dependency、专属配置发放和兼容代码移除，旧文件不触碰，无排除能力重新引入。
- [x] AC8（R5）：来源/README/spec/manifest 与行为一致，严格类型/定向自然退出/完整 check 通过或明确记录阻塞，真实 TUI 限度单独报告。

## 规划审阅门

已知技术合同与风险见 [design.md](design.md)、[implement.md](implement.md)、[迁移研究](research/runtime-migration.md)。[复制研究](research/editor-semantic-selection.md) 留档，不作为本次实施上下文主线。

无阻塞 UX 问题；规划材料已备齐，用户已明确批准实施，task.py start 已执行。后续按实施计划完成独立审查和验证，再进入入口重命名任务。

## 实施与验收证据

已完成实施与独立检查，检查修复 notice/尾空行、多行摘要、padding 所有权及旧安全回归遗漏。最终 strict + 583/583 完整测试，583/583 全量自然退出，64/64 定向通过。详见 [implementation-results.md](research/implementation-results.md) 与 [check-results.md](research/check-results.md)。

AC 以自动测试和实际宿主 seam 验收；没有真实 CLI/PTY、实际 input-history 包或 fullscreen 端到端验证，SDK 极窄问题与原生复制限制仍明确保留。不称已安装生效；未提交/同步/重载/归档。前置交付满足后续入口重命名开始条件。
