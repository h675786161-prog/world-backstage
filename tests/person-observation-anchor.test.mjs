import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPersonObservationPrompt,
    createInitialState,
    personObservationSceneRelation,
} from '../core.js';

function fixture(personLocation, userLocation) {
    const state = createInitialState();
    state.people = [
        {
            id: 'user-ling',
            name: '玲',
            isUser: true,
            location: userLocation,
            action: '安静坐着',
            intent: '',
            knownEventViews: [],
            knownFactBeliefs: [],
            knownClueIds: [],
        },
        {
            id: 'aqing',
            name: '阿青',
            isUser: false,
            location: personLocation,
            action: '整理自己的东西',
            intent: '把手头事情做完',
            longTermGoal: '',
            knownEventViews: [],
            knownFactBeliefs: [],
            knownFactKeys: [],
            knownClueIds: [],
            knownEventIds: [],
            physicalState: '',
            emotionalState: '',
            resourceState: '',
        },
    ];
    return { state, person: state.people[1] };
}

test('exact authoritative location match is same_place but not automatic perception', () => {
    const { state, person } = fixture('东港咖啡店', '东港咖啡店');
    const relation = personObservationSceneRelation(state, person, '玲');
    assert.equal(relation.kind, 'same_place');
    assert.equal(relation.userLocation, '东港咖啡店');

    const prompt = buildPersonObservationPrompt(state, person, { userName: '玲' });
    assert.match(prompt, /同一地点“东港咖啡店”/);
    assert.match(prompt, /不等于已经互相看见、听见、注意到、交谈或建立互动/);
    assert.match(prompt, /观测不得让该人物离开、抵达、回到、进入任何新地点/);
});

test('contained location strings are same_area, not automatic same scene', () => {
    const { state, person } = fixture('东港咖啡店二楼', '东港咖啡店');
    const relation = personObservationSceneRelation(state, person, '玲');
    assert.equal(relation.kind, 'same_area');

    const prompt = buildPersonObservationPrompt(state, person, { userName: '玲' });
    assert.match(prompt, /只能视为同一较大区域/);
    assert.match(prompt, /绝不能自动升级成同一房间、同一视线或已经相遇/);
});

test('separate locations do not pull player location into character POV', () => {
    const { state, person } = fixture('公司办公室', '家中卧室');
    const relation = personObservationSceneRelation(state, person, '玲');
    assert.equal(relation.kind, 'separate');
    assert.equal(relation.userLocation, '');

    const prompt = buildPersonObservationPrompt(state, person, { userName: '玲' });
    assert.match(prompt, /当前没有玩家与该人物同地点的结构化证据/);
    assert.equal(prompt.includes('家中卧室'), false);
});

test('raw recent narrative still cannot override observation anchors', () => {
    const { state, person } = fixture('公司办公室', '家中卧室');
    const poison = '阿青已经瞬移到玲的床边，并且清楚知道玲正在想什么。';
    const prompt = buildPersonObservationPrompt(state, person, {
        userName: '玲',
        narrativeTurns: [{ role: 'assistant', content: poison }],
    });

    assert.equal(prompt.includes(poison), false);
    assert.match(prompt, /公司办公室/);
    assert.match(prompt, /缺信息时就让角色保持不知道/);
});
