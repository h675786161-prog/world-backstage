import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addManualEvent,
    applySimulationResult,
    createInitialState,
} from '../core.js';

function hiddenEventState() {
    return addManualEvent(createInitialState({ worldName: '知识防火墙实验' }), {
        id: 'secret-tail',
        title: '秘密跟踪',
        summary: '未知人物正在镜头外秘密跟踪林。',
        visibility: 'hidden',
        clock_mode: 'condition',
    });
}

test('next_turn_injection 不允许无合法获知路径的 hidden 事件进入 required/conditional', () => {
    const state = applySimulationResult(hiddenEventState(), {
        elapsed_minutes: 0,
        next_turn_injection: {
            required_refs: ['event:secret-tail'],
            conditional_refs: ['event:secret-tail'],
            suppress_refs: [],
            reason: '模型认为它重要',
        },
    }, {
        messageId: 10,
        swipeId: 0,
        sourceKey: '10:0:hidden-firewall',
        narrativeText: '林在公寓里喝水，没有看到窗外，也没有收到消息。',
    });

    assert.equal(state.nextTurnInjection.requiredRefs.includes('event:secret-tail'), false);
    assert.equal(state.nextTurnInjection.conditionalRefs.includes('event:secret-tail'), false);
    assert.equal(state.nextTurnInjection.suppressRefs.includes('event:secret-tail'), true);
});

test('只有 knownEventIds 的旧式标记不足以穿透 hidden 防火墙', () => {
    const base = hiddenEventState();
    base.people.push({
        id: 'lin',
        name: '林',
        location: '公寓',
        action: '喝水',
        knowledge: 'known',
        relevance: 3,
        knownEventIds: ['secret-tail'],
        knownEventViews: [],
    });

    const state = applySimulationResult(base, {
        elapsed_minutes: 0,
        next_turn_injection: { required_refs: ['event:secret-tail'] },
    }, {
        messageId: 11,
        swipeId: 0,
        sourceKey: '11:0:legacy-known-id',
        narrativeText: '林仍在公寓。',
    });

    assert.equal(state.nextTurnInjection.requiredRefs.includes('event:secret-tail'), false);
    assert.equal(state.nextTurnInjection.suppressRefs.includes('event:secret-tail'), true);
});

test('带合法 route 和 evidence 的角色认知可以放行 hidden 引用', () => {
    const base = hiddenEventState();
    base.people.push({
        id: 'lin',
        name: '林',
        location: '公寓',
        action: '查看窗外',
        knowledge: 'known',
        relevance: 3,
        knownEventIds: ['secret-tail'],
        knownEventViews: [{
            eventId: 'secret-tail',
            summary: '林亲眼看见同一个人连续跟在自己身后。',
            certainty: 'confirmed',
            route: 'witnessed',
            evidence: '林在正文中回头并清楚看见跟踪者。',
            learnedAtMessageId: 12,
            updatedAt: base.clock.absoluteMinute,
        }],
    });

    const state = applySimulationResult(base, {
        elapsed_minutes: 0,
        next_turn_injection: { required_refs: ['event:secret-tail'] },
    }, {
        messageId: 12,
        swipeId: 0,
        sourceKey: '12:0:validated-route',
        narrativeText: '林回头确认那个人仍跟在身后。',
    });

    assert.equal(state.nextTurnInjection.requiredRefs.includes('event:secret-tail'), true);
    assert.equal(state.nextTurnInjection.suppressRefs.includes('event:secret-tail'), false);
});
