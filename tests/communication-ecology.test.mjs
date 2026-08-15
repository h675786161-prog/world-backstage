import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adaptSocialPromptPayload,
    communicationEcologyInstruction,
    inferCommunicationEcology,
} from '../communication-ecology.js';

function stateWithProfile(backgroundProfile) {
    return {
        clock: { absoluteMinute: 1200 },
        people: [
            { id: 'user', isUser: true, name: '玲', backgroundProfile },
            { id: 'p1', name: '甲', backgroundProfile, location: '城中' },
        ],
        events: [],
        storyMemory: { facts: [], summaries: [], clues: [] },
    };
}

test('modern worlds keep modern communication available', () => {
    const ecology = inferCommunicationEcology(stateWithProfile('现代都市，公司职员，平时用手机、微信和电话联系。'));
    assert.equal(ecology.technology, 'modern');
    assert.equal(ecology.realtime, 'usually');
});

test('historical worlds do not assume instant messaging', () => {
    const ecology = inferCommunicationEcology(stateWithProfile('古代王朝，住在王府，消息依靠书信、拜帖、信使和驿站。'));
    assert.equal(ecology.technology, 'historical');
    assert.equal(ecology.realtime, 'rare');
    assert.match(ecology.privateChannel, /书信|信使|驿传/);
});

test('magic does not automatically invent remote magic communication', () => {
    const ecology = inferCommunicationEcology(stateWithProfile('古代高魔世界，有魔法师、使魔和魔力，但设定没有说明远程通讯术。'));
    assert.equal(ecology.supernatural, true);
    assert.match(ecology.privateChannel, /绝不能只因“这是魔法世界”/);
});

test('science fiction worlds use world-bound future channels', () => {
    const ecology = inferCommunicationEcology(stateWithProfile('星际时代，星舰通过舰载终端和星网通讯，跨星系可能存在延迟。'));
    assert.equal(ecology.technology, 'scifi');
    assert.equal(ecology.realtime, 'conditional');
});

test('social prompt adaptation explains legacy friend/post field names as protocol only', () => {
    const state = stateWithProfile('古代王朝，消息依靠书信与信使。');
    const store = {
        currentState: state,
        social: {
            conversations: [{
                id: 'direct-p1',
                type: 'direct',
                memberIds: ['p1'],
                rawMessages: [{ senderId: 'user', text: '今晚见。', worldMinute: 1200 }],
            }],
        },
    };
    const context = { chatMetadata: { world_backstage_v1: store } };
    const payload = {
        messages: [
            { role: 'system', content: '<world_backstage_task_system>社交</world_backstage_task_system>' },
            { role: 'user', content: '你正在执行“世界背面·内置社交”回复路由。' },
        ],
        max_tokens: 1000,
    };
    const adapted = adaptSocialPromptPayload(payload, context);
    assert.notEqual(adapted, payload);
    assert.match(adapted.messages[0].content, /内部协议名/);
    assert.match(adapted.messages[0].content, /不证明这个世界存在“好友申请、朋友圈、点赞、群聊、手机或互联网”/);
    assert.match(adapted.messages[0].content, /elapsed_world_minutes/);
    assert.equal(store.communicationEcology.technology, 'historical');
});

test('instruction keeps knowledge delivery separate from backend visibility', () => {
    const ecology = inferCommunicationEcology(stateWithProfile('荒岛求生，与世隔绝，没有通讯设备。'));
    const instruction = communicationEcologyInstruction(ecology, { state: stateWithProfile('荒岛求生，与世隔绝，没有通讯设备。') });
    assert.match(instruction, /后台知道消息内容不等于角色已经收到/);
    assert.match(instruction, /允许本轮完全无回复/);
});
