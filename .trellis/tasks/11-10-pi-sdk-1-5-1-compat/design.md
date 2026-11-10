# 设计：最小 SDK 1.5.1 适配

## 决策与所有权

修复分三类：公开 SDK 类型/导入适配、真实 SDK 方法依赖的隔离测试夹具、已改变的持久化/校验预期。基线不能证明需要重构产品编辑器或 lifecycle owner。默认保留所有用户交互。

当前使用已安装 SDK 1.5.1，不引入新运行时依赖。typebox 已是 host peer；Schema 仅换公开导入来源，不改变结构。AI StringEnum/stream/models 类型仍由 pi-ai 提供。Process message renderer 保留完整 SDK MessageRenderOptions；测试用与实际 host 契约匹配的 hint functions，不制造新显示内容。

## 夹具边界

1. Editor/Overlay/Footer 的实际 InteractiveMode 方法需要 extensionDialogs / extensionOverlays。补齐 host state，而非在产品里容忍任意缺失内部 host 字段或复制 SDK reset 算法。
2. runtime 夹具仅实现此次实际使用的服务方法，包括 settleCredentialWrites；断言 SDK 卸载等待凭据收敛。不创建真实 credentials，不把类型强转当服务实现证据。
3. ExecResult 夹具使用明确 truncated:false，与 killed 独立。
4. 现有窄内部 autocomplete seam 未变：tryTriggerAutocomplete(false) 表示 display-only 查询，force/explicitTab 保持 false。保留票据、abort 和 live editor identity，不扩大 private API 访问。

## 持久化与校验

SDK 1.5.1 在 append 持久化失败时回滚内存索引/leaf。真实 SDK 测试应观察这一原子行为；Recap 产品对于旧/非原子 host 的不确认状态仍保留，继续 fake-host 验证，不伪造实际 SDK 未产生的 entry。

Memory required 字段 missing/undefined 无默认即拒绝。更新 host 校验测试，不改工具的 required/closed schema 或 direct-call 限制。所有其他 scalar conversion cases 以当前实际 validateToolArguments 实测验证。

## 验证、失败与回滚

- 类型导入修复会解锁之前无法加载的 suites，完整测试数会增加；不能把 96 次失败等同固定修复清单。
- 各阶段只要求该阶段 scoped gate 与独立审查通过；对尚未实施阶段的已知失败明确标记 deferred，不说 pnpm check 已整体 PASS。
- 若出现新的用户行为差异或公开兼容要求，先停在设计边界请求决策，不用削弱测试修复。
- 每阶段独立检查点由主会话提交，回滚应是获批的新增 revert 提交，不改写历史。
- 所有 offline tests 使用本轮独立 PI_CODING_AGENT_DIR 和已安装 SDK；最终不得有外部 Type shim。生命周期 focused 不使用 force-exit。
- 当前授权不包括个人安装/同步/reload、真实 TUI/IME/在线 provider；这些验证层只列 NOT_RUN。现有 SDK component/host tests 与源码检查不等同物理终端验证。

## 执行与资料

共享源目录，不自动创建 worktree。建议按阶段委派 trellis-implement，逐阶段 trellis-check 独立审查；主会话仅同时维护任务材料和检查非重叠证据，不与子角色并发编辑同一产品文件。角色必须完整阅读规范、任务和相关 SDK 文档/例子，不能以本调查摘要替代。

SDK 文档根：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.5.1/node_modules/@earendil-works/pi-coding-agent/`。研究已完整读取 docs/extensions.md、sdk.md、tui.md、keybindings.md、session-format.md、message-types.md，以及对应 extension/SDK examples。主会话已完整读 README、sdk.md、tui.md、sdk example13，并核对 Type 文档、关键 fixture/renderer/Recap/Memory anchors与基线日志。实施角色开始写代码前完整读其涉及的 SDK 文档与例子。

源任务 research/ 不作为通用附件目录；仅 PRD、design、implement 与 curated manifests 长期保留。原始材料留本任务仓库外 owned directory，旧任务目录保持只读。
