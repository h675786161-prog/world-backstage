const STYLE_ID = 'world-backstage-mobile-ui-polish';

function installMobilePolishStylesheet() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) return;

    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./mobile-ui-polish.css', import.meta.url).href;
    document.head.appendChild(link);
}

installMobilePolishStylesheet();
