import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyHistoryIndexResult,
    buildInjectionPackage,
    createInitialState,
    selectRelevantStoryMemory,
    trimState,
} from '../core.js';

function applyTwentyFloorBatch(state, batchIndex, extra = {}) {
    const startMessageId = batchIndex * 20;
    const endMessageId = startMessageId + 19;
    const distractors = Array.from({ length: 18 }, (_, index) => ({
        id: `distractor-${batchIndex}-${index}`,
        key: `background:${batchIndex}:${index}`,
        subject: `路人${batchIndex}-${index}`,
        predicate: '临时状态',
        value: `第${batchIndex + 1}段背景信息-${index}`,
        source_message_id: startMessageId + Math.min(index, 19),
        status: 'active',
        confidence: 'medium',
        importance: 1,
        visibility: 'known',
    }));

    return applyHistoryIndexResult(state, {
        chapter_summary: {
            title: `阶段${batchIndex + 1}`,
            summary: `这是第 ${startMessageId}-${endMessageId} 楼的背景推进。`,
            start_message_id: startMessageId,
            end_message_id: endMessageId,
        },
        facts_upsert: [
            ...distractors,
            ...(extra.facts_upsert || []),
        ],
        clues_upsert: extra.clues_upsert || [],
        memory_digest: extra.memory_digest,
    }, { startMessageId, endMessageId });
}

test('lab: a corrected key fact is still recalled after 200 floors of unrelated history', () => {
    let state = createInitialState();

    for (let batch = 0; batch < 10; batch += 1) {
        const extra = {};
        if (batch === 0) {
            extra.facts_upsert = [{
                id: 'warehouse-key-material',
                key: 'object:warehouse-key:material',
                subject: '旧仓库钥匙',
                predicate: '材质',
                value: '红色塑料',
                source_message_id: 7,
                status: 'active',
                confidence: 'high',
                importance: 3,
                visibility: 'known',
            }];
        }
        if (batch === 1) {
            extra.facts_upsert = [{
                id: 'warehouse-key-material',
                key: 'object:warehouse-key:material',
                subject: '旧仓库钥匙',
                predicate: '材质',
                value: '铜制，表面只是沾了红漆',
                source_message_id: 31,
                status: 'active',
                confidence: 'high',
                importance: 3,
                visibility: 'known',
            }];
        }
        if (batch === 6) {
            extra.clues_upsert = [{
                id: 'warehouse-key-notch',
                title: '旧仓库钥匙的缺口',
                text: '铜钥匙齿部有一道新鲜缺口。',
                source_message_id: 126,
                people: ['守门人'],
                tags: ['旧仓库钥匙', '铜钥匙'],
                importance: 3,
            }];
        }
        state = applyTwentyFloorBatch(state, batch, extra);
    }

    assert.equal(state.storyMemory.indexedThroughMessageId, 199);

    const activeVersions = state.storyMemory.facts.filter(fact => (
        fact.key === 'object:warehouse-key:material'
        && fact.status === 'active'
    ));
    assert.equal(activeVersions.length, 1);
    assert.equal(activeVersions[0].value, '铜制，表面只是沾了红漆');

    const recalled = selectRelevantStoryMemory(
        state,
        '守门人重新拿起那把旧仓库的铜钥匙，检查钥匙齿上的缺口。',
        { maximumFacts: 6, maximumClues: 3, maximumSummaries: 2 },
    );

    assert.equal(
        recalled.facts.some(fact => (
            fact.key === 'object:warehouse-key:material'
            && fact.value.includes('铜制')
        )),
        true,
    );
    assert.equal(
        recalled.facts.some(fact => (
            fact.key === 'object:warehouse-key:material'
            && fact.value === '红色塑料'
            && fact.status === 'active'
        )),
        false,
    );
    assert.equal(recalled.clues.some(clue => clue.id === 'warehouse-key-notch'), true);
});

test('lab: locked manual anchors survive memory storage pressure and remain retrievable', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'manual-anchor',
        key: 'person:keeper:hard-boundary',
        subject: '守门人',
        predicate: '明确事实',
        value: '左眼失明，不会突然恢复视力',
        status: 'active',
        confidence: 'high',
        importance: 3,
        visibility: 'known',
        locked: true,
        manual: true,
        sourceMessageId: 3,
    });

    for (let index = 0; index < 820; index += 1) {
        state.storyMemory.facts.push({
            id: `pressure-${index}`,
            key: `pressure:${index}`,
            subject: `背景人物${index}`,
            predicate: '普通事实',
            value: `普通背景事实${index}`,
            status: 'active',
            confidence: 'medium',
            importance: 1,
            visibility: 'known',
            sourceMessageId: index + 10,
        });
    }

    const trimmed = trimState(state);
    const anchor = trimmed.storyMemory.facts.find(fact => fact.id === 'manual-anchor');
    assert.ok(anchor, 'locked manual memory must not be evicted by soft storage caps');
    assert.equal(anchor.value, '左眼失明，不会突然恢复视力');
    assert.equal(anchor.locked, true);

    const recalled = selectRelevantStoryMemory(
        trimmed,
        '守门人转过左脸，视线仍旧只来自右眼。',
        { maximumFacts: 4, maximumClues: 0, maximumSummaries: 0, includeDigest: false },
    );
    assert.equal(recalled.facts.some(fact => fact.id === 'manual-anchor'), true);
});

test('lab: disabling memory injection hides recall from the foreground without deleting backstage memory', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [{
            id: 'hidden-backstage-anchor',
            key: 'object:sealed-box:owner',
            subject: '封蜡木盒',
            predicate: '真正持有人',
            value: '米拉',
            source_message_id: 12,
            status: 'active',
            confidence: 'high',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 0, endMessageId: 19 });

    const packageWithoutMemory = buildInjectionPackage(state, {
        enabled: true,
        promptInjection: true,
        injectionMemory: false,
        injectionFacts: false,
        injectionPeople: false,
        injectionEvents: false,
        injectionEchoes: false,
        injectionPublicOpinion: false,
        injectionWorldBackground: false,
    }, '米拉看向那个封蜡木盒。');

    assert.equal(packageWithoutMemory.text.includes('封蜡木盒'), false);
    assert.equal(
        state.storyMemory.facts.some(fact => fact.id === 'hidden-backstage-anchor'),
        true,
        'not injected must never mean deleted from world state',
    );

    const recalled = selectRelevantStoryMemory(
        state,
        '米拉看向那个封蜡木盒。',
        { maximumFacts: 4, maximumClues: 0, maximumSummaries: 0, includeDigest: false },
    );
    assert.equal(recalled.facts.some(fact => fact.id === 'hidden-backstage-anchor'), true);
});
