# 实施计划

## 授权

用户已批准改后的显式非nullable参数版（-1/0/正数与删除run_in_background）。S1额外同步已审阅的旧timeoutMs配置退役，S2 memory_list显式三个参数。trellis-implement逐阶段实施、独立trellis-check审查、main核验提交；manifest已准备。批准不含docs/README/spec编辑、安装/reload/push/归档。原机械nullable计划已被本版替代，下面旧nullable检查措辞按required非nullable与领域值验证替换，不作为实施要求。

## S1 Bash（先审查提交再S2）

- [ ] 刷新Git和任务状态，完整读最终owner/callers/tests；读取相关spec/checklist（只读）。创建repository-external owned临时run/config目录。
- [ ] 先真实host探针required数值/字符串字段的null/false/0/空字符串/正小数，记录转换限制。
- [ ] required非nullable schema与parser/执行纯校验；-1/0/正数三态和旧timeoutMs配置明确退役，保持removed字段提示、输出contract、模式/生命周期。
- [ ] 完整Agent-facing例子和指引，test-only helper迁移实际registered override调用，不改内置tool调用或仅metadata fixtures。
- [ ] host/direct缺失unknown-null类型、显式值、边界和零effects回归；运行下列验证。
- [ ] 独立check实际diff与验证，main确认发现并修复重跑，精确stage commit并记录hash。

```sh
node --test extensions/process-tasks/__tests__/bash-schema.test.ts extensions/process-tasks/__tests__/bash-prompt.test.ts extensions/process-tasks/__tests__/bash-bg.test.ts extensions/process-tasks/__tests__/bash-results.test.ts extensions/process-tasks/__tests__/sleep-guard.test.ts extensions/runtime-tasks/__tests__/prompt.test.ts
node --test extensions/process-tasks/__tests__/*.test.ts extensions/runtime-tasks/__tests__/*.test.ts extensions/task-ui/__tests__/*.test.ts extensions/beautify/__tests__/*.test.ts
node --test extensions/agent-tasks/__tests__/loading.test.ts extensions/agent-tasks/__tests__/tool-waits.test.ts extensions/agent-tasks/__tests__/backend-waits.test.ts
pnpm check
git diff --check
```

## S2 memory_list

- [ ] 完整读tools/store/policy/entry、相关tests及prompt/loader边界；不得改个人memory数据。
- [ ] host探针独立确认非nullable query/offset0/limit0/false/null行为。
- [ ] required非nullable schema与入口安全错误parser，getOrigin前拒绝invalid，内部store不改。
- [ ] 必要Agent-facing注册指引与test-only helper；完整host/direct和分页、disabled/lifecycle回归，memory_write数据null保持。
- [ ] 独立check，main核验修复重跑并立即stage commit。

```sh
node --test extensions/memory/__tests__/tool-schema.test.ts extensions/memory/__tests__/tools.test.ts extensions/memory/__tests__/loading.test.ts extensions/memory/__tests__/prompt.test.ts
node --test extensions/memory/__tests__/*.test.ts
pnpm check
git diff --check
```

实际文件和新增tests执行前核对，不因清单漏项缩减受影响范围；node --test不force-exit。pnpm check的full force-exit不能证明资源自然退出。所有原始日志放owned临时目录，main核验后清理；失败事实/重跑关系、命令环境exit code、未跑真实provider/物理终端保留本文件。独立review不以实施自检代替。

## S1 已完成

checkpoint `55ad847 feat: use explicit bash foreground and background values`，25精确文件；Memory未改。实施focused38/38 exit0，broad首次2个Beautify旧fixture失败、修复后564/564自然退出exit0；Agent77/77自然退出exit0。typecheck初次旧prepareArguments泛型/描述类型失败，修复后pass；加强prompt测试另一次缺ToolCall.type失败后修复，最终pnpm check1430/1430 exit0。独立check21605757-bb7c-434只读全diff无阻断，独立focused38/38自然退出、tsc、diff-check exit0。额外临时host driver首次缺keepalive exit13，修复driver后exit0；main核对实际日志/summary。

实际安装SDK built-in bash没有运行时prepareArguments；override显式清除继承signature/可能的外部旧prepareArguments，不能宣称当前SDK正在旧转换。host scalar转换null/false/空字符串阈值->0仍有raw输入限制，direct严格拒绝。旧timeoutMs file/env明确warn，Monitor内部timeoutMs不改。真实provider/物理终端NOT_RUN；无docs/spec修改。原始日志/tmp/bash-explicit-Urfqt6保留到main完成两阶段核验。

## S2 已完成及最终状态

checkpoint `cef4126 fix: require explicit memory list parameters`，6精确文件。main核对实际tools边界diff、schema/fixtures及独立日志摘要；独立check8e70ae77-3872-489只读完整6文件无阻断。实施focused24/24与all69/69自然退出exit0；最终pnpm check1436/1436含typecheck exit0。首次check因测试driver Record不满足SDK JsonObject exit2，测试cast修正后全量重跑；首次whitespace no-index exit1只是存在差异，正确wrapper重跑无诊断。独立focused24/24、all69/69自然退出、tsc、diff-check exit0。

host限制：query null/false/0转字符串，offset null/false/空串/undefined转0；query undefined转空串，缺字段仍拒绝。direct入口严格拒绝原始null/错误类型，固定MemoryError在getOrigin前；不改SDK或其他Memory工具。真实provider/物理终端NOT_RUN。没有docs/README/spec本任务修改；旧bash参数/timeoutMs声明保持只读并记录，不声称文档当前准确。

所有原始材料/tmp/bash-explicit-Urfqt6已由main核验（实施/独立review日志与exit文件、host probe），两个阶段和代理均终态；仅清理本owned目录，失败事实/重跑关系保留在本文件。用户已明确验收并授权收尾（“收尾吧”）。本次仅归档和journal；SDK原始值转换限制、真实provider/物理终端NOT_RUN及docs/spec旧表述待另行授权清理的事实保留。无安装/reload/push或历史重写，并行改动保留。最终git diff --check通过。

## 规划结果

已核对Bash schema及完整schema/output/prompt测试、Memory entry/store/tools及完整tool/schema测试。`extensions/process-tasks/bash-schema.ts`不存在；实际schema owner为tools/bash-params.ts，不使用猜测路径。已绑定本任务但status仍planning；未执行产品测试或修改产品代码。
