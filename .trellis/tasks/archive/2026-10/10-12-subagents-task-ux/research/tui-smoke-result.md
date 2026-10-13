# 隔离真实 PTY 冒烟：首轮证据与余项

## 首轮（actualCLI/PTY，非fakehost）

generalagent b8fc955e在 `/tmp/pi-real-tui-smoke-6ouRGH` 创建临时HOME/agentconfig/cwd/sessions/logs与probe。直接Node+installedPi dist/cli.js，--offline/PI_OFFLINE/noapprove/noextensions+onlyprobe/noskills/notemplates/nothemes/nocontext/nomcp/no版本检查/telemetry；无个人配置或网络。probe加载actualcomposition/Pretty，faux原生offline scriptedprovider只控制响应，不运行在线模型；FFF native服务用既有seam禁扫描。

首轮真实140x40PTY、真实按键/actions与屏幕：13项PASS，包括empty/no tasksDown与原生history、fg-onlyshellDown显示SHELL_READY/foregroundwait1、Esc保wait/PID、非空Down与ShiftDown草稿、detach原PID仍live/backgroundwait0、x实际shellkill+selectedoutputretain、actualagentforeground/queued、实际childsession/bashtoolCHILD_READY/CHILD_LOCAL_OK、解除两agentwait不消费heldresponse。

证据已由parent读actualreport/screen/failure/probe/driver：report.json、pty.raw、actions.jsonl、events.jsonl、screens01–13。首轮finallyCLI已退出，ps无fixture残留；shell/monitorPIDgone，但没有独立枚举所有worker。

## 夹具中断，不是产品bug

workflow实际worker/ownedchild已经started，failure屏幕真实显示默认展开 `▾ workflow PTY Workflow` 和缩进 `agent general-purpose`。driver却等待 `PTY child` 标签（workflow的progresslabel不是agent真实handle），超时；不能说后续steps已PASS，也不因此改产品标题。workflow子详情/stop、monitor/new/quit尚未跑。

## 最小余项

parent仅从首轮提取原VTdriver/probe到新临时root `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-real-tui-tail-lpv4erj9`，保留首轮所有证据不覆盖。tempdir由python tempfile创建（本机TMPDIR指向该路径）。无repo/SDK/个人配置写。

余项driver的前三项已经actualPASS：workflow默认展开、ownedchild即时对话/本地bash、x停止workflowworker+actualchild并abortheld响应。随后monitor选择用了End，误选最后的已停止child而不是列表中的monitor，等待monitor详情超时；截图可见monitor正确running，但该case不能算PASS。parent读report而不依exit0（此driver捕获error写report仍退出0，不能当成功）。已保留尾轮证据。

最后monitor/new/quit在新root `/var/folders/fx/bn7t1rq16xn7_66t233x_s1h0000gn/T/pi-real-tui-close-zj3buryg`完成：3/3PASS，report无error、natural_exit=true、旧monitorPIDgone、CLIquitshutdown。job b2qsobll0 exit0与actualreport一致；parent读screens/report/events，ps无三轮fixturePID残留，diffcheck/context通过。

## 最终范围验收

三轮分段共19项实际PTY检查PASS（13＋3＋3），首两轮error如上保留，未重复计完整flow通过。实际140x40终端/installedCLI/真实kbd与当前composition/Pretty，shell/monitor真实OS进程、agent真实childsession但faux离线脚本、workflow真实worker。默认workflow展开、详情即看、xscoped停止、Down条件/queue/detach/PIDcontinuity、new/quit的核心交互可验收。自然退出证明临时进程/线程未阻止exit，非全部worker枚举或任意thirdparty不协作强杀保证。

不是在线模型自主质量、完整多终端尺寸/任意插件组合/input-history原包全部顺序、真实gitworktree/provider认证验证；这些未冒称本轮覆盖。真实交互烟测无新产品缺陷，只两处fixture预期修正；自动483/461与独立core/Down复核仍有效。用户个人安装/配置未动、未commit/finish/archive。
