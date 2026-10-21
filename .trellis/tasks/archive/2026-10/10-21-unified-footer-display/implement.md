# 实施计划与验证记录

## 授权与执行选择

- 用户要求完整 task；范围见 prd.md、design.md。
- 用户已批准更新后的完整方案实施，并授权新建托管 worktree。执行代码／测试在新 worktree，任务／规范／workflow 以源目录为权威，不复制源未提交产品变化。
- 用户选择托管执行后：使用 trellis-implement 在已准备 worktree 实施，主会话负责源材料、调度、核查和 scoped commit；独立 trellis-check 在同一绑定 worktree 检查。
- 跨模块显示／生命周期契约需要独立 trellis-check 审查；派发前读取 subagents skill、准备 check.jsonl，并明确共享目录改动范围。子角色不提交，不写源任务报告，原始日志使用其自有外部临时目录。
- 未获 no-commit 指令；计划获批后，主会话按验证完成的阶段 scoped commit。无 push、个人安装／sync／reload、归档或 journal 授权。
- 保留其他会话对工具卡片任务、journal、install-pi-btw 等材料的变化，不纳入本任务提交。

## S1：统一契约、消费者迁移与规范（耦合实施阶段）

- [ ] 实施前完整读取现有 shared widget loader、consumer activation、task-ui lifecycle／overview、status-bar tests；核查 SDK setFooter 的 factory／dispose／runtime reset 语义与公开能力。
- [ ] 若现有公开接口不能安全保留组件所有权和数据 provider，记录阻塞，不能私自扩大到 SDK 私有布局。
- [ ] 中心 registry 建立 region → group → item；group 声明 block／inline、overflow／separator 和区域内 order；item 声明 group 和组内 order。迁移已有 block consumers，usage 接入 tokens／cache_metrics／task_summary；agent_overview 位于 footer 最后。
- [ ] 共享层唯一宿主 setFooter 路由；类型化 Footer factory provider；保留原 widget client 接入和会话／activation fencing。
- [ ] 拆分 Status Bar 三个 slot，保留业务指标、缓存、主题和横向排列，避免重复订阅与扫描。
- [ ] 移除 `/statusbar` 命令及开关，不加入间隔或自动区域回退。
- [ ] 增补 fixed-order、empty-item／group、不同插件共用 block／inline、未知目标／重复 item owner 拒绝、ANSI／Unicode wrap／truncate、无多余 separator、不同 lifecycle 顺序、异常／重入／late factory／shutdown、不同 manager 相同 id、RPC／print、宽度／主题测试。usage 默认 truncate；block 保留多行，不统一强制截断。
- [ ] 扩展生产边界测试：宿主 setWidget／setFooter 均由明确共享 owner 集合独占。
- [ ] 同步当前开发／测试规范与用户文档；不修改归档历史。
- [ ] 主自检 focused + strict typecheck，修复范围内发现。
- [ ] 独立审查；主核查实际 findings、fix diff 与测试结果。
- [ ] 运行受影响更广套件、pnpm check、diff whitespace／当前 Markdown 链接检查。
- [ ] 逐项复核 staging，仅提交本阶段耦合产品／测试／文档与选定规划记录。

### 计划验证命令

所有 Node／pnpm 检查使用既有 linked SDK 与独立 PI_CODING_AGENT_DIR；不安装依赖，不访问个人配置，原始日志放 mktemp 所有的系统临时目录。

```sh
node --test extensions/shared/widget-display/__tests__/*.test.ts extensions/__tests__/widget-*.test.ts extensions/__tests__/status-bar.test.ts scripts/pi-manifest.test.mjs
node --test extensions/task-ui/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts
node --test extensions/trellis/__tests__/project-activation.test.mjs
pnpm typecheck
pnpm check
git diff --check
```

运行前确认实际路径／globs和已有 deps；缺少工具／路径须记录，不把零匹配视为 PASS。focused 生命周期测试不使用 force-exit，full 配置强制退出不当作自然退出证据。

**Checkpoint**：S1 验证后 scoped implementation commit；不能把协议与消费者拆成不一致的提交。

## S2：隔离真实终端效果与最终验收

- [ ] 创建唯一 `tmux -L` server 和外部临时 HOME／agent-dir／cwd／session／capture／driver目录。
- [ ] 核查现有 CLI help，显式 offline、禁自动发现、禁 MCP／会话存储，加载本地目标入口与最小 fixture，不继承认证。
- [ ] 实际 CLI 有 Agent／workflow fixture 时核查位置、原三行指标、无新增空行。
- [ ] 撤销 fixture 后核查 Agent 区域与占位消失，指标保留。
- [ ] 宽／窄启动与动态 resize；等待真实新尺寸帧，不用固定 sleep 猜就绪。
- [ ] 生成用户可查看 PNG；标明真实窗口截图或真实终端 capture 渲染图。复核图片本身，不只检查文件存在。
- [ ] 检查 stderr／owned raw output，区分 fixture failure 和产品 failure；修复产品时重新通过 S1 affected checks 与独立 review。
- [ ] 正常结束独立 CLI，确认自有 CLI／children退出；只关闭本次唯一 server，不碰个人 panes。
- [ ] 最终记录 commands、环境、exit、结果、首次失败／重跑关系、截图路径与未覆盖项。
- [ ] 如需产品修复则检查后做 scoped fix commit；纯结果记录按最终 Git review 决定剩余提交。

**Checkpoint**：最终验收记录／必要的 scoped fix commit。效果 PNG 与 raw logs 默认不进仓库；保留到用户查看与诊断完成，不主动删除交付图片。

### 独立审查最终结果与 S1 checkpoint

- `trellis-check` 独立审查实际13项产品／测试／docs变化，无剩余 scoped defect；角色摘要标题虽为 Self-Check，其执行为主会话单独派发的独立 reviewer，并非实现角色自检。
- 修复 inline ANSI-only 空白产生多余 separator、ST终止 OSC吞后续文字、separator使用旧theme和截断 ellipsis失去dim样式；回归首次FAIL保留，最终focused53/53自然exit0，broader160/160自然exit0，strict tsc最终exit0。
- 最终完整 configured test payload 两次均exit1：1618/1619 PASS，唯一失败仍为已确认无关 jobs-read guidance；不描述全量绿，不修改范围外文件。literal pnpm wrappers NOT_RUN，使用相同 strict编译和完整测试payload避免link步骤改变依赖链接。无独立lint脚本。
- S1产品／测试／当前用户docs已在目标分支提交 `590246f`（feat(display): unify widget and footer group composition）。源规范和任务记录独立留在源目录，待scoped材料提交；未merge／push／归档。

### 合并与收尾最终结果

- 用户明确授权合并和收尾；普通 merge 无冲突，main 合并提交 `0b5f8eb`（Merge unified footer display），保留源／feature 提交关系。
- main 已有独立修复 `a9985f3`，解决之前的进程 missing task_id 报错。合并后隔离 `PI_CODING_AGENT_DIR=/tmp/footer-merge.hsxuvY/agent` 运行 `node_modules/.bin/tsc -p tsconfig.json` exit0，以及完整 Node 配置payload（concurrency8／force-exit）exit0，1619/1619 PASS，0 FAIL。原失败事实保留，上述通过不覆盖其历史。
- 检查发生在main工作目录，包含另一个会话尚未提交的overview动画变更；这些变更未纳入本次merge提交，检查结果反映当时working tree而非纯merge tree，独立feature聚焦证据仍单列。
- staging与merge检查通过；无冲突文件；其他会话的 Task UI动画、docs/tests和journal内容保留，不纳入本任务提交。
- 托管remove预览只发现本任务ignored binding marker；确认目标干净且HEAD被0b5f8eb保留后remove成功，worktree和binding已释放，不删除feature分支。
- 用户已授权archive／journal记录；仅处理本任务。图片保留供用户查看，原失败／审查日志保留支持诊断；无自有活动进程。未push、未个人sync／reload。

## 当前记录

### S1 实施自检与主核查（待独立审查完成）

- 实施角色直接 strict tsc exit0；最终 focused 52 tests、Task UI／Recap 145、Trellis 15 tests 均自然 exit0。全量 configured Node suite force-exit：1616 PASS／1 FAIL，exit1。
- 全量失败为未改动 `process-tasks/__tests__/jobs-read.test.ts:178` 的 `/output requires task_id/` 断言，实际收到 Agent 缺失 ID 提示；`runtime-tasks/tools.ts` 和该测试对 worktree base 均无 diff。实施单文件重跑19 tests中18 PASS／1 FAIL；主会话在源 checkout 同样重现 exit1，未扩大修复范围。
- 初次 typecheck 的 footer placement overload 问题已修复；SDK fixture 首轮缺 theme 初始化／提供参数后修正并通过，失败日志保留，不宣称首次全通过。
- 实施原始材料 `/tmp/footer-s1.VIeHzq`；主材料 `/tmp/footer-main.qX1TSi`。独立 reviewer `agent_trellis_check_1_876fdc3b` 已派发，日志 `/tmp/footer-check.0X6NEv`；最终结果待主核查。
- 主会话已集成源开发 display/index 与 testing/index 规范；worktree .trellis 保持不变。

### S2 真实终端初轮（尚需最终审查代码后复核）

- 实际 Pi 1.3.0，独立 `tmux -L footer-preview-qX1TSi`、隔离 HOME／agent-dir／cwd，offline／禁自动发现／禁 MCP／禁会话存储；显式加载本地 widget-display、status-bar 和外部临时 fixture。未访问线上模型或个人实例。
- Fixture 采用真实 TaskCoordinator／TaskLifecycle／TaskUIOwner 和仅元数据的 Agent source；离线 provider 模型地址 localhost:1，未提交 prompt／模型请求。
- 首轮 fixture 错用 `ctx.sessionManager.setSessionName`，session_start 异常（不是产品缺陷）；纠正为公开 `pi.setSessionName` 并添加离线模型元数据后第二轮正常。首轮就绪等待未通过，后续 capture 显示异常，未当作 PASS。原材料 retained。
- 第二轮 fullscreen 120×30 正确显示 location／context／usage／Agent 连续四组，无空行。真实 resize 到60×24后 Agent 仍在最后；`/preview-empty` 撤销 source 后概览和任务 chip 消失，不留占位，原指标保留。
- PNG 是 AppKit 从真实 tmux ANSI capture 渲染的终端内容图，不是物理窗口截图；主已打开核查 wide／narrow／empty 图片。路径 `/tmp/footer-main.qX1TSi/footer-{wide,narrow,empty}.png`，用于交付暂不删除。
- 正常 C-d 结束本次独立 CLI；唯一 session 消失，ps 未见本次目录／server 的自有残留进程。regular mode、light theme、physical IME／mouse、线上模型质量暂 NOT_RUN。

- 已批准开始并完成 task validate（implement 4 entries／check 5 entries，PASS）；task 状态 in_progress。
- 创建并准备托管 worktree `.worktree/10-21-unified-footer-display`，分支 `trellis/10-21-unified-footer-display`，固定基点 `f7791688514db1f9e423af61f290f6ff5ace232d`；binding `07ee034f-15c6-484a-b979-d9c779bcd080`。源未提交变化未复制。
- S1 已派发 `agent_trellis_implement_0_a3f833a4`。角色仅修改 worktree 产品／tests／当前 docs，源规范由主会话集成；禁止 commit、安装、个人 config／reload、递归派发和 tmux。完成自检后由主会话独立审查调度。
- 环境检查：worktree 无 node_modules，源目录已有依赖；检查命令最终 exit1 原因是 ls 目标缺失，不是 prepare 失败。prepare 返回 ready；不授权依赖下载，使用已有 ancestor resolution／现有工具路径。

- 最终已提交代码 `590246f` 再次通过独立 fullscreen120×30离线真实CLI加载，复核无gap／Agent最后；最终聚焦图片 `/tmp/footer-main.qX1TSi/footer-final.png` 已打开确认。自有session正常C-d退出，ps无残留。图片与诊断材料为用户交付／失败保留，不清理。
- S1／S2本次范围检查已完成，整体完整测试仍有已重现的范围外基线失败，任务不声称全绿。未合并回main、未个人reload、未push、未归档。
- 2026-10-21：已创建完整任务并保存 PRD／design／implement。用户明确零空白间距、删除 `/statusbar`、Agent 最后及原三行也接入规范。
- 已检查当前 slot、consumer、owner、Status Bar 和安装 SDK 的主布局／类型定义；未执行产品修改、task start、测试或 tmux。
- 后续规划确认：用户认可 region → group → item 三层规范，插件通过独立 item 共用 block／inline group；公共 inline 支持 wrap／truncate，usage 保持默认截断；已授权更新任务材料。原生 Pi 1.3.0 Footer 的 setStatus 合并行实际截断，Text 文本组件实际自动换行，二者区别已记录。仍未 start，未实施。
- implement.jsonl／check.jsonl 已准备真实规范引用，供托管角色从源目录完整读取。
