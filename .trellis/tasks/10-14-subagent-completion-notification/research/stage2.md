# 阶段 2：通知失败与运行身份

阶段 1 checkpoint：c4a5678。

## 修改

- scheduleNudge 不再静默吞异常，当前有效 UI 下简短英文 warning，否则固定安全日志。无异常对象、prompt/result内容、持久诊断entry/schema或重试。
- 提示 sink 由 safely 隔离，旧 activation/shutdown 跳过反馈。
- individual sendMessage返回后核对 active、同一live record和捕获runId，匹配才标notificationDelivered（仅SDK同步提交，不宣称父模型消费/持久化ACK）。
- group post-send沿捕获run快照核对，不读可能变化的身份。

## 当前验证

- `./node_modules/.bin/tsc -p tsconfig.json` exit0。
- 临时agent-dir `node --test extensions/agent-tasks/__tests__/tool-waits.test.ts` 47/47，自然退出、exit0（/tmp/pi-bg/bkm7yrhg8.log）。
- actual factory/manager 回归覆盖throwing send、formatter getter、UI/log sink throwing、无持久entry、结果可取/无retry、同步actual Agent resume、send中shutdown。
- 新增UI warning真实tmux验证：五项PASS（/tmp/pi-bg/bqmddo5ya.log），root completion-tmux-05cw480h。实际formatter fault只注入测试registry record，不改sendMessage或产品；自然退出且无CLI/child残留。
- 全后端122/122自然退出、全仓714/714 configured force-exit，exit0（/tmp/pi-bg/b73kbd58k.log）。
- 独立普通Agent 8b552a08-db05-4fe确认无blocking，定向9/9自然退出。非blocking建议补group send内同步resume，已新增实际factory回归；阶段2待最终测试后提交。
