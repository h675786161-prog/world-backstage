const MODULE_ID = 'world_backstage';
const ROOT_SELECTOR = '#world-backstage-root';
const TAG_FIELD_SELECTOR = '[data-wb-tag-filter-field]';
const DIRECT_SETTING_SELECTOR = '[data-wb-setting]';
const SETTING_SECONDS_SELECTOR = '[data-wb-setting-seconds]';
const GENERATION_LIMIT_SELECTOR = '[data-wb-generation-limit]';
const API_ROUTE_SELECTOR = '[data-wb-api-route]';
const TAVERN_PROFILE_SELECTOR = '[data-wb-tavern-profile-select]';
const GENERATION_MODULES = new Set(['simulation', 'observation', 'history', 'opinion']);

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
    // SillyTavern already debounces this write, so input-time persistence does not
    // turn every keystroke into a disk write.
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

function persistDirectSetting(target) {
    if (!target?.matches?.(DIRECT_SETTING_SELECTOR)) return false;
    const key = String(target.dataset.wbSetting || '').trim();
    const settings = getSettings();
    if (!key || !settings) return false;

    const type = String(target.type || '').toLowerCase();
    const value = type === 'checkbox' || type === 'radio'
        ? Boolean(target.checked)
        : target.value;

    // Match the main UI's generic update-settings path. Canonical clamping and
    // migrations stay owned by getSettings(); the existing bubbling change
    // handler still performs any runtime side effects.
    settings[key] = value;
    saveSettings();
    return true;
}

function persistSettingSeconds(target) {
    if (!target?.matches?.(SETTING_SECONDS_SELECTOR)) return false;
    const key = String(target.dataset.wbSettingSeconds || '').trim();
    const settings = getSettings();
    if (!key || !settings) return false;
    const seconds = Math.max(0, Number(target.value) || 0);
    settings[key] = seconds > 0 ? Math.round(seconds * 1000) : 0;
    saveSettings();
    return true;
}

function persistGenerationLimit(target) {
    if (!target?.matches?.(GENERATION_LIMIT_SELECTOR)) return false;
    const field = String(target.dataset.wbGenerationLimit || '');
    const moduleKey = String(target.dataset.module || '');
    const settings = getSettings();
    if (!settings || !GENERATION_MODULES.has(moduleKey)) return false;
    if (!['maxTokens', 'timeoutSeconds'].includes(field)) return false;

    const current = settings.generationModuleLimits && typeof settings.generationModuleLimits === 'object'
        ? settings.generationModuleLimits
        : {};
    const moduleLimit = {
        ...(current[moduleKey] || { maxTokens: 0, timeoutMs: 0 }),
    };

    if (field === 'maxTokens') {
        moduleLimit.maxTokens = Math.max(0, Number.parseInt(target.value, 10) || 0);
    } else {
        const seconds = Math.max(0, Number(target.value) || 0);
        moduleLimit.timeoutMs = seconds > 0 ? Math.round(seconds * 1000) : 0;
    }

    settings.generationModuleLimits = {
        ...current,
        [moduleKey]: moduleLimit,
    };
    saveSettings();
    return true;
}

function persistApiRoute(target) {
    if (!target?.matches?.(API_ROUTE_SELECTOR)) return false;
    const moduleKey = String(target.dataset.wbApiRoute || '');
    const settings = getSettings();
    if (!settings || !GENERATION_MODULES.has(moduleKey)) return false;
    settings.apiModuleRoutes = {
        ...(settings.apiModuleRoutes || {}),
        [moduleKey]: String(target.value || 'default'),
    };
    saveSettings();
    return true;
}

function persistTavernProfile(target) {
    if (!target?.matches?.(TAVERN_PROFILE_SELECTOR)) return false;
    const settings = getSettings();
    if (!settings) return false;
    settings.tavernApiProfileId = String(target.value || '');
    saveSettings();
    return true;
}

function persistDurableField(target, root = target?.closest?.(ROOT_SELECTOR)) {
    if (!target || !root) return false;

    if (target.matches?.(TAG_FIELD_SELECTOR)) return persistVisibleTagRules(root);
    if (persistSettingSeconds(target)) return true;
    if (persistGenerationLimit(target)) return true;
    if (persistDirectSetting(target)) return true;
    if (persistApiRoute(target)) return true;
    if (persistTavernProfile(target)) return true;
    return false;
}

function flushVisibleDurableSettings() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    persistVisibleTagRules(root);

    root.querySelectorAll([
        DIRECT_SETTING_SELECTOR,
        SETTING_SECONDS_SELECTOR,
        GENERATION_LIMIT_SELECTOR,
        API_ROUTE_SELECTOR,
        TAVERN_PROFILE_SELECTOR,
    ].join(',')).forEach(target => {
        persistDurableField(target, root);
    });
}

let composingTarget = null;

document.addEventListener('compositionstart', event => {
    const target = event.target;
    if (target?.closest?.(ROOT_SELECTOR)) composingTarget = target;
}, true);

document.addEventListener('compositionend', event => {
    const target = event.target;
    if (target === composingTarget) composingTarget = null;
    const root = target?.closest?.(ROOT_SELECTOR);
    if (root) persistDurableField(target, root);
}, true);

// Durable settings save on input, not on blur. The main UI may still run its
// existing change handler later for runtime side effects; this guard's job is to
// make the user's latest value impossible to lose when mobile destroys the field
// before change/blur is delivered.
document.addEventListener('input', event => {
    const target = event.target;
    const root = target?.closest?.(ROOT_SELECTOR);
    if (!root) return;
    if (event.isComposing || target === composingTarget) return;
    persistDurableField(target, root);
}, true);

// Persist at capture phase before the UI's asynchronous change handler can
// rerender the settings surface. The normal handler still runs afterwards and
// owns runtime side effects such as stopping timers.
document.addEventListener('change', event => {
    const target = event.target;
    const root = target?.closest?.(ROOT_SELECTOR);
    if (!root) return;
    persistDurableField(target, root);
}, true);

// Closing a settings surface is the dangerous path on mobile: flush while the
// current DOM still owns the user's text, before the click handler can rerender it.
document.addEventListener('pointerdown', event => {
    const action = event.target?.closest?.('[data-wb-action]')?.dataset?.wbAction;
    if (!['toggle-settings', 'toggle-module-settings'].includes(action)) return;
    flushVisibleDurableSettings();
}, true);

// Backgrounding / page teardown must not resurrect defaults either.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushVisibleDurableSettings();
});
globalThis.addEventListener?.('pagehide', flushVisibleDurableSettings);

// Intentionally NOT persisted here:
// - worldbook/memory/social search and selection state (UI-only transient state)
// - Lingqi/social message drafts (unsent conversation text)
// - API/image API and world/person/event/memory/record editor forms (explicit Save/Submit semantics)
