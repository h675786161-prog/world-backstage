const STYLE_ID = 'wb-settings-responsive-adapter';

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#world-backstage-root .wb-settings-popover {
    container-type: inline-size;
    container-name: wb-settings-panel;
}

#world-backstage-root .wb-settings-popover .wb-settings-flat-section,
#world-backstage-root .wb-settings-popover .wb-settings-subgroup-body,
#world-backstage-root .wb-settings-popover .wb-setting-block,
#world-backstage-root .wb-settings-popover .wb-api-form,
#world-backstage-root .wb-settings-popover .wb-connection-card,
#world-backstage-root .wb-settings-popover .wb-history-settings {
    min-width: 0 !important;
    max-width: 100% !important;
}

#world-backstage-root .wb-settings-popover .wb-api-form input,
#world-backstage-root .wb-settings-popover .wb-api-form select,
#world-backstage-root .wb-settings-popover .wb-api-form textarea,
#world-backstage-root .wb-settings-popover .wb-setting-block input,
#world-backstage-root .wb-settings-popover .wb-setting-block select,
#world-backstage-root .wb-settings-popover .wb-setting-block textarea {
    min-width: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
}

#world-backstage-root .wb-settings-popover .wb-connection-card > div > strong,
#world-backstage-root .wb-settings-popover .wb-connection-card dd,
#world-backstage-root .wb-settings-popover .wb-connection-card > small,
#world-backstage-root .wb-settings-popover .wb-setting-block p,
#world-backstage-root .wb-settings-popover .wb-form-note {
    min-width: 0 !important;
    max-width: 100% !important;
    overflow-wrap: anywhere;
    word-break: break-word;
}

@container wb-settings-panel (max-width: 430px) {
    #world-backstage-root .wb-settings-popover .wb-connection-card > div {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        gap: 4px !important;
        align-items: start !important;
    }

    #world-backstage-root .wb-settings-popover .wb-connection-card > div > strong {
        white-space: normal !important;
        text-align: left !important;
    }

    #world-backstage-root .wb-settings-popover .wb-connection-card dl {
        grid-template-columns: minmax(72px, auto) minmax(0, 1fr) !important;
    }

    #world-backstage-root .wb-settings-popover .wb-connection-card dd {
        white-space: normal !important;
        text-align: left !important;
    }

    #world-backstage-root .wb-settings-popover .wb-setting-block > .wb-option-row,
    #world-backstage-root .wb-settings-popover .wb-settings-flat-section > .wb-option-row,
    #world-backstage-root .wb-settings-popover .wb-api-form > .wb-option-row {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    }

    #world-backstage-root .wb-settings-popover .wb-setting-block > .wb-option-row > :last-child:nth-child(odd),
    #world-backstage-root .wb-settings-popover .wb-settings-flat-section > .wb-option-row > :last-child:nth-child(odd),
    #world-backstage-root .wb-settings-popover .wb-api-form > .wb-option-row > :last-child:nth-child(odd) {
        grid-column: 1 / -1;
    }

    #world-backstage-root .wb-settings-popover .wb-option-row button {
        min-width: 0 !important;
        white-space: normal !important;
        line-height: 1.35 !important;
    }
}

@container wb-settings-panel (max-width: 300px) {
    #world-backstage-root .wb-settings-popover .wb-setting-block > .wb-option-row,
    #world-backstage-root .wb-settings-popover .wb-settings-flat-section > .wb-option-row,
    #world-backstage-root .wb-settings-popover .wb-api-form > .wb-option-row {
        grid-template-columns: minmax(0, 1fr) !important;
    }

    #world-backstage-root .wb-settings-popover .wb-setting-block > .wb-option-row > *,
    #world-backstage-root .wb-settings-popover .wb-settings-flat-section > .wb-option-row > *,
    #world-backstage-root .wb-settings-popover .wb-api-form > .wb-option-row > * {
        grid-column: auto !important;
    }
}
`;
    document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installStyle, { once: true });
else installStyle();
