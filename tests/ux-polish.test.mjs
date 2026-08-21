import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [uiSource, styleSource, indexSource, bootstrapSource, hotfixSource, storageGuardSource, socialAdapterSource, presentationSource] = await Promise.all([
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../style.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.js', import.meta.url), 'utf8'),
    readFile(new URL('../bootstrap.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui-hotfix.js', import.meta.url), 'utf8'),
    readFile(new URL('../storage-guard.js', import.meta.url), 'utf8'),
    readFile(new URL('../social-responsive-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../presentation-polish.js', import.meta.url), 'utf8'),
]);

test('long memory UI uses filtering, search and progressive loading', () => {
    assert.match(uiSource, /data-wb-memory-search/);
    assert.match(uiSource, /set-memory-filter/);
    assert.match(uiSource, /load-more-memory/);
    assert.match(uiSource, /memoryVisibleCount = 12/);
    assert.match(uiSource, /save-memory-item/);
    assert.match(uiSource, /toggle-memory-flag/);
    assert.match(uiSource, /delete-memory-item/);
    assert.doesNotMatch(uiSource, /\$\{\(fact\.people \|\| \[\]\)\.map\(tag/);
    assert.doesNotMatch(uiSource, /\$\{\(clue\.people \|\| \[\]\)\.map\(tag/);
    assert.match(uiSource, /class="is-edit"/);
    assert.match(uiSource, /class="is-delete"/);
});

test('independent modules, cancellable simulation, NPC editor and observation cache are exposed', () => {
    assert.match(uiSource, /data-wb-setting="worldSimulationEnabled"/);
    assert.match(uiSource, /data-wb-setting="worldPromptInjection"/);
    assert.match(uiSource, /data-wb-setting="memorySystemEnabled"/);
    assert.match(uiSource, /data-wb-setting="injectionMemory"/);
    assert.match(uiSource, /data-wb-action="\$\{canCancelSimulation \? 'cancel-simulation' : 'manual-sync'\}"/);
    assert.match(indexSource, /function cancelActiveSimulation/);
    assert.match(indexSource, /runtime\.autoCatchUpSuppressedThroughMessageId = Math\.max/);
    assert.match(indexSource, /active\.controller\.abort\(\)/);
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
    assert.doesNotMatch(uiSource, /<aside class="wb-person-drawer"/);
    assert.match(styleSource, /#world-backstage-root \.wb-drawer-scrim > \.wb-person-drawer/);
    assert.match(styleSource, /#world-backstage-root \.wb-drawer-scrim > \.wb-event-form/);
});

test('module switches keep stable brightness and do not replay the panel entrance', () => {
    assert.match(uiSource, /panelEntrancePending = !isOpen/);
    assert.match(uiSource, /animatePanelEntrance \? 'is-opening' : ''/);
    assert.match(styleSource, /\.wb-panel-scrim\.is-opening/);
    assert.match(styleSource, /\.wb-panel-scrim\.is-opening \.wb-window/);
    assert.doesNotMatch(styleSource, /@keyframes wb-view-in\s*\{[^}]*opacity:/s);
    assert.match(uiSource, /currentContent\.scrollTop = viewChanged \? 0/);
});

test('offscreen observation only excludes explicitly present characters and keeps cached results', () => {
    assert.match(indexSource, /person\.presentInSceneMessageId/);
    assert.doesNotMatch(indexSource, /person\.name && text\.includes\(person\.name\)/);
    assert.match(indexSource, /if \(cached && !force\) return cached/);
    assert.match(uiSource, /get-person-observation/);
});

test('disabling memory prevents both in-flight simulation writes and archive batches', () => {
    assert.match(indexSource, /memoryEnabledAtCommit = getSettings\(\)\.memorySystemEnabled/);
    assert.match(indexSource, /runtime\.activeHistoryScan\?\.abort\(\)/);
    assert.match(indexSource, /记忆系统已关闭，本次整理已停止/);
});

test('echoes and memory cards use readable scalable typography and quiet actions', () => {
    assert.match(styleSource, /#world-backstage-root \.wb-echo-card h3/);
    assert.match(styleSource, /#world-backstage-root \.wb-echo-card p/);
    assert.match(styleSource, /\.wb-memory-card-actions \{[\s\S]*width: fit-content/);
    assert.match(styleSource, /Complete typography pass/);
    assert.match(styleSource, /\.wb-person-observation article p[\s\S]*font-size: clamp\(12px/);
    assert.match(styleSource, /\.wb-event-card p[\s\S]*font-size: clamp\(12px/);
    assert.match(uiSource, /界面字号/);
    assert.match(uiSource, /settingExplanation\('deliveryDensity', settings\.deliveryDensity\)/);
});

test('editing a committed latest reply asks before rerunning or keeping state', () => {
    assert.match(indexSource, /editDecision: null/);
    assert.match(indexSource, /async function resolveMessageEdit/);
    assert.match(indexSource, /trigger: 'edited-reply'/);
    assert.match(indexSource, /已保留编辑前的世界推演结果/);
    assert.match(uiSource, /检测到已推演正文被修改/);
    assert.match(uiSource, /按修改后正文重推/);
    assert.match(uiSource, /保留原推演/);
    assert.match(uiSource, /TOAST_FACES\.warning/);
    assert.match(styleSource, /\.wb-edit-choice/);
});

test('mobile navigation exposes all current views without horizontal overflow', () => {
    const viewCount = [...uiSource.matchAll(/\{ id: '[^']+', label: '[^']+', eyebrow: '[^']+' \}/g)].length;
    assert.equal(viewCount, 9);
    assert.match(styleSource, new RegExp(`repeat\\(${viewCount}, minmax\\(0, 1fr\\)\\)`));
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
    assert.match(uiSource, /<div class="[^"]*wb-settings-popover[^"]*" role="dialog"/);
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
    assert.match(uiSource, /<summary>本次变化<\/summary>/);
    assert.match(uiSource, /summary\.elapsedMinutes/);
    assert.match(uiSource, /data-wb-action="pull-api-models"/);
    assert.match(uiSource, /data-wb-setting="maxOutputTokens"/);
    assert.match(uiSource, /data-wb-action="queue-person-observation"/);
    assert.match(uiSource, /role="switch"/);
    assert.match(uiSource, /默认关闭：仅供幕后观看/);
    assert.match(uiSource, /不会强行插入，也不保证紧接下一轮出现/);
    assert.match(uiSource, /重新观测/);
    assert.doesNotMatch(uiSource, /安排到下一轮显露/);
    assert.match(indexSource, /function simulationSummary/);
    assert.match(indexSource, /function queuePersonObservation/);
    assert.match(indexSource, /revealEnabled/);
    assert.match(styleSource, /wb-observation-boundary/);
});

test('status toasts use restrained state-specific kaomoji', () => {
    assert.match(uiSource, /const TOAST_FACES/);
    assert.match(uiSource, /\(｡•̀ᴗ-\)✧/);
    assert.match(uiSource, /\(；′⌒`\)/);
    assert.match(styleSource, /data-toast-tone="success"/);
    assert.match(styleSource, /data-toast-tone="warning"/);
});

test('worldbook NPC bridge is explicit, selective and never scans on every turn', () => {
    assert.match(uiSource, /data-wb-action="scan-worldbook"/);
    assert.match(uiSource, /data-wb-form="worldbook"/);
    assert.match(uiSource, /name="entryIds"/);
    assert.match(uiSource, /wb-worldbook-import-button/);
    assert.match(uiSource, /worldbookSelectedCount \? `导入已选人物/);
    assert.match(indexSource, /getWorldInfoNames/);
    assert.match(indexSource, /loadWorldInfo/);
    assert.match(indexSource, /function importWorldbookPeople/);
    assert.match(styleSource, /wb-worldbook-entry-list/);
    assert.doesNotMatch(indexSource, /queueSimulation[\s\S]{0,400}scanWorldbook/);
});

test('custom API form preserves mobile edits across rerenders and avoids password autofill', () => {
    assert.match(uiSource, /let apiFormDraft = null/);
    assert.match(uiSource, /let skipApiDraftCapture = false/);
    assert.match(uiSource, /const previousApiForm = root\.querySelector/);
    assert.match(uiSource, /apiDraft\?\.customApiUrl \?\? settings\.customApiUrl/);
    assert.match(uiSource, /customApiCredential: apiDraft\?\.customApiCredential \?\? ''/);
    assert.match(uiSource, /name="customApiCredential" type="text"/);
    assert.doesNotMatch(uiSource, /value="\$\{escapeAttr\(settings\.customApiKey\)\}"/);
    assert.match(uiSource, /autocomplete="one-time-code"/);
    assert.match(uiSource, /replacementKey \|\| getSettings\(\)\.customApiKey/);
    assert.match(uiSource, /data-wb-action="reset-api-draft"/);
    assert.match(uiSource, /data-wb-action="toggle-api-key-visibility"/);
    assert.match(uiSource, /data-lpignore="true"/);
    assert.match(uiSource, /旧 Key 不会重新摆回输入框/);
    assert.match(styleSource, /-webkit-text-security: disc/);
});

test('bootstrap loads one social adapter and one community-note entry only', () => {
    assert.match(bootstrapSource, /social-responsive-adapter\.js/);
    assert.match(bootstrapSource, /community-note\.js/);
    assert.doesNotMatch(bootstrapSource, /mobile-social-fix\.js/);
    assert.doesNotMatch(bootstrapSource, /community-note-entry-fix\.js/);
});

test('responsive social thread keeps its vertical grid in single and split layouts', () => {
    assert.match(socialAdapterSource, /wb-social-adaptive-thread > \.wb-social-thread \{[\s\S]*?display: grid !important/);
    assert.match(socialAdapterSource, /wb-social-adaptive-split > \.wb-social-thread \{[\s\S]*?display: grid !important/);
    assert.doesNotMatch(socialAdapterSource, /wb-social-adaptive-(?:thread|split) > \.wb-social-thread \{[\s\S]*?display: flex !important/);
    assert.match(presentationSource, /\.wb-social-layout\.wb-social-adaptive-thread,[\s\S]*?grid-template-columns: minmax\(0,1fr\) !important/);
    assert.doesNotMatch(presentationSource, /wb-mobile-social-(?:list|thread|empty)/);
});

test('UI safeguards avoid whole-document mutation scans and periodic full serialization', () => {
    assert.doesNotMatch(hotfixSource, /MutationObserver/);
    assert.match(hotfixSource, /compositionstart/);
    assert.match(uiSource, /data-wb-action="setting-button" data-setting="injectionTimeMode"/);
    assert.match(storageGuardSource, /const GUARD_INTERVAL_MS = 60_000/);
    assert.match(storageGuardSource, /fingerprint === lastCheckedFingerprint/);
});

test('long history scans durably commit every completed batch before continuing', () => {
    assert.match(indexSource, /return Promise\.resolve\(context\.saveMetadata\(\)\)/);
    assert.match(indexSource, /await saveHistoryBootstrapCheckpoint\(\{/);
    assert.match(indexSource, /await saveStore\(store, \{ immediate: true \}\)/);
    assert.match(indexSource, /已安全保存～继续往后收拾/);
});

test('history batching starts wide, stays character-bounded and shrinks on malformed output', () => {
    assert.match(indexSource, /const HISTORY_BATCH_TARGET_ASSISTANT_TURNS = 10/);
    assert.match(indexSource, /maximumCharacters = 24000/);
    assert.match(indexSource, /assistantBatchLimit = Math\.max\(1, Math\.floor\(assistantTurns \/ 2\)\)/);
    assert.match(indexSource, /assistantBatchLimit \+ 1/);
});

test('player identity anchor supports non-binary presentation and nonhuman roles', () => {
    assert.match(indexSource, /playerIdentityAnchor: ''/);
    assert.match(indexSource, /function getPlayerIdentityAnchor/);
    assert.match(indexSource, /legacyPlayerIdentityAnchor/);
    assert.doesNotMatch(uiSource, /data-wb-setting="playerIdentityAnchor"/);
    assert.match(uiSource, /name="identityAnchor"/);
    assert.match(uiSource, /不限制为男女二选一/);
    assert.match(indexSource, /identityAnchor: String\(payload\.identityAnchor/);
});

test('recovery, safe diagnostics and visible kaomoji notices are exposed', () => {
    assert.match(uiSource, /data-wb-action="create-recovery-point"/);
    assert.match(uiSource, /data-wb-action="restore-latest-recovery"/);
    assert.match(uiSource, /data-wb-action="copy-diagnostics"/);
    assert.match(uiSource, /data-wb-action="preview-notice"/);
    assert.match(indexSource, /action === 'preview-notice'/);
    assert.match(indexSource, /reason: 'before-import'/);
    assert.match(indexSource, /before-schema-/);
    assert.match(indexSource, /API Key、接口地址、聊天正文、角色身份锚点或自定义提示词/);
    assert.match(indexSource, /function redactDiagnosticText/);
    assert.match(indexSource, /function classifyDiagnosticIssue/);
    assert.doesNotMatch(indexSource, /error:\s*redactDiagnosticText\(runtime\.syncStatus\.error\)/);
    assert.doesNotMatch(indexSource, /customApiKey:\s*settings\.customApiKey/);
    assert.match(uiSource, /const TOAST_FACES/);
    assert.match(uiSource, /const TOAST_LABELS/);
    assert.match(styleSource, /@keyframes wb-toast-in/);
});
