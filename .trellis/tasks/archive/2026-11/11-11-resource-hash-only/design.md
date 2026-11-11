# 设计：资源只使用内容指纹

## 最小行为差异

当前共享资源的权限位会影响运行授权、更新分类和恢复，即使内容不变。目标是内容 hash 一致即视为同一资源，权限不再成为持久化状态或比较条件。

## 所有者与链路

以 `extensions/trellis/lib/initialization/` 为资源 schema、发布、更新和诊断的所有者。统一修改其 reader / fingerprint / parser / writer，不在 dispatch 或 worktree 消费者添加局部豁免。

- Fingerprint/Stamp 仅保留 `sha256`；不存在仍表示为 null。
- 新 manifest 发布 schema 4，files、templates、skills 无 mode；保留各自 kind/source/origin 及 null fingerprint 语义。
- 合法 schema 2/3 作为旧输入识别，其权限不参与一致性判断；统一规范化为新内部格式。严格资源清单、来源、路径和 hash 格式仍检查。
- 初始化 action/guards 不再记录权限，采用新计划版本区分旧记录；planHash 仍覆盖新计划的路径、输出、来源及内容 guard。
- 更新、修复、模板应用、接管、根块合并和备份使用同一内容比较语义；深拷贝的旧模板/skills 也需完整去除 mode，避免只改 runtime 行。
- reader/captured source/diagnostic bootstrap 协议移除 mode，静态诊断和实际运行消费同一内容契约。

## 写入与并发保护

新资源和根文件默认写入 `0644`；备份内容文件默认 `0600`；锁/私有目录现有 `0600/0700` 设置保留。这些是创建设置，不进入 fingerprint，不复制原权限。内容无变化不重写文件以调整权限。

发布前重读内容 hash，遇到内容变化拒绝覆盖；保留原子 rename、锁、路径和符号链接检查。备份只保存内容，不承诺恢复旧权限。

读取期间不把 mode/仅 chmod 导致的 ctime 变化当成内容变化。保留 dev/ino、文件类型、路径、大小和读取边界检测；具体实现需完整检查 TS/Python 文件与目录读取保护，必要时重读验证内容而非机械删除整组 freshness guard。目录内容变化保护不得随文件权限清理移除。

## 旧数据边界

- 正常 schema 2/3 项目：兼容读取；新发布时写无 mode 的 schema 4。
- 已完成旧 operation：历史记录不作为新输出发布权限，不因旧 mode 或旧 canonical manifest bytes 阻断正常项目；保留结构/路径/记录完整性检查。
- 旧未完成 operation：用户明确不需要迁移续跑。本任务保留并明确阻断，不执行旧输出，不删除记录或锁。
- 新版本自身初始化中断：仍可在内容未变化时续跑；内容变化拒绝覆盖。
- 若改 Python runtime 字节，更新当前 hash 和 releaseId，旧 runtime 内容仍走显式 Update；旧 manifest 权限兼容不意味着放行旧代码。

## 资源所有权与排除

修改包源、相关测试和当前 spec；runtime baseline 与对应 Python 字节耦合更新。保留 vendor/history source hash。项目 `.trellis/scripts` / `.pi/skills` / manifest 为生成副本，不手动同步绕过 gate，不运行个人安装或同步。

保留文件类型检查、路径安全、来源/清单、锁、字节预算、hash 校验。无关业务 mode、私人状态权限和需要可执行的测试脚本不在删除范围。

## 风险与验证

schema 和读中一致性是跨模块边界，采用主会话实施、独立 trellis-check 审查。测试必须分别证明权限变化不报错、内容变化仍拒绝，以及旧完成记录兼容、新初始化重试、备份内容、模板/skills 分类幂等。具体命令和阶段见 implement.md。
