import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const playwrightEntry = process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core';
const { chromium } = await import(playwrightEntry);

function which(name) {
    try {
        return execFileSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

const executablePath = process.env.WB_CHROMIUM_EXECUTABLE || [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
].map(which).find(Boolean);

assert.ok(executablePath, 'GitHub runner has no Chromium/Chrome executable');

const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--enable-precise-memory-info',
    ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pluginConsoleErrors = [];
const pageErrors = [];

page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/世界背面|world[-_ ]?backstage/i.test(text)) pluginConsoleErrors.push(text);
});
page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));

const report = {
    url: process.env.WB_TAVERN_URL || 'http://127.0.0.1:8000/',
    pluginRoot: false,
    time: {},
    memory: {},
    phoneBridge: {},
    pluginConsoleErrors,
    pageErrors,
};

try {
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
    await page.waitForSelector('#world-backstage-root', { timeout: 30_000 });
    report.pluginRoot = true;

    const timeResult = await page.evaluate(async () => {
        const mod = await import('/scripts/extensions/third-party/world-backstage-test/world-clock-authority.js');
        const day = value => value * mod.MINUTES_PER_DAY;
        const lateBase = day(12) + 23 * 60 + 40;

        const arrival = mod.resolveNarrativeTimeTransition('夜已深。到了子正一刻，她推门出去。', {
            currentAbsoluteMinute: lateBase,
            calendarBound: false,
            currentPrecision: 'minute',
        });
        const alreadyAfterMidnight = mod.resolveNarrativeTimeTransition('到了子正一刻，她推门出去。', {
            currentAbsoluteMinute: day(13) + 5,
            calendarBound: false,
            currentPrecision: 'minute',
        });
        const structured = mod.resolveNarrativeTimeTransition('<time_format>时间：子正一刻</time_format>', {
            currentAbsoluteMinute: day(20) + 23 * 60 + 40,
            calendarBound: false,
            currentPrecision: 'minute',
        });
        const plan = mod.resolveNarrativeTimeTransition('她看了眼更漏：“当天子正一刻再联系。”', {
            currentAbsoluteMinute: day(20) + 23 * 60 + 40,
            calendarBound: false,
            currentPrecision: 'minute',
        });
        const dialogue = mod.resolveNarrativeTimeTransition('她说：“卯时三刻见。”', {
            currentAbsoluteMinute: day(8) + 10 * 60,
            calendarBound: false,
            currentPrecision: 'minute',
        });

        return {
            minutesPerDay: mod.MINUTES_PER_DAY,
            arrival: arrival?.targetAbsoluteMinute ?? null,
            arrivalExpected: day(13) + 15,
            afterMidnight: alreadyAfterMidnight?.targetAbsoluteMinute ?? null,
            afterMidnightExpected: day(13) + 15,
            structured: structured?.targetAbsoluteMinute ?? null,
            structuredExpected: day(21) + 15,
            planIsNull: plan === null,
            dialogueIsNull: dialogue === null,
        };
    });

    assert.equal(timeResult.arrival, timeResult.arrivalExpected, '子正一刻 should cross civil midnight from 23:40');
    assert.equal(timeResult.afterMidnight, timeResult.afterMidnightExpected, '00:05 -> 子正一刻 should stay on same civil day');
    assert.equal(timeResult.structured, timeResult.structuredExpected, 'structured 子正一刻 should cross civil midnight');
    assert.equal(timeResult.planIsNull, true, 'same-day planning phrase must not advance current world time');
    assert.equal(timeResult.dialogueIsNull, true, 'dialogue promise must not advance current world time');
    report.time = timeResult;

    const memoryResult = await page.evaluate(async () => {
        const mod = await import('/scripts/extensions/third-party/world-backstage-test/snapshot-memory-dedupe.js');

        const largeFactText = '长期事实正文'.repeat(240);
        const largeClueText = '长期线索正文'.repeat(240);
        const largeDigestText = '长期摘要正文'.repeat(180);

        function makeSnapshot(index) {
            return {
                schemaVersion: 25,
                meta: { compactMemory: true, memorySummaryCutoffMessageId: index },
                state: {
                    revision: index,
                    storyMemory: {
                        indexedThroughMessageId: index,
                        indexedAt: '2026-08-30T00:00:00.000Z',
                        digest: {
                            text: largeDigestText,
                            throughMessageId: 1,
                            people: ['阿青'],
                            tags: ['约定'],
                        },
                        facts: [{
                            id: 'promise',
                            key: 'person:a:promise',
                            subject: '阿青',
                            predicate: '承诺',
                            value: largeFactText,
                            status: 'active',
                            importance: 3,
                        }],
                        clues: [{
                            id: 'red-thread',
                            title: '红线',
                            text: largeClueText,
                            status: 'developing',
                        }],
                        summaries: [],
                        metabolismLog: [{
                            id: 'metabolism-1',
                            kind: 'memory',
                            action: 'updated',
                            targetId: 'promise',
                        }],
                    },
                },
            };
        }

        const store = { branchOverrides: {} };
        for (let index = 1; index <= 600; index += 1) {
            store.branchOverrides[`branch-${index}`] = makeSnapshot(index);
        }

        const heapBefore = performance.memory?.usedJSHeapSize || 0;
        const beforeBytes = new TextEncoder().encode(JSON.stringify({ store })).length;
        const changed = mod.compactSnapshotMemoryLedgers(store, [], 'world_backstage');
        const afterBytes = new TextEncoder().encode(JSON.stringify({ store })).length;
        const stats = mod.memoryLedgerStats(store);
        const heapAfter = performance.memory?.usedJSHeapSize || 0;

        const sample = store.branchOverrides['branch-600'].state.storyMemory;
        const hydratedFactOk = sample.facts[0]?.value === largeFactText;
        const hydratedClueOk = sample.clues[0]?.text === largeClueText;
        const persisted = JSON.parse(JSON.stringify({ store }));
        const reloadChanged = mod.compactSnapshotMemoryLedgers(persisted.store, [], 'world_backstage');
        const reloaded = persisted.store.branchOverrides['branch-600'].state.storyMemory;
        const reloadFactOk = reloaded.facts[0]?.value === largeFactText;
        const reloadClueOk = reloaded.clues[0]?.text === largeClueText;

        return {
            snapshotCount: 600,
            changed,
            beforeBytes,
            afterBytes,
            ratio: afterBytes / beforeBytes,
            stats,
            hydratedFactOk,
            hydratedClueOk,
            reloadChanged,
            reloadFactOk,
            reloadClueOk,
            heapBefore,
            heapAfter,
        };
    });

    assert.equal(memoryResult.changed, true, 'first memory-ledger compaction should change snapshots');
    assert.equal(memoryResult.stats.facts, 1, 'shared fact body should be stored once');
    assert.equal(memoryResult.stats.clues, 1, 'shared clue body should be stored once');
    assert.equal(memoryResult.stats.digests, 1, 'shared digest body should be stored once');
    assert.equal(memoryResult.stats.metabolism, 1, 'shared metabolism entry should be stored once');
    assert.equal(memoryResult.hydratedFactOk, true, 'compacted snapshot should still expose full fact data');
    assert.equal(memoryResult.hydratedClueOk, true, 'compacted snapshot should still expose full clue data');
    assert.equal(memoryResult.reloadFactOk, true, 'persisted/reloaded snapshot should restore fact data');
    assert.equal(memoryResult.reloadClueOk, true, 'persisted/reloaded snapshot should restore clue data');
    assert.ok(memoryResult.ratio < 0.2, `600-snapshot dedupe ratio is too high: ${memoryResult.ratio}`);
    report.memory = memoryResult;

    await page.waitForFunction(() => (
        Number(globalThis.worldBackstageHost?.phoneBridgeVersion || 0) >= 2
        && typeof globalThis.worldBackstageHost?.getPhoneSurface === 'function'
    ), null, { timeout: 30_000 });

    const phoneBridgeResult = await page.evaluate(async () => {
        const core = await import('/scripts/extensions/third-party/world-backstage-test/core.js');
        const ctx = globalThis.SillyTavern.getContext();
        const metadata = ctx?.chatMetadata || ctx?.chat_metadata;
        if (!metadata || typeof metadata !== 'object') throw new Error('SillyTavern chat metadata unavailable');
        const previous = metadata[core.STATE_KEY];
        metadata[core.STATE_KEY] = {
            schemaVersion: 25,
            currentState: {
                world: { name: '桥接防火墙测试世界' },
                clock: { absoluteMinute: 77, displayTime: '20:17', displayDate: '9月4日' },
                people: [
                    {
                        id: 'known-person',
                        name: '已知联系人',
                        monogram: '知',
                        isUser: false,
                        location: '后台精确位置',
                        action: '后台当前行动',
                        intent: '后台秘密计划',
                        innerVoice: '绝不能进入手机桥',
                        knownEventIds: ['secret-event'],
                        backgroundProfile: '后台完整设定',
                    },
                    {
                        id: 'secret-person',
                        name: '幕后隐藏人物',
                        isUser: false,
                        location: '暗处',
                        action: '秘密跟踪',
                        innerVoice: '完全不可见',
                    },
                ],
                events: [
                    {
                        id: 'public-event',
                        title: '后台内部标题',
                        summary: '后台私密摘要',
                        cause: '幕后原因',
                        actors: ['secret-person'],
                        publicity: 'public',
                        status: 'active',
                        publicHeadline: '公开道路提醒',
                        publicSummary: '部分路段积水，请绕行。',
                    },
                    {
                        id: 'secret-event',
                        title: '秘密跟踪',
                        summary: '幕后隐藏人物正在跟踪',
                        publicity: 'private',
                        visibility: 'hidden',
                        status: 'active',
                    },
                ],
                lastCommit: { sourceKey: 'bridge-firewall-test' },
            },
            social: {
                schemaVersion: 2,
                activeConversationId: 'direct-known-person',
                conversations: [{
                    id: 'direct-known-person',
                    type: 'direct',
                    title: '已知联系人',
                    memberIds: ['known-person'],
                    rawMessages: [{
                        id: 'msg-1',
                        senderId: 'known-person',
                        senderName: '已知联系人',
                        text: '晚上好。',
                        worldMinute: 76,
                        createdAt: '2026-09-04T12:00:00.000Z',
                    }],
                    lastRouting: {
                        evaluations: [{ personId: 'known-person', reason: '内部路由理由' }],
                    },
                    lastError: '内部错误细节',
                    createdAt: '2026-09-04T12:00:00.000Z',
                    updatedAt: '2026-09-04T12:00:00.000Z',
                }],
                connections: [{
                    personId: 'known-person',
                    status: 'accepted',
                    source: 'world',
                    evidence: '内部关系证据',
                    decisionReason: '内部决策理由',
                }],
                moments: [],
                notices: [],
            },
            publicOpinion: { news: [], forums: [] },
        };

        try {
            const surface = globalThis.worldBackstageHost.getPhoneSurface();
            const serialized = JSON.stringify(surface);
            return {
                bridgeVersion: Number(surface?.bridgeVersion || 0),
                peopleIds: (surface?.people || []).map(person => person.id),
                eventIds: (surface?.events || []).map(event => event.id),
                safePersonKeys: Object.keys(surface?.people?.[0] || {}).sort(),
                leakedSecretPerson: serialized.includes('secret-person') || serialized.includes('幕后隐藏人物'),
                leakedInnerVoice: serialized.includes('绝不能进入手机桥') || serialized.includes('完全不可见'),
                leakedPrivateEvent: serialized.includes('secret-event') || serialized.includes('秘密跟踪'),
                leakedRouting: serialized.includes('内部路由理由')
                    || serialized.includes('内部错误细节')
                    || serialized.includes('内部关系证据')
                    || serialized.includes('内部决策理由'),
            };
        } finally {
            if (previous === undefined) delete metadata[core.STATE_KEY];
            else metadata[core.STATE_KEY] = previous;
        }
    });

    assert.ok(phoneBridgeResult.bridgeVersion >= 2, `expected phone bridge v2+, got ${phoneBridgeResult.bridgeVersion}`);
    assert.deepEqual(phoneBridgeResult.peopleIds, ['known-person']);
    assert.deepEqual(phoneBridgeResult.eventIds, ['public-event']);
    assert.deepEqual(phoneBridgeResult.safePersonKeys, ['avatarDataUrl', 'id', 'monogram', 'name']);
    assert.equal(phoneBridgeResult.leakedSecretPerson, false, 'phone bridge leaked an unknown backstage person');
    assert.equal(phoneBridgeResult.leakedInnerVoice, false, 'phone bridge leaked backstage inner voice');
    assert.equal(phoneBridgeResult.leakedPrivateEvent, false, 'phone bridge leaked a private event');
    assert.equal(phoneBridgeResult.leakedRouting, false, 'phone bridge leaked internal social routing or evidence');
    report.phoneBridge = phoneBridgeResult;

    assert.equal(pluginConsoleErrors.length, 0, `plugin console errors: ${pluginConsoleErrors.join('\n')}`);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('\n')}`);

    await page.screenshot({ path: process.env.WB_RUNTIME_SCREENSHOT || 'runtime-smoke.png', fullPage: true });
} finally {
    fs.writeFileSync(
        process.env.WB_RUNTIME_REPORT || 'runtime-smoke-report.json',
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
