# 验收报告：Session Name 两次自动命名与共享上下文

日期 2026-10-15。阶段提交：S1 `cfc47d3`，S2 `025d41c`，规则调整 `6efb5b9`（用户当日决定：不必保守；手动标题不再自动改名；状态只存计数与最后ID）。

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| S1 材料抽取到 `shared/material.ts`，Recap 行为不变 | PASS | 主核 diff：Recap 仅改导入；shared 不依赖 recap；与 `b48e37b` 基线哈希比对算法未变 |
| 每 session 最多两次自动请求，无第三次 | PASS | 测试覆盖60+输入、reload、resume、tree切换；机会在请求前消耗 |
| 失败/取消不补偿；无模型或无内容不消耗 | PASS | runtime 回归测试 |
| 失败提示显示真实剩余输入数 | PASS | 审查后修复并补测试 |
| 手动标题（`/name`、`/session-name`）及来源不明标题不被自动覆盖，reload 后仍保护 | PASS | runtime 测试含 reload 后30条输入 |
| 旧v1或不可读v2状态按新会话处理 | PASS | 用户决定；测试覆盖 |
| 状态仅 `{phase,count,anchor,lastCountedId}` | PASS | 字段测试；`second` 缺 anchor 视为不可读 |
| 离分支 lastCountedId 不重复计数 | PASS | 主核 + 独立审查：候选 `after` 排除既有消息 |
| prompt 无 `currentTitle`，三种请求共用材料（预算32000，不读 recap.json） | PASS | harness 捕获请求材料 |
| 定向测试（session-name/recap/shared）自然退出 | PASS | 92/92，exit 0 |
| `pnpm check`（typecheck + 全部测试含 scripts manifest/sync，force-exit）临时 `PI_CODING_AGENT_DIR` | PASS | 927/927，HEAD `6efb5b9` |
| `git diff --check`、task.json/check.jsonl JSON、session-name.md 相对链接 | PASS | |
| 独立审查 | PASS | S2 审查通过（2项非阻塞已修）；规则调整审查无阻塞，spec 旧"failure backoff"已更新 |
| 在线模型标题质量 | NOT_RUN | 无在线授权；fake provider 不代表质量 |
| 真实终端/tmux、install、sync、reload | NOT_RUN | 未授权 |
