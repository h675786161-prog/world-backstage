const MODULE_ID = 'world_backstage';
const ROOT_SELECTOR = '#world-backstage-root';
const TAG_FIELD_SELECTOR = '[data-wb-tag-filter-field]';
const NARRATIVE_SETTING_KEYS = new Set([
    'narrativeIncludeTag',
    'narrativeRegexFilters',
]);

function getContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function getSettings() {
    const context = getContext();
    const settings = context?.extensionSettings?.[MODULE_ID];
    return settings && typeof settings === 'object' ? settings : null;
}

function saveSettings() {
    getContext()?.saveSettingsDebounced?.();
}

function sanitizeTagRule(value) {
    return String(value || '').trim().slice(0, 80);
}

function readVisibleTagRules(root) {
    if (!root) return null;
    const cards = [...root.querySelectorAll('.wb-tag-filter-rule')];
    if (!cards.length) return null;

    return cards
        .slice(0, 30)
        .map(card => ({
            open: sanitizeTagRule(card.querySelector('[data-wb-tag-filter-field="open"]')?.value),
            close: sanitizeTagRule(card.querySelector('[data-wb-tag-filter-field="close"]')?.value),
        }))
        .filter(rule => rule.open || rule.close);
}

function persistVisibleTagRules(root = document.querySelector(ROOT_SELECTOR)) {
    const rules = readVisibleTagRules(root);
    const settings = getSettings();
    if (!settings || rules === null) return false;
    settings.tagFilterRules = rules;
    saveSettings();
    return true;
}

function sanitizeNarrativeSetting(key, value) {
    if (key === 'narrativeIncludeTag') {
        return String(value || '').trim().replace(/[<>]/g, '').slice(0, 80);
    }
    if (key === 'narrativeRegexFilters') {
        return String(value || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 8)
            .join('\n')
            .slice(0, 2200);
    }
    return value;
}

function persistNarrativeField(target) {
    const key = String(target?.dataset?.wbSetting || '');
    if (!NARRATIVE_SETTING_KEYS.has(key)) return false;
    const settings = getSettings();
    if (!settings) return false;
    settings[key] = sanitizeNarrativeSetting(key, target.value);
    saveSettings();
    return true;
}

function flushVisibleDrafts() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;
    persistVisibleTagRules(root);
    root.querySelectorAll('[data-wb-setting]').forEach(target => {
        persistNarrativeField(target);
    });
}

// Tag-filter cards intentionally keep a UI draft so typing does not rerender the
// settings panel. Persist the same draft directly into extensionSettings on every
// input event; saving must never depend on blur/change firing before a mobile
// settings panel is removed from the DOM.
document.addEventListener('input', event => {
    const target = event.target;
    const root = target?.closest?.(ROOT_SELECTOR);
    if (!root) return;

    if (target.matches?.(TAG_FIELD_SELECTOR)) {
        persistVisibleTagRules(root);
        return;
    }

    persistNarrativeField(target);
}, true);

// Mobile WebViews can remove a focused input before dispatching its final change
// event when the settings panel is closed. Flush first, while the DOM still owns
// the user's latest text.
document.addEventListener('pointerdown', event => {
    const action = event.target?.closest?.('[data-wb-action]')?.dataset?.wbAction;
    if (!['toggle-settings', 'toggle-module-settings'].includes(action)) return;
    flushVisibleDrafts();
}, true);

// Backgrounding / page teardown should not resurrect defaults either.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushVisibleDrafts();
});
globalThis.addEventListener?.('pagehide', flushVisibleDrafts);
