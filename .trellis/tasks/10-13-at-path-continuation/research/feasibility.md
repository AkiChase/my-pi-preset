# 独立插件可行性核验

## 文档与公开 API
完整阅读安装 SDK `docs/extensions.md`、`docs/tui.md`、`examples/extensions/github-issue-autocomplete.ts`；核对 Editor 声明与真实 JS 接受分支。公开 provider wrapper 能观察 `applyCompletion`，但没有请求原生候选框的公开 API。公开 Editor 有 handleInput/getText/getLines/getCursor/setAutocompleteProvider，主动请求方法为 private。`triggerCharacters` 注册会过滤 `/`。

项目 Beautify 的 editor owner 已通过公共 TUI focus 和 preserveHandoff 保留当前活实例装饰；这是保留 editor 的接线先例，不代表主动补全已拥有公开接口。

## 实际 Editor 隔离实验
使用本机 Pi1.2.0 实际 Editor/TuiMainScreen、临时 PI_CODING_AGENT_DIR、确定性 provider；未启动终端或模型，未写产品代码、SDK、个人配置。命令退出0，五组断言通过：
1. setText('@local') 后 handleInput('/')：请求0、候选关闭。
2. handleInput(Tab) 后仅一项 '@local/child/'：原生自动接受，列表仍关闭。因此模拟 Tab 不满足只展示语义。
3. **显式实验调用 private `tryTriggerAutocomplete()`**：仅一项也显示列表，文本保持 '@local/'，不自动接受。
4. 列表中 Enter 接受目录：文本 '@local/child/'，列表关闭，onSubmit次数0。
5. 显式 private follow-up：下一层唯一目录候选显示而未接受，Escape 关闭。

此实验仅证明内部普通请求可实现核心语义，不证明完整插件生命周期、history、IME、真实 PTY 或所有插件顺序。

## 当前结论
无需修改 Pi SDK 的独立插件在运行机制上可行，但要复用原生候选 UI并保持用户规则，最小方案需要一个显式可选的内部能力适配：触发普通请求（force=false / explicitTab=false），不是伪造Tab。公开 handleInput 装饰处理手动 /；provider applyCompletion 观察目录接受并在原生写入/关闭后请求。原生负责单候选展示、debounce、request snapshot/abort；插件仍须防关闭/更换editor/异步接受后迟到及Escape重开。

纯公开 API当前未发现等价请求入口。重做自有候选 UI虽可走公开组件，但要接管展示/选择/编辑替换，范围与状态风险远大于本任务；临时字符、哨兵候选、keybindings临时改写不建议采用。

## 独立静态复核
独立研究 agent f8f1d4aa-2e3d-45f 完整核查 provider、Editor、CustomEditor、keybindings 与 host 接线，结论与实验一致：没有纯公开 API的等价原生列表请求能力，最小内部接口可选 requestAutocomplete({force:false,explicitTab:false}) 或其薄包装 tryTriggerAutocomplete(false)。公开接口反证覆盖 setAutocompleteProvider、模拟输入/重绑快捷键、raw listener、onChange、修改provider options与继承CustomEditor，均不能在保规则下补齐。

补充边界：原生真正零候选时会关闭列表，不展示空列表；本任务“此前无候选也能触发”不承诺空目录空列表。实际屏幕 getFocusedComponent 不在通用TUI interface中，须做能力检测，不能当所有第三方宿主的专用editor获取契约。复用本项目handoff时仍需验证same-instance setter不丢状态，不能盲目重装。

## 待用户选择的风险
若接受窄范围内部接口适配，可继续独立插件设计，需明确以Pi1.2.0为验证基线、结构预检、不兼容时保原生Tab并诊断、隔离接口依赖、独立回归与升级复核。不得把JS可调用称公开API。若要求完全公开API且复用原生列表，需等待/请求上游提供public请求接口，或另行授权核心改动；不是现有插件接口直接可做。
