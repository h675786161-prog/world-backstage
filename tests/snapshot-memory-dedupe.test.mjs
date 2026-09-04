import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compactSnapshotMemoryLedgers,
    memoryLedgerStats,
} from '../snapshot-memory-dedupe.js';

function makeSnapshot(revision, endMessageId) {
    return {
        schemaVersion: 25,
        meta: { compactMemory: true, memorySummaryCutoffMessageId: endMessageId },
        state: {
            revision,
            storyMemory: {
                indexedThroughMessageId: endMessageId,
                indexedAt: '2026-08-30T00:00:00.000Z',
                digest: {
                    text: '共同的长期记忆摘要',
                    throughMessageId: endMessageId,
                    people: ['阿青'],
                    tags: ['约定'],
                },
                facts: [{
                    id: 'promise',
                    key: 'person:a:promise',
                    subject: '阿青',
                    predicate: '承诺',
                    value: '事实正文只应在中央档案保存一次',
                    status: 'active',
                    importance: 3,
                }],
                clues: [{
                    id: 'red-thread',
                    title: '红线',
                    text: '线索正文只应在中央档案保存一次',
                    status: 'developing',
                }],
                summaries: [{
                    id: `summary-${endMessageId}`,
                    summary: `第 ${endMessageId} 轮摘要`,
                    endMessageId,
                }],
                metabolismLog: [{
                    id: 'metabolism-1',
                    kind: 'memory',
                    action: 'updated',
                    targetId: 'promise',
                }],
            },
        },
    };
}

function count(text, needle) {
    return text.split(needle).length - 1;
}

test('repeated snapshot memory bodies are interned once while snapshots keep exact refs', () => {
    const first = makeSnapshot(1, 10);
    const second = makeSnapshot(2, 20);
    // Keep digest content exactly equal as well so every repeated ledger body can dedupe.
    second.state.storyMemory.digest.throughMessageId = 10;

    const store = {
        branchOverrides: {
            first,
            second,
        },
    };
    const changed = compactSnapshotMemoryLedgers(store, [], 'world_backstage');
    assert.equal(changed, true);

    const stats = memoryLedgerStats(store);
    assert.deepEqual(stats, {
        items: 4,
        facts: 1,
        clues: 1,
        digests: 1,
        metabolism: 1,
    });

    assert.equal(first.state.storyMemory.facts[0].value, '事实正文只应在中央档案保存一次');
    assert.equal(second.state.storyMemory.clues[0].text, '线索正文只应在中央档案保存一次');

    const serialized = JSON.stringify({ store });
    assert.equal(count(serialized, '事实正文只应在中央档案保存一次'), 1);
    assert.equal(count(serialized, '线索正文只应在中央档案保存一次'), 1);
    assert.equal(serialized.includes('"_ledgerRefs"'), true);
});

test('structuredClone sees hydrated memory even though JSON storage only keeps refs', () => {
    const snapshot = makeSnapshot(3, 30);
    const store = { branchOverrides: { snapshot } };
    compactSnapshotMemoryLedgers(store, [], 'world_backstage');

    const clonedState = structuredClone(snapshot.state);
    assert.equal(clonedState.storyMemory.facts[0].id, 'promise');
    assert.equal(clonedState.storyMemory.clues[0].id, 'red-thread');
    assert.equal(clonedState.storyMemory.digest.text, '共同的长期记忆摘要');

    const serializedSnapshot = JSON.stringify(snapshot);
    assert.equal(serializedSnapshot.includes('事实正文只应在中央档案保存一次'), false);
    assert.equal(serializedSnapshot.includes('线索正文只应在中央档案保存一次'), false);
});

test('persisted compact snapshots reinstall accessors on reload without losing history', () => {
    const snapshot = makeSnapshot(4, 40);
    const store = { branchOverrides: { snapshot } };
    compactSnapshotMemoryLedgers(store, [], 'world_backstage');

    const persisted = JSON.parse(JSON.stringify({ store }));
    const reloadedStore = persisted.store;
    const changed = compactSnapshotMemoryLedgers(reloadedStore, [], 'world_backstage');
    assert.equal(changed, false);

    const restored = reloadedStore.branchOverrides.snapshot.state.storyMemory;
    assert.equal(restored.facts[0].value, '事实正文只应在中央档案保存一次');
    assert.equal(restored.clues[0].text, '线索正文只应在中央档案保存一次');
    assert.equal(restored.metabolismLog[0].targetId, 'promise');

    const detached = restored.facts;
    detached[0].value = '试图污染历史档案';
    assert.equal(restored.facts[0].value, '事实正文只应在中央档案保存一次');
});

test('message swipe snapshots and their pending bases are compacted too', () => {
    const result = makeSnapshot(5, 50);
    const base = makeSnapshot(4, 49);
    const store = { branchOverrides: {} };
    const chat = [{
        is_user: false,
        is_system: false,
        swipe_id: 0,
        swipe_info: [{
            extra: {
                world_backstage: {
                    status: 'committed',
                    base,
                    result,
                },
            },
        }],
    }];

    assert.equal(compactSnapshotMemoryLedgers(store, chat, 'world_backstage'), true);
    const data = chat[0].swipe_info[0].extra.world_backstage;
    assert.equal(data.base.state.storyMemory.facts[0].id, 'promise');
    assert.equal(data.result.state.storyMemory.clues[0].id, 'red-thread');
    assert.equal(JSON.stringify(data).includes('事实正文只应在中央档案保存一次'), false);
});
