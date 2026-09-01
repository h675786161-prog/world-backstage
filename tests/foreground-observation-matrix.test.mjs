import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addManualEvent,
    buildInjectionPackage,
    createInitialState,
} from '../core.js';

const densities = ['restrained', 'balanced', 'active'];
const visibilities = ['hidden', 'trace', 'known', 'direct'];

function packetFor({ density, visibility, scene }) {
    const state = addManualEvent(createInitialState(), {
        id: `matrix-${density}-${visibility}-${scene}`,
        title: `矩阵事件-${visibility}`,
        place: '东港咖啡店',
        summary: `一个 ${visibility} 可见度的进行中变化。`,
        consequence: '现场桌椅与动线出现了可以被注意到的变化。',
        status: 'active',
        visibility,
    });
    const narrative = scene === 'same'
        ? '我现在就在东港咖啡店里，坐在靠窗的位置。'
        : '我已经到了西市图书馆，正在阅览室里看书。';
    return buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: true,
        deliveryDensity: density,
        sceneTiming: 'open',
    }, narrative, { contextText: narrative });
}

test('matrix: hidden ongoing events never gain foreground rights at any density or scene relation', () => {
    for (const density of densities) {
        for (const scene of ['same', 'separate']) {
            const packet = packetFor({ density, visibility: 'hidden', scene });
            assert.deepEqual(packet.liveInfluenceIds, []);
            assert.equal(packet.supportText.includes('矩阵事件-hidden'), false);
            assert.equal(packet.eventIds.length, 0, 'ongoing hidden events are never settled-delivery entries');
        }
    }
});

test('matrix: newly anchored separate scene blocks every ongoing event from following the camera', () => {
    for (const density of densities) {
        for (const visibility of visibilities) {
            const packet = packetFor({ density, visibility, scene: 'separate' });
            assert.deepEqual(packet.liveInfluenceIds, [], `${density}/${visibility} must stay off-scene`);
            assert.equal(packet.supportText.includes(`矩阵事件-${visibility}`), false);
        }
    }
});

test('matrix: direct same-scene changes remain unavoidable continuity at every density', () => {
    for (const density of densities) {
        const packet = packetFor({ density, visibility: 'direct', scene: 'same' });
        assert.equal(packet.liveInfluenceIds.length, 1);
        assert.match(packet.liveInfluenceIds[0], new RegExp(`matrix-${density}-direct-same`));
        assert.equal(packet.eventIds.length, 0, 'ongoing influence must not be marked settled/delivered');
    }
});

test('matrix: balanced and active may surface trace and known same-scene consequences without changing severity', () => {
    for (const density of ['balanced', 'active']) {
        for (const visibility of ['trace', 'known']) {
            const packet = packetFor({ density, visibility, scene: 'same' });
            assert.equal(packet.liveInfluenceIds.length, 1, `${density}/${visibility} should be foreground-relevant`);
            assert.match(packet.supportText, /具体|可感知|体现/);
            assert.equal(packet.eventIds.length, 0);
        }
    }
});
