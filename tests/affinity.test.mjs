import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyAffinityAnalysisPayload,
    applyRelationshipEvent,
    buildAffinityAnalysisPrompt,
    createInitialRelationshipState,
    DEFAULT_AFFINITY_PROMPT,
    detectAffinityCandidate,
    getRelationship,
    invalidateRelationshipEvent,
    invalidateRelationshipEventsBySource,
    normalizeRelationshipState,
} from '../affinity.js';
import {
    createCompactSnapshot,
    createInitialState,
    restoreCompactSnapshot,
    trimState,
} from '../core.js';

function apply(state, event) {
    const result = applyRelationshipEvent(state, event);
    assert.equal(result.applied, true, result.reason);
    return result.state;
}

test('new world states include an empty versioned relationship ledger', () => {
    const state = createInitialState();
    assert.equal(state.schemaVersion, 26);
    assert.deepEqual(state.relationships, createInitialRelationshipState());
});

test('legacy saves migrate missing relationship data to an empty ledger', () => {
    const legacy = createInitialState();
    legacy.schemaVersion = 25;
    delete legacy.relationships;

    const migrated = trimState(legacy);
    assert.equal(migrated.schemaVersion, 26);
    assert.deepEqual(migrated.relationships, createInitialRelationshipState());
});

test('relationship direction is independent and unknown dimensions remain unknown', () => {
    let state = createInitialRelationshipState();
    state = apply(state, {
        id: 'alice-to-bob',
        sourceId: 'alice',
        targetId: 'bob',
        initialValues: { affection: 40, trust: 30 },
        deltas: { affection: 5, trust: -2 },
    });
    state = apply(state, {
        id: 'bob-to-alice',
        sourceId: 'bob',
        targetId: 'alice',
        initialValues: { affection: 15, trust: 70 },
        deltas: { affection: 0, trust: 4 },
    });

    assert.deepEqual(getRelationship(state, 'alice', 'bob').values, {
        affection: 45,
        trust: 28,
        romance: null,
    });
    assert.deepEqual(getRelationship(state, 'bob', 'alice').values, {
        affection: 15,
        trust: 74,
        romance: null,
    });
    assert.equal(getRelationship(state, 'alice', 'alice'), null);
});

test('a delta does not invent a baseline for an unknown dimension', () => {
    let state = createInitialRelationshipState();
    state = apply(state, {
        id: 'unanchored-event',
        sourceId: 'a',
        targetId: 'b',
        deltas: { affection: 8 },
    });
    assert.equal(getRelationship(state, 'a', 'b').values.affection, null);

    state = apply(state, {
        id: 'anchored-event',
        sourceId: 'a',
        targetId: 'b',
        initialValues: { affection: 30 },
        deltas: { affection: 2 },
    });
    assert.equal(getRelationship(state, 'a', 'b').values.affection, 32);
});

test('event IDs and idempotency keys prevent duplicate settlement', () => {
    const event = {
        id: 'rescue-1',
        idempotencyKey: 'source:10:0:hash|a|b|rescue',
        sourceId: 'a',
        targetId: 'b',
        initialValues: { affection: 50 },
        deltas: { affection: 10 },
    };
    const first = applyRelationshipEvent(createInitialRelationshipState(), event);
    assert.equal(first.applied, true);

    const duplicateById = applyRelationshipEvent(first.state, event);
    assert.equal(duplicateById.applied, false);
    assert.equal(duplicateById.reason, 'duplicate');

    const duplicateByKey = applyRelationshipEvent(first.state, {
        ...event,
        id: 'rescue-1-retry',
    });
    assert.equal(duplicateByKey.applied, false);
    assert.equal(duplicateByKey.reason, 'duplicate');
    assert.equal(getRelationship(duplicateByKey.state, 'a', 'b').values.affection, 60);
});

test('invalid deltas are rejected without changing the relationship', () => {
    const result = applyRelationshipEvent(createInitialRelationshipState(), {
        id: 'invalid-delta',
        sourceId: 'a',
        targetId: 'b',
        initialValues: { affection: 50 },
        deltas: { affection: 21 },
    });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'invalid_values');
    assert.equal(result.state.events.length, 0);
    assert.equal(getRelationship(result.state, 'a', 'b'), null);
});

test('invalidating an event recomputes later events without double counting', () => {
    let state = createInitialRelationshipState();
    state = apply(state, {
        id: 'event-1',
        sourceId: 'a',
        targetId: 'b',
        sourceKey: 'message:1:swipe:0:hash-a',
        initialValues: { affection: 50 },
        deltas: { affection: 10 },
    });
    state = apply(state, {
        id: 'event-2',
        sourceId: 'a',
        targetId: 'b',
        sourceKey: 'message:2:swipe:0:hash-b',
        deltas: { affection: 5 },
    });
    assert.equal(getRelationship(state, 'a', 'b').values.affection, 65);

    const result = invalidateRelationshipEvent(state, 'event-2', '消息被编辑');
    assert.equal(result.invalidated, true);
    assert.equal(getRelationship(result.state, 'a', 'b').values.affection, 60);
    assert.equal(result.state.events.find(event => event.id === 'event-2').status, 'invalidated');
});

test('source invalidation rolls back all directed events tied to a stale message', () => {
    let state = createInitialRelationshipState();
    state = apply(state, {
        id: 'event-a-b',
        sourceId: 'a',
        targetId: 'b',
        sourceKey: 'message:9:swipe:1:hash-old',
        initialValues: { affection: 40 },
        deltas: { affection: 5 },
    });
    state = apply(state, {
        id: 'event-c-d',
        sourceId: 'c',
        targetId: 'd',
        sourceKey: 'message:9:swipe:1:hash-old',
        initialValues: { trust: 20 },
        deltas: { trust: 8 },
    });

    const result = invalidateRelationshipEventsBySource(
        state,
        'message:9:swipe:1:hash-old',
        '旧 swipe 已失效',
    );
    assert.deepEqual(result.invalidatedIds.sort(), ['event-a-b', 'event-c-d']);
    assert.equal(getRelationship(result.state, 'a', 'b').values.affection, null);
    assert.equal(getRelationship(result.state, 'c', 'd').values.trust, null);
});

test('normalization clamps stored scores and removes duplicate directed edges', () => {
    const normalized = normalizeRelationshipState({
        relations: [
            { sourceId: 'a', targetId: 'b', values: { affection: 150, trust: -4 } },
            { sourceId: 'a', targetId: 'b', values: { affection: 1 } },
        ],
        events: [],
    });
    assert.equal(normalized.relations.length, 1);
    assert.deepEqual(getRelationship(normalized, 'a', 'b').values, {
        affection: 100,
        trust: 0,
        romance: null,
    });
});

test('compact branch snapshots preserve and restore relationship state', () => {
    const state = createInitialState();
    const before = createCompactSnapshot(state, {
        messageId: 1,
        swipeId: 0,
        sourceKey: '1:0:before',
    });
    const changed = { ...state };
    changed.relationships = apply(state.relationships, {
        id: 'branch-event',
        sourceId: 'npc',
        targetId: 'player',
        sourceKey: '2:0:branch-event',
        initialValues: { trust: 25 },
        deltas: { trust: 12 },
    });
    const after = createCompactSnapshot(changed, {
        messageId: 2,
        swipeId: 0,
        sourceKey: '2:0:after',
    });

    const restoredBefore = restoreCompactSnapshot(before);
    const restoredAfter = restoreCompactSnapshot(after);
    assert.equal(getRelationship(restoredBefore.relationships, 'npc', 'player'), null);
    assert.equal(getRelationship(restoredAfter.relationships, 'npc', 'player').values.trust, 37);
});


test('candidate filter requires both a relationship cue and a known person mention', () => {
    const people = [
        { id: 'npc_ash', name: '阿什莉' },
        { id: 'npc_mira', name: '米拉' },
    ];
    const relevant = detectAffinityCandidate('阿什莉把你从火场里救了出来。', people);
    assert.equal(relevant.eligible, true);
    assert.deepEqual(relevant.mentionedPersonIds, ['npc_ash']);

    const noCue = detectAffinityCandidate('阿什莉走进房间，拿起桌上的杯子。', people);
    assert.equal(noCue.eligible, false);
    assert.equal(noCue.reason, 'no_relationship_cue');

    const noKnownPerson = detectAffinityCandidate('有人向你道歉，并承诺以后不会再撒谎。', people);
    assert.equal(noKnownPerson.eligible, false);
    assert.equal(noKnownPerson.reason, 'no_known_person_mention');
});

test('affinity prompt keeps the output protocol fixed and includes only bounded context', () => {
    const prompt = buildAffinityAnalysisPrompt({
        event: {
            sourceKey: '15:0:hash',
            summary: '阿什莉救了玩家。',
        },
        characters: [{
            id: 'npc_ash',
            name: '阿什莉',
            personality: '骄傲、多疑',
            knownEvents: ['她曾经被欺骗'],
            knownFacts: ['玩家救过她'],
        }],
        currentRelations: [{
            sourceId: 'npc_ash',
            targetId: 'player',
            values: { affection: 42, trust: 18, romance: null },
        }],
        romanceEnabled: false,
        customPrompt: '自定义情感判断风格',
    });
    assert.ok(prompt.includes('自定义情感判断风格'));
    assert.ok(prompt.includes('固定执行协议'));
    assert.ok(prompt.includes('"romance_enabled": false'));
    assert.ok(prompt.includes('"source_key": "15:0:hash"'));
    const defaultPrompt = buildAffinityAnalysisPrompt({ event: { summary: '普通互动' } });
    assert.ok(defaultPrompt.includes(DEFAULT_AFFINITY_PROMPT));
});

test('affinity payload rejects unknown people, honors romance switch, and is idempotent', () => {
    const payload = {
        changes: [
            {
                source_id: 'npc',
                target_id: 'player',
                initial_values: { affection: 50, trust: 40, romance: 20 },
                affection_delta: 5,
                trust_delta: -2,
                romance_delta: 12,
                reason: '玩家救了角色。',
                memory_note: '玩家曾救下角色。',
            },
            {
                source_id: 'unlisted-npc',
                target_id: 'player',
                initial_values: { affection: 50 },
                affection_delta: 10,
                trust_delta: 0,
                romance_delta: 0,
                reason: '这名人物不在本次上下文中。',
            },
        ],
    };
    const first = applyAffinityAnalysisPayload(createInitialRelationshipState(), payload, {
        validPersonIds: ['npc'],
        playerId: 'player',
        sourceKey: '15:0:hash',
        sourceMessageId: 15,
        sourceSwipeId: 0,
        romanceEnabled: false,
    });
    assert.equal(first.appliedCount, 1);
    assert.equal(first.rejectedCount, 1);
    assert.deepEqual(getRelationship(first.state, 'npc', 'player').values, {
        affection: 55,
        trust: 38,
        romance: null,
    });

    const duplicate = applyAffinityAnalysisPayload(first.state, payload, {
        validPersonIds: ['npc'],
        playerId: 'player',
        sourceKey: '15:0:hash',
        sourceMessageId: 15,
        sourceSwipeId: 0,
        romanceEnabled: false,
    });
    assert.equal(duplicate.appliedCount, 0);
    assert.equal(duplicate.duplicateCount, 1);
    assert.equal(getRelationship(duplicate.state, 'npc', 'player').values.affection, 55);
});
