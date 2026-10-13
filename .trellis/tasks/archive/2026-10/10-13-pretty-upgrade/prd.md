# pi-pretty 升级与 claudecode 风格

## 目标
将 preset 的 pi-pretty 升级到 0.7.0，并通过同步清单默认启用 claudecode 工具风格，保留 one-dark-pro 代码主题。

## 范围与约束
- 依赖使用 ^0.7.0，更新 pnpm-lock.yaml，不引入另一份 standalone Pretty。
- pi-preset.json 的 files.pi-pretty.json 声明 theme=one-dark-pro、toolStyle=claudecode。
- 保留 process-tasks 的 bash 执行、现有 Task UI、input-history 和编辑器生命周期组合。
- 新风格涵盖工具摘要和连续调用分组；不承诺完整 diff 语法高亮，也不复刻 README 早期截图。
- 如新风格与编辑器适配冲突，只做必要的局部适配和回归，不改第三方 node_modules 源码。
- 不修改当前未提交的 monitor 工作、其他 UI 规划任务或生成的 .pi 文件；README 仅修改升级相关区域。
- 未另行授权前不运行个人 install/sync/reload，不提交或推送。

## 验收
- [x] 实际依赖解析为 0.7.0，单一 Pretty 加载入口保持不变。
- [x] 清单包含 one-dark-pro 和 claudecode，离线同步验证实际写入并保留其他用户配置。
- [x] 实际 0.7.0 claudecode 渲染及编辑器组合有定向离线回归；默认风格兼容测试继续通过。
- [x] strict typecheck、完整测试与相关自然退出测试通过，README 更新。
- [x] 输出变更范围、测试证据和本机应用步骤；真实交互验证未执行则明确说明。
