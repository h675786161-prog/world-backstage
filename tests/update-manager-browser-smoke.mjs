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
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const pluginConsoleErrors = [];
const pageErrors = [];
const versionBodies = [];
const updateBodies = [];

page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/世界背面|world[-_ ]?backstage/i.test(text)) pluginConsoleErrors.push(text);
});
page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));
page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname !== '/api/extensions/version' && url.pathname !== '/api/extensions/update') return;
    let body = null;
    try {
        body = request.postDataJSON();
    } catch {
        body = request.postData();
    }
    if (url.pathname.endsWith('/version')) versionBodies.push(body);
    if (url.pathname.endsWith('/update')) updateBodies.push(body);
});

await page.addInitScript(() => {
    localStorage.setItem('world-backstage:update-manager:world-backstage-test', JSON.stringify({
        lastCheckedAt: Date.now(),
        updateAvailable: false,
        dismissedAt: 0,
        branch: 'main',
        remoteUrl: '',
    }));
});

const report = {
    url: process.env.WB_TAVERN_URL || 'http://127.0.0.1:8000/',
    pluginRoot: false,
    onboardingDismissed: false,
    blockingDialogsClosed: 0,
    mamaNoteDismissed: false,
    versionBodies,
    updateBodies,
    beforeUpdate: null,
    afterUpdate: null,
    noticeVisible: false,
    refreshVisible: false,
    markerVisible: false,
    markerText: '',
    pluginConsoleErrors,
    pageErrors,
};

async function dismissFirstRunOnboarding() {
    const saveCandidates = page.locator('button, .menu_button, input[type="button"], input[type="submit"]');
    const saveCount = await saveCandidates.count();
    for (let index = 0; index < saveCount; index += 1) {
        const candidate = saveCandidates.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = ((await candidate.innerText().catch(() => '')) || (await candidate.getAttribute('value')) || '').trim();
        if (text !== 'Save') continue;
        await candidate.click();
        await page.waitForTimeout(500);
        return true;
    }
    return false;
}

async function clearUnrelatedTavernDialogs() {
    return page.evaluate(() => {
        let closed = 0;
        for (const dialog of document.querySelectorAll('dialog[open]')) {
            try {
                dialog.close();
            } catch {
                dialog.removeAttribute('open');
            }
            closed += 1;
        }
        return closed;
    });
}

async function dismissMamaNote() {
    const close = page.locator('#wb-mama-note-modal [data-wb-mama-note-close]');
    if (!(await close.isVisible().catch(() => false))) return false;
    await close.click();
    await page.waitForSelector('#wb-mama-note-modal', { state: 'detached', timeout: 10_000 });
    return true;
}

try {
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
    await page.waitForSelector('#world-backstage-root', { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(globalThis.worldBackstageUpdateManager), null, { timeout: 30_000 });
    report.pluginRoot = true;
    report.onboardingDismissed = await dismissFirstRunOnboarding();
    await page.waitForTimeout(300);
    report.blockingDialogsClosed = await clearUnrelatedTavernDialogs();
    await page.waitForTimeout(900);
    report.mamaNoteDismissed = await dismissMamaNote();

    const initial = await page.evaluate(() => globalThis.worldBackstageUpdateManager.getStatus());
    assert.equal(initial.currentVersion, '2.5.7');
    assert.equal(initial.extensionName, 'world-backstage-test');

    // localStorage was deliberately seeded as "just checked". The per-session guard must still
    // perform one real native version request, otherwise a new commit made minutes later is invisible.
    await page.waitForSelector('#world-backstage-update-notice [data-wb-update-now]', { state: 'visible', timeout: 15_000 });
    report.beforeUpdate = await page.evaluate(() => globalThis.worldBackstageUpdateManager.getStatus());
    report.noticeVisible = true;

    assert.equal(report.beforeUpdate.updateAvailable, true);
    assert.equal(updateBodies.length, 0, 'automatic discovery must never install an update');
    assert.ok(versionBodies.length >= 1, 'fresh Tavern session must reach the native version endpoint even after a recent prior check');
    assert.ok(versionBodies.every(body => body?.extensionName === 'world-backstage-test'));

    await page.click('#world-backstage-update-notice [data-wb-update-now]');
    await page.waitForFunction(() => globalThis.worldBackstageUpdateManager.getStatus().phase === 'updated', null, { timeout: 15_000 });
    await page.waitForSelector('#world-backstage-update-notice [data-wb-update-reload]', { state: 'visible', timeout: 10_000 });
    report.refreshVisible = true;
    report.afterUpdate = await page.evaluate(() => globalThis.worldBackstageUpdateManager.getStatus());

    assert.equal(updateBodies.length, 1, 'update endpoint should run only after the user clicks the update button');
    assert.equal(updateBodies[0]?.extensionName, 'world-backstage-test');
    assert.equal(report.afterUpdate.phase, 'updated');
    assert.equal(report.afterUpdate.updateAvailable, false);

    const markerResponse = await page.request.get(`${report.url}scripts/extensions/third-party/world-backstage-test/wb-update-marker.txt`);
    report.markerVisible = markerResponse.ok();
    report.markerText = report.markerVisible ? (await markerResponse.text()).trim() : '';
    assert.equal(report.markerVisible, true, 'native updater must actually pull the remote marker into the extension directory');
    assert.equal(report.markerText, 'real updater pull passed');
    assert.deepEqual(pluginConsoleErrors, []);
    assert.deepEqual(pageErrors, []);
} finally {
    fs.writeFileSync(
        process.env.WB_UPDATE_REPORT || 'update-manager-runtime-report.json',
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
