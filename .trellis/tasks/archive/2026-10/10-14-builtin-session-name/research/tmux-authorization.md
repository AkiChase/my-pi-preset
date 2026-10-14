# tmux 终端验收授权

2026-10-14 用户明确提出“能不能开 tmux 进行验收”，主会话按既有规范执行隔离真实CLI验收。

- 独立 `tmux -L` 服务，临时 HOME、PI_CODING_AGENT_DIR、cwd、sessions/logs，clean env；不接触现有pane、个人认证或配置。
- 已安装 Pi 1.2 CLI 直接显式加载当前产品，不install/sync/reload现有session，不联网。
- 离线可控provider仅提供模型响应，CLI/session/输入/命令/menu/title/notification走真实host。
- 最小矩阵：初次自动、手动刷新、config取消与保存、N轮阈值、/name保护与manual恢复、可见失败和N轮退避、可行时切换/晚结果、自然quit与清理。
- harness/evidence/report仅本task research，产品失败交主修复，不让验收代理改产品。
- 真实terminal capture是文本/SGR证据，不称图片；不等于online标题质量、物理IME或任意第三方插件组合验收。
- 不授予commit/push/archive或个人部署授权。

执行agent：`78a11978-a03a-438`。返回结果前不宣称验收通过。
