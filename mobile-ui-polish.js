const STYLE_ID = 'world-backstage-mobile-ui-polish';
const FOOTER_FIX_STYLE_ID = 'world-backstage-mobile-footer-fix';

function installStylesheet(id, relativeUrl) {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = new URL(relativeUrl, import.meta.url).href;
    document.head.appendChild(link);
}

function installMobilePolishStylesheet() {
    installStylesheet(STYLE_ID, './mobile-ui-polish.css');
    // Must be appended after mobile-ui-polish.css so the narrow-phone
    // one-column footer rule can never push the second task button into nav.
    installStylesheet(FOOTER_FIX_STYLE_ID, './mobile-footer-fix.css');
}

installMobilePolishStylesheet();
