import { SNAPSHOT_KEY, STATE_KEY } from './core.js';

const GUARD_RUNTIME_KEY = '__WORLD_BACKSTAGE_STORAGE_GUARD_V1__';

// Full branch snapshots are intentionally treated as a bounded cache. The
// authoritative currentState/initialState and the currently selected historical
// branch snapshot are never pruned by this guard.
const MAX_BRANCH_OVERRIDE_ENTRIES = 12;
const SOFT_BRANCH_OVERRIDE_BYTES = 6 * 1024 * 1024;
const HARD_BRANCH_OVERRIDE_BYTES = 10 * 1024 * 1024;
const KEEP_RECENT_ASSISTANT_SNAPSHOTS = 12;
const GUARD_INTERVAL_MS = 15_000;

function getContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function jsonByteLength(value) {
    try {
        const text = JSON.stringify(value);
        if (typeof TextEncoder === 'function') {
            return new TextEncoder().encode(text).byteLength;
        }
        // Conservative UTF-8 fallback for older WebViews.
        return unescape(encodeURIComponent(text)).length;
    } catch (error) {
        console.warn('[世界背面][storage-guard] 无法估算快照体积', error);
        return Number.POSITIVE_INFINITY;
    }
}

function currentProtectedOverrideKeys(store) {
    const keys = new Set(['root']);
    const currentSourceKey = String(store?.currentState?.lastCommit?.sourceKey || '').trim();
    if (currentSourceKey) keys.add(currentSourceKey);
    return keys;
}

function compactBranchOverrides(store) {
    if (!store?.branchOverrides || typeof store.branchOverrides !== 'object') return false;

    const protectedKeys = currentProtectedOverrideKeys(store);
    let entries = Object.entries(store.branchOverrides);
    let changed = false;

    const dropOldestUnprotected = () => {
        const index = entries.findIndex(([key]) => !protectedKeys.has(key));
        if (index < 0) return false;
        const [key] = entries[index];
        delete store.branchOverrides[key];
        entries.splice(index, 1);
        changed = true;
        return true;
    };

    // Count-first pruning avoids serializing dozens of multi-megabyte snapshots
    // merely to discover a chat is already far above the safe budget.
    while (entries.length > MAX_BRANCH_OVERRIDE_ENTRIES) {
        if (!dropOldestUnprotected()) break;
    }

    let totalBytes = entries.reduce((sum, [, snapshot]) => sum + jsonByteLength(snapshot), 0);
    while (totalBytes > SOFT_BRANCH_OVERRIDE_BYTES) {
        const index = entries.findIndex(([key]) => !protectedKeys.has(key));
        if (index < 0) break;
        const [, snapshot] = entries[index];
        const snapshotBytes = jsonByteLength(snapshot);
        const [key] = entries[index];
        delete store.branchOverrides[key];
        entries.splice(index, 1);
        totalBytes = Math.max(0, totalBytes - snapshotBytes);
        changed = true;
    }

    if (totalBytes > HARD_BRANCH_OVERRIDE_BYTES) {
        console.warn(
            `[世界背面][storage-guard] 受保护的分支快照仍占 ${(totalBytes / 1024 / 1024).toFixed(2)} MiB；` +
            '已停止继续删除，避免破坏当前分支。',
        );
    }

    return changed;
}

function compactHistoricalSwipeSnapshots(chat) {
    if (!Array.isArray(chat) || !chat.length) return false;

    const assistantIndexes = chat
        .map((message, index) => (!message?.is_user && !message?.is_system ? index : -1))
        .filter(index => index >= 0);
    const recentStart = assistantIndexes.length > KEEP_RECENT_ASSISTANT_SNAPSHOTS
        ? assistantIndexes[assistantIndexes.length - KEEP_RECENT_ASSISTANT_SNAPSHOTS]
        : -1;

    let changed = false;
    for (const [index, message] of chat.entries()) {
        if (message?.is_user || message?.is_system) continue;

        const currentSwipe = Number(message.swipe_id ?? 0);
        const currentSwipeData = message.swipe_info?.[currentSwipe]?.extra?.[SNAPSHOT_KEY];

        // Old versions could retain the same full snapshot in both places.
        if (currentSwipeData && message.extra?.[SNAPSHOT_KEY]) {
            delete message.extra[SNAPSHOT_KEY];
            changed = true;
        }

        if (recentStart < 0 || index >= recentStart) continue;

        // Beyond the recent editing window only the selected swipe needs a
        // restorable world snapshot. Text/swipe content itself is untouched.
        for (let swipeId = 0; swipeId < (message.swipe_info?.length || 0); swipeId += 1) {
            if (swipeId === currentSwipe) continue;
            const extra = message.swipe_info?.[swipeId]?.extra;
            if (!extra?.[SNAPSHOT_KEY]) continue;
            delete extra[SNAPSHOT_KEY];
            changed = true;
        }
    }

    return changed;
}

let running = false;
async function runStorageGuard(reason = 'scheduled') {
    if (running) return false;
    running = true;
    try {
        const context = getContext();
        const store = context?.chatMetadata?.[STATE_KEY];
        if (!context || !store) return false;

        const branchChanged = compactBranchOverrides(store);
        const swipeChanged = compactHistoricalSwipeSnapshots(context.chat);
        const changed = branchChanged || swipeChanged;
        if (!changed) return false;

        console.info(`[世界背面][storage-guard] 已整理快照存储 (${reason})`);
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
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
        globalThis[GUARD_RUNTIME_KEY]?.dispose?.();
    } catch (_) {
        // Ignore stale hot-reload instances.
    }

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

    // Let the main module finish chat restoration first, then clean legacy bloat.
    globalThis.setTimeout(() => void runStorageGuard('startup'), 800);
}

installStorageGuard();

export { runStorageGuard };
