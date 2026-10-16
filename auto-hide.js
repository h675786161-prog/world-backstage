export let AUTO_HIDE_KEEP_RECENT_MESSAGES = 5;
export const AUTO_HIDE_KEEP_RECENT_MIN = 0;
export const AUTO_HIDE_KEEP_RECENT_MAX = 100;
export const AUTO_HIDDEN_MESSAGE_KEY = 'world_backstage_auto_hidden';

function normalizedInteger(value, fallback = -1) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
}

export function normalizeAutoHideKeepRecentMessages(value, fallback = 5) {
    const safeFallback = Math.min(
        AUTO_HIDE_KEEP_RECENT_MAX,
        Math.max(AUTO_HIDE_KEEP_RECENT_MIN, normalizedInteger(fallback, 5)),
    );
    return Math.min(
        AUTO_HIDE_KEEP_RECENT_MAX,
        Math.max(AUTO_HIDE_KEEP_RECENT_MIN, normalizedInteger(value, safeFallback)),
    );
}

export function setAutoHideKeepRecentMessages(value) {
    AUTO_HIDE_KEEP_RECENT_MESSAGES = normalizeAutoHideKeepRecentMessages(
        value,
        AUTO_HIDE_KEEP_RECENT_MESSAGES,
    );
    return AUTO_HIDE_KEEP_RECENT_MESSAGES;
}

export function autoHideThroughMessageId(chatLength, indexedThroughMessageId, keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES) {
    const length = Math.max(0, normalizedInteger(chatLength, 0));
    if (!length) return -1;

    const indexedThrough = Math.min(
        length - 1,
        Math.max(-1, normalizedInteger(indexedThroughMessageId, -1)),
    );
    const keep = normalizeAutoHideKeepRecentMessages(keepRecent, AUTO_HIDE_KEEP_RECENT_MESSAGES);
    return indexedThrough - keep;
}

export function autoHideCandidateMessageIds(chat, indexedThroughMessageId, {
    keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES,
    summaries = null,
} = {}) {
    const messages = Array.isArray(chat) ? chat : [];
    const hideThrough = autoHideThroughMessageId(messages.length, indexedThroughMessageId, keepRecent);
    if (hideThrough < 0) return [];

    const covered = summaries === null ? null : new Set(
        (Array.isArray(summaries) ? summaries : [])
            .filter(item => Number(item?.level) === 0 && String(item?.summary || '').trim())
            .filter(item => Number(item?.startMessageId) === Number(item?.endMessageId))
            .map(item => Number(item.endMessageId)),
    );
    const ids = [];
    for (let messageId = 0; messageId <= hideThrough; messageId += 1) {
        const message = messages[messageId];
        if (!message || message.is_system) continue;
        if (covered && String(message.mes || '').trim() && !covered.has(messageId)) continue;
        ids.push(messageId);
    }
    return ids;
}

export function autoHiddenMessageIds(chat) {
    const messages = Array.isArray(chat) ? chat : [];
    const ids = [];
    for (let messageId = 0; messageId < messages.length; messageId += 1) {
        const message = messages[messageId];
        if (message?.extra?.[AUTO_HIDDEN_MESSAGE_KEY]) ids.push(messageId);
    }
    return ids;
}

export function markAutoHiddenMessages(chat, indexedThroughMessageId, {
    keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES,
    hiddenAt = new Date().toISOString(),
    summaries = null,
} = {}) {
    const messages = Array.isArray(chat) ? chat : [];
    const resolvedKeepRecent = normalizeAutoHideKeepRecentMessages(
        keepRecent,
        AUTO_HIDE_KEEP_RECENT_MESSAGES,
    );
    const messageIds = autoHideCandidateMessageIds(messages, indexedThroughMessageId, {
        keepRecent: resolvedKeepRecent,
        summaries,
    });
    for (const messageId of messageIds) {
        const message = messages[messageId];
        if (!message || message.is_system) continue;
        message.is_system = true;
        message.extra ||= {};
        message.extra[AUTO_HIDDEN_MESSAGE_KEY] = {
            version: 1,
            hiddenAt,
            indexedThroughMessageId: Number(indexedThroughMessageId),
            keepRecent: resolvedKeepRecent,
        };
    }
    return messageIds;
}

export function restoreAutoHiddenMessages(chat) {
    const messages = Array.isArray(chat) ? chat : [];
    const messageIds = autoHiddenMessageIds(messages);
    for (const messageId of messageIds) {
        const message = messages[messageId];
        if (!message?.extra?.[AUTO_HIDDEN_MESSAGE_KEY]) continue;
        message.is_system = false;
        delete message.extra[AUTO_HIDDEN_MESSAGE_KEY];
    }
    return messageIds;
}
