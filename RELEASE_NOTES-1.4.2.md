# 世界背面 1.4.2 · 新闻不再偷抄卧室暗流啦（恼）

1.4.1 把“事件能被正文/角色看见”误当成了“社会已经公开知道”，
于是 direct / known 的私密剧情也被同步进新闻，新闻区看起来像暗流和回声复制粘贴。

这版把两个概念彻底拆开：

- `visibility`：事件怎样进入当前正文 / 角色视野
- `publicity`：事件在社会层面是否公开传播

现在：
- publicity=private：永远不进舆情
- publicity=trace：只能形成未证实论坛讨论
- publicity=public：才允许进入新闻
- 卧室、私聊、秘密行动即使 visibility=direct，也不会自动变新闻
- 新闻只读取 public_headline / public_summary / public_trace，不再直接复制暗流 title / summary / result

旧 1.4.1 状态也会保守迁移：
只有明确出现公告、报道、媒体、官方通知等公共传播证据的旧事件才会认定为 public；
其余 known/direct 事件默认保持 private。

所以升级后，之前那些“主卧里的对峙也上世界新闻”的离谱卡片会自动被过滤掉，不需要手动清缓存。
