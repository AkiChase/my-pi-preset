# 阶段2实现与自检记录

## 范围与结果
仅修改 `extensions/memory.ts`、新增 `extensions/memory/prompt.ts` 和 `extensions/memory/__tests__/prompt.test.ts`、更新 `tools.test.ts` 的事件集合；另写本阶段 research 记录/日志。未改 store/security、PRD/implement进度、SDK、其他插件或个人配置。阶段1安全断言保持不变。

- 每次 `before_agent_start` 删除/覆盖本次 `systemPromptOptions.sections.project_memory`，保留其他 sections 和 options；不 append、不替换完整 systemPrompt、不缓存前一轮索引。
- 每轮重新读取 enabled；开启时复用实际 `store.scan()` / `buildIndex()`，只读 frontmatter 元数据，不读正文、不发布磁盘索引。空库仍有固定英文保存规则。
- 四类 user/feedback/project/reference、显式记住及时保存、排除流水/任务/code/Git/AGENTS/凭证、先读 revision 更新、按观察验证行动均在固定规则中。
- 失败只显示固定白名单诊断；不输出原异常、路径或秘密，不回退旧索引。初始化失败保留同 activation 的安全诊断，shutdown/epoch/cwd 围栏继续有效。public agentDir symlink 祖先仍拒绝，没有 realpath 自动信任。
- 无后台模型、watcher、新增 timer、退出 flush 或子代理调用。

## 实际验证方式
使用已安装 Pi 1.2.0、Node v24.14.1。所有命令的 agentDir 为本次自建临时目录，脚本在退出时只删除该目录；测试内部另用 realpath 临时 agent/cwd/session/model 路径。没有下载、install、个人 settings/session/memory 访问或 reload。

实际 provider 测试：`ModelRuntime.create(refreshOnCreate=false, allowModelNetwork=false)` → 本地 `registerProvider.streamSimple` → `DefaultResourceLoader.extensionFactories` → `createAgentSession` → `bindExtensions(print)` → `session.prompt`。使用 pi-ai 公开 `getCurrentSystemPrompt(context.messages)` 与 `getCurrentSystemMessage(context.messages)` 检查重放后的当前 prompt/sections。没有私有 registry 或 prompt 算法副本。

覆盖两个独立 prompt、修改元数据/正文后只更新元数据、手改磁盘 MEMORY.md 不被读取/写回、实际 SessionManager 文件持久化并 `SessionManager.open` 后新 factory resume、空库、enabled→disabled→enabled、保留其他扩展 section/append/guidelines/snippets、秘密/损坏/OS错误/目录容量/UTF-8索引裁剪、索引外 memory_list 发现、SDK startup失败/禁用移除诊断；每次提交恰好一个本地模型请求。
注册级 typed fixtures 补充 cwd 变化、重叠异步初始化、shutdown 时成功/失败迟到、symlink startup refusal。复用真实入口和 prompt owner，不复制算法。原 loading.test 实际 jiti loader 仍通过。

## 命令与首失败
以下 setup 每轮相同：
```sh
set -eu
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
trap 'rm -rf "$agent_dir"' EXIT
set +e
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
```
实际分别重定向日志并捕获每条命令 exit，不用最后一条成功掩盖前一步失败。

| 轮次 | focused（自然退出，无force-exit） | pnpm check | 日志 |
|---|---|---|---|
| first | FAIL exit1；27通过/1文件失败 | FAIL exit2，TypeScript阶段；全量未运行 | `stage-2-focused-first.log` / `stage-2-check-first.log` |
| second | PASS exit0，33/33 | PASS exit0，strict + 806/806 | `stage-2-focused-second.log` / `stage-2-check-second.log` |
| final | PASS exit0，35/35，4021.101583ms | PASS exit0，strict + 808/808，27013.209792ms | `stage-2-focused-final.log` / `stage-2-check-final.log` |

首失败是测试 fixture 误从公开 package root 导入仅内部声明中存在的 `normalizeBuildSystemPromptOptions`，以及 `getCurrentSystemMessage` 可返回 undefined。修复为注册 fixture 提供完整 typed options（不是复制 normalization 算法），provider 测试继续使用实际 SDK normalization；访问 helper 结果采用 optional chain。产品没有为 fixture 修改 SDK 或增加内部导入。
second 后补实际 OS read失败、SDK startup失败/disabled移除诊断及shutdown失败迟到用例，最终重新运行两条检查。

`git diff --check` exit0；新建两个 TS 文件逐行尾部空白/末尾换行检查 PASS；逐文件实际 diff 复核，只有允许范围变化，其他 dirty/untracked 保留。full suite 使用仓库配置的 force-exit，因此自然退出证据以 focused 为准。

## 限制与后续
- 本报告是实现者自检，不是独立 trellis-check；主会话需审阅并派独立检查后提交。
- 未做 online provider、自主保存质量、真实 CLI/PTY、TUI、面板、个人配置迁移/删除、安装/sync/reload。
- startup失败保留诊断但不偷偷重试 identity 或恢复写权限；新 session_start 才能重新初始化，关闭的 factory 永不恢复。
- disabled 删除当前结构化 section，不承诺擦除历史 transcript；测试检查重放后的 CURRENT prompt。
- 本子代理未 commit/start/finish/archive/push，也未写主会话负责的 PRD/implement进度。
