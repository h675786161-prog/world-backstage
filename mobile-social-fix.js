const STYLE_ID = 'world-backstage-mobile-social-single-pane';
const MOBILE_QUERY = '(max-width: 680px), (max-height: 520px) and (pointer: coarse)';

let mobileThreadOpen = false;
let scheduled = false;

function isMobileSocial() {
    return globalThis.matchMedia?.(MOBILE_QUERY)?.matches === true;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@media (max-width: 680px), (max-height: 520px) and (pointer: coarse) {
    #world-backstage-root .wb-social-page-body {
        min-width: 0;
        overflow: hidden;
    }

    #world-backstage-root .wb-social-layout {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        gap: 0 !important;
        min-width: 0;
        width: 100%;
        height: 100%;
    }

    #world-backstage-root .wb-social-layout > .wb-social-sidebar,
    #world-backstage-root .wb-social-layout > .wb-social-thread {
        min-width: 0;
        width: 100%;
        height: 100%;
    }

    /* 手机不是缩小版桌面：会话列表与聊天页一次只显示一个。 */
    #world-backstage-root .wb-social-layout.wb-mobile-social-list > .wb-social-sidebar {
        display: grid !important;
    }
    #world-backstage-root .wb-social-layout.wb-mobile-social-list > .wb-social-thread {
        display: none !important;
    }

    #world-backstage-root .wb-social-layout.wb-mobile-social-thread > .wb-social-sidebar {
        display: none !important;
    }
    #world-backstage-root .wb-social-layout.wb-mobile-social-thread > .wb-social-thread {
        display: grid !important;
    }

    /* 第一次使用时，别留一块空白“最近聊过”占半屏。 */
    #world-backstage-root .wb-social-layout.wb-mobile-social-empty > .wb-social-sidebar {
        display: none !important;
    }
    #world-backstage-root .wb-social-layout.wb-mobile-social-empty > .wb-social-thread {
        display: grid !important;
    }

    #world-backstage-root .wb-social-layout.wb-mobile-social-empty .wb-social-empty-thread.is-first-use {
        width: min(100%, 420px);
        max-width: 100%;
        margin: auto;
        padding: clamp(22px, 7vw, 36px) 18px;
    }

    #world-backstage-root .wb-social-layout.wb-mobile-social-empty .wb-social-empty-actions {
        width: min(100%, 320px);
    }

    #world-backstage-root .wb-social-sidebar-head {
        min-height: 54px;
        padding: 10px 12px 7px;
    }

    #world-backstage-root .wb-social-sidebar-scroll {
        min-width: 0;
        padding: 6px 7px;
    }

    #world-backstage-root .wb-social-conversations > button,
    #world-backstage-root .wb-social-contacts > button {
        grid-template-columns: 42px minmax(0, 1fr) !important;
        min-height: 62px !important;
        padding: 8px 9px !important;
    }

    #world-backstage-root .wb-social-conversations .wb-person-avatar.is-social,
    #world-backstage-root .wb-social-contacts .wb-person-avatar.is-social,
    #world-backstage-root .wb-social-conversations .wb-social-group-avatar {
        width: 42px !important;
        height: 42px !important;
    }

    #world-backstage-root .wb-social-thread > header {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 8px;
        min-height: 56px;
        padding: 7px 10px;
    }

    #world-backstage-root .wb-mobile-social-back {
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

    #world-backstage-root .wb-social-thread-contact {
        min-width: 0;
    }

    #world-backstage-root .wb-social-thread-contact > div {
        min-width: 0;
    }

    #world-backstage-root .wb-social-thread-contact h3,
    #world-backstage-root .wb-social-thread-contact span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    #world-backstage-root .wb-social-log {
        min-width: 0;
        padding: 16px 10px 22px !important;
    }

    #world-backstage-root .wb-social-message-main {
        max-width: 82% !important;
    }

    #world-backstage-root .wb-social-compose {
        margin: 0 6px 6px !important;
    }
}

@media (min-width: 681px) and (min-height: 521px) {
    #world-backstage-root .wb-mobile-social-back {
        display: none !important;
    }
}
`;
    document.head.appendChild(style);
}

function conversationCount(layout) {
    return layout.querySelectorAll('.wb-social-conversations > button[data-wb-action="social-select-conversation"]').length;
}

function ensureBackButton(layout) {
    const header = layout.querySelector('.wb-social-thread > header');
    if (!header || header.querySelector('.wb-mobile-social-back')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-mobile-social-back';
    button.dataset.wbMobileSocialBack = 'true';
    button.setAttribute('aria-label', '返回会话列表');
    button.title = '返回消息列表';
    button.textContent = '‹';
    header.prepend(button);
}

function applyMobileSocialLayout() {
    scheduled = false;
    const root = document.getElementById('world-backstage-root');
    if (!root) return;

    for (const layout of root.querySelectorAll('.wb-social-layout')) {
        layout.classList.remove('wb-mobile-social-list', 'wb-mobile-social-thread', 'wb-mobile-social-empty');
        if (!isMobileSocial()) continue;

        const hasConversation = conversationCount(layout) > 0;
        const hasFirstUse = Boolean(layout.querySelector('.wb-social-empty-thread.is-first-use'));

        if (!hasConversation && hasFirstUse) {
            layout.classList.add('wb-mobile-social-empty');
            continue;
        }

        if (mobileThreadOpen && hasConversation) {
            layout.classList.add('wb-mobile-social-thread');
            ensureBackButton(layout);
        } else {
            layout.classList.add('wb-mobile-social-list');
        }
    }
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyMobileSocialLayout);
}

function actionFromTarget(target) {
    return target?.closest?.('[data-wb-action]') || null;
}

function onClickCapture(event) {
    const back = event.target?.closest?.('[data-wb-mobile-social-back="true"]');
    if (back) {
        event.preventDefault();
        event.stopPropagation();
        mobileThreadOpen = false;
        scheduleApply();
        return;
    }

    const actionNode = actionFromTarget(event.target);
    const action = actionNode?.dataset?.wbAction || '';
    if (action === 'social-select-conversation' || action === 'social-open-person' || action === 'open-terminal-person') {
        mobileThreadOpen = true;
        scheduleApply();
        return;
    }

    if (action === 'social-open-notice' && actionNode.dataset.page === 'messages' && actionNode.dataset.conversationId) {
        mobileThreadOpen = true;
        scheduleApply();
        return;
    }

    if (action === 'social-set-page' && actionNode.dataset.page === 'messages') {
        mobileThreadOpen = false;
        scheduleApply();
    }
}

function install() {
    ensureStyle();
    document.addEventListener('click', onClickCapture, true);

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    globalThis.matchMedia?.(MOBILE_QUERY)?.addEventListener?.('change', scheduleApply);
    scheduleApply();
}

install();
