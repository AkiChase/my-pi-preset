# 阶段 2 实施报告（2026-10-15）

## 首先分离通知越界改动

只按 3bedbcc 原始行为分离两处 hunk：

1. `agent-manager.ts` description 恢复 `options.description`，删除 `${type} task` fallback。
2. `index.ts` scheduleNudge catch 恢复忽略 stale side-effect error，删除直接 raw console.error。

保留管理消费、wait、run snapshot、通知抑制及 group 结算等本任务 owning 接线，没有整文件 restore。初轮全量因此 **692/693 FAIL**：误入的 RPC 缺 description 回退测试仍期待 `general-purpose task`。诊断保存于 `stage-2-initial-full-natural.log`。该需求归 planning 通知任务，未在本任务实现或弱化它的需求；改为本任务实际需要的、提供显式 description 的 RPC raw ID → task_manage 互通测试，继续严格验证成功 reply／真实 ID／完成通知／完整 answer／旧名不存在。缺 description 通知可靠性留独立 owner，不宣称修复。

## 当前交付的产品切片

### 唯一接口与有限管理

- `task-composition.ts` 单次注册 task_manage，组合 local process、root agent/workflow 或 child owned branch capability；没有同名 nested customTools override。
- 新公开集合为 bash、monitor、subagent_run、subagent_workflow、subagent_message、task_manage；删除 bash_bg/jobs/get_subagent_result 和旧 Agent/SubagentWorkflow/steer_subagent 注册，无 alias、历史 ID 或 renderer 迁移。
- runtime-tasks/contracts/facade 验证七 action、逐 action/type 字段、version=1 元数据、安全 counts／range、task_id/run_id 精确 binding、stale／ambiguous／forbidden／unsupported／closed。list/status 不调用结果检索或消费；process search/stats 保原 owner。
- launch 返回模型可见 task_type/task_id/run_id 和 runtimeLaunch。前台／后台／detach 使用同一执行身份，不替换 PID／日志。nested foreground resume 原中断实现漏身份，本轮补齐 stable task_id＋新 run_id。

### 后端行为

- process management 保字节页范围／省略、regex/context/count/20-hit display cap、activation 累计统计、wait partial/final、日志失败不消费。wait 解除／取消不停止目标；monitor 等完整监听结束，事件通知仍归原 owner。
- Bash notify:false 仅允许 explicit run_in_background=true；success/failure 都抑制完成通知。普通后台 timeout 不强杀，非 auto-background 安全 timeout、日志 marker 和启动失败 rollback 保留。
- agent terminal answer／formatted conversation 捕获于 resolve，不被同步 resume 改写；精确 run consume 和通知副作用围栏保留。输出／wait 不以 UI 16K preview 替代最终 answer；pending usage 通过新注册边界单次上报。
- agent stop 原中断实现文本观察 stopped、details 却仍取 admission running；本轮仅修为 stop 后观察快照，并加实际 manager 回归。文本明确 cancellation cooperative，terminal 不代表 actual drain。
- workflow 创建即有 terminal，初始化失败／提前取消和不可序列化 return 都能 settle；不可变 final text/logs、wait/consume suppression、cancel reconsider、静默 stop、paused replay 拒绝保持。worker/host drain 不由 terminal 代替。
- child handoff 使用 graph-stable ALS 可撤销 holder，undefined mask 外层 scope，加载结束释放 builder。能力限 parent/run owned branch；root descendants 可见但不可被根模型直接管理，child 不访问 root/sibling。live exclusions/readmission/deny/narrowing 无旧名。

### Beautify 当前源码成果迁入

只读比较 source 自 3bedbcc 的 layout/shared/optional/jobs 和 tests，局部迁入适用 hunk；没有复制整混合文件或恢复已删除旧 adapter。

- layout 保 clipPlain reset 防护，secondary 先让位给完整 expand hint；新增工具名独立 heading 预算。
- shared/optional 保确切工具名先于长详情、收缩单行、pending/success/error host 背景和一次 padding。旧 jobs title 去重思想迁到 task_manage action detail，不恢复旧 jobs renderer。
- task-manage 保 version/action/type/id/run 匹配，七 action／四 type、可靠用量／duration／range、wait released/cancelled 的 target unchanged、stop requested/observed。身份／action 作为可靠 secondary，展开仅显示已返回正文。
- 未知 metadata/version/details={}／动态 same-name 工具仍原 renderer 或安全 fallback；不增加 I/O／消费。subagent_run/workflow/message/monitor 没有新启动 renderer。
- 原 Read/Bash/Find/Grep host、控制字符／窄宽／背景／image／异步 highlight 回归保留。源新增的工具名与长标题矩阵按新合同迁入。

### 维护记录

更新 agent-tasks/process-tasks 两份 PROVENANCE 的新接口偏离；Beautify TESTING 增当前 guard／注册路径并修旧归档链接，历史计数保留为历史。当前英文 testing spec 的单条名称修订由 main 完成，本 Agent未覆盖。活跃源码注释、Task Panel 非 TUI 提示和模型使用说明清旧名称；任务／上游 provenance／负向 alias 测试不机械改写。

## 自动验证：真实命令与结果

环境：Node **v24.14.1**，安装 SDK **1.2.0**；使用 source ancestor 现有依赖，只读 compiler：

```sh
cd /Users/jyxc-dz-0101322/tools/my-pi-preset/.worktree/10-14-runtime-task-tools
agent_dir="$(mktemp -d)"
export PI_CODING_AGENT_DIR="$agent_dir"
trap 'rm -rf "$agent_dir"' EXIT
node /Users/jyxc-dz-0101322/tools/my-pi-preset/node_modules/typescript/bin/tsc -p tsconfig.json
node --test extensions/runtime-tasks/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts
node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"
```

整个 test 调用在临时 PI_CODING_AGENT_DIR 下；所有测试自然退出，**无 force-exit**。测试完成只删除本调用自建配置目录。

| 轮次 | 结果 | 证据 |
| --- | --- | --- |
| 初轮 strict | PASS / exit 0 | stage-2-initial-strict.log（成功无输出） |
| 初轮 full natural | FAIL / exit 1，692/693，单个越界 description 测试 | stage-2-initial-full-natural.log |
| 迁入 source renderer＋通知分离后 strict | PASS / exit 0 | stage-2-iteration-strict.log |
| 该轮 focused | PASS / exit 0，135/135 | stage-2-iteration-focused.log |
| 最终 strict | PASS / exit 0 | stage-2-final-strict.log（成功无输出） |
| 最终 owning suites natural | PASS / exit 0，616/616，66 suites | stage-2-final-focused.log |
| 最终 full natural | PASS / exit 0，699/699，72 suites | stage-2-final-full-natural.log |
| whitespace | PASS | git diff --check＋所有 owning TS/MD/MJS trailing whitespace 扫描 |
| active old-name audit | PASS，0 active hit | stage-2-active-name-audit.log |

final automated logs由后台job bd4cs3qgk产生，strict/focused/full均exit0。随后改动仅更新源码注释里的旧名称，不改变执行行为。没有独立 lint 脚本；pnpm check 未运行，因为其 link-sdk 会写依赖链接，采用直接等价 strict＋full natural，不执行安装或 force-exit。

新增 decisive 注册/owner 回归：`runtime-tasks/__tests__/public-process.test.ts` 两项、agent stop metadata 一项、tool-waits usage 一项、Beautify 两项工具名预算矩阵；nested resume 原有实际 delegation test新增模型可见身份硬断言。红证据仅本次初轮失败，不宣称每个新 case 均做 defect restoration 红测。

## 实际验证覆盖与未完成硬门

已由自动测试验证：actual cached host loader 根六工具／child唯一 local manager，same/different cwd、本地 Bash＋finite branch output、shutdown不删root、重复factory；overlapping child marker 与独立root、ALS holder退役；live denylist/readmission/late extension scope；actual manager旧run terminal/conversation/resume、通知consume/group、启动回滚与actual进程/worker/host lifecycle；注册工具七动作、process字节页/search/count/stats、subagent最终/verbose/usage；workflow final/error/multiple waits/stop；actual SDK renderer backgrounds/mouse/default/self/fallback。

**仍需主会话独立核验／不夸大覆盖：**

1. 尚无 independent check，本报告是实施自检。main 必须审 actual diff与scope/消费/renderer，然后运行tmux；不勾最终 AC。
2. tmux fixture 仅 main/其他Agent准备，本 Agent **NOT_RUN**。真实 CLI 140/80/40 resize、Ctrl+O、新管理 partial/final、wait释放与退出清理尚待主会话。
3. actual host composite branch smoke 使用有限 stub branch capability；actual manager branch 与 live runner denylist分别测试，不等于完整真实 child provider 中 launch nested＋own process＋重叠 branch 的端到端证明。overlapping child marker/ALS、nestedoff local manager有测试，但完整 owned branch重叠／noExtensions/isolated/ext narrow组合矩阵未逐项实际host验证。
4. workflow worker paused stop有真实runtime回归；注册 workflow case名中的 paused部分实际只覆盖 running owned-child stop，不能冒称注册菜单 pause→stop全链路。已有菜单/runtime原回归保留。
5. 协作式在线provider cancellation、任意host hook、外部包组合、物理mouse/IME、light/system/regular主题 **NOT_RUN**；终态不是强杀／全drain证明。
6. 外部 pi-trellis 新工具门禁／provider probe未实施、未安装或更新当前 clone，组合发布仍待外部owner。RPC原协议/rawID保留仅证preset接口，不代替外部门禁验收。
7. 缺 description通知可靠性／安全sink诊断归另task；此次专门分离，不能用full绿宣称该需求已修。
