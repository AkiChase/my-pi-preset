# Recap 实施与验证计划

## 授权与执行路径
2026-10-15 用户认可更新父任务后开始 Recap 的顺序并回复“可以”，批准本子任务 S1–S4 实施与验证，执行前已读当前规范与规划。沿用本任务显式不自动 commit/push/install/sync/reload/archive 限制；各阶段检查后记录不提交检查点。主直接实现，独立 trellis-check 审查公共请求、配置、生命周期和入口兼容；若派发，先按届时实际协议准备 check.jsonl 及 approved execution binding，不使用临时 isolation 或假定旧 overview 协议。

## 前置合同核实
- [ ] 读取 PRD/design 及当时最新 preset development/testing、相关 guides（以最新索引为准，不能依赖已删除的旧 spec 文件名）和 [错误详情证据](evidence/report.md)。
- [ ] 核实当前 public registry 模型解析/认证、thinking 支持、streamSimple options；context/projection 对 tool/custom/bash/压缩消息的实际行为。
- [ ] 核实 session/input/settled/branch/compact/shutdown 和 command 的事件顺序及可见通知/widget 能力；读取 [空闲机制边界](evidence/report.md)，区分 pi.on 与 AgentSession subscriber 事件，不得以推测替代实际 SDK 证据。
- [x] 实施前核实恢复路径，见 [S3公开合同](evidence/report.md)：actual SDK14/14自然exit0；用户接受无法确认完成的输入/导航暂停自动资格直到下一正常settled，aborted不生成。manual compact terminal至多一次完整延迟检查，busy后等下一正常运行不轮询；automatic开启仅重排既有unattempted合格窗口。
- [ ] 记录 git baseline 和并行变更，确认入口/fixture/文档引用；具备批准后才 start，unused manifests 有意为空才用 allow-empty-context。

## S1 目录收纳（纯路径变化，不提交检查点）
- [x] 将共享模块移至 session-assist/shared，命名实现/测试移至 session-assist/session-name；保留 top-level session-name.ts。
- [x] 同步 imports、fixtures、文档路径；不改变命名行为或缓存策略。
- [x] 自查实际移动 diff，focused 自然退出及 host loader/discovery 回归通过后记录检查点，再进入 S2。main 33/33（含命名/共享25、manifest7、sync脚本1），sync内部全部PASS，自然exit0；逐文件仅五处产品路径替换，见 [S1证据](evidence/report.md)。
检查命令（预期路径，实施时验证真实文件）：
`node --test extensions/session-assist/shared/__tests__/*.test.ts extensions/session-assist/session-name/__tests__/*.test.ts`
`node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs`

## S2 公共错误详情与 Session Name 独立修复（不提交检查点）
- [x] 公共请求层保留返回消息 `errorMessage`、抛出异常原因和 timeout；无详情才兜底，不混淆取消与失败。
- [x] 共用安全详情格式化：清控制字符、凭据脱敏和合理截断，不打印 headers/payload/stack，不吞正常原因。
- [x] 命名自动/手动通知显示原因和旧标题保留；保自动 N 次输入后的重试节奏及取消/过期围栏。
- [x] 替换旧“隐藏全部 provider detail”测试，加入返回错误、异常、超时、空详情、正常原因可见和敏感内容不泄露回归；自动/手动均覆盖，成功语义不变。
- [x] 主检查实际 diff，并完成该共享合同阶段的独立 review、定向修复和验证，再进入 Recap 阶段；派发前准备真实 check.jsonl 与 approved binding。最终主35/35、独立35/35及追加actual SDK/负例10/10自然exit0；六个最终hash主核完全一致，见 [最终独立证据](evidence/report.md)。S2仅阶段接受，不代表A6全量或Recap完成，不提交。
检查命令（S1 移动后路径）：
`node --test extensions/session-assist/shared/__tests__/*.test.ts extensions/session-assist/session-name/__tests__/*.test.ts`
验收：A8 和 A6 共享层部分，focused 自然退出；旧标题、N 次输入、取消及迟到通知回归通过；记录未提交检查点。

## S3 Recap 完整产品切片（不提交检查点）
- [ ] 独立 entry/factory、配置 dialogs，显式必需 model/thinking，无回退，不读取旧文件。
- [ ] 按100字符工具结果及32000默认总预算构建文本材料，优先删除旧工具再裁旧正文，Unicode/格式标记严格预算。
- [ ] 独立 prompt（用户语言一句）、输出清理、共享请求120秒/abort稳定参数；无小token预算或cacheRetention=none。
- [ ] 实现独立轻量活动/资格状态机：单调 lastActivityAt、window/activity version、epoch、attempted、单 timer 和单请求所有权；公开 input、message_update delta、tool start/update/end 接线，高频 token 不反复创建 timer。
- [ ] 最终 agent_settled 后完整等待 idleMinutes，不折抵运行中静默时间；agent_end、长工具、重试、排队续跑、压缩不开放生成资格。后台任务自身不阻塞，通知触发主运行取消。每窗口仅自动尝试一次，恢复例外/手动生成不与普通 timer 重复并发。
- [ ] 手动/恢复、branch-aware持久化、自动关闭、失败原因与实际后果可见、无重试、前后 runtime/session/branch/activity/material/idle/pending 门禁、晚结果隔离和资源cleanup；消费 S2 公共详情合同，不能再用固定文案吞原因。
- [ ] 同阶段加入真实上游 provenance/license、外部package conflicts、中文README/docs及完整相关测试；保持产品与迁移材料一致。
检查：
`node --test extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts extensions/session-assist/session-name/__tests__/*.test.ts`
覆盖：缺配置/损坏JSON/取消写入/模型未认证及不支持thinking；参数快照；空/长/工具-only/多语言材料；budget边界；120秒与非配合provider取消；重复请求/配置/输入/切换/压缩/中性metadata；restore自动关闭；失败不覆盖、自动/手动 SDK 返回 errorMessage/抛异常/超时/无详情兜底及安全展示、所有自动触发不可用原因可见；timer自然退出；actual SDK lifecycle及host loader。

空闲与生命周期必须逐项覆盖 [边界回归矩阵](evidence/report.md)：静默工具超过5分钟后 settled 仍完整延迟、text/thinking/toolcall与工具update、高频timer、并行/嵌套、agent_end后重试/续跑/队列、manual compact success-before-cleanup/失败、取消/失败导航、背景通知续跑、command/input覆盖限制、passive材料/中性metadata、到期和await竞态、旧finally、每窗口一次与恢复/手动去重、automatic开关及shutdown。至少用 actual SDK 离线fixture验证事件顺序和公开hook覆盖；fake clock验证时间状态机，二者不能互相替代，也不等于全部命令/直接bash覆盖。

## S3 检查点
2026-10-15 main 全文核候选三个产品文件、交接/独立报告及八项最终hash。F1–F5定向修复、F6按R2显式刷新已通过独立复审：85/85自然0、strict0、actual SDK11/11及附加3/3；主回归+manifest+sync94/94自然0。S3产品切片限定接受，未提交；证据见 [S3独立复审](evidence/report.md)。UI-less通知、部分持久化/activation-only排除、prompt-only纯文本及真实终端/在线质量限制保持，不能视为A6/A7全模式通过。

## S4 独立审查与整体验证（不提交检查点）
- [ ] 准备真实check.jsonl与范围，独立review；主核actual findings/diff，定向修并复跑影响检查。
- [ ] isolated temporary PI_CODING_AGENT_DIR + existing PI_SDK_DIR 下 `pnpm check`，保退出码且只清自建目录，禁止install/download。
- [ ] `node --test scripts/pi-manifest.test.mjs scripts/sync.test.mjs`，fake sync不改个人安装。
- [ ] `git diff --check` + 新/untracked whitespace + 本地Markdown links；检查tracked/untracked和并行hunks。
- [ ] PRD验收逐项证据，更新task research，评估是否有通用spec合同需记录，不制造功能spec。
- [ ] 离线provider/UI和actual SDK不是在线质量/真实视觉接受；tmux/online未授权则NOT_RUN。
- [ ] final Git review：不commit/push/archive/install/sync/reload；产品交付等待用户验收/授权收尾。

## S4 当前验证结果
main isolated `pnpm check` strict通过、892/892 exit0（b7rtaeog9）；定向94/94自然0、独立85/85自然0+actual11/11+3/3；finalhash、affected链接/JSON/whitespace PASS。证据及能力限制见 [最终集成](evidence/report.md)。产品实现/离线检查完成，等待用户限定接受；未提交/归档/安装/reload。全量forced-exit不代替自然退出，UI-less通知与partial persistence不作全模式保证。

## 已授权提交与终端验收
2026-10-15 用户明确“可以提交…开tmux真实验收”，解除本次 scoped commit限制并授权隔离真实CLI/TUI（离线provider，非在线质量）。main提交 `b48e37b` 精确38产品/测试/docs/spec文件，未提交批量task过程报告或并行工作；旧S1–S4检查点no-commit为当时限制，不重写历史。tmux普通agent40a60cfd-40be-49f完成限定离线真实验收，主全文核摘要/两个finalJSON/cleanup；13PASS +补充4PASS/1NOT_RUN，默认5min实际300004ms，无提前请求。全部20历次CLI PID主复核不存在、unique server无、38提交路径byteeq。见 [终端验收](evidence/report.md)。原生tree菜单专项fixture不匹配NOT_RUN，在线质量/物理IME鼠标/默认>5min长响应未测；raw证据仓外。未归档/安装/personal sync/reload/push。

## 延后
Session Name 前缀缓存仅独立只读核实，不在目录移动中修改prompt/context。若用户另行批准调整，应形成明确独立范围与原命名回归，不以“同模型”等价缓存命中。
