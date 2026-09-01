import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHistoryArchaeologyPrompt,
    mergeChronologicalHistoryArtifacts,
    planHistoryArchaeologyWindows,
    runHistoryArchaeologyPool,
} from '../history-parallel-lab.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function sampleMessages(turns = 10) {
    const messages = [];
    for (let turn = 0; turn < turns; turn += 1) {
        messages.push({ id: turn * 2, role: 'user', content: `用户第${turn}轮` });
        messages.push({ id: turn * 2 + 1, role: 'assistant', content: `正文第${turn}轮：人物继续行动。` });
    }
    return messages;
}

test('parallel lab planner uses bounded overlap instead of splitting history blind at borders', () => {
    const windows = planHistoryArchaeologyWindows(sampleMessages(10), {
        assistantTurnsPerWindow: 4,
        overlapAssistantTurns: 1,
        maximumCharacters: 20000,
    });
    assert.ok(windows.length >= 3);
    assert.equal(windows[0].assistantTurns, 4);
    assert.ok(windows[1].startMessageId <= windows[0].endMessageId);
    assert.ok(windows.every(window => window.assistantTurns <= 4));
    assert.ok(windows.every(window => window.messages.length > 0));
});

test('parallel lab pool really runs two extraction slots while returning chronological result order', async () => {
    const windows = Array.from({ length: 6 }, (_, index) => ({
        index,
        id: `w${index}`,
        startMessageId: index * 10,
        endMessageId: index * 10 + 9,
        messages: [],
    }));
    const completionOrder = [];
    const started = Date.now();
    const run = await runHistoryArchaeologyPool(windows, {
        concurrency: 2,
        extract: async (window, { slot }) => {
            await sleep(window.index % 2 === 0 ? 55 : 35);
            completionOrder.push(window.index);
            return {
                turn_summaries: [{ source_message_id: window.startMessageId + 1, summary: `slot-${slot}` }],
            };
        },
    });
    const elapsed = Date.now() - started;

    assert.equal(run.maxActive, 2);
    assert.equal(run.completed, 6);
    assert.deepEqual(run.results.map(item => item.window.index), [0, 1, 2, 3, 4, 5]);
    assert.notDeepEqual(completionOrder, [0, 1, 2, 3, 4, 5]);
    // Serial latency is 270ms for these synthetic tasks. Keep the threshold loose
    // enough for CI jitter while still proving bounded overlap is materially active.
    assert.ok(elapsed < 245, `expected bounded parallel run under 245ms, got ${elapsed}ms`);
});

test('parallel lab failure is atomic from the caller perspective and aborts remaining workers', async () => {
    const windows = Array.from({ length: 8 }, (_, index) => ({ index, id: `w${index}`, startMessageId: index, endMessageId: index }));
    const completed = [];

    await assert.rejects(
        runHistoryArchaeologyPool(windows, {
            concurrency: 2,
            extract: async window => {
                if (window.index === 2) {
                    await sleep(10);
                    throw new Error('synthetic invalid JSON');
                }
                await sleep(35);
                completed.push(window.index);
                return { turn_summaries: [] };
            },
        }),
        /synthetic invalid JSON/,
    );

    assert.ok(completed.length < windows.length, 'remaining windows should not all continue after a failure');
});

test('parallel lab overlap merge removes duplicate source artifacts and restores chronological order', () => {
    const merged = mergeChronologicalHistoryArtifacts([
        {
            window: { index: 1, startMessageId: 10 },
            payload: {
                turn_summaries: [
                    { source_message_id: 11, summary: '重复边界摘要' },
                    { source_message_id: 15, summary: '后段摘要' },
                ],
                facts_upsert: [{
                    key: 'item:key:material',
                    subject: '钥匙',
                    predicate: '材质',
                    value: '铜制',
                    source_message_id: 15,
                }],
            },
        },
        {
            window: { index: 0, startMessageId: 0 },
            payload: {
                turn_summaries: [
                    { source_message_id: 3, summary: '前段摘要' },
                    { source_message_id: 11, summary: '重复边界摘要（另一窗口措辞可能不同）' },
                ],
                facts_upsert: [{
                    key: 'item:key:material',
                    subject: '钥匙',
                    predicate: '材质',
                    value: '红色塑料',
                    source_message_id: 7,
                }],
            },
        },
    ]);

    assert.deepEqual(merged.turn_summaries.map(item => item.source_message_id), [3, 11, 15]);
    assert.deepEqual(merged.facts_upsert.map(item => item.source_message_id), [7, 15]);
    assert.equal(merged.turn_summaries.filter(item => item.source_message_id === 11).length, 1);
});

test('parallel archaeology prompt is source-only and refuses direct current-world writes', () => {
    const window = planHistoryArchaeologyWindows(sampleMessages(2), {
        assistantTurnsPerWindow: 2,
        overlapAssistantTurns: 0,
    })[0];
    const prompt = buildHistoryArchaeologyPrompt(window, {
        userName: '玩家',
        playerIdentityAnchor: '女性，使用她。',
    });

    assert.match(prompt, /这里只做证据提取/);
    assert.match(prompt, /随后由代码按 source_message_id 排序并串行重建/);
    assert.match(prompt, /event_fragments/);
    assert.match(prompt, /person_observations/);
    assert.doesNotMatch(prompt, /截至上一批已经建立的世界/);
    assert.match(prompt, /不输出 .*events_update/);
    assert.doesNotMatch(prompt, /"events_update"\s*:/);
});
