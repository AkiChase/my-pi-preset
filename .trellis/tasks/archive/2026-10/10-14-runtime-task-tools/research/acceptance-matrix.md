# 本次验证与验收矩阵

当前仅准备矩阵，所有项默认 NOT_RUN，必须以最终代码上的实际命令/报告更新。阶段1的旧绿色报告不覆盖stage2。

| Gate | 需要证据 |
| --- | --- |
| 六公开工具、旧注册移除 | actual loaded extension tools（root/child），active prompts/filters/内部调用审计；不是纯字符串重命名 |
| 四后端身份与作用域 | rawRPC真实ID唯一解析、run精确绑定、stale/ambiguous/forbidden拒绝；child不能读root/sibling，nestedoff本地process仍可用 |
| output/search/stats | process byte页/UTF8/缺日志，regex/context/count；subagent完整最终回答+verbose，workflow脚本return/error；状态/列表不消费 |
| wait与stop | 已abort/多wait、/bg取消不停止、completion同tick/consume先于抑制释放；真正停止process/WS/worker和不协作provider限制明确 |
| 实际loader | same/differentcwd、重复factory/ALS重叠、late registration/root-child shutdown不互dispose |
| workflow终态 | setupfailed、pausedstop/replay拒绝、不可变最终return、menu pause/resume/skip/retry无损、held通知取消重查 |
| Beautify | 实际宿主注册callback、新metadataguard/unknown委托、七action四type、partial/final/取消释放、一次padding、逐cell背景、窄宽、正文展开无I/O/consume |
| 基础回归 | Read/Bash/Find/Grep、manifest/sync、严格tsc与全量自然退出；独立lint缺失不得冒称执行 |
| 文档 | 当前三用户页+pi-trellis组合限制符合源码；规范/activejsonl/link/whitespace，不回写历史证据 |
| 独立review | 独立于实现代理，完整PRD/diff/代码，主会话核实际修复和freshchecks，不以summary代验收 |
| 隔离真实tmux | 现有CLI1.2.0、unique -L、tempHOME/agent/cwd、offline本地provider、actualtool、Ctrl+O、140/80/40完整frame、wait释放/最终答复与真实PIDexit |

## 不自动扩张的边界

外部pi-trellis关联适配、onlineprovider质量、个人安装/sync/reload、物理mouse/IME与任意插件组合不在本次自动验证范围。第三方非协作取消不能宣称强制结束。真实tmux不足覆盖的维度逐项标NOT_RUN，不以组件测试替代。

## 最终报告要求

逐项PASS/FAIL/NOT_RUN，精确命令、版本、退出码和report.error；保存初次失败，区分fixture误差/产品缺陷，不放宽硬断言掩盖缺陷。只有核心PRD验收满足且所有阻塞失败消除，才进入source task归档，target dirtyworktree保留。
