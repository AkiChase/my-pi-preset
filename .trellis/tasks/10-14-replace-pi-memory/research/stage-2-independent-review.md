# 阶段2独立审查

## 结论
PASS：阶段2当前代码满足本阶段 prompt/生命周期合同。独立检查未发现需要修改产品代码的确定缺陷；补充两组回归覆盖后，focused 自然退出 37/37、strict TypeScript + 完整套件 810/810，均 exit0。主会话仍需核对实际新增测试和证据后决定阶段提交；本报告不是阶段3/4或整个替换验收。

## 审查范围与实际差异
- Review base：`f635dcc`。检查 `git status --short`、unstaged/staged diff、untracked 清单和 `git diff f635dcc HEAD`；本次检查时 base→HEAD 无已提交变化，index 无 staged 变化。
- 完整读取阶段2四文件：`extensions/memory.ts`、`extensions/memory/prompt.ts`、`extensions/memory/__tests__/prompt.test.ts`、`extensions/memory/__tests__/tools.test.ts`，以及阶段1真实 store/config/identity/tools/policy/paths 和 actual-loader 测试。
- 核对 PRD/design/implement、check.jsonl、stage-2-sdk-preflight.md、stage-2-implementation.md，以及开发/测试/复用/跨层规范。
- 只修改上述阶段2的两个测试文件及本 review 记录/原始本地日志；没有修改产品入口/prompt 或阶段1安全实现，没有触碰并行任务、SDK、个人配置或旧记忆。

## 核实的合同
1. SDK `ExtensionRunner.emitBeforeAgentStart` 每次 normalize 创建新的 sections/options 集合，本次 handlers 共享该 mutable options。入口只删除/覆盖自己的 `project_memory`；保留 peer/append/guidelines/snippets/cwd/customPrompt，没有跨 run options 缓存或一次性拼接。
2. SDK `AgentSession._prepareRun` 对 user 和 custom run 都调用 before_agent_start；`_preparePromptAndToolLoadout` 计算 CURRENT section diff。入口不存在 custom 排除。禁用时移除当前 own key，不宣称擦除历史 transcript。
3. store.scan 仅读安全 frontmatter，prompt 复用 scan/buildIndex，不读正文、不读磁盘索引内容、不 refresh/publish。读取/扫描预算、排序、完整 UTF-8 索引行和溢出提示沿用阶段1 owner，没有安全降级。
4. 固定规则包含四类与项目内 user、显式记住及时保存、主动保存限制、流水/任务/code/Git/AGENTS/凭证排除、先读 exact revision 更新/忘记、避免重复、不可用空正文删除，以及记忆非实时状态。
5. 无旧 metadata cache。失败输出白名单固定诊断，不回显 raw exception、路径或凭证。invalid config 是诊断而不是 disabled；明确 enabled=false 才移除 own section。startup 失败后修复配置不偷偷恢复 store，需 fresh session_start。
6. startup catch 先 assertActive，旧成功/失败异步完成都不能复活 activation。epoch/cwd/state identity/shutdown 围栏保留；shutdown 无模型调用/index flush/watchers/新增 timer。startup 失败后的工具仍 fail closed。

## 发现与补充
没有产品缺陷需要自修。原测试尚未直接覆盖以下两个阶段2边界，已补充：
- `prompt.test.ts`：实际 `session.sendCustomMessage(..., {triggerTurn:true})` 的四次独立 run。空库→写入元数据→禁用→带 enabled=false 但额外未知字段的 invalid config，验证 fresh metadata、正文不注入、禁用删除、错误非禁用、无秘密、CURRENT own section唯一；累计请求数严格等于四。
- `tools.test.ts`：startup config 失败后即使磁盘配置修复，read/list/write/forget 全部返回 isError/closed，没有项目目录创建或秘密回显；fresh session_start 后 list 恢复。

## 实际 host 验证
已安装 Pi 1.2.0，实际 `ModelRuntime.create(refreshOnCreate=false, allowModelNetwork=false)` + 本地 scripted stream provider + `DefaultResourceLoader` + `createAgentSession` + `bindExtensions(print)`，不是算法副本或 handler 字符串断言。provider 通过公开 `getCurrentSystemPrompt/getCurrentSystemMessage` 验证 CURRENT reconstructed prompt/sections；真实持久化 session 文件再 `SessionManager.open` 新 factory resume。

既有测试覆盖两 user run、metadata 外部变化、resume、新空库、enabled→disabled→enabled、其他 sections/options 保留、startup 错误、容量/metadata/secret/OS 错误、索引溢出与索引外发现；独立新增 custom run 和失败后工具安全用例。实际 jiti loader 入口测试、阶段1文件/锁/进程安全测试均在 focused 中运行。

## 验证命令与结果
每条检查从项目根执行，以已链接 installed SDK 解析 PI_SDK_DIR；使用各自 mktemp agentDir，trap 只清理自身临时目录；没有依赖下载或个人 agent/session/config 访问。

```sh
set -eu
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
trap 'rm -rf "$agent_dir"' EXIT
set +e
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts
# 独立另一 invocation 同样 setup：
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
# 实际分别重定向原始日志，捕获 result=$? 并 exit "$result"。
```

| 检查 | 实际结果 | 原始本地日志 |
| --- | --- | --- |
| focused，无 force-exit，最终两个补充回归已包含 | PASS exit0，37/37，4038.113334ms | `research/stage-2-independent-focused-first.log` |
| pnpm check（strict TypeScript + 完整配置套件） | PASS exit0，810/810，25987.22575ms | `research/stage-2-independent-check-first.log` |
| `git diff --check` | PASS exit0 | 工具输出 |
| check.jsonl JSON parse/file existence + 新增 TS 尾空白/末尾换行 | PASS exit0 | 工具输出 |

本次独立验证第一轮即成功，没有需保留的失败检查。实现者此前 first failure 记录及原始日志保持原样，未篡改或覆写。仓库无独立 lint script；未声称运行 standalone lint，静态验证是 strict TypeScript 和 whitespace。

## 限制与未验范围
- 完整套件使用仓库 `--test-force-exit`，不能证明自然退出；自然退出证据仅 focused 37/37。
- 未运行 mutation negative control；新增回归使用实际产品入口/SDK owner，不修改 SDK 或复制 prompt 算法。
- 本地 scripted provider 不证明在线 provider、自主保存质量或模型会执行所有语义指导。
- 未运行真实 CLI/PTY/TUI、面板、物理焦点/终端恢复、personal migration/delete、preset冲突整合、install/sync/reload；阶段3/4与AC9不在本次接受范围。
- 没有 commit/start/finish/archive/push、分支/历史操作或递归 dispatch。共享 source 中并行 planning 变化保持原样。
