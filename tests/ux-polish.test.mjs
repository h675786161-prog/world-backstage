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
    assert.match(uiSource, /save-memory-item/);
    assert.match(uiSource, /toggle-memory-flag/);
    assert.match(uiSource, /delete-memory-item/);
});

test('independent modules, cancellable simulation, NPC editor and observation cache are exposed', () => {
    assert.match(uiSource, /data-wb-setting="worldSimulationEnabled"/);
    assert.match(uiSource, /data-wb-setting="worldPromptInjection"/);
    assert.match(uiSource, /data-wb-setting="memorySystemEnabled"/);
    assert.match(uiSource, /data-wb-setting="memoryPromptInjection"/);
    assert.match(uiSource, /data-wb-action="\$\{canCancelSimulation \? 'cancel-simulation' : 'manual-sync'\}"/);
    assert.match(indexSource, /function cancelActiveSimulation/);
    assert.match(indexSource, /settings\.autoSimulationMode = 'manual'/);
    assert.doesNotMatch(uiSource, /data-wb-setting="simulationPaused"/);
    assert.match(uiSource, /添加后台 NPC/);
    assert.match(uiSource, /name="personalityAnchor"/);
    assert.match(uiSource, /name="speakingStyle"/);
    assert.match(uiSource, /name="behaviorBoundaries"/);
    assert.match(styleSource, /wb-character-anchor-fields/);
    assert.match(indexSource, /personObservations/);
    assert.match(indexSource, /personObservationCacheKey/);
    assert.match(indexSource, /回复为空或生成失败，已跳过推演与记忆写入/);
    assert.match(indexSource, /正文修改已保存，但不会自动重推/);
});

test('interaction polish includes grouped settings, outside close and undo', () => {
    assert.match(uiSource, /wb-settings-group/);
    assert.match(uiSource, /data-wb-action="close-panel"/);
    assert.match(uiSource, /data-wb-action="undo-manual"/);
    assert.match(indexSource, /function undoManualChange/);
    assert.match(styleSource, /wb-panel-in/);
    assert.match(uiSource, /<div class="wb-person-drawer" role="dialog"/);
    assert.doesNotMatch(uiSource, /<aside/);
    assert.match(styleSource, /#world-backstage-root \.wb-drawer-scrim > \.wb-person-drawer/);
    assert.match(styleSource, /#world-backstage-root \.wb-drawer-scrim > \.wb-event-form/);
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

test('transparent summary, model pull and observation delivery controls are exposed', () => {
    assert.match(uiSource, /本次变化与用量/);
    assert.match(uiSource, /data-wb-action="pull-api-models"/);
    assert.match(uiSource, /data-wb-setting="maxOutputTokens"/);
    assert.match(uiSource, /data-wb-action="queue-person-observation"/);
    assert.match(indexSource, /function simulationSummary/);
    assert.match(indexSource, /function queuePersonObservation/);
});

test('worldbook NPC bridge is explicit, selective and never scans on every turn', () => {
    assert.match(uiSource, /data-wb-action="scan-worldbook"/);
    assert.match(uiSource, /data-wb-form="worldbook"/);
    assert.match(uiSource, /name="entryIds"/);
    assert.match(uiSource, /导入勾选人物/);
    assert.match(indexSource, /getWorldInfoNames/);
    assert.match(indexSource, /loadWorldInfo/);
    assert.match(indexSource, /function importWorldbookPeople/);
    assert.match(styleSource, /wb-worldbook-entry-list/);
    assert.doesNotMatch(indexSource, /queueSimulation[\s\S]{0,400}scanWorldbook/);
});
