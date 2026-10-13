# 用户批准的推进调整：核心面板完整切片

用户询问为何长期卡住，主会话说明旧扩展把执行、等待、通知、widget、调度和清理混在大入口中，逐小补丁全量检查/审查造成进度消耗、面板迟迟未交付。提出不再精修将删除的旧UI，把旧AgentWidget/FleetView删除提前与共享TaskPanel一起做；先核心列表/即时详情/停止/分组，再Down，完整切片集中全量与独立审查。用户明确回复“对啊，继续”，批准本调整。

## 当前边界

- 保留已验证的process/monitor/manager/runner/worktree/worker执行基础，不重做隔离架构。
- G3仍未关闭，但不再要求先给旧UI补完整独立审查才能进入UI；旧资源复活问题通过实际删除旧UI解决，在新UI集中验实际清理。
- 修复agent89f7cf5b由用户停止，partialindex/mention/UIguard/tool-waits测试修改真实存在、未完成/验证，不丢弃有用修改也不把其summary当已验。新agent接管actualfiles。
- 收尾mention后台私有override与拒绝反馈；普通调用frontmatter优先级保持。必要sourcepub/spawnaftereffectchecks保留，自有资源不豁免。
- 核心UI：共享双栏panel、不可变身份选择、真实父子树/workflow默认展开、终态四秒/活跃父组保留/选中bounded快照、分类footer、显式Shift+Down与/tasks、xscopedstop、Escclose/Tabfocus/widthsafe/boundedpreview/pathcopy、唯一lifecycleowner。不消费backendresults，不持runtimecontroller/session。
- 旧AgentWidget/FleetView配置/监听/实现删除，不保留no-op兼容壳；extract实际还用于通知/工具的format/activitytypes等非旧UI能力。
- Down暂不实施、不启用、不称已交付，后续与独立Prettycompat实际editorAPI协调。避免在未集成相邻worktree代码时改SDK/替换editor实例。
- 单完整切片新agent实施、定向tests，主会话实际核查/fullstrict+三模块自然退出后一次集中independentreview；无递归委派/真实模型/network/install/reload/用户配置/commit。

## 已核验的实际接口

compositionbash-unified创建唯一coordinator/lifecycle，controls当前指向processBackend.openPanel；替换为sharedUIowner。coordinator现list/snapshot/registerSource/waits/subscribe，无detail/stopfacade；可增加按identitysourceId finiteoperations，不向UI暴露mutablebackend。

sources已提供TaskView/parentKey/mode/waitCount/artifacts/capabilities和detail/stop。Agent sourceownerretention保留活跃workflowchild，manager结果消费与displayfilter分离；wholegroup四秒需UI按rootowner结束时间过滤，selectedboundeddetail独立保留。process旧panel直接读reg，新的sharedUI只能source/coordinator。

processregistry.renderSidebar负责reg.changed/旧background-jobsstatus/ticker/fgdurationhint。改composition共享footer时不能停止必要hint计时或漏reg.changed。Standalonefactoryfixtures应同sharedUIowner，禁止生产重复footer/panel注册。

旧widget提供一些非UIformat/activity定义给index，删除前拆到非旧UIhelper并更新imports/tests，不误删notifications/statistics。/agents高级管理保留。
