# tmux harness 运行说明

这些脚本仅是本任务研究材料，不是生产插件入口。只调用已安装 Node/Pi/tmux/fd；不安装、下载或连接在线模型。所有持久输出限定于本任务 `research/tmux-harness/`。

- `driver.py` 每次生成唯一 `tmux -L` 服务和临时 HOME/config/cwd/sessions；以 `env -i` 加载当前独立扩展和公开只读 probe，禁自动发现。默认 140×40 fullscreen dark 最小矩阵；`--full` 增加路径、file/submit、forceTab。
- `probe.ts` 仅使用公开 `onTerminalInput`、`getEditorText`、`input`、`before_agent_start`、`registerShortcut(F9)` 和本地 faux provider。`after-input` 在真实 host 输入处理后的 setImmediate 读取文本；F9 仅在已完成目录候选画面后使用，不能插入 pending continuation 来取消工作。没有取得或直接操作 editor，没有 private request，没有自定义候选。
- 每个字符单独 `tmux send-keys -l`，等公开 after-input 后才发下一字符；Tab/Enter/Escape 通过真实 `send-keys`。目录接受的 pending 阶段只等屏幕，不注入辅助键。
- 屏幕为 `capture-pane -p`/`-p -e` 文本和 SGR，不是图片。初始 frame 的完整宽 border 另核原始 CLI 写流。每个宽度用独立 session，不发生 resize，不把 tmux 裁剪视作新宽度 render。
- 等待均为有界条件循环（poll间隔 select），没有固定 sleep；Escape 必须先等关闭画面，再观察320ms无反弹。初版漏关闭画面 barrier 的 FAIL 保留于 `evidence-first-140/`。
- finally 用真实键发送本session `/quit`，核 pane dead status、actual CLI PID gone、unique server stopped 和 config removed；异常或断言失败 exit1，清理失败也非0。每轮 report 存完整启动命令、每项结果、源码 SHA256和清理证据，raw/events每文件限制2MB。

运行（由源项目根执行，绝对路径脚本）：

```sh
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt minimal-fixed --width 140
python3 .trellis/tasks/10-13-at-path-continuation/research/tmux-harness/driver.py --attempt matrix --width 140 --full
# 不复用同一个 --attempt/--width 输出目录；已存在目录会拒绝覆盖。
```

最终结论与未覆盖项见上级 `tmux-validation.md`/`.json`。不可仅看进程 exit0，必须一起审阅 report.error/cases/cleanup。
