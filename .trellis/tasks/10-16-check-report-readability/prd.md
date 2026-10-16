# Improve Check project report readability

## 目标

让 `/trellis-init` → `Check project` 在消息区直接说明是否有需要处理的问题，避免用户从冗长通知中寻找结论。UI 文案保留英文风格。

## 背景与证据

- 用户已批准创建任务、最终方案及实施，认可状态分组和主题配色，并选择消息区展示，不使用独立面板。
- `extensions/trellis/lib/initialization/command.ts:198-216` 将报告作为单条 info 通知发布。
- `extensions/trellis/lib/initialization/diagnostics.ts:346-364` 将错误与警告合并为 Issues，将 blocked/skipped/cancelled 合并为 incomplete，随后罗列详细证据。
- `extensions/trellis/lib/initialization/diagnostic-runtime.ts:87-111` 包含前置校验阻塞、探测失败/超时、刻意跳过的 TS consumer，以及取消。`diagnostics.ts` 另记录公开 API 无法证明的宿主资源状态。这些情况不能统一视为项目故障。
- Pi 官方 `examples/extensions/message-renderer.ts` 使用 `registerMessageRenderer`，支持 `expanded`、`outputPad` 和注入的 theme；不需要另开交互面板。

## 需求

1. 消息区发布英文报告；默认紧凑，沿用宿主原生展开/收起，不新增独立面板或快捷键。
2. 顶部先给出诚实结论，分别统计 Errors、Warnings、Passed、Blocked、Skipped、Cancelled。存在遗漏时明确标记，不能宣称全部检查通过。
3. 默认优先展示错误/警告的简短摘要及 Next 建议；通过项按类别汇总，不打印正常文件清单和哈希。大量异常也需有显示上限及展开提示。
4. Blocked、Skipped、Cancelled 分开说明：前置条件阻塞不算通过；范围/API 限制不自动等同错误；没有证据时不得将所有 Skipped 重命名为 Not applicable。
5. 使用主题的 error/warning/success/muted 等语义颜色，同时保留状态文字和图标；配色不写进持久化消息数据。
6. 展开后可查看有界的 Location/evidence、Impact、Next 及通过项详情；默认隐藏细节不等于采集遗漏，两者分别提示。
7. 保留无 ANSI 的可读文本内容供非 TUI 客户端使用；不触发额外模型轮次。
8. 不改变只读采集、信任/runtime gate、取消/旧会话结果抑制、敏感内容清理和报告预算保护。

## 验收标准

- [x] 顶部可直接区分错误、仅警告、无错误但检查不完整、取消和无异常结果。
- [x] 六类状态分别计数，Skipped 和 Blocked 不混为故障或通过。
- [x] 默认视图可定位优先异常及下一步，通过项不淹没重点。
- [x] 消息采用英文文本和主题配色，展开后能访问有界诊断细节（逻辑验证，非真实终端视觉验收）。
- [x] 大量条目、Unicode、外部控制字符、报告遗漏均有安全且诚实的输出。
- [x] 无 renderer/非 TUI 路径仍有完整有界可读文本；沿用旧结果抑制，并验证 suppressed result 不发布。
- [x] 针对格式化、消息发布边界及既有诊断逻辑回归通过，并记录未执行的视觉验证限制。

## 范围外

`trellis-check` skill/agent 回复、新探测能力、自动修复、资源更新/部署、中文本地化、其他菜单重设计、个人配置修改及 SDK 修改。

## 授权与材料

用户已明确批准按 design.md / implement.md 开始实施，任务已 start。实施范围和本地提交遵循项目 workflow，不含 push 或归档授权。
