import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyHistoryIndexResult,
    applySimulationResult,
    buildHistoryIndexPrompt,
    buildInjectionPackage,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    selectRelevantStoryMemory,
    trimState,
} from '../core.js';

test('legacy state receives an empty story memory ledger', () => {
    const state = createInitialState();
    delete state.storyMemory;
    const migrated = trimState(state);

    assert.equal(migrated.storyMemory.indexedThroughMessageId, -1);
    assert.equal(migrated.storyMemory.digest.text, '');
    assert.deepEqual(migrated.storyMemory.facts, []);
    assert.deepEqual(migrated.storyMemory.summaries, []);
    assert.deepEqual(migrated.storyMemory.clues, []);
});

test('locked manual memory survives model updates and invalidation', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'locked-promise',
        key: 'person:a:promise',
        subject: 'A',
        predicate: '承诺',
        value: '不会离开',
        status: 'active',
        confidence: 'high',
        importance: 3,
        visibility: 'known',
        locked: true,
        manual: true,
    });
    const updated = applySimulationResult(state, {
        memory_update: {
            facts_upsert: [{ id: 'locked-promise', key: 'person:a:promise', value: '已经离开' }],
            facts_invalidate: [{ id: 'locked-promise', reason: '模型判断失效' }],
        },
    });
    const locked = updated.storyMemory.facts.find(fact => fact.id === 'locked-promise');
    assert.equal(locked.value, '不会离开');
    assert.equal(locked.status, 'active');
});

test('history batches create summaries and deduplicated clues', () => {
    const base = createInitialState();
    const first = applyHistoryIndexResult(base, {
        chapter_summary: {
            title: '雨夜来客',
            summary: '一封没有署名的信被藏进柜台。',
            start_message_id: 0,
            end_message_id: 19,
            people: ['老白'],
            locations: ['同福客栈'],
        },
        clues_upsert: [{
            id: 'unsigned-letter',
            title: '无署名的信',
            text: '信封上的火漆印来自京城。',
            source_message_id: 8,
            source_swipe_id: 1,
            source_excerpt: '火漆上有一道极浅的鹤纹。',
            people: ['老白'],
            locations: ['同福客栈'],
            tags: ['火漆', '鹤纹'],
            importance: 3,
        }],
    }, { startMessageId: 0, endMessageId: 19 });
    const second = applyHistoryIndexResult(first, {
        clues_upsert: [{
            id: 'unsigned-letter',
            text: '信封上的火漆印来自京城，后来又被掌柜收起。',
            status: 'echoed',
        }],
    }, { startMessageId: 20, endMessageId: 39 });

    assert.equal(second.storyMemory.summaries.length, 1);
    assert.equal(second.storyMemory.clues.length, 1);
    assert.equal(second.storyMemory.clues[0].status, 'echoed');
    assert.equal(second.storyMemory.indexedThroughMessageId, 39);
});

test('relevant memory retrieval prefers matching people and objects', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        clues_upsert: [
            {
                id: 'letter',
                title: '鹤纹火漆',
                text: '无署名的信使用鹤纹火漆。',
                people: ['老白'],
                tags: ['信件', '火漆'],
                importance: 3,
            },
            {
                id: 'well',
                title: '井边脚印',
                text: '后院井边有陌生脚印。',
                people: ['小郭'],
                tags: ['水井'],
                importance: 1,
            },
        ],
    }, { startMessageId: 0, endMessageId: 10 });

    const memory = selectRelevantStoryMemory(state, '老白再次拿起那封带火漆的信。', {
        maximumClues: 1,
        maximumSummaries: 0,
    });
    assert.equal(memory.clues[0].id, 'letter');
});

test('normal world simulation can add and resolve clue records', () => {
    const base = applyHistoryIndexResult(createInitialState(), {
        clues_upsert: [{
            id: 'old-key',
            title: '旧钥匙',
            text: '钥匙齿上刻着三道横线。',
        }],
    }, { startMessageId: 0, endMessageId: 4 });
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        memory_update: {
            clues_upsert: [{
                id: 'new-map',
                title: '残缺地图',
                text: '地图缺少北侧一角。',
            }],
            clues_resolve: [{
                id: 'old-key',
                resolution: '钥匙打开了旧仓库。',
            }],
        },
    }, { messageId: 12, swipeId: 2 });

    assert.equal(result.storyMemory.clues.length, 2);
    assert.equal(
        result.storyMemory.clues.find(clue => clue.id === 'old-key').status,
        'resolved',
    );
    assert.equal(
        result.storyMemory.clues.find(clue => clue.id === 'new-map').sourceMessageId,
        12,
    );
});

test('history and world prompts carry source-aware long memory rules', () => {
    const state = createInitialState();
    const historyPrompt = buildHistoryIndexPrompt(state, {
        messages: [
            { id: 7, swipe: 2, role: 'assistant', content: '桌角压着一封信。' },
        ],
        userName: '玩家',
    });
    const worldPrompt = buildSimulationPrompt(state, {
        narrativeTurns: [{ role: 'assistant', content: '桌角压着一封信。' }],
    });

    assert.equal(historyPrompt.includes('source_message_id'), true);
    assert.equal(historyPrompt.includes('swipe="2"'), true);
    assert.equal(worldPrompt.includes('memory_update'), true);
    assert.equal(worldPrompt.includes('相关旧记忆'), true);
});

test('person observation is bounded and protects the player by default', () => {
    const state = createInitialState();
    const npc = {
        id: 'npc',
        name: '老白',
        isUser: false,
        location: '后院',
        action: '检查门闩',
        intent: '确认是否有人来过',
        longTermGoal: '保护客栈',
        innerVoice: '这门闩像是被人动过。',
        knowledge: 'hidden',
    };
    const prompt = buildPersonObservationPrompt(state, npc);
    assert.equal(prompt.includes('不推进主世界时间'), true);
    assert.equal(prompt.includes('使用“我”'), true);

    assert.throws(
        () => buildPersonObservationPrompt(state, { ...npc, name: '玩家', isUser: true }),
        /玩家视角默认关闭/,
    );
});

test('player identity anchor is free-form, gender-neutral and shared by all prompt paths', () => {
    const state = createInitialState();
    const anchor = '男性，外表偏女性，使用“他”和男性称谓；狐族人外。';
    const worldPrompt = buildSimulationPrompt(state, {
        userName: '月岛',
        playerIdentityAnchor: anchor,
        narrativeTurns: [{ role: 'assistant', content: '有人看向月岛。' }],
    });
    const historyPrompt = buildHistoryIndexPrompt(state, {
        userName: '月岛',
        playerIdentityAnchor: anchor,
        messages: [{ id: 1, role: 'assistant', content: '有人看向月岛。' }],
    });
    const observationPrompt = buildPersonObservationPrompt(state, {
        id: 'npc',
        name: '守卫',
        location: '城门',
        action: '值守',
        intent: '观察来客',
        knowledge: 'hidden',
    }, {
        userName: '月岛',
        playerIdentityAnchor: anchor,
    });

    for (const prompt of [worldPrompt, historyPrompt, observationPrompt]) {
        assert.match(prompt, /男性，外表偏女性/);
        assert.match(prompt, /不得根据外貌、衣着、身体或物种/);
    }
    assert.doesNotMatch(worldPrompt, /追踪她的位置与行动/);
    assert.doesNotMatch(observationPrompt, /描写她此刻/);
});

test('history indexing stores a rolling digest and durable facts', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        memory_digest: {
            text: 'The innkeeper promised to protect the sealed letter.',
            through_message_id: 18,
            people: ['Innkeeper'],
            tags: ['promise'],
        },
        facts_upsert: [{
            id: 'innkeeper-promise',
            key: 'person:innkeeper:promise',
            subject: 'Innkeeper',
            predicate: 'promised',
            value: 'Protect the sealed letter',
            source_message_id: 18,
            status: 'active',
            confidence: 'high',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 9, endMessageId: 18 });

    assert.equal(state.storyMemory.digest.throughMessageId, 18);
    assert.match(state.storyMemory.digest.text, /sealed letter/);
    assert.equal(state.storyMemory.facts.length, 1);
    assert.equal(state.storyMemory.facts[0].key, 'person:innkeeper:promise');
});

test('a changed durable fact keeps the old version and links the replacement', () => {
    const first = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [{
            id: 'keeper-role',
            key: 'person:keeper:role',
            subject: 'Keeper',
            predicate: 'role',
            value: 'Innkeeper',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 0, endMessageId: 10 });
    const second = applyHistoryIndexResult(first, {
        facts_upsert: [{
            id: 'keeper-role',
            key: 'person:keeper:role',
            subject: 'Keeper',
            predicate: 'role',
            value: 'Royal spy',
            importance: 3,
            visibility: 'known',
        }],
    }, { startMessageId: 11, endMessageId: 20 });

    assert.equal(second.storyMemory.facts.length, 2);
    const oldVersion = second.storyMemory.facts.find(fact => fact.value === 'Innkeeper');
    const newVersion = second.storyMemory.facts.find(fact => fact.value === 'Royal spy');
    assert.equal(oldVersion.status, 'superseded');
    assert.equal(oldVersion.supersededBy, newVersion.id);
    assert.equal(newVersion.status, 'active');
    assert.equal(newVersion.supersedes.includes(oldVersion.id), true);
});

test('disputed replacements remain parallel instead of erasing either claim', () => {
    const first = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [{
            key: 'artifact:origin',
            subject: 'Artifact',
            predicate: 'origin',
            value: 'Northern ruins',
            visibility: 'known',
        }],
    }, { startMessageId: 0, endMessageId: 4 });
    const second = applyHistoryIndexResult(first, {
        facts_upsert: [{
            key: 'artifact:origin',
            subject: 'Artifact',
            predicate: 'origin',
            value: 'Capital forge',
            status: 'disputed',
            visibility: 'known',
        }],
    }, { startMessageId: 5, endMessageId: 9 });

    assert.equal(second.storyMemory.facts.length, 2);
    assert.deepEqual(
        second.storyMemory.facts.map(fact => fact.status).sort(),
        ['disputed', 'disputed'],
    );
});

test('normal simulation writes durable facts and can invalidate them later', () => {
    const written = applySimulationResult(createInitialState(), {
        elapsed_minutes: 0,
        memory_update: {
            facts_upsert: [{
                key: 'letter:owner',
                subject: 'Sealed letter',
                predicate: 'owner',
                value: 'Mira',
                visibility: 'known',
            }],
        },
    }, { messageId: 12, swipeId: 1 });
    const invalidated = applySimulationResult(written, {
        elapsed_minutes: 0,
        memory_update: {
            facts_invalidate: [{
                key: 'letter:owner',
                reason: 'The letter was proven to be a planted decoy.',
            }],
        },
    }, { messageId: 15, swipeId: 0 });

    assert.equal(written.storyMemory.facts[0].sourceMessageId, 12);
    assert.equal(invalidated.storyMemory.facts[0].status, 'invalidated');
    assert.match(invalidated.storyMemory.facts[0].invalidationReason, /decoy/);
});

test('main prompt recalls only relevant knowledge-safe memory', () => {
    const state = applyHistoryIndexResult(createInitialState(), {
        facts_upsert: [
            {
                key: 'letter:owner',
                subject: 'Sealed letter',
                predicate: 'owner',
                value: 'Mira may openly claim it',
                tags: ['sealed letter'],
                importance: 3,
                visibility: 'known',
            },
            {
                key: 'letter:secret',
                subject: 'Sealed letter',
                predicate: 'secret',
                value: 'Hidden assassin order',
                tags: ['sealed letter'],
                importance: 3,
                visibility: 'hidden',
            },
        ],
    }, { startMessageId: 0, endMessageId: 14 });
    const injection = buildInjectionPackage(state, {
        enabled: true,
        promptInjection: true,
        sceneTiming: 'strict',
    }, 'Mira examines the sealed letter.');

    assert.match(injection.text, /Mira may openly claim it/);
    assert.equal(injection.text.includes('Hidden assassin order'), false);
});

test('history prompts request all four memory layers', () => {
    const prompt = buildHistoryIndexPrompt(createInitialState(), {
        messages: [{ id: 1, role: 'assistant', content: 'A promise is made.' }],
    });

    assert.equal(prompt.includes('memory_digest'), true);
    assert.equal(prompt.includes('chapter_summary'), true);
    assert.equal(prompt.includes('facts_upsert'), true);
    assert.equal(prompt.includes('clues_upsert'), true);

    const compactPrompt = buildHistoryIndexPrompt(createInitialState(), {
        messages: [{ id: 1, role: 'assistant', content: 'A promise is made.' }],
        compact: true,
    });
    assert.match(compactPrompt, /极简重试/);
    assert.match(compactPrompt, /不超过240字/);
    assert.match(compactPrompt, /facts_upsert 最多3条/);
    assert.equal(compactPrompt.length < prompt.length + 300, true);
});

test('more than 200 turns remain bounded and still recall recent character facts', () => {
    let state = createInitialState({ worldName: '长篇压力测试' });
    for (let turn = 0; turn < 220; turn += 1) {
        const personIndex = turn % 18;
        state = applySimulationResult(state, {
            elapsed_minutes: turn % 10 === 0 ? 1 : 0,
            people_upsert: [{
                id: `npc-${personIndex}`,
                name: `人物${personIndex}`,
                action: `处理第${turn}轮留下的事务`,
                intent: `保持线索${turn % 9}连续`,
                source: 'background',
            }],
            events_create: [{
                id: `event-${turn}`,
                title: `后台事件${turn}`,
                place: `地点${turn % 12}`,
                summary: `人物${personIndex}推进了线索${turn % 9}`,
                clock_mode: 'condition',
                visibility: 'hidden',
            }],
        }, {
            messageId: turn * 2 + 1,
            backgroundNpcBudget: 4,
            narrativeText: `第${turn}轮正文`,
        });
        state = applyHistoryIndexResult(state, {
            chapter_summary: {
                id: `summary-${turn}`,
                title: `阶段${turn}`,
                summary: `人物${personIndex}在地点${turn % 12}处理了线索${turn % 9}`,
            },
            facts_upsert: [{
                id: `fact-${turn}`,
                key: `turn:${turn}:fact`,
                subject: `人物${personIndex}`,
                predicate: '经历',
                value: `完成第${turn}轮的可持续事实`,
                importance: turn === 219 ? 3 : 1,
                visibility: 'known',
            }],
            clues_upsert: [{
                id: `clue-${turn}`,
                title: `线索${turn}`,
                text: `人物${personIndex}记得第${turn}轮的细节`,
                people: [`人物${personIndex}`],
                tags: [`线索${turn % 9}`],
            }],
        }, {
            startMessageId: turn * 2,
            endMessageId: turn * 2 + 1,
        });
    }

    assert.equal(state.people.length, 18);
    assert.equal(state.events.length <= 96, true);
    assert.equal(state.storyMemory.facts.length <= 240, true);
    assert.equal(state.storyMemory.clues.length <= 180, true);
    assert.equal(state.storyMemory.summaries.length <= 72, true);
    assert.equal(state.audit.length <= 40, true);
    const prompt = buildSimulationPrompt(state, {
        narrativeTurns: [{ role: 'assistant', content: '人物3再次提起线索3。', messageId: 441 }],
    });
    assert.equal(prompt.includes('人物3'), true);
    assert.equal(prompt.length < 80000, true);
});
