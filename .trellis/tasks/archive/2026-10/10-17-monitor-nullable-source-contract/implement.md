# Monitor 实施与验证计划

## 授权与执行方式

用户已批准按已审阅计划开始实施，并选择 ws.protocols required nullable。执行方式调整为 trellis-implement 实施、独立 trellis-check 审查，降低批量 fixtures 迁移的上下文负担；main 验证实际diff/检查结果并提交，功能范围不变。两个role manifest已准备，不需要allow-empty。批准覆盖范围内验证和scoped local commit；不安装/reload/push/归档，不改用户docs/或长期spec，历史文档问题只读记录。

## S1：单一耦合阶段

- [ ] 刷新 Git 与 task 状态，完整读取最终受影响 owner、调用方和测试；特别检查注册 Monitor 调用（含局部别名、.mjs probe），不误改仅metadata使用者。
- [ ] schema 改为五字段 required，ws 两字段 required；用 nullableControl 描述局部控制null。
- [ ] parser 复用顶层和独立ws浅层校验，无缺字段补齐兼容；保存内部optional和protocols数组语义。
- [ ] 全部纯参数校验在 registry/source effects 前完成，保持XOR与字段级空值错误；不改生命周期。
- [ ] 更新Agent-facing指引和完整例子，错误不要求省略required字段。
- [ ] 新增/迁移测试helper与全部受影响注册调用，保持原行为断言。
- [ ] 增加host/direct schema、缺字段/undefined/unknown-null、nested缺protocols/unknown-null、双null/双来源/空command、description/url类型、时间正小数/null/0/NaN/Infinity、协议null/[]/顺序/null元素及输入不可变回归。
- [ ] 主会话查看实际diff并执行聚焦/集成/全量检查，记录首次失败原因与重跑关系。
- [ ] 独立审查完整公共契约、嵌套边界、guidance一致性、零副作用与fixtures迁移；修复后重跑受影响检查并确认发现关闭。
- [ ] 验证通过后立即精确暂存本阶段文件并scoped local commit，不混入并行改动。

## 计划命令

先创建repository-external owned临时目录，使用现有SDK与隔离PI_CODING_AGENT_DIR，原始日志留临时目录，不写research/evidence。缺SDK/依赖是阻塞，不擅自下载。

```sh
node --test extensions/process-tasks/__tests__/monitor-schema.test.ts extensions/process-tasks/__tests__/monitor.test.ts extensions/process-tasks/__tests__/monitor-session.test.ts extensions/process-tasks/__tests__/monitor-setup-result.test.ts extensions/process-tasks/__tests__/monitor-notifications.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts
node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/loading.test.ts
pnpm check
git diff --check
```

全部node --test不force-exit；pnpm check全量配置的forced-exit不作为自然退出证据。按最终helper迁移扩展聚焦范围、不缩减行为覆盖。host-loading实际覆盖以现有loading脚本确认。未运行真实provider/物理终端则NOT_RUN，不能以stub WS代替网络实测。

## 最终记录要求

命令、环境、退出码、首次FAIL及修复/重跑、独立审查、commit checkpoint和NOT_RUN限制记录于本文件。用户验收后另行收尾授权；当前不会完成或归档。仅main核验后清理本run的owned临时目录。

## 额外只读受众审查（用户新增要求）

用户再次要求本次不修改 docs/spec，并检查历史遗漏。只读关键词盘点 docs、README、spec，完整读取 Monitor、Task Composition、web-access、ask-user-question、Beautify 页面。未修改上述路径；该审查不构成文档清理或实施授权。

确认遗漏：docs/extensions/monitor.md:7–35 含模型参数表与工具JSON，:40/:50/:69等以字段和动作解释使用；docs/extensions/task-composition.md:48–76 含Bash参数与process_manage动作矩阵、required字段及ID调用说明；docs/packages/web-access.md:21–33 含工具调用代码与provider/domainFilter等模型参数教学。应在未来另获文档编辑批准后改成用户请求方式、功能/限制，不以新nullable JSON替换旧示例。

spec是面向开发Agent的实现/验证材料，注册owner、输入验证、SDK assembler与生命周期不应因包含工具名就删除。但 .trellis/spec/development/index.md:57 的 good process/Agent payload例子已不符合当前完整envelope，作为当前合法调用表述错误；:38–41、:48的签名/模式例子混有调用教程风格，后续宜改为开发不变量与测试定位，避免长期复制wire payload。

README:120 的null/[]为用户清单配置语义；ask-user-question:38的guidance字段为用户可编辑配置说明；Beautify的工具名/状态为可见UI说明，不能仅据关键词判错。未对历史归档进行修改或清理。

## 当前结果

S1 实现完成并通过独立审查。产品仅 tools/monitor.ts；7个tracked文件和新增test-only monitor-input.ts涉及本任务（随后main添加host XOR回归，总8文件）。内部WsSpec、source/session/lifecycle未改。主会话核对完整owner/parser/schema、schema测试/helper及全部fixture/prompt实际diff；docs/README/spec无本任务改动。

环境：Node v24.14.1、pnpm10.33.0、已安装SDK链接，配置隔离于/tmp/monitor-nullable-UB9SzF/implement-agent；原始日志仅run外置临时目录。

实施agent执行：计划聚焦加activation/index首次137/139 PASS、2 FAIL、exit1（错误预期host拒绝0及string位置null）；依据SDK先转换事实修正测试而不改SDK，第二次140/140、exit0；补协议defaults/小数注册回归后第三次142/142、exit0、自然退出。计划process/runtime/task-ui/Beautify集成570/570、exit0、自然退出；loading.test.ts 2/2、exit0、自然退出；pnpm check含typecheck及1436/1436、exit0（全量force-exit不作自然退出证据）；diff-check exit0。main已查实际日志摘要及首次失败与重跑关联。

独立trellis-check c4485021-87f7-4c1只读完整范围，另跑聚焦142/142自然退出exit0、直接tsc exit0、scoped diff-check exit0，并做host探针。未发现当前批准范围内可局部修复的实现偏差。主会话已读/tmp/monitor-check-XCbImX/host-probe.log：空command/空白command经SDK仍原样，与WS对象组合被XOR拒绝；numeric null-first与number-first均把0/false/undefined/字符串0转null，调整union顺序无效。main把host空command XOR探针固化为注册回归，运行 `node --test extensions/process-tasks/__tests__/monitor-schema.test.ts extensions/process-tasks/__tests__/monitor.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts`（PI_CODING_AGENT_DIR=/tmp/monitor-nullable-UB9SzF/main-agent）：38/38、exit0、自然退出；final diff-check exit0。

限制：direct parser严格拒绝原始非法值；SDK可能在execute前将原始0/false/undefined转换null、string位置null转字符串null。入口无法恢复原始值，故不得宣称host raw拒绝0；AC4据实标注此局限，不引入未批准SDK/helper改造。本任务本地实现/检查完成，但此严格host输入验收差距必须向用户报告；若要求彻底解决须另行评审授权。真实provider/网络WS、物理终端NOT_RUN。独立lint未配置。

本阶段checkpoint：`9c459c2 fix: require nullable Monitor source controls`，仅8个精确产品/测试文件。main已核验独立日志摘要及空tsc日志、实施原始日志与probe。终态后仅清理owned临时目录 /tmp/monitor-nullable-UB9SzF 与 reviewer /tmp/monitor-check-XCbImX。任务已获用户验收与收尾授权（“收尾吧，然后我们看下个task”）；用户已知SDK转换限制，真实provider/网络WS和物理终端仍NOT_RUN。本次收尾仅归档与journal，历史docs/spec问题不清理，并行改动保留。

规划阶段：没有执行产品测试，没有改产品代码。首次定位renderer误猜路径 `extensions/beautify/tools/launch.ts` 不存在；随后搜索实际tools目录未发现Monitor特有parser，不将其列为实现owner。
