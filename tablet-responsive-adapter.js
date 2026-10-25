const STYLE_ID = 'wb-tablet-responsive-adapter-v1';
const TABLET_CLASS = 'wb-tablet-mode';
const PORTRAIT_CLASS = 'wb-tablet-portrait';
const LANDSCAPE_CLASS = 'wb-tablet-landscape';
const SHORT_CLASS = 'wb-tablet-short';

let scheduled = false;

function viewportSize() {
    const vv = window.visualViewport;
    return {
        width: Math.max(0, Math.round(vv?.width || window.innerWidth || 0)),
        height: Math.max(0, Math.round(vv?.height || window.innerHeight || 0)),
    };
}

function isTouchLike() {
    return (navigator.maxTouchPoints || 0) > 0 || window.matchMedia?.('(pointer: coarse)')?.matches === true;
}

function classifyRoot(root) {
    if (!(root instanceof HTMLElement)) return;

    const { width, height } = viewportSize();
    const minSide = Math.min(width, height);
    const mediumViewport = width >= 681 && width <= 1100 && height >= 521;
    const largeTouchTablet = width > 1100 && width <= 1366 && height >= 600 && minSide >= 600 && isTouchLike();
    const tablet = mediumViewport || largeTouchTablet;

    root.classList.toggle(TABLET_CLASS, tablet);
    root.classList.toggle(PORTRAIT_CLASS, tablet && height >= width);
    root.classList.toggle(LANDSCAPE_CLASS, tablet && width > height);
    root.classList.toggle(SHORT_CLASS, tablet && width > height && height < 700);

    if (tablet) {
        root.dataset.wbResponsiveMode = 'tablet';
    } else if (root.dataset.wbResponsiveMode === 'tablet') {
        delete root.dataset.wbResponsiveMode;
    }
}

function apply() {
    scheduled = false;
    classifyRoot(document.getElementById('world-backstage-root'));
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
}

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Dedicated tablet / medium-viewport layer. Phones keep the <=680px layout;
   desktop stays untouched unless it is a large touch tablet. */
#world-backstage-root.${TABLET_CLASS} .wb-panel-scrim {
    padding:
        max(10px, env(safe-area-inset-top, 0px))
        max(10px, env(safe-area-inset-right, 0px))
        max(10px, env(safe-area-inset-bottom, 0px))
        max(10px, env(safe-area-inset-left, 0px)) !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-window {
    width: 100% !important;
    max-width: 1180px !important;
    height: 100% !important;
    min-height: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-window-header {
    height: 72px !important;
    grid-template-columns: minmax(148px, 1fr) auto auto !important;
    gap: 10px !important;
    padding: 0 14px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-window-body {
    height: calc(100% - 72px) !important;
    grid-template-columns: 88px minmax(0, 1fr) !important;
    min-height: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-brand {
    gap: 8px !important;
    min-width: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-brand p,
#world-backstage-root.${TABLET_CLASS} .wb-brand-line > i,
#world-backstage-root.${TABLET_CLASS} .wb-header-center .wb-live-status {
    display: none !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-brand h1 {
    overflow: hidden;
    font-size: 17px !important;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#world-backstage-root.${TABLET_CLASS} .wb-brand-mark {
    width: 31px !important;
    height: 31px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-calendar-copy {
    display: none !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-calendar-page {
    width: 42px !important;
    height: 48px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-header-actions {
    gap: 5px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-round-action,
#world-backstage-root.${TABLET_CLASS} .wb-drawer-close {
    min-width: 42px !important;
    min-height: 42px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-nav {
    min-height: 0 !important;
    gap: 4px !important;
    padding: 10px 6px 8px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
    scrollbar-width: none;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-nav::-webkit-scrollbar {
    display: none;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-nav > button:not(.wb-side-sync) {
    min-height: 46px !important;
    gap: 5px !important;
    padding: 6px 5px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-nav strong {
    font-size: 10.5px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-nav small {
    display: none !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-side-sync {
    min-height: 42px !important;
    padding: 7px 5px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-content-column {
    min-width: 0 !important;
    min-height: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-view-header {
    min-width: 0 !important;
    gap: 10px !important;
    padding-right: 14px !important;
    padding-left: 14px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-view-header > div,
#world-backstage-root.${TABLET_CLASS} .wb-view-header-tools {
    min-width: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-view-header-tools {
    gap: 6px !important;
    flex-wrap: wrap;
    justify-content: flex-end;
}

#world-backstage-root.${TABLET_CLASS} .wb-view-content {
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 14px 16px 18px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-window-footer {
    gap: 8px !important;
    padding-right: 12px !important;
    padding-left: 14px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-overview-grid,
#world-backstage-root.${TABLET_CLASS} .wb-people-grid,
#world-backstage-root.${TABLET_CLASS} .wb-memory-grid,
#world-backstage-root.${TABLET_CLASS} .wb-summary-grid {
    min-width: 0 !important;
}

#world-backstage-root.${PORTRAIT_CLASS} .wb-overview-grid {
    grid-template-columns: 1fr !important;
}

#world-backstage-root.${PORTRAIT_CLASS} .wb-people-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
}

#world-backstage-root.${LANDSCAPE_CLASS} .wb-people-grid {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)) !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-settings-layer {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-settings-layer > .wb-settings-popover {
    top: 68px !important;
    right: 12px !important;
    bottom: auto !important;
    left: auto !important;
    width: min(680px, calc(100% - 24px)) !important;
    max-width: calc(100% - 24px) !important;
    max-height: calc(100% - 80px) !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
}

#world-backstage-root.${TABLET_CLASS} .wb-settings-tabs {
    display: grid !important;
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 6px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-settings-tabs > button {
    min-width: 0 !important;
    min-height: 40px !important;
    padding: 7px 6px !important;
    white-space: normal !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-settings-section-body,
#world-backstage-root.${TABLET_CLASS} .wb-module-settings-body {
    min-width: 0 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-setting-block,
#world-backstage-root.${TABLET_CLASS} .wb-settings-flat-section,
#world-backstage-root.${TABLET_CLASS} .wb-settings-subgroup-body,
#world-backstage-root.${TABLET_CLASS} .wb-api-form,
#world-backstage-root.${TABLET_CLASS} .wb-connection-card {
    min-width: 0 !important;
    max-width: 100% !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-setting-block input,
#world-backstage-root.${TABLET_CLASS} .wb-setting-block select,
#world-backstage-root.${TABLET_CLASS} .wb-setting-block textarea,
#world-backstage-root.${TABLET_CLASS} .wb-api-form input,
#world-backstage-root.${TABLET_CLASS} .wb-api-form select,
#world-backstage-root.${TABLET_CLASS} .wb-api-form textarea {
    min-width: 0 !important;
    max-width: 100% !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-drawer-scrim {
    padding:
        max(12px, env(safe-area-inset-top, 0px))
        max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px))
        max(12px, env(safe-area-inset-left, 0px)) !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-event-form,
#world-backstage-root.${TABLET_CLASS} .wb-person-drawer,
#world-backstage-root.${TABLET_CLASS} .wb-person-editor {
    width: min(720px, calc(100dvw - 40px)) !important;
    max-width: calc(100dvw - 40px) !important;
    max-height: calc(100dvh - 32px) !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
}

#world-backstage-root.${TABLET_CLASS} .wb-memory-tools {
    grid-template-columns: minmax(0, 1fr) auto !important;
    grid-template-areas:
        "filters filters"
        "relation count"
        "search search" !important;
    gap: 10px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-memory-filters {
    width: 100% !important;
    flex-wrap: wrap !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-memory-filters button {
    flex: 1 1 auto !important;
    min-height: 38px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-generation-module-row {
    grid-template-columns: minmax(0, 1fr) minmax(110px, .7fr) !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-generation-module-copy {
    grid-column: 1 / -1 !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-social-page-tabs {
    overflow-x: auto !important;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
}

#world-backstage-root.${TABLET_CLASS} .wb-social-page-tabs::-webkit-scrollbar {
    display: none;
}

#world-backstage-root.${TABLET_CLASS} .wb-social-page-tabs > button {
    flex: 0 0 auto;
    min-height: 42px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-social-compose textarea {
    min-height: 58px !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-toast,
#world-backstage-root.${TABLET_CLASS} .wb-social-notice {
    max-width: min(520px, calc(100dvw - 32px)) !important;
}

#world-backstage-root.${TABLET_CLASS} .wb-window button,
#world-backstage-root.${TABLET_CLASS} .wb-window select,
#world-backstage-root.${TABLET_CLASS} .wb-window input:not([type="checkbox"]):not([type="radio"]) {
    touch-action: manipulation;
}

/* Narrow portrait tablets need a little more content width than the old 82px sidebar left them. */
#world-backstage-root.${PORTRAIT_CLASS} .wb-window-body {
    grid-template-columns: 78px minmax(0, 1fr) !important;
}

#world-backstage-root.${PORTRAIT_CLASS} .wb-side-nav {
    padding-right: 5px !important;
    padding-left: 5px !important;
}

#world-backstage-root.${PORTRAIT_CLASS} .wb-window-footer > div > span:nth-of-type(n + 2),
#world-backstage-root.${PORTRAIT_CLASS} .wb-window-footer > div > i {
    display: none !important;
}

/* Short landscape tablets are where desktop-height assumptions hurt most. */
#world-backstage-root.${SHORT_CLASS} .wb-window-header {
    height: 62px !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-window-body {
    height: calc(100% - 62px) !important;
    grid-template-columns: 82px minmax(0, 1fr) !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-side-nav {
    gap: 2px !important;
    padding-top: 6px !important;
    padding-bottom: 6px !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-side-nav > button:not(.wb-side-sync) {
    min-height: 40px !important;
    padding-top: 4px !important;
    padding-bottom: 4px !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-side-sync {
    min-height: 38px !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-view-content {
    padding-top: 10px !important;
    padding-bottom: 12px !important;
}

#world-backstage-root.${SHORT_CLASS} .wb-settings-layer > .wb-settings-popover {
    top: 58px !important;
    max-height: calc(100% - 66px) !important;
}
`;
    document.head.appendChild(style);
}

function install() {
    installStyle();
    scheduleApply();

    const mutationObserver = new MutationObserver(scheduleApply);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('resize', scheduleApply, { passive: true });
    window.addEventListener('orientationchange', scheduleApply, { passive: true });
    window.visualViewport?.addEventListener?.('resize', scheduleApply, { passive: true });

    window.addEventListener('pagehide', () => {
        mutationObserver.disconnect();
        window.removeEventListener('resize', scheduleApply);
        window.removeEventListener('orientationchange', scheduleApply);
        window.visualViewport?.removeEventListener?.('resize', scheduleApply);
    }, { once: true });
}

install();
