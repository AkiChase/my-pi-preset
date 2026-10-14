# 实施计划

## 状态与批准门
用户已批准最终计划与当前工作区实施；实现、独立check、主会话复验和限定真实tmux验收均完成。用户另已授权验收通过后自主commit/归档、不逐项询问。证据见implementation-report/check-report/main-verification/tmux-validation；仅收尾本任务，不push或修改个人安装。

## 1. 实施前核对
- [x] 读取prd/design/research与context相关规范；重新核对当前SDK真实Editor/CustomEditor及已有handoff/owner，避免并行修改后依赖陈旧片段。
- [x] 查看git diff/status，记录所有已有并行修改边界；不得重置/覆盖Beautify、Task UI、memory/runtime与.pi变更。
- [x] 新入口命名at-path-completion；保持package glob、无新依赖/配置/全局快捷键。
- [x] 主会话已完成批准/start，明确当前工作区直接实施；子代理未执行任务生命周期或worktree操作。

## 2. 核心红测与小适配
- [x] 用实际SDK Editor/CustomEditor及确定性provider建立测试，先保存两个原生行为红证据：无列表时输入/；Tab/Enter接受目录后继续提示。
- [x] 额外红测原生单候选Tab直接应用目录后不续开，下一层唯一候选必须不自动接受。
- [x] 实现兼容层，只调用显式内部tryTriggerAutocomplete(false)，能力缺失/异常仅禁增强一次诊断，保原生编辑，不读private状态/改SDK。
- [x] 实现token和真实slash插入检测，覆盖编码/引号/边界；普通文本、slash command、agent、jump、paste不触发。
- [x] 实现公开provider wrapper，委托current，观察applyCompletion目录结果；后处理以预期全文/光标、active editor、generation/focus检查再发普通请求。
- [x] 覆盖原生已有候选更新不额外请求、列表Tab/Enter、强制Tab唯一候选、空结果、文件接受不续开与Enter不误提交。

## 3. 活实例接线与清理
- [x] 独立factory/owner复用interpose/preserveHandoff保活实例；actual SDK测试覆盖history/undo/cursor/paste/receiver。IME真实终端未运行；安装public provider按宿主规则取消当时补全列表，详见报告。
- [x] 真实host setter/resetExtensionUI回归覆盖first activation、未来factory/new activation与reset-before-shutdown、部分安装失败实际container/focus恢复及unsupported editor；不等同真实CLI reload/new smoke。
- [x] Escape、后续键/鼠标/光标变化、文本替换、关闭和换editor使pending无效；迟到请求不得重开。
- [x] 后装opaque wrapper/provider链不被清理覆盖；退役cell清引用，不通过hostsetter重装旧factory。
- [x] 不依赖Beautify/Down加载顺序；禁用Down、history fixture和agent mentions组合回归。

## 4. 集成与文档
- [x] 增加唯一顶层入口及嵌套tests/TESTING.md；更新scripts/pi-manifest与实际loader的入口/handler精确断言（核对当前并行版本）。
- [x] README概览、自带扩展、开发验证命令同步，明确内部兼容风险与范围；不引入Trellis内部文档到README。
- [x] 有证据后局部更新owning specs；不覆盖并行更新、不给任意第三方editor兼容背书。

## 5. 验证命令与独立检查
所有测试使用真实既有SDK链接、临时PI_CODING_AGENT_DIR，离线、不真实install/sync/reload个人配置。示例：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
node --test extensions/at-path-completion/__tests__/*.test.ts
node --test extensions/beautify/__tests__/editor.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts
node --test scripts/pi-manifest.test.mjs
pnpm check
result=$?
rm -rf "$agent_dir"
exit "$result"
```

实际执行用fail-fast或逐条保存退出码，不将最后一条成功冒充全部通过。定向测试不加force-exit，确认自然退出。

- [x] 原生provider临时目录集成覆盖ignored local scoped、../、绝对路径及引号；~/映射临时home隔离，不读个人目录。保持候选语义不变，不用全量结果顺序恒定假设代替断言。
- [x] 无候选/空目录保持原生关闭；fd缺失不安装、不借机加新搜索实现。
- [x] 独立check复核内部API边界、provider顺序、异步取消、单候选、submit、活实例和cleanup；main检查实际diff与报告。
- [x] 复查新untrackedMarkdown链接、git diff --check与定向/完整回归；执行证据已写入report，PRD最终AC由主会话/独立check复核。
- [x] 若没有真实PTY/input-history原包验证，交付明确说明；不因隔离SDK测试声称所有终端行为已验收。

## 6. 收尾边界
用户已明确授权通过后提交/归档和自主修复；主会话只提交本任务owning改动、归档本任务及日志。不push、个人install/sync/reload，不混入其他tasks/.pi/并行代码。真实tmux限定dark/fullscreen固定140/80/40列，实际input-history/物理IME/动态resize等限制保留。可通过停用独立入口回滚，无用户数据迁移。
