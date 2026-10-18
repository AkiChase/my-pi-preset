# 实施与验证计划

## 授权

用户明确“开始吧”，批准三阶段实现、检查及本地阶段提交，不含install/reload/push/archive。为降低跨执行owner/公开契约上下文负担，S1选择trellis-implement，独立trellis-check审查；主会话检查diff与证据后提交。S2/S3按阶段复杂度重新选择实施者，独立审查保持。

## S1：Agent配置契约与返回

- 阅读相关spec、完整执行记录/resolver/session owner、启动和管理路径。
- 新增严格展示快照、resolved/session-effective、最小差异记录与模型正文摘要。
- 对齐runtime contracts/tools白名单、TaskView/source/facade、agent management、新建/resume/错误/partial投影。
- 保留现有stats类型与旧结果兼容，不修改parser/优先级/结果消费。
- 验收：AC1/AC3及AC5后端部分；新建前后台、确认前失败、确认后实际调整、false/off/未知、resume identity、快照不可变、foreign拒绝、模型正文和防泄露测试。
- 检查点：执行层/契约/正文与对应测试耦合提交。

## S2：Agent启动与管理显示

- 纯格式化共享配置组件；折叠model/thinking/mode/状态，展开完整配置与正文。
- 顶层/nested共用消费者、workflow不含agent快照时正常回退；不改workflow整套UI。
- 覆盖后台启动、前台、完成、停止、错误、output/wait及released/cancelled；旧/非法details回退。
- 宽度/ANSI测试覆盖窄终端和长model ID；renderer不访问后端、不消费结果。
- 验收：AC2、AC3显示与AC5渲染部分；独立审查后提交相关renderer/测试。

## S3：Monitor与Process管理集成

- 核对批次间隔owner实际读取语义，避免把live值误标启动后固定；记录最小monitor快照与启动正文。
- monitor启动renderer和process查询消费快照；不新增source URL/command等复制。
- monitor常驻Rule使用配置值静态说明，移除实时batch数值插值；不改调度行为。
- process展开恢复range/stat；bash不动。
- 验收：AC4/AC7，所有输入模式、未设置阈值、静默→恢复、截止、停止、关闭、partial/final及通知消费回归；独立审查后提交。

## 预检与命令

实施前读取development/testing/guides indexes及选定正文；确认实际SDK链接和测试glob。使用现有Node/TypeScript/SDK，COREPACK_ENABLE_NETWORK=0；不执行install或借HOME变化下载工具。先创建仓库外owned临时目录收集输出，最终核验后定向清理。

拟定聚焦命令（开始阶段先用find核对测试路径；不存在的glob必须修正并记录，不能算PASS）：

```sh
COREPACK_ENABLE_NETWORK=0 node --test --test-concurrency=2 \
  'extensions/agent-tasks/__tests__/*.test.ts' \
  'extensions/runtime-tasks/__tests__/*.test.ts' \
  'extensions/beautify/__tests__/*.test.ts'
```

S3加现有process测试：

```sh
COREPACK_ENABLE_NETWORK=0 node --test --test-concurrency=2 \
  'extensions/process-tasks/__tests__/*.test.ts'
```

聚焦先自然退出；如全组有历史挂起，记录真实失败/挂起及具体测试，选择相关精确文件自然退出，不能默默force-exit代替生命周期验收。

类型与最终集成：

```sh
COREPACK_ENABLE_NETWORK=0 node node_modules/typescript/bin/tsc -p tsconfig.json
COREPACK_ENABLE_NETWORK=0 node --test --test-concurrency=8 --test-force-exit \
  'extensions/**/__tests__/*.test.ts' \
  'extensions/**/__tests__/*.test.mjs' 'scripts/*.test.mjs'
git diff --check
```

最终全量与pnpm check脚本核对等价，固定并发控制资源；force-exit全量仅覆盖断言，不证明生命周期自然结束。SDK必须现有可用，不可因缺失自行下载。模拟renderer不等于真实终端视觉，mock provider不等于线上配置确认。

## S1验收记录

检查点1f60edb：Agent执行配置快照、阶段/差异、短正文与启动/管理/source/facade/共用契约投影，19个产品/测试文件。独立审查修复4项：stats未知仍误回请求值、thinking malformed对象转换抛错、workflow ID错误接受Agent配置、nested启动失败丢已存在record配置/身份。未修改renderer、monitor、bash、parser、配置策略或消费/通知。

实施初期fixture等待前台resume导致挂起并停止自有run；TS字段访问及fixture断言修正；首轮集成372/376暴露thinking误报与nested fixture旧metadata，owner修正后376/376。审查再次修复并最终377/377（agent/runtime/beautify glob并发2自然退出）、定向33/33自然退出、TS exit0、全量并发8 force-exit1446/1446 exit0、diff-check通过。命令与上列计划一致，审查现有Node24.14.1/SDK1.3.0，HOME/PI_CODING_AGENT_DIR隔离且COREPACK_ENABLE_NETWORK=0，无下载。

原始实现/tmp/pi-s1-config.YztPBe、审查/tmp/pi-s1-review.ucjya0，主会话核对diff及审查结论后保留待整体验收清理；主会话owned目录/tmp/execution-config-main.HDEbgU。全量force-exit不证明生命周期，线上provider/真实视觉/个人安装reload NOT_RUN。主会话审查者为独立trellis-check，不等同实现者自查。任务在main启动，CLI提示main/base-main非PR归档限制，本轮不换分支或归档。

## S2进度

S2已提交361110b：现有tool标题/卡片风格保留，启动和管理折叠摘要/展开配置+差异+完整正文，6个产品测试文件。独立审查修复management agent_id/kind不匹配、启动邻接数据畸形fallback、resume请求外部Agent的配置拒绝；actual ToolExecutionComponent补stop/final-wait/多正文50+行/partial-final/narrow Unicode/theme。审查before-fix回归失败，修复后377/377自然退出、TS exit0、全量1446/1446 exit0、diff-check通过。

实施早期TS fixture unknown收窄失败、pending同步fixture预期错误与foreign fallback断言错误均记录重跑，未掩盖产品失败。原始实现/tmp/pi-s2-render.gABxrS、审查/tmp/pi-s2-review.jWRwdW保留待主会话最终清理。环境与S1一致，无下载；真实终端视觉/线上provider/个人reload NOT_RUN。

S2已提交后进入S3，monitor/Process range/stats此前未实施。

## S3与最终验收记录

检查点445c0bc：monitor启动配置五字段冻结快照，启动与查询/等待关闭保留投影；官方beautify monitor renderer、静态batch Rule、Process范围与统计显示，共21个产品测试文件。未修改bash owner/launch/renderer、Agent策略、监控调度器或通知消费。批次值标启动配置而非精确发送周期；false/off/显式null无截止或关闭/未知语义均保留。独立审查修复统计key/计数白名单与数组range/不适用动作、monitor无task_id配置准入，补真实宿主fallback。

最终隔离Node24.14.1/SDK1.3.0、COREPACK_ENABLE_NETWORK=0，无安装或下载。与计划相同命令，process/agent/runtime/beautify四组并发2共777/777自然退出，TS exit0，全量并发8force-exit1453/1453 exit0，diff-check通过。统计旧验证内存回归实验最终预期FAIL(exit1)，前两次因未转译/裸import解析失败不能算证明。实施初期TS缺adapter文件、fixture泛型错误分别修复重跑；无测试断言失败。原始实现/tmp/pi-s3-monitor.zBgYLC、审查/tmp/pi-s3-review.SgzojC。

既有waits.test.ts工厂fixture的pi.on返回Map而非unsubscribe，widget-display/client dispose因此记录offStart is not a function；主会话核对完整栈定位到waits.test.ts:249与未修改fixture，不因断言全PASS宣称全部cleanup diagnostics干净。本任务不顺便改widget-display/旧fixture；保留这一限制与定位，不依赖临时日志。

AC1–3由S1/S2独立审查与最终共享链路集成验证；AC4/5/7由S3严格metadata/真实SDK组件与monitor生命周期集成覆盖；AC6主会话核对实际diff/提交和检查证据完成。实际终端视觉、线上provider、真实远端WS、个人install/reload、全量自然退出、token/cache测量NOT_RUN；全量force-exit只证明断言。没有独立lint脚本，不宣称lint PASS。

最终主会话核验后定向清理上述6个实现/审查目录及/tmp/execution-config-main.HDEbgU均成功，无其他session目录清理。关键失败、原因、重跑结果与限制已在本文留存，不依赖已删除的日志路径。

主会话最终产品范围干净，保留全部无关并行.trellis/.pi变更。spec沿用现有所有权/metadata/真实host验证标准，不为一次配置展示制造长期教学spec。用户已最终接受并授权收尾；仅归档当前任务、清除绑定与记录会话，不含push/个人reload或启动其他任务。任务直接在main实施且base_branch相同，归档使用非PR任务的--skip-branch-validation，不伪造分支历史。

## 最终记录

逐阶段实际文件/命令/环境/退出码/失败原因与重跑关系、独立审查修复、commit见以上验收记录，取代规划时全部NOT_RUN占位。线上provider、真实终端视觉、个人install/reload、token/cache测量默认NOT_RUN，若新增验证另说明权限与环境。最终比对AC1–AC7，检查tracked/untracked与并行diff，不包含他人改动。

规划待核对点：monitor批次间隔读取语义；runtime新增optional字段版本兼容；启动与beautify renderer接入及旧结果回退。由实施前源码核对解决，不据此推迟显然必要的规划，也不擅自改变范围。
