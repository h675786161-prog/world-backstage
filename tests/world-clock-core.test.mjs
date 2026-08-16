import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySimulationResult,
    formatWorldClockFactLabel,
    compactStateForModel,
    buildInjectionPackage,
    createInitialState,
    formatWorldCalendar,
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
    assert.equal(clue.timing.targetWorldMinute - clue.timing.anchoredAtWorldMinute, 2 * 24 * 60);
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
