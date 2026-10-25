import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINUTES_PER_DAY,
    resolveNarrativeTimeTransition,
} from '../world-clock-authority.js';

const day = value => value * MINUTES_PER_DAY;

test('date precision may refine a hidden same-day minute from a trailing exact time block', () => {
    const base = day(3) + 9 * 60 + 17;
    const result = resolveNarrativeTimeTransition(
        '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        {
            currentAbsoluteMinute: base,
            currentCalendar: { year: 2138, month: 1, dayOfMonth: 17 },
            calendarBound: true,
            currentPrecision: 'date',
        },
    );

    assert.ok(result);
    assert.equal(result.kind, 'structured-clock-coarse-refinement');
    assert.equal(result.targetAbsoluteMinute, day(3) + 9 * 60);
    assert.equal(result.precision, 'minute');
});

test('known minute precision still refuses an older clock', () => {
    const result = resolveNarrativeTimeTransition(
        '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        {
            currentAbsoluteMinute: day(3) + 9 * 60 + 17,
            currentCalendar: { year: 2138, month: 1, dayOfMonth: 17 },
            calendarBound: true,
            currentPrecision: 'minute',
        },
    );
    assert.equal(result, null);
});

test('opening time header never rewinds a coarse clock when narrative continues after it', () => {
    const result = resolveNarrativeTimeTransition(
        '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>\n她吃完早餐，又步行去了街角。',
        {
            currentAbsoluteMinute: day(3) + 9 * 60 + 17,
            currentCalendar: { year: 2138, month: 1, dayOfMonth: 17 },
            calendarBound: true,
            currentPrecision: 'date',
        },
    );
    assert.equal(result, null);
});

test('ui hotfix keeps factual daypart beside estimated progress', async () => {
    const mobileClock = {
        textContent: '+约 25 分钟',
        dataset: {},
        getAttribute(name) {
            return name === 'aria-label'
                ? '故事第 3 日 · 上午 · 本轮按行动估算推进约 25 分钟'
                : '';
        },
    };
    const desktopClock = { textContent: '+约 25 分钟', dataset: {} };
    const root = {
        querySelector(selector) {
            if (selector === '.wb-mobile-clock-time') return mobileClock;
            if (selector === '.wb-world-calendar em') return desktopClock;
            return null;
        },
        querySelectorAll() { return []; },
    };

    const oldGlobals = {
        document: globalThis.document,
        window: globalThis.window,
        MutationObserver: globalThis.MutationObserver,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        Element: globalThis.Element,
    };
    class FakeMutationObserver {
        observe() {}
        disconnect() {}
    }
    class FakeElement {}
    globalThis.document = {
        getElementById: id => id === 'world-backstage-root' ? root : null,
        addEventListener() {},
        removeEventListener() {},
    };
    globalThis.window = { addEventListener() {} };
    globalThis.MutationObserver = FakeMutationObserver;
    globalThis.Element = FakeElement;
    globalThis.requestAnimationFrame = callback => {
        callback();
        return 1;
    };

    try {
        await import(`../ui-hotfix.js?clock-hotfix-test=${Date.now()}`);
        assert.equal(mobileClock.textContent, '上午 · +约 25 分钟');
        assert.equal(desktopClock.textContent, '上午 · +约 25 分钟');
        assert.equal(mobileClock.dataset.wbEstimatedDaypartFixed, 'true');
    } finally {
        globalThis.document = oldGlobals.document;
        globalThis.window = oldGlobals.window;
        globalThis.MutationObserver = oldGlobals.MutationObserver;
        globalThis.requestAnimationFrame = oldGlobals.requestAnimationFrame;
        globalThis.Element = oldGlobals.Element;
    }
});
