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

test('memory progress reports unindexed assistant responses', () => {
    assert.match(indexSource, /pendingAssistantResponses: unindexedAssistantCount\(\)/);
    assert.match(uiSource, /pendingAssistantResponses/);
});
