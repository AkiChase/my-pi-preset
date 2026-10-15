# 测试规范更新候选

在最终产品集成时，将 current `.trellis/spec/testing/index.md` 的 Beautify focused checks 旧 `jobs/get-result envelopes` 变为：

> registered `task_manage` versioned metadata across actions/types, exact parameter/result identity matching, partial/final state and wait release without stopping execution; expanded management results use returned content only, without backend I/O or consumption.

本候选是英文规范中的最小合同更新，不新增功能spec。主会话曾仅编辑 target testing baseline，导致managed collect正确拒绝baseline差异。现已将target该处恢复为source一致基线；改动候选保留本task，待最终source产品集成一并更新，不能以绕过hash/runtime门禁的方式收集。开发方法不写用户docs。
