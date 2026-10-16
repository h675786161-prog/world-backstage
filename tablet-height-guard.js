const STYLE_ID = 'wb-tablet-height-guard-v2';

function installTabletHeightGuard() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Tablet height guard v2: percentage/auto height can collapse inside the centered
   grid at 768/820px portrait widths. Use the visual viewport explicitly instead. */
#world-backstage-root.wb-tablet-mode .wb-window {
    height: calc(100vh - 20px) !important;
    height: calc(100dvh - 20px) !important;
    max-height: calc(100dvh - 20px) !important;
    min-height: 0 !important;
}

#world-backstage-root.wb-tablet-mode .wb-settings-layer {
    height: calc(100vh - 20px) !important;
    height: calc(100dvh - 20px) !important;
    max-height: calc(100dvh - 20px) !important;
    min-height: 0 !important;
}
`;
    document.head.appendChild(style);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installTabletHeightGuard, { once: true });
} else {
    installTabletHeightGuard();
}
