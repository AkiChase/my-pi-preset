# 提交范围与授权记录

## 提交执行授权

用户随后明确要求“提交吧”，已授权按本清单暂存并提交产品、本任务材料和任务相关spec；未授权finish/archive、push或切换日常Pi安装。提交前在临时`PI_CODING_AGENT_DIR`重跑strict/full483/483与三模块461/461无force-exit自然退出，日志`/tmp/pi-bg/bx42ym7ad.log`，exit0、`COMMIT_CHECK_OK`。混合spec仅构造task-onlyindex版本，不改workingcopy的外部hunk。

下方“未授权/未来暂存”是前一轮清单整理的历史快照；本轮只执行已明确允许的提交，任务状态保持`in_progress`。暂存检查额外发现5个未跟踪文件EOF空行，已仅移除多余空行（含2份vendor源、2份process测试辅助及1份PTY记录）；无行为变化，最终cached-diff-check通过。

## 状态

用户本轮仅批准文档/阶段5整理与提交清单；没有执行git add、commit、finish/archive、push或install/reload。分支`feat/unified-task-panel`，基线HEAD`07ec6bc`；当前index无stageddelta。最终证据与能力验证精度见 [final-acceptance.md](research/final-acceptance.md)。

建议一个产品提交，再按用户安排单独归档任务。分阶段实施已结束，不为了提交再机械拆vendor/等候/UI的依赖链。

建议提交标题：

```text
feat: unify process and agent task interactions
```

## 完整纳入：产品代码、测试与用户文档

| 路径 | 内容与归属 |
| --- | --- |
| `extensions/bg-tasks/**` 的56个tracked删除 | 原进程树改名，不能只添加新目录留下两份可加载源 |
| `extensions/process-tasks/**` 全部57文件 | 改名后的源/许可证/provenance/回归；原快捷键/旧panel/take-control专属测试删除，新source/activation/waits/error/monitor-result测试补上 |
| `extensions/agent-tasks/**` 全部69文件 | 0.20.0 vendor运行源及后端适配、MIT/provenance/测试；旧widget/fleet在复制后删除，非UIformat迁activity，无dist |
| `extensions/task-ui/**` 全部19文件 | sharedtypes/coordinator/lifecycle/controls/model/panel/owner/editor/config和离线测试辅助 |
| `extensions/bash-unified.ts` | 唯一composition，singleprettybash、childmarker桥接，共享owner和最后注册Down |
| `package.json`、`pnpm-lock.yaml`、`.npmrc` | croner/nanoid运行依赖、TypeBox开发解析与hostSDKpeer；auto-install-peers=false去掉误安装的SDK依赖树 |
| `pi-preset.json` | standalonepi-subagents从packages移至conflicts，其他settings/keybindings/files/preserve不变 |
| `scripts/pi-manifest.test.mjs`、`scripts/sync.test.mjs` | 两后端nested不重复加载、upstreamconflict与offline替换计划，规范配置名测试；sync实现无更改 |
| `README.md` | 总表、vendor说明、三个模块/命令/配置/键位/生命周期、检查与隔离PTY边界；当前diff均为本任务相关调整 |

当前产品候选合计：145个newmodule文件＋56旧树删除＋8个顶层/脚本文件，209个路径。新模块目录无symlink、无意外二进制/build/dist文件，仅TS/MJS/Markdown/MIT许可；不能把大vendor或lockfile变更误认为无关，也不应把整个workingtree一并暂存。

## 仅纳入本任务材料

`.trellis/tasks/10-12-subagents-task-ux/**`：PRD/design/implement、task.json、JSONL与研究/交付/回归/授权/验收记录。本次完成前仍保留`status=in_progress`，不能在提交清单整理时伪造commit/completedAt。

任务归档若授权，建议先产品提交，随后taskfinish/archive、按新路径更新contextreferences与日志，再单独提交归档记录；当前不执行这些步骤。

## 共享spec：必须按任务hunk纳入，不能整个文件夹加入

只读范围分类agent `ae1fbd8b-9cc6-4c4` 已完整读取8份diff与原基线，主会话核对混合文件的实际diff：7份差异均属本任务；`extension-guidelines.md`须拆选。分类不是确定每行作者，而是保守维护任务归属。

| 文件（前缀`.trellis/spec/`） | 纳入当前差异 |
| --- | --- |
| `guides/code-reuse-thinking-guide.md` | 全部：process路径迁移与process/task-ui config owner拆分 |
| `guides/cross-layer-thinking-guide.md` | 全部：completion→view改为processregistry/TaskPanel及finiteimmutablepreview |
| `preset/documentation.md` | 全部：sharedcontrol键位证据与provenance路径 |
| `preset/monitor-contract.md` | 全部：目录迁移、retrieval重查、有界实际exit、同步setup重入守卫；保持既有wake/batching语义 |
| `preset/repository-guidelines.md` | 全部：processprovenance/许可路径，展示标签同步；未删通用vendor政策 |
| `preset/sync-guidelines.md` | 全部：规范`/process-tasks-version`诊断名，未改syncpolicy |
| `preset/testing-guidelines.md` | 全部：本任务source-loader/worker/waits/backend/activation/corepanel/editor/PTY回归契约 |
| `preset/extension-guidelines.md` | 按下述混合边界拆选；不可整文件暂存 |

### 混合文件的精确候选

仅对`preset/extension-guidelines.md`构造task-onlypatch（未来授权暂存时执行，当前不操作index）：

1. 纳入discovery句的nestedvendor重复入口警告；替换compositionownership与actualPi换代描述；lifecycle/registry引用换process；SafeTerminalRendering换真实TaskPanel/owner/测试。
2. 从新增`## 共享等待与阶段接入边界`至文件末尾全部纳入；这些是本任务waits/source/编辑器本地Down/ownexecution/auxiliary与协作式关闭约束。3B1“待审查”更为实际已复核状态。
3. **不纳入删除整个`## SDK Types and Configuration`的变化**：保留HEAD的SDK类型/importtype/strict、不掩盖any、按键cast/失败隔离/actionID与chord区分/configparser/无mutableglobal等通用政策。不恢复workingtree内容，仅futuretask-onlypatch保留；旧参考路径必须作本任务必要迁移：`shortcuts.ts`→`task-ui/controls.ts`，shortcutstests→`task-ui/__tests__/shortcuts.test.ts`，config/registry说明换process/共享controls的真实owner。不能把已删除bg路径带入提交，也不能把通用规则删除随任务提交。
4. 原`ToolDef = Parameters<ExtensionAPI["registerTool"]>[0]`示例保留在candidate，不随混合diff删除；其ownership未知，保守排除删除。
5. 原proxy捕获bash/receiver/pretty单一注册和deepimport段落保留其规则，仅`bg-tasks`机械换`process-tasks`；actualcomposition仍有同一代理行为。不要删除singlebash约束来形成看似更短的spec。
6. `## Session and Resource Ownership`标题保留，新actualactivation段在该节替换过时的“原factory复活”描述；该替换属本任务必要设计。最终检查task-onlypatch有完整公共政策/有效路径，没有把“保留HEAD”机械恢复成已删除旧backend的链接。

此拆选只影响未来stagedcandidate，当前不恢复/修改已有政策删除，也不执行gitadd。若拆选有不确定变化，保持外部内容不暂存再询问，而非whole-file捎带。

当前workingtree314个status路径：产品209＋本任务材料47＋共享spec8（其中1混合）＋排除50。后续用户或其他会话修改后数量可能变化，以最终stageddiff为准，不拿这个计数替代范围审查。

## 明确排除

- `.trellis/tasks/10-12-pretty-editor-compat/**`、`.trellis/tasks/10-12-subagent-turn-limit/**`；各自独立任务，不能把PRD/context顺手加入。
- 独立worktree `/Users/jyxc-dz-0101322/tools/my-pi-preset-pretty-editor-compat` 的`extensions/pretty-compat/**`和composition/README/spec未提交变化。本检出未复制，Down仅维护自己的实例输入装饰。
- `.trellis/agents/**`、`.trellis/scripts/**`、`.trellis/workflow.md`、`.trellis/config.yaml`、`.trellis/.gitignore`、`.trellis/.template-hashes.json`、`.trellis/.version`、`.trellis/workspace/index.md`等未跟踪workflow scaffolding；属于Trellis集成维护，非preset产品。
- sharedspec中的bootstrap语言规则、AGENTS/workflow维护策略、specdiscovery/开发约定修订等无关hunk；不能因为本任务JSONL引用这些规范就全部提交。
- `.pi/**`或其他本机/项目配置、个人~/.pi、`/tmp`/系统TMPDIR的PTY脚本/模型配置/日志；报告路径仅在任务研究中记录，不vendor临时fixture。
- `node_modules/**`、SDK软链、生成物、任何`.trellis/.runtime/**`。本次inventory没有列为产品候选。

## 保持未变的产品边界

对HEAD核对无delta：`install.sh`、`scripts/sync.mjs`、`scripts/link-pi-sdk.mjs`、`tsconfig.json`，以及statusbar/blocked-signal/clear-thinking等其他顶层扩展。本提交不升级Pretty版本，不移除模型侧`max_turns` schema，不更改四域同步实现。

## 暂存方式（按本轮授权执行）

只按上表路径明确暂存，不执行`git add -A`或`git add .trellis`。混合spec通过人工patch暂存/构建仅任务hunk的index版本，保留workingtree原始内容，核对`git diff --cached`与预期排除文件。若任何hunk无法可靠归属，保持外部改动不暂存，先说明而不是整文件捎带。

提交前重新核对用户在等待期间的新增修改，执行已约定的check，不重开未知模型/插件矩阵；报告staged清单后才能commit。README与task材料此次只更正文档，不改变已经通过483/461的运行时代码。
