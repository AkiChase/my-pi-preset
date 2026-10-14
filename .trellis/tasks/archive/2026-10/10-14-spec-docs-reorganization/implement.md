# 实施计划

## 授权
用户批准主做1、2，并行 Agent 做3。保此前不自动commit/push/archive限制；本轮不提交。最终独立审查后待验收，不恢复其他任务。

## 阶段1：规范收敛（主）
读取全部旧规范，建立约束迁移映射。development/index 合并有效开发/同步/文档规则，testing/index 整理测试规范；更新根入口和 guides，删除 preset 拆分与错误 docs 归属。更新受影响活动 JSONL，保归档。阶段自检：真实层发现、语言、约束映射、链接/空白。

## 阶段2：测试归位（主）
迁移翻译 docs/testing/tmux 到 spec/testing/tmux，修相对引用。重写 docs/index 为纯用户导航；README 仅修改本任务文档职责 hunk。阶段检查不得因 Agent 尚未完成而声称用户链接已全通过；明确中间待完成项。

## 阶段3：用户文档（Agent 与1/2并行）
核旧绑定/草稿并协调最新基线与材料后 managed dispatch。Agent 范围仅 docs/extensions 和任务 research 证据，候选五插件，各文档以真实源码为准。禁止改共享索引/README/spec/产品或派发/提交。主核完整产物与声明依据后整合；旧基线差异必须报告，不预测 Agent 结果。

## 阶段3补充：全部插件与README去重（用户批准）
以当前pi-preset.json六个第三方包与extensions七个顶层入口盘点，不以README旧表推断完整性。普通Agent分组只读研究、返回完整中文草稿与源码证据，禁止任何文件修改/安装/派发；主写入docs/extensions及docs/packages，补9份（6个第三方、3个本地）并核既有5份。README插件详细段落全部移出，改一句话+链接；跨插件配置说明只链接，不再复制表。全部完成后统一核当前实际来源；latest包不承诺永久版本，无法核的细节删去或明确限制。

## 阶段4：整体验收
curate check.jsonl，独立文档审查。主核实际修改与报告并复跑受影响检查。无产品测试/真实终端/安装副作用。

## 命令
```sh
TRELLIS_CONTEXT_ID=pi-df3eedbb9d3e python3 .trellis/scripts/get_context.py --mode packages --json
python3 .trellis/tasks/10-14-spec-docs-reorganization/research/audit_docs.py
TRELLIS_CONTEXT_ID=pi-df3eedbb9d3e python3 .trellis/scripts/task.py validate .trellis/tasks/10-14-spec-docs-reorganization
git diff --check -- .trellis/spec README.md docs .trellis/tasks/10-14-spec-docs-reorganization
```
审计包括 untracked、anchors 和当前 JSONL。空 manifest 或中间缺失 docs 如实记为失败，不冒称全通过。审计工具按实际新结构修改，不能放宽规则隐藏断链。
