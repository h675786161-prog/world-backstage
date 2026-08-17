import test from 'node:test';
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
    assert.doesNotMatch(index.slice(swipeStart, swipeEnd), /scheduleAutoSync(Number(messageId), 'swipe')/);
    assert.match(index, /function socialPulseRelationSignature/);
    assert.match(index, /currentWorldMinute - lastPulseWorldMinute >= 60/);
    assert.match(social, /lastPulseWorldMinute: -1/);
    assert.match(social, /lastPulseRelationSignature: ''/);
    assert.match(ui, /data-wb-setting="socialAutoEnabled"/);
    assert.match(ui, /memory.summaryBehind/);
    assert.match(ui, /长期记忆已追平正文/);
});
