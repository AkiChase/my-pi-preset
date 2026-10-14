# 独立检查结果与修复

只读审查 `c52298af-e29e-4f4` 检查完整production/tests/PRD/spec，focused20/20通过但另行复现三缺陷；不写产品、不操作task lifecycle或在线请求。

1. P1旧handled interactive候选可被后来source=extension且downstream transform的交付复用：主修改input见extension清旧候选，歧义宁可少计。新增`extension transforms cannot reuse handled interactive attribution`。
2. P1同步name listener再次写入同名session_info，最终只核字符串就认外部title为owned：主捕获setSessionName前全部title IDs，必须恰好一个新增且最终entry匹配；多写为manual。新增`same-name reentrant external title entry is not adopted as automatic ownership`。
3. P2waitForIdle中due automatic先取消manual epoch：主加入独立manual generation/pending，settled不抢手动waiting；new input/switch/tree/shutdown取消旧manual。新增`pending explicit manual refresh takes precedence over due automatic settlement`。

修复后focused25/25自然退出（含actual SDK projection、actualAgentSession和actualhostloader）。原reviewer已被harness回收，resume返回Agent not found，不伪称同reviewer已复核；另开只读独立复核 `103d3ed9-edf8-44a` 专门验证三处修复，已完成：逐机制阅读确认无剩余阻塞；独立运行产品测试17/17通过（用了 --test-force-exit，不作为独立自然退出证据）。主此前25/25未使用force-exit，提供自然退出证据。

主最终隔离 `pnpm check` strict+697/697 PASS，日志 `/tmp/pi-bg/b7evjolsw.log`；`git diff --check`及new-code whitespace、README/来源文件本地paths通过。无真实在线模型/终端验收；不stage/commit/archive/push/install/sync/reload。
