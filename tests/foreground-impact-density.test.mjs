import test from 'node:test';
import assert from 'node:assert/strict';
import { addManualEvent, buildInjectionPackage, createInitialState } from '../core.js';

test('balanced and active make relevant ongoing events foreground influence candidates', () => {
  const state = addManualEvent(createInitialState(), {
    id: 'east-port-rain', title: '东港持续暴雨', place: '东港',
    summary: '强降雨正在造成路面积水和车辆绕行。', consequence: '东港道路通行明显变慢。',
    status: 'active', visibility: 'trace',
  });
  const balanced = buildInjectionPackage(state, {
    enabled: true, worldSimulationEnabled: true, worldPromptInjection: true,
    deliveryDensity: 'balanced', sceneTiming: 'smart',
  }, '我准备开车去东港。', { contextText: '我准备开车去东港。' });
  assert.deepEqual(balanced.liveInfluenceIds, ['east-port-rain']);
  assert.equal(balanced.eventIds.includes('east-port-rain'), false);
  assert.match(balanced.supportText, /通常至少自然体现一处具体可感知后果/);
  const active = buildInjectionPackage(state, {
    enabled: true, worldSimulationEnabled: true, worldPromptInjection: true,
    deliveryDensity: 'active', sceneTiming: 'open',
  }, '我准备开车去东港。', { contextText: '我准备开车去东港。' });
  assert.deepEqual(active.liveInfluenceIds, ['east-port-rain']);
  assert.match(active.supportText, /互不冲突时可以承接两处/);
  assert.match(active.supportText, /不提高事件严重性/);
});

test('restrained only forces ongoing changes already colliding with the current scene', () => {
  let state = addManualEvent(createInitialState(), {
    id: 'direct-doorbell', title: '门外来访', place: '公寓门口', summary: '门铃正在响。',
    status: 'active', visibility: 'direct',
  });
  state = addManualEvent(state, {
    id: 'west-market-delay', title: '西市配送延迟', place: '西市', summary: '几家商铺的配送正在延迟。',
    status: 'active', visibility: 'trace',
  });
  const packet = buildInjectionPackage(state, {
    enabled: true, worldSimulationEnabled: true, worldPromptInjection: true,
    deliveryDensity: 'restrained', sceneTiming: 'strict',
  }, '我还坐在客厅里。', { contextText: '我还坐在客厅里。' });
  assert.deepEqual(packet.liveInfluenceIds, ['direct-doorbell']);
  assert.match(packet.supportText, /最多落下一处具体后果/);
  assert.equal(packet.supportText.includes('西市配送延迟'), false);
});

test('hidden ongoing events stay backstage and never gain foreground influence rights', () => {
  const state = addManualEvent(createInitialState(), {
    id: 'secret-tail', title: '秘密跟踪', place: '东港', summary: '一名未知人物正在暗中跟踪目标。',
    status: 'active', visibility: 'hidden',
  });
  const packet = buildInjectionPackage(state, {
    enabled: true, worldSimulationEnabled: true, worldPromptInjection: true,
    deliveryDensity: 'active', sceneTiming: 'open',
  }, '我正在东港散步。', { contextText: '我正在东港散步。' });
  assert.deepEqual(packet.liveInfluenceIds, []);
  assert.equal(packet.supportText.includes('秘密跟踪'), false);
  assert.match(packet.authorityText, /秘密跟踪/);
  assert.match(packet.authorityText, /hidden 事件.*不得泄漏幕后原因.*不知情角色突然知道/);
});
