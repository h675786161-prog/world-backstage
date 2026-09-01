import assert from 'node:assert/strict';
import test from 'node:test';

import {
    branchSurfaceHistoryStats,
    captureBranchSurface,
    ensureBranchSurfaceHistory,
    hasBranchSurface,
    inheritBranchSurface,
    pruneBranchSurfaceHistory,
    rebindBranchSurface,
    restoreBranchSurface,
} from '../branch-surface-history.js';

function social(label, imageUrl = '') {
    return {
        version: 5,
        connections: [{ id: `friend-${label}`, status: 'accepted' }],
        conversations: [{ id: `chat-${label}`, messages: [{ id: `m-${label}`, content: label }] }],
        moments: [{ id: `moment-${label}`, text: label, createdAt: `time-${label}`, imageUrl }],
        notices: [{ id: `notice-${label}`, text: label }],
        imageSettings: { provider: `provider-${label}`, apiKey: `secret-${label}` },
        ui: { section: `section-${label}` },
    };
}

function opinion(label) {
    return {
        revision: label,
        news: [{ id: `news-${label}`, headline: label }],
        forums: [{ id: `forum-${label}`, title: label }],
    };
}

function store() {
    return {
        currentState: { lastCommit: { sourceKey: 'root' } },
        social: social('root'),
        publicOpinion: opinion('root'),
    };
}

test('branch surface history isolates A/B social and public opinion', () => {
    const value = store();
    captureBranchSurface(value, 'A');

    value.social = social('B');
    value.publicOpinion = opinion('B');
    captureBranchSurface(value, 'B');

    assert.equal(restoreBranchSurface(value, 'A'), true);
    assert.equal(value.social.connections[0].id, 'friend-root');
    assert.equal(value.publicOpinion.news[0].id, 'news-root');

    assert.equal(restoreBranchSurface(value, 'B'), true);
    assert.equal(value.social.connections[0].id, 'friend-B');
    assert.equal(value.publicOpinion.news[0].id, 'news-B');
});

test('presentation settings stay global while diegetic social state rolls back', () => {
    const value = store();
    captureBranchSurface(value, 'A');

    value.social = social('B');
    value.social.imageSettings = { provider: 'GLOBAL', apiKey: 'GLOBAL-KEY' };
    value.social.ui = { section: 'GLOBAL-UI' };
    value.publicOpinion = opinion('B');
    captureBranchSurface(value, 'B');

    restoreBranchSurface(value, 'A');
    assert.equal(value.social.connections[0].id, 'friend-root');
    assert.deepEqual(value.social.imageSettings, { provider: 'GLOBAL', apiKey: 'GLOBAL-KEY' });
    assert.deepEqual(value.social.ui, { section: 'GLOBAL-UI' });
});

test('generated moment images are not duplicated into persistent branch blobs', () => {
    const value = store();
    value.social = social('A', `data:image/png;base64,${'x'.repeat(20_000)}`);
    captureBranchSurface(value, 'A');

    const history = ensureBranchSurfaceHistory(value);
    const ref = history.refs.A;
    const archived = history.blobs.social[ref.social];
    assert.equal(archived.moments[0].imageUrl, '');
    assert.equal(JSON.stringify(archived).includes('data:image/png'), false);

    value.social = social('B');
    restoreBranchSurface(value, 'A');
    assert.match(value.social.moments[0].imageUrl, /^data:image\/png;base64,/);
});

test('moment image cache uses full moment identity rather than bare id', () => {
    const value = store();
    value.social = social('A', 'data:image/png;base64,AAAA');
    value.social.moments[0].id = 'shared-id';
    captureBranchSurface(value, 'A');

    value.social = social('B', 'data:image/png;base64,BBBB');
    value.social.moments[0].id = 'shared-id';
    captureBranchSurface(value, 'B');

    restoreBranchSurface(value, 'A');
    assert.equal(value.social.moments[0].imageUrl, 'data:image/png;base64,AAAA');
    restoreBranchSurface(value, 'B');
    assert.equal(value.social.moments[0].imageUrl, 'data:image/png;base64,BBBB');
});

test('unchanged surfaces dedupe across many branch refs', () => {
    const value = store();
    for (let index = 0; index < 80; index += 1) {
        captureBranchSurface(value, `branch-${index}`);
    }
    const stats = branchSurfaceHistoryStats(value);
    assert.equal(stats.refs, 80);
    assert.equal(stats.socialBlobs, 1);
    assert.equal(stats.publicOpinionBlobs, 1);
});

test('overwriting one branch surface garbage collects its superseded blobs', () => {
    const value = store();
    for (let index = 0; index < 60; index += 1) {
        value.social = social(`rolling-${index}`);
        value.publicOpinion = opinion(`rolling-${index}`);
        captureBranchSurface(value, 'same-branch');
    }
    const stats = branchSurfaceHistoryStats(value);
    assert.equal(stats.refs, 1);
    assert.equal(stats.socialBlobs, 1);
    assert.equal(stats.publicOpinionBlobs, 1);
});

test('new branch can inherit parent surface without cloning another blob', () => {
    const value = store();
    captureBranchSurface(value, 'parent');
    const before = branchSurfaceHistoryStats(value);
    assert.equal(inheritBranchSurface(value, 'child', 'parent'), true);
    assert.equal(hasBranchSurface(value, 'child'), true);
    const after = branchSurfaceHistoryStats(value);
    assert.equal(after.socialBlobs, before.socialBlobs);
    assert.equal(after.publicOpinionBlobs, before.publicOpinionBlobs);

    value.social = social('other');
    value.publicOpinion = opinion('other');
    restoreBranchSurface(value, 'child');
    assert.equal(value.social.connections[0].id, 'friend-root');
    assert.equal(value.publicOpinion.news[0].id, 'news-root');
});

test('edited text can rebind the old branch surface to a new source key', () => {
    const value = store();
    captureBranchSurface(value, 'old-source');
    assert.equal(rebindBranchSurface(value, 'old-source', 'edited-source'), true);

    value.social = social('other');
    value.publicOpinion = opinion('other');
    assert.equal(restoreBranchSurface(value, 'edited-source'), true);
    assert.equal(value.social.connections[0].id, 'friend-root');
    assert.equal(value.publicOpinion.news[0].id, 'news-root');
});

test('pruning dead branch refs also garbage collects their payload blobs', () => {
    const value = store();
    for (const key of ['A', 'B', 'C']) {
        value.social = social(key);
        value.publicOpinion = opinion(key);
        captureBranchSurface(value, key);
    }
    assert.equal(pruneBranchSurfaceHistory(value, ['A']), true);
    const history = ensureBranchSurfaceHistory(value);
    assert.deepEqual(Object.keys(history.refs), ['A']);
    const stats = branchSurfaceHistoryStats(value);
    assert.equal(stats.socialBlobs, 1);
    assert.equal(stats.publicOpinionBlobs, 1);
});

test('missing legacy branch uses a safe fallback instead of borrowing current branch state', () => {
    const value = store();
    value.social = social('A');
    value.publicOpinion = opinion('A');

    const fallbackSocial = social('EMPTY');
    const fallbackOpinion = opinion('EMPTY');
    const found = restoreBranchSurface(value, 'legacy-B', {
        fallbackSocial,
        fallbackPublicOpinion: fallbackOpinion,
    });
    assert.equal(found, false);
    assert.equal(value.social.connections[0].id, 'friend-EMPTY');
    assert.equal(value.publicOpinion.news[0].id, 'news-EMPTY');
    assert.equal(hasBranchSurface(value, 'legacy-B'), true);
});
