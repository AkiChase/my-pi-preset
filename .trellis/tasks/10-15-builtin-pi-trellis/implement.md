# 内置 Trellis 实施计划（规划草案）

## 全权授权与基线（2026-10-16）
用户将S1–S4全部交由主会话逐步完成（见PRD授权节）。基线pin邻仓`24e3cef`；第0节未完成项按此关闭。

## 提前文档阶段 D0（2026-10-15获批）
用户明确批准在邻仓init check完成前先编写迁入后的用户文档。此为文档限定实施授权，提前执行S4的用户文档草稿部分；不授予S1–S3产品迁移、部署、安装、reload或真实终端测试权限。
- stable命令/工作流按邻仓当前已提交源码与文档核对；新项目技能部署等迁移目标明确标为迁入版本目标、尚未上线。
- init check未完成细节不虚构结果/固定输出；留出最终pin/source核对步骤，文档草稿不代表产品验收。
- 用户纠正首稿过长、不像用户文档；改为短文档：入口`docs/extensions/trellis.md` + `trellis/initialization.md` + `trellis/tasks.md`，只讲用法；README与全局导航待插件实际迁入后再切换，避免把未上线能力当当前已发布产品。
- 文档检查完成后按文档scope本地提交；其他迁移阶段等待最终批准与pin。

## 当前边界
用户批准继续完善planning及提前D0文档限定实施；产品迁移设计仍未批准。仅D0可start/写用户文档/检查与精确提交；不搬产品、不安装/sync/reload/删除邻仓。S1–S3仍按PRD R1–R7及design等待基线及最终迁移批准。

## 0. 规划收敛与基线门
- [x] 用户确认插件extensions/trellis+薄入口、复用本仓install、详细中文用户教程/英文spec提炼、小共享layout工具、init完整项目技能部署。
- [x] 用户确认等邻仓已实施成果与证据留存策略审查提交后固定commit，不接管dirty。
- [x] 完成新技能部署research/project-skill-deployment.md，整合支持文件/相对路径、未知root保留、schema3独立skills库存、显式schema2升级、移除自动reload及cwd发现限制。
- [ ] 确认邻仓初始化诊断与留存策略完成，并记录明确产品baseline commit（不是随手latestHEAD）；重新核资源/hash/源码闭包，无dirty成果混入。
- [ ] 按最终邻仓pin收敛已知schema2/release技能补齐分支；用户已排除额外旧包来源兼容，不新增检测/清理分支，不再作为待确认事项。
- [ ] 审阅最终PRD/design/implement，通过用户最终实施批准后再start，准备每个派发role的真实JSONL。

## S1 迁入产品闭包与唯一加载（A1/A2/A5/A6）

S1 具体决定（基线d0e07c9；测试只保留逻辑/纯函数，不迁UI/宿主测试）：
- `extensions/trellis/index.ts` 来自邻仓 `extensions/trellis.ts`；`lib/ runtime/ resources/ agents/ skills/ licenses/` 原样相对布局；邻仓 MIT `LICENSE` 保存为 `licenses/pi-trellis-MIT.txt`；顶层 `extensions/trellis.ts` 仅转发默认导出。
- 不迁 `scripts/{install.sh,patch-trellis.py,deploy-worktree.py}`（产品无调用者）、`docs/`、`TESTING.md`、`AGENTS.md`、邻仓 package.json；依赖这些脚本或邻仓Git历史的测试重写或不迁。
- 测试进 `extensions/trellis/__tests__/`，根 test/自然退出命令扩展 MJS glob；Python测试经现有 MJS wrapper 调用。
- 技能在S1保持旧动态发现行为可用（指向新路径），S2再改为部署。包身份检测改认本包 `my-pi-preset`。
- `pi-preset.json` 移除 `git:github.com/AkiChase/pi-trellis` 包并加入 conflicts。

S1 检查点：基线d0e07c9产品资源字节一致，lib/index仅路径/文案/严格类型差异；独立审查首轮NOT ACCEPTED（剔除了fake-pi handler安全逻辑测试），已恢复；dispatch测试83s→13s。Trellis测试432/432自然退出约80s，Python 32，`pnpm check` 1470/1470。不再覆盖：真实宿主加载、viewer界面、菜单文案。
- [ ] 从固定commit按清单迁入extensions/trellis/index.ts/lib/runtime/resources/agents/skills/licenses，不迁旧开发目录/历史/独立安装脚本/package。
- [ ] 新薄extensions/trellis.ts；集中最小地址接线，正确resourceRoot/actualentry/presetidentity/userproject，更新执行协议与references路径。
- [ ] 精选loader/context/task/dispatch/worktree/资源安全测试及fixtures到__tests__，明确MJS/Python发现/cwd，产品TS严格typecheck；不依赖neighbor或其Git历史。
- [ ] preset旧canonicalGit源改conflicts，rootmanifest唯一入口，sync.merge/dryrun/配置保护回归，不执行个人sync。
- [ ] license/provenance/资源currenthash联动保持，不改历史sourcehash，不复刻旧installer/history-only测试。
- [ ] 实际SDK/jiti入口、持久配置发现、adapter+composition公开RPC边界、ordinaryproject无自动部署验证；全preset检查。
- [ ] 独立check→主核最终diff/关键负例/自然退出与全量→主本地阶段commit，记录精确范围/hash。

## S2 初始化完整技能部署与旧项目补齐（A2/A5/A8）
- [ ] 增加skills完整资源库存及相对引用闭包，确认init计划展示目标；项目.pi/skills原生发现，撤旧动态resources_discover技能注入/virtualfilter。
- [ ] 初次同名未知技能/改动托管技能保护，安全更新未改文件、显式定制冲突，不touch无关/user级skills。
- [ ] schema3独立skills库存/last-published记录，精确schema2→schema3补齐计划，不扩大未知库存信任；template/role/runtime与skills状态分别诊断，skills定制不令Python运行时失效。assets bytes与文本验证分离，支持文件先于新SKILL.md、manifestlast，partial不伪原子保证。
- [ ] 初次未知同名skill保留整个root并报冲突，不拼混合内容；明确替换另确认且备份，不沿用adoption无备份替换语义。
- [ ] 在init/adopt/update的真实command owner移除自动ctx.reload，只给用户后续操作提示；actual projectloader覆盖根/子目录/worktree、trust/no-skills/旧包filter失效说明。
- [ ] 已知旧schema/release显式补齐计划，新增库存不任意放宽gate；锁下复核/逐文件原子publish/manifestlast/partialfailure保留，任务bindings/journal不改。
- [ ] SKILLreferences/developerworkflow/protocol/license路径迁后可达，必要技能支持资源全部部署；runtime/模板源与本仓spec区分。
- [ ] actualSDK projectskill发现/trust/no-skills/collision/disabled及重新发现步骤测试，当前session不自动reload。
- [ ] 新init、旧升级、invalid/symlink/path/manifest/source/modified/failedpublish全矩阵临时project；确认readonlycheck/启动零写。
- [ ] 独立check→主复验→精确stagecommit（源码/测试/相关hash一起）。

## S3 共享原生layout工具及Viewer首消费者（A3/A4）
- [ ] extensions/shared/scroll-panel/native-layout.ts集中actualhost解析/同实例/内部函数/frame/scrollbar/scroll行为校验；wheel.ts公开事件/几何/consume，无SDKcopy/globalstate。
- [ ] Trellis Viewer换共享接入，不改变既有选择/文档/刷新/读者安全与生命周期；旧native-layout实现不留重复接入。
- [ ] 第二独立consumerfixture证明基础工具不耦合Trellis业务；Memory/TaskPanel更新规划依赖owner，实际业务接线回各原任务。
- [ ] mountedOverlay真实SDK两mode有界nativeframe/headerfooter/full背景/bar、wheel正文/固定区/边界不穿透/selection独立，输入先paint/resize/theme/narrowUnicode，sharederror/failclosed能力负例。
- [ ] focus/ownedcustomonHandle/done/installtiming/shutdown恢复、provider0/files/index/pointer0副作用与自然退出；不把模拟当物理mouse。
- [ ] 独立check→主最终diff/自然退出/全量→精确stagecommit。

## S4 全面用户文档与规范提炼、最终整合（A1–A8）
- [ ] 中文docs/extensions/trellis主入口+主题页，完成零基础概念/全流程实例与预期行为/日常协作/更新排错，按design第7节，不因去重删学习细节。
- [ ] README/docsindex内置入口，去独立安装/旧provider/已删除refreshcollect/过时命令说明；runtimeconsumer协议路径另维护，不混用户说明。
- [ ] 英文development/testing提炼本仓新增安全/技能发布/internaladapter升级/精选测试方法，vendor/legal原文保留，不搬邻仓整spec树。
- [ ] 所有相对Markdown链接/anchors/SKILLref/role/manifest/资源hash/语言/whitespace/currentJSONL检查，完整产品不依赖邻仓目录或Git对象。
- [ ] isolatedexistingSDK pnpmcheck、memory已提交相关回归、Trellisfocusedsuite+Python自然退出、sharedlayoutmountedtests；准确区分PASS/FAIL/NOT_RUN。
- [ ] 独立最终审查→主复核→stage/finalintegration localcommit；新完整UI未实测物理mouse不宣全真机兼容。

## 精确验证接线（实施后按实际文件确定）
已有SDK解析及整个invocation临时agentDir，不下载依赖；mktemp路径realpath以免平台symlink拒绝误测。测试runner必须保留独立exit，不以最后命令掩盖前失败。
```sh
PI_SDK_DIR="$existing_sdk" PI_CODING_AGENT_DIR="$owned_agent" pnpm typecheck
PI_SDK_DIR="$existing_sdk" PI_CODING_AGENT_DIR="$owned_agent" node --test extensions/trellis/__tests__/*.test.mjs
PI_SDK_DIR="$existing_sdk" PI_CODING_AGENT_DIR="$owned_agent" node --test extensions/shared/scroll-panel/__tests__/*.test.ts
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
PI_SDK_DIR="$existing_sdk" PI_CODING_AGENT_DIR="$owned_agent" pnpm check
git diff --check
```
MJS额外preload仅在真实必要时按迁后host实例使用，不盲搬邻仓测试preload。rootfullglobs接入精选MJS与Pythonwrapper确保不漏跑；focused必须无force-exit。上述是计划命令，不是已跑或PASS。

## 额外动作与验收
- 真实PTY/Fullscreenwheel/Regular恢复需要主会话先列installedCLI+唯一tmux/tempHOME/project/session/offlineprovider范围并获批准，物理mouse与SGR注入分开记录。
- 本机旧包卸载/新包安装来源配置、当前项目init/update/apply、reload另列精确清单，不因测试自动执行。
- 用户计划删除邻仓，本任务不执行删除；最终可验迁后运行/测试在不引用neighbor的隔离checkout成立。
- 完成后由用户接受与授权finish，才archive/journal；不push/改历史/整树reset。只提交本任务hunks，不混Memory旧candidate、TaskPanelplanning或邻任务dirty。

## 规划状态
S1–S4尚未实施。新技能研究已整合，证据留存策略产品8fce55f已完成；仍等邻仓初始化诊断最终完成/明确pin与最后源码核对。额外旧加载来源兼容已被用户明确排除，无相关待确认决定。随后做PRD去重收敛及最终审阅；不能将草案存在当批准或验证通过。
