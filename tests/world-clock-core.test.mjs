import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySimulationResult,
    formatWorldClockFactLabel,
    compactStateForModel,
    buildInjectionPackage,
    createInitialState,
    formatWorldCalendar,
    setWorldCalendar,
    trimState,
} from '../core.js';

function minimalPayload(overrides = {}) {
    return {
        elapsed_minutes: 0,
        time_reason: '',
        clock_anchor: { mode: 'none' },
        world: {},
        people_upsert: [],
        people_remove: [],
        events_create: [],
        events_update: [],
        deliveries_confirmed: [],
        front_facts: [],
        world_facts_upsert: [],
        world_pulse_upsert: [],
        consistency_conflicts: [],
        memory_update: {
            turn_summaries: [],
            facts_upsert: [],
            facts_invalidate: [],
            clues_upsert: [],
            clues_resolve: [],
        },
        ...overrides,
    };
}

test('unbound world clock advances from elapsed duration and ignores model absolute anchor', () => {
    const initial = createInitialState();
    const before = initial.clock.absoluteMinute;
    const state = applySimulationResult(initial, minimalPayload({
        elapsed_minutes: 60,
        clock_anchor: {
            mode: 'initialize',
            year: 9999,
            month: 12,
            day: 31,
            hour: 23,
            minute: 59,
            precision: 'minute',
            confidence: 'high',
        },
    }), {
        messageId: 1,
        sourceKey: 'test:relative',
        timePolicy: 'world',
        narrativeText: '她吃完饭，又整理了一个小时资料。',
    });

    assert.equal(state.clock.anchored, false);
    assert.equal(state.clock.absoluteMinute, before + 60);
    assert.equal(state.clock.precision, 'day');
    assert.notEqual(formatWorldCalendar(state).year, 9999);
});

function anchoredMorning() {
    return setWorldCalendar(createInitialState(), {
        calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 0,
    });
}

test('repeated opening date does not discard elapsed work or downgrade known precision', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload({ elapsed_minutes: 20 }), {
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 · 港区</details>\n她吃完饭，收拾好了桌子。',
    });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute + 20);
    assert.equal(state.clock.precision, 'minute');
});

test('repeated opening clock does not swallow a subsequent deterministic duration', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload({ elapsed_minutes: 30 }), {
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>\n半小时后，她听见了敲门声。',
    });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute + 30);
    assert.equal(state.lastTimeResolution.method, 'deterministic-transition');
});

test('repeated opening clock allows estimated elapsed actions exactly once across turns', () => {
    let state = anchoredMorning();
    const before = state.clock.absoluteMinute;
    for (let i = 0; i < 3; i++) {
        const time = formatWorldCalendar(state).time;
        state = applySimulationResult(state, minimalPayload({ elapsed_minutes: 10 }), {
            timePolicy: 'world', messageId: i + 1, sourceKey: `clock-turn:${i}`,
            narrativeText: `<details><summary>时间与地点</summary>2138年1月17日 ${time} · 港区</details>\n她整理好资料，又倒了一杯茶。`,
        });
    }
    assert.equal(state.clock.absoluteMinute, before + 30);
});

test('repeated date header cannot override a subsequent next-day scene transition', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload(), {
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 · 港区</details>\n第二天清晨，她出了门。',
    });
    assert.equal(formatWorldCalendar(state).dayOfMonth, 18);
    assert.equal(state.clock.daypart, '清晨');
});

test('later explicit end clock still overrides model elapsed instead of double counting', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload({ elapsed_minutes: 30 }), {
        timePolicy: 'world',
        narrativeText: '她整理完资料。\n<details><summary>时间与地点</summary>2138年1月17日 09:30 · 港区</details>',
    });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute + 30);
    assert.equal(state.lastTimeResolution.method, 'deterministic-anchor');
});

test('repeated same-day period does not freeze elapsed work or invent exact clock precision', () => {
    const base = anchoredMorning();
    base.clock.precision = 'daypart';
    base.clock.daypart = '上午';
    const state = applySimulationResult(base, minimalPayload({ elapsed_minutes: 10 }), {
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 · 上午 · 港区</details>\n她整理好了一叠资料。',
    });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute + 10);
    assert.equal(state.clock.precision, 'daypart');
});

test('repeated clock with no elapsed action does not invent progress', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload(), {
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>\n她点了点头。',
    });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute);
    assert.equal(state.clock.precision, 'minute');
});

test('API action-duration estimate advances time even when legacy elapsed field is zero', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload({
        time_resolution: {
            evidence_found: false, authority: 'estimated_elapsed', scope: 'current',
            needs_elapsed_estimate: true, estimated_minutes: 25, confidence: 'medium',
            reason: '按吃完早餐、收拾餐具和步行到街角的行动估算。',
        },
    }), {
        timePolicy: 'world',
        narrativeText: '她吃完早餐，洗好餐具，然后步行到了街角。',
    });
    assert.equal(formatWorldCalendar(state).time, '09:25');
    assert.equal(state.lastTimeResolution.method, 'model-elapsed');
    assert.equal(state.lastTimeResolution.requestedElapsedMinutes, 25);
    assert.match(state.lastTimeResolution.reason, /早餐/);
});

test('API elapsed estimate respects strict-time setting without explicit narrative evidence', () => {
    const base = anchoredMorning();
    const state = applySimulationResult(base, minimalPayload({
        time_resolution: {
            authority: 'estimated_elapsed', scope: 'current', needs_elapsed_estimate: true,
            estimated_minutes: 25, confidence: 'medium',
        },
    }), { timePolicy: 'explicit', narrativeText: '她吃完早餐，洗好餐具，然后步行到了街角。' });
    assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute);
});

test('API duration supplied in both formats is applied once and missing legacy field is supported', () => {
    const base = anchoredMorning();
    const time_resolution = {
        authority: 'estimated_elapsed', scope: 'current', needs_elapsed_estimate: true,
        estimated_minutes: 25, confidence: 'medium',
    };
    for (const payload of [{ time_resolution }, { time_resolution, elapsed_minutes: 25 }]) {
        const state = applySimulationResult(base, payload, {
            timePolicy: 'world', narrativeText: '她吃完早餐，洗好餐具，然后步行到了街角。',
        });
        assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute + 25);
    }
});

test('future or recalled duration estimates cannot move the current scene clock', () => {
    const base = anchoredMorning();
    for (const scope of ['future', 'memory', 'reported']) {
        const state = applySimulationResult(base, minimalPayload({
            time_resolution: {
                authority: 'estimated_elapsed', scope, needs_elapsed_estimate: true,
                estimated_minutes: 120, confidence: 'high',
            },
        }), { timePolicy: 'world', narrativeText: '她想起了过去的旅途，又计划下一次出行。此刻仍在原地。' });
        assert.equal(state.clock.absoluteMinute, base.clock.absoluteMinute, scope);
    }
});

test('reliable foreground calendar date binds existing relative story day', () => {
    const initial = createInitialState();
    const advanced = applySimulationResult(initial, minimalPayload({ elapsed_minutes: 3 * 24 * 60 }), {
        messageId: 1,
        sourceKey: 'test:advance',
        timePolicy: 'world',
        narrativeText: '三天的旅程终于结束。',
    });
    const relativeDay = Math.floor(advanced.clock.absoluteMinute / (24 * 60));

    const bound = applySimulationResult(advanced, minimalPayload(), {
        messageId: 2,
        sourceKey: 'test:bind',
        timePolicy: 'world',
        narrativeText: '<details><summary>时间与地点</summary>2138年1月17日 · 下午 · 港区</details>',
    });

    const clock = formatWorldCalendar(bound);
    assert.equal(bound.clock.anchored, true);
    assert.equal(clock.year, 2138);
    assert.equal(clock.month, 1);
    assert.equal(clock.dayOfMonth, 17);
    assert.equal(Math.floor(bound.clock.absoluteMinute / (24 * 60)), relativeDay);
    assert.equal(bound.clock.precision, 'daypart');
});

test('explicit next-day transition advances deterministically without model elapsed', () => {
    let state = createInitialState();
    const beforeDay = Math.floor(state.clock.absoluteMinute / (24 * 60));
    state = applySimulationResult(state, minimalPayload({ elapsed_minutes: 0 }), {
        messageId: 1,
        sourceKey: 'test:next-day',
        timePolicy: 'world',
        narrativeText: '夜里众人散去。\n第二天清晨，她被鸟鸣吵醒。',
    });
    assert.equal(Math.floor(state.clock.absoluteMinute / (24 * 60)), beforeDay + 1);
    assert.equal(state.clock.precision, 'daypart');
    assert.equal(state.clock.daypart, '清晨');
});

test('unbound injection treats relative world clock as authority', () => {
    const state = createInitialState();
    const pkg = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: true,
        injectionWorldBackground: false,
        injectionPeople: false,
        injectionEvents: false,
        injectionEchoes: false,
        injectionFacts: false,
        memorySystemEnabled: false,
        memoryPromptInjection: false,
        injectionMemory: false,
        injectionTimeMode: 'full',
    }, '');
    assert.match(pkg.authorityText, /权威主世界相对时间/);
    assert.match(pkg.authorityText, /故事第 1 日/);
    assert.doesNotMatch(pkg.authorityText, /尚未完成故事时间锚点校准/);
});

test('clue future phrase receives structured timing without rewriting original text', () => {
    const initial = createInitialState();
    const clueText = '她答应后天带检查报告来复诊。';
    const state = applySimulationResult(initial, minimalPayload({
        memory_update: {
            turn_summaries: [],
            facts_upsert: [],
            facts_invalidate: [],
            clues_upsert: [{
                id: 'clue_followup',
                title: '复诊约定',
                text: clueText,
                source_excerpt: '后天带检查报告来复诊',
                status: 'open',
            }],
            clues_resolve: [],
        },
    }), {
        messageId: 1,
        sourceKey: 'test:clue',
        timePolicy: 'world',
        narrativeText: '她点头答应了。',
    });

    const clue = state.storyMemory.clues.find(item => item.id === 'clue_followup');
    assert.ok(clue);
    assert.equal(clue.text, clueText);
    assert.ok(clue.timing);
    assert.equal(clue.timing.relativeLabel, '后天');
    assert.equal(clue.timing.precision, 'date');
    assert.equal(
        Math.floor(clue.timing.targetWorldMinute / (24 * 60)),
        Math.floor(clue.timing.anchoredAtWorldMinute / (24 * 60)) + 2,
    );
    assert.equal(clue.timing.targetWorldMinute % (24 * 60), 0);
});

test('trimState preserves clock precision/daypart and clue timing metadata', () => {
    const state = createInitialState();
    state.clock.precision = 'daypart';
    state.clock.daypart = '傍晚';
    state.storyMemory.clues.push({
        id: 'clue_keep_timing',
        title: '测试',
        text: '明天见',
        status: 'open',
        timing: {
            kind: 'relative',
            sourceText: '明天',
            targetWorldMinute: state.clock.absoluteMinute + 24 * 60,
            targetDate: null,
            precision: 'date',
            anchoredAtWorldMinute: state.clock.absoluteMinute,
        },
    });
    const trimmed = trimState(state);
    assert.equal(trimmed.clock.precision, 'daypart');
    assert.equal(trimmed.clock.daypart, '傍晚');
    assert.equal(trimmed.storyMemory.clues[0].timing?.targetWorldMinute, state.clock.absoluteMinute + 24 * 60);
});


test('known minute precision survives cumulative elapsed transitions', () => {
    let state = createInitialState();
    state.clock.absoluteMinute = 24 * 60 + 9 * 60;
    state.clock.lastCheckedAt = state.clock.absoluteMinute;
    state.clock.precision = 'minute';
    state.clock.daypart = '';
    const before = state.clock.absoluteMinute;

    state = applySimulationResult(state, minimalPayload(), {
        messageId: 88,
        sourceKey: 'test:cumulative-elapsed',
        timePolicy: 'world',
        narrativeText: '过了2小时，她吃完饭。\n又过了30分钟，她出了门。',
    });

    assert.equal(state.clock.absoluteMinute, before + 150);
    assert.equal(state.clock.precision, 'minute');
});


test('core does not propagate stale minute precision across a coarse next-day jump', () => {
    let state = createInitialState();
    state.clock.absoluteMinute = 3 * 24 * 60 + 9 * 60 + 17;
    state.clock.lastCheckedAt = state.clock.absoluteMinute;
    state.clock.anchored = true;
    state.clock.precision = 'minute';
    state.clock.daypart = '';
    const before = state.clock.absoluteMinute;

    state = applySimulationResult(state, minimalPayload(), {
        messageId: 89,
        sourceKey: 'test:coarse-next-day',
        timePolicy: 'world',
        narrativeText: '第二天，她去了学校。',
    });

    assert.equal(state.clock.absoluteMinute, before + 24 * 60);
    assert.equal(state.clock.precision, 'date');
    assert.equal(state.clock.daypart, '');
});


test('coarse clock precision never exposes the internal minute as a fact label', () => {
    let state = createInitialState();
    state.clock.absoluteMinute = 3 * 24 * 60 + 9 * 60 + 17;
    state.clock.lastCheckedAt = state.clock.absoluteMinute;
    state.clock.anchored = true;
    state.clock.precision = 'date';
    state.world.calendar = {
        name: '主世界历',
        anchorAbsoluteDay: 3,
        anchorYear: 2138,
        anchorMonth: 1,
        anchorDay: 3,
    };

    const label = formatWorldClockFactLabel(state);
    const compact = compactStateForModel(state);
    assert.match(label, /2138年1月3日/);
    assert.doesNotMatch(label, /09:17/);
    assert.match(label, /具体钟点未确定/);
    assert.equal(compact.world_now_label, label);
    assert.equal(compact.world_now_coordinate_only, true);
    assert.equal(compact.world_now, null);
    assert.equal(compact.world_story_minute, null);
    assert.equal(compact.world_day_index, 3);
});

test('unbound story clock exposes story-day fact instead of a fake calendar date', () => {
    let state = createInitialState();
    state.clock.absoluteMinute = 5 * 24 * 60 + 13 * 60 + 41;
    state.clock.lastCheckedAt = state.clock.absoluteMinute;
    state.clock.anchored = false;
    state.clock.precision = 'day';

    const label = formatWorldClockFactLabel(state);
    const compact = compactStateForModel(state);
    assert.match(label, /故事第 5 日/);
    assert.doesNotMatch(label, /13:41/);
    assert.equal(compact.world_now, null);
    assert.equal(compact.world_story_minute, null);
    assert.equal(compact.world_day_index, 5);
    assert.equal(compact.world_now_label, label);
});

test('schema-24 uninitialized clock migrates conservatively without inventing minute precision', () => {
    const legacy = createInitialState();
    legacy.schemaVersion = 24;
    legacy.clock.anchored = false;
    legacy.clock.precision = 'uninitialized';
    legacy.clock.absoluteMinute = 6 * 24 * 60 + 8 * 60 + 23;
    legacy.clock.lastCheckedAt = legacy.clock.absoluteMinute;

    const migrated = trimState(legacy);
    assert.equal(migrated.clock.anchored, false);
    assert.equal(migrated.clock.precision, 'day');
    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /08:23/);
});

test('legacy save with no calendar evidence cannot revive a synthetic calendar anchor', () => {
    const legacy = createInitialState();
    legacy.schemaVersion = 7;
    legacy.world.calendar = undefined;
    legacy.clock = {
        absoluteMinute: 7 * 24 * 60 + 11 * 60 + 9,
        lastCheckedAt: 7 * 24 * 60 + 11 * 60 + 9,
        source: 'narrative',
        reason: 'legacy narrative progress',
    };
    legacy.audit = [];

    const migrated = trimState(legacy);
    assert.equal(migrated.clock.anchored, false);
    assert.equal(migrated.clock.precision, 'day');
    assert.match(formatWorldClockFactLabel(migrated), /故事第 7 日/);
    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /11:09/);
});


test('model context exposes numeric minute coordinate only when minute precision is factual', () => {
    let state = createInitialState();
    state.clock.absoluteMinute = 2 * 24 * 60 + 14 * 60 + 26;
    state.clock.lastCheckedAt = state.clock.absoluteMinute;
    state.clock.anchored = true;
    state.clock.precision = 'minute';
    state.world.calendar = {
        name: '主世界历',
        anchorAbsoluteDay: 2,
        anchorYear: 2138,
        anchorMonth: 1,
        anchorDay: 2,
    };

    const compact = compactStateForModel(state);
    assert.equal(compact.world_now, state.clock.absoluteMinute);
    assert.equal(compact.world_story_minute, state.clock.absoluteMinute);
    assert.equal(compact.world_day_index, 2);
    assert.equal(compact.world_now_coordinate_only, false);
    assert.match(compact.world_now_label, /14:26/);
});
