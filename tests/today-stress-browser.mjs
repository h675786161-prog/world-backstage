import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const playwrightEntry = process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core';
const { chromium } = await import(playwrightEntry);

function which(name) {
  try { return execFileSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

const executablePath = process.env.WB_CHROMIUM_EXECUTABLE || ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map(which).find(Boolean);
assert.ok(executablePath, 'GitHub runner has no Chromium/Chrome executable');

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pluginConsoleErrors = [];
const pageErrors = [];
page.on('console', message => {
  if (message.type() === 'error' && /世界背面|world[-_ ]?backstage/i.test(message.text())) pluginConsoleErrors.push(message.text());
});
page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));

const report = {
  pluginRoot: false,
  coreStress: {},
  mobileNews: {},
  pluginConsoleErrors,
  pageErrors,
};

try {
  await page.goto(process.env.WB_TAVERN_URL || 'http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
  await page.waitForSelector('#world-backstage-root', { state: 'attached', timeout: 30_000 });
  report.pluginRoot = true;

  report.coreStress = await page.evaluate(async () => {
    const core = await import('/scripts/extensions/third-party/world-backstage-test/core.js');
    const locations = ['东港咖啡店', '东港咖啡店二楼', '公司办公室', '家中卧室', '西市', ''];
    const state = core.createInitialState();
    state.people = [{
      id: 'user-ling', name: '玲', isUser: true, location: '东港咖啡店', action: '喝咖啡', intent: '',
      knownEventViews: [], knownFactBeliefs: [], knownClueIds: [],
    }];
    for (let i = 0; i < 149; i += 1) {
      state.people.push({
        id: `person-${i}`, name: `人物${i}`, isUser: false, location: locations[i % locations.length],
        action: '处理自己的事情', intent: '继续原计划', longTermGoal: '',
        knownEventViews: [], knownFactBeliefs: [], knownFactKeys: [], knownClueIds: [], knownEventIds: [],
        physicalState: '', emotionalState: '', resourceState: '',
      });
    }

    let relationChecks = 0;
    const counts = { same_place: 0, same_area: 0, separate: 0, unknown: 0 };
    const start = performance.now();
    for (let round = 0; round < 100; round += 1) {
      for (const person of state.people.slice(1)) {
        const relation = core.personObservationSceneRelation(state, person, '玲');
        counts[relation.kind] += 1;
        relationChecks += 1;
        if (relation.kind === 'separate' || relation.kind === 'unknown') {
          if (relation.userLocation !== '') throw new Error('separate/unknown observation leaked player location');
        }
      }
    }

    let eventState = core.createInitialState();
    const hiddenIds = new Set();
    const places = ['东港', '西市', '公寓门口', '车站', '公司', '学校'];
    for (let i = 0; i < 96; i += 1) {
      const visibility = i % 3 === 0 ? 'hidden' : i % 3 === 1 ? 'trace' : 'direct';
      const id = `${visibility}-browser-${i}`;
      if (visibility === 'hidden') hiddenIds.add(id);
      eventState = core.addManualEvent(eventState, {
        id, title: `${visibility}浏览器事件${i}`, place: places[i % places.length],
        summary: `浏览器事件${i}正在持续。`, consequence: `浏览器事件${i}产生可见后果。`,
        status: 'active', visibility,
      });
    }
    const contexts = ['我在东港散步。', '我还在公寓客厅。', '我到了车站。', '我正在西市。'];
    const densities = ['restrained', 'balanced', 'active'];
    let injectionCalls = 0;
    for (let i = 0; i < 120; i += 1) {
      const contextText = contexts[i % contexts.length];
      const density = densities[i % densities.length];
      const packet = core.buildInjectionPackage(eventState, {
        enabled: true, worldSimulationEnabled: true, worldPromptInjection: true,
        deliveryDensity: density,
        sceneTiming: density === 'active' ? 'open' : density === 'restrained' ? 'strict' : 'smart',
      }, contextText, { contextText });
      for (const id of packet.liveInfluenceIds || []) {
        if (hiddenIds.has(id)) throw new Error(`hidden event gained foreground influence: ${id}`);
      }
      for (const id of hiddenIds) {
        if (packet.supportText.includes(id)) throw new Error(`hidden event leaked into support: ${id}`);
      }
      injectionCalls += 1;
    }
    return {
      people: state.people.length,
      relationChecks,
      relationCounts: counts,
      eventCount: eventState.events.length,
      injectionCalls,
      elapsedMs: performance.now() - start,
      heap: performance.memory?.usedJSHeapSize || 0,
    };
  });

  assert.equal(report.coreStress.people, 150);
  assert.equal(report.coreStress.relationChecks, 14900);
  assert.equal(report.coreStress.eventCount, 96);
  assert.equal(report.coreStress.injectionCalls, 120);

  await page.evaluate(async () => {
    const core = await import('/scripts/extensions/third-party/world-backstage-test/core.js');
    await import('/scripts/extensions/third-party/world-backstage-test/mobile-news-discussion.js');
    const context = globalThis.SillyTavern.getContext();
    context.chatMetadata ||= {};
    const news = [];
    const forums = [];
    for (let i = 0; i < 40; i += 1) {
      const eventId = `event-${i}`;
      news.push({ id: `news-${i}`, headline: `压力新闻 ${i}`, relatedEventId: eventId });
      for (let j = 0; j < 3; j += 1) {
        forums.push({
          id: `forum-${i}-${j}`,
          relatedEventId: eventId,
          board: `板块${j}`,
          title: `讨论 ${i}-${j}`,
          summary: `这是新闻 ${i} 的讨论摘要 ${j}`,
          replies: Array.from({ length: 8 }, (_, k) => ({ author: `用户${k}`, text: `回复 ${i}-${j}-${k}` })),
        });
      }
      forums.push({ ...forums[forums.length - 1], id: `forum-duplicate-${i}` });
    }
    context.chatMetadata[core.STATE_KEY] = {
      ...(context.chatMetadata[core.STATE_KEY] || {}),
      publicOpinion: { news, forums },
      publicOpinionDismissed: { news: [], forums: [] },
    };

    document.getElementById('wb-stress-news-grid')?.remove();
    const grid = document.createElement('div');
    grid.id = 'wb-stress-news-grid';
    grid.className = 'wb-news-grid';
    for (let i = 0; i < 40; i += 1) {
      const card = document.createElement('article');
      card.className = 'wb-news-card';
      const h3 = document.createElement('h3');
      h3.textContent = `压力新闻 ${i}`;
      card.append(h3);
      grid.append(card);
    }
    document.getElementById('world-backstage-root').append(grid);
  });

  await page.waitForFunction(() => (
    document.querySelectorAll('#wb-stress-news-grid > .wb-news-card > .wb-mobile-news-discussion').length === 40
  ), null, { timeout: 15_000 });

  const initialNews = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#wb-stress-news-grid > .wb-news-card')];
    return {
      cards: cards.length,
      discussions: cards.reduce((n, card) => n + card.querySelectorAll(':scope > .wb-mobile-news-discussion').length, 0),
      maxTopics: Math.max(...cards.map(card => card.querySelectorAll('.wb-mobile-news-discussion-topic').length)),
      maxRepliesPerTopic: Math.max(...cards.flatMap(card => [...card.querySelectorAll('.wb-mobile-news-discussion-topic')]
        .map(topic => topic.querySelectorAll('.wb-mobile-news-discussion-reply').length))),
    };
  });
  assert.equal(initialNews.cards, 40);
  assert.equal(initialNews.discussions, 40);
  assert.equal(initialNews.maxTopics, 3);
  assert.ok(initialNews.maxRepliesPerTopic <= 4);

  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  const mutationStarted = Date.now();
  for (let round = 0; round < 30; round += 1) {
    await page.evaluate((roundValue) => {
      const context = globalThis.SillyTavern.getContext();
      const store = context.chatMetadata.world_backstage_v1;
      const forum = store.publicOpinion.forums[roundValue % store.publicOpinion.forums.length];
      if (forum?.replies?.[0]) forum.replies[0].text = `高频刷新 ${roundValue}`;
      const grid = document.getElementById('wb-stress-news-grid');
      const pulse = document.createElement('i');
      pulse.dataset.round = String(roundValue);
      grid.append(pulse);
      pulse.remove();
    }, round);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);

  const afterMutation = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#wb-stress-news-grid > .wb-news-card')];
    return {
      discussions: cards.reduce((n, card) => n + card.querySelectorAll(':scope > .wb-mobile-news-discussion').length, 0),
      duplicateCards: cards.filter(card => card.querySelectorAll(':scope > .wb-mobile-news-discussion').length !== 1).length,
      heap: performance.memory?.usedJSHeapSize || 0,
    };
  });
  assert.equal(afterMutation.discussions, 40);
  assert.equal(afterMutation.duplicateCards, 0, 'MutationObserver refresh created duplicate discussion panels');

  await page.evaluate(() => {
    const store = globalThis.SillyTavern.getContext().chatMetadata.world_backstage_v1;
    store.publicOpinionDismissed.news = Array.from({ length: 20 }, (_, i) => `news-${i}`);
    const grid = document.getElementById('wb-stress-news-grid');
    grid.append(document.createElement('i'));
  });
  await page.waitForFunction(() => (
    document.querySelectorAll('#wb-stress-news-grid > .wb-news-card > .wb-mobile-news-discussion').length === 20
  ), null, { timeout: 10_000 });

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForFunction(() => (
    document.querySelectorAll('#wb-stress-news-grid .wb-mobile-news-discussion').length === 0
  ), null, { timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => (
    document.querySelectorAll('#wb-stress-news-grid > .wb-news-card > .wb-mobile-news-discussion').length === 20
  ), null, { timeout: 10_000 });

  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
  report.mobileNews = {
    initial: initialNews,
    afterMutation,
    mutationRounds: 30,
    mutationElapsedMs: Date.now() - mutationStarted,
    dismissedRemaining: await page.locator('#wb-stress-news-grid > .wb-news-card > .wb-mobile-news-discussion').count(),
    heapBefore,
    heapAfter,
    heapDelta: heapAfter - heapBefore,
  };
  assert.ok(report.mobileNews.heapDelta < 120 * 1024 * 1024, `mobile news stress heap grew too much: ${report.mobileNews.heapDelta}`);

  assert.equal(pluginConsoleErrors.length, 0, `plugin console errors:\n${pluginConsoleErrors.join('\n')}`);
  assert.equal(pageErrors.length, 0, `page errors:\n${pageErrors.join('\n')}`);
  await page.screenshot({ path: process.env.WB_TODAY_STRESS_SCREENSHOT || 'today-stress-mobile.png', fullPage: true });
} finally {
  fs.writeFileSync(
    process.env.WB_TODAY_STRESS_REPORT || 'today-stress-report.json',
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
