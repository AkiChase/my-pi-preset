# 实施报告：独立 @ 路径连续补全

## 状态与边界
用户已批准最终计划，指定当前工作区直接实施；主会话已 start。此报告为 implement 子代理的实做与自检证据，**不代表独立 check 已完成，也不代替真实终端验收**。未派发子代理、使用 worktree、执行任务 start/finish/archive、git stage/commit/push、install/sync/reload、依赖安装或 SDK 修改。

开始时的并行 dirty 已核对，参考 `/tmp/at-path-parallel-baseline.diff`。未编辑 `extensions/beautify/**` 生产代码／测试、`.pi/**`、其他 tasks 或 shared specs。共享 README 与 actual loader 仅增加本任务片段，保留并行 Beautify shell/default 改动。owning specs 与 PRD 最终 AC 留给主会话。

## 实际文件
- 新增 `extensions/at-path-completion.ts`：唯一顶层入口，现有 package glob 发现，无新依赖／配置／快捷键。
- 新增 `extensions/at-path-completion/{index,compat,editor,provider,token}.ts`：独立 activation、活实例租约／handoff、唯一内部能力、真实输入观察和 public provider 链。
- 新增 `extensions/at-path-completion/__tests__/{completion,early-cancel,host-reset,native-provider,native-red,owner}.test.ts`、`harness.ts` 与 `retention.mjs`：actual SDK/editor/host 回归，49 个测试。
- 新增 `extensions/at-path-completion/TESTING.md`：实际验证与限制。
- 局部修改 `extensions/agent-tasks/__tests__/host-loading-smoke.mjs`：actual loader 加载独立入口；shutdown 精确数从并行当前3改4；保留并行 renderShell=default assert。
- 局部修改 `scripts/pi-manifest.test.mjs`：单一入口、无 nested entry assert。
- 局部修改 `README.md`：概览、自带扩展、定向验证命令与内部风险。
- 更新本任务 `implement.md` 实做勾选，新增本报告与日志；未抢写 specs/PRD 最终验收。

## 核心实现
1. 活 editor `handleInput` 先委托原 receiver，再校验真实单个 `/` 插入前后全文／cursor；支持 raw、Kitty、modifyOtherKeys，排除 bracketed paste、jump、正文／slash command／email。已有 list 由 native update，不额外请求。
2. 唯一私有依赖为结构检测的 `tryTriggerAutocomplete(false)`；Pi1.2含义普通请求 force=false/explicitTab=false，新一轮唯一候选只展示。缺失／异常一次英文诊断，回到原生 Tab，无 SDK/private editing state 读写。
3. `addAutocompleteProvider` wrapper 委托 current 的 shouldTrigger/getSuggestions/applyCompletion，保持 receiver、trigger characters、候选语义与实际搜索；目录接受须 prefix、item value/label、结果 `@.../` 同时满足。列表键／鼠标接受及异步 force Tab 单项接受后，在 native 文本写入／cancel 后的微任务请求。
4. generation、pending 身份、expected text/cursor、focused/nooverlay 与活实例检查处理 Escape／下一输入／鼠标／文本替换／换 editor／shutdown。WeakMap ticket 区分 force Tab 异步接受与后续输入；单一 pending 可替换，无常驻轮询／无界队列。
5. public `setAutocompleteProvider` 入参局部观察，不读 private registry。用于取消尚未开始的 native debounce 和不响应 abort 的迟到结果；正常已展示 list 不重复重置，activation 关闭取消旧 list/request。装饰 `setText`/`insertTextAtCursor` 只使 pending 失效，原行为／receiver 保持。后装 opaque wrapper/provider 仍保留，退役 lease 清 editor/screen/provider/request，factory inactive delegate 不调用 host setter 重装旧 editor。
6. preserveHandoff 与 descriptor ownership 复用；actual setter 在 container 卸载后抛错时以同一 protected editor 回滚，测试真实 render/focus/cursor／继续编辑。unsupported accessor/nonconfig、overlay 不破原 UI。

## 红测与修正记录
### 真实 SDK 核心红证据
命令：`PI_CODING_AGENT_DIR=<mktemp> node --test extensions/at-path-completion/__tests__/native-red.test.ts`，无 force-exit，自然结束，**退出1：0 pass / 4 fail**。

四项均在 actual CustomEditor/TuiMainScreen + 确定性provider 中失败于 `isShowingAutocomplete(): false !== true`：无列表输入 `/`、列表 Tab 接受目录、列表 Enter 接受目录、force Tab 唯一目录接受后。文字都已由 native 写到预期目录位置；目录 Enter 未通过新实现才满足续提示。

原始日志：[native-red.log](./native-red.log)。随后本 baseline 文件改为断言原生关闭行为，增强断言另在 completion/early-cancel 等测试中保留，未删红测需求。

### 实施途中失败（不算通过）
- 首轮增强 26/29：jump fixture 用了错误键（应 Ctrl+] `\x1d`，非 Alt+]）；typing/delete fixture 复用了旧 promise 来响应新 native 查询，修正为新查询null，旧结果仍必须丢弃。鼠标fixture补公开screenX/Y类型字段。未改生产原生输入语义。
- owner 首轮4项失败：native退回Tab是在已经输入 `/` 后接受唯一child，预期应 `@local/child/` 而非 `@local/`，修 fixture，不改native。
- fd 初轮43/44：180ms固定等待在实际fd启动下不足，改为观察list有限等待2s；实际native临时目录查询结果核对，无替代搜索／下载。
- 第一轮 related 46/47、full652/653：**本任务实际 host loader 失败**，原因 `pi-tui/dist/utils.js` 在 host jiti alias 变成 `index.js/dist/utils.js`。Node-only测试不能证明host可加载。修token使用Pi1.2同等 delimiter/CJK/wrapper规则，无更多内部API；actual loader重跑2/2，随后related/full全绿。此问题不归因并行任务。

## 最终验证命令与结果
每轮使用：

```sh
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))));')"
agent_dir="$(mktemp -d)"
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
# 逐条保存退出码，结束清理agent_dir，不以最后一条覆盖此前失败
node --test extensions/at-path-completion/__tests__/*.test.ts
node --test extensions/beautify/__tests__/editor.test.ts extensions/task-ui/__tests__/editor.test.ts extensions/agent-tasks/__tests__/loading.test.ts
node --test scripts/pi-manifest.test.mjs
pnpm check
```

稳定最终代码结果：
- 独立扩展：**49/49，退出0，自然退出**；[focused-final.log](./focused-final.log)。
- 相关 actual editor/host loader：**47/47，退出0，自然退出**；[related-final.log](./related-final.log)。
- manifest：**6/6，退出0**；[manifest-final.log](./manifest-final.log)。
- `pnpm check`：strict typecheck通过；完整离线 **656/656，退出0**；[check-final.log](./check-final.log) 保存命令头与终态摘要，完整运行日志 `/tmp/at-path-check.log`。全量按项目脚本带 `--test-force-exit`，不将它作为资源自然退出证据。并行期间完整测试数量变化，最终无残留失败。
- `git diff --check`：退出0；额外扫描新untracked源码／本任务Markdown无尾空白；README与TESTING的相对文件链接核对无broken。
- 项目无单独lint命令，未宣称另跑lint。

## 已验证范围与限制
actual setter/resetExtensionUI、native列表mouse callback、未来factory、新activation与shutdown、活实例history/undo/paste/cursor、三owner多顺序与Down未安装、后装opaque wrapper/provider、真实GC均有回归。native fd集成使用本机既有fd与临时目录，ignored scoped、dot/parent/absolute/quoted、递归后代与20cap通过；`~/`在临时HOME/USERPROFILE子进程通过，未读取个人home。

公开 `addAutocompleteProvider` 按host规则重建链并取消安装时list/request：这是真实宿主行为，不保证初始化时旧list仍打开；活实例／草稿/history/paste保持。其独立入口不依赖Beautify/Task UI，组合测试仅为回归。

**未运行本扩展真实 CLI/PTY、终端 IME、实际 input-history 原包、任意第三方editor/provider完整组合。** 不 delegate 旧factory/链的未知插件不保证支持。内部方法存在不证明未来SDK语义稳定，升级需actual SDK回归。回滚只需禁用此入口，无用户数据迁移。

## 交接主会话
请独立 check 复核唯一私有接口、public provider setter取消边界、forceTab票据／代次、later ownership/GC、安全回滚与README范围；随后主会话维护 specs/最终PRD AC。implement子代理未执行独立check，也未关闭/归档任务或提交。
