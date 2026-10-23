# SSE Normalize：流式响应格式规整

改善流式回答经过代理或中转服务时的 SSE 格式兼容性，随本仓库扩展加载自动生效。

## 适用情况

部分流式响应存在换行边界或无数据事件问题，可能出现 `Could not parse Anthropic SSE event`，并伴随 `Unexpected end of JSON input` 或空的 `data=`。本扩展针对这类响应格式问题，不是通用网络修复工具。

## 使用方式

正常启动 Pi 并使用流式模型即可。没有斜杠命令、工具或快捷键，不需要另行配置 provider 或修改模型地址、认证信息。

## 处理范围

作用于当前 Pi 进程中经 fetch 收到、`Content-Type` 包含 `text/event-stream` 的响应：

- 规整 SSE 换行格式。
- 忽略没有数据行的事件。
- 普通 JSON、网页等非 SSE 响应，以及没有响应体的请求不受此处理。

范围不限于 Anthropic，也可能涉及其他扩展的 SSE 请求。

## 重试与配置

没有专用配置文件、环境变量或运行时开关。自动重试仍由 Pi 判断，本扩展不直接发起或控制重试。

## 限制

截断的 Anthropic 流可能改为报告 `stream ended before message_stop`，从而进入 Pi 的重试流程，但不保证一定重试或重试成功。它不能补回丢失内容，也不能修复错误 JSON、认证失败或服务故障。

重复 `/reload` 不会叠加此处理。移除扩展后应重启 Pi，不要仅靠 `/reload` 恢复原始网络行为。
