# @ 路径连续补全验证范围

## 环境与命令
验证基线为本机既有 Pi 1.2.0 SDK，Node 24.14.1；测试只读 SDK，不修改安装文件或个人配置。每次执行使用临时 `PI_CODING_AGENT_DIR`，全量另指定实际 `PI_SDK_DIR`。无新增依赖、真实 install/sync/reload、模型或网络。

```sh
node --test extensions/at-path-completion/__tests__/*.test.ts
node --test extensions/beautify/__tests__/editor.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts
node --test scripts/pi-manifest.test.mjs
pnpm check
```

前两类定向测试不带 force-exit，要求自然退出。`pnpm check` 的全量 test 按项目既有脚本带 `--test-force-exit`，不得据此声称无资源泄漏。

## 实际执行范围
- `native-red.test.ts` 保留原生无增强对照：关闭列表输入 `/`、列表 Tab/Enter 接受目录、force Tab 单候选接受后原生均关闭列表。实施前以期望增强的断言运行，4/4 失败；原始日志与错误保存于任务研究报告。随后对照改为断言真实原生行为，生产增强另由其余测试验证。
- `harness.ts` 使用 actual `CustomEditor`、`TuiMainScreen`、`InteractiveMode` 的 `createExtensionUIContext`／setter／provider setup，不复制编辑或补全状态机。仅 terminal I/O、session 昂贵服务和候选输入是 fixture。
- `completion`／`early-cancel` 覆盖 raw／Kitty／modifyOtherKeys 单字符插入、引号光标、native 已有列表只更新一次、Tab/Enter/force Tab 唯一候选不自动钻入、文件尾空格与正常 submit。Escape、后续输入／删除／光标／鼠标／相同文本替换、focus／overlay／换 editor／shutdown 在 debounce 前及 provider await 后取消自己的续请求。后续输入可正常产生新原生查询，测试不误将新查询当过期结果。
- `check-regressions` 补充独立复核：debounce 尚未进入 provider 时失焦／overlay 不迟到开框，modifyOtherKeys 的 Shift／Caps／Num Lock 可打印 `/` 与普通请求一致；非 `@` trigger 和普通 force Tab 不被本扩展代次过滤／取消。原生 copy no-op 保留 provider 请求（含 agent mention），但仍取消目录续请求微任务。后装 delegating setter 转换 provider 后，关闭不会重入该转换叠加一层；nondelegating setter 所有权变更时不回写旧链。目录识别同时要求 SDK 的 label `/`、`@` value 与实际结果光标，不以任一单项猜测。
- `owner`／`host-reset` 执行 actual setter 与 resetExtensionUI、native 列表鼠标接受，覆盖活实例、history browsing draft、undo、large paste、callback／receiver、later opaque wrapper/provider、新 factory、shutdown 后不重新安装旧 factory。真实 GC 子进程验证退役 input wrapper 不保留 editor/screen。
- 安全降级包含缺失唯一内部方法、不可配置／accessor input、setter 在真实 container 卸载后抛错、安装时已有 overlay、request 异常；检查 container render、focus、cursor 和继续编辑，非只检查方法恢复。
- 多顺序组合执行本仓库真实 Beautify／Down；history 与 agent mention 是独立离线 public fixture，含 Down 不安装的顺序。未读取本机 input-history 包。
- `native-provider` 使用既有 fd、临时目录与 native `CombinedAutocompleteProvider`：ignored local unscoped 不显示而 scoped 可显示，dot／parent／absolute／quoted、递归后代与最多20项、fd absent 原生 no-result。`~/` 在临时 HOME/USERPROFILE 子进程中验证，不扫描个人 home。fd 耗时按可观察 list 状态有限等待，非固定延迟保证。
- actual host loader 测试已加入独立顶层入口，仍验证唯一工具注册、root/child guard 与 shutdown；manifest 确认嵌套 helpers 不作入口。

## 兼容性与已知边界
唯一私有能力为 `tryTriggerAutocomplete(false)`，定义于 `compat.ts`。其 Pi 1.2 含义是 force=false/explicitTab=false；未来仅检测函数存在不能证明语义稳定，升级须重跑 actual SDK 回归。无私有 state/history/paste/requestId 读写，无模拟 Tab／临时字符／哨兵候选，无新搜索实现。

公开 `addAutocompleteProvider` 会按宿主规则重建链并取消安装时的 native 列表／请求。handoff 保留活 editor 与其他状态，不承诺列表在 provider 安装期间仍打开。公开 `setAutocompleteProvider` 的实际入参被局部记住，用于取消尚未显示的 native debounce／请求；不读取 registry，不重建候选，不移除 later provider。取消仅在最后一次观察到的 setter 所有权仍匹配时，重放该层已接收的 public 参数，不从 later setter 顶层再包裹一次；未委托旧层的替换不回写旧链。额外候选代次过滤限 `@` token，不过滤其他 trigger、slash commands 或普通 Tab。正常操作中已显示列表仍交原生处理；activation 关闭时通过同一 public setter 层取消旧列表／请求，不重装 factory。未知不 delegate 原链的未来 editor/provider 不保证继承增强。

host jiti 对 pi-tui 子路径有 alias 限制，不能 import `dist/utils.js`；token 模块采用 Pi 1.2 同等 delimiter/CJK/wrapper 规则，actual loader 回归防止再出现 Node-only 成功、host 失败。

## 真实 tmux 验收

用户授权后，真实 installed Pi1.2.0 CLI在独立tmux服务、临时HOME/配置/cwd/sessions中显式加载本入口。dark/fullscreen固定140/80/40列最小矩阵均PASS：逐字符输入/（无Tab）、相对/父目录/临时home/绝对/引号路径、Tab/Enter与forceTab接受目录后唯一子项仅展示、文件接受尾space、Escape不反弹、普通Enter离线提交一次。候选来自原生fd；测试probe只观察公开输入/文本/submit，不直接调用editor或内部请求。六轮CLI真实退出、独立服务停止、临时配置删除已复查。

两次早期夹具FAIL保留：Escape未等首次关闭画面、parent期望在五个可见项外；修正夹具后三个完整轮通过，未修改产品。屏幕证据为capture文本/SGR与原始写流，不是图片；固定宽独立启动不是动态resize验收。报告保存在任务归档的tmux-validation.md/json，不作为发放资源。

**未进行物理 IME、实际 input-history 包、regular／其他主题、动态resize或所有第三方组合验收。** 既有离线压力/生命周期测试与本轮真实键盘矩阵各自列明范围，不互相冒称。
