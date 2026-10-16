# pi-claude-memory 0.1.2 只读研究

## 证据
- npm registry 当前 latest 0.1.2，源码 https://github.com/elecnix/pi-claude-memory ，tag 对应 cd38f533ebf6f3894e10914ee2b0053e47ee2c88。
- 下载发布 tarball 未安装、未执行；main 复读完整 README、extensions/claude-memory/index.ts 与 memory-core.ts。
- 临时完整研究报告 `/tmp/pi-claude-memory-research-z8wc6ewe/report.md`，临时材料不可作为永久执行依赖。
- Claude 官方说明 https://code.claude.com/docs/en/memory 。

## 结构
`~/.claude/projects/<cwd-slug>/memory/MEMORY.md` 是 bullet markdown link 索引；旁边各 `name.md` 是带 name/description/metadata.type frontmatter 的具体记忆正文。memory_list 实际枚举目录顶层 .md，排除 MEMORY.md，读取各文件的摘要，不是另一份独立存储。memory_write 替换正文并更新索引；空/缺失/null body 删除，无恢复 API。

## 注入与限制
index.ts:34–51 每次 session_start 重置 injected，首个 before_agent_start 标为已注入，仅追加索引，不追加正文。合法索引存在时仅使用索引；没有任何合法 pointer 才退回文件枚举。一次写入或外部编辑不刷新注入。
无记忆总数、正文大小、索引行数、token/字符上限、分页、TTL、淘汰或自动合并。展开 diff 30 行只是显示限制，不是容量限制。
Claude Code 官方 200 行或 25KB（先到者）的启动 MEMORY.md 读取限制在此包未实现；不要混同。

## 生命周期
只有 memory_read、memory_write、memory_list。无后台总结/嵌入/检索引擎/每日日志/退出 shutdown handler/网络请求/子进程。保存依赖主模型调用工具，fs 同步操作，写工具使用 Pi 同文件 mutation queue。无全局 memory scope，user 类型仍是项目目录里的类型标签。

## 作用域
路径由绝对 ctx.cwd 将 / 和 . 替为 - 直接生成，不按 Git 根和 worktree 归一，不读取 Claude 自定义 memory 目录/config/禁用设置。因此不保证与当前 Claude Code 所有启动方式共享同一目录。

## 当前 Pi 1.2.0 兼容风险（主会话复核）
已安装 Pi dist/core/agent-session.js:1300–1367 明确将 before_agent_start 返回 systemPrompt 作为当前 run 的临时 forceSystemPrompt，不写入 transcript；1431–1438 finally 清空 _runSystemPromptOptions。包 injected=true 后后续独立 run 不再返回索引，因此首轮有索引不等于会话后续仍有。未做运行时复现，应在隔离 host 测试确认后选择最小处理，不能宣称 npm 原包完整兼容。

## 当前方案说明
本文件记录早期npm包研究，不是当前产品要求；npm替换方案已被用户否决。用户已确认自研精简项目记忆、主模型主动保存、`/memory` 列表→独立详情，使用 `<agentDir>/memory/projects/<项目ID>/`。最终需求以PRD/design为准。

## 本机旧包清理清单
- memory_status：旧目录 `/Users/jyxc-dz-0101322/.pi/agent/memory` 默认路径，约 56KB。
- 实际文件 MEMORY.md、daily/2026-10-12.md、daily/2026-10-13.md；执行时重新核实。
- 当前 qmd 不可用，默认 ~/.config/qmd、~/.cache/qmd、~/.local/share/qmd 不存在，不需要假定有索引删除。
- ~/.claude/projects 下存在 7 个其他项目 MEMORY.md，绝不清理；本项目映射目录目前不存在。仅统计存在性和文件名，未读其正文。
- 本机个人 settings.json 配置 npm:pi-memory，preset pi-preset.json 同样声明，README 有现行文档。

## 授权
用户要求开task，清理仅旧pi-memory插件历史数据，不是Claude Code记忆；已批准完善自研规划。仍未获开始实施批准，未卸载/安装/删除任何数据。
