# 本地三插件草稿与整合

普通只读Agent dd07b525-371f-48f完成并返回三份完整中文草稿。主已逐份读取返回正文并写docs/extensions/{status-bar,sse-normalize,blocked-signal}.md，适度压缩重复排版并链接cache文档。Agent没有修改任何文件。

## 实际来源
Agent开始/结束HEAD d86b38b064de0b3cf1c43fde7d16be47966ce072，`fix: distinguish explicit attention waits from custom browsers`。status/sse/blocked及manifest当时无dirty，blocked-signal并行修改已提交，不能再称旧草稿。主整合时HEAD05eb4dc journal，最终准确性仍以最终源码为准。

- status-bar gitChip/contextBar/modelLabel/collectUsage/parseCacheStatus及statusbar注册：实际修改标记`~`（非README旧●）、阈值、累计/最近命中区别、默认TUI/no persist。
- sse createSseNormalizer/isEventStream/default入口：所有fetch SSE范围、重载幂等、无卸载restore；无额外retry，retry5来自manifest。
- blocked herdrPresent/cmuxCliPath/CMUX_PATCHED_KINDS/createCmuxSink/watchPrompts/default：宿主门槛、Herdr优先、cmux仅补明确问卷/编辑等待、普通custom浏览不通知。

未启动产品/终端/网络/安装/个人配置，无产品修改。

## 中间验证
git diff --check PASS。audit17docs59links69contexts：19issue全部为六份待返回第三方文档的README/index/coverage与status交叉链接。不得称完整gate通过。两组第三方Agent仍运行，不轮询，不预测结果。全部完成后统一核当前源码。
