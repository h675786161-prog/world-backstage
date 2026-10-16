// Real SillyTavern + real Chromium world-clock text scenarios.
// This intentionally puts narrative strings into the active ST chat, then runs
// the same production settlement function the extension uses for that assistant turn.
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

async function capture(name) {
    const file = path.join(evidence, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
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
                    description: '仅用于隔离 LAB 世界钟文本回归。',
                    first_mes: '世界钟实机测试开始。',
                }),
            });
            if (!response.ok) throw new Error(`Could not create LAB clock character: ${response.status}`);
            const { getCharacters } = await import('/script.js');
            await getCharacters();
        }
        const loaded = globalThis.SillyTavern.getContext();
        await loaded.selectCharacterById(0);
    });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern.getContext().chatId));
    await page.waitForTimeout(300);

    const runCase = async ({ name, setup, text, payload, expected }) => {
        const result = await page.evaluate(async ({ setup, text, payload }) => {
            const context = globalThis.SillyTavern.getContext();
            const core = await import('/scripts/extensions/third-party/world-backstage/core.js');

            context.chat.splice(0, context.chat.length,
                { name: context.name1, is_user: true, is_system: false, mes: `LAB case: ${setup.label}`, extra: {} },
                { name: context.name2, is_user: false, is_system: false, mes: text, extra: {} },
            );

            let state = core.createInitialState({ day: setup.day ?? 3, hour: setup.hour ?? 9, minute: setup.minute ?? 17 });
            if (setup.calendar) {
                state = core.setWorldCalendar(state, setup.calendar);
            }
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
                sourceKey: `lab-clock:${setup.label}`,
                userName: context.name1 || '',
                allowUserInnerVoice: false,
            });

            const store = context.chatMetadata[core.STATE_KEY];
            if (!store) throw new Error('World Backstage state store missing in real ST chat');
            store.currentState = state;

            globalThis.worldBackstageHost.close();
            globalThis.worldBackstageHost.open();
            await new Promise(resolve => setTimeout(resolve, 120));

            const mobile = document.querySelector('.wb-mobile-clock-time');
            const calendar = document.querySelector('.wb-world-calendar');
            const after = {
                absoluteMinute: state.clock.absoluteMinute,
                precision: state.clock.precision,
                daypart: state.clock.daypart,
                calendar: core.formatWorldCalendar(state),
                mobileText: mobile?.textContent?.trim() || '',
                mobileLabel: mobile?.getAttribute?.('aria-label') || '',
                calendarText: calendar?.textContent?.replace(/\s+/g, ' ')?.trim() || '',
                calendarLabel: calendar?.getAttribute?.('aria-label') || '',
                chatText: context.chat.at(-1)?.mes || '',
            };
            return { before, after };
        }, { setup, text, payload });

        for (const [key, value] of Object.entries(expected)) {
            if (value?.kind === 'match') assert.match(String(result.after[key] ?? ''), new RegExp(value.pattern, value.flags || 'u'), `${name}: ${key}`);
            else if (value?.kind === 'notMatch') assert.doesNotMatch(String(result.after[key] ?? ''), new RegExp(value.pattern, value.flags || 'u'), `${name}: ${key}`);
            else assert.equal(result.after[key], value, `${name}: ${key}`);
        }
        assert.equal(result.after.chatText, text, `${name}: text was not actually present in ST chat`);
        const screenshot = await capture(name);
        report.cases.push({ name, text, payload, expected, ...result, screenshot, passed: true });
    };

    await runCase({
        name: '01-trailing-exact-refines-date',
        setup: {
            label: '日期精度 + 末尾明确钟点',
            precision: 'date',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        text: '她整理完桌上的文件，把最后一页压进夹子。\n<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        payload: { elapsed_minutes: 0 },
        expected: { precision: 'minute', mobileText: '09:00' },
    });

    await runCase({
        name: '02-known-minute-never-rewinds',
        setup: {
            label: '分钟精度 + 更早钟点',
            precision: 'minute',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        text: '她抬头看了一眼墙上的钟。\n<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>',
        payload: { elapsed_minutes: 0 },
        expected: { precision: 'minute', mobileText: '09:17' },
    });

    await runCase({
        name: '03-opening-clock-does-not-eat-actions',
        setup: {
            label: '开头时间栏 + 后续行动耗时',
            precision: 'date',
            calendar: { calendarName: '主世界历', year: 2138, month: 1, day: 17, hour: 9, minute: 17 },
        },
        text: '<details><summary>时间与地点</summary>2138年1月17日 09:00 · 港区</details>\n她吃完早餐，洗好餐具，又步行去了街角。',
        payload: { elapsed_minutes: 25 },
        expected: { absoluteMinute: 48494882, precision: 'date', mobileText: '钟点未确定' },
    });

    await runCase({
        name: '04-daypart-plus-estimated-progress',
        setup: { label: '上午时段 + 行动估时', precision: 'daypart', daypart: '上午', day: 3, hour: 9, minute: 0 },
        text: '她吃完早餐，洗好餐具，然后步行到了街角。',
        payload: {
            elapsed_minutes: 0,
            time_resolution: {
                authority: 'estimated_elapsed', scope: 'current', needs_elapsed_estimate: true,
                estimated_minutes: 25, confidence: 'medium', reason: '根据早餐和步行估算。',
            },
        },
        expected: {
            precision: 'daypart',
            daypart: '上午',
            mobileText: '上午 · +约 25 分钟',
            mobileLabel: { kind: 'match', pattern: '上午.*本轮按行动估算推进约 25 分钟' },
        },
    });

    await runCase({
        name: '05-next-day-morning',
        setup: { label: '第二天清晨', precision: 'minute', day: 3, hour: 22, minute: 0 },
        text: '夜色沉下去。\n第二天清晨，她被敲门声叫醒。',
        payload: { elapsed_minutes: 0 },
        expected: { precision: 'daypart', daypart: '清晨', mobileText: '清晨' },
    });

    await runCase({
        name: '06-sequential-elapsed-text',
        setup: { label: '连续两段耗时', precision: 'minute', day: 3, hour: 9, minute: 0 },
        text: '过了2小时，她吃完饭。\n又过了30分钟，她出了门。',
        payload: { elapsed_minutes: 0 },
        expected: { precision: 'minute', mobileText: '11:30' },
    });

    // Desktop pass for the UI-specific daypart + estimate regression.
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktop = await page.evaluate(() => ({
        mobileText: document.querySelector('.wb-mobile-clock-time')?.textContent?.trim() || '',
        calendarText: document.querySelector('.wb-world-calendar')?.textContent?.replace(/\s+/g, ' ')?.trim() || '',
    }));
    report.desktopFinal = desktop;
    await capture('07-desktop-final');

    assert.deepEqual(pageErrors, []);
    report.finishedAt = new Date().toISOString();
    report.passed = true;
} catch (error) {
    report.finishedAt = new Date().toISOString();
    report.passed = false;
    report.error = String(error?.stack || error);
    throw error;
} finally {
    await fs.writeFile(path.join(evidence, 'world-clock-real-sillytavern.json'), JSON.stringify(report, null, 2));
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
