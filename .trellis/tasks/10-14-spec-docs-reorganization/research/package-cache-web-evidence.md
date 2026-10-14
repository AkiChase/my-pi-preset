# Cache / History / Web 用户文档来源

普通只读Agent9f022d18-5c59-4cc返回三份完整草稿，主读取后写docs/packages/{cache-optimizer,input-history,web-access}.md，减少重复latest说明和配置示例，保用户命令/参数/成本和限制。Agent无写入或执行产品。

## 核对输入
- 当前manifest：三包latest，只history searchShortcut=alt+r，cache/web无预设override。
- 已安装cache2.8.24：完整README、index注册、src/command/config/paths核常用开关/持久配置/确认修复/rollback。
- history1.1.3：完整README和index，MAX_MESSAGES/loadConfig/registerShortcut/loadRecentPrompts/SessionManager.list(cwd)/mergeHistory/setEditorText；源码按cwd历史比上游“all sessions”更具体。
- web0.40.0：完整分段1161行README，index/web-tool-core/tool-activation/curator-run/utils/brave及dist实际入口抽查。web旧PDF无OCR断言与上游多引擎说明冲突，未写此断言。

版本仅为本次只读观察，不是清单锁定。无个人config/credentials读取、无产品命令/服务验证/网络/安装。不会承诺全provider/PDF/video引擎。全部文档收齐后再统一核当前真实source/config/commands；不将草稿完成当freshness验收。
