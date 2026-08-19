const STYLE_ID = 'wb-social-responsive-adapter-v1';
const ENTER_SINGLE_WIDTH = 560;
const ENTER_SPLIT_WIDTH = 680;

let threadOpen = false;
let scheduled = false;
const observedLayouts = new WeakSet();

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* 通讯布局按自己的可用空间决定，不再把“手机=某个固定像素”写死。 */
#world-backstage-root .wb-content-column.is-social-column {
    min-height: 0 !important;
    height: 100% !important;
    grid-template-rows: auto minmax(0, 1fr) auto !important;
}

#world-backstage-root .wb-social-shell.is-page-messages,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-page-body,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout {
    min-height: 0 !important;
    height: 100% !important;
}

#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout.wb-social-adaptive-list,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout.wb-social-adaptive-thread,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout.wb-social-adaptive-empty {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 0 !important;
}

#world-backstage-root .wb-social-layout.wb-social-adaptive-list > .wb-social-sidebar {
    display: grid !important;
    width: 100% !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-list > .wb-social-thread {
    display: none !important;
}

#world-backstage-root .wb-social-layout.wb-social-adaptive-thread > .wb-social-sidebar {
    display: none !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-thread > .wb-social-thread {
    display: flex !important;
    width: 100% !important;
}

#world-backstage-root .wb-social-layout.wb-social-adaptive-empty > .wb-social-sidebar {
    display: none !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-empty > .wb-social-thread {
    display: grid !important;
    width: 100% !important;
    min-height: 0 !important;
    place-items: center;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-empty .wb-social-empty-thread.is-first-use {
    width: min(100%, 440px) !important;
    max-width: 100% !important;
    margin: auto !important;
}

#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout.wb-social-adaptive-split {
    grid-template-columns: clamp(210px, 30%, 286px) minmax(0, 1fr) !important;
    gap: 0 !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-split > .wb-social-sidebar {
    display: grid !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-split > .wb-social-thread {
    display: flex !important;
}

#world-backstage-root .wb-social-layout:not(.wb-social-adaptive-thread) .wb-adaptive-social-back {
    display: none !important;
}
#world-backstage-root .wb-social-layout.wb-social-adaptive-thread .wb-adaptive-social-back {
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    min-width: 38px;
    min-height: 38px;
    padding: 0 8px;
    border: 0;
    border-radius: 12px;
    background: color-mix(in srgb, var(--wb-accent-soft) 66%, var(--wb-panel));
    color: var(--wb-accent);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
}

#world-backstage-root .wb-social-layout.wb-social-adaptive-list > .wb-social-sidebar,
#world-backstage-root .wb-social-layout.wb-social-adaptive-thread > .wb-social-thread,
#world-backstage-root .wb-social-layout.wb-social-adaptive-split > .wb-social-sidebar,
#world-backstage-root .wb-social-layout.wb-social-adaptive-split > .wb-social-thread {
    min-height: 0 !important;
    height: 100% !important;
}
`;
    document.head.appendChild(style);
}

function conversationCount(layout) {
    return layout.querySelectorAll('.wb-social-conversations > button[data-wb-action="social-select-conversation"]').length;
}

function ensureBackButton(layout) {
    const header = layout.querySelector('.wb-social-thread > header');
    if (!(header instanceof HTMLElement) || header.querySelector('.wb-adaptive-social-back')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-adaptive-social-back';
    button.dataset.wbAdaptiveSocialBack = 'true';
    button.setAttribute('aria-label', '返回会话列表');
    button.title = '返回消息列表';
    button.textContent = '‹';
    header.prepend(button);
}

function widthMode(layout) {
    const width = Math.max(0, layout.getBoundingClientRect().width || layout.clientWidth || 0);
    const previous = layout.dataset.wbAdaptiveMode || '';
    if (previous === 'single') return width >= ENTER_SPLIT_WIDTH ? 'split' : 'single';
    if (previous === 'split') return width <= ENTER_SINGLE_WIDTH ? 'single' : 'split';
    return width < ((ENTER_SINGLE_WIDTH + ENTER_SPLIT_WIDTH) / 2) ? 'single' : 'split';
}

function applyLayout(layout) {
    if (!(layout instanceof HTMLElement)) return;
    layout.classList.remove(
        'wb-social-adaptive-list',
        'wb-social-adaptive-thread',
        'wb-social-adaptive-empty',
        'wb-social-adaptive-split',
    );

    const hasConversation = conversationCount(layout) > 0;
    const hasFirstUse = Boolean(layout.querySelector('.wb-social-empty-thread.is-first-use'));

    if (!hasConversation && hasFirstUse) {
        layout.dataset.wbAdaptiveMode = 'single';
        layout.classList.add('wb-social-adaptive-empty');
        return;
    }

    const mode = widthMode(layout);
    layout.dataset.wbAdaptiveMode = mode;
    if (mode === 'split') {
        layout.classList.add('wb-social-adaptive-split');
        return;
    }

    if (threadOpen && hasConversation) {
        layout.classList.add('wb-social-adaptive-thread');
        ensureBackButton(layout);
    } else {
        layout.classList.add('wb-social-adaptive-list');
    }
}

function observeLayout(layout, resizeObserver) {
    if (!(layout instanceof HTMLElement) || observedLayouts.has(layout)) return;
    observedLayouts.add(layout);
    resizeObserver?.observe?.(layout);
}

function applyAll() {
    scheduled = false;
    const root = document.getElementById('world-backstage-root');
    if (!root) return;
    for (const layout of root.querySelectorAll('.wb-social-layout')) applyLayout(layout);
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyAll);
}

function onClickCapture(event) {
    const back = event.target?.closest?.('[data-wb-adaptive-social-back="true"]');
    if (back) {
        event.preventDefault();
        event.stopPropagation();
        threadOpen = false;
        scheduleApply();
        return;
    }

    const actionNode = event.target?.closest?.('[data-wb-action]');
    const action = String(actionNode?.dataset?.wbAction || '');
    if (action === 'social-select-conversation' || action === 'social-open-person' || action === 'open-terminal-person') {
        threadOpen = true;
        scheduleApply();
        return;
    }
    if (action === 'social-open-notice' && actionNode?.dataset?.page === 'messages' && actionNode?.dataset?.conversationId) {
        threadOpen = true;
        scheduleApply();
        return;
    }
    if (action === 'social-set-page' && actionNode?.dataset?.page === 'messages') {
        threadOpen = false;
        scheduleApply();
    }
}

function install() {
    installStyle();
    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(scheduleApply)
        : null;

    const watchLayouts = () => {
        const root = document.getElementById('world-backstage-root');
        if (!root) return;
        for (const layout of root.querySelectorAll('.wb-social-layout')) observeLayout(layout, resizeObserver);
    };

    document.addEventListener('click', onClickCapture, true);
    const mutationObserver = new MutationObserver(() => {
        watchLayouts();
        scheduleApply();
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleApply, { passive: true });

    watchLayouts();
    scheduleApply();
    window.addEventListener('pagehide', () => {
        mutationObserver.disconnect();
        resizeObserver?.disconnect?.();
        document.removeEventListener('click', onClickCapture, true);
        window.removeEventListener('resize', scheduleApply);
    }, { once: true });
}

install();
