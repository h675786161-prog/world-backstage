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
        status: rawStatus === 'invalidated' ? 'invalidated' : 'active',
        initialValues: normalizeValues(raw?.initialValues ?? raw?.initial_values),
        deltas: normalizeDeltas(raw?.deltas ?? raw?.changes),
        beforeValues: normalizeValues(raw?.beforeValues ?? raw?.before_values),
        afterValues: normalizeValues(raw?.afterValues ?? raw?.after_values),
        suggestedTags: normalizeTags(raw?.suggestedTags ?? raw?.suggested_tags),
        reason: text(raw?.reason, '', 1000),
        memoryNote: text(raw?.memoryNote ?? raw?.memory_note, '', 1000),
        createdAt: text(raw?.createdAt ?? raw?.created_at, nowIso(), 40),
        invalidatedAt: text(raw?.invalidatedAt ?? raw?.invalidated_at, '', 40),
        invalidationReason: text(raw?.invalidationReason ?? raw?.invalidation_reason, '', 500),
    };
}

function applyEventValues(values, event) {
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
    }

    relation.values = values;
    relation.tags = normalizeTags(relation.baseTags);
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
