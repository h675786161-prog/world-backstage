import { MODULE_ID } from './core.js';

const LIVE_SEARCH_SELECTOR = [
    '[data-wb-worldbook-search]',
    '[data-wb-social-search]',
    '[data-wb-memory-search]',
].join(',');

const AUTO_TRUNCATION_PREFIX = '本次推演内容超过当前输出上限，模型返回被截断；本轮没有提交任何世界状态。';
const AUTO_TRUNCATION_MESSAGE = '本次推演在自动输出预算下仍被模型截断；本轮没有提交任何世界状态。自动模式会按任务规模分配请求上限，但并不等于无限输出；如果连续出现，可直接重试，或检查当前模型 / 服务端自身的最大输出限制。';

const composingInputs = new WeakSet();
const compositionFallbacks = new WeakMap();
let repairScheduled = false;

function matchesLiveSearch(target) {
    return target instanceof Element && target.matches(LIVE_SEARCH_SELECTOR);
}

function isAutomaticSimulationLimit() {
    const context = globalThis.SillyTavern?.getContext?.();
    const settings = context?.extensionSettings?.[MODULE_ID] || {};
    const globalLimit = Number(settings.maxOutputTokens) || 0;
    const simulationLimit = Number(settings.generationModuleLimits?.simulation?.maxTokens) || 0;
    return globalLimit <= 0 && simulationLimit <= 0;
}

function repairWorldTimeButtons(root = document) {
    for (const button of root.querySelectorAll?.('[data-wb-setting-button]') || []) {
        const setting = String(button.dataset.wbSettingButton || '').trim();
        if (!setting) continue;
        // ui.js 的通用 setting-button 分支只识别这两个字段；旧的世界时间
        // 三段按钮漏了它们，所以视觉上是按钮、实际上没有任何动作。
        button.dataset.wbAction = 'setting-button';
        button.dataset.setting = setting;
    }
}

function repairAutoTruncationMessage(root = document) {
    if (!isAutomaticSimulationLimit()) return;
    const panel = root.querySelector?.('#world-backstage-root') || root;
    if (!panel?.querySelectorAll) return;
    for (const paragraph of panel.querySelectorAll('p')) {
        const text = String(paragraph.textContent || '').trim();
        if (!text.startsWith(AUTO_TRUNCATION_PREFIX)) continue;
        paragraph.textContent = AUTO_TRUNCATION_MESSAGE;
        paragraph.dataset.wbAutoLimitMessageFixed = 'true';
    }
}

function repairUi() {
    repairScheduled = false;
    repairWorldTimeButtons(document);
    repairAutoTruncationMessage(document);
}

function scheduleRepair() {
    if (repairScheduled) return;
    repairScheduled = true;
    globalThis.requestAnimationFrame?.(repairUi) || globalThis.setTimeout(repairUi, 0);
}

function onCompositionStart(event) {
    if (!matchesLiveSearch(event.target)) return;
    composingInputs.add(event.target);
    const oldTimer = compositionFallbacks.get(event.target);
    if (oldTimer) globalThis.clearTimeout(oldTimer);
    compositionFallbacks.delete(event.target);
}

function onCompositionEnd(event) {
    if (!matchesLiveSearch(event.target)) return;
    const target = event.target;
    composingInputs.delete(target);

    // 标准浏览器会在 compositionend 后再发一个 isComposing=false 的 input。
    // 少数 Android WebView/输入法组合没有这个最终 input，因此留一个 0ms
    // 兜底；若正常 input 已经到了，capture 监听会先把这个 timer 取消。
    const timer = globalThis.setTimeout(() => {
        if (!target.isConnected) return;
        compositionFallbacks.delete(target);
        target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }, 0);
    compositionFallbacks.set(target, timer);
}

function onInputCapture(event) {
    if (!matchesLiveSearch(event.target)) return;
    const target = event.target;
    const composing = event.isComposing === true
        || composingInputs.has(target)
        || event.inputType === 'insertCompositionText';

    if (composing) {
        // ui.js 的搜索框会在 input 后 100/120ms render()；中文拼音尚未确认时
        // render 会直接替换 input 节点，迫使输入法提前提交拼音。组合阶段只拦
        // 搜索刷新，不拦浏览器本身更新输入框 value。
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
    }

    const fallback = compositionFallbacks.get(target);
    if (fallback) {
        globalThis.clearTimeout(fallback);
        compositionFallbacks.delete(target);
    }
}

function onClickCapture(event) {
    const button = event.target?.closest?.('[data-wb-setting-button]');
    if (!button) return;
    const setting = String(button.dataset.wbSettingButton || '').trim();
    if (!setting) return;

    // 在 ui.js 的冒泡 click handler 读取 data-wb-action 之前补齐字段。
    // 这层 capture 兜底让按钮即使刚 render 出来、MutationObserver 还没跑，
    // 第一次点击也不会丢。
    button.dataset.wbAction = 'setting-button';
    button.dataset.setting = setting;
}

function install() {
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('input', onInputCapture, true);
    document.addEventListener('click', onClickCapture, true);

    const observer = new MutationObserver(scheduleRepair);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleRepair();
}

install();
