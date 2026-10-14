# 阶段 1：入口契约

## 修改

共享 spawn-input 负责 description 规范化和程序化 type/prompt/options 最小结构检查；factory 在 agent 类型解析之后回退描述。manager 在 admission 前守住 description 不变量，record 与 cleanup 使用同一规范化值。RPC 有效 requestId 保持 v2 reply envelope，无有效地址安全跳过并输出简短日志，不生成 undefined channel。

保留模型解析/scope、cwd 校验和内部 capability stripping。未扩为完整 SpawnOptions schema；非法 options（含 null）拒绝，description null 仍合法。

## 当前验证

- `./node_modules/.bin/tsc -p tsconfig.json` exit 0（包含最后直接 manager 测试）。
- 临时 PI_CODING_AGENT_DIR：`node --test .../tool-waits.test.ts .../backend-waits.test.ts .../auxiliary-lifecycle.test.ts` 69/69，exit 0、自然退出（日志 /tmp/pi-bg/bzgqbclep.log）。
- 增补解析后 unknown-type fallback：tool-waits 42/42 exit 0、自然退出（/tmp/pi-bg/blsjsa6o8.log）。
- 增补直接 manager/admission/cleanup：backend-waits 20/20 exit 0、自然退出（/tmp/pi-bg/b2k3nqjp1.log）。
- `git diff --check` 通过；未委派 implement manifest 有意空，task validate 报 1 项空 manifest，不声称全绿。
- 第一轮普通 Agent e23ce42b-39f3-48f 独立检查确认描述契约无 blocking，指出 RPC requestId await 后重读可变 raw。已捕获 requestId 并新增 success/error 延迟启动删除字段回归，tsc 与 auxiliary 通过；0f65209b-2940-44b 独立复核 PASS，无 blockers，针对成功/失败 mutation 回归执行1/1。
- 增补直接 manager 与 resolved fallback 覆盖；tmux 实际 CLI 四项通过，详见 tmux-validation.md。

- 主会话追加阶段 1 全后端 `node --test extensions/agent-tasks/__tests__/*.test.ts` 117/117、exit 0、自然退出（/tmp/pi-bg/btik14cni.log）；显式空描述追加后 tool-waits 42/42（/tmp/pi-bg/bxwcrh62q.log）。

- 全仓 configured force-exit 集成回归 709/709、exit 0（/tmp/pi-bg/b5t7tapap.log）；自然退出证据仍来自后端定向，不混同。

无联网模型、安装、同步或部署修改。tmux 已有独立真实宿主证据，但不代替在线 provider 验证。
