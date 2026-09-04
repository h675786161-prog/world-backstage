import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    buildInjectionPackage,
    buildSimulationPrompt,
    createInitialState,
    normalizeEvent,
} from '../core.js';

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../ui.js', import.meta.url), 'utf8');

test('individual people selection reaches its change handler without undefined click variables', () => {
    const changeHandler = uiSource.slice(
        uiSource.indexOf("root.addEventListener('change'"),
        uiSource.indexOf("root.addEventListener('input'"),
    );
    const personSelection = changeHandler.indexOf("[data-wb-person-select]");
    assert.ok(personSelection > 0);
    assert.doesNotMatch(changeHandler.slice(0, personSelection), /if \(action === 'test-image-api'\)/);
    assert.doesNotMatch(changeHandler.slice(0, personSelection), /const form = target\.closest/);
});

test('person observation reveal is a soft cue rather than a completed event', () => {
    const state = createInitialState({ worldName: '测试世界' });
    state.events.push(normalizeEvent({
        id: 'event_observation',
        title: '甲的镜头外片段',
        summary: '甲其实仍在犹豫，但没有把这件事说出口。',
        status: 'ready',
        clock_mode: 'condition',
        visibility: 'trace',
        delivery_queued: true,
        delivery_mode: 'soft-observation',
        delivery_route: '柔性线索',
    }, state.clock.absoluteMinute));

    const packet = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: true,
        injectionEchoes: true,
        injectionEvents: false,
        injectionFacts: false,
        injectionPeople: false,
        injectionMemory: false,
        injectionWorldBackground: false,
        injectionTimeMode: 'off',
    });

    assert.match(packet.supportText, /仅作可选理解线索，不是已经发生的事件/);
    assert.match(packet.supportText, /不得逐句照搬独白/);
    assert.doesNotMatch(packet.supportText, /用户要求下一轮优先显露/);
});

test('observation reveal state can recover from an active persisted event after cache-key changes', () => {
    assert.match(indexSource, /const activeFallback = Object\.values\(store\.personObservations \|\| \{\}\)/);
    assert.match(indexSource, /state\.events\.some\(event => event\.id === item\.queuedEventId\)/);
    assert.match(indexSource, /delivery_mode: 'soft-observation'/);
    assert.doesNotMatch(indexSource, /expected_result: observation\.text/);
    assert.doesNotMatch(indexSource, /consequence: observation\.text/);
});

test('world simulation asks for bounded deltas and switches to a compact retry contract', () => {
    const prompt = buildSimulationPrompt(createInitialState({ worldName: '测试世界' }));
    assert.match(prompt, /返回值必须是增量状态，不是完整世界副本/);
    assert.match(prompt, /禁止复述推演前权威状态/);
    assert.match(indexSource, /function retrySimulationPrompt/);
    assert.match(indexSource, /精简增量 JSON/);
    assert.match(indexSource, /backgroundSimulation\(retrySimulationPrompt\(prompt, attempt\)/);
});

test('diagnostic token estimates count CJK characters conservatively', () => {
    assert.match(indexSource, /const cjkCharacters/);
    assert.match(indexSource, /cjkCharacters \+ remainingCharacters \/ 4/);
});
