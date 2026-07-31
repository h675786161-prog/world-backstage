import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [uiSource, styleSource, indexSource] = await Promise.all([
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
]);

test('long memory UI uses filtering, search and progressive loading', () => {
    assert.match(uiSource, /data-wb-memory-search/);
    assert.match(uiSource, /set-memory-filter/);
    assert.match(uiSource, /load-more-memory/);
    assert.match(uiSource, /memoryVisibleCount = 12/);
});

test('interaction polish includes grouped settings, outside close and undo', () => {
    assert.match(uiSource, /wb-settings-group/);
    assert.match(uiSource, /data-wb-action="close-panel"/);
    assert.match(uiSource, /data-wb-action="undo-manual"/);
    assert.match(indexSource, /function undoManualChange/);
    assert.match(styleSource, /wb-panel-in/);
});

test('module switches keep stable brightness and do not replay the panel entrance', () => {
    assert.match(uiSource, /panelEntrancePending = !isOpen/);
    assert.match(uiSource, /animatePanelEntrance \? 'is-opening' : ''/);
    assert.match(styleSource, /\.wb-panel-scrim\.is-opening/);
    assert.match(styleSource, /\.wb-panel-scrim\.is-opening \.wb-window/);
    assert.doesNotMatch(styleSource, /@keyframes wb-view-in\s*\{[^}]*opacity:/s);
});

test('mobile navigation exposes all six views without horizontal overflow', () => {
    assert.match(styleSource, /repeat\(6, minmax\(0, 1fr\)\)/);
    assert.match(styleSource, /\.wb-calendar-page \{/);
});

test('mobile shell adapts to dynamic viewports, safe areas and competing overlays', () => {
    assert.match(styleSource, /z-index:\s*2147483647\s*!important/);
    assert.match(styleSource, /width:\s*100dvw/);
    assert.match(styleSource, /height:\s*100dvh/);
    assert.match(styleSource, /env\(safe-area-inset-top/);
    assert.match(styleSource, /var\(--wb-visual-inset-top/);
    assert.match(styleSource, /var\(--wb-visual-height/);
    assert.match(styleSource, /clamp\(12px, 2dvh, 20px\)/);
    assert.match(styleSource, /\.wb-view-content::\-webkit-scrollbar-thumb/);
    assert.match(styleSource, /width:\s*clamp\(34px, 9vmin, 38px\)\s*!important/);
    assert.match(styleSource, /max-height:\s*520px\) and \(pointer:\s*coarse\)/);
    assert.match(uiSource, /window\.visualViewport\?\.addEventListener\('resize'/);
    assert.match(uiSource, /window\.visualViewport\?\.removeEventListener\('resize'/);
    assert.match(uiSource, /function responsiveOrbSize/);
    assert.match(uiSource, /function visualViewportBounds/);
    assert.match(uiSource, /class="wb-settings-layer"/);
    assert.match(uiSource, /<div class="wb-settings-popover" role="dialog"/);
    assert.doesNotMatch(uiSource, /<aside class="wb-settings-popover"/);
    assert.doesNotMatch(uiSource, /root\.appendChild\(settingsPanel\)/);
    assert.match(styleSource, /#world-backstage-root \.wb-settings-layer > \.wb-settings-popover/);
    assert.match(styleSource, /max-height:\s*none\s*!important/);
    assert.match(styleSource, /\.wb-world-orb:not\(\.is-open\)/);
    assert.match(styleSource, /\.wb-world-orb\.is-open/);
    assert.match(styleSource, /z-index:\s*2147483647\s*!important/);
    assert.match(styleSource, /opacity:\s*0\.94\s*!important/);
    assert.doesNotMatch(styleSource, /\.has-settings-open \.wb-world-orb/);
    assert.match(uiSource, /if \(!orb \|\| event\.button !== 0\) return/);
    assert.match(uiSource, /settings\.orbPosition \? 'has-custom-position'/);
    assert.match(styleSource, /top:\s*clamp\(180px, 52dvh, calc\(100dvh - 180px\)\)\s*!important/);
    assert.match(styleSource, /\.wb-world-orb\.has-custom-position/);
    assert.match(indexSource, /if \(previousSettingsVersion < 8\) settings\.orbPosition = null/);
});

test('memory progress reports unindexed assistant responses', () => {
    assert.match(indexSource, /pendingAssistantResponses: unindexedAssistantCount\(\)/);
    assert.match(uiSource, /pendingAssistantResponses/);
});
