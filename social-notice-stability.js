const STATE_KEY = 'world_backstage_v1';
const STYLE_ID = 'wb-social-notice-stability-v3-test';
const DESKTOP_QUERY = '(min-width: 701px) and (min-height: 521px)';
const NOTICE_GAP = 14;
const VIEWPORT_GAP = 16;

function getContext() { return globalThis.SillyTavern?.getContext?.() || null; }

function installStyle() {
    document.getElementById('wb-social-notice-stability-v2-test')?.remove();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#world-backstage-root .wb-social-notice { visibility: hidden !important; animation: none !important; }
#world-backstage-root .wb-social-notice[data-wb-notice-ready='1'] { visibility: visible !important; }

/* 桌面通知保持紧凑；位置由脚本根据悬浮球实时避让。 */
@media (min-width: 701px) and (min-height: 521px) {
    #world-backstage-root .wb-social-notice {
        width: min(320px, calc(100dvw - 32px)) !important;
        max-width: 320px !important;
    }
    #world-backstage-root .wb-social-notice-main {
        grid-template-columns: 36px minmax(0, 1fr) !important;
        gap: 9px !important;
        padding: 9px 5px 9px 10px !important;
    }
    #world-backstage-root .wb-social-notice .wb-person-avatar.is-social,
    #world-backstage-root .wb-social-notice-avatar {
        width: 36px !important;
        height: 36px !important;
        min-width: 36px !important;
    }
    #world-backstage-root .wb-social-notice-close {
        margin-top: 5px !important;
    }
}
`;
    document.head.appendChild(style);
}

function socialStore() { return getContext()?.chatMetadata?.[STATE_KEY]?.social || null; }
function persistStore() {
    const context = getContext();
    if (typeof context?.saveMetadata === 'function') void context.saveMetadata();
    else context?.saveMetadataDebounced?.();
}

function markConversationRead(conversationId) {
    const id = String(conversationId || '').trim();
    if (!id) return false;
    const notices = socialStore()?.notices;
    if (!Array.isArray(notices)) return false;
    const now = new Date().toISOString();
    let changed = false;
    for (const notice of notices) {
        if (!notice || notice.readAt || notice.read_at) continue;
        if (String(notice.kind || '') !== 'message') continue;
        if (String(notice.conversationId || notice.conversation_id || '') !== id) continue;
        notice.readAt = now;
        changed = true;
    }
    if (changed) persistStore();
    return changed;
}

function markNoticeRead(noticeId) {
    const id = String(noticeId || '').trim();
    if (!id) return false;
    const notices = socialStore()?.notices;
    if (!Array.isArray(notices)) return false;
    const notice = notices.find(item => String(item?.id || '') === id);
    if (!notice || notice.readAt || notice.read_at) return false;
    notice.readAt = new Date().toISOString();
    persistStore();
    return true;
}

function activeViewedConversation(root) {
    const shell = root?.querySelector?.('.wb-social-shell');
    if (!(shell instanceof HTMLElement)) return '';
    const messagesTab = shell.querySelector('.wb-social-page-tabs [data-page="messages"].is-active');
    if (!(messagesTab instanceof HTMLElement)) return '';
    const activeButton = shell.querySelector('.wb-social-conversations [data-wb-action="social-select-conversation"].is-active[data-conversation-id]');
    return String(activeButton?.dataset?.conversationId || '').trim();
}

function isUnread(noticeId) {
    const notices = socialStore()?.notices;
    if (!Array.isArray(notices)) return false;
    const notice = notices.find(item => String(item?.id || '') === String(noticeId || ''));
    return Boolean(notice && !(notice.readAt || notice.read_at));
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function clearDesktopPosition(notice) {
    for (const property of ['left', 'right', 'top', 'bottom', 'transform']) {
        notice.style.removeProperty(property);
    }
    notice.removeAttribute('data-wb-notice-orb-side');
}

function placeDesktopNotice(notice, root) {
    if (!(notice instanceof HTMLElement)) return;
    if (!globalThis.matchMedia?.(DESKTOP_QUERY)?.matches) {
        clearDesktopPosition(notice);
        return;
    }

    const orb = root.querySelector('.wb-world-orb');
    const viewportWidth = Math.max(0, Number(globalThis.innerWidth) || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.max(0, Number(globalThis.innerHeight) || document.documentElement.clientHeight || 0);
    if (!viewportWidth || !viewportHeight) return;

    const noticeRect = notice.getBoundingClientRect();
    const width = Math.max(220, noticeRect.width || 320);
    const height = Math.max(58, noticeRect.height || 72);

    let x = viewportWidth - VIEWPORT_GAP - width;
    let y = VIEWPORT_GAP;
    let side = 'corner';

    if (orb instanceof HTMLElement) {
        const orbRect = orb.getBoundingClientRect();
        const orbVisible = orbRect.width > 1 && orbRect.height > 1
            && orbRect.right > 0 && orbRect.bottom > 0
            && orbRect.left < viewportWidth && orbRect.top < viewportHeight;

        if (orbVisible) {
            const roomLeft = orbRect.left - VIEWPORT_GAP;
            const roomRight = viewportWidth - orbRect.right - VIEWPORT_GAP;
            const roomBelow = viewportHeight - orbRect.bottom - VIEWPORT_GAP;
            const roomAbove = orbRect.top - VIEWPORT_GAP;

            if (roomLeft >= width + NOTICE_GAP) {
                x = orbRect.left - NOTICE_GAP - width;
                y = clamp(orbRect.top + (orbRect.height - height) / 2, VIEWPORT_GAP, viewportHeight - VIEWPORT_GAP - height);
                side = 'left';
            } else if (roomRight >= width + NOTICE_GAP) {
                x = orbRect.right + NOTICE_GAP;
                y = clamp(orbRect.top + (orbRect.height - height) / 2, VIEWPORT_GAP, viewportHeight - VIEWPORT_GAP - height);
                side = 'right';
            } else if (roomBelow >= height + NOTICE_GAP) {
                x = clamp(orbRect.left + (orbRect.width - width) / 2, VIEWPORT_GAP, viewportWidth - VIEWPORT_GAP - width);
                y = orbRect.bottom + NOTICE_GAP;
                side = 'below';
            } else if (roomAbove >= height + NOTICE_GAP) {
                x = clamp(orbRect.left + (orbRect.width - width) / 2, VIEWPORT_GAP, viewportWidth - VIEWPORT_GAP - width);
                y = orbRect.top - NOTICE_GAP - height;
                side = 'above';
            }
        }
    }

    x = clamp(x, VIEWPORT_GAP, viewportWidth - VIEWPORT_GAP - width);
    y = clamp(y, VIEWPORT_GAP, viewportHeight - VIEWPORT_GAP - height);
    notice.style.setProperty('left', `${Math.round(x)}px`, 'important');
    notice.style.setProperty('right', 'auto', 'important');
    notice.style.setProperty('top', `${Math.round(y)}px`, 'important');
    notice.style.setProperty('bottom', 'auto', 'important');
    notice.style.setProperty('transform', 'none', 'important');
    notice.dataset.wbNoticeOrbSide = side;
}

function settleRoot(root) {
    const viewedConversationId = activeViewedConversation(root);
    if (viewedConversationId) markConversationRead(viewedConversationId);

    root.querySelectorAll('.wb-social-notice').forEach(notice => {
        const main = notice.querySelector('[data-wb-action="social-open-notice"]');
        if (!(main instanceof HTMLElement)) { notice.remove(); return; }
        const noticeId = String(main.dataset.noticeId || '').trim();
        const page = String(main.dataset.page || '').trim();
        const conversationId = String(main.dataset.conversationId || '').trim();
        if (!isUnread(noticeId)) { notice.remove(); return; }
        if (page === 'messages' && conversationId && conversationId === viewedConversationId) {
            markConversationRead(conversationId);
            notice.remove();
            return;
        }
        placeDesktopNotice(notice, root);
        notice.dataset.wbNoticeReady = '1';
    });
}

function onDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const conversationButton = target.closest('[data-wb-action="social-select-conversation"][data-conversation-id]');
    if (conversationButton instanceof HTMLElement) {
        markConversationRead(conversationButton.dataset.conversationId || '');
        return;
    }
    const noticeAction = target.closest('[data-wb-action="social-open-notice"], [data-wb-action="social-dismiss-notice"]');
    if (!(noticeAction instanceof HTMLElement)) return;
    const notice = noticeAction.closest('.wb-social-notice');
    const main = notice?.querySelector?.('[data-wb-action="social-open-notice"]');
    if (noticeAction.dataset.noticeId) markNoticeRead(noticeAction.dataset.noticeId);
    const conversationId = String(main?.dataset?.conversationId || '').trim();
    if (String(main?.dataset?.page || '') === 'messages' && conversationId) markConversationRead(conversationId);
}

function start() {
    installStyle();
    document.addEventListener('click', onDocumentClick, true);
    const attach = root => {
        let queued = false;
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; settleRoot(root); });
        };
        settleRoot(root);
        const observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        globalThis.addEventListener('resize', schedule);
        document.addEventListener('pointerup', schedule, true);
        window.addEventListener('pagehide', () => {
            observer.disconnect();
            document.removeEventListener('click', onDocumentClick, true);
            document.removeEventListener('pointerup', schedule, true);
            globalThis.removeEventListener('resize', schedule);
        }, { once: true });
    };
    const root = document.getElementById('world-backstage-root');
    if (root) return attach(root);
    const waiter = new MutationObserver(() => {
        const nextRoot = document.getElementById('world-backstage-root');
        if (!nextRoot) return;
        waiter.disconnect();
        attach(nextRoot);
    });
    waiter.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
