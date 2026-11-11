# 实施计划

## 授权

用户回复“开工吧”，明确批准既定方案。旧初始化中断迁移/续跑兼容已排除。可按两个阶段连续实施、验证、独立审查并作 scoped 本地提交；不授权安装、push 或 archive/journal。

## 阶段 1：资源全链路内容指纹

- [x] 完整读取涉及源文件、调用者、fixtures 和测试；确认新 schema 与内部归一化入口。
- [x] 清理 engine / provenance-reader / resources / adoption / skills / root-blocks 的 mode 记录、采集、比较、输出和备份传播。
- [x] 实现新 manifest schema 4 发布与旧 schema 2/3 正常项目兼容；清除 preserved templates / 保留 skills 中的旧 mode。
- [x] 新初始化计划无权限字段，完成旧 operation 历史兼容；旧未完成明确拒绝，不迁移；新计划中断续跑仍受内容 guard 保护。
- [x] 同阶段修改静态 diagnostics / worker / diagnostic bootstrap captured-source 协议，避免 gate 与 Check 契约暂时分叉。
- [x] 采用默认文件权限，不继承包或根文件原权限；保留私有锁、目录及原子发布。
- [x] 添加纯 chmod、不同 umask、旧 manifest/完成记录、更新/修复/接管、模板/skills 分类、备份、新计划恢复、内容冲突的回归。
- [x] 对本任务所需测试消除 smoke 过滤导致的未注册覆盖，不改造无关测试体系。
- [x] 更新当前 development spec 的 hash/mode 和 manifest 发布契约。
- [x] 主会话 diff 自查 + 独立审查 + focused 验证；阶段 1 进入本地提交检查点。

阶段 1 命令（仓库外隔离 PI_CODING_AGENT_DIR，使用现有 SDK，不安装依赖）：

```sh
node --test extensions/trellis/__tests__/{initialization,init-review,manifest-provenance,resource-update,root-block-update,apply-template,adopt-project,skill-deployment,init-diagnostics,diagnostic-runtime}.test.mjs
node --test extensions/trellis/__tests__/{dispatch,preparation,worktree,worktree-cli,agent-context-integration}.test.mjs
pnpm typecheck
```

## 阶段 2：读取期间权限漂移与集成

- [ ] 清理 diagnostics reader、task-context 和 Python materials 的 mode/ctime 隐式依赖；对文件、目录分别保留内容变化、inode、路径及文件类型保护，不机械移除整组身份检查。
- [ ] 修改对应 TS/Python 回归，独立证明读中 chmod 容忍与内容/路径替换拒绝。
- [ ] Python runtime 字节、当前 baseline sha256 / runtimeReleaseId 同阶段更新；保持历史 source hashes 不变。
- [ ] 核查全部权限关键词，分类每个剩余使用：必要创建权限、文件类型、无关业务 mode；确认无资源指纹权限残留。
- [ ] focused / 全 Trellis 自然退出 / Python / 全仓检查，独立审查，主会话验证后本地提交阶段 2。

阶段 2 与集成命令：

```sh
node --test extensions/trellis/__tests__/{task-context,init-diagnostics,diagnostic-runtime,dispatch,preparation,worktree,worktree-cli,agent-context-integration}.test.mjs
python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'
node --test extensions/trellis/__tests__/*.test.mjs
pnpm check
git diff --check
```

## 执行与审查选择

阶段 1 的跨模块代码/测试耦合量较大，为减少主会话上下文负载，选择 trellis-implement 实施；主会话维护 spec、任务材料并核对实际结果。阶段 2 主会话直接实施。两个阶段均由 trellis-check 独立审查跨模块 schema/读中一致性和安全边界。派发前准备真实 implement.jsonl / check.jsonl spec 引用与明确阶段范围。研究已完成，不再重复派发调查。

## 验收与边界

权限不同不影响内容一致性判断；新持久化资源/计划指纹无 mode；旧正常项目可读；修改内容仍被拒绝；必要的创建权限与路径/类型/锁保护未损坏。旧未完成迁移、项目生成副本手工修补、个人安装/同步、push、archive/journal 不在实施授权内。

## 阶段 1 实施与验证记录

- 实施：`trellis-implement`，主会话维护 spec 并核验实际 diff；独立审查：`trellis-check`。两个角色上下文 validate 4/4 entries 均通过，任务已 start 为 in_progress。当前分支 main；CLI 提示与 base_branch 相同，未来 archive/PR 前需另行处理，本次没有授权归档。
- 新增 `resource-hash-only.test.mjs`；修改 initialization 全链路源和相关 fixture/test。新 manifest schema 4、新计划 schema 2。遗留权限仅在旧 shape 的结构识别中读取，不成为当前资源一致性或发布策略。
- 实施首次 focused 实际 Node exit1：206 pass /7 fail；外层脚本曾因 echo/tail 显示 shell exit0，已核对原始 Node 失败，不计 PASS。修复 canonical `/var` 根比较、历史路径不读取现状，以及断言/真实中断 fixture；最终 focused 215/215 exit0。
- 实施首次 consumer exit1：24 pass /19 fail（级联）；复制 fixture 重定位 operation 根后未重新计算 planHash。改用 `rehomeOperationRecord` 后 consumer 44/44 exit0；combined 259/259 exit0。no-op Update 返回移到锁内后再次 focused 215/215 exit0。
- 独立审查负向复现两处局部问题（均 exit1）：完成 operation 可空动作；历史路径拒绝合法私用 Unicode 字符导致计划可建而发布后失败。分别加入非空动作校验、路径拒绝集合与用户名契约一致，保留控制符、代理项和非法路径拒绝。
- 主会话核验独审最终日志：上述 focused 命令加 `resource-hash-only.test.mjs` 为 **219/219 exit0**，consumer 为 **44/44 exit0**；`pnpm typecheck` exit0（linked 0 new packages），`git diff --check` exit0。Node v24.14.1，已链接 SDK 1.5.1，均仓库外 `PI_CODING_AGENT_DIR` 隔离、自然退出。现有 consumer smoke 过滤外的定义未执行，不计覆盖。
- 阶段 1 全 Trellis / Python / `pnpm check` NOT_RUN，留阶段 2 集成；仓库无独立 lint 脚本。
- 原始材料暂存 `/tmp/trellis-hash-implement.Ybcact/`、`/tmp/trellis-hash-check.2LXcd0/`；关键失败原因和复跑结果已在此自包含保留，不依赖临时链接作为唯一证据。

后续原始输出使用主会话自建 `/tmp/trellis-hash-main.yQeRM8/`。阶段 2 尚未实施。
