# Memory / Question / Recap 来源与全量文档完成

普通只读Agent16602301-a6f3-470返回完整三草稿，主读取后写docs/packages/{memory,ask-user-question,recap}.md，压缩排版并补question预设禁用jumpForward及recap子目录不归files管理。

来源为现有安装包：memory0.4.2（resolveMemoryDir/registerTool/QMD与退出总结逻辑），question2.13.8（工具schema/reconcile/loadConfig/rpiv-config/完整keyboard.md），recap0.4.8（registerRecapCommand/generateRecap/scheduleAwayRecap/persistRecapState/models配置）。三上游README完整阅读，no personal config/credential/memory读取、no writes或产品执行。

Recap README最低Pi0.84.2与peer>=0.84.3冲突，用户文档不复述旧最低门槛；不写本机缺provider断言。Memory恢复不等于彻底删除，qmd另装/首次模型下载与退出请求成本明确；question RPC/ACP与TUI区别保留，未将noninteractive一概说全不可用。

## 文档收齐后实际检查
当前HEAD05eb4dc；docs8local+6thirdparty+index，spec7+README合计23docs；audit60本地links/anchors、69context引用与全部当前manifest/entry coverage，0issues PASS。git diff --check PASS。README116lines。

全部完成后派普通general-purpose独立只读最终准确性review ce2978b2-7d16-43c，覆盖完整README/docs与实际source/安装版本，工具调用限30，核常用字段/commands/defaults/paths，不执行产品或读个人配置。旧原5docs/spec review仍独立，不能声称新范围已review通过。主不重复其语义核对，待返回后验证实际发现并修范围内文档。

不commit/push/archive/install/sync/reload/真实terminal/provider/product tests。
