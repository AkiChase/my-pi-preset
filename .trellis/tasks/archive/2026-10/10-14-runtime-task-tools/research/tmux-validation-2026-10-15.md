# 真实 tmux 验证（2026-10-15）

## 结论

当前 stage2 代码上的核心矩阵 **PASS：8/8 场景，exit0，report.error=null**；实际截图SGR逐显示cell背景检查 **8/8 PASS**。这是限定 dark/fullscreen 的真实 CLI 证据，不是完整 task 验收，独立 review 尚在执行，子会话组合等未运行门仍开放。

## 环境／命令／隔离

已有 Pi1.2.0、Node24.14.1、tmux，未安装/链接SDK/同步或reload。主会话直接运行目标工作区产品。独立 reviewer只读，不同时改产品。

```sh
cd .worktree/10-14-runtime-task-tools
python3 .trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/driver.py \
  --run --implementation-settled --label main-cleanup-fixed --workflow
python3 .trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/check-background.py \
  .trellis/tasks/10-14-runtime-task-tools/research/tmux-runtime/evidence-main-cleanup-fixed
```

每轮 unique tmux -L、env-i临时HOME/agent/cwd/sessions/logs/TMPDIR，offline本地fauxprovider、显式-e target beautify/task-composition与fixture，禁发现context/extensions/skills/themes/MCP，无个人auth/在线provider。fixture只决定真实toolcall，生产注册／backend／renderer照常执行，无私有registry读写。

## 实际覆盖

- actual host六工具存在，旧执行名称不存在。
- task_manage list：140→80→40→140，等待真实新宽完整rawframe而非裁旧screen，Ctrl+O展开/收回；40列hint整体省略。
- registered not_found error真实返回，Ctrl+O展开正文再收回。
- background bash真实OS执行，稳定task_id/run_id，list、128-byte分页省略、search/stats、wait partial、实际/bg释放后status/PID仍running，再wait取BASH_FINAL并证PIDgone。
- actual child subagent_run：explicit localfixturemodel＋继承parentmodel，先真实builtinbash再fauxfinal answer，task_manage pending/output/wait取完整563字符24行CJK/combining答复，Ctrl+O往返不再取结果。
- monitor真实stream：wait不因首事件完成，实际Esc只取消retrieval、status仍running；stop观察stopped并证PIDgone；finite monitor gate后wait最终输出。
- workflow简单零agent脚本progress＋对象return，task_manage wait完整WORKFLOW_FINAL，不把日志当脚本return。
- summary真实SGR按每显示cell解析背景（含左右padding）：list三宽、error、bashwaitpending/final、childfinal、monitorfinal共8行，success(37,65,49)、pending(52,56,58)、error(91,40,42)，所有bad_columns=[]。不是仅搜48m；capture的SGR跨行状态持续，短行右padding采用实际行末activebg。未对任意其他frame/theme作声明。

## 初次失败保留／仅修夹具

`evidence-main-first/report.json`：全部8功能场景PASS、error=null、CLIexit0、ownedPIDgone，但driver_exit1。唯一清理失败：CLI正常退出后自己的tmuxserver已结束，重复kill-server返回“no server running”。主会话fresh限定-L probe证实无server，ps确认无ownedPID；不是产品失败或未清理资源。

仅修driver finally：kill-server错误后做fresh同-L list-sessions，只有exit1且stderr明确no server running才记already_exited。保原首轮report不改；重跑完整矩阵 `evidence-main-cleanup-fixed`，exit0、全部同门PASS。之前已补CLI非0退出强制FAIL，未放宽产品hard断言。

## 最终清理与证据

`evidence-main-cleanup-fixed/report.json`：CLI65881正常quit、exit0、cli_pid_gone=true、residual_owned_pids={}、own_server_stopped=true（已自然退出）、isolated_config_removed=true。frame raw302100bytes、events139560bytes完整保留无省略；逐步text/ANSI/raw及worker exitJSON同目录。全部server命令带unique-L，不触个人panes。capture是文本/SGR屏幕不是图片，输入是实际tmuxsendkeys不是physicalmouse链路。

## NOT_RUN／开放门

nestedchild真实scope/ALS组合、subagent_message真实终端、workflowpaused菜单stop/复杂树、WS、light/system/regular、physicalmouse/IME/任意插件组合、onlineprovider质量、externalpi-trellis组合。这些不被8/8总数覆盖；独立checker须判断合同实现与必要补测，main不据此直接归档。外部适配未实施且当前用户文档明确发布前置。
