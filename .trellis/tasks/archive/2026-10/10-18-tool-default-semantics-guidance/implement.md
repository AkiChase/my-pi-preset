# 实施与验证计划

## 当前状态与授权

任务已绑定当前主session；用户明确“开始吧”批准按最新PRD/design实施，已start为in_progress。授权包含按workflow验证后的scoped local阶段提交，不包含安装/reload/push或归档。内置手册不跟普通Skill禁用联动的策略已确认；旧research中的禁用gate要求由最新设计替代。任务当前记录main与base_branch相同，CLI提示后续PR/归档风险；本轮不归档或擅自修改分支。

## 实施前规划门槛

- [x] 用户review架构方向：process_manage完整留在tool，只有subagent相关内容用Skill披露；这不是完整新文案的实施批准。
- [x] 完成只读资源通路检查，见research/builtin-skill-loading.md。用户随后明确接受本插件手册不跟普通Skill禁用联动；noSkills/过滤与父索引不再是阻塞，不新增兼容gate或SDK修改。
- [x] 研究Agent已生成research/skill-preview-zh.md及迁移映射，用户大致认可；其中普通Skill禁用联动说明按最新PRD/design决定替代，research保留历史。
- [ ] 用户明确批准按最新策略实施；预览和加载策略均已认可，不要求重复审核同一文案。
- [ ] 准备独立check.jsonl的真实spec/research引用；unused implement.jsonl可空，start时显式--allow-empty-context不代替授权。

## 执行与审查

采用trellis-implement实施以降低长文迁移上下文负担，每个阶段独立trellis-check审查跨模块资源/指引契约；主会话核对实际diff和测试后立即形成阶段提交。共享源目录执行，主会话不与执行者并发编辑同一产品文件。不得同时编辑兄弟任务的配置回显或renderer。原始日志与临时驱动使用仓库外owned run directory，不写research。

## S1：静态语义与内置Skill资源通路

- [ ] 获批后start，刷新Git与完整相关源码/测试。
- [ ] 修正schema短描述、默认/优先级/null含义及必要源码注释，不改配置resolver/SDK/执行结果。
- [ ] 新增内置Skill入口与三份reference，按用户已审内容迁移准确教程；暂未压缩的长规则与迁移稿若短期共存仅为阶段过渡，不宣称最终完成。
- [ ] 注册resources_discover，基于插件位置提供原生Skill路径，不部署用户/项目目录，不增加动态prompt全文拼接。
- [ ] 验证发现/实际加载/相对引用/安装位置变化、startup/reload、冲突及普通noSkills下仍提供内置手册的已接受行为；扩展未加载/isolated不主动注入，工具权限保持。确认包内部资源包含与不修改pi.skills。
- [ ] 聚焦检查+typecheck+独立审查，核对scope后提交耦合代码/资源/测试。建议message：`Add built-in subagent guidance skill`。

S1可独立验证资源通路；常驻长文暂仍在旧owner直到S2迁出。若采用的实现无法保持过渡安全，合并为一个有完整验证的阶段，实施前更新此计划，不制造失效中间提交。

## S2：精简常驻规则与渐进式披露

- [ ] 按已review预览缩短工具Rule，保留schema、用户授权、模式/ID、等待/停止与通知底线。
- [ ] workflow/API/patterns仅在Skill/reference中维护，旧长template移除，不再自动注入；迁移清单逐段核验无丢失。
- [ ] 移除仅服务动态后台说明的guidance options/call参数，不改live setting。
- [ ] 测试真实SDK assembler常驻短Rule、Skill索引不含正文、各模式与扩展/工具权限、完整API示例及nullable/生命周期保持。
- [ ] 记录常驻Rule/description与Skill索引长度、reference正文覆盖；字符/行数不称tokens或cache命中。
- [ ] 聚焦检查、最终pnpm check、独立审查与实际diff核对后提交。建议message：`Move subagent tutorials to progressive skill references`。
- [ ] 回填AC、检查点、限制；任何archive/journal另按用户授权处理。

## 拟验证命令

已有SDK和node_modules可用时，在仓库外自有agent config directory及现有PI_SDK_DIR隔离下执行；解析SDK失败停止，不下载。连续全量检查顺序运行，避免并发资源压力。实施新增测试文件后更新真实命令与执行结果。

```sh
node --test --test-concurrency=2 \
  extensions/agent-tasks/__tests__/input-errors.test.ts \
  extensions/agent-tasks/__tests__/tool-contract.test.ts \
  extensions/agent-tasks/__tests__/nullable-schema.test.ts \
  extensions/agent-tasks/__tests__/loading.test.ts \
  extensions/agent-tasks/__tests__/workflow.test.ts \
  extensions/runtime-tasks/__tests__/prompt.test.ts \
  extensions/runtime-tasks/__tests__/nullable-controls.test.ts \
  scripts/pi-manifest.test.mjs
# 实施新增后加入：extensions/agent-tasks/__tests__/builtin-skills.test.ts
pnpm run typecheck
pnpm check
git diff --check
```

实施前核实loading.test.ts存在和真实fixture覆盖，新增builtin-skills应驱动实际资源加载器/extension事件，不以源码字符串匹配代替Skill加载。focused不使用force-exit；full check的force-exit不证明自然生命周期。参考Markdown链接/语言、frontmatter、冲突和package包含检查需纳入相应测试。

### 必须验证的场景

- resources_discover startup/reload返回的Skill路径可读且相对reference可解析，移动插件fixture后不依赖cwd或本机路径。
- 原生Skill索引仅包含元数据/路径，正文未在常驻工具Rule/Skill入口全部展开；不自行增加system assembler。
- 普通noSkills/skills:false/string[]不要求阻止本插件手册追加；assert当前策略符合最新用户决定。不增加父索引清理、预载器改造或其他Skill过滤。扩展未加载/isolated不主动注入、不启用未授权工具。
- 插件关闭/Skill不发现、同名冲突、缺失文件的明确行为；不向用户声称已读不可用文档。
- 顶层/nested新建与resume、false/0、workflow args:null、JSoptional、ID与owned生命周期保持。
- Skill加载不是workflow授权；常驻opt-in规则保留，patterns不鼓励未授权fan-out。
- before/after教程逐段映射完整，模型/effort/继承含义准确，未借迁移修复replay/cache等其他行为。
- renderer/结果metadata/兄弟任务与用户资源目录无修改，无docs/spec参数教学。

## S1阶段验收记录

检查点：`88878a6`（Add built-in subagent guidance skill），主会话核对实际diff、资源入口、真实host测试与独立审查后提交18个耦合产品/测试/资源文件。独立trellis-check已恢复生成Agent向导的两处越界文案，并比较generatePrompt整体与HEAD原文一致；不把该向导改动纳入任务。

环境：已安装Pi SDK 1.3.0，临时HOME/PI_CODING_AGENT_DIR。实现者初次测试三次fixture失败（错误导入/个人Skill发现等fixture问题），修复后聚焦48/48、typecheck、full1439/1439通过。临时HOME下pnpm typecheck触发Corepack下载pnpm10.33.0，属于未授权副作用，明确记录而非用后续PASS抵消；不再安装/下载。独立审查使用COREPACK_ENABLE_NETWORK=0、现有Node/TypeScript直接运行，聚焦48/48自然退出、`node node_modules/typescript/bin/tsc -p tsconfig.json` exit0、`node --test --test-concurrency=8 --test-force-exit "extensions/**/__tests__/*.test.ts" "extensions/**/__tests__/*.test.mjs" "scripts/*.test.mjs"`1439/1439 exit0、diff/Markdown链接/英文/空白检查通过。未运行独立lint（项目无脚本）；等价直接检查不称pnpm wrapper运行。

原始证据暂留`/tmp/subagents-s1.l13Pbt`、`/tmp/subagents-check.ZS0nb6`，包含失败日志、Corepack事实与重跑；结束整体验证后只清理本会话自有目录。权限拒绝不可读文件、线上provider、视觉、个人reload/install、cache/token测量NOT_RUN。S1仍保留旧长规则作为安全过渡；S2迁出后最终单一源和常驻长度才验收。

## S2与最终验收记录

检查点：`2f32141`（Move subagent tutorials to progressive skill references）。主会话核对7个文件实际diff、独立trellis-check审查与最终测试后提交。process_manage与S1资源/description不在S2改动中；只有subagent规则精简与guidance调用参数、测试变化。完整workflow长教程移至S1内置references，不再在tool-description中重复维护；Skill入口按需分流。

实现者与独立审查均使用COREPACK_ENABLE_NETWORK=0、临时HOME/agent、现有Node/TS/SDK，无下载。最终聚焦自然退出49/49、`node node_modules/typescript/bin/tsc -p tsconfig.json` exit0、配置full suite直接等价命令1440/1440 exit0、diff/英文/引用/空白检查通过。独立审查无剩余阻塞、无产品修复。S2无失败验证；实现者末次改文案后重新运行最终focused/type/full，审查再次复现。没有pnpm wrapper/lint单独PASS宣称。

相对S1前`53cdbbc`，实际SDK注册Rule字符数/非空行：顶层run5257/28→5012/27；nested3127/19→2930/18；workflow22839/143→2337/8，workflow约减少90%。当前安装路径Skill原生索引525字符/7非空行；不含API/tutorial正文，路径变化可改变长度。Schema递归长度8937→9505重复计nullable分支description，不作为去重模型上下文大小；不是tokens/cache命中测量。审查核对length-last/current一致；length-final旧稿每个run少计15字符，不采用。

覆盖：实际host startup/reload、移动安装目录、metadata-only索引、native读正文/reference、no/hidden reader、disableModelInvocation、同名冲突、缺失资源、普通Skill过滤独立追加、7种child policy及工具deny保持；真实注册/SDK assembler peer/hidden与功能门控、nullable/配置优先级保持。教学占位示例不声称全部独立可运行；既有replay/cache绝对保证的历史局限按授权保留，不机会性改行为。

AC1–AC6按上述代码/资源与验证完成；实际diff未改parser/resolver/返回/renderer/向导，权限与执行契约保持。线上provider、视觉、个人安装/reload、权限拒绝不可读文件、token/cache效果NOT_RUN。源spec复用现有规则，本任务不添加长期参数教学spec。

原始目录`/tmp/subagents-s2.LRnKXd`、`/tmp/subagents-s2-check.O3zarw`及S1的`/tmp/subagents-s1.l13Pbt`、`/tmp/subagents-check.ZS0nb6`均在主会话核验后定向清理成功；未清理其他session目录。上述记录保留失败、下载事实、重跑结果及限制，不依赖临时路径。任务仍in_progress等待用户接受/单独finish授权，当前分支main/base-main归档风险仍保留，不擅自改branch/push/archive。

## 尚未执行的记录

- 当前规划更新：完成，仅任务材料。
- 新结构完整中文预览：已生成research/skill-preview-zh.md且用户大致认可；普通禁用联动说明由最新策略替代。
- 资源gate/子loader技术确认：源码研究完成，先前BLOCKED已由用户明确接受扩展追加语义解除；采用child return前只注册resource handler、不创建manager，无私有seam/noSkills兼容gate/父索引清理。
- S1/S2产品实施、聚焦/类型/全量检查、独立审查与阶段提交：已完成，详见验收记录。
- 用户最终接受、finish/archive/journal：已授权，主会话执行收尾；非PR主分支任务按CLI --skip-branch-validation归档，不改变分支历史。

## 收尾材料审查

保留PRD/design/implement作为目标、设计与最终证据；保留四份用户实际审阅的研究稿及加载研究，记录从精确措辞→中英对照→完整预览→Skill分层预览的决策过程。它们为授权研究Agent产出的Markdown，不是原始执行日志；旧预览与旧阻塞说明由最新PRD/design/验收记录明确替代，不作为当前契约。role JSONL的研究路径随本次归档修正到archive目的路径，确保归档内部引用可读。材料不含临时驱动、全量日志或截图；原始证据已按自有目录清理。

收尾执行：archive --skip-branch-validation已将任务移至archive/2026-10并设completed，当前session绑定已清空。CLI自动提交因原任务从未tracked、旧source pathspec不存在而失败（命令仍返回0）；主会话核实已暂存仅此归档目录，按现有收尾授权补交该exact目录，不修复CLI或纳入并行脚本改动。JSONL归档引用存在性检查通过。
- 真实provider/在线视觉/cache命中测量：NOT_RUN，非本任务效果承诺。
