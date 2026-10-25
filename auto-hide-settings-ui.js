import {
    AUTO_HIDE_KEEP_RECENT_MESSAGES,
    AUTO_HIDE_KEEP_RECENT_MAX,
    AUTO_HIDE_KEEP_RECENT_MIN,
    markAutoHiddenMessages,
    normalizeAutoHideKeepRecentMessages,
    restoreUnsafeAutoHiddenMessages,
    setAutoHideKeepRecentMessages,
} from './auto-hide.js';

const MODULE_ID = 'world_backstage';
const STATE_KEY = 'world_backstage_v1';
const SETTING_KEY = 'autoHideKeepRecentMessages';
const CONTROL_CLASS = 'wb-auto-hide-keep-setting';

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function getModuleSettings({ create = false } = {}) {
    const context = getContext();
    if (!context?.extensionSettings) return null;
    if (create && (!context.extensionSettings[MODULE_ID] || typeof context.extensionSettings[MODULE_ID] !== 'object')) {
        context.extensionSettings[MODULE_ID] = {};
    }
    return context.extensionSettings[MODULE_ID] || null;
}

function currentKeepRecent() {
    const settings = getModuleSettings();
    const value = settings?.[SETTING_KEY] ?? AUTO_HIDE_KEEP_RECENT_MESSAGES;
    return setAutoHideKeepRecentMessages(value);
}

function setMessageHiddenDomState(messageId, hidden) {
    const node = globalThis.document?.querySelector?.(`.mes[mesid="${Number(messageId)}"]`);
    if (node) node.setAttribute('is_system', String(Boolean(hidden)));
}

function currentWorldState(context) {
    return context?.chatMetadata?.[STATE_KEY]?.currentState || null;
}

async function reconcileAutoHiddenFloors(keepRecent) {
    const context = getContext();
    const settings = getModuleSettings();
    if (
        !context
        || !Array.isArray(context.chat)
        || !settings?.enabled
        || !settings?.memorySystemEnabled
        || !settings?.injectionMemory
        || !settings?.autoHideArchivedFloors
    ) return;

    const state = currentWorldState(context);
    const memory = state?.storyMemory;
    const indexedThroughMessageId = Number(memory?.indexedThroughMessageId ?? -1);

    const restoredIds = restoreUnsafeAutoHiddenMessages(context.chat, indexedThroughMessageId, {
        keepRecent,
        summaries: memory?.summaries || [],
    });
    for (const messageId of restoredIds) setMessageHiddenDomState(messageId, false);

    const hiddenIds = markAutoHiddenMessages(context.chat, indexedThroughMessageId, {
        keepRecent,
        summaries: memory?.summaries || [],
    });
    for (const messageId of hiddenIds) setMessageHiddenDomState(messageId, true);

    if (restoredIds.length || hiddenIds.length) await context.saveChat?.();
}

function updateControlCopies(value) {
    for (const toggle of document.querySelectorAll('input[data-wb-setting="autoHideArchivedFloors"]')) {
        const row = toggle.closest('.wb-setting-toggle');
        const copy = row?.querySelector('div > span');
        if (copy) {
            const text = `长期记忆确认收好后，自动隐藏更早楼层；当前保留最近 ${value} 层已归档正文和全部未归档正文。需要开启长期记忆注入，聊天记录不会删除。`;
            if (copy.textContent !== text) copy.textContent = text;
        }
    }
}

function syncControls(value = currentKeepRecent()) {
    for (const input of document.querySelectorAll('input[data-wb-auto-hide-keep="true"]')) {
        input.value = String(value);
    }
    updateControlCopies(value);
}

function enhanceControls() {
    const value = currentKeepRecent();
    for (const toggle of document.querySelectorAll('input[data-wb-setting="autoHideArchivedFloors"]')) {
        const row = toggle.closest('.wb-setting-toggle');
        if (!row || row.dataset.wbAutoHideCustomReady === 'true') continue;
        row.dataset.wbAutoHideCustomReady = 'true';

        const label = document.createElement('label');
        label.className = `wb-number-setting ${CONTROL_CLASS}`;
        label.innerHTML = `保留最近已归档正文（层）<input type="number" min="${AUTO_HIDE_KEEP_RECENT_MIN}" max="${AUTO_HIDE_KEEP_RECENT_MAX}" step="1" data-wb-auto-hide-keep="true" value="${value}">`;
        row.insertAdjacentElement('afterend', label);
    }
    syncControls(value);
}

async function persistKeepRecent(rawValue) {
    const value = normalizeAutoHideKeepRecentMessages(rawValue, currentKeepRecent());
    const settings = getModuleSettings({ create: true });
    const context = getContext();
    if (!settings || !context) return;

    settings[SETTING_KEY] = value;
    setAutoHideKeepRecentMessages(value);
    syncControls(value);
    context.saveSettingsDebounced?.();
    await reconcileAutoHiddenFloors(value);
}

function start() {
    currentKeepRecent();
    enhanceControls();

    document.addEventListener('change', event => {
        const input = event.target?.closest?.('input[data-wb-auto-hide-keep="true"]');
        if (!input) return;
        void persistKeepRecent(input.value).catch(error => {
            console.warn('[世界背面] 更新自动隐藏保留层数失败', error);
        });
    }, true);

    const observer = new MutationObserver(() => enhanceControls());
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}
