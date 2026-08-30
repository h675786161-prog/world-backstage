const ARCHIVE_VERSION = 1;
const LEDGER_FIELDS = Object.freeze({
    digest: 'digest',
    facts: 'fact',
    clues: 'clue',
    metabolismLog: 'metabolism',
});
const OMITTED_LEDGER_KEYS = new Set(Object.keys(LEDGER_FIELDS));

function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function hashText(text = '') {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function ensureArchive(store) {
    if (!store || typeof store !== 'object') return null;
    const raw = store.memoryLedgerArchive;
    if (
        raw
        && typeof raw === 'object'
        && Number(raw.version) === ARCHIVE_VERSION
        && raw.items && typeof raw.items === 'object'
        && raw.lookup && typeof raw.lookup === 'object'
    ) {
        raw.nextId = Math.max(1, Number.parseInt(raw.nextId, 10) || 1);
        return raw;
    }
    const archive = {
        version: ARCHIVE_VERSION,
        nextId: 1,
        items: {},
        lookup: {},
    };
    store.memoryLedgerArchive = archive;
    return archive;
}

function serialize(value) {
    return JSON.stringify(value ?? null);
}

function fingerprint(kind, serialized) {
    return `${kind}:${serialized.length}:${hashText(serialized)}`;
}

function internValue(store, kind, value) {
    const archive = ensureArchive(store);
    if (!archive) return '';
    const serialized = serialize(value);
    const key = fingerprint(kind, serialized);
    const candidates = Array.isArray(archive.lookup[key]) ? archive.lookup[key] : [];
    for (const ref of candidates) {
        const existing = archive.items?.[ref];
        if (!existing || existing.kind !== kind) continue;
        if (serialize(existing.value) === serialized) return ref;
    }

    const ref = Math.max(1, Number(archive.nextId) || 1).toString(36);
    archive.nextId = Math.max(1, Number(archive.nextId) || 1) + 1;
    archive.items[ref] = { kind, value: cloneValue(value ?? null) };
    archive.lookup[key] = [...candidates, ref];
    return ref;
}

function resolveValue(store, kind, ref) {
    const archive = ensureArchive(store);
    const entry = ref ? archive?.items?.[ref] : null;
    if (!entry || entry.kind !== kind) {
        throw new Error(`[世界背面] 历史快照记忆引用缺失：${kind}/${String(ref || 'empty')}`);
    }
    return cloneValue(entry.value);
}

function internArray(store, kind, values) {
    return (Array.isArray(values) ? values : []).map(value => internValue(store, kind, value));
}

function resolveArray(store, kind, refs) {
    return (Array.isArray(refs) ? refs : []).map(ref => resolveValue(store, kind, ref));
}

function makeLedgerRefs(storyMemory, store) {
    return {
        version: ARCHIVE_VERSION,
        digest: internValue(store, LEDGER_FIELDS.digest, storyMemory?.digest ?? null),
        facts: internArray(store, LEDGER_FIELDS.facts, storyMemory?.facts),
        clues: internArray(store, LEDGER_FIELDS.clues, storyMemory?.clues),
        metabolismLog: internArray(store, LEDGER_FIELDS.metabolismLog, storyMemory?.metabolismLog),
    };
}

function defineLedgerProperty(storyMemory, store, key, kind, isArray) {
    Object.defineProperty(storyMemory, key, {
        enumerable: true,
        configurable: true,
        get() {
            const refs = this._ledgerRefs || {};
            return isArray
                ? resolveArray(store, kind, refs[key])
                : resolveValue(store, kind, refs[key]);
        },
        set(value) {
            const refs = this._ledgerRefs || { version: ARCHIVE_VERSION };
            refs[key] = isArray
                ? internArray(store, kind, value)
                : internValue(store, kind, value ?? null);
            this._ledgerRefs = refs;
        },
    });
}

function installLedgerAccessors(storyMemory, store) {
    if (!storyMemory || typeof storyMemory !== 'object') return false;
    const refs = storyMemory._ledgerRefs;
    if (!refs || Number(refs.version) !== ARCHIVE_VERSION) return false;

    defineLedgerProperty(storyMemory, store, 'digest', LEDGER_FIELDS.digest, false);
    defineLedgerProperty(storyMemory, store, 'facts', LEDGER_FIELDS.facts, true);
    defineLedgerProperty(storyMemory, store, 'clues', LEDGER_FIELDS.clues, true);
    defineLedgerProperty(storyMemory, store, 'metabolismLog', LEDGER_FIELDS.metabolismLog, true);

    Object.defineProperty(storyMemory, 'toJSON', {
        enumerable: false,
        configurable: true,
        value() {
            const output = {};
            for (const key of Object.keys(this)) {
                if (OMITTED_LEDGER_KEYS.has(key)) continue;
                output[key] = this[key];
            }
            return output;
        },
    });
    return true;
}

export function compactStoryMemoryLedger(storyMemory, store) {
    if (!storyMemory || typeof storyMemory !== 'object') return false;
    if (storyMemory._ledgerRefs && Number(storyMemory._ledgerRefs.version) === ARCHIVE_VERSION) {
        installLedgerAccessors(storyMemory, store);
        return false;
    }

    const refs = makeLedgerRefs(storyMemory, store);
    Object.defineProperty(storyMemory, '_ledgerRefs', {
        value: refs,
        writable: true,
        enumerable: true,
        configurable: true,
    });
    installLedgerAccessors(storyMemory, store);
    return true;
}

export function compactSnapshotMemory(snapshot, store) {
    const storyMemory = snapshot?.state?.storyMemory;
    return compactStoryMemoryLedger(storyMemory, store);
}

export function compactBranchDataMemory(data, store) {
    if (!data || typeof data !== 'object') return false;
    let changed = false;
    if (data.base) changed = compactSnapshotMemory(data.base, store) || changed;
    if (data.result) changed = compactSnapshotMemory(data.result, store) || changed;
    return changed;
}

export function compactSnapshotMemoryLedgers(store, chat, snapshotKey = 'world_backstage') {
    if (!store || typeof store !== 'object') return false;
    let changed = false;

    for (const snapshot of Object.values(store.branchOverrides || {})) {
        changed = compactSnapshotMemory(snapshot, store) || changed;
    }

    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_user || message.is_system) continue;
        const extras = [];
        if (message.extra?.[snapshotKey]) extras.push(message.extra[snapshotKey]);
        for (const swipeInfo of message.swipe_info || []) {
            if (swipeInfo?.extra?.[snapshotKey]) extras.push(swipeInfo.extra[snapshotKey]);
        }
        for (const data of extras) changed = compactBranchDataMemory(data, store) || changed;
    }

    return changed;
}

export function memoryLedgerStats(store) {
    const archive = ensureArchive(store);
    const items = Object.values(archive?.items || {});
    return {
        items: items.length,
        facts: items.filter(item => item?.kind === LEDGER_FIELDS.facts).length,
        clues: items.filter(item => item?.kind === LEDGER_FIELDS.clues).length,
        digests: items.filter(item => item?.kind === LEDGER_FIELDS.digest).length,
        metabolism: items.filter(item => item?.kind === LEDGER_FIELDS.metabolismLog).length,
    };
}
