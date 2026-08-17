import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
    const matches = typeof search === 'string'
        ? source.split(search).length - 1
        : [...source.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`))].length;
    if (matches !== 1) throw new Error(`${label}: expected exactly one match, got ${matches}`);
    return source.replace(search, replacement);
}

function block(lines, eol) {
    return lines.join(eol);
}

let index = fs.readFileSync('index.js', 'utf8');
let ui = fs.readFileSync('ui.js', 'utf8');
let style = fs.readFileSync('style.css', 'utf8');
const indexEol = index.includes('\r\n') ? '\r\n' : '\n';
const uiEol = ui.includes('\r\n') ? '\r\n' : '\n';
const styleEol = style.includes('\r\n') ? '\r\n' : '\n';

if (!index.includes('socialInstantReply: true')) {
    index = replaceOnce(
        index,
        /(\s+socialAutoEnabled: true,\r?\n)/,
        `$1    socialInstantReply: true,${indexEol}`,
        'default socialInstantReply setting',
    );
}

index = replaceOnce(
    index,
    'async function sendSocialMessage(conversationId, messageText) {',
    'async function sendSocialMessage(conversationId, messageText, { requestOnly = false } = {}) {',
    'social send signature',
);

index = replaceOnce(
    index,
    /    let store = getStore\(\);\r?\n    store\.social = appendUserSocialMessage\([\s\S]*?\r?\n    saveStore\(store, \{ immediate: true \}\);/,
    block([
        '    let store = getStore();',
        '    if (requestOnly) {',
        '        const normalizedSocial = normalizeSocialState(',
        '            store.social || emptySocialState(),',
        '            store.currentState.people,',
        '        );',
        "        const conversation = normalizedSocial.conversations.find(item => item.id === String(conversationId || ''));",
        "        if (!conversation) throw new Error('没有找到这个会话');",
        '        const lastMessage = conversation.rawMessages?.at(-1) || null;',
        "        if (!lastMessage || lastMessage.senderId !== 'user') {",
        "            throw new Error('现在没有等着回的消息～先递一句过去吧');",
        '        }',
        '    } else {',
        '        store.social = appendUserSocialMessage(',
        '            store.social,',
        '            conversationId,',
        '            messageText,',
        '            store.currentState.clock?.absoluteMinute,',
        '            store.currentState.people,',
        '        );',
        '        saveStore(store, { immediate: true });',
        '        if (getSettings().socialInstantReply === false) {',
        '            runtime.socialStatus = {',
        "                phase: 'success',",
        "                message: '消息已经递出去啦～这次没有调用 API；想让对方现在回，就点「小猫传递」。',",
        "                error: '',",
        '                conversationId,',
        '            };',
        '            runtime.ui?.render();',
        '            return { stored: true, replyCount: 0, waitingForManualReply: true };',
        '        }',
        '    }',
    ], indexEol),
    'social outgoing/manual split',
);

index = replaceOnce(
    index,
    "        message: '消息已发出，正在判断谁看见、谁知道、谁愿意回……',",
    block([
        '        message: requestOnly',
        "            ? '小猫叼着消息去敲门啦～正在等对方回话……'",
        "            : '消息已发出，正在判断谁看见、谁知道、谁愿意回……',",
    ], indexEol),
    'social reply status copy',
);

if (!index.includes("if (action === 'social-request-reply')")) {
    const newAction = block([
        "    if (action === 'social-send-message') {",
        '        return await sendSocialMessage(payload.conversationId, payload.text);',
        '    }',
        '',
        "    if (action === 'social-request-reply') {",
        "        return await sendSocialMessage(payload.conversationId, '', { requestOnly: true });",
        '    }',
    ], indexEol);
    index = replaceOnce(
        index,
        /    if \(action === 'social-send-message'\) \{\s*return await sendSocialMessage\(payload\.conversationId, payload\.text\);\s*\}/,
        newAction,
        'manual social reply action',
    );
}

if (!index.includes('socialInstantReply: settings.socialInstantReply')) {
    index = replaceOnce(
        index,
        /(\s+socialAutoEnabled: settings\.socialAutoEnabled,\r?\n)/,
        `$1            socialInstantReply: settings.socialInstantReply,${indexEol}`,
        'social instant reply diagnostics',
    );
}

if (!ui.includes('data-wb-setting="socialInstantReply"')) {
    const renderStart = ui.indexOf('function renderSocialView(');
    const shellStart = ui.indexOf('<section class="wb-social-shell', renderStart);
    const navEnd = ui.indexOf('</nav>', shellStart);
    if (renderStart < 0 || shellStart < 0 || navEnd < 0) throw new Error('social nav not found');
    const toggle = block([
        '',
        "            ${page === 'messages' ? `",
        '                <div class="wb-social-reply-toggle">',
        '                    <div>',
        '                        <strong>及时回复</strong>',
        "                        <span>${settings.socialInstantReply !== false",
        "                            ? '每发一条消息就调用 1 次 API，马上等一轮回复。'",
        "                            : '先只把消息递出去；想让对方现在回时，再点「小猫传递」。'}</span>",
        '                    </div>',
        '                    <label class="wb-switch" title="控制你主动发消息后是否立刻请求人物回复">',
        '                        <input type="checkbox" data-wb-setting="socialInstantReply"',
        "                            ${settings.socialInstantReply !== false ? 'checked' : ''}>",
        '                        <i></i>',
        '                    </label>',
        '                </div>',
        "            ` : ''}",
    ], uiEol);
    ui = ui.slice(0, navEnd + 6) + toggle + ui.slice(navEnd + 6);
}

if (!ui.includes('data-wb-action="social-request-reply"')) {
    const composeNeedle = '<form class="wb-social-compose" data-wb-form="social-message">';
    const composeAt = ui.indexOf(composeNeedle, ui.indexOf('function renderSocialView('));
    if (composeAt < 0) throw new Error('social composer not found');
    const catButton = block([
        '<button class="wb-social-cat-delivery" type="button"',
        '                        data-wb-action="social-request-reply"',
        '                        data-conversation-id="${escapeAttr(active.id)}"',
        '                        title="调用一次 API，让这条会话现在回一轮"',
        "                        ${settings.socialInstantReply !== false || active?.rawMessages?.at(-1)?.senderId !== 'user' ? 'hidden' : ''}",
        "                        ${activeBusy ? 'disabled' : ''}><span aria-hidden=\"true\">🐾</span> 小猫传递</button>",
        '                    ',
    ], uiEol);
    ui = ui.slice(0, composeAt) + catButton + ui.slice(composeAt);
}

if (!ui.includes("if (action === 'social-request-reply')")) {
    const actionNeedle = "        if (action === 'social-select-conversation') {";
    const actionReplacement = block([
        "        if (action === 'social-request-reply') {",
        "            const conversationId = String(target.dataset.conversationId || '');",
        '            if (!conversationId) return;',
        "            await invokeAction('social-request-reply', { conversationId });",
        '            render();',
        '            return;',
        '        }',
        "        if (action === 'social-select-conversation') {",
    ], uiEol);
    ui = replaceOnce(ui, actionNeedle, actionReplacement, 'manual cat delivery click handler');
}

if (!style.includes('.wb-social-reply-toggle')) {
    style += block([
        '', '',
        '/* 通讯 · 及时回复 / 小猫传递 */',
        '.wb-social-reply-toggle {',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: space-between;',
        '    gap: 14px;',
        '    margin: 10px 0 12px;',
        '    padding: 10px 12px;',
        '    border: 1px solid var(--wb-line);',
        '    border-radius: 14px;',
        '    background: var(--wb-panel-faint);',
        '}',
        '.wb-social-reply-toggle > div { min-width: 0; display: grid; gap: 3px; }',
        '.wb-social-reply-toggle strong { color: var(--wb-text); font-size: calc(12px + var(--wb-reading-bump)); font-weight: 600; }',
        '.wb-social-reply-toggle span { color: var(--wb-text-faint); font-size: calc(9px + var(--wb-reading-bump)); line-height: 1.45; }',
        '.wb-social-cat-delivery {',
        '    align-self: flex-end;',
        '    margin: 0 0 8px auto;',
        '    padding: 8px 12px;',
        '    border: 1px solid color-mix(in srgb, var(--wb-accent) 38%, var(--wb-line));',
        '    border-radius: 999px;',
        '    background: var(--wb-accent-soft);',
        '    color: var(--wb-accent);',
        '    cursor: pointer;',
        '    font-size: calc(10px + var(--wb-reading-bump));',
        '    transition: transform 120ms ease, opacity 120ms ease;',
        '}',
        '.wb-social-cat-delivery:hover:not(:disabled) { transform: translateY(-1px); }',
        '.wb-social-cat-delivery:disabled { opacity: 0.55; cursor: wait; }',
        '.wb-social-cat-delivery[hidden] { display: none !important; }',
        '@media (max-width: 720px) {',
        '    .wb-social-reply-toggle { margin: 8px 0 10px; padding: 9px 10px; }',
        '    .wb-social-cat-delivery { margin-bottom: 6px; }',
        '}',
    ], styleEol);
}

fs.writeFileSync('index.js', index);
fs.writeFileSync('ui.js', ui);
fs.writeFileSync('style.css', style);
console.log('Applied social instant reply toggle and 小猫传递 manual reply flow.');
