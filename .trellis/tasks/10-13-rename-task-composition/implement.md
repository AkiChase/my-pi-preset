# 实施计划：入口重命名

## 前置与审阅

- [x] 用户确认新文件名 task-composition.ts，已更新三份材料。
- [x] 10-13-builtin-tool-renderers 完成独立 beautify 与 Pretty 适配移除；未完成则等待，不在本任务补做前置。
- [x] 用户已批准按顺序完成两项任务，无需再审批；主会话已 task.py start。
- [x] 实施前读取 manifests/spec/research，git status 记录无关 hunks；重新 rg 旧名确认前置后的消费者。

## 执行

- [x] 移动旧顶层入口到确认后的路径，default 本地函数名改为 taskComposition（若采用建议名），保留 named export 与调用顺序。
- [x] 更新真实 host-loading-smoke import、新入口 manifest 唯一性和旧入口不存在断言。
- [x] 更新确实引用旧入口的测试、README、维护中 provenance 与 owning spec；不改内部 child-context 逻辑、不改历史归档材料。
- [x] 不留顶层 shim、不调整扩展 glob、不把 beautify 合入入口。

## 验证

使用实际 SDK node_modules 路径与临时 PI_CODING_AGENT_DIR，隔离个人配置。定向命令不加 force-exit：

```sh
node --test scripts/pi-manifest.test.mjs
node --test extensions/agent-tasks/__tests__/loading.test.ts
node --test extensions/task-ui/__tests__/{editor,lifecycle,sdk-runtime}.test.ts extensions/process-tasks/__tests__/activation.test.ts
pnpm check
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/10-13-rename-task-composition
```

- [x] loading.test 的真实 host-loader 子进程通过，不仅 regex/import 静态检查。
- [x] 顶层新入口恰一次、旧入口不存在，named child bridge 保持同一上下文/跨 loader 生效。
- [x] 后端、任务 UI、Down 和生命周期无变化；前置的 beautify 测试继续通过。
- [x] 搜索活跃源码/测试/README/spec 旧路径无遗漏；provenance 的历史引用明确分类，不清历史证据。
- [ ] 独立 check 审查全部本任务 diff 并复核测试，由主会话继续派发；本次无个人 install/reload/model 请求。
- [x] 相对文档链接、全部新增文档空白检查通过；实施结果写 [research/implementation-results.md](research/implementation-results.md)，独立 check 结果另记。

## 收尾

- [x] 本任务路径移动/引用成套回滚能力明确，不影响前置或其他任务。
- [x] 最终只请求本任务提交计划授权；不自动 stage/commit/push/安装/同步/归档。
