# Follow Text Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `timePolicy: 'follow_text'` so world-backstage jumps the world clock to the latest absolute time parsed from batch chat narrative and/or simulation `world.title`/`detail`, ignoring model `elapsed_minutes`.

**Architecture:** Pure parsers in `core.js` (`extractNarrativeClockCandidates`, `pickFollowTextClockTarget`, calendar→absoluteMinute). `applySimulationResult` takes a dedicated branch for `follow_text` that calls `settleTimedEvents` to the target. Settings whitelist + four-button UI; no new toggle.

**Tech Stack:** SillyTavern extension (vanilla JS modules), Node `node:test` / `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-02-follow-text-time-design.md`

**Branch:** Create `feat/follow-text-time` from **`origin/main`** (remote tip — not local `main`, which may contain tag-filter commits). Stash all WIP first; restore only the follow-text spec (and this plan) onto the new branch.

---

## File map

| File | Responsibility |
|---|---|
| `core.js` | `daysBetweenCalendarDates`, `calendarDateTimeToAbsoluteMinute`, `extractNarrativeClockCandidates`, `pickFollowTextClockTarget`; `resolveElapsedMinutes` + `applySimulationResult` + prompt `timeRule` |
| `tests/follow-text-time.test.mjs` | Parser + pick + apply integration tests from spec |
| `index.js` | `timePolicy` whitelist includes `follow_text` |
| `ui.js` | Fourth button + help text; use `wb-option-row-four` |
| `docs/ARCHITECTURE.md` | One short note under 时间模型 (last task) |

---

### Task 0: Branch setup

**Files:** none (git only); ensure spec exists on branch

- [ ] **Step 1: Stash all WIP, branch from `origin/main`, restore only follow-text docs**

```bash
cd /home/hao/Luker/public/scripts/extensions/third-party/world-backstage
git fetch origin
# Stash ALL dirty tracked + untracked WIP (tag-filter code, specs, plans) — no pathspec.
git stash push -u -m "wip-tag-filter-before-follow-text"
git checkout -B feat/follow-text-time origin/main
# Restore only follow-text design + plan from the stash (leave tag-filter code stashed).
git checkout stash@{0} -- \
  docs/superpowers/specs/2026-08-02-follow-text-time-design.md \
  docs/superpowers/plans/2026-08-02-follow-text-time.md
```

Do **not** `git stash pop` the full stash onto this branch.

- [ ] **Step 2: Confirm clean tree except the follow-text docs**

```bash
git status -sb
test -f docs/superpowers/specs/2026-08-02-follow-text-time-design.md && echo SPEC_OK
test -f docs/superpowers/plans/2026-08-02-follow-text-time.md && echo PLAN_OK
git merge-base --is-ancestor origin/main HEAD && echo BASE_OK
```

Expected: on `feat/follow-text-time`, based on `origin/main`, only follow-text docs present/staged.

---

### Task 1: Calendar day math helpers (TDD)

**Files:**
- Create: `tests/follow-text-time.test.mjs`
- Modify: `core.js` (near `addCalendarDays` / after `formatWorldCalendar`)

- [ ] **Step 1: Write failing tests for day math**

Create `tests/follow-text-time.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInitialState,
    setWorldCalendar,
    formatWorldCalendar,
    applySimulationResult,
    addManualEvent,
    extractNarrativeClockCandidates,
    pickFollowTextClockTarget,
    calendarDateTimeToAbsoluteMinute,
    daysBetweenCalendarDates,
    MINUTES_PER_DAY,
} from '../core.js';

function calibratedState({
    year = 2033,
    month = 5,
    day = 21,
    hour = 20,
    minute = 15,
} = {}) {
    let state = createInitialState({ day: 10, hour, minute });
    state = setWorldCalendar(state, {
        calendarName: '主世界历',
        year,
        month,
        day,
        hour,
        minute,
    });
    return state;
}

test('daysBetweenCalendarDates 含闰年', () => {
    assert.equal(
        daysBetweenCalendarDates(
            { year: 2020, month: 2, day: 28 },
            { year: 2020, month: 3, day: 1 },
        ),
        2,
    );
});

test('calendarDateTimeToAbsoluteMinute 跳到更晚日期', () => {
    const state = calibratedState();
    const target = calendarDateTimeToAbsoluteMinute(state, {
        year: 2042, month: 3, day: 1, hour: 0, minute: 0,
    });
    assert.ok(target > state.clock.absoluteMinute);
    const jumped = { ...state, clock: { ...state.clock, absoluteMinute: target } };
    const stamp = formatWorldCalendar(jumped);
    assert.equal(stamp.year, 2042);
    assert.equal(stamp.month, 3);
    assert.equal(stamp.dayOfMonth, 1);
    assert.equal(stamp.time, '00:00');
});
```

- [ ] **Step 2: Run tests — expect FAIL (exports missing)**

```bash
node --test tests/follow-text-time.test.mjs
```

Expected: FAIL — `daysBetweenCalendarDates` / `calendarDateTimeToAbsoluteMinute` not exported.

- [ ] **Step 3: Implement helpers in `core.js`**

Export (place after `formatWorldCalendar`):

```js
export function daysBetweenCalendarDates(from, to) {
    const a = normalizeCalendarDate(from);
    const b = normalizeCalendarDate(to);
    const start = Date.UTC(a.year, a.month - 1, a.day);
    const end = Date.UTC(b.year, b.month - 1, b.day);
    return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

export function calendarDateTimeToAbsoluteMinute(state, {
    year, month, day, hour = 0, minute = 0,
} = {}) {
    const baseAbs = asInteger(state?.clock?.absoluteMinute, 0, 0);
    const current = formatWorldCalendar(state, baseAbs);
    const normalized = normalizeCalendarDate({ year, month, day }, {
        year: current.year,
        month: current.month,
        day: current.dayOfMonth,
    });
    const dayDelta = daysBetweenCalendarDates(
        { year: current.year, month: current.month, day: current.dayOfMonth },
        normalized,
    );
    const safeHour = asInteger(hour, 0, 0, 23);
    const safeMinute = asInteger(minute, 0, 0, 59);
    return (
        (Math.floor(baseAbs / MINUTES_PER_DAY) + dayDelta) * MINUTES_PER_DAY
        + safeHour * 60
        + safeMinute
    );
}
```

- [ ] **Step 4: Re-run — expect PASS for Task 1 tests**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add core.js tests/follow-text-time.test.mjs docs/superpowers/specs/2026-08-02-follow-text-time-design.md
git commit -m "$(cat <<'EOF'
feat: add calendar day math for follow-text time jumps

EOF
)"
```

---

### Task 2: `extractNarrativeClockCandidates` (TDD)

**Files:**
- Modify: `tests/follow-text-time.test.mjs`
- Modify: `core.js`

- [ ] **Step 1: Append failing candidate tests**

```js
test('解析 2042年春 为季节锚点 3/1，且不另产 year 候选', () => {
    const list = extractNarrativeClockCandidates('主世界历2042年春。九年过去');
    assert.ok(list.some(c => c.precision === 'season' && c.year === 2042 && c.month === 3 && c.day === 1));
    assert.equal(list.filter(c => c.precision === 'year' && c.year === 2042).length, 0);
});

test('时段换算：下午2点 / 上午12点 / 下午12点', () => {
    const afternoon = extractNarrativeClockCandidates('下午2点');
    assert.equal(afternoon[0].hour, 14);
    assert.equal(afternoon[0].precision, 'time_only');
    assert.equal(extractNarrativeClockCandidates('上午12点')[0].hour, 0);
    assert.equal(extractNarrativeClockCandidates('下午12点')[0].hour, 12);
});

test('完整日期时间与仅日期', () => {
    const dt = extractNarrativeClockCandidates('2033年5月22日 上午10:20');
    assert.ok(dt.some(c => c.year === 2033 && c.month === 5 && c.day === 22 && c.hour === 10 && c.minute === 20));
    const d = extractNarrativeClockCandidates('2040年1月5日');
    assert.ok(d.some(c => c.precision === 'date' && c.year === 2040 && c.month === 1 && c.day === 5 && c.hour === 0));
});

test('非法日夹紧到月末', () => {
    const list = extractNarrativeClockCandidates('2021年2月30日');
    assert.equal(list[0].day, 28);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 3: Implement `extractNarrativeClockCandidates` in `core.js`**

Requirements locked by spec:

- Season map: 春→3/1, 夏→6/1, 秋→9/1, 冬→12/1
- Year-only: `YYYY年` not followed by `月` or season char; no duplicate year when season matched overlapping span
- Period→hour table from spec
- Bare `H点` / `H:MM` 24h; H>23 discard
- Use `normalizeCalendarDate` for Y/M/D
- Each candidate: `{ year, month, day, hour, minute, precision, index, raw }`
- For `time_only`, leave `year/month/day` as `null` until pick (intentional deviation from spec “必填” wording); `pickFollowTextClockTarget` **must** fill from current calendar before calling `calendarDateTimeToAbsoluteMinute`. Candidate tests above only assert hour/precision for time_only.

Implementation sketch (engineer may refine regexes as long as tests pass):

```js
const SEASON_ANCHOR = { 春: [3, 1], 夏: [6, 1], 秋: [9, 1], 冬: [12, 1] };

function parseClockFragment(period, hourRaw, minuteRaw) {
    let hour = Number(hourRaw);
    const minute = minuteRaw === undefined || minuteRaw === '' ? 0 : Number(minuteRaw);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    const p = String(period || '');
    if (p === '上午' || p === '凌晨' || p === '清晨' || p === '早上') {
        if (hour === 12) hour = 0;
        else if (hour < 1 || hour > 11) return null;
    } else if (p === '下午') {
        if (hour === 12) hour = 12;
        else if (hour >= 1 && hour <= 11) hour += 12;
        else return null;
    } else if (p === '中午') {
        hour = 12;
    } else if (p === '傍晚' || p === '晚上' || p === '夜里') {
        if (hour < 12) hour += 12;
    } else {
        // bare 24h
        if (hour > 23 || hour < 0) return null;
    }
    return { hour, minute };
}

export function extractNarrativeClockCandidates(text) {
    const value = String(text || '');
    const found = [];
    const occupied = []; // [start, end) ranges claimed by higher-priority matches

    const claim = (start, end) => {
        if (occupied.some(([a, b]) => start < b && end > a)) return false;
        occupied.push([start, end]);
        return true;
    };

    // 1) YYYY年M月D日 + optional time
    const dateRe = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*(?:[:：点时]\s*(\d{1,2})(?:\s*分)?)?)?/g;
    for (const match of value.matchAll(dateRe)) {
        const index = match.index ?? 0;
        if (!claim(index, index + match[0].length)) continue;
        const date = normalizeCalendarDate({
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
        });
        let hour = 0;
        let minute = 0;
        let precision = 'date';
        if (match[5] !== undefined) {
            const parsed = parseClockFragment(match[4] || '', match[5], match[6]);
            if (!parsed) continue;
            hour = parsed.hour;
            minute = parsed.minute;
            precision = 'datetime';
        }
        found.push({ ...date, hour, minute, precision, index, raw: match[0] });
    }

    // 2) YYYY-MM-DD or YYYY/MM/DD + optional time
    const isoRe = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s*(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|(?:点|时)\s*(\d{1,2})?\s*分?)?)?/g;
    for (const match of value.matchAll(isoRe)) {
        const index = match.index ?? 0;
        if (!claim(index, index + match[0].length)) continue;
        const date = normalizeCalendarDate({
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
        });
        let hour = 0;
        let minute = 0;
        let precision = 'date';
        if (match[5] !== undefined) {
            const minutePart = match[6] !== undefined ? match[6] : match[7];
            const parsed = parseClockFragment(match[4] || '', match[5], minutePart);
            if (!parsed) continue;
            hour = parsed.hour;
            minute = parsed.minute;
            precision = 'datetime';
        }
        found.push({ ...date, hour, minute, precision, index, raw: match[0] });
    }

    // 3) YYYY年春|夏|秋|冬
    const seasonRe = /(\d{4})\s*年\s*([春夏秋冬])/g;
    for (const match of value.matchAll(seasonRe)) {
        const index = match.index ?? 0;
        if (!claim(index, index + match[0].length)) continue;
        const [month, day] = SEASON_ANCHOR[match[2]];
        const date = normalizeCalendarDate({ year: Number(match[1]), month, day });
        found.push({
            ...date, hour: 0, minute: 0, precision: 'season', index, raw: match[0],
        });
    }

    // 4) YYYY年 not followed by 月 or season
    const yearRe = /(\d{4})\s*年(?!\s*[月春夏秋冬])/g;
    for (const match of value.matchAll(yearRe)) {
        const index = match.index ?? 0;
        if (!claim(index, index + match[0].length)) continue;
        const date = normalizeCalendarDate({ year: Number(match[1]), month: 1, day: 1 });
        found.push({
            ...date, hour: 0, minute: 0, precision: 'year', index, raw: match[0],
        });
    }

    // 5) time_only: period? + H点 / H:MM
    const timeRe = /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*(?:[:：]\s*(\d{1,2})|(?:点|时)\s*(\d{1,2})?\s*分?)/g;
    for (const match of value.matchAll(timeRe)) {
        const index = match.index ?? 0;
        if (!claim(index, index + match[0].length)) continue;
        const minutePart = match[3] !== undefined ? match[3] : match[4];
        const parsed = parseClockFragment(match[1] || '', match[2], minutePart);
        if (!parsed) continue;
        found.push({
            year: null, month: null, day: null,
            hour: parsed.hour, minute: parsed.minute,
            precision: 'time_only', index, raw: match[0],
        });
    }

    return found.sort((a, b) => a.index - b.index);
}
```

Also support `YYYY-MM-DD` / `YYYY/MM/DD` in the same function (required by spec patterns #1). Keep tests green; add a tiny assertion if needed:

```js
test('解析 ISO 风格日期', () => {
    const list = extractNarrativeClockCandidates('场景切换到 2042-03-15 14:30');
    assert.ok(list.some(c => c.year === 2042 && c.month === 3 && c.day === 15 && c.hour === 14 && c.minute === 30));
});
```

- [ ] **Step 4: Re-run — expect PASS**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add core.js tests/follow-text-time.test.mjs
git commit -m "$(cat <<'EOF'
feat: parse absolute clock candidates from narrative text

EOF
)"
```

---

### Task 3: `pickFollowTextClockTarget` (TDD)

**Files:**
- Modify: `tests/follow-text-time.test.mjs`
- Modify: `core.js`

- [ ] **Step 1: Append failing pick tests**

```js
test('pick：world 有 2042年春，chat 无日历级 → source=world', () => {
    const state = calibratedState();
    const picked = pickFollowTextClockTarget({
        chatNarrative: '周日清早，露营地边的草叶还挂着水珠',
        worldCopy: '九年后：艺涵升入高中\n主世界历2042年春。九年过去',
    }, state);
    assert.equal(picked.source, 'world');
    assert.ok(picked.targetAbsoluteMinute > state.clock.absoluteMinute);
    const preview = formatWorldCalendar({
        ...state,
        clock: { ...state.clock, absoluteMinute: picked.targetAbsoluteMinute },
    });
    assert.equal(preview.year, 2042);
    assert.equal(preview.month, 3);
    assert.equal(preview.dayOfMonth, 1);
});

test('pick：chat 仅晚上8点不挡 world 跨年', () => {
    const state = calibratedState();
    const picked = pickFollowTextClockTarget({
        chatNarrative: '晚上8点，家里很安静。',
        worldCopy: '主世界历2042年春',
    }, state);
    assert.equal(picked.source, 'world');
    const preview = formatWorldCalendar({
        ...state,
        clock: { ...state.clock, absoluteMinute: picked.targetAbsoluteMinute },
    });
    assert.equal(preview.year, 2042);
});

test('pick：chat 日历级更晚优先于 world', () => {
    const state = calibratedState();
    const picked = pickFollowTextClockTarget({
        chatNarrative: '2035年6月1日',
        worldCopy: '主世界历2042年春',
    }, state);
    assert.equal(picked.source, 'chat');
    assert.equal(
        formatWorldCalendar({
            ...state,
            clock: { ...state.clock, absoluteMinute: picked.targetAbsoluteMinute },
        }).year,
        2035,
    );
});

test('pick：不回拨', () => {
    const state = calibratedState({ year: 2033, month: 5, day: 21, hour: 20, minute: 15 });
    const picked = pickFollowTextClockTarget({
        chatNarrative: '2030年1月1日',
        worldCopy: '',
    }, state);
    assert.equal(picked.targetAbsoluteMinute, null);
});

test('pick：time_only 同日更晚 / 更早或相等走次日', () => {
    const evening = calibratedState({ hour: 20, minute: 15 });
    const nextMorning = pickFollowTextClockTarget({
        chatNarrative: '上午 10:20',
        worldCopy: '',
    }, evening);
    assert.ok(nextMorning.targetAbsoluteMinute > evening.clock.absoluteMinute);
    assert.equal(
        formatWorldCalendar({
            ...evening,
            clock: { ...evening.clock, absoluteMinute: nextMorning.targetAbsoluteMinute },
        }).time,
        '10:20',
    );

    const morning = calibratedState({ hour: 8, minute: 0 });
    const sameDay = pickFollowTextClockTarget({
        chatNarrative: '上午 10:20',
        worldCopy: '',
    }, morning);
    assert.equal(
        formatWorldCalendar({
            ...morning,
            clock: { ...morning.clock, absoluteMinute: sameDay.targetAbsoluteMinute },
        }).dayOfMonth,
        formatWorldCalendar(morning).dayOfMonth,
    );

    const exact = calibratedState({ hour: 10, minute: 20 });
    const equalGoesNext = pickFollowTextClockTarget({
        chatNarrative: '上午 10:20',
        worldCopy: '',
    }, exact);
    assert.ok(equalGoesNext.targetAbsoluteMinute > exact.clock.absoluteMinute);
});

test('pick：dayDelta 超过 120*365 拒绝', () => {
    const state = calibratedState({ year: 2000, month: 1, day: 1 });
    const picked = pickFollowTextClockTarget({
        chatNarrative: '2500年1月1日',
        worldCopy: '',
    }, state);
    assert.equal(picked.targetAbsoluteMinute, null);
    assert.match(picked.reason, /120/);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 3: Implement `pickFollowTextClockTarget`**

```js
const CALENDAR_PRECISION = new Set(['datetime', 'date', 'season', 'year']);
const MAX_FOLLOW_DAY_DELTA = 120 * 365;

function candidateToAbsoluteMinute(candidate, state) {
    const current = formatWorldCalendar(state);
    const baseAbs = state.clock.absoluteMinute;
    if (candidate.precision === 'time_only') {
        let abs = calendarDateTimeToAbsoluteMinute(state, {
            year: current.year,
            month: current.month,
            day: current.dayOfMonth,
            hour: candidate.hour,
            minute: candidate.minute,
        });
        let dayDelta = 0;
        if (abs <= baseAbs) {
            abs += MINUTES_PER_DAY;
            dayDelta = 1;
        }
        return { abs, dayDelta };
    }
    const abs = calendarDateTimeToAbsoluteMinute(state, candidate);
    const dayDelta = daysBetweenCalendarDates(
        { year: current.year, month: current.month, day: current.dayOfMonth },
        { year: candidate.year, month: candidate.month, day: candidate.day },
    );
    return { abs, dayDelta };
}

function bestLaterCandidate(candidates, state, source) {
    const baseAbs = state.clock.absoluteMinute;
    let best = null;
    for (const candidate of candidates) {
        const { abs, dayDelta } = candidateToAbsoluteMinute(candidate, state);
        if (dayDelta > MAX_FOLLOW_DAY_DELTA) continue;
        if (abs <= baseAbs) continue;
        if (
            !best
            || abs > best.targetAbsoluteMinute
            || (abs === best.targetAbsoluteMinute && candidate.index > best.index)
        ) {
            best = {
                targetAbsoluteMinute: abs,
                matchedText: candidate.raw,
                source,
                index: candidate.index,
                reason: `跟随正文时间（${source}）：${candidate.raw}`,
            };
        }
    }
    return best;
}

export function pickFollowTextClockTarget({ chatNarrative = '', worldCopy = '' } = {}, baseState) {
    const chatAll = extractNarrativeClockCandidates(chatNarrative);
    const worldAll = extractNarrativeClockCandidates(worldCopy);

    const chatCalendar = chatAll.filter(c => CALENDAR_PRECISION.has(c.precision));
    const fromChatCal = bestLaterCandidate(chatCalendar, baseState, 'chat');
    if (fromChatCal) {
        return {
            targetAbsoluteMinute: fromChatCal.targetAbsoluteMinute,
            matchedText: fromChatCal.matchedText,
            source: 'chat',
            reason: fromChatCal.reason,
        };
    }

    const fromWorld = bestLaterCandidate(worldAll, baseState, 'world');
    if (fromWorld) {
        return {
            targetAbsoluteMinute: fromWorld.targetAbsoluteMinute,
            matchedText: fromWorld.matchedText,
            source: 'world',
            reason: fromWorld.reason,
        };
    }

    const chatTimeOnly = chatAll.filter(c => c.precision === 'time_only');
    const fromChatTime = bestLaterCandidate(chatTimeOnly, baseState, 'chat');
    if (fromChatTime) {
        return {
            targetAbsoluteMinute: fromChatTime.targetAbsoluteMinute,
            matchedText: fromChatTime.matchedText,
            source: 'chat',
            reason: fromChatTime.reason,
        };
    }

    // If any candidate existed but all rejected for span/rewind, prefer a specific reason
    const anyHuge = [...chatAll, ...worldAll].some((candidate) => {
        if (candidate.precision === 'time_only') return false;
        const current = formatWorldCalendar(baseState);
        const dayDelta = daysBetweenCalendarDates(
            { year: current.year, month: current.month, day: current.dayOfMonth },
            { year: candidate.year, month: candidate.month, day: candidate.day },
        );
        return dayDelta > MAX_FOLLOW_DAY_DELTA;
    });

    return {
        targetAbsoluteMinute: null,
        matchedText: '',
        source: null,
        reason: anyHuge
            ? '解析到的时间跨度超过 120 年，本轮保持世界时钟不动'
            : '正文未解析到更晚的绝对时间，本轮保持世界时钟不动',
    };
}
```

Fix `candidateToAbsoluteMinute` dayDelta for time_only if the sketch’s `formatWorldCalendar` trick is awkward — computing `dayDelta = abs <= baseAbs ? 1 : 0` for time_only span checks is enough (never hits 120y).

- [ ] **Step 4: Re-run — expect PASS**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add core.js tests/follow-text-time.test.mjs
git commit -m "$(cat <<'EOF'
feat: pick follow-text clock target from chat then world copy

EOF
)"
```

---

### Task 4: Wire `applySimulationResult` + prompt + `resolveElapsedMinutes`

**Files:**
- Modify: `core.js` (`resolveElapsedMinutes`, `applySimulationResult`, `buildSimulationPrompt` timeRule map)
- Modify: `tests/follow-text-time.test.mjs`

- [ ] **Step 1: Append apply integration tests**

```js
test('follow_text：elapsed_minutes=0 仍跟随 world 2042年春（截图回归）', () => {
    const base = calibratedState();
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        time_reason: '模型没填增量',
        world: {
            title: '九年后：艺涵升入高中',
            detail: '主世界历2042年春。九年过去，神木艺涵已升入高中。',
        },
    }, {
        timePolicy: 'follow_text',
        narrativeText: '周日清早，露营地边的草叶还挂着水珠',
    });
    const cal = formatWorldCalendar(result);
    assert.equal(cal.year, 2042);
    assert.equal(cal.month, 3);
    assert.equal(cal.dayOfMonth, 1);
    assert.match(result.clock.reason, /跟随正文|2042/);
});

test('follow_text：九年跳转让中间 due 的 duration 事件变 ready', () => {
    let base = calibratedState();
    base = addManualEvent(base, {
        id: 'exam',
        title: '升学考试',
        clock_mode: 'duration',
        duration_minutes: 60,
    });
    assert.equal(base.events[0].status, 'active');
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        world: { title: '九年后', detail: '主世界历2042年春' },
    }, {
        timePolicy: 'follow_text',
        narrativeText: '',
    });
    assert.equal(result.events[0].status, 'ready');
});

test('open 档不走正文绝对跳转', () => {
    const base = calibratedState();
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        world: { detail: '主世界历2042年春' },
    }, {
        timePolicy: 'open',
        narrativeText: '',
    });
    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute);
});

test('follow_text 与 open 一样不因无证据清零 worked_minutes', () => {
    let base = calibratedState();
    base = addManualEvent(base, {
        id: 'job',
        title: '打工',
        clock_mode: 'active',
        duration_minutes: 120,
    });
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        events_update: [{ id: 'job', worked_minutes: 30 }],
        world: { detail: '主世界历2042年春' },
    }, {
        timePolicy: 'follow_text',
        narrativeText: '没有明确几点',
    });
    assert.equal(result.events.find(e => e.id === 'job').accruedMinutes, 30);
});
```

- [ ] **Step 2: Run — expect FAIL on follow_text behaviors**

```bash
node --test tests/follow-text-time.test.mjs
```

- [ ] **Step 3: Patch `resolveElapsedMinutes`**

```js
export function resolveElapsedMinutes(rawMinutes, narrativeText, policy = 'explicit') {
    if (policy === 'follow_text') return 0;
    const minutes = asInteger(rawMinutes, 0, 0, 5 * 365 * MINUTES_PER_DAY);
    if (policy === 'open') return minutes;
    if (hasExplicitTimeEvidence(narrativeText)) return minutes;
    if (policy === 'cautious') return Math.min(minutes, 180);
    return 0;
}
```

- [ ] **Step 4: Patch `applySimulationResult` clock branch**

Replace the block that currently does `resolveElapsedMinutes` → `settleTimedEvents(base + elapsed)` with:

```js
const payload = normalizeSimulationResult(rawPayload);
const requestedElapsedMinutes = payload.elapsedMinutes;
const explicitTimeEvidence = hasExplicitTimeEvidence(narrativeText);

let state;
if (timePolicy === 'follow_text') {
    const picked = pickFollowTextClockTarget({
        chatNarrative: narrativeText,
        worldCopy: `${payload.world.title}\n${payload.world.detail}`,
    }, baseState);
    if (picked.targetAbsoluteMinute != null) {
        payload.elapsedMinutes = picked.targetAbsoluteMinute - baseState.clock.absoluteMinute;
        payload.timeReason = picked.reason;
        state = settleTimedEvents(baseState, picked.targetAbsoluteMinute, {
            source: 'narrative',
            reason: payload.timeReason,
        });
    } else {
        payload.elapsedMinutes = 0;
        payload.timeReason = picked.reason;
        state = settleTimedEvents(baseState, baseState.clock.absoluteMinute, {
            source: 'narrative',
            reason: payload.timeReason,
        });
    }
} else {
    payload.elapsedMinutes = resolveElapsedMinutes(
        requestedElapsedMinutes,
        narrativeText,
        timePolicy,
    );
    if (!explicitTimeEvidence && timePolicy !== 'open') {
        for (const update of payload.eventsUpdate) {
            const requestedWork = asInteger(
                update?.worked_minutes ?? update?.workedMinutes,
                0,
                0,
            );
            const guardedWork = timePolicy === 'cautious'
                ? Math.min(requestedWork, 180)
                : 0;
            update.worked_minutes = guardedWork;
            update.workedMinutes = guardedWork;
        }
    }
    if (requestedElapsedMinutes > 0 && payload.elapsedMinutes === 0) {
        payload.timeReason = '正文没有明确、可计算的时间证据，本轮保持世界时钟不动';
    } else if (payload.elapsedMinutes < requestedElapsedMinutes) {
        payload.timeReason = `正文时间较含糊，本轮最多推进 ${payload.elapsedMinutes} 分钟`;
    }
    state = settleTimedEvents(
        baseState,
        baseState.clock.absoluteMinute + payload.elapsedMinutes,
        { source: 'narrative', reason: payload.timeReason || '正文推演' },
    );
}

// worked_minutes gate for follow_text: treat like open → do nothing extra
// (follow_text branch must NOT enter the explicit/cautious worked_minutes zeroing)
```

Important: the existing `if (!explicitTimeEvidence && timePolicy !== 'open')` must become:

```js
if (!explicitTimeEvidence && timePolicy !== 'open' && timePolicy !== 'follow_text') {
```

when keeping a unified structure; if using the if/else above, keep worked_minutes zeroing **only** in the else branch.

- [ ] **Step 5: Patch `buildSimulationPrompt` timeRule map**

Find:

```js
const timeRule = {
    explicit: '...',
    cautious: '...',
    open: '...',
}[timePolicy] || '...';
```

Add:

```js
follow_text: '跟随正文时间：插件会忽略 elapsed_minutes，改为从本批正文与 world.title/detail 解析最晚的绝对历法时间并跳转时钟；时代跳跃时请在 world 文案写明如「主世界历2042年春」；不得把回复轮次当时间。',
```

- [ ] **Step 6: Re-run all related tests**

```bash
node --test tests/follow-text-time.test.mjs tests/core.test.mjs tests/v03-regressions.test.mjs
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core.js tests/follow-text-time.test.mjs
git commit -m "$(cat <<'EOF'
feat: apply follow_text policy by jumping clock from parsed absolute time

EOF
)"
```

---

### Task 5: Settings whitelist + UI

**Files:**
- Modify: `index.js` (~line 355 timePolicy whitelist)
- Modify: `ui.js` (~lines 683–690 时间推进 block)
- Modify: `tests/ux-polish.test.mjs` only if it asserts three time-policy labels

- [ ] **Step 1: Update whitelist in `index.js`**

```js
if (!['explicit', 'cautious', 'open', 'follow_text'].includes(settings.timePolicy)) {
    settings.timePolicy = 'explicit';
}
```

- [ ] **Step 2: Update UI in `ui.js`**

Replace the 时间推进 block with:

```js
            <div class="wb-setting-block">
                <label>时间推进</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('timePolicy', settings.timePolicy, 'explicit', '严格')}
                    ${settingButton('timePolicy', settings.timePolicy, 'cautious', '克制')}
                    ${settingButton('timePolicy', settings.timePolicy, 'open', '开放')}
                    ${settingButton('timePolicy', settings.timePolicy, 'follow_text', '跟随正文')}
                </div>
                <p>严格：无明确几点或时长则不动。克制：模糊最多三小时。开放：信模型增量。跟随正文：优先用本批聊天里的年月日/季节跳转；聊天没有这类锚点时再用推演世界文案；仅钟点不会挡住跨年文案。取更晚者，不回拨；解析不到则本轮不动。</p>
            </div>
```

- [ ] **Step 3: Grep UX tests for 三档假设**

```bash
rg -n "timePolicy|跟随正文|时间推进|严格" tests/ux-polish.test.mjs tests/*.mjs
```

If a test requires the three labels only, extend it to also require `跟随正文` / `follow_text`.

- [ ] **Step 4: Run tests**

```bash
node --test tests/follow-text-time.test.mjs tests/core.test.mjs tests/ux-polish.test.mjs tests/v03-regressions.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.js ui.js tests
git commit -m "$(cat <<'EOF'
feat: expose follow_text time policy in settings UI

EOF
)"
```

---

### Task 6: Docs note + final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (时间模型 section)
- Optional: `README.md` one line under 时间推进

- [ ] **Step 1: Add ARCHITECTURE note**

Under 时间模型, after the sentence about `elapsed_minutes`, add:

```markdown
第四档 `follow_text`（跟随正文）忽略模型增量，由插件从本批正文与 `world` 文案解析绝对时间并 `settleTimedEvents` 跳转；不回拨；仅钟点不会挡住世界文案中的跨年锚点。
```

- [ ] **Step 2: Full test suite for the extension**

```bash
node --test tests/*.mjs
```

Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md README.md
git commit -m "$(cat <<'EOF'
docs: note follow_text clock policy in architecture

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Fourth policy `follow_text` | 4, 5 |
| Ignore `elapsed_minutes` | 4 |
| Sources chat → world; time_only last | 3 |
| Latest later-only; no rewind | 3 |
| Season/year/datetime/time_only parse | 2 |
| Period→24h table | 2 |
| Year vs season exclusivity | 2 |
| Invalid day clamp | 2 |
| Absolute minute via calendar anchors | 1, 3 |
| 120y dayDelta reject | 3 |
| `settleTimedEvents` ready side effect | 4 |
| worked_minutes like open | 4 |
| Prompt rule | 4 |
| UI + whitelist | 5 |
| Screenshot regression test | 4 |
| Manual calendar remains | 5 (no hide) |

## Out of scope (do not implement)

- Luker metadata bar ingestion
- Relative phrases like `九年过去` without absolute anchor
- Independent toggle alongside 严格/克制/开放
- Falling back to open `elapsed_minutes` when parse fails
