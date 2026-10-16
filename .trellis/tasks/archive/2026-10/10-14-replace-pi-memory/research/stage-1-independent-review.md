# 阶段一独立审查

2026-10-15，trellis-check 在共享 source/main 执行。仅审查存储、配置、identity、四工具及初始生命周期围栏；prompt、面板、preset、个人迁移不是本阶段失败项。主会话负责验收/提交；本审查未 commit/start/archive/install/sync/reload，也未递归派发。

## 审阅范围

完整读取 `extensions/memory.ts` 和 `extensions/memory/` 全部 13 个文件（7 个实现文件、6 个测试/fixture 文件），以及注入的 development/testing/guides、任务 PRD/design/implement；核对 check.jsonl 全部 6 个引用存在。读取 git status、unstaged/staged diff、untracked 清单。仅两个其他任务的 tracked planning 文件有 diff，未修改；本阶段产品全为 untracked。未提供 Review base，因此本次不审查 committed history，也不把 tracked 空产品 diff 当作无工作。

## 发现与修复

1. `extensions/memory/paths.ts:71–87`：发布前只验证临时文件是 regular file，未验证仍为本次创建 inode，也未验证内容。另一个普通文件替换或同 inode 内容修改可发布错误正文并返回预期正文 revision。补 dev/ino 和有界完整内容验证；清理仅删除本次 inode，保留外来替换文件。新测试覆盖普通文件替换、原地修改、symlink 替换及 lock 释放。
2. `extensions/memory/store.ts:120`：外部原地编辑 index 为未知格式会通过 inode 检查并被覆盖。发布前再次 checkIndex；回归证明未知正文保留、临时文件/锁释放。
3. `extensions/memory/config.ts:21–23`：config 同类未知格式原地编辑窗口。发布前再次验证 config 与 activation；回归通过真实 fsync 边界注入外部格式修改，证明不覆盖未知配置。
4. `extensions/memory/lock.ts:15–19`：Windows 不能用 Node process.kill(pid,0) 证明 owner 死亡；保守保留 Windows 未知 owner、不发信号。模拟平台的回归证明 lock timeout 且原锁不改。POSIX 实际双进程与 crash owner 恢复测试仍通过。
5. `extensions/memory/paths.ts:12–16`：路径遍历用硬编码 `/`，Windows 分隔符下不能逐祖先校验。使用 node:path 的 sep，并拒绝反斜线 UNC 路径。没有声称 Windows 真机运行已验证。

## 核心证据

- 实际写入 230 个接近 16KiB 的主题；scan 仅 frontmatter，每文件结束 delimiter 立即停止，实际 scannedBytes 小于 230KiB，非整正文总量；index <=25,000 bytes/200 完整行，分页 <=8KiB，230 条全部可发现。
- malformed/oversized header、entry capacity、UTF-8/控制字符、secret、slug/type/revision、未知 index/config、symlink/hardlink 拒绝；保留原有主题/index，没有部分扫描重建。
- 两个独立 Node 子进程同时提交同 revision，恰好一个成功、一个冲突；实际自然退出；crash 子进程 SIGKILL 后等待 exit，再验证死 owner lock 恢复。不是仅 Promise.all 的单进程竞争。
- 主题/index failure、partial write/delete、外部 edit revision 冲突、缺索引修复、取消/旧 activation/晚 Git 初始化围栏通过。
- 新 fsync 回归通过真实 Node fsync 注入目录 fsync 失败：主题 published 后 saved=true/indexNeedsRepair=true/revision 对应磁盘正文；config published 后抛 PublishedError，磁盘 enabled 已切换，锁释放。这不是“设置未改变”。后续菜单实现须重新读取磁盘、显示 published/durability 警告，不能把异常当作设置未发布。未改变现有 setEnabled Promise<void> 接口。
- 实际 installed Pi 1.2.0 `discoverAndLoadExtensions`/jiti loader 加载 production entry，四工具注册且 factory 不创建存储。另 typed public registration seam 验证工具执行/错误/生命周期。实际 SDK 多轮 prompt/resume/TUI 不属于阶段一，不宣称已经测试。

## 安全取舍及未扩范围

- safeDirectory 按既有设计拒绝 public agentDir 的所有 symlink 祖先（不只是 memory 下）。已补 alias-agentDir 无写入回归，未放宽；macOS `/var` 等系统 symlink 或用户 symlink agentDir 会被拒绝，真实 fixtures 使用 realpath 的 temporary root。是否信任宿主已 canonicalized agentDir 的祖先是兼容性/设计取舍，主会话需明确后续提示/接受，不能隐式放宽成任意根路径。
- 非 `.md` 的未知顶层项计入目录容量但不读取、不删除，测试保留 `.memory-tmp-unknown`；`.md` 必须有效，未知 MEMORY.md 不覆盖。unknown lock 不抢占。孤儿/外来临时项保留并计入容量不是自动清理授权。
- POSIX 外部工具不遵守锁的 rename/check 窗口依然无法消除，不声称全进程 sandbox/完整跨工具事务。启发式 secret 检查不保证全部识别。
- 原有 read 对超大主题拒绝完整正文/revision；bounded preview/UI 在后续面板阶段实施，不能把本次拒绝视为完整 UI 预览验收。

## 精确验证与首次失败

环境：Node v24.14.1，pnpm 10.33.0；已有 SDK `/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules`，link-sdk 输出 linked 0 new of 7。未下载依赖。每轮创建 disposable PI_CODING_AGENT_DIR，命令结束后仅 rm 自建目录；测试自建 root 均使用 realpath。

每轮实际脚本（各步捕获独立 exit，不以最后命令掩盖）：

```sh
set -u
sdk_dir="$(node -e 'const fs=require("node:fs"),p=require("node:path");console.log(p.dirname(p.dirname(fs.realpathSync("node_modules/@earendil-works/pi-coding-agent"))))')" || exit 1
agent_dir="$(mktemp -d)" || exit 1
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" node --test extensions/memory/__tests__/*.test.ts > "$focused_log" 2>&1
focused=$?
PI_SDK_DIR="$sdk_dir" PI_CODING_AGENT_DIR="$agent_dir" pnpm check > "$check_log" 2>&1
check=$?
rm -rf "$agent_dir"
echo "FOCUSED_EXIT=$focused CHECK_EXIT=$check"
[ "$focused" -eq 0 ] && [ "$check" -eq 0 ]
```

日志均在本 research 目录，原失败未覆盖：

| 执行 | 日志 | 实际结果 |
| --- | --- | --- |
| 修改前基线 focused | stage-1-independent-focused-first.log | 自然退出 0，20/20 |
| 新回归第一轮 focused | stage-1-independent-focused-final.log | 自然退出 1，21/22 |
| 新回归第一轮 check | stage-1-independent-check-first.log | exit 1；typecheck 通过，794/795 |
| 修测试 mock 后 focused | stage-1-independent-focused-second.log | 自然退出 0，25/25 |
| 修测试 mock 后 check | stage-1-independent-check-final.log | exit 0 |
| 最终 focused | stage-1-independent-focused-third.log | 自然退出 0，27/27 |
| 最终 check | stage-1-independent-check-third.log | exit 0；strict typecheck + 800/800 |

第一轮唯一失败是我新加的目录 fsync 注入 fixture：修改 node:fs default export 后未 syncBuiltinESMExports，production namespace 的 fsync 仍指向旧函数，导致 indexNeedsRepair=false。保留 assertion false!==true 日志，补 syncBuiltinESMExports 并 finally 恢复，再通过。没有修改产品让其迎合错误 fixture。

最终 check 自带 --test-force-exit，因此它不证明全仓自然退出；独立 focused 没有 force-exit，27/27 的自然退出才是本任务资源证据。全量包含 scripts/pi-manifest.test.mjs 和 scripts/sync.test.mjs，均通过。未配置独立 lint script，Lint NOT_RUN；strict typecheck、git diff --check exit 0，14 个产品/测试文件 untracked whitespace、active check.jsonl parse/existence exit 0。

## 结论

阶段一 scoped review 完成，修复上述具体漏洞后最终验证通过。未发现需要阻断存储/工具阶段的剩余确定性产品失败；public agentDir symlink 兼容性取舍、配置 durability 提示及后续 bounded preview 需主会话在后续阶段正确承接。prompt/UI/preset/个人迁移/真实 PTY/在线模型质量/Windows 真机均 NOT_RUN，不能标整个替换或全部 AC 完成。主会话仍需复核实际修复和日志后自行决定阶段接受及本地提交。
