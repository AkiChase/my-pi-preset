# 实施计划：Task Viewer 文档优先与归档浏览

## 约束

- 用户已批准本计划的实现，并要求使用托管 worktree；本任务可在上下文准备后 start。
- 不安装依赖、不修改归档文件或任务生命周期。
- 代码与代码注释使用英文；任务记录和用户文档使用中文。
- 由 `trellis-implement` 在托管 worktree 实施，由独立的 `trellis-check` 在同一托管 worktree 审查；主会话维护任务材料、检查结果与阶段提交。

## Stage 1：安全归档读取与测试

1. 在 `reader.ts` 中提炼/扩展安全任务加载流程，支持 active、archive-months 与 archive-month 三种只读快照范围。
2. 保持 active 调用的行为与既有树投影不变；归档月内列表不投影跨边界父子树。
3. 在 `task-browser-reader.test.mjs` 中新增归档浏览、排序、损坏/逃逸输入和文档读取回归覆盖。
4. 运行聚焦 Reader 测试与 typecheck。

**检查点：** Reader API、实现及其回归测试作为一个可验证阶段提交。

## Stage 2：导航和详情页

1. 在 `component.ts` 将详情 Tab 调整为 PRD、Design、Implement、Metadata，默认 PRD。
2. 实现文档顶部紧凑元数据摘要和完整 Metadata 页面。
3. 实现活跃列表的 `Browse archive` 行、月份/月份内列表、Enter/Esc 过渡、刷新/选择夹取、标题和提示文本。
4. 增补可行的 Component 覆盖；运行相关 Trellis 测试、typecheck 和 UI 影响的测试集。

**检查点：** Reader 与 TaskBrowser 集成、相关测试和用户可见导航成为同一提交，避免单独发布不可达的 archive Reader。

## Stage 3：文档与最终验证

1. 更新 `docs/extensions/trellis.md`，说明默认活跃任务、可见归档入口、月份浏览、只读限制和导航键。
2. 自审差异，确认无产品外改动、无归档数据改写，检查 Markdown 链接与 `git diff --check`。
3. 在隔离 agent 配置且复用既有 SDK 的环境中运行：
   - `node --test extensions/trellis/__tests__/*.test.mjs`
   - `pnpm typecheck`
   - `pnpm check`
4. 在 `implement.md` 记录每次实际命令、环境、退出码、首次失败及重跑结果；临时原始输出仅保存到仓库外的自有临时目录。

**检查点：** 最终检查通过后提交 Stage 3 的文档及任何验证期间的范围内修复；随后进入任务最终审查，不归档，等待用户验收。

## 风险与缓解

- **安全回归：** archive 是符号链接与旧数据较集中的目录；实现必须复用现有 containment/regular-file 校验，并以逃逸测试锁定行为。
- **TUI 状态复杂度：** 特殊入口行和月份列表不是 BrowserTask；以显式范围/selection state 建模，避免伪造任务记录或污染详情逻辑。
- **窄终端：** 新标题、页脚和摘要必须继续通过现有宽度处理/ScrollView 呈现，不能靠字符串长度假设。
- **并行改动：** 开始前与每阶段前检查 git diff，避免覆盖既有未提交工作。

## 执行记录

### Stage 1–2（实现与独立检查）

- 实现角色在托管 worktree `trellis/10-19-task-viewer-navigation` 完成 Reader、TUI、回归测试和用户文档改动；独立检查角色发现归档月内目录可经符号链接解析到其他月份的边界缺陷，已在范围内修复并新增回归用例。
- `node --test extensions/trellis/__tests__/task-browser-reader.test.mjs`：PASS，37/37。
- `node --test extensions/trellis/__tests__/*.test.mjs`：PASS，341/341。
- `git diff --check`：PASS。
- `pnpm typecheck`：NOT_RUN（环境阻塞）。SDK 链接步骤成功，但本地缺少 `tsc`，命令在源代码类型检查前失败；未安装依赖。
- `pnpm check`：NOT_RUN（同一 `tsc` 前置阻塞，未进入完整测试阶段）。
- 原始命令输出保留在仓库外的自有临时目录：实现 `/tmp/task-viewer-navigation-outputs/`；独立检查 `/tmp/trellis-check-task-viewer.sUS8hO`。
