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
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
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
    url: 'http://127.0.0.1:8000/',
    pluginRoot: false,
    relation: null,
    overlap: null,
    perceivedOverlap: null,
    checks: {},
    pluginConsoleErrors,
    pageErrors,
};

try {
    await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext), null, { timeout: 30_000 });
    await page.waitForSelector('#world-backstage-root', { timeout: 30_000 });
    report.pluginRoot = true;

    const result = await page.evaluate(async () => {
        const mod = await import('/scripts/extensions/third-party/world-backstage-test/core.js');
        const overlapMod = await import('/scripts/extensions/third-party/world-backstage-test/observation-scene-overlap.js');
        const state = mod.createInitialState();
        state.people = [
            {
                id: 'user-ling',
                name: '玲',
                isUser: true,
                location: '东港咖啡店',
                action: '坐在门边',
            },
            {
                id: 'aqing',
                name: '阿青',
                isUser: false,
                location: '东港咖啡店',
                action: '整理自己的东西',
                intent: '把手头事情做完',
                knownEventViews: [],
                knownFactBeliefs: [],
                knownFactKeys: [],
                knownClueIds: [],
                knownEventIds: [],
            },
        ];
        const person = state.people[1];
        const relation = mod.personObservationSceneRelation(state, person, '玲');
        const poison = '阿青突然出现在别处并读懂了玲的内心。';
        const prompt = mod.buildPersonObservationPrompt(state, person, {
            userName: '玲',
            narrativeTurns: [{ role: 'assistant', content: poison }],
        });

        const roomState = structuredClone(state);
        roomState.people[0].location = '公寓客厅';
        roomState.people[1].location = '公寓客厅';
        const overlap = overlapMod.classifyObservationSceneOverlap(
            roomState,
            roomState.people[1],
            roomState.people[0],
        );
        const instruction = overlapMod.buildObservationSceneOverlapInstruction(
            { currentState: roomState },
            prompt,
        );

        const perceivedState = structuredClone(roomState);
        perceivedState.people[1].action = '阿青抬头看见玲站在沙发旁，正准备回应她。';
        const perceivedOverlap = overlapMod.classifyObservationSceneOverlap(
            perceivedState,
            perceivedState.people[1],
            perceivedState.people[0],
        );

        return {
            relation,
            overlap,
            perceivedOverlap,
            hasHardAnchor: prompt.includes('观测位置硬锚') && prompt.includes('东港咖啡店'),
            blocksAutoPerception: prompt.includes('不等于已经互相看见、听见、注意到、交谈或建立互动'),
            keepsNarrativeFirewall: !prompt.includes(poison),
            blocksTeleport: prompt.includes('观测不得让该人物离开、抵达、回到、进入任何新地点'),
            overlapGuardRejectsReverseCanon: instruction.includes('权威世界状态 → 观测')
                && instruction.includes('严禁反向使用观测文本修改、补全或升级世界事实'),
            overlapGuardKeepsPerceptionSeparate: instruction.includes('不自动授予感知'),
        };
    });

    report.relation = result.relation;
    report.overlap = result.overlap;
    report.perceivedOverlap = result.perceivedOverlap;
    report.checks = result;

    assert.equal(result.relation.kind, 'same_place');
    assert.equal(result.overlap.kind, 'same_scene');
    assert.equal(result.overlap.perceivedBy, 'none');
    assert.equal(result.perceivedOverlap.kind, 'perceived');
    assert.equal(result.perceivedOverlap.perceivedBy, 'person');
    assert.equal(result.hasHardAnchor, true);
    assert.equal(result.blocksAutoPerception, true);
    assert.equal(result.keepsNarrativeFirewall, true);
    assert.equal(result.blocksTeleport, true);
    assert.equal(result.overlapGuardRejectsReverseCanon, true);
    assert.equal(result.overlapGuardKeepsPerceptionSeparate, true);
    assert.deepEqual(pluginConsoleErrors, []);
    assert.deepEqual(pageErrors, []);
} finally {
    fs.writeFileSync(
        process.env.WB_OBSERVATION_REPORT || 'person-observation-anchor-runtime-report.json',
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
    );
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
