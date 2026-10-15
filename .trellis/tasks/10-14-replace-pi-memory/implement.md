# 实施计划：Pi持久记忆与旧包清理

> 2026-10-14用户接受修订规划并批准实施；2026-10-15要求迁回主worktree继续并清理旧目录。2026-10-15本会话再次批准继续，并明确按阶段实施、验证和本地提交，不逐阶段询问授权。不得push/archive/reload；本机包配置和旧数据清理仍需另核动作授权。

## 0. 审阅与环境
- [x] 主会话确认最终范围与交互；编辑使用公开多行dialog，而不是直接操纵外部终端。
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

## 3. 交互面板（AC5/6/7）
- [ ] 单custom页面内部list/detail状态，SDK theme/Markdown/ScrollView/Input；全宽、细背景、英文controls、原文正文。
- [ ] list上下/翻页/HomeEnd/Enter/filter/r/m/Esc；detail滚动/back/e/d/r，返回保留selection/query/viewport。
- [ ] custom done返回typed action，之后宿主editor/input/select/confirm，最后在仍active时重开页面；取消不写、冲突刷新、安全校验复用。
- [ ] 菜单Refresh/Clear filter/EnableDisable/Close；off可读不可写、不新注入，提示不撤销旧上下文。
- [ ] 加载/空库/无匹配/丢文件/损坏/容量/权限/partial save与disabled状态不混淆。
- [ ] 非TUIstatus/list/on/off/help，所有工具模式一致，不调用custom。
- [ ] 组件实际render测试中文/组合字符/control/窄宽度与resize/主题；真实SDKcustom/dialog seam验证焦点与done路径、shutdown while editing不会重开。

## 4. 配置/文档/独立检查（AC8/9）
- [ ] pi-preset.json移除npm:pi-memory并加入conflicts，merge也能卸载；不安装pi-claude-memory。
- [ ] 更新manifest/discovery tests，通过实际Pi resource loader验证旧pi-memory/pi-claude-memory同名工具冲突诊断，README给出移除旧包与重启说明；不额外实现registry或加载顺序抢占。
- [ ] README overview/第三方/自带扩展/配置/容量与清理说明更新；合并并行hunks。规范新增仅本任务实际证据，不大改无关spec。
- [ ] 更新本任务research验证证据/边界。主会话检查实际diff。
- [ ] 独立check按PRD逐项复核，允许任务内自修但不碰本机状态；主会话复核check实际修复。
- [ ] 隔离PTY冒烟另说明：installedCLI+临时HOME/agentDir/session/cwd，scripted local provider，直接-e本checkout，不install/reload个人实例。记录regular/fullscreen列表详情/返回/dialog/quit恢复提示，不把fakeprovider当真实自主记忆质量。

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
- [ ] 再出精确操作清单：个人settings旧包源、目标新入口来源、pi-memory数据条目、确认独占索引残留；不使用全量sync/update改变其他包。
- [ ] 再核用户批准本机应用动作，不自动reload。卸载通过公开Pi包命令，仅npm:pi-memory；新入口加载按选定来源，不静默install发布版覆盖并行本地代码。
- [ ] 当前factory仍加载旧pi-memory时不能最终删历史后宣称完成；安排不加载旧包的下一次会话执行清理并确认恢复提示。用户若不重启，明确“代码/配置完成、旧数据删除待重启”，task不当作完全验收。
- [ ] 在旧插件不再加载后核lstat/归属/清单，只删除根MEMORY.md/SCRATCHPAD.md/daily/recovery中确认旧数据；不递归删memory根、不碰projects/未知条目/symlink。
- [ ] qmd当前不可用/default目录不存在；执行时若发现共享索引只清已确认独占pi-memory collection，不卸qmd、不删整个数据库。
- [ ] 验证旧数据不会重新生成、工具只注册新实现、projects与其他个人配置/Claude/Pi/Trellis保持不变。

## 回滚与风险
- 实现阶段回滚仅本任务hunks，不能git reset/checkout整树。原数据删除前不得偷偷复制正文到恢复库；用户明确清理意味着数据删除不可恢复，清单保留元信息不保留记忆内容。
- 包配置变更保留最小原配置diff用于操作回滚；若重新启用旧包会再次生成数据，需要明确提示。
- 手工/外部编辑不遵守锁、secret扫描漏判、主模型漏记、外部超大库达扫描上限均公开说明，不宣称全自动或无限制。
- 全部AC与真实本机阶段完成后再提议收尾；本地阶段提交已授权，push/archive仍另获授权。
