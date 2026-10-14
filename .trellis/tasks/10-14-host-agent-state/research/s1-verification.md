# S1 验证

主直接实现、主自检；未独立审查，S2 宿主协议工作仍待确认。

- focused：`PI_CODING_AGENT_DIR=$(mktemp -d) node --test extensions/__tests__/blocked-signal.test.ts`（实际命令 trap 清理临时目录）；22/22，自然退出 0。
- strict/full：既有 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules` + 临时 agent-dir，`pnpm check`；job ba18qdr8y，exit 0，严格 tsc PASS，full 705/705（配置自带 force-exit，不作为自然退出证据）。
- scoped `git diff --check -- extensions/blocked-signal.ts extensions/__tests__/blocked-signal.test.ts README.md` PASS。
- 检查实际 source/test diff：custom 不默认 attention，问卷 true/false 独立成对计数，按 host 聚合，cmux 已 patched 类别不挡后来的明确问卷通知；迟到通知 id 不串新段；shutdown fence。
- README 只更新 blocked-signal 用户摘要，其他并行整理 hunk 保留，不纳入本阶段提交。

未运行：真实 Herdr/cmux 颜色及 prompt 输入门禁、真实 installed questionnaire/Pi Viewer、在线/离线实际压缩集成。未安装/sync/reload/push/archive/journal。S2 压缩误报尚未修复，不以 S1 PASS 代替。

已有开发约束足够，不新增 spec；保留其他会话进行中的 spec 重组。
