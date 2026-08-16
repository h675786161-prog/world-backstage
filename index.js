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
    buildStateCorrectionPrompt,
    applyStateCorrectionResult,
    createInitialState,
    createCompactSnapshot,
    DEFAULT_TAG_FILTER_RULES,
    extractJsonObject,
    extractTagFilterCandidates,
    extractNarrativeTimeAnchor,
    filterNarrativeText,
    formatWorldCalendar,
    formatWorldClockFactLabel,
    isPersonObservationEligible,
    countSurvivingNewAssistantTurns,
    hashText,
    selectPendingAssistantMessageIds,
    listRecoveryPoints,
    listDueBackgroundPeople,
    listRecoveryPointHeaders,
    markPendingSync,
    markCurrentPublicImpactsProcessed,
    markWorldCoverageChecked,
    pendingPublicImpactEvents,
    publicWorldCoverageDue,
    normalizeTagFilterRules,
    planMemoryRollup,
    recordDeliveryOffers,
    restoreCompactSnapshot,
    restoreRecoveryPoint,
    setWorldCalendar,
    settlePersonWorldState,
    selectWorldCoverageTargets,
    trimState,
} from './core.js';
import {
    getLastCustomApiOperation,
    getRetryControlStatus,
    isAbortError,
    requestCustomCompletion,
    requestCustomModels,
    requestImageGeneration,
    resetLastCustomApiOperation,
    resetRetryControl,
    runWithRetries,
} from './api.js';
import { createWorldBackstageUI } from './ui.js';
import {
    appendUserSocialMessage,
    applyFriendDecisionPayload,
    applyMomentsPayload,
    applySocialPulsePayload,
    applySocialReplyPayload,
    attachMomentImage,
    buildFriendRequestPrompt,
    buildMomentsPrompt,
    buildSocialPulsePrompt,
    buildSocialReplyPrompt,
    createGroupConversation,
    emptySocialState,
    markSocialNoticeRead,
    normalizeSocialState,
    openDirectConversation,
    reconcileSocialRelationships,
    removeSocialFriend,
    respondIncomingFriendRequest,
    selectSocialConversation,
    setSocialConversationError,
    toggleMomentLike,
} from './social-terminal.js';
import { buildBackstageMessages } from './prompt-bridge.js';
import { normalizeClueTiming, resolveFutureTimeExpression } from './world-clock-authority.js';
import { INTERNAL_COMPAT_SYSTEM_PROMPT } from './internal-compat.js';
import {
    detectWorldbookCharacter,
    detectWorldbookTechnicalEntry,
    extractWorldbookCharacterCandidates,
    extractWorldbookCharacterProfile,
    isWorldbookEntryManuallySelectable,
    planSmartWorldbookImport,
} from './worldbook.js';
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
import {
    activeLingqiNotes,
    addLingqiMessage,
    applyLingqiDirectorResult,
    buildLingqiChatPrompt,
    buildLingqiDirectorInjection,
    confirmLingqiProposal,
    consumeLingqiDirectorOffer,
    dismissLingqiProposal,
    emptyLingqiState,
    normalizeLingqiAssistantPayload,
    normalizeLingqiState,
    setLingqiNoteStatus,
    shouldAutoConfirmLingqiProposal,
} from './lingqi.js';
import {
    LINGQI_SAFE_SETTING_KEYS,
    buildLingqiHelpContext,
} from './lingqi-help.js';
import {
    findLingqiChatMatches,
    lingqiChatSnapshotSignature,
    parseLingqiLocalChatDeleteRequest,
    resolveLingqiChatDeletionPlan as buildLingqiChatDeletionPlan,
} from './lingqi-chat.js';
import {
    LINGQI_SETTING_GUIDES,
    buildLingqiSkillMenuText,
    parseLingqiLocalQueryRequest,
} from './lingqi-skills.js';
import { LINGQI_MASCOT_DATA_URLS } from './lingqi-assets.js';

const PROMPT_KEY = 'world_backstage_authoritative_state';
const SUPPORT_PROMPT_KEY = 'world_backstage_context_support';
const PLUGIN_VERSION = '2.5.0';
const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 30,
    enabled: true,
    promptInjection: true,
    worldSimulationEnabled: true,
    worldPromptInjection: true,
    injectionTimeMode: 'full',
    injectionWorldBackground: true,
    injectionPeople: true,
    injectionEvents: true,
    injectionEchoes: true,
    injectionFacts: true,
    injectionMemory: true,
    injectionPublicOpinion: true,
    // Social messages are conversation records, not settled world facts.
    // Keep narrative influence opt-in even when the main injection switch is on.
    injectionSocial: false,
    socialAutoEnabled: true,
    memorySystemEnabled: true,
    memoryPromptInjection: true,
    autoSync: true,
    worldAutoEnabled: true,
    autoSimulationMode: 'balanced',
    worldPulseActivity: 'natural',
    autoSimulationInterval: 1,
    pendingSimulationPromptEnabled: false,
    autoRetryCount: 1,
    memoryAutoIndexInterval: 10,
    backgroundNpcBudget: 4,
    enhancedBackgroundSimulation: false,
    customSimulationInstruction: '',
    playerIdentityAnchor: '',
    theme: 'auto',
    deliveryDensity: 'restrained',
    sceneTiming: 'strict',
    orbPosition: null,
    orbEnabled: true,
    orbEdgeHide: false,
    recordPlayerCharacter: true,
    includeUserInnerVoice: false,
    uiScale: 'comfortable',
    contextTurns: 5,
    customContextTurns: 8,
    timePolicy: 'world',
    apiMode: 'tavern',
    tavernApiProfileId: '',
    customApiUrl: '',
    customApiKey: '',
    customApiModel: '',
    customApiTransport: 'proxy',
    customApiTimeoutMs: 120000,
    imageApiEnabled: false,
    imageApiUrl: '',
    imageApiKey: '',
    imageApiModel: '',
    imageApiSize: '1024x1024',
    imageApiTimeoutMs: 180000,
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
    injection: { text: '', eventIds: [], directorNoteIds: [] },
    generationOffer: { eventIds: [], directorNoteIds: [], at: 0, rerollBase: false },
    simulationChain: Promise.resolve(),
    simulationCount: 0,
    dataEpoch: 0,
    activeSimulation: null,
    autoCatchUpSuppressedThroughMessageId: -1,
    activeHistoryScan: null,
    activeWorldPulse: null,
    activePublicImpact: null,
    activeCorrection: null,
    pendingPublicImpact: false,
    activePublicOpinion: null,
    publicOpinionRefreshTransaction: null,
    activePublicOpinionSandbox: null,
    pendingPublicOpinion: false,
    activeObservation: null,
    activeLingqi: null,
    lingqiStatus: { phase: 'idle', message: '', error: '' },
    activeSocial: null,
    socialStatus: { phase: 'idle', message: '', error: '', conversationId: '' },
    activeFriendRequest: null,
    friendRequestStatus: { phase: 'idle', message: '', error: '', personId: '' },
    activeMoments: null,
    momentsStatus: { phase: 'idle', message: '', error: '' },
    activeSocialPulse: null,
    socialPulseTimer: null,
    pendingLingqiAction: null,
    inBackgroundGeneration: false,
    consistencyBarrierRunning: false,
    activeChatToken: '',
    contextEpoch: 0,
    queuedSimulations: new Map(),
    connectionLanes: new Map(),
    apiRequestTimeline: [],
    pendingManualSimulation: null,
    manualSimulationTimer: null,
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

function recentAssistantNarrativeForSocial(context = getContext(), limit = 8) {
    return (Array.isArray(context?.chat) ? context.chat : [])
        .filter(message => !message?.is_user && !message?.is_system && String(message?.mes || '').trim())
        .slice(-Math.max(1, Number(limit) || 8))
        .map(message => String(message.mes || '').trim())
        .join('\n');
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
        const sourceEntries = Object.values(data?.entries || {})
            .filter(entry => entry && String(entry.content || '').trim())
            .map(entry => {
                const entryName = worldbookEntryLabel(entry);
                const content = String(entry.content || '').trim().slice(0, 12000);
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
                const profile = extractWorldbookCharacterProfile(content, entryName);
                const detection = detectWorldbookCharacter({
                    name: entryName,
                    content,
                    keys,
                    tags,
                    formatHints,
                }, profile);
                const technical = detectWorldbookTechnicalEntry({
                    name: entryName,
                    content,
                    keys,
                    tags,
                });
                const embedded = extractWorldbookCharacterCandidates({
                    name: entryName,
                    content,
                    keys,
                    tags,
                });

                return {
                    uid: String(entry.uid ?? ''),
                    name: entryName,
                    parsedName: profile.explicitName ? profile.name : '',
                    content,
                    keys,
                    tags,
                    formatHints,
                    disabled: Boolean(entry.disable),
                    order: Number(entry.order) || 0,
                    profile,
                    ...detection,
                    ...technical,
                    embedded,
                };
            })
            .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.order - a.order)
            .slice(0, 1000);

        const entries = [];
        for (const source of sourceEntries) {
            const embeddedPeople = source.embedded.filter(item => !item.technicalEntry);
            const shouldSplitEmbedded = embeddedPeople.length >= 2
                || (embeddedPeople.length === 1 && (!source.likelyPerson || source.technicalEntry));

            if (!shouldSplitEmbedded) {
                const importablePerson = Boolean(
                    source.likelyPerson
                    && !source.technicalEntry
                    && !source.disabled
                );
                entries.push({
                    ...source,
                    embedded: undefined,
                    importablePerson,
                    manualSelectablePerson: true,
                    smartAuto: importablePerson,
                    sourceUid: source.uid,
                    sourceEntryName: source.name,
                });
                continue;
            }

            // Keep the parent setting entry visible for context/search, but it is not a selectable person.
            entries.push({
                ...source,
                embedded: undefined,
                likelyPerson: false,
                importablePerson: false,
                manualSelectablePerson: false,
                smartAuto: false,
                mixedSource: true,
                sourceUid: source.uid,
                sourceEntryName: source.name,
                characterSignals: [
                    `内含 ${embeddedPeople.length} 个人物`,
                    ...(source.characterSignals || []),
                ].slice(0, 4),
            });

            embeddedPeople.forEach((candidate, index) => {
                const stableNameKey = hashText(candidate.name.toLocaleLowerCase());
                entries.push({
                    uid: `${source.uid}::person::${stableNameKey}`,
                    sourceUid: source.uid,
                    sourceEntryName: source.name,
                    name: candidate.name,
                    parsedName: candidate.name,
                    content: candidate.content,
                    keys: source.keys,
                    tags: [...new Set([...(source.tags || []), '条目内人物'])].slice(0, 8),
                    formatHints: source.formatHints,
                    disabled: source.disabled,
                    order: source.order - (index + 1) / 1000,
                    profile: candidate.profile,
                    likelyPerson: true,
                    importablePerson: true,
                    manualSelectablePerson: true,
                    smartAuto: candidate.confidence === 'high',
                    embeddedPerson: true,
                    characterScore: candidate.characterScore,
                    characterSignals: [
                        `从“${source.name}”里拆出`,
                        candidate.confidence === 'high' ? '人物信息较完整' : '人物信息需确认',
                    ],
                    technicalEntry: false,
                    technicalScore: 0,
                    technicalSignals: [],
                });
            });
        }

        const plan = planSmartWorldbookImport(entries);
        const embeddedCount = entries.filter(entry => entry.embeddedPerson).length;
        runtime.worldbookScan = {
            phase: 'success',
            message: entries.length
                ? [
                    `翻到 ${sourceEntries.length} 条世界书内容`,
                    `识别出 ${entries.filter(entry => entry.importablePerson).length} 个人物候选`,
                    embeddedCount ? `其中 ${embeddedCount} 个从混合条目里拆出来` : '',
                    plan.skippedTechnical.length ? `跳过 ${plan.skippedTechnical.length} 条技术/MVU内容` : '',
                ].filter(Boolean).join(' · ')
                : '这本世界书里暂时没翻到能读的内容哦～',
            bookName: name,
            entries,
            smartPlan: {
                autoCount: plan.auto.length,
                reviewCount: plan.review.length,
                skippedTechnicalCount: plan.skippedTechnical.length,
                skippedDisabledCount: plan.skippedDisabled.length,
            },
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
    const selected = runtime.worldbookScan.entries.filter(entry => (
        wanted.has(String(entry.uid))
        && isWorldbookEntryManuallySelectable(entry)
    ));
    if (!selected.length) throw new Error('请至少勾选一个人物条目');

    const next = clone(getState());
    let created = 0;
    let updated = 0;
    for (const candidate of selected) {
        const reference = `${name}::${candidate.uid}`;
        const sourceReference = `${name}::${candidate.sourceUid || candidate.uid}`;
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
            existing.worldbookSourceRef = sourceReference;
            existing.worldbookSourceEntry = candidate.sourceEntryName || candidate.name || '';
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
            worldbookSourceRef: sourceReference,
            worldbookSourceEntry: candidate.sourceEntryName || candidate.name || '',
            updatedAt: next.clock.absoluteMinute,
        });
        created += 1;
    }
    const importedPeople = next.people.filter(person => (
        person.worldbookRef
        && selected.some(candidate => `${name}::${candidate.uid}` === person.worldbookRef)
    ));
    commitManualState(
        next,
        `世界书人物已导入：新增 ${created} 人，更新 ${updated} 人。`,
        {
            mutateStore: store => {
                for (const person of importedPeople) clearPersonDeletionTombstone(store, person);
            },
        },
    );
    return { created, updated };
}

async function smartImportWorldbookPeople(bookName) {
    const name = String(bookName || '').trim();
    if (!name) throw new Error('先挑一本世界书给我看看嘛～');

    let scan = runtime.worldbookScan;
    if (scan.bookName !== name || scan.phase !== 'success' || !Array.isArray(scan.entries)) {
        scan = await scanWorldbook(name);
    }

    const plan = planSmartWorldbookImport(scan.entries);
    if (!plan.auto.length) {
        if (plan.review.length) {
            return {
                created: 0,
                updated: 0,
                reviewCount: plan.review.length,
                skippedTechnicalCount: plan.skippedTechnical.length,
                needsReview: true,
            };
        }
        throw new Error('这本世界书里暂时没识别到可以安全自动导入的人物');
    }

    const result = importWorldbookPeople(
        name,
        plan.auto.map(entry => entry.uid),
    );
    return {
        ...result,
        reviewCount: plan.review.length,
        skippedTechnicalCount: plan.skippedTechnical.length,
        importedCount: plan.auto.length,
    };
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
        if (/^tavern-profile:[^\s:][^\s]*$/.test(text)) return text.slice(0, 220);
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
    // Do not impose a product-level token ceiling. Providers/models may still
    // reject values above their own output/context capabilities.
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1000, numeric));
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
    // A task's requestedMaxTokens is only a sizing hint. In automatic mode the
    // plugin must not turn that hint into a hard response cap. Only an explicit
    // user-configured positive limit is sent as a token ceiling.
    const maxTokens = tokenCap > 0
        ? Math.max(64, Math.round(tokenCap))
        : 0;

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

function primarySimulationRequestBudget(settings, automaticBudget) {
    const moduleLimit = settings.generationModuleLimits?.simulation || {};
    const moduleBudget = Number(moduleLimit.maxTokens) > 0
        ? Number(moduleLimit.maxTokens)
        : 0;
    if (moduleBudget > 0) return moduleBudget;

    // 世界主推演的 0 = 继承，应该真的继承用户给的全局可用上限。
    // max_tokens 只是 ceiling；模型写完会自己停，不会被强迫吐满。
    const globalBudget = Number(settings.maxOutputTokens) > 0
        ? Number(settings.maxOutputTokens)
        : 0;
    if (globalBudget > 0) return globalBudget;

    return Math.max(64, Number.parseInt(automaticBudget, 10) || 2200);
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
    if (previousSettingsVersion < 26) {
        settings.injectionTimeMode = 'full';
        settings.injectionWorldBackground = true;
        settings.injectionPeople = true;
        settings.injectionEvents = true;
        settings.injectionEchoes = true;
        settings.injectionFacts = true;
        settings.injectionMemory = previous?.memoryPromptInjection !== false;
        settings.injectionPublicOpinion = true;
    }
    if (!['full', 'anchor', 'off'].includes(settings.injectionTimeMode)) {
        settings.injectionTimeMode = 'full';
    }
    settings.injectionWorldBackground = settings.injectionWorldBackground !== false;
    settings.injectionPeople = settings.injectionPeople !== false;
    settings.injectionEvents = settings.injectionEvents !== false;
    settings.injectionEchoes = settings.injectionEchoes !== false;
    settings.injectionFacts = settings.injectionFacts !== false;
    settings.injectionMemory = settings.injectionMemory !== false;
    settings.injectionPublicOpinion = settings.injectionPublicOpinion !== false;
    settings.injectionSocial = Boolean(settings.injectionSocial);
    settings.memorySystemEnabled = Boolean(settings.memorySystemEnabled);
    // Legacy alias retained for older exports; the actual injection switch is injectionMemory.
    settings.memoryPromptInjection = settings.injectionMemory;
    settings.autoSync = Boolean(settings.autoSync);
    settings.worldAutoEnabled = previousSettingsVersion < 19
        ? (
            previous?.worldAutoEnabled !== undefined
                ? Boolean(previous.worldAutoEnabled)
                : previous?.autoSync !== false && previous?.autoSimulationMode !== 'manual'
        )
        : settings.worldAutoEnabled !== false;
    settings.recordPlayerCharacter = previousSettingsVersion < 25
        ? (previous?.recordPlayerCharacter !== undefined
            ? Boolean(previous.recordPlayerCharacter)
            : true)
        : settings.recordPlayerCharacter !== false;
    // 1.7.3-dev.5 removes player inner-thought recording from the user-facing feature.
    // Player actions may be recorded when enabled, but inner_voice is always author-owned.
    settings.includeUserInnerVoice = false;
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
    settings.pendingSimulationPromptEnabled = Boolean(settings.pendingSimulationPromptEnabled);
    settings.autoRetryCount = Math.min(
        5,
        Math.max(0, Number.parseInt(settings.autoRetryCount, 10) || 0),
    );
    settings.memoryAutoIndexInterval = Math.min(
        50,
        Math.max(0, Number.parseInt(settings.memoryAutoIndexInterval, 10) || 0),
    );
    settings.backgroundNpcBudget = Math.max(
        0,
        Number.parseInt(settings.backgroundNpcBudget, 10) || 0,
    );
    settings.enhancedBackgroundSimulation = Boolean(settings.enhancedBackgroundSimulation);
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
    settings.settingsVersion = 31;
    if (!['world', 'explicit', 'cautious', 'open'].includes(settings.timePolicy)) {
        settings.timePolicy = 'world';
    }
    if (!['tavern', 'tavern-profile', 'custom'].includes(settings.apiMode)) settings.apiMode = 'tavern';
    settings.tavernApiProfileId = String(settings.tavernApiProfileId || '').trim().slice(0, 120);
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
    settings.imageApiEnabled = Boolean(settings.imageApiEnabled);
    settings.imageApiUrl = String(settings.imageApiUrl || '').trim().slice(0, 500);
    settings.imageApiKey = String(settings.imageApiKey || '').trim().slice(0, 1000);
    settings.imageApiModel = String(settings.imageApiModel || '').trim().slice(0, 180);
    if (!['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'].includes(settings.imageApiSize)) {
        settings.imageApiSize = '1024x1024';
    }
    settings.imageApiTimeoutMs = Math.min(
        600000,
        Math.max(30000, Number(settings.imageApiTimeoutMs) || 180000),
    );
    settings.socialAutoEnabled = settings.socialAutoEnabled !== false;
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
    settings.orbEdgeHide = Boolean(settings.orbEdgeHide);
    context.extensionSettings[MODULE_ID] = settings;
    if (previousSettingsVersion < 31) context.saveSettingsDebounced?.();
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
        historyBootstrapCheckpoint: null,
        personObservations: {},
        lingqi: emptyLingqiState(),
        social: emptySocialState(),
        publicOpinion: emptyPublicOpinionCache(),
        publicOpinionListHidden: false,
        publicOpinionDismissed: { news: [], forums: [] },
        publicOpinionSandbox: emptyPublicOpinionSandbox(),
        manualDeletions: {
            eventIds: [],
            events: [],
            people: [],
            memory: { factIds: [], clueIds: [], summaryIds: [] },
        },
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
    const restored = restoreCompactSnapshot(
        snapshot,
        fallback || store?.initialState || null,
        store?.memorySummaryArchive || [],
    );
    return applyPlayerCharacterRecordingPolicy(
        applyManualDeletionFilters(restored, store),
        getSettings(),
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

function isStoredPlayerCharacter(person, userName = getContext()?.name1 || '') {
    const normalizedUserName = String(userName || '').trim().toLocaleLowerCase();
    const name = String(person?.name || '').trim().toLocaleLowerCase();
    return Boolean(
        person?.isUser
        || person?.is_user
        || person?.role === 'user'
        || (normalizedUserName && name && normalizedUserName === name)
    );
}

function applyPlayerCharacterRecordingPolicy(inputState, settings = getSettings()) {
    const state = trimState(inputState);
    const userName = getContext()?.name1 || '';
    if (settings.recordPlayerCharacter === false) {
        state.people = (state.people || []).filter(person => !isStoredPlayerCharacter(person, userName));
        return trimState(state);
    }
    // Even when the player card is recorded, player inner thoughts are never stored.
    state.people = (state.people || []).map(person => (
        isStoredPlayerCharacter(person, userName)
            ? { ...person, isUser: true, innerVoice: '' }
            : person
    ));
    return trimState(state);
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
    if (getSettings().recordPlayerCharacter === false) return '';
    const resolvedState = state || getState();
    const player = findPlayerPerson(resolvedState);
    if (player) return String(player.identityAnchor || '').trim().slice(0, 500);
    return String(getSettings().playerIdentityAnchor || '').trim().slice(0, 400);
}


function normalizePublicOpinionDismissed(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const normalize = items => [...new Set(
        (Array.isArray(items) ? items : [])
            .map(item => String(item || '').trim())
            .filter(Boolean),
    )].slice(-160);
    return {
        news: normalize(raw.news),
        forums: normalize(raw.forums),
    };
}

function publicOpinionDismissKey(kind, item) {
    const related = String(item?.relatedEventId || '').trim();
    if (kind === 'forum') {
        return `forum:${related}:${String(item?.board || '').trim()}:${String(item?.title || '').trim()}`;
    }
    return `news:${related}:${String(item?.headline || '').trim()}`;
}

function filterDismissedPublicOpinion(cache, dismissedRaw) {
    const cacheValue = normalizePublicOpinionCache(cache || emptyPublicOpinionCache());
    const dismissed = normalizePublicOpinionDismissed(dismissedRaw);
    const newsKeys = new Set(dismissed.news);
    const forumKeys = new Set(dismissed.forums);
    return {
        ...cacheValue,
        news: cacheValue.news.filter(item => !newsKeys.has(publicOpinionDismissKey('news', item))),
        forums: cacheValue.forums.filter(item => !forumKeys.has(publicOpinionDismissKey('forum', item))),
    };
}

function dismissPublicOpinionItem(kind, itemId) {
    const normalizedKind = kind === 'forum' ? 'forum' : 'news';
    const store = getStore();
    const cache = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
    const list = normalizedKind === 'forum' ? cache.forums : cache.news;
    const item = list.find(entry => String(entry?.id || '') === String(itemId || ''));
    if (!item) throw new Error('这条舆情已经不在列表里啦～');

    const dismissed = normalizePublicOpinionDismissed(store.publicOpinionDismissed);
    const bucket = normalizedKind === 'forum' ? 'forums' : 'news';
    const key = publicOpinionDismissKey(normalizedKind, item);
    dismissed[bucket] = [...new Set([...dismissed[bucket], key])].slice(-160);
    store.publicOpinionDismissed = dismissed;
    store.publicOpinion = filterDismissedPublicOpinion(cache, dismissed);
    saveStore(store);
    runtime.ui?.render();
    return true;
}


function normalizeManualDeletions(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const eventIds = [...new Set(
        (Array.isArray(raw.eventIds) ? raw.eventIds : [])
            .map(item => String(item || '').trim())
            .filter(Boolean),
    )].slice(-240);

    const seenEvents = new Set();
    const events = [];
    for (const item of Array.isArray(raw.events) ? raw.events : []) {
        if (!item || typeof item !== 'object') continue;
        const entry = {
            id: String(item.id || '').trim(),
            title: String(item.title || '').trim().slice(0, 140),
            place: String(item.place || '').trim().slice(0, 140),
            summary: String(item.summary || '').trim().slice(0, 420),
            actors: (Array.isArray(item.actors) ? item.actors : [])
                .map(actor => String(actor || '').trim())
                .filter(Boolean)
                .slice(0, 16),
        };
        if (!entry.id && !entry.title) continue;
        const key = `${entry.id.toLocaleLowerCase()}\u0000${entry.title.toLocaleLowerCase()}\u0000${entry.place.toLocaleLowerCase()}`;
        if (seenEvents.has(key)) continue;
        seenEvents.add(key);
        events.push(entry);
    }

    const memoryRaw = raw.memory && typeof raw.memory === 'object' ? raw.memory : {};
    const memory = {
        factIds: [...new Set((Array.isArray(memoryRaw.factIds) ? memoryRaw.factIds : [])
            .map(item => String(item || '').trim()).filter(Boolean))].slice(-480),
        clueIds: [...new Set((Array.isArray(memoryRaw.clueIds) ? memoryRaw.clueIds : [])
            .map(item => String(item || '').trim()).filter(Boolean))].slice(-480),
        summaryIds: [...new Set((Array.isArray(memoryRaw.summaryIds) ? memoryRaw.summaryIds : [])
            .map(item => String(item || '').trim()).filter(Boolean))].slice(-480),
    };

    const seenPeople = new Set();
    const people = [];
    for (const item of Array.isArray(raw.people) ? raw.people : []) {
        if (!item || typeof item !== 'object') continue;
        const entry = {
            id: String(item.id || '').trim(),
            name: String(item.name || '').trim(),
            worldbookRef: String(item.worldbookRef || '').trim(),
        };
        if (!entry.id && !entry.name && !entry.worldbookRef) continue;
        const key = `${entry.id.toLocaleLowerCase()}\u0000${entry.name.toLocaleLowerCase()}\u0000${entry.worldbookRef.toLocaleLowerCase()}`;
        if (seenPeople.has(key)) continue;
        seenPeople.add(key);
        people.push(entry);
    }
    return { eventIds, events: events.slice(-240), people: people.slice(-240), memory };
}

function normalizedEventDeletionText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function eventDeletionSimilarity(left, right) {
    const a = normalizedEventDeletionText(left);
    const b = normalizedEventDeletionText(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    if (shorter.length >= 6 && longer.includes(shorter)) return shorter.length / longer.length;
    if (a.length < 4 || b.length < 4) return 0;
    const grams = text => {
        const values = new Set();
        for (let index = 0; index < text.length - 1; index += 1) values.add(text.slice(index, index + 2));
        return values;
    };
    const leftGrams = grams(a);
    const rightGrams = grams(b);
    let overlap = 0;
    for (const gram of leftGrams) if (rightGrams.has(gram)) overlap += 1;
    return (2 * overlap) / Math.max(1, leftGrams.size + rightGrams.size);
}

function eventMatchesDeletion(event, deletion) {
    const eventId = String(event?.id || '').trim();
    const deletionId = String(deletion?.id || '').trim();
    if (eventId && deletionId && eventId === deletionId) return true;
    const titleScore = eventDeletionSimilarity(event?.title, deletion?.title);
    if (titleScore >= 0.86) return true;
    if (titleScore < 0.68) return false;
    const contextScore = eventDeletionSimilarity(
        [event?.place, ...(event?.actors || []), event?.summary].filter(Boolean).join(' '),
        [deletion?.place, ...(deletion?.actors || []), deletion?.summary].filter(Boolean).join(' '),
    );
    return contextScore >= 0.58;
}

function personMatchesDeletion(person, deletion) {
    const id = String(person?.id || '').trim().toLocaleLowerCase();
    const name = String(person?.name || '').trim().toLocaleLowerCase();
    const worldbookRef = String(person?.worldbookRef || '').trim().toLocaleLowerCase();
    const deletedId = String(deletion?.id || '').trim().toLocaleLowerCase();
    const deletedName = String(deletion?.name || '').trim().toLocaleLowerCase();
    const deletedWorldbookRef = String(deletion?.worldbookRef || '').trim().toLocaleLowerCase();
    return Boolean(
        (deletedId && id && deletedId === id)
        || (deletedWorldbookRef && worldbookRef && deletedWorldbookRef === worldbookRef)
        || (deletedName && name && deletedName === name)
    );
}

function applyManualDeletionFilters(inputState, store) {
    const state = trimState(inputState);
    const deletions = normalizeManualDeletions(store?.manualDeletions);
    const deletedEvents = new Set(deletions.eventIds);

    if (deletedEvents.size || deletions.events.length) {
        const rejectedEventIds = new Set(deletedEvents);
        state.events = (state.events || []).filter(event => {
            const rejected = deletedEvents.has(String(event?.id || ''))
                || deletions.events.some(deletion => eventMatchesDeletion(event, deletion));
            if (rejected && event?.id) rejectedEventIds.add(String(event.id));
            return !rejected;
        });
        state.echoes = (state.echoes || []).filter(echo => !rejectedEventIds.has(String(echo?.eventId || '')));
        state.archive = (state.archive || []).filter(entry => !rejectedEventIds.has(String(entry?.eventId || '')));
    }
    if (deletions.people.length) {
        state.people = (state.people || []).filter(person => (
            person?.isUser || !deletions.people.some(deletion => personMatchesDeletion(person, deletion))
        ));
    }
    state.storyMemory ||= { facts: [], clues: [], summaries: [] };
    const deletedFacts = new Set(deletions.memory.factIds);
    const deletedClues = new Set(deletions.memory.clueIds);
    const deletedSummaries = new Set(deletions.memory.summaryIds);
    if (deletedFacts.size) {
        state.storyMemory.facts = (state.storyMemory.facts || []).filter(
            item => !deletedFacts.has(String(item?.id || '')),
        );
    }
    if (deletedClues.size) {
        state.storyMemory.clues = (state.storyMemory.clues || []).filter(
            item => !deletedClues.has(String(item?.id || '')),
        );
    }
    if (deletedSummaries.size) {
        state.storyMemory.summaries = (state.storyMemory.summaries || []).filter(
            item => !deletedSummaries.has(String(item?.id || '')),
        );
    }
    return trimState(state);
}

function addEventDeletionTombstone(store, event) {
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    const id = String(event?.id || '').trim();
    if (id) {
        store.manualDeletions.eventIds = [...new Set([
            ...store.manualDeletions.eventIds,
            id,
        ])].slice(-240);
    }
    store.manualDeletions.events = normalizeManualDeletions({
        ...store.manualDeletions,
        events: [...store.manualDeletions.events, {
            id,
            title: event?.title,
            place: event?.place,
            summary: event?.summary,
            actors: event?.actors,
        }],
    }).events;
}

function clearEventDeletionTombstone(store, event) {
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    const id = String(event?.id || '').trim();
    store.manualDeletions.eventIds = store.manualDeletions.eventIds.filter(item => item !== id);
    store.manualDeletions.events = store.manualDeletions.events.filter(
        deletion => !eventMatchesDeletion(event, deletion),
    );
}

function addMemoryDeletionTombstone(store, kind, item) {
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    const id = String(item?.id || '').trim();
    if (!id) return;
    const key = kind === 'clue'
        ? 'clueIds'
        : kind === 'summary'
            ? 'summaryIds'
            : 'factIds';
    store.manualDeletions.memory[key] = [...new Set([
        ...store.manualDeletions.memory[key],
        id,
    ])].slice(-480);
}

function addPersonDeletionTombstone(store, person) {
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    const entry = {
        id: String(person?.id || '').trim(),
        name: String(person?.name || '').trim(),
        worldbookRef: String(person?.worldbookRef || '').trim(),
    };
    store.manualDeletions.people = normalizeManualDeletions({
        ...store.manualDeletions,
        people: [...store.manualDeletions.people, entry],
    }).people;
    if (store.personObservations && entry.id) delete store.personObservations[entry.id];
}

function clearPersonDeletionTombstone(store, person) {
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    store.manualDeletions.people = store.manualDeletions.people.filter(
        deletion => !personMatchesDeletion(person, deletion),
    );
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
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    store.initialState = applyPlayerCharacterRecordingPolicy(
        store.initialState || createInitialState({ worldName: '主世界' }),
        getSettings(),
    );
    store.currentState = applyPlayerCharacterRecordingPolicy(
        applyManualDeletionFilters(
            store.currentState || store.initialState,
            store,
        ),
        getSettings(),
    );
    store.memorySummaryArchive = Array.isArray(store.memorySummaryArchive)
        ? store.memorySummaryArchive
        : [];
    store.historyBootstrapCheckpoint = store.historyBootstrapCheckpoint
        && typeof store.historyBootstrapCheckpoint === 'object'
        ? store.historyBootstrapCheckpoint
        : null;
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
    store.lingqi = normalizeLingqiState(store.lingqi || emptyLingqiState());
    store.social = reconcileSocialRelationships(
        store.social || emptySocialState(),
        store.currentState,
        {
            userName: context?.name1 || '',
            recentNarrative: recentAssistantNarrativeForSocial(context),
        },
    );
    store.publicOpinionDismissed = normalizePublicOpinionDismissed(store.publicOpinionDismissed);
    store.publicOpinion = filterDismissedPublicOpinion(
        store.publicOpinion || emptyPublicOpinionCache(),
        store.publicOpinionDismissed,
    );
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
    store.manualDeletions = normalizeManualDeletions(store.manualDeletions);
    store.currentState = applyPlayerCharacterRecordingPolicy(
        applyManualDeletionFilters(store.currentState, store),
        getSettings(),
    );
    mergeMemorySummaryArchive(store, store.currentState);
    store.social = reconcileSocialRelationships(
        store.social || emptySocialState(),
        store.currentState,
        {
            userName: context?.name1 || '',
            recentNarrative: recentAssistantNarrativeForSocial(context),
        },
    );
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
    if (taskKind === 'person-observation' || taskKind === 'lingqi' || taskKind === 'social') return 'observation';
    if (taskKind === 'public-opinion' || taskKind === 'public-opinion-sandbox') return 'opinion';
    if (taskKind === 'history' || taskKind === 'history-index' || taskKind === 'memory') return 'history';
    return 'simulation';
}

function tavernConnectionManagerDisabled(context = getContext()) {
    const disabled = context?.extensionSettings?.disabledExtensions;
    return Array.isArray(disabled) && disabled.includes('connection-manager');
}

function rawTavernConnectionProfiles(context = getContext()) {
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(profiles) ? profiles : [];
}

function tavernConnectionProfileById(profileId, context = getContext()) {
    const id = String(profileId || '').trim();
    if (!id) return null;
    return rawTavernConnectionProfiles(context).find(profile => String(profile?.id || '') === id) || null;
}

function listTavernConnectionProfiles() {
    const context = getContext();
    if (tavernConnectionManagerDisabled(context)) return [];
    let profiles = [];
    try {
        const service = context?.ConnectionManagerRequestService;
        profiles = typeof service?.getSupportedProfiles === 'function'
            ? service.getSupportedProfiles()
            : rawTavernConnectionProfiles(context);
    } catch (error) {
        console.warn('[世界背面] 读取酒馆连接方案失败，暂时只显示原始方案列表', error);
        profiles = rawTavernConnectionProfiles(context);
    }
    const seen = new Set();
    return (Array.isArray(profiles) ? profiles : [])
        .filter(profile => profile && typeof profile === 'object')
        .map(profile => {
            const id = String(profile.id || '').trim().slice(0, 120);
            if (!id || seen.has(id)) return null;
            seen.add(id);
            return {
                id,
                name: String(profile.name || '未命名酒馆方案').trim().slice(0, 120) || '未命名酒馆方案',
                api: String(profile.api || '').trim().slice(0, 80),
                model: String(profile.model || '').trim().slice(0, 180),
                mode: String(profile.mode || '').trim().slice(0, 20),
            };
        })
        .filter(Boolean)
        .slice(0, 100);
}

function tavernProfileRoute(profileId, {
    route = 'default',
    routeKey = 'simulation',
    settings = getSettings(),
} = {}) {
    const id = String(profileId || '').trim();
    const profile = tavernConnectionProfileById(id);
    return {
        mode: 'tavern-profile',
        route,
        routeKey,
        label: profile?.name || '酒馆已保存方案',
        profileId: id,
        profile,
        settings,
    };
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
    if (route.startsWith('tavern-profile:')) {
        return tavernProfileRoute(route.slice('tavern-profile:'.length), {
            route,
            routeKey,
            settings,
        });
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
    if (settings.apiMode === 'tavern-profile') {
        return tavernProfileRoute(settings.tavernApiProfileId, {
            route: 'default',
            routeKey,
            settings,
        });
    }
    return { mode: 'tavern', route: 'default', routeKey, label: '跟随当前酒馆', settings };
}

function physicalConnectionKey(taskKind = 'simulation') {
    const settings = getSettings();
    const route = resolveTaskConnection(settings, taskKind);
    if (route.mode === 'tavern-profile') {
        return [
            'tavern-profile-physical',
            String(route.profileId || 'missing'),
        ].join(':');
    }
    if (route.mode === 'custom') {
        const requestSettings = route.settings;
        return [
            'custom-physical',
            requestSettings.customApiTransport || 'proxy',
            hashText(String(requestSettings.customApiUrl || '')),
            hashText(String(requestSettings.customApiKey || '')),
            String(requestSettings.customApiModel || ''),
        ].join(':');
    }
    const connection = getConnectionInfo();
    return [
        'tavern-physical',
        String(connection?.source || 'tavern'),
        String(connection?.model || ''),
    ].join(':');
}

function retryConnectionKey(taskKind = 'simulation') {
    const settings = getSettings();
    const route = resolveTaskConnection(settings, taskKind);
    if (route.mode === 'tavern-profile') {
        return [
            'tavern-profile',
            route.route || 'default',
            String(route.profileId || 'missing'),
        ].join(':');
    }
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

function pushApiRequestTimeline(entry = {}) {
    runtime.apiRequestTimeline.push({
        chatToken: String(entry.chatToken || ''),
        taskKind: String(entry.taskKind || ''),
        route: String(entry.route || '').slice(0, 120),
        model: String(entry.model || '').slice(0, 180),
        lane: String(entry.lane || '').slice(0, 180),
        queuedAt: entry.queuedAt || '',
        startedAt: entry.startedAt || '',
        finishedAt: entry.finishedAt || '',
        waitMs: Math.max(0, Number(entry.waitMs) || 0),
        durationMs: Math.max(0, Number(entry.durationMs) || 0),
        outcome: String(entry.outcome || 'unknown'),
    });
    if (runtime.apiRequestTimeline.length > 32) {
        runtime.apiRequestTimeline.splice(0, runtime.apiRequestTimeline.length - 32);
    }
}

function waitForPromiseOrAbort(promise, signal) {
    if (!signal) return Promise.resolve(promise);
    if (signal.aborted) {
        const error = new Error('后台任务已取消');
        error.name = 'AbortError';
        return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            const error = new Error('后台任务已取消');
            error.name = 'AbortError';
            reject(error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
            value => {
                signal.removeEventListener?.('abort', onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener?.('abort', onAbort);
                reject(error);
            },
        );
    });
}

async function runInConnectionLane(taskKind, signal, operation) {
    const laneKey = physicalConnectionKey(taskKind);
    const routeAtQueue = resolveTaskConnection(getSettings(), taskKind);
    const timelineModel = routeAtQueue.mode === 'custom'
        ? String(routeAtQueue.settings?.customApiModel || '')
        : routeAtQueue.mode === 'tavern-profile'
            ? String(routeAtQueue.profile?.model || '')
            : String(getCurrentTavernConnectionInfo()?.model || '');
    const previousTail = runtime.connectionLanes.get(laneKey) || Promise.resolve();
    let release;
    const ownDone = new Promise(resolve => { release = resolve; });
    const waitForPrevious = Promise.resolve(previousTail).catch(() => undefined);
    const laneTail = waitForPrevious.then(() => ownDone);
    runtime.connectionLanes.set(laneKey, laneTail);

    const queuedAtMs = Date.now();
    const queuedAt = new Date(queuedAtMs).toISOString();
    const chatTokenAtQueue = currentChatToken();
    let startedAtMs = 0;
    let outcome = 'cancelled';
    try {
        await waitForPromiseOrAbort(waitForPrevious, signal);
        if (signal?.aborted) {
            const error = new Error('后台任务已取消');
            error.name = 'AbortError';
            throw error;
        }
        startedAtMs = Date.now();
        try {
            const result = await operation();
            outcome = 'success';
            return result;
        } catch (error) {
            outcome = isAbortError(error) || signal?.aborted ? 'cancelled' : 'error';
            throw error;
        }
    } finally {
        const finishedAtMs = Date.now();
        pushApiRequestTimeline({
            chatToken: chatTokenAtQueue,
            taskKind,
            route: routeAtQueue.label || '',
            model: timelineModel,
            lane: laneKey,
            queuedAt,
            startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : '',
            finishedAt: new Date(finishedAtMs).toISOString(),
            waitMs: startedAtMs ? startedAtMs - queuedAtMs : finishedAtMs - queuedAtMs,
            durationMs: startedAtMs ? finishedAtMs - startedAtMs : 0,
            outcome,
        });
        release?.();
        void laneTail.finally(() => {
            if (runtime.connectionLanes.get(laneKey) === laneTail) {
                runtime.connectionLanes.delete(laneKey);
            }
        });
    }
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

function getCurrentTavernConnectionInfo() {
    const context = getContext();
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
                : '经酒馆 Custom 转发（不继承酒馆模型）',
            configured: Boolean(
                pluginSettings.customApiUrl
                && pluginSettings.customApiKey
                && pluginSettings.customApiModel
            ),
        };
    }

    if (pluginSettings.apiMode === 'tavern-profile') {
        const profile = tavernConnectionProfileById(pluginSettings.tavernApiProfileId, context);
        const supported = listTavernConnectionProfiles()
            .some(item => item.id === String(pluginSettings.tavernApiProfileId || ''));
        return {
            mainApi: 'tavern-profile',
            source: String(profile?.api || 'tavern-profile'),
            apiLabel: '酒馆已保存 API 方案',
            model: String(profile?.model || '方案模型不可用'),
            profile: String(profile?.name || (pluginSettings.tavernApiProfileId ? '引用的方案已不存在' : '尚未选择方案')),
            online: String(context?.onlineStatus || ''),
            method: '引用酒馆连接方案（Key / URL 仍由酒馆管理）',
            configured: Boolean(
                profile
                && supported
                && !tavernConnectionManagerDisabled(context)
                && typeof context?.ConnectionManagerRequestService?.sendRequest === 'function'
            ),
        };
    }

    return getCurrentTavernConnectionInfo();
}


function activeBackgroundTaskLabels() {
    const labels = [];
    const currentToken = currentChatToken();
    const activeSimulation = runtime.activeSimulation?.chatToken === currentToken
        && !runtime.activeSimulation?.controller?.signal?.aborted;
    if (activeSimulation) labels.push('世界推演');
    if (runtime.activeHistoryScan && !runtime.activeHistoryScan.signal?.aborted) {
        labels.push(runtime.historyProgress?.kind === 'world-bootstrap' ? '历史回溯' : '记忆整理');
    }
    if (runtime.activeWorldPulse?.controller && !runtime.activeWorldPulse.controller.signal.aborted) labels.push('世界脉搏');
    if (runtime.activePublicImpact?.controller && !runtime.activePublicImpact.controller.signal.aborted) labels.push('公共影响');
    if (runtime.activeCorrection?.controller && !runtime.activeCorrection.controller.signal.aborted) labels.push('事实纠错');
    if (
        runtime.publicOpinionRefreshTransaction?.controller
        && !runtime.publicOpinionRefreshTransaction.controller.signal.aborted
    ) labels.push('舆情刷新');
    else if (
        runtime.activePublicOpinion?.controller
        && !runtime.activePublicOpinion.controller.signal.aborted
    ) labels.push('舆情刷新');
    if (
        runtime.activePublicOpinionSandbox?.controller
        && !runtime.activePublicOpinionSandbox.controller.signal.aborted
    ) labels.push('随便逛逛');
    if (
        runtime.activeObservation?.controller
        && !runtime.activeObservation.controller.signal.aborted
    ) labels.push('人物观测');
    if (
        runtime.activeLingqi?.controller
        && !runtime.activeLingqi.controller.signal.aborted
    ) labels.push('玲七');
    if (
        runtime.activeSocial?.controller
        && !runtime.activeSocial.controller.signal.aborted
    ) labels.push('内置社交');
    if (
        runtime.activeFriendRequest?.controller
        && !runtime.activeFriendRequest.controller.signal.aborted
    ) labels.push('好友申请');
    if (
        runtime.activeMoments?.controller
        && !runtime.activeMoments.controller.signal.aborted
    ) labels.push('朋友圈');
    if (
        runtime.activeSocialPulse?.controller
        && !runtime.activeSocialPulse.controller.signal.aborted
    ) labels.push('生活通讯');
    else if (runtime.socialPulseTimer !== null) labels.push('生活通讯待运行');
    if (runtime.queuedSimulations.size > 0 || runtime.pendingManualSimulation) {
        labels.push('排队世界推演');
    }
    return [...new Set(labels)];
}

function latestNarrativeSyncSnapshot() {
    const latest = latestAssistantEntry();
    if (!latest) {
        return {
            hasLatest: false,
            latestMessageId: null,
            pendingTurns: 0,
            committed: true,
            needsSimulation: false,
            active: false,
            queued: false,
            status: 'empty',
        };
    }

    const swipeId = Number(latest.message?.swipe_id ?? 0);
    const sourceKey = branchSourceKey(latest.index, latest.message, swipeId);
    const branch = branchDataFromMessage(latest.message, swipeId);
    const branchMatchesSource = Boolean(branch?.sourceKey === sourceKey);
    const branchCommitted = Boolean(
        branchMatchesSource
        && branch.status === 'committed'
        && branch.result
        && !branch.stale
    );
    const stateCommit = getState()?.lastCommit;
    // 历史回溯可能只建立当前状态锚点而没有逐楼层快照；只有不存在当前
    // source 的分支记录时，才允许精确匹配的状态锚点作为完成证据。
    const stateCommitted = Boolean(
        !branchMatchesSource
        && stateCommit?.sourceKey === sourceKey
        && Number(stateCommit?.messageId) === Number(latest.index)
        && Number(stateCommit?.swipeId ?? 0) === swipeId
    );
    const committed = branchCommitted || stateCommitted;
    const chatToken = currentChatToken();
    const active = Boolean(
        runtime.activeSimulation?.chatToken === chatToken
        && runtime.activeSimulation?.sourceKey === sourceKey
        && !runtime.activeSimulation?.controller?.signal?.aborted
    );
    const queued = Boolean(
        runtime.queuedSimulations.has(`${chatToken}:${sourceKey}`)
        || (
            runtime.pendingManualSimulation
            && runtime.pendingManualSimulation.chatToken === chatToken
        )
    );
    const pendingTurns = committed ? 0 : Math.max(
        pendingAssistantEntriesThrough(latest.index).length,
        1,
    );
    const branchError = branchMatchesSource && branch?.status === 'error'
        ? String(branch.error || '')
        : '';
    const status = active
        ? 'running'
        : queued
            ? 'queued'
            : committed
                ? 'committed'
                : branchError
                    ? 'error'
                    : 'pending';

    return {
        hasLatest: true,
        latestMessageId: latest.index,
        latestSwipeId: swipeId,
        sourceKey,
        pendingTurns,
        committed,
        needsSimulation: !committed,
        active,
        queued,
        status,
        error: branchError,
    };
}

function getSyncStatus() {
    const latest = latestAssistantEntry();
    const store = getStore();
    const state = store.currentState;
    const recoveryPoints = listRecoveryPointHeaders(store);
    const latestRecovery = recoveryPoints.at(-1) || null;
    const chatToken = currentChatToken();
    const narrative = latestNarrativeSyncSnapshot();
    const pendingTurns = narrative.pendingTurns;
    const activeForCurrentChat = runtime.activeSimulation?.chatToken === chatToken
        ? runtime.activeSimulation
        : null;
    const activeTurns = activeForCurrentChat
        ? Math.max(1, Number(activeForCurrentChat.newAssistantCount) || 1)
        : 0;
    let derived = {};

    const liveSimulationPhase = narrative.active
        || narrative.queued
        || ['running', 'queued', 'cancelling'].includes(runtime.syncStatus.phase);
    if (!liveSimulationPhase && narrative.hasLatest) {
        if (
            narrative.status === 'error'
            || (narrative.needsSimulation && runtime.syncStatus.phase === 'error')
        ) {
            derived = {
                phase: 'error',
                message: '上一次世界推演失败',
                error: narrative.error || runtime.syncStatus.error || '推演接口没有提供具体错误',
            };
        } else if (narrative.needsSimulation) {
            derived = {
                phase: 'pending',
                message: '最新正文仍在等待推演',
                error: '',
            };
        } else if (narrative.committed) {
            derived = {
                phase: 'success',
                message: '最新正文已经完成推演',
                error: '',
                summary: branchDataFromMessage(latest.message)?.summary || runtime.syncStatus.summary || null,
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
        lingqi: {
            ...normalizeLingqiState(store.lingqi || emptyLingqiState()),
            ...runtime.lingqiStatus,
            pendingAction: (
                runtime.pendingLingqiAction?.chatToken === chatToken
                && runtime.pendingLingqiAction?.contextEpoch === runtime.contextEpoch
            ) ? { ...runtime.pendingLingqiAction } : null,
            running: Boolean(runtime.activeLingqi && runtime.activeLingqi.chatToken === chatToken && !runtime.activeLingqi.controller?.signal?.aborted),
        },
        social: {
            ...normalizeSocialState(store.social || emptySocialState(), state.people),
            ...runtime.socialStatus,
            running: Boolean(runtime.activeSocial && runtime.activeSocial.chatToken === chatToken && !runtime.activeSocial.controller?.signal?.aborted),
            friendRequest: {
                ...runtime.friendRequestStatus,
                running: Boolean(runtime.activeFriendRequest && runtime.activeFriendRequest.chatToken === chatToken && !runtime.activeFriendRequest.controller?.signal?.aborted),
            },
            momentsStatus: {
                ...runtime.momentsStatus,
                running: Boolean(runtime.activeMoments && runtime.activeMoments.chatToken === chatToken && !runtime.activeMoments.controller?.signal?.aborted),
            },
        },
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
        narrative,
        canCancelSimulation: Boolean(
            activeForCurrentChat
            && !activeForCurrentChat.controller.signal.aborted
        ),
        manualSimulationQueued: Boolean(
            runtime.pendingManualSimulation
            && runtime.pendingManualSimulation.chatToken === chatToken
        ),
        activeBackgroundTasks: activeBackgroundTaskLabels(),
        canCancelBackgroundTask: activeBackgroundTaskLabels().length > 0,
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
    return Math.max(64, Number(base) || 3200) + Math.max(0, attempt) * 1800;
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
    if (!text) {
        const error = new Error(`${subject}没有返回可读取的 JSON 状态`);
        error.errorType = 'empty-response';
        return error;
    }
    const compact = text.replace(/\s+/g, ' ');
    const structural = compact
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    const beginning = compact.slice(0, 90);
    const ending = compact.length > 140 ? compact.slice(-70) : '';
    const likelyTruncated = /^[\[{]/.test(structural) && !/[}\]]\s*$/.test(structural);
    const detail = ending ? `开头：${beginning}；结尾：${ending}` : beginning;
    const error = new Error(
        `${subject}返回的 JSON ${likelyTruncated ? '没有闭合，疑似被输出上限截断' : '格式无效'}`
        + `（${text.length} 字符）：${detail}`,
    );
    error.errorType = likelyTruncated ? 'output-limit' : 'invalid-json';
    if (likelyTruncated) {
        error.code = 'OUTPUT_TRUNCATED';
        error.partialText = text;
    }
    return error;
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
    const monotonicState = ensureMonotonicRevision(nextState, store.currentState);
    store.currentState = applyPlayerCharacterRecordingPolicy(
        applyManualDeletionFilters(monotonicState, store),
        getSettings(),
    );

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

function recentChatText(maximum = 8, beforeIndex = Infinity) {
    const chat = getContext()?.chat || [];
    const end = Number.isFinite(Number(beforeIndex))
        ? Math.max(0, Math.min(chat.length, Number(beforeIndex)))
        : chat.length;
    return chat
        .slice(0, end)
        .slice(-maximum)
        .map(message => narrativeMessageText(message))
        .join('\n')
        .slice(-9000);
}

function recentForegroundIntentText(beforeIndex = Infinity) {
    const fullChat = getContext()?.chat || [];
    const end = Number.isFinite(Number(beforeIndex))
        ? Math.max(0, Math.min(fullChat.length, Number(beforeIndex)))
        : fullChat.length;
    const chat = fullChat.slice(0, end);
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

function publicWorldNeedsRefresh(state, _candidates = eligiblePublicOpinionEvents(state)) {
    return publicWorldCoverageDue(state, {
        customInstruction: getSettings().customSimulationInstruction,
        minimumIntervalMinutes: 180,
    });
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

function schedulePublicPostProcessing(state = getState(), {
    impactDelay = 160,
    opinionDelay = 520,
} = {}) {
    const impactScheduled = schedulePublicImpactPropagation(state, impactDelay);
    if (!impactScheduled) {
        scheduleAutoPublicOpinion(state, opinionDelay);
    }
    scheduleSocialPulse(Math.max(900, Number(opinionDelay) + 420));
    return impactScheduled;
}

function historyBootstrapPrefixSignature(endExclusive, context = getContext()) {
    const limit = Math.max(0, Math.min(
        context?.chat?.length || 0,
        Number.parseInt(endExclusive, 10) || 0,
    ));
    const parts = [];
    for (let index = 0; index < limit; index += 1) {
        const message = context?.chat?.[index];
        if (!message || message.is_system) continue;
        parts.push([
            index,
            message.is_user ? 'u' : 'a',
            message.is_user ? 0 : Number(message.swipe_id ?? 0),
            hashText(narrativeMessageText(message)),
        ].join(':'));
    }
    return hashText(parts.join('|'));
}

function validHistoryBootstrapCheckpoint(store, {
    chatToken = currentChatToken(),
    chatLength = getContext()?.chat?.length || 0,
    baseRevision = Math.max(0, Number(getState()?.revision) || 0),
} = {}) {
    const checkpoint = store?.historyBootstrapCheckpoint;
    if (!checkpoint || typeof checkpoint !== 'object') return null;
    const cursor = Math.max(0, Number.parseInt(checkpoint.cursor, 10) || 0);
    const valid = (
        Number(checkpoint.version) === 1
        && String(checkpoint.chatToken || '') === String(chatToken || '')
        && cursor > 0
        && cursor <= chatLength
        && Math.max(0, Number(checkpoint.baseRevision) || 0) === baseRevision
        && Boolean(checkpoint.stagedState && typeof checkpoint.stagedState === 'object')
        && Boolean(checkpoint.prefixSignature)
        && checkpoint.prefixSignature === historyBootstrapPrefixSignature(cursor)
        && Boolean(checkpoint.recordPlayerCharacter) === Boolean(getSettings().recordPlayerCharacter)
    );
    return valid ? { ...checkpoint, cursor } : null;
}

function saveHistoryBootstrapCheckpoint({
    chatToken,
    cursor,
    chatLength,
    baseRevision,
    stagedState,
    assistantBatchLimit,
} = {}) {
    if (!(cursor > 0) || !stagedState) return false;
    const store = getStore();
    store.historyBootstrapCheckpoint = {
        version: 1,
        chatToken: String(chatToken || ''),
        cursor: Math.max(0, Number.parseInt(cursor, 10) || 0),
        totalAtStart: Math.max(0, Number.parseInt(chatLength, 10) || 0),
        baseRevision: Math.max(0, Number(baseRevision) || 0),
        prefixSignature: historyBootstrapPrefixSignature(cursor),
        recordPlayerCharacter: Boolean(getSettings().recordPlayerCharacter),
        assistantBatchLimit: Math.max(1, Number.parseInt(assistantBatchLimit, 10) || 1),
        stagedState: trimState(stagedState),
        updatedAt: new Date().toISOString(),
    };
    saveStore(store, { immediate: true });
    return true;
}

function clearHistoryBootstrapCheckpoint({ immediate = true } = {}) {
    const store = getStore();
    if (!store.historyBootstrapCheckpoint) return false;
    store.historyBootstrapCheckpoint = null;
    saveStore(store, { immediate });
    return true;
}

function scheduleSocialPulse(delay = 1200) {
    const settings = getSettings();
    const latestMessageId = Number(latestAssistantEntry()?.index ?? -1);
    const store = getStore();
    const social = normalizeSocialState(store.social || emptySocialState(), store.currentState.people);
    if (
        !settings.enabled
        || !settings.socialAutoEnabled
        || latestMessageId < 0
        || latestMessageId <= Number(social.lastPulseMessageId ?? -1)
    ) return false;
    const chatToken = currentChatToken();
    if (runtime.socialPulseTimer !== null) window.clearTimeout(runtime.socialPulseTimer);
    runtime.socialPulseTimer = window.setTimeout(() => {
        runtime.socialPulseTimer = null;
        if (chatToken !== currentChatToken()) return;
        const blocked = Boolean(
            runtime.activeSimulation
            || runtime.activeWorldPulse
            || runtime.activeHistoryScan
            || runtime.activePublicImpact
            || runtime.activeCorrection
            || runtime.activeSocialPulse
            || runtime.queuedSimulations.size > 0
        );
        if (blocked) {
            scheduleSocialPulse(Math.max(900, Number(delay) || 1200));
            return;
        }
        void runSocialPulse(latestMessageId).catch(error => {
            if (!isAbortError(error)) console.warn('[世界背面] 生活通讯脉冲失败', error);
        });
    }, Math.max(700, Number(delay) || 1200));
    return true;
}

async function runSocialPulse(messageId = Number(latestAssistantEntry()?.index ?? -1)) {
    if (runtime.activeSocialPulse && !runtime.activeSocialPulse.controller?.signal?.aborted) return null;
    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    let store = getStore();
    const normalized = normalizeSocialState(store.social || emptySocialState(), store.currentState.people);
    if (Number(messageId) <= Number(normalized.lastPulseMessageId ?? -1)) return null;
    const prompt = buildSocialPulsePrompt(normalized, store.currentState, {
        userName: String(getContext()?.name1 || '你'),
    });
    if (!prompt) {
        normalized.lastPulseMessageId = Number(messageId);
        store.social = normalized;
        saveStore(store, { immediate: true });
        return { messageCount: 0, requestCount: 0, removalCount: 0, momentCount: 0 };
    }
    runtime.activeSocialPulse = { controller, chatToken, contextEpoch, messageId: Number(messageId) };
    runtime.ui?.render();
    try {
        const raw = await backgroundSimulation(prompt, {
            maxTokens: 1600,
            temperature: 0.45,
            signal: controller.signal,
            taskKind: 'social',
            rejectTruncated: true,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed) throw unreadableJsonError(raw, '生活通讯模型');
        if (controller.signal.aborted || chatToken !== currentChatToken() || contextEpoch !== runtime.contextEpoch) return null;
        store = getStore();
        const applied = applySocialPulsePayload(store.social, store.currentState, parsed);
        applied.social.lastPulseMessageId = Number(messageId);
        store.social = applied.social;
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.ui?.render();
        return applied;
    } finally {
        if (runtime.activeSocialPulse?.controller === controller) runtime.activeSocialPulse = null;
        runtime.ui?.render();
    }
}


function publicOpinionRevealInjection(state, cache, settings, recentText = '') {
    if (
        settings.worldPromptInjection === false
        || settings.injectionPublicOpinion === false
        || settings.publicOpinionRevealMode !== 'relevant'
    ) return '';
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

function socialConversationInjection(social, state, settings) {
    if (settings.injectionSocial !== true) return '';
    const normalized = normalizeSocialState(social || emptySocialState(), state?.people || []);
    const accepted = new Set(normalized.connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const peopleById = new Map((state?.people || []).map(person => [String(person?.id || ''), person]));
    const conversations = [...normalized.conversations]
        .filter(conversation => (
            conversation.rawMessages.length
            && (conversation.type === 'group' || accepted.has(conversation.memberIds[0]))
        ))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 3);
    if (!conversations.length) return '';
    const lines = conversations.flatMap(conversation => {
        const members = conversation.memberIds
            .map(id => peopleById.get(id)?.name)
            .filter(Boolean)
            .join('、');
        const messages = conversation.rawMessages.slice(-6).map(message => (
            `- ${message.senderId === 'user' ? '玩家' : message.senderName}：${String(message.text || '').trim().slice(0, 420)}`
        ));
        return [`[通信｜${conversation.title}｜成员：${members || '未知'}]`, ...messages];
    });
    return [
        '<world_backstage_social_context>',
        '以下是最近社交通信记录，仅代表人物说过或收到的内容，不是已结算的世界事实。',
        '可以用它保持语言和关系连续；不得因为聊天里有承诺、计划、位置或结果，就当成它已经发生。',
        ...lines.slice(-24),
        '</world_backstage_social_context>',
    ].join('\n');
}

function refreshInjection({
    stateOverride = null,
    chatBeforeIndex = Infinity,
} = {}) {
    const context = getContext();
    if (!context?.setExtensionPrompt) return;

    const settings = getSettings();
    const state = stateOverride || getState();
    const recentText = recentChatText(8, chatBeforeIndex);
    const packet = buildInjectionPackage(state, settings, recentText, {
        contextText: recentForegroundIntentText(chatBeforeIndex),
    });
    const store = getStore();
    const opinionInjection = publicOpinionRevealInjection(
        state,
        store.publicOpinion,
        settings,
        recentText,
    );
    const socialInjection = socialConversationInjection(store.social, state, settings);
    const directorInjection = buildLingqiDirectorInjection(store.lingqi || emptyLingqiState());
    const authorityText = String(packet.authorityText ?? packet.text ?? '');
    const supportText = [directorInjection.text, packet.supportText, opinionInjection, socialInjection].filter(Boolean).join('\n\n');
    const text = [supportText, authorityText].filter(Boolean).join('\n\n');
    runtime.injection = {
        ...packet,
        authorityText,
        supportText,
        text,
        directorNoteIds: directorInjection.noteIds,
    };

    // World facts stay at depth 0 as the continuity contract. Optional reveal,
    // memory and public-opinion context sits deeper so it can help without
    // competing with the newest user turn or authoritative state.
    context.setExtensionPrompt(PROMPT_KEY, authorityText, 1, 0, false, 0);
    context.setExtensionPrompt(SUPPORT_PROMPT_KEY, supportText, 1, 2, false, 0);
}

function rerollInjectionBase(type) {
    if (!/(?:swipe|regenerate|reroll)/i.test(String(type || ''))) return null;
    const chat = getContext()?.chat || [];
    let target = null;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message || message.is_user || message.is_system) continue;
        target = { message, index };
        break;
    }
    if (!target) return null;

    const swipeId = Number(target.message?.swipe_id ?? 0);
    const branch = branchDataFromMessage(target.message, swipeId);
    if (branch?.base && !branch.stale) {
        return {
            state: restoreBranchSnapshot(branch.base, getStore().initialState),
            chatBeforeIndex: target.index,
        };
    }

    const previous = findLatestResultSnapshot(target.index);
    return {
        state: previous
            ? stateWithBranchOverride(previous.snapshot)
            : clone(getStore().initialState),
        chatBeforeIndex: target.index,
    };
}

function offerGenerationInjection(type) {
    const rerollBase = rerollInjectionBase(type);
    refreshInjection(rerollBase
        ? {
            stateOverride: rerollBase.state,
            chatBeforeIndex: rerollBase.chatBeforeIndex,
        }
        : undefined);
    runtime.generationOffer = {
        eventIds: clone(runtime.injection.eventIds || []),
        directorNoteIds: clone(runtime.injection.directorNoteIds || []),
        at: Date.now(),
        rerollBase: Boolean(rerollBase),
    };
    return runtime.generationOffer;
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
        || runtime.activeCorrection
        || runtime.activeHistoryScan
        || runtime.activePublicOpinion
        || runtime.queuedSimulations.size > 0
    );
}

function coreStateWriterBusyForSimulation() {
    return Boolean(
        runtime.activeHistoryScan
        || runtime.activeWorldPulse
        || runtime.activePublicImpact
        || runtime.activeCorrection
        || runtime.activePublicOpinion
    );
}

async function waitForCoreStateWritersToSettle({
    chatToken,
    dataEpoch,
    contextEpoch,
} = {}) {
    let announced = false;
    while (coreStateWriterBusyForSimulation()) {
        if (
            (chatToken && currentChatToken() !== chatToken)
            || (dataEpoch !== undefined && runtime.dataEpoch !== dataEpoch)
            || (contextEpoch !== undefined && runtime.contextEpoch !== contextEpoch)
        ) return false;
        if (!announced) {
            announced = true;
            setSyncStatus({
                phase: 'queued',
                message: '前一个后台批次已经发出～等它收尾后再推演最新正文，不再中途掐掉重发',
                error: '',
            });
        }
        await new Promise(resolve => window.setTimeout(resolve, 80));
    }
    return true;
}

function latestAssistantSourceStamp() {
    const latest = latestAssistantEntry();
    if (!latest) return '';
    const swipeId = Number(latest.message?.swipe_id ?? 0);
    return branchSourceKey(latest.index, latest.message, swipeId);
}

function preemptLowPriorityTasksForCore({
    includeWorldWriters = false,
    hardAbort = false,
} = {}) {
    if (!hardAbort) {
        // A request that has already reached an upstream proxy may keep consuming
        // RPM/TPM even if the browser aborts fetch(). For normal new正文, do not
        // create “abort old request → immediately fire new request” bursts.
        if (runtime.activePublicOpinion && !runtime.activePublicOpinion.controller.signal.aborted) {
            runtime.pendingPublicOpinion = true;
        }
        if (runtime.activeHistoryScan && !runtime.activeHistoryScan.signal.aborted) {
            runtime.historyProgress = {
                ...runtime.historyProgress,
                message: '新正文已经排队～我先把当前这批收好，再把路让给世界推演',
            };
            runtime.ui?.render();
        }
        return;
    }

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
                ? '上下文已失效～本次历史回溯停止，现有世界不会写入半成品'
                : '上下文已失效～记忆停在上一个已保存批次',
        };
        runtime.ui?.render();
    }
    if (includeWorldWriters) {
        runtime.activeWorldPulse?.controller?.abort?.();
        if (runtime.activePublicImpact && !runtime.activePublicImpact.controller.signal.aborted) {
            runtime.pendingPublicImpact = true;
            runtime.activePublicImpact.controller.abort();
        }
    }
}

function invalidateAsyncWorldContext() {
    runtime.contextEpoch += 1;
    runtime.pendingLingqiAction = null;
    runtime.activeSimulation?.controller?.abort?.();
    runtime.queuedSimulations.clear();
    clearDeferredManualSimulation();
    preemptLowPriorityTasksForCore({ includeWorldWriters: true, hardAbort: true });
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
    runtime.autoCatchUpSuppressedThroughMessageId = Math.max(
        runtime.autoCatchUpSuppressedThroughMessageId,
        Number(latestAssistantEntry()?.index ?? active.messageId ?? -1),
    );
    active.cancelled = true;
    active.controller.abort();
    if (active.apiMode === 'tavern') {
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


function cancelActiveBackgroundTasks({ preserveLingqi = false } = {}) {
    const labels = activeBackgroundTaskLabels()
        .filter(label => !(preserveLingqi && label === '玲七'));
    const queuedWorldWork = runtime.queuedSimulations.size > 0 || Boolean(runtime.pendingManualSimulation);
    if (!labels.length && !queuedWorldWork) return { cancelled: false, labels: [] };
    const cancelledLabels = queuedWorldWork && !labels.includes('世界推演')
        ? [...labels, '世界推演队列']
        : labels;

    runtime.autoCatchUpSuppressedThroughMessageId = Math.max(
        runtime.autoCatchUpSuppressedThroughMessageId,
        Number(latestAssistantEntry()?.index ?? -1),
    );

    // Invalidate queued world-simulation jobs without changing any world data.
    // Their branch records remain pending, so a later manual sync/new reply can catch up.
    runtime.dataEpoch += 1;
    runtime.pendingPublicImpact = false;
    runtime.pendingPublicOpinion = false;
    clearDeferredManualSimulation();
    if (runtime.autoMemoryTimer !== null) {
        window.clearTimeout(runtime.autoMemoryTimer);
        runtime.autoMemoryTimer = null;
    }
    if (runtime.socialPulseTimer !== null) {
        window.clearTimeout(runtime.socialPulseTimer);
        runtime.socialPulseTimer = null;
    }

    // Main simulation needs its existing special stop path for Tavern quiet generation.
    if (
        runtime.activeSimulation
        && !runtime.activeSimulation.controller.signal.aborted
    ) {
        cancelActiveSimulation();
    }

    const abortables = [
        runtime.activeHistoryScan,
        runtime.activeWorldPulse?.controller,
        runtime.activePublicImpact?.controller,
        runtime.activeCorrection?.controller,
        runtime.activePublicOpinion?.controller,
        runtime.publicOpinionRefreshTransaction?.controller,
        runtime.activePublicOpinionSandbox?.controller,
        runtime.activeObservation?.controller,
        preserveLingqi ? null : runtime.activeLingqi?.controller,
        runtime.activeSocial?.controller,
        runtime.activeFriendRequest?.controller,
        runtime.activeMoments?.controller,
        runtime.activeSocialPulse?.controller,
    ];
    for (const controller of abortables) {
        try {
            if (controller && !controller.signal?.aborted) controller.abort();
        } catch (error) {
            console.warn('[世界背面] 停止后台任务时有一个控制器未能正常中止', error);
        }
    }

    runtime.queuedSimulations.clear();
    runtime.simulationChain = Promise.resolve();

    if (runtime.historyProgress?.phase === 'running') {
        runtime.historyProgress = {
            ...runtime.historyProgress,
            phase: 'idle',
            message: '本次记忆/历史任务已手动停止；已经成功保存的批次会保留，正在生成的批次不会提交',
        };
    }
    if (runtime.publicOpinionStatus?.phase === 'running') {
        runtime.publicOpinionStatus = {
            phase: 'idle',
            message: '本次舆情刷新已手动停止，现有舆情不会被清空',
            error: '',
        };
    }
    if (runtime.publicOpinionSandboxStatus?.phase === 'running') {
        runtime.publicOpinionSandboxStatus = {
            phase: 'idle',
            message: '本次随便逛逛已手动停止',
            error: '',
        };
    }
    if (runtime.lingqiStatus?.phase === 'running') {
        runtime.lingqiStatus = {
            phase: 'idle',
            message: '……',
            error: '',
        };
    }
    if (runtime.socialStatus?.phase === 'running') {
        runtime.socialStatus = {
            phase: 'idle',
            message: '本次社交回复已停止，你发出的原始消息仍保留',
            error: '',
            conversationId: runtime.socialStatus.conversationId || '',
        };
    }

    setSyncStatus({
        phase: 'pending',
        message: `已停止当前后台任务：${labels.join('、')}。未完成结果不会提交。`,
        error: '',
    });
    runtime.ui?.render();
    return { cancelled: true, labels: cancelledLabels };
}

function markMessagePending(messageId, {
    trigger = 'reply',
    offeredEventIds = runtime.generationOffer.eventIds,
    offeredDirectorNoteIds = runtime.generationOffer.directorNoteIds,
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
        offeredDirectorNoteIds: [...new Set(offeredDirectorNoteIds || [])],
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
    const tavernConnection = route.mode === 'tavern' ? getCurrentTavernConnectionInfo() : null;
    runtime.lastTaskConnection = {
        taskKind,
        routeKey: route.routeKey,
        route: route.route,
        apiLabel: route.mode === 'custom'
            ? route.label
            : route.mode === 'tavern-profile'
                ? route.label
                : '跟随当前酒馆',
        model: route.mode === 'custom'
            ? String(requestSettings.customApiModel || '模型尚未配置')
            : route.mode === 'tavern-profile'
                ? String(route.profile?.model || '方案模型不可用')
                : String(tavernConnection?.model || '跟随酒馆当前模型'),
        method: route.mode === 'custom'
            ? (requestSettings.customApiTransport === 'direct' ? '浏览器直连' : '酒馆 Custom 转发')
            : route.mode === 'tavern-profile'
                ? '酒馆已保存方案'
                : '酒馆独立上下文',
        source: route.mode === 'custom'
            ? 'custom-independent'
            : route.mode === 'tavern-profile'
                ? String(route.profile?.api || 'tavern-profile')
                : tavernConnection?.source || 'tavern',
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
    const foregroundNeutralTask = ['public-opinion-sandbox', 'lingqi', 'social'].includes(taskKind);

    if (route.mode === 'tavern-profile') {
        const profileId = String(route.profileId || '');
        if (!profileId) throw new Error('还没选择酒馆已保存的 API 方案');
        if (tavernConnectionManagerDisabled(context)) {
            throw new Error('SillyTavern 的 Connection Manager 当前不可用，不能读取已保存 API 方案');
        }
        if (!route.profile) {
            throw new Error(`酒馆已保存方案已不存在（ID: ${profileId}）。我没有偷偷换成别的连接，请重新选择。`);
        }
        const service = context?.ConnectionManagerRequestService;
        if (typeof service?.sendRequest !== 'function') {
            throw new Error('当前 SillyTavern 没有提供连接方案请求服务；请更新 SillyTavern 或改用其他连接方式');
        }

        if (!foregroundNeutralTask) runtime.inBackgroundGeneration = true;
        const guard = createActiveGenerationGuard(effectiveTimeoutMs, signal, taskKind);
        try {
            runtime.syncStatus.method = `${route.label} · 酒馆已保存方案`;
            resetLastCustomApiOperation();
            const result = await runInConnectionLane(taskKind, guard.signal, () => service.sendRequest(
                profileId,
                messages,
                effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined,
                {
                    stream: false,
                    signal: guard.signal,
                    extractData: true,
                    includePreset: false,
                    includeInstruct: true,
                },
                {
                    temperature,
                    include_reasoning: false,
                },
            ));
            const text = typeof result === 'string'
                ? result
                : typeof result?.content === 'string'
                    ? result.content
                    : '';
            if (!String(text || '').trim()) {
                throw new Error(`酒馆方案“${route.label}”没有返回可用正文`);
            }
            return String(text).trim();
        } catch (error) {
            if (guard.timedOut()) {
                const timeoutError = new Error(`酒馆方案“${route.label}”请求超时（${Math.ceil(effectiveTimeoutMs / 1000)} 秒）`);
                timeoutError.code = 'GENERATION_TIMEOUT';
                timeoutError.errorType = 'timeout';
                throw timeoutError;
            }
            const cause = error?.cause;
            if (cause && String(error?.message || '') === 'API request failed') {
                const wrapped = new Error(`酒馆方案“${route.label}”请求失败：${String(cause?.message || cause)}`);
                wrapped.cause = error;
                wrapped.errorType = classifyDiagnosticIssue(wrapped.message);
                throw wrapped;
            }
            throw error;
        } finally {
            guard.cleanup();
            if (!foregroundNeutralTask) runtime.inBackgroundGeneration = false;
            refreshInjection();
        }
    }

    if (route.mode === 'custom') {
        if (!foregroundNeutralTask) runtime.inBackgroundGeneration = true;
        try {
            runtime.syncStatus.method = requestSettings.customApiTransport === 'direct'
                ? `${route.label} · 浏览器直连`
                : `${route.label} · 酒馆转发`;
            return await runInConnectionLane(taskKind, signal, () => requestCustomCompletion(requestSettings, messages, {
                fetchImpl: globalThis.fetch.bind(globalThis),
                getRequestHeaders: () => context?.getRequestHeaders?.() || {},
                maxTokens: effectiveMaxTokens,
                temperature,
                timeoutMs: effectiveTimeoutMs,
                signal,
                rejectTruncated,
                operation: taskKind,
                routeLabel: route.label,
            }));
        } catch (error) {
            if (error?.code !== 'OUTPUT_TRUNCATED' && error?.errorType !== 'output-limit') throw error;
            const pluginLimited = effectiveMaxTokens > 0;
            const capHint = limits.tokenSource === 'module'
                ? '当前模块 Token 上限限制了这次请求'
                : '全局 Token 上限限制了这次请求';
            const wrapped = new Error(pluginLimited
                ? `${String(error?.message || error)}；插件实际输出上限 ${effectiveMaxTokens} Token，${capHint}。可把对应 Token 上限设为 0（自动）或调高后重试。`
                : `${String(error?.message || error)}；插件未设置输出 Token 上限，本次截断来自模型、上游服务或酒馆当前连接本身的输出边界。`);
            Object.assign(wrapped, error, {
                cause: error,
                code: error?.code || 'OUTPUT_TRUNCATED',
                errorType: 'output-limit',
                effectiveMaxTokens,
                tokenLimitSource: limits.tokenSource,
            });
            throw wrapped;
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
    if (taskKind === 'lingqi' && typeof context?.generateRaw !== 'function') {
        throw new Error('当前酒馆版本没有提供独立上下文玲七聊天接口；请更新 SillyTavern 或为世界背面配置独立 API');
    }
    if (taskKind === 'social' && typeof context?.generateRaw !== 'function') {
        throw new Error('当前酒馆版本没有提供独立上下文社交回复接口；请更新 SillyTavern 或为世界背面配置独立 API');
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
                responseLength: effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined,
                trimNames: false,
                signal: requestSignal,
            });
        } else {
            runtime.syncStatus.method = '安静生成兼容模式';
            request = context.generateQuietPrompt({
                quietPrompt: `${messages[0]?.content || ''}\n\n${messages[1]?.content || ''}`.trim(),
                skipWIAN: true,
                responseLength: effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined,
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
    const dataEpochAtStart = runtime.dataEpoch;
    const contextEpochAtStart = runtime.contextEpoch;
    const taskStillCurrent = () => (
        currentChatToken() === chatTokenAtStart
        && runtime.dataEpoch === dataEpochAtStart
        && runtime.contextEpoch === contextEpochAtStart
    );
    if (job?.chatToken && job.chatToken !== chatTokenAtStart) return null;
    if (job?.dataEpoch !== undefined && job.dataEpoch !== dataEpochAtStart) return null;

    const writerSettled = await waitForCoreStateWritersToSettle({
        chatToken: chatTokenAtStart,
        dataEpoch: dataEpochAtStart,
        contextEpoch: contextEpochAtStart,
    });
    if (!writerSettled) return null;

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
        offeredDirectorNoteIds: job?.offeredDirectorNoteIds ?? beforeData?.offeredDirectorNoteIds,
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
    const offeredDirectorNoteIds = prepared.data.offeredDirectorNoteIds || [];
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
            if (!target || !taskStillCurrent()) {
                if (taskStillCurrent()) {
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

        const backgroundPersonTargets = listDueBackgroundPeople(baseState, {
            maximum: settings.backgroundNpcBudget,
            requiredOnly: !settings.enhancedBackgroundSimulation,
        });
        const worldCoverageTargets = selectWorldCoverageTargets(baseState, {
            customInstruction: settings.customSimulationInstruction,
            maximum: settings.worldPulseActivity === 'busy' ? 3 : 2,
        });
        const prompt = buildSimulationPrompt(baseState, {
            queuedEventIds: offeredEventIds,
            trigger,
            latestTurn: narrative.latestTurn,
            narrativeTurns: narrative.turns,
            userName: beforeContext?.name1 || '',
            includeUserInnerVoice: false,
            recordPlayerCharacter: settings.recordPlayerCharacter,
            timePolicy: settings.timePolicy,
            worldAuto: settings.worldAutoEnabled,
            simulationMode: settings.autoSimulationMode,
            customInstruction: settings.customSimulationInstruction,
            playerIdentityAnchor: getPlayerIdentityAnchor(baseState),
            newAssistantTurns: Math.max(1, survivingNewCount),
            backgroundNpcBudget: settings.backgroundNpcBudget,
            worldPulseActivity: settings.worldPulseActivity,
            enhancedBackgroundSimulation: settings.enhancedBackgroundSimulation,
            backgroundPersonTargets,
            worldCoverageTargets,
directorNotes: normalizeLingqiState(getStore().lingqi || emptyLingqiState()).notes
                .filter(note => offeredDirectorNoteIds.includes(note.id) && note.status !== 'cancelled')
                .map(note => ({
                    ...note,
                    consumed: Boolean(sourceKey && note.lastAppliedSourceKey === sourceKey),
                })),
        });

        const automaticMaxTokens = settings.autoSimulationMode === 'deep'
            ? 4600
            : settings.autoSimulationMode === 'light'
                ? 2400
                : 3400;
        const baseMaxTokens = primarySimulationRequestBudget(settings, automaticMaxTokens);
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
                    turn_summaries: [],
                    facts_upsert: [],
                    facts_invalidate: [],
                    clues_upsert: [],
                    clues_resolve: [],
                },
                memoryUpdate: {
                    turnSummaries: [],
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
            allowUserInnerVoice: false,
            recordPlayerCharacter: settings.recordPlayerCharacter,
            timePolicy: settings.timePolicy,
            narrativeText: newAssistantTexts.join('\n'),
            backgroundNpcBudget: settings.backgroundNpcBudget,
            lifeSettlementTargetIds: backgroundPersonTargets.map(person => person.id),
            memorySummaryMessageIds: memoryEnabledAtCommit ? pendingMessageIds : [],
        });
        // Manual deletion is an author decision, not a temporary UI filter.
        // Apply both exact-id and near-duplicate tombstones before snapshots are
        // written, so a model cannot resurrect the same current under a new id.
        resultState = applyManualDeletionFilters(resultState, getStore());
        resultState = markWorldCoverageChecked(resultState, worldCoverageTargets, {
            publicCycle: false,
            customInstruction: settings.customSimulationInstruction,
        });
        if (memoryEnabledAtCommit) {
            resultState = advanceMemoryCursorThroughSummaries(resultState, messageId);
        }
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
        if (!target || !taskStillCurrent()) {
            if (taskStillCurrent()) {
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
            store.lingqi = applyLingqiDirectorResult(
                store.lingqi || emptyLingqiState(),
                applicablePayload.director_note_updates || applicablePayload.directorNoteUpdates || [],
                { offeredNoteIds: offeredDirectorNoteIds, sourceKey },
            );
            saveStore(store, { immediate: true });
            refreshInjection();
            runtime.ui?.render();
            schedulePublicPostProcessing(resultState, {
                impactDelay: 160,
                opinionDelay: 620,
            });
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
            const target = taskStillCurrent()
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
            if (taskStillCurrent()) {
                const store = getStore();
                store.currentState = trimState(markPendingSync(store.currentState, true));
                saveStore(store);
                refreshInjection();
                runtime.ui?.render();
            }
            if (taskStillCurrent()) {
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
        const issueType = error?.errorType || classifyDiagnosticIssue(errorMessage);
        const visibleError = issueType === 'output-limit'
            ? '本次推演内容超过当前输出上限，模型返回被截断；本轮没有提交任何世界状态。可在「生成限制」提高世界推演 Token 上限后再试。'
            : errorMessage;
        if (issueType === 'output-limit') {
            console.warn('[世界背面] 世界推演输出被截断，已丢弃未闭合结果：', errorMessage);
        }
        const target = taskStillCurrent()
            ? locateTargetBranch(messageId, swipeId, expectedHash)
            : null;
        if (target) {
            const failed = {
                ...prepared.data,
                status: 'error',
                error: visibleError,
            };
            attachBranchData(target.message, swipeId, failed);
            await target.context.saveChat?.();
        }

        if (taskStillCurrent()) {
            const store = getStore();
            store.currentState = trimState(markPendingSync(store.currentState, true));
            saveStore(store);
            refreshInjection();
            runtime.ui?.render();
        }

        if (taskStillCurrent()) {
            setSyncStatus({
                phase: 'error',
                message: issueType === 'output-limit'
                    ? '本次推演输出过长，截断结果已安全丢弃'
                    : '世界推演没有完成',
                error: visibleError,
                method: runtime.syncStatus.method,
            });
            toast(
                issueType === 'output-limit'
                    ? '推演输出被截断；本轮人物、事件、记忆和世界时间均未提交。'
                    : `世界推演没有完成：${visibleError}`,
                'warning',
            );
        }
        throw error;
    } finally {
        if (runtime.activeSimulation === activeSimulation) {
            runtime.activeSimulation = null;
        }
        setBusy(false);
    }
}


function manualSimulationBlockerLabels() {
    const labels = [];
    if (runtime.activeHistoryScan && !runtime.activeHistoryScan.signal?.aborted) {
        labels.push(runtime.historyProgress?.kind === 'world-bootstrap' ? '历史回溯' : '记忆整理');
    }
    if (runtime.activeWorldPulse?.controller && !runtime.activeWorldPulse.controller.signal.aborted) {
        labels.push('世界脉搏');
    }
    if (runtime.activePublicImpact?.controller && !runtime.activePublicImpact.controller.signal.aborted) {
        labels.push('公共影响');
    }
    if (runtime.activeCorrection?.controller && !runtime.activeCorrection.controller.signal.aborted) {
        labels.push('事实纠错');
    }
    if (
        runtime.publicOpinionRefreshTransaction?.controller
        && !runtime.publicOpinionRefreshTransaction.controller.signal.aborted
    ) {
        labels.push('舆情刷新');
    } else if (
        runtime.activePublicOpinion?.controller
        && !runtime.activePublicOpinion.controller.signal.aborted
    ) {
        labels.push('舆情刷新');
    }
    if (
        runtime.activePublicOpinionSandbox?.controller
        && !runtime.activePublicOpinionSandbox.controller.signal.aborted
    ) {
        labels.push('随便逛逛');
    }
    if (
        runtime.activeObservation?.controller
        && !runtime.activeObservation.controller.signal.aborted
    ) {
        labels.push('人物观测');
    }
    if (
        runtime.activeLingqi?.controller
        && !runtime.activeLingqi.controller.signal.aborted
    ) {
        labels.push('玲七');
    }
    // Connection tests and a few short maintenance calls only expose the shared
    // busy counter. They still should not race a manual world simulation.
    if (
        runtime.simulationCount > 0
        && !runtime.activeSimulation
        && labels.length === 0
    ) {
        labels.push('当前后台操作');
    }
    return [...new Set(labels)];
}

function clearDeferredManualSimulation() {
    if (runtime.manualSimulationTimer !== null) {
        window.clearTimeout(runtime.manualSimulationTimer);
        runtime.manualSimulationTimer = null;
    }
    runtime.pendingManualSimulation = null;
}

function scheduleDeferredManualSimulation(delay = 160, expectedChatToken = currentChatToken()) {
    const request = runtime.pendingManualSimulation;
    if (!request) return false;

    if (runtime.manualSimulationTimer !== null) {
        window.clearTimeout(runtime.manualSimulationTimer);
        runtime.manualSimulationTimer = null;
    }

    runtime.manualSimulationTimer = window.setTimeout(() => {
        runtime.manualSimulationTimer = null;
        const current = runtime.pendingManualSimulation;
        if (!current) return;

        if (
            current.chatToken !== expectedChatToken
            || current.chatToken !== currentChatToken()
            || current.dataEpoch !== runtime.dataEpoch
            || current.contextEpoch !== runtime.contextEpoch
        ) {
            clearDeferredManualSimulation();
            return;
        }

        const blockers = manualSimulationBlockerLabels();
        if (
            blockers.length
            || runtime.activeSimulation
            || runtime.queuedSimulations.size > 0
        ) {
            setSyncStatus({
                phase: 'queued',
                message: blockers.length
                    ? `推演已排队，等${blockers.join('、')}结束后自动开始`
                    : '推演已排队，等当前世界推演结束后自动开始',
                error: '',
            });
            scheduleDeferredManualSimulation(Math.min(520, Math.max(180, Number(delay) + 80)), expectedChatToken);
            return;
        }

        const latest = latestAssistantEntry();
        const forceReplay = Boolean(current.forceReplay);
        if (!latest) {
            clearDeferredManualSimulation();
            setSyncStatus({
                phase: 'idle',
                message: '排队期间没有找到可推演的 AI 正文，本次排队已取消',
                error: '',
            });
            return;
        }

        const pendingNow = pendingAssistantEntriesThrough(latest.index).length;
        if (pendingNow <= 0 && !forceReplay) {
            clearDeferredManualSimulation();
            setSyncStatus({
                phase: 'success',
                message: '排队期间世界已经由其他推演追上，本次不重复请求',
                error: '',
            });
            runtime.ui?.render();
            return;
        }

        const pendingCount = Math.max(1, pendingNow);
        clearDeferredManualSimulation();
        void queueSimulation(latest.index, {
            force: forceReplay,
            trigger: 'manual-deferred',
            newAssistantCount: pendingCount,
        }).then(
            () => {
                toast(
                    pendingCount > 1
                        ? `排队的推演已经完成，共追上 ${pendingCount} 轮正文。`
                        : '排队的世界推演已经完成。',
                    'success',
                );
            },
            () => undefined,
        );
    }, Math.max(80, Number(delay) || 160));

    return true;
}

async function requestManualWorldSimulation() {
    const settings = getSettings();
    if (!settings.worldSimulationEnabled) {
        toast('世界推演模块当前已停用。', 'warning');
        return { queued: false, started: false };
    }

    const latest = latestAssistantEntry();
    if (!latest) {
        toast('当前聊天还没有可推演的 AI 正文。', 'warning');
        return { queued: false, started: false };
    }

    if (
        runtime.pendingManualSimulation
        && runtime.pendingManualSimulation.chatToken === currentChatToken()
    ) {
        const blockers = manualSimulationBlockerLabels();
        setSyncStatus({
            phase: 'queued',
            message: blockers.length
                ? `推演已经排队，等${blockers.join('、')}结束后自动开始`
                : '推演已经排队，正在等当前世界任务结束',
            error: '',
        });
        return { queued: true, started: false };
    }

    const blockers = manualSimulationBlockerLabels();
    if (
        blockers.length
        || runtime.activeSimulation
        || runtime.queuedSimulations.size > 0
    ) {
        const pendingAtRequest = pendingAssistantEntriesThrough(latest.index).length;
        runtime.pendingManualSimulation = {
            chatToken: currentChatToken(),
            dataEpoch: runtime.dataEpoch,
            contextEpoch: runtime.contextEpoch,
            requestedAt: Date.now(),
            // If there was nothing pending when the user clicked, this was an
            // intentional manual replay. Otherwise a concurrent/automatic catch-up
            // may satisfy the request while it waits, and we must not run twice.
            forceReplay: pendingAtRequest <= 0,
        };
        setSyncStatus({
            phase: 'queued',
            message: blockers.length
                ? `推演已排队，等${blockers.join('、')}结束后自动开始`
                : '推演已排队，等当前世界推演结束后自动开始',
            error: '',
        });
        scheduleDeferredManualSimulation(140, currentChatToken());
        runtime.ui?.render();
        return { queued: true, started: false };
    }

    const pendingCount = Math.max(
        1,
        pendingAssistantEntriesThrough(latest.index).length,
    );
    try {
        await queueSimulation(latest.index, {
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
        return { queued: false, started: true };
    } catch {
        // runSimulationForMessage already recorded and displayed the detailed error.
        return { queued: false, started: false };
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
        dataEpoch: runtime.dataEpoch,
        trigger: options.trigger || 'reply',
        force: Boolean(options.force),
        newAssistantCount: Math.max(1, Number(options.newAssistantCount) || 1),
        offeredEventIds: clone(
            options.offeredEventIds
            ?? branch?.offeredEventIds
            ?? runtime.generationOffer.eventIds
            ?? [],
        ),
        offeredDirectorNoteIds: clone(
            options.offeredDirectorNoteIds
            ?? branch?.offeredDirectorNoteIds
            ?? runtime.generationOffer.directorNoteIds
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
    if (numericMessageId > runtime.autoCatchUpSuppressedThroughMessageId) {
        runtime.autoCatchUpSuppressedThroughMessageId = -1;
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
    if (latest.index <= runtime.autoCatchUpSuppressedThroughMessageId) return;
    if (latest.index <= Number(afterMessageId)) return;
    const pending = pendingAssistantEntriesThrough(latest.index);
    if (pending.length < settings.autoSimulationInterval) return;
    void queueSimulation(latest.index, {
        trigger: 'interval-catch-up',
        newAssistantCount: pending.length,
    }).catch(() => undefined);
}

function hasL0SummaryForMessage(state, messageId) {
    return (state?.storyMemory?.summaries || []).some(summary => (
        Number(summary?.level) === 0
        && Number(summary?.startMessageId) === Number(messageId)
        && Number(summary?.endMessageId) === Number(messageId)
    ));
}

function advanceMemoryCursorThroughSummaries(state, throughMessageId) {
    if (!state?.storyMemory) return state;
    const chat = getContext()?.chat || [];
    const target = Math.min(chat.length - 1, Math.max(-1, Number(throughMessageId) || -1));
    let cursor = Math.max(-1, Number(state.storyMemory.indexedThroughMessageId ?? -1));
    for (let index = cursor + 1; index <= target; index += 1) {
        const message = chat[index];
        if (
            hasUsableAssistantText(message)
            && !hasL0SummaryForMessage(state, index)
        ) break;
        cursor = index;
    }
    if (cursor > Number(state.storyMemory.indexedThroughMessageId ?? -1)) {
        state.storyMemory.indexedThroughMessageId = cursor;
        state.storyMemory.indexedAt = new Date().toISOString();
    }
    return state;
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
    const offeredDirectorNoteIds = clone(runtime.generationOffer.directorNoteIds || []);
    if (offeredDirectorNoteIds.length) {
        const swipeId = Number(message.swipe_id ?? 0);
        const sourceKey = branchSourceKey(Number(messageId), message, swipeId);
        const store = getStore();
        store.lingqi = consumeLingqiDirectorOffer(store.lingqi || emptyLingqiState(), {
            offeredNoteIds: offeredDirectorNoteIds,
            sourceKey,
        });
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.ui?.render();
    }
    const settings = getSettings();
    scheduleAutoSync(Number(messageId), type);
    const worldOwnsThisBatch = Boolean(
        settings.enabled
        && settings.worldSimulationEnabled
        && settings.worldAutoEnabled
        && (
            runtime.activeSimulation
            || runtime.queuedSimulations.size > 0
            || pendingAssistantEntriesThrough(Number(messageId)).length >= settings.autoSimulationInterval
        )
    );
    if (!worldOwnsThisBatch) {
        scheduleAutoMemoryIndex();
    }
}

async function runPreGenerationConsistencyBarrier(_chat, _contextSize, _abort, type) {
    const settings = getSettings();
    if (
        runtime.consistencyBarrierRunning
        || ['quiet', 'impersonate', 'first_message'].includes(type)
    ) {
        return;
    }

    const offerCurrentInjection = () => {
        offerGenerationInjection(type);
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
    const pluginWorkAlreadyRunning = coreAlreadyRunning || activeBackgroundTaskLabels()
        .some(label => label !== '玲七');

    // Consistency Barrier is a gate, not a hidden auto-run trigger.
    // It may wait for work that is already due/running, but it must not bypass
    // the user's auto-run switch or configured "every N turns" interval.
    const autoTaskIsDue = Boolean(
        settings.worldAutoEnabled
        && pending.length >= settings.autoSimulationInterval
    );

    if (!pending.length && !pluginWorkAlreadyRunning) {
        if (pendingPublicImpactEvents(getState(), { maximum: 8 }).length) {
            scheduleDeferredPublicImpact(220, currentChatToken());
        }
        offerCurrentInjection();
        return;
    }

    if (pluginWorkAlreadyRunning) {
        const stopped = cancelActiveBackgroundTasks({ preserveLingqi: true });
        setSyncStatus({
            phase: 'pending',
            message: stopped.cancelled
                ? '正文生成优先：后台推演已经让路，未完成结果不会提交；新回复出来后再按频率继续'
                : '正文生成优先：本轮直接沿用上一份已确认世界状态',
            error: '',
        });
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

    // Even when automatic simulation is due, foreground prose must never wait
    // for a plugin model call. MESSAGE_RECEIVED will schedule the accumulated
    // world work after the new assistant reply has completed.
    setSyncStatus({
        phase: 'pending',
        message: `已有 ${pending.length} 轮正文到达推演频率；本次正文先生成，完成后再继续后台推演`,
        error: '',
    });
    offerCurrentInjection();
}

globalThis.worldBackstageGenerationInterceptor = runPreGenerationConsistencyBarrier;

function onGenerationStarted(type, _options, dryRun) {
    if (dryRun || ['quiet', 'impersonate', 'first_message'].includes(type)) return;
    const offer = offerGenerationInjection(type);
    if (!String(runtime.injection.text || '').trim()) return;
    toast(
        offer.rerollBase
            ? '旧重 roll 分支的资料已撤回；本轮正文收到的是重 roll 前的世界状态。'
            : '世界背面资料已递给本轮正文。',
        'success',
    );
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
            offeredDirectorNoteIds: clone(runtime.injection.directorNoteIds || []),
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
    runtime.activeLingqi?.controller?.abort?.();
    runtime.activePublicOpinion = null;
    runtime.activePublicOpinionSandbox = null;
    runtime.activeObservation = null;
    runtime.activeLingqi = null;
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
    if (runtime.socialPulseTimer !== null) {
        window.clearTimeout(runtime.socialPulseTimer);
        runtime.socialPulseTimer = null;
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
    runtime.lingqiStatus = {
        phase: 'idle',
        message: '玲七在这里等你～',
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
    previousManualDeletions = null,
} = {}) {
    if (runtime.manualUndoTimer !== null) window.clearTimeout(runtime.manualUndoTimer);
    runtime.manualUndo = {
        state: clone(previousState),
        previousInitialState: previousInitialState ? clone(previousInitialState) : null,
        previousManualDeletions: previousManualDeletions
            ? clone(previousManualDeletions)
            : null,
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
    if (undo.previousManualDeletions) {
        store.manualDeletions = normalizeManualDeletions(undo.previousManualDeletions);
    }
    const monotonicUndoState = ensureMonotonicRevision(undo.state, store.currentState);
    store.currentState = applyPlayerCharacterRecordingPolicy(
        applyManualDeletionFilters(monotonicUndoState, store),
        getSettings(),
    );
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

function commitManualState(nextState, message = '世界状态已更新', {
    mutateStore = null,
} = {}) {
    const key = currentAnchorKey();
    const store = getStore();
    const previousState = clone(store.currentState);
    const previousManualDeletions = clone(
        normalizeManualDeletions(store.manualDeletions),
    );
    if (typeof mutateStore === 'function') mutateStore(store);
    const committed = setCurrentState(nextState, { overrideKey: key });
    armManualUndo(previousState, {
        key,
        previousManualDeletions,
    });
    schedulePublicPostProcessing(committed, {
        impactDelay: 160,
        opinionDelay: 620,
    });
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
    const nowMs = Date.now();
    const currentApiTimeline = runtime.apiRequestTimeline
        .filter(item => item.chatToken === currentChatToken());
    const requestStartedAtMs = item => {
        const value = Date.parse(item.startedAt || item.queuedAt || '');
        return Number.isFinite(value) ? value : 0;
    };
    const requestsInWindow = milliseconds => currentApiTimeline.filter(item => (
        requestStartedAtMs(item) > 0
        && nowMs - requestStartedAtMs(item) <= milliseconds
    ));
    const recentFiveMinuteRequests = requestsInWindow(5 * 60 * 1000);
    const recentByTask = recentFiveMinuteRequests.reduce((result, item) => {
        const key = String(item.taskKind || 'unknown');
        result[key] = (result[key] || 0) + 1;
        return result;
    }, {});
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
            transport: settings.apiMode === 'custom'
                ? settings.customApiTransport
                : settings.apiMode === 'tavern-profile'
                    ? 'tavern-profile'
                    : 'tavern',
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
            tavernProfileCount: listTavernConnectionProfiles().length,
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
        apiCadence: {
            last60Seconds: requestsInWindow(60 * 1000).length,
            last5Minutes: recentFiveMinuteRequests.length,
            byTaskLast5Minutes: recentByTask,
            queuedPhysicalRoutes: runtime.connectionLanes.size,
        },
        recentApiRequests: runtime.apiRequestTimeline
            .filter(item => item.chatToken === currentChatToken())
            .slice(-20)
            .map(item => ({
            taskKind: item.taskKind,
            route: redactDiagnosticText(item.route || ''),
            model: redactDiagnosticText(item.model || ''),
            queuedAt: item.queuedAt,
            startedAt: item.startedAt,
            finishedAt: item.finishedAt,
            waitMs: item.waitMs,
            durationMs: item.durationMs,
            outcome: item.outcome,
        })),
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
    scheduleOpinion = true,
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
        || runtime.activePublicOpinion
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
                recordPlayerCharacter: settings.recordPlayerCharacter,
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
                recordPlayerCharacter: settings.recordPlayerCharacter,
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
            if (scheduleOpinion) scheduleAutoPublicOpinion(next, 180);

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

function setPersonLifePriority(personId, enabled = true) {
    const id = String(personId || '').trim();
    if (!id) throw new Error('没有找到这个人物');
    const next = clone(getState());
    const person = next.people.find(item => item.id === id);
    if (!person) throw new Error('没有找到这个人物');
    if (person.isUser) throw new Error('玩家角色不使用后台人物生活结算');
    if (person.simulationEnabled === false) {
        throw new Error('这个人物的镜头外推演已经关闭；先在人物卡里开启“参与镜头外推演”');
    }
    person.lifeTickPriority = Boolean(enabled);
    person.lifeTickPriorityAt = enabled ? Number(next.clock?.absoluteMinute || 0) : 0;
    commitManualState(
        next,
        enabled
            ? `${person.name} 已经排到下一轮后台人物结算前面啦～`
            : `${person.name} 已取消下一轮优先。`,
    );
    return {
        personId: person.id,
        enabled: person.lifeTickPriority,
    };
}

async function runPersonLifeCatchUp(personId) {
    const id = String(personId || '').trim();
    if (!id) throw new Error('没有找到这个人物');
    const settings = getSettings();
    if (!settings.enabled || !settings.worldSimulationEnabled) {
        throw new Error('世界推演现在关着，先打开后才能补人物近况');
    }
    if (coreSimulationBusy()) {
        throw new Error('现在还有世界推演或后台结算在跑，等这一轮结束再补她的近况');
    }
    const person = getState().people.find(item => item.id === id);
    if (!person) throw new Error('没有找到这个人物');
    if (person.isUser) throw new Error('玩家角色不使用后台人物生活结算');
    if (person.simulationEnabled === false) {
        throw new Error('这个人物的镜头外推演已经关闭；先在人物卡里开启“参与镜头外推演”');
    }
    setBusy(true);
    try {
        const completed = await runWorldPulseTick({
            reason: `手动补推演人物：${person.name}`,
            quiet: false,
            force: true,
            publicCycle: false,
            personTargetId: person.id,
        });
        if (!completed) throw new Error('这次人物补推演没有完成，旧状态保持不变');
        return true;
    } finally {
        setBusy(false);
    }
}

async function runWorldPulseTick({
    reason = '主世界时间已推进',
    quiet = false,
    force = false,
    publicCycle = false,
    personTargetId = '',
} = {}) {
    const settings = getSettings();
    const requestedPersonTargetId = String(personTargetId || '').trim();
    const requestedPersonTarget = requestedPersonTargetId
        ? getState().people.find(item => item.id === requestedPersonTargetId) || null
        : null;
    const manualPersonCatchUp = Boolean(requestedPersonTargetId);
    if (manualPersonCatchUp) {
        if (!requestedPersonTarget) throw new Error('没有找到这个人物');
        if (requestedPersonTarget.isUser) throw new Error('玩家角色不使用后台人物生活结算');
        if (requestedPersonTarget.simulationEnabled === false) {
            throw new Error('这个人物的镜头外推演已经关闭');
        }
    }
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
            message: manualPersonCatchUp
                ? `我去补一下 ${requestedPersonTarget.name} 这段时间的近况～`
                : '世界脉搏正在检查镜头外的变化～',
            error: '',
        });
    }
    try {
        const state = getState();
        const baseRevision = Math.max(0, Number(state?.revision) || 0);
        const effectiveBackgroundNpcBudget = manualPersonCatchUp ? 1 : settings.backgroundNpcBudget;
        const backgroundPersonTargets = manualPersonCatchUp
            ? [{
                id: requestedPersonTarget.id,
                name: requestedPersonTarget.name,
                overdueMinutes: Math.max(0, Number(state.clock?.absoluteMinute || 0) - Number(requestedPersonTarget.lastLifeTickAt ?? requestedPersonTarget.updatedAt ?? state.clock?.absoluteMinute ?? 0)),
                priorityReason: 'manual-now',
            }]
            : listDueBackgroundPeople(state, {
                maximum: settings.backgroundNpcBudget,
                requiredOnly: !settings.enhancedBackgroundSimulation,
            });
        const worldCoverageTargets = manualPersonCatchUp
            ? []
            : selectWorldCoverageTargets(state, {
                customInstruction: settings.customSimulationInstruction,
                maximum: settings.worldPulseActivity === 'busy' ? 3 : 2,
            });
        const prompt = buildWorldPulsePrompt(state, {
            activity: manualPersonCatchUp ? 'quiet' : settings.worldPulseActivity,
            reason,
            backgroundNpcBudget: effectiveBackgroundNpcBudget,
            publicCycle: manualPersonCatchUp ? false : publicCycle,
            customInstruction: manualPersonCatchUp ? '' : settings.customSimulationInstruction,
            enhancedBackgroundSimulation: manualPersonCatchUp ? false : settings.enhancedBackgroundSimulation,
            backgroundPersonTargets,
            worldCoverageTargets,
            recordPlayerCharacter: settings.recordPlayerCharacter,
        });
        const baseMaxTokens = manualPersonCatchUp
            ? 2400
            : settings.worldPulseActivity === 'busy'
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
                `world-pulse:${chatToken}:${getState().clock?.absoluteMinute ?? -1}:${manualPersonCatchUp ? `person:${requestedPersonTargetId}` : publicCycle ? 'public' : 'normal'}:${reason}`,
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

        let payloadForCommit = payload;
        if (manualPersonCatchUp) {
            const returnedPeople = Array.isArray(payload?.people_upsert)
                ? payload.people_upsert
                : Array.isArray(payload?.peopleUpsert)
                    ? payload.peopleUpsert
                    : [];
            const targetPeople = returnedPeople.filter(item => (
                String(item?.id || '') === requestedPersonTargetId
            ));
            if (!targetPeople.length) {
                throw new Error(`人物补推演没有返回 ${requestedPersonTarget.name} 的状态，本轮已丢弃，旧数据不会被改动`);
            }

            // 单人物补推演不是一次缩小版“全世界推演”。模型即使越界返回了
            // 其他人物或宏观脉搏，提交前也会被本地防火墙挡掉。与指定人物
            // 直接关联的既有/新事件仍允许更新，保证她不是被从世界里单独拎出来。
            const targetRefs = new Set([requestedPersonTargetId, String(requestedPersonTarget.name || '')].filter(Boolean));
            const eventTouchesTarget = event => {
                const actors = Array.isArray(event?.actors) ? event.actors.map(String) : [];
                if (actors.some(actor => targetRefs.has(actor))) return true;
                const causedBy = String(event?.caused_by ?? event?.causedBy ?? '');
                return Boolean(causedBy && relatedEventIds.has(causedBy));
            };
            const relatedEventIds = new Set(
                (Array.isArray(state.events) ? state.events : [])
                    .filter(event => {
                        const actors = Array.isArray(event?.actors) ? event.actors.map(String) : [];
                        return actors.some(actor => targetRefs.has(actor));
                    })
                    .map(event => String(event.id || ''))
                    .filter(Boolean),
            );
            const rawCreates = Array.isArray(payload?.events_create)
                ? payload.events_create
                : Array.isArray(payload?.eventsCreate)
                    ? payload.eventsCreate
                    : [];
            const rawUpdates = Array.isArray(payload?.events_update)
                ? payload.events_update
                : Array.isArray(payload?.eventsUpdate)
                    ? payload.eventsUpdate
                    : [];
            const eventCreates = rawCreates.filter(eventTouchesTarget);
            const eventUpdates = rawUpdates.filter(event => (
                relatedEventIds.has(String(event?.id || ''))
                || eventTouchesTarget(event)
            ));
            const allowedEventIds = new Set([
                ...relatedEventIds,
                ...eventCreates.map(event => String(event?.id || '')).filter(Boolean),
                ...eventUpdates.map(event => String(event?.id || '')).filter(Boolean),
            ]);
            const rawFacts = Array.isArray(payload?.world_facts_upsert)
                ? payload.world_facts_upsert
                : Array.isArray(payload?.worldFactsUpsert)
                    ? payload.worldFactsUpsert
                    : [];
            const worldFacts = rawFacts.filter(fact => (
                String(fact?.subject_id ?? fact?.subjectId ?? '') === requestedPersonTargetId
                || String(fact?.subject ?? '') === String(requestedPersonTarget.name || '')
                || allowedEventIds.has(String(fact?.event_id ?? fact?.eventId ?? ''))
            ));

            payloadForCommit = {
                ...payload,
                people_upsert: targetPeople,
                peopleUpsert: targetPeople,
                people_remove: [],
                peopleRemove: [],
                events_create: eventCreates,
                eventsCreate: eventCreates,
                events_update: eventUpdates,
                eventsUpdate: eventUpdates,
                world_facts_upsert: worldFacts,
                worldFactsUpsert: worldFacts,
                world_pulse_upsert: [],
                worldPulseUpsert: [],
                deliveries_confirmed: [],
                deliveriesConfirmed: [],
                consistency_conflicts: [],
                consistencyConflicts: [],
            };
        }

        let next = applySimulationResult(state, {
            ...payloadForCommit,
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
            sourceKey: manualPersonCatchUp
                ? `person-catchup:${requestedPersonTargetId}:${Date.now()}`
                : `world-pulse:${Date.now()}`,
            userName: getContext()?.name1 || '',
            allowUserInnerVoice: false,
            recordPlayerCharacter: settings.recordPlayerCharacter,
            timePolicy: settings.timePolicy,
            narrativeText: '',
            backgroundNpcBudget: effectiveBackgroundNpcBudget,
            lifeSettlementTargetIds: backgroundPersonTargets.map(person => person.id),
            preserveCommitAnchor: true,
        });
        if (!manualPersonCatchUp) {
            next = markWorldCoverageChecked(next, worldCoverageTargets, {
                publicCycle,
                customInstruction: settings.customSimulationInstruction,
            });
            if (publicCycle) {
                // 公共世界巡查已经在同一份模型结果里结算直接客观后果与真实
                // 获知渠道；为本轮公开表面建立传播指纹，避免紧接着再打一份
                // 公共影响 API。之后公开信息真正变化时仍会产生新的指纹。
                next = markCurrentPublicImpactsProcessed(next, {
                    reason: 'public-cycle-integrated-impact',
                });
            }
        }

        const store = getStore();
        const anchorKey = state.lastCommit?.sourceKey || 'root';
        store.currentState = ensureMonotonicRevision(next, store.currentState);
        next = store.currentState;
        store.branchOverrides[anchorKey] = createBranchSnapshot(next, {
            sourceKey: anchorKey,
            kind: manualPersonCatchUp ? 'person-catchup' : 'world-pulse',
        });
        saveStore(store, { immediate: true });
        refreshInjection();
        schedulePublicPostProcessing(next, {
            impactDelay: 160,
            opinionDelay: 620,
        });
        runtime.ui?.render();
        if (!quiet) {
            setSyncStatus({
                phase: 'success',
                message: manualPersonCatchUp
                    ? `${requestedPersonTarget.name} 的近况补齐啦～没有额外推进世界时间`
                    : '世界脉搏检查完成～镜头外也继续过自己的日子',
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
                message: manualPersonCatchUp
                    ? `${requestedPersonTarget?.name || '这个人物'} 的近况这次没补上～旧状态没动`
                    : '世界时间已经推进，但这次世界脉搏没接上～下次推演会继续追',
                error: describeError(error),
            });
        }
        if (manualPersonCatchUp) throw error;
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

    const bootstrapBaseRevision = Math.max(0, Number(getState()?.revision) || 0);
    const checkpointStore = getStore();
    const checkpoint = validHistoryBootstrapCheckpoint(checkpointStore, {
        chatToken,
        chatLength,
        baseRevision: bootstrapBaseRevision,
    });
    if (!checkpoint && checkpointStore.historyBootstrapCheckpoint) {
        checkpointStore.historyBootstrapCheckpoint = null;
        saveStore(checkpointStore, { immediate: true });
    }
    const resumeCursor = checkpoint?.cursor || 0;

    const confirmed = globalThis.confirm?.(
        (checkpoint
            ? `( •ᴗ• )  上次已经安全收好前 ${resumeCursor} 层，将从第 ${resumeCursor} 层继续，共剩约 ${Math.max(0, chatLength - resumeCursor)} 条消息。\n`
            : `( •ᴗ• )  将从第 0 层开始回溯当前分支，共约 ${chatLength} 条消息。\n`)
        + '会一起建立世界时间、人物当前状态、世界事实、未完暗流、世界脉搏与长期记忆。\n'
        + '每批会保存安全断点，但全部扫描成功后才会一次性提交到正式世界。是否继续？',
    );
    if (confirmed === false) return false;

    if (!checkpoint) {
        const protectedStore = addRecoveryPoint(getStore(), {
            reason: 'before-world-history-bootstrap',
            label: '历史回溯前自动保存',
        });
        saveStore(protectedStore, { immediate: true });
    }

    const controller = new AbortController();
    runtime.activeHistoryScan = controller;
    runtime.historyProgress = {
        kind: 'world-bootstrap',
        phase: 'running',
        processed: resumeCursor,
        total: chatLength,
        message: checkpoint
            ? `接着上次的爪印，从第 ${resumeCursor} 层继续～`
            : '正在把旧聊天接成一个完整世界～',
    };
    setBusy(true);
    runtime.ui?.render();

    // IMPORTANT: staging only. Nothing below is written to the live store until all
    // batches succeed. Manual edits during the scan invalidate the staged result.
    let stagedState = checkpoint ? trimState(checkpoint.stagedState) : trimState(getState());
    let cursor = resumeCursor;
    let assistantBatchLimit = checkpoint
        ? Math.max(1, Number.parseInt(checkpoint.assistantBatchLimit, 10) || 1)
        : 4;

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
                        recordPlayerCharacter: getSettings().recordPlayerCharacter,
                        compact: attempt > 0,
                    });
                    const historyBaseTokens = 6400;
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
                allowUserInnerVoice: false,
                recordPlayerCharacter: getSettings().recordPlayerCharacter,
                memoryEnabled: getSettings().memorySystemEnabled,
            });
            cursor = batch.nextCursor;
            saveHistoryBootstrapCheckpoint({
                chatToken,
                cursor,
                chatLength,
                baseRevision: bootstrapBaseRevision,
                stagedState,
                assistantBatchLimit,
            });
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
        store.historyBootstrapCheckpoint = null;
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
        schedulePublicPostProcessing(stagedState, {
            impactDelay: 180,
            opinionDelay: 320,
        });

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
            processed: Math.min(chatLength, cursor),
            total: chatLength,
            message: error?.name === 'AbortError'
                ? (cursor > 0
                    ? `历史回溯已停在第 ${Math.min(chatLength, cursor)} 层～正式世界没动，下次可以接着来`
                    : '历史回溯已停止～正式世界没有写入半成品')
                : (cursor > 0
                    ? `历史回溯停在第 ${Math.min(chatLength, cursor)} 层：${describeError(error)}；断点已保留，正式世界没有改动`
                    : `历史回溯失败：${describeError(error)}；正式世界没有改动`),
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
    skipConfirmation = false,
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
        if (!skipConfirmation) {
            const confirmed = globalThis.confirm?.(
                `( •ᴗ• )  将从第 ${cursor} 层开始分批读取当前分支，共约 ${chatLength - cursor} 条消息。\n`
                + '这会产生额外 API 调用，但每批成功后都会立即保存进度。是否继续？',
            );
            if (confirmed === false) return false;
        }
        // 玲七代办时，用户刚刚已经明确说“整理记忆”，无需再确认第二遍；
        // 但恢复点仍然照常建立，数据安全不打折。
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
                    const historyBaseTokens = 4200;
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

            if (runtime.queuedSimulations.size > 0) {
                runtime.historyProgress.message = '当前记忆批次已经收好～世界推演在排队，先把路让出去';
                runtime.ui?.render();
                break;
            }
        }

        let rolledUp = false;
        if (runtime.queuedSimulations.size === 0) {
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
        }
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
            identityAnchor: person.identityAnchor,
            personalityAnchor: person.personalityAnchor,
            appearanceProfile: person.appearanceProfile,
            backgroundProfile: person.backgroundProfile,
            speakingStyle: person.speakingStyle,
            behaviorBoundaries: person.behaviorBoundaries,
            innerVoice: person.innerVoice,
            innerVoiceAt: person.innerVoiceAt,
            knowledge: person.knowledge,
            cognitionReady: person.cognitionReady,
            knownEventViews: person.knownEventViews,
            knownFactBeliefs: person.knownFactBeliefs,
            knownClueIds: person.knownClueIds,
            physicalState: person.physicalState,
            emotionalState: person.emotionalState,
            resourceState: person.resourceState,
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
        : settings.apiMode === 'tavern-profile'
            ? '人物观测 · 酒馆已保存方案'
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
    if (!isPersonObservationEligible(person, getContext()?.name1 || '')) {
        throw new Error('玩家角色不使用人物即时观测');
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
        includeUserInnerVoice: false,
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
        // Re-inserting an existing key does not refresh its insertion order.
        // A forced refresh could therefore be immediately discarded by the
        // 30-entry cap if this was one of the oldest keys.
        delete store.personObservations[cacheKey];
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

    let state = getState();
    let candidates = eligiblePublicOpinionEvents(state);
    const publicWorldSweepPlanned = Boolean(
        ensurePublicWorld
        && getSettings().worldSimulationEnabled
        && publicWorldNeedsRefresh(state, candidates)
    );

    // 先把已经公开的世界事件对人物/行业/地点造成的真实后果接进后台。
    // 到期的公共世界巡查会在同一次世界请求里一并承担这项工作，避免
    // “旧影响 + 世界巡查 + 舆情整理”连续打三份 API。
    if (
        settlePublicImpact
        && !publicWorldSweepPlanned
        && pendingPublicImpactEvents(state, { maximum: 8 }).length
    ) {
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: '正在结算公开事件带来的世界影响～',
            error: '',
        };
        runtime.ui?.render();
        try {
            await runPublicImpactPropagation({ quiet: true, force: true, scheduleOpinion: false });
            state = getState();
            candidates = eligiblePublicOpinionEvents(state);
        } catch (error) {
            if (!isAbortError(error)) {
                console.warn('[世界背面] 刷新舆情前的公共影响传播失败，将沿用上一份已确认状态', error);
            }
        }
    }

    if (publicWorldSweepPlanned) {
        runtime.publicOpinionStatus = {
            phase: 'running',
            message: '让公共世界巡一圈～看看这一时段又发生了什么',
            error: '',
        };
        runtime.ui?.render();

        const completed = await runWorldPulseTick({
            reason: '用户手动刷新真实世界舆情',
            quiet: true,
            force: true,
            publicCycle: true,
        });

        runtime.publicOpinionStatus = {
            phase: 'running',
            message: completed
                ? '公共变化和直接世界后果已经一起接好～正在整理新闻'
                : '公共世界这次没有提交新状态～沿用确认内容整理新闻',
            error: '',
        };
        runtime.ui?.render();
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

    const settings = getSettings();
    const prompt = buildPublicOpinionPrompt(state, {
        clockLabel: formatWorldClockFactLabel(state),
        previousCache,
        forumElapsedMinutes: Number.isFinite(plan.forumElapsed) ? plan.forumElapsed : 0,
        newsElapsedMinutes: Number.isFinite(plan.newsElapsed) ? plan.newsElapsed : 0,
        allowNews: plan.allowNews,
        allowForums: plan.allowForums,
        reason: plan.reason,
        customInstruction: settings.customSimulationInstruction,
    });
    const baseTokens = 3600;

    try {
        const raw = await runWithRetries(
            attempt => backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: retryTokenBudget(baseTokens, attempt),
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
        latestStore.publicOpinionDismissed = normalizePublicOpinionDismissed(latestStore.publicOpinionDismissed);
        latestStore.publicOpinion = filterDismissedPublicOpinion(
            cache,
            latestStore.publicOpinionDismissed,
        );
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
                clockLabel: formatWorldClockFactLabel(state),
            });
            const settings = getSettings();
            const sandbox = await runWithRetries(
                async attempt => {
                    const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                        maxTokens: retryTokenBudget(2800, attempt),
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


function lingqiWorldDigest(state = getState()) {
    const clock = formatWorldCalendar(state);
    return {
        world: {
            name: String(state.world?.name || ''),
            title: String(state.world?.title || ''),
            detail: String(state.world?.detail || ''),
            background: String(state.world?.background || '').slice(0, 1800),
        },
        clock: formatWorldClockFactLabel(state),
        people: (state.people || [])
            .slice()
            .sort((a, b) => Number(b?.relevance || 0) - Number(a?.relevance || 0))
            .slice(0, 16)
            .map(person => ({
                id: person.id,
                name: person.name,
                location: person.location,
                action: person.action,
                intent: person.intent,
                long_term_goal: person.longTermGoal || person.long_term_goal || '',
                emotional_state: person.emotionalState || person.emotional_state || '',
                knowledge: person.knowledge,
                is_user: Boolean(person.isUser || person.is_user),
            })),
        active_events: (state.events || [])
            .filter(event => ['active', 'waiting', 'ready'].includes(event.status))
            .slice(0, 16)
            .map(event => ({
                id: event.id,
                title: event.title,
                place: event.place,
                status: event.status,
                summary: event.summary,
                cause: event.cause,
                visibility: event.visibility,
                publicity: event.publicity,
            })),
        recent_memory: {
            facts: (state.storyMemory?.facts || [])
                .filter(item => ['active', 'disputed'].includes(item.status))
                .slice(-8)
                .map(item => ({ subject: item.subject, predicate: item.predicate, value: item.value })),
            clues: (state.storyMemory?.clues || [])
                .filter(item => !['resolved', 'discarded'].includes(item.status))
                .slice(-8)
                .map(item => ({ title: item.title, text: item.text, status: item.status })),
        },
        lingqi_notes: activeLingqiNotes(getStore().lingqi || emptyLingqiState()).map(note => ({
            id: note.id,
            paper_text: note.paperText,
            directive: note.directive,
            scope: note.scope,
            strength: note.strength,
            remaining_uses: note.remainingUses,
        })),
    };
}


const LINGQI_SETTING_LABELS = Object.freeze({
    worldSimulationEnabled: '世界推演',
    worldPromptInjection: '正文注入总开关',
    injectionTimeMode: '世界时间注入',
    injectionWorldBackground: '世界背景注入',
    injectionPeople: '人物状态注入',
    injectionEvents: '暗流 / 世界环境注入',
    injectionEchoes: '回声 / 后果注入',
    injectionFacts: '世界事实注入',
    injectionMemory: '长期记忆注入',
    injectionPublicOpinion: '舆情注入',
    injectionSocial: '通讯影响正文',
    socialAutoEnabled: '角色主动联系',
    memorySystemEnabled: '记忆系统',
    worldAutoEnabled: '自动世界推演',
    publicOpinionAutoEnabled: '自动舆情',
    recordPlayerCharacter: '记录玩家角色',
    enhancedBackgroundSimulation: '强化后台人物推演',
});

function lingqiSettingDisplayValue(key, value) {
    if (key === 'injectionTimeMode') {
        return {
            full: '完整',
            anchor: '最小锚点',
            off: '关闭',
        }[value] || String(value);
    }
    return value ? '开启' : '关闭';
}

function validateLingqiSettingValue(key, value) {
    const rule = LINGQI_SAFE_SETTING_KEYS[key];
    if (!rule) return { ok: false, value: null };
    if (rule === 'boolean') {
        if (typeof value === 'boolean') return { ok: true, value };
        const text = String(value ?? '').trim().toLowerCase();
        if (['true', '1', 'on', 'yes', '开', '开启'].includes(text)) return { ok: true, value: true };
        if (['false', '0', 'off', 'no', '关', '关闭'].includes(text)) return { ok: true, value: false };
        return { ok: false, value: null };
    }
    if (rule.startsWith('enum:')) {
        const allowed = rule.slice(5).split(',');
        const text = String(value ?? '').trim();
        return allowed.includes(text)
            ? { ok: true, value: text }
            : { ok: false, value: null };
    }
    return { ok: false, value: null };
}

function lingqiRelevantPeople(state, userText = '') {
    const query = String(userText || '').toLocaleLowerCase();
    const people = Array.isArray(state?.people) ? state.people : [];
    const exact = people.filter(person => {
        const name = String(person?.name || '').trim().toLocaleLowerCase();
        return name && query.includes(name);
    });
    const fallback = people
        .filter(person => !exact.some(item => item.id === person.id))
        .sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0))
        .slice(0, Math.max(0, 12 - exact.length));
    return [...exact, ...fallback].slice(0, 12).map(person => ({
        id: person.id,
        name: person.name,
        isUser: Boolean(person.isUser),
        simulationEnabled: person.simulationEnabled !== false,
        locked: Boolean(person.locked),
        location: String(person.location || '').slice(0, 140),
        action: String(person.action || '').slice(0, 220),
        intent: String(person.intent || '').slice(0, 220),
        knowledge: person.knowledge || 'backstage',
        source: person.source || '',
    }));
}

function lingqiRelevantEvents(state, userText = '') {
    const query = String(userText || '').toLocaleLowerCase();
    const events = Array.isArray(state?.events) ? state.events : [];
    return events
        .map(event => {
            const haystack = [
                event?.title,
                event?.place,
                event?.summary,
                ...(event?.actors || []),
            ].join(' ').toLocaleLowerCase();
            let score = ['active', 'waiting', 'ready'].includes(event?.status) ? 20 : 0;
            if (query && haystack && [...query].some(char => char.trim() && haystack.includes(char))) score += 5;
            return { event, score };
        })
        .sort((a, b) => b.score - a.score || Number(b.event?.updatedAt || 0) - Number(a.event?.updatedAt || 0))
        .slice(0, 12)
        .map(({ event }) => ({
            id: event.id,
            title: event.title,
            status: event.status,
            place: event.place,
            summary: String(event.summary || event.expectedResult || event.cause || '').slice(0, 260),
            visibility: event.visibility,
            deliveryState: event.delivery?.state || 'none',
            publicity: event.publicity || 'private',
        }));
}

function buildLingqiButlerContext(userText = '') {
    const state = getState();
    const settings = getSettings();
    const sync = getSyncStatus();
    const connection = getConnectionInfo();
    const lastOperation = getLastCustomApiOperation();
    const clock = formatWorldCalendar(state);
    const help = buildLingqiHelpContext(userText, PLUGIN_VERSION);
    const social = normalizeSocialState(getStore().social || emptySocialState(), state.people || []);
    const socialPeopleById = new Map((state.people || []).map(person => [String(person?.id || ''), person]));
    const snapshot = {
        plugin: {
            version: PLUGIN_VERSION,
            stateSchema: SCHEMA_VERSION,
        },
        world: {
            name: state.world?.name || '',
            title: state.world?.title || '',
            time: clock.stamp,
            anchored: Boolean(state.clock?.anchored),
            revision: state.revision,
            pendingSync: Boolean(sync.narrative?.needsSimulation),
            narrativeSync: {
                status: sync.narrative?.status || 'empty',
                committed: Boolean(sync.narrative?.committed),
                needsSimulation: Boolean(sync.narrative?.needsSimulation),
                pendingTurns: Number(sync.narrative?.pendingTurns || 0),
            },
            needsReconciliation: Boolean(state.needsReconciliation),
            publicCoverage: {
                lastSweepAt: Number(state.worldPulse?.coverage?.lastSweepAt ?? -1),
                lastPublicSweepAt: Number(state.worldPulse?.coverage?.lastPublicSweepAt ?? -1),
                recentScopes: (state.worldPulse?.coverage?.entries || []).slice(0, 6).map(entry => ({
                    label: String(entry?.label || '').slice(0, 120),
                    kind: String(entry?.kind || '').slice(0, 40),
                    lastCheckedAt: Number(entry?.lastCheckedAt ?? -1),
                })),
                customFocus: String(settings.customSimulationInstruction || '').slice(0, 500),
            },
        },
        settings: {
            worldSimulationEnabled: settings.worldSimulationEnabled,
            worldAutoEnabled: settings.worldAutoEnabled,
            enhancedBackgroundSimulation: settings.enhancedBackgroundSimulation,
            recordPlayerCharacter: settings.recordPlayerCharacter,
            worldPromptInjection: settings.worldPromptInjection,
            injectionTimeMode: settings.injectionTimeMode,
            injectionWorldBackground: settings.injectionWorldBackground,
            injectionPeople: settings.injectionPeople,
            injectionEvents: settings.injectionEvents,
            injectionEchoes: settings.injectionEchoes,
            injectionFacts: settings.injectionFacts,
            injectionMemory: settings.injectionMemory,
            injectionPublicOpinion: settings.injectionPublicOpinion,
            memorySystemEnabled: settings.memorySystemEnabled,
            publicOpinionAutoEnabled: settings.publicOpinionAutoEnabled,
            socialAutoEnabled: settings.socialAutoEnabled,
            injectionSocial: settings.injectionSocial,
            autoSimulationMode: settings.autoSimulationMode,
            worldPulseActivity: settings.worldPulseActivity,
            backgroundNpcBudget: settings.backgroundNpcBudget,
            maxOutputTokens: settings.maxOutputTokens,
            generationTimeoutMs: settings.generationTimeoutMs,
        },
        tasks: {
            world: {
                phase: sync.phase,
                message: String(sync.message || '').slice(0, 280),
                error: String(sync.error || '').slice(0, 360),
            },
            active: (sync.activeBackgroundTasks || []).filter(label => label !== '玲七'),
            queuePendingTurns: sync.queue?.pendingTurns || 0,
            memory: {
                phase: sync.memory?.phase || 'idle',
                message: String(sync.memory?.message || '').slice(0, 280),
                pendingAssistantResponses: sync.memory?.pendingAssistantResponses || 0,
            },
            opinion: {
                phase: sync.publicOpinion?.phase || 'idle',
                message: String(sync.publicOpinion?.message || '').slice(0, 260),
                stale: Boolean(sync.publicOpinion?.stale),
                canonRunning: Boolean(sync.publicOpinion?.canonRunning),
            },
        },
        connection: {
            configured: Boolean(connection.configured),
            mode: settings.apiMode,
            api: String(connection.apiLabel || '').slice(0, 120),
            source: String(connection.source || '').slice(0, 120),
            model: redactDiagnosticText(connection.model || ''),
            method: String(connection.method || '').slice(0, 100),
            transport: settings.apiMode === 'custom'
                ? settings.customApiTransport
                : settings.apiMode === 'tavern-profile'
                    ? 'tavern-profile'
                    : 'tavern',
            lastOperation: lastOperation ? {
                phase: lastOperation.phase,
                operation: lastOperation.operation,
                transportStatus: lastOperation.transportStatus,
                upstreamStatus: lastOperation.upstreamStatus,
                errorType: lastOperation.errorType,
                errorSummary: redactDiagnosticText(lastOperation.errorSummary || ''),
                retryAfterMs: Number(lastOperation.retryAfterMs) || 0,
            } : null,
        },
        social: {
            accepted: social.connections.filter(item => item.status === 'accepted').map(item => socialPeopleById.get(item.personId)?.name).filter(Boolean).slice(0, 30),
            incomingRequests: social.connections.filter(item => item.status === 'incoming').map(item => socialPeopleById.get(item.personId)?.name).filter(Boolean).slice(0, 20),
            pendingRequests: social.connections.filter(item => item.status === 'pending').map(item => socialPeopleById.get(item.personId)?.name).filter(Boolean).slice(0, 20),
            removed: social.connections.filter(item => item.status === 'removed').map(item => socialPeopleById.get(item.personId)?.name).filter(Boolean).slice(-20),
            unreadNotices: social.notices.filter(item => !item.readAt).length,
            conversations: social.conversations.length,
            moments: social.moments.length,
        },
        counts: {
            people: state.people?.length || 0,
            activeEvents: (state.events || []).filter(event => ['active', 'waiting', 'ready'].includes(event.status)).length,
            echoes: state.echoes?.length || 0,
            archive: state.archive?.length || 0,
            worldFacts: state.worldFacts?.length || 0,
            memoryFacts: state.storyMemory?.facts?.length || 0,
            memorySummaries: state.storyMemory?.summaries?.length || 0,
            memoryClues: state.storyMemory?.clues?.length || 0,
            consistencyConflicts: state.consistencyConflicts?.length || 0,
            recoveryPoints: listRecoveryPointHeaders(getStore()).length,
        },
        people: lingqiRelevantPeople(state, userText),
        events: lingqiRelevantEvents(state, userText),
    };
    return `${help}\n\n【当前实时状态】\n${JSON.stringify(snapshot)}`.slice(0, 22000);
}


const LINGQI_TRIAGE_CATEGORY_LABELS = Object.freeze({
    usage: '使用方式',
    settings: '设置 / 配置',
    api: 'API / 中转',
    task: '后台任务',
    memory: '记忆',
    people: '人物',
    injection: '正文注入',
    opinion: '舆情 / 新闻',
    worldbook: '世界书导入',
    data: '数据一致性',
    ui: '界面 / 交互',
    compatibility: '兼容性',
    performance: '性能 / 限流',
    unknown: '暂未归类',
});

function lingqiTriageCategoryLabel(category = 'unknown') {
    return LINGQI_TRIAGE_CATEGORY_LABELS[category] || LINGQI_TRIAGE_CATEGORY_LABELS.unknown;
}

function lingqiProviderErrorLooksExternal() {
    const lastOperation = getLastCustomApiOperation();
    if (!lastOperation) return false;
    const status = Number(lastOperation.upstreamStatus || lastOperation.transportStatus) || 0;
    const text = [
        lastOperation.errorType,
        lastOperation.errorSummary,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return (
        [401, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(status)
        || /unauthorized|forbidden|rate.?limit|quota|timeout|upstream|model.?unavailable|overload|provider|额度|限流|鉴权|中转|上游/u.test(text)
    );
}

function finalizeLingqiTriage(response, actionResults = [], userText = '') {
    const source = response?.triage && typeof response.triage === 'object'
        ? response.triage
        : {};
    const triage = {
        route: source.route || (response?.needsAuthorHelp ? 'mama' : 'resolved'),
        owner: source.owner || (response?.needsAuthorHelp ? 'unknown' : 'user'),
        category: source.category || 'unknown',
        summary: String(source.summary || '').trim().slice(0, 360),
        checked: (Array.isArray(source.checked) ? source.checked : [])
            .map(item => String(item || '').trim().slice(0, 220))
            .filter(Boolean)
            .slice(0, 4),
        nextStep: String(source.nextStep || '').trim().slice(0, 500),
        reason: String(source.reason || response?.helpReason || '').trim().slice(0, 500),
    };

    // 玲七不能把“教用户怎么用 / 改一个设置”这种问题甩给妈妈。
    if (triage.route === 'mama' && ['usage', 'settings'].includes(triage.category)) {
        triage.route = 'self_service';
        triage.owner = 'user';
        if (!triage.nextStep) {
            triage.nextStep = '先按玲七上面的说明检查对应开关或操作入口；如果实际行为仍和说明不一致，再回来让玲七继续查。';
        }
    }

    // 模型已经判断责任在用户自己 / 第三方时，玲七不能仍然把纸条丢给妈妈。
    if (triage.route === 'mama' && triage.owner === 'user') {
        triage.route = 'self_service';
        if (!triage.nextStep) {
            triage.nextStep = '先按玲七给出的说明把本地设置或操作修正；如果修正后仍复现，再回来继续查。';
        }
    }
    if (triage.route === 'mama' && triage.owner === 'provider') {
        triage.route = 'external';
        if (!triage.nextStep) {
            triage.nextStep = '先处理当前接口、中转、模型或第三方环境的问题；第三方恢复正常后如果插件仍异常，再回来继续查。';
        }
    }

    // dev.8 能明确识别世界推演输出截断。这种情况有直接可执行的自助方案，
    // 而且本轮状态已经安全不提交，不需要先占妈妈的反馈。
    const currentSyncError = String(getSyncStatus()?.error || '');
    if (
        triage.route === 'mama'
        && /输出上限|output-limit|OUTPUT_TRUNCATED|没有闭合，疑似被输出上限截断/u.test(
            `${triage.summary}\n${triage.reason}\n${currentSyncError}`,
        )
    ) {
        triage.route = 'self_service';
        triage.owner = 'user';
        triage.category = 'performance';
        triage.nextStep = '到「高级与维护 → 生成限制」提高“世界推演”模块 Token 上限；如果模块留 0，则提高全局 Token 上限。截断这一轮不会提交人物、事件、记忆或世界时间。';
    }

    // 明确属于上游/API 的常见错误先去解决接口，不占妈妈的插件反馈。
    const pluginApiSymptom = /插件|按钮|界面|显示|解析|状态不一致|没有触发|未触发|写入|保存|恢复|复活|串聊天/u.test(
        `${triage.summary}\n${triage.reason}`,
    );
    if (
        triage.route === 'mama'
        && ['api', 'performance', 'compatibility'].includes(triage.category)
        && !pluginApiSymptom
        && lingqiProviderErrorLooksExternal()
    ) {
        triage.route = 'external';
        triage.owner = 'provider';
        if (!triage.nextStep) {
            triage.nextStep = '先检查当前接口/中转的鉴权、额度、限流和模型可用性；如果接口本身恢复正常后插件仍异常，再回来继续查插件。';
        }
    }

    // 如果玲七刚刚已经成功代办了一个动作，就别同时写纸条告状。
    const actionSucceeded = actionResults.some(text => (
        /已经|开始了|打开|关掉|停下|检查完了|最新一层/u.test(String(text || ''))
        && !/没弄成|不敢|没认准|没找到|没有拿到结果|关着|先等/u.test(String(text || ''))
    ));
    if (triage.route === 'mama' && actionSucceeded) {
        triage.route = 'resolved';
        triage.owner = 'user';
        triage.reason = '';
    }

    if (triage.route === 'mama') {
        triage.owner = triage.owner === 'provider' || triage.owner === 'user'
            ? 'unknown'
            : triage.owner;
        if (!triage.summary) {
            triage.summary = String(response?.helpReason || userText || '现有状态无法解释当前现象')
                .trim()
                .slice(0, 360);
        }
        if (!triage.checked.length) {
            triage.checked = [
                '已对照当前插件版本、相关设置和正在运行的后台任务',
            ];
        }
        if (!triage.reason) {
            triage.reason = '现有帮助知识和实时状态都不能解释这个现象，需要妈妈进一步看插件行为。';
        }
    }

    return triage;
}

function buildLingqiSupportPack(userText = '', triage = {}) {
    const question = String(userText || '').trim().slice(0, 1600);
    const category = lingqiTriageCategoryLabel(triage.category);
    const summary = String(triage.summary || question || '现有状态无法解释当前现象').trim().slice(0, 500);
    const checked = (Array.isArray(triage.checked) ? triage.checked : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 4);
    const why = String(triage.reason || '').trim().slice(0, 600);
    return [
        '玲七给妈妈的小纸条',
        `问题类型：${category}`,
        `一句话：${summary}`,
        checked.length ? `玲七已经检查：${checked.join('；')}` : '',
        why ? `为什么需要妈妈看：${why}` : '',
        question ? `用户原话：${question}` : '',
        '',
        '—— 以下是排查时才需要看的技术信息 ——',
        buildDiagnosticReport(),
    ].filter(Boolean).join('\n');
}

async function copyTextSafely(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
        if (typeof globalThis.navigator?.clipboard?.writeText === 'function') {
            await globalThis.navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Fall through to execCommand.
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand?.('copy');
    textarea.remove();
    return Boolean(copied);
}

function findLingqiPersonTarget(action) {
    const state = getState();
    const personId = String(action?.personId || '').trim();
    const personName = String(action?.personName || '').trim().toLocaleLowerCase();
    if (personId) {
        return state.people.find(person => person.id === personId) || null;
    }
    if (!personName) return null;
    const exact = state.people.filter(person => String(person.name || '').trim().toLocaleLowerCase() === personName);
    return exact.length === 1 ? exact[0] : null;
}

function lingqiDeletionSourceMessages() {
    const state = normalizeLingqiState(getStore().lingqi || emptyLingqiState());
    const messages = [...state.messages];
    // 删除请求本身刚刚才写入玲七聊天；定位“最近/全部/范围”时不要把这句请求
    // 当成用户想删的历史记录。真正执行 all 时仍会把整个聊天清空。
    if (messages.at(-1)?.role === 'user') messages.pop();
    return messages;
}

function resolveLingqiChatDeletionPlan(action = {}) {
    const state = normalizeLingqiState(getStore().lingqi || emptyLingqiState());
    return buildLingqiChatDeletionPlan(lingqiDeletionSourceMessages(), action, state.messages.length);
}

const LINGQI_CONFIRM_ACTION_TYPES = new Set([
    'simulate_latest',
    'refresh_public_world',
    'catch_up_person',
    'delete_lingqi_chat',
    'social_send_message',
    'social_accept_request',
    'social_refuse_request',
    'social_remove_friend',
    'social_refresh_moments',
]);

function lingqiActionConfirmation(action) {
    if (action.type === 'delete_lingqi_chat') {
        const plan = resolveLingqiChatDeletionPlan(action);
        return plan.ok ? plan : { error: plan.message };
    }
    if (action.type === 'simulate_latest') {
        return {
            title: '推演最新正文？',
            detail: '会走一次世界推演；如果已经追上，我就不重复戳接口。',
            confirmLabel: '推演',
        };
    }
    if (action.type === 'refresh_public_world') {
        return {
            title: '出去巡一圈？',
            detail: '会检查公共世界并刷新舆情；同一世界时刻和侧重点会自动去重。',
            confirmLabel: '去巡',
        };
    }
    if (action.type === 'catch_up_person') {
        const person = findLingqiPersonTarget(action);
        return {
            title: person ? `补一下${person.name}的近况？` : '补一下人物近况？',
            detail: '会单独调用一次人物生活结算，不推进世界时间。',
            confirmLabel: '去看看',
        };
    }
    return null;
}

function queueLingqiActionConfirmation(action) {
    const confirmation = lingqiActionConfirmation(action);
    if (!confirmation) return { queued: false, message: '这个动作现在没有可用的确认方式。' };
    if (confirmation.error) return { queued: false, message: confirmation.error };
    const { action: preparedAction, ...confirmationMeta } = confirmation;
    const queuedAction = clone(preparedAction || action);
    if (queuedAction.type === 'delete_lingqi_chat') {
        const state = normalizeLingqiState(getStore().lingqi || emptyLingqiState());
        queuedAction.chatSnapshotSignature = lingqiChatSnapshotSignature(state.messages);
    }
    runtime.pendingLingqiAction = {
        id: `lingqi_action_${Date.now().toString(36)}`,
        chatToken: currentChatToken(),
        contextEpoch: runtime.contextEpoch,
        action: queuedAction,
        ...confirmationMeta,
    };
    return { queued: true };
}

function sealPendingLingqiChatDeletionSnapshot() {
    const pending = runtime.pendingLingqiAction;
    if (
        pending?.action?.type !== 'delete_lingqi_chat'
        || pending.chatToken !== currentChatToken()
        || pending.contextEpoch !== runtime.contextEpoch
    ) return false;
    const state = normalizeLingqiState(getStore().lingqi || emptyLingqiState());
    pending.action.chatSnapshotSignature = lingqiChatSnapshotSignature(state.messages);
    if (pending.action.deleteAll) {
        pending.action.resolvedCount = state.messages.length;
        pending.title = `清空玲七的 ${state.messages.length} 条聊天记录？`;
    }
    return true;
}

async function executeLingqiButlerActions(actions = [], { confirmed = false } = {}) {
    const results = [];
    for (const action of Array.isArray(actions) ? actions.slice(0, 8) : []) {
        try {
            if (LINGQI_CONFIRM_ACTION_TYPES.has(action.type) && !confirmed) {
                if (action.type === 'simulate_latest' && !latestNarrativeSyncSnapshot().needsSimulation) {
                    results.push('最新正文已经跟上了，不用再戳一次接口。');
                    continue;
                }
                if (action.type === 'catch_up_person' && !findLingqiPersonTarget(action)) {
                    results.push('那个人我没认准……名字重了或者没找到，先不乱跑。');
                    continue;
                }
                if (runtime.pendingLingqiAction) {
                    results.push('爪子下面已经压着一个等你点头的动作啦～先处理那个。');
                    break;
                }
                const queued = queueLingqiActionConfirmation(action);
                if (!queued.queued) {
                    results.push(queued.message || '这个范围我没认准，先不乱碰。');
                    continue;
                }
                results.push(action.type === 'delete_lingqi_chat'
                    ? '我把要删的范围圈出来啦。先看一眼，点头以后才真的删。'
                    : action.type.startsWith('social_')
                        ? '这是会真实改变通讯或关系的动作。我把人物和内容摆在确认卡上，点头以后才动。'
                        : '这个会叫一次后台模型。我先把爪子停在按钮上，等你点头～');
                break;
            }
            if (action.type === 'delete_lingqi_chat') {
                if (!confirmed) continue;
                const currentStore = getStore();
                const state = normalizeLingqiState(currentStore.lingqi || emptyLingqiState());
                if (
                    !action.chatSnapshotSignature
                    || action.chatSnapshotSignature !== lingqiChatSnapshotSignature(state.messages)
                ) {
                    results.push('确认期间聊天内容发生了变化，我没有删除。请重新说一次要删的范围。');
                    continue;
                }
                const ids = new Set(Array.isArray(action.resolvedMessageIds) ? action.resolvedMessageIds : []);
                const before = state.messages.length;
                if (action.deleteAll) {
                    state.messages = [];
                } else {
                    state.messages = state.messages.filter(message => !ids.has(message.id));
                }
                const removed = Math.max(0, before - state.messages.length);
                state.updatedAt = new Date().toISOString();
                currentStore.lingqi = state;
                saveStore(currentStore, { immediate: true });
                results.push(removed
                    ? `删掉了 ${removed} 条玲七聊天。长期记忆没动。`
                    : '那段记录已经不在这里了，我没有再乱删别的。');
                continue;
            }
            if (action.type === 'update_setting') {
                const key = String(action.setting || '');
                const checked = validateLingqiSettingValue(key, action.value);
                if (!checked.ok) {
                    results.push(`这个设置我不敢乱碰：${key || '没看清名字'}。`);
                    continue;
                }
                await handleUiAction('update-settings', { [key]: checked.value });
                results.push(`${LINGQI_SETTING_LABELS[key] || key}已经${lingqiSettingDisplayValue(key, checked.value)}。`);
                continue;
            }
            if (action.type === 'set_person_simulation') {
                const person = findLingqiPersonTarget(action);
                if (!person) {
                    results.push('那个人我没认准……名字重了或者没找到，先不乱改。');
                    continue;
                }
                if (person.isUser) {
                    results.push('这个是玩家角色。要不要记录 user 应该用“记录玩家角色”开关，不拿人物推演开关硬改。');
                    continue;
                }
                const next = clone(getState());
                const target = next.people.find(item => item.id === person.id);
                if (!target) {
                    results.push('刚刚还看见的人物不见了，先不动。');
                    continue;
                }
                target.simulationEnabled = Boolean(action.enabled);
                target.updatedAt = next.clock.absoluteMinute;
                commitManualState(next, `${target.name} 的后台人物推演已${action.enabled ? '开启' : '关闭'}。`);
                results.push(`${target.name} 的后台推演已经${action.enabled ? '打开' : '关掉'}。`);
                continue;
            }
            if (action.type === 'prioritize_person') {
                const person = findLingqiPersonTarget(action);
                if (!person || person.isUser) {
                    results.push('那个人我没认准，或者她是玩家角色……这个先不乱排。');
                    continue;
                }
                setPersonLifePriority(person.id, action.enabled !== false);
                results.push(action.enabled === false
                    ? `${person.name}不再占下一轮优先位。`
                    : `${person.name}已经排到下一轮前面啦～不额外调用接口。`);
                continue;
            }
            if (action.type === 'catch_up_person') {
                const person = findLingqiPersonTarget(action);
                if (!person || person.isUser) {
                    results.push('那个人我没认准，先不乱补。');
                    continue;
                }
                await runPersonLifeCatchUp(person.id);
                results.push(`${person.name}的近况已经补好啦～世界时间没往前拨。`);
                continue;
            }
            if (action.type === 'social_send_message') {
                const person = findLingqiPersonTarget(action);
                if (!person || person.isUser) {
                    results.push('耳朵没听准是哪位通讯人物，这条消息我还按在爪子下面，没有发。');
                    continue;
                }
                let socialStore = getStore();
                socialStore.social = openDirectConversation(socialStore.social, person, socialStore.currentState.people);
                const conversationId = socialStore.social.activeConversationId;
                saveStore(socialStore, { immediate: true });
                const sent = await sendSocialMessage(conversationId, action.text);
                results.push(sent?.replyCount
                    ? `消息已经替你送到 ${person.name} 那边啦～我叼回了 ${sent.replyCount} 条回复。`
                    : `消息已经替你送到 ${person.name} 那边啦。对方这次没回，我不替她催。`);
                continue;
            }
            if (['social_accept_request', 'social_refuse_request'].includes(action.type)) {
                const person = findLingqiPersonTarget(action);
                if (!person || person.isUser) {
                    results.push('好友申请的人我没认准，先用爪子按住，没有乱处理。');
                    continue;
                }
                const socialStore = getStore();
                const accept = action.type === 'social_accept_request';
                socialStore.social = respondIncomingFriendRequest(socialStore.social, socialStore.currentState, person.id, accept);
                saveStore(socialStore, { immediate: true });
                results.push(accept
                    ? `${person.name} 的好友申请已经按你的确认接受。她现在在通讯录里啦～`
                    : `${person.name} 的好友申请已经按你的确认拒绝。关系记录我也留好了。`);
                continue;
            }
            if (action.type === 'social_remove_friend') {
                const person = findLingqiPersonTarget(action);
                if (!person || person.isUser) {
                    results.push('要解除关系的人我没认准，先没动。');
                    continue;
                }
                const socialStore = getStore();
                socialStore.social = removeSocialFriend(socialStore.social, socialStore.currentState, person.id, {
                    source: 'lingqi-user-request',
                    reason: '用户通过玲七确认删除好友',
                });
                saveStore(socialStore, { immediate: true });
                refreshInjection();
                results.push(`已经按你的确认解除和 ${person.name} 的好友关系。历史消息与共同群聊还在，我没有多碰。`);
                continue;
            }
            if (action.type === 'social_refresh_moments') {
                const refreshed = await refreshSocialMoments();
                results.push(refreshed?.postCount
                    ? `我从朋友圈窗口蹲回来啦～看到 ${refreshed.postCount} 条新动态${refreshed.imageCount ? '，其中一条还带了配图' : ''}。`
                    : '我蹲了一圈，这次没有好友想发动态。安静也算正常，不替她们硬编。');
                continue;
            }
            if (action.type === 'simulate_latest') {
                const narrative = latestNarrativeSyncSnapshot();
                if (!narrative.needsSimulation) {
                    results.push('最新正文已经跟上了，不重复推演。');
                    continue;
                }
                const result = await requestManualWorldSimulation();
                results.push(result?.queued
                    ? '最新正文已经安全排队，前面的任务结束后就会接着推演。'
                    : result?.started
                        ? '最新正文已经推演好啦～'
                        : '这次没有启动新的世界推演。');
                continue;
            }
            if (action.type === 'refresh_public_world') {
                await generatePublicOpinionSnapshot({
                    allowDefer: true,
                    ensurePublicWorld: true,
                    settlePublicImpact: true,
                    force: false,
                });
                results.push(['queued', 'pending'].includes(runtime.publicOpinionStatus?.phase)
                    ? '外面这轮先安全排队啦～前面的世界任务结束后，我会接着巡，不会重复开一份。'
                    : '外面巡过啦～该结算的公共变化和舆情已经接好；没新东西时我没有硬编。');
                continue;
            }
            if (action.type === 'cancel_simulation') {
                const cancelled = cancelActiveSimulation();
                results.push(cancelled ? '当前世界推演停下来了。' : '现在没有正在跑的世界推演。');
                continue;
            }
            if (action.type === 'cancel_background_tasks') {
                const result = cancelActiveBackgroundTasks({ preserveLingqi: true });
                results.push(
                    result.cancelled
                        ? `其他后台任务已经停了：${result.labels.filter(label => label !== '玲七').join('、') || '没有别的任务'}。`
                        : '现在没有别的后台任务在跑。',
                );
                continue;
            }
            if (action.type === 'check_world_state') {
                const result = await checkAndCorrectWorldState();
                if (!result) {
                    results.push('这次事实检查没有拿到结果。');
                } else if (result.applied?.length || result.removedEventIds?.length) {
                    results.push(`检查完了：修正 ${result.applied?.length || 0} 项${result.removedEventIds?.length ? `，撤销 ${result.removedEventIds.length} 条未发生派生` : ''}。`);
                } else {
                    results.push(result.skipped
                        ? `检查完了，有 ${result.skipped} 项证据不够，我没让它乱改。`
                        : '检查完了，没有发现需要自动修正的明确矛盾。');
                }
                continue;
            }
            if (action.type === 'organize_memory') {
                const settings = getSettings();
                if (!settings.memorySystemEnabled) {
                    results.push('记忆系统现在关着，先不开着它我没法整理。');
                    continue;
                }
                if (runtime.historyProgress.phase === 'running') {
                    results.push(runtime.historyProgress.kind === 'world-bootstrap'
                        ? '现在正在做世界历史回溯，先不抢它的路。'
                        : '记忆已经在整理了。');
                    continue;
                }
                if (coreSimulationBusy()) {
                    results.push('现在还有世界推演/结算在跑，先等它结束再整理记忆，免得两份状态互相覆盖。');
                    continue;
                }
                const context = getContext();
                if (!(context?.chat?.length > 0)) {
                    results.push('当前聊天还没有可以整理的正文。');
                    continue;
                }
                if (unindexedAssistantCount() <= 0 && !planMemoryRollup(getState())) {
                    results.push('记忆已经整理到最新一层了，现在没有新的东西要收。');
                    continue;
                }

                const startMemoryMaintenance = () => {
                    void scanStoryMemoryHistory({
                        automatic: false,
                        maximumBatches: Number.POSITIVE_INFINITY,
                        skipConfirmation: true,
                    }).catch(error => {
                        if (!isAbortError(error)) {
                            console.warn('[世界背面] 玲七代办记忆整理失败', error);
                            toast(`记忆整理没弄成：${describeError(error)}`, 'error');
                        }
                    });
                };

                // 如果这条动作来自玲七模型回复，先让玲七自己的请求正常收尾，
                // 再启动记忆任务，避免玲七 finally 把记忆任务的 busy 状态误清掉。
                if (runtime.activeLingqi && !runtime.activeLingqi.controller?.signal?.aborted) {
                    window.setTimeout(startMemoryMaintenance, 0);
                } else {
                    startMemoryMaintenance();
                }
                results.push('记忆整理已经开始了。不是世界历史回溯，只会走现有的长期记忆整理流程。');
            }
        } catch (error) {
            results.push(`这个没弄成：${describeError(error)}`);
        }
    }
    return results;
}

async function confirmLingqiPendingAction() {
    const pending = runtime.pendingLingqiAction;
    if (
        !pending
        || pending.chatToken !== currentChatToken()
        || pending.contextEpoch !== runtime.contextEpoch
    ) {
        runtime.pendingLingqiAction = null;
        throw new Error('刚才那个动作已经不属于当前聊天啦～');
    }
    runtime.pendingLingqiAction = null;
    runtime.lingqiStatus = { phase: 'running', message: '玲七正伸爪子去弄……', error: '' };
    runtime.ui?.render();
    const results = await executeLingqiButlerActions([pending.action], { confirmed: true });
    if (
        pending.chatToken !== currentChatToken()
        || pending.contextEpoch !== runtime.contextEpoch
    ) return results;
    const text = results.join('\n') || '弄好啦～';
    const store = getStore();
    const isChatDelete = pending.action?.type === 'delete_lingqi_chat';
    const chatDeleteFailed = isChatDelete && results.some(item => /没有删除|没有再乱删|失败/u.test(String(item || '')));
    if (!(isChatDelete && pending.action?.deleteAll && !chatDeleteFailed)) {
        store.lingqi = addLingqiMessage(store.lingqi || emptyLingqiState(), 'assistant', text);
    } else {
        store.lingqi = normalizeLingqiState(store.lingqi || emptyLingqiState());
    }
    store.lingqi.mascotState = chatDeleteFailed || results.some(item => /没|失败|不敢|不能/u.test(item)) ? 'hold' : 'happy';
    saveStore(store, { immediate: true });
    runtime.lingqiStatus = {
        phase: chatDeleteFailed ? 'error' : 'success',
        message: isChatDelete ? (results[0] || '聊天记录收拾好啦～') : '玲七顺手弄好啦～',
        error: '',
    };
    if (isChatDelete) toast(results[0] || '玲七聊天记录已经收拾好啦～', chatDeleteFailed ? 'error' : 'success');
    runtime.ui?.render();
    return results;
}

function dismissLingqiPendingAction() {
    if (!runtime.pendingLingqiAction) return false;
    runtime.pendingLingqiAction = null;
    runtime.lingqiStatus = { phase: 'idle', message: '先不碰，爪子收回来啦～', error: '' };
    runtime.ui?.render();
    return true;
}



function resolveCompletedLingqiMascotState(preferred = 'watch', {
    proposal = null,
    triage = null,
    actionResults = [],
} = {}) {
    const normalized = ['idle', 'watch', 'note', 'confused', 'happy', 'hold'].includes(preferred)
        ? preferred
        : 'watch';
    const resultText = (Array.isArray(actionResults) ? actionResults : [])
        .map(value => String(value || ''))
        .join('\n');

    // Actual execution result outranks the model's pre-action guess.
    if (
        /没弄成|不敢乱碰|没认准|没找到|不见了|没有拿到结果|先等它结束|关着.+没法|不能|失败/u.test(resultText)
    ) {
        return 'hold';
    }
    if (proposal) return 'note';
    if (triage?.route === 'mama') {
        return ['confused', 'hold'].includes(normalized) ? normalized : 'confused';
    }
    if (/记忆整理已经开始|记忆已经在整理/u.test(resultText)) return 'note';
    if (
        resultText
        && /已经(?:打开|关掉|开启|关闭|停|开始)|检查完了|修正\s*\d+\s*项|停下来了/u.test(resultText)
    ) {
        return 'happy';
    }
    return normalized;
}

function lingqiLocalPersonSummary(person) {
    if (!person) return '这个人我没认准……名字可能重了，或者人物板块里还没有她。';
    const parts = [
        `${person.name}${person.isUser ? '（玩家角色）' : ''}`,
        `位置：${String(person.location || '还没记清').trim()}`,
        `正在做：${String(person.action || '没有明确动作').trim()}`,
        `意图：${String(person.intent || '没有明确记录').trim()}`,
        person.isUser
            ? '记录方式：只保存正文已经明确发生的客观状态'
            : `后台推演：${person.simulationEnabled === false ? '已关闭' : '开启'}${person.lifeTickPriority ? '，下一轮优先' : ''}`,
        person.locked ? '状态：已锁定，后台不会随便改核心状态' : '',
    ].filter(Boolean);
    return parts.join('\n');
}

const LINGQI_GUIDE_SETTING_LABELS = Object.freeze({
    memoryAutoIndexInterval: '记忆整理间隔',
    maxOutputTokens: '全局 Token 上限',
    generationTimeoutMs: '全局最长等待',
    uiScale: '界面字号',
    orbEnabled: '显示悬浮球',
    orbEdgeHide: '悬浮球贴边收纳',
    theme: '界面明暗',
});

function lingqiGuideSettingValue(key, value) {
    if (key === 'injectionTimeMode') return lingqiSettingDisplayValue(key, value);
    if (key === 'memoryAutoIndexInterval') return Number(value) > 0 ? `每 ${Number(value)} 轮` : '手动';
    if (key === 'maxOutputTokens') return Number(value) > 0 ? String(Number(value)) : '自动';
    if (key === 'generationTimeoutMs') return Number(value) > 0 ? `${Math.round(Number(value) / 1000)} 秒` : '自动';
    if (key === 'uiScale') return ({ compact: '紧凑', comfortable: '标准', large: '大字' }[value] || String(value));
    if (key === 'theme') return ({ auto: '自动', day: '日间', night: '夜间' }[value] || String(value));
    if (typeof value === 'boolean') return value ? '开启' : '关闭';
    return String(value ?? '未设置');
}

function lingqiLocalWorldDiagnosis() {
    const settings = getSettings();
    const sync = getSyncStatus();
    const narrative = latestNarrativeSyncSnapshot();
    const connection = getConnectionInfo();
    const lastOperation = getLastCustomApiOperation();

    if (!settings.worldSimulationEnabled) {
        return '原因找到了：世界推演总开关现在是关闭的。自动推演和手动推演都不会正常跑。';
    }
    if (!connection.configured) {
        return '原因找到了：当前没有可用的后台模型连接。先把世界背面的 API / 酒馆连接配好。';
    }
    if (sync.phase === 'running') {
        return `没有卡住，世界推演正在跑。${sync.message ? `\n现在：${String(sync.message).slice(0, 220)}` : ''}`;
    }
    if ((sync.queue?.pendingTurns || 0) > 0) {
        return `没有丢，队列里还有 ${sync.queue.pendingTurns} 轮待处理。前面的后台任务结束后会继续。`;
    }
    if (sync.error) {
        return `最近一次世界任务失败了：${String(sync.error).slice(0, 360)}\n我只报实际留下的错误，不替接口猜原因。`;
    }
    if (lastOperation && lastOperation.phase === 'error') {
        const status = Number(lastOperation.upstreamStatus || lastOperation.transportStatus) || '';
        const detail = redactDiagnosticText(lastOperation.errorSummary || lastOperation.errorType || '上游没有留下可读原因');
        return `最近一次后台请求失败${status ? `（${status}）` : ''}：${detail}`;
    }
    if (narrative.needsSimulation && !settings.worldAutoEnabled) {
        return `最新正文还没推演，但自动世界推演是关闭的。现在有 ${narrative.pendingTurns || 1} 轮在等手动推演。`;
    }
    if (narrative.needsSimulation) {
        return `最新正文还没跟上，目前有 ${narrative.pendingTurns || 1} 轮待推演。自动推演开着；如果一直不启动，再检查是否有别的后台任务占着队列。`;
    }
    return '我核对了开关、连接、任务、队列和最新正文快照：现在已经跟上，没有发现卡住或失败。';
}

function resolveLingqiLocalQuery(request, { state, settings, sync, clock }) {
    if (!request) return null;
    if (request.type === 'list_skills') {
        return { reply: buildLingqiSkillMenuText(), mascotState: 'happy', actions: [] };
    }
    if (request.type === 'setting_guide') {
        const guide = LINGQI_SETTING_GUIDES.find(item => item.id === request.guideId);
        if (!guide) return null;
        const current = guide.keys
            .map(key => `· ${LINGQI_SETTING_LABELS[key] || LINGQI_GUIDE_SETTING_LABELS[key] || key}：${lingqiGuideSettingValue(key, settings[key])}`)
            .join('\n');
        const reply = [
            `${guide.title}这样找：${guide.path}`,
            current ? `\n你现在的设置：\n${current}` : '',
            `\n它控制什么：${guide.meaning}`,
            `\n怎么选：\n${guide.choices.map(item => `· ${item}`).join('\n')}`,
            `\n我的建议：${guide.recommendation}`,
            guide.delegable ? '\n这里面的安全开关，你也可以直接告诉我“打开 / 关闭 / 改成哪一档”，我会先核对再代办。' : '',
        ].filter(Boolean).join('');
        return { reply, mascotState: 'watch', actions: [] };
    }
    if (request.type === 'status_overview') {
        const narrative = latestNarrativeSyncSnapshot();
        const activeTasks = (sync.activeBackgroundTasks || []).filter(label => label !== '玲七');
        const disabledPeople = (state.people || []).filter(person => !person.isUser && person.simulationEnabled === false).length;
        const lines = [
            `世界时间：${state.clock?.anchored ? clock.stamp : '还没钉稳'}`,
            `最新正文：${narrative.needsSimulation ? `待推演 ${narrative.pendingTurns || 1} 轮` : '已经跟上'}`,
            `后台任务：${activeTasks.length ? activeTasks.join('、') : '空闲'}${sync.queue?.pendingTurns ? `；队列 ${sync.queue.pendingTurns} 轮` : ''}`,
            `人物：${state.people?.length || 0} 个${disabledPeople ? `，其中 ${disabledPeople} 个关闭后台推演` : ''}`,
            `暗流：${(state.events || []).filter(event => ['active', 'waiting', 'ready'].includes(event.status)).length} 条活跃；回声 ${state.echoes?.length || 0} 条`,
            `记忆：事实 ${state.storyMemory?.facts?.length || 0}，摘要 ${state.storyMemory?.summaries?.length || 0}，线索 ${state.storyMemory?.clues?.length || 0}`,
            sync.error ? `最近错误：${String(sync.error).slice(0, 260)}` : '',
        ].filter(Boolean);
        return { reply: `我巡了一圈。\n${lines.join('\n')}`, mascotState: sync.error ? 'hold' : 'watch', actions: [] };
    }
    if (request.type === 'list_people') {
        const people = (state.people || [])
            .slice()
            .sort((a, b) => Number(b.relevance || 0) - Number(a.relevance || 0));
        if (!people.length) return { reply: '人物板块现在还是空的。', mascotState: 'idle', actions: [] };
        const shown = people.slice(0, 18).map(person => (
            `· ${person.name}${person.isUser ? '（玩家）' : person.simulationEnabled === false ? '（推演关闭）' : ''}｜${person.location || '位置未记'}｜${person.action || '暂无动作'}`
        ));
        if (people.length > shown.length) shown.push(`· 还有 ${people.length - shown.length} 个，点名问我会更准。`);
        return { reply: `这里有 ${people.length} 个人物：\n${shown.join('\n')}`, mascotState: 'watch', actions: [] };
    }
    if (request.type === 'person_status') {
        const person = findLingqiPersonTarget(request);
        return { reply: lingqiLocalPersonSummary(person), mascotState: person ? 'watch' : 'confused', actions: [] };
    }
    if (request.type === 'diagnose_person') {
        const person = findLingqiPersonTarget(request);
        if (!person) return { reply: lingqiLocalPersonSummary(null), mascotState: 'confused', actions: [] };
        const reasons = [];
        if (person.isUser) reasons.push('她是玩家角色，不走普通 NPC 后台人物推演');
        if (!settings.worldSimulationEnabled) reasons.push('世界推演总开关关闭');
        if (person.simulationEnabled === false) reasons.push('她自己的后台推演开关关闭');
        if (!person.isUser && !settings.enhancedBackgroundSimulation) reasons.push('强化后台人物推演关闭，镜头外人物只按普通到期与相关性结算');
        if ((sync.activeBackgroundTasks || []).length) reasons.push(`后台当前正在处理：${sync.activeBackgroundTasks.join('、')}`);
        const diagnosis = reasons.length
            ? `我找到这些可能直接影响她更新的条件：\n${reasons.map(item => `· ${item}`).join('\n')}`
            : '开关和任务状态里没有找到能直接证明的原因。我不会硬猜；她也可能只是没有到期，或者这段时间确实没有状态变化。';
        return {
            reply: `${diagnosis}\n\n${lingqiLocalPersonSummary(person)}`,
            mascotState: reasons.length ? 'watch' : 'confused',
            actions: [],
        };
    }
    if (request.type === 'recent_events') {
        const events = (state.events || [])
            .filter(event => ['active', 'waiting', 'ready'].includes(event.status))
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        if (!events.length) return { reply: '现在没有活跃暗流。安静也算正常，不硬编一条。', mascotState: 'idle', actions: [] };
        const shown = events.slice(0, 8).map(event => (
            `· ${event.title || '未命名事件'}｜${event.status || 'active'}｜${event.place || '地点未定'}\n  ${String(event.summary || event.cause || event.expectedResult || '暂无摘要').slice(0, 180)}`
        ));
        return { reply: `现在有 ${events.length} 条活跃暗流：\n${shown.join('\n')}`, mascotState: 'watch', actions: [] };
    }
    if (request.type === 'memory_status') {
        const memory = state.storyMemory || {};
        const pending = Number(sync.memory?.pendingAssistantResponses || 0);
        const lines = [
            `长期事实：${memory.facts?.length || 0}`,
            `分层摘要：${memory.summaries?.length || 0}`,
            `活跃线索：${(memory.clues || []).filter(item => !['resolved', 'discarded'].includes(item.status)).length}`,
            `待整理正文：${pending}`,
            `记忆任务：${sync.memory?.phase || 'idle'}${sync.memory?.message ? `｜${String(sync.memory.message).slice(0, 180)}` : ''}`,
            `记忆系统：${settings.memorySystemEnabled ? '开启' : '关闭'}；正文注入：${settings.injectionMemory ? '开启' : '关闭'}`,
        ];
        return { reply: `记忆盒子现在是这样：\n${lines.join('\n')}`, mascotState: 'note', actions: [] };
    }
    if (request.type === 'settings_overview') {
        const keys = [
            'worldSimulationEnabled', 'worldAutoEnabled', 'enhancedBackgroundSimulation',
            'recordPlayerCharacter', 'worldPromptInjection', 'injectionTimeMode',
            'injectionPeople', 'injectionEvents', 'injectionMemory', 'injectionPublicOpinion', 'injectionSocial',
            'socialAutoEnabled', 'memorySystemEnabled', 'publicOpinionAutoEnabled',
        ];
        const lines = keys.map(key => `· ${LINGQI_SETTING_LABELS[key]}：${lingqiSettingDisplayValue(key, settings[key])}`);
        return { reply: `常用开关：\n${lines.join('\n')}`, mascotState: 'watch', actions: [] };
    }
    if (request.type === 'social_overview') {
        const social = normalizeSocialState(getStore().social || emptySocialState(), state.people || []);
        const accepted = social.connections.filter(item => item.status === 'accepted');
        const incoming = social.connections.filter(item => item.status === 'incoming');
        const pending = social.connections.filter(item => item.status === 'pending');
        const unread = social.notices.filter(item => !item.readAt);
        const peopleById = new Map((state.people || []).map(person => [String(person.id || ''), person]));
        const requestNames = incoming.map(item => peopleById.get(item.personId)?.name).filter(Boolean);
        const lines = [
            `通讯好友：${accepted.length} 人`,
            `收到的好友申请：${incoming.length}${requestNames.length ? `（${requestNames.join('、')}）` : ''}`,
            `你发出、仍待处理：${pending.length}`,
            `未读通讯提醒：${unread.length}`,
            `朋友圈动态：${social.moments.length} 条`,
            `角色主动联系：${settings.socialAutoEnabled !== false ? '开启' : '关闭'}`,
            `聊天影响正文：${settings.injectionSocial === true ? '开启（仍只作未结算记录）' : '关闭'}`,
        ];
        return { reply: `我把通讯角落巡了一圈，叼回来的情况是：\n${lines.join('\n')}`, mascotState: unread.length || incoming.length ? 'watch' : 'idle', actions: [] };
    }
    if (request.type === 'social_person_status') {
        const person = findLingqiPersonTarget(request);
        if (!person || person.isUser) return { reply: '耳朵转了两圈，还是没认准你说的是谁。我先不拿关系乱猜。', mascotState: 'confused', actions: [] };
        const social = normalizeSocialState(getStore().social || emptySocialState(), state.people || []);
        const relation = social.connections.find(item => item.personId === String(person.id || ''));
        const label = {
            accepted: '通讯好友', incoming: '对方向你发来好友申请', pending: '你的申请待处理',
            declined: '申请未通过', suggested: '可能认识，但还不是好友', removed: '好友关系已结束',
        }[relation?.status] || '没有通讯关系';
        const evidence = relation?.decisionReply || relation?.decisionReason || relation?.evidence || '';
        return { reply: `我把 ${person.name} 的关系卡翻出来啦：${label}${evidence ? `\n留下的记录：${evidence}` : ''}`, mascotState: 'watch', actions: [] };
    }
    if (request.type === 'diagnose_world') {
        const reply = lingqiLocalWorldDiagnosis();
        return { reply, mascotState: /失败|错误|关闭|没有可用|卡住/u.test(reply) ? 'hold' : 'watch', actions: [] };
    }
    if (request.type === 'search_lingqi_chat') {
        const lingqi = normalizeLingqiState(getStore().lingqi || emptyLingqiState());
        const matches = findLingqiChatMatches(lingqi.messages, request.query, 8);
        if (!matches.length) {
            return { reply: `我翻了翻，没找到提到“${request.query}”的玲七聊天。换个更接近原话的词？`, mascotState: 'confused', actions: [] };
        }
        const lines = matches.map(item => {
            const date = item.at ? new Date(item.at) : null;
            const stamp = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : `第 ${item.index + 1} 条`;
            const preview = item.text.replace(/\s+/gu, ' ').slice(0, 120);
            return `· ${stamp}｜${item.role === 'user' ? '你' : '玲七'}：${preview}${item.text.length > 120 ? '…' : ''}`;
        });
        return { reply: `找到 ${matches.length} 处提到“${request.query}”：\n${lines.join('\n')}`, mascotState: 'watch', actions: [] };
    }
    return null;
}

function resolveLingqiLocalButlerRequest(userText = '') {
    const raw = String(userText || '').trim();
    const text = raw.toLocaleLowerCase();
    const settings = getSettings();
    const state = getState();
    const sync = getSyncStatus();
    const clock = formatWorldCalendar(state);

    const chatDeleteAction = parseLingqiLocalChatDeleteRequest(raw);
    if (chatDeleteAction) {
        return {
            reply: '嗯。我先把你说的那段圈出来，不会直接删。',
            mascotState: 'watch',
            actions: [chatDeleteAction],
        };
    }

    const localQuery = parseLingqiLocalQueryRequest(raw, state.people || []);
    const localQueryResponse = resolveLingqiLocalQuery(localQuery, { state, settings, sync, clock });
    if (localQueryResponse) return localQueryResponse;

    // Pure local questions: no reason to spend an extra model request.
    if (/(?:当前|现在|插件).{0,4}(?:版本|version)|(?:版本号)/iu.test(raw)) {
        return {
            reply: `版本……这里写着 ${PLUGIN_VERSION}。`,
            mascotState: 'watch',
            actions: [],
        };
    }
    if (/(?:现在|当前).{0,5}(?:几点|时间|日期)|世界时间.{0,4}(?:多少|是什么|呢|？|\?)/iu.test(raw)) {
        return {
            reply: state.clock?.anchored
                ? `现在是 ${clock.stamp}。嗯，钟在这里。`
                : '现在还没把故事时间钉稳。先别拿占位时间当真的。',
            mascotState: 'watch',
            actions: [],
        };
    }
    if (/(?:现在|当前).{0,8}(?:什么|哪些|有啥).{0,5}(?:后台任务|任务).{0,4}(?:跑|运行)|后台任务.{0,5}(?:有哪些|有啥|在跑)/iu.test(raw)) {
        const tasks = (sync.activeBackgroundTasks || []).filter(label => label !== '玲七');
        return {
            reply: tasks.length
                ? `现在还在动的有：${tasks.join('、')}。`
                : '现在没有别的后台任务在跑。',
            mascotState: tasks.length ? 'watch' : 'idle',
            actions: [],
        };
    }

    const settingQuestions = [
        { re: /人物(?:状态)?注入.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'injectionPeople' },
        { re: /记录玩家角色.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'recordPlayerCharacter' },
        { re: /记忆注入.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'injectionMemory' },
        { re: /舆情注入.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'injectionPublicOpinion' },
        { re: /(?:通讯|聊天).{0,5}(?:影响正文|注入).{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'injectionSocial' },
        { re: /(?:角色|人物).{0,5}(?:主动联系|主动消息|主动申请).{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'socialAutoEnabled' },
        { re: /世界事实注入.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'injectionFacts' },
        { re: /自动(?:世界)?推演.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'worldAutoEnabled' },
        { re: /记忆系统.{0,5}(?:开|关|开启|关闭|状态|吗|么)/iu, key: 'memorySystemEnabled' },
    ];
    for (const item of settingQuestions) {
        if (!item.re.test(raw)) continue;
        return {
            reply: `${LINGQI_SETTING_LABELS[item.key]}现在是${lingqiSettingDisplayValue(item.key, settings[item.key])}。`,
            mascotState: 'watch',
            actions: [],
        };
    }

    if (/世界时间注入.{0,8}(?:什么|哪|模式|状态|现在)/iu.test(raw)) {
        return {
            reply: `世界时间注入现在是“${lingqiSettingDisplayValue('injectionTimeMode', settings.injectionTimeMode)}”。`,
            mascotState: 'watch',
            actions: [],
        };
    }

    if (/^(?:帮我|请|让玲七|玲七)?\s*(?:推演|同步)\s*(?:一下|下)?\s*(?:最新|新的)?\s*(?:正文|剧情)\s*[吧。！!]*$/iu.test(raw)) {
        return {
            reply: '我先看看有没有落下。真没跟上，我再伸爪子～',
            mascotState: 'watch',
            actions: [{ type: 'simulate_latest' }],
        };
    }

    if (/^(?:帮我|请|让玲七|玲七)?\s*(?:出去)?\s*(?:巡一圈|看看外面|刷新世界舆情|刷新舆情)\s*[吧。！!]*$/iu.test(raw)) {
        return {
            reply: '外面？唔……我可以出去转一圈。先等你点头。',
            mascotState: 'watch',
            actions: [{ type: 'refresh_public_world' }],
        };
    }
    if (/^(?:帮我|请|让玲七|玲七)?\s*(?:刷新|看看|看下)\s*(?:新的)?朋友圈\s*[吧。！!]*$/iu.test(raw)) {
        return { reply: '我去朋友圈窗边蹲一会儿，看看有没有人真想发动态～这会叫一次后台模型；开着配图时还可能再用一次生图接口，先让你确认。', mascotState: 'watch', actions: [{ type: 'social_refresh_moments' }] };
    }

    const socialSendMatch = raw.match(/^(?:帮我|请|让玲七|玲七)?\s*(?:给|向)\s*([^，。！？!：:]{1,40})\s*(?:发消息|发条消息|说)\s*[：:]?\s*[“「『]?([^”」』]{1,1600})[”」』]?\s*$/iu);
    if (socialSendMatch) {
        return { reply: '这句话会真的送到对方那边。我先用爪爪按住，把收件人和原文放进确认卡；你点头我再发。', mascotState: 'watch', actions: [{ type: 'social_send_message', personName: socialSendMatch[1].trim(), text: socialSendMatch[2].trim() }] };
    }
    const socialRelationMatch = raw.match(/^(?:帮我|请|让玲七|玲七)?\s*(接受|同意|拒绝|婉拒|删除|删掉|移除)\s*([^，。！？!]{1,40}?)(?:的)?\s*(好友申请|好友)?\s*[吧。！!]*$/iu);
    if (socialRelationMatch) {
        const verb = socialRelationMatch[1];
        const type = /接受|同意/u.test(verb)
            ? 'social_accept_request'
            : /拒绝|婉拒/u.test(verb)
                ? 'social_refuse_request'
                : 'social_remove_friend';
        return { reply: '关系动作不能一爪拍下去。我先把人物和当前关系核准，再让你确认。', mascotState: 'hold', actions: [{ type, personName: socialRelationMatch[2].trim() }] };
    }

    const priorityPersonMatch = raw.match(
        /^(?:帮我|请|让玲七|玲七)?\s*(?:让|把)?\s*([^，。！？!]{1,40}?)\s*(?:下一轮优先|排到下一轮前面|下一轮先看)\s*[吧。！!]*$/iu,
    );
    if (priorityPersonMatch) {
        return {
            reply: `${priorityPersonMatch[1].trim()}下一轮先看。好，我把她往前挪一点。`,
            mascotState: 'note',
            actions: [{ type: 'prioritize_person', personName: priorityPersonMatch[1].trim(), enabled: true }],
        };
    }

    const catchUpPersonMatch = raw.match(
        /^(?:帮我|请|让玲七|玲七)?\s*(?:补一下|补下|看看)\s*([^，。！？!]{1,40}?)(?:的)?\s*(?:近况|最近怎么样)\s*[吧。！!]*$/iu,
    );
    if (catchUpPersonMatch) {
        return {
            reply: `我去看看${catchUpPersonMatch[1].trim()}最近在做什么～不过这会叫一次后台模型，先等你点头。`,
            mascotState: 'watch',
            actions: [{ type: 'catch_up_person', personName: catchUpPersonMatch[1].trim() }],
        };
    }

    // Reversible direct commands. Keep patterns deliberately strict so casual
    // discussion such as“如果关掉会怎样”does not silently change settings.
    const directSettingCommands = [
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:关掉|关闭)\s*(?:人物(?:状态)?注入)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'injectionPeople', value: false },
            reply: '人物状态不想递给正文。嗯，我来关。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:打开|开启)\s*(?:人物(?:状态)?注入)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'injectionPeople', value: true },
            reply: '人物状态要递给正文。好。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:关掉|关闭)\s*(?:角色|人物)?(?:主动联系|主动消息|主动申请)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'socialAutoEnabled', value: false },
            reply: '角色不再主动发消息、申请或动态。已有关系和记录都保留。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:打开|开启)\s*(?:角色|人物)?(?:主动联系|主动消息|主动申请)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'socialAutoEnabled', value: true },
            reply: '角色可以按人设低频主动联系；没有动机时仍会安静。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:关掉|关闭|不要记录)\s*(?:玩家角色|user|我)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'recordPlayerCharacter', value: false },
            reply: '不把玩家当后台人物记。嗯。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:打开|开启|记录)\s*(?:玩家角色|user)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'recordPlayerCharacter', value: true },
            reply: '要记录玩家已经明确发生的客观状态。好。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|把|直接)?\s*(?:时间|世界时间)(?:注入)?\s*(?:改成|设成|用)\s*(?:最小锚点|最小时间锚点)\s*[吧。！!]*$/iu,
            action: { type: 'update_setting', setting: 'injectionTimeMode', value: 'anchor' },
            reply: '时间只留最小锚点。这样不会一直报时。',
            mascotState: 'happy',
        },
        {
            re: /^(?:帮我|请|直接)?\s*(?:停止|停掉|停下)\s*(?:全部|所有)?\s*(?:后台任务|后台)\s*[吧。！!]*$/iu,
            action: { type: 'cancel_background_tasks' },
            reply: '都先停一下。玲七自己留着把这句话说完。',
            mascotState: 'hold',
        },
        {
            re: /^(?:帮我|请|直接)?\s*(?:停止|停掉|停下)\s*(?:当前)?\s*(?:世界)?推演\s*[吧。！!]*$/iu,
            action: { type: 'cancel_simulation' },
            reply: '这次世界推演先停。',
            mascotState: 'hold',
        },
        {
            re: /^(?:帮我|帮忙|请|给我|直接)?\s*(?:整理|收拾|归档)(?:一下|下)?\s*(?:长期)?记忆\s*[吧。！!]*$/iu,
            action: { type: 'organize_memory' },
            reply: '记忆……嗯，我来收拾。',
            mascotState: 'note',
        },
    ];
    for (const item of directSettingCommands) {
        if (!item.re.test(raw)) continue;
        return {
            reply: item.reply,
            mascotState: item.mascotState || 'watch',
            actions: [item.action],
        };
    }

    return null;
}

async function sendLingqiMessage(text) {
    const userText = String(text || '').trim().slice(0, 3000);
    if (!userText) throw new Error('先跟玲七说点什么嘛～');
    if (runtime.activeLingqi && !runtime.activeLingqi.controller?.signal?.aborted) {
        throw new Error('玲七还在想上一句话呢～等她一下下');
    }

    const localRequest = resolveLingqiLocalButlerRequest(userText);
    if (localRequest) {
        let localStore = getStore();
        localStore.lingqi = addLingqiMessage(localStore.lingqi || emptyLingqiState(), 'user', userText);
        saveStore(localStore);
        const results = await executeLingqiButlerActions(localRequest.actions);
        const finalReply = [
            localRequest.reply,
            ...results.map(value => `· ${value}`),
        ].filter(Boolean).join('\n');
        const completedMascotState = resolveCompletedLingqiMascotState(
            localRequest.mascotState || 'watch',
            { actionResults: results },
        );
        localStore = getStore();
        localStore.lingqi = addLingqiMessage(
            localStore.lingqi || emptyLingqiState(),
            'assistant',
            finalReply,
        );
        localStore.lingqi.mascotState = completedMascotState;
        saveStore(localStore, { immediate: true });
        sealPendingLingqiChatDeletionSnapshot();
        refreshInjection();
        runtime.lingqiStatus = {
            phase: 'success',
            message: runtime.pendingLingqiAction ? '范围圈好啦～等你点头。' : localRequest.actions?.length ? '玲七顺手弄好啦～' : '玲七知道这个～',
            error: '',
        };
        runtime.ui?.render();
        return {
            reply: finalReply,
            mascotState: completedMascotState,
            actions: localRequest.actions || [],
            local: true,
        };
    }

    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    const active = { chatToken, contextEpoch, controller, promise: null };
    runtime.activeLingqi = active;

    let store = getStore();
    store.lingqi = addLingqiMessage(store.lingqi || emptyLingqiState(), 'user', userText);
    saveStore(store);
    runtime.lingqiStatus = { phase: 'running', message: '……', error: '' };
    runtime.ui?.render();

    const prompt = buildLingqiChatPrompt({
        world: lingqiWorldDigest(store.currentState),
        messages: store.lingqi.messages.slice(0, -1),
        userText,
        butlerContext: buildLingqiButlerContext(userText),
    });

    const promise = (async () => {
        try {
            const parsed = await runWithRetries(async attempt => {
                const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                    maxTokens: retryTokenBudget(1800, attempt),
                    temperature: attempt > 0 ? 0.25 : 0.55,
                    signal: controller.signal,
                    taskKind: 'lingqi',
                    rejectTruncated: true,
                });
                const object = extractJsonObject(raw);
                if (object) return object;
                throw unreadableJsonError(raw);
            }, {
                retries: 1,
                shouldRetry: error => !isAbortError(error),
                signal: controller.signal,
            });

            if (
                controller.signal.aborted
                || currentChatToken() !== chatToken
                || runtime.contextEpoch !== contextEpoch
            ) return null;

            const response = normalizeLingqiAssistantPayload(parsed);
            const actionResults = await executeLingqiButlerActions(response.actions);
            const triage = finalizeLingqiTriage(response, actionResults, userText);
            const actionReply = actionResults.length
                ? actionResults.map(text => `· ${text}`).join('\n')
                : '';
            const nextStepLine = (
                ['self_service', 'external'].includes(triage.route)
                && triage.nextStep
                && !String(response.reply || '').includes(triage.nextStep)
            )
                ? `· 可以先试：${triage.nextStep}`
                : '';
            const fallbackHelpLine = triage.route === 'mama'
                && !/(妈妈|帖子|看不出来|不知道|查不明白|求助)/u.test(response.reply)
                ? '这个我这里还查不明白……得问妈妈。我把小纸条写好了。'
                : '';
            const finalReply = [
                response.reply,
                actionReply,
                nextStepLine,
                fallbackHelpLine,
            ].filter(Boolean).join('\n');
            const completedMascotState = resolveCompletedLingqiMascotState(
                response.mascotState,
                {
                    proposal: response.proposal,
                    triage,
                    actionResults,
                },
            );

            store = getStore();
            store.lingqi = addLingqiMessage(
                store.lingqi || emptyLingqiState(),
                'assistant',
                finalReply,
                {
                    planText: response.proposal?.planText || response.proposal?.directive || '',
                    needsAuthorHelp: triage.route === 'mama',
                    supportReason: triage.reason,
                    supportTriage: triage,
                },
            );
            store.lingqi.pendingProposal = response.proposal;
            store.lingqi.mascotState = completedMascotState;
            const autoConfirmed = shouldAutoConfirmLingqiProposal(
                userText,
                response.proposal?.autoConfirm,
            );
            if (autoConfirmed) {
                store.lingqi = confirmLingqiProposal(store.lingqi);
            }
            saveStore(store, { immediate: true });
            sealPendingLingqiChatDeletionSnapshot();
            refreshInjection();
            runtime.lingqiStatus = {
                phase: 'success',
                message: autoConfirmed
                    ? '玲七已经把这张小纸条贴好啦～'
                    : response.proposal
                        ? '玲七写好了一张小纸条，等你点头～'
                        : triage.route === 'mama'
                            ? '这个玲七也没查明白，给妈妈的小纸条写好啦～'
                            : runtime.pendingLingqiAction
                                ? '玲七把要做的动作压住啦～等你点头。'
                                : actionResults.length
                                    ? '玲七已经把能代办的事情处理啦～'
                                    : '玲七想好啦～',
                error: '',
            };
            runtime.ui?.render();
            return {
                ...response,
                mascotState: completedMascotState,
            };
        } catch (error) {
            if (isAbortError(error) || controller.signal.aborted) return null;
            runtime.lingqiStatus = {
                phase: 'error',
                message: '玲七刚刚没接上话……',
                error: describeError(error),
            };
            runtime.ui?.render();
            throw error;
        } finally {
            if (runtime.activeLingqi === active) runtime.activeLingqi = null;
            runtime.ui?.render();
        }
    })();
    active.promise = promise;
    return promise;
}

function confirmLingqiNoteProposal() {
    const store = getStore();
    if (!store.lingqi?.pendingProposal) return false;
    store.lingqi = confirmLingqiProposal(store.lingqi);
    saveStore(store, { immediate: true });
    refreshInjection();
    runtime.lingqiStatus = { phase: 'success', message: 'ฅ', error: '' };
    runtime.ui?.render();
    return true;
}

function dismissLingqiNoteProposal() {
    const store = getStore();
    if (!store.lingqi?.pendingProposal) return false;
    store.lingqi = dismissLingqiProposal(store.lingqi);
    saveStore(store);
    runtime.lingqiStatus = { phase: 'idle', message: '……', error: '' };
    runtime.ui?.render();
    return true;
}

function updateLingqiNoteStatus(noteId, status) {
    const store = getStore();
    store.lingqi = setLingqiNoteStatus(store.lingqi || emptyLingqiState(), noteId, status);
    saveStore(store, { immediate: true });
    refreshInjection();
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


function resetRuntimeMaintenanceState({
    clearRetryState = false,
} = {}) {
    runtime.dataEpoch += 1;

    const abortables = [
        runtime.activeSimulation?.controller,
        runtime.activeHistoryScan,
        runtime.activeWorldPulse?.controller,
        runtime.activePublicImpact?.controller,
        runtime.activeCorrection?.controller,
        runtime.activePublicOpinion?.controller,
        runtime.publicOpinionRefreshTransaction?.controller,
        runtime.activePublicOpinionSandbox?.controller,
        runtime.activeObservation?.controller,
        runtime.activeLingqi?.controller,
        runtime.activeSocial?.controller,
        runtime.activeFriendRequest?.controller,
        runtime.activeMoments?.controller,
        runtime.activeSocialPulse?.controller,
    ];
    for (const abortable of abortables) {
        try {
            abortable?.abort?.();
        } catch {
            // Maintenance must continue even if one stale task object is malformed.
        }
    }

    if (runtime.autoMemoryTimer !== null) {
        window.clearTimeout(runtime.autoMemoryTimer);
        runtime.autoMemoryTimer = null;
    }
    if (runtime.manualUndoTimer !== null) {
        window.clearTimeout(runtime.manualUndoTimer);
        runtime.manualUndoTimer = null;
    }

    runtime.activeSimulation = null;
    runtime.activeHistoryScan = null;
    runtime.activeWorldPulse = null;
    runtime.activePublicImpact = null;
    runtime.activeCorrection = null;
    runtime.activePublicOpinion = null;
    runtime.publicOpinionRefreshTransaction = null;
    runtime.activePublicOpinionSandbox = null;
    runtime.activeObservation = null;
    runtime.activeLingqi = null;
    runtime.activeSocial = null;
    runtime.activeFriendRequest = null;
    runtime.activeMoments = null;
    runtime.activeSocialPulse = null;
    runtime.lingqiStatus = { phase: 'idle', message: '', error: '' };
    runtime.socialStatus = { phase: 'idle', message: '', error: '', conversationId: '' };
    runtime.friendRequestStatus = { phase: 'idle', message: '', error: '', personId: '' };
    runtime.momentsStatus = { phase: 'idle', message: '', error: '' };
    runtime.pendingLingqiAction = null;
    runtime.pendingPublicImpact = false;
    runtime.pendingPublicOpinion = false;
    runtime.inBackgroundGeneration = false;
    runtime.consistencyBarrierRunning = false;
    runtime.queuedSimulations.clear();
    clearDeferredManualSimulation();
    runtime.simulationChain = Promise.resolve();
    runtime.simulationCount = 0;
    runtime.manualUndo = null;
    runtime.editDecision = null;
    runtime.injection = { text: '', eventIds: [], directorNoteIds: [] };
    runtime.generationOffer = { eventIds: [], directorNoteIds: [], at: 0, rerollBase: false };
    runtime.lastPromptBridge = null;
    runtime.lastTaskConnection = null;
    runtime.customModels = [];
    runtime.modelPullStatus = { phase: 'idle', message: '' };
    runtime.worldbookScan = {
        phase: 'idle',
        message: '',
        bookName: '',
        entries: [],
    };
    runtime.historyProgress = {
        kind: 'memory',
        phase: 'idle',
        processed: 0,
        total: 0,
        message: '',
    };
    runtime.publicOpinionStatus = {
        phase: 'idle',
        message: '舆情还没开张呢～',
        error: '',
    };
    runtime.publicOpinionSandboxStatus = {
        phase: 'idle',
        message: '',
        error: '',
    };
    runtime.syncStatus = {
        phase: 'idle',
        message: '还没推演过～世界先在这里等你',
        error: '',
        attemptedAt: '',
        succeededAt: '',
        method: '',
        summary: null,
    };

    resetLastCustomApiOperation();
    if (clearRetryState) resetRetryControl();
}

function clearStoredChatCaches() {
    const store = getStore();
    store.personObservations = {};
    store.publicOpinionSandbox = emptyPublicOpinionSandbox();
    store.historyBootstrapCheckpoint = null;
    saveStore(store, { immediate: true });
    return store;
}

function clearCurrentChatCache() {
    // Keep route cooldowns: a real 429 cooldown is protection, not corrupt cache.
    resetRuntimeMaintenanceState({ clearRetryState: false });
    clearStoredChatCaches();
    refreshInjection();
    runtime.ui?.render();
    return {
        cleared: true,
        preservedWorldState: true,
        preservedApiSettings: true,
    };
}

function clearMessageBranchSnapshots(context = getContext()) {
    let removed = 0;
    for (const message of context?.chat || []) {
        if (message?.extra && Object.prototype.hasOwnProperty.call(message.extra, SNAPSHOT_KEY)) {
            delete message.extra[SNAPSHOT_KEY];
            removed += 1;
        }
        for (const swipe of Array.isArray(message?.swipe_info) ? message.swipe_info : []) {
            if (swipe?.extra && Object.prototype.hasOwnProperty.call(swipe.extra, SNAPSHOT_KEY)) {
                delete swipe.extra[SNAPSHOT_KEY];
                removed += 1;
            }
        }
    }
    return removed;
}

async function resetCurrentChatData() {
    const context = getContext();
    if (!hasChatContext()) throw new Error('当前没有可重置的聊天');

    // Do not create a recovery point here. A reset that secretly leaves a complete
    // restore copy would not be a real clean-room test.
    resetRuntimeMaintenanceState({ clearRetryState: false });

    const removedSnapshots = clearMessageBranchSnapshots(context);
    const freshStore = makeStore();
    runtime.transientStore = null;
    context.chatMetadata[STATE_KEY] = freshStore;

    if (typeof context.saveMetadata === 'function') {
        await context.saveMetadata();
    } else {
        context.saveMetadataDebounced?.();
    }
    await context.saveChat?.();

    refreshInjection();
    runtime.ui?.render();

    return {
        reset: true,
        removedSnapshots,
        preservedChatMessages: true,
        preservedApiSettings: true,
    };
}


async function checkAndCorrectWorldState() {
    if (coreSimulationBusy()) {
        throw new Error('现在还有世界任务在跑～等这一轮结束后再检查，避免两份状态互相覆盖');
    }

    const settings = getSettings();
    const chatToken = currentChatToken();
    const controller = new AbortController();
    runtime.activeCorrection = {
        controller,
        chatToken,
        startedAt: Date.now(),
    };
    setBusy(true);
    setSyncStatus({
        phase: 'running',
        message: '正在核对正文证据和后台状态，只修明确矛盾项～',
        error: '',
    });

    try {
        const narrativeText = recentChatText(20);
        const prompt = buildStateCorrectionPrompt(getState(), {
            narrativeText,
            userName: getContext()?.name1 || '',
        });

        const payload = await runWithRetries(async attempt => {
            const raw = await backgroundSimulation(retryJsonPrompt(prompt, attempt), {
                maxTokens: retryTokenBudget(3200, attempt),
                temperature: attempt > 0 ? 0.02 : 0.08,
                signal: controller.signal,
                taskKind: 'simulation',
                rejectTruncated: true,
            });
            const parsed = extractJsonObject(raw);
            if (parsed) return parsed;
            throw unreadableJsonError(raw, '事实纠错模型');
        }, {
            retries: settings.autoRetryCount,
            shouldRetry: error => !(
                /请先填写独立 API|HTTP 40[0134]|没有提供安静生成接口/
                    .test(describeError(error))
            ),
            onRetry: ({ delayMs, rateLimited }) => {
                setSyncStatus({
                    phase: 'running',
                    message: rateLimited
                        ? `事实检查遇到限流～冷却 ${cooldownSeconds(delayMs)} 秒后继续同一份任务`
                        : '事实检查返回格式没收好，正在用更严格格式重试～',
                    error: '',
                });
            },
            ...retryTaskOptions(
                'simulation',
                `state-correction:${chatToken}:${getState().revision}:${latestAssistantSourceStamp()}`,
            ),
            signal: controller.signal,
        });

        if (
            controller.signal.aborted
            || currentChatToken() !== chatToken
            || runtime.activeCorrection?.controller !== controller
        ) return null;

        const latestAssistant = latestAssistantEntry();
        const result = applyStateCorrectionResult(getState(), payload, {
            narrativeText,
            messageId: latestAssistant?.index ?? null,
        });

        if (!result.applied.length && !result.removedEventIds.length) {
            setSyncStatus({
                phase: 'success',
                message: result.skipped
                    ? `检查完成：没有足够证据支持自动修改；${result.skipped} 项可疑内容被保守跳过`
                    : '检查完成：没有发现需要修改的明确矛盾～',
                error: '',
            });
            return result;
        }

        const removed = new Set(result.removedEventIds);
        commitManualState(
            result.state,
            `事实纠错完成：修正 ${result.applied.length} 项${removed.size ? `，撤销 ${removed.size} 条未发生派生` : ''}。`,
            {
                mutateStore: store => {
                    if (!removed.size) return;
                    const opinion = normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache());
                    store.publicOpinion = {
                        ...opinion,
                        news: opinion.news.filter(item => !removed.has(String(item.relatedEventId || ''))),
                        forums: opinion.forums.filter(item => !removed.has(String(item.relatedEventId || ''))),
                    };
                },
            },
        );
        setSyncStatus({
            phase: 'success',
            message: `事实纠错完成：修正 ${result.applied.length} 项${removed.size ? `，撤销 ${removed.size} 条未发生派生` : ''}`,
            error: '',
        });
        return result;
    } finally {
        if (runtime.activeCorrection?.controller === controller) {
            runtime.activeCorrection = null;
        }
        setBusy(false);
        refreshInjection();
        runtime.ui?.render();
    }
}

async function sendSocialMessage(conversationId, messageText) {
    if (runtime.activeSocial && !runtime.activeSocial.controller?.signal?.aborted) {
        throw new Error('上一条社交消息还在等回复');
    }
    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    let store = getStore();
    store.social = appendUserSocialMessage(
        store.social,
        conversationId,
        messageText,
        store.currentState.clock?.absoluteMinute,
        store.currentState.people,
    );
    saveStore(store, { immediate: true });
    runtime.activeSocial = { controller, chatToken, contextEpoch, conversationId };
    runtime.socialStatus = {
        phase: 'running',
        message: '消息已发出，正在判断谁看见、谁知道、谁愿意回……',
        error: '',
        conversationId,
    };
    runtime.ui?.render();

    try {
        const prompt = buildSocialReplyPrompt(store.social, store.currentState, conversationId, {
            userName: String(getContext()?.name1 || '你'),
        });
        const raw = await backgroundSimulation(prompt, {
            maxTokens: 1400,
            temperature: 0.72,
            signal: controller.signal,
            taskKind: 'social',
            rejectTruncated: true,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed) throw unreadableJsonError(raw, '社交回复模型');
        if (
            controller.signal.aborted
            || chatToken !== currentChatToken()
            || contextEpoch !== runtime.contextEpoch
        ) return null;
        store = getStore();
        const applied = applySocialReplyPayload(store.social, conversationId, parsed, store.currentState);
        store.social = applied.social;
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.socialStatus = {
            phase: 'success',
            message: applied.replyCount
                ? `收到 ${applied.replyCount} 条回复。`
                : '这次没有人回话。这不是生成失败，而是路由后的沉默结果。',
            error: '',
            conversationId,
        };
        runtime.ui?.render();
        return applied;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return null;
        if (chatToken === currentChatToken() && contextEpoch === runtime.contextEpoch) {
            store = getStore();
            store.social = setSocialConversationError(store.social, conversationId, error, store.currentState.people);
            saveStore(store, { immediate: true });
            runtime.socialStatus = {
                phase: 'error',
                message: '消息已保留，但这次没能拿到人物回复。',
                error: describeError(error),
                conversationId,
            };
            runtime.ui?.render();
        }
        // The outgoing raw message was already saved successfully. Treat the
        // action as completed so the composer does not put the same text back
        // and invite an accidental duplicate send.
        return { stored: true, replyCount: 0, error: describeError(error) };
    } finally {
        if (runtime.activeSocial?.controller === controller) runtime.activeSocial = null;
    }
}

async function requestSocialFriend(personId, requestMessage = '') {
    if (runtime.activeFriendRequest && !runtime.activeFriendRequest.controller?.signal?.aborted) {
        throw new Error('上一条好友申请还在等待对方处理');
    }
    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    let store = getStore();
    const person = store.currentState.people.find(item => String(item?.id || '') === String(personId || ''));
    if (!person || person.isUser) throw new Error('没有找到这个人物');
    const prompt = buildFriendRequestPrompt(store.social, store.currentState, person.id, {
        userName: String(getContext()?.name1 || '你'),
        requestMessage,
    });
    runtime.activeFriendRequest = { controller, chatToken, contextEpoch, personId: String(person.id) };
    runtime.friendRequestStatus = {
        phase: 'running',
        message: `正在等待 ${person.name} 处理申请`,
        error: '',
        personId: String(person.id),
    };
    runtime.ui?.render();
    try {
        const raw = await backgroundSimulation(prompt, {
            maxTokens: 700,
            temperature: 0.38,
            signal: controller.signal,
            taskKind: 'social',
            rejectTruncated: true,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed) throw unreadableJsonError(raw, '好友申请判定模型');
        if (controller.signal.aborted || chatToken !== currentChatToken() || contextEpoch !== runtime.contextEpoch) return null;
        store = getStore();
        const result = applyFriendDecisionPayload(store.social, store.currentState, person.id, parsed, { requestMessage });
        store.social = result.social;
        saveStore(store, { immediate: true });
        runtime.friendRequestStatus = {
            phase: 'success',
            message: result.decision === 'accepted'
                ? `${person.name} 已通过好友申请`
                : result.decision === 'declined'
                    ? `${person.name} 没有通过申请`
                    : `${person.name} 暂时没有处理申请`,
            error: '',
            personId: String(person.id),
        };
        runtime.ui?.render();
        return { ...result, personName: person.name };
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return null;
        runtime.friendRequestStatus = {
            phase: 'error',
            message: '好友申请没有完成',
            error: describeError(error),
            personId: String(person.id),
        };
        runtime.ui?.render();
        throw error;
    } finally {
        if (runtime.activeFriendRequest?.controller === controller) runtime.activeFriendRequest = null;
    }
}

async function refreshSocialMoments() {
    if (runtime.activeMoments && !runtime.activeMoments.controller?.signal?.aborted) {
        throw new Error('朋友圈还在刷新');
    }
    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    let store = getStore();
    const prompt = buildMomentsPrompt(store.social, store.currentState, {
        userName: String(getContext()?.name1 || '你'),
    });
    runtime.activeMoments = { controller, chatToken, contextEpoch };
    runtime.momentsStatus = { phase: 'running', message: '正在看看好友最近有没有想分享的内容', error: '' };
    runtime.ui?.render();
    try {
        const raw = await backgroundSimulation(prompt, {
            maxTokens: 1800,
            temperature: 0.68,
            signal: controller.signal,
            taskKind: 'social',
            rejectTruncated: true,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed) throw unreadableJsonError(raw, '朋友圈生成模型');
        if (controller.signal.aborted || chatToken !== currentChatToken() || contextEpoch !== runtime.contextEpoch) return null;
        store = getStore();
        const applied = applyMomentsPayload(store.social, store.currentState, parsed);
        store.social = applied.social;
        saveStore(store, { immediate: true });

        const settings = getSettings();
        let imageCount = 0;
        if (
            settings.imageApiEnabled
            && settings.imageApiUrl
            && settings.imageApiKey
            && settings.imageApiModel
        ) {
            // Limit one generated photo per refresh. It keeps costs and chat
            // metadata bounded while still allowing a natural mixed feed.
            const target = applied.posts.find(post => post.wantsImage && post.imagePrompt);
            if (target) {
                try {
                    const person = store.currentState.people.find(item => String(item?.id || '') === target.personId);
                    const generated = await requestImageGeneration(settings, {
                        prompt: [
                            '一张自然、生活化的朋友圈配图。画面属于发布者当下能够拍摄或拥有的内容，不出现界面文字、水印或未知秘密。',
                            `发布者：${person?.name || '人物'}。动态：${target.text}`,
                            `画面：${target.imagePrompt}`,
                        ].join('\n'),
                        signal: controller.signal,
                    });
                    store = getStore();
                    store.social = attachMomentImage(store.social, store.currentState, target.id, {
                        imageUrl: generated.imageUrl,
                    });
                    saveStore(store, { immediate: true });
                    imageCount = 1;
                } catch (imageError) {
                    if (!isAbortError(imageError)) {
                        store = getStore();
                        store.social = attachMomentImage(store.social, store.currentState, target.id, {
                            error: describeError(imageError),
                        });
                        saveStore(store, { immediate: true });
                    }
                }
            }
        }
        runtime.momentsStatus = {
            phase: 'success',
            message: applied.posts.length
                ? `看到 ${applied.posts.length} 条新动态${imageCount ? '，其中 1 条带配图' : ''}`
                : '这次没有好友想发动态',
            error: '',
        };
        runtime.ui?.render();
        return { postCount: applied.posts.length, imageCount };
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return null;
        runtime.momentsStatus = { phase: 'error', message: '朋友圈刷新失败', error: describeError(error) };
        runtime.ui?.render();
        throw error;
    } finally {
        if (runtime.activeMoments?.controller === controller) runtime.activeMoments = null;
    }
}

async function handleUiAction(action, payload = {}) {
    if (action === 'test-image-api') {
        const result = await requestImageGeneration({
            imageApiUrl: payload.imageApiUrl,
            imageApiKey: payload.imageApiKey,
            imageApiModel: payload.imageApiModel,
            imageApiSize: '512x512',
            imageApiTimeoutMs: 180000,
        }, {
            prompt: 'A simple softly lit ceramic cup on a plain wooden table, natural photo, no text, no watermark.',
        });
        return Boolean(result?.imageUrl);
    }

    if (action === 'social-open-person') {
        const store = getStore();
        const person = store.currentState.people.find(item => String(item.id || '') === String(payload.personId || ''));
        if (!person || person.isUser) throw new Error('没有找到可联系的人物');
        store.social = openDirectConversation(store.social, person, store.currentState.people);
        saveStore(store, { immediate: true });
        runtime.ui?.render();
        return store.social.activeConversationId;
    }

    if (action === 'social-select-conversation') {
        const store = getStore();
        store.social = selectSocialConversation(store.social, payload.conversationId, store.currentState.people);
        saveStore(store);
        return true;
    }

    if (action === 'social-create-group') {
        const store = getStore();
        store.social = createGroupConversation(store.social, payload, store.currentState.people);
        saveStore(store, { immediate: true });
        runtime.ui?.render();
        return store.social.activeConversationId;
    }

    if (action === 'social-send-message') {
        return await sendSocialMessage(payload.conversationId, payload.text);
    }

    if (action === 'social-request-friend') {
        return await requestSocialFriend(payload.personId, payload.message || '');
    }

    if (action === 'social-respond-friend-request') {
        const store = getStore();
        const personId = String(payload.personId || '');
        const person = store.currentState.people.find(item => String(item?.id || '') === personId && !item?.isUser);
        if (!person) throw new Error('没有找到申请人');
        store.social = respondIncomingFriendRequest(store.social, store.currentState, personId, payload.accept === true);
        saveStore(store, { immediate: true });
        runtime.ui?.render();
        return { accepted: payload.accept === true, personName: person.name };
    }

    if (action === 'social-remove-friend') {
        const store = getStore();
        const personId = String(payload.personId || '');
        const person = store.currentState.people.find(item => String(item?.id || '') === personId && !item?.isUser);
        if (!person) throw new Error('没有找到这个好友');
        store.social = removeSocialFriend(store.social, store.currentState, personId);
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.ui?.render();
        return { removed: true, personName: person.name };
    }

    if (action === 'social-read-notice') {
        const store = getStore();
        store.social = markSocialNoticeRead(store.social, store.currentState, payload.noticeId || '');
        saveStore(store, { immediate: true });
        return true;
    }

    if (action === 'social-refresh-moments') {
        return await refreshSocialMoments();
    }

    if (action === 'social-toggle-moment-like') {
        const store = getStore();
        store.social = toggleMomentLike(store.social, store.currentState, payload.momentId);
        saveStore(store, { immediate: true });
        return true;
    }

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

    if (action === 'clear-current-chat-cache') {
        return clearCurrentChatCache();
    }

    if (action === 'reset-current-chat-data') {
        return await resetCurrentChatData();
    }

    if (action === 'check-correct-world-state') {
        return await checkAndCorrectWorldState();
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
        if (Object.prototype.hasOwnProperty.call(payload, 'recordPlayerCharacter')) {
            const store = getStore();
            store.currentState = applyPlayerCharacterRecordingPolicy(store.currentState, settings);
            store.initialState = applyPlayerCharacterRecordingPolicy(store.initialState, settings);
            saveStore(store, { immediate: true });
        }
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

    if (action === 'lingqi-send-message') {
        return await sendLingqiMessage(payload.text || '');
    }

    if (action === 'lingqi-copy-support-pack') {
        const messageId = String(payload.messageId || '');
        const store = getStore();
        const messages = store.lingqi?.messages || [];
        const index = messages.findIndex(item => item.id === messageId);
        const message = index >= 0 ? messages[index] : null;
        if (!message?.needsAuthorHelp) throw new Error('这条消息没有求助包');
        let question = '';
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
            if (messages[cursor]?.role === 'user') {
                question = messages[cursor].text;
                break;
            }
        }
        const supportPack = buildLingqiSupportPack(
            question,
            message.supportTriage || {
                category: 'unknown',
                summary: question,
                checked: [],
                reason: message.supportReason,
            },
        );
        const copied = await copyTextSafely(supportPack);
        if (!copied) throw new Error('浏览器没有允许复制，请检查剪贴板权限');
        toast('小纸条叼给你啦～拿去给妈妈看。', 'success');
        return supportPack;
    }

    if (action === 'lingqi-confirm-note') {
        return confirmLingqiNoteProposal();
    }

    if (action === 'lingqi-confirm-action') {
        return await confirmLingqiPendingAction();
    }

    if (action === 'lingqi-dismiss-action') {
        return dismissLingqiPendingAction();
    }

    if (action === 'lingqi-dismiss-note') {
        return dismissLingqiNoteProposal();
    }

    if (action === 'lingqi-pause-note') {
        return updateLingqiNoteStatus(payload.noteId, 'paused');
    }

    if (action === 'lingqi-resume-note') {
        return updateLingqiNoteStatus(payload.noteId, 'active');
    }

    if (action === 'lingqi-cancel-note') {
        return updateLingqiNoteStatus(payload.noteId, 'cancelled');
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

    if (action === 'catch-up-person') {
        return await runPersonLifeCatchUp(String(payload.personId || ''));
    }

    if (action === 'prioritize-person') {
        return setPersonLifePriority(
            String(payload.personId || ''),
            payload.enabled !== false,
        );
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
            commitManualState(next, `回声“${removed.title}”已经删除。`, {
                mutateStore: store => addEventDeletionTombstone(store, removed),
            });
            return true;
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
        const cluePeople = Array.isArray(payload.people)
            ? payload.people.map(value => String(value || '').trim()).filter(Boolean).slice(0, 16)
            : [];
        const clueLocations = Array.isArray(payload.locations)
            ? payload.locations.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12)
            : [];
        const clueEvents = Array.isArray(payload.events)
            ? payload.events.map(value => String(value || '').trim()).filter(Boolean).slice(0, 16)
            : [];
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
                people: cluePeople,
                locations: clueLocations,
                events: clueEvents,
                archived: Boolean(existing?.archived),
                archivedAt: existing?.archivedAt ?? null,
                importance: payload.important ? 3 : (existing?.importance || 1),
                visibility: existing?.visibility || 'hidden',
                updatedAt: next.clock.absoluteMinute,
                createdAt: existing?.createdAt ?? next.clock.absoluteMinute,
            };
            const timingBaseMinute = Number(updated.createdAt ?? next.clock.absoluteMinute) || next.clock.absoluteMinute;
            updated.timing = resolveFutureTimeExpression(
                [updated.sourceExcerpt, updated.text].filter(Boolean).join('\n'),
                {
                    baseAbsoluteMinute: timingBaseMinute,
                    baseCalendar: formatWorldCalendar(next, timingBaseMinute),
                    calendarBound: Boolean(next.clock?.anchored),
                },
            );
            if (updated.timing) {
                updated.timing = normalizeClueTiming(updated.timing, next.clock.absoluteMinute);
            }
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

    if (action === 'set-clue-archive-state') {
        const next = clone(getState());
        const clue = next.storyMemory?.clues?.find(entry => entry.id === String(payload.id || ''));
        if (!clue) throw new Error('没有找到这条伏笔');
        if (clue.locked) throw new Error('锁定的伏笔不能归档，请先解锁');
        const archived = Boolean(payload.archived);
        if (archived && !['resolved', 'discarded'].includes(clue.status)) {
            throw new Error('还在发展的伏笔不能直接归档；先让它完成/放下，或直接删除');
        }
        clue.archived = archived;
        clue.archivedAt = archived ? next.clock.absoluteMinute : null;
        clue.updatedAt = next.clock.absoluteMinute;
        commitManualState(
            next,
            archived ? `伏笔“${clue.title || '未命名伏笔'}”已经归档。` : `伏笔“${clue.title || '未命名伏笔'}”已经移回已回收列表。`,
        );
        return true;
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
        const removedItems = [];
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
            removedItems.push({ kind, item: clone(collection[index]) });
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
            {
                mutateStore: targetStore => {
                    for (const removedEntry of removedItems) {
                        addMemoryDeletionTombstone(targetStore, removedEntry.kind, removedEntry.item);
                    }
                },
            },
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
        commitManualState(next, '记忆已经删除。', {
            mutateStore: store => addMemoryDeletionTombstone(store, kind, removed),
        });
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
        commitManualState(
            reconciled,
            existing ? '后台人物卡已经更新。' : `已将 ${person.name} 加入后台人物。`,
            {
                mutateStore: store => clearPersonDeletionTombstone(store, person),
            },
        );
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
        commitManualState(next, `已移除后台人物 ${removed.name}。`, {
            mutateStore: store => addPersonDeletionTombstone(store, removed),
        });
        return true;
    }

    if (action === 'delete-manual-people') {
        const ids = new Set(
            (Array.isArray(payload.ids) ? payload.ids : [])
                .map(id => String(id || '').trim())
                .filter(Boolean)
                .slice(0, 120),
        );
        if (!ids.size) throw new Error('请先选择要删除的人物');
        const next = clone(getState());
        const removed = next.people.filter(person => (
            ids.has(String(person.id || ''))
            && !person.locked
            && !person.isUser
        ));
        if (!removed.length) throw new Error('所选人物都已锁定、属于玩家角色，或已经不在名单中');
        next.people = next.people.filter(person => !removed.includes(person));
        commitManualState(next, `已批量移除 ${removed.length} 个后台人物。`, {
            mutateStore: store => {
                for (const person of removed) addPersonDeletionTombstone(store, person);
            },
        });
        return {
            removed: removed.length,
            names: removed.map(person => person.name).filter(Boolean),
            skipped: ids.size - removed.length,
        };
    }
    if (['social_send_message', 'social_accept_request', 'social_refuse_request', 'social_remove_friend'].includes(action.type)) {
        const person = findLingqiPersonTarget(action);
        if (!person || person.isUser) return { error: '耳朵没听准要操作的是谁，我先按住爪子，不乱动关系。' };
        if (action.type === 'social_send_message') {
            const body = String(action.text || '').trim();
            if (!body) return { error: '消息是空的，我不会替你猜一句塞进去。' };
            return {
                title: `把这句话送给 ${person.name}？`,
                detail: `我会照原文实际发出：“${body.slice(0, 180)}${body.length > 180 ? '…' : ''}”\n发送后不能在对方那里撤回；对方仍会按自己的处境决定是否回复。`,
                confirmLabel: '确认发送',
            };
        }
        if (action.type === 'social_accept_request') return { title: `把 ${person.name} 收进通讯录？`, detail: '确认后会接受好友申请，双方可以互发私聊。', confirmLabel: '接受' };
        if (action.type === 'social_refuse_request') return { title: `拒绝 ${person.name} 的好友申请？`, detail: '拒绝后不会进入通讯录，对方的申请与反应会保留为关系记录。', confirmLabel: '拒绝' };
        return { title: `和 ${person.name} 解除好友关系？`, detail: '确认后只解除好友关系并停止私聊；历史消息和共同群聊会保留。', confirmLabel: '删除好友' };
    }
    if (action.type === 'social_refresh_moments') {
        return {
            title: '去朋友圈窗口蹲一会儿？',
            detail: getSettings().imageApiEnabled
                ? '会调用一次社交模型；若人物确实想配图，还可能额外调用一次生图 API。'
                : '会调用一次社交模型；没有人物想发动态时允许保持空白。',
            confirmLabel: '刷新',
        };
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
        const created = next.events.at(-1);
        commitManualState(next, `暗流“${payload.title}”已经开始发展。`, {
            mutateStore: store => clearEventDeletionTombstone(store, created),
        });
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
        cancelActiveBackgroundTasks({ preserveLingqi: true });
        const next = clone(getState());
        const index = next.events.findIndex(item => item.id === eventId);
        if (index < 0) throw new Error('没有找到这条暗流');
        const [removed] = next.events.splice(index, 1);
        next.echoes = (next.echoes || []).filter(echo => echo.eventId !== eventId);
        commitManualState(next, `暗流“${removed.title}”已经删除，并且不会被后续推演自动补回。`, {
            mutateStore: store => addEventDeletionTombstone(store, removed),
        });
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
            // 不借按钮凭空推进公共世界，但既有公开事件的传播后果必须先进入世界状态；
            // 否则新闻只会成为与人物认知和正文脱节的 UI 卡片。
            ensurePublicWorld: true,
            settlePublicImpact: true,
            // 没有新的公开表面、世界时间节点或覆盖巡查结果时，不为了换措辞
            // 再打一份舆情 API；按钮仍会先完成所有真正到期的世界工作。
            force: false,
        });
    }

    if (action === 'clear-public-opinion') {
        return clearPublicOpinionSnapshot();
    }

    if (action === 'dismiss-public-opinion-item') {
        return dismissPublicOpinionItem(payload.kind, payload.itemId);
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

    if (action === 'smart-import-worldbook-people') {
        return await smartImportWorldbookPeople(payload.bookName);
    }

    if (action === 'cancel-background-tasks') {
        const result = cancelActiveBackgroundTasks();
        if (!result.cancelled) {
            toast('当前没有正在运行或排队的后台任务。', 'info');
        } else {
            toast(`已停止：${result.labels.join('、')}。`, 'success');
        }
        return result;
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
        return await requestManualWorldSimulation();
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
        getTavernProfiles: listTavernConnectionProfiles,
        onAction: handleUiAction,
        pluginVersion: PLUGIN_VERSION,
    });

    // Additive bridge for the companion phone. The world engine and its UI stay
    // identical to the GitHub baseline; this surface only exposes existing state
    // and actions so the phone does not need a second copy of the world.
    globalThis.worldBackstageHost = {
        version: PLUGIN_VERSION,
        integratedLauncher: true,
        open: options => runtime.ui?.open?.(options),
        openEvent: eventId => runtime.ui?.openEvent?.(eventId),
        close: () => runtime.ui?.close?.(),
        getLingqiMascotAsset: state => LINGQI_MASCOT_DATA_URLS[state] || LINGQI_MASCOT_DATA_URLS.idle || '',
        getLingqiConversation: () => normalizeLingqiState(getStore().lingqi || emptyLingqiState()).messages.map(message => ({ ...message })),
        chatWithLingqi: text => sendLingqiMessage(text),
        refreshLauncher: () => runtime.ui?.render?.(),
        getPublicSurface: () => {
            const store = getStore();
            const state = getState();
            const settings = getSettings();
            return {
                opinion: normalizePublicOpinionCache(store.publicOpinion || emptyPublicOpinionCache()),
                sandbox: normalizePublicOpinionSandbox(store.publicOpinionSandbox || emptyPublicOpinionSandbox()),
                status: { ...runtime.publicOpinionStatus },
                sandboxStatus: { ...runtime.publicOpinionSandboxStatus },
                settings: {
                    publicOpinionAutoEnabled: settings.publicOpinionAutoEnabled !== false,
                    publicOpinionRevealMode: settings.publicOpinionRevealMode || 'observe',
                    injectionPublicOpinion: settings.injectionPublicOpinion !== false,
                },
                events: Array.isArray(state.events) ? state.events : [],
                publicImpactLedger: Array.isArray(state.publicImpactLedger) ? state.publicImpactLedger : [],
                people: Array.isArray(state.people) ? state.people : [],
            };
        },
        refreshPublicOpinion: () => handleUiAction('generate-public-opinion', {}),
        generatePublicOpinionSandbox: () => handleUiAction('generate-public-opinion-sandbox', {}),
        clearPublicOpinion: () => handleUiAction('clear-public-opinion', {}),
        clearPublicOpinionSandbox: () => handleUiAction('clear-public-opinion-sandbox', {}),
        dismissPublicOpinionItem: (kind, itemId) => handleUiAction('dismiss-public-opinion-item', { kind, itemId }),
        updatePublicOpinionSettings: patch => handleUiAction('update-settings', patch && typeof patch === 'object' ? patch : {}),
    };
    window.dispatchEvent(new CustomEvent('world-backstage:ready', { detail: { version: PLUGIN_VERSION } }));

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
