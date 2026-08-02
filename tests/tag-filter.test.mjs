import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countSurvivingNewAssistantTurns,
    filterNarrativeText,
    normalizeTagFilterRules,
    selectPendingAssistantMessageIds,
} from '../core.js';

const enabled = (rules) => ({ tagFilterEnabled: true, tagFilterRules: rules });

test('始终删除跨行 HTML 注释', () => {
    const text = '前<!--\n草稿\n-->后';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), '前后');
});

test('未闭合注释保持不变', () => {
    const text = '前<!--草稿后';
    assert.equal(filterNarrativeText(text, { tagFilterEnabled: false, tagFilterRules: [] }), text);
});

test('成对规则删除整块', () => {
    const text = 'A<options>选1</options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        'AB',
    );
});

test('严格字面不匹配带属性开头', () => {
    const text = 'A<options type="x">选1</options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('区分大小写', () => {
    const text = 'A<Options>x</Options>B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('仅结尾：删除结尾及之前全部，并反复削剪', () => {
    const text = 'aaa</x>bbb</x>ccc';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '', close: '</x>' }])),
        'ccc',
    );
});

test('仅开头：从开头删到文末', () => {
    const text = '保留<tail>后面全删';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<tail>', close: '' }])),
        '保留',
    );
});

test('关闭用户规则时仍删注释', () => {
    const text = 'A<!--c-->B<options>x</options>C';
    assert.equal(
        filterNarrativeText(text, {
            tagFilterEnabled: false,
            tagFilterRules: [{ open: '<options>', close: '</options>' }],
        }),
        'AB<options>x</options>C',
    );
});

test('多规则按顺序应用', () => {
    const text = '1<think>t</think>2<options>o</options>3';
    assert.equal(
        filterNarrativeText(text, enabled([
            { open: '<think>', close: '</think>' },
            { open: '<options>', close: '</options>' },
        ])),
        '123',
    );
});

test('成对找不到 close 时不误删到文末', () => {
    const text = 'A<options>没有结尾B';
    assert.equal(
        filterNarrativeText(text, enabled([{ open: '<options>', close: '</options>' }])),
        text,
    );
});

test('normalizeTagFilterRules 丢弃双空并截断', () => {
    const rules = normalizeTagFilterRules([
        { open: '', close: '' },
        { open: ` <${'a'.repeat(100)}> `, close: '</a>' },
    ]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].open.length, 80);
    assert.equal(rules[0].close, '</a>');
});

test('先过滤再截断：闭合标签在截断点之后仍会被完整删除', () => {
    const open = '<options>';
    const close = '</options>';
    const inner = 'x'.repeat(50);
    const full = `KEEP${open}${inner}${close}TAIL`;
    const filtered = filterNarrativeText(full, enabled([{ open, close }]));
    assert.equal(filtered, 'KEEPTAIL');
    assert.equal(filtered.slice(0, 20), 'KEEPTAIL');
});

// Regression: pending batch must be selected by raw chat message ids ending at
// messageId. narrativeContext drops empty-after-filter turns, so slicing the
// last N assistants from narrative.turns can incorrectly treat an older
// committed assistant as "new" and skip the empty short-circuit.
test('selectPendingAssistantMessageIds 按原文可用性取最近 N 条 assistant id', () => {
    const chat = [
        { is_user: true, mes: 'u0' },
        { is_user: false, mes: 'old committed' }, // id 1
        { is_user: true, mes: 'u1' },
        { is_user: false, mes: '<!--only comment-->' }, // id 3, usable raw, empty after filter
        { is_user: true, mes: 'u2' },
        { is_user: false, mes: '<options>x</options>' }, // id 5, usable raw, empty after filter
    ];
    const isUsable = (message) => Boolean(
        message && !message.is_user && !message.is_system && String(message.mes || '').trim(),
    );
    assert.deepEqual(
        selectPendingAssistantMessageIds(chat, 5, 2, isUsable),
        [3, 5],
    );
    assert.deepEqual(
        selectPendingAssistantMessageIds(chat, 5, 1, isUsable),
        [5],
    );
});

test('countSurvivingNewAssistantTurns 只计仍留在 narrative 中的 pending id', () => {
    // After filter, pending ids 3 and 5 are empty and absent from narrative.turns;
    // only older assistant id 1 remains. Surviving pending count must be 0 so the
    // runner short-circuits instead of marking id 1 as new="true".
    const narrativeTurns = [
        { role: 'user', messageId: 0, content: 'u0' },
        { role: 'assistant', messageId: 1, content: 'old committed' },
        { role: 'user', messageId: 2, content: 'u1' },
        { role: 'user', messageId: 4, content: 'u2' },
    ];
    const pendingIds = [3, 5];
    assert.equal(countSurvivingNewAssistantTurns(narrativeTurns, pendingIds), 0);

    const withSurvivor = [
        ...narrativeTurns,
        { role: 'assistant', messageId: 5, content: 'kept body' },
    ];
    assert.equal(countSurvivingNewAssistantTurns(withSurvivor, pendingIds), 1);
    assert.equal(countSurvivingNewAssistantTurns(withSurvivor, [1, 5]), 2);
});

test('多轮 pending 全部滤空时不应把更早 assistant 当成 new', () => {
    const rules = enabled([{ open: '<options>', close: '</options>' }]);
    const chat = [
        { is_user: false, mes: 'already committed scene' },
        { is_user: true, mes: 'go' },
        { is_user: false, mes: '<options>menu only</options>' },
        { is_user: true, mes: 'again' },
        { is_user: false, mes: '<!--draft-->' },
    ];
    const isUsable = (message) => Boolean(
        message && !message.is_user && !message.is_system && String(message.mes || '').trim(),
    );
    const pendingIds = selectPendingAssistantMessageIds(chat, 4, 2, isUsable);
    assert.deepEqual(pendingIds, [2, 4]);

    const pendingFiltered = pendingIds.map(
        id => filterNarrativeText(chat[id].mes, rules).trim(),
    );
    assert.ok(!pendingFiltered.some(Boolean), 'pending batch filters to empty');

    // Mimic narrativeContext dropping empty assistant turns:
    const narrativeTurns = [
        { role: 'assistant', messageId: 0, content: 'already committed scene' },
        { role: 'user', messageId: 1, content: 'go' },
        { role: 'user', messageId: 3, content: 'again' },
    ];
    // Buggy path would slice(-2) assistants from narrative and see [committed],
    // skipping short-circuit. Correct path counts surviving pending ids → 0.
    assert.equal(countSurvivingNewAssistantTurns(narrativeTurns, pendingIds), 0);
    const buggySlice = narrativeTurns
        .filter(turn => turn.role === 'assistant')
        .slice(-2)
        .map(turn => turn.content);
    assert.equal(buggySlice.length, 1, 'documents the old buggy non-empty slice');
    assert.ok(buggySlice[0].trim(), 'old path wrongly saw older assistant text');
});
