import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_KEY } from '../core.js';

function fixture({ news = [], forums = [], moments = [] } = {}) {
    const store = { currentState: {}, phoneFeedCacheV1: {} };
    let sandbox = { generatedAt: '', nonCanon: true, news: [], forums: [] };
    let refreshCalls = 0;
    let sandboxCalls = 0;
    const updates = [];
    const surface = {
        connected: true,
        bridgeVersion: 2,
        branchKey: 'branch-A',
        worldName: '测试世界',
        clock: { absoluteMinute: 600 },
        people: [{ id: 'p1', name: '阿青' }],
        events: [],
        social: { moments: structuredClone(moments) },
        publicOpinion: {
            generatedAt: '2026-10-13T00:00:00.000Z',
            sourceWorldMinute: 600,
            news: structuredClone(news),
            forums: structuredClone(forums),
        },
    };
    const ctx = {
        chatId: 'chat-A',
        chatMetadata: { [STATE_KEY]: store },
        saveMetadataDebounced() {},
    };
    let activeContext = ctx;
    const host = {
        phoneBridgeVersion: 2,
        getPhoneSurface: () => structuredClone(surface),
        getPublicSurface: () => ({ sandbox: structuredClone(sandbox) }),
        async refreshPublicOpinion() { refreshCalls += 1; },
        async generatePublicOpinionSandbox() {
            sandboxCalls += 1;
            sandbox = {
                generatedAt: `2026-10-13T00:0${sandboxCalls}:00.000Z`,
                nonCanon: true,
                news: [{
                    headline: '街角新开了一家小店',
                    summary: '有人路过时顺手拍了菜单。',
                    source: '本地生活',
                    category: '生活',
                    heat: 1,
                }],
                forums: [
                    {
                        board: '闲聊',
                        title: '今天的风很舒服',
                        summary: '下班路上很多人在河边坐着。',
                        heat: 1,
                        replies: [{ author: '路人甲', text: '确实，今天适合散步。' }],
                    },
                    {
                        board: '吃喝',
                        title: '夜市烤饼排队了吗',
                        summary: '新摊第一天，队伍拐了个弯。',
                        heat: 2,
                        replies: [],
                    },
                ],
            };
        },
    };
    const old = {
        SillyTavern: globalThis.SillyTavern,
        worldBackstageHost: globalThis.worldBackstageHost,
        dispatchEvent: globalThis.dispatchEvent,
        CustomEvent: globalThis.CustomEvent,
    };
    globalThis.SillyTavern = { getContext: () => activeContext };
    globalThis.worldBackstageHost = host;
    globalThis.CustomEvent = class {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    globalThis.dispatchEvent = event => {
        updates.push({ type: event.type, detail: event.detail });
        return true;
    };
    return {
        host,
        surface,
        store,
        updates,
        counts: () => ({ refreshCalls, sandboxCalls }),
        switchChatSameBranch() {
            const otherStore = { currentState: {}, phoneFeedCacheV1: {} };
            activeContext = {
                chatId: 'chat-B',
                chatMetadata: { [STATE_KEY]: otherStore },
                saveMetadataDebounced() {},
            };
            return otherStore;
        },
        cleanup() {
            for (const [key, value] of Object.entries(old)) {
                if (value === undefined) delete globalThis[key];
                else globalThis[key] = value;
            }
        },
    };
}

async function install(sample) {
    await import(`../phone-feed-host.js?test=${Math.random().toString(36).slice(2)}`);
    return globalThis.worldBackstageHost;
}

test('installing the phone feed bridge never spends tokens by itself', async () => {
    const sample = fixture();
    try {
        const host = await install(sample);
        assert.equal(host.phoneFeedBridgeVersion, 2);
        assert.equal(typeof host.requestPhoneFeed, 'function');
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 0 });
    } finally {
        sample.cleanup();
    }
});

test('a sufficiently populated world feed projects moments with zero extra generation and then hits cache', async () => {
    const sample = fixture({
        news: [
            { id: 'n1', headline: '公告一', summary: '公开内容一' },
            { id: 'n2', headline: '公告二', summary: '公开内容二' },
        ],
        forums: [{ id: 'f1', title: '讨论一', summary: '公开讨论', replies: [] }],
        moments: [{
            id: 'm1',
            personId: 'p1',
            text: '今天去买花了。',
            visibility: 'friends',
            likes: 2,
            comments: [],
        }],
    });
    try {
        const host = await install(sample);
        const first = await host.requestPhoneFeed({ platform: 'weibo' });
        assert.equal(first.generated, false);
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 0 });
        const projected = host.getPhoneSurface();
        assert.ok(projected.publicOpinion.forums.some(
            item => item.sourceKind === 'moment' && item.summary.includes('买花'),
        ));
        const second = await host.requestPhoneFeed({ platform: 'weibo' });
        assert.equal(second.cacheHit, true);
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 0 });
    } finally {
        sample.cleanup();
    }
});

test('moment comments, likes and author display changes invalidate the projected feed cache without extra generation', async () => {
    const sample = fixture({
        news: [
            { id: 'n1', headline: '公告一', summary: '公开内容一' },
            { id: 'n2', headline: '公告二', summary: '公开内容二' },
        ],
        forums: [{ id: 'f1', title: '讨论一', summary: '公开讨论', replies: [] }],
        moments: [{
            id: 'm1',
            personId: 'p1',
            text: '今天去买花了。',
            visibility: 'friends',
            likes: 2,
            comments: [],
        }],
    });
    try {
        const host = await install(sample);
        await host.requestPhoneFeed({ platform: 'weibo' });
        sample.surface.social.moments[0].likes = 4;
        sample.surface.social.moments[0].comments.push({
            id: 'c1',
            authorId: 'user',
            authorName: '你',
            text: '花很好看。',
            createdAt: '2026-10-13T00:02:00.000Z',
        });
        sample.surface.people[0].name = '阿青改名';
        const refreshed = await host.requestPhoneFeed({ platform: 'weibo' });
        assert.equal(refreshed.cacheHit, false);
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 0 });
        const projected = host.getPhoneSurface();
        const moment = projected.publicOpinion.forums.find(item => item.sourceKind === 'moment');
        assert.equal(moment.board, '阿青改名');
        assert.equal(moment.heat, 4);
        assert.ok(moment.replies.some(reply => reply.text === '花很好看。'));
    } finally {
        sample.cleanup();
    }
});

test('a sparse RedNote feed asks the existing non-canon world sandbox once and caches the result', async () => {
    const sample = fixture({
        news: [{ id: 'n1', headline: '行业公告', summary: '与生活内容无关', category: '工业' }],
    });
    try {
        const host = await install(sample);
        const first = await host.requestPhoneFeed({ platform: 'rednote' });
        assert.equal(first.usedSandboxGeneration, true);
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 1 });
        const projected = host.getPhoneSurface();
        assert.ok(projected.publicOpinion.news.some(
            item => item.phonePlatform === 'rednote' && item.category === '生活',
        ));
        assert.ok(projected.publicOpinion.forums.some(
            item => item.phonePlatform === 'rednote' && item.scope === '日常生活',
        ));
        await host.requestPhoneFeed({ platform: 'rednote' });
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 1 });
    } finally {
        sample.cleanup();
    }
});

test('open and force requests for the same platform and scope share one in-flight generation', async () => {
    const sample = fixture();
    try {
        const host = await install(sample);
        const originalSandbox = host.generatePublicOpinionSandbox;
        let release;
        let enteredResolve;
        const entered = new Promise(resolve => { enteredResolve = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        host.generatePublicOpinionSandbox = async () => {
            enteredResolve();
            await gate;
            return originalSandbox();
        };

        const first = host.requestPhoneFeed({ platform: 'weibo' });
        await entered;
        const forced = host.requestPhoneFeed({ platform: 'weibo', force: true });
        release();
        const [a, b] = await Promise.all([first, forced]);

        assert.equal(a.sourceSignature, b.sourceSignature);
        assert.deepEqual(sample.counts(), { refreshCalls: 0, sandboxCalls: 1 });
    } finally {
        sample.cleanup();
    }
});

test('switching chats with the same branch key cannot write an old request into the new chat', async () => {
    const sample = fixture();
    try {
        const host = await install(sample);
        const originalSandbox = host.generatePublicOpinionSandbox;
        let release;
        let enteredResolve;
        const entered = new Promise(resolve => { enteredResolve = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        host.generatePublicOpinionSandbox = async () => {
            enteredResolve();
            await gate;
            return originalSandbox();
        };

        const pending = host.requestPhoneFeed({ platform: 'weibo' });
        await entered;
        const otherStore = sample.switchChatSameBranch();
        release();

        await assert.rejects(pending, /切换了聊天或世界分支/);
        assert.equal(sample.store.phoneFeedCacheV1.weibo, undefined);
        assert.equal(otherStore.phoneFeedCacheV1.weibo, undefined);
    } finally {
        sample.cleanup();
    }
});

test('manual refresh uses world-backstage refresh first and discards a result after branch switching', async () => {
    const sample = fixture({
        news: [{ id: 'n1', headline: '公告一', summary: '公开内容一' }],
        forums: [{ id: 'f1', title: '讨论一', summary: '公开讨论', replies: [] }],
        moments: [{ id: 'm1', personId: 'p1', text: '角色动态', visibility: 'friends' }],
    });
    try {
        const host = await install(sample);
        host.refreshPublicOpinion = async () => {
            sample.surface.branchKey = 'branch-B';
        };
        await assert.rejects(
            host.requestPhoneFeed({ platform: 'weibo', force: true }),
            /切换了聊天或世界分支/,
        );
        assert.equal(sample.store.phoneFeedCacheV1.weibo, undefined);
    } finally {
        sample.cleanup();
    }
});