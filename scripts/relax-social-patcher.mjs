import fs from 'node:fs';

function replaceRegexOnce(source, pattern, replacement, label) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
    if (matches.length !== 1) throw new Error(`${label}: expected 1 match, got ${matches.length}`);
    return source.replace(pattern, replacement);
}

function replaceTextOnce(source, search, replacement, label) {
    const count = source.split(search).length - 1;
    if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
    return source.replace(search, replacement);
}

let index = fs.readFileSync('index.js', 'utf8');
let social = fs.readFileSync('social-terminal.js', 'utf8');
let ui = fs.readFileSync('ui.js', 'utf8');

index = replaceRegexOnce(
    index,
    /function recentAssistantNarrativeForSocial\(context = getContext\(\), limit = 8\) \{[\s\S]*?\r?\n\}\r?\n(?=\r?\nfunction getWorldbookNames)/,
    [
        'function recentNarrativeForSocial(context = getContext(), limit = 12) {',
        '    return (Array.isArray(context?.chat) ? context.chat : [])',
        '        .filter(message => message && !message.is_system)',
        '        .slice(-Math.max(2, Number(limit) || 12))',
        '        .map(message => {',
        "            if (message.is_user) return String(message.mes || '').trim();",
        '            const swipeId = Number(message.swipe_id ?? 0);',
        "            return String(message.swipes?.[swipeId] ?? message.mes ?? '').trim();",
        '        })',
        '        .filter(Boolean)',
        "        .join('\\n')",
        '        .slice(-18000);',
        '}',
    ].join('\n'),
    'recent narrative social helper',
);
index = index.replaceAll('recentAssistantNarrativeForSocial(', 'recentNarrativeForSocial(');

// Merely browsing/selecting a swipe must never start a model call.
index = replaceRegexOnce(
    index,
    /\r?\n\s*if \(message\.mes && message\.mes !== '\.\.\.' && getSettings\(\)\.worldAutoEnabled\) \{\s*scheduleAutoSync\(Number\(messageId\), 'swipe'\);\s*\}/,
    '',
    'remove eager swipe simulation',
);

index = replaceRegexOnce(
    index,
    /(\s*pendingRollup:\s*Boolean\(planMemoryRollup\(state\)\),\r?\n)/,
    `$1            latestSummaryMessageId: Math.max(\n                -1,\n                ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),\n            ),\n            summaryBehind: (() => {\n                const indexedThrough = Number(state.storyMemory?.indexedThroughMessageId ?? -1);\n                const latestSummaryMessageId = Math.max(\n                    -1,\n                    ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),\n                );\n                return indexedThrough >= 0 && latestSummaryMessageId < indexedThrough;\n            })(),\n`,
    'memory summary coverage',
);

index = replaceTextOnce(
    index,
    'function scheduleSocialPulse(delay = 1200) {',
    [
        'function socialPulseRelationSignature(social = {}) {',
        '    const rows = (Array.isArray(social?.connections) ? social.connections : [])',
        "        .map(item => [String(item?.personId || ''), String(item?.status || '')].join(':'))",
        '        .filter(Boolean)',
        '        .sort();',
        "    return hashText(rows.join('|'));",
        '}',
        '',
        'function scheduleSocialPulse(delay = 1200) {',
    ].join('\n'),
    'social pulse relation signature',
);

index = replaceRegexOnce(
    index,
    /    const social = normalizeSocialState\(store\.social \|\| emptySocialState\(\), store\.currentState\.people\);\r?\n    if \(\r?\n        !settings\.enabled[\s\S]*?\r?\n    \) return false;/,
    [
        '    const social = normalizeSocialState(store.social || emptySocialState(), store.currentState.people);',
        '    const currentWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);',
        '    const relationSignature = socialPulseRelationSignature(social);',
        "    const relationChanged = relationSignature !== String(social.lastPulseRelationSignature || '');",
        '    const lastPulseWorldMinute = Number(social.lastPulseWorldMinute ?? -1);',
        '    const worldTimeDue = lastPulseWorldMinute < 0',
        '        ? relationChanged',
        '        : currentWorldMinute - lastPulseWorldMinute >= 60;',
        '    if (',
        '        !settings.enabled',
        '        || !settings.socialAutoEnabled',
        '        || latestMessageId < 0',
        '        || latestMessageId <= Number(social.lastPulseMessageId ?? -1)',
        '        || (!relationChanged && !worldTimeDue)',
        '    ) return false;',
    ].join('\n'),
    'social pulse due gate',
);

index = replaceTextOnce(
    index,
    '        normalized.lastPulseMessageId = Number(messageId);\n        store.social = normalized;',
    [
        '        normalized.lastPulseMessageId = Number(messageId);',
        '        normalized.lastPulseWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);',
        '        normalized.lastPulseRelationSignature = socialPulseRelationSignature(normalized);',
        '        store.social = normalized;',
    ].join('\n'),
    'empty social pulse checkpoint',
);

index = replaceTextOnce(
    index,
    '        applied.social.lastPulseMessageId = Number(messageId);\n        store.social = applied.social;',
    [
        '        applied.social.lastPulseMessageId = Number(messageId);',
        '        applied.social.lastPulseWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);',
        '        applied.social.lastPulseRelationSignature = socialPulseRelationSignature(applied.social);',
        '        store.social = applied.social;',
    ].join('\n'),
    'successful social pulse checkpoint',
);

social = replaceTextOnce(
    social,
    '        lastPulseMessageId: -1,\n    };',
    [
        '        lastPulseMessageId: -1,',
        '        lastPulseWorldMinute: -1,',
        "        lastPulseRelationSignature: '',",
        '    };',
    ].join('\n'),
    'empty social due fields',
);

social = replaceRegexOnce(
    social,
    /(        lastPulseMessageId: Number\.isFinite\(Number\(source\.lastPulseMessageId \?\? source\.last_pulse_message_id\)\)[\s\S]*?            : -1,\r?\n)(    \};)/,
    `$1        lastPulseWorldMinute: Number.isFinite(Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))\n            ? Math.max(-1, Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))\n            : -1,\n        lastPulseRelationSignature: text(source.lastPulseRelationSignature ?? source.last_pulse_relation_signature, 160),\n$2`,
    'normalized social due fields',
);

social = replaceRegexOnce(
    social,
    /    const narrative = text\(recentNarrative, 12000\);[\s\S]*?\r?\n    const relationRecords = \[/,
    [
        '    const narrative = text(recentNarrative, 18000);',
        '    const completedContact = /(?:交换|互换|互留|留下|留了|给了|记下|存下|保存|添加|互加|加上|通过了?)(?:彼此|双方|对方|了|上|好|一下|一下子|的)?(?:联系方式|微信|qq|QQ|号码|手机号|电话|通讯号|联系人|好友)|(?:扫码|扫了码|扫二维码|扫描二维码|加了微信|加上微信|加了QQ|加上QQ|互加好友|互加微信|互加QQ|通讯录里(?:有|多了))/u;',
        '    const notCompleted = /(?:还没|没有|没能|未能|尚未|并未|拒绝|婉拒|暂不|以后再|改天再|等.+再|如果.+(?:再|才)?|想(?:要)?|打算|准备|试图|询问|请求).{0,24}(?:交换|添加|互加|联系方式|微信|qq|QQ|号码|电话|好友)/u;',
        '    if (personName && narrative.includes(personName)) {',
        '        const segments = narrative',
        "            .replace(/([。！？!?；;])/gu, '$1\\n')",
        '            .split(/\\n+/u)',
        '            .map(segment => segment.trim())',
        '            .filter(Boolean);',
        '        const personIndexes = segments',
        '            .map((segment, index) => segment.includes(personName) ? index : -1)',
        '            .filter(index => index >= 0);',
        '        const contactIndexes = segments',
        '            .map((segment, index) => completedContact.test(segment) && !notCompleted.test(segment) ? index : -1)',
        '            .filter(index => index >= 0);',
        '        const nearbyCompleted = contactIndexes.some(contactIndex => (',
        '            personIndexes.some(personIndex => Math.abs(personIndex - contactIndex) <= 1)',
        '        ));',
        '        if (nearbyCompleted) {',
        "            return { status: 'accepted', evidence: '正文已明确写成双方完成了联系方式交换' };",
        '        }',
        '    }',
        '',
        '    const relationRecords = [',
    ].join('\n'),
    'completed contact evidence',
);

const commonHint = '<div class="wb-settings-common-hint">';
const commonHintIndex = ui.indexOf(commonHint);
if (commonHintIndex < 0) throw new Error('settings common hint not found');
const switchMarkup = [
    '<div class="wb-setting-toggle">',
    '    <div>',
    '        <strong>通讯自主活动</strong>',
    '        <span>关掉后，人物不会自己发消息、好友申请、删好友或发朋友圈；已有通讯录和你手动聊天仍然保留。</span>',
    '    </div>',
    '    <label class="wb-switch">',
    '        <input type="checkbox" data-wb-setting="socialAutoEnabled"',
    "            ${settings.socialAutoEnabled !== false ? 'checked' : ''}>",
    '        <i></i>',
    '    </label>',
    '</div>',
    '',
].join('\n');
ui = ui.slice(0, commonHintIndex) + switchMarkup + ui.slice(commonHintIndex);

const oldMemoryStatus = '<span>${historyRunning ? `${historyPercent}%` : (Number(memory.pendingAssistantResponses || 0) > 0 ? \'有新的东西等我收～\' : \'我已经跟上正文啦～\')}</span>';
const newMemoryStatus = [
    '<span>${historyRunning',
    "    ? String(historyPercent) + '%'",
    '    : Number(memory.pendingAssistantResponses || 0) > 0',
    "        ? '有新的东西等我收～'",
    '        : memory.summaryBehind',
    "            ? '长期摘要还停在第 ' + Math.max(0, Number(memory.latestSummaryMessageId || 0)) + ' 层'",
    '            : memory.pendingRollup',
    "                ? '长期摘要还在等我压一层～'",
    "                : '长期记忆已追平正文～'}</span>",
].join('\n');
ui = replaceTextOnce(ui, oldMemoryStatus, newMemoryStatus, 'truthful memory status');

fs.writeFileSync('index.js', index);
fs.writeFileSync('social-terminal.js', social);
fs.writeFileSync('ui.js', ui);

fs.writeFileSync('tests/social-memory-swipe.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptySocialState, reconcileSocialRelationships } from '../social-terminal.js';

function stateFixture() {
    return {
        clock: { absoluteMinute: 120 },
        people: [
            { id: 'user', name: '玲', isUser: true },
            { id: 'p1', name: '顾清', isUser: false },
        ],
        events: [],
        storyMemory: { facts: [], summaries: [] },
    };
}

test('explicit completed contact in adjacent prose becomes accepted', () => {
    const result = reconcileSocialRelationships(emptySocialState(), stateFixture(), {
        userName: '玲',
        recentNarrative: '顾清把自己的二维码递给玲。两人扫码后交换了联系方式。',
    });
    assert.equal(result.connections.find(item => item.personId === 'p1')?.status, 'accepted');
});

test('future contact intent is not treated as completed fact', () => {
    const result = reconcileSocialRelationships(emptySocialState(), stateFixture(), {
        userName: '玲',
        recentNarrative: '顾清说，如果以后有需要，可以再交换联系方式。',
    });
    assert.notEqual(result.connections.find(item => item.personId === 'p1')?.status, 'accepted');
});

test('swipe browsing, social due gate, autonomy switch and memory coverage stay wired', async () => {
    const [index, ui, social] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../social-terminal.js', import.meta.url), 'utf8'),
    ]);
    assert.match(index, /function recentNarrativeForSocial/);
    assert.doesNotMatch(index, /recentAssistantNarrativeForSocial/);
    const swipeStart = index.indexOf('function restoreExistingSwipe');
    const swipeEnd = index.indexOf('function markSnapshotsStaleFrom', swipeStart);
    assert.doesNotMatch(index.slice(swipeStart, swipeEnd), /scheduleAutoSync\(Number\(messageId\), 'swipe'\)/);
    assert.match(index, /function socialPulseRelationSignature/);
    assert.match(index, /currentWorldMinute - lastPulseWorldMinute >= 60/);
    assert.match(social, /lastPulseWorldMinute: -1/);
    assert.match(social, /lastPulseRelationSignature: ''/);
    assert.match(ui, /data-wb-setting="socialAutoEnabled"/);
    assert.match(ui, /memory\.summaryBehind/);
    assert.match(ui, /长期记忆已追平正文/);
});
`);

console.log('Applied bounded social, swipe and memory fixes.');
