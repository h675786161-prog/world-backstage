import { STATE_KEY } from './core.js';
import {
    appendUserSocialMessage,
    openDirectConversation,
    createGroupConversation,
    respondIncomingFriendRequest,
    markSocialNoticeRead,
    normalizeSocialState,
    toggleMomentLike,
} from './social-terminal.js';
import { emptyPublicOpinionCache, normalizePublicOpinionCache } from './public-opinion.js';

const PHONE_BRIDGE_VERSION = 2;
export const PHONE_CAPABILITIES = Object.freeze([
    'social-open-direct', 'social-create-group', 'social-respond-friend',
    'social-comment-moment', 'social-send-message', 'social-read-conversation',
    'social-set-moment-like',
]);

function context() {
    try { return globalThis.SillyTavern?.getContext?.() || null; } catch { return null; }
}

function text(value, fallback = '') {
    const clean = String(value ?? '').trim();
    return clean || fallback;
}

function storeFromContext(ctx = context()) {
    return ctx?.chatMetadata?.[STATE_KEY]
        || ctx?.chat_metadata?.[STATE_KEY]
        || null;
}

function capturePhoneScope() {
    const ctx = context();
    const store = storeFromContext(ctx);
    return {
        ctx,
        store,
        metadata: ctx?.chatMetadata ?? ctx?.chat_metadata,
        chatId: text(ctx?.chatId ?? ctx?.getCurrentChatId?.()),
        branchKey: text(store?.currentState?.lastCommit?.sourceKey
            ?? store?.currentState?.lastCommit?.source_key
            ?? store?.branchSurfaceHistory?.activeKey),
    };
}

function scopeCurrent(scope) {
    const current = context();
    const store = storeFromContext(current);
    const branchKey = text(store?.currentState?.lastCommit?.sourceKey
        ?? store?.currentState?.lastCommit?.source_key
        ?? store?.branchSurfaceHistory?.activeKey);
    return Boolean(scope?.store && store === scope.store
        && (current?.chatMetadata ?? current?.chat_metadata) === scope.metadata
        && text(current?.chatId ?? current?.getCurrentChatId?.()) === scope.chatId
        && branchKey === scope.branchKey);
}

async function save(ctx, store, scope) {
    if (!scopeCurrent(scope)) throw new Error('聊天或分支已经切换，写入已取消');
    if (typeof ctx?.saveMetadata !== 'function') {
        throw new Error('酒馆未提供可确认的聊天元数据保存接口');
    }
    try {
        await ctx.saveMetadata();
    } catch (error) {
        throw new Error(`世界背面手机操作保存失败：${text(error?.message, '请稍后重试')}`);
    }
    if (!scopeCurrent(scope)) throw new Error('聊天或分支已切换，旧操作结果不得写入当前手机');
}

function dispatchUpdate(detail = {}) {
    try {
        globalThis.dispatchEvent?.(new CustomEvent('world-backstage:phone-update', { detail }));
    } catch {}
}

function phoneVisiblePersonIds(social) {
    const ids = new Set();
    for (const connection of social?.connections || []) {
        const personId = text(connection?.personId);
        if (personId) ids.add(personId);
    }
    for (const conversation of social?.conversations || []) {
        for (const rawId of conversation?.memberIds || []) {
            const personId = text(rawId);
            if (personId) ids.add(personId);
        }
    }
    for (const moment of social?.moments || []) {
        if (moment?.visibility === 'private') continue;
        const personId = text(moment?.personId);
        if (personId) ids.add(personId);
    }
    for (const notice of social?.notices || []) {
        const personId = text(notice?.personId);
        if (personId) ids.add(personId);
    }
    return ids;
}

function phonePersonView(person) {
    const avatarDataUrl = text(person?.avatarDataUrl ?? person?.avatar_data_url);
    return {
        id: text(person?.id),
        name: text(person?.name, '未命名人物'),
        monogram: text(person?.monogram, text(person?.name, '?').slice(0, 1)),
        avatarDataUrl: /^(?:data:image\/|https?:\/\/)/i.test(avatarDataUrl) ? avatarDataUrl : '',
    };
}

function phoneEventView(event) {
    if (text(event?.publicity).toLowerCase() !== 'public') return null;
    const publicTrace = text(event?.publicTrace ?? event?.public_trace);
    const publicHeadline = text(event?.publicHeadline ?? event?.public_headline);
    const publicSummary = text(event?.publicSummary ?? event?.public_summary);
    const publicResult = text(event?.publicResult ?? event?.public_result);
    if (!publicTrace && !publicHeadline && !publicSummary && !publicResult) return null;
    return {
        id: text(event?.id),
        status: text(event?.status),
        publicity: 'public',
        publicTrace,
        publicHeadline,
        publicSummary,
        publicResult,
    };
}

function unreadByConversation(social) {
    const counts = new Map();
    for (const notice of social?.notices || []) {
        if (text(notice?.kind) !== 'message' || text(notice?.readAt)) continue;
        const conversationId = text(notice?.conversationId);
        if (!conversationId) continue;
        counts.set(conversationId, (counts.get(conversationId) || 0) + 1);
    }
    return counts;
}

function phoneSocialView(social) {
    const unreadCounts = unreadByConversation(social);
    return {
        schemaVersion: Number(social?.schemaVersion) || 0,
        activeConversationId: text(social?.activeConversationId),
        conversations: (social?.conversations || []).map(conversation => ({
            id: text(conversation?.id),
            type: conversation?.type === 'group' ? 'group' : 'direct',
            title: text(conversation?.title, '未命名会话'),
            memberIds: Array.isArray(conversation?.memberIds) ? [...conversation.memberIds] : [],
            unread: unreadCounts.get(text(conversation?.id)) || 0,
            rawMessages: (conversation?.rawMessages || []).map(message => ({
                id: text(message?.id),
                senderId: text(message?.senderId),
                senderName: text(message?.senderName),
                text: text(message?.text),
                worldMinute: Math.max(0, Number(message?.worldMinute) || 0),
                createdAt: text(message?.createdAt),
            })),
            createdAt: text(conversation?.createdAt),
            updatedAt: text(conversation?.updatedAt),
        })),
        connections: (social?.connections || []).map(connection => ({
            personId: text(connection?.personId),
            status: text(connection?.status),
            requestMessage: text(connection?.requestMessage),
            decisionReply: text(connection?.decisionReply),
            requestedAt: text(connection?.requestedAt),
            respondedAt: text(connection?.respondedAt),
            updatedAt: text(connection?.updatedAt),
        })),
        moments: (social?.moments || []).filter(moment => moment?.visibility !== 'private').map(moment => ({
            id: text(moment?.id),
            personId: text(moment?.personId),
            text: text(moment?.text),
            visibility: moment?.visibility === 'private' ? 'private' : 'friends',
            worldMinute: Math.max(0, Number(moment?.worldMinute) || 0),
            imageUrl: text(moment?.imageUrl),
            comments: (Array.isArray(moment?.comments) ? moment.comments : []).map(comment => ({
                id: text(comment?.id), authorId: text(comment?.authorId),
                authorName: text(comment?.authorName), text: text(comment?.text),
                createdAt: text(comment?.createdAt),
            })).filter(comment => comment.id && comment.text).slice(-50),
            likedByUser: Boolean(moment?.likedByUser),
            likes: Math.max(0, Number(moment?.likes) || 0),
            createdAt: text(moment?.createdAt),
        })),
        notices: (social?.notices || []).map(notice => ({
            id: text(notice?.id),
            kind: text(notice?.kind),
            personId: text(notice?.personId),
            conversationId: text(notice?.conversationId),
            text: text(notice?.text),
            createdAt: text(notice?.createdAt),
            readAt: text(notice?.readAt),
        })),
        momentsUpdatedAt: text(social?.momentsUpdatedAt),
        momentsUpdatedWorldMinute: Number.isFinite(Number(social?.momentsUpdatedWorldMinute))
            ? Number(social.momentsUpdatedWorldMinute)
            : -1,
    };
}

function phonePublicOpinionView(cache, events = []) {
    const sources = Array.isArray(events) ? events : [];
    const newsIds = new Set(sources.filter(event => text(event?.publicity) === 'public')
        .map(event => text(event?.id)).filter(Boolean));
    const forumIds = new Set(sources.filter(event => ['public', 'trace'].includes(text(event?.publicity)))
        .map(event => text(event?.id)).filter(Boolean));
    const isVisibleSource = allowed => item => {
        const eventId = text(item?.relatedEventId);
        return Boolean(eventId && allowed.has(eventId));
    };
    return {
        generatedAt: text(cache?.generatedAt),
        sourceWorldMinute: Number.isFinite(Number(cache?.sourceWorldMinute))
            ? Number(cache.sourceWorldMinute)
            : -1,
        news: (cache?.news || []).filter(isVisibleSource(newsIds)).map(item => ({ ...item })),
        forums: (cache?.forums || []).filter(isVisibleSource(forumIds)).map(item => ({
            ...item, replies: (item?.replies || []).map(reply => ({ ...reply })),
        })),
    };
}

export function getWorldPhoneSurface() {
    const ctx = context();
    const store = storeFromContext(ctx);
    const state = store?.currentState || null;
    const allPeople = Array.isArray(state?.people) ? state.people : [];
    const social = normalizeSocialState(store?.social, allPeople);
    const visiblePersonIds = phoneVisiblePersonIds(social);
    const publicOpinion = normalizePublicOpinionCache(store?.publicOpinion || emptyPublicOpinionCache());
    return {
        connected: Boolean(ctx && store && state),
        bridgeVersion: PHONE_BRIDGE_VERSION,
        capabilities: ctx && store && state ? [...PHONE_CAPABILITIES] : [],
        schemaVersion: Number(store?.schemaVersion) || 0,
        worldName: text(state?.world?.name ?? state?.worldName, '主世界'),
        clock: state?.clock && typeof state.clock === 'object' ? { ...state.clock } : {},
        people: allPeople
            .filter(person => visiblePersonIds.has(text(person?.id)))
            .map(phonePersonView),
        events: (Array.isArray(state?.events) ? state.events : [])
            .map(phoneEventView)
            .filter(Boolean),
        social: phoneSocialView(social),
        publicOpinion: phonePublicOpinionView(publicOpinion, state?.events),
        branchKey: text(
            state?.lastCommit?.sourceKey
            ?? state?.lastCommit?.source_key
            ?? store?.branchSurfaceHistory?.activeKey,
        ),
    };
}

let phoneWriteTail = Promise.resolve();
export function handleWorldPhoneAction(action, payload = {}) {
    const scope = capturePhoneScope();
    const task = phoneWriteTail.then(() => applyWorldPhoneAction(action, payload, scope));
    phoneWriteTail = task.catch(() => {});
    return task;
}

async function applyWorldPhoneAction(action, payload, scope) {
    if (!scopeCurrent(scope)) throw new Error('聊天或分支已切换，请重新操作');
    const { ctx, store } = scope;
    const originalSocial = store?.social;
    try {
    const state = store?.currentState;
    if (!ctx || !store || !state) throw new Error('世界背面尚未建立当前世界状态');
    const people = Array.isArray(state.people) ? state.people : [];
    const kind = text(action);

    if (kind === 'social-open-direct') {
        const person = people.find(item => text(item.id) === text(payload.personId));
        store.social = openDirectConversation(store.social, person, people);
        await save(ctx, store, scope); dispatchUpdate({kind});
        return getWorldPhoneSurface();
    }
    if (kind === 'social-create-group') {
        const memberIds = Array.isArray(payload.memberIds) ? payload.memberIds : [];
        const accepted = new Set(normalizeSocialState(store.social, people).connections.filter(item => item.status === 'accepted').map(item => item.personId));
        if (memberIds.some(id => typeof id !== 'string' || !accepted.has(id))) throw new Error('只能邀请已添加的通讯好友');
        store.social = createGroupConversation(store.social, {title:payload.title, memberIds}, people);
        await save(ctx, store, scope); dispatchUpdate({kind});
        return getWorldPhoneSurface();
    }
    if (kind === 'social-respond-friend') {
        if (typeof payload.accept !== 'boolean') throw new Error('请选择接受或拒绝');
        store.social = respondIncomingFriendRequest(store.social, state, payload.personId, payload.accept);
        await save(ctx, store, scope); dispatchUpdate({kind});
        return getWorldPhoneSurface();
    }
    if (kind === 'social-comment-moment') {
        const social = normalizeSocialState(store.social, people);
        const moment = social.moments.find(item => item.id === text(payload.momentId) && item.visibility !== 'private');
        const body = text(payload.text).slice(0, 500);
        if (!moment) throw new Error('这条动态已不可见');
        if (!body) throw new Error('先写下评论');
        moment.comments ||= [];
        moment.comments.push({id:`comment-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`, authorId:'user', authorName:text(ctx.name1, '你'), text:body, createdAt:new Date().toISOString()});
        moment.comments = moment.comments.slice(-50);
        store.social = social;
        await save(ctx, store, scope); dispatchUpdate({kind, momentId:moment.id});
        return getWorldPhoneSurface();
    }

    if (kind === 'social-send-message') {
        const conversationId = text(payload?.conversationId ?? payload?.conversation_id);
        const body = text(payload?.text).slice(0, 1600);
        if (!conversationId) throw new Error('没有找到要发送的会话');
        if (!body) throw new Error('先写点什么再发送');
        store.social = appendUserSocialMessage(
            store.social,
            conversationId,
            body,
            state.clock?.absoluteMinute,
            people,
        );
        await save(ctx, store, scope);
        dispatchUpdate({ kind, conversationId });
        return getWorldPhoneSurface();
    }

    if (kind === 'social-read-conversation') {
        const conversationId = text(payload?.conversationId ?? payload?.conversation_id);
        let social = normalizeSocialState(store.social, people);
        const matching = social.notices.filter(notice => (
            notice.kind === 'message'
            && notice.conversationId === conversationId
            && !notice.readAt
        ));
        for (const notice of matching) {
            social = markSocialNoticeRead(social, state, notice.id);
        }
        store.social = social;
        if (matching.length) await save(ctx, store, scope);
        dispatchUpdate({ kind, conversationId, count: matching.length });
        return getWorldPhoneSurface();
    }

    if (kind === 'social-set-moment-like') {
        const momentId = text(payload?.momentId ?? payload?.moment_id);
        const desired = Boolean(payload?.liked);
        let social = normalizeSocialState(store.social, people);
        const moment = social.moments.find(item => item.id === momentId && item.visibility !== 'private');
        if (!moment) throw new Error('没有找到这条动态');
        if (Boolean(moment.likedByUser) !== desired) {
            social = toggleMomentLike(social, state, momentId);
            store.social = social;
            await save(ctx, store, scope);
        }
        dispatchUpdate({ kind, momentId, liked: desired });
        return getWorldPhoneSurface();
    }

    throw new Error(`世界小手机动作未授权：${kind || 'unknown'}`);
    } catch (error) {
        // A failed write cannot leave an unconfirmed world state in memory.
        if (store && store.social !== originalSocial) store.social = originalSocial;
        throw error;
    }
}

export function installWorldPhoneBridge() {
    const host = globalThis.worldBackstageHost && typeof globalThis.worldBackstageHost === 'object'
        ? globalThis.worldBackstageHost
        : {};
    host.phoneBridgeVersion = PHONE_BRIDGE_VERSION;
    host.getPhoneSurface = getWorldPhoneSurface;
    host.phoneAction = handleWorldPhoneAction;
    globalThis.worldBackstageHost = host;
    try {
        globalThis.dispatchEvent?.(new CustomEvent('world-backstage:phone-bridge-ready', {
            detail: {
                bridgeVersion: PHONE_BRIDGE_VERSION,
                version: text(host.version),
            },
        }));
    } catch {}
    return host;
}

installWorldPhoneBridge();
