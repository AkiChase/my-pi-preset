# Research: 内置 pi-trellis 的迁移风险与实际所有者

- **Query**: 只读调查 `.trellis/tasks/10-15-builtin-pi-trellis`：将邻仓产品内置到 `extensions/trellis/`，薄入口 `extensions/trellis.ts`，复用 preset 安装/sync；识别双方包发现、资源/技能/角色、宿主加载、Python/runtime/provenance、测试与共享原生滚动接入的非显然风险，并核对新用户文档缺口。等待邻仓成果审查提交后按明确 commit 迁入，不复制 dirty 工作区。
- **Scope**: internal — 两仓源码、相关完整 owners/callers/tests、项目部署副本、已安装 Pi 1.2.0 SDK 源码；不执行产品、测试、安装、部署、真实终端或外部研究。
- **Date**: 2026-10-15

## Findings

### 观察基线：邻仓已推进，但尚不能选最终迁入 commit

调查开始邻仓 HEAD 为 `194d056`；期间新增完成报告/归档/journal，最后读取为 **`9920fbdd9ea47c3cfe6f27dfac20b2337ccf76f5`**。这是观察点，不是已经批准的迁入 pin，也不是全工作区冻结证明。

| 已完成产品 | 产品 commit | 完成依据 |
|---|---|---|
| 指令统一、无参数 init 原生菜单 | `5d3b4e472e26a8e32c2f63effb8f434ceefd77d2` | 已归档 `10-15-pi-command-unification`；菜单 Check 后续仍在改 |
| worktree source authority v2 | `9ec131f8328a830cb1566748cc67d651052d76e5` | recovery 最终报告 S1 |
| host/dispatch/source pointer 双根 | `176619d7fa7d140fd9209343c7c6b5b712f4bf6c` | 同报告 S2 |
| 角色/技能/模板/provenance 对齐 | `3d12127dbdbabcd1e2383d0117666b0427854d58` | 同报告 S3；期间已完成归档 `5b2a8b2` |
| Viewer 原生布局/滚轮 | `fbc298846cbaf9571b3e9156a92e25ff3bfa7702` | 已接受归档 `b1f9f06` |

依据：`../pi-trellis/.trellis/tasks/archive/2026-10/10-15-worktree-material-recovery/evidence/report.md:7–35`、`../pi-trellis/.trellis/tasks/archive/2026-10/10-15-task-viewer-mouse-scroll/evidence/acceptance.md:1–31`，及实际 `git log/status`。

**仍活跃**：`10-15-init-check-diagnostics/task.json:6,37–45` 为 `in_progress`，当前 dirty 产品有 `extensions/trellis.ts`、`lib/initialization/command.ts`、新 `diagnostics.ts`、init tests、README/initialization 文档；项目 `.trellis/.pi-trellis.json`、workflow 也 dirty。S2/S3 设计还涉及新 Python diagnostics、共享叶子消费者、runtime release 与有界子进程/worker；不能只捞当前 S1 文件拼成“完整诊断”（其 `design.md:1–20,118–175`）。`10-15-evidence-retention-policy/task.json:6` 仍 `planning`，若以后实施会改包模板/角色/技能/dispatch 文案及三个 baseline，而不是直接改项目部署规则（其 `prd.md:19–43`）。

### Files Found / 主要所有者

| 邻仓 package source | 本仓对应接线/消费者 | 职责与危险交叉点 |
|---|---|---|
| `extensions/trellis.ts` | 新薄 `extensions/trellis.ts`；根 `package.json` | 注册、session 身份、上下文、条件发现；不是独立 provider |
| `lib/initialization/{engine,resources,adoption,command}.ts` | `extensions/trellis/` 内资源 owner | 包资源 → 项目 `.trellis/scripts` / `.pi/agents`，发布 manifest 最后写 |
| `lib/adapter-resources.ts` | 根 `package.json`、`scripts/pi-manifest.test.mjs` | installed package identity、薄入口身份、条件 skill inventory/filter |
| `lib/{task-context,worktree-query,bindings,executions,source-executions,subagent-rpc}.ts` | `extensions/task-composition.ts`、`extensions/agent-tasks/src/` | native authority、RPC、持久 child 加载与占用；保持公开契约 |
| `runtime/`、`resources/*-baseline.json`、`agents/`、`skills/` | 插件内部资源树，不能取本仓 `.trellis/.pi` 代替 | 源码/当前 hash/历史 hash/项目逻辑路径分离 |
| `lib/task-browser/{native-layout,component,command}.ts` | `extensions/memory/{panel,command}.ts`、`extensions/task-ui/{panel,owner}.ts` | 共享的是宿主布局/geometry/wheel seam，不是面板业务 |
| `tests/{host-tui,runtime-fixture,worktree-fixture,provider-contracts}.mjs`、各 `*.test.mjs` | 根测试 scripts 与插件 `__tests__` | discovery、cwd、历史 Git object、真实 SDK identity、自然退出 |
| `scripts/{deploy-worktree,patch-trellis}.py` | 本仓 `install.sh` / `scripts/sync.mjs` | 前者目前是旧兼容/fixture 支撑，不是主初始化/安装链 |

## Code Patterns / 高价值风险

### 1. 必须分离「preset 包根」「插件资源根」「实际薄入口」「执行项目根」

原来的 `packageRoot` 同时当 filesystem resource root 和 Pi installed package identity：`engine.ts:10,85–136`、`adapter-resources.ts:15,26,48`。此外 `extensions/trellis.ts:221–223` 的 `packageDir()`、`worktree-query.ts:130` 各自按 `import.meta.url` 向上找根。维持 `lib/initialization` 的相对层级可能让某个 root 计算偶然正确，却不能让四种身份自动相等。

- 资源应读插件内部 `runtime/resources/agents/skills`；Pi 包 identity 必须是根 `my-pi-preset`。
- `adapterConfigured()` 必须匹配宿主实际登记的**顶层薄入口**，不能拿内部实现入口与资源 paths 比较。否则持久设置正确也会拒绝 dispatch。
- `renderOverview(...protocolPath=join(packageDir(),"docs/worktree-execution.md"))` 是**模型运行时会读的协议路径**，并非可随用户 docs 精简而删的普通链接（`extensions/trellis.ts:584,634–641`）；该路径、包内技能所说“session overview 的 protocol”必须有迁后有效 owner。
- Python 初始化 skeleton 从资源 runtime 导入，host query 从资源 runtime 启动；日常 task/get_context 执行的是**项目部署脚本**（`engine.ts:279–287`；`extensions/trellis.ts:171–176,255–285`）。不要统一成“所有 Python 从 preset 插件目录执行”。

**建议门**：移动前明确这四个地址的 owner；搬迁 stage 同时改真实 loader/readiness/skill/protocol tests，不只改相对 import。

### 2. 嵌套技能的 inventory 是实质架构风险，不能只改字符串前缀

现有条件技能依赖一个特殊组合：邻仓根 manifest `pi.skills: []` 避免普通项目自动暴露技能，而目录 `skills/` 仍让 Pi 的 package filter 看见候选；`projectSkillPaths()` 用只读虚拟设置补 `skills/**/SKILL.md`（`adapter-resources.ts:22–48`；`tests/skill-resources.test.mjs:18–75`）。

实际 Pi 1.2.0 `dist/core/package-manager.js:1934–1948`：manifest skills 为空时，**filter 的候选集退回 `packageRoot/skills`**。若迁后仅有 `extensions/trellis/skills`、根 `pi.skills: []`，该候选集为空；改 virtual patterns 为嵌套路径也无法发明候选。直接在根 manifest 正向声明嵌套 skills 又会让普通/无效项目静态加载技能。给声明加 blanket exclusion 也不是当然解决方案：`collectManifestFiles()` 已先按 manifest patterns 删除候选，后续包 whitelist 无法恢复被删掉的候选（同文件 `548–591,1903–1948`）。

此外若错误把 `packageRoot` 改为资源根，`own installedPath` 匹配为空，当前代码会走无配置 fallback，**绕过真实包 filter**。

**必须保留的语义矩阵**：未初始化/坏 runtime 不自动发现；valid clone 缺身份仍发现；普通 `skills: []` 禁用；autoload:false 空 delta 不禁用；排除/加法/白名单；user/project 同字面 local source 的不同 identity；trust；one-shot extension 可发现但不得声称持久 adapter；显式静态资源与 `--no-skills` 保持宿主语义。现有完整 actual-host tests 在 `project-activation-host.test.mjs:11–108`。

这是需要 main 在设计中解决的**候选资源目录与公开 resolver 接线门**，不是用户再选一次默认行为，也不是加一个嵌套 `package.json` 就会被根包自动扫描。

### 3. 不需要第二份可安装 package metadata，但很多测试误把资源根当包根

实际宿主从根 manifest 展开 `extensions/*.ts`；嵌套 manifest/`index.ts` 只在 auto-directory discovery 时才可能成为 extension（SDK `package-manager.js:381–457,1848–1871,1962–1973`）。本仓根声明可保持单一薄入口，无需单独 Trellis package 的 name/version/scripts/peers。

删除邻仓 package metadata 会使**现有测试假设**失效，而非让 `.ts` loader 自动坏掉：`skill-resources.test.mjs:19,77–81` 读 `packageRoot/package.json` 并在该 cwd 做 pack；`agent-documents.test.mjs:121–134` 检查独立 package license/README；`provider-contracts.mjs:39–74` 将 repository/resource/provider roots 与 package version 混用。将这些改为准确根包 identity + 独立资源 closure/来源断言，不能为了让测试原样绿而恢复第二套安装器/包。

**新增检查点**：根 manifest 的唯一入口；plugin root 的完整资源清单；发布闭包含全部 runtime/templates/skill references/roles/MIT+AGPL 原文，同时不依赖项目 `.trellis/.pi`。

### 4. relocation 若改写 manifest 的逻辑 `source`，会阻断所有旧项目安全更新

`engine.ts:121–156` 把项目 source 记为 `runtime/<file>`、`agents/...`、`resources/templates/...`，执行 gate 要求 exact release/hash/mode/kind/source；`resources.ts:21–35` 的 oldManifest 更新入口也要求 exact inventory 与 **`r.source===expected.source`**。

因此物理资源移到插件内部时，把已部署 manifest 的 source 改成 `extensions/trellis/runtime/...` 会令旧项目连“安全 Update project resources”都进不去。物理资源根与上述逻辑相对路径需要分离；不要为了迁文件另起 schema/release、手改项目 manifest 或放宽 gate。

当前包有 **33** runtime files，SHA-256 与 package baseline 相符，release 为 `pi-trellis-runtime-v1-c40917c03bf8fadb57d27dfaee0e922eabdd282d9c10abebb467620c98d3c90c`。本仓**部署** manifest 为旧 release `...9ba397e06aa3c7ef234e9c54bd8a5cd04a0f903a043fc7d1e60d493c58c36467`，4 个 native runtime 文件与新包不同。只读比较不是故障修复授权；测试必须用 initializer 的 disposable fixture，不能拿本仓部署状态“补齐迁移”。

新增诊断 Python 会改变 inventory/release，当前 oldManifest 不支持任意 inventory 增删；应等邻仓自己的完整升级契约审核后迁入，而非由本任务预先弱化校验。

### 5. provenance 测试依赖邻仓历史 Git object，普通复制会丢失其证据

`tests/runtime-contracts.test.mjs:222–234` 对 7 个 MIT native 原始文件运行：

```js
execFileSync('git', ['show', row.sourceRevision + ':' + row.sourcePath], { cwd: resolve('.') })
```

历史 revision `9af75d2f52f78ee932bb31563cc29fe7ce5a9b73` 在本仓 `git cat-file -t` **不存在**；sourcePath 仍是旧 `python/...`，它不是当前运行时路径。七份原始 bytes 总计约 82 KB，在邻仓历史可读取；这属于必要可复核 provenance 原件，不是大型任务证据/临时 fixture。

**建议**：迁入明确 commit 的来源记录 + 有界、不可变的必要原始材料，让测试不依赖邻仓存在或借导入整个历史来过关；不要改历史 hash 为当前输出、删除 original-byte 断言、伪称 SHA 值本身证明取得过原文。

保留邻仓 `LICENSE` 的 MIT copyright 与 `licenses/trellis-AGPL-3.0.txt`；runtime Trellis **0.6.16**、角色 **0.6.17/claude/2026-10-12**、skills/template 的 AGPL 来源分别记录（`runtime-baseline.json:1–50,257–325`；`agent-baseline.json:1–19`；`template-baseline.json:4–60`）。资源/角色引用里的 README/license 包定位若改文字，会联动 adapted/output hash；历史 source hash 不变。不要把“单仓维护”误写成“全仓原创/MIT”或机械给所有既有 preset 文件换许可。

### 6. SDK `import.meta.resolve` 目前不是已证实坏点；host family 和 module identity 才是边界

原 native seam 已主动使用 `import.meta.resolve('@earendil-works/pi-tui')`，验证解析导出的 ScrollView/VStack 与 public import **同实例**，再加载相邻 `layout.js`；不是只检查函数存在（`native-layout.ts:28–81`）。

本机 SDK 1.2.0 loader 分别处理 unbundled Node aliases、source TS、embedded/virtual modules，且每 graph `moduleCache:false`（SDK `extensions/loader.js:33–84,461–481`）。已安装 jiti `dist/babel.cjs:242` 将 `import.meta.resolve` 转换为 `jitiESMResolve`，runtime resolver 会应用 aliases。现有未 preload 实际 SDK 两种 mounted 模式测试专门防“测试 import identity 正确、真实 host graph 不同”（`task-browser-ui.test.mjs:797–805,870–905`）。因此**不能凭 Node require/import 差异断言现有 adapter 已坏，也不能仅凭 Node tests 宣称迁后 host-safe**。

共享源文件不意味着跨顶层 extension jiti graphs 只有一个模块局部 `loaded` Promise；维护 seam 集中与运行时全局 singleton 是不同要求。别为“共享”引入 process-global panel/session/controller；必须验证各入口仍对当前 mounted host 实例校准。embedded/binary/source-ts 家族的相邻 layout.js 是否可访问，本轮未验证；能力不足应明确拒绝，无 SDK 修改/renderer 复制/静默 fallback。

### 7. wheel 与 frame 接线不能抽成业务通用面板

已完成 Viewer 的几何/滚轮逻辑并非全在 native-layout：`component.ts:174–191,327–373` 先为快速输入分配 stale frame、使用 active ScrollView clip，仅正文调用标准化 wheelDelta，但标题/底栏/边界 wheel 都 `handled:true`，避免主 transcript 穿透。命令 overlay 100%/top-left/margin0（`command.ts:27–35`）。Regular 本就不捕获鼠标；Fullscreen 才走真实 host mouse route。

共享提取至少考虑 capability、frame/clip/scrollBox、input-before-paint/resize、wheel consume；不要复制 selection/tree/filter、业务 refresh、读取/CRUD 或 modal 生命周期。Viewer `ensureInputFrame()` 当前以整 terminal columns/rows 为几何来源，**只能在其 full-window 约定下直接复用**；Task Panel 当前 90%×70% center overlay，不能机械复用整 terminal dimensions（本仓 `task-ui/owner.ts:58–77`）。

本仓 Memory 候选 `panel.ts:56,148–169` 使用 hidden ScrollView、updateLayout+手工 slice；Task Panel `panel.ts:31,99–145` 同样手工 slice/双栏且有 follow:end。它们不是可作为已验收 native layout 基线的实现。Memory `command.ts:58–78` 的 onHandle cancellation 防止 setup 期间关闭其他 overlay；Task UI coordinator/lifecycle/timer/follow 与业务源继续各自拥有。共享错误文本应可由消费者包装，避免所有插件出现“Task viewer unavailable”。

### 8. 不能把 Trellis dispatch 与 composition 合并成两个 provider/第二个工具集

本仓 `task-composition.ts:18–38` 唯一组装 process/agent backends、task_manage 与生命周期；Trellis 只用公开 `subagents:rpc:*` 和 terminal events。`subagent-rpc.ts:109–155,170–252` 仍要求实际 process.cwd/ctx.cwd 为 source、源/target 持久 adapter、兼容 `.pi/agents`、in_progress、source lock、原 ID；stop 只是请求，unknown 保守保留。

角色发现**不会自动扫描插件 `agents/`**：`agent-tasks/src/custom-agents.ts:25–55` 从 execution config 的 global/.agents/.pi 读；factory 又从实际 process.cwd reload（`index.ts:459–469,748–751`），runner 将 configCwd/effectiveCwd 分离（`agent-runner.ts:697–701,827–842`）。Trellis publication 才把角色放项目 `.pi/agents`。不要以“builtin”名义 startup 自动部署、改自定义角色、透传私有 configCwd 代替持久配置。

probe 的 `--preset` 当前只允许 adapter + **task-composition** + offline fixture，不是同时加载 standalone agent backend；还有 exact tool 数量/旧名缺席断言（`provider-contracts.mjs:44–50,279–291`）。迁后若基准扩成整 preset，额外独立插件命令/skills/config读取会使原 `project-activation-host` 的 exact arrays 失效，应分清 adapter-focused loader 与 full-preset integration，两者都需要，而非删掉唯一性断言。

### 9. 测试默认会静默漏跑，cwd 与 env 又会制造假失败

邻仓默认 `tests/*.test.mjs` + `--import tests/host-tui.mjs`；本仓仅 `extensions/**/__tests__/*.test.ts` / `scripts/*.test.mjs` 且 full suite force-exit（两仓 `package.json`）。原样把 `.mjs` 放插件 tests/目录不会进入 `pnpm test`。改成 `.test.ts` 会新增本仓 strict 类型检查范围：邻仓没有 tsc gate，直接 Node TS execution 不是静态类型通过。

需要显式接线 TS/MJS gate、自然退出 focused gate、Python suite。`python-worktree.test.mjs:5` 硬编码 `tests/python` 与 repository cwd；`tests/python/test_worktree.py:9` 的 parents[2]/runtime 随安置改变。`runtime-contracts`、`workflow-policy`、`manifest-provenance`、`trellis-patches` 还有大量 `resolve('runtime')`/`readFileSync('resources/...')`/`skills/...` 包 cwd 假设。

`installRuntimeFixture()` 用真实 initializer/hash，只删 bootstrap task（`runtime-fixture.mjs:9–13`）；不能改成 cp 项目 deployed bytes + fabrication manifest。要隔离整个 suite 的 agent dir/既有 SDK，子进程按需要 unset TRELLIS_CONTEXT_ID，不修改 live host 环境；root import 已在 `extensions/trellis.ts:99` 捕获 pin。现有本仓 link-sdk 会写 checkout node_modules，本轮未执行。自然退出不能被本仓 force-exit PASS 代替。

### 10. 必要脚本、测试支撑与可丢弃基础设施须按调用闭包分类

| 类别 | 事实与处理建议 |
|---|---|
| 必须产品 | 全 runtime import closure、模板 12 文件/8 托管 template targets、3 roles、10 skills/36 skill documents、baseline、许可；`engine.ts:121–136,237–245` 和 closure tests 为依据 |
| 唯一安装 | 保留本仓 `install.sh:31–104` → dependency-free sync；不迁入邻仓 `scripts/install.sh` / installer 测试部分。安装与 `/trellis-init` 项目发布分开 |
| 当前 test 支撑 | `scripts/deploy-worktree.py` 被 `tests/preparation.test.mjs:34` 用于 tiny negative-control fixture；不是产品 TS/runtime 调用。删除需同时用正确 fixture owner 替换，不能让prepare负例消失 |
| 历史 patch | `scripts/patch-trellis.py` 只被 `trellis-patches.test.mjs:8–139` 使用；现固定 runtime 已持有修复。它不是 init/update 或来源许可必须品，可选择删除历史功能及专属测试，但需要明确 scope，不默认移植所有 scripts |
| 不迁入 | 项目 `.trellis/.pi`、journals/tasks/archive、旧 `.version/.template-hashes`、TESTING.md重复指南、.DS_Store、个人 runtime/node_modules/临时 evidence |
| 不应误删 | 当前 offline contract tests 约 548 KB，34 tracked files（观察时含 Python/helpers，另有 dirty diagnostics test）；大样本文档多在临时 fixture 由字符串生成，不是外部下载数据包。最大的 1.2 MB 文件是历史 task research JSON，不是产品测试 fixture |

pack closure tests目前只断言“应有文件存在”，没有证明整个 `.trellis` developer tree被排除（`skill-resources.test.mjs:77–81`、`runtime-contracts.test.mjs:166`）；根 metadata 无 files allowlist。Git install 本身保留仓库 checkout，**加载资源清单与 tarball发布内容并非同一概念**。有选择迁源码，不借“瘦发布包”默认删除本仓开发基础设施。

### 11. source authority、外部 task store 与 runtime/hash 不是同一种 containment

`task-context.ts:20–45` 可识别明确顶层外部 task store；native `materials.py:26–62` 对 source material 更严格，只允许 `.trellis/tasks` 本身这条 symlink route，不允许内部任意 symlink。source authority 四行头只是语法，child 还比较 native binding/path/fingerprint；target 的旧 `.trellis` 不能变成 fallback（`extensions/trellis.ts:779–844,1098–1121`）。

初始化 `checkedPath()` 的严格本地资源发布规则不应替代 external source-task 材料校验；反之 task-store 外部例外不可扩散到 runtime、sessions、bindings、role文件或任意 source references。迁目录时不要顺便把多个类似 validator 合成“通用允许symlink解析”。完整角色 isolated/read scope与 selected-role invalid-reference隔离保持；主维护 source 生命周期，resource移动不重写 task pointer、binding v2、旧activation。

## Documentation Gaps / 对最终中文入门文档的事实约束

用户最新 PRD `R6/A7` 已要求**全面新用户教程**，不是压到一个短命令页。本轮只识别缺口，不写产品 docs。

1. 邻仓 docs/index 当前仅初始化/派发/worktree/viewer/display，README基本使用只列三个 skill 与浏览器。**没有把 spec、task、PRD/design/implement、规划绑定 vs start、分stage check/commit、resume/finish 连成带预期结果的教程**（`docs/index.md:5–11`；`README.md:64–85`）。应以发布 workflow 的 Phase 1/2/3、skills和真实 CLI为依据，而非让新人先懂 upstream。
2. 教程要解释三种易混状态：init 创建 onboarding task但**不选 current**；普通 task create 在有效 session 下**绑定 planning pointer但不start**；start 设 in_progress/分支并可能跑用户 hooks（`engine.ts:284,434–446`；`task_store.py:602–652`；`runtime/task.py:174–265`）。浏览不会绑定；deactivate不完成/归档；task父子不是依赖调度器（`resources/templates/workflow.md:58–59`）。
3. 明确默认阶段检查必需、独立review按风险选择、main局部commit不等于子角色可commit；实现批准与建task/finish授权不同。**模板 config 实际 `session_auto_commit:false`**，而未配置 runtime getter默认true（`templates/config.yaml:4`；`runtime/common/config.py:25–28,121–140`）。新人不能被“默认生命周期自动提交”泛称误导；阶段产品checkpoint和journal/archive自动commit是两套行为。
4. 现 README 仍推荐单装 `@tintinweb/pi-subagents`（`README.md:33,39–44`），与本仓 composition conflicts矛盾；`README.md:23,97` 和 `docs/index.md:7` 仍说同步/收集材料，已被source-only v2删除。迁后安装来源一律从preset入口解释。
5. runtime `task.py:259` 仍输出“hook will now inject ... jsonl”，与新路径只读协议不符；属邻仓遗留运行时用户文案。要记录而非在教程复述，若获批修改该文案须联动 runtime hash/release，不能只换源码字符串。
6. `docs/task-display.md:16` 链接 `README.md#where-the-task-display-goes`，实际README无该anchor；`extensions/trellis.ts:584` 的worktree协议路径是更强的运行时consumer。角色 README/license定位、技能内部references同样需最终按真实路径核验，不批量改历史task引用。
7. init Check正在变化：committed旧版是资源事实清单，dirty当前是**静态有限诊断**、runtime/effective配置/worktree probe尚未完成（`command.ts:11` 与 active diagnostics设计）。最终教程按pin后的实际能力说明，不把新S1宣传成完整health pass，也不把旧`--check`重新写成有效参数。
8. troubleshooting需可操作图区分：无task正常、task_error、bad runtime只留init、modified角色安全更新冲突、manifest-less adopt无备份替换与template有备份替换、source unknown无recover命令、managed recover需owner死证据、remove需clean+保存提交引用。两仓现有中文初始化/dispatch/worktree页有可用细节，宜重组扩展而非删掉风险提示；开发内部schema/测试教程继续英文spec。

## Proposed Sequencing / 仅供 main 综合的依赖顺序

不是最终 design/implement plan，也不构成实施授权。

1. **基线门**：等active邻仓review/commit；重新看status、各stage完成边界、最终source authority/native/diagnostics/template baselines，再选明确pin；为policy等未实施任务记录接续归属，不复制其dirty材料。
2. **迁移闭包门**：先解决四根identity、嵌套skill inventory、Git原始来源证据、test cwd/globs与实际薄入口；产品/resources/必要tests/hashes共同检查点，暂不抽业务UI或部署用户项目。
3. **共享seam门**：以已完成 Viewer为首消费者抽 capability/frame/geometry/wheel，保持行为负对照；验证真实host graph与mounted两模式，再让Memory接入。TaskPanel业务留原task，只有同owner基础引用/必要接线属于本scope。
4. **整合门**：根manifest与冲突规则、完整新用户docs和英文spec合同、runtime protocol/skill/license路径一起核；adapter-focused与full-preset offline实际SDK回归分开，focused自然退出保持；需要PTY/物理/安装/个人sync/reload另申请授权。

## User-Owned Questions / 仅范围与交付决策

- 尚在planning的**证据留存策略**是否也是“迁入前必须等完成”的前置，还是迁移后由本仓承接？它会触碰与搬迁相同的角色/skill/template/provenance owners，需明确handoff，不能默默由迁移替它实施。
- 对旧独立包的**非canonical来源**（npm:pi-trellis、手动local checkout、one-shot -e、项目级包/旧skill filter路径），首次迁移是否只要求诊断与用户手动处理，还是也批准专门兼容范围？现sync的canonical Git conflict能覆盖URL/ref变体，但**不等于**能自动移除同名npm/local/project来源。根`packages`域只reconcile用户scope（`scripts/sync.mjs:453–550`）；实际安装/卸载仍需后续授权。

不需要再问插件目录、独立安装器、中文docs详细度、默认共享目录与托管边界、或“是否可复制dirty”——用户已决定。资源resolver实现、fixture接线、hash修复是工程设计工作，不转嫁为用户选择。

## Related Specs / External References

- `.trellis/spec/development/index.md:7–16,57–93`：单包/显式resource发现、host peers/no-build、用户docs/英文spec、安全sync与provenance。
- `.trellis/spec/testing/index.md:7–49,83–95`：根suite globs、自然退出、实际SDK与隔离、研究输出职责。
- `../pi-trellis/.trellis/spec/development/index.md:9–65`：package source vs deployed、source authority、发布/provenance与绑定。
- `../pi-trellis/.trellis/spec/testing/index.md:9–91`：host preload/env、fixtures、native/host/provider分层。
- 本机既有 `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/core/{extensions/loader,package-manager}.js` 与 jiti 变换：仅实际检索的本地SDK依据，不是外部文档或新版兼容承诺。
- **External research not performed**：请求限只读本地调查，无下载/联网必要，也未调用外部search。

## Caveats / Not Found

- 两仓有并行改动；文中dirty行号仅是2026-10-15调查观察，final pin时必须重核。历史报告的PASS来自已读取的报告，不是本轮新验收。
- 本轮未运行测试/typecheck/pack/产品Python/initializer/worktree管理、provider、PTY、install/sync/reload或task start/lifecycle；只做源码读取、Git只读查询与必要bytes/hash比较，未修改产品/规划/部署状态。
- 未取得上游Trellis原始28文件/Claude角色源artifact的新独立验证；metadata历史hash与合法原文保留不能替代未取得的上游完整性证明。七份native Git originals可检索，但本轮未落地它们。
- 未确定嵌套条件skill inventory的最终公开SDK方案；已证明现有虚拟settings+仅改prefix不足。不得把此开放工程门写成已解决。
- 未声称移植后strict类型通过或跨embedded/binary/source-ts SDK家族成立；实际mounted测试仅作为源码中的必要门。物理鼠标、在线模型和自主agent合规仍未验证。
