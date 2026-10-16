import fs from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.LAB_PLAYWRIGHT_CORE_ENTRY);
const baseUrl = process.env.LAB_ST_URL;
const evidenceDir = process.env.LAB_EVIDENCE_DIR;

const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LAB_CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: false,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const matrix = [
    { name: 'phone-control', width: 390, height: 844, tablet: false },
    { name: 'tablet-portrait-768', width: 768, height: 1024, tablet: true, portrait: true },
    { name: 'tablet-portrait-820', width: 820, height: 1180, tablet: true, portrait: true },
    { name: 'tablet-landscape-1024', width: 1024, height: 768, tablet: true, landscape: true },
    { name: 'tablet-short-1024', width: 1024, height: 600, tablet: true, landscape: true, short: true },
    { name: 'tablet-landscape-1180', width: 1180, height: 820, tablet: true, landscape: true },
    { name: 'tablet-landscape-1366', width: 1366, height: 768, tablet: true, landscape: true },
    { name: 'desktop-control', width: 1440, height: 1000, tablet: false },
];

const report = {
    manifestVersion: null,
    matrix: [],
    settings: null,
    social: null,
    pageErrors,
};

try {
    await fs.mkdir(evidenceDir, { recursive: true });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
        () => Boolean(globalThis.__worldBackstageLoaded && globalThis.worldBackstageHost),
        null,
        { timeout: 30_000 },
    );
    await page.waitForFunction(
        () => Boolean(document.getElementById('wb-tablet-responsive-adapter-v1')),
        null,
        { timeout: 15_000 },
    );

    report.manifestVersion = await page.evaluate(async () => {
        const response = await fetch('/scripts/extensions/third-party/world-backstage/manifest.json', { cache: 'no-store' });
        return (await response.json()).version;
    });
    assert(report.manifestVersion === '2.6.1', `Expected manifest version 2.6.1, got ${report.manifestVersion}`);

    await page.evaluate(() => globalThis.worldBackstageHost.open());
    await page.waitForSelector('#world-backstage-root .wb-window', { state: 'visible', timeout: 10_000 });

    for (const item of matrix) {
        await page.setViewportSize({ width: item.width, height: item.height });
        await page.waitForTimeout(220);

        const snapshot = await page.evaluate(() => {
            const root = document.getElementById('world-backstage-root');
            const win = root?.querySelector('.wb-window');
            const body = root?.querySelector('.wb-window-body');
            const header = root?.querySelector('.wb-window-header');
            const side = root?.querySelector('.wb-side-nav');
            const rect = node => {
                const r = node?.getBoundingClientRect?.();
                return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
            };
            return {
                viewport: { width: innerWidth, height: innerHeight },
                classes: root ? [...root.classList] : [],
                mode: root?.dataset?.wbResponsiveMode || '',
                windowRect: rect(win),
                bodyRect: rect(body),
                sideRect: rect(side),
                bodyColumns: body ? getComputedStyle(body).gridTemplateColumns : '',
                headerHeight: header ? parseFloat(getComputedStyle(header).height) : 0,
                sideOverflowY: side ? getComputedStyle(side).overflowY : '',
            };
        });

        const hasTablet = snapshot.classes.includes('wb-tablet-mode');
        assert(hasTablet === item.tablet, `${item.name}: tablet mode mismatch: ${JSON.stringify(snapshot)}`);
        assert(Boolean(snapshot.windowRect), `${item.name}: missing window`);
        assert(snapshot.windowRect.x >= -1 && snapshot.windowRect.y >= -1, `${item.name}: window starts outside viewport`);
        assert(snapshot.windowRect.right <= item.width + 1, `${item.name}: window overflows right edge`);
        assert(snapshot.windowRect.bottom <= item.height + 1, `${item.name}: window overflows bottom edge`);

        if (item.tablet) {
            assert(snapshot.mode === 'tablet', `${item.name}: responsive mode dataset missing`);
            if (item.portrait) {
                assert(snapshot.classes.includes('wb-tablet-portrait'), `${item.name}: portrait class missing`);
                assert(!snapshot.classes.includes('wb-tablet-landscape'), `${item.name}: unexpected landscape class`);
                assert(snapshot.sideRect?.width <= 80.5, `${item.name}: portrait sidebar too wide (${snapshot.sideRect?.width})`);
            }
            if (item.landscape) {
                assert(snapshot.classes.includes('wb-tablet-landscape'), `${item.name}: landscape class missing`);
                assert(snapshot.sideRect?.width <= 90.5, `${item.name}: landscape sidebar too wide (${snapshot.sideRect?.width})`);
            }
            if (item.short) {
                assert(snapshot.classes.includes('wb-tablet-short'), `${item.name}: short landscape class missing`);
                assert(snapshot.headerHeight <= 63, `${item.name}: short-landscape header remained too tall (${snapshot.headerHeight})`);
            }
        }

        report.matrix.push({ ...item, snapshot });
        if (['tablet-portrait-820', 'tablet-landscape-1024', 'tablet-short-1024', 'tablet-landscape-1366'].includes(item.name)) {
            await page.screenshot({ path: path.join(evidenceDir, `${item.name}.png`), fullPage: false });
        }
    }

    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(180);
    const settingsButton = page.locator('[data-wb-action="toggle-settings"]').first();
    assert(await settingsButton.count(), 'Settings button not rendered');
    await settingsButton.evaluate(el => el.click());
    await page.waitForSelector('#world-backstage-root .wb-settings-popover', { state: 'visible', timeout: 8_000 });
    await page.waitForTimeout(120);

    report.settings = await page.evaluate(() => {
        const pop = document.querySelector('#world-backstage-root .wb-settings-popover');
        const r = pop?.getBoundingClientRect();
        return r ? {
            x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            clientWidth: pop.clientWidth,
            scrollWidth: pop.scrollWidth,
            clientHeight: pop.clientHeight,
            scrollHeight: pop.scrollHeight,
        } : null;
    });
    assert(report.settings, 'Settings popover missing');
    assert(report.settings.width <= 681, `Settings popover too wide: ${report.settings.width}`);
    assert(report.settings.x >= -1 && report.settings.right <= 821, `Settings popover overflows horizontally: ${JSON.stringify(report.settings)}`);
    assert(report.settings.bottom <= 1181, `Settings popover overflows vertically: ${JSON.stringify(report.settings)}`);
    assert(report.settings.scrollWidth <= report.settings.clientWidth + 2, `Settings popover has horizontal overflow: ${JSON.stringify(report.settings)}`);
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-settings-820x1180.png'), fullPage: false });
    await settingsButton.evaluate(el => el.click());
    await page.waitForTimeout(120);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(160);
    const socialButton = page.locator('#world-backstage-root .wb-side-nav button').filter({ hasText: '通讯' }).first();
    assert(await socialButton.count(), 'Social navigation button not rendered');
    await socialButton.evaluate(el => el.click());
    await page.waitForSelector('#world-backstage-root .wb-social-shell', { state: 'visible', timeout: 8_000 });
    await page.waitForTimeout(220);

    report.social = await page.evaluate(() => {
        const layout = document.querySelector('#world-backstage-root .wb-social-layout');
        const shell = document.querySelector('#world-backstage-root .wb-social-shell');
        const sidebar = document.querySelector('#world-backstage-root .wb-social-sidebar');
        const thread = document.querySelector('#world-backstage-root .wb-social-thread');
        const rect = node => {
            const r = node?.getBoundingClientRect?.();
            return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
        };
        return {
            layoutClasses: layout ? [...layout.classList] : [],
            shell: rect(shell),
            layout: rect(layout),
            sidebar: rect(sidebar),
            thread: rect(thread),
            sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : '',
            threadDisplay: thread ? getComputedStyle(thread).display : '',
        };
    });
    assert(report.social?.shell && report.social?.layout, 'Social layout did not render');
    assert(report.social.layout.right <= report.social.shell.right + 1, 'Social layout overflows shell right edge');
    assert(report.social.layout.width <= report.social.shell.width + 1, 'Social layout wider than shell');
    assert(report.social.layoutClasses.includes('wb-social-adaptive-split'), `Expected split social layout at 1024px: ${JSON.stringify(report.social)}`);
    assert(report.social.sidebarDisplay !== 'none' && report.social.threadDisplay !== 'none', 'Social split columns are not both visible');
    await page.screenshot({ path: path.join(evidenceDir, 'tablet-social-1024x768.png'), fullPage: false });

    assert(pageErrors.length === 0, `Browser page errors detected: ${pageErrors.join(' | ')}`);
    await fs.writeFile(path.join(evidenceDir, 'tablet-runtime-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    await fs.writeFile(path.join(evidenceDir, 'tablet-runtime-report.json'), JSON.stringify({ ...report, error: String(error?.stack || error) }, null, 2));
    throw error;
} finally {
    await context.close();
    await browser.close();
}
