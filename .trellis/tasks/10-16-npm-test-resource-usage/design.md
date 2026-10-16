# 测试减重设计

## 已采用的策略与覆盖取舍

| 批次 | 改动 | 保留 / 明确减少的覆盖 |
| --- | --- | --- |
| 1 | 外层并发8、移除内层并发；删GC/忙循环；合并进程/workflow测试、使用握手/fake timer | 保留正常退出、真实进程终止、委托/取消；失去GC及忙循环专项证据 |
| 2 | RPC/state用已有mockPython返回真实模板捕获的query；managed child共用prepared模板、独立复制校准 | 文件、锁、execution、parser、snapshot仍真实；动态drift、安全与Python互通不使用固定响应 |
| 3 | manifest字段矩阵调用validateManifest；删重复schema集成；复用模板初始化；snapshot移出循环；readiness共用unprepared worktree | 保留代表runtime/template/skill完整拒绝、无写入；减少逐字段完整inspect/plan接线 |
| 4 | CLI/active/start/developer输入矩阵迁Python单进程；resource-update复用初始化模板 | 调用真实main/handlers、保护文件/hooks；Node保留成功与代表坏输入/路径/symlink接线 |
| 5 | immutable身份字段直接sameIdentity；schema直接parseBinding | 十字段双向比较及mutable不影响；child replacement真实集成只留bindingId，不逐字段重跑 |
| 6 | 五类dispatch setup用stateFixture；target identity/stale spec合并 | snapshot当前副本捕获真实材料指纹、status真实；Python lease/decoder仍真实；减少三角色重复source-authority组合 |
| 7 | 真实first-write中断模板独立复制；join模板；handler初始化夹具；manifest中断合并；diagnostics共用输入夹具 | inspect/plan/apply攻击拒绝、无写入、manifest不可执行/真实重试仍在；六diagnostics变体都保留，runtime schema重复验证交给manifest-provenance |

夹具只共享已完成或指定中断基线；每例独立目录，重写绝对root及planHash。不新增memfs/通用fixture框架，不改生产runtime gate、哈希或缓存。

## 性能归因

- 模块诊断：Trellis占累计CPU约81.2%；UI/process小模块不是持续负载主因。
- 两慢套件插桩：dispatch query-worktree157次/30.54s，context93次/22.23s；Node读取444/825MiB但分别仅0.71/1.09s，复制3.10/0.86s。耗时首先在完整原生链路，不是目录复制。
- 成功managed dispatch通常六次Python查询；内部又调用多个Git。追踪累计174query产生945Git，Git等待13.89s（rev-parse542、worktree271）。不改生产查询，仅减少无关集成重复。
- 初始化三文件诊断：initialization recheck1415次、operation读取约3GiB；init-review Python190次。apply逐action重查全部guards并保存含base64的完整计划，readOperation又重建验证；单次full apply本身很重。

上述调用耗时含子进程等待，逻辑读取不等于物理磁盘吞吐。细分与全量并发负载不同，不能相加或推算峰值。

## 受控实验

| 目标 | baseline → 优化 | 取舍 |
| --- | --- | --- |
| 50 manifest字段 | 19.15s → 1.25s | 纯validator + 代表集成 |
| CLI坏参数矩阵 | 2.22s → 0.49s | 单Python进程 + CLI代表接线 |
| 五字段child identity | 14.36s → 4.65s | 仅一个真实child，字段规则下沉 |
| 两dispatch逻辑用例 | 5.19s → 3.36s | 已有query seam |
| 十forged recovery setup | 6.28s → 3.26s | 同一真实中断模板、独立篡改 |

均为仓库外内存变换/单次顺序对照，不代表全量收益。批次1–6实际wall未稳定下降，不能把这些局部结果当资源问题已解决。

## 后续边界

继续寻找不必要的完整初始化/查询组合，先列保留与删除理由，再获批准。更多收益可能需要更强的集成删减或另行批准生产初始化算法优化；当前授权不包含两者。真实Git/index、防误删、未合并commit和symlink/ancestor防逃逸集成不能仅用mock结果证明自身正确。
