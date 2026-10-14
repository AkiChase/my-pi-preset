# 技术设计：Session Name

> 2026-10-14 用户批准收敛方案实施；补充合同见 `research/preimplementation-contracts.md`。不自动提交或安装。

## 模块边界
- `extensions/session-name.ts`：独立factory入口。
- `extensions/session-name/`：命令、配置、生命周期、命名prompt/输出校验、自动评估进度与手动标题所有权。
- `extensions/session-assist/`：拟定的纯共享模块，只供显式入口导入，无index factory或顶层entry。提供typed模型调用与上下文准备；Recap后续复用，不为未来通用AI能力扩建框架。
- 外部session-name从pi-preset.json packages移至conflicts。Recap包本任务保持不动。

## 请求合同
`streamSimple(ctx.model, {systemPrompt, messages:[user数据]}, {reasoning:pi.getThinkingLevel(), signal, timeoutMs}).result()`；等待完整结果，不做流式UI。参数捕获为请求快照，认证与适配归Pi，不使用complete原生选项模拟不同API。不要人为设置过小maxTokens，不默认修改payload。依赖SDK公开能力，缺失能力报告错误，不fallback导入另一套SDK。

Pi clamp依据模型metadata选择支持等级，不是400后自动纠正；某模型off不被标记unsupported仍可能400。失败保留标题，不擅自改变用户等级或模型。超时与取消使用自有AbortController及拥有的资源，结束解除监听/计时；默认120秒总截止时间，SDK timeoutMs 只作为支持时的传输参数；取消等待不保证终止非协作provider内部promise。不把maxTokens当标题长度校验。

## 上下文
通过public session-manager/buildSessionContext读取当前分支的有效投影，保留compaction/branch summary与user/assistant可见正文。排除thinking、工具日志、插件元数据。需验证实际公开构建API对context_edit/摘要的投影，禁止简单扫全JSONL或只读最后N轮。不截取增量，不额外LLM总结。

2026-10-14最终决策：不设置插件输入阈值、不按长度跳过、不截断为近期窗口、不增加手动超限确认；向命名请求发送整理后的完整有效上下文。成本通过N轮频率与自动开关控制，默认N=8；长上下文仍会增长输入成本，provider超限作为正常请求失败保留标题，不伪称固定token成本。

## 状态与提交
每activation有epoch、active、request owner；捕获sessionId/leaf/expectedName、context fingerprint、有效用户输入进度。成功前检查身份、新输入/分支变更、signal和当前名字。迟到响应只cleanup。

自动资格：自身成功生成/显式刷新成功才auto-owned；恢复已有未知名字视manual。监听public session_info_changed并结合session_info entry ID判别本扩展写入与外部改名；事件异步且无writer，不使用临时布尔标记。整个session共享手动保护，提交前复核最新title entry与name；不承诺跨进程直接修改文件检测，避免自身递归。原生/name改变使auto暂停，显式刷新失败不解除保护。auto开关与manual锁分开。

第一轮有效处理完成后可生成。之后每N个有效输入（默认8）在settled边界合并一次评估；工具turn_end不计。steering/followup以本activation输入候选与实际交付user消息保守一对一匹配；source=extension与斜杠输入排除，歧义不计，不补计未知历史。不能把input接收当接受或agent_end当用户round；已交付且settled的输入计数，aborted边界不发自动请求。成功同标题仍更新freshness；失败可见，记录重试基准位置，再N次有效输入重试，不立即循环。尚无有效上下文不调用。

session_tree/开始新输入/agent_start/关闭使旧请求失效；new/resume/reload按host factory lifecycle重建，计数与manual ownership持久化应采用版本化branch-aware非模型上下文entry，metadata不得影响语义freshness。持久化最小位置/所有权，不保存认证、完整会话快照或provider payload。

## 输出与UI
systemPrompt定义数据边界、简单判断、原标题准确则不变、主要语言、仅短标题。不能声称可强制不思考。输出剥离简单包装后严格校验，拒绝多行解释/控制字符/空值；失效响应不notify新会话。native setSessionName保存标题，status-bar沿用既有显示；terminal title交Pi原生，不保留旧包忙闲特殊符号。全局配置保存到agent目录session-name.json，自动开关与N跨会话持久化，不增加会话覆盖；不在preset files声明强制默认覆盖用户配置。命令配置UI只用public dialogs，取消不改配置；失败提示英文且不暴露认证。

## 回滚/兼容
产品工作限定本entry/shared helper、manifest/tests/README。禁止改SDK、已安装npm、.pi集成、无关任务源码；来源/许可证随实际参考程度记录。撤销本任务入口和conflict声明可恢复外部模式，但不能自动删除历史标题/用户配置或执行安装。
