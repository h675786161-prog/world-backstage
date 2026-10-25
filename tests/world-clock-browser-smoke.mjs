// Real Chromium rendering of the production UI with a fixture world state.
// No SillyTavern server or model API is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core');
const server = createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body>');
            return;
        }
        const filename = path.resolve(root, '.' + pathname);
        if (!filename.startsWith(root)) throw Error('invalid path');
        res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await readFile(filename));
    } catch {
        res.statusCode = 404;
        res.end();
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
    executablePath: process.env.WB_CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
try {
    for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const checks = await page.evaluate(async () => {
            const core = await import('/core.js');
            const { createWorldBackstageUI } = await import('/ui.js');
            const { PLUGIN_VERSION } = await import('/version.js');
            let state = core.createInitialState({ day: 3, hour: 9, minute: 0 });
            state.clock.precision = 'minute';
            const ui = createWorldBackstageUI({
                getState: () => state,
                getSettings: () => ({ enabled: true, worldSimulationEnabled: true, theme: 'day' }),
                getSyncStatus: () => ({ phase: 'success' }), onAction: () => {}, pluginVersion: PLUGIN_VERSION,
            });
            ui.open();
            const read = () => ({
                mobile: document.querySelector('.wb-mobile-clock-time').textContent.trim(),
                calendar: document.querySelector('.wb-world-calendar').textContent.replace(/\s+/g, ' ').trim(),
                label: document.querySelector('.wb-world-calendar').getAttribute('aria-label'),
                dateTime: document.querySelector('.wb-world-calendar').getAttribute('datetime'),
            });
            const before = read();
            state = core.applySimulationResult(state, { elapsed_minutes: 30 }, {
                timePolicy: 'world', narrativeText: '<details><summary>时间与地点</summary>09:00 · 港区</details>\n半小时后，她听见了敲门声。',
            });
            ui.render();
            const elapsed = read();
            state = core.applySimulationResult(state, { elapsed_minutes: 0 }, {
                timePolicy: 'world', narrativeText: '第二天清晨，她出了门。',
            });
            ui.render();
            const nextDay = read();
            const estimate = { elapsed_minutes: 0, time_resolution: {
                authority: 'estimated_elapsed', scope: 'current', needs_elapsed_estimate: true,
                estimated_minutes: 25, confidence: 'medium', reason: '根据早餐和步行估算。',
            } };
            state = core.applySimulationResult(core.createInitialState({ day: 3 }), estimate, {
                timePolicy: 'world', narrativeText: '她吃完早餐，洗好餐具，然后步行到了街角。',
            });
            ui.render();
            const coarseEstimated = read();
            state = core.setWorldCalendar(state, {
                calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17,
            });
            state.clock.precision = 'date';
            ui.render();
            const dateOnly = read();
            state.clock.precision = 'minute';
            state = core.applySimulationResult(state, estimate, {
                timePolicy: 'world', narrativeText: '她吃完早餐，洗好餐具，然后步行到了街角。',
            });
            ui.render();
            const modelEstimated = read();
            ui.destroy();
            return { before, elapsed, nextDay, dateOnly, coarseEstimated, modelEstimated };
        });
        assert.equal(checks.before.mobile, '09:00');
        assert.equal(checks.elapsed.mobile, '09:30');
        assert.match(checks.elapsed.label, /故事第 3 日 09:30/);
        assert.equal(checks.elapsed.dateTime, null);
        assert.match(checks.nextDay.label, /故事第 4 日.*清晨/);
        assert.equal(checks.nextDay.mobile, '清晨');
        assert.doesNotMatch(checks.nextDay.calendar, /等待|首次校准|06:00/);
        assert.equal(checks.dateOnly.mobile, '钟点未确定');
        assert.doesNotMatch(checks.dateOnly.calendar, /09:17/);
        assert.equal(checks.dateOnly.dateTime, '2138-01-17');
        assert.equal(checks.coarseEstimated.mobile, '+约 25 分钟');
        assert.match(checks.coarseEstimated.label, /故事第 3 日.*本轮按行动估算推进约 25 分钟/);
        assert.equal(checks.coarseEstimated.dateTime, null);
        assert.equal(checks.modelEstimated.mobile, '约 09:42');
        assert.match(checks.modelEstimated.label, /09:42.*按行动估算/);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, checks, pageErrors: errors, passed: true }));
        await page.close();
    }
} finally {
    await browser.close();
    server.close();
}
