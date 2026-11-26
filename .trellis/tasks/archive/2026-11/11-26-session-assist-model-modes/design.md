# 设计

## 配置与参数归属
`session-name/config.ts` 与 `recap/config.ts` 继续拥有各自文件、默认行为和行为字段。新增共同模型模式字段 `modelMode`，取 `follow` 或 `custom`。无模式时存在 `model` 或 `thinking` 字段即按独立配置检查，避免损坏或不完整的旧配置静默改用主会话；均缺失才默认跟随。显式 `follow` 忽略保留的独立参数对当前请求的影响，显式 `custom` 校验必填参数。

在 `extensions/session-assist/shared/` 建立小型模型选择 helper，共用模式解释、标识符/思考等级检查、模型解析及菜单选择；不抽取两个插件的整个配置存储或生命周期。菜单继续使用现有 `createDialogOwner` scope，保持各消费者的取消与保存归属。

## 交互
两个菜单显示模式及对应模型/思考等级，提供 `Follow main session`、`Set model`、`Set thinking`。Set model 选择并保存独立模式；已有档位受支持则保留，否则追加档位选择并原子保存整个选择补丁。Set thinking 对可用的独立模型编辑，未配置时提示先 Set model，不把主模型隐式存成独立配置。切回 follow 只写模式，独立值保留。

保留 Session Name 原有自动开/关及 Set interval、Recap 原有其他菜单项。配置标题需清理外来控制字符并限制长度，长模型列表保留唯一编号。

## 请求
请求发起时一次性捕获有效模式、模型、思考等级。follow 使用当前 ctx.model 和 pi.getThinkingLevel；custom 从 registry 查找并校验文本能力、支持等级及认证。`generateText` 继续拥有请求传输和 120 秒截止，不增加 provider 回退。

Session Name 在消耗自动机会之前确认“跟随模式下主会话无模型”的情况；独立模式可在主会话无模型时发起。其他失败、取消不返还已经开始的机会。Recap 的 config snapshot 与 request identity fencing 保持。

## 兼容与错误
保留两种文件现有读写和非法字段处理差异，不借功能之机重写存储。坏 JSON/non-object 均不保存，未知字段保留，合法对象按各自契约验证。命名的菜单仅允许修复新增模型字段，原有非法自动开关／输入间隔仍拒绝保存。模型／思考等级选择保存完整的已确认独立参数对，避免菜单等待期间外部模型字段编辑导致无效组合；其他字段仍按新鲜局部补丁保存。显式独立参数错误不回退 follow；缺少主会话模型不选择系统默认。当前请求不因模式切换自动重发。

## 变更边界
必要修改：两个 config.ts、两个 index.ts、共享模型 helper 及测试、对应 config/menu/runtime/boundary/SDK fixture 测试和两份用户文档。只有新增契约确需长期保存时更新已有 development/testing 规范；无新 entry、依赖、资源 hash 或同步配置。

## 验证与风险
以真实注册命令及 provider seam 验证模式、菜单取消、auth 重查及请求 snapshot，而非源码字符串匹配。保留次数/标题保护/空闲窗口负向回归和实际 SDK loading/runtime 检查。默认跟随增加未配置 Recap 的自动请求，已由用户选择；在线质量和供应商实际取消能力不在离线验收保证内。
