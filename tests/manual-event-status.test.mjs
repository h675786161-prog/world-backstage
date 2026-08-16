import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    addManualEvent,
    applySimulationResult,
    createInitialState,
} from '../core.js';

function terminalEventState() {
    const state = addManualEvent(createInitialState(), {
        id: 'finished-current',
        title: '已经结束的暗流',
        summary: '这件事已经客观结束。',
        visibility: 'known',
    });
    const event = state.events.find(item => item.id === 'finished-current');
    event.status = 'resolved';
    event.result = '事情已经办完。';
    event.resolvedAt = state.clock.absoluteMinute;
    return state;
}

test('routine simulation cannot resurrect or rewrite a terminal event through events_update', () => {
    for (const incomingStatus of ['active', 'cancelled']) {
        const state = terminalEventState();
        const next = applySimulationResult(state, {
            elapsed_minutes: 0,
            events_update: [{
                id: 'finished-current',
                status: incomingStatus,
                summary: '模型又对旧事件作了推断。',
                result: '模型新猜的结果。',
            }],
        }, {
            timePolicy: 'world',
            narrativeText: '',
        });
        const event = next.events.find(item => item.id === 'finished-current');
        assert.equal(event.status, 'resolved');
        assert.equal(event.result, '事情已经办完。');
        assert.equal(event.resolvedAt, state.events[0].resolvedAt);
    }
});

test('events_create cannot overwrite an existing terminal event with a recycled model event', () => {
    for (const incomingStatus of ['active', 'cancelled']) {
        const state = terminalEventState();
        const next = applySimulationResult(state, {
            elapsed_minutes: 0,
            events_create: [{
                id: 'finished-current',
                title: '已经结束的暗流',
                summary: '模型把旧事件当新事件重新创建。',
                status: incomingStatus,
                result: '模型新猜的结果。',
            }],
        }, {
            timePolicy: 'world',
            narrativeText: '',
        });
        const event = next.events.find(item => item.id === 'finished-current');
        assert.equal(event.status, 'resolved');
        assert.equal(event.result, '事情已经办完。');
        assert.equal(event.resolvedAt, state.events[0].resolvedAt);
    }
});

test('event editor exposes explicit status/result correction and manual update persists terminal fields', async () => {
    const [ui, index] = await Promise.all([
        readFile(new URL('../ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
    ]);
    assert.match(ui, /name="status"/);
    assert.match(ui, /value="resolved"/);
    assert.match(ui, /name="result"/);
    assert.match(ui, /手动状态是当前世界事实/);
    assert.match(index, /const requestedStatus = \['active', 'waiting', 'ready', 'resolved', 'cancelled', 'missed'\]/);
    assert.match(index, /event\.status = requestedStatus/);
    assert.match(index, /event\.resolvedAt = previousWasTerminal/);
});
