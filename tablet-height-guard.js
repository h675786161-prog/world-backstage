const STYLE_ID = 'wb-tablet-height-guard-v1';

function installTabletHeightGuard() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* Tablet height guard: percentage height inside the centered grid can collapse
   on portrait medium viewports. Let the grid define the available block size
   and stretch the window into it instead. */
#world-backstage-root.wb-tablet-mode .wb-panel-scrim {
    align-items: stretch !important;
    justify-items: center !important;
}

#world-backstage-root.wb-tablet-mode .wb-window {
    align-self: stretch !important;
    height: auto !important;
    max-height: none !important;
    min-height: 0 !important;
}

#world-backstage-root.wb-tablet-mode .wb-settings-layer {
    height: 100% !important;
    max-height: 100% !important;
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
