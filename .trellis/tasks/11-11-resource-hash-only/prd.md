# 清理资源权限指纹与一致性检查

## 目标

Git 共享资源只以文件内容哈希判断一致性，彻底移除包 checkout 的权限位对资源识别、执行、更新和恢复的影响，而不是只修复一处 `664 → 644` 报错。

## 背景与已知事实

- 用户报告的项目 manifest 在 runtime 行记录 `mode: 436`（`0o664`），包文件及项目脚本后来为 `mode: 420`（`0o644`），内容哈希和 runtimeReleaseId 一致却被拒绝。
- `extensions/trellis/lib/initialization/engine.ts:138` 将包 runtime 文件的实际权限写入资源记录；`:233` 将权限差异作为 runtime provenance 错误；`verifiedManifest()` 再将项目文件与记录作完整 fingerprint 比较。
- `extensions/trellis/lib/initialization/resources.ts`、`diagnostics.ts`、`diagnostic-worker.ts` 已发现同类权限追踪或比较，需进一步全链路排查。
- 用户明确要求：资源 manifest / fingerprint 不记录 `mode`；内容校验、更新前修改检测、备份恢复都不追踪原文件权限；文件创建使用明确的默认权限，不继承包 checkout 权限。

## 范围

1. 排查整个仓库相关权限使用，区分资源内容一致性、资源写入/恢复、必要的系统权限和无关业务 `mode`。
2. 清理 Trellis runtime、roles、skills、templates、root blocks 等共享资源的 mode 字段及依赖传播；覆盖初始化、接管、更新、修复、模板应用、诊断与执行消费者。
3. 同步调整相关测试、当前规范、类型和必要的资源基线；不手工修补已部署项目副本绕过校验。
4. 明确旧 manifest 与未完成初始化操作的兼容边界，避免旧权限字段继续阻断正常项目。

## 初步验收标准

- 相同内容在 `644/664` 等权限差异和不同 umask 环境下，不被判成不支持的 runtime、用户修改或资源冲突。
- 新发布的资源指纹不包含 `mode`，不从包文件 stat 生成发布权限。
- 更新前内容变更仍受保护；自定义内容不被覆盖；无变化资源不因 chmod 单独被重写。
- 备份恢复保留内容，不保存或恢复原权限；文件创建权限采用明确默认策略。
- runtime 哈希错误、未知资源、非法路径、符号链接/非普通文件、锁与未完成操作边界仍受保护。
- 相关回归测试覆盖旧记录、权限漂移、更新/修复、诊断、内容冲突、备份恢复及幂等性。

## 排除范围

- 不删除锁文件、私有临时目录等真正必要的权限设置。
- 不移除路径、来源、资源清单、文件类型、内容哈希和并发内容修改保护。
- 不清理历史归档任务、vendor 原文，不改个人已安装扩展或运行安装/同步。
- 不把业务执行模式字段（例如 source/worktree 或 diagnostic mode）误当成文件权限移除。

## 授权与当前状态

用户已授权创建任务并进入排查与规划，并明确表示不需要兼容旧版初始化中断后的续跑。用户随后明确回复“开工吧”，批准 design.md / implement.md 的清理方案及两个阶段的实施、验证、独立审查和 scoped 本地提交。

## 排查结果与技术范围

研究 Agent 已完成只读调查，主会话复核了关键源码和测试。确认不是单点问题：权限进入发布记录、runtime gate、更新分类、并发保护、初始化恢复、诊断源码快照和源材料读取。

| 所有者 | 清理内容 |
| --- | --- |
| `extensions/trellis/lib/initialization/engine.ts:19–39,82–92,128–151,174,215–266,381–596` | Fingerprint、manifest、action/guards、包权限采集、运行校验、初始化计划/重试/输出验证。 |
| `extensions/trellis/lib/initialization/resources.ts:13–49,60–94,99–142,172–232` | 更新/修复/模板应用、预览签名、原子发布、备份；`:72` 的完整 fingerprint 比较会使仅 chmod 的模板转成 preserved-project。 |
| `extensions/trellis/lib/initialization/adoption.ts:8–14,25–60,117–135` | 接管计划、输出、guard 和 preserved template 记录。 |
| `extensions/trellis/lib/initialization/skills.ts:16,30–50`、`root-blocks.ts:15–18,32–37`、`provenance-reader.ts:5–9` | skills 分类、根文件指纹、reader 契约；移除包 executable bit 对资源发布的影响。 |
| `extensions/trellis/lib/initialization/diagnostics.ts:57–110,128–205,304–320`、`diagnostic-worker.ts:20,38–39,63`、`diagnostic-bootstrap.ts:40–42` | 独立 schema 校验、静态 inventory、捕获源码协议和重新校验，统一采用内容指纹。 |
| `extensions/trellis/lib/task-context.ts:40`、`extensions/trellis/runtime/pi_trellis_worktree/materials.py:75–77` | 单次读取 identity 含 mode/ctime；chmod 同时改变 ctime，只删显式 mode 仍可能误报读取漂移。保持 descriptor/路径/普通文件保护，需以不会将权限变化当成内容变化的方式实现读取一致性。Python 目录 guard 不可机械删除其内容变化检测。 |

执行消费者 `project-state.ts`、`subagent-rpc.ts`、`worktree-query.ts`、`initialization/command.ts` 应继续复用统一 gate，不各自增加例外。

### 格式与发布方案（已获实施批准）

- 新 manifest 使用 schema 4，无 mode；兼容读取 schema 2/3 的合法旧记录，将旧 mode 忽略并统一为内容指纹。所有发布路径完整移除旧深拷贝记录中的 mode，覆盖 preserved templates 和未变化的 skills。
- 新初始化计划同样不包含权限指纹；旧 planHash 必须先按原始旧计划验证，不能先删 mode 再校验。
- 已完成旧 operation 作为历史记录处理，不应因新格式 canonical output 改变而阻断正常项目。
- 默认共享资源/根文件写入采用 `0644`，备份文件采用 `0600`，必要的私有目录采用 `0700`；无变化文件不为调整权限而重写。
- 四份资源 baseline 本来只记录内容 hash。若修改 Python `materials.py`，同步更新当前 runtime hash 和 runtimeReleaseId，保持旧版本显式更新边界；不改历史来源 hash。
- 当前 `.trellis/spec/development/index.md` 的 runtime `hash/mode` 和 schema-3 发布描述需同步更新。包 runtime/skills 的 Git index 当前均为 `100644`，没有现存资源必须继承 executable bit 的证据。

### 测试范围与已知覆盖缺口

- `initialization.test.mjs:12–17` 通过 smoke Set 只注册 3 个 case，文件内其余定义不是有效执行覆盖；`init-review.test.mjs` 也存在 smoke 过滤。至少恢复/显式注册本任务需要的锁、非法输出、恢复、符号链接等回归，避免将未注册测试视为 PASS；不顺带改造所有测试体系。
- `diagnostic-runtime.test.mjs` 的权限 gate case 混入内容篡改，不能独立证明权限行为；新增纯 chmod 与不同 umask 回归。
- 后续 focused 命令（隔离仓库外 `PI_CODING_AGENT_DIR`、使用现有 SDK、不加 force-exit）：

```sh
node --test extensions/trellis/__tests__/{initialization,init-review,manifest-provenance,resource-update,root-block-update,apply-template,adopt-project,skill-deployment,init-diagnostics,diagnostic-runtime,task-context}.test.mjs
node --test extensions/trellis/__tests__/{dispatch,preparation,worktree,worktree-cli,agent-context-integration}.test.mjs
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
node --test extensions/trellis/__tests__/*.test.mjs
pnpm check
```

以上均 NOT_RUN；当前只做规划和源码核查。跨模块格式兼容和初始化恢复变化需独立 review，主会话优先直接实施，审查单独派发。

## 已确定的兼容边界

- 用户明确表示不会有需要处理的旧版初始化中断现场，本任务不实现旧未完成 operation 的迁移或续跑兼容。
- 若遇到旧未完成记录，保留记录和部分文件并明确拒绝，不自动删除、转换或执行旧 action。新版自身的中断重试和锁保护仍需测试并保留。
- 正常已完成的 schema 2/3 项目纳入兼容；已完成的旧 operation 不因历史 mode 或新发布格式变化阻断正常项目。
- 所有范围已明确，design.md / implement.md 已获用户“开工吧”实施批准。

## 调查材料

研究原始检索输出暂存 `/tmp/trellis-hash-research.tgv29x/`；未写入 research/ 或 evidence/。本 PRD 已保留关键结论，不以临时路径作为唯一证据；临时目录尚未清理。
