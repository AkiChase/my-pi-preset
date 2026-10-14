# 实施计划

## 授权门与执行方式

用户已批准主 worktree 实施，主会话直接修改源仓库，公共 RPC 和跨模块通知需独立检查。相关 workflow、development/testing 与 guides 已读取；派发前准备 check.jsonl 的真实引用。implement.jsonl 作为未使用角色 manifest 保持空。不修改部署副本。

任务已绑定本会话并 start；实施授权含各 verified stage 的 scoped 本地 commit，不含 push/install/sync/reload/archive。失败提示按用户后续确认精简为 UI warning 或无 UI 时简短安全日志，不新增持久记录。

## 阶段 1：入口契约

- [x] 核对程序化入口、RPC 与 manager admission，添加共享 description 规范化与必要 unknown payload guard。
- [x] 保留 model/cwd/内部 capability stripping；record/cleanup 使用同一描述，runner 保留原参数契约（不读取 description）。
- [x] 补实际 RPC/factory/manager 缺省、null、空白、非空和非法描述测试；malformed payload 不 admission。
- [x] 定向测试、strict 与独立边界检查，主会话审 diff；阶段提交见 research/stage1.md。

## 阶段 2：通知失败与运行身份

- [ ] 替换无差别吞异常，有 UI 时简短英文 warning，无 UI 时简短安全日志；提示 sink 失败隔离，不新增持久诊断。
- [ ] 构造/同步提交失败不标 delivered、不 consume、不自动重试；stale/closing 不写新 session。
- [ ] 单条通知发送后核对 record/runId/activation，不污染同步 resume 新 run。
- [ ] 补 throwing send/formatter/sinks、同步 resume、消费/等待/shutdown 回归。
- [ ] 定向测试、strict、独立 review 与主 diff 复核，立即 scoped commit，记录证据。

## 阶段 3：stopped group 结算及整体集成

- [ ] terminal stopped 即计入组，actual execution 未退出不能阻塞兄弟通知。
- [ ] 用非合作 delayed runner 验证即时关闭、文案、重复回调、resume 与真正 partial timeout。
- [ ] 更新中文功能文档到根 docs/（核对并行 docs 组织，禁止把小功能说明塞入 .trellis/spec）；必要时更新 provenance。通用规范只在有可复用证据时另评估。
- [ ] 定向、整体 strict/test、独立 review、主最终 diff/PRD AC 复核，立即 scoped commit。
- [ ] 报告 remaining dirty/真实验证限制；不自行归档或推送。

## 验证命令

执行前核对 SDK peers 已存在，不运行自动下载/安装。项目 npm scripts 调 link-pi-sdk，若可能修改共享 symlink，优先使用以下现有依赖直接命令并记录差异：

```bash
./node_modules/.bin/tsc -p tsconfig.json
node --test extensions/agent-tasks/__tests__/auxiliary-lifecycle.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts
node --test --test-force-exit "extensions/**/__tests__/*.test.ts" "scripts/*.test.mjs"
git diff --check
```

新增 test 文件时将其加入定向命令。定向不加 force-exit以观察自然退出；整体项目既有 force-exit不能作为无资源泄漏证据。长命令后台执行并保留日志，结果关联实际最终输入；不会用未执行测试标 pass。

## 并行与风险

- 保留现有 docs/spec/task-panel 等其他会话修改；stage 精确本阶段文件，混合文件安全性不确定则停下报告。
- 不修改 runtime-task-tools 的任务状态或产品范围；旧 diagnosis 仅作为证据引用。
- group 修复不更改执行 cleanup；诊断不泄漏 prompt/result；SDK 异步 ACK 和 15 分钟延迟不作为本任务验收。
- 独立 review 发现材料级范围变化需重新审批，不顺手扩为完整 RPC schema 或通知队列。
