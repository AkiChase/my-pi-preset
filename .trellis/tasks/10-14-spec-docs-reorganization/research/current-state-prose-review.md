# 用户文档去除历史包袱

用户不接受用户文档叙述旧实现/旧配置/迁移历史，特别指出Beautify pi-pretty.json与standalone Pretty说明会误导新读者。主在现有获批文档范围直接修订并自检，不派发代码角色。

## 实际修正
- Beautify删除旧Pretty配置/包迁移说明。
- Task composition删除旧bg-tasks/subagents文件、旧快捷键/bg-list、fleetView等废弃设置及bash-unified改名说明；只列当前配置与入口。
- Monitor删除旧配置键清单；Session Name删除旧包提醒。
- Web/问卷删除旧配置路径回退叙述，保当前推荐路径；README conflicts改当前同步语义，不枚举旧实现来源。
- 将旧任务/旧请求等当前取消语义改为当前任务/待续请求直接表述，保真实行为保证。
- development文档维护规范加入当前状态原则：用户功能页不承载废弃入口、旧文件、历史实现/迁移，必要当前限制直接说明；历史证据仍留任务。

## 检查
全docs+README关键词扫描只剩input-history“更旧的匹配记录”与memory“恢复已删除条目”，二者是当前功能，不是历史迁移。audit23docs/60links&anchors/69activecontext、manifest/entry coverage 0issues PASS；git diff --check PASS。

此次仅删除旧历史及简化现有行为措辞，自检非新增独立review；之前源码核对与两次独立审查证据仍用于未变的当前功能声明。不producttest/install/个人sync/reload/commit/push/archive。当前结果待用户接受，不把此前交付当最终用户验收。
