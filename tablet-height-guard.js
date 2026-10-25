const STYLE_ID = 'wb-tablet-height-guard-v4';

function installTabletHeightGuard() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Tablet height/position guard v4. Loaded strictly after the responsive adapters.
   Tablet uses its own viewport box instead of inheriting the desktop centered stage. */
#world-backstage-root.wb-tablet-mode .wb-window {
    height: calc(100vh - 20px) !important;
    height: calc(100dvh - 20px) !important;
    max-height: calc(100dvh - 20px) !important;
    min-height: 0 !important;
}

#world-backstage-root.wb-tablet-mode .wb-settings-layer {
    top: max(10px, env(safe-area-inset-top, 0px)) !important;
    right: auto !important;
    bottom: auto !important;
    left: max(10px, env(safe-area-inset-left, 0px)) !important;
    width: calc(100vw - 20px) !important;
    width: calc(100dvw - 20px) !important;
    height: calc(100vh - 20px) !important;
    height: calc(100dvh - 20px) !important;
    max-width: calc(100dvw - 20px) !important;
    max-height: calc(100dvh - 20px) !important;
    min-height: 0 !important;
    transform: none !important;
}

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
