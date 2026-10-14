# 真实终端验收

## 结论

对实施提交 `7abd9fe` 的当前原字节产品代码执行真实 installed CLI 验收，最终 **89/89 PASS，report.error=null，exit 0**。没有修改产品代码。

命令：

```bash
python3 .trellis/tasks/10-14-beautify-tool-names/research/tmux-harness/acceptance.py acceptance-final
```

环境：Pi 1.2.0、tmux 3.6a、dark/fullscreen、140→80→40→140 列；窗口高 180 行以容纳完整展开标题和代码。独立 tmux 服务、env -i、临时 HOME/agent/config/cwd/sessions/logs；明确加载本仓库 beautify/task-composition、测试离线 faux provider 和已安装 ask-user-question。无网络、安装、个人同步、reload、现有 pane 操作。

## 验收范围

- read、find、grep、bash、read-error、jobs list、get_subagent_result not-found 各宽度均保完整准确工具名，不重复前缀；真实 Ctrl+O 展开保名称和已返回正文，收回正文消失、名称保留。
- 长 Bash 标题只省略参数，`bash` 名称不省略；40 列 get_subagent_result 保名称，Agent ID 与统计让出空间。
- read offset 和返回行数/limited、搜索统计、错误摘要、jobs action 与工具名共存。
- Bash 真实执行等待态保 `bash` 名称，释放自有测试 gate 后完成。
- 已安装 ask_user_question 的真实问卷控件出现在终端底部（ask-dialog.txt:166-172），Escape 取消返回；调用记录仍为小写注册名 `ask_user_question`，不是 label `Ask User Question`。原插件文件和交互未修改。
- resize 判定使用原始 CLI 写流中结束的 synchronized frame 和新宽度精确 border，而非裁旧 tmux frame。

最终证据：`tmux-acceptance-final-report.json`（89 项）；文本/SGR屏幕和 `terminal.raw` 原字节保存在 `tmux-acceptance-final.tar.gz`，初两轮同样压缩保存。原 ANSI 写流包含有意义的行尾 padding/CR，因此不进行 whitespace 修剪；JSON、脚本、报告的 whitespace 单独检查。tmux capture 是文本证据，不称图片截图；离线脚本 provider 不称在线模型自主执行质量。

## 两次夹具失败与核验

1. `tmux-acceptance/report.json`：60 行窗口的 grep 展开后标题滚出可见区，错误判标题缺失。原始 terminal.raw 中标题 `grep  MARK in sample.ts` 和 MARK_48 同在完整发出帧，产品标题未丢。增高到 180 行，保持名称断言不变。
2. `tmux-acceptance-tall/report.json`：read-error 收回后摘要仍合法包含 ENOENT，旧等待条件要求整屏没有 ENOENT 因而 timeout；failure.txt 明确工具为 collapsed，标题及摘要存在，正文已隐藏。夹具改为判断独立正文行而非摘要片段，未改产品行为。
3. 最终 bvjua3shf，日志 `/tmp/pi-bg/bvjua3shf.log`，10.06 秒，89 PASS/error null/exit0。

## 清理与其他验证

三轮 CLI PID 36709、80861、98426 均自然 /quit 退出，ps 确认不存在；三个自有 tmux server 已停止、隔离配置目录删除。最后产品与 7abd9fe 无 diff。之前最终定向 71/71 自然退出、strict typecheck 和全量 699/699 的输入没有变化，复用该有效结果，不机械重跑。

主会话验收，不是独立 review。其他 jobs action、get_result 真 child 完成/verbose、light/system、regular、物理鼠标/IME、个人 input-history 组合：NOT_RUN；相应既有组件回归不称真实终端验收。极窄不足名称宽度的安全截断在组件测试覆盖，本轮终端最窄40列。

无需产品修复或新增规范。仅保存本任务验收材料，不推送、归档或 journal；任务保持 in_progress 待用户接受/授权收尾。
