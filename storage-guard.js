import { SNAPSHOT_KEY, STATE_KEY } from './core.js';
import { pruneBranchSurfaceHistory } from './branch-surface-history.js';
import { compactSnapshotMemory, compactSnapshotMemoryLedgers } from './snapshot-memory-dedupe.js';

const GUARD_RUNTIME_KEY = '__WORLD_BACKSTAGE_STORAGE_GUARD_V2__';
const GUARD_INTERVAL_MS = 15_000;
const STARTUP_DELAY_MS = 1_500;

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function compactBranchOverrides(store) {
    if (!store?.branchOverrides || typeof store.branchOverrides !== 'object') return false;
    let changed = false;
    for (const snapshot of Object.values(store.branchOverrides)) {
        if (!snapshot || typeof snapshot !== 'object') continue;
        changed = compactSnapshotMemory(snapshot, store) || changed;
    }
    return changed;
}

function compactHistoricalSwipeSnapshots(chat) {
    if (!Array.isArray(chat) || !chat.length) return false;

    let changed = false;
    for (const message of chat) {
        if (message?.is_user || message?.is_system) continue;
        const currentSwipe = Number(message.swipe_id ?? 0);
        const currentSwipeData = message.swipe_info?.[currentSwipe]?.extra?.[SNAPSHOT_KEY];

        // Old versions could retain the exact same current-branch snapshot in both
        // message.extra and swipe_info. Remove only that duplicate container copy.
        // Alternate swipes are real histories and must never be discarded merely
        // because they are old or currently unselected.
        if (currentSwipeData && message.extra?.[SNAPSHOT_KEY]) {
            delete message.extra[SNAPSHOT_KEY];
            changed = true;
        }
    }

    return changed;
}

function validBranchSurfaceKeys(store, chat) {
    const keys = new Set(['root']);
    const remember = value => {
        const key = String(value || '').trim();
        if (key) keys.add(key);
    };
    const rememberRecord = record => {
        if (!record || typeof record !== 'object' || record.stale) return;
        remember(record.sourceKey);
        remember(record.base?.meta?.sourceKey);
        remember(record.result?.meta?.sourceKey);
    };

    remember(store?.currentState?.lastCommit?.sourceKey);
    for (const key of Object.keys(store?.branchOverrides || {})) remember(key);

    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_user || message.is_system) continue;
        rememberRecord(message.extra?.[SNAPSHOT_KEY]);
        for (const swipeInfo of message.swipe_info || []) {
            rememberRecord(swipeInfo?.extra?.[SNAPSHOT_KEY]);
        }
    }
    return [...keys];
}

let running = false;
let pendingMemoryPersistence = false;

function primeSnapshotMemoryAccessors() {
    try {
        const context = getContext();
        const store = context?.chatMetadata?.[STATE_KEY];
        if (!context || !store) return false;
        const snapshotChanged = compactSnapshotMemoryLedgers(store, context.chat, SNAPSHOT_KEY);
        const overrideChanged = compactBranchOverrides(store);
        const changed = snapshotChanged || overrideChanged;
        pendingMemoryPersistence = pendingMemoryPersistence || changed;
        return changed;
    } catch (error) {
        console.warn('[世界背面][storage-guard] 快照记忆预热失败，保留原数据', error);
        return false;
    }
}

async function runStorageGuard(reason = 'scheduled') {
    if (running) return false;
    running = true;
    try {
        const context = getContext();
        const store = context?.chatMetadata?.[STATE_KEY];
        if (!context || !store) return false;

        const memoryChanged = compactSnapshotMemoryLedgers(store, context.chat, SNAPSHOT_KEY);
        const overrideChanged = compactBranchOverrides(store);
        const swipeChanged = compactHistoricalSwipeSnapshots(context.chat);
        const surfaceChanged = pruneBranchSurfaceHistory(
            store,
            validBranchSurfaceKeys(store, context.chat),
        );
        const changed = (
            pendingMemoryPersistence
            || memoryChanged
            || overrideChanged
            || swipeChanged
            || surfaceChanged
        );
        if (!changed) return false;

        console.info(`[世界背面][storage-guard] 已整理快照存储 (${reason})`);
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
            pendingMemoryPersistence = false;
        }
        return true;
    } catch (error) {
        console.warn('[世界背面][storage-guard] 整理失败，已保留原数据', error);
        return false;
    } finally {
        running = false;
    }
}

function installStorageGuard() {
    try {
        globalThis.__WORLD_BACKSTAGE_STORAGE_GUARD_V1__?.dispose?.();
        globalThis[GUARD_RUNTIME_KEY]?.dispose?.();
    } catch (_) {
        // Ignore stale hot-reload instances.
    }

    // storage-guard loads before index.js. Reinstall compact-memory accessors now,
    // so a persisted historical branch can be restored safely during main-module startup.
    // Sidecar pruning deliberately waits for the delayed guard below, after the chat
    // and its swipe metadata have finished loading.
    primeSnapshotMemoryAccessors();

    const timer = globalThis.setInterval(
        () => void runStorageGuard('interval'),
        GUARD_INTERVAL_MS,
    );
    const onVisibilityChange = () => {
        if (globalThis.document?.visibilityState === 'hidden') {
            void runStorageGuard('background');
        }
    };
    globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);

    globalThis[GUARD_RUNTIME_KEY] = {
        dispose() {
            globalThis.clearInterval(timer);
            globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
        },
        run: runStorageGuard,
    };

    // Let the main module finish chat restoration first, then persist any legacy
    // snapshots converted during the synchronous preheat above.
    globalThis.setTimeout(() => void runStorageGuard('startup'), STARTUP_DELAY_MS);
}

installStorageGuard();

export { runStorageGuard };
