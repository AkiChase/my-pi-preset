# 实施计划

## 规划门

- [x] 六工具范围确认：Read/Bash/Find/Grep + get_subagent_result/jobs。
- [x] 实际源码合同已读，文本metadata/attach partial/未知委托边界已写 design。
- [x] PRD完整收敛；不包含write/ls/bash_bg/monitor等。
- [x] 用户批准最新 PRD/design/implement，主会话已激活任务；子代理不管理 lifecycle。
- [x] 用户明确批准当前 source checkout、isolation off；worktree CLI 缺席，不安装／临时 isolation。

## 有序实施

1. [x] 读完整owning spec及Pi extensions/tui docs、核宿主Box内宽/行尾背景/MouseRegion；保存实际契约研究。
2. [x] 增加红测：四类背景/整块单行/两行合并/长错误降级/正文后台关键词；六工具call→result更新/鼠标/宽度。
3. [x] 公共shell=default并移除renderer自加outputPad；实现单行预算和状态组件。Read标题协议统一，保留异步高亮。
4. [x] 原四类错误/未知/后台/限制摘要与展开正文分离，保原文、附件、offset/notice。
5. [x] 增加get_result参数/头部契约guard、单行description/状态metadata及已返回全文；覆盖verbose/notfound/wait释放和取消。
6. [x] 增加jobs六action契约guard/摘要；attach partial/final及跟随解除不能变成停止job；分页/省略不藏完整返回说明。
7. [x] optional resolver + 原call/result state/lastComponent隔离与未知委托；无原renderer使用公开组件fallback。测试缺席/动态/历史/同名异形/格式漂移。
8. [x] actual tool离线harness产生代表返回结果验证contract，实际host验证背景/鼠标/callresult同步，保原execute/schema/content/details/structuredContent和消费语义。
9. [ ] owning spec/TESTING/README 已更新；定向136/136、完整严格601/601、完整自然退出601/601；待主会话独立 check 与实际 diff 审阅（不以自检替代）。

## 验证

临时PI_CODING_AGENT_DIR+实际只读SDK，不运行模型/网络/install。红测结果保存 task research；恢复后定向自然退出：

```sh
node --test extensions/beautify/__tests__/*.test.ts
node --test extensions/process-tasks/__tests__/{index,waits}.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts
```

按testing-guidelines隔离运行pnpm check；如修改宿主组合fixture，运行loading/task-ui相关回归。任务validate和git diff --check。不能为fixture错误放宽产品断言；独立check完成再更新AC。

## 交付/回退

展示only，不改变后端返回shape。不自动commit/push/install/sync/reload/archive。缺席工具用合成actual-host测试，不为验收安装插件；现有registered工具离线harness只读取测试生成内容。未知格式保原展示，允许例外多行并明确报告。当前无真实PTY授权，自动宿主渲染不代表终端全验收。回退仅owning展示代码/文档，不碰并行.pi及无关任务。

## 实施证据

详见 [implementation-report.md](research/implementation-report.md)。Pi 1.2 shell 在 call/result 前选择且没有 per-call context：普通 optional 分支 default host Box，仅原 renderer 明确 self 时用公开 Box/Container 切换，保证未知结果不双框；不修改 SDK／后端。jobs list 名称／命令可能有括号及状态同形文本，保守只显示验证过的记录数，不猜分隔位置或状态计数。可选未知格式保原多行例外。真实 CLI/PTY、实际 input-history/fullscreen 不在本轮授权范围；未执行。
