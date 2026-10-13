# 原型独立审查

## 判定
12/12 定向测试经 trellis-check 独立运行确认，原始 history-first 红测预期失败。中心历史修复方向可行，但原型不具备正式集成条件。

## 确认问题
1. `extensions/pretty-compat/__tests__/prototype.ts` 安装失败缺少事务回滚。拒绝不支持 embedded status 的 editor 后，host factory 未恢复、editorContainer 变空，下一轮安装可能抛 Unexpected Pretty installation；render 不可写时 adapter 构造先改变 padding，后续失败未恢复。正式实现需预检查属性可写性，并在装饰/注册失败后恢复 padding、hooks、factory、container、slot。
2. 清理只对方法做所有权检查，最后无条件调用原 setPaddingX，仍会覆盖后来插件状态。独立探针中后来插件 padding 从 7 被清理成 0。需将 padding 状态恢复纳入所有权判断，补后来插件接管 padding 的回归。

## 覆盖边界
- 真实 SDK setter/editor、Pretty 与 input-history 源码证明冲突及双加载顺序下历史修复。
- harness 的事件分发/runtime/应用回调为 fixture，Alt+R handler 直接调用，尚非真实终端/CLI 端到端。
- fixture reload 先 shutdown，真实 SDK reload 先 reset UI 再 shutdown；独立模拟实际顺序下双顺序历史通过，但不能代替真实 runner 测试。
- 仅证明 SDK 1.1.0、Pretty 0.6.31 及支持特定 hooks/embedded status 的 editor。
- 极窄中文递归溢出和单列光标越界为原 SDK/Pretty 同样存在的限制，未修复。
- 长期 wrapper 增长、后来 working-controller 所有权、复杂异步补全仍未充分验证。

## 独立命令结果
- 原型测试 12/12，0 skipped。
- 原始 history-first 红测预期退出 1。
- manifest 4/4；tsc 无诊断；diff --check 通过。
- 正式入口、manifest、README、lockfile 未修改；未提交；未运行全量 pnpm check。

## 后续
先在独立 worktree 修复原型异常回滚与 padding 所有权，再收敛正式兼容接口和真实生命周期验证方案。不得把现有原型直接上线或宣称完整验收通过。
