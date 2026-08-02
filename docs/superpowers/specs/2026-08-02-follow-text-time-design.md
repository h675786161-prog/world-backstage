# 跟随正文时间（Follow Text Time）设计

日期：2026-08-02  
范围：`world-backstage` 时间推进新增第四档「跟随正文」；推演提交时由插件从正文解析绝对时间并跳转世界时钟。  
状态：产品确认第四档 `follow_text`；源优先级见「来源优先级」；待实现计划

## 问题

当前三档时间策略（严格 / 克制 / 开放）最终都依赖模型返回的 `elapsed_minutes`：

1. 插件只把该增量加到 `clock.absoluteMinute`。
2. 模型常把绝对时间写进 `world.title` / `world.detail`（如「主世界历2042年春。九年过去…」），却填 `elapsed_minutes: 0`。
3. 严格档还会用 `hasExplicitTimeEvidence` 把无证据增量压成 0；开放档仍无法纠正「文案对了、数字是 0」。
4. 插件从不把正文里的绝对日期解析成目标时钟；用户只能手动校准日历。

结果：推演完成、人物/暗流已按「九年后」更新，顶栏世界历仍停在旧日期。

## 目标

1. 时间推进增加第四档：**跟随正文**（`timePolicy: 'follow_text'`）。
2. 该档下，世界时钟权威来自正文解析出的**绝对时间**，不再信任模型的 `elapsed_minutes`。
3. 解析来源：本批新 AI 聊天正文，以及本轮推演结果的 `world.title` + `world.detail`（优先级见下节，避免「仅钟点」挡住跨年世界文案）。
4. 在同一决策层内取**最晚**的绝对时间；若该时间不晚于当前世界时钟，则**不回拨**。
5. 选中此档即覆盖「靠手动日历纠偏」的需求：能解析则跳转，解析不到则本轮时钟不动并写明原因。
6. 行为以纯函数实现，可用单测锁定。

## 非目标

- 不改 Luker / memory-graph 的元数据条或 `event_time` 管道。
- 不做 NLP 消歧（「上周五」「放学后」等相对口语本期不解析）。
- 不在聊天显示层改写正文。
- 不把跟随正文做成独立开关与三档并存（产品确认：第四档，不是额外 toggle）。
- 不在此档回退到开放档的 `elapsed_minutes` 估算（解析失败 → 不动，而不是改信模型增量）。
- 不自动改写用户手动填写的历法名称；锚点映射保持现有 `world.calendar`，只推进 `absoluteMinute`。

## 方案

采用**提交阶段插件解析 + 绝对跳转**：

```text
推演模型返回 JSON
        │
        ▼
normalizeSimulationResult（照旧）
        │
        ▼
timePolicy === 'follow_text' ?
   │                         │
  是                         否 → 现有 resolveElapsedMinutes 路径
   │
   ▼
pickFollowTextClockTarget(sources, baseState)
   ├─ sources.chatNarrative   （调用方已过滤的本批 new assistant 正文）
   └─ sources.worldCopy       （payload.world.title + detail）
        │
        ▼
有更晚目标？
   │              │
  是              否 → elapsedMinutes=0，timeReason=未解析/不回拨说明
   │
   ▼
settleTimedEvents(base, targetAbsoluteMinute)
（展示用 summary.elapsedMinutes 仍由 simulationSummary 用时钟差分计算）
```

### 为何不改 prompt-only

开放档已证明模型会把时间写进文案却不填增量。第四档必须在插件侧闭环。

### 为何不走 `setWorldCalendar` 校准

`setWorldCalendar` 主要重锚显示标签，并把当日时分写回**当前绝对日**；跨年剧情跳跃应增加 `absoluteMinute`，让现有 `formatWorldCalendar` 自然显示新日期，避免把「九年过去」做成只改标签、不结算事件的假跳跃。

## 设置模型

`timePolicy` 合法值扩展为：

```js
['explicit', 'cautious', 'open', 'follow_text']
```

| 值 | UI 文案 | 行为摘要 |
|---|---|---|
| `explicit` | 严格 | 现有：无明确证据则增量与 worked_minutes 清零 |
| `cautious` | 克制 | 现有：模糊最多 180 分钟 |
| `open` | 开放 | 现有：信模型增量（仍受上限夹紧） |
| `follow_text` | 跟随正文 | **新**：忽略模型增量；解析绝对时间并跳转；失败则不动 |

校验：`index.js` 中非法 `timePolicy` 回退 `'explicit'` 的白名单加入 `'follow_text'`。

**迁移：** 无需 `settingsVersion` 迁移；仅扩展白名单。旧存档三档值保持不变；非法值仍回退 `explicit`。

UI（`ui.js` 时间推进四档按钮行）：

- 增加 `跟随正文` 按钮。
- 说明文案：「优先用本批聊天里的年月日/季节跳转；聊天没有这类锚点时再用推演世界文案；仅钟点不会挡住跨年文案。取更晚者，不回拨；解析不到则本轮不动。」

手动日历区（校准 / +1小时等）**保留**，供开局锚定与应急；跟随正文档运行时不再依赖用户每轮手调。无需隐藏日历 UI。

## 解析规则

新增纯函数（`core.js`）：

```js
extractNarrativeClockCandidates(text) → Candidate[]
pickFollowTextClockTarget({ chatNarrative, worldCopy }, baseState) → {
  targetAbsoluteMinute: number | null,
  matchedText: string,
  source: 'chat' | 'world' | null,
  reason: string,
}
```

`chatNarrative` = 调用方传入的已过滤 `narrativeText`（`index.js` 的 `narrativeMessageText` 结果）。`core` 解析函数**不**调用 `narrativeMessageText`。

### Candidate 形状

```js
{
  year: number,          // 必填（time_only 从当前历日继承）
  month: number,         // 1–12；季节锚点填入
  day: number,           // 经 normalizeCalendarDate 夹紧后的日
  hour: number,          // 0–23；缺省 0
  minute: number,        // 0–59；缺省 0
  precision: 'datetime' | 'date' | 'season' | 'year' | 'time_only',
  index: number,         // 在该文本中的起始偏移，用于稳定排序
  raw: string,
}
```

非法日（如 2 月 30 日）按现有 `normalizeCalendarDate` / `daysInCalendarMonth`（含闰年）**夹紧到该月最后一天**，不丢弃候选。

### 识别模式（本期）

在文本上匹配（聊天正文由调用方先过滤；world 文案不经过标签过滤，直接拼 `title + '\n' + detail`）：

1. **完整或近完整日期时间**  
   - `YYYY年M月D日` + 可选时间  
   - `YYYY-MM-DD` / `YYYY/MM/DD` + 可选时间  
2. **年月日 + 无钟点** → `hour=0, minute=0`，`precision='date'`  
3. **年 + 季节**（春夏秋冬）→ 锚点：  
   - 春 → 3/1 00:00  
   - 夏 → 6/1 00:00  
   - 秋 → 9/1 00:00  
   - 冬 → 12/1 00:00  
   - `precision='season'`  
   - 示例：`2042年春`、`主世界历2042年春`（前缀子串不影响匹配）  
4. **仅年份** → 1/1 00:00，`precision='year'`  
   - `YYYY年` 后不得紧跟 `月` 或 `春|夏|秋|冬`  
   - 与季节模式重叠时**只保留** `precision='season'`，不另产 year 候选  
5. **仅钟点** → 日期取**当前世界历日**；目标时刻 `<= now`（**含相等**）则落到**次日**同时刻；仅 `>` 才同日采纳。`precision='time_only'`

### 时段 → 24 小时换算

| 写法 | 换算 |
|---|---|
| `上午 H点`（H∈1..11） | H |
| `上午 12点` / `上午12点` | 0 |
| `下午 H点`（H∈1..11） | H+12 |
| `下午 12点` / `中午` | 12 |
| `凌晨` / `清晨` / `早上` + H（1..11） | H；`12点` → 0 |
| `傍晚` / `晚上` / `夜里` + H | H<12 → H+12，否则 H |
| 无日段的 `H点` / `H:MM` / `HH:MM` | 按 24 小时字面；H>23 丢弃该候选 |
| 可选分 | `H点M分`、`H:MM`、`HH:MM`（M∈0..59） |

`上午 10:20` 视为上午 + 10 时 20 分 → 10:20。

### 明确不识别（本期）

- 纯相对跨度且无绝对锚点：`九年过去`、`两个小时后`、`次日`（跟随正文档忽略；其他档仍可由 `elapsed_minutes` 处理）
- 纯氛围：`清早`、`夜幕降临`、`周日上午`（无年月日或可解析钟点时）
- 插件外元数据条 / UI 时间：**不**单独读取；若同一字符串出现在 `mes` 正文中则按候选处理，不优待也不排除

### 来源优先级与「最晚」

定义：

- **日历级精度** = `datetime | date | season | year`
- **钟点级精度** = `time_only`

决策顺序（保留「先聊天、后世界文案」，并防止仅钟点挡住跨年）：

1. 在 `chatNarrative` 中收集**日历级**候选，换算为绝对分钟后筛 `> baseAbs`；若非空，取最大值，`source='chat'`。  
2. 否则在 `worldCopy` 中收集**全部精度**候选，同样筛更晚者；若非空，取最大值，`source='world'`。  
3. 否则在 `chatNarrative` 中收集 **`time_only`** 候选（含次日规则），筛更晚者；若非空，取最大值，`source='chat'`。  
4. 否则 `targetAbsoluteMinute = null`。  
5. 同一层内并列（绝对分钟相同）时取 `index` 更大者。

「最晚」比较的是换算后的绝对分钟，不是字符串顺序。

示例：聊天仅有 `晚上8点`、world.detail 有 `主世界历2042年春` → 步骤 1 空、步骤 2 命中 2042-03-01（不被钟点挡住）。

### 绝对分钟换算

基于现有历法锚点，**不**调用 `setWorldCalendar`：

1. `current = formatWorldCalendar(baseState)`  
2. 用公历日差（与现有 `addCalendarDays` / `daysInCalendarMonth` 一致，**含闰年**）计算  
   `dayDelta = daysBetween(  
     { year: current.year, month: current.month, day: current.dayOfMonth },  
     { year: target.year, month: target.month, day: target.day }  
   )`  
3. `targetAbsoluteMinute = (floor(baseAbs/1440) + dayDelta) * 1440 + hour*60 + minute`  
4. 仅当 `targetAbsoluteMinute > baseAbs` 时采纳。

跨度上限：跟随正文路径**不**经过 `elapsed_minutes` 的 `5 * 365` 天夹紧。直接 `settleTimedEvents` 到目标。若 `dayDelta > 120 * 365`（按日差判断，不要求把闰日算进上限），拒绝跳转并写入 reason（防止解析误吞巨大数字）。`daysBetween` 本身仍按公历含闰年计算真实目标。

## 提交链路改动

### `resolveElapsedMinutes` / `applySimulationResult`

- `resolveElapsedMinutes`：对 `'follow_text'` 直接返回 `0`（或该分支不调用它）。  
- `applySimulationResult` 在 normalize 之后：

```text
if (timePolicy === 'follow_text') {
  const picked = pickFollowTextClockTarget(
    { chatNarrative: narrativeText, worldCopy: `${payload.world.title}\n${payload.world.detail}` },
    baseState,
  );
  if (picked.targetAbsoluteMinute != null) {
    payload.elapsedMinutes = picked.targetAbsoluteMinute - baseState.clock.absoluteMinute;
    payload.timeReason = picked.reason || `跟随正文时间（${picked.source}）：${picked.matchedText}`;
    state = settleTimedEvents(baseState, picked.targetAbsoluteMinute, {
      source: 'narrative',
      reason: payload.timeReason,
    });
  } else {
    payload.elapsedMinutes = 0;
    payload.timeReason = picked.reason || '正文未解析到更晚的绝对时间，本轮保持世界时钟不动';
    state = settleTimedEvents(baseState, baseState.clock.absoluteMinute, {
      source: 'narrative',
      reason: payload.timeReason,
    });
  }
} else {
  // 现有路径
}
```

- `worked_minutes` 门禁：`follow_text` 与 `open` 同等对待（不因缺乏 `hasExplicitTimeEvidence` 清零）。

**大跨度与事件结算（预期行为）：** 跳转故意走现有 `settleTimedEvents`：所有 `dueAt <= target` 的 `duration` / `scheduled` 事件变为 `ready`；`active` 事件的 `worked_minutes` 仍按模型更新与上述门禁处理，**不**因跨年自动勾完。此为预期，不是 bug。

展示用 `summary.elapsedMinutes` 仍由 `simulationSummary` 从前后时钟差分得到（九年跳跃可能显示为数千天）；apply 只设置 `payload.elapsedMinutes` / `timeReason`，不另写 summary。

### 调用方

`index.js` 已把 `narrativeText: newAssistantTexts.join('\n')` 传入 `applySimulationResult`；跟随正文使用同一字段作为 `chatNarrative`。`world.title/detail` 在 apply 内从 payload 读取，**无需**调用方再传一份。

`world.title/detail` 是**本轮模型输出**，在写入 state 之前即可用于解析；聊天正文是推演输入侧的本批新正文。

### Prompt

`buildSimulationPrompt` 为 `follow_text` 增加时间规则：

- 仍可填写 `elapsed_minutes`，但插件会忽略，改从正文与 `world` 文案解析绝对时间。  
- `world.title` / `world.detail` 若发生时代跳跃，应写明可读的绝对历法时间（如 `主世界历2042年春`），便于插件跟随。  
- 不得把回复轮次当时间。

## 与手动日历的关系

| 操作 | 跟随正文档下的行为 |
|---|---|
| 推演自动跳转 | 解析成功则 `settleTimedEvents` 到目标 |
| 手动校准 / +1h / +1d | 仍可用；不禁用 |
| 解析失败 | 时钟不变；用户可手动校准 |

产品语义：选择跟随正文后，**正常游玩不再需要靠日历区纠偏**；日历区降为开局与急救工具。

## 测试

在 `tests/core.test.mjs`（或新建专注文件）覆盖：

1. `2042年春` → 目标 2042-03-01 00:00（相对当前 2033-05-21 为更晚）→ 跳转成功。  
2. 聊天正文无绝对时间、world.detail 有 `主世界历2042年春` → `source='world'`。  
3. 聊天有日历级更晚时间、world 也有 → 用聊天中最晚日历级；聊天日历级皆不更晚才用 world。  
4. 聊天仅有 `晚上8点`、world 有 `2042年春` → 跳到 2042-03-01（钟点不挡跨年）。  
5. 正文时间早于当前时钟 → 不回拨，`elapsedMinutes=0`。  
6. 仅 `上午 10:20`：当前同日 20:15 → 次日 10:20；当前同日 08:00 → 同日 10:20；当前恰为 10:20 → 次日 10:20。  
7. `timePolicy: 'follow_text'`，模型 `elapsed_minutes: 0`，聊天无日历级锚点、world.detail 含 `主世界历2042年春。九年过去` → 时钟跳到 2042-03-01（截图回归）。  
8. 九年跳转时，一个 `dueAt` 落在新旧时钟之间的 duration 事件变为 `ready`。  
9. `timePolicy: 'open'` 行为不变（不误走解析跳转）。  
10. `dayDelta > 120 * 365` 的荒谬解析 → 拒绝跳转。  
11. `2042年春` 不额外产生 `precision='year'` 的 2042-01-01 候选。  
12. `下午2点` → 14:00；`上午12点` → 00:00；`下午12点` → 12:00。

`ux-polish` / 设置相关测试若断言时间推进只有三档按钮，更新为四档。

## 文件改动预期

| 文件 | 改动 |
|---|---|
| `core.js` | 解析函数、绝对分钟换算、`applySimulationResult` 分支、prompt 文案、`resolveElapsedMinutes` 兼容 |
| `index.js` | `timePolicy` 白名单 |
| `ui.js` | 第四档按钮 + 说明 |
| `tests/core.test.mjs`（及必要时 UX 测试） | 上述用例 |
| `docs/ARCHITECTURE.md` / `README.md` | 简短补充第四档（实现计划中可选任务） |

## 验收标准

1. 设置可选「跟随正文」。  
2. 复现截图场景：世界文案含「2042年春 / 九年过去」、模型 `elapsed_minutes=0`、聊天无更晚日历级锚点时，推演提交后顶栏与 WORLD STATE 历法进入 2042 年春锚点（3/1 00:00），且不早于跳转前。  
3. 正文只有更早时间时时钟不回拨。  
4. 聊天仅钟点不阻止 world 跨年文案生效。  
5. 严格/克制/开放三档回归通过。  
6. 单测覆盖解析与 apply 路径。
