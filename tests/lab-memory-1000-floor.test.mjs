import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyHistoryIndexResult,
    createInitialState,
    selectRelevantStoryMemory,
    trimState,
} from '../core.js';

function addTwentyFloors(state, batchIndex, extras = {}) {
    const startMessageId = batchIndex * 20;
    const endMessageId = startMessageId + 19;
    const distractors = Array.from({ length: 15 }, (_, index) => ({
        id: `millennium-distractor-${batchIndex}-${index}`,
        key: `millennium:${batchIndex}:${index}`,
        subject: `背景人物${batchIndex}-${index}`,
        predicate: '普通状态',
        value: `第${batchIndex + 1}段普通背景信息-${index}`,
        source_message_id: startMessageId + Math.min(index, 19),
        status: 'active',
        confidence: 'medium',
        importance: 1,
        visibility: 'known',
    }));

    return applyHistoryIndexResult(state, {
        chapter_summary: {
            title: `千楼阶段${batchIndex + 1}`,
            summary: `这是第 ${startMessageId}-${endMessageId} 楼的普通世界推进。`,
            start_message_id: startMessageId,
            end_message_id: endMessageId,
        },
        facts_upsert: [...distractors, ...(extras.facts_upsert || [])],
        clues_upsert: extras.clues_upsert || [],
    }, { startMessageId, endMessageId });
}

test('lab: corrected important fact and manual anchor survive 1000 floors of unrelated history', () => {
    let state = createInitialState();
    state.storyMemory.facts.push({
        id: 'keeper-left-eye-anchor',
        key: 'person:keeper:left-eye',
        subject: '守门人',
        predicate: '身体事实',
        value: '左眼失明，只能用右眼正常视物',
        status: 'active',
        confidence: 'high',
        importance: 3,
        visibility: 'known',
        locked: true,
        manual: true,
        sourceMessageId: 2,
    });

    for (let batch = 0; batch < 50; batch += 1) {
        const extras = {};
        if (batch === 0) {
            extras.facts_upsert = [{
                id: 'warehouse-key-material-long',
                key: 'object:warehouse-key:material-long',
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
        if (batch === 2) {
            extras.facts_upsert = [{
                id: 'warehouse-key-material-long',
                key: 'object:warehouse-key:material-long',
                subject: '旧仓库钥匙',
                predicate: '材质',
                value: '铜制，表面只是沾了红漆',
                source_message_id: 47,
                status: 'active',
                confidence: 'high',
                importance: 3,
                visibility: 'known',
            }];
        }
        if (batch === 20) {
            extras.clues_upsert = [{
                id: 'warehouse-key-notch-long',
                title: '旧仓库钥匙缺口',
                text: '铜钥匙齿部有一道特殊缺口。',
                source_message_id: 406,
                people: ['守门人'],
                tags: ['旧仓库钥匙', '铜钥匙'],
                importance: 3,
            }];
        }
        state = addTwentyFloors(state, batch, extras);
    }

    state = trimState(state);
    assert.equal(state.storyMemory.indexedThroughMessageId, 999);
    assert.equal(state.storyMemory.facts.length <= 720, true);

    const anchor = state.storyMemory.facts.find(fact => fact.id === 'keeper-left-eye-anchor');
    assert.ok(anchor, 'locked manual anchor must survive a thousand-floor world');

    const activeMaterial = state.storyMemory.facts.filter(fact => (
        fact.key === 'object:warehouse-key:material-long'
        && fact.status === 'active'
    ));
    assert.equal(activeMaterial.length, 1);
    assert.match(activeMaterial[0].value, /铜制/);

    const recalled = selectRelevantStoryMemory(
        state,
        '守门人用右眼查看那把旧仓库的铜钥匙，又摸了摸钥匙齿上的特殊缺口。',
        { maximumFacts: 8, maximumClues: 4, maximumSummaries: 3 },
    );
    assert.equal(recalled.facts.some(fact => fact.id === 'keeper-left-eye-anchor'), true);
    assert.equal(recalled.facts.some(fact => fact.key === 'object:warehouse-key:material-long' && /铜制/.test(fact.value)), true);
    assert.equal(recalled.clues.some(clue => clue.id === 'warehouse-key-notch-long'), true);
});
