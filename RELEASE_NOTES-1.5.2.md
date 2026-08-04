# 世界背面 1.5.2 · 舆情刷新漏导入修复

- 修复刷新舆情时 `mergePublicOpinionStream is not defined`
- 补齐 `index.js` 对滚动新闻合并函数的 import
- 新增跨模块 import 回归测试
- 发布检查新增未定义标识符扫描，避免同类问题再次漏过

世界逻辑本身没有改动。
