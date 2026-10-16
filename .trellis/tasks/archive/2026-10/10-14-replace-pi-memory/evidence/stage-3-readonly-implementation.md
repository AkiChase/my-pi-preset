# 阶段3只读原生面板：实施能力门禁阻塞

2026-10-15，trellis-implement；共享 source/main。**未实施产品代码。当前旧可编辑候选仍未验收，不能提交为只读面板。** 按本轮批准的设计，原生能力不足必须报告，不能回退手工 slice/updateLayout/offset、自制滚动条或修改SDK。本次停在阶段3第一个能力门禁，未修改 PRD/design/implement/progress、入口或任何 memory 产品/既有测试文件；只新增本 evidence 及隔离能力探针/日志。其他并行修改保持。

## 实际阻塞

已读取 implement.jsonl 全部8条（引用均已完整注入）、当前 panel.ts/command.ts、完整 command owner 测试、installed Pi 1.2.0 TUI README、index exports、Stack/VStack/ScrollView 声明与实现、TUI/Regular/Fullscreen 声明、完整 TuiBase/TuiAltScreen/layout 实现、Pi extensions.md/tui.md，以及 InteractiveMode.showExtensionCustom 完整方法。由于门禁已阻塞，没有继续通读剩余全部 memory 文件/测试或开始产品修改；不宣称完成实施前材料审阅。

1. **公开 custom overlay 不进入原生 layout frame。** `pi-tui/dist/tui.js:978` 的 `TuiBase.compositeOverlays` 直接 `component.render(width)`，随后按 maxHeight 截掉数组。Regular、Fullscreen 共用这个方法。即使直接返回公开 `VStack`（不是包在不透明 wrapper 下），也没有 overlay 的 constrained native Stack/Scroll 布局。
2. `VStack.render` 是无界 document render；basis=0/grow=1 的正文不会获得剩余终端高度。本次 40×8 actual owner overlay 只有 HEADER+FOOTER 两行，body viewportHeight=0，常驻 scrollbar 不可见。若改为 auto basis，仍只有完整正文 document，宿主截去末尾，不是批准的固定 footer/native viewport 方案。
3. **Fullscreen 滚轮的原生 route 只查询应用 currentLayout。** `TuiAltScreen.doRender` 先为 `layoutRoot ?? implicitScrollView` 构建 frame，再 composite overlays。overlay ScrollView 不在 frame 中。`handleViewportInput` 对未处理的 overlay wheel 调用 `routeWheel`，其目标仍为 base currentLayout；overlay 的 overscroll=contain 因此不起作用。离线 actual SDK owner 回归中，滚轮坐标命中 overlay footer，overlay.scrollTop 保持0，底层 base.scrollTop 从0到1。
4. **不能通过已批准公开路径解决。** 公开 `isViewportTUI/setLayoutRoot` 仅有 Fullscreen；README 明确 native terminal-height layout semantics 不提供给 Regular。该方法替换整个应用 root，不是 overlay root；无公开 getter 可保存宿主现有 root，且本任务明确不修改主编辑器/宿主布局。公开包 index 也不导出 `renderLayoutFrame` / `LAYOUT_NODE`；直接导入 dist/layout、反射 host root、自己 render frame 或手写 wheel 路由都会扩大批准边界。未做这些产品调用，也未创建第二 renderer。

## 能力探针及首失败

`stage-3-readonly-native-capability.mjs` 是 evidence-only 离线 `node:test` 探针：实际 installed `InteractiveMode.showExtensionCustom` owner（仅测试通过 Reflect 调用，延续既有 owner regression seam），公开 VStack/ScrollView 直接作为返回 root，真正自建 TuiMainScreen/TuiAltScreen + 合成 Terminal，明确 overlay width/maxHeight100%、top-left、margin0。无真实PTY/个人数据/provider。finally 经 supplied done 关闭，断言 editor 焦点恢复且 setText零次，并 stop 自建 host。

- `stage-3-readonly-native-contract-first.log`：请求合同 **FAIL exit1，1/3**；两个模式 viewportHeight 实际0，预期6。保留未覆盖。
- `stage-3-readonly-native-capability-final.log`：第一轮观测断言 **FAIL exit1，1/3**。原因是探针错误预期 footer 被裁掉；basis-zero正文实际折叠后 footer 保留，但只有2行。这是 fixture 推断错误，不掩盖/覆盖首失败。
- `stage-3-readonly-native-capability-second.log`：修正观测断言 **PASS自然exit0，3/3**，证明当前能力缺口，不是只读产品验收。两个模式 overlay viewport0/bar false/height2；Fullscreen wheel 在overlay区域穿到底层；positive control 在**仅自建测试host** setLayoutRoot 同样树后 viewport6/bar true/footer visible，证明 native components 本身工作、失败属于 overlay接入。

## 验证命令与结果

Node24.14.1、pnpm10.33.0、已安装 SDK1.2.0，无下载/安装。两轮均现有SDK + 自建 PI_CODING_AGENT_DIR，结束清理仅自己的临时目录。第二轮 driver `b8wfdii7o` 自然完成退出0：

```sh
sdk_dir="$(node -e 'const f=require("fs"),p=require("path"); console.log(p.dirname(p.dirname(f.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')" || exit 1
agent_dir="$(mktemp -d)" || exit 1
export PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir"
e=.trellis/tasks/10-14-replace-pi-memory/evidence
node --test "$e/stage-3-readonly-native-capability.mjs" > "$e/stage-3-readonly-native-capability-second.log" 2>&1
probe=$?
node --test extensions/memory/__tests__/*.test.ts > "$e/stage-3-readonly-unchanged-focused.log" 2>&1
focused=$?
pnpm check > "$e/stage-3-readonly-unchanged-check.log" 2>&1
check=$?
rm -rf "$agent_dir"
echo CAPABILITY_PROBE_EXIT=$probe UNCHANGED_FOCUSED_EXIT=$focused UNCHANGED_CHECK_EXIT=$check
test "$probe" -eq 0 && test "$focused" -eq 0 && test "$check" -eq 0
```

- 能力缺口观测：3/3自然exit0。
- **未改变的旧候选** focused：58/58自然exit0，包含阶段1/2的37个既有 safety/prompt 回归；不代表新只读UI已存在/验收。
- **未改变的共享checkout** `pnpm check`：strict + full835/835 exit0，含manifest/sync，package full有force-exit，不能代替自然退出；并行session-assist代码影响总数。
- `git diff --check` exit0；匹配上述自有 test/check 命令的 `ps` 无残留。
- 新只读UI实现/交互/focus/Unicode/高度矩阵/刷新零写/provider0实际浏览回归：**NOT_RUN（产品未实施）**。
- 真PTY/物理mouse/IME、独立review、安装/sync/reload、个人config/data清理、提交/start/archive/递归派发：**NOT_RUN**。

## 主会话下一步

请向用户报告 native overlay 能力阻塞，保持新阶段3未完成。满足全部现合同需要宿主公开 overlay constrained-layout/mouse frame 支持，且 Regular 也需相应能力；当前未授权修改/升级SDK。不要以邻仓规划、positive application-root control 或旧候选58/58当作本面板交付。若用户调整合同/能力来源，主会话明确新的批准边界后再派实施；本次不自行选择手工兼容路径，不修改旧候选，主会话亦不应提交旧候选为只读Stage3。
