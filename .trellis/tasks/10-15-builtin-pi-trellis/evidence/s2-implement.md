# S2 实施记录（trellis-implement，自检，非独立审查）

## 设计
- Manifest schema3：`files`（runtime/agent）与 `templates` 不变，新增独立 `skills`：`.pi/skills/<skill>/<file>` → `{sha256, mode, source: "skills/..."}`（last-published）。所有写入均发布 schema3；运行时门禁接受 schema2（无 skills）与 schema3，只严格校验 runtime 字节，skill 行仅校验为已知目标+精确 source，磁盘状态不参与。
- 旧项目：沿用 d0e07c9 “旧 release 可缺包新增行” 规则，skill 版本与 runtimeReleaseId 解耦——缺行（schema2 全缺、包新增文件）= Update 计划新增；未知/错 source 行、schema≠2/3 仍拒绝。
- 冲突：init 遇已存在同名 skill 目录直接拒绝、零写入；apply 在锁内再确认计划内目录只含本计划文件。Update/Check 共用 `reviewSkills`：未托管目录整体保留为冲突（仅含精确包副本时视为中断发布可续）；托管文件仅在等于 last-published 时更新，定制/未记录文件为冲突（与角色相同，阻断 apply）。Adopt 只在缺失目录创建，不进入无备份替换循环。
- 发布顺序：每个 skill 的支持文件先于 SKILL.md，manifest 最后。`assets/` 下文件 binary（仅 bytes/hash/mode）。
- 移除 resources_discover 注入、projectSkillPaths/rebasePattern/skillsPrefix；init/adopt/update 不再 ctx.reload，通知提示 /reload 或新会话。

## 后续修正（S2-followup，2026-10-16）
1. 运行时门禁放宽：`validateManifest`（engine.ts:215–248）与 `manifestSnapshot`（diagnostics.ts:160–172）保持精确键集、source、kind、fingerprint 格式校验，仅在 `kind === "runtime"` 时要求与当前包精确 hash/mode。角色由 dispatch 读取且不做 hash 校验（lib/subagent-rpc.ts:154），模板是用户文档，二者旧指纹现在表现为安全更新：`inspect()` 仍 `ready`，Update/Check 报告可更新而非 blocked/malformed；定制角色仍按磁盘≠last-published 判为冲突（resources.ts `Modified — preserved`）。篡改 runtime 行、未知键/kind/source、非法 hash/mode 仍拒绝。
2. Adopt 锁内竞态：`applyAdoptPlan`（adoption.ts:104–140）在取锁后新增 `assertAdoptedSkillFoldersOwned`（adoption.ts:89–97），按本计划将被写入的 skill 目录复查只含计划文件；测试用 `underLock` 测试钩子注入锁内出现的未托管文件。
3. 测试提速：`runtime-fixture.mjs` 的 `copyRuntimeFixture` 支持 `user`/`prepare`/`key`，共享构建可带一次性的项目形态变换，并把复制的完成记录改根并重算 planHash（`rehomeOperationRecord`），使 Check 因本项目自身状态而非陈旧 root 失败。manifest-provenance（48 malformed + 54 用例）、init-diagnostics、init-review 改为 build-once/copy-per-case。

## 验证（临时 PI_CODING_AGENT_DIR，已链接 SDK）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `node --test extensions/trellis/__tests__/*.test.mjs`×2（自然退出） | exit 0，各 460/460，70.3s / 69.9s（此前 446/446 约 113s） |
| 最慢文件（单跑，含进程启动） | initialization 25.8s、manifest-provenance 23.0s、apply-template 22.7s、worktree-cli 22.2s、diagnostic-runtime 21.6s、init-review 21.1s；manifest-provenance 76s→22s、init-diagnostics 23s→2.5s、init-review 42s→20s |
| `python3 -B -m unittest discover -s extensions/trellis/__tests__/python -p 'test_*.py'` | exit 0，32 OK |
| `pnpm check` | exit 0，1498/1498，约 88s |
| 负例演示 | 移除 `assertAdoptedSkillFoldersOwned` 调用后新 adopt 用例失败（fail 1），恢复后通过 |

## 限制 / 待处理
- 角色/模板指纹不再是执行门禁：旧项目的角色或模板文案差异只表现为 Update/Check 的安全更新；旧 schema2/skills 补齐规则不变。
- 包将来删除 skill 文件会使旧行成为“未知行”而被拒绝（与 files 现有规则一致），届时需单独迁移规则。
- 未做真实 Pi loader 发现/trust/no-skills 验证（按测试方针）。
