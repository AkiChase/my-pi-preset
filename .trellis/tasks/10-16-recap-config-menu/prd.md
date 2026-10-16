# Recap 模型与思考档位菜单化

## 目标

用户通过 `/recap config` 选择模型和思考档位，无需记忆或手填 `provider/model-id`，避免配置了模型后仍因思考档位不受支持而生成失败。

## 背景与证据

- `extensions/session-assist/recap/index.ts:262–277`：顶层配置是菜单；Set model 使用 `ctx.ui.input`，Set thinking 使用全部固定档位的 `ctx.ui.select`，未按模型能力过滤。
- `extensions/session-assist/recap/config.ts:26–32,69–79`：模型与 thinking 必须显式配置；生成前校验模型注册、档位支持和认证。不沿用主会话模型，不静默回退。
- `docs/extensions/recap.md`：配置保存在 agent 根目录 `recap.json`，取消不写入、保存保留未知字段，已有请求保持其参数快照。
- 已有 `extensions/session-assist/recap/__tests__/lifecycle.test.ts` 和 `sdk-runtime.test.ts` 覆盖配置取消、上下文切换、参数快照及真实 SDK 命令边界；模型手填用例需随行为更新。
- 创建任务时相关产品目录与文档无已存在的 Git 改动；仓库另有 75 项未提交变更，必须保留。

## 范围

- 模型使用选择菜单，选项来自 Pi 模型注册表，推荐仅列已认证、可用于文本生成的模型；展示清晰的 provider/model-id，避免同名混淆。
- thinking 使用所选模型实际支持的档位菜单，而非所有固定档位。
- 无可用模型时提示原因，不回退手填，不修改配置。
- 保持显式配置、取消与过期对话框不写入、未知字段保留、在途参数快照等已有安全契约。
- 更新相关测试与 Recap 用户文档；不改变自动生成时机、主会话模型、配置文件格式或其他插件。

## 关键决策

用户已选择模型与档位联动：切换模型时，若 thinking 缺失或不兼容，立即接着展示新模型支持的 thinking 菜单，并在完成两步后一起保存；旧档位仍兼容则保留。任一步取消均不写入。

## 验收标准

- [x] Set model 不再要求用户手填模型字符串，可从注册表选择有效模型。
- [x] Set thinking 仅提供选中模型支持的档位，模型尚未有效配置时明确引导先选模型。
- [x] 切换模型时，缺失/不兼容 thinking 触发联动档位菜单，两步完成后一次保存；兼容的旧档位保留。
- [x] 空列表、任意步骤取消、导航或会话切换后迟到选择，不产生配置写入。
- [x] 已有合法配置继续可用，不静默替换模型或思考档位；未知字段与在途请求快照保持不变。
- [x] 相关回归测试、类型检查、整体测试及 `git diff --check` 通过；记录未运行或不可验证的限制。

## 执行与授权

- 用户已通过“开始吧”明确批准已审阅方案的实施、验证与 scoped local commit。已使用 `task.py start ... --allow-empty-context` 进入 in_progress；未派发角色，两个未使用 manifests 保持为空，不将其描述为完整 validate 通过。
- start 提示当前 main 同时是 base_branch，后续归档会拒绝同分支；本阶段不归档，也不擅自切换分支。
- 预计单阶段完成配置交互、测试与文档。计划主会话直接实施与自检；无权限/破坏性操作或公共跨模块接口变化，暂不需要独立派发。
- 验证计划：在本次创建的仓库外临时 agent 目录和现有 SDK 下执行 `node --test extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts`、`pnpm check`，并执行 `git diff --check`；测试不请求线上模型、不读写个人配置。真实终端体验如未实测须明确列为限制。
- 实施获批后按工作流完成检查与该阶段的 scoped local commit；不安装、不修改个人配置、不 push、不归档。

## 实施结果与验证

- 单阶段完成：`recap/index.ts` 配置菜单、`harness.ts` 菜单记录、`menu.test.ts` 回归覆盖、`sdk-runtime.test.ts` 真实 SDK 命令边界、`docs/extensions/recap.md` 用户说明。没有改变生成时机或配置文件格式。
- 模型菜单使用 public `getAvailable()`，过滤文本输入、认证与有效标识符；排序后用编号加有界标识符展示，长标识符不会因截断碰撞而选错。保存前重新校验注册表、认证、档位与文本输入能力。
- 主会话自检（非独立审查）：核对配置 UI → 注册表 → 能力 → 联动 patch → fresh atomic save → 后续请求快照；检查取消、导航/shutdown 迟到结果、无候选、伪造选项、未知字段保存及文档一致性。无需新增通用框架或 spec；本次沿用现有能力校验、取消 fencing 与原子保存契约。
- 测试环境：已有本机 SDK，通过 realpath 推导 `PI_SDK_DIR`；`PI_CODING_AGENT_DIR` 指向本次拥有的仓库外临时 agent 目录。离线 fixture provider，无个人配置与线上请求，无安装。
- 首轮 focused：72 tests PASS（exit 0）。新增真实 SDK 联动用例后 focused 失败（exit 1）：测试错误地预期未显式映射的 `xhigh`，SDK `getSupportedThinkingLevels` 实际返回 off/low/medium/high；产品过滤行为正确。修正预期后 focused 73 tests PASS，`pnpm check` PASS（1514 tests，82 suites，exit 0）。
- 自检补充保存前文本能力变化 guard 后，最终再次运行 `node --test extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts`：73/73 PASS，exit 0，自然退出；`pnpm check`：严格 typecheck 与整体测试 1514/1514 PASS、82 suites，exit 0。完整套件使用项目既有 `--test-force-exit`，不能代替 focused 的自然退出证据。
- `git diff --check` exit 0；Recap 文档本地链接与新增测试 whitespace 检查 PASS。没有单独 lint 脚本。
- NOT_RUN：真实终端键盘/视觉体验、线上模型生成质量；真实 SDK 测试使用 fake UI sink，不宣称真实终端实测。没有个人 sync/reload、push 或 archive。
- task material retention：仅保留 PRD、task.json 与空 role manifests；无研究附件或永久原始日志。临时日志在 main 检查后按本次目录范围清理，未清理其他会话或历史任务的材料。

- 已验证阶段 checkpoint：`0c74dd9`（`feat(recap): select models and compatible thinking levels from menus`），仅包含以上产品文件及本任务最小规划材料。
