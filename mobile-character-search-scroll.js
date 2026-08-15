const STYLE_ID = 'world-backstage-mobile-character-search-scroll';

function installCharacterSearchScrollStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@media (max-width: 680px), (max-height: 520px) and (pointer: coarse) {
    /*
     * Keep the search controls visible while long character result lists scroll
     * independently. This avoids the phone keyboard / narrow viewport hiding
     * candidate names below the search field.
     */
    #world-backstage-root .wb-social-add-friend .wb-social-search-results {
        min-height: 0;
        max-height: clamp(180px, 38dvh, 420px);
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--wb-accent) 62%, transparent) transparent;
        padding-right: 4px;
        padding-bottom: 10px;
    }

    #world-backstage-root .wb-social-add-friend .wb-social-search-results::-webkit-scrollbar {
        width: 6px;
    }

    #world-backstage-root .wb-social-add-friend .wb-social-search-results::-webkit-scrollbar-track {
        background: transparent;
    }

    #world-backstage-root .wb-social-add-friend .wb-social-search-results::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: color-mix(in srgb, var(--wb-accent) 58%, transparent);
    }

    #world-backstage-root .wb-social-add-friend .wb-social-search-results::-webkit-scrollbar-thumb:active {
        background: color-mix(in srgb, var(--wb-accent) 78%, transparent);
    }
}
`;
    document.head.appendChild(style);
}

installCharacterSearchScrollStyle();
