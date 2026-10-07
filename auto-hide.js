export const AUTO_HIDE_KEEP_RECENT_MESSAGES = 5;
export const AUTO_HIDDEN_MESSAGE_KEY = 'world_backstage_auto_hidden';

export function isRecallableStorySummary(item) {
    const text = String(item?.summary || '').trim();
    return Boolean(text) && !/^细节已(?:收进上层记忆|由.+概括)/u.test(text);
}

export function messageMemoryFingerprint(message) {
    const text = JSON.stringify([String(message?.mes || ''), Boolean(message?.is_user), Number(message?.swipe_id || 0)]);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function coveredMessageIds(messages, summaries) {
    if (summaries === null) return null;
    return new Set((Array.isArray(summaries) ? summaries : [])
        .filter(item => Number(item?.level) === 0 && !item?.manual && isRecallableStorySummary(item))
        .filter(item => Number(item?.startMessageId) === Number(item?.endMessageId))
        .filter(item => !item.sourceFingerprint
            || item.sourceFingerprint === messageMemoryFingerprint(messages[Number(item.endMessageId)]))
        .map(item => Number(item.endMessageId)));
}

function normalizedInteger(value, fallback = -1) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
}

export function autoHideThroughMessageId(chatLength, indexedThroughMessageId, keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES) {
    const length = Math.max(0, normalizedInteger(chatLength, 0));
    if (!length) return -1;

    const indexedThrough = Math.min(
        length - 1,
        Math.max(-1, normalizedInteger(indexedThroughMessageId, -1)),
    );
    const keep = Math.max(0, normalizedInteger(keepRecent, AUTO_HIDE_KEEP_RECENT_MESSAGES));
    return indexedThrough - keep;
}

export function autoHideCandidateMessageIds(chat, indexedThroughMessageId, {
    keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES,
    summaries = null,
} = {}) {
    const messages = Array.isArray(chat) ? chat : [];
    const hideThrough = autoHideThroughMessageId(messages.length, indexedThroughMessageId, keepRecent);
    if (hideThrough < 0) return [];

    const covered = coveredMessageIds(messages, summaries);
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
    const messageIds = autoHideCandidateMessageIds(messages, indexedThroughMessageId, { keepRecent, summaries });
    for (const messageId of messageIds) {
        const message = messages[messageId];
        if (!message || message.is_system) continue;
        // Older archives lack signatures; bind their proven coverage when first hidden.
        for (const item of Array.isArray(summaries) ? summaries : []) {
            if (Number(item.level) === 0 && Number(item.startMessageId) === messageId
                && Number(item.endMessageId) === messageId && isRecallableStorySummary(item)
                && !item.sourceFingerprint) item.sourceFingerprint = messageMemoryFingerprint(message);
        }
        message.is_system = true;
        message.extra ||= {};
        message.extra[AUTO_HIDDEN_MESSAGE_KEY] = {
            version: 1,
            hiddenAt,
            indexedThroughMessageId: Number(indexedThroughMessageId),
            keepRecent,
            sourceFingerprint: messageMemoryFingerprint(message),
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

// A cursor alone never proves that the active branch still has recall coverage.
export function restoreUnsafeAutoHiddenMessages(chat, indexedThroughMessageId, {
    keepRecent = AUTO_HIDE_KEEP_RECENT_MESSAGES,
    summaries = [],
} = {}) {
    const messages = Array.isArray(chat) ? chat : [];
    const covered = coveredMessageIds(messages, summaries);
    const hideThrough = autoHideThroughMessageId(messages.length, indexedThroughMessageId, keepRecent);
    const ids = autoHiddenMessageIds(messages).filter(id => {
        const message = messages[id];
        const marker = message.extra[AUTO_HIDDEN_MESSAGE_KEY];
        return id > hideThrough || !covered?.has(id)
            || (marker.sourceFingerprint && marker.sourceFingerprint !== messageMemoryFingerprint(message));
    });
    for (const id of ids) {
        messages[id].is_system = false;
        delete messages[id].extra[AUTO_HIDDEN_MESSAGE_KEY];
    }
    return ids;
}

export function firstUncoveredStoryMessageId(chat, indexedThroughMessageId, summaries = []) {
    const messages = Array.isArray(chat) ? chat : [];
    const covered = coveredMessageIds(messages, summaries);
    const through = Math.min(messages.length - 1, normalizedInteger(indexedThroughMessageId));
    for (let id = 0; id <= through; id += 1) {
        const message = messages[id];
        if (!message || (message.is_system && !message.extra?.[AUTO_HIDDEN_MESSAGE_KEY])) continue;
        if (String(message.mes || '').trim() && !covered.has(id)) return id;
    }
    return -1;
}
