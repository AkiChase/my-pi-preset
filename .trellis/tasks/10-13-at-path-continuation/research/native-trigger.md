# 原生补全触发与接入约束（只读）

## 已核对版本与实现
本机安装 SDK 与项目链接均为 Pi 1.2.0。安装根：`/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/`。

- `@earendil-works/pi-tui/dist/components/editor.js:1018-1051`：无 autocompleteState 时，仅触发字符、字母数字点横线下划线等引发请求；路径 `/` 不触发。已有 state 时 updateAutocomplete。
- 同文件约 `1875-1893`：候选接受调用 applyCompletion、更新编辑器、cancelAutocomplete、onChange；没有目录继续请求。
- 同文件 `1985-1999`：force+explicitTab 单候选直接应用，未继续请求。
- 同文件 `1952-1962`：setAutocompleteTriggerCharacters 明确过滤 `/`。
- `components/editor.d.ts:243-249`：tryTriggerAutocomplete / requestAutocomplete 为 private，不可据 JS 可访问性称公开接口。
- `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:141`：公开 addAutocompleteProvider；可改变/合并候选，但本身不提供编辑器自动请求能力。
- `@earendil-works/pi-tui/dist/autocomplete.js:606-681`：明确目录 scope 后 fd 单层+递归结果去重排序，最多20项。保留原行为。

## 只读 provider 验证
用真实 CombinedAutocompleteProvider([], sourceCwd, managedFd) 调用 getSuggestions。@local 无结果（当前项目 local/ 被 ignore）；@local/、@./local/、@../、@~/、@/tmp/ 有结果。fdPath=null 则这些 @ 查询没有结果。调用 provider 仅证明有候选，不证明编辑器自动触发或真实 TUI 交互。

## 接入风险
不能只 addAutocompleteProvider 或注册 triggerCharacters=['/'] 然后宣称解决。不能注入强制 Tab，因为原生单候选分支会自动接受，与“只展示下一层”冲突。后续研究须完整阅读官方 extensions.md/tui.md 与 autocomplete 示例，核对公开 handleInput 的安全自动请求路径、生命周期和保留活 editor 的方式；若公开 API 不足，显式记录取舍并向用户说明，不隐式读取 private state 或修改 SDK。
