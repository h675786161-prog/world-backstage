import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoryIndexResult, applyMemoryRollupResult, applySimulationResult, buildInjectionPackage,
    createInitialState, planMemoryRollup, selectRelevantStoryMemory, trimState } from '../core.js';
import { AUTO_HIDDEN_MESSAGE_KEY, autoHideCandidateMessageIds, markAutoHiddenMessages,
    messageMemoryFingerprint, restoreUnsafeAutoHiddenMessages } from '../auto-hide.js';

const chatFixture = () => Array.from({ length: 16 }, (_, id) => ({
    mes: `正文${id}`, is_user: id % 2 === 0, is_system: false, extra: {},
}));
const summariesFor = chat => chat.map((message, id) => ({
    id: `detail${id}`, level: 0, startMessageId: id, endMessageId: id,
    summary: `记忆${id}`, sourceFingerprint: messageMemoryFingerprint(message),
}));

test('repeated model summary IDs cannot overwrite different indexed floors', () => {
    const turns = [0, 1, 2].map(id => ({ id: 'summary_l0_message_id',
        source_message_id: id, summary: `第${id}楼独有内容` }));
    let state = applyHistoryIndexResult(createInitialState(), { turn_summaries: turns },
        { startMessageId: 0, endMessageId: 2 });
    assert.equal(state.storyMemory.summaries.length, 3);
    assert.equal(new Set(state.storyMemory.summaries.map(item => item.id)).size, 3);
    state = applyHistoryIndexResult(state, { turn_summaries: [{ ...turns[1], summary: '第1楼修订' }] },
        { startMessageId: 1, endMessageId: 1 });
    assert.equal(state.storyMemory.summaries.length, 3);
    assert.match(state.storyMemory.summaries.find(item => item.startMessageId === 0).summary, /独有/);
    assert.equal(state.storyMemory.summaries.find(item => item.startMessageId === 1).summary, '第1楼修订');
});

test('simulation turn summaries also preserve each authorized floor despite repeated IDs', () => {
    const state = applySimulationResult(createInitialState(), { memory_update: {
        turn_summaries: [2, 4, 8].map(id => ({ id: 'summary_l0_message_id',
            source_message_id: id, summary: `事件${id}` })),
    } }, { messageId: 4, memorySummaryMessageIds: [2, 4] });
    assert.deepEqual(state.storyMemory.summaries.map(item => item.startMessageId).sort((a,b) => a-b), [2,4]);
});

test('repairing legacy summary IDs preserves upper references and avoids old ID collisions', () => {
    const state = createInitialState();
    state.storyMemory.summaries = [
        { id: 'summary_l0_0', level: 0, startMessageId: 1, endMessageId: 1, summary: '旧第1楼' },
        { id: 'upper', level: 1, startMessageId: 1, endMessageId: 1, summary: '上层索引',
            sourceSummaryIds: ['summary_l0_0'] },
    ];
    const updated = applyHistoryIndexResult(state, { turn_summaries: [
        { source_message_id: 0, summary: '补回第0楼' },
        { source_message_id: 1, summary: '修订第1楼' },
    ] }, { startMessageId: 0, endMessageId: 1 });
    assert.equal(new Set(updated.storyMemory.summaries.map(item => item.id)).size, 3);
    assert.equal(updated.storyMemory.summaries.find(item => item.id === 'summary_l0_0').summary, '修订第1楼');
    assert.deepEqual(updated.storyMemory.summaries.find(item => item.id === 'upper').sourceSummaryIds, ['summary_l0_0']);
    assert.equal(updated.storyMemory.summaries.find(item => item.startMessageId === 0).summary, '补回第0楼');
});

test('an omitted one-off detail remains recallable after model rollup and serialization', () => {
    const chat = chatFixture();
    let state = applyHistoryIndexResult(createInitialState(), {
        turn_summaries: chat.map((_, id) => ({ source_message_id: id,
            summary: id === 4 ? '观察树洞刻痕：四道平行蓝线，旁边是倒置三角。' : `众人在长廊查看普通石墙${id}。` })),
    }, { startMessageId: 0, endMessageId: 15,
        messages: chat.map((message, id) => ({ id, sourceFingerprint: messageMemoryFingerprint(message) })) });
    state = applyMemoryRollupResult(state, {
        summary_rollup: { summary: '众人在长廊调查石墙，仍未发现出口。' },
    }, planMemoryRollup(state));
    state = trimState(JSON.parse(JSON.stringify(state)));
    const detail = state.storyMemory.summaries.find(item => item.startMessageId === 4 && item.level === 0);
    assert.equal(detail.retentionState, 'compacted');
    assert.match(detail.summary, /四道平行蓝线/);
    assert.equal(detail.sourceFingerprint, messageMemoryFingerprint(chat[4]));
    const query = '树洞刻痕是什么图案？';
    assert.ok(selectRelevantStoryMemory(state, query).summaries.some(item => /倒置三角/.test(item.summary)));
    const packet = buildInjectionPackage(state, { enabled: true, worldSimulationEnabled: false }, query);
    assert.match(packet.supportText, /四道平行蓝线/);
    assert.ok(packet.text.length <= 4200);
});

test('legacy placeholders and mismatched source fingerprints never cover a floor', () => {
    const chat = chatFixture(), summaries = summariesFor(chat);
    summaries[2].summary = '细节已收进上层记忆；原始正文见消息 2—2。';
    chat[3].mes = '修改后的正文';
    const eligible = autoHideCandidateMessageIds(chat, 15, { summaries });
    assert.ok(!eligible.includes(2));
    assert.ok(!eligible.includes(3));
    assert.ok(eligible.includes(4));
});

test('coverage loss, edited text, changed swipe and rollback restore owned hides only', () => {
    const chat = chatFixture(), summaries = summariesFor(chat);
    chat[1].is_system = true;
    markAutoHiddenMessages(chat, 15, { summaries });
    summaries.splice(2, 1);
    chat[3].mes = '被改楼';
    chat[4].swipe_id = 1;
    const restored = restoreUnsafeAutoHiddenMessages(chat, 12, { summaries });
    assert.deepEqual(restored, [2, 3, 4, 8, 9, 10]);
    assert.equal(chat[1].is_system, true);
    assert.equal(chat[0].is_system, true);
    for (const id of restored) assert.equal(chat[id].extra[AUTO_HIDDEN_MESSAGE_KEY], undefined);
});

test('legacy coverage is bound on hiding and cannot re-hide edited messages', () => {
    const chat = chatFixture(), summaries = summariesFor(chat);
    for (const item of summaries) delete item.sourceFingerprint;
    markAutoHiddenMessages(chat, 15, { summaries });
    chat[2].mes = '新内容';
    assert.deepEqual(restoreUnsafeAutoHiddenMessages(chat, 15, { summaries }), [2]);
    assert.ok(!markAutoHiddenMessages(chat, 15, { summaries }).includes(2));
});
