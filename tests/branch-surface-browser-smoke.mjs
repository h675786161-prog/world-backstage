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

const executablePath = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
].map(which).find(Boolean);
assert.ok(executablePath, 'GitHub runner has no Chromium/Chrome executable');

const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('console', message => {
    if (message.type() === 'error' && /世界背面|world[-_ ]?backstage/i.test(message.text())) {
        errors.push(message.text());
    }
});
page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)));

let report = {};
try {
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
    await page.waitForSelector('#world-backstage-root', { timeout: 30_000 });

    report = await page.evaluate(async () => {
        const mod = await import('/scripts/extensions/third-party/world-backstage-test/branch-surface-history.js');
        const social = (label, imageUrl = '') => ({
            version: 5,
            connections: [{ id: `friend-${label}`, status: 'accepted' }],
            conversations: [{ id: `chat-${label}`, messages: [{ id: `msg-${label}`, content: label }] }],
            moments: [{ id: 'shared-moment', text: label, createdAt: `time-${label}`, imageUrl }],
            notices: [{ id: `notice-${label}`, text: label }],
            imageSettings: { provider: `provider-${label}`, apiKey: `key-${label}` },
            ui: { section: `ui-${label}` },
        });
        const opinion = label => ({
            revision: label,
            news: [{ id: `news-${label}`, headline: label }],
            forums: [{ id: `forum-${label}`, title: label }],
        });
        const store = {
            currentState: { lastCommit: { sourceKey: 'root' } },
            social: social('A', 'data:image/png;base64,AAAA'),
            publicOpinion: opinion('A'),
        };

        mod.captureBranchSurface(store, 'A');
        store.social = social('B', 'data:image/png;base64,BBBB');
        store.social.imageSettings = { provider: 'GLOBAL', apiKey: 'GLOBAL' };
        store.social.ui = { section: 'GLOBAL' };
        store.publicOpinion = opinion('B');
        mod.captureBranchSurface(store, 'B');

        const serialized = JSON.stringify(store.branchSurfaceHistory);
        const aFound = mod.restoreBranchSurface(store, 'A');
        const a = {
            friend: store.social.connections[0]?.id,
            news: store.publicOpinion.news[0]?.id,
            image: store.social.moments[0]?.imageUrl,
            imageProvider: store.social.imageSettings?.provider,
            ui: store.social.ui?.section,
        };
        const bFound = mod.restoreBranchSurface(store, 'B');
        const b = {
            friend: store.social.connections[0]?.id,
            news: store.publicOpinion.news[0]?.id,
            image: store.social.moments[0]?.imageUrl,
        };

        for (let index = 0; index < 500; index += 1) {
            mod.inheritBranchSurface(store, `B-child-${index}`, 'B');
        }
        const dedupe = mod.branchSurfaceHistoryStats(store);

        for (let index = 0; index < 100; index += 1) {
            store.social = social(`rolling-${index}`);
            store.publicOpinion = opinion(`rolling-${index}`);
            mod.captureBranchSurface(store, 'rolling');
        }
        const afterRolling = mod.branchSurfaceHistoryStats(store);
        mod.pruneBranchSurfaceHistory(store, ['A', 'B']);
        const afterPrune = mod.branchSurfaceHistoryStats(store);

        const legacyStore = {
            currentState: { lastCommit: { sourceKey: 'legacy-B' } },
            social: social('foreign'),
            publicOpinion: opinion('foreign'),
        };
        const legacyFound = mod.restoreBranchSurface(legacyStore, 'legacy-B', {
            fallbackSocial: social('EMPTY'),
            fallbackPublicOpinion: opinion('EMPTY'),
        });

        return {
            aFound,
            bFound,
            a,
            b,
            persistentContainsImageData: serialized.includes('data:image/'),
            dedupe,
            afterRolling,
            afterPrune,
            legacyFound,
            legacyFriend: legacyStore.social.connections[0]?.id,
            legacyNews: legacyStore.publicOpinion.news[0]?.id,
        };
    });

    assert.equal(report.aFound, true);
    assert.equal(report.bFound, true);
    assert.equal(report.a.friend, 'friend-A');
    assert.equal(report.a.news, 'news-A');
    assert.equal(report.a.image, 'data:image/png;base64,AAAA');
    assert.equal(report.a.imageProvider, 'GLOBAL');
    assert.equal(report.a.ui, 'GLOBAL');
    assert.equal(report.b.friend, 'friend-B');
    assert.equal(report.b.news, 'news-B');
    assert.equal(report.b.image, 'data:image/png;base64,BBBB');
    assert.equal(report.persistentContainsImageData, false);
    assert.equal(report.dedupe.socialBlobs, 2, '500 inherited B branches must share existing social blobs');
    assert.equal(report.dedupe.publicOpinionBlobs, 2, '500 inherited B branches must share existing opinion blobs');
    assert.ok(report.afterRolling.socialBlobs <= 3, 'rolling overwrite leaked social payload blobs');
    assert.ok(report.afterRolling.publicOpinionBlobs <= 3, 'rolling overwrite leaked opinion payload blobs');
    assert.equal(report.afterPrune.refs, 3, 'A, B and current root should be the only protected refs after prune');
    assert.equal(report.legacyFound, false);
    assert.equal(report.legacyFriend, 'friend-EMPTY');
    assert.equal(report.legacyNews, 'news-EMPTY');
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(
        process.env.WB_BRANCH_SURFACE_REPORT || 'branch-surface-browser-report.json',
        `${JSON.stringify({ ...report, errors }, null, 2)}\n`,
        'utf8',
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
