# 修复 @ 路径补全的过期候选重复前缀

## 目标

阻止异步更新期间接受旧候选而产生 `@~/@~/Downloads/` 等重复前缀，保留正常路径补全和目录续补行为。

## 授权与约束

- 用户已批准本轻量方案直接实施、主会话自审与范围内本地阶段提交；不归档任务。
- 主会话自行排查、规划和后续实施/自审，不启动 Agent。
- 本任务独立于 `10-16-npm-test-resource-usage`，不修改其材料或扩大其已批准范围。
- 不修改已安装 Pi SDK，不安装依赖、不同步或重载个人配置、不 push、不归档。

## 已确认原因

- Pi 1.3.0 原生 `dist/components/editor.js:611` 在列表打开时直接接受高亮项；输入更新调用 `updateAutocomplete()`，旧列表在新结果返回前仍可接受。
- 原生 `dist/autocomplete.js:294–295` 按 `cursorCol - prefix.length` 保留前面的文本，再拼接完整候选 value。
- 受控内存 provider 配合原生 Editor 及本项目 `decorate` / `wrapProvider` 已复现：旧列表 prefix 为 `@~`，当前输入为 `@~/Do`，立即 Tab 得到 `@~/@~/Downloads/`；等待候选更新后得到正常 `@~/Downloads/`。这是组件级受控复现，不是真实终端或真实 fd 验证。
- `extensions/at-path-completion/provider.ts:49–53` 先调用原生替换，再检查 token 是否一致，因此当前检查不能阻止错误替换。
- 早前针对个人 HOME 的原生 fd 探测被 SIGKILL 终止（退出码 137），未获得候选结果；该失败不能证明候选排序或目录过滤，后续验证不扫描个人 HOME。

## 需求与技术方案

- R1：在 `wrapProvider.applyCompletion()` 委托原生替换之前，校验 attachment 候选的替换 prefix 与当前光标前的完整 token 是否一致。
- R2：必要时在已有候选 WeakMap 记录查询文本及光标快照，识别替换位置错位；不直接以现有 generation 相等作为正常接受条件，因为真实 Tab 输入也会递增 generation。
- R3：候选过期时返回未修改的文本和光标，不使用旧候选，也不把旧候选强行套用到当前 token。
- R4：原生接受流程关闭旧列表后，重新请求当前输入的普通候选，只展示、不自动接受；沿用现有微任务与输入/焦点/overlay/关闭取消机制，不引入私有列表状态读写。
- R5：正常 Tab/Enter 接受、文件尾空格、目录续补与非 attachment provider 行为保持不变；不改变候选排序和 Tab 选择语义。

## 轻量验证与阶段检查点

- 优先在现有 `completion.test.ts` 增加一个紧凑回归，参数化 Tab/Enter，复用实际 SDK 组件；用内存 provider、可控 Promise 和明确握手控制旧列表及待返回的新查询，不靠重复尝试或固定长等待碰竞态。
- 如需推进 native debounce，核实 Node mock timers 与 SDK 兼容性后使用；测试同步必须证明请求/更新完成，不能把单次微任务让步当作完整更新证据。
- 不新增测试入口、CLI/GC driver、真实 fd/个人 HOME 扫描、子进程或路径/编码/取消组合矩阵；已有正常功能测试继续复用。
- 实施前读取相关开发与测试规范；在临时 agent-dir 和已有 SDK 隔离下运行 focused 自然退出检查、typecheck 及按影响所需的完整套件，不并行运行多套全量测试。
- 作为一个验证阶段处理：局部代码、紧凑回归和必要资源声明保持一致；实施获批后，主会话检查实际差异与验证结果，再创建范围内阶段提交。测试命令、退出码、失败及重跑事实、耗时/资源限制与提交 hash 记录于本 PRD。

## 验收标准

- [x] AC1 / R1–R3：`@~` 旧列表尚未更新、当前文本为 `@~/Do` 时接受，不出现重复前缀，文本和光标保持当前输入。
- [x] AC2 / R4：过期接受后展示当前输入的新候选，不自动填入；再次接受可正常补全。
- [x] AC3 / R3–R5：Tab 和 Enter 都阻止过期候选；Enter 不意外提交消息，正常目录与文件接受行为通过现有回归。
- [x] AC4 / R4：刷新沿用已有取消保护，后续输入/Escape/失焦/关闭不能造成过期刷新反弹；优先复用已有覆盖，确有缺口才增加最小断言。
- [x] AC5：紧凑回归可确定性证明旧行为失败和修复通过，不调用真实 fd/CLI、不扫描个人 HOME、不增加固定长等待或冗余矩阵；focused 自然退出。

## 实施与验证记录

- 主会话实施并自审，仅修改 `extensions/at-path-completion/provider.ts` 与现有 `completion.test.ts`。无 Agent、SDK 修改或新测试入口。
- 候选 WeakMap 增加查询文本/光标快照；只有当前 lease 记录的 attachment 候选接受前校验，其他 provider 委托不变。拒绝过期候选返回原文本/光标，复用从既有目录续补提取的 `scheduleSuggestions()`；它完整保留 pending identity、generation、焦点/overlay、文本/光标和列表关闭校验。
- 正常接受不比较 generation，避免把 Tab 本身视为过期。原生 no-op 接受仍通知一次 onChange，回归显式确认文本/光标不变、没有 submit；不改写 SDK undo 状态。
- 新增一个参数化 Tab/Enter 的回归：mock setTimeout 推进 20ms native debounce，Promise 握手保持第二次查询未完成，实际 SDK requestRender 证明新列表已应用。无新增真实等待、fd、HOME 扫描、进程或 driver；finally 释放阻塞 Promise 并关闭夹具。
- 环境：Node `v24.14.1`，已有 Pi SDK `1.3.0`；验证均设置 `PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules`、`PI_CODING_AGENT_DIR=/tmp/at-path-stale.LG8Neq/agent`。SDK 链接命令报告 0 new；无下载依赖。

| 检查命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='stale attachment list' extensions/at-path-completion/__tests__/completion.test.ts`（修复前） | FAIL，退出码 1，明确得到 `@~/@~/Downloads/`；1 项失败，测试主体约 5ms，总进程约 421ms。 |
| 同一命令（修复后） | PASS，退出码 0，Tab/Enter 都通过；1 项通过，测试主体约 7ms，总进程约 411ms。不是资源性能基准。 |
| `node --test extensions/at-path-completion/__tests__/*.test.ts` | PASS，退出码 0，60/60，约 8.69s，自然退出；既有测试包含临时目录 fd/临时 HOME 集成，新回归未新增这些边界。 |
| `pnpm typecheck` | FAIL，退出码 2；只报告范围外 `extensions/agent-tasks/__tests__/tool-waits.test.ts:466,899` 的 TS2322（string 或 undefined 不能赋给 string）。该文件已有并行未提交改动，未修改它。 |
| `pnpm test`（一次，文件并发 8） | FAIL，退出码 1；1536 项，1518 通过、18 失败、0 cancelled，约 82.53s。路径回归通过；全仓 forced-exit 不能证明自然关闭。 |
| `git diff --check` | PASS，退出码 0。 |

全量失败均在本次两处产品/测试修改范围外。检查实际失败输出：backend-waits 与 tool-waits workflow launcher 仍期待 `task_id/run_id`；loading/Beautify composition 仍期待 `task_manage`，实际为 `agent_manage/process_manage`；workflow-failure-host 五项传入已拒绝的 task_id；Beautify registered-agent/retrieval、Task UI mixed-waits/sdk-runtime 沿用旧管理工具/结果；另有 tool-waits closed callback 未拒绝、workflow pause stale execution 和 runtime retained-child 未 settle。具体入口与本次失败计数：

- `agent-tasks/__tests__/backend-waits.test.ts:77`（1）、`loading.test.ts:55`（1）、`tool-waits.test.ts:514,1032,1065`（3）、`workflow-failure-host.test.ts:71,91,104`（5）。
- `beautify/__tests__/editor.test.ts:150`（1）、`registered-agent.test.ts:19`（1）、`retrieval.test.ts:43,169,258`（3）。
- `runtime-tasks/__tests__/retained-child.test.ts:89`（1）；`task-ui/__tests__/mixed-waits.test.ts:25`、`sdk-runtime.test.ts:161`（2）。

不把范围外失败归因于本次补全修复，也不宣称全仓通过；未进行旧基线全量重跑或顺手修理其他任务。局部阶段可验证，任务保持 in_progress，整仓整合验证受并行改动阻塞。原始日志保留在本次自有 `/tmp/at-path-stale.LG8Neq/` 供失败复核，未清理、不复制进仓库。未跑真实终端/个人重载，组件测试不证明物理输入或任意第三方组合。既有规范已覆盖异步来源校验和轻量边界，无需另造 spec 文档。

## 范围外与风险

- 不承诺解决所有异步问题、任意第三方不委托的 provider/editor 或真实物理终端输入问题。
- 过期时首次 Tab/Enter 只刷新，用户需再次接受；这一交互已向用户说明。
- no-op 的 applyCompletion 仍可能触发原生 undo/onChange 流程；实施时核实不会引起提交或额外目录续请求，不通过改写 SDK 隐藏副作用。
- 节点定时器模拟、provider 包装顺序和快照校验范围需在实施前核实；如发现必须扩大到公共跨模块契约或改变正常接受交互，先重新确认范围。
