# 实施计划：Pi持久记忆与旧包清理

> 2026-10-14用户接受修订规划并批准实施；2026-10-15要求迁回主worktree继续并清理旧目录。2026-10-15本会话再次批准继续，并明确按阶段实施、验证和本地提交，不逐阶段询问授权。不得push/archive/reload；本机包配置和旧数据清理仍需另核动作授权。

## 0. 审阅与环境
- [x] 主会话确认记忆四工具与存储/prompt范围；2026-10-15面板交互改为只读全屏浏览，移除此前公开多行dialog方案，用户已认可修订交互与常驻滚动条并批准继续实施。
- [x] 已核当前Git状态与任务材料；保护并行Trellis脚本/集成及其他任务修改。实施时逐文件检查实际diff，只编辑本任务拥有hunks，不覆盖/恢复整文件。
- [x] 执行方式（2026-10-15修订）：用户要求清理两个旧worktree，改在源checkout主worktree（main）继续。原记忆worktree仅创建、unprepared、无执行记录/产品改动，任务文档已在source。主会话协调本任务文件范围，可在共享source派发阶段实现；阶段1完成后核验，独立trellis-check仍是交付门。不新建隔离worktree、不覆盖其他任务改动。
- [x] 已核Pi1.2公开sections/Markdown/custom/editor/agentDir API，读取上下文清单全部规范；实现具体调用前继续核签名和实际host行为。
- [x] 用户明确批准修订规划与激活；更新文档后执行task.py start。本任务按顺序完成可验证阶段，不创建无必要子任务树。
- 用户2026-10-15明确解除此前不自动commit限制：逐阶段实施、验证并由主会话创建本地提交，不逐阶段重新询问。独立审查不能由主Agent自查替代；若执行条件受阻，报告阻塞而不标为通过。

## 1. 存储/策略/工具（AC1/3/4/7）
- [x] 新建唯一顶层memory.ts与嵌套memory/，不修改Task composition/editor。
- [x] 实现项目identity、个人enabled配置、安全路径与主题schema、固定预算。
- [x] 实现跨进程短锁/expectedRevision/原子正文/index派生重建；partial save明确结果，损坏/扫描超限fail closed。
- [x] 实现memory_read/write/list/forget与英文bounded结果，缺正文/空白不可隐式删；扫描仅有界frontmatter（每文件最多1KiB/总2MiB），正文read/详情另受16KiB限制；索引裁剪留省略提示，list分页可发现溢出。
- [x] 验证超过128个接近16KiB的有效主题仍能列出/生成索引，证明元数据扫描预算不误计完整正文；外部frontmatter超限不生成部分有效索引。
- [x] 单测临时HOME/agentDir/cwd、Git identity seam及临时自有Git仓库（不动真实仓库配置），secret/UTF8/path/symlink/lock/crash/conflict/capacity全矩阵。
- [x] 两个独立本地进程竞争同项目锁，验证冲突/无lost update；不只用Promise.all进程内测试。
- [x] 独立审查c3c53b27完成，主会话通读实际修复并复测27/27自然退出0；独立strict+full800/800 exit0沿用最终未变输入。证据见research/stage-1-independent-review.md及stage-1-main-focused.log。接受既定public agentDir symlink祖先拒绝，后续UI提示和配置published/durability重读不得遗漏。
- 阶段1提交：`f635dcc`；26个精确文件，仅memory代码/测试和本任务材料。原始.log保留本地未提交，首次staged whitespace失败因日志空白行，未篡改日志；源码/Markdown/JSONL及提交diffcheck通过。

## 2. Prompt与生命周期（AC2/6/8）
- [x] 公开structured sections每run合成唯一project_memory段，保留其他扩展sections、不重复叠加；空库/错误规则明确，disabled删除自己的段。
- [x] 初始化timeout、shutdown epoch、旧dialog/async回调不能重开；无后台模型/退出flush/timer。（dialog围栏在阶段3另验。）
- [x] 实际SDK stub-provider捕获两次独立prompt、resume及空库请求，证明首/后轮索引存在、无额外模型调用；另验enabled→disabled自己的段移除、其他sections保留，不以注入handler字符串断言替代host请求验证。
- [x] root/embedded child加载均不创建后台任务；不引入Agent工具调用或递归。
- 独立审查24c31566 PASS，补actual custom-triggered run与startup修复后四工具closed回归；主会话核实际两测试变更并复验37/37自然exit0，独立strict/full810/810 exit0沿用。CLI/PTY/在线质量仍NOT_RUN。
- 阶段2提交：`d0fada7`，9个精确文件（入口/prompt/两测试、实施manifest/进度与证据摘要）；原始.log继续保留本地未提交。

## 3. 只读全屏面板（AC5/6/7，等待内置迁移/共享模块归属）
用户随后要求新建`../10-15-builtin-pi-trellis`，将pi-trellis内置本仓并把共享内部模块纳入迁移任务。Memory不再先独立落共享adapter；Agent5d1e6816-d75a-4f3已确认安全停止，未修改文件/启动验证进程；既有未提交candidate保持原样，未删除/回滚。迁移规划收敛并明确共享模块交付后，再继续本阶段只读面板消费者接线；S1/S2提交保持。
阶段3旧可编辑候选未提交，独立审查58/58自然退出、strict/full831/831只证明旧候选离线验证；不能转为新原生滚动验收。旧证据保留、不改历史结果。用户已认可本轮只读全屏交互和常驻滚动条，并批准继续实施；沿用阶段审查/主复验/本地提交，不逐项重复询问。
- [x] 接入共享`extensions/shared/scroll-panel/native-layout.ts`与`wheel.ts`：解析实际宿主包、校验同实例/内部renderLayoutFrame/getScrollViewBox及实际frame/scrollbar/scroll行为，集中内部兼容接入；公开wheel bridge只消费标准化wheelDelta并按原生正文几何转交。Memory先实践验证，再由Task Panel复用，不共享业务model/读取/生命周期。
  - 旧纯公开路径阻塞事实保留：installedPi1.2.0 overlay不求值nativeframe、viewport0/wheel穿透，见evidence/stage-3-readonly-implementation.md。**接口决策已解决**：用户接受隔离内部layout风险并批准同步及继续Memory实施；最终方案保留overlay、不替换宿主layoutRoot、不改SDK/复制renderer，不兼容明确拒绝打开。邻仓最终方案见10-15-task-viewer-mouse-scroll，仍须本仓实际host验证，旧3/3缺口探针不当新验收。
- [x] 移除阶段3候选的编辑/删除/菜单与宿主editor/input/select/confirm接线；保留四工具及独立/memory on|off，不改变阶段1/2已提交合同。
- [x] 单custom内部全屏list/detail：width/maxHeight100%、top-left、margin0，固定header/footer、原生正文viewport与可视滚动条，背景填满实际行列，小屏保Esc入口。滚动条常驻，用户已确认。
- [x] list↑↓/HomeEnd选择、Enter详情、/原生Input过滤、c清除、r只读刷新、Esc关闭；detail↑↓/HomeEnd滚动、←/Esc返回、r只读刷新；移除手动分页及PageUp/PageDown处理提示。
- [x] 原生滚动状态列表/详情独立；滚轮不改selection，keyboard选择变化才ensure-visible，普通render/刷新不拉回；返回/过滤/丢条目/resize合理保留收敛，不保存重复手工offset。
- [x] Fullscreen公开handleMouse wheel bridge按native frame正文几何滚动、所有overlay wheel（含固定区域/边界）消费防穿透；不解析协议/二次加速；Regular不强开mouse，不新增行点击/滚动条拖动。
- [x] 面板浏览、filter、r全部零磁盘写入/零模型调用；刷新只重读主题和metadata、不store.refresh/publishIndex。无效/丢文件/损坏/容量/权限/disabled状态不当空库；超大安全预览无完整revision。
- [x] 非TUIstatus/list/on/off/help仍可，on/off显式写配置并正确处理PublishedError重读disk；面板本身无开关。
- [x] 实际SDK组件/原生布局/owner测试Unicode、控制字符、宽度/高度/resize/主题/focus与done安装时序、异步读取shutdown/latefence；四工具/多轮prompt回归保留。
- [x] 独立check后主会话核实际diff、focused自然exit与pnpm check，再精确提交新阶段3；真实PTY鼠标验收另获精确动作授权，不以模拟/邻仓结果替代。

### 阶段3完成记录（2026-10-16）
共享模块由已归档任务 10-15-builtin-pi-trellis 交付（`extensions/shared/scroll-panel/`，含打包版 Pi 下的 pi-tui 定位修复 9b09a6a）。
- 实施 trellis-implement 6b1884ca：整份重写 `panel.ts`、`command.ts` 及 `panel/command/ui-helpers` 测试，不在旧可编辑候选上修补。移除 `m`/`e`/`d`、PageUp/PageDown、全部 editor/input/select/confirm 调用、每个动作关闭再重开 custom 的循环、`store.refresh`、手工 slice/updateLayout/重复 offset 与隐藏滚动条。布局提供者可注入，测试使用 fake layout，不依赖真实宿主。`preview.ts` 内容未变（保留旧审查的 UTF-8 与缺失目录修复）；`extensions/memory.ts` 只有注册接线。
- 独立审查 trellis-check aaaf4e96：PASS。逐项确认只读边界、共享模块使用、生命周期与安全显示，测试没有旧候选残留。主会话真机发现 resize 后选中项不可见，由审查方修复：列表 frame 尺寸变化时，若缩放前选中项在原生视口内则保持可见，被滚轮滚开的不拉回。新增逻辑测试，先去掉修复确认测试失败，恢复后通过。
- 真机实测（主会话，tmux，已安装 **Pi 1.3.0**，隔离 `PI_CODING_AGENT_DIR`，`--no-extensions -e` 加载本仓 memory.ts，用真实 store 写入 40 条测试记忆）：
  - 列表、列标题、常驻原生滚动条、固定底栏正常，中文宽字符对齐。
  - End/Home、↑↓ 选择；滚轮滚动视口但不改选择；标题与底栏上的滚轮被消费不滚动；滚轮后按键选择会把选中项拉回可见。
  - `/` 中文过滤、`c` 清除后保留选中项；Enter 打开 128 行详情，End/滚轮/Home 滚动；`e`/`d`/`m`/PgUp 无效；`r` 只读刷新；Esc 返回列表并保留选中项与位置；Esc 关闭后恢复编辑器。
  - 浏览前后隔离 agent 目录 45 个文件的 mtime 与大小完全一致（零写入）。
  - 40×6 与 30×1 小屏仍保留 Esc 入口；resize 修复后复验通过。
  - `/memory list <query>`、`/memory off|on` 正确写配置，面板显示 Disabled 状态。
- 最终验证：`node --test extensions/memory/__tests__/*.test.ts extensions/shared/scroll-panel/__tests__/*.test.ts` 71/71 自然退出，约 5 秒；`pnpm -s typecheck` 0；`pnpm check` 1523/1523（工作区含另一会话 10-16-check-report-readability 的并行 Trellis 改动，未纳入本次提交）。
- 未验证：物理鼠标手感、IME、Regular 模式与 Fullscreen 模式分别在真实终端的差异（本次未切换宿主模式）。已知小问题：`/memory list` 直接输出工具的 JSON，可读性一般，留待阶段4处理。
- 历史遗留：`research/*.log`、`evidence/*.log` 与探针 `.mjs` 是此前写入任务目录的原始输出，按工作流不应保留在任务目录；未获授权不移动或删除，本次也不提交。

## 4. 配置/文档/独立检查（AC8/9）
- [x] pi-preset.json移除npm:pi-memory并加入conflicts，merge也能卸载；不安装pi-claude-memory。
- [x] 更新manifest/discovery tests，通过实际Pi resource loader验证旧pi-memory/pi-claude-memory同名工具冲突诊断，README给出移除旧包与重启说明；不额外实现registry或加载顺序抢占。
- [x] README overview/第三方/自带扩展/配置/容量与清理说明更新；合并并行hunks。规范新增仅本任务实际证据，不大改无关spec。
- [x] 更新本任务验证证据/边界（记录于下方完成记录，不另写research）。主会话检查实际diff。
- [x] 独立check按PRD逐项复核，允许任务内自修但不碰本机状态；主会话复核check实际修复。
- [x] （面板代码本阶段未改，沿用阶段3 Pi 1.3.0 真实 tmux 验证）隔离PTY冒烟另说明：installedCLI+临时HOME/agentDir/session/cwd，scripted local provider，直接-e本checkout，不install/reload个人实例。记录regular/fullscreen全屏列表详情/返回/resize/quit恢复提示，验证Fullscreen真实滚轮和上下边界不穿透、Regular键盘/滚动条且不强开mouse；不再验证已移除dialog，不把fakeprovider当真实自主记忆质量。

### 阶段4完成记录（2026-10-16）
- 改动：`pi-preset.json`（packages 删 `npm:pi-memory`，conflicts 加入）；`scripts/pi-manifest.test.mjs` 新增断言；`extensions/memory/__tests__/loading.test.ts` 新增同名工具冲突回归；新增 `docs/extensions/memory.md`，删除 `docs/packages/memory.md`，README/`docs/index.md` 把 Memory 移入自带列表并加迁移说明（含容量上限）。
- 宿主事实（Pi 1.3.0，已读源码并以测试固定）：`DefaultResourceLoader.addExtensionConflictDiagnostics`（`core/resource-loader.js:583`）对同名工具给后加载者记 `Tool "<name>" conflicts with <path>` 错误，两扩展都保留；`ExtensionRunner.getAllRegisteredTools()` 先注册者胜。纯 `discoverAndLoadExtensions` 不做此检测。
- 失败事实：主会话初稿只查了 runner/loader，误判“无诊断”，README 与测试按此写成；独立审查（agent 427e523a）指出并改为经 `DefaultResourceLoader` 断言 4 条冲突错误、README 改为如实描述启动报错。审查另修正文档 5 处（面板不能删除、`/memory list` 仅前 20 条、项目按 Git common dir 实际路径识别、索引 200 行约 197 条并补 `memory_list` 分页上限、手改 memory.json 下一轮生效）；主会话复核源码后接受，并补“全屏模式下”滚轮限定。
- 验证：初稿 focused 74/74、`pnpm check` 1525/1525（审查前）；审查后 `node --test scripts/pi-manifest.test.mjs extensions/memory/__tests__/*.test.ts` 73/73、`pnpm -s typecheck` 0；审查者反向验证：重加 packages 或移出 conflicts 时新清单测试失败（9/1），调换加载顺序时冲突测试失败。
- 未验证：真实已安装 CLI 启动时冲突横幅的显示；真实 npm `pi-memory` 包（以同名工具替身代替）。

## 验证命令
从项目根使用现有installedSDK+临时配置：
```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
# 定向node --test无force-exit必须自然结束；记录退出码并清理仅自建agent_dir。
```
另跑scripts/pi-manifest.test.mjs、scripts/sync.test.mjs、Markdown本地链接检查及git diff --check；新untracked文档/代码也检查，不能git diff空就当通过。失败按实际exit报告，不连续命令掩盖前一步失败。

## 5. 本机应用与旧历史清理（有副作用，AC9）
阶段1–4形成可独立验收的代码交付；本节形成迁移验收。代码完成不等于AC9完成，本机迁移未完成时保持任务未完全验收，不归档。
代码与独立check通过后单独主会话执行，不派给普通checker：
- [x] 再出精确操作清单：个人settings旧包源、目标新入口来源、pi-memory数据条目、确认独占索引残留；不使用全量sync/update改变其他包。
- [x] 再核用户批准本机应用动作，不自动reload。卸载通过公开Pi包命令，仅npm:pi-memory；新入口加载按选定来源，不静默install发布版覆盖并行本地代码。
- [ ] 当前factory仍加载旧pi-memory时不能最终删历史后宣称完成；安排不加载旧包的下一次会话执行清理并确认恢复提示。用户若不重启，明确“代码/配置完成、旧数据删除待重启”，task不当作完全验收。
- [x] 在旧插件不再加载后核lstat/归属/清单，只删除根MEMORY.md/SCRATCHPAD.md/daily/recovery中确认旧数据；不递归删memory根、不碰projects/未知条目/symlink。
- [x] qmd当前不可用/default目录不存在；执行时若发现共享索引只清已确认独占pi-memory collection，不卸qmd、不删整个数据库。
- [ ] 验证旧数据不会重新生成、工具只注册新实现、projects与其他个人配置/Claude/Pi/Trellis保持不变。

### 阶段5执行记录（2026-10-16 10:41）
- 核查（只读）：`~/.pi/agent/settings.json` packages 已不含 `npm:pi-memory`（此前同步已移除，本次未运行 sync/update/install）；残留仅 pnpm 内部 `npm/node_modules/.ignored/pi-memory` 与 `.pnpm/pi-memory@0.4.2_*`。旧数据：`memory/MEMORY.md` 48K、`memory/daily/` 5 个 `YYYY-MM-DD.md`（10-12…10-16，最后写入 10-16 05:00）、`memory/recovery/` 空；无 `SCRATCHPAD.md`、无 symlink、无未知条目；qmd 未安装、无缓存。
- 用户以问卷逐项确认后删除上述四项（文件 `rm`、daily `rm -rf`、recovery `rmdir`、两处 pnpm 残留）；删除前再核非 symlink 与 daily 文件名格式。删除后 `memory/` 仅剩 `projects/`（3 个项目目录，未动）。
- 未完成：本会话启动时是否仍加载旧包无法在会话内证实；需在下一次新会话中确认 `memory/` 下不再出现 `MEMORY.md`/`daily/`，且仅内置 Memory 注册 `memory_*` 工具，之后勾选剩余两项并验收 AC9。

## 回滚与风险
- 实现阶段回滚仅本任务hunks，不能git reset/checkout整树。原数据删除前不得偷偷复制正文到恢复库；用户明确清理意味着数据删除不可恢复，清单保留元信息不保留记忆内容。
- 包配置变更保留最小原配置diff用于操作回滚；若重新启用旧包会再次生成数据，需要明确提示。
- 手工/外部编辑不遵守锁、secret扫描漏判、主模型漏记、外部超大库达扫描上限均公开说明，不宣称全自动或无限制。
- 全部AC与真实本机阶段完成后再提议收尾；本地阶段提交已授权，push/archive仍另获授权。
