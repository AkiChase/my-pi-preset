# 实施与主会话自检

## 改动

- layout.toolHeading 将真实工具名作为独立身份字段，折叠时先分配完整名称，再对参数/描述执行原 middlePath 与摘要预算；展开保留名称和完整参数分行。宽度不足容纳工具名时安全截断。
- shared 四工具标题改为参数部分，统一组合 read/bash/find/grep 名称；jobs contract 的标题只保 action/参数，optional 自有标题统一组合 jobs/get_subagent_result。Agent description 解析、执行与结果数据未变。
- 名称占用额外空间后，get_result 的展开提示被次要用量字段挤掉；首轮 focused 暴露该回归，摘要预算现先移除次要字段，再完整省略提示，避免残缺提示。
- 测试覆盖六工具的名称、等待/终态/错误、展开/折叠、长中文路径/命令/描述、极窄/宽屏、offset 原子与背景；ask_user_question resolver 透传保持身份，原可选 renderer 未知格式委托测试仍通过。
- README 只更新 Beautify 所属小节；其他既有未提交 hunks 保留、不提交。

## 验证

使用已安装 SDK，不获取依赖；整次测试使用 mktemp 临时 PI_CODING_AGENT_DIR，完成后删除，仅隔离目录被清理。

```bash
agent_dir="$(mktemp -d)"
export PI_SDK_DIR=/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules PI_CODING_AGENT_DIR="$agent_dir"
node --test 'extensions/beautify/__tests__/*.test.ts' && pnpm check
result=$?
rm -rf "$agent_dir"
exit "$result"
```

- 初轮 bohb2m7xc：FAIL，get_result 120 列的展开提示被挤掉；修复后 focused b4w3vyw9m：PASS。
- 最终 bzntcpbs7，日志 `/tmp/pi-bg/bzntcpbs7.log`，exit 0：focused 71/71，自然退出；pnpm check strict typecheck PASS，全量 699/699 PASS（全量命令自带 test-force-exit，不作为自然退出证据）。
- git diff --check：PASS。
- 主会话实际 diff 与规范自检：PASS，无 suppressions、新依赖、工具重注册或执行变更。共享函数所有自有标题调用者已更新。无需新 spec：已有渲染宽度/控制字符/可选委托规范足够，具体用户行为记录于 README。
- 实际第三方问卷 UI、真实 tmux/在线 provider：NOT_RUN；SDK 组件/透传测试不宣称真实视觉验收。
- 未使用独立审查；采用已批准的主实施→主自检路径。

## 交付边界

实施授权涵盖本任务单阶段本地 commit。未 push、安装、个人同步、reload、归档或 journal。任务保留 in_progress 待用户接受；其他 task/spec/docs/README 并行修改排除。
