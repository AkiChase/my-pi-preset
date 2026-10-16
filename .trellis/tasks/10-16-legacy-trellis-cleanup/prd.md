# 清理旧 Trellis 开发文件

## 目标与授权

用户已批准删除前述清单第 1–4 类；第 5 类运行记录、会话绑定和模板备份不得改动。仅清理本项目部署目录中的遗留文件，不修改包源代码或历史任务材料。

## 范围

- 删除 `.trellis/agents/implement.md`、`check.md`。
- 删除 `.trellis/.version`、`.trellis/.template-hashes.json`、`.pi/.pi-trellis-hashes.json`。
- 删除 `.trellis/scripts/__init__.py`、`common/cli_adapter.py`、`common/task_queue.py`、`hooks/linear_sync.py`。
- 删除 `.pi/subagents.json`，不迁移其中的设置。
- 清理 `.trellis/scripts/common/__pycache__/` 和空 `.worktree/`；只移除清理后为空的遗留父目录。
- 删除 `.trellis/config.yaml` 中旧 channel worker guard 配置及说明，精简确认无当前 Pi 消费者的 prompt injection 说明；保留仍被 runtime 消费的配置与说明。

## 边界与验证

- `.trellis/.runtime/` 全部内容、路径和文件模式必须保持不变。为遵守用户限制，使用 `create --no-start`，不运行会写入会话绑定的 `task.py start`；任务状态不作为执行授权来源。
- 保留受管 runtime、角色、skills、manifest、任务历史和其他并行改动。
- 主会话直接实施和自审，不启动 agent；删除的是已定位无当前调用的部署遗留文件，不改变公共接口。
- 单阶段检查：删除目标不存在；runtime 全目录哈希/模式快照一致；受管脚本保持完整；配置保留预期键；Python 入口只读冒烟；`git diff --check`。
- 核对实际 diff 后，仅提交本阶段精确文件和本任务最小材料；不 push、不 archive、不记录 journal。

## 验收

1. 以上遗留文件与空目录已清理。
2. 当前 Pi Trellis 的受管资源未被删除或更改。
3. runtime 全目录快照一致，其他并行工作未包含在提交内。
4. 最终记录说明执行命令、结果和未执行的验证。

## 实施与验证结果

- 已删除 10 个遗留文件、Python 缓存目录，并移除清理后为空的 `.trellis/agents/`、`.trellis/scripts/hooks/`、`.worktree/`。
- `config.yaml` 已删除 channel 配置块及无当前 Pi 调用的 per-turn prompt injection 说明；保留被 Python runtime 消费的 Codex 与 context injection 说明。
- 主会话自审实际删除范围和 config diff；不启动子代理。未更新通用 spec：本次仅清理项目遗留部署文件，无新增执行契约。
- Python 快照断言：`.trellis/.runtime/` 的 22 个文件/目录路径、SHA256 和模式在删除前后及冒烟后完全一致；除批准编辑的 `config.yaml` 外，81 个受管资源快照中的其余文件均未改动。退出码 0。
- `TRELLIS_CONTEXT_ID=pi-fcf7981e0465 python3 -B .trellis/scripts/get_developer.py`：退出码 0，身份为 `akichase`。
- `TRELLIS_CONTEXT_ID=pi-fcf7981e0465 python3 -B .trellis/scripts/task.py current --json`：退出码 0，仍为 no-task；未写入会话绑定。
- `TRELLIS_CONTEXT_ID=pi-fcf7981e0465 python3 -B .trellis/scripts/get_context.py --mode packages --json`：退出码 0，发现 development/testing。
- 配置验证首次误用不存在的 `load_config`，ImportError，退出码 1；改用 `_load_config` 后又误将解析器返回的字符串 `2000` 当整数比较，AssertionError，退出码 1。检查实际消费者后，使用 `get_max_journal_lines` 验证整数值 2000；最终脚本退出码 0，其他保留值正确且 channel 已不存在。两次均为检查脚本错误，未修改产品修复。
- 所有 Python 检查使用 `-B`，未重新产生缓存；`git diff --check` 退出码 0。
- 未运行全量测试、TypeScript typecheck 或真实 Pi/provider 验证：当前运行代码未改动，仅移除无当前调用的遗留部署文件与配置。
- 单阶段精确提交：仅包含 10 个删除文件、config 编辑、本 PRD 和 task.json；不包含既有并行工作。检查点哈希由最终交付列出，避免提交后追加记录产生第二次提交。
- 为遵守 runtime 不动的限制，任务仅作为清理记录保留在 planning；没有 start、archive、journal 或生命周期提交。
