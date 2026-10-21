# 实施计划：精简派发上下文并改进任务面板体验

## 授权状态

- 已获授权：创建任务、收集证据、完成需求与设计规划；用户在本会话明确回复“开始吧”，批准按已评审方案实施、验证和分阶段本地提交。
- 尚未执行：产品代码实现、阶段验证与实现提交。
- 未授权：推送、发布、部署、安装或下载依赖。

实施按 `design.md` 与本文件的获批范围推进；材料性范围变化仍需重新评审。

## 执行者与检查路径

- 实施方式：各阶段以 `trellis-implement` 承担明确的模块范围，主会话负责跨阶段集成、验证与提交；阶段 1 限定 Trellis，阶段 2 限定会话数据契约，阶段 3 限定 Task UI 布局/renderer/config/文档。独立可验证模块委派减轻上下文负担，阶段顺序不变，主会话不得提前实施下一阶段或重复调查委派范围。
- 计划检查方式：主会话完成各阶段的聚焦检查后，派发独立 `trellis-check` 复核最终跨层契约。检查派发前必须创建并填充 `check.jsonl`，仅列真实相关 spec/reference；不为未使用的 implement 角色创建占位 context。
- 每个完成阶段先自查、运行该阶段检查、审阅实际 diff，再提交该阶段的 scoped commit；保留并报告无关并行改动。

## 阶段 1：最小 authority 协议

### 修改范围

- `extensions/trellis/lib/task-context.ts`
- `extensions/trellis/index.ts`
- 关联 Trellis role/workflow 资源及其资源元数据（以实际 package-owned 路径为准）
- `extensions/trellis/__tests__/task-context.test.mjs`
- `extensions/trellis/__tests__/agent-context-integration.test.mjs`
- `extensions/trellis/__tests__/dispatch.test.mjs`
- 其他直接断言旧 authority 形状的 Trellis 聚焦测试

### 工作内容

1. 定义并解析最小 authority schema：仅包含 source root、execution root 与 requirements fingerprint；taskDir、role、contextId 保持在固定 header 行。
2. 让宿主从 native `queryWorktree` / `requireMaterials` 重建完整 facts，并与最小 header、source/binding/worktree identity 比对。
3. 移除模型 prompt 中 authority JSON 与 source-authority instruction 对逐 reference path/hash/bytes 的双重发送。
4. 让角色从 source root、taskDir、role 和 manifest 读取完整材料；更新角色/工作流文字，保留完整读取、分页、无 fallback、防伪与只读边界。
5. 保持 malformed/forged header、source mismatch、worktree mismatch、角色 mismatch 的拒绝行为。

### 检查

```sh
node --test extensions/trellis/__tests__/task-context.test.mjs \
  extensions/trellis/__tests__/agent-context-integration.test.mjs \
  extensions/trellis/__tests__/dispatch.test.mjs \
  extensions/trellis/__tests__/agent-documents.test.mjs \
  extensions/trellis/__tests__/workflow-policy.test.mjs
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
git diff --check
```

### Commit checkpoint

authority parser/assembler、native validation、package-owned role/workflow resources 与对应聚焦回归测试必须在同一提交中，避免任何发布状态出现“资源宣称新协议、运行时代码仍解析旧协议”或反向不一致。

## 阶段 2：结构化会话分页与紧凑 tool 数据

### 修改范围

- `extensions/task-ui/types.ts`
- `extensions/task-ui/coordinator.ts`
- `extensions/agent-tasks/src/conversation-entries.ts`
- `extensions/agent-tasks/src/source.ts`
- `extensions/agent-tasks/__tests__/…` 中覆盖 source/conversation 的实际测试文件
- `extensions/task-ui/__tests__/…` 中覆盖 TaskDetail request/contract 的实际测试文件

### 工作内容

1. 增加可选、向后兼容的 structured conversation page request/result；普通 raw text source 不受影响。
2. 实现首屏 64 个可展示 entry 的自适应反向取样：先扫描两倍，再按有界页补取，直到足额、边界或预算上限。
3. 为 live session 与 JSONL transcript 提供 source-owned opaque cursor、稳定 entry ID、边界/失效/不可读降级信息。
4. 按 tool-call identity 关联调用与结果，准备 bash/read/write/edit/通用结果的紧凑摘要数据；保留既有 external-text sanitization 边界。
5. 不允许 system、隐藏 custom/context 或 provider 内部消息随分页进入 Task Panel。

### 检查

```sh
node --test extensions/agent-tasks/__tests__/*.test.ts \
  extensions/task-ui/__tests__/panel.test.ts \
  extensions/task-ui/__tests__/conversation.test.ts
git diff --check
```

若上述 glob 中已有不相关且无法稳定执行的测试，记录真实失败文件与原因后，改用发现到的最小相关测试文件集合；不得通过删除既有覆盖来获取通过。

### Commit checkpoint

类型契约、source 分页、stable ID/tool 关联与对应测试同一提交。此阶段不改动 Task Panel 的最终布局，以便分页 source 可以独立验证。

## 阶段 3：Task Detail 分区、鼠标折叠与状态呈现

### 修改范围

- `extensions/task-ui/panel.ts`
- `extensions/task-ui/detail-view.ts`
- `extensions/task-ui/conversation.ts`
- `extensions/task-ui/presentation.ts`
- 必要时新增小型 task-ui renderer/state helper
- `extensions/task-ui/__tests__/panel.test.ts`
- `extensions/task-ui/__tests__/conversation.test.ts`
- `extensions/task-ui/__tests__/presentation.test.ts`
- `docs/extensions/task-composition.md`

### 工作内容

1. 将 detail frame 拆成固定且有限的 metadata 摘要、固定 conversation 标题、独立 ScrollView、固定状态栏与固定 footer。
2. 使用 Pi `ScrollView` 的 follow-end 行为实现初始定位末尾、尾随追加、手动上滚取消尾随、End 恢复尾随；分页前插/窗口淘汰以稳定锚点补偿滚动位置。
3. 实现滑动页窗口，不在 render 内读文件或扫描完整会话；正确处理 resize、换选 task、run 更换、source revision 与 stale detail。
4. 将工具结果默认压缩，点击单项才切换展开；展开后仍受行/字符预算限制；write 成功不回显完整正文。
5. 建立列表与详情底部共用的真实状态 presenter 与受控 spinner；不新增或显示 waiting。
6. 更新中文用户文档，准确描述详情分区、最新消息跟随、历史加载、鼠标展开和状态图标，移除旧的静态圆点/单一全局详情滚动描述。

### 检查

```sh
node --test extensions/task-ui/__tests__/panel.test.ts \
  extensions/task-ui/__tests__/conversation.test.ts \
  extensions/task-ui/__tests__/presentation.test.ts \
  extensions/task-ui/__tests__/mixed-waits.test.ts \
  extensions/task-ui/__tests__/lifecycle.test.ts
node --test extensions/shared/scroll-panel/__tests__/*.test.ts
git diff --check
```

### Commit checkpoint

布局、交互、status presenter、文档及所有关联测试同一提交。提交前应覆盖窄/宽宽度、Unicode、wheel、左键、resize、follow、分页锚点和面板 dispose。

## 阶段 4：跨层验证与独立检查

### 工作内容

1. 审阅三阶段实际 diff，确认 authority 资料边界、source 分页和 UI 展示没有破坏其他 TaskSource 或 managed worktree 行为。
2. 创建临时运行目录（`mktemp -d`）保存原始命令输出；在主会话核验后按规则清理。
3. 填充 `check.jsonl`，引用 development/testing spec、相关 guide、PRD/design/implement 和实际跨层 source files；派发 `trellis-check` 进行独立复核。
4. 核验 reviewer 返回的发现，修复处于本任务 scope 的问题并重跑受影响检查。
5. 完成真实安装 Pi 的人工 TUI 冒烟：打开 panel、进入长 agent detail、滚轮、点开/收起 tool result、上滚加载历史、返回底部 follow、状态动画/静态状态；该检查不取代自动测试。

### 检查

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm typecheck
result=$?
rm -rf "$agent_dir"
exit "$result"
```

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"); const p=require("node:path"); console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check
result=$?
rm -rf "$agent_dir"
exit "$result"
```

还需运行：

```sh
git diff --check
git status --short
```

### Commit checkpoint

若独立检查或最终集成检查发现并修复 scoped 问题，单独提交该阶段修复。不得 amend、rebase、squash 或 push。

## 风险与回滚点

| 风险 | 防护 | 回滚点 |
| --- | --- | --- |
| authority 精简削弱 source/binding 防伪 | native query 重建并严格比对；伪造回归测试 | 阶段 1 提交 |
| 长 transcript 分页卡顿或跳动 | 有界读取、cursor、stable ID、滑动窗口和锚点测试 | 阶段 2 提交 |
| 鼠标命中与独立 ScrollView 坐标错位 | 使用 native layout 的 clip/scrollTop，窄尺寸/wheel/click 测试 | 阶段 3 提交 |
| spinner 导致不必要重绘 | 仅可见 active task 使用受控时钟；静态 fallback | 阶段 3 提交 |
| 文档与行为不一致 | 文档与 UI 变更同阶段审阅，最终 diff 检查 | 阶段 3/4 提交 |

## 执行记录

### 阶段 1：已验证并提交

- 提交：`17a9546`（`refactor(trellis): minimize dispatch authority prompts`）。
- 改动：三字段 authority，宿主内部保存 native 完整资料，移除两处逐引用重复；配套 roles/skills/workflow/protocol 与 adapted hashes 同步。
- 独立审查发现并修复同会话换 task/role 可重绑 pointer 的缺陷；新增回归修复前 exit 1，修复后通过。
- 最终命令：五文件 focused tests exit 0（50/50）；`node --test extensions/trellis/__tests__/*.test.mjs` exit 0（357/357）；Python unittest discover exit 0（38）；`pnpm exec tsc -p tsconfig.json` exit 0；`git diff --check` exit 0；当前资源 hashes 与历史 source hashes 校验 exit 0。
- 环境：现有链接 SDK，离线 fixture；未安装依赖、未更新部署副本、未 reload。
- 尚未运行：最终全项目 `pnpm check`、真实 Pi TUI 冒烟。
- 原始证据仍保留在本会话拥有的 `/tmp/task-panel-ux-FNU7Sj/stage1/` 和 `check-stage1/`，任务结束核验后再清理。

### 阶段 2：已验证并提交

- 提交：`b680208`（`feat(agent-tasks): add bounded conversation history paging`）。
- 接口：`TaskDetailRequest.conversationPage` 支持 latest/before/after；返回稳定ID entries、opaque before/after cursors、hasOlder/hasNewer、generation、ok/reset/unavailable 与预算元数据。
- 预算：每页目标64条；原始采样先128，不足补64；每次scan1024条/512KiB；page256KiB；JSONL单行128KiB。Token registry2048、live/file metadata各256、tool关联1024，dispose清理。
- 独立审查修复：显式分页丢失终态outcome、partial JSONL尾行永久漏读、coordinator同步重入fencing、省略计数未知内容误报和长参数先normalize导致无界扫描。
- 原baseline focused71/71 exit0；前三类回归修复前4失败exit1、修复后46/46 exit0；conversion旧逻辑有效内存回归exit1，先行两次hook匹配失败为driver错误，不作为缺陷证明。最终focused78/78 exit0；全部agent/task-ui自然退出368/368 exit0；`pnpm exec tsc -p tsconfig.json` exit0；`git diff --check` exit0。
- 执行中断：原阶段2agent被停止且无法resume；接续agent发生模型服务502后成功resume，均不属于产品测试失败。
- 已核对实际source/paging/types/coordinator最终diff，精确staging8文件；保留并行未跟踪task目录。
- 阶段3需消费`toolResult.sourceTruncated`并显示未知数量的“additional content omitted”；不得虚构剩余字符数。
- 限制：append-only transcript不保证识别原地重写并同时增长；tool调用超出扫描/关联缓存时摘要可缺失。最终pnpm check/真实Pi TUI尚未执行。
- 原始日志：本会话owned temporary目录的stage2/check-stage2，仍保留用于最终核验。

### 阶段 3：已验证并提交

- 提交：`8071409`（`feat(task-ui): add bounded conversation detail interactions`），13 个文件：分区布局、鼠标单项折叠、3 页/256 entries/768 KiB 滑动窗口、真实状态 presenter、animations 配置、测试与中文用户文档。
- 实现首轮测试 exit1：旧圆点/顶部状态/全量 metadata 断言不适用新合同；更新断言并新增行为回归后通过。第四轮 tiny-terminal 回归 exit1 揭示第二次 layout 覆盖紧凑 footer，修复后实现最终98/98 exit0。
- 独立审查回归证实并修复：首次 unavailable 页面丢终态 annotations、空 unavailable 后重试仍丢终态、stable outcome ID 不变导致新消息漏判、tiny-terminal 全局 detach/control 提示被裁剪；各有效缺陷回归修复前 exit1。中间两次 label 预期和一次 anchor 观察 driver 错误已诊断，不作为产品缺陷证明。
- 最终独立检查命令：`node --test extensions/task-ui/__tests__/*.test.ts extensions/shared/scroll-panel/__tests__/*.test.ts` exit0（102/102，自然退出）；`pnpm exec tsc -p tsconfig.json` exit0；`git diff --check` exit0。
- 主会话核对最终 panel/window/renderer 实现与文档，精确 staging13文件，不含并行任务材料。

### 最终集成检查

- 现有 SDK 路径通过 node_modules 实际链接解析；使用新建 `/tmp/task-panel-final-agent-*` 隔离 `PI_CODING_AGENT_DIR`，未安装或下载依赖。
- `PI_SDK_DIR=<existing SDK> PI_CODING_AGENT_DIR=<owned temp> pnpm check` exit0：strict typecheck 通过，全套1591/1591 tests通过，78 suites，0 fail/skip/cancel。
- 主会话读取最终日志确认计数，`git diff --check` exit0；产品改动全部分阶段提交，仅本任务和两个其他会话的任务目录未跟踪。
- 原始最终日志：`/tmp/task-panel-ux-FNU7Sj/final/pnpm-check.log`。隔离配置目录在命令结束后清理，整个本次执行证据目录暂保留。
- **NOT_RUN：真实安装 Pi TUI 人工冒烟。** 自动 component/native-layout 测试不等于真实终端视觉、实际鼠标或安装版本已加载新代码；未安装、reload或更新项目部署资源。
- 未 push、archive 或 journal。本任务等待用户视觉验收；parallel tasks 保持原状。

### 真实终端验收：tmux（组件挂载层）

- 用户明确授权使用 tmux 验收最新源码。按 `.trellis/spec/testing/tmux.md` 建立唯一 tmux server、临时 HOME、`PI_CODING_AGENT_DIR`、TUI log 与 fixture extension；不读取个人认证，不安装/reload/同步或调用在线模型。
- CLI：安装的 `pi` 1.3.0；命令以 `--offline -na -ne -ns -np -nc --no-mcp --no-session -e <owned fixture>` 启动。fixture 在真实 Pi fullscreen TUI 中以真实 `TaskPanel`、`NativeLayout` 和 `ScrollView` 挂载固定结构化 TaskSource；这是组件在真实终端的证据，不是 provider/真实子代理执行验收。
- PASS（100×30）：真实覆盖层打开列表，Enter 进入 Detail；初始视图位于最新 bash 尾部，显示固定 metadata/Conversation/status/actions；Home 触发 older page并保持原阅读锚点，第二次 Home 到达加载的更早内容；End 回到真正 latest page。
- PASS（40×12）：真实 resize 后仍显示 Conversation、`x Stop` 和 `ctrl+shift+b All waits`。PASS（40×3）：仅可用正文尾行、状态和关键 action 行可见，符合物理空间裁剪。
- NOT_RUN：物理鼠标端到端。通过 `tmux send-keys` 注入 SGR click 的模拟尝试未使条目展开（tmux/fixture 输入传递限制），不能据此判定产品鼠标失败；自动 native-layout/component 回归已覆盖 click 命中。
- Fixture 首次启动出现项目 trust dialog（驱动缺少 `-na`）；重新使用 `-na` 后通过，不是产品错误。首次“单次 Home 立即出现更早文字”的 driver 断言 exit1：实现已加载旧页但按设计锚定原阅读位置；第二次 Home 才显示更早页，随后End验收通过。该断言调整不是产品缺陷。
- 关闭：发送 Ctrl-C 请求正常退出；确认 session 退出。若未退出会仅 kill 本次唯一 `tmux -L` server；本次 `normal_exit=1`，无残留 server。临时 driver/屏幕捕获/raw log保留在 `/tmp/task-panel-ux-FNU7Sj/tmux/`，未加入仓库。
