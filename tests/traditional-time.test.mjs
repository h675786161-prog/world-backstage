import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTraditionalTime, parseTraditionalClock } from '../traditional-time.js';
import {
    MINUTES_PER_DAY,
    resolveFutureTimeExpression,
    resolveNarrativeTimeTransition,
} from '../world-clock-authority.js';

const day = value => value * MINUTES_PER_DAY;

test('traditional time: parses 卯时三刻 as 05:45', () => {
    const parsed = parseTraditionalClock('更漏报到卯时三刻。');
    assert.ok(parsed);
    assert.equal(parsed.branch, '卯');
    assert.equal(parsed.hour, 5);
    assert.equal(parsed.minute, 45);
    assert.equal(parsed.precision, 'minute');
});

test('traditional time: 初 and 正 use start and midpoint of a shichen', () => {
    assert.equal(parseTraditionalClock('卯初')?.minuteOfDay, 5 * 60);
    assert.equal(parseTraditionalClock('卯正')?.minuteOfDay, 6 * 60);
    assert.equal(formatTraditionalTime(5 * 60), '卯初');
    assert.equal(formatTraditionalTime(5 * 60 + 45), '卯时三刻');
    assert.equal(formatTraditionalTime(6 * 60), '卯正');
});

test('traditional time: phased quarters stay inside their half-shichen', () => {
    assert.equal(parseTraditionalClock('卯初三刻')?.minuteOfDay, 5 * 60 + 45);
    assert.equal(parseTraditionalClock('卯正三刻')?.minuteOfDay, 6 * 60 + 45);
    assert.equal(parseTraditionalClock('卯初四刻'), null);
    assert.equal(parseTraditionalClock('卯正七刻'), null);
    assert.equal(parseTraditionalClock('卯时七刻')?.minuteOfDay, 6 * 60 + 45);
});

test('traditional time: 子正 crosses civil midnight without losing its shichen identity', () => {
    const parsed = parseTraditionalClock('子正三刻');
    assert.ok(parsed);
    assert.equal(parsed.minuteOfDay, 45);
    assert.equal(parsed.hour, 0);
    assert.equal(parsed.minute, 45);
    assert.equal(parsed.crossesMidnight, true);
    assert.equal(formatTraditionalTime(45), '子正三刻');
});

test('traditional time: bare shichen stays daypart precision', () => {
    const parsed = parseTraditionalClock('卯时');
    assert.ok(parsed);
    assert.equal(parsed.precision, 'daypart');
    assert.equal(parsed.minuteOfDay, 5 * 60);
});

test('traditional time: structured 卯时三刻 settles to exact world minute', () => {
    const base = day(3) + 5 * 60 + 10;
    const result = resolveNarrativeTimeTransition('<time_format>时间：卯时三刻</time_format>', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(3) + 5 * 60 + 45);
    assert.equal(result.precision, 'minute');
    assert.equal(result.daypart, '卯时');
});

test('traditional time: structured bare 卯时 does not invent a quarter', () => {
    const base = day(3) + 4 * 60;
    const result = resolveNarrativeTimeTransition('时间：卯时', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'day',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(3) + 5 * 60);
    assert.equal(result.precision, 'daypart');
    assert.equal(result.daypart, '卯时');
});

test('traditional time: narrative arrival at 卯时三刻 advances same day', () => {
    const base = day(4) + 5 * 60 + 5;
    const result = resolveNarrativeTimeTransition('夜色渐退。到了卯时三刻，她推门出去。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(4) + 5 * 60 + 45);
    assert.equal(result.precision, 'minute');
});

test('traditional time: 明日卯时三刻 is a schedulable future clue', () => {
    const base = day(8) + 10 * 60;
    const result = resolveFutureTimeExpression('明日卯时三刻见。', {
        baseAbsoluteMinute: base,
        calendarBound: false,
    });
    assert.ok(result);
    assert.equal(result.targetWorldMinute, day(9) + 5 * 60 + 45);
    assert.equal(result.precision, 'minute');
    assert.equal(result.daypart, '卯时');
});

test('traditional time: a bare dialogue promise does not advance the scene', () => {
    const base = day(8) + 10 * 60;
    const result = resolveNarrativeTimeTransition('她说：“卯时三刻见。”', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.equal(result, null);
});

test('traditional time: a same-day planning phrase is still only a plan', () => {
    const base = day(8) + 10 * 60;
    const result = resolveNarrativeTimeTransition('她看了眼日历：“当天酉时再联系。”', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.equal(result, null);
});

test('traditional time: late 子正 arrival crosses civil midnight exactly once', () => {
    const base = day(12) + 23 * 60 + 40;
    const result = resolveNarrativeTimeTransition('夜已深。到了子正一刻，她推门出去。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(13) + 15);
});

test('traditional time: 子正 after civil midnight stays on the current civil day', () => {
    const base = day(13) + 5;
    const result = resolveNarrativeTimeTransition('到了子正一刻，她推门出去。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(13) + 15);
});

test('traditional time: structured 子正 crosses midnight from a late-night base', () => {
    const base = day(20) + 23 * 60 + 40;
    const result = resolveNarrativeTimeTransition('<time_format>时间：子正一刻</time_format>', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(21) + 15);
    assert.equal(result.precision, 'minute');
});

test('traditional time: a same-day 子正 planning phrase still does not move the scene', () => {
    const base = day(20) + 23 * 60 + 40;
    const result = resolveNarrativeTimeTransition('她看了眼更漏：“当天子正一刻再联系。”', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.equal(result, null);
});
