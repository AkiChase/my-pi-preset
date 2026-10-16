# 实施计划

## 授权与执行方式

最终方案已批准且任务已 start。由主会话直接实施并自审；未派发角色，两份 JSONL 保持空，启动使用 `--allow-empty-context`，不宣称 task validate 已完整通过。若需派发审查，先整理 check.jsonl。

## 单一可验证阶段与提交点

- [x] 实施前完整重读 relevant source/callers/tests，检查 staged/unstaged/untracked 平行改动；实施前相关产品文件没有 `git status --short extensions/trellis` 输出。
- [x] 在 diagnostics owner 中增加一致的分类/排序、紧凑/详细有界报告快照与英文 outcome；不改变采集和执行权限。
- [x] 注册主题化 custom message renderer，并仅将菜单 Check 改为 display=true 消息发布。
- [x] 补齐状态组合、紧凑/展开、遗漏/清理、消息回退及发布回归；保持既有 read-only 和 lifecycle 检查。
- [x] 自审实际 diff，执行下述检查并记录结果/首次失败原因；检查通过后已作 scoped 本地提交，未推送。

## 检查命令

使用已安装 SDK 和本次自建的仓库外临时 agent/output 目录隔离，不安装依赖；stdout/stderr 只写该目录。

```sh
node --test extensions/trellis/__tests__/init-diagnostics.test.mjs extensions/trellis/__tests__/diagnostic-runtime.test.mjs extensions/trellis/__tests__/diagnostic-report.test.mjs
node --test extensions/trellis/__tests__/*.test.mjs
pnpm check
git diff --check
```

新增测试文件名按实现保持一致。命令/生命周期测试从完整既有 suite 覆盖；focused tests 不使用 force exit。pnpm check 的全套配置可能强制退出，不能据此证明自然退出。记录确切环境、退出码、失败与 rerun 关系，不用后续 PASS 删除此前失败事实。

## 验收与限制

最终检查 PRD 六类状态、英文风格、异常优先和消息区展开要求。根据项目 testing spec，不新增或运行 Trellis 实际 host/TUI/menu-flow 测试；真实视觉效果标为未验证，不将逻辑测试称作视觉验收。仅有界快照进入会话；无资源部署/SDK/个人配置变更。材料遵循中文 task artifacts、英文代码/UI/commit 约定。

## 执行记录

实施已完成：六类状态分组、英文 outcome、有界 compact/expanded 快照、消息区 theme renderer、纯文本回退及命令发布；检查结果及提交点见下文。

首次失败事实：
- 首轮 focused 诊断测试 56/57 通过，唯一失败为旧标题 `Checks completed` 断言；实际 consumer/provenance 检查成功。仅更新新标题预期，保留只读/安全断言。
- 新报告逻辑首轮 10/10 通过。
- 初次 `pnpm typecheck` exit 2，错误在平行任务的 `extensions/memory/__tests__/panel.test.ts:26,37` Terminal fixture 类型，不修改该任务文件。
- 初次定位命令最后 rg 指定不存在的 `check-lifecycle.test.mjs` 导致 shell exit 2；前面的 task start 成功，非运行时失败。
- 自审发现详细报告预算遗漏在 compact 中可能不可见，已修复并增加专门回归；发现一个通过变量传入的 fake-pi fixture 未补 renderer 注册方法，已补齐。
- scoped diff 首次发现 diagnostics.ts 末尾额外空行，已移除。

## 最终验证结果与限制

环境：现有 Node/Python/已安装 Pi 1.3.0 SDK；后续全套隔离使用 `PI_CODING_AGENT_DIR=/tmp/trellis-report-UJJzGW/agent`，SDK 路径从现有 node_modules 链接解析。未安装依赖、未运行部署/个人 reload。日志在仓库外，以下结果不依赖临时文件才能理解。

| 命令 | 结果 |
| --- | --- |
| `node --test extensions/trellis/__tests__/init-diagnostics.test.mjs extensions/trellis/__tests__/diagnostic-runtime.test.mjs` 首轮 | exit 1；56/57，唯一旧标题断言失败，已按新文案修复 |
| `node --test extensions/trellis/__tests__/diagnostic-report.test.mjs` 初轮及最终安全重跑 | exit 0；10/10 |
| 三份 diagnostic focused tests 最终重跑 | exit 0；67/67 |
| `node --test extensions/trellis/__tests__/diagnostic-report.test.mjs extensions/trellis/__tests__/agent-context-integration.test.mjs` | exit 0；renderer fixture 修复后的专项验证 |
| `node --test extensions/trellis/__tests__/*.test.mjs` 首轮 | exit 1；442/470；28 个失败均由共用 fake-pi setup 缺 renderer 注册方法导致，未通过放松产品 API 规避 |
| 同一 Trellis 全套最终重跑 | exit 0；470/470，自然退出，没有 force-exit |
| `pnpm check`（后续全仓） | exit 0；typecheck 与 1522/1522 tests；首轮 memory 平行工作类型错误后来已消失，本任务没有修改 memory 文件 |
| `pnpm test`（单独全仓） | exit 0；1522/1522；配置中的 force-exit 不用作自然退出证据 |
| `pnpm typecheck` 最终 | exit 0 |
| `git diff --check` 及 scoped 最终重跑 | exit 0；首次多余 EOF 空行已修复 |

主会话已自审产品与所有 fixture 差异：只改展示 owner/Check 发布及其逻辑测试；collector/worker/执行授权/旧结果 generation 未修改。主题颜色在渲染时生成，恢复 details 验证有界且控制字符拒绝；默认隐藏与实际预算遗漏分开，详细视图的遗漏会在紧凑结论中提示。未作独立审查，不声称真实终端、实际宿主菜单或鼠标/快捷键视觉验收；按项目规范仅 logic/fake-pi 验证。无新增规范变更必要：已有 UI/主题/安全/测试约束足以覆盖本次实现。

## 提交与清理

stage 已验收并提交 `c36f6ee`（`feat(trellis): show structured themed Check reports in messages`）：产品、测试与本任务最小规划/验证材料，无 research/evidence 报告。首次提交前 staged diff 检查发现 implement.md 多余 EOF 空行，修复后提交成功，没有失败的 Git commit。

所有本次进程已结束且原始材料已核实；已仅清理本次拥有的 `/tmp/trellis-report-UJJzGW/`，删除后不存在的检查通过，保留此处自包含验证记录。用户在交付后明确要求“收尾吧”，已接受本次工作并授权归档和 journal 记录。视觉验证限制保持不变，不推送、不部署。本任务直接在 main 完成且从未使用 PR/独立 feature branch；保留真实 branch/base_branch 元数据，归档使用 CLI 明确支持的 `--skip-branch-validation`（非 PR 任务），不伪造分支。
