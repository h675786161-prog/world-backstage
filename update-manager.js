import { PLUGIN_VERSION } from './version.js';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_DELAY_MS = 5000;
const STORAGE_PREFIX = 'world-backstage:update-manager:';
const NOTICE_ID = 'world-backstage-update-notice';
const STYLE_ID = 'world-backstage-update-style';

function nowMs() {
    return Date.now();
}

export function extensionFolderFromUrl(url = import.meta.url) {
    try {
        const parts = new URL('.', url, globalThis.location?.href || 'http://localhost/').pathname
            .split('/')
            .map(part => decodeURIComponent(part))
            .filter(Boolean);
        return parts.at(-1) || 'world-backstage';
    } catch {
        return 'world-backstage';
    }
}

export function shouldAutoCheck(lastCheckedAt, now = nowMs()) {
    const previous = Number(lastCheckedAt) || 0;
    return previous <= 0 || now - previous >= UPDATE_CHECK_INTERVAL_MS;
}

function storageKey(extensionName) {
    return `${STORAGE_PREFIX}${extensionName}`;
}

function defaultStoredState() {
    return {
        lastCheckedAt: 0,
        updateAvailable: false,
        dismissedAt: 0,
        branch: '',
        remoteUrl: '',
        commitHash: '',
    };
}

function readStoredState(extensionName) {
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey(extensionName)) || 'null');
        if (!parsed || typeof parsed !== 'object') return defaultStoredState();
        return { ...defaultStoredState(), ...parsed };
    } catch {
        return defaultStoredState();
    }
}

function writeStoredState(extensionName, patch) {
    const next = { ...readStoredState(extensionName), ...patch };
    try {
        globalThis.localStorage?.setItem(storageKey(extensionName), JSON.stringify(next));
    } catch {
        // Update checks are convenience only; unavailable browser storage must never break the plugin.
    }
    return next;
}

async function requestHeaders() {
    try {
        const script = await import('/script.js');
        if (typeof script.getRequestHeaders === 'function') return script.getRequestHeaders();
    } catch {
        // A manual check will surface the request failure; automatic checks stay quiet.
    }
    return { 'Content-Type': 'application/json' };
}

async function postExtensionEndpoint(endpoint, extensionName, global, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的网络请求接口');
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: await requestHeaders(),
        body: JSON.stringify({ extensionName, global: Boolean(global) }),
    });
    if (!response?.ok) {
        const error = new Error(`SillyTavern extension endpoint failed (${response?.status || 0})`);
        error.status = Number(response?.status) || 0;
        throw error;
    }
    return response.json();
}

export async function requestExtensionVersion(extensionName, {
    global = false,
    fetchImpl = globalThis.fetch,
} = {}) {
    return postExtensionEndpoint('/api/extensions/version', extensionName, global, fetchImpl);
}

export async function requestExtensionUpdate(extensionName, {
    global = false,
    fetchImpl = globalThis.fetch,
} = {}) {
    return postExtensionEndpoint('/api/extensions/update', extensionName, global, fetchImpl);
}

function toast(message, kind = 'info') {
    const api = globalThis.toastr;
    const fn = api?.[kind] || api?.info;
    if (typeof fn === 'function') fn.call(api, message);
}

function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${NOTICE_ID} {
            position: fixed;
            right: max(14px, env(safe-area-inset-right));
            bottom: max(18px, calc(env(safe-area-inset-bottom) + 10px));
            z-index: 10020;
            width: min(360px, calc(100vw - 28px));
            padding: 14px 15px;
            border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 22%, transparent);
            border-radius: 16px;
            background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #17191f) 94%, transparent);
            color: var(--SmartThemeBodyColor, #f4f4f4);
            box-shadow: 0 16px 44px rgba(0,0,0,.28);
            backdrop-filter: blur(16px);
            font: 13px/1.55 system-ui, sans-serif;
        }
        #${NOTICE_ID} strong { display:block; margin-bottom:4px; font-size:14px; }
        #${NOTICE_ID} p { margin:0; opacity:.82; }
        #${NOTICE_ID} .wb-update-actions { display:flex; gap:8px; margin-top:11px; flex-wrap:wrap; }
        #${NOTICE_ID} button {
            border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
            border-radius: 999px;
            background: transparent;
            color: inherit;
            padding: 5px 10px;
            cursor: pointer;
            font: inherit;
        }
        #${NOTICE_ID} button[data-wb-update-now] { background: color-mix(in srgb, currentColor 13%, transparent); }
    `;
    document.head.appendChild(style);
}

function removeNotice() {
    if (typeof document === 'undefined') return;
    document.getElementById(NOTICE_ID)?.remove();
}

const extensionName = extensionFolderFromUrl();
const runtime = {
    phase: 'idle',
    extensionName,
    isGlobal: false,
    updateAvailable: false,
    lastCheckedAt: 0,
    branch: '',
    remoteUrl: '',
    commitHash: '',
    error: '',
};

function publicStatus() {
    return {
        phase: runtime.phase,
        extensionName: runtime.extensionName,
        isGlobal: runtime.isGlobal,
        currentVersion: PLUGIN_VERSION,
        updateAvailable: runtime.updateAvailable,
        lastCheckedAt: runtime.lastCheckedAt,
        branch: runtime.branch,
        remoteUrl: runtime.remoteUrl,
        commitHash: runtime.commitHash,
        error: runtime.error,
    };
}

function dispatchStatus() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('world-backstage:update-status', { detail: publicStatus() }));
}

function renderNotice({ force = false } = {}) {
    if (typeof document === 'undefined') return;
    installStyles();
    const stored = readStoredState(extensionName);
    if (!runtime.updateAvailable) {
        removeNotice();
        return;
    }
    if (!force && stored.dismissedAt && nowMs() - Number(stored.dismissedAt) < UPDATE_CHECK_INTERVAL_MS) {
        removeNotice();
        return;
    }

    let notice = document.getElementById(NOTICE_ID);
    if (!notice) {
        notice = document.createElement('aside');
        notice.id = NOTICE_ID;
        notice.setAttribute('role', 'status');
        notice.innerHTML = `
            <strong>世界背面有更新 ✦</strong>
            <p data-wb-update-copy></p>
            <div class="wb-update-actions">
                <button type="button" data-wb-update-now>手动更新</button>
                <button type="button" data-wb-update-later>稍后</button>
            </div>
        `;
        notice.addEventListener('click', async event => {
            const target = event.target instanceof Element ? event.target.closest('button') : null;
            if (!target) return;
            if (target.hasAttribute('data-wb-update-later')) {
                writeStoredState(extensionName, { dismissedAt: nowMs() });
                removeNotice();
                return;
            }
            if (target.hasAttribute('data-wb-update-now')) {
                target.disabled = true;
                target.textContent = '更新中…';
                try {
                    await updateNow();
                } finally {
                    target.disabled = false;
                }
            }
            if (target.hasAttribute('data-wb-update-reload')) globalThis.location?.reload?.();
        });
        document.body.appendChild(notice);
    }
    const copy = notice.querySelector('[data-wb-update-copy]');
    const nextCopy = `当前 ${PLUGIN_VERSION}。检测到仓库有更新；不会自动安装，只有你点“手动更新”才会拉取。`;
    if (copy && copy.textContent !== nextCopy) copy.textContent = nextCopy;
}

async function discoverGlobalLocation(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') return null;
    try {
        const response = await fetchImpl('/api/extensions/discover');
        if (!response?.ok) return null;
        const discovered = await response.json();
        const expectedName = `third-party/${extensionName}`;
        const match = Array.isArray(discovered)
            ? discovered.find(item => item?.name === expectedName)
            : null;
        if (!match) return null;
        if (match.type === 'global') return true;
        if (match.type === 'local') return false;
    } catch {
        // Older SillyTavern builds may not expose discovery; retain the endpoint fallback below.
    }
    return null;
}

async function versionRequestWithLocationFallback(fetchImpl = globalThis.fetch) {
    const discoveredGlobal = await discoverGlobalLocation(fetchImpl);
    if (discoveredGlobal !== null) {
        const data = await requestExtensionVersion(extensionName, { global: discoveredGlobal, fetchImpl });
        runtime.isGlobal = discoveredGlobal;
        return data;
    }
    try {
        const data = await requestExtensionVersion(extensionName, { global: false, fetchImpl });
        runtime.isGlobal = false;
        return data;
    } catch (error) {
        if (Number(error?.status) !== 404) throw error;
        const data = await requestExtensionVersion(extensionName, { global: true, fetchImpl });
        runtime.isGlobal = true;
        return data;
    }
}

export async function checkForUpdates({
    force = false,
    notify = false,
    fetchImpl = globalThis.fetch,
    now = nowMs(),
} = {}) {
    const stored = readStoredState(extensionName);
    runtime.updateAvailable = Boolean(stored.updateAvailable);
    runtime.lastCheckedAt = Number(stored.lastCheckedAt) || 0;
    runtime.branch = String(stored.branch || '');
    runtime.remoteUrl = String(stored.remoteUrl || '');
    runtime.commitHash = String(stored.commitHash || '');

    if (!force && !shouldAutoCheck(stored.lastCheckedAt, now)) {
        renderNotice();
        return publicStatus();
    }

    runtime.phase = 'checking';
    runtime.error = '';
    dispatchStatus();
    if (notify) toast('正在检查世界背面更新～', 'info');

    try {
        const data = await versionRequestWithLocationFallback(fetchImpl);
        runtime.phase = 'idle';
        runtime.updateAvailable = data?.isUpToDate === false;
        runtime.lastCheckedAt = now;
        runtime.branch = String(data?.currentBranchName || '');
        runtime.remoteUrl = String(data?.remoteUrl || '');
        runtime.commitHash = String(data?.currentCommitHash || data?.shortCommitHash || '').slice(0, 40);
        runtime.error = '';
        writeStoredState(extensionName, {
            lastCheckedAt: now,
            updateAvailable: runtime.updateAvailable,
            dismissedAt: runtime.updateAvailable ? 0 : stored.dismissedAt,
            branch: runtime.branch,
            remoteUrl: runtime.remoteUrl,
            commitHash: runtime.commitHash,
        });
        if (runtime.updateAvailable) {
            renderNotice({ force: true });
            if (notify) toast('世界背面有新更新～不会自动安装，点提示里的“手动更新”就行。', 'info');
        } else {
            removeNotice();
            if (notify) toast(`已经是最新版本 ${PLUGIN_VERSION} 啦～`, 'success');
        }
    } catch (error) {
        runtime.phase = 'error';
        runtime.error = String(error?.message || error || '检查更新失败');
        runtime.lastCheckedAt = now;
        writeStoredState(extensionName, { lastCheckedAt: now });
        // Automatic checks are deliberately quiet. A broken updater must never become a plugin-load error.
        if (notify) toast('检查更新失败了；现有世界背面不受影响，可以稍后再试。', 'warning');
    }

    dispatchStatus();
    return publicStatus();
}

export async function updateNow({ fetchImpl = globalThis.fetch } = {}) {
    runtime.phase = 'updating';
    runtime.error = '';
    dispatchStatus();
    try {
        const data = await requestExtensionUpdate(extensionName, {
            global: runtime.isGlobal,
            fetchImpl,
        });
        runtime.phase = 'updated';
        runtime.updateAvailable = false;
        runtime.commitHash = String(data?.currentCommitHash || data?.shortCommitHash || runtime.commitHash || '').slice(0, 40);
        runtime.error = '';
        writeStoredState(extensionName, {
            updateAvailable: false,
            dismissedAt: 0,
            lastCheckedAt: nowMs(),
            commitHash: runtime.commitHash,
        });
        installStyles();
        const notice = typeof document !== 'undefined' ? document.getElementById(NOTICE_ID) : null;
        if (notice) {
            notice.innerHTML = `
                <strong>更新已经拉下来啦 ✦</strong>
                <p>酒馆当前页面仍在运行旧代码；刷新后才会切到新版本。</p>
                <div class="wb-update-actions"><button type="button" data-wb-update-reload>刷新酒馆</button></div>
            `;
        }
        toast('世界背面已经更新，刷新酒馆后生效～', 'success');
        dispatchStatus();
        return { ...publicStatus(), result: data };
    } catch (error) {
        runtime.phase = 'error';
        runtime.error = String(error?.message || error || '更新失败');
        toast('更新没有拉成功；旧版本还在，世界状态不会因此被改坏。', 'error');
        renderNotice({ force: true });
        dispatchStatus();
        throw error;
    }
}

export function getUpdateStatus() {
    return publicStatus();
}

function initBrowserUpdateManager() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const stored = readStoredState(extensionName);
    runtime.updateAvailable = Boolean(stored.updateAvailable);
    runtime.lastCheckedAt = Number(stored.lastCheckedAt) || 0;
    runtime.branch = String(stored.branch || '');
    runtime.remoteUrl = String(stored.remoteUrl || '');
    runtime.commitHash = String(stored.commitHash || '');
    installStyles();
    renderNotice();

    globalThis.worldBackstageUpdateManager = {
        check: options => checkForUpdates({ force: true, notify: true, ...(options || {}) }),
        update: options => updateNow(options || {}),
        getStatus: getUpdateStatus,
        currentVersion: PLUGIN_VERSION,
        extensionName,
    };

    setTimeout(() => {
        void checkForUpdates({ force: false, notify: false });
    }, AUTO_CHECK_DELAY_MS);
}

initBrowserUpdateManager();