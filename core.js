import {
    buildClockAuthorityLines,
    normalizeClueTiming,
    resolveFutureTimeExpression,
    resolveNarrativeTimeTransition,
} from './world-clock-authority.js';

const WB_STATE_RECONCILE_ORDER = Object.freeze([3, 1, 4, 2]);

export const MODULE_ID = 'world_backstage';
export const STATE_KEY = 'world_backstage_v1';
export const SNAPSHOT_KEY = 'world_backstage';
export const SCHEMA_VERSION = 25;
export const MAX_CALENDAR_YEAR = 999999;
export const MINUTES_PER_DAY = 24 * 60;
export const RECOVERY_LIMIT = 3;

const TERMINAL_EVENT_STATES = new Set(['resolved', 'cancelled', 'missed']);
const ACTIVE_EVENT_STATES = new Set(['active', 'waiting']);
const VALID_CLOCK_MODES = new Set(['duration', 'active', 'scheduled', 'condition']);
const VALID_VISIBILITY = new Set(['hidden', 'trace', 'known', 'direct']);
const VALID_KNOWLEDGE = new Set(['hidden', 'known']);
const VALID_KNOWLEDGE_ROUTES = new Set([
    'witnessed',
    'told',
    'investigated',
    'message',
    'public_channel',
    'inferred',
]);
const VALID_KNOWLEDGE_CERTAINTY = new Set(['confirmed', 'suspected']);
const VALID_CLUE_STATES = new Set(['open', 'developing', 'triggered', 'echoed', 'resolved', 'discarded']);
const VALID_MEMORY_FACT_STATES = new Set(['active', 'disputed', 'superseded', 'invalidated']);
const VALID_MEMORY_CONFIDENCE = new Set(['low', 'medium', 'high']);
const MEMORY_SUMMARY_LEVELS = Object.freeze({
    DETAIL: 0,
    STAGE: 1,
    CHAPTER: 2,
    LONG_TERM: 3,
});
const MEMORY_ROLLUP_THRESHOLDS = Object.freeze({
    0: 12,
    1: 6,
    2: 3,
});
const VALID_EVENT_STATES = new Set([
    'active',
    'waiting',
    'ready',
    'resolved',
    'cancelled',
    'missed',
]);

const LIMITS = Object.freeze({
    // Persistent people storage is intentionally uncapped. These limits only bound
    // one model payload / one task / one prompt context so a large world stays usable.
    peoplePayload: 36,
    peopleTaskBudget: 36,
    peopleModelContext: 36,
    events: 96,
    archive: 120,
    echoes: 80,
    foregroundFacts: 24,
    worldFacts: 160,
    worldPulseDomains: 18,
    worldCoverageEntries: 48,
    publicImpactLedger: 96,
    consistencyConflicts: 32,
    audit: 40,
    text: 800,
    innerVoice: 240,
    longTermGoal: 360,
    identityAnchor: 500,
    personalityAnchor: 600,
    appearanceProfile: 700,
    backgroundProfile: 900,
    worldBackground: 5000,
    worldbookRaw: 4000,
    speakingStyle: 360,
    behaviorBoundaries: 500,
    cognitiveRefs: 32,
    personState: 220,
    personAvatarData: 180000,
    eventCause: 360,
    eventPublicTrace: 260,
    storySummaries: 2400,
    clues: 480,
    memoryFacts: 720,
    memoryDigest: 2400,
    metabolismLog: 180,
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

function mergeUniqueStrings(previous, incoming, maximum = 12) {
    return uniqueStrings([
        ...asArray(previous),
        ...asArray(incoming),
    ], maximum);
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


function inferLegacyEventPublicity(raw = {}, existing = null) {
    const explicit = String(raw?.publicity ?? raw?.public_scope ?? raw?.publicScope ?? existing?.publicity ?? '').trim().toLowerCase();
    if (VALID_EVENT_PUBLICITY.has(explicit)) return explicit;

    const publicTrace = String(
        raw?.public_trace
        ?? raw?.publicTrace
        ?? existing?.publicTrace
        ?? ''
    ).trim();
    const publicHeadline = String(
        raw?.public_headline
        ?? raw?.publicHeadline
        ?? existing?.publicHeadline
        ?? ''
    ).trim();
    const publicSummary = String(
        raw?.public_summary
        ?? raw?.publicSummary
        ?? existing?.publicSummary
        ?? ''
    ).trim();

    if (!publicTrace && !publicHeadline && !publicSummary) return 'private';

    // 1.4.1 以前 public_trace 和 visibility 混用过。
    // 迁移时只在文本本身明确出现“社会传播渠道”证据时才自动认定为 public；
    // 否则宁可保持 private，避免把卧室/私聊/角色已知事件错误同步成新闻。
    const evidence = `${publicHeadline} ${publicSummary} ${publicTrace}`;
    const strongPublicCue = /(公告|通报|报道|新闻|媒体|记者|电视台|广播|报纸|官方|政府|警方|消防|医院|学校|公司发布|机构发布|委员会|公示|通知|预警|交通部门|气象|论坛|社交媒体|热搜|公众|市民|居民|游客|全城|全网|公开声明|新闻发布)/i;
    if (strongPublicCue.test(evidence)) return 'public';

    const traceCue = /(有人看见|有人发现|路人|邻居|附近的人|外界察觉|传闻|风声|小道消息|可疑迹象|异常迹象)/i;
    if (traceCue.test(evidence)) return 'trace';

    return 'private';
}

function normalizeEventPublicity(value, fallback = 'private') {
    const normalized = String(value || '').trim().toLowerCase();
    return VALID_EVENT_PUBLICITY.has(normalized) ? normalized : fallback;
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
    if (policy === 'open' || policy === 'world') return minutes;
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
    const safeYear = asInteger(year, fallback.year, 1, MAX_CALENDAR_YEAR);
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

function daysBeforeCalendarYear(year) {
    const previous = Math.max(0, asInteger(year, 1, 1, MAX_CALENDAR_YEAR) - 1);
    return (
        previous * 365
        + Math.floor(previous / 4)
        - Math.floor(previous / 100)
        + Math.floor(previous / 400)
    );
}

function calendarOrdinal(date) {
    const safe = normalizeCalendarDate(date);
    let ordinal = daysBeforeCalendarYear(safe.year);
    for (let month = 1; month < safe.month; month += 1) {
        ordinal += daysInCalendarMonth(safe.year, month);
    }
    return ordinal + safe.day - 1;
}

function calendarDateFromOrdinal(value) {
    const maximumOrdinal = (
        daysBeforeCalendarYear(MAX_CALENDAR_YEAR)
        + 365
        + (daysInCalendarMonth(MAX_CALENDAR_YEAR, 2) === 29 ? 1 : 0)
        - 1
    );
    const target = Math.min(maximumOrdinal, Math.max(0, Math.trunc(Number(value) || 0)));

    let low = 1;
    let high = MAX_CALENDAR_YEAR;
    while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (daysBeforeCalendarYear(middle) <= target) low = middle;
        else high = middle - 1;
    }

    const year = low;
    let dayOfYear = target - daysBeforeCalendarYear(year);
    let month = 1;
    while (month < 12) {
        const monthDays = daysInCalendarMonth(year, month);
        if (dayOfYear < monthDays) break;
        dayOfYear -= monthDays;
        month += 1;
    }
    return { year, month, day: dayOfYear + 1 };
}

function addCalendarDays(date, days) {
    const safe = normalizeCalendarDate(date);
    const delta = asInteger(days, 0, -1000000, 1000000);
    return calendarDateFromOrdinal(calendarOrdinal(safe) + delta);
}

function calendarDayDifference(fromDate, toDate) {
    const from = normalizeCalendarDate(fromDate);
    const to = normalizeCalendarDate(toDate, from);
    return calendarOrdinal(to) - calendarOrdinal(from);
}

function extractExplicitCalendarDate(text = '') {
    const source = asString(text, '', 60000);
    const patterns = [
        /(?:^|\D)(\d{1,6})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\D|$)/g,
        /(?:^|\D)(\d{1,6})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/g,
    ];
    let latest = null;
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            if (year < 1 || year > MAX_CALENDAR_YEAR || month < 1 || month > 12) continue;
            if (day < 1 || day > daysInCalendarMonth(year, month)) continue;
            const index = Number(match.index ?? 0);
            if (!latest || index >= latest.index) {
                latest = { year, month, day, index, excerpt: match[0].trim() };
            }
        }
    }
    return latest;
}


/**
 * 从一条正文中读取“作者明确写出来”的时间锚点。
 * 手动“与正文校准”使用它：不调用模型、不推断缺失的钟点。
 * 优先解析正文的“时间与地点” details；找不到时才回退到整条正文。
 */
export function extractNarrativeTimeAnchor(text = '') {
    const source = asString(text, '', 60000);
    if (!source.trim()) return null;

    const detailMatches = [...source.matchAll(/<details\b[^>]*>[\s\S]*?<summary\b[^>]*>[\s\S]*?(?:时间\s*[与和]\s*地点|时间地点)[\s\S]*?<\/summary>[\s\S]*?<\/details>/giu)];
    const scope = detailMatches.length
        ? String(detailMatches.at(-1)?.[0] || '')
        : source;

    const date = extractExplicitCalendarDate(scope) || (scope === source ? null : extractExplicitCalendarDate(source));

    // 形如 ▶07:40→08:15：结尾时间代表这段正文结束时的时间。
    const transitions = [...scope.matchAll(/(?:▶|>)?\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*(?:→|->|至|到)\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)/gu)];
    let exact = null;
    if (transitions.length) {
        const match = transitions.at(-1);
        exact = { hour: Number(match[3]), minute: Number(match[4]), excerpt: match[0].trim() };
    } else {
        // 时间栏里只有单个明确钟点时也允许同步。限制在“时间与地点”区域可减少误抓正文中的普通数字。
        const times = [...scope.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/gu)];
        if (times.length) {
            const match = times.at(-1);
            exact = { hour: Number(match[1]), minute: Number(match[2]), excerpt: match[0].trim() };
        }
    }

    const daypartMatch = [...scope.matchAll(/(?:凌晨|黎明|清晨|早晨|上午|中午|午后|下午|傍晚|黄昏|晚上|夜晚|深夜)/gu)].at(-1);
    const daypart = daypartMatch?.[0] || '';

    if (!date && !exact) return null;
    return {
        year: date?.year ?? null,
        month: date?.month ?? null,
        day: date?.day ?? null,
        hour: exact?.hour ?? null,
        minute: exact?.minute ?? null,
        daypart,
        structured: detailMatches.length > 0,
        precision: date && exact ? 'minute' : date ? (daypart ? 'daypart' : 'date') : 'minute',
        excerpt: [date?.excerpt, exact?.excerpt, daypart].filter(Boolean).join(' · ').slice(0, 240),
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


const VALID_WORLD_FACT_SOURCES = new Set(['narrative', 'simulation', 'manual', 'event-settlement']);
const VALID_WORLD_FACT_CONFIDENCE = new Set(['low', 'medium', 'high']);
const VALID_WORLD_FACT_VALIDITY = new Set(['current', 'upcoming', 'historical', 'persistent']);
const VALID_WORLD_PULSE_KINDS = new Set([
    'environment',
    'government',
    'economy',
    'organization',
    'infrastructure',
    'security',
    'culture',
    'media',
    'community',
    'other',
]);
const VALID_WORLD_PULSE_TRENDS = new Set(['stable', 'rising', 'falling', 'volatile']);
const VALID_EVENT_PUBLICITY = new Set(['private', 'trace', 'public']);

function worldFactStableKey(raw = {}) {
    const explicit = asString(raw?.key, '', 180);
    if (explicit) return explicit;
    const subjectType = asString(raw?.subject_type ?? raw?.subjectType, 'world', 40) || 'world';
    const subjectId = asString(
        raw?.subject_id ?? raw?.subjectId ?? raw?.subject ?? raw?.name,
        'world',
        120,
    ) || 'world';
    const field = asString(raw?.field, 'state', 80) || 'state';
    return `${subjectType}:${subjectId}:${field}`;
}

export function normalizeWorldFact(raw, existing = null, worldMinute = 0) {
    const key = worldFactStableKey(raw || existing || {});
    const source = asString(raw?.source, existing?.source || 'simulation', 40);
    const confidence = asString(raw?.confidence, existing?.confidence || 'high', 20);
    const rawValidity = asString(
        raw?.validity ?? raw?.temporal_state ?? raw?.temporalState ?? existing?.validity,
        '',
        20,
    ).toLowerCase();
    const inferredValidity = String(key || '').startsWith('event:') && String(key || '').endsWith(':result')
        ? 'historical'
        : 'current';
    const validity = VALID_WORLD_FACT_VALIDITY.has(rawValidity)
        ? rawValidity
        : inferredValidity;
    return {
        id: normalizeId(raw?.id || existing?.id || `world_fact_${hashText(key)}`, 'world_fact'),
        key,
        subjectType: asString(
            raw?.subject_type ?? raw?.subjectType,
            existing?.subjectType || 'world',
            40,
        ) || 'world',
        subjectId: asString(
            raw?.subject_id ?? raw?.subjectId,
            existing?.subjectId || '',
            120,
        ),
        subject: asString(raw?.subject, existing?.subject || '', 140),
        field: asString(raw?.field, existing?.field || 'state', 80) || 'state',
        value: asString(raw?.value, existing?.value || '', 520),
        source: VALID_WORLD_FACT_SOURCES.has(source) ? source : 'simulation',
        confidence: VALID_WORLD_FACT_CONFIDENCE.has(confidence) ? confidence : 'high',
        validity,
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        eventId: asString(
            raw?.event_id ?? raw?.eventId,
            existing?.eventId || '',
            120,
        ),
        messageId: asInteger(
            raw?.message_id ?? raw?.messageId,
            existing?.messageId ?? -1,
            -1,
        ),
        settledAt: asInteger(
            raw?.settled_at ?? raw?.settledAt,
            existing?.settledAt ?? worldMinute,
            0,
        ),
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            worldMinute,
            0,
        ),
    };
}

function worldFactAuthorityScore(fact) {
    const sourceWeight = {
        manual: 40,
        narrative: 35,
        'event-settlement': 30,
        simulation: 10,
    }[fact?.source] ?? 10;
    const confidenceWeight = {
        high: 3,
        medium: 2,
        low: 0,
    }[fact?.confidence] ?? 1;
    return sourceWeight + confidenceWeight;
}

function isStableIdentityFact(fact) {
    const field = String(fact?.field || '').toLocaleLowerCase();
    return /(?:婚姻|离婚|结婚|配偶|伴侣|亲属|父母|子女|兄弟|姐妹|身份|性别|物种|生死|死亡|存活|marriage|marital|spouse|partner|family|identity|gender|species|death|alive)/iu.test(field);
}

function factTransitionHasCausalEvent(state, fact) {
    const eventId = String(fact?.eventId || '').trim();
    return Boolean(eventId && asArray(state?.events).some(event => event?.id === eventId));
}

function lowerAuthorityFactOverwriteMustBeRejected(state, existing, incoming, worldMinute) {
    if (!existing || !incoming || existing.value === incoming.value) return false;
    if (incoming.source !== 'simulation') return false;

    // Stable identity/relationship facts cannot silently flip because the model
    // guessed a different value. A backstage transition is allowed only when the
    // new fact points at an actual causal event created/updated in world state.
    if (
        isStableIdentityFact(existing)
        && ['manual', 'narrative', 'event-settlement'].includes(existing.source)
        && !factTransitionHasCausalEvent(state, incoming)
    ) {
        return true;
    }

    // At the same world moment, a background inference never beats a stronger
    // foreground/manual fact. Once world time has genuinely advanced, ordinary
    // dynamic facts (location, shop status, resources, etc.) may evolve normally.
    return (
        worldFactAuthorityScore(incoming) < worldFactAuthorityScore(existing)
        && Number(worldMinute || 0) <= Number(existing.updatedAt || existing.settledAt || 0)
    );
}

function appendFactConsistencyConflict(state, {
    existing,
    incoming,
    resolution = 'keep-world',
    reason = '',
    messageId = null,
} = {}) {
    if (!existing || !incoming || existing.value === incoming.value) return;
    state.consistencyConflicts = [
        normalizeConsistencyConflict({
            subject: existing.subject || incoming.subject || existing.subjectId || incoming.subjectId || '世界状态',
            field: existing.field || incoming.field || 'state',
            previous_value: existing.value,
            narrative_value: incoming.value,
            resolution,
            reason,
            message_id: messageId ?? incoming.messageId ?? existing.messageId ?? -1,
        }, state?.clock?.absoluteMinute || 0, messageId),
        ...asArray(state.consistencyConflicts),
    ].slice(0, LIMITS.consistencyConflicts);
}

function upsertWorldFact(state, raw, {
    worldMinute = state?.clock?.absoluteMinute || 0,
    source = '',
    messageId = null,
} = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const prepared = {
        ...raw,
        ...(source ? { source } : {}),
        ...(messageId !== null && messageId !== undefined ? { message_id: messageId } : {}),
    };
    const key = worldFactStableKey(prepared);
    const existing = asArray(state.worldFacts).find(item => item.key === key) || null;
    const fact = normalizeWorldFact(prepared, existing, worldMinute);
    if (!fact.value) return null;

    if (existing && existing.value !== fact.value) {
        if (lowerAuthorityFactOverwriteMustBeRejected(state, existing, fact, worldMinute)) {
            appendFactConsistencyConflict(state, {
                existing,
                incoming: fact,
                resolution: 'keep-world',
                reason: isStableIdentityFact(existing)
                    ? '稳定身份/关系事实没有对应的新因果事件，拒绝用后台推断直接翻转'
                    : `同一世界时刻的低权威来源 ${fact.source} 不能覆盖 ${existing.source}`,
                messageId,
            });
            return existing;
        }

        const incomingAuthority = worldFactAuthorityScore(fact);
        const existingAuthority = worldFactAuthorityScore(existing);
        if (
            incomingAuthority > existingAuthority
            || fact.source === 'narrative'
            || fact.source === 'manual'
        ) {
            freezeKnownFactBeforeChange(state, existing);
            appendFactConsistencyConflict(state, {
                existing,
                incoming: fact,
                resolution: 'accept-narrative',
                reason: fact.source === 'narrative'
                    ? '正文明确事实更新了后台旧状态'
                    : fact.source === 'manual'
                        ? '用户/作者维护事实更新了后台旧状态'
                        : `更高权威来源 ${fact.source} 修正了较低权威来源 ${existing.source}`,
                messageId,
            });
            appendAudit(state, {
                type: 'fact_authority_correction',
                text: `${existing.subject || existing.subjectId || '世界'}｜${existing.field}：${existing.value} → ${fact.value}`,
                reason: fact.source === 'narrative'
                    ? '正文明确事实优先'
                    : fact.source === 'manual'
                        ? '用户/作者维护事实优先'
                        : `事实来源优先级：${fact.source} > ${existing.source}`,
            });
        }
    }

    if (existing) Object.assign(existing, fact);
    else state.worldFacts.unshift(fact);
    state.worldFacts = state.worldFacts.slice(0, LIMITS.worldFacts);
    return fact;
}


export function eventTemporalState(event, worldMinute = 0) {
    if (!event) return 'historical';
    if (TERMINAL_EVENT_STATES.has(event.status)) return 'historical';

    const now = Number(worldMinute || 0);
    const dueAt = Number(event.dueAt);
    const startedAt = Number(event.startedAt);

    if (event.status === 'waiting') return 'upcoming';
    if (event.clockMode === 'scheduled' && Number.isFinite(dueAt) && dueAt > now) {
        return 'upcoming';
    }
    if (Number.isFinite(startedAt) && startedAt > now) return 'upcoming';
    return 'current';
}

function syncPublicEventRealityFacts(state, worldMinute = state?.clock?.absoluteMinute || 0) {
    for (const event of asArray(state?.events)) {
        if (
            event?.publicity !== 'public'
            || !event?.id
            || (!event.publicSummary && !event.publicHeadline && !event.publicTrace && !event.publicResult)
        ) continue;

        const temporalState = eventTemporalState(event, worldMinute);
        let value = '';
        let field = '';
        let source = 'simulation';

        if (temporalState === 'historical') {
            value = asString(
                event.publicResult || event.publicSummary || event.publicHeadline || event.publicTrace,
                '',
                520,
            );
            field = event.publicResult ? '最终公开结果' : '最近公开报道';
            source = 'event-settlement';
        } else if (temporalState === 'upcoming') {
            value = asString(
                event.publicSummary || event.publicHeadline || event.publicTrace,
                '',
                520,
            );
            field = '公开预告';
        } else {
            value = asString(
                event.publicSummary || event.publicHeadline || event.publicTrace,
                '',
                520,
            );
            field = '当前公开状态';
        }
        if (!value) continue;

        const subject = asString(event.place, '', 140)
            || asString(event.title, '世界', 140)
            || '世界';
        upsertWorldFact(state, {
            key: `public_event:${event.id}:state`,
            subject_type: event.place ? 'location' : 'event',
            subject_id: event.place || event.id,
            subject,
            field,
            value,
            validity: temporalState,
            visibility: 'known',
            confidence: 'high',
            event_id: event.id,
            settled_at: event.createdAt || worldMinute,
            updated_at: event.updatedAt || event.resolvedAt || worldMinute,
        }, {
            worldMinute,
            source,
        });
    }
}

function settlePersonStateFacts(state, person, source, messageId = null) {
    if (!person?.id) return;
    const fields = [
        ['location', '位置', person.location, 'hidden'],
        ['action', '当前行动', person.action, 'hidden'],
        ['physicalState', '身体状态', person.physicalState, 'hidden'],
        ['resourceState', '资源状态', person.resourceState, 'hidden'],
    ];
    for (const [field, label, value, visibility] of fields) {
        const text = asString(value, '', 520);
        if (!text || /待确认$/.test(text)) continue;
        upsertWorldFact(state, {
            key: `person:${person.id}:${field}`,
            subject_type: 'person',
            subject_id: person.id,
            subject: person.name,
            field,
            value: text,
            validity: 'current',
            visibility,
            confidence: 'high',
        }, {
            source,
            messageId,
        });
    }
}

export function settlePersonWorldState(inputState, personId, {
    source = 'manual',
    messageId = null,
} = {}) {
    const state = deepClone(inputState);
    const person = asArray(state.people).find(item => item.id === String(personId || ''));
    if (!person) return trimState(state);
    settlePersonStateFacts(state, person, source, messageId);
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    return trimState(state);
}

function settleEventResultFact(state, event, messageId = null) {
    if (!event?.id || !TERMINAL_EVENT_STATES.has(event.status)) return;
    const result = asString(event.result || event.consequence || event.summary, '', 520);
    if (!result) return;
    upsertWorldFact(state, {
        key: `event:${event.id}:result`,
        subject_type: 'event',
        subject_id: event.id,
        subject: event.title,
        field: 'result',
        value: result,
        validity: 'historical',
        visibility: event.visibility,
        event_id: event.id,
        confidence: 'high',
    }, {
        source: 'event-settlement',
        messageId,
    });
}

function normalizeConsistencyConflict(raw, worldMinute = 0, messageId = null) {
    return {
        id: normalizeId(raw?.id || `conflict_${hashText(JSON.stringify(raw || {}))}`, 'conflict'),
        subject: asString(raw?.subject, '世界状态', 140),
        field: asString(raw?.field, 'state', 80),
        expected: asString(raw?.expected ?? raw?.previous_value ?? raw?.previousValue, '', 420),
        observed: asString(raw?.observed ?? raw?.narrative_value ?? raw?.narrativeValue, '', 420),
        resolution: ['accept-narrative', 'keep-world', 'transition'].includes(raw?.resolution)
            ? raw.resolution
            : 'keep-world',
        reason: asString(raw?.reason, '', 360),
        messageId: asInteger(raw?.message_id ?? raw?.messageId, messageId ?? -1, -1),
        at: worldMinute,
    };
}


function normalizeWorldPulseDomain(raw, existing = null, worldMinute = 0) {
    const label = asString(
        raw?.label ?? raw?.name ?? existing?.label,
        existing?.label || '未命名领域',
        100,
    );
    const rawKind = asString(raw?.kind, existing?.kind || 'other', 30).toLowerCase();
    const rawTrend = asString(raw?.trend, existing?.trend || 'stable', 20).toLowerCase();
    return {
        id: normalizeId(
            raw?.id || existing?.id || `pulse_${hashText(`${rawKind}:${label}`)}`,
            'pulse',
        ),
        label,
        scope: asString(raw?.scope, existing?.scope || '', 120),
        kind: VALID_WORLD_PULSE_KINDS.has(rawKind) ? rawKind : 'other',
        state: asString(raw?.state, existing?.state || '', 420),
        pressure: asInteger(raw?.pressure, existing?.pressure ?? 1, 0, 3),
        trend: VALID_WORLD_PULSE_TRENDS.has(rawTrend) ? rawTrend : 'stable',
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        source: ['history', 'simulation', 'manual'].includes(raw?.source)
            ? raw.source
            : (existing?.source || 'simulation'),
        evidence: asString(
            raw?.evidence ?? raw?.reason,
            existing?.evidence || '',
            260,
        ),
        updatedAt: asInteger(
            raw?.updated_at ?? raw?.updatedAt,
            worldMinute,
            0,
        ),
    };
}

function normalizeWorldCoverageEntry(raw, worldMinute = 0) {
    const label = asString(raw?.label, '未命名范围', 120) || '未命名范围';
    const kind = asString(raw?.kind, 'general', 40) || 'general';
    const scope = asString(raw?.scope, '', 160);
    return {
        id: normalizeId(
            raw?.id || `coverage_${hashText(`${kind}:${label}:${scope}`)}`,
            'coverage',
        ),
        label,
        kind,
        scope,
        source: asString(raw?.source, 'world', 40) || 'world',
        lastCheckedAt: asInteger(
            raw?.last_checked_at ?? raw?.lastCheckedAt,
            -1,
            -1,
        ),
        checks: asInteger(raw?.checks, 0, 0, 999999),
    };
}

function normalizeWorldCoverage(raw, worldMinute = 0) {
    const entries = [];
    for (const candidate of asArray(raw?.entries).slice(0, LIMITS.worldCoverageEntries)) {
        const normalized = normalizeWorldCoverageEntry(candidate, worldMinute);
        const existing = entries.find(item => item.id === normalized.id);
        if (existing) Object.assign(existing, normalized);
        else entries.push(normalized);
    }
    return {
        lastSweepAt: asInteger(raw?.last_sweep_at ?? raw?.lastSweepAt, -1, -1),
        lastPublicSweepAt: asInteger(
            raw?.last_public_sweep_at ?? raw?.lastPublicSweepAt,
            -1,
            -1,
        ),
        lastFocusSignature: asString(
            raw?.last_focus_signature ?? raw?.lastFocusSignature,
            '',
            80,
        ),
        entries: entries
            .sort((a, b) => Number(b.lastCheckedAt || -1) - Number(a.lastCheckedAt || -1))
            .slice(0, LIMITS.worldCoverageEntries),
    };
}

function worldCoverageTarget(raw = {}, sourceRank = 9) {
    const label = asString(raw?.label, '', 120);
    if (!label) return null;
    const kind = asString(raw?.kind, 'general', 40) || 'general';
    const scope = asString(raw?.scope, '', 160);
    return {
        id: `coverage_${hashText(`${kind}:${label}:${scope}`)}`,
        label,
        kind,
        scope,
        source: asString(raw?.source, 'world', 40) || 'world',
        pressure: asInteger(raw?.pressure, 0, 0, 3),
        sourceRank,
    };
}

export function selectWorldCoverageTargets(state, {
    customInstruction = '',
    maximum = 2,
} = {}) {
    const candidates = new Map();
    const add = (raw, sourceRank) => {
        const candidate = worldCoverageTarget(raw, sourceRank);
        if (candidate && !candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
    };
    const customFocus = asString(customInstruction, '', 1000);
    if (customFocus) {
        add({
            label: customFocus,
            kind: 'custom-focus',
            scope: '用户指定的镜头外世界侧重点',
            source: 'custom',
            pressure: 3,
        }, 0);
    }
    for (const domain of asArray(state?.worldPulse?.domains)) {
        add({
            label: domain?.label,
            kind: domain?.kind || 'other',
            scope: domain?.scope,
            source: 'world-pulse',
            pressure: domain?.pressure,
        }, 1);
    }
    add({
        label: '世界背景中的普通公共生活',
        kind: 'general',
        scope: asString(state?.world?.name, '主世界', 80),
        source: 'world-background',
    }, 2);
    const locationLabels = [
        ...asArray(state?.worldFacts)
            .filter(fact => String(fact?.subjectType || '') === 'location')
            .map(fact => fact?.subject || fact?.subjectId),
        ...asArray(state?.storyMemory?.digest?.locations),
        ...asArray(state?.events).map(event => event?.place),
        ...asArray(state?.people).map(person => person?.location),
    ];
    for (const location of [...new Set(locationLabels.map(item => asString(item, '', 120)).filter(Boolean))]) {
        add({
            label: location,
            kind: 'location',
            scope: location,
            source: 'known-location',
        }, 3);
    }

    const coverage = normalizeWorldCoverage(state?.worldPulse?.coverage, state?.clock?.absoluteMinute || 0);
    const checkedById = new Map(coverage.entries.map(entry => [entry.id, entry]));
    return [...candidates.values()]
        .map(candidate => ({
            ...candidate,
            lastCheckedAt: checkedById.get(candidate.id)?.lastCheckedAt ?? -1,
            checks: checkedById.get(candidate.id)?.checks ?? 0,
        }))
        .sort((a, b) => (
            Number(a.lastCheckedAt) - Number(b.lastCheckedAt)
            || Number(a.sourceRank) - Number(b.sourceRank)
            || Number(b.pressure || 0) - Number(a.pressure || 0)
            || a.label.localeCompare(b.label, 'zh-CN')
        ))
        .slice(0, asInteger(maximum, 2, 1, 4))
        .map(({ sourceRank, pressure, ...target }) => target);
}

export function markWorldCoverageChecked(inputState, targets = [], {
    publicCycle = false,
    customInstruction = '',
} = {}) {
    const state = deepClone(inputState);
    state.worldPulse = normalizeWorldPulse(state.worldPulse, state.clock?.absoluteMinute || 0);
    const worldMinute = asInteger(state.clock?.absoluteMinute, 0, 0);
    const coverage = normalizeWorldCoverage(state.worldPulse.coverage, worldMinute);
    for (const rawTarget of asArray(targets)) {
        const target = normalizeWorldCoverageEntry(rawTarget, worldMinute);
        target.lastCheckedAt = worldMinute;
        const existing = coverage.entries.find(item => item.id === target.id);
        if (existing) Object.assign(existing, target, { checks: Number(existing.checks || 0) + 1 });
        else coverage.entries.push({ ...target, checks: 1 });
    }
    coverage.lastSweepAt = worldMinute;
    if (publicCycle) coverage.lastPublicSweepAt = worldMinute;
    coverage.lastFocusSignature = hashText(asString(customInstruction, '', 1000));
    coverage.entries = coverage.entries
        .sort((a, b) => Number(b.lastCheckedAt || -1) - Number(a.lastCheckedAt || -1))
        .slice(0, LIMITS.worldCoverageEntries);
    state.worldPulse.coverage = coverage;
    return state;
}

export function publicWorldCoverageDue(state, {
    customInstruction = '',
    minimumIntervalMinutes = 180,
} = {}) {
    const worldMinute = asInteger(state?.clock?.absoluteMinute, 0, 0);
    const coverage = normalizeWorldCoverage(state?.worldPulse?.coverage, worldMinute);
    const focusSignature = hashText(asString(customInstruction, '', 1000));
    if (coverage.lastSweepAt < 0) return true;
    if (focusSignature !== coverage.lastFocusSignature) return true;
    return worldMinute - coverage.lastSweepAt >= Math.max(
        1,
        asInteger(minimumIntervalMinutes, 180, 1),
    );
}

function normalizeWorldPulse(raw, worldMinute = 0) {
    const domains = [];
    for (const candidate of asArray(raw?.domains).slice(0, LIMITS.worldPulseDomains)) {
        const normalized = normalizeWorldPulseDomain(candidate, null, worldMinute);
        if (!normalized.state && !normalized.evidence) continue;
        const existing = domains.find(item => item.id === normalized.id || (
            item.kind === normalized.kind
            && item.label.toLocaleLowerCase() === normalized.label.toLocaleLowerCase()
        ));
        if (existing) Object.assign(existing, normalizeWorldPulseDomain(candidate, existing, worldMinute));
        else domains.push(normalized);
    }
    return {
        baselineEstablished: Boolean(raw?.baselineEstablished ?? raw?.baseline_established),
        lastSweepAt: asInteger(raw?.lastSweepAt ?? raw?.last_sweep_at, worldMinute, 0),
        coverage: normalizeWorldCoverage(raw?.coverage, worldMinute),
        domains: domains.slice(0, LIMITS.worldPulseDomains),
    };
}

function upsertWorldPulseDomain(state, raw, {
    worldMinute = state?.clock?.absoluteMinute || 0,
    source = '',
} = {}) {
    if (!raw || typeof raw !== 'object') return null;
    state.worldPulse = normalizeWorldPulse(state.worldPulse, worldMinute);
    const prepared = {
        ...raw,
        ...(source ? { source } : {}),
    };
    const candidate = normalizeWorldPulseDomain(prepared, null, worldMinute);
    const existing = state.worldPulse.domains.find(item => (
        item.id === candidate.id
        || (
            item.kind === candidate.kind
            && item.label.toLocaleLowerCase() === candidate.label.toLocaleLowerCase()
        )
    )) || null;
    const normalized = normalizeWorldPulseDomain(prepared, existing, worldMinute);
    if (!normalized.state && !normalized.evidence) return null;
    if (existing) Object.assign(existing, normalized);
    else state.worldPulse.domains.unshift(normalized);
    state.worldPulse.domains = state.worldPulse.domains
        .sort((a, b) => (
            Number(b.pressure || 0) - Number(a.pressure || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, LIMITS.worldPulseDomains);
    state.worldPulse.lastSweepAt = worldMinute;
    return normalized;
}


function normalizePublicImpactRecord(raw, worldMinute = 0) {
    return {
        id: normalizeId(
            raw?.id || `impact_${hashText(`${raw?.source_event_id ?? raw?.sourceEventId ?? ''}:${raw?.fingerprint || ''}`)}`,
            'impact',
        ),
        sourceEventId: asString(raw?.source_event_id ?? raw?.sourceEventId, '', 120),
        fingerprint: asString(raw?.fingerprint, '', 120),
        summary: asString(raw?.summary, '', 520),
        affectedPersonIds: uniqueStrings(
            raw?.affected_person_ids ?? raw?.affectedPersonIds,
            24,
        ),
        affectedScopes: uniqueStrings(
            raw?.affected_scopes ?? raw?.affectedScopes,
            24,
        ),
        channels: uniqueStrings(raw?.channels, 16),
        processedAt: asInteger(
            raw?.processed_at ?? raw?.processedAt,
            worldMinute,
            0,
        ),
        reason: asString(raw?.reason, '', 220),
    };
}

export function publicImpactFingerprint(event) {
    if (!event?.id) return '';
    // Public-impact propagation reacts to what entered public circulation, not to
    // backstage-only lifecycle state. A hidden resolved/cancelled transition must
    // not make society magically know the ending. If the terminal outcome becomes
    // public, publicResult/publicSummary changes and naturally creates a new fingerprint.
    const payload = {
        id: String(event.id || ''),
        publicity: String(event.publicity || 'private'),
        publicTrace: String(event.publicTrace || ''),
        publicHeadline: String(event.publicHeadline || ''),
        publicSummary: String(event.publicSummary || ''),
        publicResult: String(event.publicResult || ''),
    };
    return hashText(JSON.stringify(payload));
}

function eventHasPublicPropagation(event) {
    if (!event?.id) return false;
    if (event.publicity === 'public') {
        return Boolean(event.publicHeadline || event.publicSummary || event.publicResult || event.publicTrace);
    }
    if (event.publicity === 'trace') {
        return Boolean(event.publicTrace);
    }
    return false;
}

export function pendingPublicImpactEvents(state, { maximum = 8 } = {}) {
    const ledger = asArray(state?.publicImpactLedger);
    const processed = new Set(
        ledger.map(record => `${record?.sourceEventId || ''}:${record?.fingerprint || ''}`),
    );
    return asArray(state?.events)
        .filter(eventHasPublicPropagation)
        .filter(event => {
            const fingerprint = publicImpactFingerprint(event);
            return fingerprint && !processed.has(`${event.id}:${fingerprint}`);
        })
        .sort((a, b) => (
            Number(b.updatedAt || b.resolvedAt || 0)
            - Number(a.updatedAt || a.resolvedAt || 0)
        ))
        .slice(0, Math.max(1, Number(maximum) || 8));
}

function recordProcessedPublicImpacts(state, sourceEvents, rawRecords = [], {
    reason = 'public-impact',
} = {}) {
    const recordsBySource = new Map(
        asArray(rawRecords)
            .map(raw => normalizePublicImpactRecord(raw, state.clock?.absoluteMinute || 0))
            .filter(record => record.sourceEventId)
            .map(record => [record.sourceEventId, record]),
    );
    const next = asArray(state.publicImpactLedger)
        .map(record => normalizePublicImpactRecord(record, state.clock?.absoluteMinute || 0));

    for (const event of asArray(sourceEvents)) {
        if (!event?.id) continue;
        const fingerprint = publicImpactFingerprint(event);
        if (!fingerprint) continue;
        const modelRecord = recordsBySource.get(event.id);
        const record = normalizePublicImpactRecord({
            id: `impact_${hashText(`${event.id}:${fingerprint}`)}`,
            source_event_id: event.id,
            fingerprint,
            summary: modelRecord?.summary || '本轮已检查该公开事件的世界连锁影响。',
            affected_person_ids: modelRecord?.affectedPersonIds || [],
            affected_scopes: modelRecord?.affectedScopes || [],
            channels: modelRecord?.channels || [],
            processed_at: state.clock?.absoluteMinute || 0,
            reason,
        }, state.clock?.absoluteMinute || 0);

        const key = `${record.sourceEventId}:${record.fingerprint}`;
        const oldIndex = next.findIndex(item => (
            `${item.sourceEventId}:${item.fingerprint}` === key
        ));
        if (oldIndex >= 0) next[oldIndex] = record;
        else next.unshift(record);
    }

    state.publicImpactLedger = next
        .sort((a, b) => Number(b.processedAt || 0) - Number(a.processedAt || 0))
        .slice(0, LIMITS.publicImpactLedger);
}

export function markCurrentPublicImpactsProcessed(inputState, {
    reason = 'baseline',
} = {}) {
    const state = deepClone(inputState);
    recordProcessedPublicImpacts(
        state,
        asArray(state.events).filter(eventHasPublicPropagation),
        [],
        { reason },
    );
    return trimState(state);
}

export function buildPublicImpactPrompt(state, {
    sourceEventIds = [],
    userName = '',
    maximumEvents = 8,
    recordPlayerCharacter = true,
} = {}) {
    const wanted = new Set(asArray(sourceEventIds).map(String).filter(Boolean));
    const sourceEvents = (wanted.size
        ? asArray(state?.events).filter(event => wanted.has(String(event?.id || '')))
        : pendingPublicImpactEvents(state, { maximum: maximumEvents }))
        .filter(eventHasPublicPropagation)
        .slice(0, Math.max(1, Number(maximumEvents) || 8));

    const priorityPersonIds = uniqueStrings(
        asArray(state?.people)
            .filter(person => sourceEvents.some(event => {
                const actors = asArray(event?.actors).map(item => normalizedReference(item));
                const personId = normalizedReference(person?.id);
                const personName = normalizedReference(person?.name);
                const eventPlace = normalizedReference(event?.place);
                const personPlace = normalizedReference(person?.location);
                const actorMatched = actors.some(actor => (
                    actor && (actor === personId || actor === personName)
                ));
                const placeMatched = Boolean(
                    eventPlace
                    && personPlace
                    && (eventPlace.includes(personPlace) || personPlace.includes(eventPlace)),
                );
                return actorMatched || placeMatched;
            }))
            .map(person => person.id),
        24,
    );

    const compact = compactStateForModel(state, {
        includeUserInnerVoice: false,
        includeUserCharacter: recordPlayerCharacter,
        userName,
        maximumPeople: 24,
        priorityPersonIds,
    });
    const publicSources = sourceEvents.map(event => ({
        id: event.id,
        place: modelText(event.place, 120),
        status: event.status,
        publicity: event.publicity,
        public_trace: modelText(event.publicTrace, 260),
        public_headline: modelText(event.publicHeadline, 180),
        public_summary: modelText(event.publicSummary, 520),
        public_result: modelText(event.publicResult, 520),
        actors: asArray(event.actors).slice(0, 12),
    }));

    return [
        '你是“世界背面”的公共事件影响传播引擎。你的任务不是写新闻，而是判断已经进入公共传播的世界事件，会怎样真实改变这个世界。',
        '',
        '核心原则：事件可以完全不是为了主角发生，但主角和角色生活在这个世界里，所以只要职业、组织、地点、资源、关系、政策、市场或社会环境被波及，后果必须进入后台世界状态。',
        compact.world.background
            ? `世界背景设定（基础约束，不可改写）：${compact.world.background}`
            : '世界背景设定：未额外填写。',
        '1. 只根据 source_public_events、世界背景设定与当前权威世界状态推导后果。新闻措辞不是新的事实来源；不得从新闻标题脑补未公开的幕后原因。',
        '2. publicity=public 表示公开事实；publicity=trace 只表示公开流传的迹象/传闻。trace 可以造成“传闻正在流传、品牌观望、公众讨论升温”等真实社会后果，但绝不能把传闻内容本身升级成已证实事实。',
        '3. 影响可以落到人物、组织/势力、地点、行业、资源、机会、合同、行程、声誉、价格、政策执行、基础设施和社会压力。该变的人物状态就 people_upsert；该留下的客观结果写 world_facts_upsert；持续压力写 world_pulse_upsert；需要继续发展的后果写 events_create/update。world_facts_upsert 必须填写 validity：current / upcoming / historical / persistent。源新闻已经结束，不代表它造成的后果也结束；仍然有效的后果用 current/persistent。',
        '4. 新建的后果事件必须 caused_by 包含源公共事件 id，避免因果链断掉。source_public_events 本身是本轮已确认输入，不要在 events_update 里改写它们；需要的新进展另建后果事件。不要为了“有影响”硬制造戏剧性后果；无直接影响完全允许。',
        '5. 对非玩家角色：只有当她本轮确实通过公开渠道/职业渠道/组织通知等接触到信息时，才在 people_upsert 写 knowledge_updates；禁止直接写 known_event_ids / known_fact_keys。public_channel 必须写清 evidence 和 source_event_id；其他镜头外 confirmed 获知也必须有 source_event_id 指向明确的通知/目击/调查过程事件，不能因为新闻公开或人物被波及就默认她自动知道。',
        recordPlayerCharacter
            ? '6. 对玩家：绝不能因为“新闻公开”就自动假定玩家已经看到了。若公共事件会直接影响玩家，但玩家当前未必知道，优先建立一个可被正文自然承接的后果事件（例如经纪人通知、行程变更、公司群消息、道路封闭导致到场受阻），并用 delivery_route/visibility 描述它如何进入前台；不要替玩家决定反应。'
            : '6. 玩家角色当前设置为“不记录”。公共事件仍可客观影响玩家所在地点、资源、行程或关系，但禁止通过 people_upsert 建立/更新玩家人物卡；需要显露的影响用事件、世界事实或 delivery_route 进入前台，不替玩家决定反应。',
        '7. 如果公共事件已经在物理层面直接影响当前地点/行程，例如停电、封路、航班取消，可以把这些后果写成世界事实；“角色知道这件新闻”仍然是另一层认知。',
        '8. 影响传播不是每条新闻都必须撞主角。先判断世界范围，再判断当前人物与之有没有真实连接。娱乐圈、政商、战争、灾害等题材里，行业/组织级新闻往往会自然波及大量角色；日常地方新闻则可能只影响局部。',
        '8A. compact people 已优先带入源事件参与者和当前位于受影响地点的人物。必须逐个检查她们是否会被客观环境直接影响，以及是否真的有新闻、公告、职业通知、社交传播或现场感知渠道；有渠道就更新认知/行动，没有渠道就只保留客观世界影响，不能全员自动知晓。',
        '8B. 对每个拟更新人物明确校验至少一条接触链：physical=确实位于受影响地点/行程/设施；information=新闻、公告、职业通知、消息或可信转述实际送达；causal=组织、工作、合同、资源、关系或共同事件被上游变化真实牵动。链路断裂时不得更新该人物，也不得为了让新闻“有用”临时补造巧合。',
        '8C. 同一公共变化影响多人时，先形成一份共享的地点/组织/行业/事件后果，再分别结算人物反应。需要共同行动时只创建或更新一条 actors 完整的事件，并让所有实际参与者的 people_upsert 与知识状态互相对得上；预算不足以安全更新全部参与者时，不得宣称互动已经完成。',
        '8D. 社会评价只有在行为或后果通过目击、物证、公告、媒体或有效传闻进入相应圈层后才能变化。官方、民间、行业、组织内部可以关注不同侧面并形成不同判断；圈层舆论是社会状态，不是世界真相，不能反向证明传闻内容。',
        '9. 不推进主世界时间，elapsed_minutes 必须为 0；不写长期记忆 memory_update。这里只结算公共传播造成的世界后果。',
        '10. 只输出合法 JSON。',
        '',
        '当前权威世界：',
        JSON.stringify(compact),
        '',
        '本轮公共事件：',
        JSON.stringify(publicSources),
        '',
        '返回结构：',
        JSON.stringify({
            elapsed_minutes: 0,
            time_reason: 'public impact propagation',
            clock_anchor: { mode: 'none' },
            world: { title: '', detail: '' },
            people_upsert: [{
                id: '',
                name: '',
                location: '',
                action: '',
                intent: '',
                long_term_goal: '',
                physical_state: '',
                emotional_state: '',
                resource_state: '',
                knowledge_updates: [{
                    kind: 'event | fact',
                    ref: '事件ID / 事实key',
                    route: 'public_channel | message | told | investigated | witnessed | inferred',
                    certainty: 'confirmed | suspected',
                    evidence: '该角色实际接触到这条公开信息/通知的依据',
                    belief: '角色实际知道或相信的版本',
                    source_event_id: '公开来源事件ID',
                }],
                relevance: 1,
                source: 'background',
            }],
            people_remove: [],
            events_create: [{
                id: '',
                title: '',
                place: '',
                summary: '',
                consequence: '',
                expected_result: '',
                status: 'active | waiting | ready',
                clock_mode: 'condition | duration | scheduled | active',
                duration_minutes: 0,
                scheduled_at: null,
                prerequisites: [],
                cause: '',
                actors: [],
                caused_by: ['源公共事件ID'],
                publicity: 'private | trace | public',
                public_trace: '',
                public_headline: '',
                public_summary: '',
                public_result: '',
                visibility: 'hidden | trace | known | direct',
                delivery_route: '',
            }],
            events_update: [],
            deliveries_confirmed: [],
            front_facts: [],
            world_facts_upsert: [{
                key: '',
                subject_type: 'person | event | world | location | item | organization | other',
                subject_id: '',
                subject: '',
                field: '',
                value: '',
                source: 'simulation',
                visibility: 'hidden | trace | known | direct',
                confidence: 'high',
                validity: 'current | upcoming | historical | persistent',
                event_id: '',
            }],
            world_pulse_upsert: [{
                id: '',
                label: '',
                scope: '',
                kind: 'environment | government | economy | organization | infrastructure | security | culture | media | community | other',
                state: '',
                pressure: 1,
                trend: 'stable | rising | falling | volatile',
                visibility: 'hidden | trace | known',
                source: 'simulation',
                evidence: '',
            }],
            consistency_conflicts: [],
            impact_records: [{
                source_event_id: '源公共事件ID',
                summary: '这件公开事件实际造成了什么世界连锁影响；若暂无影响也明确写无直接影响',
                affected_person_ids: [],
                affected_scopes: [],
                channels: [],
            }],
            memory_update: {
                facts_upsert: [],
                facts_invalidate: [],
                clues_upsert: [],
                clues_resolve: [],
            },
        }),
    ].join('\n');
}

export function applyPublicImpactResult(inputState, rawPayload, {
    sourceEventIds = [],
    userName = '',
    sourceKey = '',
    backgroundNpcBudget = LIMITS.peopleTaskBudget,
    recordPlayerCharacter = true,
} = {}) {
    const sourceEvents = asArray(inputState?.events)
        .filter(event => asArray(sourceEventIds).includes(event?.id))
        .filter(eventHasPublicPropagation);
    let state = applySimulationResult(inputState, {
        ...rawPayload,
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
        sourceKey: sourceKey || `public-impact:${sourceEventIds.join(',')}`,
        userName,
        allowUserInnerVoice: false,
        recordPlayerCharacter,
        timePolicy: 'world',
        narrativeText: '',
        backgroundNpcBudget,
        preserveCommitAnchor: true,
    });

    recordProcessedPublicImpacts(
        state,
        sourceEvents,
        rawPayload?.impact_records ?? rawPayload?.impactRecords ?? [],
        { reason: 'public-impact-propagation' },
    );
    appendAudit(state, {
        type: 'public_impact_propagated',
        text: `已检查 ${sourceEvents.length} 条公共事件的连锁影响`,
        reason: asArray(rawPayload?.impact_records ?? rawPayload?.impactRecords)
            .map(item => asString(item?.summary, '', 160))
            .filter(Boolean)
            .slice(0, 3)
            .join('；'),
    });
    return trimState(state);
}


function contextMatchScore(text, terms = []) {
    let score = 0;
    const source = String(text || '').toLocaleLowerCase();
    for (const raw of terms) {
        const term = String(raw || '').trim().toLocaleLowerCase();
        if (term.length < 2) continue;
        if (source.includes(term)) {
            score += Math.min(140, 80 + term.length * 4);
            continue;
        }
        // Useful for longer location / organization names where the story may use
        // a shortened form, without fuzzy-matching generic one-character words.
        if (term.length >= 4) {
            const chunks = term
                .split(/[\s·・,，。、“”"'（）()\-_/]+/u)
                .map(item => item.trim())
                .filter(item => item.length >= 2);
            if (chunks.some(chunk => source.includes(chunk))) score += 35;
        }
    }
    return score;
}

function textSuggestsFuturePlan(text = '') {
    return /(?:待会|等会|稍后|之后|过会|下午|今晚|明天|后天|下周|周末|过几天|晚些时候|一会儿|准备去|打算去|计划去|要去)/u
        .test(String(text || ''));
}

function textExplicitlyReferencesHistoricalEvent(text = '', event = null) {
    const source = String(text || '').toLocaleLowerCase();
    if (!source || !event) return false;
    const exactTerms = [
        event.title,
        event.publicHeadline,
        event.publicResult,
    ]
        .map(value => String(value || '').trim().toLocaleLowerCase())
        .filter(value => value.length >= 3);
    return exactTerms.some(term => source.includes(term));
}

export function selectContextRelevantReality(state, recentText = '', maximum = 8) {
    const text = asString(recentText, '', 6000);
    if (!text.trim()) return [];
    const now = Number(state?.clock?.absoluteMinute || 0);
    const futurePlan = textSuggestsFuturePlan(text);
    const eventsById = new Map(asArray(state?.events).map(event => [event.id, event]));
    const candidates = [];

    for (const event of asArray(state?.events)) {
        if (
            event?.publicity !== 'public'
            || (!event.publicSummary && !event.publicHeadline && !event.publicTrace && !event.publicResult)
        ) continue;

        const temporalState = eventTemporalState(event, now);
        if (temporalState === 'historical') continue;
        if (temporalState === 'upcoming' && !futurePlan) continue;

        const score = contextMatchScore(text, [
            event.place,
            event.title,
            event.publicHeadline,
            ...(event.actors || []),
        ]);
        if (score <= 0) continue;

        candidates.push({
            id: `event:${event.id}`,
            kind: 'public-event',
            temporalState,
            label: event.place || event.title || '公开世界事件',
            state: event.publicSummary || event.publicHeadline || event.publicTrace,
            publicity: 'public',
            eventId: event.id,
            score: score
                + (temporalState === 'current' ? 55 : 15)
                + Number(event.updatedAt || 0) / 1_000_000,
        });
    }

    for (const domain of asArray(state?.worldPulse?.domains)) {
        const score = contextMatchScore(text, [
            domain.scope,
            domain.label,
            domain.state,
        ]);
        if (score <= 0) continue;
        candidates.push({
            id: `pulse:${domain.id}`,
            kind: 'world-pulse',
            temporalState: 'current',
            label: domain.scope || domain.label || '世界环境',
            state: domain.state,
            publicity: domain.visibility === 'known' ? 'public' : 'world',
            eventId: '',
            score: score + 30 + Number(domain.pressure || 0) * 5,
        });
    }

    for (const fact of asArray(state?.worldFacts)) {
        if (fact?.confidence !== 'high') continue;
        // Person location/action/body/resource facts already have their own
        // authoritative character-state injection. The situational bridge is for
        // the surrounding world (place / organization / item / policy / consequence),
        // not a second copy of the person card.
        if (fact?.subjectType === 'person') continue;
        const event = fact.eventId ? eventsById.get(fact.eventId) : null;
        const factValidity = VALID_WORLD_FACT_VALIDITY.has(fact.validity)
            ? fact.validity
            : (event ? eventTemporalState(event, now) : 'current');
        const temporalState = factValidity === 'persistent' ? 'current' : factValidity;

        if (fact.eventId && String(fact.key || '').startsWith('public_event:')) continue;
        if (
            temporalState === 'historical'
            && !(event && textExplicitlyReferencesHistoricalEvent(text, event))
        ) continue;
        if (temporalState === 'upcoming' && !futurePlan) continue;

        const score = contextMatchScore(text, [
            fact.subject,
            fact.subjectId,
            fact.field,
            fact.value,
            event?.title,
            event?.publicHeadline,
        ]);
        if (score <= 0) continue;

        candidates.push({
            id: `fact:${fact.key}`,
            kind: 'world-fact',
            temporalState,
            label: fact.subject || fact.subjectId || '世界',
            state: `${fact.field}：${fact.value}`,
            publicity: fact.visibility === 'known' || fact.visibility === 'direct'
                ? 'public-or-known'
                : 'world',
            eventId: fact.eventId || '',
            score: score
                + (temporalState === 'current' ? 30 : temporalState === 'upcoming' ? 5 : -35)
                + Number(fact.updatedAt || 0) / 1_000_000,
        });
    }

    const seenKeys = new Set();
    const seenEventIds = new Set();
    return candidates
        .sort((a, b) => b.score - a.score)
        .filter(item => {
            if (item.eventId) {
                if (seenEventIds.has(item.eventId)) return false;
                seenEventIds.add(item.eventId);
            }
            const key = `${item.label}\u0000${item.state}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        })
        .slice(0, Math.max(0, Number(maximum) || 0));
}

function selectRelevantWorldFacts(state, recentText = '', maximum = 12) {
    const text = String(recentText || '').toLocaleLowerCase();
    const eventsById = new Map(asArray(state?.events).map(event => [event.id, event]));
    return asArray(state?.worldFacts)
        .filter(fact => {
            if (String(fact?.key || '').startsWith('public_event:')) return false;
            const event = fact?.eventId ? eventsById.get(fact.eventId) : null;
            const validity = VALID_WORLD_FACT_VALIDITY.has(fact?.validity)
                ? fact.validity
                : 'current';
            if (
                validity === 'historical'
                && !(event && textExplicitlyReferencesHistoricalEvent(text, event))
            ) return false;
            if (validity === 'upcoming' && !textSuggestsFuturePlan(text)) return false;
            return true;
        })
        .map(fact => {
            const terms = [fact.subject, fact.subjectId, fact.field, fact.value]
                .filter(Boolean)
                .map(value => String(value).toLocaleLowerCase());
            let score = Number(fact.updatedAt || fact.settledAt || 0) / 1_000_000;
            if (terms.some(term => term.length >= 2 && text.includes(term))) score += 120;
            if (fact.source === 'narrative') score += 25;
            if (fact.source === 'event-settlement') score += 20;
            if (fact.confidence === 'high') score += 8;
            return { fact, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, maximum))
        .map(item => item.fact);
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
            background: '',
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
            anchored: false,
            precision: 'day',
            daypart: '',
        },
        people: [],
        events: [],
        echoes: [],
        archive: [],
        foregroundFacts: [],
        worldFacts: [],
        worldPulse: {
            baselineEstablished: false,
            lastSweepAt: absoluteMinute,
            coverage: normalizeWorldCoverage(null, absoluteMinute),
            domains: [],
        },
        publicImpactLedger: [],
        consistencyConflicts: [],
        needsReconciliation: false,
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
            metabolismLog: [],
            lastMetabolismMessageId: -1,
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
    const summary = asString(raw?.summary, existing?.summary || '', 1800);
    const level = asInteger(
        raw?.level ?? raw?.memory_level ?? raw?.memoryLevel,
        existing?.level ?? MEMORY_SUMMARY_LEVELS.STAGE,
        MEMORY_SUMMARY_LEVELS.DETAIL,
        MEMORY_SUMMARY_LEVELS.LONG_TERM,
    );
    return {
        id: normalizeId(
            raw?.id || existing?.id || `summary_${startMessageId}_${endMessageId}`,
            'summary',
        ),
        title: asString(raw?.title, existing?.title || `第 ${startMessageId}—${endMessageId} 层`, 120),
        summary,
        level,
        hierarchyManaged: Boolean(
            raw?.hierarchy_managed
            ?? raw?.hierarchyManaged
            ?? existing?.hierarchyManaged
            ?? false
        ),
        parentId: asString(
            raw?.parent_id ?? raw?.parentId,
            existing?.parentId || '',
            120,
        ),
        sourceSummaryIds: uniqueStrings(
            raw?.source_summary_ids ?? raw?.sourceSummaryIds ?? existing?.sourceSummaryIds,
            24,
        ),
        startMessageId,
        endMessageId,
        people: uniqueStrings(raw?.people ?? existing?.people, 20),
        locations: uniqueStrings(raw?.locations ?? existing?.locations, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        retentionState: ['active', 'compacted'].includes(raw?.retention_state ?? raw?.retentionState)
            ? (raw?.retention_state ?? raw?.retentionState)
            : (existing?.retentionState || 'active'),
        compactedReason: asString(
            raw?.compacted_reason ?? raw?.compactedReason,
            existing?.compactedReason || '',
            260,
        ),
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
        events: uniqueStrings(raw?.events ?? existing?.events, 16),
        tags: uniqueStrings(raw?.tags ?? existing?.tags, 20),
        archived: Boolean(raw?.archived ?? existing?.archived),
        archivedAt: raw?.archived_at ?? raw?.archivedAt
            ?? existing?.archivedAt
            ?? null,
        locked: Boolean(raw?.locked ?? existing?.locked),
        important: Boolean(raw?.important ?? existing?.important),
        manual: Boolean(raw?.manual ?? existing?.manual),
        status: VALID_CLUE_STATES.has(requestedStatus) ? requestedStatus : 'open',
        importance: asInteger(raw?.importance, existing?.importance ?? 1, 1, 3),
        visibility: normalizeVisibility(raw?.visibility ?? existing?.visibility ?? 'hidden'),
        resolution: asString(raw?.resolution, existing?.resolution || '', 520),
        lifecycleReason: asString(
            raw?.lifecycle_reason ?? raw?.lifecycleReason,
            existing?.lifecycleReason || '',
            360,
        ),
        resolvedMessageId: raw?.resolved_message_id ?? raw?.resolvedMessageId
            ?? existing?.resolvedMessageId
            ?? null,
        timing: normalizeClueTiming(
            raw?.timing ?? existing?.timing,
            worldMinute,
        ),
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

function retainMemoryFacts(items) {
    const normalized = asArray(items);
    const protectedItems = normalized.filter(item => (
        item?.locked
        || item?.important
        || item?.manual
        || Number(item?.importance || 0) >= 3
        || item?.status === 'disputed'
    ));
    const protectedIds = new Set(protectedItems.map(item => item.id));
    const remainder = normalized
        .filter(item => !protectedIds.has(item.id))
        .sort((a, b) => {
            const statusWeight = value => ({ active: 4, disputed: 3, superseded: 1, invalidated: 0 }[value] ?? 0);
            const confidenceWeight = value => ({ high: 3, medium: 2, low: 0 }[value] ?? 1);
            return (
                statusWeight(b.status) - statusWeight(a.status)
                || Number(b.importance || 0) - Number(a.importance || 0)
                || confidenceWeight(b.confidence) - confidenceWeight(a.confidence)
                || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
            );
        })
        .slice(0, LIMITS.memoryFacts);
    return [...protectedItems, ...remainder]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function retainStorySummaries(items) {
    const chronological = asArray(items)
        .sort((a, b) => Number(a.endMessageId || 0) - Number(b.endMessageId || 0));
    if (!chronological.length) return chronological;

    // Memory is allowed to forget low-value detail after it has been safely rolled
    // into a higher layer.  We keep the recent detail window, the story opening,
    // manually protected items and all chapter/long-term summaries.  Older compacted
    // L0/L1 nodes may leave the active store; their parent summaries still retain the
    // covered message range, so the original chat remains traceable without keeping
    // every intermediate summary forever.
    const latestMessageId = Number(chronological.at(-1)?.endMessageId || 0);
    const recentFloor = Math.max(0, latestMessageId - 480);
    const protectedIds = new Set();
    const protect = item => {
        if (item?.id) protectedIds.add(item.id);
    };

    for (const item of chronological) {
        const level = Number(item?.level || 0);
        const recent = Number(item?.endMessageId || 0) >= recentFloor;
        const activeUnrolled = !item?.parentId && item?.retentionState !== 'compacted';
        if (
            item?.locked
            || item?.important
            || item?.manual
            || level >= MEMORY_SUMMARY_LEVELS.CHAPTER
            || activeUnrolled
            || recent
        ) {
            protect(item);
        }
    }
    // A tiny amount of opening detail is intentionally kept as a durable story anchor.
    chronological.slice(0, 12).forEach(protect);

    const keep = new Map();
    for (const item of chronological) {
        if (protectedIds.has(item.id)) keep.set(item.id, item);
    }

    // Fill any remaining room with the newest useful summaries, but compacted old
    // details lose to active/higher-level memory.  This makes LIMITS.storySummaries a
    // real upper bound in ordinary cases instead of a pool that can grow forever.
    const candidates = chronological
        .filter(item => !keep.has(item.id) && item?.retentionState !== 'compacted')
        .sort((a, b) => (
            Number(b.level || 0) - Number(a.level || 0)
            || Number(b.endMessageId || 0) - Number(a.endMessageId || 0)
        ));
    for (const item of candidates) {
        if (keep.size >= LIMITS.storySummaries) break;
        keep.set(item.id, item);
    }

    return [...keep.values()]
        .sort((a, b) => Number(a.endMessageId || 0) - Number(b.endMessageId || 0));
}

function retainClues(items) {
    const normalized = asArray(items);
    const protectedItems = normalized.filter(item => (
        item?.locked
        || item?.important
        || item?.manual
        || ['open', 'developing', 'echoed', 'triggered'].includes(item?.status)
    ));
    const protectedIds = new Set(protectedItems.map(item => item.id));
    const remainder = normalized
        .filter(item => !protectedIds.has(item.id))
        .sort((a, b) => (
            Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, LIMITS.clues);
    return [...protectedItems, ...remainder]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
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
        // Storage capacity and per-turn recall are intentionally separate.
        // Keep locked/important/open anchors even when the soft pool is full;
        // selectRelevantStoryMemory still injects only a small relevant subset.
        facts: retainMemoryFacts([...factMap.values()]),
        summaries: retainStorySummaries(summaries),
        clues: retainClues([...clueMap.values()]),
        metabolismLog: asArray(raw?.metabolismLog ?? raw?.metabolism_log)
            .slice(-LIMITS.metabolismLog)
            .map(item => ({
                id: asString(item?.id, makeId('metabolism'), 100),
                kind: asString(item?.kind, 'memory', 30),
                action: asString(item?.action, 'updated', 30),
                targetId: asString(item?.targetId ?? item?.target_id, '', 120),
                replacementId: asString(item?.replacementId ?? item?.replacement_id, '', 120),
                reason: asString(item?.reason, '', 360),
                sourceMessageId: asInteger(item?.sourceMessageId ?? item?.source_message_id, 0, 0),
                worldMinute: asInteger(item?.worldMinute ?? item?.world_minute, worldMinute, 0),
                createdAt: asString(item?.createdAt ?? item?.created_at, nowIso(), 40),
            })),
        lastMetabolismMessageId: asInteger(
            raw?.lastMetabolismMessageId ?? raw?.last_metabolism_message_id,
            -1,
            -1,
        ),
    };
}

function normalizeFactBeliefs(value, fallback = []) {
    const byKey = new Map();
    for (const raw of [...asArray(fallback), ...asArray(value)]) {
        const key = asString(raw?.key, '', 180);
        const valueText = asString(raw?.value, '', 520);
        if (!key || !valueText) continue;
        const route = asString(raw?.route, '', 40);
        const certaintyRaw = asString(raw?.certainty, '', 20);
        byKey.set(key, {
            key,
            value: valueText,
            factId: asString(raw?.fact_id ?? raw?.factId, '', 120),
            certainty: VALID_KNOWLEDGE_CERTAINTY.has(certaintyRaw)
                ? certaintyRaw
                : 'confirmed',
            route: VALID_KNOWLEDGE_ROUTES.has(route) ? route : '',
            evidence: asString(raw?.evidence, '', 360),
            learnedAtMessageId: asInteger(raw?.learned_at_message_id ?? raw?.learnedAtMessageId, 0, 0),
            updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, 0, 0),
        });
    }
    return [...byKey.values()].slice(-LIMITS.cognitiveRefs);
}


function normalizeKnownEventViews(value, fallback = []) {
    const byEvent = new Map();
    for (const raw of [...asArray(fallback), ...asArray(value)]) {
        const eventId = asString(raw?.event_id ?? raw?.eventId ?? raw?.id, '', 120);
        const summary = asString(raw?.summary ?? raw?.view ?? raw?.belief, '', 520);
        if (!eventId || !summary) continue;
        const route = asString(raw?.route, '', 40);
        const certaintyRaw = asString(raw?.certainty, '', 20);
        byEvent.set(eventId, {
            eventId,
            summary,
            certainty: VALID_KNOWLEDGE_CERTAINTY.has(certaintyRaw)
                ? certaintyRaw
                : 'confirmed',
            route: VALID_KNOWLEDGE_ROUTES.has(route) ? route : '',
            evidence: asString(raw?.evidence, '', 360),
            learnedAtMessageId: asInteger(
                raw?.learned_at_message_id ?? raw?.learnedAtMessageId,
                0,
                0,
            ),
            updatedAt: asInteger(raw?.updated_at ?? raw?.updatedAt, 0, 0),
        });
    }
    return [...byEvent.values()].slice(-LIMITS.cognitiveRefs);
}

function normalizeKnowledgeAcquisitions(value, messageId = 0) {
    return asArray(value)
        .map(raw => {
            const kind = asString(raw?.kind, '', 20).toLowerCase();
            const ref = asString(
                raw?.ref ?? raw?.ref_id ?? raw?.refId ?? raw?.key ?? raw?.event_id ?? raw?.eventId ?? raw?.clue_id ?? raw?.clueId,
                '',
                180,
            );
            const route = asString(raw?.route, '', 40).toLowerCase();
            const certaintyRaw = asString(raw?.certainty, '', 20).toLowerCase();
            const certainty = route === 'inferred'
                ? 'suspected'
                : (VALID_KNOWLEDGE_CERTAINTY.has(certaintyRaw) ? certaintyRaw : 'confirmed');
            if (!['event', 'fact', 'clue'].includes(kind)) return null;
            if (!ref || !VALID_KNOWLEDGE_ROUTES.has(route)) return null;
            const evidence = asString(raw?.evidence, '', 360);
            if (!evidence) return null;
            return {
                kind,
                ref,
                route,
                certainty,
                evidence,
                belief: asString(raw?.belief ?? raw?.view ?? raw?.summary, '', 520),
                sourceEventId: asString(raw?.source_event_id ?? raw?.sourceEventId, '', 120),
                learnedAtMessageId: asInteger(
                    raw?.learned_at_message_id ?? raw?.learnedAtMessageId,
                    messageId,
                    0,
                ),
            };
        })
        .filter(Boolean)
        .slice(0, LIMITS.cognitiveRefs);
}

function activeFactByKey(state, key) {
    const normalized = asString(key, '', 180);
    if (!normalized) return null;
    return asArray(state?.storyMemory?.facts)
        .filter(fact => fact.key === normalized && ['active', 'disputed'].includes(fact.status))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
}

function setFactBelief(person, fact, messageId = 0, {
    value = fact?.value,
    certainty = 'confirmed',
    route = '',
    evidence = '',
} = {}) {
    if (!person || !fact?.key || !value) return;
    const beliefs = normalizeFactBeliefs(person.knownFactBeliefs);
    const next = {
        key: fact.key,
        value: asString(value, fact.value, 520),
        factId: fact.id || '',
        certainty: VALID_KNOWLEDGE_CERTAINTY.has(certainty) ? certainty : 'confirmed',
        route: VALID_KNOWLEDGE_ROUTES.has(route) ? route : '',
        evidence: asString(evidence, '', 360),
        learnedAtMessageId: asInteger(messageId, 0, 0),
        updatedAt: asInteger(fact.updatedAt, 0, 0),
    };
    const index = beliefs.findIndex(item => item.key === next.key);
    if (index >= 0) beliefs[index] = next;
    else beliefs.push(next);
    person.knownFactBeliefs = beliefs.slice(-LIMITS.cognitiveRefs);
}

function freezeKnownFactBeforeChange(state, fact) {
    if (!fact?.key || !fact?.value) return;
    for (const person of asArray(state?.people)) {
        const knowsKey = asArray(person?.knownFactKeys).some(key => (
            normalizedReference(key) === normalizedReference(fact.key)
        ));
        if (!knowsKey) continue;
        const hasSnapshot = asArray(person?.knownFactBeliefs).some(item => (
            normalizedReference(item?.key) === normalizedReference(fact.key)
        ));
        if (!hasSnapshot) setFactBelief(person, fact, person?.lastSeenMessageId || fact.sourceMessageId || 0);
    }
}

function isUserPersonLike(person, userName = '') {
    const normalizedUserName = asString(userName, '', 80).toLocaleLowerCase();
    const name = asString(person?.name, '', 80).toLocaleLowerCase();
    return Boolean(
        person?.isUser
        || person?.is_user
        || person?.role === 'user'
        || (normalizedUserName && name && normalizedUserName === name)
    );
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
    const identityAnchor = asString(
        existing
            ? existing.identityAnchor
            : (raw?.identity_anchor ?? raw?.identityAnchor),
        '',
        LIMITS.identityAnchor,
    );
    const personalityAnchor = asString(
        existing
            ? existing.personalityAnchor
            : (raw?.personality_anchor ?? raw?.personalityAnchor),
        '',
        LIMITS.personalityAnchor,
    );
    const appearanceProfile = asString(
        existing
            ? existing.appearanceProfile
            : (raw?.appearance_profile ?? raw?.appearanceProfile),
        '',
        LIMITS.appearanceProfile,
    );
    const backgroundProfile = asString(
        existing
            ? existing.backgroundProfile
            : (raw?.background_profile ?? raw?.backgroundProfile),
        '',
        LIMITS.backgroundProfile,
    );
    const worldbookRaw = asString(
        existing
            ? existing.worldbookRaw
            : (raw?.worldbook_raw ?? raw?.worldbookRaw),
        '',
        LIMITS.worldbookRaw,
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
    const isUser = Boolean(
        isUserPersonLike(raw, userName)
        || isUserPersonLike(existing, userName)
    );
    const storedInnerVoice = isUser && !allowUserInnerVoice
        ? ''
        : asString(existing?.innerVoice, '', LIMITS.innerVoice);

    return {
        id: normalizeId(raw?.id || existing?.id || name, 'person'),
        name,
        isUser,
        monogram: asString(raw?.monogram, existing?.monogram || name.slice(0, 1), 4),
        // 头像是纯 UI 资源，不进入模型上下文。已有头像优先，避免后台推演误改。
        avatarDataUrl: asString(
            existing?.avatarDataUrl ?? raw?.avatar_data_url ?? raw?.avatarDataUrl,
            '',
            LIMITS.personAvatarData,
        ),
        location: asString(raw?.location, existing?.location || '位置待确认', 160),
        action: asString(raw?.action, existing?.action || '当前行动待确认', 280),
        intent: asString(raw?.intent, existing?.intent || '短期意图待确认', 320),
        longTermGoal: longTermGoal || asString(existing?.longTermGoal, '', LIMITS.longTermGoal),
        identityAnchor,
        personalityAnchor,
        appearanceProfile,
        backgroundProfile,
        worldbookRaw,
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
            : asInteger(existing?.innerVoiceAt, worldMinute, 0),
        knowledge: normalizeKnowledge(raw?.knowledge ?? existing?.knowledge),
        cognitionReady: Boolean(
            raw?.cognition_ready
            ?? raw?.cognitionReady
            ?? existing?.cognitionReady
            ?? false,
        ),
        // Direct model writes to known_* are deliberately ignored.
        // New cognition must pass through validated knowledge_updates.
        knownEventIds: uniqueStrings(existing?.knownEventIds, LIMITS.cognitiveRefs),
        knownEventViews: normalizeKnownEventViews(existing?.knownEventViews),
        knownFactKeys: uniqueStrings(existing?.knownFactKeys, LIMITS.cognitiveRefs),
        knownFactBeliefs: normalizeFactBeliefs(existing?.knownFactBeliefs),
        knownClueIds: uniqueStrings(existing?.knownClueIds, LIMITS.cognitiveRefs),
        physicalState: asString(
            raw?.physical_state ?? raw?.physicalState ?? existing?.physicalState,
            '',
            LIMITS.personState,
        ),
        emotionalState: asString(
            raw?.emotional_state ?? raw?.emotionalState ?? existing?.emotionalState,
            '',
            LIMITS.personState,
        ),
        resourceState: asString(
            raw?.resource_state ?? raw?.resourceState ?? existing?.resourceState,
            '',
            LIMITS.personState,
        ),
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
        lastLifeTickAt: asInteger(
            raw?.last_life_tick_at
            ?? raw?.lastLifeTickAt
            ?? existing?.lastLifeTickAt
            ?? existing?.updatedAt,
            worldMinute,
            0,
        ),
        // 用户可以把某个后台人物明确排到“下一轮优先”。这是调度标记，
        // 不是世界事实，也不会进入人物设定；成功完成该人物的生活结算后会自动清掉。
        lifeTickPriority: Boolean(
            raw?.life_tick_priority
            ?? raw?.lifeTickPriority
            ?? existing?.lifeTickPriority
            ?? false,
        ),
        lifeTickPriorityAt: asInteger(
            raw?.life_tick_priority_at
            ?? raw?.lifeTickPriorityAt
            ?? existing?.lifeTickPriorityAt,
            0,
            0,
        ),
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
    const publicity = normalizeEventPublicity(
        raw?.publicity ?? raw?.public_scope ?? raw?.publicScope,
        inferLegacyEventPublicity(raw, existing),
    );
    const oldDelivery = existing?.delivery || {};
    const requestedDeliveryState = asString(raw?.delivery_state, oldDelivery.state || '', 30);
    const defaultDeliveryState = TERMINAL_EVENT_STATES.has(status) && visibility !== 'hidden'
        ? 'pending'
        : 'none';
    const deliveryState = ['none', 'pending', 'delivered', 'expired'].includes(requestedDeliveryState)
        ? requestedDeliveryState
        : (oldDelivery.state || defaultDeliveryState);

    return {
        // Event identity is immutable once the event already exists. Model output may
        // accidentally return an events_create item with a fresh id for the same
        // ongoing event; when we merge into an existing record, never let that new
        // id replace the canonical one.
        id: normalizeId(existing?.id || raw?.id, 'event'),
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
        cause: asString(
            raw?.cause ?? existing?.cause,
            '',
            LIMITS.eventCause,
        ),
        actors: mergeUniqueStrings(existing?.actors, raw?.actors, 16),
        knownBy: mergeUniqueStrings(
            existing?.knownBy,
            raw?.known_by ?? raw?.knownBy,
            LIMITS.cognitiveRefs,
        ),
        causedBy: mergeUniqueStrings(
            existing?.causedBy,
            raw?.caused_by ?? raw?.causedBy,
            12,
        ),
        publicTrace: publicity === 'private'
            ? ''
            : asString(
                raw?.public_trace ?? raw?.publicTrace ?? existing?.publicTrace,
                '',
                LIMITS.eventPublicTrace,
            ),
        publicHeadline: publicity === 'public'
            ? asString(
                raw?.public_headline ?? raw?.publicHeadline ?? existing?.publicHeadline,
                '',
                180,
            )
            : '',
        publicSummary: publicity === 'public'
            ? asString(
                raw?.public_summary ?? raw?.publicSummary ?? existing?.publicSummary,
                '',
                520,
            )
            : '',
        publicResult: publicity === 'public'
            ? asString(
                raw?.public_result ?? raw?.publicResult ?? existing?.publicResult,
                '',
                520,
            )
            : '',
        publicity,
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
            ? (
                Number.isFinite(Number(raw?.resolved_at ?? raw?.resolvedAt))
                    ? asInteger(raw?.resolved_at ?? raw?.resolvedAt, worldMinute, 0)
                    : (
                        existing?.resolvedAt
                        ?? terminalResolutionMinute(
                            { clockMode, dueAt },
                            status,
                            worldMinute,
                        )
                    )
            )
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
        ...state.clock,
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

function normalizedReference(value) {
    return asString(value, '', 120).toLocaleLowerCase();
}

function listReferencesPerson(value, person) {
    const id = normalizedReference(person?.id);
    const name = normalizedReference(person?.name);
    return asArray(value).some(item => {
        const ref = normalizedReference(item);
        return Boolean(ref && (ref === id || ref === name));
    });
}

function eventKnownToPerson(event, person) {
    const eventId = normalizedReference(event?.id);
    return asArray(person?.knownEventIds)
        .some(id => normalizedReference(id) === eventId);
}

function synchronizeCognitiveLedger(state) {
    // Person cognition is authoritative. event.knownBy is only a derived mirror for
    // compatibility/inspection; it can never grant knowledge back to a person.
    for (const event of asArray(state?.events)) {
        for (const person of asArray(state?.people)) {
            if (!eventKnownToPerson(event, person)) continue;
            event.knownBy = mergeUniqueStrings(
                event.knownBy,
                [person.id],
                LIMITS.cognitiveRefs,
            );
        }
    }
}

function terminalResolutionMinute(event, status, worldMinute, explicitMinute = null) {
    const hasExplicit = explicitMinute !== null
        && explicitMinute !== undefined
        && String(explicitMinute).trim() !== '';
    const explicit = hasExplicit ? Number(explicitMinute) : Number.NaN;
    if (Number.isFinite(explicit) && explicit >= 0) {
        return Math.min(asInteger(explicit, worldMinute, 0), worldMinute);
    }
    const dueAt = Number(event?.dueAt);
    if (
        ['resolved', 'missed'].includes(status)
        && ['duration', 'scheduled'].includes(event?.clockMode)
        && Number.isFinite(dueAt)
        && dueAt >= 0
        && dueAt <= worldMinute
    ) {
        return dueAt;
    }
    return worldMinute;
}

function markTerminal(event, status, worldMinute, result = '', explicitMinute = null) {
    const resolvedMinute = terminalResolutionMinute(event, status, worldMinute, explicitMinute);
    event.status = status;
    event.result = asString(result, event.result || event.expectedResult || '', 520);
    event.resolvedAt = resolvedMinute;
    event.updatedAt = Math.max(Number(event.updatedAt) || 0, resolvedMinute);
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

function appendMemoryMetabolism(state, {
    kind = 'memory',
    action = 'updated',
    targetId = '',
    replacementId = '',
    reason = '',
    sourceMessageId = 0,
} = {}) {
    state.storyMemory ||= {};
    state.storyMemory.metabolismLog = asArray(state.storyMemory.metabolismLog);
    state.storyMemory.metabolismLog.push({
        id: makeId('metabolism'),
        kind: asString(kind, 'memory', 30),
        action: asString(action, 'updated', 30),
        targetId: asString(targetId, '', 120),
        replacementId: asString(replacementId, '', 120),
        reason: asString(reason, '', 360),
        sourceMessageId: asInteger(sourceMessageId, 0, 0),
        worldMinute: asInteger(state.clock?.absoluteMinute, 0, 0),
        createdAt: nowIso(),
    });
    state.storyMemory.metabolismLog = state.storyMemory.metabolismLog.slice(-LIMITS.metabolismLog);
    state.storyMemory.lastMetabolismMessageId = Math.max(
        Number(state.storyMemory.lastMetabolismMessageId ?? -1),
        asInteger(sourceMessageId, -1, -1),
    );
}

function compactRolledUpSources(state, parentSummary, sources, { sourceMessageId = 0 } = {}) {
    for (const source of sources) {
        if (source.locked || source.important || source.manual) continue;
        if (asArray(source.tags).length) continue;
        if (Number(source.level || 0) >= MEMORY_SUMMARY_LEVELS.CHAPTER) continue;
        if (source.retentionState === 'compacted') continue;
        source.retentionState = 'compacted';
        source.compactedReason = `细节已由 ${parentSummary.title || `L${parentSummary.level}`} 概括；原始正文仍可按消息范围回看。`;
        source.summary = `细节已收进上层记忆；原始正文见消息 ${source.startMessageId}—${source.endMessageId}。`;
        appendMemoryMetabolism(state, {
            kind: 'episode',
            action: 'compacted',
            targetId: source.id,
            replacementId: parentSummary.id,
            reason: source.compactedReason,
            sourceMessageId,
        });
    }
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
                freezeKnownFactBeforeChange(state, conflict);
                conflict.status = 'superseded';
                conflict.supersededBy = prepared.id;
                conflict.invalidationReason = `已被后续事实“${prepared.value}”取代`;
                conflict.updatedAt = state.clock.absoluteMinute;
                appendMemoryMetabolism(state, {
                    kind: 'fact',
                    action: 'superseded',
                    targetId: conflict.id,
                    replacementId: prepared.id,
                    reason: conflict.invalidationReason,
                    sourceMessageId: sourceMessageId ?? prepared.sourceMessageId ?? 0,
                });
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
        freezeKnownFactBeforeChange(state, fact);
        fact.status = 'invalidated';
        fact.invalidationReason = asString(
            invalidation?.reason ?? invalidation?.invalidation_reason,
            fact.invalidationReason || '已被后续正文否定',
            360,
        );
        fact.updatedAt = state.clock.absoluteMinute;
        appendMemoryMetabolism(state, {
            kind: 'fact',
            action: 'invalidated',
            targetId: fact.id,
            reason: fact.invalidationReason,
            sourceMessageId: sourceMessageId ?? fact.sourceMessageId ?? 0,
        });
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

    const anchorTiming = (clue, { force = false } = {}) => {
        if (!clue) return;
        const currentMinute = state.clock?.absoluteMinute || 0;
        if (clue.timing && !force) {
            clue.timing = normalizeClueTiming(clue.timing, currentMinute);
            return;
        }
        const sourceText = [clue.sourceExcerpt, clue.text].filter(Boolean).join('\n');
        if (!sourceText) {
            clue.timing = null;
            return;
        }
        const baseMinute = asInteger(clue.createdAt, currentMinute, 0);
        clue.timing = resolveFutureTimeExpression(sourceText, {
            baseAbsoluteMinute: baseMinute,
            baseCalendar: formatWorldCalendar(state, baseMinute),
            calendarBound: Boolean(state.clock?.anchored),
        });
        if (clue.timing) clue.timing = normalizeClueTiming(clue.timing, currentMinute);
    };

    // Old saves may contain only natural-language clues. Anchor them from the
    // moment they were created; never reinterpret “后天” from today's clock.
    for (const clue of state.storyMemory.clues) anchorTiming(clue);

    for (const rawClue of asArray(cluesUpsert).slice(0, 24)) {
        const existing = findClue(state.storyMemory, rawClue);
        if (existing?.locked) continue;
        const previousText = existing?.text || '';
        const previousExcerpt = existing?.sourceExcerpt || '';
        const clue = normalizeClue(rawClue, existing, state.clock.absoluteMinute, {
            sourceMessageId,
            sourceSwipeId,
        });
        if (!clue.text) continue;
        const sourceChanged = Boolean(
            existing
            && (previousText !== clue.text || previousExcerpt !== clue.sourceExcerpt)
        );
        // Model-supplied timing is never authoritative. Resolve it from the actual
        // clue/source text and the world clock instead.
        if (!existing || sourceChanged) clue.timing = null;
        anchorTiming(clue, { force: !existing || sourceChanged });
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
            clue.resolution || (clue.status === 'discarded' ? '后续发展已证明这条线索无需继续追踪' : '已由后续正文呼应或解决'),
            520,
        );
        clue.lifecycleReason = asString(
            resolution?.reason ?? resolution?.lifecycle_reason ?? resolution?.lifecycleReason,
            clue.lifecycleReason || clue.resolution,
            360,
        );
        clue.resolvedMessageId = asInteger(
            resolution?.message_id ?? resolution?.messageId,
            sourceMessageId ?? clue.resolvedMessageId ?? 0,
            0,
        );
        clue.updatedAt = state.clock.absoluteMinute;
        appendMemoryMetabolism(state, {
            kind: 'clue',
            action: clue.status,
            targetId: clue.id,
            reason: clue.lifecycleReason || clue.resolution,
            sourceMessageId: sourceMessageId ?? clue.resolvedMessageId ?? 0,
        });
    }
}

function normalizeSimulationResult(payload, { peopleUpsertLimit = LIMITS.peoplePayload } = {}) {
    const rawClockAnchor = payload?.clock_anchor ?? payload?.clockAnchor ?? {};
    const anchorMode = ['none', 'initialize', 'calibrate'].includes(rawClockAnchor?.mode)
        ? rawClockAnchor.mode
        : 'none';
    const anchorPrecision = ['minute', 'daypart', 'date'].includes(rawClockAnchor?.precision)
        ? rawClockAnchor.precision
        : 'minute';
    const anchorConfidence = ['low', 'medium', 'high'].includes(rawClockAnchor?.confidence)
        ? rawClockAnchor.confidence
        : 'low';
    return {
        elapsedMinutes: asInteger(
            payload?.elapsed_minutes ?? payload?.elapsedMinutes,
            0,
            0,
            5 * 365 * MINUTES_PER_DAY,
        ),
        timeReason: asString(payload?.time_reason ?? payload?.timeReason, '', 320),
        clockAnchor: {
            mode: anchorMode,
            calendarName: asString(
                rawClockAnchor?.calendar_name ?? rawClockAnchor?.calendarName,
                '',
                40,
            ),
            year: asInteger(rawClockAnchor?.year, 0, 0, MAX_CALENDAR_YEAR),
            month: asInteger(rawClockAnchor?.month, 0, 0, 12),
            day: asInteger(rawClockAnchor?.day, 0, 0, 31),
            hour: asInteger(rawClockAnchor?.hour, 0, 0, 23),
            minute: asInteger(rawClockAnchor?.minute, 0, 0, 59),
            hasDate: (() => {
                const year = Number(rawClockAnchor?.year);
                const month = Number(rawClockAnchor?.month);
                const day = Number(rawClockAnchor?.day);
                return Number.isFinite(year) && year >= 1 && year <= MAX_CALENDAR_YEAR
                    && Number.isFinite(month) && month >= 1 && month <= 12
                    && Number.isFinite(day) && day >= 1 && day <= 31;
            })(),
            hasTime: (() => {
                const rawHour = rawClockAnchor?.hour;
                const rawMinute = rawClockAnchor?.minute;
                if (rawHour === null || rawHour === undefined || rawHour === '') return false;
                if (rawMinute === null || rawMinute === undefined || rawMinute === '') return false;
                const hour = Number(rawHour);
                const minute = Number(rawMinute);
                return Number.isFinite(hour) && hour >= 0 && hour <= 23
                    && Number.isFinite(minute) && minute >= 0 && minute <= 59;
            })(),
            precision: anchorPrecision,
            confidence: anchorConfidence,
            sourceExcerpt: asString(
                rawClockAnchor?.source_excerpt ?? rawClockAnchor?.sourceExcerpt,
                '',
                220,
            ),
            reason: asString(rawClockAnchor?.reason, '', 240),
        },
        world: {
            title: asString(payload?.world?.title, '', 180),
            detail: asString(payload?.world?.detail, '', 640),
        },
        peopleUpsert: asArray(payload?.people_upsert ?? payload?.peopleUpsert).slice(0, Math.max(1, asInteger(peopleUpsertLimit, LIMITS.peoplePayload, 1))),
        peopleRemove: uniqueStrings(payload?.people_remove ?? payload?.peopleRemove, LIMITS.peoplePayload),
        eventsCreate: asArray(payload?.events_create ?? payload?.eventsCreate).slice(0, 24),
        eventsUpdate: asArray(payload?.events_update ?? payload?.eventsUpdate).slice(0, 36),
        deliveriesConfirmed: uniqueStrings(
            payload?.deliveries_confirmed ?? payload?.deliveriesConfirmed,
            24,
        ),
        foregroundFacts: asArray(payload?.front_facts ?? payload?.frontFacts).slice(0, 16),
        worldFactsUpsert: asArray(
            payload?.world_facts_upsert ?? payload?.worldFactsUpsert,
        ).slice(0, 32),
        worldPulseUpsert: asArray(
            payload?.world_pulse_upsert ?? payload?.worldPulseUpsert,
        ).slice(0, LIMITS.worldPulseDomains),
        consistencyConflicts: asArray(
            payload?.consistency_conflicts ?? payload?.consistencyConflicts,
        ).slice(0, 24),
        memoryUpdates: {
            turnSummaries: asArray(
                payload?.memory_update?.turn_summaries
                ?? payload?.memoryUpdate?.turnSummaries,
            ).slice(0, 24),
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

function conflictKeepsPersonField(rawConflicts, person, field) {
    const aliases = new Set([
        String(person?.id || '').toLocaleLowerCase(),
        String(person?.name || '').toLocaleLowerCase(),
    ].filter(Boolean));
    return asArray(rawConflicts).some(raw => {
        const subject = String(raw?.subject_id ?? raw?.subjectId ?? raw?.subject ?? '')
            .trim().toLocaleLowerCase();
        const rawField = String(raw?.field || '').trim();
        const resolution = String(raw?.resolution || '').trim();
        return aliases.has(subject) && rawField === field && resolution === 'keep-world';
    });
}


function normalizedEvidenceText(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function foregroundKnowledgeEvidenceSupported(narrativeText, person, acquisition) {
    const narrative = normalizedEvidenceText(narrativeText);
    const evidence = normalizedEvidenceText(acquisition?.evidence);
    if (!narrative || !evidence || evidence.length < 4) return false;

    // Foreground cognition needs evidence from the actual new narrative, not a model
    // invented explanation. The prompt asks the model to copy a short source excerpt.
    if (!narrative.includes(evidence)) return false;

    const personName = normalizedEvidenceText(person?.name);
    if (personName && !evidence.includes(personName) && !narrative.includes(personName)) {
        return false;
    }
    return true;
}


function backgroundAcquisitionHasWorldTrace(state, person, acquisition) {
    if (acquisition?.route === 'inferred') return acquisition?.certainty === 'suspected';
    if (acquisition?.route === 'public_channel') {
        return publicChannelSupportsAcquisition(state, acquisition);
    }

    const sourceEventId = normalizedReference(acquisition?.sourceEventId);
    if (!sourceEventId) return false;
    const sourceEvent = asArray(state?.events).find(item => (
        normalizedReference(item?.id) === sourceEventId
    ));
    if (!sourceEvent) return false;

    const personName = String(person?.name || '').trim();
    const traceText = `${sourceEvent.title || ''} ${sourceEvent.summary || ''} ${sourceEvent.cause || ''} ${acquisition.evidence || ''}`;
    if (personName && !traceText.includes(personName)) return false;

    const routeCue = {
        witnessed: /(看见|看到|目睹|亲眼|听见|听到|亲耳|撞见|当场发现)/,
        told: /(告诉|告知|转告|说明给|向.+说明|被.+告知)/,
        investigated: /(调查|查到|查明|核实|验证|翻查|调取|检索)/,
        message: /(收到|短信|消息|电话|邮件|通知|私信|群消息|来电)/,
    }[acquisition.route];

    return Boolean(routeCue?.test(traceText));
}

function publicChannelSupportsAcquisition(state, acquisition) {
    const sourceEventId = normalizedReference(
        acquisition?.sourceEventId || (acquisition?.kind === 'event' ? acquisition?.ref : ''),
    );
    if (!sourceEventId) return false;
    const event = asArray(state?.events).find(item => (
        normalizedReference(item?.id) === sourceEventId
    ));
    return Boolean(
        event
        && event.publicity === 'public'
        && (event.publicHeadline || event.publicSummary || event.publicResult || event.publicTrace)
    );
}

function applyKnowledgeAcquisition(state, person, rawAcquisition, {
    messageId = 0,
    narrativeText = '',
    foreground = false,
} = {}) {
    const [acquisition] = normalizeKnowledgeAcquisitions([rawAcquisition], messageId);
    if (!person || !acquisition) return false;

    if (
        foreground
        && !foregroundKnowledgeEvidenceSupported(narrativeText, person, acquisition)
    ) return false;

    if (
        acquisition.route === 'public_channel'
        && !publicChannelSupportsAcquisition(state, acquisition)
    ) return false;

    if (
        !foreground
        && !backgroundAcquisitionHasWorldTrace(state, person, acquisition)
    ) return false;

    if (acquisition.route === 'inferred' && acquisition.certainty !== 'suspected') {
        return false;
    }

    if (acquisition.kind === 'event') {
        const event = asArray(state?.events).find(item => (
            normalizedReference(item?.id) === normalizedReference(acquisition.ref)
        ));
        if (!event) return false;

        const safeView = asString(
            acquisition.belief
            || (
                acquisition.route === 'public_channel'
                    ? (event.publicSummary || event.publicHeadline || event.publicTrace)
                    : acquisition.evidence
            ),
            '',
            520,
        );
        if (!safeView) return false;

        person.knownEventViews = normalizeKnownEventViews([{
            event_id: event.id,
            summary: safeView,
            certainty: acquisition.certainty,
            route: acquisition.route,
            evidence: acquisition.evidence,
            learned_at_message_id: acquisition.learnedAtMessageId,
            updated_at: state.clock?.absoluteMinute || 0,
        }], person.knownEventViews);

        if (acquisition.certainty === 'confirmed') {
            person.knownEventIds = mergeUniqueStrings(
                person.knownEventIds,
                [event.id],
                LIMITS.cognitiveRefs,
            );
        }
        person.cognitionReady = true;
        return true;
    }

    if (acquisition.kind === 'fact') {
        const fact = activeFactByKey(state, acquisition.ref);
        if (!fact) return false;

        const beliefValue = asString(
            acquisition.belief
            || (acquisition.certainty === 'confirmed' ? fact.value : ''),
            '',
            520,
        );
        if (!beliefValue) return false;

        setFactBelief(person, fact, acquisition.learnedAtMessageId || messageId, {
            value: beliefValue,
            certainty: acquisition.certainty,
            route: acquisition.route,
            evidence: acquisition.evidence,
        });
        if (acquisition.certainty === 'confirmed') {
            person.knownFactKeys = mergeUniqueStrings(
                person.knownFactKeys,
                [fact.key],
                LIMITS.cognitiveRefs,
            );
        }
        person.cognitionReady = true;
        return true;
    }

    if (acquisition.kind === 'clue') {
        const clue = asArray(state?.storyMemory?.clues).find(item => (
            normalizedReference(item?.id) === normalizedReference(acquisition.ref)
        ));
        if (!clue) return false;
        // Suspicion about a clue is not equivalent to knowing that clue exists.
        if (acquisition.certainty !== 'confirmed') return false;
        person.knownClueIds = mergeUniqueStrings(
            person.knownClueIds,
            [clue.id],
            LIMITS.cognitiveRefs,
        );
        person.cognitionReady = true;
        return true;
    }

    return false;
}


function personKnowsReference(person, ref) {
    const normalized = normalizedReference(ref);
    if (!normalized) return false;
    if (normalized.startsWith('event:')) {
        const eventId = normalized.slice('event:'.length);
        return asArray(person?.knownEventIds).some(id => normalizedReference(id) === eventId)
            || asArray(person?.knownEventViews).some(view => normalizedReference(view?.eventId) === eventId);
    }
    if (normalized.startsWith('fact:')) {
        const factKey = normalized.slice('fact:'.length);
        return asArray(person?.knownFactKeys).some(key => normalizedReference(key) === factKey)
            || asArray(person?.knownFactBeliefs).some(belief => normalizedReference(belief?.key) === factKey);
    }
    if (normalized.startsWith('clue:')) {
        const clueId = normalized.slice('clue:'.length);
        return asArray(person?.knownClueIds).some(id => normalizedReference(id) === clueId);
    }
    return false;
}

function textHasSecretOverlap(text, secret) {
    const candidate = normalizedEvidenceText(text);
    const source = normalizedEvidenceText(secret);
    if (!candidate || !source || source.length < 6) return false;
    if (candidate.includes(source)) return true;
    const windows = [];
    const width = source.length >= 12 ? 6 : 5;
    for (let index = 0; index + width <= source.length; index += Math.max(2, width - 2)) {
        windows.push(source.slice(index, index + width));
    }
    return windows.some(chunk => chunk.length >= 5 && candidate.includes(chunk));
}


function personHasNearbyUnknownSecrets(state, person) {
    const name = String(person?.name || '');
    for (const event of asArray(state?.events)) {
        if (eventKnownToPerson(event, person)) continue;
        if (
            listReferencesPerson(event?.actors, person)
            || (person?.location && event?.place === person.location)
            || (name && (
                String(event?.title || '').includes(name)
                || String(event?.summary || '').includes(name)
                || String(event?.cause || '').includes(name)
            ))
        ) return true;
    }
    return false;
}

function innerVoiceLeaksUnknownReality(state, person, candidate) {
    for (const event of asArray(state?.events)) {
        if (eventKnownToPerson(event, person)) continue;
        const secrets = [
            event.cause,
            event.summary,
            event.result,
            event.expectedResult,
        ].filter(Boolean);
        if (secrets.some(secret => textHasSecretOverlap(candidate, secret))) return true;
    }

    const knownFactRefs = new Set([
        ...asArray(person?.knownFactKeys).map(normalizedReference),
        ...asArray(person?.knownFactBeliefs).map(item => normalizedReference(item?.key)),
    ]);
    for (const fact of asArray(state?.storyMemory?.facts)) {
        if (knownFactRefs.has(normalizedReference(fact?.key))) continue;
        if (fact?.visibility !== 'hidden') continue;
        if (textHasSecretOverlap(candidate, fact?.value)) return true;
    }
    return false;
}

function commitSafeInnerVoice(state, person, rawPerson, {
    worldMinute = 0,
    allowUserInnerVoice = true,
} = {}) {
    if (!person) return false;
    if (person.isUser && !allowUserInnerVoice) {
        person.innerVoice = '';
        person.innerVoiceAt = worldMinute;
        return false;
    }
    const candidate = asString(rawPerson?.inner_voice ?? rawPerson?.innerVoice, '', LIMITS.innerVoice);
    if (!candidate) return false;

    const basis = uniqueStrings(
        rawPerson?.inner_voice_basis ?? rawPerson?.innerVoiceBasis,
        LIMITS.cognitiveRefs,
    );
    if (basis.length && basis.some(ref => !personKnowsReference(person, ref))) {
        return false;
    }
    if (!basis.length && personHasNearbyUnknownSecrets(state, person)) {
        return false;
    }
    if (innerVoiceLeaksUnknownReality(state, person, candidate)) {
        return false;
    }

    person.innerVoice = candidate;
    person.innerVoiceAt = worldMinute;
    return true;
}

function narrativeSupportsLocationValue(narrativeText, value) {
    const text = String(narrativeText || '').replace(/\s+/g, '');
    const compactValue = String(value || '').replace(/\s+/g, '').trim();
    if (!text || compactValue.length < 2) return false;
    const terms = uniqueStrings([
        compactValue,
        ...compactValue.split(/[的、,，/·|｜]/g),
    ], 12).filter(term => term.length >= 2);
    for (const term of terms) {
        let index = text.indexOf(term);
        while (index >= 0) {
            const window = text.slice(Math.max(0, index - 28), Math.min(text.length, index + term.length + 18));
            if (
                /(?:地点|位置|所在地|场景)[：:]/.test(window)
                || /(?:在|位于|身处|来到|到达|抵达|回到|返回|进入|走进|前往|赶到|去了|住在|留在|待在|躺在|坐在|站在|出现在|离开)[^。！？!?]{0,22}/.test(window)
            ) return true;
            index = text.indexOf(term, index + term.length);
        }
    }
    return false;
}

function authoritativePersonFact(state, personId, field) {
    const key = `person:${personId}:${field}`;
    return asArray(state?.worldFacts).find(fact => fact?.key === key && fact?.confidence === 'high') || null;
}

export function applySimulationResult(baseState, rawPayload, {
    messageId = null,
    swipeId = null,
    sourceKey = '',
    userName = '',
    allowUserInnerVoice = true,
    recordPlayerCharacter = true,
    timePolicy = 'open',
    narrativeText = '',
    backgroundNpcBudget = LIMITS.peopleTaskBudget,
    lifeSettlementTargetIds = [],
    memorySummaryMessageIds = [],
    preserveCommitAnchor = false,
} = {}) {
    const requestedBackgroundNpcBudget = asInteger(
        backgroundNpcBudget,
        LIMITS.peopleTaskBudget,
        0,
    );
    const payload = normalizeSimulationResult(rawPayload, {
        // Keep a small foreground allowance while letting the user-selected background
        // budget scale past the old fixed 36-person payload ceiling.
        peopleUpsertLimit: Math.max(LIMITS.peoplePayload, requestedBackgroundNpcBudget + 24),
    });
    const lifeSettlementTargets = new Set(
        asArray(lifeSettlementTargetIds).map(item => String(item || '')).filter(Boolean),
    );
    if (!recordPlayerCharacter) {
        baseState = {
            ...baseState,
            people: asArray(baseState?.people).filter(person => !isUserPersonLike(person, userName)),
        };
    }
    const baseClockAnchored = Boolean(baseState?.clock?.anchored);
    // Model clock_anchor is advisory only. Absolute world time is a deterministic
    // state authority: model guesses may estimate elapsed duration, never date us.
    const modelClockAnchor = payload.clockAnchor;
    void modelClockAnchor;
    const currentCalendar = formatWorldCalendar(baseState);
    const narrativeCalendar = extractExplicitCalendarDate(narrativeText);
    const narrativeAnchor = extractNarrativeTimeAnchor(narrativeText);
    const relativeTransition = resolveNarrativeTimeTransition(narrativeText, {
        currentAbsoluteMinute: baseState.clock?.absoluteMinute || 0,
        currentCalendar,
        calendarBound: baseClockAnchored,
        narrativeAnchor,
    });
    const anchor = {
        mode: 'none',
        calendarName: '',
        year: 0,
        month: 0,
        day: 0,
        hour: 0,
        minute: 0,
        hasDate: false,
        hasTime: false,
        precision: 'date',
        confidence: 'low',
        sourceExcerpt: '',
        reason: '',
    };

    const currentMinuteOfDay = currentCalendar.hour * 60 + currentCalendar.minute;
    const narrativeMinuteOfDay = narrativeAnchor
        && narrativeAnchor.hour !== null
        && narrativeAnchor.minute !== null
        ? Number(narrativeAnchor.hour) * 60 + Number(narrativeAnchor.minute)
        : null;
    const structuredForwardExact = Boolean(
        baseClockAnchored
        && narrativeAnchor?.structured
        && Number.isFinite(narrativeMinuteOfDay)
        && narrativeMinuteOfDay >= currentMinuteOfDay
    );
    const narrativeDayDelta = narrativeCalendar
        ? calendarDayDifference({
            year: currentCalendar.year,
            month: currentCalendar.month,
            day: currentCalendar.dayOfMonth,
        }, {
            year: narrativeCalendar.year,
            month: narrativeCalendar.month,
            day: narrativeCalendar.day,
        })
        : null;
    const narrativeDateReliable = Boolean(
        narrativeCalendar
        && (narrativeAnchor?.structured || Number(narrativeCalendar.index) <= 500)
    );
    const narrativeDateCanCalibrate = Boolean(
        narrativeDateReliable
        && (!baseClockAnchored || Number(narrativeDayDelta) >= 0)
    );

    if (narrativeDateCanCalibrate) {
        const dateChanged = !baseClockAnchored || Number(narrativeDayDelta) !== 0;
        const reliableExact = Boolean(
            narrativeAnchor
            && narrativeAnchor.hour !== null
            && narrativeAnchor.minute !== null
            && (
                !baseClockAnchored
                || dateChanged
                || structuredForwardExact
                || /→|->|至|到/.test(narrativeAnchor.excerpt || '')
            )
        );
        anchor.mode = baseClockAnchored ? 'calibrate' : 'initialize';
        anchor.year = narrativeCalendar.year;
        anchor.month = narrativeCalendar.month;
        anchor.day = narrativeCalendar.day;
        anchor.hasDate = true;
        if (reliableExact) {
            anchor.hour = narrativeAnchor.hour;
            anchor.minute = narrativeAnchor.minute;
            anchor.hasTime = true;
            anchor.precision = 'minute';
        } else {
            anchor.precision = narrativeAnchor?.daypart ? 'daypart' : 'date';
        }
        anchor.confidence = 'high';
        anchor.sourceExcerpt = narrativeAnchor?.excerpt || narrativeCalendar.excerpt;
        anchor.reason = baseClockAnchored
            ? '正文给出新的可靠时间证据，按确定性规则校准主世界时间'
            : '正文给出可靠年月日，将既有相对世界时钟绑定到主世界历';
    } else if (structuredForwardExact) {
        anchor.mode = 'calibrate';
        anchor.year = currentCalendar.year;
        anchor.month = currentCalendar.month;
        anchor.day = currentCalendar.dayOfMonth;
        anchor.hour = narrativeAnchor.hour;
        anchor.minute = narrativeAnchor.minute;
        anchor.hasDate = true;
        anchor.hasTime = true;
        anchor.precision = 'minute';
        anchor.confidence = 'high';
        anchor.sourceExcerpt = narrativeAnchor.excerpt;
        anchor.reason = '正文时间栏给出更晚的明确钟点，自动校准主世界时间';
    }

    const anchorHasDate = Boolean(anchor?.hasDate);
    const anchorHasExactTime = Boolean(anchor?.hasTime);
    const initializeClock = !baseClockAnchored
        && anchorHasDate
        && anchor?.mode === 'initialize'
        && anchor?.confidence === 'high';
    const recalibrateClock = baseClockAnchored
        && anchorHasDate
        && anchor?.mode === 'calibrate'
        && anchor?.confidence === 'high';
    const anchorApplied = initializeClock || recalibrateClock;

    const requestedElapsedMinutes = payload.elapsedMinutes;
    const explicitTimeEvidence = hasExplicitTimeEvidence(narrativeText);
    if (anchorApplied || relativeTransition) {
        // Both are end-of-batch time evidence. Adding model elapsed_minutes again
        // would double-count the same date/transition.
        payload.elapsedMinutes = 0;
    } else {
        payload.elapsedMinutes = resolveElapsedMinutes(
            requestedElapsedMinutes,
            narrativeText,
            timePolicy,
        );
    }
    if (!explicitTimeEvidence && !['open', 'world'].includes(timePolicy)) {
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
    if (anchorApplied) {
        payload.timeReason = anchor.reason;
    } else if (relativeTransition) {
        payload.timeReason = relativeTransition.reason;
    } else if (!baseClockAnchored && timePolicy === 'world') {
        payload.timeReason = payload.elapsedMinutes > 0
            ? '具体历法日期尚未绑定；沿用相对世界时钟并按本批真实耗时推进'
            : '具体历法日期尚未绑定；相对世界时钟保持连续';
    } else if (requestedElapsedMinutes > 0 && payload.elapsedMinutes === 0) {
        payload.timeReason = '正文没有明确、可计算的时间证据，本轮保持世界时钟不动';
    } else if (payload.elapsedMinutes < requestedElapsedMinutes) {
        payload.timeReason = `正文时间较含糊，本轮最多推进 ${payload.elapsedMinutes} 分钟`;
    }
    let anchoredBaseState = baseState;
    if (initializeClock) {
        const currentClock = formatWorldCalendar(baseState);
        anchoredBaseState = setWorldCalendar(baseState, {
            calendarName: anchor.calendarName || baseState?.world?.calendar?.name || '主世界历',
            year: anchor.year,
            month: anchor.month,
            day: anchor.day,
            hour: anchorHasExactTime ? anchor.hour : currentClock.hour,
            minute: anchorHasExactTime ? anchor.minute : currentClock.minute,
            reason: payload.timeReason,
        });
        anchoredBaseState.clock.source = 'narrative-anchor-init';
        anchoredBaseState.clock.anchored = true;
        anchoredBaseState.clock.precision = anchor.precision;
        anchoredBaseState.clock.daypart = narrativeAnchor?.daypart || '';
        appendAudit(anchoredBaseState, {
            type: 'clock_anchor_initialized',
            text: `主世界时间锚点建立：${formatWorldCalendar(anchoredBaseState).stamp}`,
            reason: anchor.sourceExcerpt
                ? `${payload.timeReason}；依据：${anchor.sourceExcerpt}`
                : payload.timeReason,
        });
    } else if (recalibrateClock) {
        const current = formatWorldCalendar(baseState);
        const dayDelta = calendarDayDifference({
            year: current.year,
            month: current.month,
            day: current.dayOfMonth,
        }, {
            year: anchor.year,
            month: anchor.month,
            day: anchor.day,
        });
        const currentMinuteOfDay = current.hour * 60 + current.minute;
        const anchorMinuteOfDay = anchorHasExactTime
            ? anchor.hour * 60 + anchor.minute
            : currentMinuteOfDay;
        const targetMinute = Math.max(
            0,
            baseState.clock.absoluteMinute
                + dayDelta * MINUTES_PER_DAY
                + anchorMinuteOfDay
                - currentMinuteOfDay,
        );
        anchoredBaseState = settleTimedEvents(baseState, targetMinute, {
            source: 'narrative-anchor',
            reason: payload.timeReason,
        });
        if (anchor.calendarName) {
            anchoredBaseState.world.calendar.name = anchor.calendarName;
        }
        anchoredBaseState.clock.anchored = true;
        anchoredBaseState.clock.precision = anchor.precision;
        anchoredBaseState.clock.daypart = narrativeAnchor?.daypart || '';
        appendAudit(anchoredBaseState, {
            type: 'clock_anchor_recalibrated',
            text: `主世界时间重新校准：${formatWorldCalendar(anchoredBaseState).stamp}`,
            reason: anchor.sourceExcerpt
                ? `${payload.timeReason}；依据：${anchor.sourceExcerpt}`
                : payload.timeReason,
        });
    }
    const transitionTarget = !anchorApplied && relativeTransition
        ? Number(relativeTransition.targetAbsoluteMinute)
        : Number.NaN;
    const targetWorldMinute = Number.isFinite(transitionTarget)
        ? Math.max(0, transitionTarget)
        : anchoredBaseState.clock.absoluteMinute + payload.elapsedMinutes;
    let state = settleTimedEvents(
        anchoredBaseState,
        targetWorldMinute,
        {
            source: anchorApplied
                ? anchoredBaseState.clock.source
                : relativeTransition
                    ? 'narrative-time-evidence'
                    : 'world-clock',
            reason: payload.timeReason || '正文推演',
        },
    );
    if (!anchorApplied && relativeTransition) {
        state.clock.precision = relativeTransition.precision || state.clock.precision || 'day';
        state.clock.daypart = relativeTransition.daypart || '';
        state.clock.source = 'narrative-time-evidence';
        state.clock.reason = relativeTransition.reason || payload.timeReason;
    } else if (!state.clock.anchored && !['minute', 'daypart', 'date', 'day'].includes(state.clock.precision)) {
        state.clock.precision = 'day';
        state.clock.daypart = '';
    }
    const worldMinute = state.clock.absoluteMinute;

    if (payload.world.title) state.world.title = payload.world.title;
    if (payload.world.detail) state.world.detail = payload.world.detail;

    const pendingKnowledgeUpdates = [];

    const generatedConsistencyConflicts = [];
    let backgroundNpcUpdates = 0;
    const maximumBackgroundNpcUpdates = requestedBackgroundNpcBudget;
    // Whether a person is foreground is an evidence question, not a budget-size question.
    // A large user budget must never let model-labelled "foreground" bypass narrative evidence.
    const enforceForegroundEvidence = true;
    const narrativeForPeople = asString(narrativeText, '', 60000).toLocaleLowerCase();
    for (const rawPerson of payload.peopleUpsert) {
        const personName = asString(rawPerson?.name, '', 80).toLocaleLowerCase();
        const playerPerson = Boolean(
            isUserPersonLike(rawPerson, userName)
            || isUserPersonLike(findPerson(state, rawPerson), userName)
        );
        if (playerPerson && !recordPlayerCharacter) continue;
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
        pendingKnowledgeUpdates.push({
            personId: existing?.id || normalizeId(rawPerson?.id || rawPerson?.name, 'person'),
            foreground: foregroundPerson,
            rawPerson,
            updates: normalizeKnowledgeAcquisitions(
                rawPerson?.knowledge_updates
                ?? rawPerson?.knowledgeUpdates
                ?? rawPerson?.knowledge_acquisitions
                ?? rawPerson?.knowledgeAcquisitions,
                messageId || 0,
            ),
        });
        const person = normalizePerson(rawPerson, existing, worldMinute, {
            userName,
            allowUserInnerVoice,
            sourceMessageId: messageId,
        });
        const targetedLifeSettlement = Boolean(
            lifeSettlementTargets.has(String(existing?.id || ''))
            || lifeSettlementTargets.has(String(person.id || ''))
            || lifeSettlementTargets.has(String(rawPerson?.id || ''))
        );
        // 普通后台 upsert 可能只是事件后果/认知变化，不等于整段个人生活已经结算。
        if (!person.isUser && (foregroundPerson || targetedLifeSettlement)) {
            person.lastLifeTickAt = worldMinute;
            if (targetedLifeSettlement) {
                person.lifeTickPriority = false;
                person.lifeTickPriorityAt = 0;
            }
        }
        if (existing && foregroundPerson && !baseState?.needsReconciliation) {
            const authoritativeLocation = authoritativePersonFact(state, existing.id, 'location');
            const requestedLocation = asString(
                rawPerson?.location,
                existing.location || '',
                160,
            );
            const locationChanged = Boolean(
                requestedLocation
                && authoritativeLocation?.value
                && requestedLocation !== authoritativeLocation.value
            );
            const explicitKeep = conflictKeepsPersonField(
                payload.consistencyConflicts,
                existing,
                'location',
            );
            const narrativeSupport = locationChanged
                ? narrativeSupportsLocationValue(narrativeText, requestedLocation)
                : true;
            if (locationChanged && (explicitKeep || !narrativeSupport)) {
                person.location = authoritativeLocation.value;
                generatedConsistencyConflicts.push({
                    subject: existing.name,
                    field: 'location',
                    previous_value: authoritativeLocation.value,
                    narrative_value: requestedLocation,
                    resolution: 'keep-world',
                    reason: explicitKeep
                        ? '推演识别到正文与权威位置无过渡冲突，保持既有世界事实'
                        : '正文没有找到足够明确的位置变化证据，拒绝用模型推断无过渡覆盖权威位置',
                    message_id: messageId,
                });
            }
        }
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
            settlePersonStateFacts(
                state,
                existing,
                foregroundPerson ? 'narrative' : 'simulation',
                messageId,
            );
        } else {
            state.people.push(person);
            settlePersonStateFacts(
                state,
                person,
                foregroundPerson ? 'narrative' : 'simulation',
                messageId,
            );
        }
    }

    if (payload.peopleRemove.length) {
        const removed = new Set(payload.peopleRemove.map(item => item.toLowerCase()));
        const removedPersonIds = new Set(
            state.people
                .filter(person => (
                    !person.locked
                    // 用户手动添加 / 世界书导入的人物属于作者维护资产。
                    // routine simulation 可以更新她们的动态状态，但不能通过 people_remove 删除。
                    && !person.manual
                    && !person.worldbookRef
                    && person.source !== 'manual'
                    && (
                        removed.has(person.id.toLowerCase())
                        || removed.has(person.name.toLowerCase())
                    )
                ))
                .map(person => person.id),
        );
        state.people = state.people.filter(person => (
            person.locked
            || !removedPersonIds.has(person.id)
        ));
        if (removedPersonIds.size) {
            state.worldFacts = asArray(state.worldFacts).filter(fact => !(
                fact?.subjectType === 'person'
                && removedPersonIds.has(fact?.subjectId)
            ));
        }
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
        if (update?.cause !== undefined) {
            event.cause = asString(update.cause, event.cause || '', LIMITS.eventCause);
        }
        event.actors = mergeUniqueStrings(event.actors, update?.actors, 16);
        event.knownBy = mergeUniqueStrings(
            event.knownBy,
            update?.known_by ?? update?.knownBy,
            LIMITS.cognitiveRefs,
        );
        event.causedBy = mergeUniqueStrings(
            event.causedBy,
            update?.caused_by ?? update?.causedBy,
            12,
        );
        if (update?.visibility) event.visibility = normalizeVisibility(update.visibility);
        if (
            update?.publicity !== undefined
            || update?.public_scope !== undefined
            || update?.publicScope !== undefined
        ) {
            event.publicity = normalizeEventPublicity(
                update?.publicity ?? update?.public_scope ?? update?.publicScope,
                event.publicity || 'private',
            );
        }
        if (update?.public_trace !== undefined || update?.publicTrace !== undefined) {
            event.publicTrace = asString(
                update?.public_trace ?? update?.publicTrace,
                event.publicTrace || '',
                LIMITS.eventPublicTrace,
            );
        }
        if (update?.public_headline !== undefined || update?.publicHeadline !== undefined) {
            event.publicHeadline = asString(
                update?.public_headline ?? update?.publicHeadline,
                event.publicHeadline || '',
                180,
            );
        }
        if (update?.public_summary !== undefined || update?.publicSummary !== undefined) {
            event.publicSummary = asString(
                update?.public_summary ?? update?.publicSummary,
                event.publicSummary || '',
                520,
            );
        }
        if (update?.public_result !== undefined || update?.publicResult !== undefined) {
            event.publicResult = asString(
                update?.public_result ?? update?.publicResult,
                event.publicResult || '',
                520,
            );
        }
        if (event.publicity === 'private') {
            event.publicTrace = '';
            event.publicHeadline = '';
            event.publicSummary = '';
            event.publicResult = '';
        } else if (event.publicity === 'trace') {
            event.publicHeadline = '';
            event.publicSummary = '';
            event.publicResult = '';
        }
        if (update?.delivery_route) {
            event.delivery.route = asString(update.delivery_route, event.delivery.route, 220);
        }

        const requestedStatus = normalizeEventStatus(update?.status ?? event.status);
        if (TERMINAL_EVENT_STATES.has(requestedStatus)) {
            markTerminal(
                event,
                requestedStatus,
                worldMinute,
                update?.result,
                update?.resolved_at ?? update?.resolvedAt,
            );
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
        if (TERMINAL_EVENT_STATES.has(event.status)) {
            settleEventResultFact(state, event, messageId);
        }
    }

    for (const rawFact of payload.worldFactsUpsert) {
        const source = ['foreground', 'narrative'].includes(rawFact?.source)
            ? 'narrative'
            : 'simulation';
        upsertWorldFact(state, rawFact, {
            source,
            messageId,
        });
    }

    state.worldPulse = normalizeWorldPulse(state.worldPulse, worldMinute);
    for (const rawDomain of payload.worldPulseUpsert) {
        upsertWorldPulseDomain(state, rawDomain, {
            worldMinute,
            source: rawDomain?.source === 'history' ? 'history' : 'simulation',
        });
    }
    if (payload.worldPulseUpsert.length) {
        state.worldPulse.baselineEstablished = true;
    }
    if (payload.elapsedMinutes > 0 || payload.worldPulseUpsert.length) {
        state.worldPulse.lastSweepAt = worldMinute;
    }

    // Public news is only a presentation of an already-real world event.
    // Keep one stable world fact per public event so later foreground scenes can
    // retrieve the world's current/recent reality even after the news card changes.
    syncPublicEventRealityFacts(state, worldMinute);

    const allConsistencyConflicts = [
        ...generatedConsistencyConflicts,
        ...payload.consistencyConflicts,
    ];
    if (allConsistencyConflicts.length) {
        const seen = new Set();
        const conflicts = allConsistencyConflicts
            .map(raw => normalizeConsistencyConflict(raw, worldMinute, messageId))
            .filter(conflict => {
                if (!conflict.expected && !conflict.observed) return false;
                const key = `${conflict.subject}\u0000${conflict.field}\u0000${conflict.expected}\u0000${conflict.observed}\u0000${conflict.messageId}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        state.consistencyConflicts = [
            ...conflicts,
            ...asArray(state.consistencyConflicts),
        ].slice(0, LIMITS.consistencyConflicts);
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
        upsertWorldFact(state, {
            key: rawFact?.key || `foreground:${hashText(text)}`,
            subject_type: rawFact?.subject_type || 'world',
            subject_id: rawFact?.subject_id || '',
            subject: rawFact?.subject || '正文事实',
            field: rawFact?.field || 'state',
            value: text,
            visibility: rawFact?.visibility ?? 'known',
            confidence: 'high',
        }, {
            source: 'narrative',
            messageId,
        });
    }

    const allowedMemorySummaryIds = new Set(
        asArray(memorySummaryMessageIds)
            .map(value => asInteger(value, -1, -1))
            .filter(value => value >= 0),
    );
    for (const rawTurn of asArray(payload.memoryUpdates?.turnSummaries).slice(0, 24)) {
        const summaryMessageId = asInteger(
            rawTurn?.source_message_id
            ?? rawTurn?.sourceMessageId
            ?? rawTurn?.message_id
            ?? rawTurn?.messageId,
            -1,
            -1,
        );
        if (
            summaryMessageId < 0
            || !allowedMemorySummaryIds.has(summaryMessageId)
            || !rawTurn?.summary
        ) continue;
        const preparedSummary = {
            ...rawTurn,
            id: rawTurn?.id || `summary_l0_${summaryMessageId}`,
            start_message_id: summaryMessageId,
            end_message_id: summaryMessageId,
            level: MEMORY_SUMMARY_LEVELS.DETAIL,
            hierarchy_managed: true,
            source_summary_ids: [],
        };
        const normalizedSummary = normalizeStorySummary(preparedSummary);
        const existingSummary = state.storyMemory.summaries.find(summary => (
            summary.id === normalizedSummary.id
            || (
                Number(summary.level) === MEMORY_SUMMARY_LEVELS.DETAIL
                && Number(summary.startMessageId) === summaryMessageId
                && Number(summary.endMessageId) === summaryMessageId
            )
        ));
        if (existingSummary) Object.assign(existingSummary, normalizedSummary);
        else state.storyMemory.summaries.push(normalizedSummary);
    }

    applyMemoryFactUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });
    applyClueUpdates(state, payload.memoryUpdates, {
        sourceMessageId: messageId,
        sourceSwipeId: swipeId,
    });
    let acceptedKnowledgeUpdates = 0;
    let rejectedKnowledgeUpdates = 0;
    for (const pending of pendingKnowledgeUpdates) {
        const person = state.people.find(item => item.id === pending.personId);
        if (!person) continue;
        for (const update of pending.updates) {
            const accepted = applyKnowledgeAcquisition(state, person, update, {
                messageId,
                narrativeText,
                foreground: pending.foreground,
            });
            if (accepted) acceptedKnowledgeUpdates += 1;
            else rejectedKnowledgeUpdates += 1;
        }
    }
    synchronizeCognitiveLedger(state);
    let acceptedInnerVoices = 0;
    let rejectedInnerVoices = 0;
    for (const pending of pendingKnowledgeUpdates) {
        const person = state.people.find(item => item.id === pending.personId);
        if (!person) continue;
        const hasCandidate = Boolean(
            asString(pending.rawPerson?.inner_voice ?? pending.rawPerson?.innerVoice, '', LIMITS.innerVoice)
        );
        if (!hasCandidate) continue;
        const accepted = commitSafeInnerVoice(state, person, pending.rawPerson, {
            worldMinute,
            allowUserInnerVoice,
        });
        if (accepted) acceptedInnerVoices += 1;
        else rejectedInnerVoices += 1;
    }
    if (acceptedKnowledgeUpdates || rejectedKnowledgeUpdates || acceptedInnerVoices || rejectedInnerVoices) {
        appendAudit(state, {
            type: 'cognition_firewall',
            text: `认知更新：知识接受 ${acceptedKnowledgeUpdates} · 拒绝 ${rejectedKnowledgeUpdates}；独白接受 ${acceptedInnerVoices} · 拒绝 ${rejectedInnerVoices}`,
            reason: rejectedKnowledgeUpdates || rejectedInnerVoices
                ? '缺少合法获知路径/证据，或独白引用了角色尚未掌握的幕后真相'
                : '全部通过角色认知边界校验',
        });
    }

    if (preserveCommitAnchor) {
        state.needsReconciliation = Boolean(baseState?.needsReconciliation);
        state.pendingSync = Boolean(baseState?.pendingSync);
        state.lastCommit = baseState?.lastCommit ? deepClone(baseState.lastCommit) : null;
    } else {
        state.needsReconciliation = false;
        state.pendingSync = false;
        state.lastCommit = {
            messageId,
            swipeId,
            sourceKey: asString(sourceKey, '', 180),
            at: worldMinute,
            committedAt: nowIso(),
        };
    }
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
    const state = settleTimedEvents(inputState, target, { source: 'manual', reason });
    state.clock.anchored = true;
    state.clock.precision = 'minute';
    return trimState(state);
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
    state.clock.anchored = true;
    state.clock.precision = 'minute';
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

export function buildInjectionPackage(state, settings = {}, recentText = '', { contextText = recentText } = {}) {
    if (!settings.enabled) {
        return { text: '', authorityText: '', supportText: '', eventIds: [] };
    }

    // 注入只决定“当前镜头能拿到什么”，不决定后台模块是否存在或运行。
    const worldRunning = settings.worldSimulationEnabled !== false
        && settings.worldPromptInjection !== false;
    const injectBackground = worldRunning && settings.injectionWorldBackground !== false;
    const injectPeople = worldRunning && settings.injectionPeople !== false;
    const injectEvents = worldRunning && settings.injectionEvents !== false;
    const injectEchoes = worldRunning && settings.injectionEchoes !== false;
    const injectFacts = worldRunning && settings.injectionFacts !== false;
    const injectMemory = settings.memorySystemEnabled !== false
        && settings.memoryPromptInjection !== false
        && settings.injectionMemory !== false;
    const timeMode = worldRunning && ['full', 'anchor', 'off'].includes(settings.injectionTimeMode)
        ? settings.injectionTimeMode
        : (worldRunning ? 'full' : 'off');

    if (
        !injectBackground
        && !injectPeople
        && !injectEvents
        && !injectEchoes
        && !injectFacts
        && !injectMemory
        && timeMode === 'off'
    ) {
        return { text: '', authorityText: '', supportText: '', eventIds: [] };
    }

    const clock = formatWorldCalendar(state);
    const people = injectPeople
        ? selectRelevantPeople(state, recentText)
            .filter(person => settings.recordPlayerCharacter !== false || !person?.isUser)
        : [];
    const rawContextReality = (injectEvents || injectFacts)
        ? selectContextRelevantReality(state, contextText, 9)
        : [];
    const eventContextText = `${recentText || ''}\n${contextText || ''}`.toLocaleLowerCase();
    const ongoingEvents = injectEvents
        ? asArray(state?.events)
            .filter(event => ACTIVE_EVENT_STATES.has(event?.status))
            .map(event => {
                const terms = [
                    event.title,
                    event.place,
                    ...(event.actors || []),
                ].map(value => String(value || '').trim().toLocaleLowerCase()).filter(value => value.length >= 2);
                let score = Number(event.updatedAt || event.startedAt || 0) / 1_000_000;
                if (terms.some(term => eventContextText.includes(term))) score += 100;
                if (event.delivery?.manualQueued) score += 80;
                return { event, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(item => item.event)
        : [];
    const contextReality = rawContextReality.filter(item => (
        (item.kind === 'world-fact' && injectFacts)
        || (item.kind !== 'world-fact' && injectEvents)
    ));
    const contextFactKeys = new Set(
        contextReality
            .filter(item => item.kind === 'world-fact' && String(item.id || '').startsWith('fact:'))
            .map(item => String(item.id).slice(5)),
    );
    const authoritativeFacts = injectFacts
        ? selectRelevantWorldFacts(state, recentText, 12)
            .filter(fact => !contextFactKeys.has(fact.key))
        : [];
    const deliveries = injectEchoes ? selectDeliveryCandidates(state, settings) : [];
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
        && !clue.archived
        && clue.status !== 'discarded'
    ));
    const sceneTiming = {
        strict: '只在转场、空档或角色自然能够接触信息时显露；当前场面不合适就继续延后。',
        smart: '关键场面中延后次要信息；只有直接影响眼前行动的结果可以自然进入。',
        open: '可以在场景中加入一条简短、自然的可感知变化，但不要后台播报。',
    }[settings.sceneTiming] || '只在自然时机显露，不要后台播报。';

    const authorityLines = ['<world_backstage_state>'];
    const supportLines = ['<world_backstage_support>'];

    if (injectBackground) {
        if (state.world?.background) {
            authorityLines.push(
                '世界背景基础约束（用户手动设定，不是动态剧情建议；不得被正文随意改写）：',
                modelText(state.world.background, 1600),
                '背景规则负责定义这个世界允许什么；若后续已经发生的权威世界事实明确改变了某个“状态”，以最新事实为准，但不得无因果违反背景中的底层规则。',
            );
        }
        authorityLines.push(`整体状态：${state.world.title}；${state.world.detail}`);
    }

    authorityLines.push(...buildClockAuthorityLines(state, clock, timeMode));

    if (people.length) {
        if (state.needsReconciliation) {
            authorityLines.push(
                '旧存档人物状态（等待一次前台重新校准）：',
                '这些状态来自升级前的后台记录；若与最近正文的明确事实冲突，以正文为准。首次成功世界推演后会重新结算为权威状态。',
            );
        } else {
            authorityLines.push(
                '当前人物权威状态（必须保持连续性；不等于主角知道全部后台信息）：',
                '若正文没有明确写出新的移动、离场、返回或状态变化，不得把人物无理由放到与这里冲突的位置；若正文明确发生了新变化，则按新变化继续，并由世界背面回写。',
            );
        }
        for (const person of people) {
            const boundary = person.knowledge === 'known' ? '可知' : '幕后';
            authorityLines.push(`- ${person.name}｜${person.location}｜${person.action}｜${boundary}`);
            const knownViews = [
                ...asArray(person.knownEventViews).map(view => ({
                    kind: '事件',
                    text: modelText(view?.summary, 220),
                    certainty: view?.certainty === 'suspected' ? '怀疑' : '确认',
                    updatedAt: Number(view?.updatedAt || view?.learnedAtMessageId || 0),
                })),
                ...asArray(person.knownFactBeliefs).map(belief => ({
                    kind: '事实',
                    text: modelText(belief?.value, 220),
                    certainty: belief?.certainty === 'suspected' ? '怀疑' : '确认',
                    updatedAt: Number(belief?.updatedAt || belief?.learnedAtMessageId || 0),
                })),
            ]
                .filter(item => item.text)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 3);
            if (knownViews.length) {
                authorityLines.push(
                    `  · ${person.name}本人已知/相信：${knownViews.map(item => `[${item.certainty}${item.kind}] ${item.text}`).join('；')}`,
                );
            }
        }
        if (people.some(person => (
            asArray(person.knownEventViews).length || asArray(person.knownFactBeliefs).length
        ))) {
            authorityLines.push('人物认知行是该人物已经获得的冻结版本：只允许对应人物据此判断和行动；“怀疑”不能写成确认，且不得用后台事件后来变化偷偷更新她尚未重新获知的版本。');
        }
    }

    if (ongoingEvents.length) {
        authorityLines.push(
            '当前相关进行中事件 / 暗流（它们在世界里客观存在，但不等于任何角色已经知道）：',
        );
        for (const event of ongoingEvents) {
            authorityLines.push(
                `- [${event.id}] ${event.title}｜${event.place}｜${event.summary || event.expectedResult || event.cause || '正在发展'}｜显露=${event.visibility}`,
            );
        }
        authorityLines.push('这些进行中事件只约束世界连续性；隐藏事件不得因此直接泄漏成角色知识或后台播报。');
    }

    if (contextReality.length) {
        authorityLines.push(
            '当前行动关联的世界现实（不是新闻播报任务，而是角色正生活其中的客观环境）：',
            '只要用户或角色当前提出的地点、行程、组织、行业或行动会被这些现实直接影响，本轮正文必须尊重它。公开可查的信息只有在角色有合理习惯/渠道得知时才可以由角色主动提醒或据此调整；角色尚不知情时，不要强塞知识，而应让客观后果在实际接触时自然体现。绝不能替玩家决定已经看过新闻或已经知道。',
        );
        for (const reality of contextReality) {
            const sourceLabel = {
                'public-event': reality.temporalState === 'upcoming' ? '即将发生的公开预告' : '当前公开世界事件',
                'world-pulse': '当前世界环境',
                'world-fact': reality.temporalState === 'historical'
                    ? '当前对话明确重新提及的历史事实'
                    : reality.temporalState === 'upcoming'
                        ? '与当前计划相关的未来事实'
                        : '当前权威世界事实',
            }[reality.kind] || '世界现实';
            authorityLines.push(`- ${sourceLabel}｜${reality.label}：${reality.state}`);
        }
        authorityLines.push(
            '例如目的地正在暴雨/封路，正文不能照常写成晴天畅通；知情且会关注此事的角色可以自然提醒带伞、改路线或调整计划，不知情角色则可以到场后才发现。保持角色个性，不要机械复述上述句子。',
        );
    }

    if (authoritativeFacts.length) {
        authorityLines.push(
            '已结算世界事实（这是世界客观状态，不是可选剧情建议；必须保持一致，但角色是否知道仍看认知边界）：',
        );
        for (const fact of authoritativeFacts) {
            const subject = fact.subject || fact.subjectId || '世界';
            authorityLines.push(`- ${subject}｜${fact.field}：${fact.value}｜显露=${fact.visibility}`);
        }
        authorityLines.push('显露度只决定这些事实如何进入镜头，不决定它们是否存在。隐藏事实可以约束连续性，但不得因此让不知情角色突然知晓。');
    }

    if (knownFacts.length || knownClues.length) {
        supportLines.push('与当前场景相关、且角色已经有资格知道的长期记忆：');
        for (const fact of knownFacts) {
            const qualifier = fact.status === 'disputed' ? '（说法有争议，不可当成定论）' : '';
            supportLines.push(`- 事实｜${fact.subject || fact.key}｜${fact.predicate || '相关信息'}：${fact.value}${qualifier}`);
        }
        for (const clue of knownClues) {
            supportLines.push(`- 线索｜${clue.title}：${clue.text}`);
        }
        supportLines.push('只用于维持回忆、承诺与前后呼应；不得把未列出的隐藏记忆补写成角色知识。');
    }

    if (deliveries.length) {
        supportLines.push('本轮由用户点名或系统选中的可自然显露事件：');
        for (const event of deliveries) {
            const route = event.delivery.route || event.result || event.consequence || event.summary;
            const request = event.delivery?.manualQueued ? '用户要求下一轮优先显露' : '系统候选';
            supportLines.push(`- [${event.id}] ${event.title}：${route}（${event.visibility}；${request}）`);
        }
        supportLines.push(`显露节奏：${sceneTiming}`);
        supportLines.push('只把真正写进正文、被角色感知或留下可见痕迹的结果视为已承接；不要声称“后台已递交”。');
    }

    if (authorityLines.length > 1) {
        authorityLines.push('禁止提及“世界背面”、状态表、注入块或幕后独白。');
        authorityLines.push('</world_backstage_state>');
    }
    const supportHasContent = supportLines.length > 1;
    if (supportHasContent) {
        supportLines.push('辅助信息只用于自然承接和长期连续性；不得覆盖上面的权威世界状态。');
        supportLines.push('</world_backstage_support>');
    }

    const compactLayer = (sourceLines, maximumCharacters, closingTag) => {
        if (sourceLines.length <= 1) return { text: '', omitted: 0 };
        const kept = [];
        let usedCharacters = 0;
        for (const line of sourceLines) {
            const addition = line.length + (kept.length ? 1 : 0);
            if (usedCharacters + addition > maximumCharacters) break;
            kept.push(line);
            usedCharacters += addition;
        }
        const originalKeptCount = kept.length;
        if (originalKeptCount < sourceLines.length) {
            if (kept.at(-1) === closingTag) kept.pop();
            const notice = '（其余低相关信息已压缩省略，禁止自行补全。）';
            while (kept.length > 1 && [...kept, notice, closingTag].join('\n').length > maximumCharacters) {
                kept.pop();
            }
            kept.push(notice, closingTag);
        }
        return {
            text: kept.join('\n'),
            omitted: Math.max(0, sourceLines.length - originalKeptCount),
        };
    };

    const authority = compactLayer(authorityLines, 4600, '</world_backstage_state>');
    const support = supportHasContent
        ? compactLayer(supportLines, 1100, '</world_backstage_support>')
        : { text: '', omitted: 0 };

    return {
        text: [support.text, authority.text].filter(Boolean).join('\n\n'),
        authorityText: authority.text,
        supportText: support.text,
        eventIds: deliveries.map(event => event.id),
        omittedLines: authority.omitted + support.omitted,
    };
}

function modelText(value, maximum) {
    return asString(value, '', maximum);
}

export function planMemoryRollup(state) {
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    for (const sourceLevel of [MEMORY_SUMMARY_LEVELS.CHAPTER, MEMORY_SUMMARY_LEVELS.STAGE, MEMORY_SUMMARY_LEVELS.DETAIL]) {
        const threshold = MEMORY_ROLLUP_THRESHOLDS[sourceLevel];
        const candidates = memory.summaries
            .filter(summary => (
                summary.hierarchyManaged
                && !summary.manual
                && Number(summary.level) === sourceLevel
                && summary.retentionState !== 'compacted'
                && !summary.parentId
            ))
            .sort((a, b) => (
                Number(a.startMessageId || 0) - Number(b.startMessageId || 0)
                || Number(a.endMessageId || 0) - Number(b.endMessageId || 0)
            ));
        if (candidates.length < threshold) continue;
        const sources = candidates.slice(0, threshold);
        return {
            sourceLevel,
            targetLevel: Math.min(MEMORY_SUMMARY_LEVELS.LONG_TERM, sourceLevel + 1),
            threshold,
            sourceSummaryIds: sources.map(summary => summary.id),
            summaries: sources,
        };
    }
    return null;
}

export function buildMemoryRollupPrompt(state, plan, { compact = false } = {}) {
    const sourceLevel = asInteger(plan?.sourceLevel, 0, 0, 2);
    const targetLevel = Math.min(3, sourceLevel + 1);
    const sourceIds = new Set(asArray(plan?.sourceSummaryIds));
    const memory = normalizeStoryMemory(state?.storyMemory, state?.clock?.absoluteMinute || 0);
    const sources = memory.summaries
        .filter(summary => sourceIds.has(summary.id))
        .sort((a, b) => Number(a.startMessageId) - Number(b.startMessageId));
    if (!sources.length) throw new Error('没有可压缩的下层记忆');
    const levelNames = ['单轮片段', '阶段小结', '章节总结', '长期经历'];
    const lengthRule = compact
        ? 'summary 控制在 180—320 字，只保留真正会影响未来理解的变化。'
        : targetLevel === MEMORY_SUMMARY_LEVELS.STAGE
            ? 'summary 约 220—420 字。'
            : targetLevel === MEMORY_SUMMARY_LEVELS.CHAPTER
                ? 'summary 约 320—600 字。'
                : 'summary 约 420—800 字，强调长期关系、目标、转折与仍未结束的线索。';
    const payload = sources.map(summary => ({
        id: summary.id,
        level: summary.level,
        title: summary.title,
        summary: modelText(summary.summary, 1200),
        start_message_id: summary.startMessageId,
        end_message_id: summary.endMessageId,
        people: summary.people,
        locations: summary.locations,
        tags: summary.tags,
    }));
    return [
        '你是“世界背面”的长期记忆压缩员。这里只做档案压缩，不续写剧情、不推演未来、不修改任何事实。',
        `请把下面 ${sources.length} 条 ${levelNames[sourceLevel]} 压成 1 条 ${levelNames[targetLevel]}。`,
        '要求：',
        '1. 只能使用给出的下层摘要；禁止补写不存在的情节。',
        '2. 优先保留关系变化、长期目标、承诺、关键转折、持续冲突、重要物品与未解决问题。普通动作、重复气氛和已经失效的枝节可以舍弃。',
        '3. 新摘要是上层长期索引。source_summary_ids 与消息范围会保留，但普通下层摘要在建立上层后可能被压成轻量占位；因此真正会影响未来理解的细节必须进入上层，不重要的枝节可以主动放下。',
        '4. people / locations / tags 只保留真正贯穿这一段的重要项。',
        `5. ${lengthRule}`,
        '6. 只返回合法 JSON，不要代码围栏和解释。',
        '',
        `来源层级：L${sourceLevel} ${levelNames[sourceLevel]}`,
        `目标层级：L${targetLevel} ${levelNames[targetLevel]}`,
        '下层记忆：',
        JSON.stringify(payload),
        '',
        '返回结构：',
        JSON.stringify({
            summary_rollup: {
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            },
        }),
    ].join('\n');
}

export function applyMemoryRollupResult(inputState, rawPayload, plan = {}) {
    const state = deepClone(inputState);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);
    const sourceIds = new Set(asArray(plan?.sourceSummaryIds));
    const sources = state.storyMemory.summaries
        .filter(summary => sourceIds.has(summary.id))
        .sort((a, b) => Number(a.startMessageId) - Number(b.startMessageId));
    if (!sources.length) return trimState(state);
    if (sources.some(summary => summary.parentId)) return trimState(state);
    const sourceLevel = asInteger(plan?.sourceLevel, sources[0]?.level ?? 0, 0, 2);
    if (sources.some(summary => Number(summary.level) !== sourceLevel)) return trimState(state);
    const raw = rawPayload?.summary_rollup ?? rawPayload?.summaryRollup ?? rawPayload;
    const summaryText = asString(raw?.summary, '', 1800);
    if (!summaryText) return trimState(state);
    const targetLevel = Math.min(MEMORY_SUMMARY_LEVELS.LONG_TERM, sourceLevel + 1);
    const first = sources[0];
    const last = sources.at(-1);
    const id = normalizeId(
        raw?.id || `summary_L${targetLevel}_${first.startMessageId}_${last.endMessageId}_${hashText(sources.map(item => item.id).join('|'))}`,
        'summary',
    );
    const existing = state.storyMemory.summaries.find(summary => summary.id === id);
    const normalized = normalizeStorySummary({
        ...raw,
        id,
        summary: summaryText,
        level: targetLevel,
        hierarchy_managed: true,
        source_summary_ids: sources.map(summary => summary.id),
        start_message_id: first.startMessageId,
        end_message_id: last.endMessageId,
        important: sources.some(summary => summary.important),
    }, existing);
    if (existing) Object.assign(existing, normalized);
    else state.storyMemory.summaries.push(normalized);
    for (const source of sources) source.parentId = normalized.id;
    compactRolledUpSources(state, normalized, sources, {
        sourceMessageId: last.endMessageId,
    });
    state.storyMemory.lastMetabolismMessageId = Math.max(
        Number(state.storyMemory.lastMetabolismMessageId || -1),
        Number(last.endMessageId || -1),
    );
    state.revision = asInteger(state.revision, 0, 0) + 1;
    state.updatedAt = nowIso();
    appendAudit(state, {
        type: 'memory_rollup',
        text: `记忆压缩完成 · L${sourceLevel} → L${targetLevel}`,
        reason: `${sources.length} 条下层经历已建立可追溯上层索引`,
    });
    return trimState(state);
}

function memoryTerms(item) {
    return uniqueStrings([
        item?.subject || '',
        item?.predicate || '',
        ...(item?.people || []),
        ...(item?.locations || []),
        ...(item?.events || []),
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
    if (item?.status === 'developing' || item?.status === 'echoed') score += 6;
    if (item?.status === 'triggered') score += 9;
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
        .filter(clue => !clue.archived && !['resolved', 'discarded'].includes(clue.status))
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
            events: clue.events,
            tags: clue.tags,
            status: clue.status,
            importance: clue.importance,
            visibility: clue.visibility,
            source_message_id: clue.sourceMessageId,
            source_swipe_id: clue.sourceSwipeId,
            resolution: modelText(clue.resolution, 260),
        }));
    const scoredSummaries = memory.summaries
        .filter(summary => summary.retentionState !== 'compacted')
        .map(summary => ({
            summary,
            score: memoryMatchScore(summary, narrativeText, { referenceMessageId }),
        }));
    const anchors = [];
    for (const level of [MEMORY_SUMMARY_LEVELS.LONG_TERM, MEMORY_SUMMARY_LEVELS.CHAPTER]) {
        const newest = scoredSummaries
            .filter(item => Number(item.summary.level) === level)
            .sort((a, b) => Number(b.summary.endMessageId) - Number(a.summary.endMessageId))[0];
        if (newest) anchors.push(newest);
    }
    if (!anchors.length) {
        const newestStage = scoredSummaries
            .filter(item => Number(item.summary.level) === MEMORY_SUMMARY_LEVELS.STAGE)
            .sort((a, b) => Number(b.summary.endMessageId) - Number(a.summary.endMessageId))[0];
        if (newestStage) anchors.push(newestStage);
    }
    const anchorIds = new Set(anchors.map(item => item.summary.id));
    const recalled = scoredSummaries
        .filter(item => !anchorIds.has(item.summary.id))
        .sort((a, b) => (
            b.score - a.score
            || Number(b.summary.level || 0) - Number(a.summary.level || 0)
            || b.summary.endMessageId - a.summary.endMessageId
        ))
        .slice(0, Math.max(0, maximumSummaries));
    const summaries = [...anchors, ...recalled]
        .map(({ summary }, index) => ({
            id: summary.id,
            title: modelText(summary.title, 100),
            summary: modelText(summary.summary, Number(summary.level) >= 2 ? 900 : 720),
            level: summary.level,
            memory_role: index < anchors.length ? 'anchor' : 'recall',
            parent_id: summary.parentId || '',
            source_summary_ids: summary.sourceSummaryIds,
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


export function buildWorldBootstrapPrompt(state, {
    messages = [],
    userName = '',
    playerIdentityAnchor = '',
    recordPlayerCharacter = true,
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
                    ? (message?.role === 'user' ? 2200 : 3800)
                    : (message?.role === 'user' ? 3600 : 6200),
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
    const identityAnchor = modelText(playerIdentityAnchor, 400);
    const compactState = compactStateForModel(state, {
        includeUserInnerVoice: false,
        includeUserCharacter: recordPlayerCharacter,
        userName,
        maximumPeople: compactMode ? 12 : 22,
    });
    const existingMemory = selectRelevantStoryMemory(state, sourceText, {
        maximumFacts: compactMode ? 10 : 24,
        maximumClues: compactMode ? 8 : 18,
        maximumSummaries: compactMode ? 2 : 5,
    });
    const outputRule = compactMode
        ? '极简重试：每条单轮摘要不超过90字；人物最多8名、未完暗流最多5条、世界事实最多8条、世界脉搏最多5项；无变化数组返回空数组。'
        : '输出要克制：只恢复对当前世界仍有价值的内容。人物最多16名、未完暗流最多10条、世界事实最多16条、世界脉搏最多8项；不要把历史流水账重新复制一遍。';

    return [
        '你是“世界背面”的历史回溯引擎。目标是让插件在长聊天中途启用时，能够接上此前已经真实发生的世界，而不是重新创作一份过去。',
        '',
        '总原则：恢复证据支持的世界，不补写隐藏历史，不推演未来。',
        compactState.world.background
            ? `当前已有用户维护的世界背景设定：${compactState.world.background}`
            : '当前没有额外填写世界背景设定。',
        '世界背景设定不是历史回溯的输出字段，也不能由聊天回溯覆盖；历史只能在这份地基上恢复已经发生的状态。',
        '1. 本批每条 assistant 正文仍要生成一条 turn_summaries L0 摘要；同时整理长期记忆 facts/clues。',
        recordPlayerCharacter
            ? '2. people_upsert 恢复截至本批末尾仍有意义的人物当前状态：最后可靠位置、行动/处境、长期目标与已明确状态。只写正文有证据的内容；不得根据外貌猜身份，不得替玩家补内心。'
            : '2. people_upsert 只恢复 NPC / 非玩家人物。玩家角色当前设置为“不记录”，禁止为玩家建立或更新人物卡；玩家已经发生的行动仍可沉淀为事件、世界事实和长期记忆。',
        '3. events_create 只恢复“到本批末尾仍未解决”的过程、承诺、计划、威胁、调查、旅程、任务、环境压力等。已经明确结束的旧事件不要重新挂回暗流；它们应沉淀为 world_facts_upsert / 长期记忆。',
        '3A. 如果上一批已经恢复的 existing event 在本批历史里继续推进、完成、取消或错过，必须用 events_update 更新原 ID。特别是已经结束的事件必须给 terminal status + result，不能因为它曾经未完成就让它错误地一直挂到当前时间。',
        '4. world_facts_upsert 恢复已经客观成立、会约束后续世界的一致性事实。正文传闻、角色误解、未经确认的猜测不能升级为世界事实。必须标 validity：current=截至本批末尾仍成立，upcoming=已明确预定但尚未发生，historical=已经结束，persistent=起因结束但后果仍持续。',
        '5. world_pulse_upsert 建立宏观社会基线：环境/天气趋势、地区状态、组织/势力方向、经济资源、基础设施、治安、文化媒体、社区压力。只能依据正文已经体现的世界设定与持续条件，不得凭空补出“其实过去还发生过”的事件。',
        '6. 绝对时间由插件代码从历史正文确定性解析。clock_anchor.mode 必须返回 none；不要猜年月日、星期或钟点。历史回溯只恢复正文已经发生的状态。',
        '7. world.title/detail 可以把已经明确的当前世界态势压成一个简短基线，但不能写未来预测。',
        '8. 公开性必须严格，而且与 visibility 分开：正文/角色已经看见某件事，不代表社会知道。只有历史里明确出现公告、媒体报道、论坛传播、公众可见现象或广泛传播渠道时，才设置 publicity=trace/public。私密事件保持 publicity=private，即使 visibility=direct。',
        '9. 不生成舆情帖子。若历史已经明确存在公开渠道，只恢复 publicity/public_trace；只有已经真正公开成可报道事实时才可补 public_headline/public_summary，且只能写公众当时能知道的内容。若历史明确记录了公开终局，可填写 public_result；否则不要把最后一次报道误当终局。',
        '10. 用户手动/世界书人物属于作者资产。已有 author_managed/locked_profile 的稳定设定不可改写；只能用历史证据补动态状态。',
        '10A. 历史回溯中的人物认知也必须走 knowledge_updates。只有本批历史正文明确证明人物亲历、被告知、调查、收到消息或确实接触公开渠道时才恢复认知；evidence 必须复制本批原文短句。不要因为人物参与某事件、和事件同地点、或名字出现在摘要里就推断她知道幕后真相。',
        '11. 同一人物/事件/事实尽量沿用已有 id/key，避免每批重复创建。',
        '12. 只输出合法 JSON，不要 Markdown、解释或代码围栏。',
        `13. ${outputRule}`,
        '',
        `玩家角色名：${modelText(userName, 80) || '未提供'}。`
            + (identityAnchor
                ? ` 玩家身份锚点：${identityAnchor}。必须逐项遵守。`
                : ' 未设置玩家身份锚点；没有明确证据时使用中性表述。'),
        `本批范围：消息 ${startMessageId}—${endMessageId}`,
        '',
        '本批正文：',
        sourceText || '（没有正文）',
        '',
        '截至上一批已经建立的世界（用于延续、去重与覆盖旧状态）：',
        JSON.stringify(compactState),
        '',
        '已有相关记忆（用于延续稳定 key / clue id）：',
        JSON.stringify(existingMemory),
        '',
        '返回结构：',
        JSON.stringify({
            memory_digest: {
                text: '',
                through_message_id: endMessageId,
            },
            turn_summaries: [{
                id: 'summary_l0_message_id',
                source_message_id: endMessageId,
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            }],
            chapter_summary: null,
            facts_upsert: [{
                key: '',
                subject: '',
                predicate: '',
                value: '',
                source_message_id: startMessageId,
                source_excerpt: '',
            }],
            facts_invalidate: [],
            clues_upsert: [{
                id: '',
                title: '',
                text: '',
                source_message_id: startMessageId,
                source_excerpt: '',
                people: [],
                locations: [],
                events: [],
                tags: [],
                status: 'open | developing | triggered',
            }],
            clues_resolve: [],
            clock_anchor: {
                mode: 'none | initialize | calibrate',
                calendar_name: '',
                year: null,
                month: null,
                day: null,
                hour: null,
                minute: null,
                precision: 'minute | daypart | date',
                confidence: 'low | medium | high',
                source_excerpt: '',
                reason: '',
            },
            world: {
                title: '',
                detail: '',
            },
            people_upsert: [{
                id: '',
                name: '',
                is_user: false,
                location: '',
                action: '',
                intent: '',
                long_term_goal: '',
                physical_state: '',
                emotional_state: '',
                resource_state: '',
                knowledge_updates: [{
                    kind: 'event | fact | clue',
                    ref: '事件ID / 事实key / 线索ID',
                    route: 'witnessed | told | investigated | message | public_channel | inferred',
                    certainty: 'confirmed | suspected',
                    evidence: '必须复制本批历史正文中能证明获知路径的短句',
                    belief: '人物当时实际知道/相信的版本',
                    source_event_id: '',
                }],
                relevance: 1,
                source: 'foreground',
                present_in_scene: false,
                last_seen_message_id: endMessageId,
            }],
            events_create: [{
                id: '',
                title: '',
                place: '',
                summary: '',
                consequence: '',
                expected_result: '',
                clock_mode: 'condition | duration | scheduled | active',
                duration_minutes: 0,
                scheduled_at: null,
                prerequisites: [],
                cause: '',
                actors: [],
                caused_by: [],
                publicity: 'private | trace | public',
                public_trace: '',
                public_headline: '',
                public_summary: '',
                public_result: '',
                visibility: 'hidden | trace | known | direct',
                delivery_route: '',
            }],
            events_update: [{
                id: '必须沿用上一批已有事件 id',
                status: 'active | waiting | ready | resolved | cancelled | missed',
                result: '',
                summary: '',
                consequence: '',
                cause: '',
                actors: [],
                publicity: 'private | trace | public',
                public_trace: '',
                public_headline: '',
                public_summary: '',
                public_result: '',
                visibility: 'hidden | trace | known | direct',
            }],
            world_facts_upsert: [{
                key: '',
                subject_type: 'person | event | world | location | item | organization | other',
                subject_id: '',
                subject: '',
                field: '',
                value: '',
                source: 'foreground',
                validity: 'current | upcoming | historical | persistent',
                visibility: 'hidden | trace | known | direct',
                confidence: 'high',
                message_id: endMessageId,
            }],
            world_pulse_upsert: [{
                id: '',
                label: '',
                scope: '',
                kind: 'environment | government | economy | organization | infrastructure | security | culture | media | community | other',
                state: '',
                pressure: 1,
                trend: 'stable | rising | falling | volatile',
                visibility: 'hidden | trace | known',
                source: 'history',
                evidence: '',
            }],
        }),
    ].join('\n');
}

export function applyWorldBootstrapResult(inputState, rawPayload, {
    startMessageId = 0,
    endMessageId = 0,
    narrativeText = '',
    userName = '',
    allowUserInnerVoice = false,
    recordPlayerCharacter = true,
    memoryEnabled = true,
} = {}) {
    let state = deepClone(inputState);

    if (memoryEnabled) {
        state = applyHistoryIndexResult(state, rawPayload, {
            startMessageId,
            endMessageId,
        });
    }

    const simulationPayload = {
        elapsed_minutes: 0,
        time_reason: '历史回溯只建立当前世界基线，不按批次额外推进时间',
        clock_anchor: rawPayload?.clock_anchor ?? rawPayload?.clockAnchor ?? { mode: 'none' },
        world: rawPayload?.world ?? {},
        people_upsert: rawPayload?.people_upsert ?? rawPayload?.peopleUpsert ?? [],
        people_remove: [],
        events_create: rawPayload?.events_create ?? rawPayload?.eventsCreate ?? [],
        events_update: rawPayload?.events_update ?? rawPayload?.eventsUpdate ?? [],
        deliveries_confirmed: [],
        front_facts: [],
        world_facts_upsert: rawPayload?.world_facts_upsert ?? rawPayload?.worldFactsUpsert ?? [],
        world_pulse_upsert: rawPayload?.world_pulse_upsert ?? rawPayload?.worldPulseUpsert ?? [],
        consistency_conflicts: [],
        memory_update: {
            facts_upsert: [],
            facts_invalidate: [],
            clues_upsert: [],
            clues_resolve: [],
        },
    };

    state = applySimulationResult(state, simulationPayload, {
        messageId: endMessageId,
        swipeId: 0,
        sourceKey: `history-bootstrap:${startMessageId}:${endMessageId}`,
        userName,
        allowUserInnerVoice,
        recordPlayerCharacter,
        timePolicy: 'world',
        narrativeText,
        backgroundNpcBudget: LIMITS.peopleTaskBudget,
    });

    state.worldPulse = normalizeWorldPulse(state.worldPulse, state.clock.absoluteMinute);
    state.worldPulse.baselineEstablished = true;
    state.worldPulse.lastSweepAt = state.clock.absoluteMinute;
    recordProcessedPublicImpacts(
        state,
        state.events.filter(eventHasPublicPropagation),
        [],
        { reason: 'history-bootstrap-baseline' },
    );
    appendAudit(state, {
        type: 'world_history_bootstrapped',
        text: `历史回溯已接入消息 ${startMessageId}—${endMessageId}`,
        reason: '建立人物、世界事实、未完暗流、宏观世界脉搏与长期记忆基线',
    });
    return trimState(state);
}

export function buildWorldPulsePrompt(state, {
    activity = 'natural',
    reason = 'world-clock-advanced',
    backgroundNpcBudget = 4,
    publicCycle = false,
    customInstruction = '',
    enhancedBackgroundSimulation = false,
    backgroundPersonTargets = [],
    worldCoverageTargets = [],
    recordPlayerCharacter = true,
} = {}) {
    const compact = compactStateForModel(state, {
        includeUserInnerVoice: false,
        includeUserCharacter: recordPlayerCharacter,
        allowExpandedPeopleContext: true,
        priorityPersonIds: asArray(backgroundPersonTargets).map(item => String(item?.id || '')).filter(Boolean),
        maximumPeople: enhancedBackgroundSimulation
            ? Math.max(12, Number(backgroundNpcBudget) * 2 + 4)
            : Math.max(10, Number(backgroundNpcBudget) + 8),
    });
    const activityRule = {
        quiet: '安静：主要推进已存在的压力和到期事件，新公共事件极少。',
        natural: '自然：合理维护社会、地区、环境、组织与资源变化；普通地方事件可以自然出现，重大新闻稀少。',
        busy: '活跃：允许更多并行的地方/行业/组织变化，但仍禁止无因果的大灾难和巧合。',
    }[activity] || '自然：合理维护镜头外世界。';

    const publicCycleRule = publicCycle
        ? '本次同时是“公共世界循环”：用户正在刷新真实世界新闻。请巡查指定的镜头外范围，并从既有世界脉搏、地区/行业/组织状态和时代常态判断这段世界时间是否自然形成 0—3 条公共变化。没有变化可以保持安静；有变化时优先天气、交通、商业、活动、行业、政策执行、设施、治安、文化娱乐等普通新闻。不要求与主角有关，也绝不能为了填新闻硬造灾难。创建可报道事件时 publicity=public，并填写只含公众可知信息的 public_headline/public_summary。'
        : '按正常世界脉搏运行；没有自然变化时可以不新建事件。';
    const customRule = modelText(customInstruction, 1000);
    const coverageTargets = asArray(worldCoverageTargets)
        .filter(item => item?.id && item?.label)
        .slice(0, 4)
        .map(item => ({
            id: asString(item.id, '', 120),
            label: asString(item.label, '', 120),
            kind: asString(item.kind, 'general', 40),
            scope: asString(item.scope, '', 160),
            source: asString(item.source, 'world', 40),
            last_checked_at: asInteger(item.lastCheckedAt, -1, -1),
        }));
    const coverageRule = coverageTargets.length
        ? `本轮镜头外覆盖检查：${JSON.stringify(coverageTargets)}。这些是“必须检查是否变化”的世界范围，不是“必须制造事件”的配额。逐项查看世界背景、world_pulse、已有事实、时间与因果；有自然变化才更新状态或创建事件，没有就保持原样。不能用当前剧情中的相近事件冒充已经检查。`
        : '本轮没有额外覆盖范围；按既有世界脉搏正常检查。';
    const pendingPublicImpactSources = publicCycle
        ? pendingPublicImpactEvents(state, { maximum: 8 }).map(event => ({
            id: event.id,
            place: modelText(event.place, 120),
            publicity: event.publicity,
            public_trace: modelText(event.publicTrace, 260),
            public_headline: modelText(event.publicHeadline, 180),
            public_summary: modelText(event.publicSummary, 520),
            public_result: modelText(event.publicResult, 520),
            actors: asArray(event.actors).slice(0, 12),
        }))
        : [];
    const integratedPublicImpactRule = publicCycle
        ? [
            `本轮还必须在同一次请求里结算这些尚未传播完成的公开事件：${JSON.stringify(pendingPublicImpactSources)}。`,
            '对已有待传播事件和本轮新建/更新的 public/trace 事件，同时检查地点、交通、设施、行业、组织、资源和人物是否受到直接客观影响。客观后果写 world_facts_upsert / world_pulse_upsert / events_create/update，人物实际状态变化写 people_upsert。',
            '公共影响必须先过“接触链”校验：物理链=人物确实处在受影响地点/行程/设施；信息链=她实际接触新闻、公告、职业通知、消息或可信社交转述；因果链=她的组织、工作、合同、资源、关系或共同事件确实被上游变化牵动。至少一条链成立才更新该人物；链路断裂就让她继续自己的生活。',
            '人物只有通过现场感知、新闻、公告、职业通知或真实社交传播接触到信息时，才可通过 knowledge_updates 增加认知，并写清 public_channel、evidence 与 source_event_id。公开不等于全员自动知道。',
            '同一公共变化若同时波及多人，先结算一份共享世界后果，再让每个实际受影响者按自己的位置、职责、关系和已知信息分别反应；共同行动只用一条 actors 完整的事件承接，不能复制成互相矛盾的个人小剧场。',
            '声誉与圈层反应也受可见性限制：只有目击、物证、公告、媒体或有效传闻真正进入对应圈层时才产生社会评价；官方、民间、行业、组织内部可以形成不同判断，任何圈层意见都不能反向改写客观事实。',
            '这是公共巡查与直接影响的一体结算，不要只创建新闻事件而把已经确定的直接世界后果留给另一轮 API。没有直接影响可以不写。',
        ].join('\n')
        : '本轮不是公共世界循环，不额外承担公共传播影响批处理。';
    const targetList = asArray(backgroundPersonTargets)
        .filter(item => item?.id)
        .slice(0, asInteger(backgroundNpcBudget, 4, 0))
        .map(item => ({
            id: asString(item.id, '', 100),
            name: asString(item.name, '', 80),
            overdue_minutes: asInteger(item.overdueMinutes, 0, 0),
            priority_reason: ['manual-next', 'starvation-guard', 'manual-now', 'due'].includes(item?.priorityReason)
                ? item.priorityReason
                : 'due',
        }));
    const manualCatchUp = targetList.some(item => item.priority_reason === 'manual-now');
    const enhancedBackgroundRule = targetList.length
        ? [
            manualCatchUp
                ? `用户正在手动补推演指定人物。本轮必须且只需完成人物生活结算名单：${JSON.stringify(targetList)}。`
                : enhancedBackgroundSimulation
                    ? `强化后台人物推演已开启。本轮必须结算 ${targetList.length} 名优先人物：${JSON.stringify(targetList)}。`
                    : `后台人物保底调度触发。本轮必须结算 ${targetList.length} 名优先人物：${JSON.stringify(targetList)}。manual-next=用户要求下一轮优先；starvation-guard=已经连续超过三个生活周期未结算。`,
            '这些人物不是可选参考。逐个检查她们经过这段世界时间后现在在哪里、在做什么、短期意图如何，必要时同步身体/情绪/资源状态；即使没有戏剧性事件，也必须在 people_upsert 中返回每个人的自然当前状态。不得只顾当前与玩家同场的人。',
            manualCatchUp
                ? '这是单人物补结算：people_upsert 只允许写指定人物。可以更新与她直接相关、且截至当前世界时间确实已经发生变化的既有事件/世界事实；不得顺手推进无关人物、无关地区或制造随机公共新闻。elapsed_minutes 必须为 0。'
                : '先完成这些人物的生活结算，再处理其他世界脉搏变化；不要为了交作业额外制造与她们无关的随机事故或新闻。',
        ].join('\n')
        : '本轮没有必须优先结算的后台人物；仍按普通生活到期规则处理镜头外人物。';
    const groupLifeRule = manualCatchUp
        ? [
            '群体生活边界：指定人物仍然活在关系和社会环境里。先检查她与同地人物、共同事件、组织/工作、既有关系和日程是否存在自然交集；可以让这些交集影响指定人物的行动、意图、状态及相关事件。',
            '但这是单人物补结算，不能越权改写其他人物卡。若发生交流，事件 actors 要列出真实参与者，指定人物的 knowledge_updates 要写清 told/message/witnessed 的来源；不得因为别人知道就让她自动知道。',
        ].join('\n')
        : [
            '群体生活协调：人物不是彼此隔离的状态卡。结算必做人物前，先按“精确地点与时间是否重合、共同事件、同一组织/工作、既有关系与约定”识别本轮自然形成的小群体；先结算共同经历，再结算个人余下日常。',
            '交互必须存在可说明的接触链：物理链（确实同地同时间或行程相遇）、信息链（消息/通知/转述实际送达）、因果链（共同事件、组织职责、合同资源或既有关系真正牵连）。只写“同城、同组织、认识彼此”不算链路已经成立。',
            '不能只因同属一座城市或同一组织就强行见面，也不能为了热闹把人瞬移到一起。没有自然交集的人完全可以继续各自的普通生活；人物不应默认围着 user 转。',
            '一旦本轮确实发生多人互动，必须留下对称结果：所有实际参与者都计入 backgroundNpcBudget 并出现在 people_upsert；共同行动用同一条既有事件更新或一条 actors 完整的新事件承接，不能只改一方。若预算容不下所有参与者，就不要把互动写成已经完成，可只保留尚未发生的联系意图/等待条件。',
            '交流不会自动共享全部知识。每个接收者只为实际听见、看见、收到或合理推断的内容分别提交 knowledge_updates，并保留 route、evidence、source_event_id；同地、亲密或同组织都不等于全知。',
        ].join('\n');

    return [
        '你是“世界背面”的世界脉搏引擎。本次没有新的小说正文；主世界时钟已经由用户或系统推进或正在进行一次明确的公共世界刷新。你只根据当前权威世界状态，结算到期变化并让镜头外世界按因果继续。',
        compact.world.background
            ? `世界背景设定（用户维护、不可由推演改写）：${compact.world.background}`
            : '世界背景设定：未额外填写。',
        '所有自主变化都必须发生在这份背景允许的世界里。背景里的规则/时代/地理/势力/时间线是生成边界；世界可以发展，但不能为了制造事件绕开底层规则。',
        `本次触发原因：${modelText(reason, 120)}。世界脉搏活跃度：${activityRule}`,
        `公共世界循环：${publicCycleRule}`,
        customRule
            ? `用户自定义世界侧重点：${customRule}\n这条要求也适用于镜头外公共世界。若它指定了新闻地区、行业、组织、主题或日常世界动向，必须从世界背景、world_pulse 与既有因果中单独检查，不能拿一条恰好与当前剧情有关的公开事件敷衍替代。它只调整关注与采样方向，不能覆盖既有事实、时间、知识边界或强行制造无因果事件。`
            : '用户没有追加自定义世界侧重点。',
        coverageRule,
        integratedPublicImpactRule,
        enhancedBackgroundRule,
        groupLifeRule,
        '规则：',
        '1. elapsed_minutes 必须返回 0；时间已经在调用前推进完毕，不得再次加时。',
        '2. 先检查 existing events 是否到期、条件是否满足、持续过程是否应该结算；需要时用 events_update。同一场持续中的公共事件（例如同一地区暴雨、同一案件、同一行业风波）有新进展时优先更新原 event 的 public_headline/public_summary/status，而不是另建一条近义重复新闻；只有真正独立的新事件才 events_create。事件在本轮终结且终局已经公开时必须填写 public_result；若终局尚未公开则留空，不能拿旧 public_summary 假装最终结果。',
        '3. 再检查 world_pulse、人物长期目标、势力/地区/环境压力是否自然产生下一步。可以 events_create，但不得因为“没有正文”就硬造事件。',
        '3A. compact people 中 life_tick_due_minutes>0 的人物已经有一段世界时间没有进行个人生活结算。优先处理最逾期的后台人物：从她原本的位置、工作/日程、长期目标、关系、身体情绪和资源继续；没有大事时就写普通生活推进，不要为了让她“有发展”强制造戏。若上方给出了“本轮必须结算人物”，这些人物必须逐个出现在 people_upsert，不能只处理当前场景人物。',
        '3B. 多人共同经历不能被拆成互相矛盾的独立小剧场。共同地点、动作、事件状态与信息传递必须互相对得上；一个人已经离开、拒绝或不知情时，另一人的状态不能假装她仍在场、已同意或已知晓。',
        '4. world_pulse_upsert 只写真正变化的持续宏观状态；不要机械复读原值。',
        '5. 公开世界事件可以与主角完全无关，但必须用 publicity 表示社会公开度，而不是拿 visibility 代替。publicity=trace 只能形成未证实讨论；publicity=public 才能进入新闻，并填写 public_headline/public_summary。',
        '6. visibility 仍只控制事件怎样靠近当前正文。某件私密事件即使 visibility=direct，也可以且通常应该 publicity=private。',
        '7. 普通天气、交通、商业、地方政策、设施、行业、社区与网络热点远多于战争/灾难/巨型阴谋。重大事件必须罕见且有强因果。',
        '7A. 世界背景若明确写了持续运转的地区、行业、组织、公共日程或新闻主题，必须检查它们在当前世界时间是否有自然变化；最近正文不是公共世界的选题表，不能只维护镜头内人物附近的新闻。',
        recordPlayerCharacter
            ? '7. 可以更新镜头外 NPC 的位置、行动、意图和状态，但不得删除 author_managed / locked 人物，不得替玩家补行动或内心。'
            : '7. 可以更新镜头外 NPC，但玩家角色当前设置为“不记录”：禁止在 people_upsert / people_remove 中创建、更新或删除玩家。玩家只通过已发生的正文事实影响世界。',
        '8. 已结算的客观结果写 world_facts_upsert，并同步对应人物/事件状态。',
        '9. 不写 memory_update；没有新正文，不应该凭空形成“正文长期记忆”。',
        '10. 只输出合法 JSON。',
        '',
        '当前权威世界：',
        JSON.stringify(compact),
        '',
        '返回结构：',
        JSON.stringify({
            elapsed_minutes: 0,
            time_reason: 'world pulse tick',
            clock_anchor: { mode: 'none' },
            world: { title: '', detail: '' },
            people_upsert: [],
            people_remove: [],
            events_create: [],
            events_update: [],
            deliveries_confirmed: [],
            front_facts: [],
            world_facts_upsert: [],
            world_pulse_upsert: [],
            consistency_conflicts: [],
            memory_update: {
                facts_upsert: [],
                facts_invalidate: [],
                clues_upsert: [],
                clues_resolve: [],
            },
        }),
    ].join('\n');
}

export function buildHistoryIndexPrompt(state, {
    messages = [],
    userName = '',
    playerIdentityAnchor = '',
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
        ? '极简重试：每条 turn_summaries.summary 不超过100字，memory_digest.text 不超过240字；facts_upsert 最多3条，clues_upsert 最多2条；没有变化的数组必须返回空数组。'
        : '输出应紧凑：每条 turn_summaries.summary 约80—180字，memory_digest.text 约300—600字；facts_upsert 最多8条，clues_upsert 最多6条。';
    const identityAnchor = modelText(playerIdentityAnchor, 400);
    const characterIdentityAnchors = asArray(state?.people)
        .filter(person => modelText(person?.identityAnchor, LIMITS.identityAnchor))
        .slice(0, LIMITS.peopleModelContext)
        .map(person => ({
            name: modelText(person?.name, 80),
            identity_anchor: modelText(person?.identityAnchor, LIMITS.identityAnchor),
        }));

    return [
        '你是“世界背面”的历史档案员。你只整理已经发生的聊天记录，不续写、不推演未来、不修改世界时间。',
        '',
        '任务：',
        '1. 为本批每一条 assistant 正文分别写一条 L0 单轮摘要，放进 turn_summaries。每条只总结对应消息，不把下一轮或别的消息混进来；保留关系变化、承诺、冲突、重要物品与未完成的问题。',
        '2. 重写 memory_digest：把旧持续摘要与本批真正持久的重要变化合并，删除已经失效的说法；这不是逐轮流水账，也不是所有 L0 摘要的机械拼接。',
        '3. facts_upsert 只记录正文明确成立、未来仍有用的长期事实，例如身份、关系、承诺、能力限制、重要物品归属和已经揭示的真相。临时位置、普通动作、气氛不算长期事实。',
        '4. 每类事实使用稳定 key（例如“人物:老白:真实身份”）。同一 key 出现新值时保留 key 并提交新 value；插件会把旧版本标为 superseded。真假仍无法判断时用 status=disputed，不要强行覆盖。',
        '5. 只提取真正可能在后文产生呼应的伏笔。普通环境描写、一次性动作和已经当场解释完的事实不要当作伏笔。',
        '6. 长期事实与伏笔必须记录最早或最清楚的来源消息 id、swipe，并保留不超过80字的原文摘录。',
        '7. 记忆要会更迭，不要只增不减：旧伏笔开始推进时用原 ID 更新为 developing；关键条件真正触发时可更新为 triggered；确实完成/揭晓时放入 clues_resolve(status=resolved)；后文已经证明它不再需要、方向被废弃或只是误判的伏笔放入 clues_resolve(status=discarded) 并写清 reason。被正文明确否定或已经失效的长期事实放入 facts_invalidate。',
        '7A. 同一长期事实出现新值时继续用同一稳定 key，插件会把旧值标为 superseded 并保留轻量变化链；不要让互相冲突的旧值同时保持 active。世界事实更新不会自动修改任何 NPC 的认知账本。',
        '7B. 不需要保存所有东西。普通枝节、已被高层经历覆盖且未来无独立价值的信息可以从持续摘要中淡出；锁定、重要、长期关系、重大承诺、身份、关键限制与未完成线索必须保留。',
        '8. 不得把玩家未明说的想法写成事实。玩家角色名：'
            + `${modelText(userName, 80) || '未提供'}。`
            + (identityAnchor
                ? ` 用户明确设定的身份锚点：${identityAnchor}。涉及性别身份、称谓/代词、外貌表达、身体设定、物种、年龄阶段或社会身份时必须逐项遵守；不得根据外貌、衣着、身体或物种反推性别。`
                : ' 未设置玩家身份锚点；正文没有明确时使用中性表述，不得根据外貌、衣着、身体或物种猜测性别与称谓。'),
        `用户维护的其他角色身份锚点：${characterIdentityAnchors.length ? JSON.stringify(characterIdentityAnchors) : '无'}。这些锚点是权威设定，整理身份、称谓和关系时必须遵守；没有锚点且正文也不明确的角色使用中性表述，不得凭外貌、衣着、身体或物种猜测。`,
        '9. turn_summaries 只为 assistant 消息生成；user 消息作为上下文使用，但不要单独建立 L0。每条必须带准确 source_message_id。',
        '10. chapter_summary 是旧版兼容兜底字段：正常情况下返回 null；只有无法输出 turn_summaries 时才用它概括整批。',
        '11. 只返回一个合法 JSON 对象，不要代码围栏和解释。',
        `12. ${outputLimits}`,
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
            turn_summaries: [{
                id: 'summary_l0_message_id',
                source_message_id: endMessageId,
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            }],
            chapter_summary: null,
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
                status: 'open | developing | triggered',
            }],
            clues_resolve: [{
                id: '',
                status: 'resolved | discarded',
                resolution: '',
                reason: '',
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
    const turnSummaries = asArray(rawPayload?.turn_summaries ?? rawPayload?.turnSummaries)
        .slice(0, 24);
    let storedTurnSummaries = 0;
    for (const rawTurn of turnSummaries) {
        const messageId = asInteger(
            rawTurn?.source_message_id ?? rawTurn?.sourceMessageId ?? rawTurn?.message_id ?? rawTurn?.messageId,
            -1,
            -1,
        );
        if (messageId < startMessageId || messageId > endMessageId || !rawTurn?.summary) continue;
        const prepared = {
            ...rawTurn,
            id: rawTurn?.id || `summary_l0_${messageId}`,
            start_message_id: messageId,
            end_message_id: messageId,
            level: MEMORY_SUMMARY_LEVELS.DETAIL,
            hierarchy_managed: true,
            source_summary_ids: [],
        };
        const normalized = normalizeStorySummary(prepared);
        const existing = state.storyMemory.summaries.find(summary => (
            summary.id === normalized.id
            || (
                Number(summary.level) === MEMORY_SUMMARY_LEVELS.DETAIL
                && summary.startMessageId === messageId
                && summary.endMessageId === messageId
            )
        ));
        if (existing) Object.assign(existing, normalized);
        else state.storyMemory.summaries.push(normalized);
        storedTurnSummaries += 1;
    }

    const rawSummary = rawPayload?.chapter_summary ?? rawPayload?.chapterSummary;
    if (!storedTurnSummaries && rawSummary?.summary) {
        const prepared = {
            ...rawSummary,
            start_message_id: rawSummary.start_message_id ?? startMessageId,
            end_message_id: rawSummary.end_message_id ?? endMessageId,
            level: rawSummary.level ?? MEMORY_SUMMARY_LEVELS.STAGE,
            hierarchy_managed: Boolean(rawSummary.hierarchy_managed ?? rawSummary.hierarchyManaged ?? false),
        };
        const normalized = normalizeStorySummary(prepared);
        const existing = state.storyMemory.summaries.find(summary => (
            summary.id === normalized.id
            || (
                summary.startMessageId === normalized.startMessageId
                && summary.endMessageId === normalized.endMessageId
                && Number(summary.level) === Number(normalized.level)
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

export function isPersonObservationEligible(person, userName = '') {
    if (!person) return false;
    if (person.isUser || person.is_user) return false;
    const normalizedUserName = String(userName || '').trim().toLocaleLowerCase();
    const normalizedPersonName = String(person.name || '').trim().toLocaleLowerCase();
    return !(normalizedUserName && normalizedPersonName === normalizedUserName);
}

export function buildPersonObservationPrompt(state, person, {
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
    playerIdentityAnchor = '',
} = {}) {
    if (!isPersonObservationEligible(person, userName)) {
        throw new Error('玩家角色不使用人物即时观测');
    }

    // IMPORTANT: raw recent narrative is intentionally NOT passed to the person POV.
    // The world engine may know the full scene; this observer only receives the
    // character's own state + validated cognition ledger.
    void narrativeTurns;

    const relevantMemory = selectRelevantStoryMemory(
        state,
        `${person?.name || ''}\n${person?.location || ''}\n${person?.action || ''}\n${person?.intent || ''}`,
        { maximumClues: 10, maximumFacts: 16, maximumSummaries: 0, includeDigest: false },
    );
    relevantMemory.digest = null;
    relevantMemory.summaries = [];

    const knownFactKeys = new Set(
        asArray(person?.knownFactKeys).map(item => normalizedReference(item)),
    );
    const knownClueIds = new Set(
        asArray(person?.knownClueIds).map(item => normalizedReference(item)),
    );
    const beliefs = normalizeFactBeliefs(person?.knownFactBeliefs);
    const beliefKeys = new Set(beliefs.map(item => normalizedReference(item.key)));

    const beliefFacts = beliefs.map(belief => {
        const historical = asArray(state?.storyMemory?.facts).find(fact => (
            belief.factId && fact.id === belief.factId
        )) || asArray(state?.storyMemory?.facts).find(fact => fact.key === belief.key);
        return {
            id: belief.factId || `belief_${hashText(`${belief.key}\n${belief.value}`)}`,
            key: belief.key,
            subject: historical?.subject || belief.key,
            predicate: historical?.predicate || '',
            value: belief.value,
            people: historical?.people || [],
            locations: historical?.locations || [],
            tags: historical?.tags || [],
            status: belief.certainty === 'suspected' ? 'suspected' : 'known',
            confidence: belief.certainty === 'suspected'
                ? 'low'
                : (historical?.confidence || 'medium'),
            importance: historical?.importance || 2,
            visibility: 'known',
            certainty: belief.certainty,
            route: belief.route,
            evidence: belief.evidence,
            source_message_id: belief.learnedAtMessageId || historical?.sourceMessageId || 0,
            source_swipe_id: historical?.sourceSwipeId || 0,
        };
    });
    const legacyKnownFacts = relevantMemory.facts.filter(fact => (
        knownFactKeys.has(normalizedReference(fact.key))
        && !beliefKeys.has(normalizedReference(fact.key))
    ));
    relevantMemory.facts = [...beliefFacts, ...legacyKnownFacts].slice(0, 16);
    relevantMemory.clues = relevantMemory.clues.filter(clue => (
        knownClueIds.has(normalizedReference(clue.id))
    ));

    const relevantEvents = normalizeKnownEventViews(person?.knownEventViews)
        .map(view => ({
            // Deliberately do not attach the live event place/status here. Those
            // are omniscient world fields and may have changed since the person
            // acquired this frozen, character-known view.
            event_id: view.eventId,
            what_this_character_knows: view.summary,
            certainty: view.certainty,
            route: view.route,
            evidence: view.evidence,
        }))
        .slice(0, 8);

    const observedIdentityAnchor = modelText(person?.identityAnchor, LIMITS.identityAnchor);
    const observedAppearanceProfile = modelText(person?.appearanceProfile, LIMITS.appearanceProfile);
    const observedBackgroundProfile = modelText(person?.backgroundProfile, LIMITS.backgroundProfile);

    return [
        '你是“世界背面”的人物即时观测器。',
        `本次唯一观测主体是“${modelText(person?.name, 80)}”。不要以第一人称小说的方式描写“正在做什么”，而要直接呈现该角色此刻脑中真实经过的念头、注意力、判断、犹豫、联想、情绪反应与即时意识活动。`,
        '你不是在介绍、分析或“扮演一个像该角色的人”；你要直接停留在该角色自己的意识内部。输出不是小说、日记、心理描写作文、人物小传或状态总结。',
        '这是幕后即时观测，不是主聊天正文，也不是新的世界推演。',
        '人物观测不会收到完整“世界背景设定”：其中可能包含角色本人不知道的幕后世界真相。世界规则由已结算人物状态和认知账本间接约束。',
        '本任务拥有独立 POV 与输出协议。你没有收到完整最近正文或 GM 世界档案，这是刻意的认知防火墙；绝不能根据“世界可能知道什么”自行补全角色没获得的信息。',
        '执行优先级：已结算的明确事实 > 该人物的已知/已怀疑信息 > 当前位置、行动、目标与身心状态 > 人格、经历、说话习惯与行为边界 > 人物惯性与合理日常 > 戏剧性和可读性。',
        '要求：',
        '0. 最高优先级是“像这个具体人物本人”，其次才是“像真实思维”，最后才是“把信息交代完整”。三者冲突时，宁可少交代，也不要为了完整、合理或好读写出不像本人的内容。',
        '0A. 不要先把 personality_anchor 等资料抽象成“冷静/聪明/非人/寡言/疯狂”等标签，再生成一个符合标签的通用角色。你要延续的是这个具体人物已经形成的脑回路、词汇习惯、判断角度、注意偏好、偏见、盲区、自欺方式和表达节奏。',
        '0B. 人格资料是边界与参考，不是要求你把标签翻译成文风。冷静不等于报告腔，聪明不等于术语密集，非人不等于机器口吻，理性不等于不断统计/建模/量化，寡言不等于句句省略号，疯狂不等于语无伦次。',
        '0C. speaking_style、既有 inner_voice、background_profile 中已经体现出的个人用词与思考习惯，优先于模型对“这种类型的人通常会怎么想”的泛化推测。若一种说法只是“符合性格标签”，却不像这个人物本人会使用的语言，就不用。',
        '0D. 不得擅自把人物语言“升级”为更专业、更抽象、更技术化的表达。除非该人物既有设定/说话习惯或当前具体思考对象本来就会使用，否则不要因为人物聪明、理性、非人或擅长观察，就自动加入“数据、样本、变量、模型、机制、阈值、结构、反馈、概率、参数、路径”等分析术语。宁可用人物本人会想到的普通词，也不要用模型认为更精确高级的词。',
        '1. 只呈现这一小段时间内真正进入该人物意识、并且有足够注意重量的内容。内心独白不是逐秒转录意识：人物不会把每个感觉、每个动作、每次判断都转换成语言。已经默认接受、微弱、重复或没有形成明确念头的信息可以直接略过。',
        '1A. 重点是即时念头、注意力、判断、犹豫、联想、情绪反应与未说出口的反应，而不是完整记录动作过程。无需刻意频繁使用“我”，真实思维可以自然省略主语。先在内部对齐该人物的认知方式和表达能力，不要输出分析过程。',
        '1B. 一个念头一旦已经成立，不要为了显得细腻继续换不同措辞反复确认、定义、解释和总结同一个结论。除非该人物此刻真的在纠结、反刍或推演，否则想到一次就可以过去。',
        '1C. 允许思维存在没有被语言化的空白。不要用省略号、感官描写、重复判断、自我解说或哲学化概括去填满所有空隙；也不要为了表现“内心感”刻意一行一句、频繁断句。停顿和碎片化只在该人物真的会这样思考时出现。',
        '1D. 把 location / action / intent / long_term_goal 与身心、资源状态当作此刻的连续性锚点。如果没有足够强且该人物确实知道的新刺激，就让生活从上一状态自然延续，不得突然换目标、换地点、开新剧情或得出重大结论。',
        '1E. inner_voice 只是上一次已结算状态留下的连续线索，不是必须复读的台词。没有状态变化时保持同一人的脑回路；已有明确变化时不要被旧独白拖回去。',
        '1F. 动作、环境、声音、触感、气味和其他人物，只有在它们此刻真的进入该人物注意、造成阻力、引起感受或触发念头时才允许出现。禁止连续写“我抬头/我走过去/我拿起/我坐下/我看向”等动作流水账，也不要为了画面感主动铺陈场景。',
        '1G. 不要替不存在的读者解释角色自己早已知道的身份、关系、背景、性格、过去经历、世界设定或当前处境。只有当某个具体刺激此刻真的勾起这些内容时，才允许它们自然浮现。角色不知道自己正在被观测。',
        '2. 不推进主世界时间，不制造重大新事件，不替其他角色行动，不改变任何既有事实。',
        '3. 严守该角色的知识边界。唯一可当作该角色知识的内容，是下方 known_event_views / known_fact_beliefs / known_clue_ids 明确允许的版本。',
        '3A. known_event_views 中的 what_this_character_knows 才是角色所知版本；绝不能从 event_id、世界背景或常识反推出该事件的幕后真相。没有提供事件的实时地点/状态是刻意的；角色不会自动知道它后来是否转移、结束或变化。',
        '3B. certainty=suspected 只是怀疑/推测，写作时必须保持不确定，不能当成确认事实。',
        '3C. physical_state / emotional_state / resource_state 是当前状态约束。行动、注意力和即时判断必须受伤势、疲劳、情绪与资源限制影响；不得凭空获得能力、装备、权限或知识。',
        observedIdentityAnchor
            ? `该角色的身份锚点：${observedIdentityAnchor}。性别身份、称谓/代词、物种、年龄阶段与社会身份必须逐项遵守，不得根据外貌或其他表面特征擅自改写。`
            : '该角色没有设置身份锚点；没有明确证据时使用中性表述，不得根据外貌、衣着、身体或物种猜测其性别与称谓。',
        observedAppearanceProfile
            ? `该角色的稳定外貌设定：${observedAppearanceProfile}。观测时保持一致，不要把外貌特征混写成人格或身份。`
            : '该角色没有额外外貌设定；不要为了画面感凭空补充关键身体特征。',
        observedBackgroundProfile
            ? `该角色的背景与关系设定：${observedBackgroundProfile}。只用于保持经历与关系连续，不得因此让角色知道认知账本之外的信息。`
            : '该角色没有额外背景资料；不要自行补造重要经历或关系。',
        modelText(playerIdentityAnchor, 400)
            ? `若片段提及玩家“${modelText(userName, 80) || 'user'}”，必须逐项遵守身份锚点：${modelText(playerIdentityAnchor, 400)}。`
            : '若片段提及玩家且没有明确身份或称谓，使用中性表述。',
        '4. 人格保真：关注什么、忽略什么、如何取舍和误判、是否给情绪命名、是否解释原因、会不会抽象概括、句子长短与用词，都必须源于该人物本人，而不是来自通用的“角色扮演文风”。',
        '4A. 不要复述性格标签，不要让角色自我解说“我向来很冷淡/谨慎/不善表达”。用这个人物自己的注意、选择、反应和词汇自然体现。',
        '4B. 不得为了让人物显得“像设定”而夸张某一特质。不要把冷淡写成毫无人味，把理性写成实时研究报告，把敏感写成事事过度解读，把聪明写成每件事都完整推理，把寡言写成所有念头都只剩单词。人格是整体，不是单一标签的最大化。',
        '4C. 不得为了好看而提高角色的自省能力、情绪敏锐度、逻辑复杂度或语言组织能力。人物可以误判、逃避、自欺、想歪、懒得深究，也可以根本没有意识到真正影响自己的是什么；这些比“正确分析自己”更重要。',
        '4D. 思考不必不断形成结论。不要自动套用“观察现象→分析原因→形成判断→制定策略”的完整推理链。角色已经接受的事实可以直接作为前提；只有当该人物此刻真的在解决问题、做决定或主动推理时，才展开相应分析。',
        '4E. 不要默认围着玩家转。只有当前目标、已知事件、已结算关系或近期状态确实会自然触发时，才允许想到或提及玩家；否则继续自己的生活、工作、休息、社交、兴趣和问题。',
        '4F. 允许平淡、停滞、发呆、吃饭、工作、休息或什么也没发生。不需要为了让观测“值得看”而制造小动作、新决定、暗示、巧合、悬念或戏剧冲突。',
        '5. 思维形式必须服从人物本人。允许短句、完整句、半句话、转念、自我否定、犹豫、少量重复、注意力漂移和想到一半被打断；使用哪一种、频率多高，都由人物本人决定。不要统一套用碎片化“意识流”，也不要统一套用完整书面语。',
        '5A. 不需要开头、场景交代、氛围铺垫、起承转合、高潮或总结。不要为了“完整”在结尾强行感悟、收束或解释这一刻的心情。思维在哪里自然停下，就在哪里结束。',
        '5B. 禁止按“环境描写→动作→心理→感慨”或“现象→术语分析→结论→策略”的固定结构输出。如果一句话更像作者、研究员、旁白或通用AI会写的，而不像这个人物本人真的会想到的，就删掉或改回人物自己的词。',
        '6. 正文不少于150字，不设上限。150字只是最低要求，不是建议目标，也不是达到后即可结束的目标；如果该人物此刻仍有新的、彼此不重复且符合人设的思维内容，就继续自然展开。',
        '6A. 如果当前瞬间本来没有足够多值得语言化的念头，不要把一个念头拆成多层解释来凑长度；可以在不推进主世界、不制造新事件的前提下，把观测窗口自然覆盖到接下来的几分钟，从同一连续状态中截取几个真正进入注意的念头。扩展时间切片，不扩写同一个念头。',
        '6B. 禁止为了满足最低字数而重复同义内容、复述动作、堆砌环境、复习设定、解释背景、强加感悟、连续定义自己的感受、添加总结，或凭空制造新事件/新秘密/新记忆/新关系变化。',
        '6C. 最终只返回该人物此刻的内心活动本身，不写标题、说明、分析、项目符号、“第一视角”等标签或任何场外文字；最后一句必须完整结束。',
        '',
        `主世界时间：${formatWorldCalendar(state).stamp}`,
        '人物状态：',
        JSON.stringify({
            name: person?.name,
            location: person?.location,
            action: person?.action,
            intent: person?.intent,
            long_term_goal: person?.longTermGoal,
            identity_anchor: person?.identityAnchor,
            personality_anchor: person?.personalityAnchor,
            appearance_profile: person?.appearanceProfile,
            background_profile: person?.backgroundProfile,
            speaking_style: person?.speakingStyle,
            behavior_boundaries: person?.behaviorBoundaries,
            inner_voice: person?.innerVoice,
            knowledge: person?.knowledge,
            cognition_ready: person?.cognitionReady,
            known_event_ids: person?.knownEventIds,
            known_event_views: relevantEvents,
            known_fact_keys: person?.knownFactKeys,
            known_fact_beliefs: relevantMemory.facts,
            known_clue_ids: person?.knownClueIds,
            physical_state: person?.physicalState,
            emotional_state: person?.emotionalState,
            resource_state: person?.resourceState,
        }),
        '该角色可使用的事件认知版本：',
        JSON.stringify(relevantEvents),
        '该角色可使用的长期记忆/信念：',
        JSON.stringify(relevantMemory),
        '不要索取、猜测或补写未提供的最近正文；缺信息时就让角色保持不知道。',
    ].join('\n');
}

function personLifeTickInterval(person) {
    const relevance = asInteger(person?.relevance, 1, 0, 3);
    if (relevance >= 3) return 12 * 60;
    if (relevance === 2) return 24 * 60;
    if (relevance === 1) return 48 * 60;
    return 72 * 60;
}

function personLifeTickInfo(state, person) {
    const now = asInteger(state?.clock?.absoluteMinute, 0, 0);
    const last = asInteger(
        person?.lastLifeTickAt ?? person?.updatedAt,
        now,
        0,
    );
    const interval = personLifeTickInterval(person);
    const elapsed = Math.max(0, now - last);
    return {
        last,
        interval,
        elapsed,
        overdue: Math.max(0, elapsed - interval),
        due: elapsed >= interval,
    };
}

export function listDueBackgroundPeople(state, {
    maximum = LIMITS.peopleTaskBudget,
    requiredOnly = false,
} = {}) {
    const limit = asInteger(maximum, LIMITS.peopleTaskBudget, 0);
    if (limit <= 0) return [];
    return asArray(state?.people)
        .filter(person => !person?.isUser && person?.simulationEnabled !== false)
        .map(person => {
            const life = personLifeTickInfo(state, person);
            const manualPriority = Boolean(person?.lifeTickPriority);
            // 三个完整生活周期仍未结算时进入保底队列。它只是强制“轮到她”，
            // 不代表人物凭空发生大事，也不会额外推进世界时间。
            const starvationGuard = life.elapsed >= life.interval * 3;
            return { person, life, manualPriority, starvationGuard };
        })
        .filter(item => (
            requiredOnly
                ? (item.manualPriority || item.starvationGuard)
                : (item.manualPriority || item.life.due)
        ))
        .sort((a, b) => (
            Number(b.manualPriority) - Number(a.manualPriority)
            || Number(b.starvationGuard) - Number(a.starvationGuard)
            || Number(a.person?.lifeTickPriorityAt || Number.MAX_SAFE_INTEGER)
                - Number(b.person?.lifeTickPriorityAt || Number.MAX_SAFE_INTEGER)
            || Number(b.life.overdue) - Number(a.life.overdue)
            || Number(b.person?.relevance || 0) - Number(a.person?.relevance || 0)
            || Number(a.life.last) - Number(b.life.last)
        ))
        .slice(0, limit)
        .map(({ person, life, manualPriority, starvationGuard }) => ({
            id: String(person.id || ''),
            name: String(person.name || ''),
            overdueMinutes: life.overdue,
            elapsedMinutes: life.elapsed,
            intervalMinutes: life.interval,
            lastLifeTickAt: life.last,
            priorityReason: manualPriority
                ? 'manual-next'
                : starvationGuard
                    ? 'starvation-guard'
                    : 'due',
        }));
}

export function compactStateForModel(state, {
    includeUserInnerVoice = false,
    includeUserCharacter = true,
    userName = '',
    maximumPeople = 14,
    allowExpandedPeopleContext = false,
    priorityPersonIds = [],
} = {}) {
    const maximum = asInteger(
        maximumPeople,
        14,
        1,
        allowExpandedPeopleContext ? Number.MAX_SAFE_INTEGER : LIMITS.peopleModelContext,
    );
    const candidates = [...state.people]
        .filter(person => includeUserCharacter || !isUserPersonLike(person, userName))
        .filter(person => person?.simulationEnabled !== false || isUserPersonLike(person, userName))
        .map(person => ({
            person,
            life: personLifeTickInfo(state, person),
        }));

    // Explicit scheduler targets must always be present with their full current
    // state. A target list containing only id/name is not enough to continue a
    // person's life safely, especially for manual catch-up before the normal due time.
    const priorityOrder = uniqueStrings(priorityPersonIds, maximum);
    const priorityRank = new Map(priorityOrder.map((id, index) => [id, index]));
    const priority = candidates
        .filter(item => priorityRank.has(String(item.person?.id || '')))
        .sort((a, b) => (
            Number(priorityRank.get(String(a.person?.id || '')) ?? Number.MAX_SAFE_INTEGER)
            - Number(priorityRank.get(String(b.person?.id || '')) ?? Number.MAX_SAFE_INTEGER)
        ))
        .slice(0, maximum);

    // Reserve part of every world call for people whose own lives are overdue,
    // so a long-absent NPC cannot fall out forever just because the foreground
    // stopped mentioning them. Manual next-round priority also counts as due for
    // context selection, even when its normal interval has not elapsed yet.
    const priorityIds = new Set(priority.map(item => item.person.id));
    const dueQuota = Math.max(0, Math.max(1, Math.floor(maximum / 2)) - priority.length);
    const due = candidates
        .filter(item => !priorityIds.has(item.person.id))
        .filter(item => !item.person?.isUser && (item.person?.lifeTickPriority || item.life.due))
        .sort((a, b) => (
            Number(Boolean(b.person?.lifeTickPriority)) - Number(Boolean(a.person?.lifeTickPriority))
            || Number(b.life.overdue) - Number(a.life.overdue)
            || Number(b.person.relevance || 0) - Number(a.person.relevance || 0)
            || Number(a.life.last) - Number(b.life.last)
        ))
        .slice(0, dueQuota);

    const selectedIds = new Set([...priority, ...due].map(item => item.person.id));
    const regular = candidates
        .filter(item => !selectedIds.has(item.person.id))
        .sort((a, b) => (
            Number(b.person.relevance || 0) - Number(a.person.relevance || 0)
            || Number(b.person.presentInSceneMessageId || -1) - Number(a.person.presentInSceneMessageId || -1)
            || Number(b.person.updatedAt || 0) - Number(a.person.updatedAt || 0)
        ))
        .slice(0, Math.max(0, maximum - due.length));

    const people = [...priority, ...due, ...regular].slice(0, maximum).map(item => item.person);
    const lifeById = new Map(candidates.map(item => [item.person.id, item.life]));
    const eventPriority = event => (
        event.delivery?.state === 'pending' ? 4
            : event.status === 'ready' ? 3
                : ['active', 'waiting'].includes(event.status) ? 2
                    : 1
    );
    const eventCandidates = state.events
        .filter(event => !['cancelled', 'missed'].includes(event.status) || event.delivery.state === 'pending')
        .sort((a, b) => (
            eventPriority(b) - eventPriority(a)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ));
    const events = eventCandidates.slice(0, 20);

    // Detailed event payload stays capped for token safety, but every other
    // ongoing event still exposes a compact identity row. This prevents an old
    // dark-current from becoming invisible after the first 20 entries and then
    // being recreated under a new id/title on the next model call.
    const detailedEventIds = new Set(events.map(event => event.id));
    const eventIndex = state.events
        .filter(event => !TERMINAL_EVENT_STATES.has(event.status))
        .filter(event => !detailedEventIds.has(event.id))
        .sort((a, b) => (
            eventPriority(b) - eventPriority(a)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ))
        .slice(0, LIMITS.events);

    return {
        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,
        world_now_label: state.clock?.anchored
            ? formatWorldCalendar(state).stamp
            : 'UNINITIALIZED_STORY_CLOCK',
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'uninitialized',
        world: {
            name: modelText(state.world.name, 80),
            title: modelText(state.world.title, 140),
            detail: modelText(state.world.detail, 360),
            background: modelText(state.world.background, LIMITS.worldBackground),
        },
        world_pulse: {
            baseline_established: Boolean(state.worldPulse?.baselineEstablished),
            last_sweep_at: Number(state.worldPulse?.lastSweepAt || 0),
            coverage: {
                last_sweep_at: Number(state.worldPulse?.coverage?.lastSweepAt ?? -1),
                last_public_sweep_at: Number(state.worldPulse?.coverage?.lastPublicSweepAt ?? -1),
                recent_checks: asArray(state.worldPulse?.coverage?.entries)
                    .slice(0, 12)
                    .map(entry => ({
                        id: entry.id,
                        label: modelText(entry.label, 120),
                        kind: entry.kind,
                        scope: modelText(entry.scope, 140),
                        last_checked_at: Number(entry.lastCheckedAt ?? -1),
                        checks: Number(entry.checks || 0),
                    })),
            },
            domains: asArray(state.worldPulse?.domains)
                .sort((a, b) => (
                    Number(b.pressure || 0) - Number(a.pressure || 0)
                    || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
                ))
                .slice(0, LIMITS.worldPulseDomains)
                .map(domain => ({
                    id: domain.id,
                    label: modelText(domain.label, 100),
                    scope: modelText(domain.scope, 120),
                    kind: domain.kind,
                    state: modelText(domain.state, 360),
                    pressure: domain.pressure,
                    trend: domain.trend,
                    visibility: domain.visibility,
                    evidence: modelText(domain.evidence, 220),
                })),
        },
        recent_public_impacts: asArray(state.publicImpactLedger)
            .slice(0, 12)
            .map(record => ({
                source_event_id: record.sourceEventId,
                summary: modelText(record.summary, 260),
                affected_person_ids: record.affectedPersonIds,
                affected_scopes: record.affectedScopes,
                channels: record.channels,
                processed_at: record.processedAt,
            })),
        world_facts: asArray(state.worldFacts)
            .filter(fact => fact?.confidence === 'high')
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
            .slice(0, 24)
            .map(fact => ({
                key: fact.key,
                subject_type: fact.subjectType,
                subject_id: fact.subjectId,
                subject: modelText(fact.subject, 120),
                field: modelText(fact.field, 80),
                value: modelText(fact.value, 360),
                validity: fact.validity || 'current',
                visibility: fact.visibility,
                event_id: fact.eventId || '',
                updated_at: fact.updatedAt,
            })),
        people: people.map(person => {
            const isUser = isUserPersonLike(person, userName);
            return {
                id: person.id,
                name: modelText(person.name, 80),
                is_user: isUser,
                location: modelText(person.location, 120),
                action: modelText(person.action, 180),
                intent: modelText(person.intent, 180),
                long_term_goal: modelText(person.longTermGoal, 220),
                identity_anchor: modelText(person.identityAnchor, LIMITS.identityAnchor),
                personality_anchor: modelText(person.personalityAnchor, LIMITS.personalityAnchor),
                appearance_profile: modelText(person.appearanceProfile, 360),
                background_profile: modelText(person.backgroundProfile, 500),
                speaking_style: modelText(person.speakingStyle, LIMITS.speakingStyle),
                behavior_boundaries: modelText(person.behaviorBoundaries, LIMITS.behaviorBoundaries),
                inner_voice: isUser && !includeUserInnerVoice
                    ? ''
                    : modelText(person.innerVoice, 160),
                inner_voice_at: person.innerVoiceAt,
                knowledge: person.knowledge,
                cognition_ready: person.cognitionReady,
                known_event_ids: person.knownEventIds,
                known_event_views: person.knownEventViews,
                known_fact_keys: person.knownFactKeys,
                known_fact_beliefs: person.knownFactBeliefs,
                known_clue_ids: person.knownClueIds,
                physical_state: modelText(person.physicalState, LIMITS.personState),
                emotional_state: modelText(person.emotionalState, LIMITS.personState),
                resource_state: modelText(person.resourceState, LIMITS.personState),
                relevance: person.relevance,
                background_simulation: person.simulationEnabled !== false,
                locked_profile: Boolean(person.locked),
                author_managed: Boolean(person.manual || person.worldbookRef || person.source === 'manual'),
                last_seen_message_id: person.lastSeenMessageId,
                last_life_tick_at: lifeById.get(person.id)?.last ?? person.lastLifeTickAt ?? person.updatedAt,
                life_tick_interval_minutes: lifeById.get(person.id)?.interval ?? personLifeTickInterval(person),
                life_tick_due_minutes: lifeById.get(person.id)?.overdue ?? 0,
                life_tick_priority: Boolean(person.lifeTickPriority),
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
                cause: modelText(event.cause, LIMITS.eventCause),
                actors: event.actors,
                known_by: event.knownBy,
                caused_by: event.causedBy,
                public_trace: modelText(event.publicTrace, LIMITS.eventPublicTrace),
                public_headline: modelText(event.publicHeadline, 180),
                public_summary: modelText(event.publicSummary, 360),
                public_result: modelText(event.publicResult, 360),
                publicity: event.publicity || 'private',
                visibility: event.visibility,
                delivery_state: event.delivery.state,
            })),
        event_index: eventIndex.map(event => ({
            id: event.id,
            title: modelText(event.title, 120),
            place: modelText(event.place, 100),
            status: event.status,
            actors: asArray(event.actors).slice(0, 8),
            caused_by: asArray(event.causedBy).slice(0, 8),
            updated_at: event.updatedAt,
        })),
        omitted: {
            people: Math.max(0, state.people.length - people.length),
            events: Math.max(0, state.events.length - events.length - eventIndex.length),
        },
    };
}


function correctionEvidenceSource(raw) {
    const source = asString(
        raw?.evidence_source ?? raw?.evidenceSource,
        'narrative',
        40,
    ).toLowerCase();
    return ['narrative', 'character_anchor', 'world_background', 'manual_fact'].includes(source)
        ? source
        : 'narrative';
}

function correctionEvidenceSupported(state, narrativeText, correction) {
    const evidence = normalizedEvidenceText(
        correction?.evidence
        ?? correction?.evidence_excerpt
        ?? correction?.evidenceExcerpt,
    );
    if (!evidence || evidence.length < 4) return false;
    const source = correctionEvidenceSource(correction);

    if (source === 'narrative') {
        return normalizedEvidenceText(narrativeText).includes(evidence);
    }
    if (source === 'world_background') {
        return normalizedEvidenceText(state?.world?.background).includes(evidence);
    }
    if (source === 'character_anchor') {
        const personId = asString(
            correction?.person_id ?? correction?.personId ?? correction?.subject_id ?? correction?.subjectId,
            '',
            120,
        );
        const targetMemoryFact = findMemoryFactForCorrection(state, correction);
        const targetWorldFact = findWorldFactForCorrection(state, correction);
        const personName = asString(
            correction?.person_name
            ?? correction?.personName
            ?? correction?.subject
            ?? targetMemoryFact?.subject
            ?? targetWorldFact?.subject,
            '',
            100,
        );
        const person = asArray(state?.people).find(item => (
            (personId && item?.id === personId)
            || (personName && item?.name === personName)
        ));
        if (!person) return false;
        const anchorText = normalizedEvidenceText([
            person.identityAnchor,
            person.personalityAnchor,
            person.backgroundProfile,
            person.worldbookRaw,
            person.speakingStyle,
            person.behaviorBoundaries,
        ].filter(Boolean).join('\n'));
        return anchorText.includes(evidence);
    }
    if (source === 'manual_fact') {
        return asArray(state?.worldFacts).some(fact => (
            fact?.source === 'manual'
            && normalizedEvidenceText(`${fact.subject}${fact.field}${fact.value}`).includes(evidence)
        ));
    }
    return false;
}

function correctionSourceForEvidence(correction) {
    return correctionEvidenceSource(correction) === 'narrative'
        ? 'narrative'
        : 'manual';
}

function findWorldFactForCorrection(state, correction) {
    const key = asString(correction?.key, '', 180);
    if (key) {
        return asArray(state?.worldFacts).find(fact => fact?.key === key) || null;
    }
    const subjectId = asString(
        correction?.subject_id ?? correction?.subjectId,
        '',
        120,
    ).toLocaleLowerCase();
    const subject = asString(correction?.subject, '', 140).toLocaleLowerCase();
    const field = asString(correction?.field, '', 80).toLocaleLowerCase();
    return asArray(state?.worldFacts).find(fact => (
        (!field || String(fact?.field || '').toLocaleLowerCase() === field)
        && (
            (subjectId && String(fact?.subjectId || '').toLocaleLowerCase() === subjectId)
            || (subject && String(fact?.subject || '').toLocaleLowerCase() === subject)
        )
    )) || null;
}

function findMemoryFactForCorrection(state, correction) {
    const factId = asString(
        correction?.fact_id ?? correction?.factId ?? correction?.id,
        '',
        120,
    );
    const key = asString(correction?.key, '', 180);
    return asArray(state?.storyMemory?.facts).find(fact => (
        (factId && fact?.id === factId)
        || (key && fact?.key === key)
    )) || null;
}

function correctionPersonField(rawField) {
    const field = asString(rawField, '', 80);
    const aliases = {
        location: 'location',
        action: 'action',
        intent: 'intent',
        physical_state: 'physicalState',
        physicalState: 'physicalState',
        emotional_state: 'emotionalState',
        emotionalState: 'emotionalState',
        resource_state: 'resourceState',
        resourceState: 'resourceState',
    };
    return aliases[field] || '';
}

export function buildStateCorrectionPrompt(state, {
    narrativeText = '',
    userName = '',
} = {}) {
    const people = asArray(state?.people)
        .slice(0, LIMITS.peopleModelContext)
        .map(person => ({
            id: person.id,
            name: person.name,
            is_user: Boolean(person.isUser),
            current: {
                location: modelText(person.location, 160),
                action: modelText(person.action, 220),
                intent: modelText(person.intent, 240),
                physical_state: modelText(person.physicalState, 180),
                emotional_state: modelText(person.emotionalState, 180),
                resource_state: modelText(person.resourceState, 180),
            },
            author_anchors: {
                identity: modelText(person.identityAnchor, 360),
                background: modelText(person.backgroundProfile, 700),
                worldbook_raw: modelText(person.worldbookRaw, 1200),
                behavior_boundaries: modelText(person.behaviorBoundaries, 320),
            },
        }));

    const worldFacts = asArray(state?.worldFacts)
        .slice(0, 100)
        .map(fact => ({
            key: fact.key,
            subject: fact.subject,
            subject_id: fact.subjectId,
            field: fact.field,
            value: fact.value,
            source: fact.source,
            confidence: fact.confidence,
            validity: fact.validity,
            message_id: fact.messageId,
        }));

    const memoryFacts = asArray(state?.storyMemory?.facts)
        .filter(fact => ['active', 'disputed'].includes(fact?.status))
        .slice(0, 100)
        .map(fact => ({
            id: fact.id,
            key: fact.key,
            subject: fact.subject,
            predicate: fact.predicate,
            value: fact.value,
            status: fact.status,
            confidence: fact.confidence,
            locked: Boolean(fact.locked),
            manual: Boolean(fact.manual),
            source_excerpt: fact.sourceExcerpt,
        }));

    const activeEvents = asArray(state?.events)
        .filter(event => !TERMINAL_EVENT_STATES.has(event?.status))
        .slice(0, 60)
        .map(event => ({
            id: event.id,
            title: event.title,
            summary: event.summary,
            expected_result: event.expectedResult,
            cause: event.cause,
            caused_by: event.causedBy,
            status: event.status,
            delivery_state: event.delivery?.state || 'none',
            publicity: event.publicity,
        }));

    return [
        '你是“世界背面”的事实一致性校对员。你的任务只有纠错，不续写剧情、不创造新发展。',
        '权威顺序：用户/作者维护设定 > 正文明示事实 > 已结算事件结果 > AI后台推断。',
        '绝对禁止：',
        '1. 不能改写、删除或否认已经真实出现在正文里的历史。',
        '2. 不能因为“更合理”就创造正文没有发生过的新事实。',
        '3. 不能把角色设定里的倾向、可能性当成已经发生的状态。',
        '4. 只有能给出明确证据摘录的错误才允许修正；拿不准就不要改。',
        '5. 需要撤销派生暗流时，只能列出尚未终结、尚未递交正文的 event id；已 delivered / resolved / cancelled / missed 的事件绝不能要求删除。',
        '',
        '证据来源 evidence_source 只能是：',
        '- narrative：下面“最近正文证据”中的逐字短句；',
        '- character_anchor：人物 author_anchors 中的逐字短句；',
        '- world_background：世界背景中的逐字短句；',
        '- manual_fact：当前 source=manual 的世界事实逐字短句。',
        '',
        '允许的 correction kind：',
        '- world_fact：修正已存在的世界事实。给 key/value。',
        '- memory_fact：修正错误长期事实。给 fact_id 或 key，以及 value。',
        '- person_state：只修 location/action/intent/physical_state/emotional_state/resource_state，不得改人物性格、身份、背景、外貌或历史。',
        '',
        '如果某个错误后台事实已经衍生出尚未发生的暗流，可把 event id 放入 cancel_event_ids。不要取消只是“不喜欢”的事件，只取消明确依赖错误事实的派生。',
        '只返回合法 JSON，不要代码围栏和解释。',
        '',
        `玩家角色名：${modelText(userName, 80) || '未提供'}`,
        `世界背景：${modelText(state?.world?.background, 2400) || '（空）'}`,
        '人物状态与作者锚点：',
        JSON.stringify(people),
        '当前世界事实：',
        JSON.stringify(worldFacts),
        '当前长期事实：',
        JSON.stringify(memoryFacts),
        '当前未终结事件：',
        JSON.stringify(activeEvents),
        '最近正文证据：',
        modelText(narrativeText, 16000),
        '',
        '返回结构：',
        JSON.stringify({
            corrections: [
                {
                    kind: 'world_fact',
                    key: 'person:xxx:relationship',
                    value: '正确值',
                    evidence_source: 'character_anchor',
                    evidence: '必须逐字存在的短证据',
                    reason: '为什么现状态与证据冲突',
                },
            ],
            cancel_event_ids: [],
        }),
    ].join('\n');
}

export function applyStateCorrectionResult(inputState, rawPayload, {
    narrativeText = '',
    messageId = null,
} = {}) {
    const state = deepClone(inputState);
    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock?.absoluteMinute || 0);
    const corrections = asArray(rawPayload?.corrections).slice(0, 24);
    const appliedCorrections = [];
    const skippedCorrections = [];
    const correctedOldValues = [];

    for (const rawCorrection of corrections) {
        const kind = asString(rawCorrection?.kind, '', 40);
        const value = asString(rawCorrection?.value, '', 520);
        if (!kind || !value || !correctionEvidenceSupported(state, narrativeText, rawCorrection)) {
            skippedCorrections.push(rawCorrection);
            continue;
        }

        if (kind === 'world_fact') {
            const existing = findWorldFactForCorrection(state, rawCorrection);
            if (!existing || existing.value === value) {
                skippedCorrections.push(rawCorrection);
                continue;
            }
            if (existing.source === 'manual') {
                skippedCorrections.push(rawCorrection);
                continue;
            }
            const oldValue = existing.value;
            const result = upsertWorldFact(state, {
                ...existing,
                value,
                confidence: 'high',
                source: correctionSourceForEvidence(rawCorrection),
                message_id: messageId ?? existing.messageId,
            }, {
                source: correctionSourceForEvidence(rawCorrection),
                messageId,
            });
            if (result?.value === value) {
                correctedOldValues.push(oldValue);
                appliedCorrections.push({
                    kind,
                    key: existing.key,
                    from: oldValue,
                    to: value,
                    evidence: asString(rawCorrection?.evidence, '', 220),
                });
            } else {
                skippedCorrections.push(rawCorrection);
            }
            continue;
        }

        if (kind === 'memory_fact') {
            const existing = findMemoryFactForCorrection(state, rawCorrection);
            if (!existing || existing.locked || existing.manual || existing.value === value) {
                skippedCorrections.push(rawCorrection);
                continue;
            }
            const oldValue = existing.value;
            applyMemoryFactUpdates(state, {
                factsUpsert: [{
                    key: existing.key,
                    subject: existing.subject,
                    predicate: existing.predicate,
                    value,
                    confidence: 'high',
                    importance: existing.importance,
                    visibility: existing.visibility,
                    people: existing.people,
                    locations: existing.locations,
                    tags: uniqueStrings([...(existing.tags || []), '事实纠错'], 24),
                    source_excerpt: asString(rawCorrection?.evidence, '', 220),
                    manual: false,
                    status: 'active',
                }],
            }, {
                sourceMessageId: messageId ?? existing.sourceMessageId ?? 0,
                sourceSwipeId: existing.sourceSwipeId ?? 0,
            });
            const corrected = asArray(state.storyMemory.facts).find(fact => (
                fact.key === existing.key
                && fact.value === value
                && ['active', 'disputed'].includes(fact.status)
            ));
            if (corrected) {
                correctedOldValues.push(oldValue);
                appliedCorrections.push({
                    kind,
                    key: existing.key,
                    from: oldValue,
                    to: value,
                    evidence: asString(rawCorrection?.evidence, '', 220),
                });
            } else {
                skippedCorrections.push(rawCorrection);
            }
            continue;
        }

        if (kind === 'person_state') {
            const personId = asString(
                rawCorrection?.person_id ?? rawCorrection?.personId ?? rawCorrection?.subject_id ?? rawCorrection?.subjectId,
                '',
                120,
            );
            const personName = asString(rawCorrection?.person_name ?? rawCorrection?.personName ?? rawCorrection?.subject, '', 100);
            const person = asArray(state.people).find(item => (
                (personId && item?.id === personId)
                || (personName && item?.name === personName)
            ));
            const field = correctionPersonField(rawCorrection?.field);
            if (!person || !field || person[field] === value) {
                skippedCorrections.push(rawCorrection);
                continue;
            }
            const oldValue = asString(person[field], '', 520);
            person[field] = value;
            person.updatedAt = state.clock?.absoluteMinute || 0;
            settlePersonStateFacts(
                state,
                person,
                correctionSourceForEvidence(rawCorrection),
                messageId,
            );
            correctedOldValues.push(oldValue);
            appliedCorrections.push({
                kind,
                key: `${person.id}:${field}`,
                from: oldValue,
                to: value,
                evidence: asString(rawCorrection?.evidence, '', 220),
            });
            continue;
        }

        skippedCorrections.push(rawCorrection);
    }

    const requestedEventIds = new Set(
        uniqueStrings(rawPayload?.cancel_event_ids ?? rawPayload?.cancelEventIds, 24),
    );
    const removedEventIds = [];
    if (requestedEventIds.size && appliedCorrections.length) {
        state.events = asArray(state.events).filter(event => {
            if (!requestedEventIds.has(event?.id)) return true;
            if (
                TERMINAL_EVENT_STATES.has(event?.status)
                || event?.delivery?.state === 'delivered'
            ) return true;
            const dependencyText = normalizedEvidenceText([
                event?.title,
                event?.summary,
                event?.cause,
                event?.expectedResult,
                event?.consequence,
            ].filter(Boolean).join('\n'));
            const explicitlyDependsOnCorrectedError = correctedOldValues.some(oldValue => {
                const normalizedOld = normalizedEvidenceText(oldValue);
                return normalizedOld.length >= 2 && dependencyText.includes(normalizedOld);
            });
            if (!explicitlyDependsOnCorrectedError) return true;
            removedEventIds.push(event.id);
            return false;
        });
        if (removedEventIds.length) {
            const removed = new Set(removedEventIds);
            state.echoes = asArray(state.echoes).filter(echo => !removed.has(echo?.eventId));
            state.archive = asArray(state.archive).filter(entry => !removed.has(entry?.eventId));
            state.worldFacts = asArray(state.worldFacts).filter(fact => !(
                removed.has(fact?.eventId)
                || removedEventIds.some(eventId => String(fact?.key || '').startsWith(`event:${eventId}:`))
                || removedEventIds.some(eventId => String(fact?.key || '').startsWith(`public_event:${eventId}:`))
            ));
            state.publicImpactLedger = asArray(state.publicImpactLedger)
                .filter(record => !removed.has(record?.sourceEventId));
        }
    }

    if (appliedCorrections.length || removedEventIds.length) {
        appendAudit(state, {
            type: 'state_correction',
            text: `事实纠错：修正 ${appliedCorrections.length} 项${removedEventIds.length ? `，撤销 ${removedEventIds.length} 条未发生派生事件` : ''}`,
            reason: appliedCorrections
                .slice(0, 4)
                .map(item => `${item.key}：${item.from} → ${item.to}`)
                .join('；')
                .slice(0, 700),
        });
        state.revision = asInteger(state.revision, 0, 0) + 1;
        state.updatedAt = nowIso();
    }

    return {
        state: trimState(state),
        applied: appliedCorrections,
        skipped: skippedCorrections.length,
        removedEventIds,
        oldValues: uniqueStrings(correctedOldValues, 24),
    };
}

export function buildSimulationPrompt(state, {
    queuedEventIds = [],
    trigger = 'reply',
    latestTurn = {},
    narrativeTurns = [],
    userName = '',
    includeUserInnerVoice = false,
    recordPlayerCharacter = true,
    timePolicy = 'world',
    simulationMode = 'balanced',
    customInstruction = '',
    playerIdentityAnchor = '',
    newAssistantTurns = 1,
    backgroundNpcBudget = 4,
    worldPulseActivity = 'natural',
    enhancedBackgroundSimulation = false,
    backgroundPersonTargets = [],
    worldCoverageTargets = [],
    directorNotes = [],
} = {}) {
    const compact = compactStateForModel(state, {
        includeUserInnerVoice,
        includeUserCharacter: recordPlayerCharacter,
        userName,
        allowExpandedPeopleContext: true,
        priorityPersonIds: asArray(backgroundPersonTargets).map(item => String(item?.id || '')).filter(Boolean),
        maximumPeople: enhancedBackgroundSimulation
            ? Math.max(14, Number(backgroundNpcBudget) * 2 + 6)
            : Math.max(10, Number(backgroundNpcBudget) + 10),
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
        world: '世界钟模式：主世界时钟一旦建立就是连续时间基准。不要重新猜“现在几点”；只根据 new="true" 正文里真实发生的行动、路程、等待、睡眠、工作等估算本批实际经过时长。没有事件耗时就填 0；不得把回复轮次本身当时间。',
    }[timePolicy] || '严格时间：没有明确、可计算的时间证据就填 0。';
    const clockAuthorityRule = '绝对日期、星期和精确钟点由插件的确定性时间权威层处理。clock_anchor.mode 必须返回 none；不要猜年月日、星期或当前几点。你只负责 elapsed_minutes（本批 new=true 正文真正经过的时长）和 time_reason。正文已经明确写出的时间证据会由插件代码单独解析。';
    const identityAnchor = modelText(playerIdentityAnchor, 400);
    const playerIdentityRule = identityAnchor
        ? `用户明确设定的玩家身份锚点：${identityAnchor}。涉及玩家的性别身份、称谓/代词、外貌表达、身体设定、物种、年龄阶段或社会身份时必须逐项遵守，除非用户更新此锚点；不得根据外貌、衣着、身体或物种反推性别。`
        : '用户没有设置玩家身份锚点；正文没有明确身份或称谓时必须使用中性表述，不得根据外貌、衣着、身体或物种猜测性别。';
    const userVoiceRule = recordPlayerCharacter
        ? `玩家角色名为“${modelText(userName, 80) || '未提供'}”；允许把正文已经明确发生的玩家位置、行动与客观状态记录进 people_upsert，必须标记 is_user=true；inner_voice 必须为空，绝不替玩家描写内心活动。`
        : `玩家角色名为“${modelText(userName, 80) || '未提供'}”；本次设置明确禁止记录玩家角色：不要为玩家创建或更新 people_upsert，也不要把玩家放进 people_remove。玩家在正文里已经发生的行动仍然是世界事实，可以影响事件、物品、地点、关系和 world_facts，但不得为玩家建立人物状态卡或猜测内心。`;
    const simulationRule = {
        light: '轻量推演：先同步正文事实，再做一次很轻的世界自主检查。若已有事件后果、人物既定目标或明确环境压力已经自然形成下一步，可以新建最多1条镜头外暗流；没有因果就保持安静。',
        balanced: '均衡推演：同步正文后必须检查世界本身有没有继续往前走的理由。已有事件后果、人物目标、势力行动与环境变化都可以独立产生新的暗流；通常新增0—2条，宁缺毋滥。',
        deep: '深入推演：在保持因果与知识边界的前提下，认真维护镜头外人物、势力和事件链。可以让多个已有压力自然长出后续暗流，但每条都必须有清楚来源，不得为了热闹硬凑事故或灾难。',
        manual: '手动均衡推演：按均衡尺度同步正文并检查世界自主发展，不因为手动触发而重复旧变化。',
    }[simulationMode] || '均衡推演：同步正文，同时维护世界自身能够自然继续的因果。';
    const customRule = modelText(customInstruction, 1000);
    const pulseActivityRule = {
        quiet: '世界脉搏偏安静：优先推进已存在的宏观压力与到期事项。独立公共事件应很少，普通平稳状态完全可以持续；不要为了证明世界在运行而制造新闻。',
        natural: '世界脉搏自然：每次主世界时间真正推进后，都检查环境、城市/地区、组织/势力、经济/资源、公共设施与社会生活是否有自然变化。大多数是普通或地方变化，重大新闻必须稀少且有因果。',
        busy: '世界脉搏偏活跃：在合理因果足够时，可以让更多地区/行业/组织同时出现变化，但仍以日常、地方和行业事件为主；重大事故、战争、灾害与极端巧合仍然必须有强依据。',
    }[worldPulseActivity] || '世界脉搏自然：让镜头外社会按时间与因果正常变化。';
    const coverageTargets = asArray(worldCoverageTargets)
        .filter(item => item?.id && item?.label)
        .slice(0, 4)
        .map(item => ({
            id: asString(item.id, '', 120),
            label: asString(item.label, '', 120),
            kind: asString(item.kind, 'general', 40),
            scope: asString(item.scope, '', 160),
            source: asString(item.source, 'world', 40),
            last_checked_at: asInteger(item.lastCheckedAt, -1, -1),
        }));
    const coverageRule = coverageTargets.length
        ? `本轮必须独立检查这些长期未照看的世界范围：${JSON.stringify(coverageTargets)}。它们不是事件配额；只有当世界时间、既有压力或因果足以产生变化时才更新 world_pulse / world_facts / events。没有变化就保持安静，但不能拿当前剧情中的相近内容冒充已经检查。`
        : '本轮没有额外的镜头外覆盖目标；按现有因果正常运行。';
    const backgroundTargetList = asArray(backgroundPersonTargets)
        .filter(item => item?.id)
        .slice(0, asInteger(backgroundNpcBudget, 4, 0))
        .map(item => ({
            id: asString(item.id, '', 100),
            name: asString(item.name, '', 80),
            overdue_minutes: asInteger(item.overdueMinutes, 0, 0),
            priority_reason: ['manual-next', 'starvation-guard', 'manual-now', 'due'].includes(item?.priorityReason)
                ? item.priorityReason
                : 'due',
        }));
    const enhancedBackgroundRule = backgroundTargetList.length
        ? [
            enhancedBackgroundSimulation
                ? `强化后台人物推演已开启。本批除了前台事实协调，还必须结算 ${backgroundTargetList.length} 名优先后台人物：${JSON.stringify(backgroundTargetList)}。`
                : `后台人物保底调度触发。本批除了前台事实协调，还必须结算 ${backgroundTargetList.length} 名优先后台人物：${JSON.stringify(backgroundTargetList)}。manual-next=用户要求下一轮优先；starvation-guard=已经连续超过三个生活周期未结算。`,
            '她们必须逐个出现在 people_upsert。按照各自既有位置、行动、长期目标、日程、关系和身体/情绪/资源状态自然推进到当前世界时间；没有大事也要更新成合理的“现在正在做什么/接下来准备做什么”，不要为了交作业制造冲突。',
            '不得因为最新正文只与某一人物同场，就把这些必做人物继续冻结。',
        ].join('\n')
        : '本轮没有必须优先结算的后台人物。';
    const groupLifeRule = [
        '人物群体生活协调：镜头外人物不是逐张独立抽取的小剧场。先用精确地点/时间重合、共同事件、组织与工作、既有关系、约定和日程判断本轮是否有自然交集；有交集时先结算共同经历，再补各自余下日常。',
        '不要只因同城、同组织或关系亲近就强行碰面，不得瞬移，也不要让所有人的生活自动围着 user 转。没有自然交集时，各过各的普通日子就是正确结果。',
        '若本轮形成真实多人互动，所有实际参与的后台人物都要计入 backgroundNpcBudget 并在 people_upsert 留下彼此一致的位置、行动、意图或状态；持续/有后果的共同经历应更新同一事件，或只创建一条 actors 完整的新事件，不能为每个人复制近义事件。预算不足以更新全部参与者时，不得把互动写成已经完成。',
        '信息传播按人结算：交谈、消息、目击或共同工作只把实际传递的内容写入各接收者自己的 knowledge_updates，并写明 route/evidence/source_event_id；同地、亲密、同事或同组织都不等于共享后台全知。',
    ].join('\n');

const activeDirectorNotes = asArray(directorNotes)
        .filter(note => note?.id && note?.directive)
        .slice(0, 3)
        .map(note => ({
            id: asString(note.id, '', 100),
            directive: asString(note.directive, '', 900),
            scope: note.scope === 'next' ? 'next' : 'short',
            strength: ['natural', 'priority', 'force'].includes(note.strength) ? note.strength : 'priority',
            consumed: Boolean(note.consumed),
        }));
    const directorRule = activeDirectorNotes.length
        ? [
            '玲七导演纸条（用户明确确认的创作愿望，不是世界事实）：',
            ...activeDirectorNotes.map(note => `- [${note.id}] 强度=${note.strength}；范围=${note.scope}；${note.directive}`),
            '实现方式必须服从当前权威世界状态、人物稳定设定、知识边界、时间连续性和玩家自主意志。natural=有机会就顺势靠近；priority=本轮明显优先尝试；force=在不违反硬事实与玩家意志的前提下尽量兑现。条件不足时可以先铺设自然条件，绝不能为了兑现愿望而瞬移、改写既有事实、让人物性格突变或替玩家决定行动。',
            activeDirectorNotes.some(note => note.consumed)
                ? '这些纸条已经在本批正文生成前提供给前台模型；此处以“核对结果”为主。不要为了补做纸条而额外制造镜头外事件，只同步 new 正文已经发生的变化，并按正常世界因果维护后台。'
                : '如果纸条尚未提供给前台正文，只能在正常世界因果本来就成立时顺势支持，不能为了完成纸条凭空制造事件。',
            '对每张本轮提供的纸条，在 director_note_updates 中判断本批 new 正文实际结果：completed=已经真正兑现；continue=尚未完成但仍适合继续寻找机会；blocked=本轮客观条件不适合。memo 用一句简短说明，不要假装未发生的内容已经发生。',
        ].join('\n')
        : '本轮没有玲七导演纸条。';
    const npcBudget = asInteger(backgroundNpcBudget, 4, 0);
    const newAssistantRule = newAssistantIndexSet.size === 1
        ? '11. 较早轮次只用于理解因果，不得重复计算；本次只推演最后一个 assistant_turn（new="true"）。'
        : `11. 只处理标记 new="true" 的最后 ${newAssistantIndexSet.size} 个 assistant_turn，并按消息顺序合并变化；new="false" 的轮次只用于理解因果，不得重复计算。`;

    return [
        '你是“世界背面”的世界状态引擎。你维护一个持续运转的世界，不是正文纪要器。正文只是当前镜头；镜头外已经结算的结果同样属于真实世界。你不续写小说正文，只处理标记为 new="true" 的正文变化，并继续维护必要的镜头外因果。',
        compact.world.background
            ? `用户维护的“世界背景设定”是这个世界的基础地基，不是动态状态，也不是可改写建议：${compact.world.background}`
            : '当前没有额外填写“世界背景设定”，只按已有世界状态与正文证据运行。',
        '世界背景设定只能由用户手动编辑。你可以让世界发展改变其中描述的“当前状态”，但不得无因果违反其中的世界规则、时代/科技/魔法边界、地理、势力结构或明确时间线锚点；也绝不能在返回 world.title/detail 时偷偷改写这份背景。',
        '',
        '推演原则：',
        `1. 主世界时间是唯一进度轴。${timeRule}`,
        clockAuthorityRule,
        '1A. 世界钟无论是否已经绑定具体年月日都持续存在。没有绝对日期时沿用故事日序与已有时间精度；不要因为正文没写日期就把时间重置或停住。',
        '1B. 正文里的“明天见/下周约”等未来承诺不是当前时间已经跳转；只把本批真正发生的等待、睡眠、路程、工作与明确转场计入 elapsed_minutes。',
        '1C. clock_anchor 只是兼容返回字段，必须保持 mode=none。模型没有权限初始化或重新校准绝对世界日期。',
        `本次尺度：${simulationRule}`,
        '2. 玩家/用户的行动只能来自正文已经发生的内容，不得替玩家新增行动。',
        `3. 先做“前台事实协调”：new="true" 正文明确写出的时间、人物位置/移动、行动、身体状态、物品或环境变化必须回写。这个步骤不受后台 NPC 预算限制。完成前台协调后，本次最多更新 ${npcBudget} 名镜头外 NPC。`,
        '3A. 推演前权威状态不是可选建议。若新正文没有描写移动/返回/离场等过渡，却把人物放到与权威位置矛盾的地方，不要默默覆盖世界状态；把它写入 consistency_conflicts，并保持原世界事实。只有正文明确建立了新的过渡或可靠新事实，才接受正文并更新状态。',
        '3B. 后台推演也可以形成真实世界事实。事件一旦 resolved/cancelled/missed，或镜头外行动已经客观完成，就必须把结果结算进人物/事件状态；无法落到现有字段的稳定结果写入 world_facts_upsert。不要等正文重复确认它才算发生。world fact 必须区分 validity：current=当前仍成立，upcoming=尚未发生但已确定/预定，historical=已经结束的历史事实，persistent=事件结束后仍持续成立的后果。事件本身的 result 通常是 historical；若“暴雨结束但道路仍积水”，积水必须另写 current/persistent world fact。',
        '3C. 结算结果如果改变了人物位置、当前行动、身体/资源状态等已有结构字段，必须同步写入对应 people_upsert；不能只在 event.result 里写“已经到达卧室”，却继续让人物权威位置停在工作室。事件结果与人物/地点状态必须彼此一致。',
        '3D. 前台事实协调完成后，必须再做一次“世界自主运转检查”。最新正文只是世界输入之一，不是新事件产生的前提。检查：①已有暗流/已结算事件留下的后果是否自然形成下一步；②镜头外人物的 long_term_goal / intent 是否到了会自行行动的时候；③势力、地点、社会环境或资源压力是否已经足以产生新的合理变化；④预定时间或既有条件是否触发了此前未显露的行动。只要因果已经成立，就可以创建新的镜头外暗流，即使正文完全没有提到它。',
        '3E. “随机事件”只能从当前世界设定、地点环境、社会背景与已有压力中合理采样：可以是日常事故、天气、交通、组织动作、工作变化、资源波动等；不得无缘无故制造重大灾难、巧合强转折或专门围着玩家发生。随机只决定合理候选里哪件先发生，不负责凭空创造因果。',
        '3F. 世界自主运转不是每轮硬凑事件。若主世界时间没有实际推进、已有条件没有变化、人物目标也没有自然下一步，就可以 events_create=[]。但不能因为“正文没提到”就跳过本来已经应该发生的世界变化。',
        `3G. ${pulseActivityRule}`,
        `3G-COVERAGE. ${coverageRule}`,
        `3G-LIFE. ${enhancedBackgroundRule}`,
        `3G-GROUP. ${groupLifeRule}`,
        '3H. world_pulse 是镜头外宏观状态账本，不是新闻列表。它记录持续一段时间的环境、地区、组织/势力、经济资源、基础设施、治安、文化/媒体或社区压力。状态真正变化时才写 world_pulse_upsert；不要每轮重复同一句。pressure=0 表示平稳，1=轻微，2=明显，3=高压；trend 只描述该压力在上升、下降、波动或稳定。',
        '3I. visibility 和 publicity 是两条完全不同的轴。visibility=hidden/trace/known/direct 只表示这个事件怎样进入当前正文/角色视野；它绝不等于社会公开。卧室、私聊、秘密行动即使 visibility=direct，也通常必须 publicity=private。',
        '3J. publicity=private 表示社会不知道；publicity=trace 表示外界只有未证实迹象，可形成论坛传闻但不能成为新闻；publicity=public 表示已有公告、媒体报道、公众可见现象或广泛传播渠道，可以进入新闻。',
        '3K. 只有 publicity=trace/public 时才填写 public_trace。只有 publicity=public 时才填写 public_headline 与 public_summary；这两个字段必须只包含公众已经能知道的事实，不能复制幕后原因、私密细节或角色内心。public_summary 表示当前/最近一次公众知道的状态，不自动等于最终结局。',
        '3K-1. 当 publicity=public 的事件进入 resolved/cancelled/missed 时：如果终局已经公开，必须填写 public_result；如果终局尚未公开，public_result 留空。旧 public_summary 只会被当作历史报道，绝不能继续充当当前世界状态。',
        '3L. world_pulse 可以产生与当前主线完全无关的新暗流。公开世界事件先在世界里真实发生，再通过 publicity/public_* 字段交给舆情模块；舆情绝不能反向创造事实。',
        '3M. “公开世界事件”不等于“大事件”。天气、交通、商业、政策小变化、行业动态、地方案件、设施故障、活动、消费与网络热点都可以成立。绝大多数公共变化应该普通、地方化、可解释；真正的大型灾害、战争、政变、巨型阴谋等必须极罕见且有强因果。',
        '大量同阵营或同地点 NPC 的共同变化优先合并成势力/地点事件；名字重新出现、地点接近、关联事件到时或伏笔命中时再唤醒个人。',
        '4. 不输出百分比。duration/scheduled 事件由插件按时间计算；active 事件只填写本轮实际工作的 worked_minutes；condition 事件等待条件。',
        '5. 到时事件必须给出 resolved/cancelled/missed 之一及具体 result，或明确保持 ready；不能用 99%/100% 长期悬挂。',
        '6. NPC 第一视角独白写入 inner_voice，必须是该人物自己的口吻、20—80字，只在该人物的处境、目标或情绪有真实变化时更新。不要让所有人物每轮集体独白。',
        '人物状态中的 identity_anchor、personality_anchor、appearance_profile、background_profile、speaking_style 与 behavior_boundaries 是用户维护的稳定角色设定：必须遵守，不得在 people_upsert 中重写。identity_anchor 可包含任意性别身份、称谓/代词、物种、年龄阶段与社会身份；appearance_profile 负责外貌与身体特征；background_profile 负责背景、经历与关系。不得根据外貌、衣着、身体或物种反推或改写身份。没有身份锚点且正文也不明确时使用中性表述。',
        '人物 author_managed=true 表示由用户手动添加或从世界书导入：可以正常更新其位置、行动、意图和状态，但绝不能放进 people_remove。people_remove 只用于清理插件自行生成、且已经确定不再需要保留的临时后台人物。用户人物、author_managed 人物与 locked_profile 人物都不得由 routine simulation 删除。',
        `7. ${userVoiceRule} ${playerIdentityRule}`,
        '8. long_term_goal 是人物较稳定的长期方向；只有目标真正建立、完成、放弃或转向时才更新，不能把本轮动作重复填进去。',
        '9. inner_voice 是幕后观测信息，不得当作主角已知事实，也不得写入 deliveries_confirmed。',
        '10. deliveries_confirmed 只表示“正文是否看见了结果”，绝不决定结果是否存在。已经结算的世界事实即使没有显露也仍然有效；只有本批新正文确实承接、感知或留下可见痕迹时才填写对应事件ID。',
        newAssistantRule,
        '12. 相关旧记忆中的伏笔只能帮助保持因果连续；角色不知情的隐藏伏笔不能突然变成角色知识。',
        '12A. NPC 认知必须经过 knowledge_updates，known_event_ids / known_fact_keys / known_fact_beliefs / known_clue_ids 都是只读账本，禁止直接写入新值。每条 knowledge_updates 必须给 kind、ref、route、certainty、evidence；route 只能是 witnessed / told / investigated / message / public_channel / inferred。前台正文中的获知，evidence 必须复制本批 new=true 正文里能直接证明“这个人物如何得知”的短句；没有证据就不要提交。',
        '12A-1. inferred 只能 certainty=suspected，只能形成“怀疑/相信某个版本”，绝不能直接升级成确认知识。若是 event，belief/view 只写角色实际知道的表面版本；世界真实 summary/cause/result 可能包含幕后真相，绝不能整段复制给角色。',
        '12A-2. public_channel 只表示角色本轮确实通过新闻/公告/职业渠道接触到了公开信息；“新闻已经公开”本身不等于每个角色都看过。没有实际接触渠道就不要提交 public_channel。',
        '12A-2a. 镜头外人物新增 confirmed 知识时，除 inferred 外必须填写 source_event_id 指向本轮/既有的一条“获知过程事件”；该事件的 title/summary/cause 要明确写出这个人物如何看见、被告知、收到消息或调查得知。单纯把人物列进原秘密事件 actors 不算获知证据。',
        '12A-3. inner_voice 只能基于该人物已知/已怀疑的内容与当前身体情绪状态。若独白依赖具体认知，请在 inner_voice_basis 写 event:ID / fact:KEY / clue:ID；不得把世界全知、旁白秘密或玩家私下行为塞进角色内心。',
        '12B. event.visibility 只表示前台/玩家显露边界，不代表 NPC 是否知道。actors 只表示参与/被波及，也不等于知情；event.known_by 只是兼容镜像，插件会从通过防火墙的人物认知账本反推，不要依赖它给角色开知识。',
        '12C. physical_state / emotional_state / resource_state 是人物当前状态。状态变化必须真实影响 action、intent 与执行能力；受伤、疲劳、缺资源、权限不足或情绪压力不能下一轮凭空消失。不得发明角色卡、身份锚点、既有记忆未支持的技能、装备、权限或知识。玩家的 emotional_state 只有正文/玩家明确表达时才能更新，不得替玩家猜内心。',
        '12D. 新事件必须写明 cause。cause 可以来自：已有事件的行动/结果/后果、人物既定目标与主动行动、势力/地点/环境压力、或当前世界条件下自然发生的合理环境事件。若由已有事件继续发酵，必须在 caused_by 填上游事件 ID；若没有上游事件，则在 cause 中明确写出人物目标或环境条件。actors 只列真实参与/经历该事件的人。一个事件解决后如果产生新的未解决局面，应创建新的后续事件并用 caused_by 串起来，而不是把已经解决的旧事件无限续命。',
        '12D-1. 暗流身份必须稳定。推演前权威状态的 events 是详细事件，event_index 是因调用体积被省略详情但仍在运行的既有暗流索引；两者中的 ID 都是真实且仍存在的事件身份。只要同一件未终结事件是在推进、受阻、等待、获得新线索、改变公开状态或接近结算，就必须用 events_update 更新原 ID，禁止换标题后再 events_create 一条近义事件。即使该事件只出现在 event_index、没有完整 summary，也不能因此复制新建；信息不足时宁可保守更新或保持不变。只有出现真正独立的新因果对象，或旧事件已经终结后产生新的未解决后果时，才允许 events_create。',
        '12D-LIFE. compact people 中 life_tick_due_minutes>0 的人物属于“生活结算到期”。优先让其中最多 backgroundNpcBudget 名从她自己的 location/action/intent/long_term_goal/physical/emotional/resource 状态继续生活，而不是围着最新正文找反应。即使这段时间没有戏剧性事件，也应通过 people_upsert 给出自然的当前行动/意图，从而完成生活结算；不要为了交作业硬造冲突。只要 3G-LIFE 给出明确目标名单，无论是否开启强化后台人物推演，该名单都是本轮必做项，不得省略；其中 manual-next 是用户点了“下一轮优先”，starvation-guard 是系统防止人物长期饿死。',
        '12D-GROUP. 多人共同经历必须是同一份世界事实，不能拆成互相矛盾的个人小剧场。参与者的位置、动作、事件状态和获知内容要彼此对账；一方已离开、拒绝或尚不知情时，另一方不能假装她仍在场、已同意或已经知道。',
        '12D-1. 已解决事件本体不要为了“保留剧情”继续挂在暗流里；保留它已经造成的 world_facts / 人物状态 / 环境后果即可。真正需要继续发展的部分创建为新的事件。这样事件链会往前长，而不是反复复读旧事件。',
        '12E. 当 event.visibility=trace 时，public_trace 只写“不知内情的外界观察者实际能看见/听见/注意到的表面迹象”，例如封路、异常车流、公开可见的损坏、突然停业等；绝不能把隐藏原因、幕后行动、人物私密内容或未公开结论塞进 public_trace。hidden 事件的 public_trace 必须为空；known/direct 可按需给一条简短公开线索。',
        '12F. visibility 必须按“外界实际能察觉到什么”主动选择，而不是习惯性全部填 hidden：只有事件及其影响都无法被不知情者合理察觉时才用 hidden；幕后原因仍保密、但已经出现可见/可听/可公开注意到的表面异常时必须用 trace，并填写安全的 public_trace；已经通过公告、媒体、公开渠道传播的事实用 known；当前镜头中的人物/玩家已直接感知到的显露内容可用 direct。秘密原因 + 公开迹象的组合必须是 trace，不能因为真相保密就继续写 hidden。',
        '13. 新出现且可能在后文呼应的细节写入 memory_update.clues_upsert；普通动作和气氛不要滥记。旧伏笔开始推进时用原 ID 更新为 developing，关键条件已实际触发时可更新为 triggered；已经完成/揭晓用 clues_resolve(status=resolved)，后文证明不再需要或误判的线索用 clues_resolve(status=discarded) 并说明原因。伏笔若明确关联人物、地点或世界事件，可分别填写 people / locations / events；不要为了分类硬绑一个人物。',
        '14. 只有本批新正文明确建立或改变了未来仍有用的身份、关系、承诺、限制、物品归属或已揭示真相时，才写入 memory_update.facts_upsert。临时位置、动作和模型自行推演的幕后猜测不得写成长效事实。长期事实必须更迭：同一稳定 key 出现新值时提交新值，让旧版本退出 active；明确失效/否定时写 facts_invalidate。不要让过期事实与新事实同时保持当前有效。',
        '14A. 事实层更新只代表世界真相/档案更新，绝不能因此自动把新值塞进所有 NPC 的 known_fact_keys；NPC 认知仍只按 12A 的知情证据单独变化。',
        '14B. 为每个 new="true" 的 assistant_turn 顺手生成一条 L0 单轮摘要，写入 memory_update.turn_summaries。source_message_id 必须等于该 assistant_turn 的 message_id；summary 只总结这一轮真正发生的关键变化、关系/承诺/物品/未完问题，约 60—160 字。不要再让独立记忆任务为了同一轮正文重新请求一次模型。',
        '同一类事实使用稳定 key。正文给出新值时保留 key；插件会保留旧版本并标为 superseded。正文明确否定某条旧事实时写入 facts_invalidate；真假未定时用 status=disputed。',
        '人物 source 只有在本批 new="true" 正文真实描写到该人物时才填 foreground；镜头外人物必须填 background。present_in_scene 只有人物本人在当前场景中实际行动、说话或被直接感知时才为 true；仅被提及、回忆、谈论、作为目标或出现在内心想法里一律为 false。last_seen_message_id 必须填该人物最后实际出现的 assistant 消息 ID。',
        directorRule,
        customRule
            ? `用户自定义侧重点：${customRule}（它只能调整侧重点，不能覆盖时间证据、知识边界、玩家意志或 JSON 格式规则。若要求关注世界新闻、特定地区/行业/组织或镜头外动向，必须在完成正文事实协调后另行检查对应世界来源；不能拿最新剧情里一条相近事件当作已经满足。）`
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
            clock_anchor: {
                mode: 'none',
                calendar_name: '',
                year: null,
                month: null,
                day: null,
                hour: null,
                minute: null,
                precision: 'minute',
                confidence: 'low',
                source_excerpt: '',
                reason: '',
            },
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
                inner_voice_basis: ['event:已有事件ID | fact:事实key | clue:线索ID'],
                knowledge: 'hidden',
                cognition_ready: true,
                knowledge_updates: [{
                    kind: 'event | fact | clue',
                    ref: '事件ID / 事实key / 线索ID',
                    route: 'witnessed | told | investigated | message | public_channel | inferred',
                    certainty: 'confirmed | suspected',
                    evidence: '能证明该人物如何获知的原文短句；前台获知必须复制本批正文',
                    belief: '该人物实际知道/相信的版本；event 尤其不能复制幕后全知 summary',
                    source_event_id: '若通过公开事件/通知渠道获知，可填写来源事件ID',
                }],
                physical_state: '',
                emotional_state: '',
                resource_state: '',
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
                cause: '',
                actors: [],
                caused_by: [],
                publicity: 'private | trace | public',
                public_trace: '',
                public_headline: '',
                public_summary: '',
                public_result: '',
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
                cause: '',
                actors: [],
                caused_by: [],
                publicity: 'private | trace | public',
                public_trace: '',
                public_headline: '',
                public_summary: '',
                public_result: '',
                visibility: 'hidden',
                delivery_route: '',
            }],
            deliveries_confirmed: [],
            director_note_updates: [{
                id: 'note_xxx',
                status: 'completed | continue | blocked',
                memo: '基于本批 new 正文实际结果的一句简短说明',
            }],
            front_facts: [{
                text: '',
                affects: [],
                visibility: 'known',
            }],
            world_facts_upsert: [{
                key: 'person:人物ID:location',
                subject_type: 'person | event | world | location | item | organization | other',
                subject_id: '',
                subject: '',
                field: 'location | state | result | owner | condition | other',
                value: '',
                source: 'simulation | foreground',
                validity: 'current | upcoming | historical | persistent',
                visibility: 'hidden | trace | known | direct',
                confidence: 'high',
                event_id: '',
            }],
            world_pulse_upsert: [{
                id: '',
                label: '例如：港区物流 / 城市交通 / 商会资金链 / 季风天气',
                scope: '地区、行业、组织或社会范围',
                kind: 'environment | government | economy | organization | infrastructure | security | culture | media | community | other',
                state: '当前持续状态，不写一次性新闻标题',
                pressure: 1,
                trend: 'stable | rising | falling | volatile',
                visibility: 'hidden | trace | known',
                source: 'simulation',
                evidence: '由什么既有条件或世界设定支撑',
            }],
            consistency_conflicts: [{
                subject: '',
                field: '',
                previous_value: '',
                narrative_value: '',
                resolution: 'keep-world | accept-narrative | transition',
                reason: '',
            }],
            memory_update: {
                turn_summaries: [{
                    source_message_id: 0,
                    title: '',
                    summary: '',
                }],
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
                    events: [],
                    tags: [],
                    status: 'open | developing | triggered',
                    importance: 1,
                    visibility: 'hidden',
                }],
                clues_resolve: [{
                    id: '',
                    status: 'resolved | discarded',
                    resolution: '',
                    reason: '',
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

// Message/swipe snapshots used to copy the entire hierarchical memory pool into
// every turn. On very long chats that makes chat metadata grow roughly with
// "turns × accumulated memory". Compact snapshots keep the branch-specific
// world state plus only the summaries that end on the snapshot's own cutoff;
// older summaries are reconstructed from one chat-level archive on restore.
export function createCompactSnapshot(state, meta = {}) {
    const trimmed = trimState(deepClone(state));
    const summaries = asArray(trimmed.storyMemory?.summaries);
    const explicitCutoff = Number.parseInt(meta.memorySummaryCutoffMessageId ?? meta.messageId, 10);
    const inferredCutoff = summaries.reduce(
        (maximum, summary) => Math.max(maximum, Number(summary?.endMessageId ?? -1)),
        -1,
    );
    const cutoff = Number.isFinite(explicitCutoff) && explicitCutoff >= 0
        ? explicitCutoff
        : inferredCutoff;
    const localSummaries = cutoff >= 0
        ? summaries.filter(summary => Number(summary?.endMessageId ?? -1) === cutoff)
        : [];
    trimmed.storyMemory = {
        ...trimmed.storyMemory,
        summaries: deepClone(localSummaries),
    };
    return {
        schemaVersion: SCHEMA_VERSION,
        takenAt: nowIso(),
        meta: {
            messageId: meta.messageId ?? null,
            swipeId: meta.swipeId ?? null,
            sourceKey: asString(meta.sourceKey, '', 180),
            kind: asString(meta.kind, 'result', 30),
            compactMemory: true,
            memorySummaryCutoffMessageId: cutoff,
        },
        state: trimmed,
    };
}

export function restoreCompactSnapshot(snapshot, fallback = null, summaryPool = []) {
    const restored = restoreSnapshot(snapshot, fallback);
    if (!snapshot?.meta?.compactMemory) return restored;
    const cutoff = asInteger(snapshot?.meta?.memorySummaryCutoffMessageId, -1, -1);
    const localSummaries = asArray(snapshot?.state?.storyMemory?.summaries);
    const localIds = new Set(localSummaries.map(summary => String(summary?.id || '')).filter(Boolean));
    const archived = cutoff >= 0
        ? asArray(summaryPool).filter(summary => (
            Number(summary?.endMessageId ?? -1) < cutoff
            && !localIds.has(String(summary?.id || ''))
        ))
        : [];
    restored.storyMemory = {
        ...restored.storyMemory,
        summaries: [...archived, ...localSummaries],
    };
    return trimState(restored);
}

function normalizeRecoveryPoint(raw) {
    if (!raw || typeof raw !== 'object' || !raw.state || typeof raw.state !== 'object') return null;
    return {
        id: asString(raw.id, '', 120),
        createdAt: asString(raw.createdAt, '', 40),
        reason: asString(raw.reason, 'manual', 60),
        label: asString(raw.label, '手动恢复点', 120),
        schemaVersion: asInteger(raw.schemaVersion, 0, 0),
        worldName: asString(raw.worldName, raw.state?.world?.name || '主世界', 80),
        worldMinute: asInteger(raw.worldMinute, raw.state?.clock?.absoluteMinute ?? 0, 0),
        revision: asInteger(raw.revision, raw.state?.revision ?? 0, 0),
        state: deepClone(raw.state),
    };
}

export function listRecoveryPoints(inputStore) {
    return asArray(inputStore?.recoveryPoints)
        .map(normalizeRecoveryPoint)
        .filter(point => point?.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(-RECOVERY_LIMIT);
}

// Hot UI paths only need recovery-point metadata. Avoid cloning the full saved
// world state just to render a count/label; the full snapshot is normalized
// only when a recovery operation actually needs it.
export function listRecoveryPointHeaders(inputStore) {
    return asArray(inputStore?.recoveryPoints)
        .filter(raw => raw && typeof raw === 'object' && raw.state && typeof raw.state === 'object')
        .map(raw => ({
            id: asString(raw.id, '', 120),
            createdAt: asString(raw.createdAt, '', 40),
            reason: asString(raw.reason, 'manual', 60),
            label: asString(raw.label, '手动恢复点', 120),
            schemaVersion: asInteger(raw.schemaVersion, 0, 0),
            worldName: asString(raw.worldName, raw.state?.world?.name || '主世界', 80),
            worldMinute: asInteger(raw.worldMinute, raw.state?.clock?.absoluteMinute ?? 0, 0),
            revision: asInteger(raw.revision, raw.state?.revision ?? 0, 0),
        }))
        .filter(point => point.id)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(-RECOVERY_LIMIT);
}

export function addRecoveryPoint(inputStore, {
    reason = 'manual',
    label = '手动恢复点',
    createdAt = nowIso(),
    id = '',
} = {}) {
    const store = deepClone(inputStore || {});
    const state = store.currentState;
    if (!state || typeof state !== 'object') return store;
    const normalizedCreatedAt = asString(createdAt, nowIso(), 40);
    const signature = hashText(JSON.stringify({
        createdAt: normalizedCreatedAt,
        reason,
        revision: state.revision,
        worldMinute: state.clock?.absoluteMinute,
    }));
    const point = normalizeRecoveryPoint({
        id: asString(id, '', 120) || `recovery_${Date.parse(normalizedCreatedAt) || Date.now()}_${signature}`,
        createdAt: normalizedCreatedAt,
        reason,
        label,
        schemaVersion: inputStore?.schemaVersion ?? state.schemaVersion ?? 0,
        worldName: state.world?.name,
        worldMinute: state.clock?.absoluteMinute,
        revision: state.revision,
        state,
    });
    const points = listRecoveryPoints(store).filter(existing => existing.id !== point.id);
    store.recoveryPoints = [...points, point].slice(-RECOVERY_LIMIT);
    return store;
}

export function restoreRecoveryPoint(inputStore, recoveryId = '') {
    const store = deepClone(inputStore || {});
    const points = listRecoveryPoints(store);
    const target = recoveryId
        ? points.find(point => point.id === String(recoveryId))
        : points.at(-1);
    if (!target) return { store, point: null };
    store.currentState = trimState(target.state);
    store.recoveryPoints = points;
    store.updatedAt = nowIso();
    return { store, point: target };
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

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const DEFAULT_TAG_FILTER_RULES = Object.freeze([
    Object.freeze({ open: '<options>', close: '</options>' }),
    Object.freeze({ open: '<thinking>', close: '</thinking>' }),
    Object.freeze({ open: '<think>', close: '</think>' }),
    Object.freeze({ open: '<UpdateVariable>', close: '</UpdateVariable>' }),
    Object.freeze({ open: '<updatevariable>', close: '</updatevariable>' }),
]);

export function normalizeTagFilterRules(rawRules) {
    const list = Array.isArray(rawRules) ? rawRules : [];
    const normalized = [];
    for (const item of list) {
        if (normalized.length >= 30) break;
        const open = String(item?.open ?? '').trim().slice(0, 80);
        const close = String(item?.close ?? '').trim().slice(0, 80);
        if (!open && !close) continue;
        normalized.push({ open, close });
    }
    return normalized;
}



export function extractTagFilterCandidates(texts, existingRules = []) {
    const sources = Array.isArray(texts) ? texts : [texts];
    const existing = new Set(
        normalizeTagFilterRules(existingRules)
            .map(rule => `${rule.open}\u0000${rule.close}`),
    );
    const byName = new Map();
    const broadNames = new Set([
        'div', 'span', 'p', 'a', 'section', 'article', 'main', 'header', 'footer',
        'details', 'summary', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li',
        'style', 'script', 'content',
    ]);
    const recommendedNames = new Set([
        'think', 'thinking', 'analysis', 'options', 'updatevariable', 'jsonpatch', 'json_patch',
    ]);

    for (const source of sources) {
        const text = String(source ?? '');
        const opens = [];
        const openPattern = /<([^\s<>\/!]+)(?:\s[^<>]*?)?>/g;
        let match;
        while ((match = openPattern.exec(text))) {
            const token = match[0];
            if (/\/$/.test(token.slice(0, -1))) continue;
            const name = String(match[1] || '');
            if (!name) continue;
            opens.push({ name, token, index: match.index });
        }
        for (const item of opens) {
            const closePattern = new RegExp(`</${escapeRegExp(item.name)}\\s*>`, 'g');
            closePattern.lastIndex = item.index + item.token.length;
            const closeMatch = closePattern.exec(text);
            if (!closeMatch) continue;
            const key = item.name;
            const current = byName.get(key) || {
                name: key,
                open: item.token,
                close: closeMatch[0],
                count: 0,
                variants: new Set(),
            };
            current.count += 1;
            current.variants.add(item.token);
            byName.set(key, current);
        }
    }

    return [...byName.values()]
        .map(item => {
            const lower = item.name.toLocaleLowerCase();
            const open = item.variants.size > 1 && /\s/.test(item.open)
                ? item.open
                : item.open;
            const close = item.close;
            const alreadyAdded = existing.has(`${open}\u0000${close}`);
            const broad = broadNames.has(lower) || item.variants.size > 1;
            return {
                id: hashText(`${open}\u0000${close}`),
                tagName: item.name,
                open,
                close,
                count: item.count,
                broad,
                alreadyAdded,
                recommended: !alreadyAdded && recommendedNames.has(lower) && !broad,
            };
        })
        .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.count - a.count || a.tagName.localeCompare(b.tagName));
}

export function normalizeNarrativeRegexRules(rawRules) {
    const source = Array.isArray(rawRules)
        ? rawRules
        : String(rawRules ?? '').split(/\r?\n/);
    return source
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .map(item => item.slice(0, 260));
}

function extractIncludedNarrativeTag(text, tagName) {
    const normalized = String(tagName || '').trim();
    if (!/^[A-Za-z0-9_:-]{1,80}$/.test(normalized)) return String(text ?? '');
    const pattern = new RegExp(
        `<${escapeRegExp(normalized)}(?:\\s[^<>]*?)?>([\\s\\S]*?)<\\/${escapeRegExp(normalized)}\\s*>`,
        'gi',
    );
    const matches = [];
    let match;
    while ((match = pattern.exec(String(text ?? '')))) {
        matches.push(String(match[1] || ''));
        if (match[0] === '') pattern.lastIndex += 1;
    }
    // “只读取某标签”是便捷提取器：本条没有该标签时保留原文，
    // 避免不同预设/旧楼层因为格式不一致被整个吃空。
    return matches.length ? matches.join('\n') : String(text ?? '');
}

function compileNarrativeRegexRule(rawRule) {
    const raw = String(rawRule || '').trim();
    if (!raw) return null;
    let pattern = raw;
    let flags = 'g';
    const slash = raw.match(/^\/(.*)\/([dgimsuvy]*)$/);
    if (slash) {
        pattern = slash[1];
        flags = slash[2] || 'g';
    }
    // Replacement must scan the whole narrative. Sticky mode would only match
    // at lastIndex and is not useful for a cleanup rule.
    flags = [...new Set(`${flags.replaceAll('y', '')}g`)].join('');
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

export function filterNarrativeText(text, settings = {}) {
    let result = String(text ?? '');
    // Always strip well-formed HTML comments (non-greedy, dotAll).
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    if (settings?.tagFilterEnabled === false) return result;

    // Optional positive extraction comes first. If a preset wraps the actual
    // prose in e.g. <narrative>...</narrative>, users can simply name the tag
    // instead of maintaining a long exclusion list.
    result = extractIncludedNarrativeTag(result, settings?.narrativeIncludeTag);

    const rules = normalizeTagFilterRules(settings?.tagFilterRules);
    for (const rule of rules) {
        const { open, close } = rule;
        if (open && close) {
            const pattern = new RegExp(
                `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
                'g',
            );
            let previous;
            do {
                previous = result;
                result = result.replace(pattern, '');
            } while (result !== previous);
            continue;
        }
        if (!open && close) {
            let previous;
            do {
                previous = result;
                const index = result.indexOf(close);
                if (index === -1) break;
                result = result.slice(index + close.length);
            } while (result !== previous);
            continue;
        }
        if (open && !close) {
            const index = result.indexOf(open);
            if (index !== -1) result = result.slice(0, index);
        }
    }

    for (const rawRule of normalizeNarrativeRegexRules(settings?.narrativeRegexFilters)) {
        const pattern = compileNarrativeRegexRule(rawRule);
        if (!pattern) continue;
        result = result.replace(pattern, '');
    }
    return result;
}

/**
 * Last `count` usable assistant message ids ending at `messageId` (ascending).
 * Walks raw chat by index; does not consult narrativeContext (which drops empty-after-filter turns).
 */
export function selectPendingAssistantMessageIds(chat, messageId, count, isUsableAssistant) {
    const list = asArray(chat);
    const maxCount = Math.max(1, Number(count) || 1);
    const target = Number(messageId);
    const end = Number.isFinite(target)
        ? Math.min(Math.max(0, target), Math.max(0, list.length - 1))
        : list.length - 1;
    const usable = typeof isUsableAssistant === 'function'
        ? isUsableAssistant
        : (message) => Boolean(message && !message.is_user && !message.is_system);
    const ids = [];
    if (!list.length || end < 0) return ids;
    for (let index = end; index >= 0 && ids.length < maxCount; index -= 1) {
        if (!usable(list[index])) continue;
        ids.push(index);
    }
    return ids.reverse();
}

/** Count assistant narrative turns whose messageId is in the pending batch. */
export function countSurvivingNewAssistantTurns(narrativeTurns, pendingMessageIds) {
    const pending = new Set(asArray(pendingMessageIds).map(Number));
    return asArray(narrativeTurns).filter(
        turn => turn?.role === 'assistant' && pending.has(Number(turn.messageId)),
    ).length;
}

export function trimState(inputState) {
    const state = deepClone(inputState);
    const previousSchemaVersion = asInteger(state.schemaVersion, 0, 0);
    state.schemaVersion = SCHEMA_VERSION;
    const absoluteMinute = asInteger(state.clock?.absoluteMinute, MINUTES_PER_DAY, 0);
    const absoluteDay = Math.floor(absoluteMinute / MINUTES_PER_DAY);
    state.world = {
        name: asString(state.world?.name, '未命名世界', 80),
        title: asString(state.world?.title, '世界仍在继续', 180),
        detail: asString(state.world?.detail, '', 640),
        // User-authored foundation. Routine simulation can read it but never rewrites it.
        background: asString(state.world?.background, '', LIMITS.worldBackground),
        calendar: normalizeWorldCalendar(state.world?.calendar, absoluteDay),
    };
    const rawCalendar = state.world.calendar;
    const hasCalendarCalibrationAudit = asArray(state.audit).some(entry => (
        ['calendar_calibrated', 'clock_anchor_initialized', 'clock_anchor_recalibrated']
            .includes(entry?.type)
    ));
    const legacyCalendarLooksPlaceholder = previousSchemaVersion < 8
        && rawCalendar?.name === '主世界历'
        && Number(rawCalendar?.anchorYear) === 1
        && Number(rawCalendar?.anchorMonth) === 1
        && Number(rawCalendar?.anchorDay) === 1
        && !hasCalendarCalibrationAudit
        && ['initial', 'narrative', 'unknown'].includes(asString(state.clock?.source, 'initial', 40));
    const inferredAnchored = legacyCalendarLooksPlaceholder
        ? false
        : asString(state.clock?.source, 'initial', 40) !== 'initial';
    state.clock = {
        absoluteMinute,
        lastCheckedAt: asInteger(
            state.clock?.lastCheckedAt,
            state.clock?.absoluteMinute ?? MINUTES_PER_DAY,
            0,
        ),
        source: asString(state.clock?.source, 'unknown', 40),
        reason: asString(state.clock?.reason, '', 240),
        anchored: legacyCalendarLooksPlaceholder
            ? false
            : (state.clock?.anchored === undefined
                ? inferredAnchored
                : Boolean(state.clock?.anchored)),
        precision: legacyCalendarLooksPlaceholder
            ? 'day'
            : (['minute', 'daypart', 'date', 'day'].includes(state.clock?.precision)
                ? state.clock.precision
                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))
                    ? 'minute'
                    : 'day')),
        daypart: asString(state.clock?.daypart, '', 20),
    };

    // 人物 ID 是 UI 编辑、观测与删除操作的稳定定位键。
    // 旧状态或模型输出偶尔可能产生重复 ID；如果继续保留，点击 A 人物的操作
    // 会命中数组中更早出现的 B 人物。载入/提交状态时统一修复冲突，保留首个
    // ID，并为后续冲突项生成新的稳定 ID。
    const seenPersonIds = new Set();
    state.people = asArray(state.people)
        .map(person => normalizePerson(person, person, state.clock.absoluteMinute))
        .map(person => {
            if (!seenPersonIds.has(person.id)) {
                seenPersonIds.add(person.id);
                return person;
            }
            let nextId = makeId('person');
            while (seenPersonIds.has(nextId)) nextId = makeId('person');
            person.id = nextId;
            seenPersonIds.add(nextId);
            return person;
        });

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
    synchronizeCognitiveLedger(state);

    state.echoes = asArray(state.echoes).slice(0, LIMITS.echoes);
    state.archive = asArray(state.archive).slice(0, LIMITS.archive);
    state.foregroundFacts = asArray(state.foregroundFacts).slice(0, LIMITS.foregroundFacts);

    const normalizedWorldFacts = [];
    for (const rawFact of asArray(state.worldFacts).slice(0, LIMITS.worldFacts)) {
        const existing = normalizedWorldFacts.find(item => item.key === worldFactStableKey(rawFact));
        const fact = normalizeWorldFact(rawFact, existing, state.clock.absoluteMinute);
        if (!fact.value) continue;
        if (existing) Object.assign(existing, fact);
        else normalizedWorldFacts.push(fact);
    }
    state.worldFacts = normalizedWorldFacts;
    state.worldPulse = normalizeWorldPulse(state.worldPulse, state.clock.absoluteMinute);
    syncPublicEventRealityFacts(state, state.clock.absoluteMinute);
    state.publicImpactLedger = asArray(state.publicImpactLedger)
        .map(record => normalizePublicImpactRecord(record, state.clock.absoluteMinute))
        .filter(record => record.sourceEventId && record.fingerprint)
        .slice(0, LIMITS.publicImpactLedger);

    // Schema 14 introduces an explicit authoritative fact layer. Old person
    // locations may already lag behind the latest foreground, so migration does
    // not immediately promote them to hard facts. Terminal event results are safe
    // to retain; person state becomes authoritative after the first successful
    // 1.3 reconciliation pass.
    if (previousSchemaVersion < 14) {
        state.needsReconciliation = true;
        if (!state.worldFacts.length) {
            for (const event of state.events) settleEventResultFact(state, event, null);
        }
    } else {
        state.needsReconciliation = Boolean(state.needsReconciliation);
    }
    if (previousSchemaVersion < 15) {
        state.worldPulse.baselineEstablished = Boolean(state.worldPulse.domains.length);
        state.worldPulse.lastSweepAt = state.clock.absoluteMinute;
    }
    if (previousSchemaVersion < 16) {
        // publicity 在 normalizeEvent 中已按“明确公共传播证据”保守迁移。
        // 不允许把旧 known/direct 直接解释为社会公开。
        state.events = state.events.map(event => normalizeEvent(event, state.clock.absoluteMinute, event));
    }
    if (previousSchemaVersion < 17) {
        // 升级时把已有公共事件视为“此前世界已经包含其后果”，避免更新后
        // 把旧新闻全部重新冲击一遍人物/行业。只有之后新增或公共信息真正变化
        // 的事件才进入新的影响传播队列。
        recordProcessedPublicImpacts(
            state,
            state.events.filter(eventHasPublicPropagation),
            [],
            { reason: 'schema-17-baseline' },
        );
    }
    if (previousSchemaVersion < 18) {
        // 最新公开报道和真正公开的终局从此分开。旧终结事件不会把
        // publicSummary 自动猜成 publicResult，避免把“仍在下雨”之类旧报道
        // 升级后继续冒充当前结果。
        state.events = state.events.map(event => normalizeEvent(event, state.clock.absoluteMinute, event));
        // schema 18 的公共影响 fingerprint 只看真正公开的信息，不再看后台
        // status。升级时给现有公开事件建立新基线，避免把所有旧新闻重放一次。
        recordProcessedPublicImpacts(
            state,
            state.events.filter(eventHasPublicPropagation),
            [],
            { reason: 'schema-18-public-fingerprint-baseline' },
        );
    }
    if (previousSchemaVersion < 20) {
        // 旧认知账本曾受 actors / known_by / visibility 反向推断污染，无法可靠
        // 区分“角色真的知道”与“世界/模型知道”。升级时对 NPC 做保守清洗，
        // 之后只允许带获知路径和证据的 knowledge_updates 重新建立认知。
        state.people = state.people.map(person => {
            if (person.isUser) return person;
            return {
                ...person,
                cognitionReady: false,
                knownEventIds: [],
                knownEventViews: [],
                knownFactKeys: [],
                knownFactBeliefs: [],
                knownClueIds: [],
                innerVoice: '',
                innerVoiceAt: state.clock.absoluteMinute,
            };
        });
        state.events = state.events.map(event => ({
            ...event,
            knownBy: [],
        }));
        appendAudit(state, {
            type: 'cognition_schema_20_reset',
            text: '已清洗旧版 NPC 认知账本，等待按获知路径重新建立',
            reason: '旧版 actors/known_by/visibility 可能把世界全知泄漏给人物',
        });
    }
    if (previousSchemaVersion < 24) {
        // 首次升级不假装旧世界已经被完整巡查。coverage 保持“尚未检查”，
        // 让下一次正常世界推演或手动舆情刷新安全建立真实覆盖基线。
        state.worldPulse.coverage = normalizeWorldCoverage(
            state.worldPulse.coverage,
            state.clock.absoluteMinute,
        );
        appendAudit(state, {
            type: 'world_coverage_schema_24_ready',
            text: '镜头外公共世界轮转账本已就绪',
            reason: '首次巡查将在下一次到期世界推演中建立，不反向改写旧世界',
        });
    }

    state.consistencyConflicts = asArray(state.consistencyConflicts)
        .map(conflict => normalizeConsistencyConflict(
            conflict,
            state.clock.absoluteMinute,
            conflict?.messageId ?? null,
        ))
        .slice(0, LIMITS.consistencyConflicts);
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
