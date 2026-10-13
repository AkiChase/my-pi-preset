# 实施与离线验证结果

## 范围与实现

在当前 main 检出实施，没有创建／切换 worktree、stage、commit、push、task finish/archive或安装／reload。没有修改 task-ui、agent、依赖或新增配置字段。

- `extensions/process-tasks/monitor-notifications.ts`：BackgroundRegistry 所有的共享通知队列、一个刷新 timer、成功提交时钟、source 决策订阅；固定 min(200ms,F) 首窗／及时窗、普通共享节奏、timely携带其他eligible pending；发送前移出快照与epoch校验。fair water-fill输出预算，描述160、summary/note512、转换16的有界metadata，正文/details同一裁剪preview。
- `state.ts`、`monitor-session.ts`：registry持调度器，源保留事件到达／deadline／silence／实际source owner；自然终态保留有限尾批，finishing suspend普通pending，内部abort不取消尾批。
- `lifecycle.ts`、`index.ts`、`registry.ts`：freeze/dispose/reset/显式stop/metadata sweep释放通知队列／timer／订阅；index renderer兼容单条与monitorBatch，shell分支不变。
- `notify.ts`、`tools/jobs.ts`：markOutcomeSurfaced可接受registry，仅monitor消费时释放pending/retry；shell时机／正文不变。attach/retrieval重查继续使用原notificationRetries通道，不自动重试。
- `config.ts`、`tools/monitor.ts`：更新注释／工具描述，无新字段。
- 新增 `__tests__/monitor-notifications.test.ts`，修改 `monitor-session.test.ts`、`monitor-setup-result.test.ts`、`monitor.test.ts`、`index.test.ts`、`process-harness.ts`。真实scheduler、session、factory／源接入，仅fake clock/transport/host seam；原OS/decoder/停止hard assertions保留。
- README、monitor-contract、testing-guidelines、provenance同步；implement.md checklist/results更新。独立trellis-check仍未执行，应由主会话派发。

## 红测

源码变更前执行：

```sh
node --test --test-name-pattern='session batch:' extensions/process-tasks/__tests__/monitor-session.test.ts
```

0/1，实际两个session在100ms内发两条独立通知，首窗应尚无发送：`2 !== 0`。完整捕获证据（仅去除行尾空白）见 [red-session-batch.log](./red-session-batch.log)。

## 隔离方式

全部验证使用已安装SDK只读路径（SDK 1.2.0，link-sdk输出linked0/7）：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" <验证命令>
result=$?
rm -rf "$agent_dir"
(exit "$result")
```

无真实个人配置读写、模型／网络请求或pi install/reload。真实command只运行隔离本地child；factory WS只替换transport。未用强制退出掩盖资源保留；pnpm check的既有package test脚本含force-exit，另跑完整无force-exit命令。

## 实际结果

| 命令 | 结果 |
| --- | --- |
| `node --test extensions/process-tasks/__tests__/{monitor-notifications,monitor-session,monitor-buffer,monitor,config,index,activation,waits,monitor-setup-result}.test.ts` | 最终136/136，自然退出，~2.27s |
| `node --test extensions/task-ui/__tests__/*.test.ts extensions/process-tasks/__tests__/*.test.ts extensions/agent-tasks/__tests__/*.test.ts` | 初次493/494，原样复跑494/494；最终497/497自然退出，~14.90s |
| `pnpm check`（最终） | strict TypeScript + 557/557，~19.02s |
| `node --test "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"`（最终） | 初次556/557；未改任何代码，原样复跑557/557自然退出，~19.75s |
| 改动文档与task文档的相对Markdown链接 | 52条，无缺失 |
| `git diff --check` | 通过；新TS/文档另检查无尾空白 |

### 既有、未修改的边界测试波动

两次全模块／全量自然退出初次失败均只在 `extensions/task-ui/__tests__/editor.test.ts:208`：fixture设置 `endedAt = Date.now() - 3999` 后再调canOpen，若跨1ms就达到4000ms，断言true实际false。原样复跑通过；没有修改或放宽该测试，按用户scope保留task-ui。结果表不隐藏初次失败，也不据复跑宣称它已修复。

### 开发迭代

- 首次新文件使用参数属性，被Node strip-only拒绝；已改显式字段，strict与自然运行均通过。
- 首次strict对notification state使用JobStatus谓词失败；已用局部terminal谓词。
- 旧立即发送断言按已批准短窗更新；短命令窗口内退出应折进单终态而非额外progress。
- scheduler equal-due先核查源deadline/silence，防止普通timer插入顺序先发送。
- SDK窄宽truncate可产生自有SGR reset，测试允许SDK SGR而禁止外部OSC／control。

上述迭代失败不是旧实现的产品红测证据。

## 保留与约束

原先 `.pi/.pi-trellis-hashes.json`、`.pi/agents/trellis-{check,implement,research}.md` 未编辑、stage或提交。执行期间发现另一未跟踪 `.trellis/tasks/10-13-task-panel-redesign/`，未读取或修改。task原PRD/design/context manifests保留，实施仅更新implement.md与本研究证据。

本轮是implement自检；主会话还需独立trellis-check。提交API返回void，只证明本地提交，不证明模型已处理。frequent timely事件仍可频繁唤醒；预算仅约束输出预览，不宣称全部metadata也在outputPreviewChars内。

## 用户追加批准的容量修复

上一审查发现的整批metadata无硬上限已按「单条有界通知＋完整清单」实施，见 [capacity-results.md](./capacity-results.md)。本轮63KiB content/details JSON＋1KiB信封预留、同logDir独占JSONL metadata、诚实failure/latch/query与实际factory容量/fd隔离矩阵已完成自动自检：150/150定向、511/511三模块、strict＋571/571全量自然退出；无force-exit（pnpm check用临时node launcher移除既有该参数），未改package/SDK。新代码还需主会话独立check，不能复用原check绿色。
