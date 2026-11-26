# 实施与验证计划

## 阶段 1：统一两种模式（单一耦合提交）
- [x] 用户明确“开工”，任务已 start（`--allow-empty-context`）；主会话直接实施。实现时识别新增共享配置契约，按 workflow 在自审后追加独立 `trellis-check` 只读审查，准备 check.jsonl；未使用 implement 派发。
- [x] 已完整阅读相关 extensions SDK 文档、summarize 示例、兼容/对话/开发/测试规范、两个插件相关 source/tests/fixtures。
- [x] 新增窄共享模型模式解析与选择 helper，保持行为存储和生命周期在各自消费者。
- [x] 两个配置/菜单/请求接入；缺失默认 follow，已有独立值继续 custom，新增明确模式优先。
- [x] 回归覆盖模式解释、非法配置、支持等级/文本/auth、菜单取消和新鲜补丁、切换保留独立值、请求参数快照、无主模型的独立请求。
- [x] 更新两个中文用户文档、维护范围及已有英文开发/测试契约。
- [x] 主会话 diff 自审与独立 `trellis-check` 只读审查完成；产品功能无实质问题。专项及类型检查通过，全量两个无关失败已单独复现并记录，不标为全量 PASS。
- [x] 阶段已本地提交：`65d10a76ced1dec8f966eaac2ecf2d5f6d493a28`（`feat(session-assist): support follow and custom model modes`）。仅本任务代码/测试/文档/必要任务材料，未包含 `pnpm-lock.yaml`。功能阶段后仅更新本实施记录的提交证据。

## 命令与隔离
执行前在仓库外 `mktemp -d` 建立本次 owned run directory，agent-dir 和原始日志都置于其中。仅使用已安装 SDK/工具，不做依赖安装或 fetching。执行全部默认配置相关测试时设置 `PI_CODING_AGENT_DIR=<owned-run>/agent`，按 testing spec 从现有链接解析 `PI_SDK_DIR`。

自然退出专项：
```sh
node --test extensions/session-assist/session-name/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts extensions/shared/interaction/__tests__/dialog.test.ts extensions/shared/interaction/__tests__/sdk-dialog.test.ts
```
实施前确认上述文件存在；不使用 force-exit。随后运行现有 `pnpm check`（类型检查加全量套件），不得因工具缺失自动下载安装。最后 `git diff --check`、两份用户文档链接/配置说明核对、`git status --short` 和 scoped diff 审查。

## 执行记录
主会话在源目录 main 实施，已有 `pnpm-lock.yaml` 修改保持不动。owned run directory 为 `/tmp/session-assist-model-modes.4RSQ8K`，原始日志与临时 pnpm 启动器均在仓库外。
- 初始自然退出专项：退出 0（接入两种模式后、扩充测试前）。
- 第二次自然退出专项：退出 0（新增模式/菜单/SDK 回归）。
- 首次 `pnpm typecheck`：退出 2。失败仅为新共享测试夹具传入 `{}`，遗漏必需的 `model` 属性（model-config.test.ts 两处 TS2345）；已改为 `{ model: undefined }`，未绕过生产类型检查。
- 最终自然退出专项：退出 0，156/156 PASS（包括模型字段修复、已选参数对覆盖并发模型字段修改的回归）。
- `pnpm check`：退出 1；类型检查已通过，全量 1943 项中 1941 PASS、2 FAIL。两项失败均为本任务之外的 scripts/package-manager.test.mjs：现有用户 lockfile 含 SDK 包内容而触发“不含 SDK peers”静态断言（51 行）；已缓存 pnpm 10.33.0 的 `run` 不支持 fixture 传入的 `--registry`，原生 package-manager case 拒绝执行（76 行）。
- 单独复现 `node --test scripts/package-manager.test.mjs`（同一 `PNPM_TEST_BIN` 和隔离环境）：退出 1，3 PASS、2 FAIL，复现相同两项失败；该测试不导入本任务产品代码。未修改 lockfile、无关测试或工具去掩盖失败，保留专项 PASS 与全量 FAIL 的区别。
- 独立 `trellis-check`（agent_trellis_check_0_adf699cd）只读审查：完整阅读任务/规范/产品/新文件，未发现实质模型功能问题。仅指出 Session Name 用户文档已有的版本历史措辞；已改为当前“命名状态无法恢复”行为说明，无产品变更。未将主会话自审当作独立审查。
- 用户文档配置 JSON 示例通过生产 parser，两个页面相对链接与 check.jsonl 六项引用存在性检查 PASS；`git diff --check` PASS；spec discovery 仍为 development/testing。
- 执行前后 `pnpm-lock.yaml` SHA256 一致；SDK linking 均为 0 new，没有依赖安装/下载。未运行在线 provider 质量或真实终端外观验证（NOT_RUN），未配置独立 lint 命令。
- `task.py validate`：退出 1，未使用 implement.jsonl 为 0 curated entries；check.jsonl 六项通过，development/index 超过 32768 字节注入预算警告。审查者已直接完整读取该文件，不把片段注入或 manifest 检查当作全文阅读证据。

Node v24.14.1，实际 SDK Pi 1.5.2。使用已缓存的 pnpm 10.33.0 `bin/pnpm.cjs`，临时 PATH 启动器固定此入口，`COREPACK_ENABLE_NETWORK=0`，没有执行安装或依赖下载。设置 `PI_CODING_AGENT_DIR=<owned-run>/agent`、`PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.5.2/node_modules`；SDK link 报告 `0 new`。全量检查还设置 `PNPM_TEST_BIN` 为同一缓存入口。
start 给出 main 同时为 base_branch 的归档/PR 警告。收尾前确认：功能提交直接位于 main，本任务从未建立 PR，task.json 的 pr_url 为 null、无独立任务分支；按 CLI 为 never-PR-backed 任务提供的 `archive --skip-branch-validation` 处理，不伪造 branch/base_branch、不改历史。implement.jsonl 保留未使用的空文件，不把 task validate 空 manifest 诊断报告成完整验证通过。

完整原始日志暂保留在上述 owned run directory，用于两个仓库全量失败的后续核查；没有复制到任务 evidence/research，也没有清理其他会话材料。任务只保留 PRD/design/implement、task.json 及角色上下文，无原始输出。

## 完成边界
用户明确“好的，收尾吧”，接受交付及此前披露的验证限制，授权本任务归档、清除绑定和日志记录及对应本地提交。收尾时功能代码未发生新变化，复用最终专项、类型检查和独立审查结果，不重跑未变代码；仍不声称全量 PASS。
归档前已检查全部六份任务文件：仅保留必要规划、实施结论、task.json 及角色上下文，无原始输出或重复审查报告。工作区只有既存 `pnpm-lock.yaml` 修改，归档/日志提交均须排除它。不包含 push、安装或个人配置更改。
本次 owned 临时目录因两项无关仓库测试失败仍待后续处理，保留诊断日志，不宣称已清理。
