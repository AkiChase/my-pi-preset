# AGENTS.md

个人 pi 配置预设，不是应用。`extensions/` 下的 `.ts` 由 pi 直接加载，**无构建步骤**。

| 路径 | 作用 |
| --- | --- |
| `pi-preset.json` | 清单：`packages` 要装的，`conflicts` 不能当 pi 包装的，`settings` / `keybindings` 要对齐的 pi 配置，`preserve` prune 时也不动的键 |
| `install.sh` + `scripts/sync.mjs` | 把本机对齐到清单（三个域：packages / settings / keybindings） |
| `extensions/` | 自带扩展，pi 自动发现 |
| `local/` | 本机草稿：计划、笔记、临时脚本。**已 gitignore**，不进仓库，也别在这里放代码 |
| `README.md` | 面向使用者的全部文档 |

## 铁律：改代码就得改 README

| 改了什么 | 同步更新 README |
| --- | --- |
| 增删扩展 | 「这里有什么」总表 + 「本仓库自带的扩展」 |
| 扩展的行为/命令/键位/配置 | 对应扩展小节；涉及键位看「键位冲突」 |
| `packages` | 「这里有什么」总表 + 「第三方包」 |
| `conflicts` / 改为本仓库代为加载 | 「由本仓库代为加载的包」 |
| `settings` / `keybindings` / `preserve` | 「这里有什么」的清单声明段 + 「声明设置和键位」；改键位还要看「键位冲突」 |
| `sync.mjs` 同步语义 | 「工作方式」的情况→动作表 |
| `install.sh` / `sync.mjs` 选项 | 「安装」「命令行选项」 |
| 新增脚本或检查手段 | 「开发」+ 本文件 |

vendor 进来的第三方代码（如 `extensions/bg-tasks/`）留 PROVENANCE 说明来源与版本；之后就是本仓库的代码，直接改，不往上游合。

## 命令

```sh
pnpm install            # 开发依赖
pnpm check              # typecheck + test，提交前跑
pnpm link-sdk           # 重建 pi SDK 软链（pnpm install 后可能需要）
./install.sh --dry-run
./install.sh --sync settings --dry-run   # 只看配置会怎么变
```

用 pnpm，不要 `package-lock.json`。别人机器上的运行时依赖由 pi 用它自己的包管理器（默认 npm）安装，不读 `pnpm-lock.yaml`：`dependencies` 保持宽松范围，`devDependencies` 不会装到那些机器上。

## 检查

`@earendil-works/*` 是 peer 依赖，运行时由 pi 提供，故意不装。`scripts/link-pi-sdk.mjs` 从本机 pi 安装里软链过来（可用 `PI_SDK_DIR` / `PI_BIN` 覆盖），`typecheck` 和 `test` 都会先跑它。

- `tsconfig.json`：`noEmit` + strict，只检查 `extensions/**/*.ts`。别用 `any` / `@ts-ignore` 糊，必须压制时写明原因。
- 测试用 `node --test`，放 `extensions/<ext>/__tests__/*.test.ts` 或 `scripts/*.test.mjs`。必须离线、不碰 `~/.pi`。

## 约定

- 注释写**为什么**：多数代码在绕 pi 或第三方扩展的具体行为，点明哪个版本的什么行为、不这么做会怎样。
- 代码/注释/提交信息用英文，README 和本文件用中文。
