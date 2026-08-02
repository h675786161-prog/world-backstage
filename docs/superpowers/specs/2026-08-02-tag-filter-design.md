# 标签过滤（Tag Filter）设计

日期：2026-08-02  
范围：`world-backstage` 观测设置新增「标签过滤」模块；在推演 / 记忆 / 人物观测读取正文时剔除杂标签与 HTML 注释。  
状态：已通过产品确认，待实现计划

## 问题

插件在提取聊天正文做世界推演、长期记忆整理和人物观测时，直接使用原始 `mes` / swipe 文本，没有剔除：

- HTML 注释中的自我纠正草稿，例如 `<!-- ... -->`
- 功能性标签块，例如 `<options>...</options>`
- 格式边界标签，例如仅出现的 `</dream_body>`

这些内容会污染推演与记忆模型输入。

## 目标

1. 观测设置中新增「标签过滤」分组，用户可配置要剔除的标签规则。
2. `<!-- ... -->` 始终整块删除，不可关闭。
3. 用户规则区分「开头标签」与「结尾标签」；开头可空。
4. 过滤只影响喂给推演 / 记忆 / 观测的文本；聊天原文、分支哈希、待推演队列判断不变。
5. 默认预置常见成对规则，可增删。

## 非目标

- 不修改 SillyTavern 聊天原文或显示。
- 不做模糊 / 正则自定义匹配（本期为严格字面匹配）。
- 不把过滤规则写入聊天 metadata 或导出世界状态。
- 不在提示词构造器内各自实现一份过滤逻辑。

## 方案

采用**提取层统一过滤**：

```text
聊天原文 (mes / swipes)
        │
        ├─ selectedMessageText()（保持原文）
        │     └─ branchSourceKey / hash / 队列 / hasUsableAssistantText
        │
        └─ narrativeMessageText()
                = filterNarrativeText(selectedMessageText(), settings)
                        ├─ 世界推演 narrativeContext
                        ├─ 记忆整理 nextHistoryBatch
                        ├─ 人物观测 narrativeTurns
                        └─ recentChatText（相关性检索用）
```

- 纯函数 `filterNarrativeText(text, settings)` 放在 `core.js`，便于单测。
- `selectedMessageText` 继续返回原文，供哈希与可用性判断使用。
- 新增 `narrativeMessageText`（`index.js`）专供叙事链路；不在分支 key、hash、可用性判断处调用过滤。
- `hasUsableAssistantText` 继续基于**过滤前原文**，避免滤完为空导致漏排队。
- `narrativeContext` 内 `latestTurn.user` 当前直接读 `chat[i].mes`；`recentChatText` 当前直接读 `message.mes`。实现时这两处必须改为 `narrativeMessageText(message)`，不得只替换 `selectedMessageText(...)` 调用点。`recentChatText` 因此同时改为按当前 swipe 取文（与 `selectedMessageText` 一致），再过滤。
- 所有叙事入口统一为：先得到完整过滤文本 `narrativeMessageText(message)`，再由调用方 `slice` / 计入字符预算。禁止先截断再过滤，以免切断标签对并扭曲批次长度。
- `recentChatText` 同时用于正文注入相关性检索（`buildInjectionPackage`）；它走过滤后文本，但不改写注入到主对话的世界状态内容本身。

## 设置模型

扩展设置（`extensionSettings[MODULE_ID]`）新增字段：

```js
{
  tagFilterEnabled: true,
  tagFilterRules: [
    { open: '<options>', close: '</options>' },
    { open: '<thinking>', close: '</thinking>' },
    { open: '<think>', close: '</think>' },
  ],
}
```

约束：

| 字段 | 规则 |
|---|---|
| `tagFilterEnabled` | 布尔；关闭时仍删除 HTML 注释，但跳过用户规则 |
| `tagFilterRules` | 数组；最多 30 条 |
| `open` / `close` | 字符串，trim 后保存；各自最长 80 字符 |
| 空规则 | `open` 与 `close` 皆空 → 保存时丢弃 |
| 默认值 | 见上表三条成对规则；升级后首次 `getSettings` 对缺失字段回填默认值 |
| `settingsVersion` | `13`（当前为 `12`） |

导入 / 导出世界状态不包含这些字段（它们属于插件设置，不是世界 store）。

## 过滤语义

对单条消息文本：

1. **始终**删除全部 HTML 注释：`<!-- ... -->`（含内部内容，允许跨行）。
2. 若 `tagFilterEnabled === false`，到此结束。
3. 否则按 `tagFilterRules` **从上到下**依次应用；每条规则反复匹配直到不再命中。

| 开头 | 结尾 | 行为 |
|---|---|---|
| 有 | 有 | 删除字面 `open … close` 整块；非贪婪；同一规则可删多段 |
| 空 | 有 | 找到**第一个**字面 `close`，删除从文本开头到该 `close`（含）的全部内容；因规则会反复应用，后续若仍有同一 `close`，会继续削到下一个 |
| 有 | 空 | 找到**第一个**字面 `open`，删除从该 `open` 到文本末尾的全部内容 |
| 空 | 空 | 忽略 |

匹配方式：**严格字面、区分大小写**。填写 `<options>` 不会匹配 `<options type="x">`，也不会匹配 `<Options>`。  
转义：对用户填写的 `open`/`close` 做正则转义后再查找，防止用户输入被当成正则元字符。  
未闭合的 `<!--`（找不到对应 `-->`）：保持原文，不删除到文末。

作用范围：世界推演、记忆整理、人物观测（三条链路共用同一入口过滤）；注入相关性用的 `recentChatText` 同步走过滤。

## UI

观测设置新增折叠分组：

- 标题：`标签过滤`
- 副标题：`剔除杂标签与注释后再推演 / 记忆`
- 位置：`自动推演` 与 `世界书人物` 之间
- `data-settings-group="tagfilter"`

分组内容：

1. **启用标签过滤**开关（`tagFilterEnabled`）。说明文案：关闭后仍会删除 HTML 注释。
2. 固定说明：`<!-- ... -->` 始终整块删除；匹配为严格字面。
3. 规则卡片列表：每条含「开头标签（可空）」「结尾标签」、删除按钮。
4. **＋ 添加规则**按钮。
5. 输入框使用插件现有表单正文色（高对比），不用过淡占位色承载已填值。

交互约定：

- 开关与规则字段沿用现有设置控件的即时写入方式（与 `data-wb-setting` 同类：变更即 `saveSettings`）。
- 添加规则时在 **UI 草稿层**追加一条空卡片，不立即写入 `tagFilterRules`。仅当 `open` 或 `close` 至少一侧非空时才写入对应数组项；`getSettings` 规范化只丢弃持久化数组中的双空项，不得清掉尚未提交的 UI 草稿卡片。
- 规则输入在 `change` / `blur` 时：若至少一侧非空则写回 / 插入持久化数组；若两侧皆空则从持久化数组移除该项（草稿卡片可仍显示到下次关闭设置）。
- 删除规则立即从持久化数组移除并保存。
- 规则数上限 30 以已持久化非空规则为准。
- 展开状态进入现有 `openSettingsGroups` 生命周期集合，不持久化到 metadata。

## 错误处理与边界

- 单条过滤后为空：在构建 prompt / 历史批次时跳过该条（现有 `filter(turn => turn.content)` 等），但不影响原文可用性与排队。
- 某次推演待处理的 assistant 正文在过滤后**全部为空**（trim 后）：跳过模型调用，按“无世界变化”完成该次推演（不报错、不改世界状态；队列推进 / 成功路径与现有“无变化”语义对齐）。
- 记忆批次中过滤后为空的单条跳过；若整批 `messages` 为空则前进 cursor，不调用模型。
- 人物观测在过滤后 `narrative.turns` 全空时仍允许调用模型，prompt 中正文上下文按现有空上下文占位（例如“无”）处理。
- 仅结尾规则且正文中无该结尾：文本不变。
- 仅开头规则且正文中无该开头：文本不变。
- 成对规则找不到成对 close：该次匹配失败，不删除（避免误删到文末）；实现时用非贪婪成对查找，找不到 close 则停止该规则。
- 嵌套同字面标签：按「先开后闭、非贪婪」处理，不尝试完整 XML 解析。
- 恶意超长规则：截断到 80 字符；规则数上限 30。

## 测试

在 `tests/` 为 `filterNarrativeText` 增加用例，至少覆盖：

1. HTML 注释跨行删除。
2. 成对规则删除整块内容。
3. 仅结尾：删除结尾及之前全部。
4. 仅开头：删除开头到文末。
5. 严格字面：`<options>` 不匹配 `<options x>`。
6. `tagFilterEnabled: false` 时仍删注释、不跑用户规则。
7. 多规则顺序应用。
8. 仅结尾规则多段反复削剪。
9. 未闭合 `<!--` 保持不变。
10. 先过滤再截断：过滤完整文本后再 `slice`，截断点不得落在标签对内部导致漏删（用带闭合标签的长文本断言）。
11. 原文路径：`hasUsableAssistantText` / branch key 不依赖过滤结果（契约测试或文档化断言）。

## 文件改动预期

| 文件 | 改动 |
|---|---|
| `core.js` | 新增 `filterNarrativeText`（及必要的规则规范化辅助） |
| `index.js` | 默认设置、`getSettings` 规范化、新增 `narrativeMessageText`、叙事入口改走过滤结果 |
| `ui.js` | 观测设置「标签过滤」分组与规则编辑交互 |
| `style.css` | 仅在现有设置样式不够用时补少量规则卡片样式 |
| `tests/*.test.mjs` | 过滤语义单测 |
| `docs/ARCHITECTURE.md` | 实现完成后补一句提取层过滤说明（可选，随实现） |

## 验收标准

1. 设置面板可见「标签过滤」分组，默认可编辑三条预置规则。
2. 含 `<!-- 草稿 -->` 与 `<options>...</options>` 的正文进入推演 / 记忆 / 观测时，上述片段已被剔除。
3. 仅配置 `close: '</dream_body>'` 时，该闭合标签及之前内容被剔除。
4. 关闭「启用标签过滤」后，用户规则不生效，但注释仍被删除。
5. 修改过滤设置不会改写聊天消息原文，也不会改变已有分支 source key。
6. 待推演正文过滤后全空时不调用模型，且不错误改写世界状态。
