import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adaptObservationGenerateRawOptions,
    buildObservationSceneOverlapInstruction,
    classifyObservationSceneOverlap,
} from '../observation-scene-overlap.js';

function fixture({ personLocation, userLocation, personAction = '', userAction = '' }) {
    const state = {
        people: [
            {
                id: 'user-ling',
                name: '玲',
                isUser: true,
                location: userLocation,
                action: userAction,
            },
            {
                id: 'aqing',
                name: '阿青',
                isUser: false,
                location: personLocation,
                action: personAction,
            },
        ],
    };
    const store = { currentState: state };
    return { state, store, player: state.people[0], person: state.people[1] };
}

function observationPrompt() {
    return [
        '你是“世界背面”的人物即时观测器。',
        '本次唯一观测主体是“阿青”。',
        '场景关系约束（只作一致性边界，不是角色知识）：' + JSON.stringify({
            kind: 'same_place',
            personId: 'aqing',
            personLocation: '东港咖啡店',
            userId: 'user-ling',
            userLocation: '东港咖啡店',
        }),
    ].join('\n');
}

test('same broad venue stays same_place and does not become perception', () => {
    const { state, person, player } = fixture({
        personLocation: '东港咖啡店',
        userLocation: '东港咖啡店',
    });
    const relation = classifyObservationSceneOverlap(state, person, player);
    assert.equal(relation.kind, 'same_place');
    assert.equal(relation.perceivedBy, 'none');
});

test('same concrete room becomes same_scene but still not automatic perception', () => {
    const { state, person, player } = fixture({
        personLocation: '公寓客厅',
        userLocation: '公寓客厅',
    });
    const relation = classifyObservationSceneOverlap(state, person, player);
    assert.equal(relation.kind, 'same_scene');
    assert.equal(relation.perceivedBy, 'none');
});

test('authoritative current action can prove perception without reading observation prose', () => {
    const { state, person, player } = fixture({
        personLocation: '东港咖啡店',
        userLocation: '东港咖啡店',
        personAction: '阿青抬头看见玲站在柜台边，正准备回应她。',
    });
    const relation = classifyObservationSceneOverlap(state, person, player);
    assert.equal(relation.kind, 'perceived');
    assert.equal(relation.perceivedBy, 'person');
});

test('contained locations stay same_area and never upgrade to same scene', () => {
    const { state, person, player } = fixture({
        personLocation: '东港咖啡店二楼',
        userLocation: '东港咖啡店',
    });
    const relation = classifyObservationSceneOverlap(state, person, player);
    assert.equal(relation.kind, 'same_area');
});

test('scene instruction explicitly forbids observation text from becoming canon', () => {
    const { store } = fixture({
        personLocation: '公寓客厅',
        userLocation: '公寓客厅',
    });
    const instruction = buildObservationSceneOverlapInstruction(store, observationPrompt());
    assert.match(instruction, /权威世界状态 → 观测/);
    assert.match(instruction, /严禁反向使用观测文本修改、补全或升级世界事实/);
    assert.match(instruction, /same_scene/);
    assert.match(instruction, /不自动授予感知/);
});

test('generateRaw observation prompt gets current authoritative overlap guard only for observation tasks', () => {
    const { store } = fixture({
        personLocation: '公寓客厅',
        userLocation: '公寓客厅',
    });
    const context = {
        chatMetadata: {
            world_backstage_v1: store,
        },
    };
    const adapted = adaptObservationGenerateRawOptions({ prompt: observationPrompt() }, context);
    assert.notEqual(adapted.prompt, observationPrompt());
    assert.match(adapted.prompt, /world_backstage_observation_scene_overlap/);
    assert.match(adapted.prompt, /same_scene/);

    const unrelated = { prompt: '普通聊天提示词' };
    assert.equal(adaptObservationGenerateRawOptions(unrelated, context), unrelated);
});
