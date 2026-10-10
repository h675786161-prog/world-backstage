import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STATE_KEY } from '../core.js';

function makeFixture() {
    return {
        schemaVersion: 25,
        currentState: {
            world: { name: '联合回归世界' },
            clock: { absoluteMinute: 500, displayTime: '10:20' },
            lastCommit: { sourceKey: 'branch-A' },
            people: [
                { id: 'p1', name: '阿青', innerVoice: '绝密心理', intent: '绝密意图', knowledge: '绝密知识' },
                { id: 'p2', name: '阿紫' },
                { id: 'p3', name: '隐藏作者', innerVoice: '绝密内容' },
                { id: 'p4', name: '待拒好友' },
            ],
            events: [
                { id: 'e1', publicity: 'public', status: 'active', publicHeadline: '公开道路通知',
                  publicSummary: '可以传播', cause: '内部幕后原因', actors: ['p3'], summary: '后台事件摘要' },
                { id: 'e2', publicity: 'private', status: 'active', summary: '秘密事件细节' },
                { id: 'e3', publicity: 'trace', status: 'active', publicTrace: '街角传闻' },
            ],
        },
        social: {
            schemaVersion: 2,
            activeConversationId: 'direct-p1',
            conversations: [{
                id: 'direct-p1', type: 'direct', title: '阿青', memberIds: ['p1'],
                rawMessages: [{ id: 'message1', senderId: 'p1', senderName: '阿青', text: '你好',
                  worldMinute: 499, createdAt: '2026-09-04T12:00:00.000Z' }],
            }],
            connections: [
                { personId: 'p1', status: 'accepted' },
                { personId: 'p2', status: 'incoming' },
                { personId: 'p4', status: 'incoming' },
            ],
            moments: [
                { id: 'public1', personId: 'p1', text: '公开动态', visibility: 'friends',
                  likes: 2, likedByUser: false },
                { id: 'hidden1', personId: 'p3', text: '绝密私密动态', visibility: 'private' },
            ],
            notices: [
                { id: 'n1', kind: 'message', personId: 'p1', conversationId: 'direct-p1', text: '你好', readAt: '' },
                { id: 'n2', kind: 'friend_request', personId: 'p2', text: '好友申请', readAt: '' },
                { id: 'n3', kind: 'friend_request', personId: 'p4', text: '好友申请', readAt: '' },
            ],
        },
        publicOpinion: {
            news: [
                { id: 'news1', relatedEventId: 'e1', headline: '公开新闻', summary: '可读新闻' },
                { id: 'news2', relatedEventId: 'e2', headline: '绝密新闻', summary: '秘密事件细节' },
            ],
            forums: [
                { id: 'forum1', relatedEventId: 'e3', title: '街角论坛', summary: '可见传闻' },
                { id: 'forum2', relatedEventId: 'e2', title: '绝密论坛', summary: '秘密讨论' },
            ],
        },
    };
}

async function withBridge(fn) {
    const store = makeFixture();
    let saved = structuredClone(store);
    let saveCount = 0;
    const updates = [];
    const ctx = {
        name1: '测试用户',
        chatId: 'chat-A',
        chatMetadata: { [STATE_KEY]: store },
        async saveMetadata() {
            saved = structuredClone(this.chatMetadata[STATE_KEY]);
            saveCount += 1;
        },
    };
    const old = {
        SillyTavern: globalThis.SillyTavern,
        dispatchEvent: globalThis.dispatchEvent,
        CustomEvent: globalThis.CustomEvent,
    };
    globalThis.SillyTavern = { getContext: () => ctx };
    globalThis.CustomEvent = class {
        constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    };
    globalThis.dispatchEvent = event => { if (event.type === 'world-backstage:phone-update') updates.push(event.detail); return true; };
    const host = await import('../phone-bridge-host.js?contract=' + Math.random().toString(36).slice(2));
    try {
        return await fn({ host, ctx, store, updates, saved: () => saved, saveCount: () => saveCount });
    } finally {
        for (const [key, value] of Object.entries(old)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
        delete globalThis.worldBackstageHost;
    }
}

test('seven declared phone actions exactly equal the host implementation branches', async () => {
    const expected = [
        'social-open-direct', 'social-create-group', 'social-respond-friend',
        'social-comment-moment', 'social-send-message', 'social-read-conversation',
        'social-set-moment-like',
    ];
    const source = await readFile(new URL('../phone-bridge-host.js', import.meta.url), 'utf8');
    const implemented = [...new Set([...source.matchAll(/if \(kind === '([^']+)'\)/g)].map(match => match[1]))];
    await withBridge(async ({ host }) => {
        assert.deepEqual([...host.PHONE_CAPABILITIES].sort(), [...expected].sort());
        assert.deepEqual(implemented.sort(), [...expected].sort());
        assert.deepEqual(host.getWorldPhoneSurface().capabilities.sort(), [...expected].sort());
    });
});

test('all seven phone actions write one authoritative social state and reload correctly', async () => {
    await withBridge(async ({ host, ctx, store, updates, saved, saveCount }) => {
        const action = (kind, payload) => host.handleWorldPhoneAction(kind, payload);
        await assert.rejects(action('social-open-direct', { personId: 'p2' }), /好友/);
        await assert.rejects(action('social-create-group', { memberIds: ['p1', 'p2'] }), /好友/);
        await assert.rejects(action('social-respond-friend', { personId: 'p2', accept: 'yes' }), /接受或拒绝/);
        await action('social-respond-friend', { personId: 'p2', accept: true });
        await action('social-respond-friend', { personId: 'p4', accept: false });
        const direct = await action('social-open-direct', { personId: 'p2' });
        const directId = direct.social.activeConversationId;
        assert.equal(directId, 'direct-p2');
        await action('social-open-direct', { personId: 'p2' });
        assert.equal(store.social.conversations.filter(c => c.id === directId).length, 1);
        const group = await action('social-create-group', { title: '夜市同行', memberIds: ['p1', 'p2'] });
        assert.equal(group.social.conversations.find(c => c.id === group.social.activeConversationId).type, 'group');
        await action('social-send-message', { conversationId: directId, text: '晚上见' });
        assert.equal(store.social.conversations.find(c => c.id === directId).rawMessages.at(-1).text, '晚上见');
        assert.equal(host.getWorldPhoneSurface().social.conversations.find(c => c.id === 'direct-p1').unread, 1);
        await action('social-read-conversation', { conversationId: 'direct-p1' });
        assert.equal(host.getWorldPhoneSurface().social.conversations.find(c => c.id === 'direct-p1').unread, 0);
        await action('social-set-moment-like', { momentId: 'public1', liked: true });
        assert.equal(host.getWorldPhoneSurface().social.moments[0].likes, 3);
        await action('social-set-moment-like', { momentId: 'public1', liked: false });
        assert.equal(host.getWorldPhoneSurface().social.moments[0].likes, 2);
        await action('social-comment-moment', { momentId: 'public1', text: '天气真好' });
        assert.equal(host.getWorldPhoneSurface().social.moments[0].comments[0].text, '天气真好');
        assert.equal(updates.length, 10);
        assert.ok(saveCount() >= 9);
        ctx.chatMetadata[STATE_KEY] = structuredClone(saved());
        const reloaded = host.getWorldPhoneSurface();
        assert.equal(reloaded.social.moments[0].comments[0].text, '天气真好');
        assert.equal(reloaded.social.connections.find(c => c.personId === 'p2').status, 'accepted');
        assert.equal(reloaded.social.connections.find(c => c.personId === 'p4').status, 'declined');
        assert.equal(reloaded.social.conversations.find(c => c.id === 'direct-p1').unread, 0);
    });
});

test('private moments, internal fields and hidden public-opinion sources never reach the phone', async () => {
    await withBridge(async ({ host, store }) => {
        const surface = host.getWorldPhoneSurface();
        assert.deepEqual(surface.social.moments.map(m => m.id), ['public1']);
        assert.equal(surface.people.some(p => p.id === 'p3'), false);
        assert.deepEqual(surface.events.map(e => e.id), ['e1']);
        assert.deepEqual(surface.publicOpinion.news.map(e => e.id), ['news1']);
        assert.deepEqual(surface.publicOpinion.forums.map(e => e.id), ['forum1']);
        const json = JSON.stringify(surface);
        for (const secret of ['绝密心理', '绝密意图', '绝密知识', '绝密私密动态',
            '绝密新闻', '绝密论坛', '秘密事件细节', '内部幕后原因', '后台事件摘要']) {
            assert.equal(json.includes(secret), false, secret);
        }
        const before = JSON.stringify(store.social);
        await assert.rejects(host.handleWorldPhoneAction('social-set-moment-like', { momentId: 'hidden1', liked: true }));
        await assert.rejects(host.handleWorldPhoneAction('social-comment-moment', { momentId: 'hidden1', text: '不该出现' }));
        assert.equal(JSON.stringify(store.social), before);
    });
});

test('save failure rolls back in-memory state and never advertises a successful update', async () => {
    await withBridge(async ({ host, ctx, store, updates }) => {
        const old = structuredClone(store.social);
        ctx.saveMetadata = async () => { throw new Error('磁盘不可写'); };
        await assert.rejects(host.handleWorldPhoneAction('social-send-message',
            { conversationId: 'direct-p1', text: '不应保存' }), /保存失败/);
        assert.deepEqual(store.social, old);
        assert.deepEqual(updates, []);
    });
});

test('chat switch while save is pending cannot publish an old result into the new chat', async () => {
    await withBridge(async ({ host, ctx, updates, store }) => {
        let release;
        ctx.saveMetadata = () => new Promise(resolve => { release = resolve; });
        const before = structuredClone(store.social);
        const pending = host.handleWorldPhoneAction('social-send-message',
            { conversationId: 'direct-p1', text: '原聊天的消息' });
        for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
        assert.equal(typeof release, 'function');
        ctx.chatId = 'chat-B';
        ctx.chatMetadata = { [STATE_KEY]: makeFixture() };
        release();
        await assert.rejects(pending, /切换/);
        assert.deepEqual(store.social, before);
        assert.deepEqual(updates, []);
        assert.equal(host.getWorldPhoneSurface().social.conversations[0].rawMessages.length, 1);
    });
});
