# 追加硬容量实施与验证（2026-10-13）

## 已批准决策与范围

解决上一独立审查的metadata数量无界缺口；保留决策reset重入和unknown异常安全转换修复。用户批准一次有界通知＋完整批次清单，不拆批、不增加唤醒、不新增config/admission，不改task-ui/agent/source decoder/OS ownership。当前main检出，未操作分支、stage/commit/push、finish/archive或install/reload；未读取／编辑并行task-panel-redesign及原4个.pi改动。

## 实现

- 新nested `extensions/process-tasks/monitor-batch.ts`：内部64KiB常量，`JSON.stringify({content, details})` UTF-8至多63KiB，预留1KiB信封；按来源逐个计量，只构造有界内联前缀，不构造全批content/details大字符串。共享outputPreviewChars与fair preview预算仍独立；普通小批旧single/batch正文/details保持兼容。source即便单个preview或路径超容量也不能绕过硬上限。
- `monitor-notifications.ts`：snapshot保存原始description/summary/note供manifest，wire仍裁描述160、summary/note512，正文/details同一裁剪载荷。溢出时一次投递给sourceCount/omittedSources/manifestPath；全部来源metadata逐行且字符串分块写JSONL，无full preview。原日志是全输出。沿用最多16转换/额外计数，未伪称恢复已经省略的转换历史。
- 清单位于配置logDir下独立uuid路径、`wx`独占、0600；不覆盖其他registry/epoch文件，无global singleton/SDK runtime。处理短写、关闭fd，失败仅删除自己独占创建的部分文件；source stop/reset/dispose/sweep保留磁盘清单。查询用文件读取/搜索，首行header，其后各source完整ID/state/原描述/summary/logPath等，再查原log；面板不自动导入清单。
- 路径自身不能完整放入容量时写前判失败，不展示假截断路径。失败仍发一次有界unavailable提示；未保存省略terminal不消费、notifyError/既有retrieval重查保留，不kill/replay/自动retry。保存成功但send失败也不消费任何terminal，保留清单。API返回void不证明模型已查阅。
- renderer复核：现有index监控分支对空monitorBatch也适用（数组truthy），直接显示正文省略hint/path；外部OSC/control先清再SDK按显示宽度截断，shell分支未改。README/spec/tool/provenance与PRD checklist同步。

## 回归与红证据

- helper 1500个terminal（远超running capacity）断言UTF-8硬上限、一次send、完整原description/summary/log查询、absent→resumed→completed与terminal消费；short-write、chunk上限、独占碰撞、写失败部分文件删除/fstat EBADF、超长100000字符路径、成功清单后send恶意对象失败/无replay、epoch唯一和日志保留。
- actual index factory在同一logDir创建两个独立registry，各350个真实WS source（只fake transport），running capacity=1，顺序terminal后保留全部metadata；一次deliver、文件中全部ID/log/summary、跨registry唯一、renderer窄宽/control安全。追加350终态批次注入manifest open失败，live WS仍继续、下一新活动可发且旧progress不重放，jobs list报notification failed；session reset/shutdown所有source fd与manifest fd归零、socket close一次，清单保留。
- 反向验证局部禁用bound/manifest（立即恢复）：helper1500及actual factory350两项均因content/details超过64KiB失败，0/2。见 [capacity-red.log](./capacity-red.log)。非产品红测：初次factory fixture误匹配Started monitor（实际Monitor ID started）；初次strict缺typed fs namespace和toolCallId，已修。huge-preview fixture初次插入换行触发行数限额而未超wire，已改单行。以上不冒充旧产品缺陷。

## 验证命令与最终结果

全部使用installed SDK 1.2.0只读路径、临时PI_CODING_AGENT_DIR，离线，无模型／网络／个人配置写入。

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | strict通过，linked0/7 |
| `node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts` | 150/150自然退出，2752ms；先前huge-preview fixture错误149/150另记，不隐藏 |
| `pnpm check`（临时launcher仅移除`--test-force-exit`） | strict＋571/571自然退出，29051ms |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | 511/511自然退出，14640ms |

现有package test自带force-exit，为遵守本轮不force-exit指令，用临时PATH/node launcher调用真实node，仅从argv删除该参数；未改package.json/SDK/依赖，pnpm check全部原测试仍执行。launcher及agentDir在finally式shell收尾中删除。日志：`/tmp/monitor-cap-{targeted,check,three,types}.log`。无单独lint脚本，未声称Lint运行。

静态链接/空白与最终scope结果见本文件末尾。当前仅implement自检，新改动需主会话重新派发独立check；上一check不是新代码验收。

## 最终静态与范围核查

57条本地Markdown链接无缺失；`git diff --check`通过，新增TS/文档另逐行无尾空白。staged diff为空，task-ui/agent diff为空；原4个.pi改动保留。并行task-panel-redesign及后来出现的task-panel-overview/task-presentation-unification仅status可见，未读取／修改；没有stage、commit、push、install/reload、finish/archive。新追加自检不替代独立check。
