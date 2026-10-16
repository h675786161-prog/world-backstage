// Real SillyTavern + real Chromium text-driven world-clock QA.
// Each case places the narrative text in the active ST chat, settles it with the
// production core, opens the production UI, and reads what a user would see.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core');
const base = process.env.WB_TAVERN_URL || 'http://127.0.0.1:8000';
const evidence = process.env.WB_CLOCK_EVIDENCE || 'world-clock-real-evidence';
await fs.mkdir(evidence, { recursive: true });

const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.WB_CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

const report = { startedAt: new Date().toISOString(), cases: [], pageErrors };

async function runCase(name, setup, text, payload) {
    const result = await page.evaluate(async ({ name, setup, text, payload }) => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');

        context.chat.splice(0, context.chat.length,
            { name: context.name1, is_user: true, is_system: false, mes: `LAB：${name}`, extra: {} },
            { name: context.name2, is_user: false, is_system: false, mes: text, extra: {} },
        );

        let state = core.createInitialState({
            day: setup.day ?? 3,
            hour: setup.hour ?? 9,
            minute: setup.minute ?? 17,
        });
        if (setup.calendar) state = core.setWorldCalendar(state, setup.calendar);
        state.clock.precision = setup.precision;
        state.clock.daypart = setup.daypart || '';

        const before = {
            absoluteMinute: state.clock.absoluteMinute,
            precision: state.clock.precision,
            daypart: state.clock.daypart,
            calendar: core.formatWorldCalendar(state),
        };

        state = core.applySimulationResult(state, payload, {
            timePolicy: 'world',
            narrativeText: text,
            messageId: 1,
            swipeId: 0,
            sourceKey: `lab-real-clock:${name}`,
            userName: context.name1 || '',
            allowUserInnerVoice: false,
        });

        const store = context.chatMetadata[core.STATE_KEY];
        if (!store) throw new Error('World Backstage state store missing in real ST chat');
        store.currentState = state;
        globalThis.worldBackstageHost.close();
        globalThis.worldBackstageHost.open();
        await new Promise(resolve => setTimeout(resolve, 180));

        const mobile = document.querySelector('.wb-mobile-clock-time');
        const calendar = document.querySelector('.wb-world-calendar');
        return {
            before,
            after: {
                absoluteMinute: state.clock.absoluteMinute,
                precision: state.clock.precision,
                daypart: state.clock.daypart,
                calendar: core.formatWorldCalendar(state),
                mobileText: mobile?.textContent?.trim() || '',
                mobileLabel: mobile?.getAttribute('aria-label') || '',
                calendarText: calendar?.textContent?.replace(/\s+/g, ' ')?.trim() || '',
                calendarLabel: calendar?.getAttribute('aria-label') || '',
                chatText: context.chat.at(-1)?.mes || '',
            },
        };
    }, { name, setup, text, payload });

    assert.equal(result.after.chatText, text, `${name}: narrative text did not enter the real ST chat`);
    const screenshot = path.join(evidence, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.cases.push({ name, text, payload, ...result, screenshot });
    return result;
}

try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.__worldBackstageLoaded && globalThis.worldBackstageHost), null, { timeout: 30_000 });

    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        if (!context.characters.length) {
            const response = await fetch('/api/characters/create', {
                method: 'POST',
                headers: { ...context.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ch_name: 'LAB世界钟实机角色',
                    description: '隔离 LAB 世界钟文本回归。',
                    first_mes: '开始测试。',
                }),
            });
            if (!response.ok) throw new Error(`Could not create LAB character: ${response.status}`);
            const { getCharacters } = await import('/script.js');
            await getCharacters();
        }
        const loaded = globalThis.SillyTavern.getContext();
        await loaded.selectCharacterById(0);
    });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern.getContext().chatId));
    await page.waitForTimeout(350);

    const trailing = await runCase(
        '01-trailing-exact-refines-date',
        {
            precision: 'date',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        '她整理完桌上的文件，把最后一页压进夹子。\n<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        { elapsed_minutes: 0 },
    );
    assert.equal(trailing.after.precision, 'minute');
    assert.equal(trailing.after.mobileText, '09:00');
    assert.equal(trailing.after.absoluteMinute, trailing.before.absoluteMinute - 17);

    const noRewind = await runCase(
        '02-known-minute-never-rewinds',
        {
            precision: 'minute',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        '她抬头看了一眼墙上的钟。\n<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        { elapsed_minutes: 0 },
    );
    assert.equal(noRewind.after.mobileText, '09:17');
    assert.equal(noRewind.after.absoluteMinute, noRewind.before.absoluteMinute);

    const opening = await runCase(
        '03-opening-clock-does-not-eat-actions',
        {
            precision: 'date',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>\n她吃完早餐，洗好餐具，又步行去了街角。',
        { elapsed_minutes: 25 },
    );
    assert.equal(opening.after.absoluteMinute, opening.before.absoluteMinute + 25);
    assert.notEqual(opening.after.mobileText, '09:00');

    const estimated = await runCase(
        '04-daypart-plus-estimated-progress',
        { precision: 'daypart', daypart: '上午', day: 3, hour: 9, minute: 0 },
        '她吃完早餐，洗好餐具，然后步行到了街角。',
        {
            elapsed_minutes: 0,
            time_resolution: {
                authority: 'estimated_elapsed',
                scope: 'current',
                needs_elapsed_estimate: true,
                estimated_minutes: 25,
                confidence: 'medium',
                reason: '根据早餐和步行估算。',
            },
        },
    );
    assert.equal(estimated.after.precision, 'daypart');
    assert.equal(estimated.after.daypart, '上午');
    assert.equal(estimated.after.mobileText, '上午 · +约 25 分钟');
    assert.match(estimated.after.mobileLabel, /上午.*本轮按行动估算推进约 25 分钟/u);

    const nextDay = await runCase(
        '05-next-day-morning',
        { precision: 'minute', day: 3, hour: 22, minute: 0 },
        '夜色沉下去。\n第二天清晨，她被敲门声叫醒。',
        { elapsed_minutes: 0 },
    );
    assert.equal(nextDay.after.precision, 'daypart');
    assert.equal(nextDay.after.daypart, '清晨');
    assert.equal(nextDay.after.mobileText, '清晨');
    assert.ok(nextDay.after.absoluteMinute > nextDay.before.absoluteMinute);

    const sequential = await runCase(
        '06-sequential-elapsed-text',
        { precision: 'minute', day: 3, hour: 9, minute: 0 },
        '过了2小时，她吃完饭。\n又过了30分钟，她出了门。',
        { elapsed_minutes: 0 },
    );
    assert.equal(sequential.after.absoluteMinute, sequential.before.absoluteMinute + 150);
    assert.equal(sequential.after.mobileText, '11:30');

    await page.setViewportSize({ width: 1280, height: 900 });
    // Re-run the UI-specific case at desktop width instead of merely resizing the
    // last scenario, so both layouts actually render the same factual daypart.
    const desktopEstimated = await runCase(
        '07-desktop-daypart-plus-estimated-progress',
        { precision: 'daypart', daypart: '上午', day: 3, hour: 9, minute: 0 },
        '她吃完早餐，洗好餐具，然后步行到了街角。',
        {
            elapsed_minutes: 0,
            time_resolution: {
                authority: 'estimated_elapsed', scope: 'current', needs_elapsed_estimate: true,
                estimated_minutes: 25, confidence: 'medium', reason: '根据早餐和步行估算。',
            },
        },
    );
    assert.equal(desktopEstimated.after.mobileText, '上午 · +约 25 分钟');
    assert.match(desktopEstimated.after.calendarText, /上午.*\+约 25 分钟/u);

    assert.deepEqual(pageErrors, []);
    report.passed = true;
} catch (error) {
    report.passed = false;
    report.error = String(error?.stack || error);
    throw error;
} finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(
        path.join(evidence, 'world-clock-real-sillytavern.json'),
        JSON.stringify(report, null, 2),
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
