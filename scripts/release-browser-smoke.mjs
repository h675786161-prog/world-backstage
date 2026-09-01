import assert from 'node:assert/strict';

const playwrightEntry = process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core';
const { chromium } = await import(playwrightEntry);
const url = process.env.WB_TAVERN_URL || 'http://127.0.0.1:8020/';
const executablePath = process.env.WB_BROWSER_EXECUTABLE;
assert.ok(executablePath, 'WB_BROWSER_EXECUTABLE is required');

const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const report = { url, views: [], pageErrors: [], consoleErrors: [] };
try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        page.on('pageerror', error => report.pageErrors.push(String(error?.stack || error)));
        page.on('console', message => {
            if (message.type() === 'error' && /世界背面|world[-_ ]?backstage/i.test(message.text())) {
                report.consoleErrors.push(message.text());
            }
        });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
        await page.waitForSelector('#world-backstage-root', { timeout: 30_000, state: 'attached' });
        const result = await page.evaluate(() => {
            const root = document.querySelector('#world-backstage-root');
            const panel = root?.querySelector('.wb-shell, .wb-panel, [class*="shell"]');
            const title = root?.querySelector('.wb-brand, .wb-title, header');
            return {
                root: Boolean(root),
                updater: Boolean(root?.querySelector('[data-wb-action*="update"], #wb-update-manager-button')),
                bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
                panelOverflow: panel ? panel.scrollWidth > panel.clientWidth + 2 : false,
                titleOverflow: title ? title.scrollWidth > title.clientWidth + 2 : false,
            };
        });
        report.views.push({ viewport, ...result });
        await page.close();
    }
    assert.ok(report.views.every(view => view.root), 'world-backstage root did not mount');
    assert.ok(report.views.every(view => !view.updater), 'test updater leaked into formal UI');
    assert.ok(report.views.every(view => !view.titleOverflow), 'title area overflowed');
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, []);
    console.log(JSON.stringify(report));
} finally {
    await browser.close();
}
