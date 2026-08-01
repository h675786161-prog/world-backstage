export const MODULE_ID = 'world_backstage';
export const STATE_KEY = 'world_backstage_v1';
export const SNAPSHOT_KEY = 'world_backstage';
export const SCHEMA_VERSION = 4;
export const MINUTES_PER_DAY = 24 * 60;

const TERMINAL_EVENT_STATES = new Set(['resolved', 'cancelled', 'missed']);
const ACTIVE_EVENT_STATES = new Set(['active', 'waiting']);
const VALID_CLOCK_MODES = new Set(['duration', 'active', 'scheduled', 'condition']);
const VALID_VISIBILITY = new Set(['hidden', 'trace', 'known', 'direct']);
const VALID_KNOWLEDGE = new Set(['hidden', 'known']);
const VALID_CLUE_STATES = new Set(['open', 'echoed', 'resolved', 'discarded']);
const VALID_MEMORY_FACT_STATES = new Set(['active', 'disputed', 'superseded', 'invalidated']);
const VALID_MEMORY_CONFIDENCE = new Set(['low', 'medium', 'high']);
const VALID_EVENT_STATES = new Set([
    'active',
    'waiting',
    'ready',
    'resolved',
    'cancelled',
    'missed',
]);

const LIMITS = Object.freeze({
    people: 36,
    events: 96,
    archive: 120,
    echoes: 80,
    foregroundFacts: 24,
    audit: 40,
    text: 800,
    innerVoice: 240,
    longTermGoal: 360,
    personalityAnchor: 600,
    speakingStyle: 360,
    behaviorBoundaries: 500,
    storySummaries: 72,
    clues: 180,
    memoryFacts: 240,
    memoryDigest: 2400,
});

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function asString(value, fallback = '', maxLength = LIMITS.text) {
    const result = typeof value === 'string' ? value.trim() : fallback;
    return result.slice(0, maxLength);
}

function asInteger(value, fallback = 0, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function uniqueStrings(value, maximum = 12) {
    return [...new Set(asArray(value)
        .map(item => asString(item, '', 120))
        .filter(Boolean))]
        .slice(0, maximum);
}

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = 'wb') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeId(value, prefix) {
    const candidate = asString(value, '', 100)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return candidate || makeId(prefix);
}

function normalizeClockMode(value) {
    return VALID_CLOCK_MODES.has(value) ? value : 'duration';
}

function normalizeVisibility(value) {
    return VALID_VISIBILITY.has(value) ? value : 'hidden';
}

function normalizeEventStatus(value) {
    return VALID_EVENT_STATES.has(value) ? value : 'active';
}

function normalizeKnowledge(value) {
    return VALID_KNOWLEDGE.has(value) ? value : 'hidden';
}

export function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function hasExplicitTimeEvidence(text) {
    const value = String(text || '');
    const chineseNumber = '[一二两三四五六七八九十百千万半]';
    const arabicDurationUnit = '(?:分钟|分|刻钟|小时|个小时|钟头|天|日|周|星期|个月|月|年)';
    const chineseDurationUnit = '(?:分钟|刻钟|小时|个小时|钟头|天|日|周|星期|个月|月|年)';
    const patterns = [
        new RegExp(`\\d+(?:\\.\\d+)?\\s*${arabicDurationUnit}`),
        new RegExp(`${chineseNumber}+\\s*${chineseDurationUnit}`),
        /(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*\d{1,2}\s*(?:点|时|[:：])\s*\d{0,2}/,
        new RegExp(`(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\\s*${chineseNumber}+\\s*(?:点|时)`),
        /第\s*\d+\s*[日天]/,
        new RegExp(`第\\s*${chineseNumber}+\\s*[日天]`),
        /(?:次日|翌日|第二天|隔天|第二周|下周|下个月|次年)/,
    ];
    return patterns.some(pattern => pattern.test(value));
}

export function resolveElapsedMinutes(rawMinutes, narrativeText, policy = 'explicit') {
    const minutes = asInteger(rawMinutes, 0, 0, 5 * 365 * MINUTES_PER_DAY);
    if (policy === 'open') return minutes;
    if (hasExplicitTimeEvidence(narrativeText)) return minutes;
    if (policy === 'cautious') return Math.min(minutes, 180);
    return 0;
}

export function formatWorldMinute(totalMinutes) {
    const safeTotal = asInteger(totalMinutes, 0, 0);
    const day = Math.floor(safeTotal / MINUTES_PER_DAY);
    const minuteOfDay = safeTotal % MINUTES_PER_DAY;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const pad = number => String(number).padStart(2, '0');

    return {
        day,
        hour,
        minute,
        time: `${pad(hour)}:${pad(minute)}`,
        stamp: `第 ${day} 日 ${pad(hour)}:${pad(minute)}`,
    };
}

function daysInCalendarMonth(year, month) {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeCalendarDate({ year, month, day } = {}, fallback = {
    year: 1,
    month: 1,
    day: 1,
}) {
    const safeYear = asInteger(year, fallback.year, 1, 9999);
    const safeMonth = asInteger(month, fallback.month, 1, 12);
    return {
        year: safeYear,
        month: safeMonth,
        day: asInteger(
            day,
            fallback.day,
            1,
            daysInCalendarMonth(safeYear, safeMonth),
        ),
    };
}

function addCalendarDays(date, days) {
    const safe = normalizeCalendarDate(date);
    const value = new Date(0);
    value.setUTCHours(12, 0, 0, 0);
    value.setUTCFullYear(safe.year, safe.month - 1, 1);
    value.setUTCDate(safe.day + asInteger(days, 0, -1000000, 1000000));
    return {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
    };
}

function sequentialCalendarDate(absoluteDay) {
    return addCalendarDays(
        { year: 1, month: 1, day: 1 },
        Math.max(0, asInteger(absoluteDay, 1, 0) - 1),
    );
}

function normalizeWorldCalendar(raw, absoluteDay = 1) {
    const fallback = sequentialCalendarDate(absoluteDay);
    const anchor = normalizeCalendarDate({
        year: raw?.anchor_year ?? raw?.anchorYear,
        month: raw?.anchor_month ?? raw?.anchorMonth,
        day: raw?.anchor_day ?? raw?.anchorDay,
    }, fallback);
    return {
        name: asString(raw?.name, '主世界历', 40),
        anchorAbsoluteDay: asInteger(
            raw?.anchor_absolute_day ?? raw?.anchorAbsoluteDay,
            absoluteDay,
            0,
            999999,
        ),
        anchorYear: anchor.year,
        anchorMonth: anchor.month,
        anchorDay: anchor.day,
    };
}

export function formatWorldCalendar(state, totalMinutes = state?.clock?.absoluteMinute ?? 0) {
    const clock = formatWorldMinute(totalMinutes);
    const calendar = normalizeWorldCalendar(state?.world?.calendar, clock.day);
    const date = addCalendarDays({
        year: calendar.anchorYear,
        month: calendar.anchorMonth,
        day: calendar.anchorDay,
    }, clock.day - calendar.anchorAbsoluteDay);
    const pad = number => String(number).padStart(2, '0');
    const dateLabel = `${date.year}年${date.month}月${date.day}日`;
    return {
        ...clock,
        calendarName: calendar.name,
        year: date.year,
        month: date.month,
        dayOfMonth: date.day,
        date: dateLabel,
        shortDate: `${pad(date.month)}月${pad(date.day)}日`,
        stamp: `${calendar.name} ${dateLabel} ${clock.time}`,
    };
}

export function formatDuration(minutes) {
    const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    const days = Math.floor(safeMinutes / MINUTES_PER_DAY);
    const hours = Math.floor((safeMinutes % MINUTES_PER_DAY) / 60);
    const rest = safeMinutes % 60;
    const parts = [];

    if (days) parts.push(`${days} 天`);
    if (hours) parts.push(`${hours} 小时`);
    if (rest || parts.length === 0) parts.push(`${rest} 分钟`);
    return parts.join(' ');
}

export function createInitialState({
    worldName = '未命名世界',
    day = 1,
    hour = 8,
    minute = 0,
} = {}) {
    const absoluteMinute = (
        asInteger(day, 1, 0, 999999) * MINUTES_PER_DAY
        + asInteger(hour, 8, 0, 23) * 60
        + asInteger(minute, 0, 0, 59)
    );
    const absoluteDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    const initialDate = sequentialCalendarDate(absoluteDay);

    return {
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        world: {
            name: asString(worldName, '未命名世界', 80),
            title: '世界仍在镜头之外继续',
            detail: '尚未完成第一次世界推演。',
            calendar: {
                name: '主世界历',
                anchorAbsoluteDay: absoluteDay,
                anchorYear: initialDate.year,
                anchorMonth: initialDate.month,
                anchorDay: initialDate.day,
            },
        },
        clock: {
            absoluteMinute,
            lastCheckedAt: absoluteMinute,
            source: 'initial',
            reason: '建立主世界时钟',
        },
        people: [],
        events: [],
        echoes: [],
        archive: [],
        foregroundFacts: [],
        storyMemory: {
            indexedThroughMessageId: -1,
            indexedAt: '',
            digest: {
                text: '',
                throughMessageId: -1,
                people: [],
                locations: [],
                tags: [],
                updatedAt: 0,
            },
            facts: [],
            summaries: [],
            clues: [],
        },
        audit: [],
        pendingSync: false,
        lastCommit: null,
        updatedAt: nowIso(),
    };
}

function normalizeStorySummary(raw, existing = null) {
    const startMessageId = asInteger(
        raw?.start_message_id ?? raw?.startMessageId,
        existing?.startMessageId ?? 0,
        0,
    );
    const endMessageId = asInteger(
        raw?.end_message_id ?? raw?.endMessageId,
        existing?.endMessageId ?? startMessageId,
        startMessageId,
    );
    const summary = asString(raw?.summary, existing?.summary || '', 1400);
    return {
        id: normalizeId(
            raw?.id || existing?.id || `summary_${startMessageId}_${endMessageId}`,
            'summary',
        ),
        title: asString(raw?.title, existing?.title || `第 ${startMessageId}—${endMessageId} 层`, 120),
        summary,
        startMessageId,
        endMessageId,
        people: uniqueStrings(raw?.people ?? existing?.people, 20),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        createdAt: asString(raw?.created_at ?? raw?.createdAt, existing?.createdAt || nowIso(), 40),
    };
}

function normalizeClue(raw, existing = null, worldMinute = 0, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    const text = asString(raw?.text, existing?.text || '', 620);
    const clueId = raw?.id
        || existing?.id
        || (text ? `clue_${hashText(text)}` : '');
    const requestedStatus = asString(raw?.status, existing?.status || 'open', 20);
    return {
        id: normalizeId(clueId, 'clue'),
        title: asString(raw?.title, existing?.title || text.slice(0, 48) || '未命名伏笔', 120),
        text,
        sourceMessageId: asInteger(
            raw?.source_message_id ?? raw?.sourceMessageId,
            existing?.sourceMessageId ?? sourceMessageId ?? 0,
            0,
        ),
        sourceSwipeId: asInteger(
            raw?.source_swipe_id ?? raw?.sourceSwipeId,
            existing?.sourceSwipeId ?? sourceSwipeId ?? 0,
            0,
        ),
        sourceExcerpt: asString(
            raw?.source_excerpt ?? raw?.sourceExcerpt,
            existing?.sourceExcerpt || '',
            220,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 16),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 12),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        status: VALID_CLUE_STATES.has(requestedStatus) ? requestedStatus : 'open',
        importance: asInteger(raw?.importance, existing?.importance ?? 1, 1, 3),
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        resolution: asString(raw?.resolution, existing?.resolution || '', 520),
        resolvedMessageId: raw?.resolved_message_id ?? raw?.resolvedMessageId
            ?? existing?.resolvedMessageId
            ?? null,
        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

function normalizeMemoryDigest(raw, existing = null, worldMinute = 0) {
    return {
        text: asString(raw?.text, existing?.text || '', LIMITS.memoryDigest),
        throughMessageId: asInteger(
            raw?.through_message_id ?? raw?.throughMessageId,
            existing?.throughMessageId ?? -1,
            -1,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 32),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 24),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 32),
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            existing?.updatedAt ?? worldMinute,
            0,
        ),
    };
}

function normalizeMemoryFact(raw, existing = null, worldMinute = 0, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    const subject = asString(raw?.subject, existing?.subject || '', 100);
    const predicate = asString(raw?.predicate, existing?.predicate || '', 100);
    const value = asString(raw?.value, existing?.value || '', 520);
    const key = asString(
        raw?.key,
        existing?.key || [subject, predicate].filter(Boolean).join('：'),
        180,
    );
    const requestedStatus = asString(raw?.status, existing?.status || 'active', 20);
    const requestedConfidence = asString(
        raw?.confidence,
        existing?.confidence || 'high',
        20,
    );
    const factId = raw?.id
        || existing?.id
        || `memory_${hashText(`${key}\n${value}`)}`;
    return {
        id: normalizeId(factId, 'memory'),
        key,
        subject,
        predicate,
        value,
        sourceMessageId: asInteger(
            raw?.source_message_id ?? raw?.sourceMessageId,
            existing?.sourceMessageId ?? sourceMessageId ?? 0,
            0,
        ),
        sourceSwipeId: asInteger(
            raw?.source_swipe_id ?? raw?.sourceSwipeId,
            existing?.sourceSwipeId ?? sourceSwipeId ?? 0,
            0,
        ),
        sourceExcerpt: asString(
            raw?.source_excerpt ?? raw?.sourceExcerpt,
            existing?.sourceExcerpt || '',
            220,
        ),
        people: uniqueStrings(raw?.people ?? existing?.people, 20),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 24),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        status: VALID_MEMORY_FACT_STATES.has(requestedStatus) ? requestedStatus : 'active',
        confidence: VALID_MEMORY_CONFIDENCE.has(requestedConfidence)
            ? requestedConfidence
            : 'medium',
        importance: asInteger(raw?.importance, existing?.importance ?? 2, 1, 3),
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'known'),
        supersedes: uniqueStrings(raw?.supersedes ?? existing?.supersedes, 12),
        supersededBy: asString(
            raw?.superseded_by ?? raw?.supersededBy,
            existing?.supersededBy || '',
            100,
        ),
        invalidationReason: asString(
            raw?.invalidation_reason ?? raw?.invalidationReason,
            existing?.invalidationReason || '',
            360,
        ),
        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

function normalizeStoryMemory(raw, worldMinute = 0) {
    const summaries = asArray(raw?.summaries)
        .map(summary => normalizeStorySummary(summary))
        .filter(summary => summary.summary);
    const clueMap = new Map();
    for (const clue of asArray(raw?.clues)) {
        const normalized = normalizeClue(clue, clue, worldMinute);
        if (!normalized.text) continue;
        clueMap.set(normalized.id, normalized);
    }
    const factMap = new Map();
    for (const fact of asArray(raw?.facts)) {
        const normalized = normalizeMemoryFact(fact, fact, worldMinute);
        if (!normalized.key || !normalized.value) continue;
        factMap.set(normalized.id, normalized);
    }
    return {
        indexedThroughMessageId: asInteger(
            raw?.indexedThroughMessageId ?? raw?.indexed_through_message_id,
            -1,
            -1,
        ),
        indexedAt: asString(raw?.indexedAt ?? raw?.indexed_at, '', 40),
        digest: normalizeMemoryDigest(raw?.digest, null, worldMinute),
        facts: [...factMap.values()]
            .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
            .slice(0, LIMITS.memoryFacts),
        summaries: summaries
            .sort((a, b) => a.endMessageId - b.endMessageId)
            .slice(-LIMITS.storySummaries),
        clues: [...clueMap.values()]
            .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
            .slice(0, LIMITS.clues),
    };
}

function normalizePerson(raw, existing = null, worldMinute = 0, {
    userName = '',
    allowUserInnerVoice = true,
    sourceMessageId = null,
} = {}) {
    const name = asString(raw?.name, existing?.name || '未命名人物', 80);
    const innerVoice = asString(raw?.inner_voice ?? raw?.innerVoice, '', LIMITS.innerVoice);
    const hasNewInnerVoice = Boolean(innerVoice);
    const longTermGoal = asString(
        raw?.long_term_goal ?? raw?.longTermGoal,
        '',
        LIMITS.longTermGoal,
    );
    // These are author-owned character anchors. A routine simulation may use
    // them as constraints, but must never silently rewrite an existing card.
    const personalityAnchor = asString(
        existing
            ? existing.personalityAnchor
            : (raw?.personality_anchor ?? raw?.personalityAnchor),
        '',
        LIMITS.personalityAnchor,
    );
    const speakingStyle = asString(
        existing
            ? existing.speakingStyle
            : (raw?.speaking_style ?? raw?.speakingStyle),
        '',
        LIMITS.speakingStyle,
    );
    const behaviorBoundaries = asString(
        existing
            ? existing.behaviorBoundaries
            : (raw?.behavior_boundaries ?? raw?.behaviorBoundaries),
        '',
        LIMITS.behaviorBoundaries,
    );
    const suppliedInnerVoiceAt = raw?.inner_voice_at ?? raw?.innerVoiceAt;
    const suppliedLastSeen = raw?.last_seen_message_id ?? raw?.lastSeenMessageId;
    const presentInScene = raw?.present_in_scene ?? raw?.presentInScene;
    const suppliedLastSeenNumber = Number(suppliedLastSeen);
    const hasSuppliedLastSeen = (
        suppliedLastSeen !== null
        && suppliedLastSeen !== undefined
        && suppliedLastSeen !== ''
        && Number.isInteger(suppliedLastSeenNumber)
        && !(
            suppliedLastSeenNumber === 0
            && Number.isInteger(Number(sourceMessageId))
            && Number(sourceMessageId) > 0
        )
    );
    const normalizedUserName = asString(userName, '', 80).toLocaleLowerCase();
    const isUser = Boolean(
        (
            normalizedUserName
            && name.toLocaleLowerCase() === normalizedUserName
        )
        || raw?.is_user
        || raw?.isUser
        || raw?.role === 'user'
        || existing?.isUser,
    );
    const storedInnerVoice = isUser && !allowUserInnerVoice
        ? ''
        : (hasNewInnerVoice ? innerVoice : asString(existing?.innerVoice, '', LIMITS.innerVoice));

    return {
        id: normalizeId(raw?.id || existing?.id || name, 'person'),
        name,
        isUser,
        monogram: asString(raw?.monogram, existing?.monogram || name.slice(0, 1), 4),
        location: asString(raw?.location, existing?.location || '位置待确认', 160),
        action: asString(raw?.action, existing?.action || '当前行动待确认', 280),
        intent: asString(raw?.intent, existing?.intent || '短期意图待确认', 320),
        longTermGoal: longTermGoal || asString(existing?.longTermGoal, '', LIMITS.longTermGoal),
        personalityAnchor,
        speakingStyle,
        behaviorBoundaries,
        simulationEnabled: Boolean(
            raw?.simulation_enabled
            ?? raw?.simulationEnabled
            ?? existing?.simulationEnabled
            ?? true,
        ),
        locked: Boolean(raw?.locked ?? existing?.locked),
        manual: Boolean(raw?.manual ?? existing?.manual),
        trace: asString(raw?.trace, existing?.trace || '', 360),
        innerVoice: storedInnerVoice,
        innerVoiceAt: isUser && !allowUserInnerVoice
            ? worldMinute
            : hasNewInnerVoice
            ? asInteger(suppliedInnerVoiceAt, worldMinute, 0)
            : asInteger(existing?.innerVoiceAt, worldMinute, 0),
        knowledge: normalizeKnowledge(raw?.knowledge ?? existing?.knowledge),
        relevance: asInteger(raw?.relevance, existing?.relevance ?? 1, 0, 3),
        source: ['foreground', 'background', 'manual'].includes(raw?.source)
            ? raw.source
            : (existing?.source || 'background'),
        worldbookRef: asString(
            existing?.worldbookRef ?? raw?.worldbookRef ?? raw?.worldbook_ref,
            '',
            180,
        ),
        lastSeenMessageId: hasSuppliedLastSeen
            ? suppliedLastSeenNumber
            : (
                raw?.source === 'foreground'
                && Number.isInteger(Number(sourceMessageId))
            )
                ? Number(sourceMessageId)
                : asInteger(existing?.lastSeenMessageId, -1, -1),
        presentInSceneMessageId: presentInScene === true
            && Number.isInteger(Number(sourceMessageId))
            ? Number(sourceMessageId)
            : asInteger(existing?.presentInSceneMessageId, -1, -1),
        updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, worldMinute, 0),
    };
}

export function normalizeEvent(raw, worldMinute = 0, existing = null) {
    const clockMode = normalizeClockMode(raw?.clock_mode ?? raw?.clockMode ?? existing?.clockMode);
    const startedAt = asInteger(
        raw?.started_at ?? raw?.startedAt,
        existing?.startedAt ?? worldMinute,
        0,
    );
    const durationMinutes = asInteger(
        raw?.duration_minutes ?? raw?.durationMinutes,
        existing?.durationMinutes ?? 0,
        0,
        5 * 365 * MINUTES_PER_DAY,
    );
    let dueAt = raw?.scheduled_at ?? raw?.due_at ?? raw?.dueAt;
    dueAt = Number.isFinite(Number(dueAt))
        ? asInteger(dueAt, 0, 0)
        : (existing?.dueAt ?? null);

    if (dueAt === null && clockMode === 'duration' && durationMinutes > 0) {
        dueAt = startedAt + durationMinutes;
    }

    const status = normalizeEventStatus(raw?.status ?? existing?.status);
    const visibility = normalizeVisibility(raw?.visibility ?? existing?.visibility);
    const oldDelivery = existing?.delivery || {};
    const requestedDeliveryState = asString(raw?.delivery_state, oldDelivery.state || '', 30);
    const defaultDeliveryState = TERMINAL_EVENT_STATES.has(status) && visibility !== 'hidden'
        ? 'pending'
        : 'none';
    const deliveryState = ['none', 'pending', 'delivered', 'expired'].includes(requestedDeliveryState)
        ? requestedDeliveryState
        : (oldDelivery.state || defaultDeliveryState);

    return {
        id: normalizeId(raw?.id || existing?.id, 'event'),
        title: asString(raw?.title, existing?.title || '未命名事件', 140),
        place: asString(raw?.place, existing?.place || '地点待确认', 140),
        summary: asString(raw?.summary, existing?.summary || '', 420),
        consequence: asString(raw?.consequence, existing?.consequence || '', 420),
        expectedResult: asString(
            raw?.expected_result ?? raw?.expectedResult,
            existing?.expectedResult || '',
            420,
        ),
        result: asString(raw?.result, existing?.result || '', 520),
        status,
        clockMode,
        startedAt,
        dueAt,
        durationMinutes,
        accruedMinutes: asInteger(
            raw?.accrued_minutes ?? raw?.accruedMinutes,
            existing?.accruedMinutes ?? 0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        ),
        lastCheckedAt: asInteger(
            raw?.last_checked_at ?? raw?.lastCheckedAt,
            existing?.lastCheckedAt ?? worldMinute,
            0,
        ),
        prerequisites: uniqueStrings(raw?.prerequisites ?? existing?.prerequisites, 12),
        visibility,
        delivery: {
            state: deliveryState,
            manualQueued: Boolean(
                raw?.delivery_queued
                ?? raw?.deliveryQueued
                ?? oldDelivery.manualQueued,
            ),
            attempts: asInteger(oldDelivery.attempts, 0, 0, 99),
            route: asString(raw?.delivery_route, oldDelivery.route || '', 220),
            confirmedAt: oldDelivery.confirmedAt ?? null,
            confirmedMessageId: oldDelivery.confirmedMessageId ?? null,
            lastOfferedAt: oldDelivery.lastOfferedAt ?? null,
        },
        createdAt: existing?.createdAt ?? worldMinute,
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            existing?.updatedAt ?? worldMinute,
            0,
        ),
        resolvedAt: TERMINAL_EVENT_STATES.has(status)
            ? (existing?.resolvedAt ?? worldMinute)
            : null,
    };
}

export function eventProgress(event, worldMinute) {
    if (event?.status === 'ready' || TERMINAL_EVENT_STATES.has(event?.status)) {
        return {
            ratio: 1,
            percent: 100,
            remaining: 0,
        phase: event.status === 'ready' ? '到时待确认' : '已形成结果',
        };
    }

    if (event?.clockMode === 'condition') {
        return {
            ratio: null,
            percent: null,
            remaining: null,
            phase: '等待条件',
        };
    }

    if (event?.clockMode === 'active') {
        const duration = Math.max(1, Number(event.durationMinutes) || 1);
        const accrued = Math.max(0, Number(event.accruedMinutes) || 0);
        const ratio = clamp(accrued / duration, 0, 1);
        return {
            ratio,
            percent: Math.round(ratio * 100),
            remaining: Math.max(0, duration - accrued),
            phase: ratio >= 0.72 ? '临近完成' : ratio >= 0.28 ? '发展' : '萌芽',
        };
    }

    const dueAt = Number(event?.dueAt);
    const startedAt = Number(event?.startedAt);
    if (!Number.isFinite(dueAt) || !Number.isFinite(startedAt) || dueAt <= startedAt) {
        return {
            ratio: null,
            percent: null,
            remaining: null,
            phase: event?.clockMode === 'scheduled' ? '等待时间点' : '时间待确认',
        };
    }

    const elapsed = Math.max(0, worldMinute - startedAt);
    const duration = dueAt - startedAt;
    const ratio = clamp(elapsed / duration, 0, 1);
    const remaining = Math.max(0, dueAt - worldMinute);
    let phase = ratio >= 0.72 ? '临近完成' : ratio >= 0.28 ? '发展' : '萌芽';
    if (event.clockMode === 'scheduled') {
        phase = remaining <= 30 ? '正在靠近' : '等待时间点';
    }

    return {
        ratio,
        percent: Math.round(ratio * 100),
        remaining,
        phase,
    };
}

function appendAudit(state, entry) {
    state.audit.unshift({
        id: makeId('audit'),
        at: state.clock.absoluteMinute,
        createdAt: nowIso(),
        ...entry,
    });
    state.audit = state.audit.slice(0, LIMITS.audit);
}

export function settleTimedEvents(inputState, targetMinute, {
    source = 'world',
    reason = '',
} = {}) {
    const state = deepClone(inputState);
    const previousMinute = asInteger(state.clock?.absoluteMinute, 0, 0);
    const nextMinute = asInteger(targetMinute, previousMinute, 0);
    const previousStamp = formatWorldCalendar(state, previousMinute).stamp;

    state.clock = {
        absoluteMinute: nextMinute,
        lastCheckedAt: nextMinute,
        source,
        reason: asString(reason, '', 240),
    };

    if (nextMinute >= previousMinute) {
        for (const event of state.events) {
            if (!ACTIVE_EVENT_STATES.has(event.status)) continue;
            event.lastCheckedAt = nextMinute;

            if (!['duration', 'scheduled'].includes(event.clockMode)) continue;
            if (!Number.isFinite(Number(event.dueAt))) continue;

            if (nextMinute >= Number(event.dueAt)) {
                event.status = 'ready';
                event.updatedAt = nextMinute;
                event.result = event.result || event.expectedResult || '';
            }
        }
    }

    if (nextMinute !== previousMinute) {
        appendAudit(state, {
            type: nextMinute > previousMinute ? 'clock_advanced' : 'clock_corrected',
            text: `${previousStamp} → ${formatWorldCalendar(state, nextMinute).stamp}`,
            reason: asString(reason, '', 240),
        });
    }

    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    return trimState(state);
}

function findPerson(state, raw) {
    const id = asString(raw?.id, '', 100);
    const name = asString(raw?.name, '', 80);
    return state.people.find(person => (id && person.id === normalizeId(id, 'person')) || (name && person.name === name));
}

function findEvent(state, raw) {
    const id = asString(raw?.id, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'event');
        const byId = state.events.find(event => event.id === normalized);
        if (byId) return byId;
    }

    const title = asString(raw?.title, '', 140);
    const place = asString(raw?.place, '', 140);
    return state.events.find(event => (
        title
        && event.title === title
        && (!place || event.place === place)
        && !TERMINAL_EVENT_STATES.has(event.status)
    ));
}

function markTerminal(event, status, worldMinute, result = '') {
    event.status = status;
    event.result = asString(result, event.result || event.expectedResult || '', 520);
    event.resolvedAt = worldMinute;
    event.updatedAt = worldMinute;
    if (event.visibility !== 'hidden' && event.delivery.state !== 'delivered') {
        event.delivery.state = 'pending';
    }
}

function findClue(memory, raw) {
    const id = asString(raw?.id ?? raw, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'clue');
        const byId = memory.clues.find(clue => clue.id === normalized);
        if (byId) return byId;
    }
    const text = asString(raw?.text, '', 620);
    if (!text) return null;
    const fingerprint = text.replace(/\s+/g, '').slice(0, 80);
    return memory.clues.find(clue => (
        clue.text.replace(/\s+/g, '').slice(0, 80) === fingerprint
    )) || null;
}

function findMemoryFact(memory, raw, {
    matchValue = true,
} = {}) {
    const id = asString(raw?.id ?? raw, '', 100);
    if (id) {
        const normalized = normalizeId(id, 'memory');
        const byId = memory.facts.find(fact => fact.id === normalized);
        if (byId) return byId;
    }
    const key = asString(raw?.key, '', 180);
    const value = asString(raw?.value, '', 520);
    if (!key) return null;
    return memory.facts.find(fact => (
        fact.key === key
        && (!matchValue || !value || fact.value === value)
    )) || null;
}

function applyMemoryFactUpdates(state, {
    factsUpsert = [],
    factsInvalidate = [],
} = {}, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    for (const rawFact of asArray(factsUpsert).slice(0, 32)) {
        const prepared = normalizeMemoryFact(rawFact, null, state.clock.absoluteMinute, {
            sourceMessageId,
            sourceSwipeId,
        });
        if (!prepared.key || !prepared.value) continue;

        const sameCandidate = findMemoryFact(state.storyMemory, prepared);
        const same = sameCandidate?.value === prepared.value ? sameCandidate : null;
        if (same) {
            if (same.locked) continue;
            Object.assign(
                same,
                normalizeMemoryFact(rawFact, same, state.clock.absoluteMinute, {
                    sourceMessageId,
                    sourceSwipeId,
                }),
            );
            continue;
        }

        const conflicts = state.storyMemory.facts.filter(fact => (
            fact.key === prepared.key
            && fact.value !== prepared.value
            && ['active', 'disputed'].includes(fact.status)
        ));
        if (conflicts.some(fact => fact.locked)) prepared.status = 'disputed';
        if (conflicts.some(fact => fact.id === prepared.id)) {
            prepared.id = normalizeId(
                `${prepared.id}_${hashText(prepared.value)}`,
                'memory',
            );
        }

        if (prepared.status === 'disputed') {
            for (const conflict of conflicts) {
                if (conflict.locked) continue;
                conflict.status = 'disputed';
                conflict.updatedAt = state.clock.absoluteMinute;
            }
        } else {
            for (const conflict of conflicts) {
                if (conflict.locked) continue;
                conflict.status = 'superseded';
                conflict.supersededBy = prepared.id;
                conflict.updatedAt = state.clock.absoluteMinute;
            }
            prepared.supersedes = uniqueStrings([
                ...prepared.supersedes,
                ...conflicts.filter(fact => !fact.locked).map(fact => fact.id),
            ], 12);
        }
        state.storyMemory.facts.unshift(prepared);
    }

    for (const rawInvalidation of asArray(factsInvalidate).slice(0, 32)) {
        const invalidation = typeof rawInvalidation === 'string'
            ? { id: rawInvalidation }
            : rawInvalidation;
        const fact = findMemoryFact(state.storyMemory, invalidation, { matchValue: false });
        if (!fact || fact.locked) continue;
        fact.status = 'invalidated';
        fact.invalidationReason = asString(
            invalidation?.reason ?? invalidation?.invalidation_reason,
            fact.invalidationReason || '已被后续正文否定',
            360,
        );
        fact.updatedAt = state.clock.absoluteMinute;
    }
}

function applyClueUpdates(state, {
    cluesUpsert = [],
    cluesResolve = [],
} = {}, {
    sourceMessageId = null,
    sourceSwipeId = null,
} = {}) {
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    for (const rawClue of asArray(cluesUpsert).slice(0, 24)) {
        const existing = findClue(state.storyMemory, rawClue);
        if (existing?.locked) continue;
        const clue = normalizeClue(rawClue, existing, state.clock.absoluteMinute, {
            sourceMessageId,
            sourceSwipeId,
        });
        if (!clue.text) continue;
        if (existing) Object.assign(existing, clue);
        else state.storyMemory.clues.unshift(clue);
    }

    for (const rawResolution of asArray(cluesResolve).slice(0, 24)) {
        const resolution = typeof rawResolution === 'string'
            ? { id: rawResolution }
            : rawResolution;
        const clue = findClue(state.storyMemory, resolution);
        if (!clue || clue.locked) continue;
        clue.status = VALID_CLUE_STATES.has(resolution?.status)
            ? resolution.status
            : 'resolved';
        clue.resolution = asString(
            resolution?.resolution,
            clue.resolution || '已由后续正文呼应或解决',
            520,
        );
        clue.resolvedMessageId = asInteger(
            resolution?.message_id ?? resolution?.messageId,
            sourceMessageId ?? clue.resolvedMessageId ?? 0,
            0,
        );
        clue.updatedAt = state.clock.absoluteMinute;
    }
}

function normalizeSimulationResult(payload) {
    return {
        elapsedMinutes: asInteger(
            payload?.elapsed_minutes ?? payload?.elapsedMinutes,
            0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        ),
        timeReason: asString(payload?.time_reason ?? payload?.timeReason, '', 320),
        world: {
            title: asString(payload?.world?.title, '', 180),
            detail: asString(payload?.world?.detail, '', 640),
        },
        peopleUpsert: asArray(payload?.people_upsert ?? payload?.peopleUpsert).slice(0, LIMITS.people),
        peopleRemove: uniqueStrings(payload?.people_remove ?? payload?.peopleRemove, LIMITS.people),
        eventsCreate: asArray(payload?.events_create ?? payload?.eventsCreate).slice(0, 24),
        eventsUpdate: asArray(payload?.events_update ?? payload?.eventsUpdate).slice(0, 36),
        deliveriesConfirmed: uniqueStrings(
            payload?.deliveries_confirmed ?? payload?.deliveriesConfirmed,
            24,
        ),
        foregroundFacts: asArray(payload?.front_facts ?? payload?.frontFacts).slice(0, 16),
        memoryUpdates: {
            factsUpsert: asArray(
                payload?.memory_update?.facts_upsert
                ?? payload?.memoryUpdate?.factsUpsert,
            ).slice(0, 32),
            factsInvalidate: asArray(
                payload?.memory_update?.facts_invalidate
                ?? payload?.memoryUpdate?.factsInvalidate,
            ).slice(0, 32),
            cluesUpsert: asArray(
                payload?.memory_update?.clues_upsert
                ?? payload?.memoryUpdate?.cluesUpsert,
            ).slice(0, 24),
            cluesResolve: asArray(
                payload?.memory_update?.clues_resolve
                ?? payload?.memoryUpdate?.cluesResolve,
            ).slice(0, 24),
        },
    };
}

export function applySimulationResult(baseState, rawPayload, {
    messageId = null,
    swipeId = null,
    sourceKey = '',
    userName = '',
    allowUserInnerVoice = true,
    timePolicy = 'open',
    narrativeText = '',
    backgroundNpcBudget = LIMITS.people,
} = {}) {
    const payload = normalizeSimulationResult(rawPayload);
    const requestedElapsedMinutes = payload.elapsedMinutes;
    const explicitTimeEvidence = hasExplicitTimeEvidence(narrativeText);
    payload.elapsedMinutes = resolveElapsedMinutes(
        requestedElapsedMinutes,
        narrativeText,
        timePolicy,
    );
    if (!explicitTimeEvidence && timePolicy !== 'open') {
        for (const update of payload.eventsUpdate) {
            const requestedWork = asInteger(
                update?.worked_minutes ?? update?.workedMinutes,
                0,
                0,
            );
            const guardedWork = timePolicy === 'cautious'
                ? Math.min(requestedWork, 180)
                : 0;
            update.worked_minutes = guardedWork;
            update.workedMinutes = guardedWork;
        }
    }
    if (requestedElapsedMinutes > 0 && payload.elapsedMinutes === 0) {
        payload.timeReason = '正文没有明确、可计算的时间证据，本轮保持世界时钟不动';
    } else if (payload.elapsedMinutes < requestedElapsedMinutes) {
        payload.timeReason = `正文时间较含糊，本轮最多推进 ${payload.elapsedMinutes} 分钟`;
    }
    let state = settleTimedEvents(
        baseState,
        baseState.clock.absoluteMinute + payload.elapsedMinutes,
        { source: 'narrative', reason: payload.timeReason || '正文推演' },
    );
    const worldMinute = state.clock.absoluteMinute;

    if (payload.world.title) state.world.title = payload.world.title;
    if (payload.world.detail) state.world.detail = payload.world.detail;

    let backgroundNpcUpdates = 0;
    const maximumBackgroundNpcUpdates = asInteger(
        backgroundNpcBudget,
        LIMITS.people,
        0,
        LIMITS.people,
    );
    const enforceForegroundEvidence = maximumBackgroundNpcUpdates < LIMITS.people;
    const narrativeForPeople = asString(narrativeText, '', 60000).toLocaleLowerCase();
    for (const rawPerson of payload.peopleUpsert) {
        const personName = asString(rawPerson?.name, '', 80).toLocaleLowerCase();
        const playerPerson = Boolean(
            rawPerson?.is_user
            || rawPerson?.isUser
            || rawPerson?.role === 'user'
        );
        const namedInNarrative = Boolean(
            personName
            && narrativeForPeople
            && narrativeForPeople.includes(personName)
        );
        const foregroundPerson = playerPerson || (
            rawPerson?.source === 'foreground'
            && (!enforceForegroundEvidence || namedInNarrative)
        );
        if (!foregroundPerson) {
            if (backgroundNpcUpdates >= maximumBackgroundNpcUpdates) continue;
            backgroundNpcUpdates += 1;
        }
        const existing = findPerson(state, rawPerson);
        if (existing && !foregroundPerson && existing.simulationEnabled === false) continue;
        const person = normalizePerson(rawPerson, existing, worldMinute, {
            userName,
            allowUserInnerVoice,
            sourceMessageId: messageId,
        });
        if (existing) {
            if (existing.locked) {
                person.name = existing.name;
                person.isUser = existing.isUser;
                person.longTermGoal = existing.longTermGoal;
                person.simulationEnabled = existing.simulationEnabled;
                person.locked = true;
                person.manual = existing.manual;
            }
            Object.assign(existing, person);
        } else {
            state.people.push(person);
        }
    }

    if (payload.peopleRemove.length) {
        const removed = new Set(payload.peopleRemove.map(item => item.toLowerCase()));
        state.people = state.people.filter(person => (
            person.locked
            || (
                !removed.has(person.id.toLowerCase())
                && !removed.has(person.name.toLowerCase())
            )
        ));
    }

    for (const rawEvent of payload.eventsCreate) {
        const existing = findEvent(state, rawEvent);
        const event = normalizeEvent(rawEvent, worldMinute, existing);
        event.updatedAt = worldMinute;
        if (existing) {
            Object.assign(existing, event);
        } else {
            state.events.push(event);
        }
    }

    for (const update of payload.eventsUpdate) {
        const event = findEvent(state, update);
        if (!event) continue;

        const workedMinutes = asInteger(
            update?.worked_minutes ?? update?.workedMinutes,
            0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        );
        if (workedMinutes && event.clockMode === 'active') {
            event.accruedMinutes = Math.min(
                event.durationMinutes || Number.MAX_SAFE_INTEGER,
                event.accruedMinutes + workedMinutes,
            );
            if (event.durationMinutes > 0 && event.accruedMinutes >= event.durationMinutes) {
                event.status = 'ready';
            }
        }

        if (update?.summary) event.summary = asString(update.summary, event.summary, 420);
        if (update?.consequence) event.consequence = asString(update.consequence, event.consequence, 420);
        if (update?.visibility) event.visibility = normalizeVisibility(update.visibility);
        if (update?.delivery_route) {
            event.delivery.route = asString(update.delivery_route, event.delivery.route, 220);
        }

        const requestedStatus = normalizeEventStatus(update?.status ?? event.status);
        if (TERMINAL_EVENT_STATES.has(requestedStatus)) {
            markTerminal(event, requestedStatus, worldMinute, update?.result);
        } else {
            event.status = requestedStatus;
            event.updatedAt = worldMinute;
            if (requestedStatus === 'ready' && update?.result) {
                markTerminal(event, 'resolved', worldMinute, update.result);
            }
        }
    }

    for (const event of state.events) {
        if (event.status === 'ready' && event.result) {
            markTerminal(event, 'resolved', worldMinute, event.result);
        }
    }

    for (const rawId of payload.deliveriesConfirmed) {
        const event = state.events.find(item => item.id === normalizeId(rawId, 'event'));
        if (!event) continue;
        event.delivery.state = 'delivered';
        event.delivery.confirmedAt = worldMinute;
        event.delivery.confirmedMessageId = messageId;
        state.echoes.unshift({
            id: makeId('echo'),
            eventId: event.id,
            at: worldMinute,
            title: event.title,
            route: event.delivery.route || event.result || event.consequence,
            state: '已由正文承接',
        });
    }

    for (const rawFact of payload.foregroundFacts) {
        const text = asString(rawFact?.text, '', 420);
        if (!text) continue;
        state.foregroundFacts.unshift({
            id: normalizeId(rawFact?.id, 'fact'),
            at: worldMinute,
            text,
            affects: uniqueStrings(rawFact?.affects, 10),
            visibility: normalizeVisibility(rawFact?.visibility ?? 'known'),
        });
    }

    applyMemoryFactUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });
    applyClueUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });

    state.pendingSync = false;
    state.lastCommit = {
        messageId,
        swipeId,
        sourceKey: asString(sourceKey, '', 180),
        at: worldMinute,
        committedAt: nowIso(),
    };
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'simulation_committed',
        text: `世界推演完成 · ${formatWorldCalendar(state, worldMinute).stamp}`,
        reason: payload.timeReason,
    });
    return trimState(state);
}

export function addManualEvent(inputState, rawEvent) {
    const state = deepClone(inputState);
    const event = normalizeEvent({
        ...rawEvent,
        status: rawEvent?.status || 'active',
    }, state.clock.absoluteMinute);
    state.events.push(event);
    state.revision += 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'event_created',
        text: `新增事件：${event.title}`,
        reason: '手动创建',
    });
    return trimState(state);
}

export function setWorldClock(inputState, {
    day,
    hour,
    minute,
    reason = '手动校准',
} = {}) {
    const target = (
        asInteger(day, 1, 0, 999999) * MINUTES_PER_DAY
        + asInteger(hour, 0, 0, 23) * 60
        + asInteger(minute, 0, 0, 59)
    );
    return settleTimedEvents(inputState, target, { source: 'manual', reason });
}

export function setWorldCalendar(inputState, {
    calendarName = '',
    year,
    month,
    day,
    hour,
    minute,
    reason = '手动校准历法',
} = {}) {
    const currentClock = formatWorldMinute(inputState?.clock?.absoluteMinute ?? MINUTES_PER_DAY);
    const date = normalizeCalendarDate({ year, month, day }, sequentialCalendarDate(currentClock.day));
    const targetMinute = (
        currentClock.day * MINUTES_PER_DAY
        + asInteger(hour, currentClock.hour, 0, 23) * 60
        + asInteger(minute, currentClock.minute, 0, 59)
    );
    const state = settleTimedEvents(inputState, targetMinute, {
        source: 'manual',
        reason,
    });
    state.world.calendar = {
        name: asString(calendarName, state.world?.calendar?.name || '主世界历', 40),
        anchorAbsoluteDay: currentClock.day,
        anchorYear: date.year,
        anchorMonth: date.month,
        anchorDay: date.day,
    };
    appendAudit(state, {
        type: 'calendar_calibrated',
        text: `历法校准为 ${formatWorldCalendar(state).stamp}`,
        reason: asString(reason, '', 240),
    });
    state.updatedAt = nowIso();
    return trimState(state);
}

export function advanceWorldClock(inputState, minutes, reason = '手动推进') {
    const delta = asInteger(minutes, 0, 0, 5 * 365 * MINUTES_PER_DAY);
    return settleTimedEvents(
        inputState,
        inputState.clock.absoluteMinute + delta,
        { source: 'manual', reason },
    );
}

function eventPriority(event) {
    const visibilityScore = {
        direct: 40,
        known: 30,
        trace: 20,
        hidden: 0,
    }[event.visibility] || 0;
    const recency = Number(event.resolvedAt ?? event.updatedAt ?? 0);
    return visibilityScore * 1_000_000 + recency;
}

export function selectDeliveryCandidates(state, settings = {}) {
    const maximum = {
        restrained: 1,
        balanced: 2,
        active: 3,
        克制: 1,
        均衡: 2,
        活跃: 3,
    }[settings.deliveryDensity] || 1;

    const manuallyQueued = state.events
        .filter(event => event.visibility !== 'hidden' && event.delivery?.manualQueued)
        .sort((a, b) => eventPriority(b) - eventPriority(a));
    const automatic = state.events
        .filter(event => (
            TERMINAL_EVENT_STATES.has(event.status)
            && event.visibility !== 'hidden'
            && event.delivery?.state === 'pending'
            && !event.delivery?.manualQueued
        ))
        .sort((a, b) => eventPriority(b) - eventPriority(a));
    return [...manuallyQueued, ...automatic].slice(0, Math.max(maximum, manuallyQueued.length));
}

export function recordDeliveryOffers(inputState, eventIds, {
    messageId = null,
    expireAfter = 3,
} = {}) {
    const state = deepClone(inputState);
    const ids = new Set(uniqueStrings(eventIds, 24).map(id => normalizeId(id, 'event')));

    for (const event of state.events) {
        if (!ids.has(event.id)) continue;
        if (event.delivery?.manualQueued) event.delivery.manualQueued = false;
        if (event.delivery?.state !== 'pending') continue;
        event.delivery.attempts = asInteger(event.delivery.attempts, 0, 0, 99) + 1;
        event.delivery.lastOfferedAt = state.clock.absoluteMinute;
        event.delivery.lastOfferedMessageId = messageId;

        if (event.delivery.attempts >= expireAfter && event.visibility !== 'direct') {
            event.delivery.state = 'expired';
            state.archive.unshift({
                id: makeId('archive'),
                eventId: event.id,
                at: state.clock.absoluteMinute,
                title: event.title,
                text: event.result || event.consequence || event.summary,
                visibility: event.visibility,
                deliveryState: 'expired',
            });
        }
    }

    state.updatedAt = nowIso();
    return trimState(state);
}

function selectRelevantPeople(state, recentText = '', maximum = 6) {
    const text = asString(recentText, '', 6000);
    return [...state.people]
        .map(person => ({
            person,
            score: (
                (text.includes(person.name) ? 100 : 0)
                + person.relevance * 10
                + (person.knowledge === 'known' ? 5 : 0)
                + person.updatedAt / 1_000_000
            ),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maximum)
        .map(item => item.person);
}

export function buildInjectionPackage(state, settings = {}, recentText = '') {
    if (!settings.enabled) {
        return { text: '', eventIds: [] };
    }

    const injectWorld = settings.worldSimulationEnabled !== false
        && settings.worldPromptInjection !== false;
    const injectMemory = settings.memorySystemEnabled !== false
        && settings.memoryPromptInjection !== false;
    if (!injectWorld && !injectMemory) return { text: '', eventIds: [] };

    const clock = formatWorldCalendar(state);
    const people = injectWorld ? selectRelevantPeople(state, recentText) : [];
    const deliveries = injectWorld ? selectDeliveryCandidates(state, settings) : [];
    const recalledMemory = injectMemory ? selectRelevantStoryMemory(state, recentText, {
        maximumFacts: 6,
        maximumClues: 3,
        maximumSummaries: 0,
        includeDigest: false,
    }) : { facts: [], clues: [] };
    const knownFacts = recalledMemory.facts.filter(fact => (
        ['known', 'direct'].includes(fact.visibility)
        && ['active', 'disputed'].includes(fact.status)
    ));
    const knownClues = recalledMemory.clues.filter(clue => (
        ['known', 'direct'].includes(clue.visibility)
        && clue.status !== 'discarded'
    ));
    const sceneTiming = {
        strict: '只在转场、空档或角色自然能够接触信息时显露；当前场面不合适就继续延后。',
        smart: '关键场面中延后次要信息；只有直接影响眼前行动的结果可以自然进入。',
        open: '可以在场景中加入一条简短、自然的可感知变化，但不要后台播报。',
    }[settings.sceneTiming] || '只在自然时机显露，不要后台播报。';

    const lines = ['<world_backstage_state>'];
    if (injectWorld) {
        lines.push(
            `权威主世界时间：${state.world.name} · ${clock.stamp}`,
            `整体状态：${state.world.title}；${state.world.detail}`,
            '一致性规则：当前时间与下列人物位置是本轮事实源；没有明确经过时间时，不要擅自推进时钟。',
        );
    }

    if (people.length) {
        lines.push('当前人物状态（仅用于保持连续性，不等于主角知道全部后台信息）：');
        for (const person of people) {
            const boundary = person.knowledge === 'known' ? '可知' : '幕后';
            lines.push(`- ${person.name}｜${person.location}｜${person.action}｜${boundary}`);
        }
    }

    if (knownFacts.length || knownClues.length) {
        lines.push('与当前场景相关、且角色已经有资格知道的长期记忆：');
        for (const fact of knownFacts) {
            const qualifier = fact.status === 'disputed' ? '（说法有争议，不可当成定论）' : '';
            lines.push(`- 事实｜${fact.subject || fact.key}｜${fact.predicate || '相关信息'}：${fact.value}${qualifier}`);
        }
        for (const clue of knownClues) {
            lines.push(`- 线索｜${clue.title}：${clue.text}`);
        }
        lines.push('只用于维持回忆、承诺与前后呼应；不得把未列出的隐藏记忆补写成角色知识。');
    }

    if (deliveries.length) {
        lines.push('本轮由用户点名或系统选中的可自然显露事件：');
        for (const event of deliveries) {
            const route = event.delivery.route || event.result || event.consequence || event.summary;
            const request = event.delivery?.manualQueued ? '用户要求下一轮优先显露' : '系统候选';
            lines.push(`- [${event.id}] ${event.title}：${route}（${event.visibility}；${request}）`);
        }
        lines.push(`显露节奏：${sceneTiming}`);
        lines.push('只把真正写进正文、被角色感知或留下可见痕迹的结果视为已承接；不要声称“后台已递交”。');
    }

    lines.push('禁止提及“世界背面”、状态表、注入块或幕后独白。');
    lines.push('</world_backstage_state>');

    const keptLines = [];
    let usedCharacters = 0;
    for (const line of lines) {
        const addition = line.length + (keptLines.length ? 1 : 0);
        if (usedCharacters + addition > 4200) break;
        keptLines.push(line);
        usedCharacters += addition;
    }
    const originalKeptCount = keptLines.length;
    if (originalKeptCount < lines.length) {
        const closing = '</world_backstage_state>';
        if (keptLines.at(-1) === closing) keptLines.pop();
        const notice = '（其余低相关信息已压缩省略，禁止自行补全。）';
        while (keptLines.length > 1 && [...keptLines, notice, closing].join('\n').length > 4200) {
            keptLines.pop();
        }
        keptLines.push(notice, closing);
    }

    return {
        text: keptLines.join('\n'),
        eventIds: deliveries.map(event => event.id),
        omittedLines: Math.max(0, lines.length - originalKeptCount),
    };
}

function modelText(value, maximum) {
    return asString(value, '', maximum);
}

function memoryTerms(item) {
    return uniqueStrings([
        item?.subject || '',
        item?.predicate || '',
        ...(item?.people || []),
        ...(item?.locations || []),
        ...(item?.tags || []),
    ], 40).filter(term => term.length >= 2);
}

function memorySearchText(item) {
    return [
        item?.key,
        item?.subject,
        item?.predicate,
        item?.value,
        item?.title,
        item?.text,
        item?.summary,
        ...memoryTerms(item),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function memoryBigrams(value) {
    const normalized = String(value || '')
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
    const result = new Set();
    for (let index = 0; index < normalized.length - 1 && result.size < 180; index += 1) {
        result.add(normalized.slice(index, index + 2));
    }
    return result;
}

function memoryMatchScore(item, query, {
    referenceMessageId = 0,
} = {}) {
    const normalizedQuery = String(query || '').toLocaleLowerCase();
    let score = Number(item?.importance || 0) * 5;
    for (const term of memoryTerms(item)) {
        if (normalizedQuery.includes(term.toLocaleLowerCase())) score += 18;
    }
    const queryBigrams = memoryBigrams(normalizedQuery);
    if (queryBigrams.size) {
        const itemBigrams = memoryBigrams(memorySearchText(item));
        let overlap = 0;
        for (const term of queryBigrams) {
            if (itemBigrams.has(term)) overlap += 1;
        }
        score += Math.min(20, overlap * 2);
    }
    if (item?.status === 'open') score += 8;
    if (item?.status === 'echoed') score += 5;
    if (item?.status === 'active') score += 7;
    if (item?.status === 'disputed') score += 2;
    if (item?.confidence === 'high') score += 4;
    if (item?.confidence === 'low') score -= 3;

    const sourceMessageId = Number(
        item?.sourceMessageId
        ?? item?.endMessageId
        ?? item?.throughMessageId
        ?? referenceMessageId,
    );
    const age = Math.max(0, Number(referenceMessageId || 0) - sourceMessageId);
    const decay = Math.min(18, Math.floor(Math.log2(1 + age / 12) * 4));
    score -= Number(item?.importance || 1) >= 3 ? Math.floor(decay / 3) : decay;
    return score;
}

export function selectRelevantStoryMemory(state, narrativeText = '', {
    maximumFacts = 10,
    maximumClues = 8,
    maximumSummaries = 4,
    includeDigest = true,
} = {}) {
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    const referenceMessageId = Math.max(
        Number(state?.lastCommit?.messageId || 0),
        Number(memory.indexedThroughMessageId || 0),
    );
    const facts = memory.facts
        .filter(fact => ['active', 'disputed'].includes(fact.status))
        .map(fact => ({
            fact,
            score: memoryMatchScore(fact, narrativeText, { referenceMessageId }),
        }))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.fact.updatedAt) - Number(a.fact.updatedAt)
        ))
        .slice(0, Math.max(0, maximumFacts))
        .map(({ fact, score }) => ({
            id: fact.id,
            key: fact.key,
            subject: fact.subject,
            predicate: fact.predicate,
            value: modelText(fact.value, 420),
            people: fact.people,
            locations: fact.locations,
            tags: fact.tags,
            status: fact.status,
            confidence: fact.confidence,
            importance: fact.importance,
            visibility: fact.visibility,
            source_message_id: fact.sourceMessageId,
            source_swipe_id: fact.sourceSwipeId,
            recall_score: score,
        }));
    const clues = memory.clues
        .filter(clue => !['discarded'].includes(clue.status))
        .map(clue => ({
            clue,
            score: memoryMatchScore(clue, narrativeText, { referenceMessageId }),
        }))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.clue.updatedAt) - Number(a.clue.updatedAt)
        ))
        .slice(0, Math.max(0, maximumClues))
        .map(({ clue }) => ({
            id: clue.id,
            title: modelText(clue.title, 100),
            text: modelText(clue.text, 360),
            people: clue.people,
            locations: clue.locations,
            tags: clue.tags,
            status: clue.status,
            importance: clue.importance,
            visibility: clue.visibility,
            source_message_id: clue.sourceMessageId,
            source_swipe_id: clue.sourceSwipeId,
            resolution: modelText(clue.resolution, 260),
        }));
    const summaries = memory.summaries
        .map(summary => ({
            summary,
            score: memoryMatchScore(summary, narrativeText, { referenceMessageId }),
        }))
        .sort((a, b) => (
            b.score - a.score
            || b.summary.endMessageId - a.summary.endMessageId
        ))
        .slice(0, Math.max(0, maximumSummaries))
        .map(({ summary }) => ({
            id: summary.id,
            title: modelText(summary.title, 100),
            summary: modelText(summary.summary, 720),
            start_message_id: summary.startMessageId,
            end_message_id: summary.endMessageId,
            people: summary.people,
            locations: summary.locations,
            tags: summary.tags,
        }));

    return {
        indexed_through_message_id: memory.indexedThroughMessageId,
        digest: includeDigest && memory.digest.text
            ? {
                text: modelText(memory.digest.text, 1600),
                through_message_id: memory.digest.throughMessageId,
                people: memory.digest.people,
                locations: memory.digest.locations,
                tags: memory.digest.tags,
            }
            : null,
        facts,
        summaries,
        clues,
    };
}

export function buildHistoryIndexPrompt(state, {
    messages = [],
    userName = '',
    compact = false,
} = {}) {
    const compactMode = Boolean(compact);
    const normalizedMessages = asArray(messages)
        .map(message => ({
            id: asInteger(message?.id, 0, 0),
            swipe: asInteger(message?.swipe, 0, 0),
            role: message?.role === 'user' ? 'user' : 'assistant',
            content: modelText(
                message?.content,
                compactMode
                    ? (message?.role === 'user' ? 2400 : 4200)
                    : (message?.role === 'user' ? 4000 : 7000),
            ),
        }))
        .filter(message => message.content);
    const startMessageId = normalizedMessages[0]?.id ?? 0;
    const endMessageId = normalizedMessages.at(-1)?.id ?? startMessageId;
    const sourceText = normalizedMessages
        .map(message => (
            `<message id="${message.id}" swipe="${message.swipe}" role="${message.role}">`
            + `${message.content}</message>`
        ))
        .join('\n');
    const existing = selectRelevantStoryMemory(state, sourceText, {
        maximumFacts: compactMode ? 14 : 32,
        maximumClues: compactMode ? 10 : 24,
        maximumSummaries: compactMode ? 3 : 6,
    });
    const outputLimits = compactMode
        ? '极简重试：memory_digest.text 不超过240字，chapter_summary.summary 不超过160字；facts_upsert 最多3条，clues_upsert 最多2条；没有变化的数组必须返回空数组。'
        : '输出应紧凑：memory_digest.text 约300—600字，chapter_summary.summary 约160—320字；facts_upsert 最多8条，clues_upsert 最多6条。';

    return [
        '你是“世界背面”的历史档案员。你只整理已经发生的聊天记录，不续写、不推演未来、不修改世界时间。',
        '',
        '任务：',
        '1. 为这一批正文写一段忠实、紧凑的阶段摘要，保留关系变化、承诺、冲突、重要物品与未完成的问题。',
        '2. 重写 memory_digest：把旧持续摘要与本批真正持久的重要变化合并，删除已经失效的说法；这不是逐轮流水账。',
        '3. facts_upsert 只记录正文明确成立、未来仍有用的长期事实，例如身份、关系、承诺、能力限制、重要物品归属和已经揭示的真相。临时位置、普通动作、气氛不算长期事实。',
        '4. 每类事实使用稳定 key（例如“人物:老白:真实身份”）。同一 key 出现新值时保留 key 并提交新 value；插件会把旧版本标为 superseded。真假仍无法判断时用 status=disputed，不要强行覆盖。',
        '5. 只提取真正可能在后文产生呼应的伏笔。普通环境描写、一次性动作和已经当场解释完的事实不要当作伏笔。',
        '6. 长期事实与伏笔必须记录最早或最清楚的来源消息 id、swipe，并保留不超过80字的原文摘录。',
        '7. 若旧伏笔在本批正文中被呼应但未解决，放入 clues_upsert 并把 status 改为 echoed；确实解决时放入 clues_resolve。被正文明确否定的长期事实放入 facts_invalidate。',
        '8. 不得把玩家未明说的想法写成事实。玩家角色名：'
            + `${modelText(userName, 80) || '未提供'}。`,
        '9. 只返回一个合法 JSON 对象，不要代码围栏和解释。',
        `10. ${outputLimits}`,
        '',
        `本批范围：消息 ${startMessageId}—${endMessageId}`,
        '本批正文：',
        sourceText || '（没有正文）',
        '',
        '已有相关档案（用于去重与延续 ID）：',
        JSON.stringify(existing),
        '',
        '返回结构：',
        JSON.stringify({
            memory_digest: {
                text: '',
                through_message_id: endMessageId,
            },
            chapter_summary: {
                id: `summary_${startMessageId}_${endMessageId}`,
                title: '',
                summary: '',
                start_message_id: startMessageId,
                end_message_id: endMessageId,
            },
            facts_upsert: [{
                key: '',
                subject: '',
                predicate: '',
                value: '',
                source_message_id: startMessageId,
                source_excerpt: '',
            }],
            facts_invalidate: [{
                key: '',
                reason: '',
            }],
            clues_upsert: [{
                id: '',
                title: '',
                text: '',
                source_message_id: startMessageId,
                source_excerpt: '',
                status: 'open',
            }],
            clues_resolve: [{
                id: '',
                status: 'resolved',
                resolution: '',
                message_id: endMessageId,
            }],
        }),
    ].join('\n');
}

export function applyHistoryIndexResult(inputState, rawPayload, {
    startMessageId = 0,
    endMessageId = 0,
} = {}) {
    const state = deepClone(inputState);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    const rawDigest = rawPayload?.memory_digest ?? rawPayload?.memoryDigest;
    if (rawDigest?.text) {
        state.storyMemory.digest = normalizeMemoryDigest({
            ...rawDigest,
            through_message_id: rawDigest.through_message_id ?? endMessageId,
        }, state.storyMemory.digest, state.clock.absoluteMinute);
    }
    const rawSummary = rawPayload?.chapter_summary ?? rawPayload?.chapterSummary;
    if (rawSummary?.summary) {
        const prepared = {
            ...rawSummary,
            start_message_id: rawSummary.start_message_id ?? startMessageId,
            end_message_id: rawSummary.end_message_id ?? endMessageId,
        };
        const normalized = normalizeStorySummary(prepared);
        const existing = state.storyMemory.summaries.find(summary => (
            summary.id === normalized.id
            || (
                summary.startMessageId === normalized.startMessageId
                && summary.endMessageId === normalized.endMessageId
            )
        ));
        if (existing) Object.assign(existing, normalized);
        else state.storyMemory.summaries.push(normalized);
    }

    applyMemoryFactUpdates(state, {
        factsUpsert: rawPayload?.facts_upsert ?? rawPayload?.factsUpsert,
        factsInvalidate: rawPayload?.facts_invalidate ?? rawPayload?.factsInvalidate,
    }, {
        sourceMessageId: endMessageId,
        sourceSwipeId: 0,
    });
    applyClueUpdates(state, {
        cluesUpsert: rawPayload?.clues_upsert ?? rawPayload?.cluesUpsert,
        cluesResolve: rawPayload?.clues_resolve ?? rawPayload?.cluesResolve,
    }, {
        sourceMessageId: endMessageId,
        sourceSwipeId: 0,
    });
    state.storyMemory.indexedThroughMessageId = Math.max(
        state.storyMemory.indexedThroughMessageId,
        asInteger(endMessageId, 0, 0),
    );
    state.storyMemory.indexedAt = nowIso();
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'history_indexed',
        text: `历史档案已整理至消息 ${state.storyMemory.indexedThroughMessageId}`,
        reason: `本批 ${startMessageId}—${endMessageId}`,
    });
    return trimState(state);
}

export function buildPersonObservationPrompt(state, person, {
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
} = {}) {
    const isUser = Boolean(
        person?.isUser
        || (
            userName
            && person?.name?.toLocaleLowerCase() === String(userName).toLocaleLowerCase()
        )
    );
    if (isUser && !includeUserInnerVoice) {
        throw new Error('玩家视角默认关闭；如确实需要，请先开启“描写玩家内心”');
    }
    const recent = asArray(narrativeTurns)
        .map(turn => `${turn?.role === 'user' ? 'user' : 'assistant'}：${modelText(turn?.content, 2400)}`)
        .filter(Boolean)
        .join('\n');
    const relevantMemory = selectRelevantStoryMemory(
        state,
        `${person?.name || ''}\n${person?.location || ''}\n${recent}`,
        { maximumClues: 6, maximumSummaries: 3 },
    );
    relevantMemory.digest = null;
    relevantMemory.summaries = [];
    relevantMemory.facts = relevantMemory.facts.filter(fact => (
        fact.visibility !== 'hidden'
        || fact.people.includes(person?.name)
    ));
    relevantMemory.clues = relevantMemory.clues.filter(clue => (
        clue.visibility !== 'hidden'
        || clue.people.includes(person?.name)
    ));
    const relevantEvents = state.events
        .filter(event => (
            !TERMINAL_EVENT_STATES.has(event.status)
            && (
                event.place === person?.location
                || String(event.summary || '').includes(person?.name || '')
                || String(event.title || '').includes(person?.name || '')
            )
        ))
        .slice(0, 8)
        .map(event => ({
            title: event.title,
            place: event.place,
            summary: event.summary,
            status: event.status,
            visibility: event.visibility,
        }));

    return [
        `请以“${modelText(person?.name, 80)}”本人的第一人称，描写她此刻正在做什么。`,
        '这是幕后即时观测，不是主聊天正文，也不是新的世界推演。',
        '要求：',
        '1. 只描写几分钟内的动作、感官、注意力与符合既有信息的即时念头；使用“我”。',
        '2. 不推进主世界时间，不制造重大新事件，不替其他角色行动，不改变任何既有事实。',
        '3. 严守该角色的知识边界；幕后伏笔若角色并不知道，不得让她突然知晓。',
        '4. 文风自然沉浸，不写标题、说明、项目符号或“第一视角”等标签。',
        '5. 输出约 250—500 字的中文片段，只返回片段本身。',
        '',
        `主世界时间：${formatWorldCalendar(state).stamp}`,
        '人物状态：',
        JSON.stringify({
            name: person?.name,
            location: person?.location,
            action: person?.action,
            intent: person?.intent,
            long_term_goal: person?.longTermGoal,
            personality_anchor: person?.personalityAnchor,
            speaking_style: person?.speakingStyle,
            behavior_boundaries: person?.behaviorBoundaries,
            inner_voice: person?.innerVoice,
            knowledge: person?.knowledge,
        }),
        '同地点或相关进行中事件：',
        JSON.stringify(relevantEvents),
        '相关旧记忆（只使用该角色有合理机会知道的内容）：',
        JSON.stringify(relevantMemory),
        '最近正文：',
        recent || '（无）',
    ].join('\n');
}

export function compactStateForModel(state, {
    includeUserInnerVoice = false,
    userName = '',
    maximumPeople = 14,
} = {}) {
    const people = [...state.people]
        .sort((a, b) => (
            Number(b.relevance || 0) - Number(a.relevance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, asInteger(maximumPeople, 14, 1, LIMITS.people));
    const events = state.events
        .filter(event => !['cancelled', 'missed'].includes(event.status) || event.delivery.state === 'pending')
        .sort((a, b) => {
            const priority = event => (
                event.delivery?.state === 'pending' ? 4
                    : event.status === 'ready' ? 3
                        : ['active', 'waiting'].includes(event.status) ? 2
                            : 1
            );
            return priority(b) - priority(a) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        })
        .slice(0, 20);

    return {
        world_now: state.clock.absoluteMinute,
        world_now_label: formatWorldCalendar(state).stamp,
        world: {
            name: modelText(state.world.name, 80),
            title: modelText(state.world.title, 140),
            detail: modelText(state.world.detail, 360),
        },
        people: people.map(person => {
            const isUser = Boolean(
                person.isUser
                || (
                    userName
                    && person.name.toLocaleLowerCase() === String(userName).toLocaleLowerCase()
                )
            );
            return {
                id: person.id,
                name: modelText(person.name, 80),
                is_user: isUser,
                location: modelText(person.location, 120),
                action: modelText(person.action, 180),
                intent: modelText(person.intent, 180),
                long_term_goal: modelText(person.longTermGoal, 220),
                personality_anchor: modelText(person.personalityAnchor, LIMITS.personalityAnchor),
                speaking_style: modelText(person.speakingStyle, LIMITS.speakingStyle),
                behavior_boundaries: modelText(person.behaviorBoundaries, LIMITS.behaviorBoundaries),
                inner_voice: isUser && !includeUserInnerVoice
                    ? ''
                    : modelText(person.innerVoice, 160),
                inner_voice_at: person.innerVoiceAt,
                knowledge: person.knowledge,
                relevance: person.relevance,
                background_simulation: person.simulationEnabled !== false,
                locked_profile: Boolean(person.locked),
                last_seen_message_id: person.lastSeenMessageId,
            };
        }),
        events: events.map(event => ({
                id: event.id,
                title: modelText(event.title, 120),
                place: modelText(event.place, 100),
                summary: modelText(event.summary, 180),
                consequence: modelText(event.consequence, 180),
                expected_result: modelText(event.expectedResult, 180),
                result: modelText(event.result, 180),
                status: event.status,
                clock_mode: event.clockMode,
                started_at: event.startedAt,
                due_at: event.dueAt,
                duration_minutes: event.durationMinutes,
                accrued_minutes: event.accruedMinutes,
                prerequisites: event.prerequisites,
                visibility: event.visibility,
                delivery_state: event.delivery.state,
            })),
        omitted: {
            people: Math.max(0, state.people.length - people.length),
            events: Math.max(0, state.events.length - events.length),
        },
    };
}

export function buildSimulationPrompt(state, {
    queuedEventIds = [],
    trigger = 'reply',
    latestTurn = {},
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
    timePolicy = 'explicit',
    simulationMode = 'balanced',
    customInstruction = '',
    newAssistantTurns = 1,
    backgroundNpcBudget = 4,
} = {}) {
    const compact = compactStateForModel(state, {
        includeUserInnerVoice,
        userName,
        maximumPeople: Math.min(24, Math.max(10, Number(backgroundNpcBudget) + 10)),
    });
    const queued = uniqueStrings(queuedEventIds, 24);
    const latestUser = modelText(latestTurn?.user, 6000);
    const latestAssistant = modelText(latestTurn?.assistant, 9000);
    const contextTurns = asArray(narrativeTurns)
        .map((turn, index) => ({
            role: turn?.role === 'assistant' ? 'assistant' : 'user',
            content: modelText(turn?.content, turn?.role === 'assistant' ? 5000 : 3000),
            messageId: Number.isInteger(Number(turn?.messageId)) ? Number(turn.messageId) : index,
            swipeId: Number.isInteger(Number(turn?.swipeId)) ? Number(turn.swipeId) : 0,
            index,
        }))
        .filter(turn => turn.content);
    if (!contextTurns.length) {
        if (latestUser) contextTurns.push({ role: 'user', content: latestUser, index: 0 });
        if (latestAssistant) contextTurns.push({ role: 'assistant', content: latestAssistant, index: 1 });
    }
    const assistantIndexes = contextTurns
        .filter(turn => turn.role === 'assistant')
        .map(turn => turn.index);
    const newAssistantIndexSet = new Set(
        assistantIndexes.slice(-asInteger(newAssistantTurns, 1, 1, 20)),
    );
    const narrativeBlock = contextTurns
        .map(turn => (
            `<${turn.role}_turn order="${turn.index + 1}" message_id="${turn.messageId}" `
            + `swipe_id="${turn.swipeId}" new="${newAssistantIndexSet.has(turn.index)}">`
            + `${turn.content}</${turn.role}_turn>`
        ))
        .join('\n');
    const relevantMemory = selectRelevantStoryMemory(state, narrativeBlock, {
        maximumClues: 8,
        maximumSummaries: 4,
    });
    const timeRule = {
        explicit: '严格时间：只有正文明确给出几点、多少分钟/小时/天或明确跨到次日时，elapsed_minutes 才能大于 0；“夜幕降临、过了一会、首夜、许久”等氛围或模糊词一律填 0。',
        cautious: '克制估算：明确时间正常计算；只有模糊时间变化时可以保守估算，但不得超过 180 分钟。',
        open: '开放估算：允许依据清楚的叙事时间变化估算经过时长，但仍不得把回复轮次当时间。',
    }[timePolicy] || '严格时间：没有明确、可计算的时间证据就填 0。';
    const userVoiceRule = includeUserInnerVoice
        ? `玩家角色名为“${modelText(userName, 80) || '未提供'}”；允许在正文已经明确体现其情绪时写入玩家角色 inner_voice，但不得替玩家新增决定、欲望或立场。`
        : `玩家角色名为“${modelText(userName, 80) || '未提供'}”；可以追踪她的位置与行动，但必须标记 is_user=true，且 inner_voice 必须为空，绝不替玩家描写内心活动。`;
    const simulationRule = {
        light: '轻量推演：只处理最后正文明确造成的变化，原则上不新建镜头外事件；最多提取1条真正重要的新伏笔。',
        balanced: '均衡推演：维护明确的前台变化，并让少量高相关的镜头外人物和事件继续发展；避免无意义扩张。',
        deep: '深入推演：在保持因果与知识边界的前提下，可以维护更多高相关镜头外人物、事件和伏笔，但仍不得凭空制造灾难或强行转折。',
        manual: '手动均衡推演：按均衡尺度处理本次正文，不因为手动触发而重复旧变化。',
    }[simulationMode] || '均衡推演：只维护与当前因果相关的变化。';
    const customRule = modelText(customInstruction, 1000);
    const npcBudget = asInteger(backgroundNpcBudget, 4, 0, 12);
    const newAssistantRule = newAssistantIndexSet.size === 1
        ? '11. 较早轮次只用于理解因果，不得重复计算；本次只推演最后一个 assistant_turn（new="true"）。'
        : `11. 只处理标记 new="true" 的最后 ${newAssistantIndexSet.size} 个 assistant_turn，并按消息顺序合并变化；new="false" 的轮次只用于理解因果，不得重复计算。`;

    return [
        '你是“世界背面”的世界状态推演器。你不写小说正文，不总结长期记忆，只处理标记为 new="true" 的 AI 正文新造成的世界变化。',
        '',
        '推演原则：',
        `1. 主世界时间是唯一进度轴。${timeRule}`,
        `本次尺度：${simulationRule}`,
        '2. 玩家/用户的行动只能来自正文已经发生的内容，不得替玩家新增行动。',
        `3. 前台已经发生的事实必须回写人物位置、行动和事件；本次最多更新 ${npcBudget} 名镜头外 NPC。其余人物保持休眠，不得为了“热闹”集体更新。`,
        '大量同阵营或同地点 NPC 的共同变化优先合并成势力/地点事件；名字重新出现、地点接近、关联事件到时或伏笔命中时再唤醒个人。',
        '4. 不输出百分比。duration/scheduled 事件由插件按时间计算；active 事件只填写本轮实际工作的 worked_minutes；condition 事件等待条件。',
        '5. 到时事件必须给出 resolved/cancelled/missed 之一及具体 result，或明确保持 ready；不能用 99%/100% 长期悬挂。',
        '6. NPC 第一视角独白写入 inner_voice，必须是该人物自己的口吻、20—80字，只在她的处境/目标/情绪有真实变化时更新。不要让所有人物每轮集体独白。',
        '人物状态中的 personality_anchor、speaking_style 与 behavior_boundaries 是用户维护的角色约束：必须遵守，不得在 people_upsert 中重写，也不得用本轮临时情绪覆盖稳定人格。',
        `7. ${userVoiceRule}`,
        '8. long_term_goal 是人物较稳定的长期方向；只有目标真正建立、完成、放弃或转向时才更新，不能把本轮动作重复填进去。',
        '9. inner_voice 是幕后观测信息，不得当作主角已知事实，也不得写入 deliveries_confirmed。',
        '10. deliveries_confirmed 只填写本批新正文确实承接、感知或留下可见痕迹的事件ID。没有写进正文就不要确认。',
        newAssistantRule,
        '12. 相关旧记忆中的伏笔只能帮助保持因果连续；角色不知情的隐藏伏笔不能突然变成角色知识。',
        '13. 新出现且可能在后文呼应的细节写入 memory_update.clues_upsert；普通动作和气氛不要滥记。旧伏笔被明确呼应或解决时使用原 ID 更新。',
        '14. 只有本批新正文明确建立或改变了未来仍有用的身份、关系、承诺、限制、物品归属或已揭示真相时，才写入 memory_update.facts_upsert。临时位置、动作和模型自行推演的幕后猜测不得写成长效事实。',
        '同一类事实使用稳定 key。正文给出新值时保留 key；插件会保留旧版本并标为 superseded。正文明确否定某条旧事实时写入 facts_invalidate；真假未定时用 status=disputed。',
        '人物 source 只有在本批 new="true" 正文真实描写到该人物时才填 foreground；镜头外人物必须填 background。present_in_scene 只有人物本人在当前场景中实际行动、说话或被直接感知时才为 true；仅被提及、回忆、谈论、作为目标或出现在内心想法里一律为 false。last_seen_message_id 必须填该人物最后实际出现的 assistant 消息 ID。',
        customRule
            ? `用户自定义侧重点：${customRule}（它只能调整侧重点，不能覆盖时间证据、知识边界、玩家意志或 JSON 格式规则。）`
            : '用户没有追加自定义推演要求。',
        '15. 只返回一个合法 JSON 对象，不要代码围栏，不要解释。',
        '16. 权威状态为了控制调用体积只列出最相关的人物与事件；未列出的旧条目会由插件原样保留，绝不能据此推断其消失。',
        '',
        `触发类型：${trigger}`,
        `本轮曾提供给正文的候选结果ID：${queued.length ? queued.join(', ') : '无'}`,
        '',
        '最近正文上下文（只处理 new="true" 的 assistant_turn）：',
        narrativeBlock || '<assistant_turn>（AI正文为空）</assistant_turn>',
        '',
        '与当前人物、地点和物品相关的旧记忆：',
        JSON.stringify(relevantMemory),
        '',
        '推演前权威状态：',
        JSON.stringify(compact),
        '',
        '返回结构：',
        JSON.stringify({
            elapsed_minutes: 0,
            time_reason: '',
            world: { title: '', detail: '' },
            people_upsert: [{
                id: '',
                name: '',
                is_user: false,
                location: '',
                action: '',
                intent: '',
                long_term_goal: '',
                trace: '',
                inner_voice: '',
                knowledge: 'hidden',
                relevance: 1,
                source: 'foreground',
                present_in_scene: false,
                last_seen_message_id: 0,
            }],
            people_remove: [],
            events_create: [{
                id: '',
                title: '',
                place: '',
                summary: '',
                consequence: '',
                expected_result: '',
                clock_mode: 'duration',
                duration_minutes: 0,
                scheduled_at: null,
                prerequisites: [],
                visibility: 'hidden',
                delivery_route: '',
            }],
            events_update: [{
                id: '',
                status: 'active',
                worked_minutes: 0,
                result: '',
                summary: '',
                consequence: '',
                visibility: 'hidden',
                delivery_route: '',
            }],
            deliveries_confirmed: [],
            front_facts: [{
                text: '',
                affects: [],
                visibility: 'known',
            }],
            memory_update: {
                facts_upsert: [{
                    id: '',
                    key: '',
                    subject: '',
                    predicate: '',
                    value: '',
                    source_message_id: 0,
                    source_swipe_id: 0,
                    source_excerpt: '',
                    people: [],
                    locations: [],
                    tags: [],
                    status: 'active',
                    confidence: 'high',
                    importance: 2,
                    visibility: 'known',
                }],
                facts_invalidate: [{
                    id: '',
                    key: '',
                    reason: '',
                }],
                clues_upsert: [{
                    id: '',
                    title: '',
                    text: '',
                    source_excerpt: '',
                    people: [],
                    locations: [],
                    tags: [],
                    status: 'open',
                    importance: 1,
                    visibility: 'hidden',
                }],
                clues_resolve: [{
                    id: '',
                    status: 'resolved',
                    resolution: '',
                }],
            },
        }),
    ].join('\n');
}

function escapeJsonControlCharacters(candidate) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (const char of candidate) {
        if (!inString) {
            if (char === '"') inString = true;
            output += char;
            continue;
        }
        if (escaped) {
            output += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            output += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            output += char;
            inString = false;
            continue;
        }
        if (char === '\n') {
            output += '\\n';
            continue;
        }
        if (char === '\r') {
            output += '\\r';
            continue;
        }
        if (char === '\t') {
            output += '\\t';
            continue;
        }
        const code = char.charCodeAt(0);
        output += code < 0x20
            ? `\\u${code.toString(16).padStart(4, '0')}`
            : char;
    }
    return output;
}

function removeJsonTrailingCommas(candidate) {
    let output = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (inString) {
            output += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            output += char;
            continue;
        }
        if (char === ',') {
            let next = index + 1;
            while (next < candidate.length && /\s/.test(candidate[next])) next += 1;
            if (candidate[next] === '}' || candidate[next] === ']') continue;
        }
        output += char;
    }
    return output;
}

function parseJsonCandidate(candidate) {
    const repaired = removeJsonTrailingCommas(escapeJsonControlCharacters(candidate));
    for (const value of repaired === candidate ? [candidate] : [candidate, repaired]) {
        try {
            return JSON.parse(value);
        } catch {
            // Try the next conservative repair, if one exists.
        }
    }
    return null;
}

export function extractJsonObject(rawText) {
    const raw = asString(rawText, '', 200000)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!raw) return null;

    const direct = parseJsonCandidate(raw);
    if (direct) return direct;

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                const parsed = parseJsonCandidate(raw.slice(start, index + 1));
                if (parsed) return parsed;
                start = -1;
            }
        }
    }
    return null;
}

export function createSnapshot(state, meta = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        takenAt: nowIso(),
        meta: {
            messageId: meta.messageId ?? null,
            swipeId: meta.swipeId ?? null,
            sourceKey: asString(meta.sourceKey, '', 180),
            kind: asString(meta.kind, 'result', 30),
        },
        state: trimState(deepClone(state)),
    };
}

export function restoreSnapshot(snapshot, fallback = null) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.state) {
        return fallback ? trimState(deepClone(fallback)) : createInitialState();
    }
    return trimState(deepClone(snapshot.state));
}

export function markPendingSync(inputState, pending = true) {
    const state = deepClone(inputState);
    state.pendingSync = Boolean(pending);
    state.updatedAt = nowIso();
    return state;
}

export function hashText(text) {
    const value = String(text ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function trimState(inputState) {
    const state = deepClone(inputState);
    state.schemaVersion = SCHEMA_VERSION;
    const absoluteMinute = asInteger(state.clock?.absoluteMinute, MINUTES_PER_DAY, 0);
    const absoluteDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    state.world = {
        name: asString(state.world?.name, '未命名世界', 80),
        title: asString(state.world?.title, '世界仍在继续', 180),
        detail: asString(state.world?.detail, '', 640),
        calendar: normalizeWorldCalendar(state.world?.calendar, absoluteDay),
    };
    state.clock = {
        absoluteMinute,
        lastCheckedAt: asInteger(
            state.clock?.lastCheckedAt,
            state.clock?.absoluteMinute ?? MINUTES_PER_DAY,
            0,
        ),
        source: asString(state.clock?.source, 'unknown', 40),
        reason: asString(state.clock?.reason, '', 240),
    };

    state.people = asArray(state.people)
        .slice(-LIMITS.people)
        .map(person => normalizePerson(person, person, state.clock.absoluteMinute));

    const events = asArray(state.events)
        .map(event => normalizeEvent(event, state.clock.absoluteMinute, event));
    const active = events.filter(event => !TERMINAL_EVENT_STATES.has(event.status));
    const terminal = events
        .filter(event => TERMINAL_EVENT_STATES.has(event.status))
        .sort((a, b) => Number(b.resolvedAt || b.updatedAt) - Number(a.resolvedAt || a.updatedAt));
    state.events = [
        ...active.slice(-LIMITS.events),
        ...terminal.slice(0, Math.max(0, LIMITS.events - active.length)),
    ];

    state.echoes = asArray(state.echoes).slice(0, LIMITS.echoes);
    state.archive = asArray(state.archive).slice(0, LIMITS.archive);
    state.foregroundFacts = asArray(state.foregroundFacts).slice(0, LIMITS.foregroundFacts);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    state.audit = asArray(state.audit).slice(0, LIMITS.audit);
    state.revision = asInteger(state.revision, 0, 0);
    state.pendingSync = Boolean(state.pendingSync);
    state.updatedAt = asString(state.updatedAt, nowIso(), 40);
    return state;
}

export function isTerminalEvent(event) {
    return TERMINAL_EVENT_STATES.has(event?.status);
}

export function isActiveEvent(event) {
    return ACTIVE_EVENT_STATES.has(event?.status);
}
