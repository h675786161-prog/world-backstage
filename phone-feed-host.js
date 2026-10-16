import { STATE_KEY } from './core.js';

const PHONE_FEED_BRIDGE_VERSION = 2;
const CACHE_KEY = 'phoneFeedCacheV1';
const SUPPORTED_PLATFORMS = new Set(['weibo', 'rednote']);
const MINIMUM_FEED_ITEMS = Object.freeze({ weibo: 4, rednote: 4 });
const REDNOTE_FRIENDLY = /夜市|市集|散步|生活|美食|旅行|游玩|校园|穿搭|咖啡|餐厅|公园|展览|电影|音乐|购物|探店|体验|日常|照片|图集|景点|住宿|宠物|猫|狗|书|阅读|手作|健身|运动|周末/i;

function text(value, maximum = 1200) {
    return String(value ?? '').trim().slice(0, maximum);
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function context() {
    try { return globalThis.SillyTavern?.getContext?.() || null; } catch { return null; }
}

function storeFromContext(ctx = context()) {
    return ctx?.chatMetadata?.[STATE_KEY]
        || ctx?.chat_metadata?.[STATE_KEY]
        || null;
}

function currentStore() {
    return storeFromContext(context());
}

function currentHost() {
    const host = globalThis.worldBackstageHost;
    return host && typeof host === 'object' ? host : null;
}

function hash(value) {
    const source = String(value || '');
    let result = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        result ^= source.charCodeAt(index);
        result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result.toString(16).padStart(8, '0');
}

function cleanPlatform(value) {
    const platform = text(value, 24).toLowerCase();
    if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error('手机公开信息流只支持微博和小红书');
    return platform;
}

function shallowCloneSurface(surface) {
    return surface && typeof surface === 'object' ? surface : {};
}

function momentCommentDescriptor(comment) {
    return [
        text(comment?.id, 160),
        text(comment?.authorId, 160),
        text(comment?.authorName ?? comment?.author, 80),
        text(comment?.text, 360),
        text(comment?.createdAt, 60),
    ];
}

function visibleMomentDescriptor(moment) {
    return {
        id: text(moment?.id, 160),
        personId: text(moment?.personId, 160),
        text: text(moment?.text, 700),
        imageUrl: text(moment?.imageUrl, 500),
        worldMinute: Math.max(0, Number(moment?.worldMinute) || 0),
        createdAt: text(moment?.createdAt, 60),
        likes: Math.max(0, Number(moment?.likes) || 0),
        likedByUser: Boolean(moment?.likedByUser),
        comments: list(moment?.comments).slice(-8).map(momentCommentDescriptor),
    };
}

function sourceSignature(surface, platform) {
    const opinion = surface?.publicOpinion && typeof surface.publicOpinion === 'object'
        ? surface.publicOpinion
        : {};
    const social = surface?.social && typeof surface.social === 'object' ? surface.social : {};
    const minute = Math.max(0, Number(surface?.clock?.absoluteMinute) || 0);
    const moments = list(social?.moments).filter(moment => moment?.visibility !== 'private');
    const momentAuthorIds = new Set(moments.map(moment => text(moment?.personId, 160)).filter(Boolean));
    const descriptor = {
        platform,
        branchKey: text(surface?.branchKey, 240),
        worldName: text(surface?.worldName, 160),
        worldTimeBucket: Math.floor(minute / 180),
        people: list(surface?.people)
            .filter(person => momentAuthorIds.has(text(person?.id, 160)))
            .map(person => [text(person?.id, 160), text(person?.name, 80)]),
        events: list(surface?.events).map(event => ({
            id: text(event?.id, 160),
            status: text(event?.status, 40),
            publicity: text(event?.publicity, 24),
            publicTrace: text(event?.publicTrace, 420),
            publicHeadline: text(event?.publicHeadline, 240),
            publicSummary: text(event?.publicSummary, 620),
            publicResult: text(event?.publicResult, 620),
        })),
        opinion: {
            generatedAt: text(opinion?.generatedAt, 60),
            sourceWorldMinute: Number(opinion?.sourceWorldMinute) || 0,
            news: list(opinion?.news).map(item => [
                text(item?.id, 160),
                text(item?.headline, 240),
                text(item?.summary, 700),
                text(item?.updatedAt ?? item?.updated_at, 60),
            ]),
            forums: list(opinion?.forums).map(item => [
                text(item?.id, 160),
                text(item?.title, 240),
                text(item?.summary, 700),
                text(item?.updatedAt ?? item?.updated_at, 60),
            ]),
        },
        moments: moments.map(visibleMomentDescriptor),
    };
    return hash(JSON.stringify(descriptor));
}

function cacheRoot(store = currentStore(), { create = true } = {}) {
    if (!store || typeof store !== 'object') return null;
    if (!store[CACHE_KEY] || typeof store[CACHE_KEY] !== 'object') {
        if (!create) return null;
        store[CACHE_KEY] = {};
    }
    return store[CACHE_KEY];
}

function validCache(surface, platform, store = currentStore()) {
    const root = cacheRoot(store, { create: false });
    const cached = root?.[platform];
    if (!cached || typeof cached !== 'object') return null;
    return cached.sourceSignature === sourceSignature(surface, platform) ? cached : null;
}

function dispatchPhoneUpdate(detail = {}) {
    try {
        globalThis.dispatchEvent?.(new CustomEvent('world-backstage:phone-update', { detail }));
    } catch {}
}

function personNameById(surface, personId) {
    const id = text(personId, 160);
    const person = list(surface?.people).find(item => text(item?.id, 160) === id);
    return text(person?.name, 80) || '世界居民';
}

function momentProjection(surface, platform) {
    return list(surface?.social?.moments)
        .filter(moment => moment?.visibility !== 'private')
        .map((moment, index) => {
            const author = personNameById(surface, moment?.personId);
            const body = text(moment?.text, 700);
            const imageUrl = text(moment?.imageUrl, 500);
            if (!body && !imageUrl) return null;
            const replies = list(moment?.comments).map(comment => ({
                author: text(comment?.authorName ?? comment?.author, 60) || '朋友',
                text: text(comment?.text, 360),
            })).filter(reply => reply.text).slice(-8);
            return {
                id: `phonefeed_${platform}_moment_${text(moment?.id, 120) || index}`,
                board: author,
                title: platform === 'rednote' ? `${author}的日常` : `${author}的动态`,
                summary: body || '分享了一张照片。',
                sourceType: 'unofficial',
                scope: platform === 'rednote' ? '日常生活' : '朋友动态',
                claimStatus: 'fact',
                heat: Math.max(1, Math.min(5, Number(moment?.likes) || 1)),
                replies,
                relatedEventId: '',
                worldMinute: Math.max(0, Number(moment?.worldMinute) || 0),
                publishedAt: text(moment?.createdAt, 60),
                updatedAt: text(moment?.createdAt, 60),
                imageUrl,
                phoneFeed: true,
                phonePlatform: platform,
                sourceKind: 'moment',
                sourceMomentId: text(moment?.id, 160),
            };
        })
        .filter(Boolean)
        .slice(-10);
}

function sandboxProjection(publicSurface, platform) {
    const sandbox = publicSurface?.sandbox && typeof publicSurface.sandbox === 'object'
        ? publicSurface.sandbox
        : {};
    const generatedAt = text(sandbox?.generatedAt, 60) || new Date().toISOString();
    const news = list(sandbox?.news).map((item, index) => ({
        id: `phonefeed_${platform}_sandbox_news_${index}_${hash(`${item?.headline || ''}\n${item?.summary || ''}`)}`,
        category: platform === 'rednote' ? '生活' : text(item?.category, 40) || '本地',
        headline: text(item?.headline, 180),
        summary: text(item?.summary, 700),
        source: text(item?.source, 100) || (platform === 'rednote' ? '生活见闻' : '公开信息'),
        sourceType: 'unofficial',
        scope: platform === 'rednote' ? '生活见闻' : '手机闲逛',
        heat: Math.max(1, Math.min(3, Number(item?.heat) || 1)),
        relatedEventId: '',
        publishedAt: generatedAt,
        updatedAt: generatedAt,
        worldMinute: -1,
        nonCanon: true,
        phoneFeed: true,
        phonePlatform: platform,
        sourceKind: 'sandbox',
    })).filter(item => item.headline && item.summary).slice(0, 2);
    const forums = list(sandbox?.forums).map((item, index) => ({
        id: `phonefeed_${platform}_sandbox_forum_${index}_${hash(`${item?.title || ''}\n${item?.summary || ''}`)}`,
        board: platform === 'rednote'
            ? `生活 · ${text(item?.board, 40) || '闲聊'}`
            : text(item?.board, 60) || '闲聊',
        title: text(item?.title, 180),
        summary: text(item?.summary, 700),
        sourceType: 'unofficial',
        scope: platform === 'rednote' ? '日常生活' : '手机闲逛',
        claimStatus: 'rumor',
        heat: Math.max(1, Math.min(5, Number(item?.heat) || 1)),
        replies: list(item?.replies).map(reply => ({
            author: text(reply?.author, 60) || '匿名',
            text: text(reply?.text, 360),
        })).filter(reply => reply.text).slice(0, 4),
        relatedEventId: '',
        publishedAt: generatedAt,
        updatedAt: generatedAt,
        worldMinute: -1,
        nonCanon: true,
        phoneFeed: true,
        phonePlatform: platform,
        sourceKind: 'sandbox',
    })).filter(item => item.title && item.summary).slice(0, 4);
    return { news, forums };
}

function canonicalItemCount(surface, platform) {
    const opinion = surface?.publicOpinion && typeof surface.publicOpinion === 'object'
        ? surface.publicOpinion
        : {};
    const moments = list(surface?.social?.moments).filter(moment => moment?.visibility !== 'private').length;
    if (platform === 'weibo') {
        return moments + list(opinion?.news).length + list(opinion?.forums).length;
    }
    const friendlyNews = list(opinion?.news).filter(item => REDNOTE_FRIENDLY.test([
        item?.category, item?.scope, item?.headline, item?.summary,
    ].map(value => text(value, 700)).join(' '))).length;
    const friendlyForums = list(opinion?.forums).filter(item => REDNOTE_FRIENDLY.test([
        item?.board, item?.scope, item?.title, item?.summary,
    ].map(value => text(value, 700)).join(' '))).length;
    return moments + friendlyNews + friendlyForums;
}

function mergeUnique(baseItems, extraItems, keyFor) {
    const seen = new Set();
    const result = [];
    for (const item of [...list(baseItems), ...list(extraItems)]) {
        const key = keyFor(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

function mergeCacheIntoSurface(surface, cached, platform) {
    if (!cached) return surface;
    const publicOpinion = surface?.publicOpinion && typeof surface.publicOpinion === 'object'
        ? surface.publicOpinion
        : {};
    return {
        ...surface,
        publicOpinion: {
            ...publicOpinion,
            news: mergeUnique(publicOpinion.news, cached.news, item => `news:${text(item?.id, 180)}`),
            forums: mergeUnique(publicOpinion.forums, cached.forums, item => `forum:${text(item?.id, 180)}`),
            phoneFeed: {
                platform,
                generatedAt: cached.generatedAt,
                sourceSignature: cached.sourceSignature,
                cacheHit: true,
            },
        },
    };
}

let installedHost = null;
let originalGetPhoneSurface = null;
let activePlatform = '';
const requestsByStore = new WeakMap();

function rawPhoneSurface() {
    return originalGetPhoneSurface?.() || {};
}

function ensureConnected(surface) {
    if (!surface?.connected) throw new Error('世界背面尚未初始化当前聊天');
    if (!text(surface?.branchKey, 240)) throw new Error('世界背面当前分支尚未稳定，稍后再刷新手机');
}

function captureScope(surface) {
    const ctx = context();
    const store = storeFromContext(ctx);
    if (!ctx || !store) throw new Error('世界背面尚未初始化当前聊天');
    return {
        ctx,
        store,
        chatId: text(ctx?.chatId ?? ctx?.getCurrentChatId?.(), 240),
        branchKey: text(surface?.branchKey, 240),
    };
}

function scopeCurrent(scope) {
    const ctx = context();
    const store = storeFromContext(ctx);
    const surface = shallowCloneSurface(rawPhoneSurface());
    return Boolean(
        scope?.store
        && store === scope.store
        && text(ctx?.chatId ?? ctx?.getCurrentChatId?.(), 240) === scope.chatId
        && text(surface?.branchKey, 240) === scope.branchKey
    );
}

function assertScopeCurrent(scope) {
    if (!scopeCurrent(scope)) {
        throw new Error('生成期间切换了聊天或世界分支，本次手机刷新已作废');
    }
}

function flightMapFor(store) {
    let map = requestsByStore.get(store);
    if (!map) {
        map = new Map();
        requestsByStore.set(store, map);
    }
    return map;
}

function saveCache(scope, platform, entry) {
    assertScopeCurrent(scope);
    const root = cacheRoot(scope.store);
    if (!root) throw new Error('当前聊天没有可写入的世界背面存档');
    root[platform] = entry;
    scope.ctx?.saveMetadataDebounced?.();
}

async function requestPhoneFeed(options = {}) {
    const host = currentHost();
    if (!host || host !== installedHost || typeof originalGetPhoneSurface !== 'function') {
        throw new Error('世界背面手机信息流桥尚未就绪');
    }
    const platform = cleanPlatform(options?.platform);
    const force = Boolean(options?.force);
    activePlatform = platform;

    const before = shallowCloneSurface(rawPhoneSurface());
    ensureConnected(before);
    const scope = captureScope(before);
    const flights = flightMapFor(scope.store);
    const flightKey = `${platform}:${scope.branchKey}`;
    if (flights.has(flightKey)) return flights.get(flightKey);

    const cached = !force ? validCache(before, platform, scope.store) : null;
    if (cached) {
        dispatchPhoneUpdate({ kind: 'phone-feed-cache', platform, cacheHit: true });
        return { platform, cacheHit: true, generated: false, ...cached };
    }

    let task;
    task = (async () => {
        const beforeOpinionSignature = hash(JSON.stringify(before?.publicOpinion || {}));
        let usedPublicOpinionRefresh = false;
        let usedSandboxGeneration = false;

        if (force && typeof host.refreshPublicOpinion === 'function') {
            await host.refreshPublicOpinion();
            assertScopeCurrent(scope);
            usedPublicOpinionRefresh = true;
        }

        let current = shallowCloneSurface(rawPhoneSurface());
        ensureConnected(current);
        assertScopeCurrent(scope);

        const opinionChanged = hash(JSON.stringify(current?.publicOpinion || {})) !== beforeOpinionSignature;
        const sparse = canonicalItemCount(current, platform) < (MINIMUM_FEED_ITEMS[platform] || 4);
        if (
            typeof host.generatePublicOpinionSandbox === 'function'
            && (sparse || (force && !opinionChanged))
        ) {
            await host.generatePublicOpinionSandbox();
            assertScopeCurrent(scope);
            usedSandboxGeneration = true;
            current = shallowCloneSurface(rawPhoneSurface());
            ensureConnected(current);
        }

        assertScopeCurrent(scope);
        const publicSurface = typeof host.getPublicSurface === 'function'
            ? host.getPublicSurface()
            : {};
        const projectedMoments = momentProjection(current, platform);
        const filler = usedSandboxGeneration
            ? sandboxProjection(publicSurface, platform)
            : { news: [], forums: [] };
        const entry = {
            sourceSignature: sourceSignature(current, platform),
            generatedAt: new Date().toISOString(),
            news: filler.news,
            forums: [...projectedMoments, ...filler.forums].slice(-16),
            usedPublicOpinionRefresh,
            usedSandboxGeneration,
        };
        saveCache(scope, platform, entry);
        dispatchPhoneUpdate({
            kind: 'phone-feed-ready',
            platform,
            cacheHit: false,
            usedPublicOpinionRefresh,
            usedSandboxGeneration,
        });
        return {
            platform,
            cacheHit: false,
            generated: usedPublicOpinionRefresh || usedSandboxGeneration,
            ...entry,
        };
    })().finally(() => {
        if (flights.get(flightKey) === task) flights.delete(flightKey);
    });
    flights.set(flightKey, task);
    return task;
}

function activatePhoneFeed(platformValue) {
    const platform = cleanPlatform(platformValue);
    activePlatform = platform;
    dispatchPhoneUpdate({ kind: 'phone-feed-activate', platform });
    return validCache(rawPhoneSurface(), platform);
}

function peekPhoneFeed(platformValue) {
    const platform = cleanPlatform(platformValue);
    return validCache(rawPhoneSurface(), platform);
}

function clearPhoneFeedCache(platformValue = '') {
    const root = cacheRoot(currentStore(), { create: false });
    if (!root) return false;
    const platform = text(platformValue, 24).toLowerCase();
    if (platform && SUPPORTED_PLATFORMS.has(platform)) delete root[platform];
    else {
        for (const key of SUPPORTED_PLATFORMS) delete root[key];
    }
    context()?.saveMetadataDebounced?.();
    dispatchPhoneUpdate({ kind: 'phone-feed-clear', platform: platform || 'all' });
    return true;
}

export function installWorldPhoneFeedBridge() {
    const host = currentHost();
    if (!host || typeof host.getPhoneSurface !== 'function') return null;
    if (
        host.phoneFeedBridgeVersion >= PHONE_FEED_BRIDGE_VERSION
        && typeof host.requestPhoneFeed === 'function'
    ) {
        installedHost = host;
        return host;
    }

    installedHost = host;
    originalGetPhoneSurface = host.getPhoneSurface.bind(host);
    host.getPhoneSurface = () => {
        const surface = shallowCloneSurface(rawPhoneSurface());
        if (!surface?.connected || !activePlatform) return surface;
        const cached = validCache(surface, activePlatform);
        return mergeCacheIntoSurface(surface, cached, activePlatform);
    };
    host.phoneFeedBridgeVersion = PHONE_FEED_BRIDGE_VERSION;
    // Use the raw public surface, excluding our own projected cache. This lets
    // phones detect real source changes without a refresh -> update loop.
    host.getPhoneFeedSourceSignature = platform => {
        const surface = rawPhoneSurface();
        return surface?.connected
            ? sourceSignature(surface, cleanPlatform(platform))
            : '';
    };
    host.requestPhoneFeed = requestPhoneFeed;
    host.activatePhoneFeed = activatePhoneFeed;
    host.peekPhoneFeed = peekPhoneFeed;
    host.clearPhoneFeedCache = clearPhoneFeedCache;
    globalThis.worldBackstageHost = host;
    try {
        globalThis.dispatchEvent?.(new CustomEvent('world-backstage:phone-feed-ready', {
            detail: { bridgeVersion: PHONE_FEED_BRIDGE_VERSION },
        }));
    } catch {}
    return host;
}

installWorldPhoneFeedBridge();