# 设计：Check project 消息报告

## 最小行为差距与归属

诊断采集已有足够的状态；问题在 `diagnostics.ts` 的文本编排和 `command.ts` 的通知发布。仅调整展示层，不借机修改 probe、信任判断或 runtime 数据结构。

## 消息与渲染

- 为 Check 结果注册独立 custom message renderer（customType `trellis-check-report`），在初始化命令注册时准备，确保未初始化项目也能显示。
- Check 完成后发布一条 display=true 的消息，不再发布整段 info 通知；其余 init 操作的通知保持原状。
- 消息 content 使用有界、已清理的完整英文纯文本；details 仅保存有界的报告展示快照，不保存 worker/controller 或原始输出，不触发模型继续运行。
- 通过公共 `registerMessageRenderer` 的 expanded 参数选择紧凑或详细视图；使用 Box/Text 和 outputPad，遵循宿主主题与消息背景。无额外交互组件或私有 API。
- 展示快照及纯文本复用同一状态分类/排序规则，避免颜色视图与纯文本结论不一致。渲染时应用主题，不持久化 ANSI。未知/不合法 details 回退至安全文本展示。

## 英文信息层级

1. `Check project · <outcome>`：错误优先，取消仍明确；警告与未完成可组合表达，不将 warning-only 报为失败，不将省略结果报为完整成功。
2. 各状态独立计数：`Errors / Warnings / Passed / Blocked / Skipped / Cancelled`。
3. `Errors` / `Warnings`：错误后警告，每项一行摘要，必要时一行 `Next`；默认每组预览 3 项，未展示项提示展开。
4. `Blocked` / `Skipped` / `Cancelled`：各组分别展示简明原因，默认各预览 2 项；不使用笼统的未验证总数替代。
5. `Passed`：按类别紧凑汇总；展开可见条目。
6. 项目路径/检查范围和 `Read-only: no files were changed.` 保留；证据、影响及详细原因在展开视图按所属条目显示。
7. 明确区分可展开的隐藏详情和预算导致的不可展示遗漏。默认异常预览数量/行数属于展示上限，不改变原始诊断覆盖范围。

## 安全与生命周期

沿用现有 collector/formatter 控制字符清理和报告预算；新增快照构建同样有界，不能把未清理 result 直接保存进会话。`index.ts:920-947` 已有最新 Check generation、abort 和关闭抑制，保留并回归，不扩大取消语义。renderer 不读取文件、不执行探测、不写个人设置。

## 预期变更文件

- `extensions/trellis/lib/initialization/diagnostics.ts`：状态分类、有界文本报告及可复用快照。
- 新增 `extensions/trellis/lib/initialization/diagnostic-report.ts`：主题感知的消息 renderer/注册，保持采集模块不依赖 TUI。
- `extensions/trellis/lib/initialization/command.ts`：只替换 Check 的结果发布路径。
- `extensions/trellis/__tests__/init-diagnostics.test.mjs`、`diagnostic-runtime.test.mjs`：更新必要的旧文案断言，保留安全及只读断言。
- 新增报告逻辑测试及必要的命令 fake-pi fixture 调整：注册/发布状态、紧凑/展开快照和回退。
- 仅在实际受影响时调整其他既有 fake-pi fixture；不改 runtime 模板、部署资源或历史 hash。

## 验证路径与限制

主会话直接实施并自审：范围限于展示，不修改权限、破坏性操作或公共执行协议。项目规范只允许 Trellis 逻辑/fake-pi 测试，不新增真实 Pi host/挂载 TUI/菜单流测试。因此验证状态分组、颜色语义选择、纯文本回退、预算和发布边界；不声称自动化用例证明真实终端视觉效果。若实现发现公共协议或安全层需变更，停止并重新评估范围及独立审查需求。
