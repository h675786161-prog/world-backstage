const { chromium } = await import(process.env.LAB_PLAYWRIGHT_CORE_ENTRY);
const baseUrl = process.env.LAB_ST_URL;
const evidenceDir = process.env.LAB_EVIDENCE_DIR;

const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LAB_CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: false,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
        () => Boolean(globalThis.__worldBackstageLoaded && globalThis.worldBackstageHost),
        null,
        { timeout: 30_000 },
    );
    await page.waitForFunction(
        () => Boolean(
            document.getElementById('wb-tablet-responsive-adapter-v1')
            && document.getElementById('wb-tablet-height-guard-v4')
        ),
        null,
        { timeout: 15_000 },
    );

    await page.evaluate(() => globalThis.worldBackstageHost.open());
    await page.waitForSelector('#world-backstage-root .wb-window', { state: 'visible', timeout: 10_000 });

    const results = [];
    for (const viewport of [
        { width: 768, height: 1024 },
        { width: 820, height: 1180 },
    ]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(220);
        const snapshot = await page.evaluate(() => {
            const root = document.getElementById('world-backstage-root');
            const win = root?.querySelector('.wb-window');
            const body = root?.querySelector('.wb-window-body');
            const rect = node => {
                const r = node?.getBoundingClientRect?.();
                return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
            };
            return {
                classes: root ? [...root.classList] : [],
                windowRect: rect(win),
                bodyRect: rect(body),
            };
        });

        assert(snapshot.classes.includes('wb-tablet-mode'), `${viewport.width}x${viewport.height}: tablet mode missing`);
        assert(snapshot.classes.includes('wb-tablet-portrait'), `${viewport.width}x${viewport.height}: portrait mode missing`);
        assert(snapshot.windowRect?.height >= viewport.height - 30, `${viewport.width}x${viewport.height}: window collapsed (${snapshot.windowRect?.height}px)`);
        assert(snapshot.bodyRect?.height >= viewport.height - 120, `${viewport.width}x${viewport.height}: body collapsed (${snapshot.bodyRect?.height}px)`);
        assert(snapshot.windowRect.y >= 0 && snapshot.windowRect.bottom <= viewport.height + 1, `${viewport.width}x${viewport.height}: window exceeds viewport`);
        results.push({ viewport, snapshot });
    }

    const settingsButton = page.locator('[data-wb-action="toggle-settings"]').first();
    assert(await settingsButton.count(), 'Settings button not rendered');
    await settingsButton.evaluate(el => el.click());
    await page.waitForSelector('#world-backstage-root .wb-settings-popover', { state: 'visible', timeout: 8_000 });
    await page.waitForTimeout(160);

    const settings = await page.evaluate(() => {
        const layer = document.querySelector('#world-backstage-root .wb-settings-layer');
        const pop = document.querySelector('#world-backstage-root .wb-settings-popover');
        const r = pop?.getBoundingClientRect();
        const lr = layer?.getBoundingClientRect();
        return r ? {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
            clientWidth: pop.clientWidth,
            scrollWidth: pop.scrollWidth,
            clientHeight: pop.clientHeight,
            scrollHeight: pop.scrollHeight,
            layer: lr ? { x: lr.x, y: lr.y, width: lr.width, height: lr.height, right: lr.right, bottom: lr.bottom } : null,
        } : null;
    });

    assert(settings, 'Settings popover missing');
    assert(settings.height >= 400, `Portrait settings popover collapsed (${settings.height}px)`);
    assert(settings.y >= 0, `Portrait settings popover starts offscreen (${settings.y}px)`);
    assert(settings.right <= 821 && settings.bottom <= 1181, `Portrait settings popover exceeds viewport: ${JSON.stringify(settings)}`);
    assert(settings.scrollWidth <= settings.clientWidth + 2, `Portrait settings has horizontal overflow: ${JSON.stringify(settings)}`);
    assert(pageErrors.length === 0, `Browser page errors detected: ${pageErrors.join(' | ')}`);

    await page.screenshot({ path: `${evidenceDir}/tablet-portrait-height-820x1180.png`, fullPage: false });
    console.log(JSON.stringify({ portraitHeightGuard: results, settings, pageErrors }, null, 2));
} finally {
    await context.close();
    await browser.close();
}
