# Recap 来源与维护范围

功能参考 [@tifan/pi-recap](https://github.com/tifandotme/pi-extensions/tree/master/packages/pi-recap)，本机读取的 npm 基线为 0.4.8。该包 package.json 声明 MIT，作者 Tifan Dwi Avianto。实际安装目录未提供声明的 LICENSE 文件；没有根据元数据猜写版权年份或许可证原件。

本实现独立编写，没有复制上游实现或提示词。延续单行恢复工作摘要、编辑器上方 widget 和非模型上下文 custom entry 的功能方向；按本任务重新实现显式模型/思考配置、120 秒共享请求、严格 Unicode 材料预算和公开事件空闲生命周期。无需承载未复制源码的许可证正文；如后续引入原件，必须一并保留上游实际许可证与准确来源。

公开 SDK 基线为 Pi 1.2.0，运行时只通过包名导入公开 extension/model/session/TUI API；不使用安装路径、AgentSession 私有订阅、工具执行循环、旧 complete fallback 或 provider payload 修改。`shared/request.ts` 只增加显式文本材料输入，命名未提供该参数时仍使用原 JSON 序列化。

生命周期仅观察当前会话公开输入/运行/增量/工具事件，不检测操作系统离席、未提交键入或任意第三方 handler 完成。取消输入/导航后保守暂停到下一正常 settled；中止 settled 不自动生成。手动压缩 terminal 最多一次延迟检查，busy 时不轮询。print/JSON 无 UI 通知是公开 no-op；rpc 可通知，但编辑器 widget 仅 TUI。离线测试不代表在线质量或真实终端视觉接受。
