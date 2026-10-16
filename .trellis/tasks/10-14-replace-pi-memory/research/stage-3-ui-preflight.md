# 阶段3面板实施前接线与边界

> 已被2026-10-15只读全屏面板修订替代。本文件记录旧可编辑候选的历史preflight，不再是实施依据；当前交互以prd.md、design.md第7节、implement.md第3阶段为准，禁止重新接入editor/menu/手动视口。

阶段2独立审查 `24c31566-1e80-4cb` 正在运行；本记录只准备后续，未开始面板代码。必须阶段2验收/提交后实施。

## 最小行为差距与所有权
目前仅四模型工具及每run索引，无用户交互。新增 `/memory` command；独立 `memory/panel.ts` 负责有界snapshot的显示/按键，`memory/command.ts` 负责刷新/读取/宿主dialog与安全存储操作，activation依然由 `extensions/memory.ts` 拥有。render/handleInput不做文件I/O/await；所有异步action由typed custom result回主command循环。

## UI公开合同与采用方式
已完整读installedPi1.2 docs/extensions.md、docs/tui.md、overlay-qa-tests/qna示例；公开types.d.ts和Markdown/Input/ScrollView签名已核对。
- `ctx.mode==='tui'` 才custom，RPC的hasUI不能当终端。其他模式默认status，list/on/off/help，不开custom/模型。
- 一次custom内部list/detail状态；全宽overlay width='100%'，host padding/terminal.rows约束。需求仅全宽，不自行把Pi切fullscreen。键位English固定controls，局部UI不替换main editor。
- 每次custom工厂新实例，用done关闭，不调用SDK owned handle.hide，不叠custom/confirm。action返回后调用ui.editor(prefill)/input/select/confirm，再在active时打开新实例保留纯view state。
- Input负责filter原生编辑/focus/CURSOR_MARKER，wrapper传focused。filter状态普通字符全部给Input；Enter确认/Esc退出filter不清query；menu清query。
- Markdown(body,0,0,getMarkdownTheme(theme))；ScrollView隐藏scrollbar避免transient timer，render生成有界正文排版，updateLayout/clamp，按slice渲染当前viewport。sanitize外部控制符先于style，保正文原文在数据中，不把host ANSI二次清掉；padding必须计visibleWidth，不用string.length。
- 无watcher/poll计时刷新；`r` typed refresh显式更新。显示snapshot包含enabled/entries/total/scanBytes/errors/selected detail，error不是empty。

## 状态与动作
纯view state：page(list/detail)、query、selectedName、listStart、detailScroll、filterMode。列表由完整bounded scan（最多2000目录项）snapshot本地过滤name/description，只排当前页；上下/Pg/HomeEnd/Enter，detail↑↓PgHomeEnd/←Esc/e/d/r。返回保原query/选项/viewport，无entry时选最近有效项。
command循环action：close/refresh/selectDetail/menu/edit/delete；内部list-detail切页可读前返回loadDetail action，绝不在render读取。Refresh之后detail丢失回list+有限提示，非法正文可看错误但禁edit/delete无revision。
编辑现有topic不可改name：body editor→description input→type select，每await验证activation和operation identity，任意cancel无写；最终store.write携原完整revision。disabled read/list仍可，edit/delete不可用且store继续统一拒绝。删除包含slug及不可恢复confirm，finalstore.forget再次revision检测。
menu Refresh/Clear filter/EnableDisable/Close；setEnabled PublishedError表示可能已发布，catch后readEnabled重新核disk状态并显示durability警告，不可假称未修改。config未知保持、不覆盖。

## 超大文件预览与安全
stage1 read对>16KiB拒绝完整revision。若实现PRD bounded preview，必须路径/slug/regular/symlink验证复用owner，最多读取16KiB(+1探超限)，UTF8末尾裁剪且显式preview/omitted/no complete revision，禁写/删除，不让无效file看似正常。它只用于本地详情，不改变模型read合同/隐式放宽安全。损坏/secret正文不回显敏感值或raw异常；unknown path私有根拒绝仍明确。

## 验证要求
真实entry command登记、typedSDKcustom/done/dialog seam与实际组件render测试；取消/冲突/删除/disabled/reopen/late shutdown/reentrantdone、无叠overlay、provider调用计数0。宽度1..120/resize/中文combining/control/lightdark/focus marker/selectionscroll。已有fourtools/35focused与prompt真实SDK不得退化。真实PTY regular/fullscreen与退出恢复提示仍需显式隔离执行授权，不把组件fixture当视觉验收。

## 不做
不修改共享Task UI、editor、SDK、安装、个人清理、模型调用、向量检索、后台timer；不自动迁移正文/新增主题人工create/rename（现有设计编辑已有主题）。若公开UI签名不足先报告，不私有接管终端。
