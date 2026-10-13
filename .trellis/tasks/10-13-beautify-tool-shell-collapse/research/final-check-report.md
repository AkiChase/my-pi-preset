# 最终定向独立复核

## 检查范围与结论

完整读取 `extensions/beautify/layout.ts`、新增 `terminal-layout.test.ts`、`terminal-fix-report.md`、green report、terminal-fix runner，以及注入的 owning spec。未提供 Review base，未审查已提交历史；本轮仅最终 terminal 修复，不重复六工具全范围审查。

- F1 红证据有效：原实现三项逐打印 cell 背景断言失败，分别在列32、4、139出现 default；不是仅搜索48m。实际 Pi1.2 `pi-tui/dist/utils.js:130-141,1018-1043` 确认纯ASCII截断、空marker仍追加0m。两处 clipPlain 仅清理标题head与已清理stats的截断结果，保SDK列预算，随后现有fg/host Box负责样式；未清除expanded/Shiki样式。
- F2 分类可信：独立查看 repro/observed/green raw synchronized writes；repro没有40列border frame，却有80列frame，截图裁剪不证明CLI收到resize。observer轮存在38内宽/真正40列frame，但最终runner不加载observer。新barrier只接受offset之后、2026l闭合frame的恰好新宽度border，不能把80列末尾40列当新frame。独立重跑40列hint完整省略，80/140完整显示，Ctrl+O往返通过。
- spec已要求条件等待、审阅cases/error/cleanup、区分fixture与产品、声明dark/fullscreen和stdin mouse等限制。非阻断文档建议：main可把本轮“raw已闭合新宽frame barrier，不能仅看capture border长度”写入spec第6条；当前细节只在research/runner中。

## 实际验证

- 临时 `PI_CODING_AGENT_DIR`：`node --test extensions/beautify/__tests__/*.test.ts`，69/69 PASS，自然退出，含terminal4项；输出 `/tmp/beautify-final-independent.log`。
- `python3 .../tmux-harness/terminal-fix.py check-final`：9/9 PASS、error=null、exit0、2.18秒。证据 `terminal-fix-check-final/report.json`；自然CLI退出、PID gone、仅自身server停止、临时config删除均true。
- `git diff --check` PASS。无独立lint命令。本轮未重复typecheck/full suite；implement671 strict/full/natural是已有证据，不标为本轮执行。

无确认的窄产品bug，无产品编辑。仅本报告与runner生成的定向research证据新增；未改README/host-loading-smoke/at-path/.pi，未commit/archive/install/reload/push。light/system/regular、其他实际六工具矩阵、物理鼠标、真实history仍未验证；提交前full gate及AC收尾由main完成。
