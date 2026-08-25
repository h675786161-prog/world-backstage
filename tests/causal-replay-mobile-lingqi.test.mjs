import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildInjectionPackage,
    buildSimulationPrompt,
    createInitialState,
    normalizeEvent,
} from '../core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('settled backstage events are injected as continuity, never as replay instructions', () => {
    const state = createInitialState({ worldName: '测试世界' });
    state.events = [normalizeEvent({
        id: 'evt_public_unrest',
        title: '南区暴动',
        place: '南区',
        summary: '昨夜已经发生，目前仍在持续',
        status: 'active',
        visibility: 'known',
        publicity: 'public',
    }, state.clock.absoluteMinute)];

    const packet = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: true,
        injectionEvents: true,
        injectionFacts: true,
        injectionWorldBackground: true,
        injectionPeople: false,
        injectionEchoes: false,
        memorySystemEnabled: false,
    }, '南区新闻');

    assert.match(packet.authorityText, /此前已经成立的世界事实，不是要求正文重新生成的剧情指令/);
    assert.match(packet.authorityText, /事件本体不可重新开演/);
    assert.match(packet.authorityText, /不得把事件的起因、发生过程或既有结果再演一次/);
});

test('simulation settlement treats news repetition as knowledge, not a duplicate event', () => {
    const prompt = buildSimulationPrompt(createInitialState({ worldName: '测试世界' }), {
        latestTurn: {
            user: '打开新闻。',
            assistant: '电视正在报道昨夜已经发生的南区暴动。',
        },
        userName: '玲',
    });

    assert.match(prompt, /正文若只是报道、回忆、转述或角色刚刚得知/);
    assert.match(prompt, /不得另建一条近义事件/);
    assert.match(prompt, /不得把既有事件的发生时间改成本轮/);
});

test('public opinion and mobile Lingqi UI keep their explicit runtime contracts', () => {
    const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const uiSource = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');
    const mobileCss = fs.readFileSync(path.join(root, 'mobile-ui-polish.css'), 'utf8');

    assert.match(indexSource, /新闻记录（承接获知\/后果，不重演报道对象）/);
    assert.match(indexSource, /角色看到新闻只新增“获知与反应”/);
    assert.match(uiSource, /\/-alpha\|-beta\|dev\\\.\/i/);
    assert.match(uiSource, /\^2\\\.5\\\.\\d\+\$\/i\.test\(text\)\) return '小猫版 V2\.5'/);
    assert.match(mobileCss, /\.wb-view-content\.is-lingqi-view[\s\S]*overflow-y:\s*auto\s*!important/);
    assert.match(mobileCss, /\.wb-lingqi-surface[\s\S]*flex-direction:\s*column\s*!important/);
    assert.match(mobileCss, /\.wb-lingqi-chat-card[\s\S]*min-height:\s*clamp\(300px,\s*38dvh,\s*390px\)\s*!important/);
    assert.match(mobileCss, /\.wb-lingqi-chat-log[\s\S]*min-height:\s*210px\s*!important/);
    assert.match(mobileCss, /\.wb-lingqi-notes-scroll[\s\S]*max-height:\s*none\s*!important/);
});
