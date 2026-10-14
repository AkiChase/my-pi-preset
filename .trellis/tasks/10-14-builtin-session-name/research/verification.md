# 阶段验证记录

## S1 请求与上下文
2026-10-14 主会话严格类型检查与 `node --test extensions/session-assist/__tests__/*.test.ts` 通过，8/8，自然退出。实际SDK projection覆盖compaction、branch/context_edit；不truncate/budget，正文/摘要保留、tool/thinking/custom/bash排除，120秒deadline与noncooperative等待取消（测试缩短deadline，不改产品默认）。当前off以公共SimpleStreamOptions的undefined表示，无payload改写；SDK不支持时仍可能失败。

## S2 首轮产品切片
严格类型检查+focused20/20自然退出：初次/N轮/同标题进度、失败可见及N轮退避、未知标题/原生改名保护、晚返回/新输入/shutdown、配置保存/取消、duplicate/transform未知不计、reload、abort及并发手动刷新。

## S3 首轮整体
- 隔离 `pnpm check`：严格类型检查+693/693 PASS，日志 `/tmp/pi-bg/b8gnrp3an.log`。包含actual host loader，未包含之后新增的sync专用迁移断言/actual AgentSession test，不作为最终代码验证。
- focused+manifest+fake sync 专用迁移检查 PASS，日志 `/tmp/pi-bg/b9ku9z8km.log`，无真实安装；仅自有临时配置。
- `node --test extensions/session-name/__tests__/sdk-runtime.test.ts`：1/1 PASS，自然退出；真实AgentSession input/message/settled/name流、offline原生provider替换，无网络/认证/个人配置。夹具最初使用错误SDK导出与构造参数，修正为公开factory/create options/getModel后通过，未改SDK。

## 独立检查
只读general-purpose reviewer `c52298af-e29e-4f4` 正在审查core状态/计数/ownership/config/concurrency，主负责修复；不是trellis-check managed执行，不创建不满足已提交scaffolding条件的worktree。已完成：主定向修复三缺陷，独立复核103d3ed9逐机制确认无剩余阻塞，产品focused17/17通过（force-exit；自然退出证据沿用主25/25）。详见research/independent-review.md。

## tmux 真实终端验收

用户授权后，隔离 installed Pi 1.2 CLI、140×40 dark/fullscreen、离线 native provider，最终16项细分断言通过，report.error=null、自然quit exit0。覆盖初次命名、manual可见成功、config取消/保存/全局沿用、自动关闭、N=2阈值、native /name保护与manual恢复、失败消息可见及N轮重试、input/new取消晚响应。默认N=8在配置UI确认，动态阈值用N=2加速，不称默认8轮端到端。

主已读取实际报告、visible-failure.txt及cleanup-audit.json，重新运行audit.py：四轮自有PID均不存在、唯一tmux服务均停止、临时root均清理。当前七个产品源码SHA256与最终运行一致，无产品修改，不需重复产品测试。此前三轮夹具FAIL及两个非自然退出保留并区分，未确认产品失败。完整报告见[tmux-validation/report.md](./tmux-validation/report.md)。

## 限制与范围
无在线模型标题质量/任意插件变换组合保证；本次终端仅140×40 dark/fullscreen，不覆盖physicalIME/其他主题/resize/branch等，完整NOT_RUN见tmux报告。不自动stage/commit/archive/push/install/sync/reload。保留并行Trellis集成与其他task修改。
