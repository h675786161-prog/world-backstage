import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
    const matches = typeof search === 'string'
        ? source.split(search).length - 1
        : [...source.matchAll(new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`))].length;
    if (matches !== 1) throw new Error(`${label}: expected exactly one match, got ${matches}`);
    return source.replace(search, replacement);
}

let index = fs.readFileSync('index.js', 'utf8');
let social = fs.readFileSync('social-terminal.js', 'utf8');
let ui = fs.readFileSync('ui.js', 'utf8');

// 1) Contact facts must read both sides of the recent narrative, not AI replies only.
index = replaceOnce(
    index,
    /function recentAssistantNarrativeForSocial\(context = getContext\(\), limit = 8\) \{[\s\S]*?\n\}/,
    `function recentNarrativeForSocial(context = getContext(), limit = 12) {
    return (Array.isArray(context?.chat) ? context.chat : [])
        .filter(message => message && !message.is_system)
        .slice(-Math.max(2, Number(limit) || 12))
        .map(message => {
            if (message.is_user) return String(message.mes || '').trim();
            const swipeId = Number(message.swipe_id ?? 0);
            return String(message.swipes?.[swipeId] ?? message.mes ?? '').trim();
        })
        .filter(Boolean)
        .join('\\n')
        .slice(-18000);
}`,
    'recent social narrative helper',
);
index = index.replaceAll('recentAssistantNarrativeForSocial(', 'recentNarrativeForSocial(');

// 2) Swiping is browsing, not acceptance. Persist a pending branch, but do not call the model until play continues.
index = replaceOnce(
    index,
    `    } else if (data?.base && !data.stale) {
        store.currentState = markPendingSync(
            restoreBranchSnapshot(data.base, store.initialState),
            true,
        );
        if (message.mes && message.mes !== '...' && getSettings().worldAutoEnabled) {
            scheduleAutoSync(Number(messageId), 'swipe');
        }
    } else {
        const previous = findLatestResultSnapshot(Number(messageId));
        store.currentState = markPendingSync(
            previous ? stateWithBranchOverride(previous.snapshot, store) : clone(store.initialState),
            true,
        );
    }`,
    `    } else if (data?.base && !data.stale) {
        store.currentState = markPendingSync(
            restoreBranchSnapshot(data.base, store.initialState),
            true,
        );
    } else {
        const previous = findLatestResultSnapshot(Number(messageId));
        const base = previous
            ? stateWithBranchOverride(previous.snapshot, store)
            : clone(store.initialState);
        store.currentState = markPendingSync(base, true);
        const pendingSourceKey = branchSourceKey(Number(messageId), message, swipeId);
        attachBranchData(message, swipeId, {
            schemaVersion: SCHEMA_VERSION,
            status: 'pending',
            sourceKey: pendingSourceKey,
            trigger: 'swipe-selected',
            offeredEventIds: [],
            offeredDirectorNoteIds: [],
            base: createBranchSnapshot(base, {
                messageId: Number(messageId),
                swipeId,
                sourceKey: pendingSourceKey,
                kind: 'base',
            }),
            result: null,
            error: '',
            stale: false,
        });
        void context?.saveChat?.();
    }`,
    'restoreExistingSwipe auto-sync block',
);

// 3) Memory UI needs a real summary-coverage signal, not only the index cursor.
index = replaceOnce(
    index,
    `            pendingRollup: Boolean(planMemoryRollup(state)),
            clues: state.storyMemory?.clues?.length || 0,`,
    `            pendingRollup: Boolean(planMemoryRollup(state)),
            latestSummaryMessageId: Math.max(
                -1,
                ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),
            ),
            summaryBehind: (() => {
                const indexedThrough = Number(state.storyMemory?.indexedThroughMessageId ?? -1);
                const latestSummaryMessageId = Math.max(
                    -1,
                    ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),
                );
                return indexedThrough >= 0 && latestSummaryMessageId < indexedThrough;
            })(),
            clues: state.storyMemory?.clues?.length || 0,`,
    'memory summary coverage fields',
);

// 4) Social autonomy gets its own due gate. No every-reply model call.
index = replaceOnce(
    index,
    `function scheduleSocialPulse(delay = 1200) {
    const settings = getSettings();`,
    `function socialPulseRelationSignature(social = {}) {
    const rows = (Array.isArray(social?.connections) ? social.connections : [])
        .map(item => [String(item?.personId || ''), String(item?.status || '')].join(':'))
        .filter(Boolean)
        .sort();
    return hashText(rows.join('|'));
}

function scheduleSocialPulse(delay = 1200) {
    const settings = getSettings();`,
    'social pulse signature helper',
);

index = replaceOnce(
    index,
    `    const social = normalizeSocialState(store.social || emptySocialState(), store.currentState.people);
    if (
        !settings.enabled
        || !settings.socialAutoEnabled
        || latestMessageId < 0
        || latestMessageId <= Number(social.lastPulseMessageId ?? -1)
    ) return false;`,
    `    const social = normalizeSocialState(store.social || emptySocialState(), store.currentState.people);
    const currentWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);
    const relationSignature = socialPulseRelationSignature(social);
    const relationChanged = relationSignature !== String(social.lastPulseRelationSignature || '');
    const lastPulseWorldMinute = Number(social.lastPulseWorldMinute ?? -1);
    const worldTimeDue = lastPulseWorldMinute < 0
        ? relationChanged
        : currentWorldMinute - lastPulseWorldMinute >= 60;
    if (
        !settings.enabled
        || !settings.socialAutoEnabled
        || latestMessageId < 0
        || latestMessageId <= Number(social.lastPulseMessageId ?? -1)
        || (!relationChanged && !worldTimeDue)
    ) return false;`,
    'social pulse due gate',
);

index = replaceOnce(
    index,
    `    if (!prompt) {
        normalized.lastPulseMessageId = Number(messageId);
        store.social = normalized;`,
    `    if (!prompt) {
        normalized.lastPulseMessageId = Number(messageId);
        normalized.lastPulseWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);
        normalized.lastPulseRelationSignature = socialPulseRelationSignature(normalized);
        store.social = normalized;`,
    'empty social pulse checkpoint',
);

index = replaceOnce(
    index,
    `        const applied = applySocialPulsePayload(store.social, store.currentState, parsed);
        applied.social.lastPulseMessageId = Number(messageId);
        store.social = applied.social;`,
    `        const applied = applySocialPulsePayload(store.social, store.currentState, parsed);
        applied.social.lastPulseMessageId = Number(messageId);
        applied.social.lastPulseWorldMinute = Math.max(0, Number(store.currentState?.clock?.absoluteMinute) || 0);
        applied.social.lastPulseRelationSignature = socialPulseRelationSignature(applied.social);
        store.social = applied.social;`,
    'successful social pulse checkpoint',
);

// Persist social due-state fields and make completed-contact detection tolerant of normal prose layout.
social = replaceOnce(
    social,
    `        lastPulseMessageId: -1,
    };`,
    `        lastPulseMessageId: -1,
        lastPulseWorldMinute: -1,
        lastPulseRelationSignature: '',
    };`,
    'empty social pulse fields',
);

social = replaceOnce(
    social,
    `        lastPulseMessageId: Number.isFinite(Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            ? Math.max(-1, Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            : -1,
    };`,
    `        lastPulseMessageId: Number.isFinite(Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            ? Math.max(-1, Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            : -1,
        lastPulseWorldMinute: Number.isFinite(Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))
            ? Math.max(-1, Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))
            : -1,
        lastPulseRelationSignature: text(source.lastPulseRelationSignature ?? source.last_pulse_relation_signature, 160),
    };`,
    'normalized social pulse fields',
);

social = replaceOnce(
    social,
    `    const narrative = text(recentNarrative, 12000);
    const completedContact = /交换(?:了|好)?联系方式|互(?:相)?加(?:了|上)?(?:好友|联系方式)|加(?:了|上|为)好友|通过(?:了)?好友申请|留下(?:了)?(?:电话|号码|联系方式)|存下(?:了)?(?:电话|号码|联系方式)|通讯录里(?:有|多了)/;
    const incompleteOrRejected = /没(?:有|能)?|未能|拒绝|婉拒|想(?:要)?|打算|准备|试图|询问|请求|等.+再|如果/;
    if (personName && narrative.includes(personName)) {
        const relevantLines = narrative.split(/\\r?\\n/).filter(line => (
            line.includes(personName)
            && ((playerName && line.includes(playerName)) || /(?:你|user|玩家)/iu.test(line))
        ));
        if (relevantLines.some(line => completedContact.test(line) && !incompleteOrRejected.test(line))) {
            return { status: 'accepted', evidence: '正文已明确写成双方完成了联系方式交换' };
        }
    }
`,
    `    const narrative = text(recentNarrative, 18000);
    const completedContact = /(?:交换|互换|互留|留下|留了|给了|记下|存下|保存|添加|互加|加上|通过了?)(?:彼此|双方|对方|了|上|好|一下|一下子|的)?(?:联系方式|微信|qq|QQ|号码|手机号|电话|通讯号|联系人|好友)|(?:扫码|扫了码|扫二维码|扫描二维码|加了微信|加上微信|加了QQ|加上QQ|互加好友|互加微信|互加QQ|通讯录里(?:有|多了))/u;
    const notCompleted = /(?:还没|没有|没能|未能|尚未|并未|拒绝|婉拒|暂不|以后再|改天再|等.+再|如果.+(?:再|才)?|想(?:要)?|打算|准备|试图|询问|请求).{0,24}(?:交换|添加|互加|联系方式|微信|qq|QQ|号码|电话|好友)/u;
    if (personName && narrative.includes(personName)) {
        const segments = narrative
            .replace(/([。！？!?；;])/gu, '$1\\n')
            .split(/\\n+/u)
            .map(segment => segment.trim())
            .filter(Boolean);
        const personIndexes = segments
            .map((segment, index) => segment.includes(personName) ? index : -1)
            .filter(index => index >= 0);
        const contactIndexes = segments
            .map((segment, index) => completedContact.test(segment) && !notCompleted.test(segment) ? index : -1)
            .filter(index => index >= 0);
        const nearbyCompleted = contactIndexes.some(contactIndex => (
            personIndexes.some(personIndex => Math.abs(personIndex - contactIndex) <= 1)
        ));
        if (nearbyCompleted) {
            return { status: 'accepted', evidence: '正文已明确写成双方完成了联系方式交换' };
        }
    }
`,
    'completed contact evidence detector',
);

// 5) Make the social autonomy switch visible and memory status truthful.
ui = replaceOnce(
    ui,
    `                </div>
                <div class="wb-settings-common-hint">`,
    `                    <div class="wb-setting-toggle">
                        <div>
                            <strong>通讯自主活动</strong>
                            <span>关掉后，人物不会自己发消息、好友申请、删好友或发朋友圈；已有通讯录和你手动聊天仍然保留。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="socialAutoEnabled"
                                \${settings.socialAutoEnabled !== false ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                </div>
                <div class="wb-settings-common-hint">`,
    'visible social autonomy switch',
);

ui = replaceOnce(
    ui,
    `                    <span>\${historyRunning ? \`\${historyPercent}%\` : (Number(memory.pendingAssistantResponses || 0) > 0 ? '有新的东西等我收～' : '我已经跟上正文啦～')}</span>`,
    `                    <span>\${historyRunning
                        ? \`\${historyPercent}%\`
                        : Number(memory.pendingAssistantResponses || 0) > 0
                            ? '有新的东西等我收～'
                            : memory.summaryBehind
                                ? \`长期摘要还停在第 \${Math.max(0, Number(memory.latestSummaryMessageId || 0))} 层\`
                                : memory.pendingRollup
                                    ? '长期摘要还在等我压一层～'
                                    : '长期记忆已追平正文～'}</span>`,
    'truthful long-memory status',
);

fs.writeFileSync('index.js', index);
fs.writeFileSync('social-terminal.js', social);
fs.writeFileSync('ui.js', ui);

const test = `import test from 'node:test';
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

test('explicit completed contact in nearby prose becomes an accepted contact', () => {
    const result = reconcileSocialRelationships(emptySocialState(), stateFixture(), {
        userName: '玲',
        recentNarrative: '顾清把自己的二维码递给玲。两人扫码后交换了联系方式。',
    });
    assert.equal(result.connections.find(item => item.personId === 'p1')?.status, 'accepted');
});

test('future intent to exchange contacts is not treated as completed fact', () => {
    const result = reconcileSocialRelationships(emptySocialState(), stateFixture(), {
        userName: '玲',
        recentNarrative: '顾清说，如果以后有需要，可以再交换联系方式。',
    });
    assert.notEqual(result.connections.find(item => item.personId === 'p1')?.status, 'accepted');
});

test('swipe browsing, social pulse gating, autonomy switch and memory coverage stay wired', async () => {
    const [index, ui, social] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../social-terminal.js', import.meta.url), 'utf8'),
    ]);
    assert.match(index, /function recentNarrativeForSocial/);
    assert.doesNotMatch(index, /recentAssistantNarrativeForSocial/);
    const swipeStart = index.indexOf('function restoreExistingSwipe');
    const swipeEnd = index.indexOf('function markSnapshotsStaleFrom', swipeStart);
    const swipeBlock = index.slice(swipeStart, swipeEnd);
    assert.match(swipeBlock, /trigger: 'swipe-selected'/);
    assert.doesNotMatch(swipeBlock, /scheduleAutoSync\(Number\(messageId\), 'swipe'\)/);
    assert.match(index, /function socialPulseRelationSignature/);
    assert.match(index, /currentWorldMinute - lastPulseWorldMinute >= 60/);
    assert.match(social, /lastPulseWorldMinute: -1/);
    assert.match(social, /lastPulseRelationSignature: ''/);
    assert.match(ui, /data-wb-setting="socialAutoEnabled"/);
    assert.match(ui, /memory\.summaryBehind/);
    assert.match(ui, /长期记忆已追平正文/);
});
`;
fs.writeFileSync('tests/social-memory-swipe.test.mjs', test);
console.log('Applied social relationship, swipe batching, memory status and social pulse fixes.');
