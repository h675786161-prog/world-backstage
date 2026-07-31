import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySimulationResult,
    createInitialState,
    hasExplicitTimeEvidence,
    trimState,
} from '../core.js';

test('ambiguous Chinese wording does not count as explicit elapsed time', () => {
    assert.equal(hasExplicitTimeEvidence('洞内十分安静，只能听见水滴声。'), false);
});

test('cautious time policy caps unsupported elapsed time', () => {
    const base = createInitialState({ day: 1, hour: 8, minute: 0 });
    const result = applySimulationResult(
        base,
        { elapsed_minutes: 480 },
        { timePolicy: 'cautious', narrativeText: '许久以后，雨声仍未停。' },
    );

    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute + 180);
});

test('legacy people records receive new defaults during migration', () => {
    const oldState = createInitialState();
    oldState.people = [
        {
            id: 'old-person',
            name: '旧人物',
            location: '旧地点',
            status: '等待',
            intent: '继续观察',
            lastSeen: '刚刚',
            innerVoice: '先等等。',
        },
    ];

    const migrated = trimState(oldState);
    assert.equal(migrated.people[0].longTermGoal, '');
    assert.equal(migrated.people[0].isUser, false);
});
