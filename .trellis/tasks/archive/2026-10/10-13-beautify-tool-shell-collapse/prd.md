# Beautify 工具外壳与单行收缩修复扩展

## 目标

恢复原 Read/Bash/Find/Grep 的主题背景和整块单行收缩，并为 get_subagent_result、jobs 增加可选展示适配。收缩态主信息在前、适用元数据在末尾；展开显示已返回正文。不采用多行预览。

## 背景与已确认决策

用户批准建任务，随后明确新增仅 get_subagent_result、jobs，并要求完整规划。write 保留代码预览；ls、bash_bg、monitor、Agent、workflow、web tools 不加入。当前已是会话活动任务，status=planning；本轮“激活进行规划”不是进入实施的授权。

原缺陷：shared.ts:13 的 self 外壳未绘制背景；shared.ts:14-29 分画 call/result 造成两行；shared.ts:35-37 的 fallback 忽略 expanded；bash.ts:6 关键词后台识别过宽。现有测试未检查背景、整块单行、降级行数。

## 需求

### R1 主题背景与宿主交互

六种适配工具使用当前 Pi pending/success/error 主题背景，宿主负责外壳与鼠标展开。不硬编码背景、重复 padding 或改变全局展开设置。上下留白与图片附件不算文字有效行。

### R2 四类原工具单行与展开

Read 以路径/offset 为主信息，尾部返回行数；Bash 以命令为主信息，尾部输出行数/可用耗时/必要后台句柄；Find/Grep 以搜索条件为主信息，尾部可靠结果数量。每块仅一行有效文字，不重复标题。展开保完整标题、已返回正文、Read 行号/Shiki、搜索分组与匹配高亮。限制说明不作为记录计数。

错误、后台、图片说明、未知格式均遵守收缩状态。单行保关键错误/后台ID/受限标记，展开保原文；不能因输出含后台关键词就铺全文。未知数值不伪造。

### R3 get_subagent_result

- 收缩主信息优先使用可识别的 description，无法可靠取得时用请求 agent_id；尾部为可靠识别的状态、用量/耗时及展开提示，宽度不足省略次要信息。
- 等待中的调用显示 waiting；返回运行/排队快照不可标为完成。wait released/cancelled 表示停止等待，不表示 agent 停止；not found 必须可见。
- expanded 显示已返回完整文本，包括 verbose 对话；不再次请求结果、不读取 session、不消费额外结果。
- 当前信息仅在文本，使用经测试的完整返回头部合同保守识别；未知格式保留原展示，不能猜统计。

### R4 jobs

覆盖 list/output/search/stats/attach/kill 六个 action：
- list：主标题 jobs list，尾部可靠任务数/状态计数；未知格式不用文本行数冒充任务数。
- output：jobId 为主信息，尾部可识别字节范围/总大小及省略标记；no output 状态仍明确。
- search：pattern/可选 jobId 为主信息，尾部可靠匹配/任务数量及限制标记。
- stats：简短主标题，尾部可靠 running/terminal 等统计，不挤进所有统计。
- attach：partial 单行 following/waiting，展开显示宿主提供的当前 partial；完成/解除等待/取消分别准确表示，不能把 stopped following 当作 job stopped。
- kill：显示真实返回的停止结果或错误，不推断真实 OS exit；展开完整返回文本。
- 所有 expanded 只显示已返回文本/当前 partial，不再读取日志、不拼成未实际返回的全量历史。

### R5 可选适配与无强耦合

不依赖可选插件安装/启用，不 import 其私有 registry/state，不改执行/schema/content/details/structuredContent，不额外轮询或 I/O。不存在的工具不注册/不激活；动态出现时按展示调用惰性处理。非适配工具直接 next。同名工具未知参数/结果形状时委托原 renderer；没有原 renderer 时使用宿主通用 fallback。历史结果按内容保守显示，不声称实时状态。文字解析不是身份认证，无法消除同名同形工具歧义，不做未经依据的强保证。

### R6 单行布局与验证

按可见列宽布局，元数据位于尾部；先缩略长标题，再省略次要字段/hint，绝不因窄屏生成第二行。offset/关键状态原子保留，物理换行转可读单行。键位提示来自当前 keybinding；Read 异步失效防护、附件单次显示与原编辑器/Task UI 回归保留。

## 排除范围

write/ls/bash_bg/monitor/Agent/workflow/web renderer、通用全工具收缩、插件后端元数据新增、通知美化、输入框改造、SDK 修改、个人 install/sync/reload、自动 commit/push。

## 验收标准

- [x] AC1/R1：actual-host pending/success/error 背景及行尾填充正确，无双 padding。长标题省略处reset已修，定向tmux逐cell连续背景通过。
- [x] AC2/R2,R6：原四类整个收缩块仅一行有效文字，展开保现有美化，覆盖结果前后/partial/错误/后台/未知格式/不同宽度。
- [x] AC3/R3：agent 查询正常/verbose/running/queued/error/not found/wait release/cancel 的已知信封单行与展开正确，未知合同安全委托。
- [x] AC4/R4：jobs 六种 action、无结果、分页、省略、partial与final、停止跟随和停止job区别均验证；只显示实际已返回内容。
- [x] AC5/R5：缺席/动态注册/同名不同格式/未知details/原renderer有无/恢复历史均不崩溃或破坏原展示；无内部插件依赖或额外执行读取。
- [x] AC6/R6：鼠标/宿主展开、键位、宽度、offset/notice/Shiki stale/附件保留，其他工具及执行结果不变。40列hint旧帧夹具误判已据raw frame排除；真实新宽度帧提示完整省略。
- [x] AC7：先红测后修复，actual-host/定向/完整严格检查及独立check，真实终端验证未做时明确限度。

## 规划与授权

用户已批准最终六工具方案及当前工作区执行；任务 in_progress。实施与独立 check 完成，main 已核 actual diff 和独立修复；不自动提交、安装、重载或归档。

## 真实终端复验（更新自动验收结论）

用户授权tmux验收；research/tmux-validation.md和json保留原总体FAIL。后续terminal-fix-report.md记录F1 reset根因及修复、F2旧帧夹具误判复核；terminal-fix-green/report.json 9/9 PASS，error=null，cleanup通过。AC1/AC6据定向复验重新通过。此前原四工具成功单行/真实CtrlO、jobs list、SGR stdin鼠标、三种dark背景颜色证据保留。未跑的get_result实际child及其他jobs action仍NOT_RUN，不能用自动测试冒充真实通过。

## 最终验收证据

main核 shared/layout/read、optional/agent/jobs 合同与实际独立修复及回归列表。AC1-6基于实际host/registered离线测试验收；AC7定向141/141、strict+完整606/606及无force-exit全量606/606自然退出，见research/check-report.md。已补owning executable spec，任务validate/diff-check通过。未知新增工具格式（含SDK details={}错误）保原多行展示，不承诺单行；原生Box极窄宽度限制保留。没有真实CLI/PTY/实际input-history验收，自动证据不能称终端视觉已通过。未install/sync/reload/stage/commit/push/archive。
