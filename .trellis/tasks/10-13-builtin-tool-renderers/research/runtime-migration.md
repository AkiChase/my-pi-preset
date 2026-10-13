# 原生工具展示与 Pretty 迁移证据

## 研究基线

2026-10-13，本机 Pi 1.2.0；上游 pi-pretty 0.7.0 / commit 862708e，克隆目录 local/pi-pretty（ignored，不是部署依赖）。本文只记录规划证据，未运行产品实施或安装。

## 公开渲染接口

- installed pi-coding-agent/dist/core/extensions/types.d.ts:340-378：ToolRenderContext 含 args、cwd、state、expanded、isError、durationMs、outputPad、invalidate。渲染返回的 Component.render(width) 才是真实宽度，不能使用 process.stdout.columns 代替。
- types.d.ts:521-526,1256：registerToolRenderer 支持 renderShell/renderCall/renderResult；resolver 通过 next 组合。不需要 registerTool、tool_result 或执行 wrapper。
- dist/core/extensions/runner.js:541-545：resolver 按扩展加载顺序查找，最后才取原工具 renderer；本模块只匹配 read/bash/find/grep，其他名称调用 next。命中的工具由本 preset 明确拥有展示，而非 next() ?? ours（后者会被原生 renderer 永远遮住）。
- dist/modes/interactive/interactive-mode.js:1706：宿主取得 resolver 后与原工具定义组合。应在实际 host loader 测试这条路径，不能只用 fake registration 判断成功。

## 原始结果结构

- read.js:57-160：结果保留原始文本/图片；offset 输入是 1-based，展示从 max(0, offset-1)+1 起；截断和用户 limit 的续读说明混在文本尾部。不能依赖 Pretty 自己写入的 readFile details，不能把说明作为真实文件行数/代码。拆分只能使用精确宿主说明模式，并保留原始文本完整可见；未知格式不猜测删除。
- grep.js:128-145,196-237：match 行是 path:line: text，context 行是 path-line- text；literal/ignoreCase 必须影响高亮。输出附带 limit/truncation 说明，details 不是完整结构化 matches。计数为可识别 match 记录数，不是包含 context/说明的总行数；不是正则命中次数。注意文件名含冒号/连字符造成歧义，保守回退原文本，不破坏内容。
- find.js：文本为相对路径列表，可能附限量说明；不能将说明当文件计数。无结果状态单独识别，保留 details 的限制信息。
- extensions/process-tasks/tools/bash.ts:231,252,317：普通输出和后台 ID/log handle 都是 content 文本，details 经常 undefined。不能把“返回后台 handle”误标为命令已执行完成；耗时仅表示该次工具调用时间。展示保留 ID/log 路径与后台文案。

## 依赖与清理边界

- extensions/bash-unified.ts 捕获 process Bash 再注入 Pretty，仅为 Pretty 唯一注册；移除后 processTasks 直接注册原定义，保留唯一 lifecycle/coordinator/UI owner、agent guard 和最后的 Down opener。
- extensions/pretty-compat/editor.ts 专属 Pretty 代理必须撤除，但同实例装饰、事务 preflight、所有权清理和 reset-before-shutdown 的回归要迁移，不可直接丢弃。
- extensions/task-ui/editor.ts:86-107,142-185 已有 preserveHandoff：即使 setter 返回同一个 editor，也可能重设文字、历史草稿、paste、补全和 actions。新的输入框 owner 必须复用/局部抽取这套安全交接，不复制私有编辑状态。
- extensions/task-ui/__tests__/editor-host.mjs 与 editor.test.ts 仍直接 import Pretty/FFF；extensions/agent-tasks/__tests__/loading.test.ts 的真实 loader，以及 scripts/pi-manifest.test.mjs、sync.test.mjs、README 均需审核迁移。
- pi-preset.json 当前声明 pi-pretty.json 主题与 toolStyle；删除整个文件声明后 sync 不再读写该个人文件，不能用 null tombstone 删除用户内容。
- Pretty 仍与本 preset 四类渲染/输入框竞争，conflicts 保留其 source 作为禁止共存项，而不再称为代加载包；移除运行时依赖不意味着允许同时装 standalone Pretty。

## Shiki

已从当前安装 Pretty 的依赖目录直接调用 @shikijs/cli codeToANSI，以 one-dark-pro 验证 TypeScript/JSON/Markdown 返回正确 ANSI。主项目根 eval 无法 import 其传递依赖（正常 pnpm 隔离），因此新模块必须显式声明直接 runtime dependency。

推荐 dependencies 显式声明 shiki ^4.0.2 和 @shikijs/cli ^4.0.2，使用 codeToANSI 与 bundledThemes 校验；不安装第二套 Pi SDK、不导入 Pretty。保留有限缓存/80k 字符上限，未知语言正常 plain fallback，异常只给一次不含源内容的诊断。

## 输入框与复制决策

详见 editor-semantic-selection.md。用户在研究后明确决定不做鼠标片段语义复制；不加入完整输入复制替代品、不接管鼠标、不修改宿主。

用户已选择上下规则、无左右竖边框、首行 ❯ 的输入框样式。原生鼠标/键盘、自动折行与 IME 保留，不能承诺终端复制可还原软换行。
