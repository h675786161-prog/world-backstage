import { STATE_KEY } from './core.js';
import {
    appendUserSocialMessage,
    markSocialNoticeRead,
    normalizeSocialState,
    toggleMomentLike,
} from './social-terminal.js';
import { emptyPublicOpinionCache, normalizePublicOpinionCache } from './public-opinion.js';

const PHONE_BRIDGE_VERSION = 2;

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

function save(ctx, store) {
    if (!ctx || !store) return false;
    if (ctx.chatMetadata && typeof ctx.chatMetadata === 'object') ctx.chatMetadata[STATE_KEY] = store;
    if (ctx.chat_metadata && typeof ctx.chat_metadata === 'object') ctx.chat_metadata[STATE_KEY] = store;
    try {
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
            return true;
        }
        if (typeof ctx.saveMetadata === 'function') {
            void Promise.resolve(ctx.saveMetadata()).catch(error => {
                console.error('[世界背面] 小手机桥保存失败', error);
            });
            return true;
        }
    } catch (error) {
        console.error('[世界背面] 小手机桥保存失败', error);
    }
    return false;
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

function phoneSocialView(social) {
    return {
        schemaVersion: Number(social?.schemaVersion) || 0,
        activeConversationId: text(social?.activeConversationId),
        conversations: (social?.conversations || []).map(conversation => ({
            id: text(conversation?.id),
            type: conversation?.type === 'group' ? 'group' : 'direct',
            title: text(conversation?.title, '未命名会话'),
            memberIds: Array.isArray(conversation?.memberIds) ? [...conversation.memberIds] : [],
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
        moments: (social?.moments || []).map(moment => ({
            id: text(moment?.id),
            personId: text(moment?.personId),
            text: text(moment?.text),
            visibility: moment?.visibility === 'private' ? 'private' : 'friends',
            worldMinute: Math.max(0, Number(moment?.worldMinute) || 0),
            imageUrl: text(moment?.imageUrl),
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

function phonePublicOpinionView(cache) {
    return {
        generatedAt: text(cache?.generatedAt),
        sourceWorldMinute: Number.isFinite(Number(cache?.sourceWorldMinute))
            ? Number(cache.sourceWorldMinute)
            : -1,
        news: (cache?.news || []).map(item => ({ ...item })),
        forums: (cache?.forums || []).map(item => ({
            ...item,
            replies: (item?.replies || []).map(reply => ({ ...reply })),
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
        publicOpinion: phonePublicOpinionView(publicOpinion),
        branchKey: text(
            state?.lastCommit?.sourceKey
            ?? state?.lastCommit?.source_key
            ?? store?.branchSurfaceHistory?.activeKey,
        ),
    };
}

export function handleWorldPhoneAction(action, payload = {}) {
    const ctx = context();
    const store = storeFromContext(ctx);
    const state = store?.currentState;
    if (!ctx || !store || !state) throw new Error('世界背面尚未建立当前世界状态');
    const people = Array.isArray(state.people) ? state.people : [];
    const kind = text(action);

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
        save(ctx, store);
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
        if (matching.length) save(ctx, store);
        dispatchUpdate({ kind, conversationId, count: matching.length });
        return getWorldPhoneSurface();
    }

    if (kind === 'social-set-moment-like') {
        const momentId = text(payload?.momentId ?? payload?.moment_id);
        const desired = Boolean(payload?.liked);
        let social = normalizeSocialState(store.social, people);
        const moment = social.moments.find(item => item.id === momentId);
        if (!moment) throw new Error('没有找到这条动态');
        if (Boolean(moment.likedByUser) !== desired) {
            social = toggleMomentLike(social, state, momentId);
            store.social = social;
            save(ctx, store);
        }
        dispatchUpdate({ kind, momentId, liked: desired });
        return getWorldPhoneSurface();
    }

    throw new Error(`世界小手机动作未授权：${kind || 'unknown'}`);
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
