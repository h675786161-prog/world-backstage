import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINUTES_PER_DAY,
    buildClockAuthorityLines,
    normalizeClueTiming,
    resolveFutureTimeExpression,
    resolveNarrativeTimeTransition,
} from '../world-clock-authority.js';

const day = value => value * MINUTES_PER_DAY;

test('future promise does not advance current scene clock', () => {
    const result = resolveNarrativeTimeTransition('她挥了挥手：“明天见。”', {
        currentAbsoluteMinute: day(3) + 12 * 60,
        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },
        calendarBound: true,
    });
    assert.equal(result, null);
});

test('explicit next-day scene transition advances one day and preserves daypart precision', () => {
    const base = day(3) + 22 * 60;
    const result = resolveNarrativeTimeTransition('夜色沉下去。\n第二天清晨，她被敲门声叫醒。', {
        currentAbsoluteMinute: base,
        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },
        calendarBound: true,
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(4) + 6 * 60);
    assert.equal(result.precision, 'daypart');
    assert.equal(result.daypart, '清晨');
});

test('unbound structured exact clock may calibrate same relative story day', () => {
    const result = resolveNarrativeTimeTransition('<details><summary>时间与地点</summary>21:50 · 老城区</details>', {
        currentAbsoluteMinute: day(1) + 8 * 60,
        currentCalendar: { year: 1, month: 1, dayOfMonth: 2 },
        calendarBound: false,
        narrativeAnchor: {
            hour: 21,
            minute: 50,
            daypart: '晚上',
            structured: true,
            excerpt: '21:50 · 晚上',
        },
    });
    assert.ok(result);
    assert.equal(result.replaceCurrent, true);
    assert.equal(result.targetAbsoluteMinute, day(1) + 21 * 60 + 50);
    assert.equal(result.precision, 'minute');
});

test('clue relative day stays anchored to its creation day without inventing a clock time', () => {
    const base = day(10) + 9 * 60;
    const timing = resolveFutureTimeExpression('她约好后天去医院复诊。', {
        baseAbsoluteMinute: base,
        baseCalendar: { year: 2138, month: 8, dayOfMonth: 12 },
        calendarBound: true,
    });
    assert.ok(timing);
    assert.equal(timing.targetWorldMinute, day(12));
    assert.equal(timing.anchoredAtWorldMinute, base);
    assert.equal(timing.precision, 'date');
    assert.deepEqual(timing.targetDate, { year: 2138, month: 8, day: 14 });
    assert.equal(timing.relativeLabel, '后天');

    const tomorrow = normalizeClueTiming(timing, day(11) + 9 * 60);
    assert.equal(tomorrow.targetWorldMinute, timing.targetWorldMinute);
    assert.equal(tomorrow.relativeLabel, '明天');
});

test('weekday expression is deterministic only after calendar binding', () => {
    const base = day(10) + 9 * 60;
    const unbound = resolveFutureTimeExpression('下周六一起吃饭。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    assert.ok(unbound);
    assert.equal(unbound.kind, 'condition');
    assert.equal(unbound.targetWorldMinute, null);

    const bound = resolveFutureTimeExpression('下周六一起吃饭。', {
        baseAbsoluteMinute: base,
        baseCalendar: { year: 2026, month: 8, dayOfMonth: 12 },
        calendarBound: true,
    });
    assert.ok(bound);
    assert.notEqual(bound.targetWorldMinute, null);
    assert.equal(bound.targetDate?.year, 2026);
});

test('unbound clock injection exposes relative story time, never placeholder calendar', () => {
    const state = {
        world: { name: '主世界' },
        clock: {
            absoluteMinute: day(4) + 15 * 60,
            anchored: false,
            precision: 'daypart',
            daypart: '下午',
        },
    };
    const lines = buildClockAuthorityLines(state, {
        stamp: '主世界历 1年1月5日 15:00',
        year: 1,
        month: 1,
        dayOfMonth: 5,
        time: '15:00',
        date: '1年1月5日',
    }, 'full');
    const text = lines.join('\n');
    assert.match(text, /故事第 4 日/);
    assert.match(text, /下午/);
    assert.doesNotMatch(text, /1年1月5日/);
});

test('anchored daypart precision does not pretend an exact minute is authoritative', () => {
    const state = {
        world: { name: '主世界' },
        clock: {
            absoluteMinute: day(4) + 15 * 60,
            anchored: true,
            precision: 'daypart',
            daypart: '下午',
        },
    };
    const lines = buildClockAuthorityLines(state, {
        stamp: '主世界历 2138年1月5日 15:00',
        year: 2138,
        month: 1,
        dayOfMonth: 5,
        time: '15:00',
        date: '2138年1月5日',
    }, 'full');
    const text = lines.join('\n');
    assert.match(text, /2138年1月5日 · 下午/);
    assert.match(text, /具体钟点未确定/);
    assert.doesNotMatch(text, /time=15:00/);
});


test('stale unbound structured clock never rewinds authoritative time', () => {
    const base = day(2) + 21 * 60;
    const result = resolveNarrativeTimeTransition('<details><summary>时间与地点</summary>10:00 · 客厅</details>', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
        narrativeAnchor: { hour: 10, minute: 0, structured: true, excerpt: '10:00 · 客厅' },
    });
    assert.equal(result, null);
});

test('sequential elapsed transitions accumulate instead of keeping only the last one', () => {
    const base = day(2) + 9 * 60;
    const result = resolveNarrativeTimeTransition('过了2小时，她吃完饭。\n又过了30分钟，她出了门。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, base + 150);
    assert.equal(result.precision, 'minute');
    assert.equal(result.evidenceCount, 2);
});


test('whole-day transition drops stale minute precision instead of inventing a clock time', () => {
    const base = day(3) + 9 * 60 + 17;
    const result = resolveNarrativeTimeTransition('第二天，她去了学校。', {
        currentAbsoluteMinute: base,
        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },
        calendarBound: true,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    // The minute coordinate is retained internally for deterministic arithmetic,
    // but it is no longer an asserted fact after a coarse whole-day jump.
    assert.equal(result.targetAbsoluteMinute, day(4) + 9 * 60 + 17);
    assert.equal(result.precision, 'date');
    assert.equal(result.daypart, '');
});

test('unbound whole-day transition falls back to story-day precision', () => {
    const base = day(3) + 9 * 60 + 17;
    const result = resolveNarrativeTimeTransition('隔天，她才重新出门。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(4) + 9 * 60 + 17);
    assert.equal(result.precision, 'day');
    assert.equal(result.daypart, '');
});

test('explicit daypart on a whole-day transition replaces stale minute precision', () => {
    const base = day(3) + 9 * 60 + 17;
    const result = resolveNarrativeTimeTransition('第二天下午，她去了学校。', {
        currentAbsoluteMinute: base,
        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },
        calendarBound: true,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(4) + 15 * 60);
    assert.equal(result.precision, 'daypart');
    assert.equal(result.daypart, '下午');
});


test('date-only future clue uses target-day threshold without inventing creation clock', () => {
    const base = day(10) + 15 * 60 + 17;
    const timing = resolveFutureTimeExpression('明天复诊。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    assert.ok(timing);
    assert.equal(timing.precision, 'date');
    assert.equal(timing.targetWorldMinute, day(11));
});

test('relative words with built-in dayparts keep that factual daypart', () => {
    const base = day(10) + 15 * 60 + 17;
    const morning = resolveFutureTimeExpression('明早去复诊。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    const evening = resolveFutureTimeExpression('明晚再联系。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    assert.ok(morning);
    assert.equal(morning.precision, 'daypart');
    assert.equal(morning.daypart, '早晨');
    assert.equal(morning.targetWorldMinute, day(11) + 7 * 60);
    assert.ok(evening);
    assert.equal(evening.precision, 'daypart');
    assert.equal(evening.daypart, '晚上');
    assert.equal(evening.targetWorldMinute, day(11) + 20 * 60);
});

test('future clue does not steal an unrelated clock from another sentence', () => {
    const base = day(10) + 15 * 60 + 17;
    const timing = resolveFutureTimeExpression('明天复诊。今天09:00出的报告记得带上。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    assert.ok(timing);
    assert.equal(timing.precision, 'date');
    assert.equal(timing.targetWorldMinute, day(11));
    assert.equal(timing.daypart, '');
});
