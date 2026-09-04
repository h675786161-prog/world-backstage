import assert from 'node:assert/strict';
import test from 'node:test';
import {
    branchRecordMatchesSource,
    committedBranchMatchesSource,
    readBranchRecord,
} from '../branch-history.js';

const KEY = 'world_backstage';

test('per-swipe metadata never falls back to another swipe message.extra snapshot', () => {
    const selected = { sourceKey: '10:0:a', status: 'committed', result: { state: { branch: 'A' } } };
    const message = {
        swipe_id: 0,
        extra: { [KEY]: selected },
        swipe_info: [
            { extra: { [KEY]: selected } },
            { extra: {} },
        ],
    };

    assert.equal(readBranchRecord(message, 0, KEY), selected);
    assert.equal(readBranchRecord(message, 1, KEY), null);
});

test('legacy message.extra is accepted only for the selected swipe', () => {
    const selected = { sourceKey: '4:1:b', status: 'committed', result: { state: { branch: 'legacy' } } };
    const message = {
        swipe_id: 1,
        extra: { [KEY]: selected },
    };

    assert.equal(readBranchRecord(message, 1, KEY), selected);
    assert.equal(readBranchRecord(message, 0, KEY), null);
});

test('branch identity rejects stale or text-mismatched committed snapshots', () => {
    const record = {
        sourceKey: '8:1:hash-before-edit',
        status: 'committed',
        result: { state: { clock: { absoluteMinute: 100 } } },
        stale: false,
    };

    assert.equal(branchRecordMatchesSource(record, '8:1:hash-before-edit'), true);
    assert.equal(committedBranchMatchesSource(record, '8:1:hash-before-edit'), true);
    assert.equal(committedBranchMatchesSource(record, '8:1:hash-after-edit'), false);
    assert.equal(committedBranchMatchesSource({ ...record, stale: true }, record.sourceKey), false);
    assert.equal(committedBranchMatchesSource({ ...record, result: null }, record.sourceKey), false);
});
