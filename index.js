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
import {
    isAbortError,
    requestCustomCompletion,
    requestCustomModels,
    runWithRetries,
} from './api.js';
import { createWorldBackstageUI } from './ui.js';

const PROMPT_KEY = 'world_backstage_authoritative_state';
const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 11,
    enabled: true,
    promptInjection: true,
    worldSimulationEnabled: true,
    worldPromptInjection: true,
    memorySystemEnabled: true,
    memoryPromptInjection: true,
    autoSync: true,
    autoSimulationMode: 'balanced',
    autoSimulationInterval: 1,
    autoRetryCount: 1,
    memoryAutoIndexInterval: 10,
    backgroundNpcBudget: 4,
    customSimulationInstruction: '',
    playerIdentityAnchor: '',
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
    maxOutputTokens: 0,
});

const runtime = {
    initialized: false,
    ui: null,
    transientStore: null,
    injection: { text: '', eventIds: [] },
    generationOffer: { eventIds: [], at: 0 },
    simulationChain: Promise.resolve(),
    simulationCount: 0,
    activeSimulation: null,
    activeHistoryScan: null,
    inBackgroundGeneration: false,
    activeChatToken: '',
    queuedSimulations: new Map(),
    autoMemoryTimer: null,
    manualUndo: null,
    manualUndoTimer: null,
    editDecision: null,
    customModels: [],
    modelPullStatus: { phase: 'idle', message: '' },
    worldbookScan: {
        phase: 'idle',
        message: '',
        bookName: '',
        entries: [],
    },
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
        summary: null,
    },
};

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function getWorldbookNames() {
    const names = getContext()?.getWorldInfoNames?.();
    return Array.isArray(names)
        ? [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        : [];
}

function worldbookEntryLabel(entry) {
    const keys = Array.isArray(entry?.key)
        ? entry.key
        : typeof entry?.key === 'string' ? [entry.key] : [];
    return String(entry?.comment || keys[0] || `条目 ${entry?.uid ?? ''}`)
        .trim()
        .slice(0, 80);
}

async function scanWorldbook(bookName) {
    const name = String(bookName || '').trim();
    const context = getContext();
    if (!name) throw new Error('请先选择一本世界书');
    if (typeof context?.loadWorldInfo !== 'function') {
        throw new Error('当前酒馆版本没有开放世界书读取接口');
    }
    runtime.worldbookScan = {
        phase: 'running',
        message: `正在读取《${name}》`,
        bookName: name,
        entries: [],
    };
    runtime.ui?.render();
    try {
        const data = await context.loadWorldInfo(name);
        const entries = Object.values(data?.entries || {})
            .filter(entry => entry && String(entry.content || '').trim())
            .map(entry => ({
                uid: String(entry.uid ?? ''),
                name: worldbookEntryLabel(entry),
                content: String(entry.content || '').trim().slice(0, 4000),
                keys: (Array.isArray(entry.key) ? entry.key : [entry.key])
                    .map(key => String(key || '').trim())
                    .filter(Boolean)
                    .slice(0, 8),
                disabled: Boolean(entry.disable),
                order: Number(entry.order) || 0,
            }))
            .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.order - a.order)
            .slice(0, 240);
        runtime.worldbookScan = {
            phase: 'success',
            message: entries.length
                ? `已读取 ${entries.length} 条；请只勾选确实代表人物的条目`
                : '这本世界书没有可读取的内容条目',
            bookName: name,
            entries,
        };
        return runtime.worldbookScan;
    } catch (error) {
        runtime.worldbookScan = {
            phase: 'error',
            message: `读取失败：${describeError(error)}`,
            bookName: name,
            entries: [],
        };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

function importWorldbookPeople(bookName, entryIds = []) {
    const name = String(bookName || '').trim();
    if (runtime.worldbookScan.bookName !== name) {
        throw new Error('世界书预览已经变化，请重新扫描');
    }
    const wanted = new Set((Array.isArray(entryIds) ? entryIds : [entryIds]).map(String));
    const selected = runtime.worldbookScan.entries.filter(entry => wanted.has(String(entry.uid)));
    if (!selected.length) throw new Error('请至少勾选一个人物条目');

    const next = clone(getState());
    let created = 0;
    let updated = 0;
    for (const candidate of selected) {
        const reference = `${name}::${candidate.uid}`;
        const existing = next.people.find(person => (
            person.worldbookRef === reference
            || person.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase()
        ));
        const personalityAnchor = candidate.content.slice(0, 600);
        if (existing) {
            existing.personalityAnchor = personalityAnchor || existing.personalityAnchor || '';
            existing.worldbookRef = reference;
            existing.manual = true;
            existing.updatedAt = next.clock.absoluteMinute;
            updated += 1;
            continue;
        }
        next.people.push({
            id: `person_worldbook_${hashText(reference)}`,
            name: candidate.name,
            monogram: candidate.name.slice(0, 1),
            location: '位置待确认',
            action: '当前行动待确认',
            intent: '短期意图待确认',
            longTermGoal: '',
            identityAnchor: '',
            personalityAnchor,
            speakingStyle: '',
            behaviorBoundaries: '',
            trace: '',
            innerVoice: '',
            innerVoiceAt: next.clock.absoluteMinute,
            knowledge: 'hidden',
            relevance: 1,
            simulationEnabled: true,
            locked: false,
            manual: true,
            source: 'manual',
            isUser: false,
            lastSeenMessageId: -1,
            worldbookRef: reference,
            updatedAt: next.clock.absoluteMinute,
        });
        created += 1;
    }
    commitManualState(next, `世界书人物已导入：新增 ${created} 人，更新 ${updated} 人。`);
    return { created, updated };
}

function toast(message, tone = 'info') {
    runtime.ui?.notify(message, tone);
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
    const legacySimulationPaused = previousSettingsVersion < 11
        && Boolean(previous?.simulationPaused);
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(previous && typeof previous === 'object' ? previous : {}),
    };
    settings.enabled = Boolean(settings.enabled);
    if (previousSettingsVersion < 9) {
        settings.worldPromptInjection = previous?.promptInjection !== false;
        settings.memoryPromptInjection = previous?.promptInjection !== false;
    }
    // Kept only as a migration field. Injection is now controlled per module.
    settings.promptInjection = true;
    settings.worldSimulationEnabled = Boolean(settings.worldSimulationEnabled);
    settings.worldPromptInjection = Boolean(settings.worldPromptInjection);
    settings.memorySystemEnabled = Boolean(settings.memorySystemEnabled);
    settings.memoryPromptInjection = Boolean(settings.memoryPromptInjection);
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
    if (previousSettingsVersion < 8) settings.orbPosition = null;
    if (previousSettingsVersion < 5) {
        settings.autoSimulationMode = previous?.autoSync === false ? 'manual' : 'balanced';
    }
    if (!['manual', 'light', 'balanced', 'deep'].includes(settings.autoSimulationMode)) {
        settings.autoSimulationMode = 'balanced';
    }
    if (legacySimulationPaused) {
        settings.autoSimulationMode = 'manual';
    }
    delete settings.simulationPaused;
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
    settings.playerIdentityAnchor = String(
        settings.playerIdentityAnchor || '',
    ).trim().slice(0, 400);
    settings.settingsVersion = 12;
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
    settings.maxOutputTokens = Math.min(
        16000,
        Math.max(0, Number.parseInt(settings.maxOutputTokens, 10) || 0),
    );
    settings.orbPosition = normalizeOrbPosition(settings.orbPosition);
    context.extensionSettings[MODULE_ID] = settings;
    if (previousSettingsVersion < 12) context.saveSettingsDebounced?.();
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
        personObservations: {},
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
    store.personObservations = store.personObservations && typeof store.personObservations === 'object'
        ? store.personObservations
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
        if (hasUsableAssistantText(message)) return { message, index };
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
                summary: branch.summary || null,
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
        editDecision: {
            available: Boolean(
                runtime.editDecision
                && runtime.editDecision.chatToken === currentChatToken()
                && runtime.editDecision.messageId === latestAssistantEntry()?.index
            ),
            messageId: runtime.editDecision?.messageId ?? null,
        },
        presentPersonIds: currentTurnPresentPersonIds(),
        availableModels: runtime.customModels,
        modelPull: runtime.modelPullStatus,
        worldbook: {
            ...runtime.worldbookScan,
            books: getWorldbookNames(),
        },
        canCancelSimulation: Boolean(
            runtime.activeSimulation
            && !runtime.activeSimulation.controller.signal.aborted
        ),
    };
}

function setSyncStatus(patch) {
    const phaseChanged = Object.hasOwn(patch || {}, 'phase');
    runtime.syncStatus = {
        ...runtime.syncStatus,
        ...patch,
        ...(phaseChanged && !Object.hasOwn(patch || {}, 'summary') ? { summary: null } : {}),
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
    return Math.min(16000, Math.max(64, Number(base) || 3200) + Math.max(0, attempt) * 1800);
}

function approximateTokens(text) {
    return Math.max(0, Math.ceil(String(text || '').length / 2));
}

function changedItems(beforeItems = [], afterItems = [], fields = []) {
    const beforeById = new Map(beforeItems.map(item => [item.id, item]));
    const added = [];
    const updated = [];
    for (const item of afterItems) {
        const previous = beforeById.get(item.id);
        if (!previous) {
            added.push(item);
            continue;
        }
        const beforeShape = fields.map(field => previous?.[field]);
        const afterShape = fields.map(field => item?.[field]);
        if (JSON.stringify(beforeShape) !== JSON.stringify(afterShape)) updated.push(item);
    }
    return { added, updated };
}

function simulationSummary(before, after, {
    prompt = '',
    raw = '',
    attempts = 1,
    tokenBudget = 0,
    injection = { text: '', eventIds: [], omittedLines: 0 },
} = {}) {
    const people = changedItems(before.people, after.people, [
        'name', 'location', 'action', 'intent', 'longTermGoal', 'trace', 'innerVoice',
    ]);
    const events = changedItems(before.events, after.events, [
        'title', 'summary', 'status', 'result', 'consequence', 'visibility', 'delivery',
    ]);
    const beforeMemory = before.storyMemory || {};
    const afterMemory = after.storyMemory || {};
    const facts = changedItems(beforeMemory.facts, afterMemory.facts, [
        'subject', 'predicate', 'value', 'status', 'importance', 'locked', 'important',
    ]);
    const clues = changedItems(beforeMemory.clues, afterMemory.clues, [
        'title', 'text', 'status', 'importance', 'locked', 'important',
    ]);
    const summaries = changedItems(beforeMemory.summaries, afterMemory.summaries, [
        'title', 'summary', 'startMessageId', 'endMessageId',
    ]);
    return {
        elapsedMinutes: Math.max(0, Number(after.clock?.absoluteMinute) - Number(before.clock?.absoluteMinute)),
        peopleChanged: people.added.length + people.updated.length,
        peopleNames: [...people.added, ...people.updated].map(item => item.name).filter(Boolean).slice(0, 6),
        eventsAdded: events.added.length,
        eventsUpdated: events.updated.length,
        eventTitles: [...events.added, ...events.updated].map(item => item.title).filter(Boolean).slice(0, 6),
        memoryAdded: facts.added.length + clues.added.length + summaries.added.length,
        memoryUpdated: facts.updated.length + clues.updated.length + summaries.updated.length,
        promptCharacters: String(prompt || '').length,
        promptTokens: approximateTokens(prompt),
        outputCharacters: String(raw || '').length,
        outputTokens: approximateTokens(raw),
        outputBudget: Number(tokenBudget) || 0,
        attempts: Math.max(1, Number(attempts) || 1),
        injectionCharacters: String(injection.text || '').length,
        injectionLines: String(injection.text || '').split('\n').filter(Boolean).length,
        injectionEvents: injection.eventIds?.length || 0,
        omittedInjectionLines: Number(injection.omittedLines) || 0,
    };
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

function hasUsableAssistantText(message) {
    if (!message || message.is_user || message.is_system) return false;
    if (message.is_error || message.error || message.extra?.generation_error || message.extra?.api_error) {
        return false;
    }
    const text = selectedMessageText(message).trim();
    return Boolean(text && !/^(?:\.{3}|…+|（?空回复）?)$/u.test(text));
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
    return getState().people
        .filter(person => Number(person.presentInSceneMessageId) === Number(latest.index))
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
        if (!hasUsableAssistantText(message)) continue;
        const branch = branchDataFromMessage(message);
        if (!branch) continue;
        if (branch?.status === 'committed' && !branch.stale) continue;
        entries.push({ message, index });
    }
    return entries;
}

function nextHistoryBatch(cursor, {
    maximumCharacters = 24000,
    maximumUserTurns = 8,
    maximumAssistantTurns = 6,
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

function cancelActiveSimulation() {
    const active = runtime.activeSimulation;
    if (!active || active.controller.signal.aborted) return false;
    active.cancelled = true;
    active.controller.abort();
    if (active.apiMode !== 'custom') {
        try {
            getContext()?.stopGeneration?.();
        } catch (error) {
            console.warn('[世界背面] 无法请求酒馆停止安静生成', error);
        }
    }
    setSyncStatus({
        phase: 'cancelling',
        message: '正在停止本次推演，不会提交任何世界变化',
        error: '',
    });
    return true;
}

function markMessagePending(messageId, {
    trigger = 'reply',
    offeredEventIds = runtime.generationOffer.eventIds,
} = {}) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!hasUsableAssistantText(message)) return null;
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
    signal = null,
} = {}) {
    const context = getContext();
    const settings = getSettings();
    if (signal?.aborted) {
        const error = new Error('推演已由用户取消');
        error.name = 'AbortError';
        throw error;
    }
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
                signal,
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
    const stopNativeGeneration = () => {
        try {
            context?.stopGeneration?.();
        } catch (error) {
            console.warn('[世界背面] 酒馆安静生成停止请求没有正常返回', error);
        }
    };
    signal?.addEventListener?.('abort', stopNativeGeneration, { once: true });
    try {
        if (typeof context.generateRaw === 'function') {
            runtime.syncStatus.method = '独立上下文推演';
            return await context.generateRaw({
                prompt: [{ role: 'user', content: prompt }],
                responseLength: maxTokens,
                trimNames: false,
                signal,
            });
        }
        runtime.syncStatus.method = '安静生成兼容模式';
        return await context.generateQuietPrompt({
            quietPrompt: prompt,
            skipWIAN: true,
            responseLength: maxTokens,
            removeReasoning: true,
            signal,
        });
    } finally {
        signal?.removeEventListener?.('abort', stopNativeGeneration);
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
    const initialSettings = getSettings();
    if (!initialSettings.enabled || !initialSettings.worldSimulationEnabled) {
        throw new Error('世界推演模块当前已停用');
    }
    if (!hasUsableAssistantText(beforeMessage)) {
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
        playerIdentityAnchor: settings.playerIdentityAnchor,
        newAssistantTurns: assistantTurnsToApply,
        backgroundNpcBudget: settings.backgroundNpcBudget,
    });
    const simulationModeLabel = {
        light: '轻量',
        balanced: '均衡',
        deep: '深入',
        manual: '手动',
    }[settings.autoSimulationMode] || '均衡';
    const generationMetrics = {
        raw: '',
        attempts: 1,
        tokenBudget: 0,
    };
    const controller = new AbortController();
    const activeSimulation = {
        controller,
        messageId,
        trigger,
        apiMode: settings.apiMode,
        cancelled: false,
    };
    runtime.activeSimulation = activeSimulation;

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
        const automaticMaxTokens = settings.autoSimulationMode === 'deep'
            ? 4600
            : settings.autoSimulationMode === 'light'
                ? 2400
                : 3400;
        const baseMaxTokens = settings.maxOutputTokens > 0
            ? settings.maxOutputTokens
            : automaticMaxTokens;
        const payload = await runWithRetries(async attempt => {
            generationMetrics.attempts = attempt + 1;
            generationMetrics.tokenBudget = retryTokenBudget(baseMaxTokens, attempt);
            const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: generationMetrics.tokenBudget,
                temperature: attempt > 0
                    ? 0.08
                    : settings.autoSimulationMode === 'deep' ? 0.28 : 0.18,
                signal: controller.signal,
            });
            generationMetrics.raw = String(raw || '');
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
            signal: controller.signal,
        });

        if (controller.signal.aborted) {
            const error = new Error('推演已由用户取消');
            error.name = 'AbortError';
            throw error;
        }

        // Settings may have changed while the API request was in flight. The
        // commit decision must use the current switch value, not the snapshot
        // captured when generation started.
        const memoryEnabledAtCommit = getSettings().memorySystemEnabled;
        const applicablePayload = memoryEnabledAtCommit
            ? payload
            : {
                ...payload,
                memory_update: {
                    facts_upsert: [],
                    facts_invalidate: [],
                    clues_upsert: [],
                    clues_resolve: [],
                },
                memoryUpdate: {
                    factsUpsert: [],
                    factsInvalidate: [],
                    cluesUpsert: [],
                    cluesResolve: [],
                },
            };
        let resultState = applySimulationResult(baseState, applicablePayload, {
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
        const nextInjection = buildInjectionPackage(resultState, settings, recentChatText());
        const summary = simulationSummary(baseState, resultState, {
            prompt,
            raw: generationMetrics.raw,
            attempts: generationMetrics.attempts,
            tokenBudget: generationMetrics.tokenBudget,
            injection: nextInjection,
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
            summary,
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
            summary,
        });
        return resultState;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            const target = locateTargetBranch(messageId, swipeId, expectedHash);
            if (target) {
                attachBranchData(target.message, swipeId, {
                    ...prepared.data,
                    status: 'pending',
                    error: '',
                });
                await target.context.saveChat?.();
            }
            const store = getStore();
            store.currentState = markPendingSync(baseState, true);
            saveStore(store);
            refreshInjection();
            runtime.ui?.render();
            setSyncStatus({
                phase: 'pending',
                message: '本次推演已取消，正文仍保持待同步',
                error: '',
            });
            toast('已停止推演；时间、人物、事件和记忆均未提交。', 'info');
            throw error;
        }
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
        if (runtime.activeSimulation === activeSimulation) {
            runtime.activeSimulation = null;
        }
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
    const message = getContext()?.chat?.[Number(messageId)];
    if (!hasUsableAssistantText(message)) {
        setSyncStatus({
            phase: 'idle',
            message: '未检测到有效 AI 正文，本轮没有推进世界',
            error: '',
        });
        return;
    }
    if (!settings.enabled || !settings.worldSimulationEnabled) {
        setSyncStatus({
            phase: 'idle',
            message: settings.enabled ? '世界推演模块已停用' : '世界背面当前未启用',
            error: '',
        });
        return;
    }
    markMessagePending(messageId, { trigger: type || 'reply' });
    if (!settings.autoSync) {
        setSyncStatus({
            phase: 'pending',
            message: '自动推演设为手动；可随时推演累计正文',
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
        || !settings.worldSimulationEnabled
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
        .filter(hasUsableAssistantText)
        .length;
}

function scheduleAutoMemoryIndex() {
    const settings = getSettings();
    const interval = settings.memoryAutoIndexInterval;
    if (!settings.enabled || !settings.memorySystemEnabled || interval <= 0) return;
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
    const message = getContext()?.chat?.[Number(messageId)];
    if (!hasUsableAssistantText(message)) {
        setSyncStatus({
            phase: 'idle',
            message: '回复为空或生成失败，已跳过推演与记忆写入',
            error: '',
        });
        return;
    }
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
    const swipeId = Number(message?.swipe_id ?? 0);
    const existing = message ? branchDataFromMessage(message, swipeId) : null;

    if (
        message
        && !message.is_user
        && index === context.chat.length - 1
        && existing?.status === 'committed'
        && existing.result
        && existing.base
        && !existing.stale
    ) {
        runtime.editDecision = {
            chatToken: currentChatToken(),
            messageId: index,
        };
        setSyncStatus({
            phase: 'pending',
            message: '检测到已推演正文被编辑，正在等待你选择是否重推',
            error: '',
        });
        runtime.ui?.render();
        return;
    }

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
        setSyncStatus({
            phase: 'pending',
            message: '正文已编辑，世界状态尚未改动；确认内容后请手动同步',
            error: '',
        });
        toast('正文修改已保存，但不会自动重推；确认满意后再点“同步最新正文”。', 'info');
        return;
    }
    toast('已回到编辑点之前的世界快照；后续正文需要重新生成或手动同步。', 'info');
}

async function resolveMessageEdit(mode) {
    const decision = runtime.editDecision;
    if (!decision || decision.chatToken !== currentChatToken()) {
        runtime.editDecision = null;
        throw new Error('这次正文修改已经不在当前聊天分支中');
    }
    const context = getContext();
    const message = context?.chat?.[decision.messageId];
    if (!message || message.is_user || decision.messageId !== context.chat.length - 1) {
        runtime.editDecision = null;
        throw new Error('正文位置已经改变，请改用“推演最新正文”同步');
    }

    if (mode === 'keep') {
        runtime.editDecision = null;
        setSyncStatus({
            phase: 'success',
            message: '已保留编辑前的世界推演结果',
            error: '',
        });
        runtime.ui?.render();
        toast('已保留原推演，适合仅修改错字、标点或措辞的情况。', 'success');
        return;
    }

    if (!getSettings().worldSimulationEnabled) {
        throw new Error('世界推演模块当前已停用，无法按修改后的正文重推');
    }
    runtime.editDecision = null;
    markSnapshotsStaleFrom(decision.messageId);
    const store = getStore();
    const previous = findLatestResultSnapshot(decision.messageId);
    store.currentState = markPendingSync(
        previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
        true,
    );
    saveStore(store);
    refreshInjection();
    runtime.ui?.render();
    await queueSimulation(decision.messageId, {
        force: true,
        trigger: 'edited-reply',
        newAssistantCount: 1,
    });
    toast('已按照修改后的正文重新完成世界推演。', 'success');
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
    runtime.editDecision = null;
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

async function pullCustomApiModels() {
    const settings = getSettings();
    if (settings.apiMode !== 'custom') {
        throw new Error('请先把世界推演连接切换为“独立接口”');
    }
    runtime.modelPullStatus = { phase: 'running', message: '正在读取模型列表' };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(settings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `已读取 ${models.length} 个模型；仍可手动填写`,
        };
        toast(`已读取 ${models.length} 个可用模型。`, 'success');
        return models;
    } catch (error) {
        runtime.modelPullStatus = {
            phase: 'error',
            message: describeError(error),
        };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

async function scanHistoryArchive({
    automatic = false,
    maximumBatches = Number.POSITIVE_INFINITY,
} = {}) {
    if (!getSettings().memorySystemEnabled) {
        if (automatic) return false;
        throw new Error('记忆系统当前已停用');
    }
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
    const controller = new AbortController();
    runtime.activeHistoryScan = controller;
    setBusy(true);
    runtime.ui?.render();

    try {
        let completedBatches = 0;
        let assistantBatchLimit = automatic
            ? Math.min(6, Math.max(1, getSettings().memoryAutoIndexInterval))
            : 6;
        const batchLimit = Number.isFinite(Number(maximumBatches))
            ? Math.max(1, Number.parseInt(maximumBatches, 10) || 1)
            : Number.POSITIVE_INFINITY;
        while (cursor < chatLength && completedBatches < batchLimit) {
            if (!getSettings().memorySystemEnabled || controller.signal.aborted) {
                const error = new Error('记忆系统已关闭，本次整理已停止');
                error.name = 'AbortError';
                throw error;
            }
            if (currentChatToken() !== chatToken) {
                throw new Error('扫描期间切换了聊天，本次已在上一个完成批次处停止');
            }
            const batch = nextHistoryBatch(cursor, {
                maximumAssistantTurns: assistantBatchLimit,
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

            let payload;
            try {
                payload = await runWithRetries(async attempt => {
                    const prompt = buildHistoryIndexPrompt(state, {
                        messages: batch.messages,
                        userName: context?.name1 || '',
                        playerIdentityAnchor: getSettings().playerIdentityAnchor,
                        compact: attempt > 0,
                    });
                    const historyBaseTokens = getSettings().maxOutputTokens > 0
                        ? Math.max(3200, getSettings().maxOutputTokens)
                        : 3200;
                    const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                        maxTokens: retryTokenBudget(historyBaseTokens, attempt),
                        temperature: attempt > 0 ? 0.05 : 0.1,
                        signal: controller.signal,
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
                        runtime.historyProgress.message = `记忆整理失败，正在用紧凑格式重试 ${attempt}/${total}`;
                        runtime.ui?.render();
                    },
                    signal: controller.signal,
                });
            } catch (error) {
                const assistantTurns = batch.messages.filter(message => message.role === 'assistant').length;
                const canSplit = assistantTurns > 1 && (
                    /JSON|截断|长度上限|No message generated|没有返回最终正文|没有可读取的最终正文/i
                        .test(describeError(error))
                );
                if (canSplit) {
                    assistantBatchLimit = Math.max(1, Math.floor(assistantTurns / 2));
                    runtime.historyProgress.message = `输出过长或为空，已自动缩小为每批 ${assistantBatchLimit} 轮后重试`;
                    runtime.ui?.render();
                    continue;
                }
                throw error;
            }
            if (!getSettings().memorySystemEnabled || controller.signal.aborted) {
                const error = new Error('记忆系统已关闭，本次整理已停止');
                error.name = 'AbortError';
                throw error;
            }
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
        if (error?.name === 'AbortError') {
            runtime.historyProgress = {
                ...runtime.historyProgress,
                phase: 'idle',
                message: '记忆整理已停止，未提交正在生成的批次',
            };
            runtime.ui?.render();
            return false;
        }
        runtime.historyProgress = {
            ...runtime.historyProgress,
            phase: 'error',
            message: describeError(error),
        };
        runtime.ui?.render();
        throw error;
    } finally {
        if (runtime.activeHistoryScan === controller) runtime.activeHistoryScan = null;
        setBusy(false);
    }
}

function personObservationCacheKey(state, person) {
    const latest = latestAssistantEntry();
    const source = latest
        ? branchSourceKey(latest.index, latest.message)
        : 'no-assistant';
    const stateFingerprint = hashText(JSON.stringify({
        clock: state.clock.absoluteMinute,
        world: state.world,
        person: {
            id: person.id,
            location: person.location,
            action: person.action,
            intent: person.intent,
            goal: person.longTermGoal,
            updatedAt: person.updatedAt,
        },
    }));
    return `${person.id}:${source}:${stateFingerprint}`;
}

function cachedPersonObservation(personId) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) return null;
    const cached = getStore().personObservations?.[personObservationCacheKey(state, person)];
    if (!cached) return null;
    const queuedEvent = cached.queuedEventId
        ? state.events.find(event => event.id === cached.queuedEventId)
        : null;
    const revealState = queuedEvent?.delivery?.state === 'delivered'
        ? 'delivered'
        : queuedEvent?.delivery?.state === 'expired'
            ? 'expired'
            : (
                queuedEvent
                && (cached.revealEnabled ?? (
                    queuedEvent.delivery?.manualQueued
                    || queuedEvent.delivery?.state === 'pending'
                ))
            )
                ? 'enabled'
                : 'off';
    return {
        ...cached,
        queued: revealState === 'enabled',
        revealState,
    };
}

function queuePersonObservation(personId) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) throw new Error('没有找到这个人物');
    const cacheKey = personObservationCacheKey(state, person);
    const store = getStore();
    const observation = store.personObservations?.[cacheKey];
    if (!observation?.text) throw new Error('请先生成一次人物观测');
    const existing = state.events.find(event => event.id === observation.queuedEventId);
    if (existing?.delivery?.state === 'delivered') {
        throw new Error('这段观测已经由正文自然承接，无法撤回');
    }

    if (existing) {
        const enabled = !['delivered', 'expired', 'none'].includes(existing.delivery?.state)
            && (observation.revealEnabled ?? (
                existing.delivery?.manualQueued
                || existing.delivery?.state === 'pending'
            ));
        const next = clone(state);
        const event = next.events.find(item => item.id === existing.id);
        event.delivery ||= { state: 'none' };
        event.delivery.manualQueued = !enabled;
        event.delivery.state = enabled ? 'none' : 'pending';
        if (!enabled) event.delivery.attempts = 0;
        observation.revealEnabled = !enabled;
        store.personObservations[cacheKey] = observation;
        commitManualState(
            next,
            enabled
                ? `已将 ${person.name} 的幕后观测撤回为仅观看。`
                : `已允许 ${person.name} 的幕后观测在合适时自然显露。`,
        );
        saveStore(store);
        return cachedPersonObservation(personId);
    }

    const previousIds = new Set(state.events.map(event => event.id));
    const next = addManualEvent(state, {
        title: `${person.name}的镜头外片段`,
        place: person.location,
        summary: observation.text,
        expected_result: observation.text,
        result: observation.text,
        consequence: observation.text,
        status: 'ready',
        clock_mode: 'condition',
        visibility: 'trace',
        delivery_queued: true,
        delivery_route: observation.text,
    });
    const created = next.events.find(event => !previousIds.has(event.id));
    if (!created) throw new Error('没有成功建立自然显露候选');
    commitManualState(next, `已允许 ${person.name} 的幕后观测在合适时自然显露。`);
    observation.queuedEventId = created.id;
    observation.revealEnabled = true;
    store.personObservations[cacheKey] = observation;
    saveStore(store);
    return cachedPersonObservation(personId);
}

async function observePerson(personId, { force = false } = {}) {
    const state = getState();
    const person = state.people.find(item => item.id === personId);
    if (!person) throw new Error('没有找到这个人物');
    if (person.isUser) throw new Error('玩家角色不使用镜头外人物观测');
    if (currentTurnPresentPersonIds().includes(person.id)) {
        throw new Error('这个人物已经在本轮镜头中，不需要另行观测');
    }
    const cacheKey = personObservationCacheKey(state, person);
    const cached = getStore().personObservations?.[cacheKey];
    if (cached && !force) return cached;
    const settings = getSettings();
    const latest = latestAssistantEntry();
    const narrative = latest
        ? narrativeContext(latest.index, settings.contextTurns)
        : { turns: [] };
    const prompt = buildPersonObservationPrompt(state, person, {
        narrativeTurns: narrative.turns,
        userName: getContext()?.name1 || '',
        includeUserInnerVoice: settings.includeUserInnerVoice,
        playerIdentityAnchor: settings.playerIdentityAnchor,
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
        const result = {
            personId: person.id,
            text,
            worldMinute: state.clock.absoluteMinute,
            cacheKey,
        };
        const store = getStore();
        store.personObservations[cacheKey] = result;
        const cacheEntries = Object.entries(store.personObservations);
        if (cacheEntries.length > 30) {
            store.personObservations = Object.fromEntries(cacheEntries.slice(-30));
        }
        saveStore(store);
        return result;
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
        if (payload.memorySystemEnabled === false) {
            if (runtime.autoMemoryTimer !== null) {
                window.clearTimeout(runtime.autoMemoryTimer);
                runtime.autoMemoryTimer = null;
            }
            runtime.activeHistoryScan?.abort();
        }
        context.extensionSettings[MODULE_ID] = settings;
        saveSettings();
        refreshInjection();
        syncSettingsEntry();
        runtime.ui?.render();
        if (payload.autoSimulationMode && payload.autoSimulationMode !== 'manual') {
            window.setTimeout(schedulePendingCatchUp, 40);
        }
        return;
    }

    if (action === 'test-api') {
        return testCustomApiConnection();
    }

    if (action === 'pull-api-models') {
        return pullCustomApiModels();
    }

    if (action === 'scan-history') {
        return scanHistoryArchive();
    }

    if (action === 'observe-person') {
        return observePerson(String(payload.personId || ''), { force: Boolean(payload.force) });
    }

    if (action === 'get-person-observation') {
        return cachedPersonObservation(String(payload.personId || ''));
    }

    if (action === 'queue-person-observation') {
        return queuePersonObservation(String(payload.personId || ''));
    }

    if (action === 'save-memory-item') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const id = String(payload.id || '');
        const title = String(payload.title || '').trim();
        const relation = String(payload.relation || '').trim();
        const content = String(payload.content || '').trim();
        if (!title || !content) throw new Error('标题和内容不能为空');

        const next = clone(getState());
        next.storyMemory ||= { facts: [], clues: [], summaries: [] };
        const collection = kind === 'fact'
            ? next.storyMemory.facts
            : kind === 'clue'
                ? next.storyMemory.clues
                : next.storyMemory.summaries;
        const existing = collection.find(item => item.id === id);
        if (existing?.locked && payload.locked === false) {
            throw new Error('请先用卡片上的锁定按钮解锁，再编辑这条记忆');
        }
        const itemId = existing?.id || `${kind}_manual_${Date.now().toString(36)}`;
        const common = {
            ...(existing || {}),
            id: itemId,
            locked: Boolean(payload.locked),
            important: Boolean(payload.important),
            manual: true,
        };
        let updated;
        if (kind === 'fact') {
            updated = {
                ...common,
                key: existing?.key || `manual:${hashText(`${title}\n${relation}`)}`,
                subject: title.slice(0, 100),
                predicate: relation.slice(0, 100),
                value: content.slice(0, 520),
                status: existing?.status || 'active',
                confidence: existing?.confidence || 'high',
                importance: payload.important ? 3 : (existing?.importance || 2),
                visibility: existing?.visibility || 'known',
                updatedAt: next.clock.absoluteMinute,
            };
        } else if (kind === 'clue') {
            updated = {
                ...common,
                title: title.slice(0, 120),
                text: content.slice(0, 620),
                status: existing?.status || 'open',
                importance: payload.important ? 3 : (existing?.importance || 1),
                visibility: existing?.visibility || 'hidden',
                updatedAt: next.clock.absoluteMinute,
                createdAt: existing?.createdAt ?? next.clock.absoluteMinute,
            };
        } else {
            const anchor = latestAssistantEntry()?.index ?? 0;
            updated = {
                ...common,
                title: title.slice(0, 120),
                summary: content.slice(0, 1400),
                startMessageId: existing?.startMessageId ?? anchor,
                endMessageId: existing?.endMessageId ?? anchor,
                createdAt: existing?.createdAt || new Date().toISOString(),
            };
        }
        if (existing) Object.assign(existing, updated);
        else collection.unshift(updated);
        commitManualState(next, existing ? '记忆已经更新。' : '手动记忆已经加入。');
        return updated;
    }

    if (action === 'toggle-memory-flag') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const field = payload.field === 'locked' ? 'locked' : 'important';
        const next = clone(getState());
        const collection = kind === 'fact'
            ? next.storyMemory?.facts
            : kind === 'clue'
                ? next.storyMemory?.clues
                : next.storyMemory?.summaries;
        const item = collection?.find(entry => entry.id === String(payload.id || ''));
        if (!item) throw new Error('没有找到这条记忆');
        item[field] = !item[field];
        if (field === 'important' && item.important && 'importance' in item) item.importance = 3;
        commitManualState(next, field === 'locked'
            ? (item.locked ? '记忆已锁定，不会被自动整理覆盖。' : '记忆已解锁。')
            : (item.important ? '已标记为重要记忆。' : '已取消重要标记。'));
        return;
    }

    if (action === 'delete-memory-item') {
        const kind = ['fact', 'clue', 'summary'].includes(payload.kind) ? payload.kind : 'fact';
        const next = clone(getState());
        const collection = kind === 'fact'
            ? next.storyMemory?.facts
            : kind === 'clue'
                ? next.storyMemory?.clues
                : next.storyMemory?.summaries;
        const index = collection?.findIndex(entry => entry.id === String(payload.id || '')) ?? -1;
        if (index < 0) throw new Error('没有找到这条记忆');
        if (collection[index].locked) throw new Error('锁定的记忆不能删除，请先解锁');
        collection.splice(index, 1);
        commitManualState(next, '记忆已经删除。');
        return;
    }

    if (action === 'save-manual-person') {
        const id = String(payload.id || '');
        const name = String(payload.name || '').trim();
        if (!name) throw new Error('人物姓名不能为空');
        const next = clone(getState());
        const existing = next.people.find(person => person.id === id);
        if (existing?.locked && payload.locked === false) {
            throw new Error('请先解锁人物卡，再修改核心设定');
        }
        const person = {
            ...(existing || {}),
            id: existing?.id || `person_manual_${hashText(`${name}\n${Date.now()}`)}`,
            name: name.slice(0, 80),
            monogram: name.slice(0, 1),
            location: String(payload.location || '位置待确认').trim().slice(0, 160),
            action: String(payload.action || '当前行动待确认').trim().slice(0, 280),
            intent: String(payload.intent || '短期意图待确认').trim().slice(0, 320),
            longTermGoal: String(payload.longTermGoal || '').trim().slice(0, 420),
            identityAnchor: String(payload.identityAnchor || '').trim().slice(0, 500),
            personalityAnchor: String(payload.personalityAnchor || '').trim().slice(0, 600),
            speakingStyle: String(payload.speakingStyle || '').trim().slice(0, 360),
            behaviorBoundaries: String(payload.behaviorBoundaries || '').trim().slice(0, 500),
            knowledge: payload.knowledge === 'known' ? 'known' : 'backstage',
            relevance: Math.min(3, Math.max(0, Number(payload.relevance) || 2)),
            simulationEnabled: Boolean(payload.simulationEnabled),
            locked: Boolean(payload.locked),
            manual: true,
            source: 'manual',
            isUser: Boolean(existing?.isUser),
            updatedAt: next.clock.absoluteMinute,
        };
        if (existing) Object.assign(existing, person);
        else next.people.push(person);
        commitManualState(next, existing ? '后台人物卡已经更新。' : `已将 ${person.name} 加入后台人物。`);
        return person;
    }

    if (action === 'delete-manual-person') {
        const next = clone(getState());
        const index = next.people.findIndex(person => person.id === String(payload.id || ''));
        if (index < 0) throw new Error('没有找到这个人物');
        if (next.people[index].locked) throw new Error('锁定的人物卡不能删除，请先解锁');
        const [removed] = next.people.splice(index, 1);
        commitManualState(next, `已移除后台人物 ${removed.name}。`);
        return;
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

    if (action === 'toggle-event-delivery') {
        const eventId = String(payload.eventId || '');
        const next = clone(getState());
        const event = next.events.find(item => item.id === eventId);
        if (!event) throw new Error('没有找到这条事件');
        if (event.visibility === 'hidden') {
            throw new Error('完全隐藏的事件不能注入正文；请先调整其可见性');
        }
        event.delivery ||= { state: 'none' };
        event.delivery.manualQueued = !event.delivery.manualQueued;
        commitManualState(
            next,
            event.delivery.manualQueued
                ? `“${event.title}”将在下一轮优先寻找自然显露时机。`
                : `已取消“${event.title}”的下一轮显露。`,
        );
        return;
    }

    if (action === 'scan-worldbook') {
        return await scanWorldbook(payload.bookName);
    }

    if (action === 'import-worldbook-people') {
        return importWorldbookPeople(payload.bookName, payload.entryIds);
    }

    if (action === 'cancel-simulation') {
        if (!cancelActiveSimulation()) {
            toast('当前没有正在运行的世界推演。', 'info');
        }
        return;
    }

    if (action === 'resolve-message-edit') {
        await resolveMessageEdit(payload.mode === 'keep' ? 'keep' : 'rerun');
        return;
    }

    if (action === 'manual-sync') {
        if (!getSettings().worldSimulationEnabled) {
            toast('世界推演模块当前已停用。', 'warning');
            return;
        }
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
