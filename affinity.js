export const AFFINITY_SCHEMA_VERSION = 1;
export const AFFINITY_DIMENSIONS = Object.freeze(['affection', 'trust', 'romance']);

const MAX_EVENTS = 500;
const MAX_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 800;
const MAX_TAGS = 16;
const MAX_DELTA = 20;

function nowIso() {
    return new Date().toISOString();
}

function text(value, fallback = '', maximum = MAX_TEXT_LENGTH) {
    const result = String(value ?? '').trim().slice(0, maximum);
    return result || fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}

function nullableInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function score(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.min(100, Math.max(0, Math.round(numeric)));
}

function delta(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < -MAX_DELTA || numeric > MAX_DELTA) return null;
    return numeric;
}

function hasInput(value) {
    return value !== null && value !== undefined && value !== '';
}

function validScoreInput(value) {
    if (!hasInput(value)) return true;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 100;
}

function validDeltaInput(value) {
    if (!hasInput(value)) return true;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= -MAX_DELTA && numeric <= MAX_DELTA;
}

function normalizeValues(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(AFFINITY_DIMENSIONS.map(key => [key, score(source[key])]));
}

function normalizeDeltas(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(AFFINITY_DIMENSIONS.map(key => [key, delta(source[key])]));
}

function normalizeTags(raw) {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const tag = text(item, '', 48);
        if (!tag) continue;
        const key = tag.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
        if (result.length >= MAX_TAGS) break;
    }
    return result;
}

function pairKey(sourceId, targetId) {
    return sourceId + '\u0000' + targetId;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeRelation(raw, hasEvents = false) {
    const sourceId = text(raw?.sourceId ?? raw?.source_id, '', MAX_ID_LENGTH);
    const targetId = text(raw?.targetId ?? raw?.target_id, '', MAX_ID_LENGTH);
    if (!sourceId || !targetId || sourceId === targetId) return null;

    const createdAt = text(raw?.createdAt ?? raw?.created_at, nowIso(), 40);
    const baseSource = raw?.baseValues ?? raw?.base_values
        ?? (hasEvents ? null : raw?.values);
    const baseTagsSource = raw?.baseTags ?? raw?.base_tags ?? raw?.tags;
    return {
        id: text(raw?.id, 'rel_' + sourceId + '_' + targetId, MAX_ID_LENGTH),
        sourceId,
        targetId,
        baseValues: normalizeValues(baseSource),
        values: normalizeValues(raw?.values ?? baseSource),
        baseTags: normalizeTags(baseTagsSource),
        tags: normalizeTags(raw?.tags ?? baseTagsSource),
        lastEventId: text(raw?.lastEventId ?? raw?.last_event_id, '', MAX_ID_LENGTH),
        createdAt,
        updatedAt: text(raw?.updatedAt ?? raw?.updated_at, createdAt, 40),
    };
}

function normalizeEvent(raw, fallbackSequence = 1) {
    const id = text(raw?.id ?? raw?.eventId ?? raw?.event_id, '', MAX_ID_LENGTH);
    const sourceId = text(raw?.sourceId ?? raw?.source_id, '', MAX_ID_LENGTH);
    const targetId = text(raw?.targetId ?? raw?.target_id, '', MAX_ID_LENGTH);
    if (!id || !sourceId || !targetId || sourceId === targetId) return null;

    const rawStatus = text(raw?.status, 'active', 20);
    return {
        id,
        idempotencyKey: text(raw?.idempotencyKey ?? raw?.idempotency_key, '', 300),
        sequence: integer(raw?.sequence, fallbackSequence, 1),
        sourceId,
        targetId,
        sourceKey: text(raw?.sourceKey ?? raw?.source_key, '', 240),
        sourceMessageId: nullableInteger(raw?.sourceMessageId ?? raw?.source_message_id),
        sourceSwipeId: nullableInteger(raw?.sourceSwipeId ?? raw?.source_swipe_id),
        eventType: text(raw?.eventType ?? raw?.event_type, 'interaction', 60),
        origin: raw?.origin === 'manual' ? 'manual' : 'ai',
        status: rawStatus === 'invalidated' ? 'invalidated' : 'active',
        initialValues: normalizeValues(raw?.initialValues ?? raw?.initial_values),
        deltas: normalizeDeltas(raw?.deltas ?? raw?.changes),
        beforeValues: normalizeValues(raw?.beforeValues ?? raw?.before_values),
        afterValues: normalizeValues(raw?.afterValues ?? raw?.after_values),
        suggestedTags: normalizeTags(raw?.suggestedTags ?? raw?.suggested_tags),
        manualEdit: raw?.manualEdit === true || raw?.manual_edit === true,
        manualValues: normalizeValues(raw?.manualValues ?? raw?.manual_values),
        manualTags: normalizeTags(raw?.manualTags ?? raw?.manual_tags),
        reason: text(raw?.reason, '', 1000),
        memoryNote: text(raw?.memoryNote ?? raw?.memory_note, '', 1000),
        createdAt: text(raw?.createdAt ?? raw?.created_at, nowIso(), 40),
        invalidatedAt: text(raw?.invalidatedAt ?? raw?.invalidated_at, '', 40),
        invalidationReason: text(raw?.invalidationReason ?? raw?.invalidation_reason, '', 500),
    };
}

function applyEventValues(values, event) {
    if (event.manualEdit) return normalizeValues(event.manualValues);
    const next = { ...values };
    for (const key of AFFINITY_DIMENSIONS) {
        if (next[key] === null && event.initialValues[key] !== null) {
            next[key] = event.initialValues[key];
        }
        if (next[key] !== null && event.deltas[key] !== null) {
            next[key] = Math.min(100, Math.max(0, next[key] + event.deltas[key]));
        }
    }
    return next;
}

function ensureRelation(state, sourceId, targetId) {
    let relation = state.relations.find(item => (
        item.sourceId === sourceId && item.targetId === targetId
    ));
    if (relation) return relation;

    const timestamp = nowIso();
    relation = {
        id: 'rel_' + sourceId + '_' + targetId,
        sourceId,
        targetId,
        baseValues: normalizeValues(null),
        values: normalizeValues(null),
        baseTags: [],
        tags: [],
        lastEventId: '',
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    state.relations.push(relation);
    return relation;
}

function rebuildRelation(relation, events, { touch = false } = {}) {
    let values = normalizeValues(relation.baseValues);
    let tags = normalizeTags(relation.baseTags);
    const ordered = events
        .filter(event => (
            event.status === 'active'
            && event.sourceId === relation.sourceId
            && event.targetId === relation.targetId
        ))
        .sort((a, b) => a.sequence - b.sequence);

    for (const event of ordered) {
        event.beforeValues = clone(values);
        values = applyEventValues(values, event);
        event.afterValues = clone(values);
        if (event.manualEdit) tags = normalizeTags(event.manualTags);
        else if (event.suggestedTags.length) tags = normalizeTags(event.suggestedTags);
    }

    relation.values = values;
    relation.tags = tags;
    relation.lastEventId = ordered.at(-1)?.id || '';
    if (touch) relation.updatedAt = nowIso();
    return relation;
}

export function createInitialRelationshipState() {
    return {
        schemaVersion: AFFINITY_SCHEMA_VERSION,
        nextSequence: 1,
        relations: [],
        events: [],
    };
}

export function normalizeRelationshipState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const eventCandidates = Array.isArray(source.events) ? source.events : [];
    const events = [];
    const seenIds = new Set();
    const seenIdempotencyKeys = new Set();

    eventCandidates.forEach((candidate, index) => {
        const event = normalizeEvent(candidate, index + 1);
        if (!event || seenIds.has(event.id)) return;
        if (event.idempotencyKey && seenIdempotencyKeys.has(event.idempotencyKey)) return;
        seenIds.add(event.id);
        if (event.idempotencyKey) seenIdempotencyKeys.add(event.idempotencyKey);
        events.push(event);
    });
    events.sort((a, b) => a.sequence - b.sequence);

    const eventPairs = new Set(events.map(event => pairKey(event.sourceId, event.targetId)));
    const relations = [];
    const seenPairs = new Set();
    for (const candidate of Array.isArray(source.relations) ? source.relations : []) {
        const sourceId = text(candidate?.sourceId ?? candidate?.source_id, '', MAX_ID_LENGTH);
        const targetId = text(candidate?.targetId ?? candidate?.target_id, '', MAX_ID_LENGTH);
        const key = pairKey(sourceId, targetId);
        if (!sourceId || !targetId || sourceId === targetId || seenPairs.has(key)) continue;
        const relation = normalizeRelation(candidate, eventPairs.has(key));
        if (!relation) continue;
        seenPairs.add(key);
        relations.push(relation);
    }

    const state = {
        schemaVersion: AFFINITY_SCHEMA_VERSION,
        nextSequence: integer(source.nextSequence ?? source.next_sequence, 1, 1),
        relations,
        events,
    };

    for (const event of state.events) {
        ensureRelation(state, event.sourceId, event.targetId);
    }

    if (state.events.length > MAX_EVENTS) {
        const dropped = state.events.slice(0, state.events.length - MAX_EVENTS);
        for (const relation of state.relations) {
            let base = normalizeValues(relation.baseValues);
            for (const event of dropped) {
                if (
                    event.status === 'active'
                    && event.sourceId === relation.sourceId
                    && event.targetId === relation.targetId
                ) {
                    base = applyEventValues(base, event);
                }
            }
            relation.baseValues = base;
        }
        state.events = state.events.slice(-MAX_EVENTS);
    }

    for (const relation of state.relations) {
        rebuildRelation(relation, state.events);
    }
    const maxSequence = state.events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    state.nextSequence = Math.max(state.nextSequence, maxSequence + 1);
    return state;
}

export function getRelationship(inputState, sourceId, targetId) {
    const state = normalizeRelationshipState(inputState);
    const relation = state.relations.find(item => (
        item.sourceId === String(sourceId ?? '').trim()
        && item.targetId === String(targetId ?? '').trim()
    ));
    return relation ? clone(relation) : null;
}

export function applyRelationshipEvent(inputState, rawEvent) {
    const state = normalizeRelationshipState(inputState);
    const sourceId = text(rawEvent?.sourceId ?? rawEvent?.source_id, '', MAX_ID_LENGTH);
    const targetId = text(rawEvent?.targetId ?? rawEvent?.target_id, '', MAX_ID_LENGTH);
    const eventId = text(rawEvent?.id ?? rawEvent?.eventId ?? rawEvent?.event_id, '', MAX_ID_LENGTH);
    if (!eventId || !sourceId || !targetId || sourceId === targetId) {
        return { state, applied: false, reason: 'invalid_event', eventId };
    }

    const rawDeltas = rawEvent?.deltas ?? rawEvent?.changes ?? {};
    const rawInitialValues = rawEvent?.initialValues ?? rawEvent?.initial_values ?? {};
    if (
        AFFINITY_DIMENSIONS.some(key => !validDeltaInput(rawDeltas?.[key]))
        || AFFINITY_DIMENSIONS.some(key => !validScoreInput(rawInitialValues?.[key]))
    ) {
        return { state, applied: false, reason: 'invalid_values', eventId };
    }

    const idempotencyKey = text(
        rawEvent?.idempotencyKey ?? rawEvent?.idempotency_key,
        '',
        300,
    );
    const duplicate = state.events.find(event => (
        event.id === eventId
        || (idempotencyKey && event.idempotencyKey === idempotencyKey)
    ));
    if (duplicate) {
        return { state, applied: false, reason: 'duplicate', eventId: duplicate.id };
    }

    const relation = ensureRelation(state, sourceId, targetId);
    const event = normalizeEvent({
        ...rawEvent,
        id: eventId,
        idempotencyKey,
        sequence: state.nextSequence,
        sourceId,
        targetId,
        status: 'active',
        createdAt: rawEvent?.createdAt ?? nowIso(),
        initialValues: rawInitialValues,
        deltas: rawDeltas,
    }, state.nextSequence);
    if (!event) return { state, applied: false, reason: 'invalid_event', eventId };

    state.events.push(event);
    state.nextSequence += 1;
    rebuildRelation(relation, state.events, { touch: true });
    return { state, applied: true, reason: 'applied', eventId: event.id };
}

export function invalidateRelationshipEvent(inputState, eventId, reason = '') {
    const state = normalizeRelationshipState(inputState);
    const targetId = text(eventId, '', MAX_ID_LENGTH);
    const event = state.events.find(item => item.id === targetId);
    if (!event || event.status !== 'active') {
        return { state, invalidated: false, reason: 'not_active_or_missing', eventId: targetId };
    }

    event.status = 'invalidated';
    event.invalidatedAt = nowIso();
    event.invalidationReason = text(reason, '来源事件已失效', 500);
    const relation = state.relations.find(item => (
        item.sourceId === event.sourceId && item.targetId === event.targetId
    ));
    if (relation) rebuildRelation(relation, state.events, { touch: true });
    return { state, invalidated: true, reason: 'invalidated', eventId: targetId };
}

export function invalidateRelationshipEventsBySource(inputState, sourceKey, reason = '') {
    const state = normalizeRelationshipState(inputState);
    const targetSourceKey = text(sourceKey, '', 240);
    if (!targetSourceKey) {
        return { state, invalidatedIds: [], reason: 'missing_source_key' };
    }

    const affectedPairs = new Set();
    const invalidatedIds = [];
    for (const event of state.events) {
        if (event.status !== 'active' || event.sourceKey !== targetSourceKey) continue;
        event.status = 'invalidated';
        event.invalidatedAt = nowIso();
        event.invalidationReason = text(reason, '来源消息已失效', 500);
        affectedPairs.add(pairKey(event.sourceId, event.targetId));
        invalidatedIds.push(event.id);
    }

    for (const relation of state.relations) {
        if (affectedPairs.has(pairKey(relation.sourceId, relation.targetId))) {
            rebuildRelation(relation, state.events, { touch: true });
        }
    }
    return { state, invalidatedIds, reason: invalidatedIds.length ? 'invalidated' : 'no_matching_events' };
}


export const DEFAULT_AFFINITY_PROMPT = [
    '你是世界背面的关系演化分析模块。你的任务是根据人物设定、实际事件、既有关系和人物可获得的信息，判断一次互动是否造成了持续性的情感变化。',
    '人物独立于玩家存在。你不需要讨好玩家，也不应把所有帮助都理解为好感上升。不同性格的人可以对同一件事产生完全不同的反应。',
    '好感、信任和恋爱倾向相互独立。喜欢不代表信任，信任不代表喜欢，喜欢不代表爱情，爱情不代表服从。允许复杂、矛盾和不对称的情感。',
    '普通寒暄、重复行为和没有持续意义的互动通常不改变数值。没有足够证据时，保持不变比编造变化更好。重复礼物和重复帮助应考虑边际效应。',
    '历史经历会影响当前判断。道歉不自动恢复信任，数值恢复也不代表历史伤害消失。关系变化必须符合人物性格、价值观、过往经历和当前认知。',
    '只能使用输入中明确提供的事实，以及对应人物合理知道或能推断的信息。区分事实、传闻、误解和人物主观相信的内容。不得把后台真相自动当成所有人物都知道的事实。',
    'NPC之间的关系同样重要。只分析本次事件中确实受到影响的人物对，不要把所有关系都绑定到玩家身上。',
    '恋爱倾向只在启用时分析，并遵守人物设定、取向、现有关系和情感边界。不得把友谊、亲情、敬佩、合作或依赖自动解释为爱情。',
    '每个维度的单次变化范围为 -20 到 20。普通事件可以返回 0 或 null。只有存在明确情感意义时才给出非零变化，并用简短原因解释。',
].join('\n');

const AFFINITY_OUTPUT_PROTOCOL = [
    '【固定执行协议，不受上方自定义提示词覆盖】',
    '只输出一个可解析的 JSON 对象，不要 Markdown、代码围栏或额外解释。',
    '顶层结构必须是 {"changes":[...]}。没有有效变化时返回 {"changes":[]}。',
    '每个 change 必须包含 source_id、target_id、affection_delta、trust_delta、romance_delta、reason。可选字段：event_type、initial_values、relation_tag_suggestion、memory_note。',
    'source_id 表示产生情感的一方，target_id 表示情感指向的一方。方向不能混淆。同一事件中可以返回双向关系，也可以只返回其中一方。',
    '三个 delta 必须是 -20 到 20 的整数或 null。未变化请用 0 或 null，不得返回范围外数值。',
    'initial_values 仅用于当前关系维度尚未初始化且上下文足以估计事件发生前基线的情况；其值为 0 到 100 的整数或 null。不要为了制造变化而捏造基线。',
    'relation_tag_suggestion 为可选字符串数组，只能提出建议，不代表已确认的关系状态。',
    'reason 说明这次变化为什么符合人物性格和经历；memory_note 只记录可供未来回忆的事实，不要添加未发生的事件。',
].join('\n');

const RELATIONSHIP_CUE_PATTERN = /救(?:下|了|命|助)?|帮助|帮忙|保护|照顾|陪伴|安慰|感谢|道谢|道歉|承诺|失约|欺骗|背叛|撒谎|说谎|隐瞒|坦白|告白|表白|喜欢|讨厌|信任|怀疑|依赖|嫉妒|争吵|吵架|冲突|伤害|威胁|合作|敌对|欣赏|厌恶|原谅|和解|误会|牺牲|礼物|送给|拒绝|冷落|疏远|亲近|亲吻|拥抱|倾诉|秘密|约定|失望|心疼|愧疚|感激|维护|袒护|利用|出卖|营救|舍身|救人|争执|和好|陪着|支持|拒不|不信任|forgive|betray|betrayal|trust|distrust|lie|lied|lying|apolog|confess|confession|love|hate|jealous|protect|rescue|save|help|comfort|thank|promise|break.*promise|argue|fight|hurt|threaten|support|gift|reject|reconcile|forgive|kiss|hug|rely|depend|secret|admit|admire|resent/i;

export function detectAffinityCandidate(narrative, people = []) {
    const source = String(narrative ?? '').trim().slice(0, 16000);
    if (!source) {
        return { eligible: false, mentionedPersonIds: [], reason: 'empty_narrative' };
    }
    if (!RELATIONSHIP_CUE_PATTERN.test(source)) {
        return { eligible: false, mentionedPersonIds: [], reason: 'no_relationship_cue' };
    }
    const lowered = source.toLocaleLowerCase();
    const mentioned = [];
    for (const person of Array.isArray(people) ? people : []) {
        const id = text(person?.id, '', MAX_ID_LENGTH);
        const name = text(person?.name, '', 120);
        if (!id || !name || name.length < 2) continue;
        if (lowered.includes(name.toLocaleLowerCase())) mentioned.push(id);
    }
    const uniqueIds = [...new Set(mentioned)].slice(0, 12);
    return {
        eligible: uniqueIds.length > 0,
        mentionedPersonIds: uniqueIds,
        reason: uniqueIds.length ? 'relationship_cue_and_person_mention' : 'no_known_person_mention',
    };
}

export function buildAffinityAnalysisPrompt({
    event = {},
    characters = [],
    currentRelations = [],
    relevantMemories = [],
    romanceEnabled = true,
    customPrompt = '',
} = {}) {
    const context = {
        event: {
            source_key: text(event.sourceKey ?? event.source_key, '', 240),
            source_message_id: nullableInteger(event.sourceMessageId ?? event.source_message_id),
            source_swipe_id: nullableInteger(event.sourceSwipeId ?? event.source_swipe_id),
            type: text(event.type, 'interaction', 60),
            summary: text(event.summary ?? event.narrative, '', 8000),
        },
        characters: (Array.isArray(characters) ? characters : []).slice(0, 12).map(person => ({
            id: text(person?.id, '', MAX_ID_LENGTH),
            name: text(person?.name, '', 120),
            is_player_character: Boolean(person?.isUser ?? person?.is_player_character),
            personality: text(person?.personality ?? person?.description, '', 900),
            values: text(person?.values, '', 500),
            goals: text(person?.goals, '', 500),
            current_action: text(person?.action ?? person?.current_action, '', 300),
            intent: text(person?.intent, '', 300),
            knowledge: text(person?.knowledge, 'backstage', 40),
            known_events: (Array.isArray(person?.knownEvents ?? person?.known_events)
                ? (person.knownEvents ?? person.known_events)
                : []).slice(-8).map(item => text(
                    typeof item === 'string'
                        ? item
                        : item?.summary ?? item?.description ?? item?.title ?? item?.text ?? item?.belief,
                    '',
                    220,
                )).filter(Boolean),
            known_facts: (Array.isArray(person?.knownFacts ?? person?.known_facts)
                ? (person.knownFacts ?? person.known_facts)
                : []).slice(-8).map(item => text(
                    typeof item === 'string'
                        ? item
                        : [item?.key, item?.value, item?.certainty].filter(Boolean).join(': '),
                    '',
                    220,
                )).filter(Boolean),
        })),
        current_relations: (Array.isArray(currentRelations) ? currentRelations : []).slice(0, 50).map(relation => ({
            source_id: text(relation?.sourceId ?? relation?.source_id, '', MAX_ID_LENGTH),
            target_id: text(relation?.targetId ?? relation?.target_id, '', MAX_ID_LENGTH),
            values: normalizeValues(relation?.values),
            tags: normalizeTags(relation?.tags),
        })),
        relevant_memories: (Array.isArray(relevantMemories) ? relevantMemories : [])
            .slice(-8)
            .map(item => text(typeof item === 'string' ? item : item?.text ?? item?.summary ?? item?.content, '', 600))
            .filter(Boolean),
        settings: {
            romance_enabled: Boolean(romanceEnabled),
            maximum_single_change: MAX_DELTA,
        },
    };

    const editablePrompt = text(customPrompt, DEFAULT_AFFINITY_PROMPT, 12000);
    return [
        '【任务】判断输入事件是否对人物之间的持续关系造成了变化。不要写正文，不要替角色行动。',
        '【可编辑的情感判断提示词】',
        editablePrompt,
        AFFINITY_OUTPUT_PROTOCOL,
        '【本次事件与最小必要上下文】',
        JSON.stringify(context, null, 2),
    ].join('\n\n');
}

function stableHash(value) {
    const source = String(value ?? '');
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < source.length; index += 1) {
        const code = source.charCodeAt(index);
        first = Math.imul(first ^ code, 16777619) >>> 0;
        second = Math.imul(second ^ (code + index), 3266489917) >>> 0;
    }
    return first.toString(36) + second.toString(36);
}

export function applyAffinityAnalysisPayload(inputState, payload, {
    validPersonIds = [],
    playerId = 'player',
    sourceKey = '',
    sourceMessageId = null,
    sourceSwipeId = null,
    romanceEnabled = true,
    maximumChanges = 12,
} = {}) {
    let state = normalizeRelationshipState(inputState);
    const source = text(sourceKey, '', 240);
    if (!source) {
        return { state, appliedCount: 0, duplicateCount: 0, rejectedCount: 0, reason: 'missing_source_key' };
    }

    const allowed = new Set(
        [...(Array.isArray(validPersonIds) ? validPersonIds : []), playerId, '__wb_player__', 'player']
            .map(id => text(id, '', MAX_ID_LENGTH))
            .filter(Boolean),
    );
    const changes = Array.isArray(payload?.changes) ? payload.changes.slice(0, Math.max(0, integer(maximumChanges, 12, 0, 24))) : [];
    let appliedCount = 0;
    let duplicateCount = 0;
    let rejectedCount = 0;

    for (const change of changes) {
        const sourceId = text(change?.sourceId ?? change?.source_id, '', MAX_ID_LENGTH);
        const targetId = text(change?.targetId ?? change?.target_id, '', MAX_ID_LENGTH);
        if (
            !sourceId || !targetId || sourceId === targetId
            || !allowed.has(sourceId) || !allowed.has(targetId)
        ) {
            rejectedCount += 1;
            continue;
        }

        const rawDeltas = {
            affection: change?.affectionDelta ?? change?.affection_delta,
            trust: change?.trustDelta ?? change?.trust_delta,
            romance: romanceEnabled
                ? (change?.romanceDelta ?? change?.romance_delta)
                : null,
        };
        const rawInitial = change?.initialValues ?? change?.initial_values ?? {};
        const initialValues = {
            affection: rawInitial?.affection,
            trust: rawInitial?.trust,
            romance: romanceEnabled ? rawInitial?.romance : null,
        };
        const identity = source + '|' + sourceId + '|' + targetId;
        const idempotencyKey = 'affinity:' + stableHash(identity);
        const eventId = 'affinity_' + stableHash(identity);
        const result = applyRelationshipEvent(state, {
            id: eventId,
            idempotencyKey,
            sourceId,
            targetId,
            sourceKey: source,
            sourceMessageId,
            sourceSwipeId,
            eventType: change?.eventType ?? change?.event_type ?? 'interaction',
            initialValues,
            deltas: rawDeltas,
            suggestedTags: change?.relationTagSuggestion ?? change?.relation_tag_suggestion ?? change?.suggestedTags ?? change?.suggested_tags,
            reason: change?.reason,
            memoryNote: change?.memoryNote ?? change?.memory_note,
        });
        state = result.state;
        if (result.applied) appliedCount += 1;
        else if (result.reason === 'duplicate') duplicateCount += 1;
        else rejectedCount += 1;
    }

    return {
        state,
        appliedCount,
        duplicateCount,
        rejectedCount,
        reason: changes.length ? 'processed' : 'no_changes',
    };
}



export function applyManualRelationshipEdit(inputState, {
    sourceId = '',
    targetId = '',
    values = {},
    tags = [],
    validPersonIds = [],
    playerId = '__wb_player__',
    reason = '',
} = {}) {
    const state = normalizeRelationshipState(inputState);
    const from = text(sourceId, '', MAX_ID_LENGTH);
    const to = text(targetId, '', MAX_ID_LENGTH);
    if (!from || !to || from === to) {
        return { state, applied: false, reason: 'invalid_direction' };
    }

    const allowed = new Set(
        [...(Array.isArray(validPersonIds) ? validPersonIds : []), playerId]
            .map(id => text(id, '', MAX_ID_LENGTH))
            .filter(Boolean),
    );
    if (!allowed.has(from) || !allowed.has(to)) {
        return { state, applied: false, reason: 'unknown_person' };
    }

    const rawValues = values && typeof values === 'object' ? values : {};
    if (AFFINITY_DIMENSIONS.some(key => !validScoreInput(rawValues[key]))) {
        return { state, applied: false, reason: 'invalid_values' };
    }
    if (!Array.isArray(tags) || tags.length > MAX_TAGS
        || tags.some(tag => typeof tag !== 'string' || tag.trim().length > 48)) {
        return { state, applied: false, reason: 'invalid_tags' };
    }

    const manualValues = Object.fromEntries(
        AFFINITY_DIMENSIONS.map(key => [key, hasInput(rawValues[key]) ? Number(rawValues[key]) : null]),
    );
    const manualTags = normalizeTags(tags);
    const now = nowIso();
    const eventId = 'manual_' + state.nextSequence.toString(36) + '_' + Date.now().toString(36);
    const result = applyRelationshipEvent(state, {
        id: eventId,
        idempotencyKey: eventId,
        sourceId: from,
        targetId: to,
        eventType: 'manual-edit',
        origin: 'manual',
        sourceKey: 'manual:' + eventId,
        manualEdit: true,
        manualValues,
        manualTags,
        reason: text(reason, '用户手动调整关系', 1000),
        createdAt: now,
        deltas: {},
        initialValues: {},
    });
    return { ...result, reason: result.applied ? 'manual_edit_applied' : result.reason };
}

function affinityQualitativeLabel(value) {
    const normalized = score(value);
    if (normalized === null) return '未知';
    if (normalized <= 20) return '极低';
    if (normalized <= 40) return '偏低';
    if (normalized <= 60) return '中等';
    if (normalized <= 80) return '偏高';
    return '很高';
}

export function buildRelationshipContext(inputState, people = [], recentText = '', {
    romanceEnabled = true,
    maximumRelations = 6,
} = {}) {
    const state = inputState && typeof inputState === 'object' ? inputState : {};
    const relations = Array.isArray(state.relations) ? state.relations : [];
    const events = Array.isArray(state.events) ? state.events : [];
    const roster = Array.isArray(people) ? people : [];
    const loweredText = String(recentText ?? '').toLocaleLowerCase();
    if (!loweredText || !relations.length) return '';

    const mentionedIds = new Set();
    const nameById = new Map();
    for (const person of roster) {
        const id = text(person?.id, '', MAX_ID_LENGTH);
        const name = text(person?.name, '', 120);
        if (!id || !name) continue;
        nameById.set(id, name);
        if (name.length >= 2 && loweredText.includes(name.toLocaleLowerCase())) {
            mentionedIds.add(id);
        }
    }
    if (!mentionedIds.size) return '';

    const playerPerson = roster.find(person => Boolean(person?.isUser ?? person?.is_player_character));
    const playerId = text(playerPerson?.id, '', MAX_ID_LENGTH);
    const playerIds = new Set(['__wb_player__', 'player']);
    if (playerId) playerIds.add(playerId);
    const playerLabel = text(playerPerson?.name, '玩家角色', 120);
    nameById.set('__wb_player__', playerLabel);
    nameById.set('player', playerLabel);

    const latestEventByPair = new Map();
    for (const event of events) {
        if (event?.status !== 'active') continue;
        const sourceId = text(event.sourceId, '', MAX_ID_LENGTH);
        const targetId = text(event.targetId, '', MAX_ID_LENGTH);
        if (!sourceId || !targetId) continue;
        const key = pairKey(sourceId, targetId);
        const current = latestEventByPair.get(key);
        if (!current || Number(event.sequence || 0) >= Number(current.sequence || 0)) {
            latestEventByPair.set(key, event);
        }
    }

    const relevant = relations.map(relation => {
        const sourceId = text(relation?.sourceId, '', MAX_ID_LENGTH);
        const targetId = text(relation?.targetId, '', MAX_ID_LENGTH);
        const isMentionedPair = mentionedIds.has(sourceId) && mentionedIds.has(targetId);
        const isPlayerPair = (
            (playerIds.has(sourceId) && mentionedIds.has(targetId))
            || (playerIds.has(targetId) && mentionedIds.has(sourceId))
        );
        if (!sourceId || !targetId || (!isMentionedPair && !isPlayerPair)) return null;
        const latestEvent = latestEventByPair.get(pairKey(sourceId, targetId)) || null;
        const values = normalizeValues(relation.values);
        const tags = normalizeTags(relation.tags);
        if (
            AFFINITY_DIMENSIONS.every(key => values[key] === null)
            && !tags.length
            && !latestEvent?.memoryNote
            && !latestEvent?.reason
        ) return null;
        return { relation, sourceId, targetId, values, tags, latestEvent };
    }).filter(Boolean)
        .sort((a, b) => Number(b.latestEvent?.sequence || 0) - Number(a.latestEvent?.sequence || 0))
        .slice(0, integer(maximumRelations, 6, 1, 12));

    if (!relevant.length) return '';
    const lines = [
        '当前人物关系连续性参考（后台辅助信息，不代表角色共同知识）：',
    ];
    for (const item of relevant) {
        const parts = [];
        if (item.values.affection !== null) {
            parts.push('好感' + affinityQualitativeLabel(item.values.affection));
        }
        if (item.values.trust !== null) {
            parts.push('信任' + affinityQualitativeLabel(item.values.trust));
        }
        if (romanceEnabled && item.values.romance !== null) {
            parts.push('恋爱倾向' + affinityQualitativeLabel(item.values.romance));
        }
        if (item.tags.length) parts.push('关系标签：' + item.tags.join('、'));
        const sourceName = nameById.get(item.sourceId) || item.sourceId;
        const targetName = nameById.get(item.targetId) || item.targetId;
        lines.push('- ' + sourceName + ' → ' + targetName + '：' + (parts.join('；') || '关系状态尚不明确'));
        const note = text(item.latestEvent?.memoryNote || item.latestEvent?.reason, '', 220);
        if (note) lines.push('  关系账本备注（可能含角色主观理解或分析推断，不等同于已确认事实）：' + note);
    }
    lines.push(
        '这些信息只用于指导人物自然、连续的行为，不得向玩家直接报出数值，也不得仅凭等级强制表白、服从、背叛或固定台词。每个角色只能知道其认知账本允许其知道的信息，不得把他人的隐藏情感直接当成已知事实。',
    );
    return lines.join('\n');
}
