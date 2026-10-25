const STYLE_ID = 'wb-tablet-clock-polish-v1';

const CSS = `
/* Keep the tablet header clock compact without crushing its label into vertical text. */
#world-backstage-root.wb-tablet-mode .wb-header-center {
    min-width: 78px !important;
}

#world-backstage-root.wb-tablet-mode .wb-world-calendar {
    min-width: 76px !important;
    max-width: 96px !important;
}

#world-backstage-root.wb-tablet-mode .wb-world-calendar .wb-calendar-page {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 7px !important;
    width: auto !important;
    min-width: 76px !important;
    height: 44px !important;
    padding: 0 9px !important;
    overflow: hidden !important;
}

#world-backstage-root.wb-tablet-mode .wb-world-calendar .wb-calendar-page > small,
#world-backstage-root.wb-tablet-mode .wb-world-calendar .wb-calendar-page > strong {
    display: block !important;
    margin: 0 !important;
    writing-mode: horizontal-tb !important;
    text-orientation: mixed !important;
    white-space: nowrap !important;
    word-break: keep-all !important;
}

#world-backstage-root.wb-tablet-mode .wb-world-calendar .wb-calendar-page > small {
    font-size: 9px !important;
    line-height: 1 !important;
    letter-spacing: 0.04em !important;
}

#world-backstage-root.wb-tablet-mode .wb-world-calendar .wb-calendar-page > strong {
    font-size: 18px !important;
    line-height: 1 !important;
}

#world-backstage-root.wb-tablet-short .wb-header-center {
    min-width: 72px !important;
}

#world-backstage-root.wb-tablet-short .wb-world-calendar {
    min-width: 70px !important;
    max-width: 86px !important;
}

#world-backstage-root.wb-tablet-short .wb-world-calendar .wb-calendar-page {
    min-width: 70px !important;
    height: 38px !important;
    gap: 6px !important;
    padding: 0 8px !important;
}

#world-backstage-root.wb-tablet-short .wb-world-calendar .wb-calendar-page > small {
    font-size: 8px !important;
}

#world-backstage-root.wb-tablet-short .wb-world-calendar .wb-calendar-page > strong {
    font-size: 16px !important;
}
`;

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installStyle, { once: true });
} else {
    installStyle();
}
