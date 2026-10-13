# 独立质量审查结果（2026-10-13）

## 范围与材料

已完整读取 hook 注入的 check.jsonl 全部规范／notification-paths，以及 PRD、design、implement；另读取 check.jsonl 本身、implementation-results、red-session-batch 全部内容及 preset index Quality Check。检查当前全部 task-owned tracked diff、未跟踪 monitor-notifications.ts／测试／task 文档、实际 registry／lifecycle／notify／session／factory／retrieval 调用。未提供 Review base，故不把 committed history 计入本次审查。

task-ui／agent 路径没有变更；普通 shell 发送正文／时机、源双流 decoder／日志／OS execution 没有改动。未读取或编辑并行 task-panel-redesign；未编辑 `.pi` 四个既有改动。无 stage、commit、push、install、reload、finish/archive。

## 已发现并修复

1. `monitor-notifications.ts` 的决策订阅回调同步 reset 后，新 epoch enqueue 被 flushing 守卫挡住；旧 flush 发现 epoch 改变直接返回，导致新源 pending 无 timer。修复为旧决策快照停止遍历，释放守卫后重新 schedule。不能简单在 reset 中清 flushing，否则可能递归 flush。
2. `sendMessage` 抛出无原型或 throwing-toString 对象时，catch 的 String(error) 再次抛错，实际 command source 会转成失败并关闭双 pipe。新增安全 unknown 转换 fallback，保持监听和日志，并不自动重放进度。

新 scheduler 红测修复前 0/3，见 [check-red.log](./check-red.log)。实际 factory/session 回归在窄恢复旧代码后 0/2，见 [check-actual-red.log](./check-actual-red.log)，恢复修复后通过。actual factory fixture 初次误用内部 killed 代替公开 stopped，修正 fixture 后再做上述反向证明；该初次失败不计产品红测。

实际新增六项断言：决策 reset、两种恶意异常、factory deadline 决策同步 fallback 新源、command session 异常隔离、send callback reset+enqueue 不 commit 旧 terminal latch。最后一项现有逻辑通过，无额外产品修复。

## 核查确认

- 自然 completion 内部 abort 保留有限尾批，显式 stop／shutdown／setup rollback 清 pending；自然终态投递不依赖 job running。
- 快照发送前移出，progress send 重入自然结束保留下一终态；成功只有本快照 terminal 调用 markOutcomeSurfaced。其 cancel 不吞真实 source 新进度：terminal source 已停止，progress 快照不会调用该标记。
- 固定短窗、小 F／F=0、ordinary 与 timely 合批、先 deadline/silence 决策、absent→resumed 顺序、attach/outcome/retrieval 重查和异常无自动 replay 均有实际测试。
- registry 是通知唯一 owner；runtime import 到 notify/config/types，无 state 反向 runtime import 成环。source handler／fd／socket 与 actual execution 沿原 owner 清理；finish 移除决策订阅，freeze/reset/dispose 清有限 queue/retry/timer。
- customType 两类均用 index renderer，single monitor 与 monitorBatch 均清外部控制符、按 visible width 截断，shell renderer 不变；manifest 回归确认没有新增顶层入口。

## 尚未解决的容量要求

`maxConcurrentJobs` 仅限制 running，终态十分钟保留没有数量上限。快速串行终态可在 200ms 内积累超出并发上限的来源，held retry 也可积累。因此 metadata 逐来源有界、整批输出预算有界，但整批来源数／metadata 没有独立硬上限，不能宣称“有限 registry 容量”满足 PRD 总消息容量验收。

已更正 README／monitor-contract 的过强描述。必须由主会话与用户决定容量策略：限制／省略来源、分页／拆批、admission 或其他策略均改变已批准的保留所有 ID／一次投递／shell 不变边界，不能擅自实施。本轮不关闭这项验收。

## 最终验证

所有测试使用已安装 SDK 1.2.0 只读路径与临时 PI_CODING_AGENT_DIR，离线，不写个人配置；未设置 force-exit 的命令均自然退出。无独立 lint script，strict typecheck 与 diff/link 检查替代可用验证，不声称运行了 lint。

| 实际命令 | 最终结果 |
| --- | --- |
| `node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts` | 142/142，自然退出，2228ms |
| `pnpm check` | strict TypeScript + 563/563，21049ms；package test 原本含 force-exit |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | 503/503，自然退出，16195ms |
| `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"` | 563/563，自然退出，24211ms |

本轮所有完整检查均通过，未触发既有未修改 task-ui/editor.test.ts:208 的 3999/4000ms timing 波动；其历史失败已在 implementation-results 保留，不能声称已修复。无在线模型／真实 TUI／端到端送达证明。

日志位于 `/tmp/monitor-review-{targeted-final,check-final,three-final,natural-final}.log`，task 中保留红证据。最终 Markdown links、空白及 scoped status 结果另在本文件末尾记录。

## 本 check 实际修改文件

- `extensions/process-tasks/monitor-notifications.ts`
- `extensions/process-tasks/__tests__/monitor-notifications.test.ts`
- `extensions/process-tasks/__tests__/monitor-session.test.ts`
- `extensions/process-tasks/__tests__/index.test.ts`
- `README.md`
- `.trellis/spec/preset/monitor-contract.md`
- `.trellis/spec/preset/testing-guidelines.md`
- 本 task 的 `implement.md`、`research/check-results.md`、`research/check-red.log`、`research/check-actual-red.log`

最终静态检查：55 条本地 Markdown 链接无缺失；tracked task diff 与 task 新文档／新 TS 全文件无尾空白，`git diff --check` 通过。staged diff 为空；task-ui／agent diff 为空；status 中仍保留原 `.pi` 四个改动及并行未跟踪 task-panel-redesign。未运行独立 lint（项目无该脚本）。


## 追加硬容量后的最终独立check（2026-10-13）

前文为追加容量前的独立审查证据，完整保留；该轮metadata硬上限blocker现已闭合。本轮读取更新PRD/design/implement/check.jsonl、所有注入spec/research及implementation-results、capacity-results与全部红日志；检查全部tracked task diff、3个新增TS、task所有artifacts及真实factory/session/retrieval/lifecycle调用。无Review base，未审查committed history。

### 发现与窄修

1. `monitor-batch.ts` 初始预选把overflow提示预留用于普通批，两个15938字符logPath的实际普通载荷仅64303bytes，仍误选1/2来源。不必要的manifest写入也会在不可写logDir制造未告知终态。修为按来源精确累计普通JSON（含section转义/分隔符），确实overflow才预留hint；单来源按实际旧details形状计量。最终payload再断言硬上限，没有构造全量批字符串。
2. `monitor-notifications.ts` catch原对象直接传console.error，抛错inspect.custom仍会逃逸；actual command source变failed并关闭双pipe。新增仅传安全字符串、捕获可选diagnostic sink异常的report helper，覆盖decision/manifest/send；error.message只接受string。保留此前reset新epoch scheduling及unknown转换修复。
3. 修正notify.ts顶部注释为shell立即发送、monitor归共享调度，不改shell执行逻辑。

新增两项红测未修时0/2，见[final-check-red.log](./final-check-red.log)；actual command局部恢复原对象日志后1/2（原null-prototype通过，inspect对象失败），立即恢复修复，见[final-check-actual-red.log](./final-check-actual-red.log)。没有把fixture错误当产品证据。

### 全边界核查

- 64KiB内部硬上限满足：最终content/details JSON≤64512bytes，实际sendMessage message＋options JSON≤65536bytes，description/summary/note及转义/重复文本均计入。1500terminal和actual两个350terminal批次(capacity1)仍一次发送，全部原ID/state/description/summary/log及有界transitions可由manifest查询。
- 独占uuid/wx/0600，短写循环、写0、write异常、close前／后抛错、EEXIST保旧文件均验证。JSON分块与JSON.stringify(row)一致，覆盖4096边界pair、孤立surrogate、控制符/转义；完整snapshot note/silenceMs/toolUseId保留，没有preview。
- 超长路径先失败不造假路径，NUL配置路径诚实unavailable。manifest保存成功＋send成功才消费全部；保存失败仅成功inline消费，遗漏terminal保持notifyError/retry，失败send不消费任何terminal。显式retrieval重查成功清资格，重复closure调用不重复enqueue；无自动replay/retry，无kill。
- snapshot/epoch/send重入、先decision终态／deadline／silence、16转换＋省略数、自然abort尾批与silent stop/reset/dispose/sweep owner沿原契约。running WS在manifest失败后继续，原日志/清单保留。empty monitorBatch的renderer显示overflow提示且按width/control安全。
- shell/agent/task-ui路径没有行为扩展、配置/admission/通知次数改变；没有读取／写入并行task-panel-redesign/overview/presentation任务及原4个.pi改动。staged为空，无commit/push/install/reload/finish。

### 最终版本验证

全部installed SDK1.2.0只读路径（linked0/7），临时PI_CODING_AGENT_DIR，离线。`pnpm check`通过临时PATH/node launcher仅去掉既有`--test-force-exit`参数，原strict与全部test glob照常执行；未修改package.json/SDK。无独立lint命令，未声称运行lint。

| 实际命令 | 最终结果 |
| --- | --- |
| `node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts` | 158/158，自然退出，2763ms |
| `pnpm check`（临时launcher去force-exit） | strict TypeScript＋579/579，自然退出，测试20595ms |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | 519/519，自然退出，14837ms |

日志：`/tmp/monitor-finalcheck-{targeted,full,three}.log`。最后检查未触发既有editor3999/4000ms波动；不宣称已修复。无在线模型／真实TUI／端到端送达确认；同步写manifest可增加本地IO成本，不是新的强实时承诺；操作系统拒绝close并持续不关闭时无法证明OS fd关闭，原finally仍尝试并删除自己部分文件。本轮可复现close前后/短写故障全部自然退出。

### 本轮实际修改

`monitor-batch.ts`、`monitor-notifications.ts`、`notify.ts`；`__tests__/{monitor-notifications,monitor-session,index}.test.ts`；README、monitor-contract/testing-guidelines；本task PRD/implement/check-results及2份新增红证据。其余task diff已复核未改。

最终静态检查：60条本地Markdown链接无缺失；git diff --check与全部scoped新文件尾空白通过。新增红日志仅去行尾空白，旧审查证据未重写。staged为空，task-ui/agent diff为空；status保留原4个.pi及3个并行任务。
