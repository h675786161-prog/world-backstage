import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
    const matches = typeof search === 'string'
        ? source.split(search).length - 1
        : [...source.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`))].length;
    if (matches !== 1) throw new Error(`${label}: expected exactly one match, got ${matches}`);
    return source.replace(search, replacement);
}

function withEol(text, eol) {
    return text.replace(/\n/g, eol);
}

let index = fs.readFileSync('index.js', 'utf8');
let ui = fs.readFileSync('ui.js', 'utf8');
let style = fs.readFileSync('style.css', 'utf8');
const indexEol = index.includes('\r\n') ? '\r\n' : '\n';
const uiEol = ui.includes('\r\n') ? '\r\n' : '\n';
const styleEol = style.includes('\r\n') ? '\r\n' : '\n';

// Persisted setting. Default true preserves the current behavior for existing users.
if (!index.includes('socialInstantReply: true')) {
    index = replaceOnce(
        index,
        /(\s+socialAutoEnabled: true,\r?\n)/,
        `$1    socialInstantReply: true,${indexEol}`,
        'default socialInstantReply setting',
    );
}

// Split "send a message" from "ask the model for a reply".
const socialStart = index.indexOf('async function sendSocialMessage(');
const socialEnd = index.indexOf('async function requestSocialFriend(', socialStart);
if (socialStart < 0 || socialEnd < 0) throw new Error('social reply function boundaries not found');
const socialFunctions = withEol(`async function requestSocialReply(conversationId, { source = 'manual' } = {}) {
    if (runtime.activeSocial && !runtime.activeSocial.controller?.signal?.aborted) {
        throw new Error('上一条社交消息还在等回复');
    }
    const chatToken = currentChatToken();
    const contextEpoch = runtime.contextEpoch;
    const controller = new AbortController();
    let store = getStore();
    const normalizedSocial = normalizeSocialState(
        store.social || emptySocialState(),
        store.currentState.people,
    );
    const conversation = normalizedSocial.conversations.find(
        item => item.id === String(conversationId || ''),
    );
    if (!conversation) throw new Error('没有找到这个会话');
    const lastMessage = conversation.rawMessages?.at(-1) || null;
    if (!lastMessage || lastMessage.senderId !== 'user') {
        throw new Error('现在没有等着回的消息～先递一句过去吧');
    }

    runtime.activeSocial = { controller, chatToken, contextEpoch, conversationId };
    runtime.socialStatus = {
        phase: 'running',
        message: source === 'manual'
            ? '小猫叼着消息去敲门啦～正在等对方回话……'
            : '消息已发出，正在判断谁看见、谁知道、谁愿意回……',
        error: '',
        conversationId,
    };
    runtime.ui?.render();

    try {
        const prompt = buildSocialReplyPrompt(store.social, store.currentState, conversationId, {
            userName: String(getContext()?.name1 || '你'),
        });
        const raw = await backgroundSimulation(prompt, {
            maxTokens: 1400,
            temperature: 0.72,
            signal: controller.signal,
            taskKind: 'social',
            rejectTruncated: true,
        });
        const parsed = extractJsonObject(raw);
        if (!parsed) throw unreadableJsonError(raw, '社交回复模型');
        if (
            controller.signal.aborted
            || chatToken !== currentChatToken()
            || contextEpoch !== runtime.contextEpoch
        ) return null;
        store = getStore();
        const applied = applySocialReplyPayload(store.social, conversationId, parsed, store.currentState);
        store.social = applied.social;
        saveStore(store, { immediate: true });
        refreshInjection();
        runtime.socialStatus = {
            phase: 'success',
            message: applied.replyCount
                ? (source === 'manual' ? `小猫叼回 ${applied.replyCount} 条回复。` : `收到 ${applied.replyCount} 条回复。`)
                : '这次没有人回话。这不是生成失败，而是路由后的沉默结果。',
            error: '',
            conversationId,
        };
        runtime.ui?.render();
        return applied;
    } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return null;
        if (chatToken === currentChatToken() && contextEpoch === runtime.contextEpoch) {
            store = getStore();
            store.social = setSocialConversationError(store.social, conversationId, error, store.currentState.people);
            saveStore(store, { immediate: true });
            runtime.socialStatus = {
                phase: 'error',
                message: source === 'manual'
                    ? '消息还在，但小猫这次没叼回回复。'
                    : '消息已保留，但这次没能拿到人物回复。',
                error: describeError(error),
                conversationId,
            };
            runtime.ui?.render();
        }
        return { stored: true, replyCount: 0, error: describeError(error) };
    } finally {
        if (runtime.activeSocial?.controller === controller) runtime.activeSocial = null;
    }
}

async function sendSocialMessage(conversationId, messageText) {
    if (runtime.activeSocial && !runtime.activeSocial.controller?.signal?.aborted) {
        throw new Error('上一条社交消息还在等回复');
    }
    let store = getStore();
    store.social = appendUserSocialMessage(
        store.social,
        conversationId,
        messageText,
        store.currentState.clock?.absoluteMinute,
        store.currentState.people,
    );
    saveStore(store, { immediate: true });

    if (getSettings().socialInstantReply === false) {
        runtime.socialStatus = {
            phase: 'success',
            message: '消息已经递出去啦～这次没有调用 API；想让对方现在回，就点「小猫传递」。',
            error: '',
            conversationId,
        };
        runtime.ui?.render();
        return { stored: true, replyCount: 0, waitingForManualReply: true };
    }

    return await requestSocialReply(conversationId, { source: 'instant' });
}

`, indexEol);
index = index.slice(0, socialStart) + socialFunctions + index.slice(socialEnd);

// Manual reply action uses the same one-request reply path and never appends the outgoing text twice.
if (!index.includes("if (action === 'social-request-reply')")) {
    index = replaceOnce(
        index,
        `    if (action === 'social-send-message') {${indexEol}        return await sendSocialMessage(payload.conversationId, payload.text);${indexEol}    }`,
        `    if (action === 'social-send-message') {${indexEol}        return await sendSocialMessage(payload.conversationId, payload.text);${indexEol}    }${indexEol}${indexEol}    if (action === 'social-request-reply') {${indexEol}        return await requestSocialReply(payload.conversationId, { source: 'manual' });${indexEol}    }`,
        'manual social reply action',
    );
}

// Keep diagnostics aware of the switch without changing any unrelated behavior.
if (!index.includes("socialInstantReply: settings.socialInstantReply")) {
    index = replaceOnce(
        index,
        /(\s+socialAutoEnabled: settings\.socialAutoEnabled,\r?\n)/,
        `$1            socialInstantReply: settings.socialInstantReply,${indexEol}`,
        'social instant reply diagnostic snapshot',
    );
}

// Communications page switch: visible where the behavior matters.
if (!ui.includes('data-wb-setting="socialInstantReply"')) {
    const renderStart = ui.indexOf('function renderSocialView(');
    const shellStart = ui.indexOf('<section class="wb-social-shell', renderStart);
    const navEnd = ui.indexOf('</nav>', shellStart);
    if (renderStart < 0 || shellStart < 0 || navEnd < 0) throw new Error('social view navigation not found');
    const toggleMarkup = withEol(`
            \${page === 'messages' ? `
                <div class="wb-social-reply-toggle">
                    <div>
                        <strong>及时回复</strong>
                        <span>\${settings.socialInstantReply !== false
                            ? '每发一条消息就调用 1 次 API，马上等一轮回复。'
                            : '先只把消息递出去；想让对方现在回时，再点「小猫传递」。'}</span>
                    </div>
                    <label class="wb-switch" title="控制你主动发消息后是否立刻请求人物回复">
                        <input type="checkbox" data-wb-setting="socialInstantReply"
                            \${settings.socialInstantReply !== false ? 'checked' : ''}>
                        <i></i>
                    </label>
                </div>
            ` : ''}
`, uiEol);
    ui = ui.slice(0, navEnd + '</nav>'.length) + toggleMarkup + ui.slice(navEnd + '</nav>'.length);
}

// When instant replies are off, a pending user message exposes the manual cat-delivery button.
if (!ui.includes('data-wb-action="social-request-reply"')) {
    const composeNeedle = '<form class="wb-social-compose" data-wb-form="social-message">';
    const composeAt = ui.indexOf(composeNeedle, ui.indexOf('function renderSocialView('));
    if (composeAt < 0) throw new Error('social composer not found');
    const catButton = withEol(`<button class="wb-social-cat-delivery" type="button"
                        data-wb-action="social-request-reply"
                        data-conversation-id="\${escapeAttr(active.id)}"
                        title="调用一次 API，让这条会话现在回一轮"
                        \${settings.socialInstantReply !== false || active?.rawMessages?.at(-1)?.senderId !== 'user' ? 'hidden' : ''}
                        \${activeBusy ? 'disabled' : ''}><span aria-hidden="true">🐾</span> 小猫传递</button>
                    `, uiEol);
    ui = ui.slice(0, composeAt) + catButton + ui.slice(composeAt);
}

// Wire the button through the existing UI action dispatcher.
if (!ui.includes("if (action === 'social-request-reply')")) {
    const actionNeedle = "        if (action === 'social-select-conversation') {";
    ui = replaceOnce(
        ui,
        actionNeedle,
        withEol(`        if (action === 'social-request-reply') {
            const conversationId = String(target.dataset.conversationId || '');
            if (!conversationId) return;
            await invokeAction('social-request-reply', { conversationId });
            render();
            return;
        }
        if (action === 'social-select-conversation') {`, uiEol),
        'social request reply click handler',
    );
}

if (!style.includes('.wb-social-reply-toggle')) {
    style += withEol(`

/* 通讯 · 及时回复 / 小猫传递 */
.wb-social-reply-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin: 10px 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--wb-line);
    border-radius: 14px;
    background: var(--wb-panel-faint);
}

.wb-social-reply-toggle > div {
    min-width: 0;
    display: grid;
    gap: 3px;
}

.wb-social-reply-toggle strong {
    color: var(--wb-text);
    font-size: calc(12px + var(--wb-reading-bump));
    font-weight: 600;
}

.wb-social-reply-toggle span {
    color: var(--wb-text-faint);
    font-size: calc(9px + var(--wb-reading-bump));
    line-height: 1.45;
}

.wb-social-cat-delivery {
    align-self: flex-end;
    margin: 0 0 8px auto;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--wb-accent) 38%, var(--wb-line));
    border-radius: 999px;
    background: var(--wb-accent-soft);
    color: var(--wb-accent);
    cursor: pointer;
    font-size: calc(10px + var(--wb-reading-bump));
    transition: transform 120ms ease, opacity 120ms ease;
}

.wb-social-cat-delivery:hover:not(:disabled) {
    transform: translateY(-1px);
}

.wb-social-cat-delivery:disabled {
    opacity: 0.55;
    cursor: wait;
}

.wb-social-cat-delivery[hidden] {
    display: none !important;
}

@media (max-width: 720px) {
    .wb-social-reply-toggle {
        margin: 8px 0 10px;
        padding: 9px 10px;
    }

    .wb-social-cat-delivery {
        margin-bottom: 6px;
    }
}
`, styleEol);
}

fs.writeFileSync('index.js', index);
fs.writeFileSync('ui.js', ui);
fs.writeFileSync('style.css', style);
console.log('Applied social instant reply toggle and 小猫传递 manual reply flow.');
