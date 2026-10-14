# 主会话最终验证

## 实际复核
已完整读取入口与5个生产模块，实施报告、独立check报告和TESTING；核查README/manifest/actual loader diff保留并行Beautify hunk。独立check仅自修editor/provider与11个回归；主会话读实际修复而非只信summary。唯一private能力仍tryTriggerAutocomplete(false)。

## 主会话复跑
后台job bbvoibocy使用已安装SDK与临时PI_CODING_AGENT_DIR，set -e/trap清理，退出0：
- `node --test extensions/at-path-completion/__tests__/*.test.ts`：60/60，0fail/skip，自然退出；完整日志 `/tmp/at-path-main-focused.log`。
- `pnpm check`：strict typecheck通过、完整671/671，0fail/skip；完整日志 `/tmp/at-path-main-full.log`。
- 结果摘要 `/tmp/pi-bg/bbvoibocy.log`。全量带项目force-exit，不作为自然清理证据；定向自然退出。

独立check另跑related47/47、manifest6/6，详见 [check-report.md](./check-report.md)。四类修复及红证据保留；没有确认未修范围内缺陷。

## 文档与范围
主会话更新owning extension/testing规范的连续补全契约，保已有并行hunks；PRD AC按离线证据勾选，明确真实PTY/IME/actual input-history未验。任务仍in_progress，未stage/commit/push/install/sync/reload/archive，不修改其他任务或SDK。

## 真实 tmux 与提交前确认
主会话完整读取tmux driver/probe、验证报告、汇总JSON、清理审计和40/80列实际捕获。dark/fullscreen固定140/80/40列均PASS；原生fd提供候选，probe只观察公开输入/文本/提交，未直接控制补全。两次夹具FAIL原样保留及归因，不据此改产品。六次实际CLI自然退出，unique服务停止、临时root删除；scope限制见 [tmux-validation.md](./tmux-validation.md)。

提交前主会话重跑隔离 `pnpm check`（job b0mowq7cj）exit0，完整671/671与strict通过，日志 `/tmp/at-path-precommit.log`。仅文档/任务材料在复验后更新；产品hash与真实tmux轮次一致。

## 已知限制
Pi1.2.0验证基线，不代表未来内部语义保证。只按原生provider返回候选，空目录无列表，不改变ignore/递归/排序/20cap。未知不delegate wrapper不保证增强；不额外监听全局focus，纯瞬时离开再返回无输入不承诺感知。独立helper规则与actual loader回归防Node-only子路径导入错误。
