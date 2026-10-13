# 核心面板集中审查：整组窗口窄修

review59d94a60：范围内无执行安全/ownresourceblocking，无误停、重复overlay或旧UI复活；mention真实frontmatter/拒绝/partialattempt通过。独立panel/tool/mixed45/45自然退出，parent466/444日志核验。唯一shouldfix是长workflowchild已完成并consume超十分钟，整组刚结束，sweep在4秒内删除child；已经打开panelcached能保，但sweep后freshpanel不知该child，AC6不满足。

## 确认证据与最小改动

parent添加backend-waits3个actual回归，真正manager.spawnAndWaitconsumechild→drainactualexecution→Date推进11分钟→completeWorkflowTask设置终态/endTime→actualmanagercleanup→构造新TaskPanel：0ms/3999ms应仍父child两行且可看result，4000ms应metadata已sweep/空新panel。非旧panel缓存或复制sweep，preview不consume。

未修source时actual3项1pass/2fail，两个窗口内用例在recordretained false失败；4000ms通过，证明不会把无界保留当修复。source.ts唯一行为增量：ownerretention在running/paused外，task.endTime后共享FINISHED_LINGER_MS内仍true。不改manager/drain/control；4秒外恢复原sweep资格，不保超期控制器。使用sharedmodel4秒常量，避免两处漂移。

严格typecheck+actualbackend/panel测试已通过，日志 `/tmp/pi-bg/b6a9rg6fq.log`，新3项均包含在内。最终集中strict/full469/469、三模块447/447无forceexit自然退出，diffcheck/contextvalidate通过；日志 `/tmp/pi-bg/b0fav00ex.log`。原review独立窄复核actual3/3通过，自然退出，明确finding关闭。核心UI与修订G3接受，完整G4/Down/真实TUI不在该结论内。

README/provenance/spec补freshpanel窗口保证/实际边界回归，G3/coreUI门待最终确认；Down/真实TUI未验。没有模型/安装/reload/提交/个人配置操作。
