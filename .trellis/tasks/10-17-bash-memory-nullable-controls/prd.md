# bash 与 memory_list 显式参数契约

## 目标与授权

用户否决机械nullable默认值方案，明确选择领域值：bash -1一直前台、0立即后台、正数定时转后台，删除run_in_background；memory_list显式query/offset/limit。用户已审阅完整参数并批准“按这版来”。批准包括两阶段实现、独立审查及scoped local commits；不改docs/README/spec，不安装/reload/push/改历史/归档。目录slug保留历史名称，不自动改名。

## 最终参数与要求

bash三个字段全部required/non-null/closed：command:string（非blank）、background_after_seconds:number（-1、0或有限正数，最大2147483.647，拒绝其他负数）、description:string（允许空字符串）。-1一直前台直到结束或手动/bg；0立即后台；正数交互前台等待阈值后detach不kill。非交互模式允许-1/0，正数拒绝。run_in_background删除且拒绝包括false/null。缺字段、undefined、unknown/null及direct错误类型在spawn前拒绝。不用schema默认值补齐调用。

memory_list三个字段全部required/non-null/closed：query:string（允许空字符串，最多160码点，无控制字符）、offset:number（非负safe integer）、limit:number（1–50 safe integer）。直接提供空串/0/20，无默认值sentinel。内部store.list defaults与8KiB/nextOffset行为不改；nextOffset:null和memory_write.expectedRevision:null是数据/业务语义，保持。

## 验收

- AC1：两入口required/non-null完整schema，host/direct缺字段unknown拒绝；direct严格类型/域校验不修改输入。记录host转换限制，不声称SDK已转换值可被恢复。
- AC2：bash -1/0/正小数模式、非交互限制、/bg、不replace PID、取消stop/session cleanup、structuredContent不回归。removed字段有correctable错误。
- AC3：旧timeoutMs配置无实际consumer后必须移除默认值/类型/加载支持与配置命令表述，既有文件或环境变量出现时明确警告，不继续显示为有效设置；Monitor内部timeoutMs不受影响。相关config/commands测试同步。docs/spec既有过时声明只记录，不编辑。
- AC4：memory_list错误在getOrigin/读取前拒绝且固定安全消息，空query/offset0/limit20及其他边界、分页/disabled/startup/shutdown保持；其他工具不改。
- AC5：Agent schema/指引/真实SDK assembler与全部实际注册override调用fixtures同步，不为旧调用添加产品补齐层，不弱化生命周期断言。
- AC6：S1 bash、S2 memory_list独立阶段分别自然退出验证/full check/独立check后立即scoped commit；真实provider/物理终端未跑标NOT_RUN。

## 已确认源码与决策

bash schema为tools/bash-params.ts，执行为tools/bash.ts；当前默认阈值来自config.timeoutMs并只在bash使用，commands/config/tests包含旧配置。Monitor的session timeoutMs是独立内部参数，不能机械删除。Memory owner为memory/tools.ts，store.list二次验证并扫描；boundary屏蔽非MemoryError，参数错误使用固定安全MemoryError。Beautify bash renderer消费结果不解析模式参数，预计不改。

## 执行

主会话协调，trellis-implement逐阶段实施，独立trellis-check逐阶段只读审查，main验证/提交。两个manifest准备后start，无未决产品选择；范围扩展尤其SDK/sharedhelper必须另获批准。
