# 内置插件统一展示层

## 目标与用户价值

统一 preset 内置插件编辑器区域的 widget 展示与排序规范。Recap 必须位于 Trellis 上方，不因插件刷新、异步生成或加载顺序漂移；后续内置插件必须遵循同一项目 dev 规范。

用户确认布局：对话内容 → Recap → Trellis 任务信息 → 编辑器；转后台提示保留在编辑器下方。不是终端整体顶部，不将 Recap 移到编辑器下方。

## 背景证据

- 前置菜单化任务已归档：`.trellis/tasks/archive/2026-10/10-16-recap-config-menu`；实施 `0c74dd9`、checkpoint `edaeefc`、归档 `28b954c`、journal `e1273cc7`。展示调整独立归本任务。
- 当前 SDK `ExtensionWidgetOptions` 仅支持 placement，没有 priority；interactive-mode 的 setExtensionWidget 删除再插入 Map，renderWidgetContainer 按 Map 顺序渲染。
- 已确认全部生产 widget 消费者：Recap `extensions/session-assist/recap/index.ts:116` 发布 aboveEditor；Trellis `extensions/trellis/index.ts:859–890` 同区域发布并在启动/agent_end 刷新；foreground hint `extensions/process-tasks/hint.ts:58,73` 与 `index.ts:145` 发布/撤销 belowEditor。
- Recap 的生命周期/SDK回归位于 `recap/__tests__/lifecycle.test.ts`、`sdk-runtime.test.ts`；Trellis 采用 `trellis/__tests__/project-activation.test.mjs` fake pi 逻辑测试；foreground hint 使用 `process-tasks/__tests__/hint.test.ts`。
- `extensions/status-bar.ts` 独占 footer，`extensions/task-ui/owner.ts` 管理 task status/panel overlay，`extensions/shared/scroll-panel/` 管理面板布局，均不是 widget 排序 owner。
- SDK 各 extension 的 pi.events facade 不同但共享底层 bus；协议需同步 admission/ack，runtime 负责订阅 retirement。具体设计见 design.md。

## 范围与关键决策

R1. 新增共享展示 owner/API 和独立内置入口；以 aboveEditor/belowEditor 两个组合 widget 发布，内部按中心 slot registry 固定排序，不依赖宿主写入时机。

R2. 本任务迁移全部现有内置 widget：Recap、Trellis、Process Tasks foreground hint。不是只建框架、只迁移两个消费者，或把其他迁移留到下一任务。

R3. 更新 `.trellis/spec/development/index.md` 与必要专题 spec，成为强制项目 dev 规范：内置 widget 必须声明 slot/区域/排序并通过共享 client 发布/撤销，遵守会话/activation身份与清理职责；不允许消费者直接调用宿主 setWidget。

R4. 更新 `.trellis/spec/testing/index.md`；增加可执行生产入口检查和排序/更新/取消/切换/reload/重入/失败清理回归，使规范可验证。

R5. 保留消费者业务契约：Recap request/material有效性及保存，Trellis task/status显示，foreground派生内容与快捷键提示。更新一个 slot 不无意义重建其他组件，空区域不保留占位。

R6. 状态栏、header/footer、编辑器、消息与 overlay 不纳入本次统一管理，保留已有 owner，仅明确边界。

## 验收标准

- [x] AC1/R1：aboveEditor 内部固定 Recap → Trellis；先后发布、更新、撤销不改变排序，无重复组件/空白占位。
- [x] AC2/R2,R5：三个消费者全部接入，原有业务、区域、主题/文本处理与非展示行为保持不变；更新不重建无关 slot。
- [x] AC3/R1,R5：共享 owner/session/activation生命周期明确；旧会话、迟到factory/setter/dispose或关闭handle不能覆盖/撤销新会话，清理幂等且隔离失败。
- [x] AC4/R3,R4：项目 dev/testing规范明确唯一owner、接入/slot/排序/清理与验证；生产入口检查可发现绕过统一层，索引links与spec discovery有效。
- [x] AC5/R6：第三方widget不被删除/重发；status/header/footer/editor/messages/overlay保持现有管理。
- [x] AC6：阶段focused自然退出、类型检查与受影响loader/consumer测试，最终pnpm check与git diff --check；独立review通过，记录首次失败及NOT_RUN限制。

## 排除与限制

不修改已安装 SDK，不访问其私有 widget Map/容器，不包装第三方 setWidget；不承诺组合相对未接入第三方一直最上方。后者仍由宿主写入顺序决定，需另行批准宿主能力才能保证。

不安装、不个人 sync/reload、不 push、不修改历史、不归档、不修改其他任务未提交材料。模拟UI/真实SDK boundary测试不等于真实终端视觉或线上质量实测。

## 授权与执行

用户已明确批准完整方案实施，并允许每阶段检查后commit、有问题及时提出。顺序：S1共享层与基础规范 → 独立review/检查/提交 → S2全部迁移、强制检查与最终规范 → 独立review/检查/提交。详见 implement.md；主直接实现，trellis-check独立审查跨模块生命周期契约。
