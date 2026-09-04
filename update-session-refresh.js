export const SESSION_RECHECK_DELAY_MS = 6500;
export const RETURN_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

function numericTime(value) {
    return Math.max(0, Number(value) || 0);
}

export function shouldForceSessionRecheck(initialLastCheckedAt, currentLastCheckedAt) {
    return numericTime(currentLastCheckedAt) === numericTime(initialLastCheckedAt);
}

export function shouldRecheckAfterReturn(lastCheckedAt, now = Date.now()) {
    const previous = numericTime(lastCheckedAt);
    if (previous <= 0) return false;
    return numericTime(now) - previous >= RETURN_RECHECK_INTERVAL_MS;
}

async function silentForcedCheck(manager) {
    try {
        await manager?.check?.({ force: true, notify: false });
    } catch {
        // 更新提示只是便利功能，失败不能影响世界背面本体。
    }
}

function initSessionRefresh() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const manager = globalThis.worldBackstageUpdateManager;
    if (!manager?.getStatus || !manager?.check) return;

    const initialLastCheckedAt = numericTime(manager.getStatus()?.lastCheckedAt);

    setTimeout(() => {
        const status = manager.getStatus?.() || {};
        if (status.phase === 'checking' || status.phase === 'updating') return;
        if (shouldForceSessionRecheck(initialLastCheckedAt, status.lastCheckedAt)) {
            void silentForcedCheck(manager);
        }
    }, SESSION_RECHECK_DELAY_MS);

    const checkOnReturn = () => {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        const status = manager.getStatus?.() || {};
        if (status.phase === 'checking' || status.phase === 'updating') return;
        if (shouldRecheckAfterReturn(status.lastCheckedAt)) {
            void silentForcedCheck(manager);
        }
    };

    window.addEventListener('focus', checkOnReturn, { passive: true });
    document.addEventListener('visibilitychange', checkOnReturn, { passive: true });
}

initSessionRefresh();
