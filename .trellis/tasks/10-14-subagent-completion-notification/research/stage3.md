# 阶段 3：stopped group 结算

checkpoint：阶段1 c4a5678；阶段2 69bd5ba。阶段2最终group send同步resume定向49/49、tsc通过（/tmp/pi-bg/bnmyfrlk5.log）。

## 最小修改

reconsiderAgentNotice 的group terminal入口允许公开stopped终态通过isRunActive保护；其他结果仍待实际cleanup结束。finalizeBatch同样 retroactively计入已stopped成员。现有canDeliver继续排除stopped自身通知。manager abort、execution drain、pool release与provider cancel未修改。

中文用户文档仅加失败提示/结果仍可取、停止不阻塞兄弟两句；通用spec已含terminal≠execution exit、origin identity和sink isolation，不制造新增专用spec。

## 定向证据

- noncooperative runner promise保持pending，batch形成前/后source实际stop，兄弟及时收到非partial通知；迟到completion无重复。
- 真正running成员mock实际timeout：30s前无通知，30s+200ms partial，straggler完成后再正常通知。mock timers非真实时间等待。
- tool-waits 52/52 exit0自然退出（/tmp/pi-bg/bznrzinep.log）。
- 主会话最终 tsc exit0、后端127/127自然退出、全仓719/719 configured force-exit（/tmp/pi-bg/b1gwwsmhg.log）。
- 独立普通Agent fbd18fbe-83b1-472无blocking，21项group/notice/shutdown和5项execution/waits自然退出PASS。指出partial测试标题过宽，已修名并补completed+stopped noncooperative+running三成员实际回归；最终 tsc通过、后端128/128自然退出、全仓720/720（/tmp/pi-bg/bsvsvt9nd.log），exit0。

## 真实测试限制

tmux已覆盖实际CLI/faux/通知/父followup/warning/退出；noncooperative stopped group及同步resume只由实际factory/manager离线DI验证，不声称在线provider取消质量或物理终端全矩阵。无需增加复杂terminal测试框架。
