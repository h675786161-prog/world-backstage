import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINUTES_PER_DAY,
    resolveNarrativeTimeTransition,
} from '../world-clock-authority.js';

const day = value => value * MINUTES_PER_DAY;

test('lab time: bare half-hour narrative jump advances exactly 30 minutes', () => {
    const base = day(2) + 9 * 60 + 15;
    const result = resolveNarrativeTimeTransition('她把门重新锁好。\n半小时后，她听见楼上传来脚步声。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, base + 30);
    assert.equal(result.precision, 'minute');
});

test('lab time: bare two-hour narrative jump advances without requiring “过了”', () => {
    const base = day(2) + 10 * 60;
    const result = resolveNarrativeTimeTransition('窗外的雨一直没停。\n两小时后，她终于合上书。', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, base + 120);
});

test('lab time: next-day “一早” is normalized to morning daypart', () => {
    const base = day(5) + 23 * 60;
    const result = resolveNarrativeTimeTransition('第二天一早，她就被门铃吵醒。', {
        currentAbsoluteMinute: base,
        currentCalendar: { year: 2138, month: 5, dayOfMonth: 6 },
        calendarBound: true,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(6) + 7 * 60);
    assert.equal(result.precision, 'daypart');
    assert.equal(result.daypart, '早晨');
});

test('lab time: same-day evening scene transition moves forward but does not invent minutes', () => {
    const base = day(8) + 10 * 60;
    const result = resolveNarrativeTimeTransition('当天晚上，她才重新回到公寓。', {
        currentAbsoluteMinute: base,
        currentCalendar: { year: 2138, month: 8, dayOfMonth: 9 },
        calendarBound: true,
        currentPrecision: 'minute',
    });
    assert.ok(result);
    assert.equal(result.targetAbsoluteMinute, day(8) + 20 * 60);
    assert.equal(result.precision, 'daypart');
    assert.equal(result.daypart, '晚上');
});

test('lab time: future dialogue promise still does not advance the scene', () => {
    const base = day(8) + 10 * 60;
    const result = resolveNarrativeTimeTransition('她说：“两小时后见。”', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.equal(result, null);
});

test('lab time: same-day planning phrase does not masquerade as an elapsed transition', () => {
    const base = day(8) + 10 * 60;
    const result = resolveNarrativeTimeTransition('她看了眼日历：“当天晚上再联系。”', {
        currentAbsoluteMinute: base,
        calendarBound: false,
        currentPrecision: 'minute',
    });
    assert.equal(result, null);
});
