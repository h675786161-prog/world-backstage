export function readBranchRecord(message, swipeId, snapshotKey = 'world_backstage') {
    if (!message || typeof message !== 'object') return null;
    const targetSwipe = Number(swipeId ?? message?.swipe_id ?? 0);
    const currentSwipe = Number(message?.swipe_id ?? 0);
    const swipeInfo = Array.isArray(message?.swipe_info) ? message.swipe_info : [];

    // When SillyTavern exposes per-swipe metadata, that is the only authoritative
    // store for a specific swipe. Falling back to message.extra here can lend the
    // selected branch's snapshot to another swipe that has no snapshot of its own.
    if (swipeInfo.length) {
        const record = swipeInfo[targetSwipe]?.extra?.[snapshotKey];
        return record && typeof record === 'object' ? record : null;
    }

    // Legacy/compatibility message shapes may only expose message.extra. Such data
    // can only describe the currently selected swipe, never an arbitrary alternate.
    if (targetSwipe !== currentSwipe) return null;
    const record = message?.extra?.[snapshotKey];
    return record && typeof record === 'object' ? record : null;
}

export function branchRecordMatchesSource(record, sourceKey) {
    if (!record || typeof record !== 'object' || record.stale) return false;
    const expected = String(sourceKey || '');
    return Boolean(expected && String(record.sourceKey || '') === expected);
}

export function committedBranchMatchesSource(record, sourceKey) {
    return Boolean(
        branchRecordMatchesSource(record, sourceKey)
        && record.status === 'committed'
        && record.result
    );
}
