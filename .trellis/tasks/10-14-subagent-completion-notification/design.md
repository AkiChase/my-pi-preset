# 技术设计

## 所有权

修改源仓库 `extensions/agent-tasks/`，顶层 task-composition 仅在确有必要时调整接线。保持 manager 执行与 task-ui 等待所有权，不引入第二个通知执行器。公共 RPC 接受外部 unknown 输入；可信 manager 仍须在 admission 前守住 description 不变量。

## 入口契约

公共入口解析 agent type 后规范化描述，manager 对直接可信调用使用同一纯函数或等价共享契约。缺省/null/空白回退 type，非空字符串保留，非法类型抛明确英文错误。使用 unknown/type guards，避免新增 any。规范化 options 向下贯穿 record/runner/cleanup。必要 RPC 结构校验在 spawn 前执行，有效 requestId 保持现有 reply envelope；无有效 reply 地址不能生成 undefined channel，安全诊断但不派发。保留 model resolution、scope check、内部字段剥离和 cwd 校验，不重写全量 SpawnOptions schema。

## 通知失败处理

保持现有 200ms hold、消费与 wait 抑制。stale 条件正常 return；真正构造/提交异常在有 UI 时显示简短英文 warning，无 UI 时输出安全、限长错误日志。提示 sink 失败隔离，避免记录 prompt/result 或任意异常对象。不新增持久诊断 entry、schema 或查询入口；失败不 consume、不标 delivered、不重试。执行期 stale/closing 守卫同样应用于提示，不能使用旧 activation 写入新 session。

复用当前有效 UI ctx，不为提示保活旧 ctx。sendMessage 返回 void，没有可靠异步 ACK；SDK 异步失败归 SDK 渠道。

## 运行身份

单条发送前保存 `{ record, runId }`；发送返回后再次核对 active、manager.getRecord(id) 同一引用与 runId。匹配才标已提交 SDK；不修改新 run。保持 group 已有快照复核。

## 组终态

组成员 stopped 的公开 terminal 与实际 execution drain 不同。reconsider 的 group terminal 处理置于阻止 active execution 通知的条件之前，但必须先满足相同 live record、完成时间与当前 attempt 身份。停止成员只参与组关闭，canDeliver 继续排除其自身通知。runner 迟到 completion 重复回调不得产生重复组交付；resume 必须忘记旧 membership。实际 drain、清理 owner 与 provider cancel 不改变。

## 验证与回滚

实际 factory/RPC/manager + 离线 DI runner/timer fixtures，禁止真实模型与安装。入口失败断言无 admission 残留；通知错误注入包括诊断 sink 错误；stop 使用不会立即完成的 runner。分别验证 record identity 与状态，不能只断言通知文本。

分阶段本地 commit；失败修复后再验证，不改写历史。回滚按新增 scoped 修复的逆向提交另获批准执行，不自动 reset 或覆盖并行工作。

## 排除

不新增外部包、RPC version bump、Trellis 描述装饰、SDK ACK/重试/outbox、15 分钟延迟修复、真实 provider 可靠性承诺。
