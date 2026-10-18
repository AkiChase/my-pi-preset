# 清理锁文件镜像地址

## 目标

让提交的 `pnpm-lock.yaml` 不再绑定开发环境的 Artifactory 镜像，保留现有依赖版本、依赖图和完整性校验。

## 已确认事实

- 清理前 `pnpm-lock.yaml:37` 起共有 51 个 `resolution.tarball` 指向 `a.z01.normandyfunc.com/artifactory/api/npm/npm-public/`；当时 HEAD 与工作区锁文件一致。
- 每个受影响包均有 `integrity`，锁定的是常规 npm 包版本，没有发现需要保留的定制 tarball 依赖。
- `.npmrc:1` 只有 `auto-install-peers=false`，没有仓库级 registry 设置。
- 规划时 pnpm 为 `10.33.0`；有效 registry 为另一个 Artifactory 地址，`lockfile-include-tarball-url` 查询结果为 `undefined`。这证明当时环境使用镜像，但不能证明历史地址生成的具体配置。

## 范围与技术决策

- 仅删除这 51 个显式镜像 `tarball` 字段，不替换为另一组写死的 URL。
- 保留全部 `integrity`、依赖版本、importers、snapshots 及其他字段。
- 不修改 `package.json` 或项目 `.npmrc`；将 `~/.npmrc` 的默认 registry 改为 `https://registry.npmjs.org/`，保留 `@step.ai` 和全局 `@neo-code` 专用源及其他个人配置。不升级依赖、不删除并重建整份锁文件。
- 不增加清理脚本、CI 或用户文档。防止未来镜像元数据再次写入需要另行评估，本任务不承诺自动防复发。

## 验收标准

1. 锁文件不含原镜像地址，移除字段数精确为 51。
2. 清理后的文件与原文件仅在上述字段上不同，所有完整性校验及依赖图保持不变。
3. pnpm 能在仓库外临时目录中接受清理后的锁文件和原 `package.json`：拟执行 `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/`。此检查不下载依赖、不运行安装脚本、不改仓库 `node_modules`；仅验证锁文件接受性，不证明公网实际下载成功。
4. `git diff --check` 通过，实际 Git diff 不混入其他任务改动。
5. npm/pnpm 有效默认源均为 `https://registry.npmjs.org/`；个人配置除默认 registry 外逐字保持不变，作用域专用源不变。

## 执行计划与检查点

单阶段，由主会话直接编辑并自审；不派发代理，两个角色 JSONL 有意保持空白。范围明确且可逐字段验证，不涉及运行时或公共接口改动。

获批后启动任务，精确编辑锁文件，在本任务拥有的系统临时目录保存验证输出（个人配置仅保存预期摘要，不复制认证内容），执行上述验收检查。完整应用测试不覆盖此类 URL 清理，不作为本任务必跑项。检查通过后提交本任务范围的本地提交，记录命令、结果、限制和提交哈希。不给予 push、历史重写或其他任务改动授权；归档及日志记录由后续收尾授权覆盖。

## 授权状态

用户已批准本方案实施、验证和范围内本地提交，并明确认可修改本机默认 registry、保留两个作用域专用源及继续清理锁文件。随后用户说“收尾吧”，认可交付并批准归档、清除任务绑定、日志记录及其本地提交。授权不包含 push 或历史重写。

## 执行结果

- 主会话直接实施并自审，已删除 51 个镜像 `tarball` 字段；`~/.npmrc` 默认源已改为 npm 官方源。
- Python 字节级基线比较：PASS，退出码 0。清理后锁文件等于原 HEAD 锁文件仅删除指定 51 个字段的结果，所有其他字节保持不变。个人配置摘要等于仅修改默认源的预期摘要，全局 npmrc 摘要不变；未复制或输出认证内容。
- 在仓库外临时 fixture（仅复制 `package.json`、锁文件和项目 `.npmrc`）执行 `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/`：PASS，退出码 0，pnpm `10.33.0`，输出 `Done in 124ms`。随后 `cmp` 验证 fixture 锁文件未变化，退出码 0。
- `pnpm config get registry` 和 `npm config get registry`：PASS，均为 `https://registry.npmjs.org/`。查询 `@step.ai:registry`、`@neo-code:registry` 并断言与原值相同：PASS，退出码 0。
- `git diff --check`：PASS，退出码 0。实际 diff 仅清除锁文件地址；其他任务已有变更未暂存或提交。
- 实现检查点：`1c07d8b` — `fix: remove environment-specific lockfile tarball URLs`，仅提交 `pnpm-lock.yaml`。个人配置不属于仓库提交范围。
- NOT_RUN：联网下载、实际依赖安装及完整应用测试；本次只证明锁文件可被 pnpm 接受，不证明公网下载或私有包服务可达。
- 未修改长期 specs：没有新增产品接口或项目级约束。两个未使用角色 JSONL 有意为空，start 使用 `--allow-empty-context`，不声称完整 manifest 校验通过。
- start 提示当前分支与 base_branch 同为 `main`；本任务直接在 `main` 提交、从未创建 PR，收尾使用官方 CLI `archive --skip-branch-validation` 的非 PR 任务选项，不伪造分支元数据或改写历史。
- 用户已验收交付并授权收尾；本任务临时验证目录已清除，未 push。
- 归档已移至 `.trellis/tasks/archive/2026-10/10-18-clean-lockfile-mirror/`，状态为 `completed`，当前会话任务绑定已清除。自动提交失败：旧任务目录从未被 Git 跟踪，归档提交包含该旧路径导致 `pathspec ... did not match any file(s) known to git`。采用仅包含实际归档目录的显式 pathspec 手动补交，不重跑归档、不修改工具或其他任务。
- 补交前 `git diff --cached --check` 发现 PRD 文件尾部多余空行，提交因此未执行；移除该空行后重跑检查并补交。日志记录命令已先行完成并提交，本任务归档材料另行范围提交。
