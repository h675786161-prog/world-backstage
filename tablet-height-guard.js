const STYLE_ID = 'wb-tablet-height-guard-v3';

function installTabletHeightGuard() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Tablet height guard v3. This module is loaded strictly after the base tablet
   adapter so these viewport rules win deterministically instead of racing it. */
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

/* Desktop settings are vertically centered with a transform. Tablet positions
   the panel from the top edge, so carrying that transform over sends it offscreen. */
#world-backstage-root.wb-tablet-mode .wb-settings-layer > .wb-settings-popover {
    transform: none !important;
}
`;
    document.head.appendChild(style);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installTabletHeightGuard, { once: true });
} else {
    installTabletHeightGuard();
}
