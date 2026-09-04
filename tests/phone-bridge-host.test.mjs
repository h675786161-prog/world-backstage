import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_KEY } from '../core.js';

function fixtureStore() {
    return {
        schemaVersion: 25,
        currentState: {
            world: { name: '测试世界' },
            clock: { absoluteMinute: 123, displayTime: '21:37', displayDate: '9月4日' },
            people: [
                {
                    id: 'p1',
                    name: '阿青',
                    isUser: false,
                    monogram: '青',
                    avatarDataUrl: 'data:image/png;base64,AAAA',
                    location: '楼下',
                    action: '等人',
                    intent: '准备试探用户',
                    innerVoice: '这句话绝不能让手机直接读到。',
                    knowledge: 'known',
                    knownEventIds: ['event-secret'],
                    backgroundProfile: '后台完整人物设定',
                },
                {
                    id: 'p2',
                    name: '幕后人',
                    isUser: false,
                    location: '未知处',
                    action: '秘密跟踪',
                    innerVoice: '完全隐藏',
                    knowledge: 'hidden',
                },
            ],
            events: [
                {
                    id: 'event-public',
                    title: '后台内部标题',
                    summary: '后台私密摘要，不应出桥',
                    cause: '幕后原因',
                    actors: ['p2'],
                    status: 'active',
                    publicity: 'public',
                    publicHeadline: '城区发布道路积水提醒',
                    publicSummary: '部分道路仍有积水，请绕行。',
                    publicTrace: '已有公开提示。',
                },
                {
                    id: 'event-secret',
                    title: '秘密跟踪',
                    summary: '幕后人正在跟踪阿青',
                    status: 'active',
                    publicity: 'private',
                    visibility: 'hidden',
                },
            ],
            lastCommit: { sourceKey: 'branch-test' },
        },
        social: {
            schemaVersion: 2,
            activeConversationId: 'direct-p1',
            conversations: [{
                id: 'direct-p1',
                type: 'direct',
                title: '阿青',
                memberIds: ['p1'],
                rawMessages: [{
                    id: 'm1', senderId: 'p1', senderName: '阿青', text: '到楼下了。', worldMinute: 122, createdAt: '2026-09-04T12:00:00.000Z',
                }],
                narrativeSettledThroughMessageId: 'm1',
                lastRouting: {
                    at: '2026-09-04T12:00:00.000Z',
                    evaluations: [{ personId: 'p1', saw: true, knows: true, willing: true, outcome: 'speak', reason: '内部路由原因' }],
                },
                lastError: '内部错误细节',
                createdAt: '2026-09-04T12:00:00.000Z',
                updatedAt: '2026-09-04T12:00:00.000Z',
            }],
            connections: [{
                personId: 'p1',
                status: 'accepted',
                source: 'world',
                evidence: '后台关系证据',
                decisionReason: '内部决策理由',
            }],
            moments: [{ id: 'moment-1', personId: 'p1', text: '雨停了。', likes: 2, likedByUser: false, createdAt: '2026-09-04T11:00:00.000Z' }],
            notices: [{ id: 'notice-1', kind: 'message', personId: 'p1', conversationId: 'direct-p1', text: '到楼下了。', createdAt: '2026-09-04T12:00:00.000Z', readAt: '' }],
        },
        publicOpinion: { news: [], forums: [] },
    };
}

test('world phone bridge exposes only phone-visible world surface and canonical social writes', async () => {
    const store = fixtureStore();
    let saves = 0;
    globalThis.SillyTavern = {
        getContext() {
            return {
                name1: '你',
                chatMetadata: { [STATE_KEY]: store },
                saveMetadataDebounced() { saves += 1; },
            };
        },
    };

    const module = await import(`../phone-bridge-host.js?test=${Date.now()}`);
    const initial = module.getWorldPhoneSurface();
    assert.equal(initial.connected, true);
    assert.equal(initial.bridgeVersion, 2);
    assert.equal(initial.worldName, '测试世界');
    assert.equal(initial.branchKey, 'branch-test');
    assert.equal(globalThis.worldBackstageHost.phoneBridgeVersion, 2);

    assert.deepEqual(initial.people.map(person => person.id), ['p1']);
    assert.deepEqual(Object.keys(initial.people[0]).sort(), ['avatarDataUrl', 'id', 'monogram', 'name']);
    assert.equal(initial.people[0].name, '阿青');
    assert.equal('innerVoice' in initial.people[0], false);
    assert.equal('intent' in initial.people[0], false);
    assert.equal('knownEventIds' in initial.people[0], false);

    assert.equal(initial.events.length, 1);
    assert.equal(initial.events[0].id, 'event-public');
    assert.equal(initial.events[0].publicHeadline, '城区发布道路积水提醒');
    assert.equal('title' in initial.events[0], false);
    assert.equal('summary' in initial.events[0], false);
    assert.equal('cause' in initial.events[0], false);
    assert.equal('actors' in initial.events[0], false);

    assert.equal(initial.social.conversations[0].rawMessages.length, 1);
    assert.equal('lastRouting' in initial.social.conversations[0], false);
    assert.equal('lastError' in initial.social.conversations[0], false);
    assert.equal('narrativeSettledThroughMessageId' in initial.social.conversations[0], false);
    assert.equal('evidence' in initial.social.connections[0], false);
    assert.equal('decisionReason' in initial.social.connections[0], false);

    module.handleWorldPhoneAction('social-send-message', { conversationId: 'direct-p1', text: '马上下来。' });
    assert.equal(store.social.conversations[0].rawMessages.at(-1).senderId, 'user');
    assert.equal(store.social.conversations[0].rawMessages.at(-1).text, '马上下来。');
    assert.equal(store.social.conversations[0].rawMessages.at(-1).worldMinute, 123);

    module.handleWorldPhoneAction('social-read-conversation', { conversationId: 'direct-p1' });
    assert.ok(store.social.notices[0].readAt);

    module.handleWorldPhoneAction('social-set-moment-like', { momentId: 'moment-1', liked: true });
    assert.equal(store.social.moments[0].likedByUser, true);
    assert.equal(store.social.moments[0].likes, 3);
    assert.ok(saves >= 3);

    delete globalThis.SillyTavern;
    delete globalThis.worldBackstageHost;
});
