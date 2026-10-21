# 在同步清单中声明 pi-btw

## 目标

将 `npm:@narumitw/pi-btw` 加入本预设的受版本控制包清单。用户下次运行本仓库的同步命令时，由既有同步逻辑将它安装到用户级 Pi 环境；本次不直接安装或修改用户级 Pi 配置。

## 已确认事实

- `pi-preset.json` 是本预设的所需包状态；`scripts/sync.mjs` 读取其 `packages`，并通过用户级 `pi list`、`pi install`、`pi update`、`pi remove` 对齐状态。
- 该同步逻辑明确禁止管理 Pi 自己维护的 `settings.json.packages`，因此不能通过项目 `.pi/settings.json` 声明此同步包。
- `.pi/settings.json` 目前只有空的项目本地 `packages` 数组；项目本地包需要项目信任，且不属于本预设跨机器同步的安装路径。
- `pi-btw` 的 npm 来源是 `npm:@narumitw/pi-btw`；它提供 `/btw` 临时旁支提问命令。

## 范围与要求

1. 在 `pi-preset.json` 的 `packages` 添加 `npm:@narumitw/pi-btw`，版本策略与其他第三方包一致，使用 `latest`。
2. 更新 README 的第三方插件列表和新增的中文用户说明，使用户知道同步后可用 `/btw <问题>`。
3. 说明本次只更新清单；实际安装发生在用户之后运行 `./install.sh` 或选定 `packages` 域的同步命令时。
4. 不执行 `pi install`、`./install.sh` 或 `pi update`，不改 `~/.pi`、项目 `.pi/settings.json`、依赖或第三方源码。

## 验收标准

- [ ] `pi-preset.json` 包含 `"npm:@narumitw/pi-btw": "latest"`，且不与 `conflicts` 重复。
- [ ] 在隔离的同步脚本测试中，该清单条目会生成正确的 `pi install npm:@narumitw/pi-btw` 计划，而非本次执行真实安装。
- [ ] README 列出 pi-btw，并链接到中文说明；说明准确写明同步路径、基本 `/btw` 用法和未在本预设中覆盖的额外配置。
- [ ] 不产生用户级 Pi 配置或包安装副作用；相关测试、JSON 校验和差异检查通过。

## 范围外

- 本机或其他机器上实际安装、更新、卸载 pi-btw。
- 修改 pi-btw 的模型、快捷键、面板布局或其他插件配置。
- 管理项目本地 `.pi/settings.json` 的 packages，或修改同步器实现。

## 实施与验证计划

单阶段、主会话直接完成：更新包清单与用户文档，并为清单条目补充同步脚本隔离测试。运行 `node --test scripts/sync.test.mjs`、JSON 解析和 `git diff --check`；不拉取依赖。此改动只扩展现有 manifest → sync 合约，主会话自审即可。代码、测试与文档在验证后同一 scoped commit；不包含并行会话改动。

## 实施与验证结果

- 已在 `pi-preset.json` 添加 `npm:@narumitw/pi-btw: latest`，未修改项目 `.pi/settings.json`、用户级 Pi 设置或包目录。
- 新增 `docs/packages/pi-btw.md`，并在 README 第三方插件列表添加链接；文档说明同步命令、`/btw <问题>` 基本用法及不由预设覆盖的配置。
- 新增隔离回归用例，读取真实预设清单并以临时 agent 目录和伪 `pi` 命令运行 `--sync packages`，断言计划包含 `install npm:@narumitw/pi-btw`，不触及真实用户配置。
- 验证环境：Node `v24.14.1`。`node --test scripts/sync.test.mjs` 退出 0，7 PASS；JSON 解析、README 本地链接断言与 `git diff --check` 退出 0。
- NOT_RUN：`./install.sh`、`pi install`、`pi update`、`/reload` 及真实 TUI 使用；这些操作会改变用户级 Pi 环境，超出本任务范围。
- 本任务是直接实现与自审，种子 role manifest 有意为空；未将 `task.py validate` 的空 manifest 诊断描述为成功验证。单阶段已验证，准备 scoped commit；不自动归档或处理并行会话改动。

## 授权与材料状态

用户已澄清原任务不应进行即时全局安装，而是将配置加入当前预设、以后由同步正确安装，并在确认后明确要求实施。原 `install-pi-btw-global` 任务已更名为本任务以反映更正范围。直接实现与自审不派发角色，种子 JSONL 保持空；启动时明确使用 `--allow-empty-context`，不将空 manifest 描述为完整验证通过。
