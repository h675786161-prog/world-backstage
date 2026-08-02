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

function calendarAt(state, absoluteMinute) {
    return formatWorldCalendar({
        ...state,
        clock: { ...state.clock, absoluteMinute },
    });
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
    const stamp = calendarAt(state, target);
    assert.equal(stamp.year, 2042);
    assert.equal(stamp.month, 3);
    assert.equal(stamp.dayOfMonth, 1);
    assert.equal(stamp.time, '00:00');
});

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

test('解析 ISO 风格日期', () => {
    const list = extractNarrativeClockCandidates('场景切换到 2042-03-15 14:30');
    assert.ok(list.some(c => c.year === 2042 && c.month === 3 && c.day === 15 && c.hour === 14 && c.minute === 30));
});

test('pick：world 有 2042年春，chat 无日历级 → source=world', () => {
    const state = calibratedState();
    const picked = pickFollowTextClockTarget({
        chatNarrative: '周日清早，露营地边的草叶还挂着水珠',
        worldCopy: '九年后：艺涵升入高中\n主世界历2042年春。九年过去',
    }, state);
    assert.equal(picked.source, 'world');
    assert.ok(picked.targetAbsoluteMinute > state.clock.absoluteMinute);
    const preview = calendarAt(state, picked.targetAbsoluteMinute);
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
    assert.equal(calendarAt(state, picked.targetAbsoluteMinute).year, 2042);
});

test('pick：chat 日历级更晚优先于 world', () => {
    const state = calibratedState();
    const picked = pickFollowTextClockTarget({
        chatNarrative: '2035年6月1日',
        worldCopy: '主世界历2042年春',
    }, state);
    assert.equal(picked.source, 'chat');
    assert.equal(calendarAt(state, picked.targetAbsoluteMinute).year, 2035);
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
    assert.equal(calendarAt(evening, nextMorning.targetAbsoluteMinute).time, '10:20');

    const morning = calibratedState({ hour: 8, minute: 0 });
    const sameDay = pickFollowTextClockTarget({
        chatNarrative: '上午 10:20',
        worldCopy: '',
    }, morning);
    assert.equal(
        calendarAt(morning, sameDay.targetAbsoluteMinute).dayOfMonth,
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
