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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
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
    scenarios: {},
    pluginConsoleErrors,
    pageErrors,
};

try {
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
    await page.waitForSelector('#world-backstage-root', { timeout: 30_000 });
    report.pluginRoot = true;

    const scenarios = await page.evaluate(async () => {
        const mod = await import('/scripts/extensions/third-party/world-backstage-test/core.js');

        const add = (state, event) => mod.addManualEvent(state, event);
        const settings = (deliveryDensity, sceneTiming) => ({
            enabled: true,
            worldSimulationEnabled: true,
            worldPromptInjection: true,
            deliveryDensity,
            sceneTiming,
        });

        let state = mod.createInitialState();
        state = add(state, {
            id: 'direct-doorbell',
            title: '门外来访',
            place: '公寓门口',
            summary: '门铃正在响。',
            consequence: '屋内的人已经能直接听见门铃。',
            status: 'active',
            visibility: 'direct',
        });
        state = add(state, {
            id: 'east-port-rain',
            title: '东港持续暴雨',
            place: '东港',
            summary: '强降雨正在造成路面积水和车辆绕行。',
            consequence: '东港道路通行明显变慢。',
            status: 'active',
            visibility: 'trace',
        });
        state = add(state, {
            id: 'secret-tail',
            title: '秘密跟踪',
            place: '东港',
            summary: '一名未知人物正在暗中跟踪目标。',
            consequence: '跟踪行为持续，但尚未暴露。',
            status: 'active',
            visibility: 'hidden',
        });
        state = add(state, {
            id: 'west-market-delay',
            title: '西市配送延迟',
            place: '西市',
            summary: '几家商铺的配送正在延迟。',
            consequence: '西市到货时间推迟。',
            status: 'active',
            visibility: 'trace',
        });

        const restrained = mod.buildInjectionPackage(
            state,
            settings('restrained', 'strict'),
            '我还坐在客厅里。',
            { contextText: '我还坐在客厅里。' },
        );
        const balanced = mod.buildInjectionPackage(
            state,
            settings('balanced', 'smart'),
            '我准备开车去东港。',
            { contextText: '我准备开车去东港。' },
        );
        const active = mod.buildInjectionPackage(
            state,
            settings('active', 'open'),
            '我正在东港散步。',
            { contextText: '我正在东港散步。' },
        );

        const pick = packet => ({
            liveInfluenceIds: packet.liveInfluenceIds,
            eventIds: packet.eventIds,
            supportText: packet.supportText,
            authorityText: packet.authorityText,
        });

        return {
            restrained: pick(restrained),
            balanced: pick(balanced),
            active: pick(active),
        };
    });

    report.scenarios = scenarios;

    assert.deepEqual(scenarios.restrained.liveInfluenceIds, ['direct-doorbell']);
    assert.equal(scenarios.restrained.supportText.includes('西市配送延迟'), false);
    assert.equal(scenarios.restrained.supportText.includes('秘密跟踪'), false);

    assert.ok(scenarios.balanced.liveInfluenceIds.includes('east-port-rain'));
    assert.equal(scenarios.balanced.eventIds.includes('east-port-rain'), false);
    assert.equal(scenarios.balanced.supportText.includes('秘密跟踪'), false);

    assert.ok(scenarios.active.liveInfluenceIds.includes('east-port-rain'));
    assert.equal(scenarios.active.liveInfluenceIds.includes('secret-tail'), false);
    assert.equal(scenarios.active.supportText.includes('秘密跟踪'), false);
    assert.match(scenarios.active.authorityText, /秘密跟踪/);
    assert.match(scenarios.active.authorityText, /hidden 事件.*不得泄漏幕后原因.*不知情角色突然知道/);

    assert.equal(pluginConsoleErrors.length, 0, `plugin console errors: ${pluginConsoleErrors.join('\n')}`);
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('\n')}`);

    // First-run SillyTavern onboarding can cover the evidence panel. Close it if present.
    const saveCandidates = page.locator('button, .menu_button, input[type="button"], input[type="submit"]');
    const saveCount = await saveCandidates.count();
    for (let index = 0; index < saveCount; index += 1) {
        const candidate = saveCandidates.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = ((await candidate.innerText().catch(() => '')) || (await candidate.getAttribute('value')) || '').trim();
        if (text !== 'Save') continue;
        await candidate.click().catch(() => {});
        await page.waitForTimeout(500);
        break;
    }

    await page.evaluate(result => {
        document.querySelector('#wb-foreground-impact-qa')?.remove();
        const box = document.createElement('section');
        box.id = 'wb-foreground-impact-qa';
        box.style.cssText = [
            'position:fixed',
            'right:24px',
            'bottom:24px',
            'z-index:2147483647',
            'width:min(560px,calc(100vw - 48px))',
            'max-height:78vh',
            'overflow:auto',
            'padding:16px 18px',
            'border-radius:18px',
            'background:rgba(16,18,24,.94)',
            'color:#f4f4f5',
            'box-shadow:0 18px 60px rgba(0,0,0,.45)',
            'font:14px/1.55 system-ui,sans-serif',
            'border:1px solid rgba(255,255,255,.14)',
            'backdrop-filter:blur(14px)',
        ].join(';');

        const items = [
            ['Restrained / living room', result.restrained],
            ['Balanced / drive to East Port', result.balanced],
            ['Active / walk in East Port', result.active],
        ];
        const rows = items.map(([label, value]) => {
            const influences = value.liveInfluenceIds.length ? value.liveInfluenceIds.join(', ') : 'none';
            return `<div style="padding:12px 0;border-top:1px solid rgba(255,255,255,.1)">
                <div style="font-weight:750;margin-bottom:5px">${label}</div>
                <div>Foreground influence: <code>${influences}</code></div>
            </div>`;
        }).join('');

        const hiddenInSupport = result.active.supportText.includes('秘密跟踪');
        const hiddenInAuthority = result.active.authorityText.includes('秘密跟踪');
        box.innerHTML = `
            <div style="font-size:18px;font-weight:850;margin-bottom:2px">World Backstage - Experiment Tavern QA</div>
            <div style="opacity:.72;margin-bottom:9px">SillyTavern 1.18.0 / current test main</div>
            ${rows}
            <div style="padding-top:11px;border-top:1px solid rgba(255,255,255,.1)">
                <div><code>secret-tail</code> in foreground support: <b>${hiddenInSupport}</b></div>
                <div><code>secret-tail</code> retained in backstage authority: <b>${hiddenInAuthority}</b></div>
                <div style="opacity:.8;margin-top:5px">Plugin console errors: 0 / Page errors: 0</div>
            </div>`;
        document.body.appendChild(box);
    }, scenarios);

    await page.screenshot({
        path: process.env.WB_FOREGROUND_SCREENSHOT || 'foreground-impact-runtime.png',
        fullPage: true,
    });
} finally {
    fs.writeFileSync(
        process.env.WB_FOREGROUND_REPORT || 'foreground-impact-runtime-report.json',
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
