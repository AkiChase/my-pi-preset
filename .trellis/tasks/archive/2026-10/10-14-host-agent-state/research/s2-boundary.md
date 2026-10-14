# 压缩状态阶段的实施边界

S1 已验证提交 d86b38b（source/test/README owning hunk + task artifacts）；focused 22/22 natural exit0，strict/full705/705。S2 未实施。

调研结束：research/herdr-integration.md 官方 v0.9.1/v0.9.4 的 Pi integration v9 相同，只有 session path 兼容性修正，仍无 compaction 监听或 busy 公共 hook。安装升级不能声称修复。当前仓库与邻近目录没有 Herdr 源码 checkout。

继续 S2 必须明确代码归属：
- 推荐在 Herdr 官方 integration 源码修复，保持唯一 publisher；需要用户提供/批准 Herdr 源码工作目录，不能推送或安装。
- 若要求 preset 自包含，需要用户批准完整替代集成的设计与将来禁用 managed publisher 的部署步骤；未经确认不写替代 reporter，不直接修改 ~/.pi 文件。

本次批准的 preset 修复已执行，跨项目/替代所有权属于 material scope change，先报告边界而非静默改动。任务继续 in_progress，未 archive，压缩验收未勾选。
