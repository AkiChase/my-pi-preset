# 显式参数设计

## 形状

```ts
{ command: string; background_after_seconds: number; description: string }
{ query: string; offset: number; limit: number }
```

不nullable、不optional、不默认值补齐。parseControlArguments可复用仅shape检查（controls=[]），各入口独立域验证。host scalar conversion与direct原始类型校验分开证明。

## S1 bash

bash-params.ts提供required closed schema与局部parser，number使用minimum:-1/maximum，(-1,0)区间由runtime拒绝（可用字段级union表达确切域但避免复杂对象variants）。所有域校验在effects前；command非blank，description string允许空。

bash.ts通过background_after_seconds===0立即spawn后台；-1前台不设置detach timer；正数交互定时detach，非交互拒绝。保留QUICK_COMPLETION_MS进度窗口、manual/bg、取消与structuredContent全部结果路径。删除run_in_background/隐式threshold，模型指引完整三个字段，错误拒绝旧模式字段。

config.ts删除旧timeoutMs字段/default/bounds；commands.ts移除旧有效配置说明，配置加载对旧文件键使用unknown警告，旧PROCESS_TASKS_TIMEOUT_MS要明确retired/unsupported warning而非忽略。不自动修改用户配置。Monitor session参数timeoutMs保留。更新config/commands tests；PROVENANCE如需记录本地fork变化可在阶段记录，不把任务细节写入用户docs/spec。

新增test-only bash input helper，迁移实际override注册调用包括mjs host probes、局部别名；不改SDK built-in bash调用。旧fixtures省略阈值需显式选择对应原行为（普遍-1，专门timer测试填正数，后台填0），不可统一填0/-1破坏测试意义。renderer只有明确依赖才改。

## S2 memory_list

memory/tools.ts入口shape与query/数值safe-integer域校验在getOrigin前，参数错误用MemoryError固定安全提示；boundary和store API保持。列表schema无null，直接query=""、offset=0、limit=20；schema描述和必要单一guidelines承载模型说明。不改prompt section注入方式，不改其他Memory工具/expectedRevision:null。

## 验证/回滚

逐阶段验证真实host、direct、参数不可变、错误零副作用及运行语义；host TypeBox number conversion可能将字符串等转换合法类型，direct严格拒绝，限制据实记录。不修SDK或全局helper。阶段耦合schema/parser/guidance/config/tests同时提交，main只精确暂存文件；回滚仅scoped阶段改动，不触碰并行任务。docs/spec原过时tool/config说明记录而不改。
