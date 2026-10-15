# 实施与验证计划

## 当前阶段与启动门禁
2026-10-15 用户确认“你这边可以继续了”，已授权按既定方案实施/验证。前置Recap已接受归档（archive/2026-10/10-14-builtin-recap/evidence/report.md），产品b48e37b；先执行S1，不修改归档前置任务。
本次S1委派普通trellis-implement执行限定抽取，主核实际diff后由普通独立只读agent审查；S2执行者与审查者分别选择。check.jsonl已准备4项真实spec引用，implement.jsonl有意为空（S1提示完整自含并要求手读任务/spec）；不宣称空manifest完整验证PASS，后续implementation派发前补齐实际上下文。

## S1 共享材料抽取
- [ ] 捕获Recap最终基线，读development/testing/guides规范、全部相关源码/测试和调用者。
- [ ] 将材料构造器及测试移至shared，更新Recap调用与host loading fixture，保留文本/身份/预算/空材料行为。
- [ ] 定向材料/Recap/共享测试自然退出，actual SDK projection/host loader与抽取前后等价验证。
- [ ] 主核diff及独立review，验证后按获批实施边界提交S1；不能混入前置任务未提交内容。

## S2 命名完整行为切片
- [ ] 核实公开SDK支持session级状态恢复、消费持久化与跨branch保守计数；旧状态迁移测试先行。
- [ ] 新两阶段额度与取消消费，删除周期评估/失败重试；手动不重置、外部标题保护、disabled/enable/reload/branch稳定。
- [ ] 统一共享材料及直接生成prompt，移除currentTitle，保留模型/思考/timeout/输出校验与身份围栏。
- [ ] 菜单/错误文案/中文docs/extensions/session-name.md同步，配置兼容。
- [ ] 覆盖至少第1/第9之后不再触发、失败/取消/aborted/重复settled、批量交付、手动优先、外部改名、恢复/分支/旧v1及预算边界。
- [ ] 主审与独立check、定向自然退出与actual SDK离线fixture；验证后提交S2。

## S3 整体验证
- [ ] temporary PI_CODING_AGENT_DIR与已安装SDK隔离，禁止下载/个人配置操作。
- [ ] `node --test extensions/session-assist/session-name/__tests__/*.test.ts extensions/session-assist/recap/__tests__/*.test.ts extensions/session-assist/shared/__tests__/*.test.ts`（实施时核实glob及新测试实际路径）。
- [ ] `pnpm check`、manifest测试、文档链接/JSON/whitespace/`git diff --check`；按testing规范区分forced-exit完整suite与focused自然退出。
- [ ] 独立审查实际共享合同与session级机会、主核实际修改与证据，最终验收逐项PASS/FAIL/NOT_RUN；fake provider不代表在线标题质量。
- [ ] 检查阶段提交与最终整合修复，保存必要证据于evidence/，不写research/；是否更新通用spec按实际发现决定，不创建功能专用spec。

## 限制
已授权产品实施与验证及scoped local stage commits。无安装、同步、reload、online、真实tmux、push、历史改写或归档授权。保存现有并行内容，不修改Recap任务文件。任务完成后另等接受与收尾授权。
