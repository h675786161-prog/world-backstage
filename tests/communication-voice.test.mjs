import assert from 'node:assert/strict';
import test from 'node:test';

import {
    adaptCommunicationVoicePayload,
    buildCommunicationVoiceInstruction,
    selectCommunicationVoiceProfiles,
} from '../communication-voice-guard.js';

function fixture() {
    const state = {
        clock: { absoluteMinute: 1234 },
        people: [
            {
                id: 'user-ling',
                name: '玲',
                isUser: true,
                identityAnchor: '成年女性；称呼使用她。',
            },
            {
                id: 'aqing',
                name: '阿青',
                identityAnchor: '成年女性，普通公司职员。',
                personalityAnchor: '安静，嫌麻烦；不爱主动解释自己。',
                backgroundProfile: '和玲认识很多年，但不习惯把关心直接说出口。',
                speakingStyle: '短句；少用感叹号；基本不用 emoji；熟人面前偶尔直接吐槽。',
                behaviorBoundaries: '不会突然撒娇，不用夸张昵称，不把情绪写成长篇分析。',
            },
            {
                id: 'beatrice',
                name: '贝阿特丽斯',
                personalityAnchor: '这是不相关人物，不应泄漏进阿青本轮提示词。',
                speakingStyle: '华丽长句。',
            },
        ],
    };
    const store = {
        currentState: state,
        social: {
            connections: [
                {
                    personId: 'aqing',
                    status: 'accepted',
                    evidence: '多年熟人；当前关系稳定，但没有新增暧昧关系。',
                },
            ],
            conversations: [
                {
                    id: 'direct-aqing',
                    type: 'direct',
                    memberIds: ['aqing'],
                    rawMessages: [
                        { senderId: 'aqing', text: '还没下班。', worldMinute: 1190 },
                        { senderId: 'user', text: '你什么时候回来呀', worldMinute: 1192 },
                        { senderId: 'aqing', text: '不知道，快了。', worldMinute: 1194 },
                    ],
                },
            ],
            moments: [
                { personId: 'aqing', text: '凌晨两点。还活着。', worldMinute: 900 },
            ],
        },
    };
    const context = {
        chatMetadata: {
            world_backstage_v1: store,
        },
    };
    return { state, store, context };
}

test('communication voice roster carries author anchors, relationship register and own-message samples', () => {
    const { state, store } = fixture();
    const profiles = selectCommunicationVoiceProfiles(
        store,
        state,
        '世界背面·内置社交\n本轮成员：阿青 (aqing)',
    );

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, '阿青');
    assert.match(profiles[0].identity_anchor, /成年女性/);
    assert.match(profiles[0].personality_anchor, /嫌麻烦/);
    assert.match(profiles[0].background_profile, /认识很多年/);
    assert.match(profiles[0].speaking_style, /少用感叹号/);
    assert.match(profiles[0].behavior_boundaries, /不会突然撒娇/);
    assert.equal(profiles[0].relationship.status, 'accepted');
    assert.match(profiles[0].relationship.evidence, /没有新增暧昧关系/);
    assert.ok(profiles[0].voice_samples.some(sample => sample.text === '还没下班。'));
    assert.ok(profiles[0].voice_samples.some(sample => sample.text === '不知道，快了。'));
    assert.ok(profiles[0].voice_samples.some(sample => sample.text === '凌晨两点。还活着。'));
    assert.ok(!profiles[0].voice_samples.some(sample => sample.text.includes('什么时候回来')));
});

test('communication voice instruction treats samples as style evidence, respects relationship distance, and permits silence', () => {
    const { state, store } = fixture();
    const instruction = buildCommunicationVoiceInstruction(
        store,
        state,
        '世界背面·内置社交\n请判断阿青是否回复。',
    );

    assert.match(instruction, /先做“人物决策”，再做“语言实现”/);
    assert.match(instruction, /保持沉默\/无动作就是正确结果/);
    assert.match(instruction, /不得因为界面需要内容而强迫人物营业/);
    assert.match(instruction, /不是把性格标签翻译成模板文风/);
    assert.match(instruction, /关系距离决定称呼/);
    assert.match(instruction, /voice_samples 的事实内容属于“当时那条消息\/动态”的历史内容/);
    assert.match(instruction, /绝不能因此把其中地点、状态、关系进展或旧事件当成当前事实/);
    assert.match(instruction, /不像作者旁白、人物分析、心理总结、客服答复或角色小传/);
    assert.match(instruction, /"name":"阿青"/);
    assert.doesNotMatch(instruction, /贝阿特丽斯/);
});

test('social payload gets the high-priority voice guard without changing unrelated prompts', () => {
    const { context } = fixture();
    const socialPayload = {
        messages: [
            { role: 'system', content: '世界背面·朋友圈：生成阿青的公开动态。' },
            { role: 'user', content: '候选人物：阿青' },
        ],
    };
    const adapted = adaptCommunicationVoicePayload(socialPayload, context);
    assert.notEqual(adapted, socialPayload);
    assert.match(adapted.messages[0].content, /<world_backstage_character_voice>/);
    assert.match(adapted.messages[0].content, /本次通讯语域：public_post/);
    assert.match(adapted.messages[0].content, /少用感叹号/);

    const unrelated = {
        messages: [{ role: 'user', content: '普通世界推演，不是社交任务。' }],
    };
    assert.equal(adaptCommunicationVoicePayload(unrelated, context), unrelated);
});
