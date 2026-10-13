# 阶段2A独立审查：抛错UI路径

只读trellis-check `872e92bb-ef2a-453` 实际检查core/process implementation/tests，未审查deferredagent/UI/epoch。正常311process/core定向tests、22manifest/sync/standalone、真实strict与diffcheck通过，但4个focusedofflineassertions失败，确认3项缺陷。

## 确认问题

1. **blocking**：process bash.ts:164,246–247,260–263；hint.ts:60–63。2秒show hint setWidget抛错，finally cleanup再次setWidget抛错，mandatory lease.dispose未执行。actualfakeclock/spawn/fs/signals复现statusrunning/waitCount1/abortHooks1/foreground0。需要UI异常不妨碍mandatoryresource/leasecleanup，不保留已rejecttool的运行进程。
2. **should-fix**：jobs.ts:275,314–315。completed lease先markOutcomeSurfaced，ui.notify随后抛错阻止inline result返回；actualjobs/lifecycle/coordinator复现resultrejected,outcomeSurfacedtrue,notifications0,retryfalse。optionaltoast必须隔离，保持atomic consumption且返回report。
3. **should-fix**：bash.ts:295–296和bash-bg.ts:69–73。backgroundcaller启动后startBackgroundJob initialstatus抛错，缺rollback；两实际mockspawn复现jobrunning/abortHooks1/retrytrue。必须silentstop/hookscleanup并保留file，不改monitorbuffer/pending。
4. **doc**：README inventoryprocessrow包含shortcuts且无task-ui.jsonrow，与实际sharedconfig不符。

## 修复安排

`task-process-error-fix` / `0d8f0774-e529-45d`只动process工具/hint/回归、READMEinventory/provenance，另存process-error-fix.md；agentstage2B不动这些路径。主会话已通知2B UI异常教训，不能把optionalnotification/widget抛错放在mandatorycleanup/report之前。

Stage2A正常路径gate保持已有证据，错误路径项重新打开；修复完成前不宣称AC9/AC10processslice满足。Completeepoch/UI仍未实施，不能用这次cleanup修复替代phase3。
