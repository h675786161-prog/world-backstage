import {
    MODULE_ID,
    SCHEMA_VERSION,
    SNAPSHOT_KEY,
    STATE_KEY,
    addRecoveryPoint,
    addManualEvent,
    advanceWorldClock,
    applySimulationResult,
    applyHistoryIndexResult,
    applyWorldBootstrapResult,
    applyPublicImpactResult,
    applyMemoryRollupResult,
    buildInjectionPackage,
    buildHistoryIndexPrompt,
    buildWorldBootstrapPrompt,
    buildWorldPulsePrompt,
    buildPublicImpactPrompt,
    buildMemoryRollupPrompt,
    buildPersonObservationPrompt,
    buildSimulationPrompt,
    createInitialState,
    createCompactSnapshot,
    DEFAULT_TAG_FILTER_RULES,
    extractJsonObject,
    extractTagFilterCandidates,
    extractNarrativeTimeAnchor,
    filterNarrativeText,
    formatWorldCalendar,
    countSurvivingNewAssistantTurns,
    hashText,
    selectPendingAssistantMessageIds,
    listRecoveryPoints,
    listRecoveryPointHeaders,
    markPendingSync,
    pendingPublicImpactEvents,
    normalizeTagFilterRules,
    planMemoryRollup,
    recordDeliveryOffers,
    restoreCompactSnapshot,
    restoreRecoveryPoint,
    setWorldCalendar,
    settlePersonWorldState,
    trimState,
} from './core.js';
import {
    getLastCustomApiOperation,
    getRetryControlStatus,
    isAbortError,
    requestCustomCompletion,
    requestCustomModels,
    resetLastCustomApiOperation,
    runWithRetries,
} from './api.js';
import { createWorldBackstageUI } from './ui.js';
import { buildBackstageMessages } from './prompt-bridge.js';
import { INTERNAL_COMPAT_SYSTEM_PROMPT } from './internal-compat.js';
import { detectWorldbookCharacter, extractWorldbookCharacterProfile } from './worldbook.js';
import {
    buildPublicOpinionPrompt,
    buildPublicOpinionSandboxPrompt,
    eligiblePublicOpinionEvents,
    emptyPublicOpinionCache,
    emptyPublicOpinionSandbox,
    normalizePublicOpinionCache,
    normalizePublicOpinionPayload,
    mergePublicOpinionStream,
    planPublicOpinionRefresh,
    publicOpinionSourceSignature,
    normalizePublicOpinionSandbox,
    normalizePublicOpinionSandboxPayload,
} from './public-opinion.js';

const PROMPT_KEY = 'world_backstage_authoritative_state';
const SUPPORT_PROMPT_KEY = 'world_backstage_context_support';
const PLUGIN_VERSION = '1.7.2';
const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 23,
    enabled: true,
    promptInjection: true,
    worldSimulationEnabled: true,
    worldPromptInjection: true,
    memorySystemEnabled: true,
    memoryPromptInjection: true,
    autoSync: true,
    worldAutoEnabled: true,
    autoSimulationMode: 'balanced',
    worldPulseActivity: 'natural',
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
    orbEnabled: true,
    includeUserInnerVoice: false,
    uiScale: 'comfortable',
    contextTurns: 5,
    customContextTurns: 8,
    timePolicy: 'world',
    apiMode: 'tavern',
    customApiUrl: '',
    customApiKey: '',
    customApiModel: '',
    customApiTransport: 'proxy',
    customApiTimeoutMs: 120000,
    apiProfiles: [],
    apiModuleRoutes: {
        simulation: 'default',
        observation: 'default',
        history: 'default',
        opinion: 'default',
    },
    publicOpinionRevealMode: 'observe',
    publicOpinionAutoEnabled: true,
    // 0 = automatic task budget. A positive value is a global upper cap.
    maxOutputTokens: 0,
    // 0 = module-aware automatic timeout. This counts active request time only.
    generationTimeoutMs: 0,
    generationModuleLimits: {
        simulation: { maxTokens: 0, timeoutMs: 0 },
        observation: { maxTokens: 0, timeoutMs: 0 },
        history: { maxTokens: 0, timeoutMs: 0 },
        opinion: { maxTokens: 0, timeoutMs: 0 },
    },
    tagFilterEnabled: true,
    tagFilterRules: DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule })),
    narrativeIncludeTag: '',
    narrativeRegexFilters: '',
});

const runtime = {
    initialized: false,
    ui: null,
    transientStore: null,
    preparedStores: new WeakSet(),
    injection: { text: '', eventIds: [] },
    generationOffer: { eventIds: [], at: 0 },
    simulationChain: Promise.resolve(),
    simulationCount: 0,
    activeSimulation: null,
    activeHistoryScan: null,
    activeWorldPulse: null,
    activePublicImpact: null,
    pendingPublicImpact: false,
    activePublicOpinion: null,
    publicOpinionRefreshTransaction: null,
    activePublicOpinionSandbox: null,
    pendingPublicOpinion: false,
    activeObservation: null,
    inBackgroundGeneration: false,
    consistencyBarrierRunning: false,
    activeChatToken: '',
    contextEpoch: 0,
    queuedSimulations: new Map(),
    autoMemoryTimer: null,
    publicImpactTimer: null,
    publicOpinionTimer: null,
    manualUndo: null,
    manualUndoTimer: null,
    editDecision: null,
    customModels: [],
    modelPullStatus: { phase: 'idle', message: '' },
    lastPromptBridge: null,
    lastTaskConnection: null,
    publicOpinionStatus: {
        phase: 'idle',
        message: '舆情还没开张呢～',
        error: '',
    },
    publicOpinionSandboxStatus: {
        phase: 'idle',
        message: '',
        error: '',
    },
    worldbookScan: {
        phase: 'idle',
        message: '',
        bookName: '',
        entries: [],
    },
    historyProgress: {
        kind: 'memory',
        phase: 'idle',
        processed: 0,
        total: 0,
        message: '',
    },
    syncStatus: {
        phase: 'idle',
        message: '还没推演过～世界先在这里等你',
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
    if (!name) throw new Error('先挑一本世界书给我看看嘛～');
    if (typeof context?.loadWorldInfo !== 'function') {
        throw new Error('当前酒馆版本没有开放世界书读取接口');
    }
    runtime.worldbookScan = {
        phase: 'running',
        message: `正在翻《${name}》～稍等一下下`,
        bookName: name,
        entries: [],
    };
    runtime.ui?.render();
    try {
        const data = await context.loadWorldInfo(name);
        const entries = Object.values(data?.entries || {})
            .filter(entry => entry && String(entry.content || '').trim())
            .map(entry => {
                const name = worldbookEntryLabel(entry);
                const content = String(entry.content || '').trim().slice(0, 4000);
                const keys = [...new Set([
                    ...(Array.isArray(entry.key) ? entry.key : [entry.key]),
                    ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : [entry.keysecondary]),
                ].map(key => String(key || '').trim()).filter(Boolean))].slice(0, 12);
                const tags = [...new Set([
                    entry.group,
                    entry.position,
                    entry.role,
                ].map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 8);
                const formatHints = [...new Set(
                    [...content.matchAll(/<\s*([a-zA-Z][\w:-]*)\b/g)]
                        .map(match => String(match[1] || '').toLocaleLowerCase())
                        .filter(Boolean),
                )].slice(0, 12);
                const profile = extractWorldbookCharacterProfile(content, name);
                const detection = detectWorldbookCharacter({ name, content, keys, tags, formatHints }, profile);
                return {
                    uid: String(entry.uid ?? ''),
                    name,
                    parsedName: profile.explicitName ? profile.name : '',
                    content,
                    keys,
                    tags,
                    formatHints,
                    disabled: Boolean(entry.disable),
                    order: Number(entry.order) || 0,
                    profile,
                    ...detection,
                };
            })
            .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.order - a.order)
            .slice(0, 1000);
        runtime.worldbookScan = {
            phase: 'success',
            message: entries.length
                ? `翻到 ${entries.length} 条内容啦～其中 ${entries.filter(entry => entry.likelyPerson).length} 条看起来像人物，确认一下再导入就好`
                : '这本世界书里暂时没翻到能读的内容哦～',
            bookName: name,
            entries,
        };
        return runtime.worldbookScan;
    } catch (error) {
        runtime.worldbookScan = {
            phase: 'error',
            message: `没读成功 QAQ：${describeError(error)}`,
            bookName: name,
            entries: [],
        };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

function looksLikeLegacyWorldbookPersonalityDump(value, candidateContent = '') {
    const text = String(value || '').trim();
    const raw = String(candidateContent || '').trim();
    if (!text) return false;
    if (raw && text === raw.slice(0, 600)) return true;
    const markerHits = (text.match(/(?:<\/?(?:info|character)\b|中文名|姓名|昵称|gender|性别|age|年龄|birthday|生日|identity|身份|background|背景|appearance|外貌|height|身高)/giu) || []).length;
    return markerHits >= 3;
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
        const profile = candidate.profile || extractWorldbookCharacterProfile(candidate.content, candidate.name);
        const importedName = String(profile.name || candidate.parsedName || candidate.name || '').trim().slice(0, 80);
        if (!importedName) continue;
        const existing = next.people.find(person => (
            person.worldbookRef === reference
            || person.name.toLocaleLowerCase() === importedName.toLocaleLowerCase()
            || person.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase()
        ));
        if (existing) {
            const fillIfBlank = (field, value) => {
                if (value && !String(existing[field] || '').trim()) existing[field] = value;
            };
            fillIfBlank('identityAnchor', profile.identityAnchor);
            if (
                profile.personalityAnchor
                && (
                    !String(existing.personalityAnchor || '').trim()
                    || looksLikeLegacyWorldbookPersonalityDump(existing.personalityAnchor, candidate.content)
                )
            ) {
                existing.personalityAnchor = profile.personalityAnchor;
            }
            fillIfBlank('appearanceProfile', profile.appearanceProfile);
            fillIfBlank('backgroundProfile', profile.backgroundProfile);
            fillIfBlank('speakingStyle', profile.speakingStyle);
            fillIfBlank('behaviorBoundaries', profile.behaviorBoundaries);
            existing.worldbookRaw = profile.worldbookRaw || existing.worldbookRaw || '';
            existing.worldbookRef = reference;
            existing.manual = true;
            existing.updatedAt = next.clock.absoluteMinute;
            updated += 1;
            continue;
        }
        next.people.push({
            id: `person_worldbook_${hashText(reference)}`,
            name: importedName,
            monogram: importedName.slice(0, 1),
            location: '位置待确认',
            action: '当前行动待确认',
            intent: '短期意图待确认',
            longTermGoal: '',
            identityAnchor: profile.identityAnchor,
            personalityAnchor: profile.personalityAnchor,
            appearanceProfile: profile.appearanceProfile,
            backgroundProfile: profile.backgroundProfile,
            worldbookRaw: profile.worldbookRaw,
            speakingStyle: profile.speakingStyle,
            behaviorBoundaries: profile.behaviorBoundaries,
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
    if (runtime.ui?.notify) {
        runtime.ui.notify(message, tone);
        return;
    }
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

function normalizeApiProfiles(value) {
    const seen = new Set();
    const result = [];
    for (const raw of Array.isArray(value) ? value : []) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim().slice(0, 80);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = String(raw.name || '未命名方案').trim().slice(0, 80) || '未命名方案';
        const url = String(raw.url || raw.customApiUrl || '').trim().slice(0, 500);
        const key = String(raw.key || raw.customApiKey || '').trim().slice(0, 1000);
        const model = String(raw.model || raw.customApiModel || '').trim().slice(0, 180);
        const transport = ['proxy', 'direct'].includes(raw.transport || raw.customApiTransport)
            ? (raw.transport || raw.customApiTransport)
            : 'proxy';
        result.push({ id, name, url, key, model, transport });
        if (result.length >= 20) break;
    }
    return result;
}

function normalizeApiModuleRoutes(value, profiles = []) {
    const validProfiles = new Set(profiles.map(profile => `profile:${profile.id}`));
    const normalizeRoute = route => {
        const text = String(route || 'default');
        if (text === 'default' || text === 'tavern') return text;
        return validProfiles.has(text) ? text : 'default';
    };
    const raw = value && typeof value === 'object' ? value : {};
    return {
        simulation: normalizeRoute(raw.simulation),
        observation: normalizeRoute(raw.observation),
        history: normalizeRoute(raw.history),
        opinion: normalizeRoute(raw.opinion),
    };
}


const AUTO_GENERATION_TIMEOUT_MS = Object.freeze({
    simulation: 180000,
    observation: 120000,
    history: 300000,
    opinion: 150000,
});

function normalizeGenerationTokenLimit(value) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(16000, Math.max(1000, numeric));
}

function normalizeGenerationTimeoutMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(600000, Math.max(15000, Math.round(numeric)));
}

function normalizeGenerationModuleLimits(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const key of ['simulation', 'observation', 'history', 'opinion']) {
        const item = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
        result[key] = {
            maxTokens: normalizeGenerationTokenLimit(item.maxTokens),
            timeoutMs: normalizeGenerationTimeoutMs(item.timeoutMs),
        };
    }
    return result;
}

function resolveGenerationLimits(settings, taskKind, requestedMaxTokens = 2200) {
    const routeKey = taskRouteKey(taskKind);
    const moduleLimit = settings.generationModuleLimits?.[routeKey] || {};
    const tokenCap = Number(moduleLimit.maxTokens) > 0
        ? Number(moduleLimit.maxTokens)
        : Number(settings.maxOutputTokens) > 0
            ? Number(settings.maxOutputTokens)
            : 0;
    const requested = Math.max(64, Number.parseInt(requestedMaxTokens, 10) || 2200);
    const maxTokens = tokenCap > 0
        ? Math.max(64, Math.min(requested, tokenCap))
        : requested;

    const timeoutMs = Number(moduleLimit.timeoutMs) > 0
        ? Number(moduleLimit.timeoutMs)
        : Number(settings.generationTimeoutMs) > 0
            ? Number(settings.generationTimeoutMs)
            : (AUTO_GENERATION_TIMEOUT_MS[routeKey] || 180000);

    return {
        routeKey,
        requestedMaxTokens: requested,
        tokenCap,
        maxTokens,
        timeoutMs,
        timeoutSource: Number(moduleLimit.timeoutMs) > 0
            ? 'module'
            : Number(settings.generationTimeoutMs) > 0
                ? 'global'
                : 'auto',
        tokenSource: Number(moduleLimit.maxTokens) > 0
            ? 'module'
            : Number(settings.maxOutputTokens) > 0
                ? 'global'
                : 'auto',
    };
}

function makeApiProfileId() {
    return `api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    // Kept only as a migration field. World continuity is mandatory while the world engine is enabled;
    // worldPromptInjection now controls proactive reveal candidates only.
    settings.promptInjection = true;
    settings.worldSimulationEnabled = Boolean(settings.worldSimulationEnabled);
    settings.worldPromptInjection = Boolean(settings.worldPromptInjection);
    settings.memorySystemEnabled = Boolean(settings.memorySystemEnabled);
    settings.memoryPromptInjection = Boolean(settings.memoryPromptInjection);
    settings.autoSync = Boolean(settings.autoSync);
    settings.worldAutoEnabled = previousSettingsVersion < 19
        ? (
            previous?.worldAutoEnabled !== undefined
                ? Boolean(previous.worldAutoEnabled)
                : previous?.autoSync !== false && previous?.autoSimulationMode !== 'manual'
        )
        : settings.worldAutoEnabled !== false;
    settings.includeUserInnerVoice = Boolean(settings.includeUserInnerVoice);
    if (!['auto', 'day', 'night'].includes(settings.theme)) settings.theme = 'auto';
    if (!['restrained', 'balanced', 'active'].includes(settings.deliveryDensity)) {
        settings.deliveryDensity = 'restrained';
    }
    if (!['strict', 'smart', 'open'].includes(settings.sceneTiming)) settings.sceneTiming = 'strict';
    if (!['compact', 'comfortable', 'large'].includes(settings.uiScale)) {
        settings.uiScale = 'comfortable';
    }
    settings.contextTurns = Math.min(
        30,
        Math.max(1, Number.parseInt(settings.contextTurns, 10) || 5),
    );
    settings.customContextTurns = Math.min(
        30,
        Math.max(1, Number.parseInt(settings.customContextTurns, 10) || 8),
    );
    if (![1, 3, 5].includes(settings.contextTurns)) {
        settings.customContextTurns = settings.contextTurns;
    }
    if (previousSettingsVersion < 4) settings.contextTurns = 5;
    if (previousSettingsVersion < 8) settings.orbPosition = null;
    if (previousSettingsVersion < 5) {
        settings.autoSimulationMode = 'balanced';
    }
    if (settings.autoSimulationMode === 'manual') {
        settings.worldAutoEnabled = false;
        settings.autoSimulationMode = 'balanced';
    }
    if (!['light', 'balanced', 'deep'].includes(settings.autoSimulationMode)) {
        settings.autoSimulationMode = 'balanced';
    }
    if (!['quiet', 'natural', 'busy'].includes(settings.worldPulseActivity)) {
        settings.worldPulseActivity = 'natural';
    }
    if (legacySimulationPaused) {
        settings.worldAutoEnabled = false;
    }
    delete settings.simulationPaused;
    settings.autoSync = settings.worldAutoEnabled; // legacy alias
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
    // 0.9.6 removes foreground preset bridging entirely. World Backstage now
    // always uses its own internal compatibility layer plus task-specific system.
    delete settings.presetBridgeEnabled;
    delete settings.presetBridgeAdditionalPrompt;
    settings.playerIdentityAnchor = String(
        settings.playerIdentityAnchor || '',
    ).trim().slice(0, 400);
    settings.tagFilterEnabled = settings.tagFilterEnabled !== false;
    if (!Array.isArray(settings.tagFilterRules)) {
        settings.tagFilterRules = DEFAULT_TAG_FILTER_RULES.map(rule => ({ ...rule }));
    } else {
        settings.tagFilterRules = normalizeTagFilterRules(settings.tagFilterRules);
    }
    settings.narrativeIncludeTag = String(settings.narrativeIncludeTag || '')
        .trim().replace(/[<>]/g, '').slice(0, 80);
    settings.narrativeRegexFilters = String(settings.narrativeRegexFilters || '')
        .split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 8).join('\n').slice(0, 2200);
    if (previousSettingsVersion < 15) {
        settings.timePolicy = 'world';
    }
    settings.settingsVersion = 23;
    if (!['world', 'explicit', 'cautious', 'open'].includes(settings.timePolicy)) {
        settings.timePolicy = 'world';
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
    settings.apiProfiles = normalizeApiProfiles(settings.apiProfiles);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    if (!['observe', 'relevant'].includes(settings.publicOpinionRevealMode)) {
        settings.publicOpinionRevealMode = 'observe';
    }
    settings.publicOpinionAutoEnabled = settings.publicOpinionAutoEnabled !== false;
    settings.maxOutputTokens = normalizeGenerationTokenLimit(settings.maxOutputTokens);
    settings.generationTimeoutMs = normalizeGenerationTimeoutMs(settings.generationTimeoutMs);
    settings.generationModuleLimits = normalizeGenerationModuleLimits(settings.generationModuleLimits);
    settings.orbPosition = normalizeOrbPosition(settings.orbPosition);
    settings.orbEnabled = previousSettingsVersion < 22
        ? (previous?.orbEnabled !== undefined ? Boolean(previous.orbEnabled) : true)
        : settings.orbEnabled !== false;
    context.extensionSettings[MODULE_ID] = settings;
    if (previousSettingsVersion < 23) context.saveSettingsDebounced?.();
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
        memorySummaryArchive: [],
        personObservations: {},
        publicOpinion: emptyPublicOpinionCache(),
        publicOpinionListHidden: false,
        publicOpinionSandbox: emptyPublicOpinionSandbox(),
        recoveryPoints: [],
        updatedAt: new Date().toISOString(),
    };
}

function mergeMemorySummaryArchive(store, state = store?.currentState) {
    if (!store || typeof store !== 'object') return [];
    const existing = Array.isArray(store.memorySummaryArchive) ? store.memorySummaryArchive : [];
    const current = Array.isArray(state?.storyMemory?.summaries) ? state.storyMemory.summaries : [];
    const byId = new Map();
    for (const summary of [...existing, ...current]) {
        const id = String(summary?.id || '').trim();
        if (!id) continue;
        byId.set(id, clone(summary));
    }
    const merged = [...byId.values()]
        .sort((a, b) => Number(a?.endMessageId || 0) - Number(b?.endMessageId || 0));
    // Keep one chat-level reservoir instead of duplicating the whole hierarchy
    // in every message/swipe snapshot. The live state already applies its own
    // retention policy; this extra headroom mainly preserves alternate swipes.
    if (merged.length > 3600) {
        const protectedItems = merged.filter(item => (
            item?.locked || item?.important || item?.manual || Number(item?.level || 0) >= 2
        ));
        const protectedIds = new Set(protectedItems.map(item => item.id));
        const remainder = merged.filter(item => !protectedIds.has(item.id)).slice(-Math.max(0, 3600 - protectedItems.length));
        store.memorySummaryArchive = [...protectedItems, ...remainder]
            .sort((a, b) => Number(a?.endMessageId || 0) - Number(b?.endMessageId || 0));
    } else {
        store.memorySummaryArchive = merged;
    }
    return store.memorySummaryArchive;
}

function createBranchSnapshot(state, meta = {}, store = getStore()) {
    mergeMemorySummaryArchive(store, state);
    return createCompactSnapshot(state, meta);
}

function restoreBranchSnapshot(snapshot, fallback = null, store = getStore()) {
    return restoreCompactSnapshot(
        snapshot,
        fallback || store?.initialState || null,
        store?.memorySummaryArchive || [],
    );
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

function findPlayerPerson(state, userName = getContext()?.name1 || '') {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalizedUserName = String(userName || '').trim().toLocaleLowerCase();
    return people.find(person => person?.isUser)
        || people.find(person => (
            normalizedUserName
            && String(person?.name || '').trim().toLocaleLowerCase() === normalizedUserName
        ))
        || null;
}

function getPlayerIdentityAnchor(state = null) {
    const resolvedState = state || getState();
    const player = findPlayerPerson(resolvedState);
    if (player) return String(player.identityAnchor || '').trim().slice(0, 500);
    return String(getSettings().playerIdentityAnchor || '').trim().slice(0, 400);
}

function prepareStore(rawStore, context = getContext()) {
    let store = rawStore && typeof rawStore === 'object' ? rawStore : makeStore();
    if (runtime.preparedStores.has(store)) return store;

    const previousSchemaVersion = Number(
        store.schemaVersion
        ?? store.currentState?.schemaVersion
        ?? 0,
    );
    const migrationReason = `before-schema-${SCHEMA_VERSION}`;
    let createdMigrationRecovery = false;
    const recoveryHeaders = listRecoveryPointHeaders(store);
    if (
        previousSchemaVersion > 0
        && previousSchemaVersion < SCHEMA_VERSION
        && store.currentState
        && !recoveryHeaders.some(point => point.reason === migrationReason)
    ) {
        store = addRecoveryPoint(store, {
            reason: migrationReason,
            label: `升级到数据结构 ${SCHEMA_VERSION} 前自动保存`,
        });
        createdMigrationRecovery = true;
    }

    // Normalize persisted data exactly once per loaded store object. Repeating
    // trimState() on every read deep-clones thousands of memory items and makes
    // innocuous UI actions (such as checking a box) unexpectedly expensive.
    store.schemaVersion = SCHEMA_VERSION;
    store.initialState = trimState(store.initialState || createInitialState({ worldName: '主世界' }));
    store.currentState = trimState(store.currentState || store.initialState);
    store.memorySummaryArchive = Array.isArray(store.memorySummaryArchive)
        ? store.memorySummaryArchive
        : [];
    mergeMemorySummaryArchive(store, store.currentState);

    const settings = getSettings();
    const legacyPlayerIdentityAnchor = String(settings.playerIdentityAnchor || '').trim().slice(0, 400);
    const player = findPlayerPerson(store.currentState, context?.name1 || '');
    let migratedLegacyPlayerIdentity = false;
    if (player && legacyPlayerIdentityAnchor) {
        if (!String(player.identityAnchor || '').trim()) {
            player.identityAnchor = legacyPlayerIdentityAnchor;
        }
        settings.playerIdentityAnchor = '';
        saveSettings();
        migratedLegacyPlayerIdentity = true;
    }
    store.branchOverrides = store.branchOverrides && typeof store.branchOverrides === 'object'
        ? store.branchOverrides
        : {};
    store.personObservations = store.personObservations && typeof store.personObservations === 'object'
        ? store.personObservations
        : {};
    store.publicOpinion = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
    store.publicOpinionListHidden = Boolean(store.publicOpinionListHidden);
    store.publicOpinionSandbox = normalizePublicOpinionSandbox(store.publicOpinionSandbox || emptyPublicOpinionSandbox());
    store.recoveryPoints = Array.isArray(store.recoveryPoints) ? store.recoveryPoints.slice(-3) : [];

    runtime.preparedStores.add(store);
    if ((createdMigrationRecovery || migratedLegacyPlayerIdentity) && context?.chatMetadata && hasChatContext()) {
        context.chatMetadata[STATE_KEY] = store;
        context.saveMetadataDebounced?.();
    }
    return store;
}

function getStore({ create = true } = {}) {
    const context = getContext();
    const metadata = context?.chatMetadata;

    if (!metadata || typeof metadata !== 'object' || !hasChatContext()) {
        runtime.transientStore ||= makeStore();
        runtime.transientStore = prepareStore(runtime.transientStore, context);
        return runtime.transientStore;
    }

    if (!metadata[STATE_KEY] && create) {
        metadata[STATE_KEY] = makeStore();
        context.saveMetadataDebounced?.();
    }

    const rawStore = metadata[STATE_KEY] || runtime.transientStore || makeStore();
    const prepared = prepareStore(rawStore, context);
    if (prepared !== metadata[STATE_KEY] && metadata[STATE_KEY]) {
        metadata[STATE_KEY] = prepared;
    }
    return prepared;
}

function saveStore(store, { immediate = false } = {}) {
    const context = getContext();
    mergeMemorySummaryArchive(store, store.currentState);
    // 舆情/新闻只能通过自己的时间 + 公开事件调度器更新。普通世界状态保存
    // 绝不能顺手把 public event 直接塞进新闻，否则会绕过新闻时间门槛。
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
    // swipe_info is the canonical branch store when SillyTavern provides it.
    // Older builds wrote the same full snapshot to both swipe_info and message.extra,
    // doubling chat-file weight for the current swipe.
    const swipeData = message?.swipe_info?.[swipeId]?.extra?.[SNAPSHOT_KEY];
    if (swipeData && typeof swipeData === 'object') return swipeData;
    const currentData = message?.extra?.[SNAPSHOT_KEY];
    if (currentData && typeof currentData === 'object') return currentData;
    return null;
}

function latestAssistantEntry() {
    const chat = getContext()?.chat || [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (hasUsableAssistantText(message)) return { message, index };
    }
    return null;
}

function taskRouteKey(taskKind = 'simulation') {
    if (taskKind === 'person-observation') return 'observation';
    if (taskKind === 'public-opinion' || taskKind === 'public-opinion-sandbox') return 'opinion';
    if (taskKind === 'history' || taskKind === 'history-index' || taskKind === 'memory') return 'history';
    return 'simulation';
}

function settingsForApiProfile(baseSettings, profile) {
    return {
        ...baseSettings,
        apiMode: 'custom',
        customApiUrl: String(profile?.url || ''),
        customApiKey: String(profile?.key || ''),
        customApiModel: String(profile?.model || ''),
        customApiTransport: ['proxy', 'direct'].includes(profile?.transport) ? profile.transport : 'proxy',
    };
}

function resolveTaskConnection(settings, taskKind = 'simulation') {
    const routeKey = taskRouteKey(taskKind);
    const route = String(settings.apiModuleRoutes?.[routeKey] || 'default');
    if (route === 'tavern') {
        return { mode: 'tavern', route, routeKey, label: '跟随当前酒馆', settings };
    }
    if (route.startsWith('profile:')) {
        const id = route.slice('profile:'.length);
        const profile = settings.apiProfiles?.find(item => item.id === id);
        if (profile) {
            return {
                mode: 'custom',
                route,
                routeKey,
                label: profile.name || '已保存方案',
                profile,
                settings: settingsForApiProfile(settings, profile),
            };
        }
    }
    if (settings.apiMode === 'custom') {
        return {
            mode: 'custom',
            route: 'default',
            routeKey,
            label: '默认独立接口',
            settings,
        };
    }
    return { mode: 'tavern', route: 'default', routeKey, label: '跟随当前酒馆', settings };
}


function retryConnectionKey(taskKind = 'simulation') {
    const settings = getSettings();
    const route = resolveTaskConnection(settings, taskKind);
    if (route.mode === 'custom') {
        const requestSettings = route.settings;
        return [
            'custom',
            route.route || 'default',
            requestSettings.customApiTransport || 'proxy',
            hashText(String(requestSettings.customApiUrl || '')),
            String(requestSettings.customApiModel || ''),
        ].join(':');
    }
    const connection = getConnectionInfo();
    return [
        'tavern',
        route.route || 'default',
        String(connection?.source || 'tavern'),
        String(connection?.model || ''),
    ].join(':');
}

function retryTaskOptions(taskKind, taskKey, {
    onCooldown = null,
} = {}) {
    return {
        cooldownKey: retryConnectionKey(taskKind),
        taskKey: String(taskKey || '').slice(0, 240),
        onCooldown,
    };
}

function cooldownSeconds(milliseconds) {
    return Math.max(1, Math.ceil(Math.max(0, Number(milliseconds) || 0) / 1000));
}

function rateLimitLike(error) {
    return error?.errorType === 'rate-limit'
        || error?.code === 'RATE_LIMIT'
        || Number(error?.upstreamStatus) === 429
        || /429|too many requests|rate[_\s-]*limit|限流|频率限制|请求过于频繁/i
            .test(String(error?.message || error || ''));
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
    const store = getStore();
    const state = store.currentState;
    const recoveryPoints = listRecoveryPointHeaders(store);
    const latestRecovery = recoveryPoints.at(-1) || null;
    const chatToken = currentChatToken();
    const pendingTurns = latest ? pendingAssistantEntriesThrough(latest.index).length : 0;
    const activeForCurrentChat = runtime.activeSimulation?.chatToken === chatToken
        ? runtime.activeSimulation
        : null;
    const activeTurns = activeForCurrentChat
        ? Math.max(1, Number(activeForCurrentChat.newAssistantCount) || 1)
        : 0;
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
        lastConnection: runtime.lastTaskConnection ? { ...runtime.lastTaskConnection } : null,
        pluginVersion: PLUGIN_VERSION,
        userName: String(getContext()?.name1 || ''),
        memory: {
            indexedThroughMessageId: Number(state.storyMemory?.indexedThroughMessageId ?? -1),
            facts: state.storyMemory?.facts?.length || 0,
            summaries: state.storyMemory?.summaries?.length || 0,
            summaryLevels: [0, 1, 2, 3].map(level => (
                (state.storyMemory?.summaries || []).filter(summary => (
                    summary?.hierarchyManaged && Number(summary?.level || 0) === level
                )).length
            )),
            pendingRollup: Boolean(planMemoryRollup(state)),
            clues: state.storyMemory?.clues?.length || 0,
            hasDigest: Boolean(state.storyMemory?.digest?.text),
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
        promptBridge: runtime.lastPromptBridge || {
            enabled: false,
            promptCount: 0,
            available: false,
            truncated: false,
            internalCompatChars: String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length,
            at: '',
        },
        publicOpinion: (() => {
            const opinionStore = store;
            const storedOpinion = normalizePublicOpinionCache(
                opinionStore.publicOpinion || emptyPublicOpinionCache(),
            );
            const displayOpinion = storedOpinion;
            return {
                ...displayOpinion,
                ...runtime.publicOpinionStatus,
                sandbox: opinionStore.publicOpinionSandbox || emptyPublicOpinionSandbox(),
                sandboxStatus: { ...runtime.publicOpinionSandboxStatus },
                canonRunning: Boolean(
                    runtime.publicOpinionRefreshTransaction
                    || (runtime.activePublicOpinion && !runtime.activePublicOpinion?.controller?.signal?.aborted)
                ),
                sandboxRunning: Boolean(runtime.activePublicOpinionSandbox && !runtime.activePublicOpinionSandbox?.controller?.signal?.aborted),
                stale: planPublicOpinionRefresh(state, storedOpinion).due,
            };
        })(),
        worldbook: {
            ...runtime.worldbookScan,
            books: getWorldbookNames(),
        },
        recovery: {
            count: recoveryPoints.length,
            latest: latestRecovery ? {
                id: latestRecovery.id,
                createdAt: latestRecovery.createdAt,
                label: latestRecovery.label,
                worldName: latestRecovery.worldName,
                worldMinute: latestRecovery.worldMinute,
                revision: latestRecovery.revision,
            } : null,
        },
        queue: {
            pendingTurns,
            waitingTurns: Math.max(0, pendingTurns - activeTurns),
            activeMessageId: activeForCurrentChat?.messageId ?? null,
        },
        canCancelSimulation: Boolean(
            activeForCurrentChat
            && !activeForCurrentChat.controller.signal.aborted
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

    const swipeInfo = message.swipe_info?.[swipeId];
    if (swipeInfo && typeof swipeInfo === 'object') {
        swipeInfo.extra ||= {};
        swipeInfo.extra[SNAPSHOT_KEY] = clone(data);

        // Keep exactly one full copy. branchDataFromMessage reads swipe_info first.
        if (Number(message.swipe_id ?? 0) === Number(swipeId)) {
            delete message.extra[SNAPSHOT_KEY];
        }
        return;
    }

    // Some ST message shapes do not expose swipe_info. Fall back to message.extra.
    if (Number(message.swipe_id ?? 0) === Number(swipeId)) {
        message.extra[SNAPSHOT_KEY] = clone(data);
    }
}

function compactBranchSnapshotStorage({
    keepRecentAssistant = 50,
} = {}) {
    const context = getContext();
    const chat = context?.chat || [];
    const assistantIndexes = chat
        .map((message, index) => (!message?.is_user && !message?.is_system ? index : -1))
        .filter(index => index >= 0);
    const recentStart = assistantIndexes.length > keepRecentAssistant
        ? assistantIndexes[assistantIndexes.length - keepRecentAssistant]
        : -1;

    let changed = false;
    const compactCommitted = (data, historical = false) => {
        if (!data || typeof data !== 'object' || data.status !== 'committed') return;
        if (data.base) {
            data.base = null;
            changed = true;
        }
        if (historical) {
            if (data.summary) {
                delete data.summary;
                changed = true;
            }
            if (Array.isArray(data.offeredEventIds) && data.offeredEventIds.length) {
                data.offeredEventIds = [];
                changed = true;
            }
            if (data.error) {
                data.error = '';
                changed = true;
            }
            data.storageCompacted = true;
        }
    };

    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const currentSwipe = Number(message.swipe_id ?? 0);
        const historical = recentStart >= 0 && index < recentStart;

        // Canonicalize current swipe into swipe_info and remove the duplicate
        // message.extra full state left by older versions.
        const currentSwipeData = message.swipe_info?.[currentSwipe]?.extra?.[SNAPSHOT_KEY];
        if (currentSwipeData && message.extra?.[SNAPSHOT_KEY]) {
            delete message.extra[SNAPSHOT_KEY];
            changed = true;
        }

        if (!currentSwipeData) {
            compactCommitted(message.extra?.[SNAPSHOT_KEY], historical);
        }

        for (let swipeId = 0; swipeId < (message.swipe_info?.length || 0); swipeId += 1) {
            const swipeInfo = message.swipe_info?.[swipeId];
            const data = swipeInfo?.extra?.[SNAPSHOT_KEY];
            if (!data) continue;

            // For old floors keep the selected branch exact, but stop carrying
            // every abandoned alternate swipe forever. Switching to such an old
            // alternate can still be resynchronized from the nearest confirmed
            // selected-world state.
            if (historical && swipeId !== currentSwipe) {
                delete swipeInfo.extra[SNAPSHOT_KEY];
                changed = true;
                continue;
            }
            compactCommitted(data, historical);
        }
    }
    return changed;
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
    const restored = restoreBranchSnapshot(snapshot, store.initialState);
    const sourceKey = snapshot?.meta?.sourceKey || '';
    const override = sourceKey ? store.branchOverrides[sourceKey] : null;
    return override ? restoreBranchSnapshot(override, restored) : restored;
}

function currentAnchorKey() {
    const state = getState();
    return state.lastCommit?.sourceKey || 'root';
}

function ensureMonotonicRevision(nextState, previousState = null) {
    const next = trimState(nextState);
    const previousRevision = Math.max(0, Number(previousState?.revision) || 0);
    const proposedRevision = Math.max(0, Number(next?.revision) || 0);
    next.revision = Math.max(proposedRevision, previousRevision + 1);
    next.updatedAt = new Date().toISOString();
    return next;
}

function setCurrentState(nextState, {
    save = true,
    overrideKey = null,
    immediate = false,
} = {}) {
    const store = getStore();
    store.currentState = ensureMonotonicRevision(nextState, store.currentState);

    if (overrideKey) {
        store.branchOverrides[overrideKey] = createBranchSnapshot(store.currentState, {
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
                ? restoreBranchSnapshot(store.branchOverrides.root, store.initialState)
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
        .map(message => narrativeMessageText(message))
        .join('\n')
        .slice(-9000);
}

function recentForegroundIntentText() {
    const chat = getContext()?.chat || [];
    if (!chat.length) return '';

    let latestUserIndex = -1;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (message?.is_user && !message?.is_system) {
            latestUserIndex = index;
            break;
        }
    }

    let nearestAssistantIndex = -1;
    if (latestUserIndex >= 0) {
        for (let distance = 1; distance <= 2; distance += 1) {
            for (const candidate of [latestUserIndex - distance, latestUserIndex + distance]) {
                const message = chat[candidate];
                if (
                    candidate >= 0
                    && candidate < chat.length
                    && message
                    && !message.is_user
                    && !message.is_system
                ) {
                    nearestAssistantIndex = candidate;
                    break;
                }
            }
            if (nearestAssistantIndex >= 0) break;
        }
    } else {
        for (let index = chat.length - 1; index >= 0; index -= 1) {
            const message = chat[index];
            if (message && !message.is_user && !message.is_system) {
                nearestAssistantIndex = index;
                break;
            }
        }
    }

    const selected = [];
    if (nearestAssistantIndex >= 0) {
        selected.push({
            index: nearestAssistantIndex,
            text: narrativeMessageText(chat[nearestAssistantIndex]),
        });
    }
    if (latestUserIndex >= 0) {
        selected.push({
            index: latestUserIndex,
            text: narrativeMessageText(chat[latestUserIndex]),
        });
    }

    return selected
        .sort((a, b) => a.index - b.index)
        .map(item => item.text)
        .filter(Boolean)
        .join('\n')
        .slice(-4500);
}

function selectedMessageText(message) {
    if (!message) return '';
    if (message.is_user) return String(message.mes || '');
    const swipeId = Number(message.swipe_id ?? 0);
    return String(message.swipes?.[swipeId] ?? message.mes ?? '');
}

function narrativeMessageText(message) {
    return filterNarrativeText(selectedMessageText(message), getSettings());
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
            userText = narrativeMessageText(chat[index]);
            break;
        }
    }
    const assistantText = narrativeMessageText(assistant);

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
            content: narrativeMessageText(message),
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
        const content = narrativeMessageText(message).slice(0, maximum);
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


function publicOpinionEventSignature(state) {
    // 只签公开表面，不把事件内部 updatedAt / 幕后 status 的每轮变化算成“新舆情”。
    return publicOpinionSourceSignature(state);
}

function publicWorldNeedsRefresh(state, candidates = eligiblePublicOpinionEvents(state)) {
    if (!candidates.length) return true;
    if (!state?.clock?.anchored) return false;

    const worldMinute = Number(state.clock.absoluteMinute || 0);
    const eventById = new Map((state.events || []).map(event => [String(event.id || ''), event]));
    const latestPublicMinute = candidates.reduce((latest, item) => {
        const event = eventById.get(String(item.id || ''));
        const updated = Number(event?.updatedAt ?? event?.resolvedAt ?? event?.createdAt ?? -1);
        return Math.max(latest, updated);
    }, -1);

    if (latestPublicMinute < 0) return true;
    // News is a rolling view of a moving world. If the world's clock moved several
    // hours beyond the latest public update, refresh the public-world layer even
    // when an older headline still exists.
    return worldMinute - latestPublicMinute >= 180;
}

function scheduleAutoPublicOpinion(state = getState(), delay = 260) {
    const settings = getSettings();
    if (!settings.enabled || !settings.publicOpinionAutoEnabled) return false;
    const store = getStore();
    const plan = planPublicOpinionRefresh(state, store.publicOpinion || emptyPublicOpinionCache());
    // 正文每次成功同步都会来“敲门”，但只有公开来源真的变化，或世界时间走到
    // 舆情/新闻自己的演化节点，才排一次 AI。没到点就完全不调用模型。
    if (!plan.due) {
        runtime.pendingPublicOpinion = false;
        return false;
    }
    runtime.pendingPublicOpinion = true;
    const chatToken = currentChatToken();
    if (runtime.publicOpinionTimer !== null) window.clearTimeout(runtime.publicOpinionTimer);
    runtime.publicOpinionTimer = window.setTimeout(
        () => scheduleDeferredPublicOpinion(Math.max(220, Number(delay) || 260), chatToken),
        Math.max(120, Number(delay) || 260),
    );
    return true;
}

function schedulePublicImpactPropagation(state = getState(), delay = 160) {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.worldSimulationEnabled
        || !settings.worldAutoEnabled
        || !pendingPublicImpactEvents(state, { maximum: 8 }).length
    ) return false;

    runtime.pendingPublicImpact = true;
    const chatToken = currentChatToken();
    if (runtime.publicImpactTimer !== null) window.clearTimeout(runtime.publicImpactTimer);
    runtime.publicImpactTimer = window.setTimeout(
        () => scheduleDeferredPublicImpact(Math.max(180, Number(delay) || 160), chatToken),
        Math.max(120, Number(delay) || 160),
    );
    return true;
}

function publicOpinionRevealInjection(state, cache, settings, recentText = '') {
    if (settings.publicOpinionRevealMode !== 'relevant') return '';
    const normalized = normalizePublicOpinionCache(cache || {});
    const stale = String(normalized.sourceEventSignature || '') !== publicOpinionEventSignature(state);
    // 注入只消费已经由舆情调度器确认过的缓存，不能在这里临时从世界事件
    // “补造”新闻。来源变了时先丢掉过期论坛，新闻历史保留到新快照接上。
    const opinion = stale
        ? { ...normalized, forums: [] }
        : normalized;
    if (!opinion.news.length && !opinion.forums.length) return '';
    const text = String(recentText || '').toLocaleLowerCase();
    const events = new Map((state.events || []).map(event => [String(event.id), event]));
    const peopleNames = (state.people || []).map(person => String(person.name || '').trim()).filter(Boolean);
    const isRelevant = item => {
        const event = events.get(String(item.relatedEventId || ''));
        if (!event) return false;
        const terms = [
            event.title,
            event.place,
            ...(item.audienceTags || []),
            ...peopleNames.filter(name => (
                String(event.summary || '').includes(name)
                || String(event.expectedResult || '').includes(name)
                || String(event.result || '').includes(name)
            )),
        ]
            .map(value => String(value || '').trim().toLocaleLowerCase())
            .filter(value => value.length >= 2);
        return terms.some(term => text.includes(term));
    };
    const news = (opinion.news || []).filter(isRelevant).slice(0, 2);
    const forums = (opinion.forums || []).filter(isRelevant).slice(0, 2);
    if (!news.length && !forums.length) return '';
    const lines = [
        '<world_public_opinion>',
        '以下是与当前镜头确实相关的公开舆情候选。只有角色存在自然接触渠道（手机、电视、路人讨论、工作消息等）时才允许顺手显露；不得为了播报而打断当前剧情，也不得把论坛猜测当成世界事实。',
    ];
    for (const item of news) {
        const audience = (item.audienceTags || []).slice(0, 4).join('、');
        lines.push(`新闻｜${item.headline}｜${item.summary}｜来源：${item.source || '公开信息'}｜来源层级：${item.sourceType || 'official'}${audience ? `｜可能关注：${audience}` : ''}`);
    }
    for (const item of forums) {
        const audience = (item.audienceTags || []).slice(0, 4).join('、');
        lines.push(`论坛｜${item.title}｜${item.summary}｜性质：${item.claimStatus || 'mixed'}｜来源层级：${item.sourceType || 'unofficial'}${audience ? `｜可能关注：${audience}` : ''}`);
    }
    lines.push('</world_public_opinion>');
    return lines.join('\n');
}

function refreshInjection() {
    const context = getContext();
    if (!context?.setExtensionPrompt) return;

    const settings = getSettings();
    const state = getState();
    const recentText = recentChatText();
    const packet = buildInjectionPackage(state, settings, recentText, {
        contextText: recentForegroundIntentText(),
    });
    const opinionInjection = publicOpinionRevealInjection(
        state,
        getStore().publicOpinion,
        settings,
        recentText,
    );
    const authorityText = String(packet.authorityText ?? packet.text ?? '');
    const supportText = [packet.supportText, opinionInjection].filter(Boolean).join('\n\n');
    const text = [supportText, authorityText].filter(Boolean).join('\n\n');
    runtime.injection = { ...packet, authorityText, supportText, text };

    // World facts stay at depth 0 as the continuity contract. Optional reveal,
    // memory and public-opinion context sits deeper so it can help without
    // competing with the newest user turn or authoritative state.
    context.setExtensionPrompt(PROMPT_KEY, authorityText, 1, 0, false, 0);
    context.setExtensionPrompt(SUPPORT_PROMPT_KEY, supportText, 1, 2, false, 0);
}

function clearOwnInjection() {
    const context = getContext();
    context?.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
    context?.setExtensionPrompt?.(SUPPORT_PROMPT_KEY, '', 1, 2, false, 0);
}

function setBusy(value) {
    runtime.simulationCount += value ? 1 : -1;
    runtime.simulationCount = Math.max(0, runtime.simulationCount);
    runtime.ui?.setBusy(runtime.simulationCount > 0);
}

function coreSimulationBusy() {
    return Boolean(
        runtime.activeSimulation
        || runtime.activeWorldPulse
        || runtime.activePublicImpact
        || runtime.queuedSimulations.size > 0
    );
}

function latestAssistantSourceStamp() {
    const latest = latestAssistantEntry();
    if (!latest) return '';
    const swipeId = Number(latest.message?.swipe_id ?? 0);
    return branchSourceKey(latest.index, latest.message, swipeId);
}

function preemptLowPriorityTasksForCore({ includeWorldWriters = false } = {}) {
    if (runtime.activePublicOpinion && !runtime.activePublicOpinion.controller.signal.aborted) {
        runtime.pendingPublicOpinion = true;
        runtime.activePublicOpinion.controller.abort();
    }
    if (runtime.activeObservation && !runtime.activeObservation.controller.signal.aborted) {
        runtime.activeObservation.controller.abort();
    }
    if (runtime.activeHistoryScan && !runtime.activeHistoryScan.signal.aborted) {
        runtime.activeHistoryScan.abort();
        runtime.historyProgress = {
            ...runtime.historyProgress,
            message: runtime.historyProgress.kind === 'world-bootstrap'
                ? '新正文来啦～本次历史回溯已停止，现有世界不会写入半成品'
                : '新正文来啦～先把世界主线追上，记忆会从已保存批次继续整理',
        };
        runtime.ui?.render();
    }
    if (includeWorldWriters) {
        runtime.activeWorldPulse?.controller?.abort?.();
        if (runtime.activePublicImpact && !runtime.activePublicImpact.controller.signal.aborted) {
            // 前台正文抢占传播任务时，把传播需求留着。旧请求停掉后会基于最新世界状态重跑，
            // 不会因为一次抢占就永久漏掉尚未传播的公共事件。
            runtime.pendingPublicImpact = true;
            runtime.activePublicImpact.controller.abort();
        }
    }
}

function invalidateAsyncWorldContext() {
    runtime.contextEpoch += 1;
    runtime.activeSimulation?.controller?.abort?.();
    runtime.queuedSimulations.clear();
    preemptLowPriorityTasksForCore({ includeWorldWriters: true });
}

function scheduleDeferredPublicImpact(delay = 180, expectedChatToken = currentChatToken()) {
    if (!runtime.pendingPublicImpact || expectedChatToken !== currentChatToken()) return;
    if (runtime.publicImpactTimer !== null) window.clearTimeout(runtime.publicImpactTimer);
    runtime.publicImpactTimer = window.setTimeout(() => {
        runtime.publicImpactTimer = null;
        if (!runtime.pendingPublicImpact || expectedChatToken !== currentChatToken()) return;
        const coreBlocked = Boolean(
            runtime.activeSimulation
            || runtime.activeWorldPulse
            || runtime.activePublicImpact
            || runtime.activeHistoryScan
            || runtime.queuedSimulations.size > 0
        );
        if (coreBlocked) {
            scheduleDeferredPublicImpact(Math.max(220, Number(delay) || 180), expectedChatToken);
            return;
        }
        runtime.pendingPublicImpact = false;
        void runPublicImpactPropagation({ quiet: true }).catch(error => {
            if (!isAbortError(error)) console.warn('[世界背面] 公共事件影响传播失败', error);
        });
    }, delay);
}

function scheduleDeferredPublicOpinion(delay = 220, expectedChatToken = currentChatToken()) {
    if (!runtime.pendingPublicOpinion || expectedChatToken !== currentChatToken()) return;
    if (runtime.publicOpinionTimer !== null) window.clearTimeout(runtime.publicOpinionTimer);
    runtime.publicOpinionTimer = window.setTimeout(() => {
        runtime.publicOpinionTimer = null;
        if (!runtime.pendingPublicOpinion || expectedChatToken !== currentChatToken()) return;
        if (coreSimulationBusy()) {
            scheduleDeferredPublicOpinion(Math.max(260, Number(delay) || 220), expectedChatToken);
            return;
        }
        runtime.pendingPublicOpinion = false;
        void generatePublicOpinionSnapshot({ allowDefer: true }).catch(error => {
            if (!isAbortError(error)) console.warn('[世界背面] 延后舆情生成失败', error);
        });
    }, delay);
}

function hasNewerAssistantReply(messageId) {
    const latest = latestAssistantEntry();
    return Boolean(latest && Number(latest.index) > Number(messageId));
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
    deferBase = false,
} = {}) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!hasUsableAssistantText(message)) return null;
    const swipeId = Number(message.swipe_id ?? 0);
    const sourceKey = branchSourceKey(messageId, message, swipeId);
    const existing = branchDataFromMessage(message, swipeId);

    let baseState = null;
    if (!deferBase) {
        if (existing?.base && !existing.stale) {
            baseState = restoreBranchSnapshot(existing.base, getStore().initialState);
        } else {
            const previous = findLatestResultSnapshot(messageId);
            baseState = previous
                ? stateWithBranchOverride(previous.snapshot)
                : clone(getState());
        }
    }

    const data = {
        schemaVersion: SCHEMA_VERSION,
        status: 'pending',
        sourceKey,
        trigger,
        offeredEventIds: [...new Set(offeredEventIds || [])],
        base: baseState ? createBranchSnapshot(baseState, {
            messageId,
            swipeId,
            sourceKey,
            kind: 'base',
        }) : null,
        result: null,
        error: '',
        stale: false,
    };

    attachBranchData(message, swipeId, data);
    void context?.saveChat?.();
    const store = getStore();
    if (baseState && currentChatToken() === runtime.activeChatToken) {
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

function backgroundRequestMessages(prompt, settings = getSettings(), {
    taskKind = 'simulation',
    rejectTruncated = false,
} = {}) {
    const messages = buildBackstageMessages(prompt);
    runtime.lastPromptBridge = {
        enabled: false,
        removed: true,
        taskKind,
        promptCount: 0,
        available: false,
        truncated: false,
        internalCompatChars: String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length,
        systemChars: String(messages[0]?.content || '').length,
        userChars: String(messages[1]?.content || '').length,
        at: new Date().toISOString(),
    };
    return messages;
}


function generationTimeoutError(timeoutMs, taskKind = 'simulation') {
    const seconds = Math.max(1, Math.ceil(Number(timeoutMs || 0) / 1000));
    const error = new Error(`后台任务等待超时（${seconds} 秒 · ${taskRouteKey(taskKind)}）`);
    error.code = 'GENERATION_TIMEOUT';
    error.errorType = 'timeout';
    error.timeoutMs = Number(timeoutMs) || 0;
    return error;
}

function createActiveGenerationGuard(timeoutMs, externalSignal, taskKind = 'simulation') {
    const controller = new AbortController();
    const documentRef = globalThis.document;
    const canWatchVisibility = Boolean(
        documentRef
        && typeof documentRef.addEventListener === 'function'
        && typeof documentRef.removeEventListener === 'function'
    );
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    let remainingMs = Math.max(1, Number(timeoutMs) || 1);
    let activeSince = 0;
    let timer = null;
    let timedOut = false;
    let rejectGuard = null;

    const guardPromise = new Promise((_, reject) => {
        rejectGuard = reject;
    });

    const pageHidden = () => canWatchVisibility && Boolean(documentRef.hidden);
    const pause = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (activeSince > 0) {
            remainingMs = Math.max(0, remainingMs - Math.max(0, now() - activeSince));
            activeSince = 0;
        }
    };
    const fireTimeout = () => {
        if (controller.signal.aborted) return;
        timedOut = true;
        const error = generationTimeoutError(timeoutMs, taskKind);
        // Reject our guard before aborting the native request. Some adapters turn
        // signal.abort() into a generic AbortError synchronously; ordering this way
        // guarantees Promise.race reports a real timeout instead of misclassifying
        // it as a user cancellation.
        rejectGuard?.(error);
        controller.abort(error);
    };
    const resume = () => {
        if (controller.signal.aborted || pageHidden() || timer !== null) return;
        if (remainingMs <= 0) {
            fireTimeout();
            return;
        }
        activeSince = now();
        timer = setTimeout(() => {
            timer = null;
            activeSince = 0;
            fireTimeout();
        }, remainingMs);
    };
    const onVisibility = () => {
        if (pageHidden()) pause();
        else resume();
    };
    const onExternalAbort = () => {
        if (controller.signal.aborted) return;
        const error = new Error('推演已由用户取消');
        error.name = 'AbortError';
        rejectGuard?.(error);
        controller.abort(error);
    };

    if (canWatchVisibility) documentRef.addEventListener('visibilitychange', onVisibility);
    if (externalSignal) {
        if (externalSignal.aborted) onExternalAbort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    resume();

    return {
        signal: controller.signal,
        guardPromise,
        timedOut: () => timedOut,
        cleanup() {
            pause();
            if (canWatchVisibility) documentRef.removeEventListener('visibilitychange', onVisibility);
            externalSignal?.removeEventListener?.('abort', onExternalAbort);
            rejectGuard = null;
        },
    };
}

async function backgroundSimulation(prompt, {
    maxTokens = 2200,
    temperature = 0.2,
    signal = null,
    taskKind = 'simulation',
    rejectTruncated = false,
} = {}) {
    const context = getContext();
    const settings = getSettings();
    const route = resolveTaskConnection(settings, taskKind);
    const requestSettings = route.settings;
    const limits = resolveGenerationLimits(settings, taskKind, maxTokens);
    const effectiveMaxTokens = limits.maxTokens;
    const effectiveTimeoutMs = limits.timeoutMs;
    const tavernConnection = route.mode === 'tavern' ? getConnectionInfo() : null;
    runtime.lastTaskConnection = {
        taskKind,
        routeKey: route.routeKey,
        route: route.route,
        apiLabel: route.mode === 'custom' ? route.label : '跟随当前酒馆',
        model: route.mode === 'custom'
            ? String(requestSettings.customApiModel || '模型尚未配置')
            : String(tavernConnection?.model || '跟随酒馆当前模型'),
        method: route.mode === 'custom'
            ? (requestSettings.customApiTransport === 'direct' ? '浏览器直连' : '酒馆转发')
            : '酒馆独立上下文',
        source: route.mode === 'custom' ? 'custom-independent' : tavernConnection?.source || 'tavern',
        requestedMaxTokens: limits.requestedMaxTokens,
        maxTokens: effectiveMaxTokens,
        tokenLimitSource: limits.tokenSource,
        timeoutMs: effectiveTimeoutMs,
        timeoutLimitSource: limits.timeoutSource,
    };
    const messages = backgroundRequestMessages(prompt, settings, { taskKind });
    if (signal?.aborted) {
        const error = new Error('推演已由用户取消');
        error.name = 'AbortError';
        throw error;
    }
    const foregroundNeutralTask = taskKind === 'public-opinion-sandbox';

    if (route.mode === 'custom') {
        if (!foregroundNeutralTask) runtime.inBackgroundGeneration = true;
        try {
            runtime.syncStatus.method = requestSettings.customApiTransport === 'direct'
                ? `${route.label} · 浏览器直连`
                : `${route.label} · 酒馆转发`;
            return await requestCustomCompletion(requestSettings, messages, {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens: effectiveMaxTokens,
                temperature,
                timeoutMs: effectiveTimeoutMs,
                signal,
                rejectTruncated,
                operation: taskKind,
                routeLabel: route.label,
            });
        } finally {
            if (!foregroundNeutralTask) runtime.inBackgroundGeneration = false;
            refreshInjection();
        }
    }

    if (
        typeof context?.generateRaw !== 'function'
        && typeof context?.generateQuietPrompt !== 'function'
    ) {
        throw new Error('当前酒馆版本没有提供安静生成接口');
    }
    if (taskKind === 'person-observation' && typeof context?.generateRaw !== 'function') {
        throw new Error('当前酒馆版本没有提供独立上下文人物观测接口；请更新 SillyTavern 或为世界背面配置独立 API');
    }

    if (!foregroundNeutralTask) runtime.inBackgroundGeneration = true;
    clearOwnInjection();
    // Timeout applies to this single request attempt only. runWithRetries cooldown
    // happens outside backgroundSimulation, so a 429 wait can never consume the
    // model's active generation timeout.
    const guard = createActiveGenerationGuard(effectiveTimeoutMs, signal, taskKind);
    const requestSignal = guard.signal;
    // Sandbox is allowed to coexist with the core world task. Its AbortController
    // must therefore never call SillyTavern's global stopGeneration(), otherwise
    // closing "随便逛逛" could accidentally kill the main world simulation too.
    const allowGlobalStopOnAbort = !foregroundNeutralTask;
    const stopNativeGeneration = () => {
        if (!allowGlobalStopOnAbort) return;
        try {
            context?.stopGeneration?.();
        } catch (error) {
            console.warn('[世界背面] 酒馆安静生成停止请求没有正常返回', error);
        }
    };
    if (allowGlobalStopOnAbort) {
        requestSignal.addEventListener('abort', stopNativeGeneration, { once: true });
    }
    try {
        let request;
        if (typeof context.generateRaw === 'function') {
            runtime.syncStatus.method = '独立上下文推演';
            request = context.generateRaw({
                prompt: messages,
                responseLength: effectiveMaxTokens,
                trimNames: false,
                signal: requestSignal,
            });
        } else {
            runtime.syncStatus.method = '安静生成兼容模式';
            request = context.generateQuietPrompt({
                quietPrompt: `${messages[0]?.content || ''}\n\n${messages[1]?.content || ''}`.trim(),
                skipWIAN: true,
                responseLength: effectiveMaxTokens,
                removeReasoning: true,
                signal: requestSignal,
            });
        }
        // The background request has captured its own prompt. Restore the
        // foreground injection before waiting so a newly sent user turn never
        // sees an empty World Backstage prompt.
        refreshInjection();
        return await Promise.race([request, guard.guardPromise]);
    } finally {
        if (allowGlobalStopOnAbort) {
            requestSignal.removeEventListener?.('abort', stopNativeGeneration);
        }
        guard.cleanup();
        if (!foregroundNeutralTask) runtime.inBackgroundGeneration = false;
        refreshInjection();
    }
}

async function runSimulationForMessage(messageId, {
    force = false,
    trigger = 'reply',
    newAssistantCount = 1,
    job = null,
} = {}) {
    const chatTokenAtStart = currentChatToken();
    const contextEpochAtStart = runtime.contextEpoch;
    if (job?.chatToken && job.chatToken !== chatTokenAtStart) return null;

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
    if (
        job
        && (job.swipeId !== beforeSwipeId || job.sourceKey !== beforeSourceKey)
    ) {
        setSyncStatus({
            phase: 'pending',
            message: '正文已发生变化，旧排队任务已跳过；等待按最新正文推演',
            error: '',
        });
        return null;
    }
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

    const prepared = markMessagePending(messageId, {
        trigger,
        offeredEventIds: job?.offeredEventIds ?? beforeData?.offeredEventIds,
    });
    if (!prepared) {
        throw new Error('没有找到可以推演的 AI 正文');
    }

    const {
        message,
        swipeId,
        sourceKey,
        baseState,
    } = prepared;
    const baseRevision = Math.max(0, Number(baseState?.revision) || 0);
    const expectedHash = sourceKey.split(':').at(-1);
    const offeredEventIds = prepared.data.offeredEventIds;
    const settings = getSettings();
    const assistantTurnsToApply = Math.min(
        20,
        Math.max(1, Number.parseInt(newAssistantCount, 10) || 1),
    );
    const anchorContextTurns = baseState?.clock?.anchored ? 0 : 20;
    const narrative = narrativeContext(
        messageId,
        Math.max(settings.contextTurns, assistantTurnsToApply, anchorContextTurns),
    );
    // Pending batch must come from raw chat ids (hasUsableAssistantText), not
    // narrative.turns — narrativeContext already drops empty-after-filter turns,
    // which would otherwise pull older assistants into the "new" slice.
    const chatForPending = beforeContext?.chat || [];
    const pendingMessageIds = selectPendingAssistantMessageIds(
        chatForPending,
        messageId,
        assistantTurnsToApply,
        hasUsableAssistantText,
    );
    const pendingFilteredTexts = pendingMessageIds.map(
        id => narrativeMessageText(chatForPending[id]),
    );
    const survivingNewCount = countSurvivingNewAssistantTurns(
        narrative.turns,
        pendingMessageIds,
    );
    const newAssistantTexts = pendingFilteredTexts
        .map(text => String(text || '').trim())
        .filter(Boolean);
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
        chatToken: chatTokenAtStart,
        sourceKey,
        newAssistantCount: assistantTurnsToApply,
        apiMode: resolveTaskConnection(settings, 'simulation').mode,
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
        // Short-circuit when every pending (queued) assistant filters to empty —
        // not when narrative.turns' last-N assistants happen to be non-empty older turns.
        if (!newAssistantTexts.length) {
            // No valid narrative after filtering: do not consume delivery attempts
            // or expire candidates via recordDeliveryOffers.
            const resultState = markPendingSync(clone(baseState), false);
            const nextInjection = buildInjectionPackage(resultState, settings, recentChatText(), {
                contextText: recentForegroundIntentText(),
            });
            const summary = simulationSummary(baseState, resultState, {
                prompt: '',
                raw: '',
                attempts: 0,
                tokenBudget: 0,
                injection: nextInjection,
            });
            const target = locateTargetBranch(messageId, swipeId, expectedHash);
            if (!target || currentChatToken() !== chatTokenAtStart) {
                if (currentChatToken() === chatTokenAtStart) {
                    setSyncStatus({
                        phase: 'pending',
                        message: '正文分支已变化，旧结果未提交；最新正文仍等待推演',
                        error: '',
                    });
                }
                return resultState;
            }
            const committed = {
                ...prepared.data,
                status: 'committed',
                result: createBranchSnapshot(resultState, {
                    messageId,
                    swipeId,
                    sourceKey,
                    kind: 'result',
                }),
                error: '',
                summary,
            };
            attachBranchData(target.message, swipeId, committed);
            compactBranchSnapshotStorage();
            const branchIsCurrent = (
                Number(target.message.swipe_id ?? 0) === swipeId
                && hashText(target.message.mes) === expectedHash
            );
            const supersededByNewerReply = hasNewerAssistantReply(messageId);
            if (branchIsCurrent && !supersededByNewerReply) {
                const store = getStore();
                store.currentState = trimState(resultState);
                saveStore(store, { immediate: true });
                refreshInjection();
                runtime.ui?.render();
            }
            await target.context.saveChat?.();
            setSyncStatus({
                phase: supersededByNewerReply ? 'pending' : 'success',
                message: supersededByNewerReply
                    ? '这一轮结果已安全存档，但更新正文已经出现～先不写进当前状态，正在追赶最新一轮'
                    : '过滤后无有效正文，本轮没有推进世界',
                error: '',
                succeededAt: supersededByNewerReply ? '' : new Date().toISOString(),
                method: runtime.syncStatus.method,
                summary,
            });
            return resultState;
        }

        const prompt = buildSimulationPrompt(baseState, {
            queuedEventIds: offeredEventIds,
            trigger,
            latestTurn: narrative.latestTurn,
            narrativeTurns: narrative.turns,
            userName: beforeContext?.name1 || '',
            includeUserInnerVoice: settings.includeUserInnerVoice,
            timePolicy: settings.timePolicy,
            worldAuto: settings.worldAutoEnabled,
            simulationMode: settings.autoSimulationMode,
            customInstruction: settings.customSimulationInstruction,
            playerIdentityAnchor: getPlayerIdentityAnchor(baseState),
            newAssistantTurns: Math.max(1, survivingNewCount),
            backgroundNpcBudget: settings.backgroundNpcBudget,
            worldPulseActivity: settings.worldPulseActivity,
        });

        const automaticMaxTokens = settings.autoSimulationMode === 'deep'
            ? 4600
            : settings.autoSimulationMode === 'light'
                ? 2400
                : 3400;
        const baseMaxTokens = automaticMaxTokens;
        const payload = await runWithRetries(async attempt => {
            generationMetrics.attempts = attempt + 1;
            generationMetrics.tokenBudget = resolveGenerationLimits(
                settings,
                'simulation',
                retryTokenBudget(baseMaxTokens, attempt),
            ).maxTokens;
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
            onRetry: ({ attempt, total, delayMs, error, rateLimited }) => {
                setSyncStatus({
                    phase: 'running',
                    message: rateLimited
                        ? `接口限流中～本轮推演保持单实例，进入 ${cooldownSeconds(delayMs)} 秒冷却`
                        : `推演失败，准备第 ${attempt}/${total} 次自动重试`,
                    error: rateLimited
                        ? `${describeError(error)}；冷却结束后只重试当前这一份任务`
                        : `${describeError(error)}；${Math.ceil(delayMs / 100) / 10} 秒后重试`,
                });
            },
            ...retryTaskOptions(
                'simulation',
                `simulation:${chatTokenAtStart}:${sourceKey}`,
                {
                    onCooldown: ({ delayMs }) => {
                        setSyncStatus({
                            phase: 'running',
                            message: `这条 API 路线正在冷却～还剩约 ${cooldownSeconds(delayMs)} 秒`,
                            error: '不会创建新的重复推演；冷却结束后继续当前任务。',
                        });
                    },
                },
            ),
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
        if (
            currentChatToken() === chatTokenAtStart
            && (
                runtime.contextEpoch !== contextEpochAtStart
                || Math.max(0, Number(getState()?.revision) || 0) !== baseRevision
            )
        ) {
            const target = locateTargetBranch(messageId, swipeId, expectedHash);
            if (target) {
                attachBranchData(target.message, swipeId, {
                    ...prepared.data,
                    status: 'pending',
                    error: '',
                });
                await target.context.saveChat?.();
            }
            setSyncStatus({
                phase: 'pending',
                message: '推演期间世界状态被手动修改，旧结果已丢弃；会按最新状态重新同步',
                error: '',
            });
            return getState();
        }

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
        const nextInjection = buildInjectionPackage(resultState, settings, recentChatText(), {
                contextText: recentForegroundIntentText(),
            });
        const summary = simulationSummary(baseState, resultState, {
            prompt,
            raw: generationMetrics.raw,
            attempts: generationMetrics.attempts,
            tokenBudget: generationMetrics.tokenBudget,
            injection: nextInjection,
        });

        const target = locateTargetBranch(messageId, swipeId, expectedHash);
        if (!target || currentChatToken() !== chatTokenAtStart) {
            if (currentChatToken() === chatTokenAtStart) {
                setSyncStatus({
                    phase: 'pending',
                    message: '正文分支已变化，旧结果未提交；最新正文仍等待推演',
                    error: '',
                });
            }
            return resultState;
        }

        const committed = {
            ...prepared.data,
            status: 'committed',
            result: createBranchSnapshot(resultState, {
                messageId,
                swipeId,
                sourceKey,
                kind: 'result',
            }),
            error: '',
            summary,
        };
        attachBranchData(target.message, swipeId, committed);
        compactBranchSnapshotStorage();

        const branchIsCurrent = (
            Number(target.message.swipe_id ?? 0) === swipeId
            && hashText(target.message.mes) === expectedHash
        );
        const supersededByNewerReply = hasNewerAssistantReply(messageId);
        if (branchIsCurrent && !supersededByNewerReply) {
            const store = getStore();
            store.currentState = ensureMonotonicRevision(resultState, store.currentState);
            resultState = store.currentState;
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
            schedulePublicImpactPropagation(resultState, 120);
            scheduleAutoPublicOpinion(resultState, 520);
        }

        await target.context.saveChat?.();
        setSyncStatus({
            phase: supersededByNewerReply ? 'pending' : 'success',
            message: supersededByNewerReply
                ? '这一轮推演已经安全存档～但你已经走到更新正文啦，旧结果不会盖住当前状态，接下来直接追最新一轮'
                : '最新正文已完成推演',
            error: '',
            succeededAt: supersededByNewerReply ? '' : new Date().toISOString(),
            method: runtime.syncStatus.method,
            summary,
        });
        return resultState;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            const target = currentChatToken() === chatTokenAtStart
                ? locateTargetBranch(messageId, swipeId, expectedHash)
                : null;
            if (target) {
                attachBranchData(target.message, swipeId, {
                    ...prepared.data,
                    status: 'pending',
                    error: '',
                });
                await target.context.saveChat?.();
            }
            if (currentChatToken() === chatTokenAtStart) {
                const store = getStore();
                store.currentState = trimState(markPendingSync(store.currentState, true));
                saveStore(store);
                refreshInjection();
                runtime.ui?.render();
            }
            if (currentChatToken() === chatTokenAtStart) {
                setSyncStatus({
                    phase: 'pending',
                    message: '本次推演已取消，正文仍保持待同步',
                    error: '',
                });
                toast('已停止推演；时间、人物、事件和记忆均未提交。', 'info');
            }
            throw error;
        }
        const errorMessage = describeError(error);
        const target = currentChatToken() === chatTokenAtStart
            ? locateTargetBranch(messageId, swipeId, expectedHash)
            : null;
        if (target) {
            const failed = {
                ...prepared.data,
                status: 'error',
                error: errorMessage,
            };
            attachBranchData(target.message, swipeId, failed);
            await target.context.saveChat?.();
        }

        if (currentChatToken() === chatTokenAtStart) {
            const store = getStore();
            store.currentState = trimState(markPendingSync(store.currentState, true));
            saveStore(store);
            refreshInjection();
            runtime.ui?.render();
        }

        if (currentChatToken() === chatTokenAtStart) {
            setSyncStatus({
                phase: 'error',
                message: '世界推演没有完成',
                error: errorMessage,
                method: runtime.syncStatus.method,
            });
            toast(`世界推演没有完成：${errorMessage}`, 'warning');
        }
        throw error;
    } finally {
        if (runtime.activeSimulation === activeSimulation) {
            runtime.activeSimulation = null;
        }
        setBusy(false);
    }
}

function queueSimulation(messageId, options = {}) {
    // Foreground simulation is the highest-priority state writer. Any history,
    // pulse or propagation task still working from an older world must yield.
    preemptLowPriorityTasksForCore({ includeWorldWriters: true });
    const context = getContext();
    const numericMessageId = Number(messageId);
    const message = context?.chat?.[numericMessageId];
    const swipeId = Number(message?.swipe_id ?? 0);
    const sourceKey = message
        ? branchSourceKey(numericMessageId, message, swipeId)
        : `${numericMessageId}:${swipeId}:missing`;
    const branch = message ? branchDataFromMessage(message, swipeId) : null;
    const chatToken = currentChatToken();
    const queueKey = `${chatToken}:${sourceKey}`;
    const job = Object.freeze({
        chatToken,
        messageId: numericMessageId,
        swipeId,
        sourceKey,
        queueKey,
        trigger: options.trigger || 'reply',
        force: Boolean(options.force),
        newAssistantCount: Math.max(1, Number(options.newAssistantCount) || 1),
        offeredEventIds: clone(
            options.offeredEventIds
            ?? branch?.offeredEventIds
            ?? runtime.generationOffer.eventIds
            ?? [],
        ),
    });
    const existing = runtime.queuedSimulations.get(queueKey);
    if (existing) return existing;

    setSyncStatus({
        phase: 'queued',
        message: '已排入世界推演队列',
        error: '',
    });
    const task = runtime.simulationChain
        .catch(() => undefined)
        .then(() => runSimulationForMessage(numericMessageId, {
            ...options,
            trigger: job.trigger,
            force: job.force,
            newAssistantCount: job.newAssistantCount,
            job,
        }));
    runtime.simulationChain = task;
    runtime.queuedSimulations.set(queueKey, task);
    void task.then(
        () => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
            window.setTimeout(schedulePendingCatchUp, 40);
            window.setTimeout(scheduleDeferredPublicOpinion, 180);
            window.setTimeout(scheduleAutoMemoryIndex, 700);
        },
        error => {
            if (runtime.queuedSimulations.get(queueKey) === task) {
                runtime.queuedSimulations.delete(queueKey);
            }
            // A failed task must stay failed/pending. Do NOT construct a fresh
            // simulation 40ms later: otherwise bounded internal retries become an
            // unbounded outer retry loop, especially dangerous on 429 routes.
            if (!isAbortError(error) && rateLimitLike(error)) {
                setSyncStatus({
                    phase: 'error',
                    message: '接口限流，本轮推演已停止自动重建',
                    error: '世界状态没有提交；等待冷却后由下一次明确触发继续。',
                    method: runtime.syncStatus.method,
                });
            }
        },
    );
    return task;
}

function scheduleAutoSync(messageId, type) {
    const settings = getSettings();
    const numericMessageId = Number(messageId);
    const message = getContext()?.chat?.[numericMessageId];
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
    const sourceKey = branchSourceKey(numericMessageId, message);
    const chatToken = currentChatToken();
    const queueKey = `${chatToken}:${sourceKey}`;
    const duplicateTask = Boolean(
        (
            runtime.activeSimulation?.chatToken === chatToken
            && runtime.activeSimulation?.sourceKey === sourceKey
        )
        || runtime.queuedSimulations.has(queueKey)
    );
    if (duplicateTask) {
        setSyncStatus({
            phase: runtime.activeSimulation?.sourceKey === sourceKey ? 'running' : 'queued',
            message: '这轮正文已经在推演队列中，无需重复处理',
            error: '',
        });
        return;
    }
    const workAlreadyRunning = Boolean(
        runtime.activeSimulation
        || runtime.queuedSimulations.size > 0
    );
    markMessagePending(messageId, {
        trigger: type || 'reply',
        deferBase: workAlreadyRunning,
    });
    // 新的前台正文一出现，所有仍拿旧上下文工作的低优先级任务都让路。
    preemptLowPriorityTasksForCore({ includeWorldWriters: true });
    if (!settings.worldAutoEnabled) {
        setSyncStatus({
            phase: 'pending',
            message: '自动推演设为手动；可随时推演累计正文',
            error: '',
        });
        return;
    }
    if (workAlreadyRunning) {
        preemptLowPriorityTasksForCore();
        const activeForCurrentChat = runtime.activeSimulation?.chatToken === chatToken
            ? runtime.activeSimulation
            : null;
        const activeTurns = activeForCurrentChat
            ? Math.max(1, Number(activeForCurrentChat.newAssistantCount) || 1)
            : 0;
        const waitingTurns = Math.max(
            1,
            pendingAssistantEntriesThrough(messageId).length - activeTurns,
        );
        setSyncStatus({
            phase: activeForCurrentChat ? 'running' : 'queued',
            message: `新正文已安全进入队列，会在当前推演完成后继续（待处理 ${waitingTurns} 轮）`,
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

    preemptLowPriorityTasksForCore();
    void queueSimulation(messageId, {
        trigger: type || 'reply',
        newAssistantCount: pending.length,
    }).catch(() => undefined);
}

function schedulePendingCatchUp({ afterMessageId = -1 } = {}) {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.worldSimulationEnabled
        || !settings.worldAutoEnabled
        || runtime.simulationCount > 0
        || coreSimulationBusy()
    ) {
        return;
    }
    const latest = latestAssistantEntry();
    if (!latest) return;
    if (latest.index <= Number(afterMessageId)) return;
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
    const hasNewHistory = unindexedAssistantCount() >= interval;
    const hasPendingRollup = Boolean(planMemoryRollup(getState()));
    if (!hasNewHistory && !hasPendingRollup) return;
    if (runtime.autoMemoryTimer !== null) return;

    runtime.autoMemoryTimer = window.setTimeout(() => {
        runtime.autoMemoryTimer = null;
        if (
            runtime.historyProgress.phase === 'running'
            || runtime.simulationCount > 0
            || coreSimulationBusy()
        ) {
            scheduleAutoMemoryIndex();
            return;
        }
        void scanStoryMemoryHistory({
            automatic: true,
            maximumBatches: 1,
        }).catch(() => undefined);
    }, hasNewHistory ? 900 : 1600);
}

function onMessageReceived(messageId, type) {
    if (['quiet', 'impersonate', 'first_message'].includes(type)) return;
    const message = getContext()?.chat?.[Number(messageId)];
    if (!hasUsableAssistantText(message)) {
        if (!runtime.inBackgroundGeneration) {
            setSyncStatus({
                phase: 'idle',
                message: '回复为空或生成失败，已跳过推演与记忆写入',
                error: '',
            });
        }
        return;
    }
    scheduleAutoSync(Number(messageId), type);
    scheduleAutoMemoryIndex();
}

async function runPreGenerationConsistencyBarrier(_chat, _contextSize, _abort, type) {
    const settings = getSettings();
    if (
        runtime.inBackgroundGeneration
        || runtime.consistencyBarrierRunning
        || ['quiet', 'impersonate', 'first_message'].includes(type)
    ) {
        return;
    }

    const offerCurrentInjection = () => {
        refreshInjection();
        runtime.generationOffer = {
            eventIds: clone(runtime.injection.eventIds || []),
            at: Date.now(),
        };
    };

    if (!settings.enabled || !settings.worldSimulationEnabled) {
        offerCurrentInjection();
        return;
    }

    const latest = latestAssistantEntry();
    if (!latest) {
        offerCurrentInjection();
        return;
    }

    const pending = pendingAssistantEntriesThrough(latest.index);
    const coreAlreadyRunning = Boolean(
        runtime.activeSimulation
        || runtime.queuedSimulations.size > 0
    );

    // Consistency Barrier is a gate, not a hidden auto-run trigger.
    // It may wait for work that is already due/running, but it must not bypass
    // the user's auto-run switch or configured "every N turns" interval.
    const autoTaskIsDue = Boolean(
        settings.worldAutoEnabled
        && pending.length >= settings.autoSimulationInterval
    );

    if (!pending.length && !coreAlreadyRunning) {
        if (pendingPublicImpactEvents(getState(), { maximum: 8 }).length) {
            try {
                await runPublicImpactPropagation({ quiet: true, force: true });
            } catch (error) {
                if (!isAbortError(error)) {
                    console.warn('[世界背面] 发送前公共事件影响未完成，本轮沿用上一份已确认影响状态', error);
                }
            }
        }
        offerCurrentInjection();
        return;
    }

    if (!coreAlreadyRunning && !autoTaskIsDue) {
        setSyncStatus({
            phase: 'pending',
            message: !settings.worldAutoEnabled
                ? `已有 ${pending.length} 轮正文待同步；自动推演为手动，本次发送不会偷偷替你启动推演`
                : `已累计 ${pending.length}/${settings.autoSimulationInterval} 轮正文；未到自动频率，本次发送继续沿用上一份已确认世界状态`,
            error: '',
        });
        offerCurrentInjection();
        return;
    }

    runtime.consistencyBarrierRunning = true;
    preemptLowPriorityTasksForCore();
    setSyncStatus({
        phase: 'running',
        message: coreAlreadyRunning
            ? '已有到期世界任务正在接线～先等它提交完成，再把最新确认状态递给正文'
            : pending.length > 1
                ? `已达到自动频率，先把累计的 ${pending.length} 层世界接上～`
                : '已达到自动频率，先把最新一层世界接上～',
        error: '',
    });

    try {
        if (coreAlreadyRunning) {
            await runtime.simulationChain.catch(error => {
                if (!isAbortError(error)) throw error;
            });
        } else if (autoTaskIsDue) {
            await queueSimulation(latest.index, {
                trigger: 'pre-send-barrier-due',
                newAssistantCount: pending.length,
            });
        }

        if (pendingPublicImpactEvents(getState(), { maximum: 8 }).length) {
            await runPublicImpactPropagation({ quiet: true, force: true });
        }
    } catch (error) {
        if (!isAbortError(error)) {
            console.warn('[世界背面] 发送前世界同步未完成，本轮将沿用上一份已确认状态', error);
        }
    } finally {
        runtime.consistencyBarrierRunning = false;
        offerCurrentInjection();
    }
}

globalThis.worldBackstageGenerationInterceptor = runPreGenerationConsistencyBarrier;

function onGenerationStarted(type, _options, dryRun) {
    if (dryRun || ['quiet', 'impersonate'].includes(type)) return;
    refreshInjection();
    runtime.generationOffer = {
        eventIds: clone(runtime.injection.eventIds || []),
        at: Date.now(),
    };
}

function restoreExistingSwipe(messageId) {
    invalidateAsyncWorldContext();
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
            ? restoreBranchSnapshot(data.base, store.initialState)
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
            base: createBranchSnapshot(base, {
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
            restoreBranchSnapshot(data.base, store.initialState),
            true,
        );
        if (message.mes && message.mes !== '...' && getSettings().worldAutoEnabled) {
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
    invalidateAsyncWorldContext();
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

function onMessageDeleted(messageId) {
    invalidateAsyncWorldContext();
    const rawIndex = messageId && typeof messageId === 'object'
        ? (messageId.messageId ?? messageId.message_id ?? messageId.index ?? messageId.id)
        : messageId;
    const index = Number(rawIndex);
    if (!Number.isFinite(index) || index < 0) {
        restoreLatestBranch({ pending: true });
        return;
    }

    // 删除中间楼层后，后面的消息索引整体左移；旧 snapshot/sourceMessageId
    // 已经不再指向同一段正文。先作废删除点之后的快照，再退回删除点之前。
    markSnapshotsStaleFrom(index);
    const store = getStore();
    const previous = findLatestResultSnapshot(index);
    store.currentState = markPendingSync(
        previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
        true,
    );
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    setSyncStatus({
        phase: 'pending',
        message: '消息已删除，删除点之后的旧世界快照已作废；请按当前正文重新同步',
        error: '',
    });
}

function onChatChanged() {
    invalidateAsyncWorldContext();
    runtime.activePublicOpinion?.controller?.abort?.();
    runtime.activePublicOpinionSandbox?.controller?.abort?.();
    runtime.activeObservation?.controller?.abort?.();
    runtime.activePublicOpinion = null;
    runtime.activePublicOpinionSandbox = null;
    runtime.activeObservation = null;
    // 旧聊天的 single-flight promise 不能挡住新聊天第一次舆情检查。
    // 旧 promise 的 finally 有 identity guard，不会误清新聊天随后建立的 transaction。
    runtime.publicOpinionRefreshTransaction = null;
    runtime.pendingPublicImpact = false;
    runtime.pendingPublicOpinion = false;
    runtime.queuedSimulations.clear();
    if (runtime.publicImpactTimer !== null) {
        window.clearTimeout(runtime.publicImpactTimer);
        runtime.publicImpactTimer = null;
    }
    if (runtime.publicOpinionTimer !== null) {
        window.clearTimeout(runtime.publicOpinionTimer);
        runtime.publicOpinionTimer = null;
    }
    runtime.lastTaskConnection = null;
    resetLastCustomApiOperation();
    runtime.ui?.resetContext?.();
    runtime.ui?.ensureMounted?.();
    installSettingsEntry();
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
    runtime.publicOpinionStatus = {
        phase: 'idle',
        message: '尚未生成舆情快照',
        error: '',
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
        if (compactBranchSnapshotStorage()) void getContext()?.saveChat?.();
        schedulePendingCatchUp();
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
    store.currentState = ensureMonotonicRevision(undo.state, store.currentState);
    if (undo.previousInitialState) store.initialState = trimState(undo.previousInitialState);
    store.branchOverrides[undo.key] = createBranchSnapshot(store.currentState, {
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
    const committed = setCurrentState(nextState, { overrideKey: key });
    armManualUndo(previousState, { key });
    schedulePublicImpactPropagation(committed, 120);
    scheduleAutoPublicOpinion(committed, 520);
    toast(message, 'success');
}

function createManualRecoveryPoint() {
    const store = addRecoveryPoint(getStore(), {
        reason: 'manual',
        label: '手动创建的恢复点',
    });
    saveStore(store, { immediate: true });
    runtime.ui?.render();
    toast('恢复点存好啦～放心继续折腾 `(｡•̀ᴗ-)✧`', 'success');
    return listRecoveryPoints(store).at(-1) || null;
}

function restoreLatestSavedRecovery() {
    const currentStore = getStore();
    const beforeRestoreState = clone(currentStore.currentState);
    const key = currentAnchorKey();
    const target = listRecoveryPoints(currentStore).at(-1);
    if (!target) throw new Error('当前聊天还没有可恢复的保存点');
    const confirmed = globalThis.confirm?.(
        `(・_・;)  将当前世界恢复到：${target.label}\n${target.createdAt}\n\n恢复前也会自动保存现在的状态。`,
    );
    if (confirmed === false) return null;

    let store = addRecoveryPoint(currentStore, {
        reason: 'before-restore',
        label: '恢复操作前自动保存',
    });
    const restored = restoreRecoveryPoint(store, target.id);
    if (!restored.point) throw new Error('恢复点已经失效，请重新打开设置后再试');
    store = restored.store;
    store.currentState = ensureMonotonicRevision(store.currentState, beforeRestoreState);
    store.branchOverrides ||= {};
    store.branchOverrides[key] = createBranchSnapshot(store.currentState, {
        sourceKey: key,
        kind: 'recovery-restore',
    });
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.ui?.render();
    toast('世界已经恢复到保存点，可以继续啦。', 'success');
    return restored.point;
}

function redactDiagnosticText(value) {
    let text = String(value || '');
    const settings = getSettings();
    const keys = [
        String(settings.customApiKey || ''),
        ...(settings.apiProfiles || []).map(profile => String(profile.key || '')),
    ].filter(key => key.length >= 4);
    for (const key of keys) text = text.split(key).join('[API Key 已隐藏]');
    return text
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
        .replace(/https?:\/\/[^\s"'<>]+/gi, '[接口地址已隐藏]')
        .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
        .slice(0, 600);
}

function classifyDiagnosticIssue(value) {
    const text = String(value || '').toLocaleLowerCase();
    if (!text) return 'none';
    if (/abort|cancel|取消|停止/.test(text)) return 'cancelled';
    if (/401|403|unauthorized|forbidden|鉴权|密钥|api.?key/.test(text)) return 'authorization';
    if (/insufficient[_\s-]*quota|quota\s*(?:exceeded|exhausted|depleted)|credits?\s*(?:exhausted|depleted)|额度(?:不足|耗尽)|余额不足/.test(text)) return 'quota-exhausted';
    if (/429|too many requests|rate[_\s-]*limit|请求过于频繁|频率限制|限流/.test(text)) return 'rate-limit';
    if (/timeout|timed out|超时/.test(text)) return 'timeout';
    if (/network|fetch|connection|econn|网络|连接/.test(text)) return 'network';
    if (/no message|empty|空回|没有生成|未生成/.test(text)) return 'empty-response';
    if (/length|max[_\s-]*tokens?|token[_\s-]*limit|输出上限|长度上限|过长/.test(text)) return 'output-limit';
    if (/json|解析|parse|格式/.test(text)) return 'invalid-json';
    return 'other';
}

function buildDiagnosticReport() {
    const context = getContext();
    const settings = getSettings();
    const state = getState();
    const store = getStore();
    const connection = getConnectionInfo();
    const recoveryPoints = listRecoveryPoints(store);
    const activeEvents = state.events.filter(event => ['active', 'waiting', 'ready'].includes(event.status));
    const viewport = globalThis.visualViewport;
    const report = {
        plugin: {
            name: 'World Backstage',
            version: PLUGIN_VERSION,
            stateSchema: SCHEMA_VERSION,
        },
        sillyTavern: {
            version: String(
                context?.version
                || globalThis.SillyTavern?.version
                || document.querySelector?.('#version_display')?.textContent
                || '未识别',
            ).trim().slice(0, 120),
        },
        device: {
            userAgent: String(globalThis.navigator?.userAgent || '未识别').slice(0, 240),
            viewport: `${Math.round(Number(viewport?.width || globalThis.innerWidth || 0))}x${Math.round(Number(viewport?.height || globalThis.innerHeight || 0))}`,
            touchPoints: Number(globalThis.navigator?.maxTouchPoints || 0),
        },
        connection: {
            mode: settings.apiMode,
            api: connection.apiLabel,
            source: connection.source,
            model: redactDiagnosticText(connection.model),
            transport: settings.apiMode === 'custom' ? settings.customApiTransport : 'tavern',
            configured: connection.configured,
            method: connection.method,
            internalCompatChars: Number(runtime.lastPromptBridge?.internalCompatChars
                ?? String(INTERNAL_COMPAT_SYSTEM_PROMPT || '').trim().length),
        },
        features: {
            worldSimulation: settings.worldSimulationEnabled,
            worldAuto: settings.worldAutoEnabled,
            worldContinuityInjection: settings.worldSimulationEnabled,
            worldRevealInjection: settings.worldPromptInjection,
            memorySystem: settings.memorySystemEnabled,
            memoryInjection: settings.memoryPromptInjection,
            simulationMode: settings.autoSimulationMode,
            worldPulseActivity: settings.worldPulseActivity,
            simulationInterval: settings.autoSimulationInterval,
            retryCount: settings.autoRetryCount,
            contextTurns: settings.contextTurns,
            npcBudget: settings.backgroundNpcBudget,
            uiScale: settings.uiScale,
            publicOpinionAuto: settings.publicOpinionAutoEnabled,
            publicOpinionRevealMode: settings.publicOpinionRevealMode,
            apiProfileCount: settings.apiProfiles?.length || 0,
            apiModuleRoutes: { ...(settings.apiModuleRoutes || {}) },
            generationMaxTokenCap: settings.maxOutputTokens,
            generationTimeoutMs: settings.generationTimeoutMs,
            generationModuleLimits: clone(settings.generationModuleLimits || {}),
        },
        state: {
            revision: state.revision,
            worldMinute: state.clock?.absoluteMinute,
            pendingSync: state.pendingSync,
            people: state.people.length,
            events: state.events.length,
            activeEvents: activeEvents.length,
            echoes: state.echoes.length,
            archive: state.archive.length,
            memoryFacts: state.storyMemory?.facts?.length || 0,
            memorySummaries: state.storyMemory?.summaries?.length || 0,
            memoryClues: state.storyMemory?.clues?.length || 0,
            worldFacts: state.worldFacts?.length || 0,
            publicImpactLedger: state.publicImpactLedger?.length || 0,
            pendingPublicImpacts: pendingPublicImpactEvents(state, { maximum: 96 }).length,
            consistencyConflicts: state.consistencyConflicts?.length || 0,
            needsReconciliation: Boolean(state.needsReconciliation),
            indexedThroughMessageId: state.storyMemory?.indexedThroughMessageId ?? -1,
            chatMessages: context?.chat?.length || 0,
            recoveryPoints: recoveryPoints.length,
            latestSnapshot: Boolean(findLatestResultSnapshot()),
        },
        lastWorldTask: {
            phase: runtime.syncStatus.phase,
            messageType: classifyDiagnosticIssue(runtime.syncStatus.message),
            errorType: classifyDiagnosticIssue(runtime.syncStatus.error),
            attemptedAt: runtime.syncStatus.attemptedAt,
            succeededAt: runtime.syncStatus.succeededAt,
            method: runtime.syncStatus.method,
            route: runtime.lastTaskConnection?.apiLabel || '',
            model: redactDiagnosticText(runtime.lastTaskConnection?.model || ''),
            taskKind: runtime.lastTaskConnection?.taskKind || '',
            requestedMaxTokens: runtime.lastTaskConnection?.requestedMaxTokens || 0,
            effectiveMaxTokens: runtime.lastTaskConnection?.maxTokens || 0,
            tokenLimitSource: runtime.lastTaskConnection?.tokenLimitSource || '',
            timeoutMs: runtime.lastTaskConnection?.timeoutMs || 0,
            timeoutLimitSource: runtime.lastTaskConnection?.timeoutLimitSource || '',
            memoryPhase: runtime.historyProgress.phase,
            memoryMessageType: classifyDiagnosticIssue(runtime.historyProgress.message),
        },
        retryControl: getRetryControlStatus(),
        lastApiOperation: (() => {
            const operation = getLastCustomApiOperation();
            if (!operation) return null;
            return {
                phase: operation.phase,
                operation: operation.operation,
                source: operation.source,
                route: redactDiagnosticText(operation.route || ''),
                model: redactDiagnosticText(operation.model || ''),
                transport: operation.transport,
                transportStatus: operation.transportStatus,
                upstreamStatus: operation.upstreamStatus,
                retryAfterMs: Number(operation.retryAfterMs) || 0,
                errorType: operation.errorType,
                errorSummary: redactDiagnosticText(operation.errorSummary || ''),
                attemptedAt: operation.attemptedAt,
                succeededAt: operation.succeededAt,
                failedAt: operation.failedAt,
            };
        })(),
        privacy: '不包含 API Key、接口地址、聊天正文、角色身份锚点或自定义提示词。',
        generatedAt: new Date().toISOString(),
    };
    return `世界背面诊断信息（可安全分享）\n${JSON.stringify(report, null, 2)}`;
}

async function copyDiagnosticReport() {
    const report = buildDiagnosticReport();
    try {
        if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') {
            throw new Error('Clipboard API unavailable');
        }
        await globalThis.navigator.clipboard.writeText(report);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand?.('copy');
        textarea.remove();
        if (!copied) throw new Error('浏览器没有允许复制，请检查剪贴板权限');
    }
    toast('诊断信息已复制，敏感内容没有放进去。', 'success');
    return report;
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
        `(・_・;)  导入会替换这个聊天当前的世界状态。\n\n导入：${imported.world.name}`,
    );
    if (confirmed === false) return;

    let store = addRecoveryPoint(getStore(), {
        reason: 'before-import',
        label: '导入世界状态前自动保存',
    });
    const previousState = clone(store.currentState);
    const previousInitialState = clone(store.initialState);
    const key = currentAnchorKey();
    store.currentState = imported;
    if (!findLatestResultSnapshot()) store.initialState = clone(imported);
    store.branchOverrides[key] = createBranchSnapshot(imported, {
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
    toast('世界状态搬进来啦～一切都在原位。', 'success');
}

function saveApiProfile(payload = {}) {
    const context = getContext();
    const settings = getSettings();
    const id = String(payload.id || '').trim() || makeApiProfileId();
    const existing = settings.apiProfiles.find(item => item.id === id);
    const name = String(payload.name || existing?.name || '我的独立 API').trim().slice(0, 80) || '我的独立 API';
    const url = String(payload.url || payload.customApiUrl || existing?.url || '').trim().slice(0, 500);
    const replacementKey = String(payload.key || payload.customApiKey || '').trim();
    const key = (replacementKey || existing?.key || '').slice(0, 1000);
    const model = String(payload.model || payload.customApiModel || existing?.model || '').trim().slice(0, 180);
    const transportValue = payload.transport || payload.customApiTransport || existing?.transport || 'proxy';
    const transport = ['proxy', 'direct'].includes(transportValue) ? transportValue : 'proxy';
    if (!url) throw new Error('先填一下接口地址吧～');
    if (!key) throw new Error('这个方案还缺 API Key 哦');
    if (!model) throw new Error('还没选模型呢～');
    const profile = { id, name, url, key, model, transport };
    const next = settings.apiProfiles.filter(item => item.id !== id);
    next.push(profile);
    settings.apiProfiles = normalizeApiProfiles(next);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    context.extensionSettings[MODULE_ID] = settings;
    saveSettings();
    runtime.ui?.render();
    toast(`“${name}”已经乖乖存好啦～`, 'success');
    return { ...profile, key: '' };
}

function deleteApiProfile(profileId) {
    const context = getContext();
    const settings = getSettings();
    const id = String(profileId || '').trim();
    const existing = settings.apiProfiles.find(item => item.id === id);
    if (!existing) throw new Error('没有找到这个 API 方案');
    settings.apiProfiles = settings.apiProfiles.filter(item => item.id !== id);
    settings.apiModuleRoutes = normalizeApiModuleRoutes(settings.apiModuleRoutes, settings.apiProfiles);
    context.extensionSettings[MODULE_ID] = settings;
    saveSettings();
    runtime.ui?.render();
    toast(`“${existing.name}”已经删掉啦～`, 'success');
    return true;
}

function duplicateApiProfile(profileId) {
    const settings = getSettings();
    const existing = settings.apiProfiles.find(item => item.id === String(profileId || ''));
    if (!existing) throw new Error('没有找到这个 API 方案');
    return saveApiProfile({
        ...existing,
        id: '',
        name: `${existing.name} · 副本`.slice(0, 80),
    });
}

function profileRequestSettings(profileId) {
    const settings = getSettings();
    const profile = settings.apiProfiles.find(item => item.id === String(profileId || ''));
    if (!profile) throw new Error('没有找到这个 API 方案');
    return { settings, profile, requestSettings: settingsForApiProfile(settings, profile) };
}

async function testApiProfileConnection(profileId) {
    const { profile, requestSettings } = profileRequestSettings(profileId);
    const context = getContext();
    setBusy(true);
    try {
        const reply = await requestCustomCompletion(requestSettings, buildBackstageMessages('这是连接测试。请只回复：连接成功'), {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            maxTokens: 80,
            temperature: 0,
            operation: 'connection-test',
            routeLabel: profile.name || '已保存方案',
        });
        if (!String(reply || '').trim()) throw new Error('接口没有返回内容');
        toast(`“${profile.name}”连接成功啦～`, 'success');
        return true;
    } finally {
        setBusy(false);
    }
}

async function pullApiProfileModels(profileId) {
    const { profile, requestSettings } = profileRequestSettings(profileId);
    runtime.modelPullStatus = { phase: 'running', message: `正在读取“${profile.name}”的模型列表` };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(requestSettings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: profile.name || '已保存方案',
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `找到 ${models.length} 个模型啦～还是可以手动填写哦`,
        };
        return models;
    } catch (error) {
        runtime.modelPullStatus = { phase: 'error', message: describeError(error) };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

function settingsFromApiDraft(payload = {}, { requireModel = true } = {}) {
    const base = getSettings();
    const url = String(payload.url || payload.customApiUrl || '').trim().slice(0, 500);
    const key = String(payload.key || payload.customApiKey || '').trim().slice(0, 1000);
    const model = String(payload.model || payload.customApiModel || '').trim().slice(0, 180);
    const transport = ['proxy', 'direct'].includes(payload.transport || payload.customApiTransport)
        ? (payload.transport || payload.customApiTransport)
        : 'proxy';
    if (!url) throw new Error('还没填接口地址呢～');
    if (!key) throw new Error('还缺 API Key 哦～');
    if (requireModel && !model) throw new Error('还没选模型呢～');
    return {
        ...base,
        apiMode: 'custom',
        customApiUrl: url,
        customApiKey: key,
        customApiModel: model,
        customApiTransport: transport,
    };
}

async function testApiDraftConnection(payload = {}) {
    const requestSettings = settingsFromApiDraft(payload, { requireModel: true });
    const context = getContext();
    setBusy(true);
    try {
        const reply = await requestCustomCompletion(requestSettings, buildBackstageMessages('这是连接测试。请只回复：连接成功'), {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            maxTokens: 80,
            temperature: 0,
            operation: 'connection-test',
            routeLabel: String(payload.label || '临时独立接口').slice(0, 80),
        });
        if (!String(reply || '').trim()) throw new Error('接口没有返回内容');
        toast(`${String(payload.label || '这个接口').slice(0, 80)}连接成功啦～`, 'success');
        return true;
    } finally {
        setBusy(false);
    }
}

async function pullApiDraftModels(payload = {}) {
    const requestSettings = settingsFromApiDraft(payload, { requireModel: false });
    const label = String(payload.label || '这个接口').slice(0, 80);
    runtime.modelPullStatus = { phase: 'running', message: `正在翻${label}的模型列表～` };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(requestSettings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: label,
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `找到 ${models.length} 个模型啦～不会改动默认接口`,
        };
        toast(`找到 ${models.length} 个可用模型啦～`, 'success');
        return models;
    } catch (error) {
        runtime.modelPullStatus = { phase: 'error', message: describeError(error) };
        throw error;
    } finally {
        runtime.ui?.render();
    }
}

async function testCustomApiConnection() {
    const settings = getSettings();
    if (settings.apiMode !== 'custom') {
        throw new Error('请先把世界推演连接切换为“独立接口”');
    }
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: '正在戳一下独立 API，看看它醒不醒～',
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const context = getContext();
        runtime.syncStatus.method = settings.customApiTransport === 'direct'
            ? '默认独立接口 · 浏览器直连'
            : '默认独立接口 · 酒馆转发';
        const reply = await requestCustomCompletion(
            settings,
            buildBackstageMessages('这是连接测试。请只回复：连接成功'),
            {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens: 80,
                temperature: 0,
                operation: 'connection-test',
                routeLabel: '默认独立接口',
            },
        );
        if (!String(reply || '').trim()) throw new Error('接口没有返回内容');
        setSyncStatus({
            phase: 'success',
            message: '独立 API 连接成功啦～',
            error: '',
            succeededAt: new Date().toISOString(),
            method: runtime.syncStatus.method,
        });
        toast('独立 API 通啦～可以开工 `(•̀ᴗ•́)و`', 'success');
        return true;
    } catch (error) {
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: 'error',
            message: '独立 API 没接上 QAQ',
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
    runtime.modelPullStatus = { phase: 'running', message: '正在翻模型列表～' };
    runtime.ui?.render();
    try {
        const context = getContext();
        const models = await requestCustomModels(settings, {
            fetchImpl: globalThis.fetch.bind(globalThis),
            getRequestHeaders: () => context?.getRequestHeaders?.() || {},
            routeLabel: '默认独立接口',
        });
        runtime.customModels = models;
        runtime.modelPullStatus = {
            phase: 'success',
            message: `找到 ${models.length} 个模型啦～还是可以手动填写`,
        };
        toast(`找到 ${models.length} 个可用模型啦～`, 'success');
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

async function runOneMemoryRollup(state, controller) {
    const plan = planMemoryRollup(state);
    if (!plan) return { state, rolledUp: false };
    if (controller?.signal?.aborted) {
        const error = new Error('记忆整理已停止');
        error.name = 'AbortError';
        throw error;
    }
    runtime.historyProgress = {
        ...runtime.historyProgress,
        phase: 'running',
        message: `正在把 ${plan.sourceSummaryIds.length} 条 L${plan.sourceLevel} 记忆压成 L${plan.targetLevel}～`,
    };
    runtime.ui?.render();
    const payload = await runWithRetries(async attempt => {
        const prompt = buildMemoryRollupPrompt(state, plan, { compact: attempt > 0 });
        const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
            maxTokens: retryTokenBudget(2400, attempt),
            temperature: attempt > 0 ? 0.03 : 0.08,
            signal: controller?.signal,
            taskKind: 'history',
        });
        const parsed = extractJsonObject(raw);
        if (parsed) return parsed;
        throw unreadableJsonError(raw, '记忆压缩模型');
    }, {
        retries: getSettings().autoRetryCount,
        shouldRetry: error => !(
            /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                .test(describeError(error))
        ),
        onRetry: ({ attempt, total, delayMs, rateLimited }) => {
            runtime.historyProgress.message = rateLimited
                ? `历史路线被限流啦～冷却 ${cooldownSeconds(delayMs)} 秒后只继续这一份记忆压缩`
                : `记忆压缩没收好，正在用更紧凑格式重试 ${attempt}/${total}`;
            runtime.ui?.render();
        },
        ...retryTaskOptions(
            'history',
            `history-rollup:${currentChatToken()}:${plan.sourceSummaryIds.join(',')}:${plan.targetLevel}`,
            {
                onCooldown: ({ delayMs }) => {
                    runtime.historyProgress.message = `历史 API 正在冷却～还剩约 ${cooldownSeconds(delayMs)} 秒，不会重复开任务`;
                    runtime.ui?.render();
                },
            },
        ),
        signal: controller?.signal,
    });
    if (controller?.signal?.aborted) {
        const error = new Error('记忆整理已停止');
        error.name = 'AbortError';
        throw error;
    }
    return {
        state: applyMemoryRollupResult(state, payload, plan),
        rolledUp: true,
    };
}



async function runPublicImpactPropagation({
    quiet = false,
    force = false,
    maximumEvents = 8,
} = {}) {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.worldSimulationEnabled
        || (!force && !settings.worldAutoEnabled)
    ) return false;

    if (runtime.activePublicImpact?.promise) {
        return runtime.activePublicImpact.promise;
    }
    if (
        runtime.activeSimulation
        || runtime.activeWorldPulse
        || runtime.activeHistoryScan
        || runtime.queuedSimulations.size > 0
    ) return false;

    const baseState = getState();
    const baseRevision = Math.max(0, Number(baseState?.revision) || 0);
    const sourceEvents = pendingPublicImpactEvents(baseState, { maximum: maximumEvents });
    if (!sourceEvents.length) return false;

    const chatToken = currentChatToken();
    const contextEpochAtStart = runtime.contextEpoch;
    const controller = new AbortController();
    const active = {
        controller,
        chatToken,
        sourceEventIds: sourceEvents.map(event => event.id),
        promise: null,
    };
    runtime.activePublicImpact = active;
    runtime.pendingPublicImpact = false;

    active.promise = (async () => {
        setBusy(true);
        if (!quiet) {
            setSyncStatus({
                phase: 'running',
                message: '公共事件正在沿着行业、组织和人物关系往外产生影响～',
                error: '',
            });
        }
        try {
            const prompt = buildPublicImpactPrompt(baseState, {
                sourceEventIds: active.sourceEventIds,
                userName: getContext()?.name1 || '',
                maximumEvents,
            });
            const baseMaxTokens = 3400;

            const payload = await runWithRetries(async attempt => {
                const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                    maxTokens: retryTokenBudget(baseMaxTokens, attempt),
                    temperature: attempt > 0 ? 0.04 : 0.12,
                    signal: controller.signal,
                    taskKind: 'public-impact',
                });
                const parsed = extractJsonObject(raw);
                if (parsed) return parsed;
                throw unreadableJsonError(raw, '公共事件影响模型');
            }, {
                retries: settings.autoRetryCount,
                shouldRetry: error => !(
                    /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                        .test(describeError(error))
                ),
                onRetry: ({ delayMs, rateLimited }) => {
                    if (!quiet && rateLimited) {
                        setSyncStatus({
                            phase: 'running',
                            message: `公共事件影响遇到限流～冷却 ${cooldownSeconds(delayMs)} 秒`,
                            error: '当前影响任务保持单实例，不会重复创建。',
                        });
                    }
                },
                ...retryTaskOptions(
                    'public-impact',
                    `public-impact:${chatToken}:${active.sourceEventIds.join(',')}`,
                ),
                signal: controller.signal,
            });

            if (controller.signal.aborted || currentChatToken() !== chatToken) return false;
            if (
                runtime.contextEpoch !== contextEpochAtStart
                || Math.max(0, Number(getState()?.revision) || 0) !== baseRevision
            ) {
                runtime.pendingPublicImpact = true;
                if (!quiet) {
                    setSyncStatus({
                        phase: 'pending',
                        message: '公共事件影响生成期间世界状态已变化，旧结果未提交',
                        error: '',
                    });
                }
                return false;
            }

            let next = applyPublicImpactResult(baseState, payload, {
                sourceEventIds: active.sourceEventIds,
                userName: getContext()?.name1 || '',
                sourceKey: `public-impact:${active.sourceEventIds.join(',')}:${Date.now()}`,
                backgroundNpcBudget: settings.backgroundNpcBudget,
            });

            const store = getStore();
            const anchorKey = baseState.lastCommit?.sourceKey || 'root';
            store.currentState = ensureMonotonicRevision(next, store.currentState);
            next = store.currentState;
            store.branchOverrides[anchorKey] = createBranchSnapshot(next, {
                sourceKey: anchorKey,
                kind: 'public-impact',
            });
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
            scheduleAutoPublicOpinion(next, 180);

            if (!quiet) {
                setSyncStatus({
                    phase: 'success',
                    message: '公共事件的世界后果已经接进后台啦～',
                    error: '',
                    succeededAt: new Date().toISOString(),
                });
            }
            return true;
        } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) return false;
            if (!quiet) {
                setSyncStatus({
                    phase: 'error',
                    message: '公共事件影响这次没结算完～世界仍沿用上一份确认状态',
                    error: describeError(error),
                });
            }
            throw error;
        } finally {
            setBusy(false);
        }
    })();

    try {
        return await active.promise;
    } finally {
        if (runtime.activePublicImpact === active) runtime.activePublicImpact = null;
        if (runtime.pendingPublicImpact && currentChatToken() === active.chatToken) {
            scheduleDeferredPublicImpact(140, active.chatToken);
        }
        window.setTimeout(schedulePendingCatchUp, 40);
    }
}

async function runWorldPulseTick({
    reason = '主世界时间已推进',
    quiet = false,
    force = false,
    publicCycle = false,
} = {}) {
    const settings = getSettings();
    if (
        !settings.enabled
        || !settings.worldSimulationEnabled
        || (!force && !settings.worldAutoEnabled)
        || runtime.activeSimulation
        || runtime.activePublicImpact
        || runtime.activeWorldPulse
        || runtime.activeHistoryScan
        || runtime.queuedSimulations.size > 0
    ) return false;

    const chatToken = currentChatToken();
    const contextEpochAtStart = runtime.contextEpoch;
    const controller = new AbortController();
    runtime.activeWorldPulse = { controller, chatToken };
    if (!quiet) {
        setSyncStatus({
            phase: 'running',
            message: '世界脉搏正在检查镜头外的变化～',
            error: '',
        });
    }
    try {
        const state = getState();
        const baseRevision = Math.max(0, Number(state?.revision) || 0);
        const prompt = buildWorldPulsePrompt(state, {
            activity: settings.worldPulseActivity,
            reason,
            backgroundNpcBudget: settings.backgroundNpcBudget,
            publicCycle,
        });
        const baseMaxTokens = settings.worldPulseActivity === 'busy'
            ? 3800
            : settings.worldPulseActivity === 'quiet'
                ? 2200
                : 3000;
        const payload = await runWithRetries(async attempt => {
            const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: retryTokenBudget(baseMaxTokens, attempt),
                temperature: attempt > 0 ? 0.05 : 0.16,
                signal: controller.signal,
                taskKind: 'simulation',
            });
            const parsed = extractJsonObject(raw);
            if (parsed) return parsed;
            throw unreadableJsonError(raw, '世界脉搏模型');
        }, {
            retries: settings.autoRetryCount,
            shouldRetry: error => !(
                /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                    .test(describeError(error))
            ),
            onRetry: ({ delayMs, rateLimited }) => {
                if (!quiet && rateLimited) {
                    setSyncStatus({
                        phase: 'running',
                        message: `世界脉搏遇到限流～冷却 ${cooldownSeconds(delayMs)} 秒`,
                        error: '本轮脉搏不会重新创建第二份任务。',
                    });
                }
            },
            ...retryTaskOptions(
                'simulation',
                `world-pulse:${chatToken}:${getState().clock?.absoluteMinute ?? -1}:${publicCycle ? 'public' : 'normal'}:${reason}`,
            ),
            signal: controller.signal,
        });

        if (controller.signal.aborted || currentChatToken() !== chatToken) return false;
        if (
            runtime.contextEpoch !== contextEpochAtStart
            || Math.max(0, Number(getState()?.revision) || 0) !== baseRevision
        ) {
            if (!quiet) {
                setSyncStatus({
                    phase: 'pending',
                    message: '世界脉搏生成期间世界状态已变化，旧结果未提交',
                    error: '',
                });
            }
            return false;
        }

        let next = applySimulationResult(state, {
            ...payload,
            elapsed_minutes: 0,
            memory_update: {
                facts_upsert: [],
                facts_invalidate: [],
                clues_upsert: [],
                clues_resolve: [],
            },
        }, {
            messageId: null,
            swipeId: null,
            sourceKey: `world-pulse:${Date.now()}`,
            userName: getContext()?.name1 || '',
            allowUserInnerVoice: settings.includeUserInnerVoice,
            timePolicy: settings.timePolicy,
            narrativeText: '',
            backgroundNpcBudget: settings.backgroundNpcBudget,
            preserveCommitAnchor: true,
        });

        const store = getStore();
        const anchorKey = state.lastCommit?.sourceKey || 'root';
        store.currentState = ensureMonotonicRevision(next, store.currentState);
        next = store.currentState;
        store.branchOverrides[anchorKey] = createBranchSnapshot(next, {
            sourceKey: anchorKey,
            kind: 'world-pulse',
        });
        saveStore(store, { immediate: true });
        refreshInjection();
        schedulePublicImpactPropagation(next, 120);
        scheduleAutoPublicOpinion(next, 520);
        runtime.ui?.render();
        if (!quiet) {
            setSyncStatus({
                phase: 'success',
                message: '世界脉搏检查完成～镜头外也继续过自己的日子',
                error: '',
                succeededAt: new Date().toISOString(),
            });
        }
        return true;
    } catch (error) {
        if (error?.name === 'AbortError') return false;
        if (!quiet) {
            setSyncStatus({
                phase: 'error',
                message: '世界时间已经推进，但这次世界脉搏没接上～下次推演会继续追',
                error: describeError(error),
            });
        }
        return false;
    } finally {
        if (runtime.activeWorldPulse?.controller === controller) runtime.activeWorldPulse = null;
        window.setTimeout(schedulePendingCatchUp, 40);
    }
}

async function bootstrapWorldFromHistory() {
    if (runtime.historyProgress.phase === 'running') {
        throw new Error('历史整理已经在进行中');
    }
    if (coreSimulationBusy()) {
        throw new Error('世界推演或后台结算正在进行，请等当前任务结束后再做历史回溯');
    }
    const context = getContext();
    const chatToken = currentChatToken();
    const contextEpochAtStart = runtime.contextEpoch;
    const chatLength = context?.chat?.length || 0;
    if (!chatLength) throw new Error('当前聊天还没有可回溯的正文');

    const confirmed = globalThis.confirm?.(
        `( •ᴗ• )  将从第 0 层开始回溯当前分支，共约 ${chatLength} 条消息。\n`
        + '会一起建立世界时间、人物当前状态、世界事实、未完暗流、世界脉搏与长期记忆。\n'
        + '全部扫描成功后才会一次性提交；中途失败不会留下半成品。是否继续？',
    );
    if (confirmed === false) return false;

    const protectedStore = addRecoveryPoint(getStore(), {
        reason: 'before-world-history-bootstrap',
        label: '历史回溯前自动保存',
    });
    saveStore(protectedStore, { immediate: true });

    const controller = new AbortController();
    runtime.activeHistoryScan = controller;
    runtime.historyProgress = {
        kind: 'world-bootstrap',
        phase: 'running',
        processed: 0,
        total: chatLength,
        message: '正在把旧聊天接成一个完整世界～',
    };
    setBusy(true);
    runtime.ui?.render();

    // IMPORTANT: staging only. Nothing below is written to the live store until all
    // batches succeed. Manual edits during the scan invalidate the staged result.
    const bootstrapBaseRevision = Math.max(0, Number(getState()?.revision) || 0);
    let stagedState = trimState(getState());
    let cursor = 0;
    let assistantBatchLimit = 4;

    try {
        while (cursor < chatLength) {
            if (controller.signal.aborted) {
                const error = new Error('历史回溯已停止');
                error.name = 'AbortError';
                throw error;
            }
            if (currentChatToken() !== chatToken) {
                throw new Error('回溯期间切换了聊天，本次结果不会提交');
            }

            const batch = nextHistoryBatch(cursor, {
                maximumAssistantTurns: assistantBatchLimit,
            });
            if (!batch.messages.length) {
                cursor = batch.nextCursor;
                continue;
            }

            runtime.historyProgress = {
                kind: 'world-bootstrap',
                phase: 'running',
                processed: batch.startMessageId,
                total: chatLength,
                message: `正在回溯消息 ${batch.startMessageId}—${batch.endMessageId}：人物、暗流、事实和世界脉搏一起收拾～`,
            };
            runtime.ui?.render();

            let payload;
            try {
                payload = await runWithRetries(async attempt => {
                    const prompt = buildWorldBootstrapPrompt(stagedState, {
                        messages: batch.messages,
                        userName: context?.name1 || '',
                        playerIdentityAnchor: getPlayerIdentityAnchor(stagedState),
                        compact: attempt > 0,
                    });
                    const historyBaseTokens = 4800;
                    const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                        maxTokens: retryTokenBudget(historyBaseTokens, attempt),
                        temperature: attempt > 0 ? 0.04 : 0.08,
                        signal: controller.signal,
                        taskKind: 'history',
                    });
                    const parsed = extractJsonObject(raw);
                    if (!parsed) throw unreadableJsonError(raw, '世界历史回溯模型');

                    const assistantIds = batch.messages
                        .filter(message => message.role === 'assistant')
                        .map(message => Number(message.id));
                    const summarizedIds = new Set(
                        (Array.isArray(parsed.turn_summaries) ? parsed.turn_summaries : parsed.turnSummaries || [])
                            .map(item => Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId))
                            .filter(Number.isFinite),
                    );
                    const missingIds = assistantIds.filter(id => !summarizedIds.has(id));
                    if (missingIds.length) {
                        const error = new Error(`历史回溯 L0 摘要缺失：消息 ${missingIds.join(', ')}`);
                        error.code = 'WORLD_BOOTSTRAP_L0_MISSING';
                        throw error;
                    }
                    return parsed;
                }, {
                    retries: getSettings().autoRetryCount,
                    shouldRetry: error => !(
                        /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                            .test(describeError(error))
                    ),
                    onRetry: ({ attempt, total, delayMs, rateLimited }) => {
                        runtime.historyProgress.message = rateLimited
                            ? `历史回溯接口限流～冷却 ${cooldownSeconds(delayMs)} 秒后继续当前批次`
                            : `这批世界基线没收好，正在用紧凑格式重试 ${attempt}/${total}`;
                        runtime.ui?.render();
                    },
                    ...retryTaskOptions(
                        'history',
                        `world-bootstrap:${chatToken}:${batch.startMessageId}:${batch.endMessageId}`,
                    ),
                    signal: controller.signal,
                });
            } catch (error) {
                const assistantTurns = batch.messages.filter(message => message.role === 'assistant').length;
                const canSplit = assistantTurns > 1 && (
                    /JSON|L0 摘要缺失|L0摘要缺失|截断|长度上限|No message generated|没有返回最终正文|没有可读取的最终正文/i
                        .test(describeError(error))
                );
                if (canSplit) {
                    assistantBatchLimit = Math.max(1, Math.floor(assistantTurns / 2));
                    runtime.historyProgress.message = `输出太胖了～自动缩成每批 ${assistantBatchLimit} 轮再来`;
                    runtime.ui?.render();
                    continue;
                }
                throw error;
            }

            const narrativeText = batch.messages
                .filter(message => message.role === 'assistant')
                .map(message => message.content)
                .join('\n');
            stagedState = applyWorldBootstrapResult(stagedState, payload, {
                startMessageId: batch.startMessageId,
                endMessageId: batch.endMessageId,
                narrativeText,
                userName: context?.name1 || '',
                allowUserInnerVoice: getSettings().includeUserInnerVoice,
                memoryEnabled: getSettings().memorySystemEnabled,
            });
            cursor = batch.nextCursor;
            runtime.historyProgress.processed = Math.min(chatLength, cursor);
            runtime.ui?.render();
        }

        // Compact one hierarchy layer after the full staged history has been built.
        if (getSettings().memorySystemEnabled) {
            const rollup = await runOneMemoryRollup(stagedState, controller);
            stagedState = rollup.state;
        }
        if (controller.signal.aborted || currentChatToken() !== chatToken) {
            const error = new Error('历史回溯在提交前被停止');
            error.name = 'AbortError';
            throw error;
        }

        if (
            runtime.contextEpoch !== contextEpochAtStart
            || (getContext()?.chat?.length || 0) !== chatLength
            || Math.max(0, Number(getState()?.revision) || 0) !== bootstrapBaseRevision
        ) {
            const error = new Error('历史回溯期间世界状态被手动修改，本次旧基线不会覆盖新状态');
            error.name = 'AbortError';
            throw error;
        }

        stagedState.storyMemory.indexedThroughMessageId = Math.max(
            stagedState.storyMemory.indexedThroughMessageId,
            chatLength - 1,
        );
        stagedState.worldPulse ||= { baselineEstablished: true, lastSweepAt: stagedState.clock.absoluteMinute, domains: [] };
        stagedState.worldPulse.baselineEstablished = true;
        stagedState.worldPulse.lastSweepAt = stagedState.clock.absoluteMinute;
        stagedState = trimState(stagedState);

        // Atomic commit happens only here. The history helper uses synthetic
        // source keys internally, but the live state must remain anchored to the
        // real foreground branch so later manual overrides survive reload/swipe.
        const latest = latestAssistantEntry();
        if (latest) {
            const latestSwipeId = Number(latest.message?.swipe_id ?? 0);
            stagedState.pendingSync = false;
            stagedState.needsReconciliation = false;
            stagedState.lastCommit = {
                messageId: latest.index,
                swipeId: latestSwipeId,
                sourceKey: branchSourceKey(latest.index, latest.message, latestSwipeId),
                at: stagedState.clock?.absoluteMinute ?? 0,
                committedAt: new Date().toISOString(),
            };
        }
        const store = getStore();
        store.currentState = ensureMonotonicRevision(stagedState, store.currentState);
        stagedState = store.currentState;
        const anchorKey = stagedState.lastCommit?.sourceKey || 'root';
        store.branchOverrides[anchorKey] = createBranchSnapshot(stagedState, {
            sourceKey: anchorKey,
            kind: 'world-history-bootstrap',
        });
        saveStore(store, { immediate: true });

        runtime.historyProgress = {
            kind: 'world-bootstrap',
            phase: 'success',
            processed: chatLength,
            total: chatLength,
            message: '历史回溯完成～世界背面已经跟上这段聊天',
        };
        refreshInjection();
        runtime.ui?.render();
        scheduleAutoPublicOpinion(stagedState, 180);

        const activeCurrents = (stagedState.events || []).filter(event => (
            !['resolved', 'cancelled', 'missed'].includes(event.status)
        )).length;
        toast(
            `世界基线接好啦～人物 ${stagedState.people.length} · 世界事实 ${stagedState.worldFacts.length} · `
            + `未完暗流 ${activeCurrents} · 长期记忆 ${stagedState.storyMemory?.facts?.length || 0}`,
            'success',
        );
        return true;
    } catch (error) {
        runtime.historyProgress = {
            kind: 'world-bootstrap',
            phase: error?.name === 'AbortError' ? 'idle' : 'error',
            processed: 0,
            total: chatLength,
            message: error?.name === 'AbortError'
                ? '历史回溯已停止～现有世界没有写入半成品'
                : `历史回溯失败：${describeError(error)}；现有世界没有改动`,
        };
        runtime.ui?.render();
        if (error?.name === 'AbortError') return false;
        throw error;
    } finally {
        if (runtime.activeHistoryScan === controller) runtime.activeHistoryScan = null;
        setBusy(false);
        runtime.ui?.render();
    }
}

async function scanStoryMemoryHistory({
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
    if (coreSimulationBusy()) {
        if (automatic) return false;
        throw new Error('世界推演或后台结算正在进行，请等当前任务结束后再整理记忆');
    }
    const context = getContext();
    const chatToken = currentChatToken();
    const contextEpochAtStart = runtime.contextEpoch;
    const chatLength = context?.chat?.length || 0;
    if (!chatLength) throw new Error('当前聊天还没有可扫描的正文');

    let state = getState();
    let cursor = Math.max(0, Number(state.storyMemory?.indexedThroughMessageId ?? -1) + 1);
    const initialRollupPlan = planMemoryRollup(state);
    if (cursor >= chatLength && !initialRollupPlan) {
        if (!automatic) toast('历史档案已经追到最新一层啦～', 'info');
        return true;
    }
    if (!automatic && cursor < chatLength) {
        const confirmed = globalThis.confirm?.(
            `( •ᴗ• )  将从第 ${cursor} 层开始分批读取当前分支，共约 ${chatLength - cursor} 条消息。\n`
            + '这会产生额外 API 调用，但每批成功后都会立即保存进度。是否继续？',
        );
        if (confirmed === false) return false;
        const protectedStore = addRecoveryPoint(getStore(), {
            reason: 'before-memory-maintenance',
            label: '手动整理记忆前自动保存',
        });
        saveStore(protectedStore, { immediate: true });
    }

    runtime.historyProgress = {
        kind: 'memory',
        phase: 'running',
        processed: cursor,
        total: chatLength,
        message: cursor < chatLength
            ? (automatic ? '正在悄悄整理新增记忆～' : '正在给历史档案归档～')
            : '正文已经追平啦～顺手把旧经历再压一层',
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
                message: `正在收拾消息 ${batch.startMessageId}—${batch.endMessageId}～`,
            };
            runtime.ui?.render();

            let payload;
            try {
                payload = await runWithRetries(async attempt => {
                    const prompt = buildHistoryIndexPrompt(state, {
                        messages: batch.messages,
                        userName: context?.name1 || '',
                        playerIdentityAnchor: getPlayerIdentityAnchor(state),
                        compact: attempt > 0,
                    });
                    const historyBaseTokens = 3200;
                    const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                        maxTokens: retryTokenBudget(historyBaseTokens, attempt),
                        temperature: attempt > 0 ? 0.05 : 0.1,
                        signal: controller.signal,
                        taskKind: 'history',
                    });
                    const parsed = extractJsonObject(raw);
                    if (parsed) {
                        const assistantIds = batch.messages
                            .filter(message => message.role === 'assistant')
                            .map(message => Number(message.id));
                        const summarizedIds = new Set(
                            (Array.isArray(parsed.turn_summaries) ? parsed.turn_summaries : parsed.turnSummaries || [])
                                .map(item => Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId))
                                .filter(Number.isFinite),
                        );
                        const missingIds = assistantIds.filter(id => !summarizedIds.has(id));
                        const fallbackSummary = parsed?.chapter_summary ?? parsed?.chapterSummary;
                        if (missingIds.length && !(assistantIds.length === 1 && fallbackSummary?.summary)) {
                            const error = new Error(`L0摘要缺失：消息 ${missingIds.join(', ')}`);
                            error.code = 'MEMORY_L0_MISSING';
                            throw error;
                        }
                        return parsed;
                    }
                    throw unreadableJsonError(raw, '记忆整理模型');
                }, {
                    retries: getSettings().autoRetryCount,
                    shouldRetry: error => !(
                        /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                            .test(describeError(error))
                    ),
                    onRetry: ({ attempt, total, delayMs, rateLimited }) => {
                        runtime.historyProgress.message = rateLimited
                            ? `记忆整理接口限流～冷却 ${cooldownSeconds(delayMs)} 秒后继续当前批次`
                            : `记忆整理失败，正在用紧凑格式重试 ${attempt}/${total}`;
                        runtime.ui?.render();
                    },
                    ...retryTaskOptions(
                        'history',
                        `memory-history:${chatToken}:${batch.startMessageId}:${batch.endMessageId}`,
                    ),
                    signal: controller.signal,
                });
            } catch (error) {
                const assistantTurns = batch.messages.filter(message => message.role === 'assistant').length;
                const canSplit = assistantTurns > 1 && (
                    /JSON|L0摘要缺失|截断|长度上限|No message generated|没有返回最终正文|没有可读取的最终正文/i
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
            if (
                runtime.contextEpoch !== contextEpochAtStart
                || Math.max(0, Number(getState()?.revision) || 0) !== Math.max(0, Number(state?.revision) || 0)
            ) {
                const error = new Error('记忆整理期间世界状态被修改，旧批次不会覆盖新状态');
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
            store.currentState = ensureMonotonicRevision(state, store.currentState);
            state = store.currentState;
            const anchorKey = state.lastCommit?.sourceKey || 'root';
            store.branchOverrides[anchorKey] = createBranchSnapshot(state, {
                sourceKey: anchorKey,
                kind: 'history-index',
            });
            saveStore(store);
            runtime.historyProgress.processed = Math.min(chatLength, cursor);
            refreshInjection();
            runtime.ui?.render();
        }

        let rolledUp = false;
        const rollupBaseRevision = Math.max(0, Number(state?.revision) || 0);
        const rollup = await runOneMemoryRollup(state, controller);
        if (
            runtime.contextEpoch !== contextEpochAtStart
            || Math.max(0, Number(getState()?.revision) || 0) !== rollupBaseRevision
        ) {
            const error = new Error('记忆压缩期间世界状态被修改，旧结果不会覆盖新状态');
            error.name = 'AbortError';
            throw error;
        }
        state = rollup.state;
        rolledUp = rollup.rolledUp;
        if (rolledUp) {
            const store = getStore();
            store.currentState = ensureMonotonicRevision(state, store.currentState);
            state = store.currentState;
            const anchorKey = state.lastCommit?.sourceKey || 'root';
            store.branchOverrides[anchorKey] = createBranchSnapshot(state, {
                sourceKey: anchorKey,
                kind: 'memory-rollup',
            });
            saveStore(store, { immediate: true });
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
        store.currentState = ensureMonotonicRevision(state, store.currentState);
        state = store.currentState;
        saveStore(store, { immediate: true });
        runtime.historyProgress = {
            phase: 'success',
            processed: Math.min(chatLength, cursor),
            total: chatLength,
            message: caughtUp
                ? (rolledUp
                    ? '正文记忆已追平，上层经历也顺手整理好一层～'
                    : (automatic ? '新增记忆已自动整理' : '当前分支的历史档案已经建立'))
                : `已整理至消息 ${state.storyMemory.indexedThroughMessageId}`,
        };
        refreshInjection();
        runtime.ui?.render();
        if (!automatic) {
            toast(
                `记忆建档完成：${state.storyMemory.facts.length} 条长期事实，`
                + `${state.storyMemory.clues.length} 条伏笔，`
                + `${state.storyMemory.summaries.length} 段分层经历。`,
                'success',
            );
        } else {
            scheduleAutoMemoryIndex();
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

function personObservationPollutionReason(text, person) {
    const value = String(text || '').trim();
    if (!value) return '返回内容为空';
    if (/<\/?content\b|<UpdateVariable\b|<JSONPatch\b|JSONPatch|<details\b/i.test(value)) {
        return '返回内容混入了主聊天正文 / 变量更新协议';
    }
    const playerCentricHits = (value.match(/(?:^|[。！？\n])\s*你(?:正|又|还|已经|沿|走|坐|站|抬|低|伸|把|看|听|闻|感觉|发现|来到|回到|穿|拿|吃|喝|说|问|停|转)/g) || []).length;
    const firstPersonHits = (value.match(/(?:^|[。！？\n，,])\s*我(?:正|又|还|已经|在|把|看|听|闻|想|觉得|发现|走|坐|站|抬|低|伸|拿|吃|喝|说|问|停|转|没|有)/g) || []).length;
    if (playerCentricHits >= 3 && firstPersonHits === 0) {
        return `返回内容疑似把玩家当成叙述主体，而不是 ${person?.name || '被观测人物'} 的第一人称`;
    }
    return '';
}

function personObservationLooksComplete(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    // Character observations are prose-only. A result that ends mid-word or
    // mid-sentence is overwhelmingly likely to be a max-token truncation on
    // tavern-backed generation, where finish_reason is not exposed to plugins.
    return /[。！？!?…」』”’）)\]】]$/.test(value);
}

async function generateIndependentPersonObservation(prompt, person, settings, { signal } = {}) {
    runtime.syncStatus.method = settings.apiMode === 'custom'
        ? '人物观测 · 世界背面独立接口'
        : '人物观测 · 世界背面独立上下文';

    const requestedAttempts = [
        { maxTokens: 4096, temperature: 0.75 },
        { maxTokens: 8192, temperature: 0.65 },
    ];
    const attempts = [];
    for (const requested of requestedAttempts) {
        const effective = resolveGenerationLimits(
            settings,
            'person-observation',
            requested.maxTokens,
        ).maxTokens;
        if (attempts.some(item => item.maxTokens === effective)) continue;
        attempts.push({ ...requested, maxTokens: effective });
    }
    let lastTruncation = null;

    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        try {
            const raw = String(await runWithRetries(
                () => backgroundSimulation(prompt, {
                    maxTokens: attempt.maxTokens,
                    temperature: attempt.temperature,
                    // Person observation must never inherit the foreground preset. It has
                    // its own POV/output contract.
                    taskKind: 'person-observation',
                    // Custom APIs expose finish_reason, so reject MAX_TOKENS/length
                    // immediately instead of accepting a visibly cut-off paragraph.
                    rejectTruncated: true,
                    signal,
                }),
                {
                    retries: Math.min(1, getSettings().autoRetryCount),
                    shouldRetry: error => rateLimitLike(error)
                        || error?.code === 'GENERATION_TIMEOUT'
                        || error?.errorType === 'timeout',
                    ...retryTaskOptions(
                        'person-observation',
                        `person-observation:${currentChatToken()}:${person.id}:${getState().revision}:${attempt.maxTokens}`,
                    ),
                    signal,
                },
            ) || '');
            const filtered = filterNarrativeText(raw, settings).trim();
            if (!filtered) {
                throw new Error('人物观测返回内容在标签过滤后为空');
            }
            const pollution = personObservationPollutionReason(filtered, person);
            if (pollution) {
                throw new Error(`人物观测输出污染：${pollution}`);
            }
            if (!personObservationLooksComplete(filtered)) {
                const error = new Error('人物观测疑似因输出长度被截断，未保存半截内容');
                error.code = 'OUTPUT_TRUNCATED';
                error.partialText = filtered;
                throw error;
            }
            return filtered;
        } catch (error) {
            if (isAbortError(error)) throw error;
            const truncated = error?.code === 'OUTPUT_TRUNCATED'
                || /输出达到长度上限|输出长度被截断|MAX_TOKENS|finish_reason.?length/i.test(String(error?.message || error));
            if (!truncated) throw error;
            lastTruncation = error;
            if (index >= attempts.length - 1) break;
            console.warn(`[世界背面] 人物观测疑似截断，自动提高输出额度重试（${attempt.maxTokens} → ${attempts[index + 1].maxTokens}）`);
        }
    }

    const reason = String(lastTruncation?.finishReason || '').trim();
    const finalBudget = attempts.at(-1)?.maxTokens || 0;
    throw new Error(
        `人物观测达到当前输出上限${finalBudget ? `（${finalBudget} tokens）` : ''}${reason ? `（${reason}）` : ''}，没有保存半截内容；可在「生成限制」里提高人物观测 Token 上限后再试`,
    );
}

async function observePerson(personId, { force = false } = {}) {
    const state = getState();
    const baselineRevision = Number(state.revision || 0);
    const baselineChatToken = currentChatToken();
    const baselineAssistantStamp = latestAssistantSourceStamp();
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
        playerIdentityAnchor: getPlayerIdentityAnchor(state),
    });

    const controller = new AbortController();
    const activeObservation = {
        controller,
        personId: person.id,
        chatToken: baselineChatToken,
        revision: baselineRevision,
        assistantStamp: baselineAssistantStamp,
    };
    runtime.activeObservation = activeObservation;
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: `正在看 ${person.name} 此刻在做什么`,
        error: '',
        attemptedAt: new Date().toISOString(),
    });
    try {
        const text = await generateIndependentPersonObservation(prompt, person, settings, { signal: controller.signal });
        const stale = (
            currentChatToken() !== baselineChatToken
            || Number(getState().revision || 0) !== baselineRevision
            || latestAssistantSourceStamp() !== baselineAssistantStamp
        );
        if (stale) {
            const error = new Error('观测期间世界已经往前走啦～旧结果没有保存，重新看一次就会以最新状态为准');
            error.code = 'STALE_BACKGROUND_TASK';
            throw error;
        }
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
        if (isAbortError(error) || controller.signal.aborted) {
            setSyncStatus({
                phase: 'pending',
                message: '新正文来啦～旧人物观测先停掉，不会保存过期结果',
                error: '',
                method: runtime.syncStatus.method,
            });
            throw error;
        }
        const errorMessage = describeError(error);
        setSyncStatus({
            phase: error?.code === 'STALE_BACKGROUND_TASK' ? 'pending' : 'error',
            message: error?.code === 'STALE_BACKGROUND_TASK'
                ? '人物观测已经过期，没有写入缓存'
                : '人物即时观测没有完成',
            error: errorMessage,
            method: runtime.syncStatus.method,
        });
        throw error;
    } finally {
        if (runtime.activeObservation === activeObservation) runtime.activeObservation = null;
        setBusy(false);
    }
}



async function generatePublicOpinionSnapshot(options = {}) {
    const existing = runtime.publicOpinionRefreshTransaction;
    if (existing?.promise) return existing.promise;

    const transaction = {
        chatToken: currentChatToken(),
        startedAt: Date.now(),
        promise: null,
    };
    runtime.publicOpinionRefreshTransaction = transaction;
    runtime.ui?.render();

    const promise = generatePublicOpinionSnapshotInternal(options)
        .finally(() => {
            if (runtime.publicOpinionRefreshTransaction === transaction) {
                runtime.publicOpinionRefreshTransaction = null;
            }
            runtime.ui?.render();
        });
    transaction.promise = promise;
    return promise;
}

async function generatePublicOpinionSnapshotInternal({ allowDefer = true, ensurePublicWorld = false, settlePublicImpact = true, force = false } = {}) {
    const chatTokenAtStart = currentChatToken();
    if (allowDefer && coreSimulationBusy()) {
        runtime.pendingPublicOpinion = true;
        runtime.publicOpinionStatus = {
            phase: 'queued',
            message: '世界主线还在推演～舆情先排到后面，等核心状态追上就自动继续 `(•̀ᴗ•́)و`',
            error: '',
        };
        runtime.ui?.render();
        return null;
    }

    runtime.publicOpinionStatus = {
        phase: 'running',
        message: '正在检查世界变化～',
        error: '',
    };
    runtime.ui?.render();

    // 先把已经公开的世界事件对人物/行业/地点造成的真实后果接进后台。
    // 新闻是公共传播节点，不是孤立的 UI 卡片。
    if (settlePublicImpact && pendingPublicImpactEvents(getState(), { maximum: 8 }).length) {
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: '正在结算公开事件带来的世界影响～',
            error: '',
        };
        runtime.ui?.render();
        try {
            await runPublicImpactPropagation({ quiet: true, force: true });
        } catch (error) {
            if (!isAbortError(error)) {
                console.warn('[世界背面] 刷新舆情前的公共影响传播失败，将沿用上一份已确认状态', error);
            }
        }
    }

    let state = getState();
    let candidates = eligiblePublicOpinionEvents(state);

    if (
        ensurePublicWorld
        && getSettings().worldSimulationEnabled
        && publicWorldNeedsRefresh(state, candidates)
    ) {
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: '让公共世界巡一圈～看看这一时段又发生了什么',
            error: '',
        };
        runtime.ui?.render();

        await runWorldPulseTick({
            reason: '用户手动刷新真实世界舆情',
            quiet: true,
            force: true,
            publicCycle: true,
        });

        // 公共世界循环可能产生会波及人物/组织的新事件，新闻出现前先把后果结算。
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: '正在把新的公共变化接回人物和世界状态～',
            error: '',
        };
        runtime.ui?.render();
        await runPublicImpactPropagation({ quiet: true, force: true });
        state = getState();
        candidates = eligiblePublicOpinionEvents(state);
    }

    if (currentChatToken() !== chatTokenAtStart) return null;

    const store = getStore();
    const previousCache = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
    const plan = planPublicOpinionRefresh(state, previousCache, { force });
    const sourceRevision = Number(state.revision || 0);
    const sourceAssistantStamp = latestAssistantSourceStamp();
    const sourceWorldMinute = Number(state.clock?.absoluteMinute ?? -1);
    const sourceEventSignature = plan.sourceEventSignature;
    const generatedAt = new Date().toISOString();

    if (!candidates.length) {
        // Refresh is atomic from the UI's point of view: keep the current rolling
        // feed until a newer valid snapshot exists. "No new public event" is not
        // equivalent to "erase yesterday's world".
        const currentFeed = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
        runtime.publicOpinionStatus = {
            phase: 'success',
            message: ensurePublicWorld
                ? '公共世界检查完成～这次没有新的可报道变化，当前新闻继续保留。'
                : '当前没有新的公开世界事件～已有新闻继续保留。',
            error: '',
        };
        runtime.ui?.render();
        return currentFeed;
    }

    if (!plan.due) {
        runtime.pendingPublicOpinion = false;
        runtime.publicOpinionStatus = {
            phase: 'success',
            message: '检查过啦～公开来源没有新变化，世界时间也还没走到下一次舆情/新闻演化节点。',
            error: '',
        };
        runtime.ui?.render();
        return previousCache;
    }

    const controller = new AbortController();
    const activePublicOpinion = {
        controller,
        chatToken: chatTokenAtStart,
        sourceRevision,
        assistantStamp: sourceAssistantStamp,
    };
    runtime.activePublicOpinion = activePublicOpinion;
    runtime.pendingPublicOpinion = false;
    runtime.publicOpinionStatus = {
        phase: 'running',
        message: '正在整理新闻和讨论～',
        error: '',
    };
    runtime.ui?.render();

    const prompt = buildPublicOpinionPrompt(state, {
        clockLabel: formatWorldCalendar(state)?.stamp || '',
        previousCache,
        forumElapsedMinutes: Number.isFinite(plan.forumElapsed) ? plan.forumElapsed : 0,
        newsElapsedMinutes: Number.isFinite(plan.newsElapsed) ? plan.newsElapsed : 0,
        allowNews: plan.allowNews,
        allowForums: plan.allowForums,
        reason: plan.reason,
    });
    const settings = getSettings();
    const baseTokens = 3600;

    try {
        const raw = await runWithRetries(
            () => backgroundSimulation(prompt, {
                maxTokens: baseTokens,
                temperature: 0.65,
                taskKind: 'public-opinion',
                rejectTruncated: true,
                signal: controller.signal,
            }),
            {
                retries: Math.min(1, settings.autoRetryCount),
                delayMs: 650,
                shouldRetry: error => rateLimitLike(error)
                    || error?.code === 'GENERATION_TIMEOUT'
                    || error?.errorType === 'timeout'
                    || /JSON|截断|长度上限|empty|No message generated|没有返回最终正文/i.test(String(error?.message || error || '')),
                onRetry: ({ delayMs, rateLimited }) => {
                    if (rateLimited) {
                        runtime.publicOpinionStatus = {
                            phase: 'running',
                            message: `舆情路线限流中～冷却 ${cooldownSeconds(delayMs)} 秒后只继续这一份刷新`,
                            error: '不会自动改开“随便逛逛”，也不会并发重建任务。',
                        };
                        runtime.ui?.render();
                    }
                },
                ...retryTaskOptions(
                    'public-opinion',
                    `public-opinion:${chatTokenAtStart}:${sourceEventSignature}:${sourceAssistantStamp}`,
                ),
                signal: controller.signal,
            },
        );
        const parsed = extractJsonObject(raw);
        if (!parsed) throw new Error('舆情接口没有返回可解析的 JSON');
        if (controller.signal.aborted) {
            const error = new Error('舆情任务已取消');
            error.name = 'AbortError';
            throw error;
        }

        const latestOpinionState = getState();
        const stale = (
            currentChatToken() !== chatTokenAtStart
            || publicOpinionEventSignature(latestOpinionState) !== sourceEventSignature
            || Number(latestOpinionState.clock?.absoluteMinute ?? -1) !== sourceWorldMinute
            || latestAssistantSourceStamp() !== sourceAssistantStamp
        );
        if (stale) {
            runtime.pendingPublicOpinion = currentChatToken() === chatTokenAtStart;
            runtime.publicOpinionStatus = {
                phase: 'pending',
                message: '世界刚刚又往前走了一步～当前新闻先留着，正在接最新一版 `(｡•̀ᴗ-)✧`',
                error: '',
            };
            runtime.ui?.render();
            scheduleDeferredPublicOpinion(260);
            return null;
        }

        let generatedCache = normalizePublicOpinionPayload(parsed, {
            validEventIds: candidates.map(item => item.id),
            eventVisibilityById: Object.fromEntries(candidates.map(item => [item.id, item.visibility])),
            eventPublicityById: Object.fromEntries(candidates.map(item => [item.id, item.publicity])),
            sourceRevision: state.revision,
            sourceWorldMinute,
            sourceEventSignature,
            forumSourceSignature: plan.forumSourceSignature,
            newsSourceSignature: plan.newsSourceSignature,
            generatedAt,
            lastForumWorldMinute: plan.allowForums
                ? sourceWorldMinute
                : previousCache.lastForumWorldMinute,
            lastNewsWorldMinute: plan.allowNews
                ? sourceWorldMinute
                : previousCache.lastNewsWorldMinute,
        });
        // 代码层再做一次硬门禁：即使模型无视 allow_*，没到新闻/讨论节点的类别
        // 也不会被写入。空数组是合法的“检查后无需变化”，不是生成失败。
        generatedCache = {
            ...generatedCache,
            news: plan.allowNews
                ? generatedCache.news.map(item => ({ ...item, worldSynced: true }))
                : [],
            forums: plan.allowForums ? generatedCache.forums : [],
        };
        // AI 的后续报道已经过本轮时间门槛和公开事实回查，这里直接进入滚动流。
        // 不再拿事件最初的 publicHeadline/publicSummary 覆盖它，否则新闻永远无法演化。
        const latestSnapshot = generatedCache;
        const latestStore = getStore();
        const cache = mergePublicOpinionStream(
            latestStore.publicOpinion || emptyPublicOpinionCache(),
            latestSnapshot,
            {
                maximumNews: 18,
                maximumForums: 12,
            },
        );
        cache.sourceWorldMinute = sourceWorldMinute;
        cache.sourceEventSignature = sourceEventSignature;
        cache.forumSourceSignature = plan.allowForums
            ? plan.forumSourceSignature
            : previousCache.forumSourceSignature;
        cache.newsSourceSignature = plan.allowNews
            ? plan.newsSourceSignature
            : previousCache.newsSourceSignature;
        cache.lastForumWorldMinute = plan.allowForums
            ? sourceWorldMinute
            : previousCache.lastForumWorldMinute;
        cache.lastNewsWorldMinute = plan.allowNews
            ? sourceWorldMinute
            : previousCache.lastNewsWorldMinute;
        latestStore.publicOpinion = cache;
        latestStore.publicOpinionListHidden = false;
        saveStore(latestStore);
        refreshInjection();
        if (!cache.news.length && !cache.forums.length) {
            runtime.publicOpinionStatus = {
                phase: 'success',
                message: '这轮没有形成新的可展示舆情～',
                error: '',
            };
            runtime.ui?.render();
            return cache;
        }
        runtime.publicOpinionStatus = {
            phase: 'success',
            message: `已接上最新世界动态 · 当前 ${cache.news.length} 条新闻 · ${cache.forums.length} 个论坛话题`,
            error: '',
        };
        runtime.ui?.render();
        return cache;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
            if (currentChatToken() === chatTokenAtStart) {
                runtime.pendingPublicOpinion = true;
                runtime.publicOpinionStatus = {
                    phase: 'queued',
                    message: '新正文抢先到啦～旧舆情先停掉，等世界推演追上后再看新的',
                    error: '',
                };
                runtime.ui?.render();
                scheduleDeferredPublicOpinion(260);
            }
            return null;
        }
        if (currentChatToken() === chatTokenAtStart) {
            runtime.publicOpinionStatus = {
                phase: 'error',
                message: '舆情这次没扒完 QAQ',
                error: describeError(error),
            };
            runtime.ui?.render();
        }
        throw error;
    } finally {
        if (runtime.activePublicOpinion === activePublicOpinion) {
            runtime.activePublicOpinion = null;
        }
    }
}

async function generatePublicOpinionSandbox() {
    const existing = runtime.activePublicOpinionSandbox;
    if (existing?.promise && !existing.controller?.signal?.aborted) {
        return existing.promise;
    }

    const chatTokenAtStart = currentChatToken();
    const state = getState();
    const controller = new AbortController();
    const activeSandbox = {
        controller,
        chatToken: chatTokenAtStart,
        promise: null,
    };
    runtime.activePublicOpinionSandbox = activeSandbox;
    const generatedAt = new Date().toISOString();
    runtime.publicOpinionSandboxStatus = {
        phase: 'running',
        message: '正在街上随便逛逛～看看今天有什么无关紧要的小热闹 `(ﾉ◕ヮ◕)ﾉ`',
        error: '',
    };
    runtime.ui?.render();

    const promise = (async () => {
        try {
            const prompt = buildPublicOpinionSandboxPrompt(state, {
                clockLabel: formatWorldCalendar(state)?.stamp || '',
            });
            const settings = getSettings();
            const sandbox = await runWithRetries(
                async () => {
                    const raw = await backgroundSimulation(prompt, {
                        maxTokens: 2800,
                        temperature: 0.9,
                        taskKind: 'public-opinion-sandbox',
                        rejectTruncated: true,
                        signal: controller.signal,
                    });
                    const parsed = extractJsonObject(raw);
                    if (!parsed) throw new Error('闲逛舆情没有返回可解析的 JSON');
                    const normalized = normalizePublicOpinionSandboxPayload(parsed, { generatedAt });
                    if (!normalized.news.length && !normalized.forums.length) {
                        throw new Error('闲逛舆情返回了空内容');
                    }
                    return normalized;
                },
                {
                    retries: Math.min(1, settings.autoRetryCount),
                    delayMs: 520,
                    shouldRetry: error => rateLimitLike(error)
                        || error?.code === 'GENERATION_TIMEOUT'
                        || error?.errorType === 'timeout'
                        || /JSON|空内容|截断|长度上限|empty|No message generated/i.test(String(error?.message || error || '')),
                    ...retryTaskOptions(
                        'public-opinion-sandbox',
                        `public-opinion-sandbox:${chatTokenAtStart}:${state.revision}:${generatedAt}`,
                    ),
                    signal: controller.signal,
                },
            );

            if (currentChatToken() !== chatTokenAtStart) return null;
            const store = getStore();
            store.publicOpinionSandbox = sandbox;
            saveStore(store);
            runtime.publicOpinionSandboxStatus = {
                phase: 'success',
                message: `随便逛到 ${sandbox.news.length} 条小新闻 · ${sandbox.forums.length} 个闲聊话题～这些都不算正史哦`,
                error: '',
            };
            runtime.ui?.render();
            return sandbox;
        } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) {
                if (currentChatToken() === chatTokenAtStart) {
                    runtime.publicOpinionSandboxStatus = {
                        phase: 'idle',
                        message: '闲逛先收摊啦～下次想看小热闹再点我 `(｡•̀ᴗ-)✧`',
                        error: '',
                    };
                    runtime.ui?.render();
                }
                return null;
            }
            if (currentChatToken() === chatTokenAtStart) {
                runtime.publicOpinionSandboxStatus = {
                    phase: 'error',
                    message: '今天闲逛没逛出东西 QAQ',
                    error: describeError(error),
                };
                runtime.ui?.render();
            }
            throw error;
        } finally {
            if (runtime.activePublicOpinionSandbox === activeSandbox) {
                runtime.activePublicOpinionSandbox = null;
            }
            runtime.ui?.render();
        }
    })();

    activeSandbox.promise = promise;
    return promise;
}

function clearPublicOpinionSandbox() {
    runtime.activePublicOpinionSandbox?.controller?.abort?.();
    runtime.activePublicOpinionSandbox = null;
    const store = getStore();
    store.publicOpinionSandbox = emptyPublicOpinionSandbox();
    saveStore(store);
    runtime.publicOpinionSandboxStatus = { phase: 'idle', message: '闲逛小报收起来啦～', error: '' };
    runtime.ui?.render();
    return true;
}

function clearPublicOpinionSnapshot() {
    runtime.activePublicOpinion?.controller?.abort?.();
    runtime.activePublicOpinion = null;
    runtime.pendingPublicOpinion = false;
    const store = getStore();
    store.publicOpinion = emptyPublicOpinionCache();
    store.publicOpinionListHidden = true;
    saveStore(store);
    refreshInjection();
    runtime.publicOpinionStatus = {
        phase: 'idle',
        message: '舆情列表收起来啦～世界事实和已经发生的影响还在原地 (｡•̀ᴗ-)✧',
        error: '',
    };
    runtime.ui?.render();
    return true;
}

function recentRawAssistantTexts(count = 1) {
    const chat = getContext()?.chat || [];
    const limit = Math.max(1, Math.min(20, Number(count) || 1));
    const result = [];
    for (let index = chat.length - 1; index >= 0 && result.length < limit; index -= 1) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const swipeId = Number(message.swipe_id ?? 0);
        const text = String(message.swipes?.[swipeId] ?? message.mes ?? '');
        if (!text.trim()) continue;
        result.unshift(text);
    }
    return result;
}

async function handleUiAction(action, payload = {}) {
    if (action === 'undo-manual') {
        undoManualChange();
        return;
    }

    if (action === 'create-recovery-point') {
        return createManualRecoveryPoint();
    }

    if (action === 'restore-latest-recovery') {
        return restoreLatestSavedRecovery();
    }

    if (action === 'copy-diagnostics') {
        return copyDiagnosticReport();
    }

    if (action === 'preview-notice') {
        toast('之后的保存、恢复、推演和报错都会用这样的提示告诉你。', 'success');
        return null;
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
        if (payload.publicOpinionAutoEnabled === false) {
            runtime.pendingPublicOpinion = false;
        }
        context.extensionSettings[MODULE_ID] = settings;
        saveSettings();
        refreshInjection();
        syncSettingsEntry();
        runtime.ui?.render();
        if (payload.publicOpinionAutoEnabled === true) {
            scheduleAutoPublicOpinion(getState(), 120);
        }
        if (
            (payload.worldAutoEnabled === true)
            || (payload.autoSimulationMode && getSettings().worldAutoEnabled)
        ) {
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

    if (action === 'save-api-profile') {
        return saveApiProfile(payload);
    }

    if (action === 'delete-api-profile') {
        return deleteApiProfile(payload.profileId);
    }

    if (action === 'duplicate-api-profile') {
        return duplicateApiProfile(payload.profileId);
    }

    if (action === 'test-api-profile') {
        return await testApiProfileConnection(payload.profileId);
    }

    if (action === 'pull-api-profile-models') {
        return await pullApiProfileModels(payload.profileId);
    }

    if (action === 'test-api-draft') {
        return await testApiDraftConnection(payload);
    }

    if (action === 'pull-api-draft-models') {
        return await pullApiDraftModels(payload);
    }

    if (action === 'scan-history') {
        return scanStoryMemoryHistory();
    }

    if (action === 'bootstrap-history') {
        return bootstrapWorldFromHistory();
    }

    if (action === 'generate-public-opinion-sandbox') {
        return generatePublicOpinionSandbox();
    }

    if (action === 'clear-public-opinion-sandbox') {
        return clearPublicOpinionSandbox();
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

    if (action === 'save-world-summary') {
        const title = String(payload.title || '').trim();
        const detail = String(payload.detail || '').trim();
        const background = String(payload.background || '').trim();
        if (!title || !detail) throw new Error('世界标题和概况不能为空');
        const next = clone(getState());
        next.world ||= {};
        next.world.title = title.slice(0, 140);
        next.world.detail = detail.slice(0, 900);
        next.world.background = background.slice(0, 5000);
        commitManualState(
            next,
            background
                ? '世界概况和背景设定已经更新啦～'
                : '世界概况已经更新；背景设定保持为空。',
        );
        return next.world;
    }

    if (action === 'save-record') {
        const kind = payload.kind === 'archive' ? 'archive' : 'echo';
        const id = String(payload.id || '');
        const title = String(payload.title || '').trim();
        const text = String(payload.text || '').trim();
        if (!title || !text) throw new Error('标题和内容不能为空');
        const next = clone(getState());
        const visibility = ['hidden', 'trace', 'known', 'direct'].includes(payload.visibility)
            ? payload.visibility
            : 'hidden';

        if (kind === 'echo') {
            const event = next.events.find(item => item.id === id);
            if (!event) throw new Error('没有找到这条回声');
            event.title = title.slice(0, 140);
            event.result = text.slice(0, 900);
            event.consequence = event.result;
            event.place = String(payload.place || event.place || '').trim().slice(0, 160);
            event.visibility = visibility;
            event.delivery ||= { state: 'none' };
            event.delivery.state = ['none', 'pending', 'delivered', 'expired'].includes(payload.deliveryState)
                ? payload.deliveryState
                : event.delivery.state;
            event.updatedAt = next.clock.absoluteMinute;
            for (const echo of next.echoes || []) {
                if (echo.eventId !== event.id) continue;
                echo.title = event.title;
                echo.route = event.result;
            }
            for (const entry of next.archive || []) {
                if (entry.eventId !== event.id) continue;
                entry.title = event.title;
                entry.text = event.result;
                entry.visibility = event.visibility;
                entry.deliveryState = event.delivery.state;
            }
            commitManualState(next, `回声“${event.title}”已经更新。`);
            return event;
        }

        const entry = next.archive.find(item => item.id === id);
        if (!entry) throw new Error('没有找到这条纪事');
        entry.title = title.slice(0, 140);
        entry.text = text.slice(0, 900);
        entry.visibility = visibility;
        entry.manual = true;
        commitManualState(next, `纪事“${entry.title}”已经更新。`);
        return entry;
    }

    if (action === 'delete-record') {
        const kind = payload.kind === 'archive' ? 'archive' : 'echo';
        const id = String(payload.id || '');
        const next = clone(getState());
        if (kind === 'echo') {
            const index = next.events.findIndex(item => item.id === id);
            if (index < 0) throw new Error('没有找到这条回声');
            const [removed] = next.events.splice(index, 1);
            next.echoes = (next.echoes || []).filter(item => item.eventId !== removed.id);
            next.archive = (next.archive || []).filter(item => item.eventId !== removed.id);
            commitManualState(next, `回声“${removed.title}”已经删除。`);
            return;
        }
        const index = next.archive.findIndex(item => item.id === id);
        if (index < 0) throw new Error('没有找到这条纪事');
        const [removed] = next.archive.splice(index, 1);
        commitManualState(next, `纪事“${removed.title || '未命名记录'}”已经删除。`);
        return;
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
                level: existing?.level ?? 1,
                hierarchyManaged: existing?.hierarchyManaged ?? false,
                parentId: existing?.parentId || '',
                sourceSummaryIds: existing?.sourceSummaryIds || [],
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

    if (action === 'bulk-delete-memory') {
        const requested = Array.isArray(payload.items) ? payload.items : [];
        const unique = new Map();
        for (const item of requested) {
            const kind = ['fact', 'clue', 'summary'].includes(item?.kind) ? item.kind : '';
            const id = String(item?.id || '').trim();
            if (!kind || !id) continue;
            unique.set(`${kind}:${id}`, { kind, id });
        }
        if (!unique.size) throw new Error('没有选中可删除的记忆');

        // Bulk deletion is intentionally safer than a normal one-card delete:
        // create a durable recovery point before touching the memory pool.
        let store = addRecoveryPoint(getStore(), {
            reason: 'before-memory-bulk-delete',
            label: `批量清理 ${unique.size} 条记忆前自动保存`,
        });
        saveStore(store, { immediate: true });

        const next = clone(store.currentState);
        next.storyMemory ||= { facts: [], clues: [], summaries: [] };
        const removedSummaryIds = new Set();
        let removed = 0;
        let lockedSkipped = 0;

        for (const { kind, id } of unique.values()) {
            const collection = kind === 'fact'
                ? next.storyMemory.facts
                : kind === 'clue'
                    ? next.storyMemory.clues
                    : next.storyMemory.summaries;
            const index = collection.findIndex(entry => entry.id === id);
            if (index < 0) continue;
            if (collection[index].locked) {
                lockedSkipped += 1;
                continue;
            }
            if (kind === 'summary') removedSummaryIds.add(collection[index].id);
            collection.splice(index, 1);
            removed += 1;
        }

        if (removedSummaryIds.size) {
            for (const summary of next.storyMemory.summaries || []) {
                if (removedSummaryIds.has(summary.parentId)) summary.parentId = '';
                if (Array.isArray(summary.sourceSummaryIds)) {
                    summary.sourceSummaryIds = summary.sourceSummaryIds.filter(
                        id => !removedSummaryIds.has(id),
                    );
                }
            }
            // The chat-level summary reservoir must forget manually deleted
            // summaries too, otherwise restoring a compact branch could resurrect them.
            store.memorySummaryArchive = (store.memorySummaryArchive || []).filter(
                summary => !removedSummaryIds.has(summary?.id),
            );
            saveStore(store, { immediate: true });
        }

        if (!removed) {
            throw new Error(lockedSkipped
                ? '选中的记忆都处于锁定状态，没有删除任何内容'
                : '没有找到这些记忆，它们可能已经被整理掉了');
        }

        commitManualState(
            next,
            lockedSkipped
                ? `已删除 ${removed} 条记忆，${lockedSkipped} 条锁定记忆乖乖留着～`
                : `已删除 ${removed} 条记忆；删除前的恢复点已经存好啦～`,
        );
        return true;
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
        const removed = collection[index];
        if (kind === 'summary') {
            const summaries = next.storyMemory?.summaries || [];
            for (const summary of summaries) {
                if (summary.parentId === removed.id) summary.parentId = '';
                if (Array.isArray(summary.sourceSummaryIds) && summary.sourceSummaryIds.includes(removed.id)) {
                    summary.sourceSummaryIds = summary.sourceSummaryIds.filter(id => id !== removed.id);
                }
            }
        }
        collection.splice(index, 1);
        if (kind === 'summary') {
            const store = getStore();
            store.memorySummaryArchive = (store.memorySummaryArchive || []).filter(
                summary => summary?.id !== removed.id,
            );
            saveStore(store);
        }
        commitManualState(next, '记忆已经删除。');
        return;
    }

    if (action === 'save-manual-person') {
        const id = String(payload.id || '');
        const originalName = String(payload.originalName || '').trim();
        const name = String(payload.name || '').trim();
        if (!name) throw new Error('人物姓名不能为空');
        const next = clone(getState());
        const existing = next.people.find(person => (
            person.id === id
            && (!originalName || person.name === originalName)
        )) || next.people.find(person => person.id === id);
        if (existing?.locked && payload.locked === false) {
            throw new Error('请先解锁人物卡，再修改核心设定');
        }
        const person = {
            ...(existing || {}),
            id: existing?.id || `person_manual_${hashText(`${name}\n${Date.now()}`)}`,
            name: name.slice(0, 80),
            monogram: name.slice(0, 1),
            avatarDataUrl: payload.avatarDataUrl === null || payload.avatarDataUrl === undefined
                ? String(existing?.avatarDataUrl || '')
                : String(payload.avatarDataUrl || '').slice(0, 180000),
            location: String(payload.location || '位置待确认').trim().slice(0, 160),
            action: String(payload.action || '当前行动待确认').trim().slice(0, 280),
            intent: String(payload.intent || '短期意图待确认').trim().slice(0, 320),
            longTermGoal: String(payload.longTermGoal || '').trim().slice(0, 420),
            innerVoice: String(payload.innerVoice ?? existing?.innerVoice ?? '').trim().slice(0, 240),
            innerVoiceAt: next.clock.absoluteMinute,
            identityAnchor: String(payload.identityAnchor || '').trim().slice(0, 500),
            personalityAnchor: String(payload.personalityAnchor || '').trim().slice(0, 600),
            appearanceProfile: String(payload.appearanceProfile || '').trim().slice(0, 700),
            backgroundProfile: String(payload.backgroundProfile || '').trim().slice(0, 900),
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
        const reconciled = settlePersonWorldState(next, person.id, { source: 'manual' });
        commitManualState(reconciled, existing ? '后台人物卡已经更新。' : `已将 ${person.name} 加入后台人物。`);
        return person;
    }

    if (action === 'clear-person-avatar') {
        const next = clone(getState());
        const person = next.people.find(item => item.id === String(payload.id || ''));
        if (!person) throw new Error('没有找到这个人物');
        person.avatarDataUrl = '';
        person.updatedAt = next.clock.absoluteMinute;
        commitManualState(next, '人物头像已经恢复成文字头像啦～');
        return true;
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

    if (action === 'sync-clock-from-story') {
        const latest = latestAssistantEntry();
        if (!latest?.message) {
            toast('未识别正文时间。', 'warning');
            return false;
        }
        const anchor = extractNarrativeTimeAnchor(selectedMessageText(latest.message));
        if (!anchor) {
            toast('未识别正文时间。', 'warning');
            return false;
        }

        const current = getState();
        const clock = formatWorldCalendar(current);
        const hasDate = Number.isFinite(anchor.year) && Number.isFinite(anchor.month) && Number.isFinite(anchor.day);
        const hasMinute = Number.isFinite(anchor.hour) && Number.isFinite(anchor.minute);
        const next = setWorldCalendar(current, {
            calendarName: clock.calendarName,
            year: hasDate ? anchor.year : clock.year,
            month: hasDate ? anchor.month : clock.month,
            day: hasDate ? anchor.day : clock.dayOfMonth,
            hour: hasMinute ? anchor.hour : clock.hour,
            minute: hasMinute ? anchor.minute : clock.minute,
            reason: `与最新正文校准${anchor.excerpt ? `：${anchor.excerpt}` : ''}`,
        });
        next.clock.precision = hasMinute ? 'minute' : (anchor.daypart ? 'daypart' : 'date');
        next.clock.source = 'narrative-manual-sync';
        next.clock.reason = `手动与最新正文校准${anchor.excerpt ? `：${anchor.excerpt}` : ''}`.slice(0, 240);
        commitManualState(
            next,
            hasDate && hasMinute
                ? `已与正文校准至 ${anchor.year}年${anchor.month}月${anchor.day}日 ${String(anchor.hour).padStart(2, '0')}:${String(anchor.minute).padStart(2, '0')}。`
                : hasDate
                    ? `已同步正文日期：${anchor.year}年${anchor.month}月${anchor.day}日${anchor.daypart ? ` · ${anchor.daypart}` : ''}；正文未给出精确钟点，保留当前时分。`
                    : `已同步正文钟点：${String(anchor.hour).padStart(2, '0')}:${String(anchor.minute).padStart(2, '0')}。`,
        );
        return true;
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
        if (minutes > 0 && getSettings().worldAutoEnabled && getSettings().worldSimulationEnabled) {
            window.setTimeout(() => {
                void runWorldPulseTick({
                    reason: `用户手动推进主世界时间 ${minutes} 分钟`,
                });
            }, 80);
        }
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

    if (action === 'update-event') {
        const eventId = String(payload.id || payload.eventId || '');
        const title = String(payload.title || '').trim();
        if (!title) throw new Error('事件名称不能为空');

        const next = clone(getState());
        const event = next.events.find(item => item.id === eventId);
        if (!event) throw new Error('没有找到这条暗流');
        if (['resolved', 'cancelled', 'missed'].includes(event.status)) {
            throw new Error('已经形成结果的事件请在“回声”中查看，不能再作为暗流修改');
        }

        const previousClockMode = event.clockMode;
        const previousDuration = Number(event.durationMinutes) || 0;
        const clockMode = ['duration', 'active', 'scheduled', 'condition'].includes(payload.clockMode)
            ? payload.clockMode
            : event.clockMode;
        const durationHours = Math.max(0, Number(payload.durationHours) || 0);
        const durationMinutes = Math.round(durationHours * 60);
        const timingChanged = previousClockMode !== clockMode || previousDuration !== durationMinutes;

        event.title = title.slice(0, 140);
        event.place = String(payload.place || '地点待确认').trim().slice(0, 140) || '地点待确认';
        event.summary = String(payload.summary || '').trim().slice(0, 420);
        event.expectedResult = String(payload.expectedResult || '').trim().slice(0, 420);
        event.consequence = event.expectedResult;
        event.visibility = ['hidden', 'trace', 'known', 'direct'].includes(payload.visibility)
            ? payload.visibility
            : event.visibility;
        event.clockMode = clockMode;
        event.durationMinutes = durationMinutes;

        if (timingChanged) {
            if (clockMode === 'duration' || clockMode === 'scheduled') {
                event.dueAt = Number(event.startedAt || next.clock.absoluteMinute) + durationMinutes;
                event.accruedMinutes = 0;
                if (event.dueAt <= next.clock.absoluteMinute) {
                    event.status = 'ready';
                } else if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            } else if (clockMode === 'active') {
                event.dueAt = null;
                event.accruedMinutes = Math.min(Number(event.accruedMinutes) || 0, durationMinutes || Number.MAX_SAFE_INTEGER);
                if (durationMinutes > 0 && event.accruedMinutes >= durationMinutes) {
                    event.status = 'ready';
                } else if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            } else {
                event.dueAt = null;
                event.accruedMinutes = 0;
                if (event.status === 'ready') {
                    event.status = 'active';
                    event.result = '';
                }
            }
        }

        event.updatedAt = next.clock.absoluteMinute;
        event.resolvedAt = null;
        commitManualState(next, `暗流“${event.title}”已经更新。`);
        return event;
    }

    if (action === 'delete-event') {
        const eventId = String(payload.eventId || payload.id || '');
        const next = clone(getState());
        const index = next.events.findIndex(item => item.id === eventId);
        if (index < 0) throw new Error('没有找到这条暗流');
        const [removed] = next.events.splice(index, 1);
        next.echoes = (next.echoes || []).filter(echo => echo.eventId !== eventId);
        commitManualState(next, `暗流“${removed.title}”已经删除。`);
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

    if (action === 'generate-public-opinion') {
        return await generatePublicOpinionSnapshot({
            allowDefer: true,
            // “立即检查舆情”只检查传播层，不借按钮强制推进公共世界或结算世界状态。
            ensurePublicWorld: false,
            settlePublicImpact: false,
            force: true,
        });
    }

    if (action === 'clear-public-opinion') {
        return clearPublicOpinionSnapshot();
    }

    if (action === 'scan-tag-candidates') {
        const texts = recentRawAssistantTexts(payload.count || 1);
        return extractTagFilterCandidates(texts, getSettings().tagFilterRules || []);
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
                    <span>启用世界背面</span>
                </label>
                <label class="checkbox_label">
                    <input id="world-backstage-orb-enabled" type="checkbox">
                    <span>显示悬浮球</span>
                </label>
                <p class="notes">镜头没照到的地方也会继续过日子～时间、人物和事件都会自己往前走 (｡•̀ᴗ-)✧</p>
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
    entry.querySelector('#world-backstage-orb-enabled')?.addEventListener('change', event => {
        void handleUiAction('update-settings', { orbEnabled: event.target.checked });
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
    const settings = getSettings();
    const checkbox = document.getElementById('world-backstage-enabled');
    if (checkbox) checkbox.checked = settings.enabled;
    const orbCheckbox = document.getElementById('world-backstage-orb-enabled');
    if (orbCheckbox) orbCheckbox.checked = settings.orbEnabled !== false;
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
        pluginVersion: PLUGIN_VERSION,
    });

    installSettingsEntry();
    registerEvents();
    registerDebugCheck();
    restoreLatestBranch();
    console.info('[世界背面] 世界状态引擎已加载');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}
