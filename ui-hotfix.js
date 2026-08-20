const LIVE_SEARCH_SELECTOR = [
    '[data-wb-worldbook-search]',
    '[data-wb-social-search]',
    '[data-wb-memory-search]',
].join(',');

const composingInputs = new WeakSet();
const compositionFallbacks = new WeakMap();

function matchesLiveSearch(target) {
    return target instanceof Element && target.matches(LIVE_SEARCH_SELECTOR);
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

function install() {
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('input', onInputCapture, true);
}

install();
