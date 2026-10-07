import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoryIndexResult, applyMemoryRollupResult, buildInjectionPackage,
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
