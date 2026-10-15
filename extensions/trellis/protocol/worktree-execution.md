# 托管 worktree 执行

未绑定任务可直接在共享源目录通过 `trellis_dispatch` 派发。本页适用于主动选择托管 worktree 的任务；首次管理操作前阅读。命令从**源项目根目录**执行固定入口 `python3 .trellis/scripts/worktree.py`，精确选项见各子命令 `--help`。

## 材料来源与执行目录

主 worktree 是任务、项目 workflow、规范和角色 JSONL 的唯一权威来源。子 worktree 用于产品代码和测试，不保存本任务的执行材料副本。派发提供经过宿主验证的绝对 sourceRoot/materialRoot、taskPath/specRoot/workflowPath，以及独立 executionRoot 和子上下文身份；不把材料正文放进 prompt，也没有“已完整注入”捷径。

子 agent 先完整读取源 PRD、可选 design/implement 和 workflow，再读取本角色 JSONL 及全部选中引用；research 不要求 implement/check manifest。材料相对路径从 sourceRoot 解析，代码和测试在 executionRoot 操作；单次 read 截断必须分页补齐。目标 checkout 自然存在的 `.trellis` 保持原样，即使其中任务/spec 过时或缺失也不参与当前材料解析。源材料失效时明确报错，**不回退目标副本**。

## 创建与准备

先按项目 workflow 批准并 start 源任务。预览不写入、不预留；确认必须处于已有用户授权内，不因 CLI 参数获得额外权限：

```bash
python3 .trellis/scripts/worktree.py create --task .trellis/tasks/<slug>
python3 .trellis/scripts/worktree.py create --task .trellis/tasks/<slug> --confirm
python3 .trellis/scripts/worktree.py prepare --task .trellis/tasks/<slug> --role implement
python3 .trellis/scripts/worktree.py prepare --task .trellis/tasks/<slug> --role implement --confirm
python3 .trellis/scripts/worktree.py status --task .trellis/tasks/<slug> --json
```

- `create` 从提交创建分支目录，不复制源未提交代码；`adopt --path <已注册worktree>` 接纳同仓库、分支支持的已有目录，不接受任意目录或 detached worktree。
- 默认基点为当前 HEAD；需固定时用 `--base <完整commit>`。创建不安装依赖、启动任务或子代理。
- 默认目录为源根 `.worktree/`；可在 `.pi/pi-trellis.json` 配置 `{ "worktree": { "directory": ".worktree" } }`。相对路径从源根解析，只影响新创建；既有绑定保留原绝对路径。
- 源目录需忽略 worktree 目录和 `.trellis/.runtime/`，目标也需忽略 runtime；CLI 只检查，不自动改 `.gitignore`。
- `prepare` 验证源材料、身份和目标执行配置，只登记忽略的 runtime 状态；不复制任务/spec、不改目标 task.json、不调用目标 task start 或 hooks。准备前后目标 Git status/diff 保持不变（忽略的 runtime 除外）。
- `--role` 可选 `implement`、`check`、`research`，默认 implement；另一角色的失效 manifest 不阻断本次角色。重复 prepare 只验证当前源材料，不同步或重新 start。
- 目标需有兼容运行时和持久 adapter 配置；不兼容时拒绝，不自动补装。项目资源检查入口是无参数 `/trellis-init` 菜单的 **Check**；目前只报告资源/接管事实，不等于完整 worktree readiness 验证。

## 派发与状态

主 Pi 会话保持源根目录，准备完成后调用模型 tool `trellis_dispatch`：

```json
{ "agent": "trellis-implement", "task": ".trellis/tasks/<slug>", "prompt": "实施已批准范围；只修改指定产品文件" }
```

返回真实 agent ID，可用于 `task_manage` 查询/等待结果和 `subagent_message` 指导。provider 使用已存在的目标目录和 `isolation: off`；不临时创建 worktree，绑定损坏或未准备不回退源目录。父进程一次性 `-e` 不足以保证子会话加载，源/目标或用户 settings 需持久配置 adapter。

状态按角色报告源材料路径、诊断和已完成检查是否仍新鲜。源要求指纹与执行 checkout 快照只是证据，不证明 agent 实际完整读取，也不代表验收；需求或代码变化可能使旧结果过时。主会话仍须审查报告、实际 diff 和测试。

## 源材料变化与职责

源材料可以包含获批的未提交内容。发现失效引用时，主 agent 根据源路径和 JSONL 行号核实迁移，在已有材料维护授权内修正源引用，重新查询并派发；无需同步目标材料。运行中要求变化由主会话通知和复核，不假装子 agent 已读到新版本，也不自动取消或推进阶段。

子角色默认只读源管理材料、修改目标产品代码/测试并返回结果和证据；主会话维护任务、规范和生命周期。明确授权可允许 research 写源任务 `research/*.md`，或 implement/check 写源任务 `evidence/`；读取权限、任务身份和工具可用不代表任意源写授权。研究目录不保存实施/审查报告或测试日志。

仅支持严格 version 2 源权威绑定；旧格式或未知记录明确拒绝，不自动转换、删除或清理。原来的 `refresh`、`collect` 已删除，不提供材料复制/收集或迁移命令。产品代码集成另按获批 Git 工作流处理，不是任务材料同步。

## 停止、恢复与清理

starting/running/unknown 阻止同目录重复执行和管理写操作。`trellis_dispatch { "action": "stop", "task": "..." }` 仅请求停止，终态证据才释放占用。超时、关闭或不确定启动保留 unknown，需核查实际 provider/进程；不自动重试派发。

托管 `recover` 需证明 owner 已死，重置准备状态后再准备；不能修复任意身份、源引用或缺失运行时。共享源执行（未绑定任务的 `trellis_dispatch`）不适用此 recover。残留锁需人工检查，不猜 stale 删除。

`remove --task ... --integrated-into <保留提交的引用>` 先预览 ignored 文件风险，获批后确认；目标必须干净且提交已被该引用保留。普通 Git removal 不 force、不删分支、不删当前 cwd。真实产品或手动材料改动仍会令目标 dirty，需获批保存/集成，不能强制清空。已手动移除的目标可明确解除绑定，分支仍保留。

失败保留已有目录、分支、输出和错误状态，不承诺整次回滚。worktree 与角色规则不是 OS 沙箱；工具不自动推进阶段、安装、提交、合并或归档。
