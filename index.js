import {
    MODULE_ID,
    SCHEMA_VERSION,
    SNAPSHOT_KEY,
    STATE_KEY,
    addManualEvent,
    advanceWorldClock,
    applySimulationResult,
    applyHistoryIndexResult,
    buildInjectionPackage,
    buildHistoryIndexPrompt,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    createSnapshot,
    extractJsonObject,
    hashText,
    markPendingSync,
    recordDeliveryOffers,
    restoreSnapshot,
    setWorldCalendar,
    trimState,
} from './core.js';
import { requestCustomCompletion, runWithRetries } from './api.js';
import { createWorldBackstageUI } from './ui.js';

const PROMPT_KEY = 'world_backstage_authoritative_state';
const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 7,
    enabled: true,
    promptInjection: true,
    autoSync: true,
    autoSimulationMode: 'balanced',
    autoSimulationInterval: 1,
    autoRetryCount: 1,
    memoryAutoIndexInterval: 10,
    backgroundNpcBudget: 4,
    customSimulationInstruction: '',
    theme: 'auto',
    deliveryDensity: 'restrained',
    sceneTiming: 'strict',
    orbPosition: null,
    includeUserInnerVoice: false,
    uiScale: 'comfortable',
    contextTurns: 5,
    timePolicy: 'explicit',
    apiMode: 'tavern',
    customApiUrl: '',
    customApiKey: '',
    customApiModel: '',
    customApiTransport: 'proxy',
    customApiTimeoutMs: 120000,
});

const runtime = {
    initialized: false,
    ui: null,
    transientStore: null,
    injection: { text: '', eventIds: [] },
    generationOffer: { eventIds: [], at: 0 },
    simulationChain: Promise.resolve(),
    simulationCount: 0,
    inBackgroundGeneration: false,
    activeChatToken: '',
    queuedSimulations: new Map(),
    autoMemoryTimer: null,
    manualUndo: null,
    manualUndoTimer: null,
    historyProgress: {
        phase: 'idle',
        processed: 0,
        total: 0,
        message: '',
    },
    syncStatus: {
        phase: 'idle',
        message: '尚未进行世界推演',
        error: '',
        attemptedAt: '',
        succeededAt: '',
        method: '',
    },
};

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function toast(message, tone = 'info') {
    runtime.ui?.notify(message, tone === 'error' ? 'error' : 'normal');
    if (!globalThis.toastr) return;
    const method = ['success', 'warning', 'error', 'info'].includes(tone) ? tone : 'info';
    globalThis.toastr[method](message, '世界背面', { preventDuplicates: true });
}

function normalizeOrbPosition(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
    };
}

function getSettings() {
    const context = getContext();
    if (!context?.extensionSettings) return { ...DEFAULT_SETTINGS };

    const previous = context.extensionSettings[MODULE_ID];
    const previousSettingsVersion = Number(previous?.settingsVersion) || 0;
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(previous && typeof previous === 'object' ? previous : {}),
    };
    settings.enabled = Boolean(settings.enabled);
    settings.promptInjection = Boolean(settings.promptInjection);
    settings.autoSync = Boolean(settings.autoSync);
    settings.includeUserInnerVoice = Boolean(settings.includeUserInnerVoice);
    if (!['auto', 'day', 'night'].includes(settings.theme)) settings.theme = 'auto';
    if (!['restrained', 'balanced', 'active'].includes(settings.deliveryDensity)) {
        settings.deliveryDensity = 'restrained';
    }
    if (!['strict', 'smart', 'open'].includes(settings.sceneTiming)) settings.sceneTiming = 'strict';
    if (!['compact', 'comfortable', 'large'].includes(settings.uiScale)) {
        settings.uiScale = 'comfortable';
    }
    settings.contextTurns = [1, 3, 5].includes(Number(settings.contextTurns))
        ? Number(settings.contextTurns)
        : 5;
    if (previousSettingsVersion < 4) settings.contextTurns = 5;
    if (previousSettingsVersion < 5) {
        settings.autoSimulationMode = previous?.autoSync === false ? 'manual' : 'balanced';
    }
    if (!['manual', 'light', 'balanced', 'deep'].includes(settings.autoSimulationMode)) {
        settings.autoSimulationMode = 'balanced';
    }
    settings.autoSync = settings.autoSimulationMode !== 'manual';
    settings.autoSimulationInterval = Math.min(
        20,
        Math.max(1, Number.parseInt(settings.autoSimulationInterval, 10) || 1),
    );
    settings.autoRetryCount = Math.min(
        5,
        Math.max(0, Number.parseInt(settings.autoRetryCount, 10) || 0),
    );
    settings.memoryAutoIndexInterval = Math.min(
        50,
        Math.max(0, Number.parseInt(settings.memoryAutoIndexInterval, 10) || 0),
    );
    settings.backgroundNpcBudget = Math.min(
        12,
        Math.max(0, Number.parseInt(settings.backgroundNpcBudget, 10) || 0),
    );
    settings.customSimulationInstruction = String(
        settings.customSimulationInstruction || '',
    ).trim().slice(0, 1000);
    settings.settingsVersion = 7;
    if (!['explicit', 'cautious', 'open'].includes(settings.timePolicy)) {
        settings.timePolicy = 'explicit';
    }
    if (!['tavern', 'custom'].includes(settings.apiMode)) settings.apiMode = 'tavern';
    settings.customApiUrl = String(settings.customApiUrl || '').trim().slice(0, 500);
    settings.customApiKey = String(settings.customApiKey || '').trim().slice(0, 1000);
    settings.customApiModel = String(settings.customApiModel || '').trim().slice(0, 180);
    if (!['proxy', 'direct'].includes(settings.customApiTransport)) {
        settings.customApiTransport = 'proxy';
    }
    settings.customApiTimeoutMs = Math.min(
        300000,
        Math.max(15000, Number(settings.customApiTimeoutMs) || 120000),
    );
    settings.orbPosition = normalizeOrbPosition(settings.orbPosition);
    context.extensionSettings[MODULE_ID] = settings;
    if (previousSettingsVersion < 7) context.saveSettingsDebounced?.();
    return settings;
}

function saveSettings() {
    const context = getContext();
    context?.saveSettingsDebounced?.();
}

function makeStore() {
    const initialState = createInitialState({ worldName: '主世界' });
    return {
        schemaVersion: SCHEMA_VERSION,
        initialState,
        currentState: clone(initialState),
        branchOverrides: {},
        updatedAt: new Date().toISOString(),
    };
}

function currentChatToken() {
    const context = getContext();
    if (!context) return 'no-context';
    return String(context.chatId ?? context.groupId ?? context.characterId ?? 'no-chat');
}

function hasChatContext() {
    const context = getContext();
    return Boolean(
        context
        && Array.isArray(context.chat)
        && (
            context.chatId
            || context.groupId
            || context.characterId !== undefined
        )
    );
}

function getStore({ create = true } = {}) {
    const context = getContext();
    const metadata = context?.chatMetadata;

    if (!metadata || typeof metadata !== 'object' || !hasChatContext()) {
        runtime.transientStore ||= makeStore();
        return runtime.transientStore;
    }

    if (!metadata[STATE_KEY] && create) {
        metadata[STATE_KEY] = makeStore();
        context.saveMetadataDebounced?.();
    }

    const store = metadata[STATE_KEY] || runtime.transientStore || makeStore();
    store.schemaVersion = SCHEMA_VERSION;
    store.initialState = trimState(store.initialState || createInitialState({ worldName: '主世界' }));
    store.currentState = trimState(store.currentState || store.initialState);
    store.branchOverrides = store.branchOverrides && typeof store.branchOverrides === 'object'
        ? store.branchOverrides
        : {};
    return store;
}

function saveStore(store, { immediate = false } = {}) {
    const context = getContext();
    store.updatedAt = new Date().toISOString();

    if (!context?.chatMetadata || !hasChatContext()) {
        runtime.transientStore = store;
        return;
    }

    context.chatMetadata[STATE_KEY] = store;
    if (immediate && typeof context.saveMetadata === 'function') {
        void context.saveMetadata();
    } else {
        context.saveMetadataDebounced?.();
    }
}

function getState() {
    return getStore().currentState;
}

function branchSourceKey(messageId, message, swipeId = message?.swipe_id ?? 0) {
    const text = message?.swipes?.[swipeId] ?? message?.mes ?? '';
    return `${messageId}:${swipeId}:${hashText(text)}`;
}

function branchDataFromMessage(message, swipeId = message?.swipe_id ?? 0) {
    const currentData = message?.extra?.[SNAPSHOT_KEY];
    if (currentData && typeof currentData === 'object') return currentData;
    return message?.swipe_info?.[swipeId]?.extra?.[SNAPSHOT_KEY] || null;
}

function latestAssistantEntry() {
    const chat = getContext()?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message && !message.is_user && !message.is_system) return { message, index };
    }
    return null;
}

function getConnectionInfo() {
    const context = getContext();
    const pluginSettings = getSettings();
    if (pluginSettings.apiMode === 'custom') {
        let host = '';
        try {
            host = new URL(pluginSettings.customApiUrl).host;
        } catch {
            host = pluginSettings.customApiUrl;
        }
        return {
            mainApi: 'custom-independent',
            source: 'custom-independent',
            apiLabel: '独立 OpenAI 兼容接口',
            model: pluginSettings.customApiModel || '模型尚未配置',
            profile: host || '接口地址尚未配置',
            online: '',
            method: pluginSettings.customApiTransport === 'direct'
                ? '浏览器直连（不继承酒馆模型）'
                : '经酒馆转发（不继承酒馆模型）',
            configured: Boolean(
                pluginSettings.customApiUrl
                && pluginSettings.customApiKey
                && pluginSettings.customApiModel
            ),
        };
    }

    const settings = context?.chatCompletionSettings || {};
    const mainApi = String(context?.mainApi || 'unknown');
    const source = mainApi === 'openai'
        ? String(settings.chat_completion_source || 'openai')
        : mainApi;
    const latest = latestAssistantEntry()?.message;
    const modelKeys = [
        `${source}_model`,
        'custom_model',
        'openrouter_model',
        'google_model',
        'claude_model',
        'openai_model',
        'model',
    ];
    const configuredModel = modelKeys
        .map(key => settings?.[key])
        .find(value => typeof value === 'string' && value.trim());
    const messageModel = latest?.extra?.model || latest?.model;
    const manager = context?.extensionSettings?.connectionManager || {};
    const selectedProfile = (manager.profiles || []).find(profile => (
        profile?.id === manager.selectedProfile
        || profile?.name === manager.selectedProfile
    ));
    const apiLabels = {
        openai: 'Chat Completion',
        textgenerationwebui: 'Text Completion',
        kobold: 'KoboldAI',
        koboldhorde: 'AI Horde',
        novel: 'NovelAI',
        custom: '自定义兼容接口',
        google: 'Google AI Studio',
        makersuite: 'Google AI Studio',
        openrouter: 'OpenRouter',
        claude: 'Anthropic Claude',
    };

    return {
        mainApi,
        source,
        apiLabel: apiLabels[source] || apiLabels[mainApi] || source || '未识别',
        model: String(configuredModel || selectedProfile?.model || messageModel || '跟随酒馆当前模型'),
        profile: String(selectedProfile?.name || ''),
        online: String(context?.onlineStatus || ''),
        method: typeof context?.generateRaw === 'function' ? '独立上下文推演' : '安静推演兼容模式',
        configured: true,
    };
}

function getSyncStatus() {
    const latest = latestAssistantEntry();
    const branch = latest ? branchDataFromMessage(latest.message) : null;
    let derived = {};

    if (runtime.syncStatus.phase === 'idle' && branch) {
        if (branch.status === 'error') {
            derived = {
                phase: 'error',
                message: '上一次世界推演失败',
                error: branch.error || '推演接口没有提供具体错误',
            };
        } else if (branch.status === 'pending') {
            derived = {
                phase: 'pending',
                message: '最新正文仍在等待推演',
                error: '',
            };
        } else if (branch.status === 'committed') {
            derived = {
                phase: 'success',
                message: '最新正文已经完成推演',
                error: '',
            };
        }
    }

    return {
        ...runtime.syncStatus,
        ...derived,
        connection: getConnectionInfo(),
        userName: String(getContext()?.name1 || ''),
        memory: {
            indexedThroughMessageId: Number(getState().storyMemory?.indexedThroughMessageId ?? -1),
            facts: getState().storyMemory?.facts?.length || 0,
            summaries: getState().storyMemory?.summaries?.length || 0,
            clues: getState().storyMemory?.clues?.length || 0,
            hasDigest: Boolean(getState().storyMemory?.digest?.text),
            pendingAssistantResponses: unindexedAssistantCount(),
            totalMessages: getContext()?.chat?.length || 0,
            ...runtime.historyProgress,
        },
        manualUndo: {
            available: Boolean(
                runtime.manualUndo
                && runtime.manualUndo.expiresAt > Date.now()
                && runtime.manualUndo.chatToken === currentChatToken()
                && runtime.manualUndo.key === currentAnchorKey()
            ),
            label: runtime.manualUndo?.label || '撤销刚才的手动更改',
        },
        presentPersonIds: currentTurnPresentPersonIds(),
    };
}

function setSyncStatus(patch) {
    runtime.syncStatus = {
        ...runtime.syncStatus,
        ...patch,
    };
    runtime.ui?.render();
}

function describeError(error) {
    const candidates = [
        error?.message,
        error?.error?.message,
        error?.response,
        typeof error === 'string' ? error : '',
    ];
    let message = candidates
        .map(value => String(value || '').trim())
        .find(Boolean) || '';

    if (!message || message === '<none>' || message === '[object Object]') {
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== '{}' && serialized !== '"<none>"') message = serialized;
        } catch {
            // Ignore serialization errors and use the actionable fallback below.
        }
    }
    if (!message || message === '<none>' || message === '[object Object]') {
        return '推演接口没有返回具体错误；请先测试世界背面的连接，再重试最新正文';
    }
    return message.slice(0, 420);
}

function retryJsonPrompt(prompt, attempt) {
    if (!(attempt > 0)) return prompt;
    return `${prompt}\n\n<json_retry>\n这是第 ${attempt} 次格式重试。上一次返回无法解析或达到输出上限。请重新生成一个完整、严格、闭合的 JSON 对象；不要沿用被截断的句子，不要代码围栏或解释。优先省略没有变化的可选条目，绝不能省略结尾括号。\n</json_retry>`;
}

function retryTokenBudget(base, attempt) {
    return Math.min(6000, Math.max(64, Number(base) || 2200) + Math.max(0, attempt) * 1200);
}

function unreadableJsonError(raw, subject = '模型') {
    const text = String(raw || '').trim();
    if (!text) return new Error(`${subject}没有返回可读取的 JSON 状态`);
    const compact = text.replace(/\s+/g, ' ');
    const beginning = compact.slice(0, 90);
    const ending = compact.length > 140 ? compact.slice(-70) : '';
    const likelyTruncated = /^[\[{]/.test(compact) && !/[}\]]\s*(?:```)?$/.test(compact);
    const detail = ending ? `开头：${beginning}；结尾：${ending}` : beginning;
    return new Error(
        `${subject}返回的 JSON ${likelyTruncated ? '没有闭合，疑似被输出上限截断' : '格式无效'}`
        + `（${text.length} 字符）：${detail}`,
    );
}

function attachBranchData(message, swipeId, data) {
    if (!message || typeof message !== 'object') return;
    message.extra ||= {};

    if (Number(message.swipe_id ?? 0) === Number(swipeId)) {
        message.extra[SNAPSHOT_KEY] = clone(data);
    }

    const swipeInfo = message.swipe_info?.[swipeId];
    if (swipeInfo && typeof swipeInfo === 'object') {
        swipeInfo.extra ||= {};
        swipeInfo.extra[SNAPSHOT_KEY] = clone(data);
    }
}

function findLatestResultSnapshot(beforeIndex = Infinity) {
    const context = getContext();
    const chat = context?.chat || [];
    const start = Math.min(chat.length - 1, Number(beforeIndex) - 1);

    for (let index = start; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message || message.is_user) continue;
        const data = branchDataFromMessage(message);
        if (data?.status === 'committed' && data.result && !data.stale) {
            return { snapshot: data.result, messageId: index, data };
        }
    }
    return null;
}

function stateWithBranchOverride(snapshot, store = getStore()) {
    const restored = restoreSnapshot(snapshot, store.initialState);
    const sourceKey = snapshot?.meta?.sourceKey || '';
    const override = sourceKey ? store.branchOverrides[sourceKey] : null;
    return override ? restoreSnapshot(override, restored) : restored;
}

function currentAnchorKey() {
    const state = getState();
    return state.lastCommit?.sourceKey || 'root';
}

function setCurrentState(nextState, {
    save = true,
    overrideKey = null,
    immediate = false,
} = {}) {
    const store = getStore();
    store.currentState = trimState(nextState);

    if (overrideKey) {
        store.branchOverrides[overrideKey] = createSnapshot(store.currentState, {
            sourceKey: overrideKey,
            kind: 'manual-override',
        });
        const entries = Object.entries(store.branchOverrides);
        if (entries.length > 48) {
            store.branchOverrides = Object.fromEntries(entries.slice(-48));
        }
    }

    if (save) saveStore(store, { immediate });
    refreshInjection();
    runtime.ui?.render();
    return store.currentState;
}

function restoreLatestBranch({ pending = false } = {}) {
    const store = getStore();
    const latest = findLatestResultSnapshot();
    let state = latest
        ? stateWithBranchOverride(latest.snapshot, store)
        : (
            store.branchOverrides.root
                ? restoreSnapshot(store.branchOverrides.root, store.initialState)
                : clone(store.initialState)
        );
    if (pending) state = markPendingSync(state, true);
    store.currentState = trimState(state);
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
    return store.currentState;
}

function recentChatText(maximum = 8) {
    const chat = getContext()?.chat || [];
    return chat
        .slice(-maximum)
        .map(message => String(message?.mes || ''))
        .join('\n')
        .slice(-9000);
}

function selectedMessageText(message) {
    if (!message) return '';
    if (message.is_user) return String(message.mes || '');
    const swipeId = Number(message.swipe_id ?? 0);
    return String(message.swipes?.[swipeId] ?? message.mes ?? '');
}

function narrativeContext(messageId, maximumTurns = 3) {
    const chat = getContext()?.chat || [];
    const assistant = chat[Number(messageId)];
    let userText = '';
    for (let index = Number(messageId) - 1; index >= 0; index -= 1) {
        if (chat[index]?.is_user) {
            userText = String(chat[index].mes || '');
            break;
        }
    }
    const assistantText = selectedMessageText(assistant);

    let startIndex = 0;
    let userTurns = 0;
    for (let index = Number(messageId); index >= 0; index -= 1) {
        if (chat[index]?.is_user) {
            userTurns += 1;
            if (userTurns >= maximumTurns) {
                startIndex = index;
                break;
            }
        }
    }
    const turns = chat
        .slice(startIndex, Number(messageId) + 1)
        .map((message, offset) => ({ message, messageId: startIndex + offset }))
        .filter(entry => entry.message && !entry.message.is_system)
        .map(({ message, messageId: turnMessageId }) => ({
            messageId: turnMessageId,
            swipeId: message.is_user ? 0 : Number(message.swipe_id ?? 0),
            role: message.is_user ? 'user' : 'assistant',
            content: selectedMessageText(message),
        }))
        .filter(turn => turn.content);

    return {
        latestTurn: {
            user: userText,
            assistant: assistantText,
        },
        turns,
        assistant: String(assistantText),
    };
}

function currentTurnPresentPersonIds() {
    const latest = latestAssistantEntry();
    if (!latest) return [];
    const narrative = narrativeContext(latest.index, 1);
    const text = narrative.turns.map(turn => turn.content).join('\n');
    return getState().people
        .filter(person => (
            Number(person.lastSeenMessageId) === Number(latest.index)
            || (person.name && text.includes(person.name))
        ))
        .map(person => person.id);
}

function pendingAssistantEntriesThrough(messageId) {
    const target = Number(messageId);
    const chat = getContext()?.chat || [];
    const previous = findLatestResultSnapshot(target + 1);
    const start = previous ? previous.messageId + 1 : 0;
    const entries = [];
    for (let index = start; index <= target; index += 1) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const branch = branchDataFromMessage(message);
        if (!branch) continue;
        if (branch?.status === 'committed' && !branch.stale) continue;
        entries.push({ message, index });
    }
    return entries;
}

function nextHistoryBatch(cursor, {
    maximumCharacters = 32000,
    maximumUserTurns = 10,
    maximumAssistantTurns = 10,
} = {}) {
    const chat = getContext()?.chat || [];
    const messages = [];
    let characters = 0;
    let userTurns = 0;
    let assistantTurns = 0;
    let endMessageId = Math.max(-1, Number(cursor) - 1);

    for (let index = Math.max(0, Number(cursor) || 0); index < chat.length; index += 1) {
        if (messages.length && assistantTurns >= maximumAssistantTurns) {
            endMessageId = index - 1;
            break;
        }
        const message = chat[index];
        endMessageId = index;
        if (!message || message.is_system) continue;
        const role = message.is_user ? 'user' : 'assistant';
        const maximum = role === 'user' ? 4000 : 7000;
        const content = selectedMessageText(message).slice(0, maximum);
        if (!content) continue;
        const nextCharacters = characters + content.length;
        const nextUserTurns = userTurns + (role === 'user' ? 1 : 0);
        if (
            messages.length
            && (
                nextCharacters > maximumCharacters
                || nextUserTurns > maximumUserTurns
            )
        ) {
            endMessageId = index - 1;
            break;
        }
        messages.push({
            id: index,
            swipe: message.is_user ? 0 : Number(message.swipe_id ?? 0),
            role,
            content,
        });
        characters = nextCharacters;
        userTurns = nextUserTurns;
        if (role === 'assistant') assistantTurns += 1;
    }

    return {
        messages,
        startMessageId: messages[0]?.id ?? Math.max(0, Number(cursor) || 0),
        endMessageId: messages.at(-1)?.id ?? endMessageId,
        nextCursor: Math.max(Number(cursor) + 1, endMessageId + 1),
        totalMessages: chat.length,
    };
}

function refreshInjection() {
    const context = getContext();
    if (!context?.setExtensionPrompt) return;

    const settings = getSettings();
    const packet = buildInjectionPackage(getState(), settings, recentChatText());
    runtime.injection = packet;

    context.setExtensionPrompt(
        PROMPT_KEY,
        packet.text,
        1,
        0,
        false,
        0,
    );
}

function clearOwnInjection() {
    const context = getContext();
    context?.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
}

function setBusy(value) {
    runtime.simulationCount += value ? 1 : -1;
    runtime.simulationCount = Math.max(0, runtime.simulationCount);
    runtime.ui?.setBusy(runtime.simulationCount > 0);
}

function markMessagePending(messageId, {
    trigger = 'reply',
    offeredEventIds = runtime.generationOffer.eventIds,
} = {}) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user) return null;
    const swipeId = Number(message.swipe_id ?? 0);
    const sourceKey = branchSourceKey(messageId, message, swipeId);
    const existing = branchDataFromMessage(message, swipeId);

    let baseState;
    if (existing?.base && !existing.stale) {
        baseState = restoreSnapshot(existing.base, getStore().initialState);
    } else {
        const previous = findLatestResultSnapshot(messageId);
        baseState = previous
            ? stateWithBranchOverride(previous.snapshot)
            : clone(getState());
    }

    const data = {
        schemaVersion: SCHEMA_VERSION,
        status: 'pending',
        sourceKey,
        trigger,
        offeredEventIds: [...new Set(offeredEventIds || [])],
        base: createSnapshot(baseState, {
            messageId,
            swipeId,
            sourceKey,
            kind: 'base',
        }),
        result: null,
        error: '',
        stale: false,
    };

    attachBranchData(message, swipeId, data);
    void context?.saveChat?.();
    const store = getStore();
    if (currentChatToken() === runtime.activeChatToken) {
        store.currentState = markPendingSync(baseState, true);
        saveStore(store);
        refreshInjection();
        runtime.ui?.render();
    }
    return { data, message, messageId, swipeId, sourceKey, baseState };
}

function locateTargetBranch(messageId, swipeId, expectedHash) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message) return null;
    const text = message.swipes?.[swipeId] ?? (
        Number(message.swipe_id ?? 0) === Number(swipeId) ? message.mes : ''
    );
    if (hashText(text) !== expectedHash) return null;
    return { context, message };
}

async function backgroundSimulation(prompt, {
    maxTokens = 2200,
    temperature = 0.2,
} = {}) {
    const context = getContext();
    const settings = getSettings();
    if (settings.apiMode === 'custom') {
        runtime.inBackgroundGeneration = true;
        clearOwnInjection();
        try {
            runtime.syncStatus.method = settings.customApiTransport === 'direct'
                ? '独立 API 浏览器直连'
                : '独立 API 经酒馆转发';
            return await requestCustomCompletion(settings, [
                { role: 'user', content: prompt },
            ], {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens,
                temperature,
            });
        } finally {
            runtime.inBackgroundGeneration = false;
            refreshInjection();
        }
    }

    if (
        typeof context?.generateRaw !== 'function'
        && typeof context?.generateQuietPrompt !== 'function'
    ) {
        throw new Error('当前酒馆版本没有提供安静生成接口');
    }

    runtime.inBackgroundGeneration = true;
    clearOwnInjection();
    try {
        if (typeof context.generateRaw === 'function') {
            runtime.syncStatus.method = '独立上下文推演';
            return await context.generateRaw({
                prompt: [{ role: 'user', content: prompt }],
                responseLength: maxTokens,
                trimNames: false,
            });
        }
        runtime.syncStatus.method = '安静生成兼容模式';
        return await context.generateQuietPrompt({
            quietPrompt: prompt,
            skipWIAN: true,
            responseLength: maxTokens,
            removeReasoning: true,
        });
    } finally {
        runtime.inBackgroundGeneration = false;
        refreshInjection();
    }
}

async function runSimulationForMessage(messageId, {
    force = false,
    trigger = 'reply',
    newAssistantCount = 1,
} = {}) {
    const beforeContext = getContext();
    const beforeMessage = beforeContext?.chat?.[messageId];
    if (!beforeMessage || beforeMessage.is_user) {
        throw new Error('没有找到可以推演的 AI 正文');
    }
    const beforeSwipeId = Number(beforeMessage.swipe_id ?? 0);
    const beforeSourceKey = branchSourceKey(messageId, beforeMessage, beforeSwipeId);
    const beforeData = branchDataFromMessage(beforeMessage, beforeSwipeId);
    if (
        !force
        && beforeData?.status === 'committed'
        && beforeData.sourceKey === beforeSourceKey
        && beforeData.result
        && !beforeData.stale
    ) {
        return stateWithBranchOverride(beforeData.result);
    }

    const prepared = markMessagePending(messageId, { trigger });
    if (!prepared) {
        throw new Error('没有找到可以推演的 AI 正文');
    }

    const {
        message,
        swipeId,
        sourceKey,
        baseState,
    } = prepared;
    const expectedHash = sourceKey.split(':').at(-1);
    const chatTokenAtStart = currentChatToken();
    const offeredEventIds = prepared.data.offeredEventIds;
    const settings = getSettings();
    const assistantTurnsToApply = Math.min(
        20,
        Math.max(1, Number.parseInt(newAssistantCount, 10) || 1),
    );
    const narrative = narrativeContext(
        messageId,
        Math.max(settings.contextTurns, assistantTurnsToApply),
    );
    const newAssistantTexts = narrative.turns
        .filter(turn => turn.role === 'assistant')
        .slice(-assistantTurnsToApply)
        .map(turn => turn.content);
    const prompt = buildSimulationPrompt(baseState, {
        queuedEventIds: offeredEventIds,
        trigger,
        latestTurn: narrative.latestTurn,
        narrativeTurns: narrative.turns,
        userName: beforeContext?.name1 || '',
        includeUserInnerVoice: settings.includeUserInnerVoice,
        timePolicy: settings.timePolicy,
        simulationMode: settings.autoSimulationMode,
        customInstruction: settings.customSimulationInstruction,
        newAssistantTurns: assistantTurnsToApply,
        backgroundNpcBudget: settings.backgroundNpcBudget,
    });
    const simulationModeLabel = {
        light: '轻量',
        balanced: '均衡',
        deep: '深入',
        manual: '手动',
    }[settings.autoSimulationMode] || '均衡';

    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: assistantTurnsToApply > 1
            ? `正在合并最近 ${assistantTurnsToApply} 轮新正文并进行${simulationModeLabel}推演`
            : `正在读取最近 ${settings.contextTurns} 轮正文并进行${simulationModeLabel}推演`,
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const baseMaxTokens = settings.autoSimulationMode === 'deep'
            ? 3000
            : settings.autoSimulationMode === 'light'
                ? 1600
                : 2200;
        const payload = await runWithRetries(async attempt => {
            const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: retryTokenBudget(baseMaxTokens, attempt),
                temperature: attempt > 0
                    ? 0.08
                    : settings.autoSimulationMode === 'deep' ? 0.28 : 0.18,
            });
            const parsed = extractJsonObject(raw);
            if (parsed) return parsed;
            throw unreadableJsonError(raw);
        }, {
            retries: settings.autoRetryCount,
            shouldRetry: error => !(
                /请先填写独立 API|HTTP 40[0134]|没有找到可以推演|没有提供安静生成接口/
                    .test(describeError(error))
            ),
            onRetry: ({ attempt, total, delayMs, error }) => {
                setSyncStatus({
                    phase: 'running',
                    message: `推演失败，准备第 ${attempt}/${total} 次自动重试`,
                    error: `${describeError(error)}；${Math.ceil(delayMs / 100) / 10} 秒后重试`,
                });
            },
        });

        let resultState = applySimulationResult(baseState, payload, {
            messageId,
            swipeId,
            sourceKey,
            userName: beforeContext?.name1 || '',
            allowUserInnerVoice: settings.includeUserInnerVoice,
            timePolicy: settings.timePolicy,
            narrativeText: newAssistantTexts.join('\n'),
            backgroundNpcBudget: settings.backgroundNpcBudget,
        });
        resultState = recordDeliveryOffers(resultState, offeredEventIds, {
            messageId,
            expireAfter: 3,
        });

        const target = locateTargetBranch(messageId, swipeId, expectedHash);
        if (!target || currentChatToken() !== chatTokenAtStart) {
            setSyncStatus({
                phase: 'idle',
                message: '推演已返回；你已切换聊天或正文分支，结果未覆盖当前页面',
                error: '',
            });
            return resultState;
        }

        const committed = {
            ...prepared.data,
            status: 'committed',
            result: createSnapshot(resultState, {
                messageId,
                swipeId,
                sourceKey,
                kind: 'result',
            }),
            error: '',
        };
        attachBranchData(target.message, swipeId, committed);

        const branchIsCurrent = (
            Number(target.message.swipe_id ?? 0) === swipeId
            && hashText(target.message.mes) === expectedHash
        );
        if (branchIsCurrent) {
            const store = getStore();
            store.currentState = trimState(resultState);
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
        }

        await target.context.saveChat?.();
        setSyncStatus({
            phase: 'success',
            message: '最新正文已完成推演',
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        return resultState;
    } catch (error) {
        const errorMessage = describeError(error);
        const target = locateTargetBranch(messageId, swipeId, expectedHash);
        if (target) {
            const failed = {
                ...prepared.data,
                status: 'error',
                error: errorMessage,
            };
            attachBranchData(target.message, swipeId, failed);
            await target.context.saveChat?.();
        }

        const store = getStore();
        store.currentState = markPendingSync(baseState, true);
        saveStore(store);
        refreshInjection();
        runtime.ui?.render();

        setSyncStatus({
            phase: 'error',
            message: '世界推演没有完成',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        toast(`世界推演没有完成：${errorMessage}`, 'warning');
        throw error;
    } finally {
        setBusy(false);
    }
}

function queueSimulation(messageId, options = {}) {
    const context = getContext();
    const message = context?.chat?.[Number(messageId)];
    const queueKey = message
        ? `${currentChatToken()}:${branchSourceKey(Number(messageId), message)}`
        : `${currentChatToken()}:${Number(messageId)}`;
    const existing = runtime.queuedSimulations.get(queueKey);
    if (existing) return existing;

    setSyncStatus({
        phase: 'queued',
        message: '已排入世界推演队列',
        error: '',
    });
    const task = runtime.simulationChain
        .catch(() => undefined)
        .then(() => runSimulationForMessage(messageId, options));
    runtime.simulationChain = task;
    runtime.queuedSimulations.set(queueKey, task);
    void task.then(
        () => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
            window.setTimeout(schedulePendingCatchUp, 40);
            window.setTimeout(scheduleAutoMemoryIndex, 700);
        },
        () => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
        },
    );
    return task;
}

function scheduleAutoSync(messageId, type) {
    const settings = getSettings();
    markMessagePending(messageId, { trigger: type || 'reply' });
    if (!settings.autoSync || !settings.enabled) {
        setSyncStatus({
            phase: 'pending',
            message: settings.enabled
                ? '自动推演设为手动；可随时推演累计正文'
                : '世界背面当前未启用',
            error: '',
        });
        return;
    }
    if (runtime.simulationCount > 0 || runtime.queuedSimulations.size > 0) {
        setSyncStatus({
            phase: 'queued',
            message: '已有世界推演在进行，新正文已安全累计',
            error: '',
        });
        return;
    }

    const pending = pendingAssistantEntriesThrough(messageId);
    const interval = settings.autoSimulationInterval;
    if (pending.length < interval) {
        setSyncStatus({
            phase: 'pending',
            message: `已累计 ${pending.length}/${interval} 轮新正文，达到频率后自动推演`,
            error: '',
        });
        return;
    }

    window.setTimeout(() => {
        void queueSimulation(messageId, {
            trigger: type || 'reply',
            newAssistantCount: pending.length,
        }).catch(() => undefined);
    }, 160);
}

function schedulePendingCatchUp() {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.autoSync
        || runtime.simulationCount > 0
        || runtime.queuedSimulations.size > 0
    ) {
        return;
    }
    const latest = latestAssistantEntry();
    if (!latest) return;
    const pending = pendingAssistantEntriesThrough(latest.index);
    if (pending.length < settings.autoSimulationInterval) return;
    void queueSimulation(latest.index, {
        trigger: 'interval-catch-up',
        newAssistantCount: pending.length,
    }).catch(() => undefined);
}

function unindexedAssistantCount() {
    const state = getState();
    const cursor = Math.max(
        0,
        Number(state.storyMemory?.indexedThroughMessageId ?? -1) + 1,
    );
    return (getContext()?.chat || [])
        .slice(cursor)
        .filter(message => message && !message.is_user && !message.is_system)
        .length;
}

function scheduleAutoMemoryIndex() {
    const settings = getSettings();
    const interval = settings.memoryAutoIndexInterval;
    if (!settings.enabled || interval <= 0) return;
    if (unindexedAssistantCount() < interval) return;
    if (runtime.autoMemoryTimer !== null) return;

    runtime.autoMemoryTimer = window.setTimeout(() => {
        runtime.autoMemoryTimer = null;
        if (
            runtime.historyProgress.phase === 'running'
            || runtime.simulationCount > 0
            || runtime.queuedSimulations.size > 0
        ) {
            scheduleAutoMemoryIndex();
            return;
        }
        void scanHistoryArchive({
            automatic: true,
            maximumBatches: 1,
        }).catch(() => undefined);
    }, 900);
}

function onMessageReceived(messageId, type) {
    if (runtime.inBackgroundGeneration) return;
    if (['quiet', 'impersonate', 'first_message'].includes(type)) return;
    scheduleAutoSync(Number(messageId), type);
    scheduleAutoMemoryIndex();
}

function onGenerationStarted(type, _options, dryRun) {
    if (runtime.inBackgroundGeneration || dryRun || ['quiet', 'impersonate'].includes(type)) return;
    refreshInjection();
    runtime.generationOffer = {
        eventIds: clone(runtime.injection.eventIds || []),
        at: Date.now(),
    };
}

function restoreExistingSwipe(messageId) {
    const context = getContext();
    const message = context?.chat?.[Number(messageId)];
    if (!message) return;
    const swipeId = Number(message.swipe_id ?? 0);
    const swipesLength = Array.isArray(message.swipes) ? message.swipes.length : 0;
    const data = branchDataFromMessage(message, swipeId);
    const store = getStore();

    if (swipeId >= swipesLength) {
        const previous = findLatestResultSnapshot(Number(messageId));
        const base = data?.base && !data.stale
            ? restoreSnapshot(data.base, store.initialState)
            : (previous
                ? stateWithBranchOverride(previous.snapshot, store)
                : clone(store.initialState));
        store.currentState = markPendingSync(base, true);
        const pending = {
            schemaVersion: SCHEMA_VERSION,
            status: 'pending',
            sourceKey: `${messageId}:${swipeId}:pending`,
            trigger: 'swipe',
            offeredEventIds: clone(runtime.injection.eventIds || []),
            base: createSnapshot(base, {
                messageId: Number(messageId),
                swipeId,
                sourceKey: `${messageId}:${swipeId}:pending`,
                kind: 'base',
            }),
            result: null,
            error: '',
            stale: false,
        };
        message.extra ||= {};
        message.extra[SNAPSHOT_KEY] = pending;
    } else if (data?.status === 'committed' && data.result && !data.stale) {
        store.currentState = stateWithBranchOverride(data.result, store);
    } else if (data?.base && !data.stale) {
        store.currentState = markPendingSync(
            restoreSnapshot(data.base, store.initialState),
            true,
        );
        if (message.mes && message.mes !== '...' && getSettings().autoSync) {
            scheduleAutoSync(Number(messageId), 'swipe');
        }
    } else {
        const previous = findLatestResultSnapshot(Number(messageId));
        store.currentState = markPendingSync(
            previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
            true,
        );
    }

    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
}

function markSnapshotsStaleFrom(messageId) {
    const context = getContext();
    const chat = context?.chat || [];
    for (let index = Number(messageId); index < chat.length; index += 1) {
        const message = chat[index];
        const current = message?.extra?.[SNAPSHOT_KEY];
        if (current) current.stale = true;
        for (const swipeInfo of message?.swipe_info || []) {
            const data = swipeInfo?.extra?.[SNAPSHOT_KEY];
            if (data) data.stale = true;
        }
    }
    void context?.saveChat?.();
}

function onMessageEdited(messageId) {
    const context = getContext();
    const index = Number(messageId);
    const message = context?.chat?.[index];
    markSnapshotsStaleFrom(index);

    const previous = findLatestResultSnapshot(index);
    const store = getStore();
    store.currentState = markPendingSync(
        previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
        true,
    );
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();

    if (message && !message.is_user && index === context.chat.length - 1) {
        window.setTimeout(() => {
            void queueSimulation(index, { force: true, trigger: 'edit' }).catch(() => undefined);
        }, 120);
    } else {
        toast('已回到编辑点之前的世界快照；后续正文需要重新生成或手动同步。', 'info');
    }
}

function onMessageDeleted() {
    restoreLatestBranch();
}

function onChatChanged() {
    if (runtime.autoMemoryTimer !== null) {
        window.clearTimeout(runtime.autoMemoryTimer);
        runtime.autoMemoryTimer = null;
    }
    if (runtime.manualUndoTimer !== null) {
        window.clearTimeout(runtime.manualUndoTimer);
        runtime.manualUndoTimer = null;
    }
    runtime.manualUndo = null;
    runtime.activeChatToken = currentChatToken();
    runtime.historyProgress = {
        phase: 'idle',
        processed: 0,
        total: getContext()?.chat?.length || 0,
        message: '',
    };
    runtime.syncStatus = {
        phase: 'idle',
        message: '正在读取当前聊天的推演状态',
        error: '',
        attemptedAt: '',
        succeededAt: '',
        method: '',
    };
    window.setTimeout(() => {
        runtime.activeChatToken = currentChatToken();
        restoreLatestBranch();
        syncSettingsEntry();
    }, 80);
}

function armManualUndo(previousState, {
    key = currentAnchorKey(),
    label = '撤销刚才的手动更改',
    previousInitialState = null,
} = {}) {
    if (runtime.manualUndoTimer !== null) window.clearTimeout(runtime.manualUndoTimer);
    runtime.manualUndo = {
        state: clone(previousState),
        previousInitialState: previousInitialState ? clone(previousInitialState) : null,
        key,
        label,
        chatToken: currentChatToken(),
        expiresAt: Date.now() + 9000,
    };
    runtime.manualUndoTimer = window.setTimeout(() => {
        runtime.manualUndo = null;
        runtime.manualUndoTimer = null;
        runtime.ui?.render();
    }, 9000);
    runtime.ui?.render();
}

function undoManualChange() {
    const undo = runtime.manualUndo;
    if (
        !undo
        || undo.expiresAt <= Date.now()
        || undo.chatToken !== currentChatToken()
        || undo.key !== currentAnchorKey()
    ) {
        throw new Error('可撤销时间已经结束，或者正文分支已经改变');
    }
    if (runtime.manualUndoTimer !== null) window.clearTimeout(runtime.manualUndoTimer);
    runtime.manualUndo = null;
    runtime.manualUndoTimer = null;

    const store = getStore();
    store.currentState = trimState(undo.state);
    if (undo.previousInitialState) store.initialState = trimState(undo.previousInitialState);
    store.branchOverrides[undo.key] = createSnapshot(store.currentState, {
        sourceKey: undo.key,
        kind: 'manual-undo',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    toast('刚才的手动更改已经撤销。', 'success');
}

function commitManualState(nextState, message = '世界状态已更新') {
    const key = currentAnchorKey();
    const previousState = getState();
    setCurrentState(nextState, { overrideKey: key });
    armManualUndo(previousState, { key });
    toast(message, 'success');
}

function exportState() {
    const payload = {
        format: 'world-backstage-state',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        state: getState(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeWorldName = String(getState().world.name || '世界')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 60);
    link.href = url;
    link.download = `世界背面_${safeWorldName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('当前世界状态已导出。', 'success');
}

function importState(text) {
    const parsed = JSON.parse(String(text || ''));
    const imported = trimState(parsed?.state || parsed);
    const confirmed = globalThis.confirm?.(
        `导入会替换这个聊天当前的世界状态。\n\n导入：${imported.world.name}`,
    );
    if (confirmed === false) return;

    const store = getStore();
    const previousState = clone(store.currentState);
    const previousInitialState = clone(store.initialState);
    const key = currentAnchorKey();
    store.currentState = imported;
    if (!findLatestResultSnapshot()) store.initialState = clone(imported);
    store.branchOverrides[key] = createSnapshot(imported, {
        sourceKey: key,
        kind: 'import',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    armManualUndo(previousState, {
        key,
        label: '撤销状态导入',
        previousInitialState,
    });
    toast('世界状态已导入。', 'success');
}

async function testCustomApiConnection() {
    const settings = getSettings();
    if (settings.apiMode !== 'custom') {
        throw new Error('请先把世界推演连接切换为“独立接口”');
    }
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: '正在测试独立 API',
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const reply = await backgroundSimulation(
            '这是连接测试。请只回复：连接成功',
            { maxTokens: 80, temperature: 0 },
        );
        if (!String(reply || '').trim()) throw new Error('接口没有返回内容');
        setSyncStatus({
            phase: 'success',
            message: '独立 API 连接测试成功',
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        toast('独立 API 已经可以使用。', 'success');
        return true;
    } catch (error) {
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: 'error',
            message: '独立 API 连接测试失败',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        throw error;
    } finally {
        setBusy(false);
    }
}

async function scanHistoryArchive({
    automatic = false,
    maximumBatches = Number.POSITIVE_INFINITY,
} = {}) {
    if (runtime.historyProgress.phase === 'running') {
        if (automatic) return false;
        throw new Error('历史建档已经在进行中');
    }
    const context = getContext();
    const chatToken = currentChatToken();
    const chatLength = context?.chat?.length || 0;
    if (!chatLength) throw new Error('当前聊天还没有可扫描的正文');

    let state = getState();
    let cursor = Math.max(0, Number(state.storyMemory?.indexedThroughMessageId ?? -1) + 1);
    if (cursor >= chatLength) {
        if (!automatic) toast('历史档案已经扫描到当前最新消息。', 'info');
        return true;
    }
    if (!automatic) {
        const confirmed = globalThis.confirm?.(
            `将从第 ${cursor} 层开始分批读取当前分支，共约 ${chatLength - cursor} 条消息。\n`
            + '这会产生额外 API 调用，但每批成功后都会立即保存进度。是否继续？',
        );
        if (confirmed === false) return false;
    }

    runtime.historyProgress = {
        phase: 'running',
        processed: cursor,
        total: chatLength,
        message: automatic ? '正在自动整理新增记忆' : '正在建立历史档案',
    };
    setBusy(true);
    runtime.ui?.render();

    try {
        let completedBatches = 0;
        const batchLimit = Number.isFinite(Number(maximumBatches))
            ? Math.max(1, Number.parseInt(maximumBatches, 10) || 1)
            : Number.POSITIVE_INFINITY;
        while (cursor < chatLength && completedBatches < batchLimit) {
            if (currentChatToken() !== chatToken) {
                throw new Error('扫描期间切换了聊天，本次已在上一个完成批次处停止');
            }
            const batch = nextHistoryBatch(cursor, {
                maximumAssistantTurns: automatic
                    ? Math.max(1, getSettings().memoryAutoIndexInterval)
                    : 10,
            });
            if (!batch.messages.length) {
                cursor = batch.nextCursor;
                continue;
            }
            runtime.historyProgress = {
                phase: 'running',
                processed: batch.startMessageId,
                total: chatLength,
                message: `正在整理消息 ${batch.startMessageId}—${batch.endMessageId}`,
            };
            runtime.ui?.render();

            const prompt = buildHistoryIndexPrompt(state, {
                messages: batch.messages,
                userName: context?.name1 || '',
            });
            const payload = await runWithRetries(async attempt => {
                const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                    maxTokens: retryTokenBudget(3200, attempt),
                    temperature: attempt > 0 ? 0.05 : 0.1,
                });
                const parsed = extractJsonObject(raw);
                if (parsed) return parsed;
                throw unreadableJsonError(raw, '记忆整理模型');
            }, {
                retries: getSettings().autoRetryCount,
                shouldRetry: error => !(
                    /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                        .test(describeError(error))
                ),
                onRetry: ({ attempt, total }) => {
                    runtime.historyProgress.message = `记忆整理失败，正在重试 ${attempt}/${total}`;
                    runtime.ui?.render();
                },
            });
            state = applyHistoryIndexResult(state, payload, {
                startMessageId: batch.startMessageId,
                endMessageId: batch.endMessageId,
            });
            cursor = batch.nextCursor;
            completedBatches += 1;

            const store = getStore();
            store.currentState = state;
            store.branchOverrides[currentAnchorKey()] = createSnapshot(state, {
                sourceKey: currentAnchorKey(),
                kind: 'history-index',
            });
            saveStore(store);
            runtime.historyProgress.processed = Math.min(chatLength, cursor);
            refreshInjection();
            runtime.ui?.render();
        }

        const caughtUp = cursor >= chatLength;
        if (caughtUp) {
            state.storyMemory.indexedThroughMessageId = Math.max(
                state.storyMemory.indexedThroughMessageId,
                chatLength - 1,
            );
        }
        const store = getStore();
        store.currentState = trimState(state);
        saveStore(store, { immediate: true });
        runtime.historyProgress = {
            phase: 'success',
            processed: Math.min(chatLength, cursor),
            total: chatLength,
            message: caughtUp
                ? (automatic ? '新增记忆已自动整理' : '当前分支的历史档案已经建立')
                : `已整理至消息 ${state.storyMemory.indexedThroughMessageId}`,
        };
        refreshInjection();
        runtime.ui?.render();
        if (!automatic) {
            toast(
                `记忆建档完成：${state.storyMemory.facts.length} 条长期事实，`
                + `${state.storyMemory.clues.length} 条伏笔，`
                + `${state.storyMemory.summaries.length} 段经历。`,
                'success',
            );
        }
        return true;
    } catch (error) {
        runtime.historyProgress = {
            ...runtime.historyProgress,
            phase: 'error',
            message: describeError(error),
        };
        runtime.ui?.render();
        throw error;
    } finally {
        setBusy(false);
    }
}

async function observePerson(personId) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) throw new Error('没有找到这个人物');
    if (person.isUser) throw new Error('玩家角色不使用镜头外人物观测');
    if (currentTurnPresentPersonIds().includes(person.id)) {
        throw new Error('这个人物已经在本轮镜头中，不需要另行观测');
    }
    const settings = getSettings();
    const latest = latestAssistantEntry();
    const narrative = latest
        ? narrativeContext(latest.index, settings.contextTurns)
        : { turns: [] };
    const prompt = buildPersonObservationPrompt(state, person, {
        narrativeTurns: narrative.turns,
        userName: getContext()?.name1 || '',
        includeUserInnerVoice: settings.includeUserInnerVoice,
    });

    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: `正在看 ${person.name} 此刻在做什么`,
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const text = String(await backgroundSimulation(prompt, {
            maxTokens: 1200,
            temperature: 0.65,
        }) || '').trim();
        if (!text) throw new Error('人物观测没有返回内容');
        setSyncStatus({
            phase: 'success',
            message: `${person.name} 的即时观测已经生成`,
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        return {
            personId: person.id,
            text,
            worldMinute: state.clock.absoluteMinute,
        };
    } catch (error) {
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: 'error',
            message: '人物即时观测没有完成',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        throw error;
    } finally {
        setBusy(false);
    }
}

async function handleUiAction(action, payload = {}) {
    if (action === 'undo-manual') {
        undoManualChange();
        return;
    }

    if (action === 'update-settings') {
        const context = getContext();
        const settings = getSettings();
        Object.assign(settings, payload);
        context.extensionSettings[MODULE_ID] = settings;
        saveSettings();
        refreshInjection();
        syncSettingsEntry();
        runtime.ui?.render();
        return;
    }

    if (action === 'test-api') {
        return testCustomApiConnection();
    }

    if (action === 'scan-history') {
        return scanHistoryArchive();
    }

    if (action === 'observe-person') {
        return observePerson(String(payload.personId || ''));
    }

    if (action === 'set-clock') {
        const next = setWorldCalendar(getState(), {
            calendarName: payload.calendarName,
            year: payload.year,
            month: payload.month,
            day: payload.day,
            hour: payload.hour,
            minute: payload.minute,
            reason: '在世界背面校准',
        });
        commitManualState(next, '主世界时间已经校准。');
        return;
    }

    if (action === 'advance-clock') {
        const minutes = Number(payload.minutes) || 0;
        const next = advanceWorldClock(getState(), minutes, '在世界背面手动推进');
        commitManualState(next, `主世界时间已推进 ${minutes} 分钟。`);
        return;
    }

    if (action === 'add-event') {
        const durationHours = Number(payload.durationHours) || 0;
        const durationMinutes = Math.max(0, Math.round(durationHours * 60));
        const clockMode = payload.clockMode;
        const next = addManualEvent(getState(), {
            title: payload.title,
            place: payload.place,
            summary: payload.summary,
            expected_result: payload.expectedResult,
            consequence: payload.expectedResult,
            clock_mode: clockMode,
            duration_minutes: durationMinutes,
            scheduled_at: clockMode === 'scheduled'
                ? getState().clock.absoluteMinute + durationMinutes
                : null,
            visibility: payload.visibility,
            delivery_route: '',
        });
        commitManualState(next, `暗流“${payload.title}”已经开始发展。`);
        return;
    }

    if (action === 'manual-sync') {
        const lastAssistantIndex = latestAssistantEntry()?.index;
        if (!Number.isInteger(lastAssistantIndex)) {
            toast('当前聊天还没有可推演的 AI 正文。', 'warning');
            return;
        }
        try {
            const pendingCount = Math.max(
                1,
                pendingAssistantEntriesThrough(lastAssistantIndex).length,
            );
            await queueSimulation(lastAssistantIndex, {
                force: true,
                trigger: 'manual',
                newAssistantCount: pendingCount,
            });
            toast(
                pendingCount > 1
                    ? `累计的 ${pendingCount} 轮正文已经完成推演。`
                    : '最新正文已经重新推演。',
                'success',
            );
        } catch {
            // runSimulationForMessage has already recorded and displayed the detailed error.
        }
        return;
    }

    if (action === 'export-state') {
        exportState();
        return;
    }

    if (action === 'import-state-data') {
        try {
            importState(payload.text);
        } catch (error) {
            toast(`导入失败：${error?.message || error}`, 'error');
        }
    }
}

function installSettingsEntry() {
    if (document.getElementById('world-backstage-settings-entry')) return;
    const host = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!host) return;

    const entry = document.createElement('div');
    entry.id = 'world-backstage-settings-entry';
    entry.className = 'world-backstage-settings-entry';
    entry.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>世界背面</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="world-backstage-enabled" type="checkbox">
                    <span>启用独立平行世界</span>
                </label>
                <p class="notes">世界时钟、人物轨迹、第一视角独白与事件账本按聊天独立保存。</p>
                <button id="world-backstage-open" class="menu_button" type="button">
                    打开世界背面
                </button>
            </div>
        </div>
    `;
    host.appendChild(entry);

    entry.querySelector('#world-backstage-enabled')?.addEventListener('change', event => {
        void handleUiAction('update-settings', { enabled: event.target.checked });
    });
    entry.querySelector('#world-backstage-open')?.addEventListener('click', () => {
        const settings = getSettings();
        if (!settings.enabled) {
            void handleUiAction('update-settings', { enabled: true });
        }
        runtime.ui?.open();
    });
    syncSettingsEntry();
}

function syncSettingsEntry() {
    const checkbox = document.getElementById('world-backstage-enabled');
    if (checkbox) checkbox.checked = getSettings().enabled;
}

function registerEvents() {
    const context = getContext();
    const source = context?.eventSource;
    const events = context?.eventTypes || context?.event_types;
    if (!source || !events) return;

    const on = (eventName, handler) => {
        const event = events[eventName];
        if (event) source.on(event, handler);
    };

    on('GENERATION_STARTED', onGenerationStarted);
    on('MESSAGE_RECEIVED', onMessageReceived);
    on('MESSAGE_SWIPED', restoreExistingSwipe);
    on('MESSAGE_EDITED', onMessageEdited);
    on('MESSAGE_DELETED', onMessageDeleted);
    on('CHAT_CHANGED', onChatChanged);
    on('CHAT_LOADED', onChatChanged);
}

function registerDebugCheck() {
    const context = getContext();
    context?.registerDebugFunction?.(
        'world_backstage_state_check',
        '检查世界背面状态',
        '检查当前世界时钟、活动事件与分支快照是否可读取',
        () => {
            const state = getState();
            const result = {
                ok: true,
                clock: state.clock.absoluteMinute,
                people: state.people.length,
                activeEvents: state.events.filter(event => ['active', 'waiting'].includes(event.status)).length,
                pendingSync: state.pendingSync,
                latestSnapshot: Boolean(findLatestResultSnapshot()),
            };
            console.info('[世界背面] 状态检查', result);
            toast('状态检查完成，详细结果已写入浏览器控制台。', 'success');
            return result;
        },
    );
}

function initialize() {
    if (runtime.initialized || globalThis.__worldBackstageLoaded) return;
    runtime.initialized = true;
    globalThis.__worldBackstageLoaded = true;
    runtime.activeChatToken = currentChatToken();

    getSettings();
    getStore();
    runtime.ui = createWorldBackstageUI({
        getState,
        getSettings,
        getSyncStatus,
        onAction: handleUiAction,
    });

    installSettingsEntry();
    registerEvents();
    registerDebugCheck();
    restoreLatestBranch();
    console.info('[世界背面] 独立平行世界扩展已加载');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
