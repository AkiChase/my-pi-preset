# 插件标题一致性修订

用户指出blocked-signal“等待用户通知”标题不准确、多份标题风格不统一。主统一全部14插件页H1为“插件名称：简短功能说明”；本地用统一显示名，第三方用实际包名。README/docs索引Task Composition与At Path Completion同步匹配。

Blocked Signal改“Blocked Signal：交互等待状态提示”，不是等待通知到达；status/SSE/task/path显式保插件标识，Memory/Recap/Question等改真实包名，Session Name不以自动功能代替整个命名功能。development加入标题规范。

全部14H1 name+全角冒号+功能检查PASS；audit23docs60links69contexts覆盖/anchors0issuesPASS；git diff --check PASS。未改产品行为，未安装/测试/commit/archive。自检非新增独立review，待用户认可标题及当前整体文档结果。
