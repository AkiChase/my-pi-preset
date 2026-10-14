# @ 路径连续补全设计

## 1. 边界与目录
独立入口 `extensions/at-path-completion.ts`，导出嵌套 `extensions/at-path-completion/index.ts` 的 factory。建议 helper：`token.ts`、`provider.ts`、`editor.ts`、`owner.ts`、`compat.ts`，测试置 `__tests__/`，验证范围置 `TESTING.md`。命名与拆分可按实际复杂度合并，不增加第二个顶层helper入口。

不依赖 Beautify/task-composition/fff；仅复用已有通用 editor-handoff。主入口通过 package.json 现有 `extensions/*.ts` 自动发现，更新 manifest/actual-loader 的精确入口断言，不新增包、键位或配置文件。不发布第二个 npm/git 包；“独立插件”指本preset内可独立加载的扩展入口。

## 2. 核心行为
用户手动输入 `@path/` 或原生接受目录得到 `@path/` 后，普通请求原生候选列表。新一轮无 explicitTab/force，因此唯一候选不会自动接受。接受文件保持原生结果，不续请求。目录为空保持原生无列表行为。搜索、递归范围、20项上限、ignore、排序全部由现有provider链决定。

## 3. 唯一内部能力
`compat.ts` 只适配当前 editor 的 `tryTriggerAutocomplete(false)`；其当前含义是 requestAutocomplete({force:false,explicitTab:false})。不调用更多private方法，不读/写private autocompleteState、state、requestId或undo/history/paste字段，不改SDK/prototype/global keybindings。使用 unknown+结构校验明确标注内部接口，不用any或ts-ignore掩盖类型边界。

能力检查：实际editor须提供公开getText/getLines/getCursor/handleInput/isShowingAutocomplete，实例方法可安全装饰，内部请求方法是函数；Screen须能安全取focus且无overlay。Pi1.2.0是实际验证版本，不声称方法存在就保证所有未来版本行为；不能可靠检测语义变化，升级必须重跑回归。不硬锁整个preset SDK peer到单一版本。

内部能力缺失/接入失败/调用异常：该activation停止增强并给出一次英文诊断；原编辑器、provider查询、Tab仍正常。不伪造Tab，不通过临时字符或候选注入绕过。

## 4. 输入触发
以实例handleInput装饰原receiver，先执行真实按键，再检查公开文本/光标和操作结果。识别真正插入的单个 `/`（包括SDK支持的终端编码），不能因Jump、快捷键、paste、移动光标后恰好落到 `/` 而误触发。跟踪自己的bracketed paste输入阶段用于排除，不读取SDK私有paste状态。不把整段粘贴当手动目录进入。

仅在合法 `@` 文件token中且光标位于目录分隔符后触发；支持相对/绝对/~/../和引号，允许光标在闭引号前。token边界参考SDK公开delimiter工具和实际extractAtPrefix行为，覆盖中英文标点/wrapper，不把email或agent handle当路径。slash command上下文和非editor focus/overlay不处理。

已有列表时原生handleInput会更新，不额外请求；无列表时调用普通请求。一次操作最多一次增强请求，不根据render或单纯文本末尾 `/` 反复触发。

## 5. 接受触发与provider链
在session_start使用公开addAutocompleteProvider包裹current：getSuggestions/shouldTriggerFileCompletion保持原样委托，applyCompletion先委托原实现，再观察prefix、item与返回的文本/光标是否代表合法 `@` 目录。不能仅凭label判断，不把agent mention或slash command当目录。

目录接受时安排一个有界异步后处理，在原生已写入文本并cancel旧列表后进行；覆盖列表Tab/Enter、原生forceTab单候选直接补全（异步路径）、原生列表接受回调。不要在applyCompletion里同步请求，否则会被随后cancel掉。

记录activation/editor identity、操作generation和原生applyCompletion返回的预期全文/光标。后处理必须仍同一个活实例、同文本/光标、focused且无overlay、generation未被后续输入/鼠标/取消或关闭推进才可执行；校验不满足就丢弃。后装provider wrapper仍委托原链可正常观察；不委托的替换provider不保证支持，保持原功能。

## 6. 竞态和取消
装饰handleInput在每次真实输入前使之前后处理失效；兼容原生多字符/单候选异步应用。必要时装饰公开handleMouse取消待续请求，不占有鼠标行为。Escape只委托原逻辑并取消自己的pending，不因目录字符串未变而重开。重入保护避免插件请求自身触发无限循环。

只有真实接受记录才创建pending；记录不长期保存全文，不持无界队列。一次pending替换前一个，用微任务/单次scheduler而非常驻轮询或render触发。关闭先清cell/generation/pending再释放方法租约；迟到微任务看到inactive直接返回。已有原生请求继续使用SDK自己的abort/snapshot机制；插件不得在retired editor上发新请求。

## 7. 活编辑器与生命周期
参考既有owner的公共UI custom同步probe、实际screen focus、factory/handoff接线，保留当前活实例和receiver/subclass/history/undo/cursor/paste/IME，不new+copyText替换用户编辑器。

先完成能力/descriptor预检与装饰，再由preserveHandoff屏蔽同实例host重复setText和回调接线；host setter失败须恢复实际container/focus可用性。后续factory委托之前factory并对新实例按能力装饰。各activation拥有自己的cell/leases/seen，不创建全局mutable editor。

与Beautify/Down/history不同顺序均安全，不按文件字母顺序建立正确性。shutdown/reload退役wrapper清引用并成为inactive delegate，仅恢复仍由自己占有的descriptor，不通过setter重装旧factory，不覆盖后来wrapper/provider。当前activation真正切换editor时旧lease失效；取消的before-switch不提前永久关闭。

## 8. 文档与验证
README增加概览与独立扩展说明，明确规则、Pi1.2.0基线、内部兼容依赖、不兼容退回Tab、保留原生搜索。新增定向测试命令与TESTING.md，规范仅写有实际回归证据的经验，保并行hunks。

实际SDK Editor/CustomEditor和host setter用于回归，不复制补全状态机。核心红测：关闭列表后输入/不提示、接受目录后不续提示。确定性provider覆盖唯一候选与时序；临时真实目录+原生provider验证路径值/引号，不扫描个人home（home映射使用隔离子进程临时环境）。实际fd不可用时报告该集成用例限制，不下载工具。独立check与完整离线验证必须完成；真实终端/input-history未运行时如实列明。

## 9. 回滚
停用此独立入口即回到原生补全；无配置迁移、无磁盘索引或数据变化。工作代码与文档不触碰其他任务的Beautify工具展示、Task UI redesign、memory/runtime工具改动；共享README/spec/loader测试只做局部合并。
