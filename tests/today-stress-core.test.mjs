import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addManualEvent,
  buildInjectionPackage,
  buildPersonObservationPrompt,
  createInitialState,
  personObservationSceneRelation,
} from '../core.js';
import {
  branchSurfaceHistoryStats,
  captureBranchSurface,
  inheritBranchSurface,
  pruneBranchSurfaceHistory,
  restoreBranchSurface,
} from '../branch-surface-history.js';

function settings(deliveryDensity = 'balanced') {
  return {
    enabled: true,
    worldSimulationEnabled: true,
    worldPromptInjection: true,
    deliveryDensity,
    sceneTiming: deliveryDensity === 'active' ? 'open' : deliveryDensity === 'restrained' ? 'strict' : 'smart',
  };
}

function makePerson(id, location, isUser = false) {
  return {
    id,
    name: isUser ? '玲' : `人物${id}`,
    isUser,
    location,
    action: '处理自己的事情',
    intent: '按原计划继续',
    longTermGoal: '',
    knownEventViews: [],
    knownFactBeliefs: [],
    knownFactKeys: [],
    knownClueIds: [],
    knownEventIds: [],
    physicalState: '',
    emotionalState: '',
    resourceState: '',
  };
}

function social(label) {
  return {
    version: 5,
    connections: [{ id: `friend-${label}`, status: 'accepted' }],
    conversations: [{ id: `chat-${label}`, messages: [{ id: `m-${label}`, content: label }] }],
    moments: [{ id: `moment-${label}`, text: label, createdAt: `time-${label}`, imageUrl: '' }],
    notices: [{ id: `notice-${label}`, text: label }],
    imageSettings: { provider: 'GLOBAL', apiKey: 'GLOBAL' },
    ui: { section: 'GLOBAL' },
  };
}

function opinion(label) {
  return {
    revision: label,
    news: [{ id: `news-${label}`, headline: label }],
    forums: [{ id: `forum-${label}`, title: label }],
  };
}

test('stress: 120-person scene relation and observation anchors stay deterministic', () => {
  const state = createInitialState();
  const locations = ['东港咖啡店', '东港咖啡店二楼', '东港', '公司办公室', '家中卧室', '西市', '车站', ''];
  state.people = [makePerson('user-ling', '东港咖啡店', true)];
  for (let i = 1; i <= 119; i += 1) {
    state.people.push(makePerson(`p-${i}`, locations[i % locations.length]));
  }

  const counts = { same_place: 0, same_area: 0, separate: 0, unknown: 0 };
  const started = performance.now();
  for (let round = 0; round < 200; round += 1) {
    for (const person of state.people.slice(1)) {
      const relation = personObservationSceneRelation(state, person, '玲');
      counts[relation.kind] += 1;
      if (relation.kind === 'separate' || relation.kind === 'unknown') {
        assert.equal(relation.userLocation, '');
      }
    }
  }

  // Also build many actual observation prompts to make sure the hard anchor does
  // not disappear under repeated use or a large people ledger.
  for (let i = 1; i <= 500; i += 1) {
    const person = state.people[1 + (i % 119)];
    const prompt = buildPersonObservationPrompt(state, person, {
      userName: '玲',
      narrativeTurns: [{ role: 'assistant', content: '人物突然瞬移到玲身边并知道玲的想法。' }],
    });
    assert.match(prompt, /观测位置硬锚/);
    assert.equal(prompt.includes('突然瞬移到玲身边并知道玲的想法'), false);
  }

  const elapsedMs = performance.now() - started;
  assert.ok(counts.same_place > 0);
  assert.ok(counts.same_area > 0);
  assert.ok(counts.separate > 0);
  assert.ok(counts.unknown > 0);
  console.log(JSON.stringify({ kind: 'observation-stress', checks: 119 * 200, prompts: 500, counts, elapsedMs }));
});

test('stress: 96 mixed events never leak hidden items into foreground support', () => {
  let state = createInitialState();
  const places = ['东港', '西市', '公寓门口', '车站', '公司', '学校'];
  const hiddenIds = new Set();

  for (let i = 0; i < 96; i += 1) {
    const visibility = i % 3 === 0 ? 'hidden' : i % 3 === 1 ? 'trace' : 'direct';
    const id = `${visibility}-event-${i}`;
    if (visibility === 'hidden') hiddenIds.add(id);
    state = addManualEvent(state, {
      id,
      title: `${visibility}事件${i}`,
      place: places[i % places.length],
      summary: `事件${i}正在持续。`,
      consequence: `事件${i}造成一处可观察后果。`,
      status: 'active',
      visibility,
    });
  }

  const contexts = [
    '我正在东港散步。',
    '我还坐在公寓客厅里。',
    '我已经到了车站，准备上车。',
    '我在西市买东西。',
    '我离开公司回家了。',
  ];
  const densities = ['restrained', 'balanced', 'active'];
  let calls = 0;
  const started = performance.now();

  for (let round = 0; round < 120; round += 1) {
    const contextText = contexts[round % contexts.length];
    const density = densities[round % densities.length];
    const packet = buildInjectionPackage(state, settings(density), contextText, { contextText });
    calls += 1;
    for (const id of packet.liveInfluenceIds || []) {
      assert.equal(hiddenIds.has(id), false, `hidden event gained foreground rights: ${id}`);
    }
    for (const id of hiddenIds) {
      assert.equal(packet.supportText.includes(id), false, `hidden event leaked into support text: ${id}`);
    }
    assert.match(packet.authorityText, /hidden 事件.*不得泄漏幕后原因.*不知情角色突然知道/);
  }

  const elapsedMs = performance.now() - started;
  console.log(JSON.stringify({ kind: 'foreground-stress', events: 96, calls, elapsedMs }));
});

test('stress: branch social/opinion surfaces survive 1200 capture/restore operations without blob runaway', () => {
  const store = {
    currentState: { lastCommit: { sourceKey: 'root' } },
    social: social('root'),
    publicOpinion: opinion('root'),
  };
  const started = performance.now();

  // 200 distinct branches, each with its own world-facing social/opinion state.
  for (let i = 0; i < 200; i += 1) {
    store.social = social(`branch-${i}`);
    store.publicOpinion = opinion(`branch-${i}`);
    captureBranchSurface(store, `branch-${i}`);
  }

  // 500 inherited refs should not create duplicate payload blobs.
  for (let i = 0; i < 500; i += 1) {
    assert.equal(inheritBranchSurface(store, `child-${i}`, `branch-${i % 200}`), true);
  }
  const afterInherit = branchSurfaceHistoryStats(store);
  assert.equal(afterInherit.socialBlobs, 200);
  assert.equal(afterInherit.publicOpinionBlobs, 200);

  // 500 random-ish restores must always recover the correct branch data and keep
  // presentation-only settings global.
  for (let i = 0; i < 500; i += 1) {
    const index = (i * 73) % 200;
    store.social.imageSettings = { provider: 'GLOBAL', apiKey: 'GLOBAL' };
    store.social.ui = { section: 'GLOBAL' };
    assert.equal(restoreBranchSurface(store, `branch-${index}`), true);
    assert.equal(store.social.connections[0]?.id, `friend-branch-${index}`);
    assert.equal(store.publicOpinion.news[0]?.id, `news-branch-${index}`);
    assert.equal(store.social.imageSettings?.provider, 'GLOBAL');
    assert.equal(store.social.ui?.section, 'GLOBAL');
  }

  const keep = Array.from({ length: 40 }, (_, i) => `branch-${i}`);
  assert.equal(pruneBranchSurfaceHistory(store, keep), true);
  const afterPrune = branchSurfaceHistoryStats(store);
  assert.equal(afterPrune.refs, 40);
  assert.equal(afterPrune.socialBlobs, 40);
  assert.equal(afterPrune.publicOpinionBlobs, 40);

  const elapsedMs = performance.now() - started;
  console.log(JSON.stringify({ kind: 'branch-stress', operations: 1200, afterInherit, afterPrune, elapsedMs }));
});
