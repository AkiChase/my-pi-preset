# Research: 项目技能完整部署与显式旧库存补齐

- **Query**: `/trellis-init` 从 builtin `extensions/trellis/skills/` COPY 完整技能目录到项目 `.pi/skills/`；调查现有初始化/接管/更新/schema/baseline、Pi 原生 trust/禁用/碰撞、技能引用闭包与旧 schema2 项目显式补齐策略。动态 `resources_discover` 候选库存方案已被用户新决定覆盖，不再研究其 workaround。
- **Scope**: internal — 邻仓完整相关初始化 owners/callers/tests、36 个技能文件的库存/引用核对、已安装 Pi 1.2.0 源码及随包文档；只读源码/Git/字节核对。不执行产品、测试、安装、部署、reload、task start 或提交。
- **Date**: 2026-10-15

## Findings

### 当前观察点与并行归属

邻仓 HEAD 为 `ad2187bc973d19b80aaf34adbee3e6ad2a81118c`（Check **S1 静态诊断**）。`10-15-init-check-diagnostics/task.json:6` 仍 `in_progress`；S2 正在修改 engine/diagnostics、增加 `provenance-reader.ts`、`diagnostic-{bootstrap,runner}.ts`、`runtime/diagnostics.py` 及配置叶子。下文区分 **ad2187b 固定行号** 与 **S2 dirty 观察行号**，不能把后者当已审阅迁入 pin。

证据留存任务已归档并 `completed`：`../pi-trellis/.trellis/tasks/archive/2026-10/10-15-evidence-retention-policy/{task.json:6,implement.md:8–20,45–69}`；产品 `8fce55f` 已改 workflow 模板、check/finish 技能和两个对应 baseline，未改 agents/runtime/部署副本。此前研究称它仍 planning 的结论已过时。本研究不接管/清理邻仓历史材料。

### Files Found / 高风险完整 owners

| Owner（均为 `../pi-trellis/`，除 Pi 行） | 相关职责 |
|---|---|
| `lib/initialization/engine.ts`（ad2187b:18–35,120–183,294–389,393–499） | manifest/action 类型、固定库存、exact runtime gate、canonical 输出重建、init/identity/retry；加一个复制循环不足 |
| `lib/initialization/resources.ts:21–112,126–207` | 旧库存 exact 校验、未修改更新/缺失修复、全操作 conflict、lock/re-preview/manifest-last、显式模板替换及备份 |
| `lib/initialization/adoption.ts:15–69,76–116` | 无 manifest 接管；当前所有 `files` 都按 runtime/role 无备份 Replace，不能把新 skills 无条件加入这个替换循环 |
| `lib/initialization/command.ts:29–109,159–211` | 摘要范围、菜单可用性、conflict 分支、确认、完成通知；init/adopt/update 当前均自动 `ctx.reload()`，新需求必须改此 owner |
| `lib/initialization/diagnostics.ts`（ad2187b:126–214,344–366；S2 dirty:125–180,324–340） | envelope kind/schema 白名单、fixed inventory 与 operation action、预算/诊断分类；S2 正在合并 provenance 读取 |
| S2 dirty `lib/initialization/{engine.ts:85–100,128–195,provenance-reader.ts:5–13,diagnostics.ts:80–110}` | `PackageProvenance` 与共享 reader；当前 **file() 强制 UTF-8/无 NUL**，未来 binary assets 不能直接复用为 text |
| `resources/{runtime,agent,template,skill}-baseline.json` | runtime release 只由 Python hashes 算；skill baseline 当前只是源码/许可指纹，**没有部署路径、mode、库存版本** |
| `extensions/trellis.ts:221–223,584,634–640,1063–1079`、`lib/adapter-resources.ts:19–49` | on-demand 协议路径、将删除的动态技能注入；保留 adapterConfigured 的真实包身份职责 |
| `skills/trellis-meta/references/`、`resources/templates/{agents-block.md:6,workflow.md:137–139,spec/index.md:6}` | 现存“skills 从 package 加载/不能改 package skills”等文字，需要随新部署职责修订 |
| `tests/{initialization,init-review,manifest-provenance,resource-update,adopt-project,apply-template,skill-resources,project-activation-host,init-command,init-diagnostics}.test.mjs` | 既有 safety/retry/真实 loader 负例；当前断言 `.pi/skills` 不存在、只 runtime+3 roles、动态注入等均需按新合同替换，不是删除安全用例 |
| Pi 1.2.0 `dist/core/{package-manager.js:207–276,704–744,1990–2064,2117–2135,skills.js:126–262,320–412,resource-loader.js:349–428,624–644,agent-session.js:1697–1710}` | 原生发现、precedence、trust/no-skills、技能目录相对引用与按命令重新读磁盘 |

Pi 绝对包位置：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/`。以上可经本仓 `node_modules/@earendil-works/pi-coding-agent/` 读取。

### 1. 现有部署边界与旧项目失败点

当前 `InstalledManifest` 是 schema2：`files` 仅 `kind: runtime|agent`，`templates` 独立含 `package-default|preserved-project`；`FileAction` 另含 identity/workspace/task/root/manifest。runtime/roles 属于固定包资源；workflow/config/spec 属于可编辑文档。`verifiedManifest()` 只比对 **runtime 磁盘 bytes/mode**，角色定制本身不使 runtime 失效（ad2187b engine:139–183）。

```ts
// resources.ts:25–28，更新入口不是通用迁移器
if (Object.keys(m.files).sort().join() !== Object.keys(expected).sort().join()
 || Object.keys(m.templates).sort().join() !== Object.keys(templates).sort().join())
 throw new Error("Unsupported resource inventory; explicit reconciliation is required");
// 每个 r.source / r.kind 仍必须等于 expected。
```

因此直接把 36 个技能文件加到 `packageResources()`：旧 schema2 的 runtime gate、Update、菜单 fallback 都失败；**Adopt 也拒绝任何已有 manifest**（adoption:18）。新技能须有明确可识别的旧→新库存 transition，不能用“允许任意缺少/未知 entries”解决。物理 root 移动不要求改旧 `runtime/...`、`agents/...`、`resources/templates/...` 逻辑 source；保存这些值避免额外 provenance 断裂。

当前新 init 遇任何已有非 root 文件即报 collision，甚至相同 bytes 也不会自动认领（engine:413–418）；恢复只能接受 canonical package outputs，不能信任 operation 中自报 hash（294–340）。identity 分支只补身份/workspace/onboarding，不部署资源（393–446），所以“已有 clone 设身份”也不是技能补齐入口。

更新仅在实际 bytes/mode 等于已记录旧 baseline、或目标缺失时写；任一 modified `files` 会阻止 **整个 apply**。templates 修改后转换为 preserved；preserved 删除后也不自动重建（resources:48–64,101）。adoption 与显式 Apply template 是不同的破坏性授权：前者 runtime/role 无备份 Replace，后者只 workflow/spec且先备份。技能不能伪装成 `kind:runtime`，也不能只放进现有八个模板 targets 而漏 scripts/assets。

**已存在的细节**：runtimeReleaseId 不包含 roles/templates/skills；包只更新 workflow hash（例如留存策略）后，旧 `package-default` manifest 的 exact template fingerprint 仍会使 `verifyRuntime()` 拒绝，尽管 resourcePlan 能显式更新。新增 skills 不应继续把独立技能版本/定制耦合为 Python execution failure。

### 2. 技能闭包：当前完整且可复制，但语义文案要改

只读遍历并逐文件 SHA-256 比较：**10 个 skill roots / 36 个 Markdown 文件 / 76,718 bytes**，均 regular file、mode `0644`、无 symlink、与 `skill-baseline.json` 的 keys/hashes 完全一致。组成：10 个 SKILL.md、meta 的22个 references、spec-bootstrap 的4个 references。当前 **没有 scripts/ 或 assets/**；需求仍要覆盖以后新增的完整 regular-file tree，不把“今天全是 Markdown”写成永久格式限制。

实际 Markdown 链接全在各自 skill directory 内且存在，无逃逸 `../` 链接/包外文件路径。`trellis-meta/SKILL.md:8–32` 和 spec-bootstrap:20–25 的 references 可原路径复制，Pi 的 `baseDir` 会自然变为项目 skill directory，不需要包根兼容层。

但技能中的 `.trellis/scripts/...` 命令是**项目/source root 相对**，不是 skill-local supporting file。start/continue footer和其他技能 Pi Execution Boundary 已明确区分；Pi 默认 system prompt 及 `/skill:` wrapper 都说相对路径从 skill directory 解析（skills.js:279–295；agent-session.js:1709）。新说明须保留/澄清：`references/scripts/assets` 是 skill-local；`.trellis` 是 source/project material root；`.pi` 仍 execution project scope，不能把 CLI 拼成 `.pi/skills/trellis-start/.trellis/...`。

需要改变而不是机械复制的 docs：meta `local-architecture/{bundled-skills,generated-files,overview}.md`、`platform-files/{overview,platform-map}.md`、`customize-local/{overview,change-skills-or-commands}.md`、agents-block 和 initialization docs。尤其 bundled-skills:3 当前明确 “Skills load from package pi.skills, not project copies”，新合同相反。只更新对应输出 hashes，历史 source hashes/license 不改。

**worktree protocol** 并非技能内部失效链接：`renderOverview()` 明确给模型 absolute `packageDir()/docs/worktree-execution.md`，skills/start/continue 只要求读 overview 引用。复制技能不会自动复制这个文档；迁入后须保留一个稳定包内 protocol owner并重接 absolute path（或明确纳入单一部署 reference owner），不能删除邻仓 docs 后留 missing path。不要复制整棵用户 docs；该文档目前自己含 dispatch.md 相对链接，若移作独立运行协议也须修其闭包。

### 3. Pi 原生加载合同（源码观察，不是本轮实际 host 验收）

- `DefaultPackageManager` 只自动发现 **cwd/.pi/skills**；与 `.agents/skills` 沿 ancestors 扫描不同（package-manager:291–311,2017–2039）。Trellis init 会向上找 project root，所以从 project/src 启动、或未包含新技能的旧 worktree base，**不保证根 .pi/skills 自动出现**。不新增动态 fallback/同步；须在说明和真实 loader 回归中覆盖 execution cwd/已提交 clone 情况。
- projectTrusted=false 时不加载项目 settings或 auto `.pi/.agents` skills；用户资源仍可加载（settings-manager:257–260；package-manager:2024–2053）。init 原生确认 **不等于授予 trust**；不要写 trust.json 或强制 trust。noSkills 禁用自动/配置资源，显式 `--skill` 或 CLI package skills仍按 Pi 合同加载（resource-loader:424–428；随包 docs/cli.md:200–203）。
- project top-level `skills` override 才管理项目副本。`skills: []` 在这里 **不禁用 auto discovery**；可用 `!skills/trellis-*/SKILL.md` 或精确 `-skills/trellis-check/SKILL.md`（相对项目 `.pi`；package-manager:473–539,1998–2039）。旧 package entry 的 `skills:[]`/autoload delta 不再控制新项目文件，也不能自动转换设置或声称旧过滤仍生效。
- precedence：project explicit → project auto → user explicit → user auto → package（package-manager:51–72,2117–2135）；CLI explicit 在 resource-loader:424–426 前置。重复 realpath 静默去重，但 **复制品 realpath 不同**，同名保留 first 并产生包含 winner/loserPath 的 collision（skills:326–351）。项目副本通常盖过旧包/用户技能；同 scope 文件顺序不应作为冲突策略。不得默默覆盖同名目录或删除外部/用户资源。
- 每个有 SKILL.md 的目录作为一个 root并停止下钻，所以 references/*.md 不是额外技能（package-manager:207–270、skills:126–205）。`.gitignore/.ignore/.fdignore` 从扫描目录添加规则，可能隐藏 skill；不能为完成 init 自动改用户 ignore。
- `enableSkillCommands:false` 仅控制 command discovery，手输 `/skill:name` 仍可运行；`disable-model-invocation:true` 仅隐藏自动 prompt 选择（随包 docs/skills.md:53,80–87；skills:279）。不是资源整体禁用。
- 原生发现不检查 Trellis manifest/runtime；已部署技能在坏 runtime 时仍可能可见。manifest-last 不阻止另一个原生会话看见逐文件发布的半完成目录；SKILL.md 最后发布可减少新目录提前发现，但不是全目录/全项目原子事务。当前会话新增 root 要用户 `/reload`/新会话重新发现；已有 `/skill:` 每次读当前磁盘 body，所以 stale metadata 不保证旧内容不执行（agent-session:1707–1709）。执行 gate 和 project trust需诚实分开。

### 4. 最小显式迁移/更新策略建议（技术方案，不新增用户决策）

1. **一份包内闭包库存**：沿现有 skill-baseline，明确 target `.pi/skills/<skill>/<relative-file>`、logical source `skills/...`、hash及mode；有界 regular-tree/key-set核对，含 scripts/assets，不跟 symlink、不拷包外文件、不抄用户级技能。复用现有 plan/guard/lock/atomicFile，不建立通用 migration framework。
2. **一个明确的新库存形状**：建议新 manifest schema3 增独立 `skills` map（复用 hash/mode/source 与 editable provenance语义），原 `files` 的 runtime/agent和 templates逻辑 source 保持。技能 last-published baseline 仅是安全更新/定制诊断，不是执行未知代码的许可；runtime gate 继续严格 current runtime files，不能要求用户技能磁盘恰好等于包版本，也不要把技能包更新绑定到 runtimeReleaseId。
3. **一个精确 legacy transition**：schema2 → schema3 的显式菜单计划只接受已知 legacy runtime/role/template target/source/kind 清单；保留全部原始 provenance，新增仅固定 skill targets。若上游 S2 增 Python inventory，也须按最终 pin 声明对应允许 transition，不能泛化成“所有 unknown都可信”。旧/坏runtime本身仍只能进入确认资源修复/升级，不能因补齐 skills启用执行。schema3 后续技能增删同样用已知库存版本/key delta，不接受任意未知 records。
4. **unknown collision与 customization**：初次部署/legacy add若任一目标 skill root 已有未托管内容，默认 preserve整个 root并报告冲突，不拼成混合技能、不写默认 origin冒充已部署。用户可先自行重命名/迁出，或进入另一个明确替换/认领确认；执行替换须备份，不复用 adoption 的“全部 files无备份 Replace”。后续安全更新只换 last-published未改 files、修复已记录 missing；定制保留并标识。可先采用现有全操作 conflict，要求处理后重新计划，不必做文件选择/diff/merge UI。
5. **完整 canonical authority**：init/adopt/legacy-add/update都重建 package output闭包，预览后/lock下重验 source与target、manifest最后发布、partial保留并可显式重试。基于本次76KB库存，当前256 actions/512 guards/4MB plan bounds足够，但将来脚本/资产可能超限；不能无界扩大。新 init-only action规则不能被一个“迁移 operation自报output/hash”绕过。
6. **text vs binary seam**：SKILL/reference/script文本保留 UTF-8/无 NUL验证；asset 仅 regular-file/byte-size/hash/mode，不过 text validator。S2 的 `ProvenanceReader.file()` 与 diagnostics inventory当前全把文件当文本，需要显式 bytes/text用途，不能全局删除 Python/role文本校验。存储 bytes的base64和原子写 owner可复用。
7. **结束行为与加载退场**：去掉 extension resources_discover技能返回、projectSkillPaths虚拟包设置；保留真实adapterConfigured。init/adopt/update去掉自动reload，完成通知准确指出 trust/native禁用/碰撞、current cwd/新会话或用户reload。普通启动不自动部署、补库存、改settings、清旧skill或恢复定制。

## Related Specs / External References

- `.trellis/spec/development/index.md:7–15,57–76` — 单包资源声明、包/项目归属、中文任务与英文开发约束。
- `.trellis/spec/testing/index.md:5–45,80–95` — 实际相关 owners/loader与自然退出、隔离及 NOT_RUN边界。
- Pi 已安装随包 `docs/{skills.md,cli.md,packages.md}` — 本地1.2.0文档，分别支持目录闭包/trust/collision/reload、no-skills例外、package filter与identity；未联网获取新版文档。

## Caveats / Not Found

- 未发现现成 schema2→新增技能库存 reconciliation 操作；不是已实现能力。schema3/独立skills map是上述推荐，不是用户必须再选择的需求，也不是本轮代码修改。
- 当前没有真实 scripts/assets；binary支持、新目录partial可见、从子目录/目标worktree发现、同名加载与用户reload须在最终pin实现后用隔离真实Pi loader覆盖。本轮只读比对不是产品测试PASS。
- S2 dirty reader/provenance合同正在变动；完成迁入前重新读最终commit，勿直接复制dirty或以当前33 runtime inventory为永久数值。
- 本会话 current 为 no-task；用户明确给了上述单个task research输出授权，未绑定/start任务。仅写本Markdown研究，不改规划/产品/tests/部署/个人配置或历史材料。
