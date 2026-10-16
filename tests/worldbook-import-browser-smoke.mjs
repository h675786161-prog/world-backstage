// Run against an isolated real SillyTavern (--disableCsrf), never a user's chat.
// WB_TAVERN_URL, WB_EXTENSION_NAME, WB_PLAYWRIGHT_CORE_ENTRY and WB_IMPORT_EVIDENCE
// select the lab, browser wrapper, installed extension, and output directory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { extractWorldbookCharacterProfile, IMPORT_FIELDS } from '../worldbook.js';

const { chromium } = await import(process.env.WB_PLAYWRIGHT_CORE_ENTRY || 'playwright-core');
const base = process.env.WB_TAVERN_URL || 'http://127.0.0.1:8000';
const extension = process.env.WB_EXTENSION_NAME || 'world-backstage-test';
const evidence = process.env.WB_IMPORT_EVIDENCE || 'worldbook-import-evidence';
await fs.mkdir(evidence, { recursive: true });
const report = { checks: [], requests: [], pageErrors: [], screenshots: [], startedAt: new Date().toISOString() };
const book = '导入验收·人物档案';
const otherBook = '导入验收·另一本书';
const longBackground = `在北岸长大。${'沿河旅行并记录沿途村庄。'.repeat(420)}最后回到故乡。`;
const ability = '折叠空间，但不能穿过铁墙，每次使用会暂时失去听觉。';
const entries = {
    1: { uid: 1, comment: '林舟-外貌', key: ['林舟'], content: '外貌：黑色短发，常穿深色外套。', disable: false },
    2: { uid: 2, comment: '林舟-背景', key: ['林舟'], content: `背景：${longBackground}`, disable: false },
    3: { uid: 3, comment: '林舟-能力', key: ['林舟'], content: `能力：${ability}`, disable: false },
    4: { uid: 4, comment: '人物合集', key: ['人物'], content: '<character name="小路">外貌：棕色短发。性格：谨慎。</character>\n<character name="小路">背景：来自东港。能力：能够听到钟声，太远则无效。</character>', disable: false },
};
let delayNext = false;
let releaseResponse = null;
const upstream = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'worldbook-lab' }] }));
    try {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        const prompt = payload.messages.map(message => String(message.content || '')).join('\n');
        assert.ok(prompt.includes('世界书条目：\n'), 'actual model request is a worldbook import');
        const batch = JSON.parse(prompt.split('世界书条目：\n')[1].split('\n\n返回结构：')[0]);
        report.requests.push({ entries: batch.map(entry => entry.uid), chars: batch.reduce((n, entry) => n + entry.content.length, 0), model: payload.model });
        const people = batch.map(entry => {
            const profile = extractWorldbookCharacterProfile(entry.content, entry.person_name_hint || entry.entry_name);
            const values = Object.fromEntries(IMPORT_FIELDS.map(field => [field.jsonKey, profile[field.key] || '']));
            // A controlled invented assertion must be rejected by source checks.
            if (entry.uid === '1') values.speaking_style = '总会说宇宙已经为我改变了命运';
            return { name: entry.person_name_hint || profile.name, source_uids: [entry.uid], ...values };
        });
        if (delayNext) { delayNext = false; await new Promise(resolve => { releaseResponse = resolve; }); }
        res.end(JSON.stringify({ id: 'worldbook-lab', object: 'chat.completion', model: 'worldbook-lab', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ people }) }, finish_reason: 'stop' }] }));
    } catch (error) {
        report.providerError = String(error.stack);
        res.statusCode = 500; res.end(JSON.stringify({ error: { message: error.message } }));
    }
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
const post = async (endpoint, data) => {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.ok(response.ok, `${endpoint}: ${response.status}`); return response;
};
const check = (label, value) => { assert.ok(value, label); report.checks.push(label); console.log(`通过：${label}`); };
let browser, page;
try {
    await post('/api/worldinfo/edit', { name: book, data: { entries } });
    await post('/api/worldinfo/edit', { name: otherBook, data: { entries: { 1: { uid: 1, comment: '其他人', key: ['其他人'], content: '姓名：其他人\n性格：安静。' } } } });
    const avatar = await (await post('/api/characters/create', { ch_name: '导入验收', description: '本地测试角色', first_mes: '清晨，街上很安静。' })).text();
    browser = await chromium.launch({ headless: true, ...(process.env.WB_CHROMIUM_EXECUTABLE ? { executablePath: process.env.WB_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /world.?backstage|世界背面/i.test(message.text())) (report.pluginErrors ||= []).push(message.text()); });
    await page.addInitScript(extension => { localStorage.setItem(`world-backstage:update-manager:${extension}`, JSON.stringify({ lastCheckedAt: Date.now() })); localStorage.setItem('world-backstage:mama-note:seen', '1'); }, extension);
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const choose = async () => {
        await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext));
        await page.locator('#loader').waitFor({ state: 'hidden' });
        if (await page.getByRole('button', { name: '收好纸条' }).isVisible()) await page.getByRole('button', { name: '收好纸条' }).click();
        const onboarding = page.locator('dialog:visible').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) { await onboarding.locator('.popup-input').fill('验收员'); await onboarding.locator('.popup-button-ok').click(); }
        await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext?.().characters.length));
        if (!await page.locator('.character_select').first().isVisible()) await page.locator('#rightNavHolder .drawer-toggle').click();
        const index = await page.evaluate(avatar => SillyTavern.getContext().characters.findIndex(character => character.avatar === avatar), avatar);
        await page.locator(`.character_select[data-chid="${index}"],.character_select[chid="${index}"]`).click();
        await page.waitForFunction(avatar => { const context = SillyTavern.getContext(); return context.characters[context.characterId]?.avatar === avatar && context.chat.length; }, avatar);
        if (await page.locator('#rm_button_characters').isVisible()) await page.locator('#rightNavHolder .drawer-toggle').click();
        await page.waitForFunction(() => Boolean(globalThis.worldBackstageHost));
        if ((await fetch(base + '/lab-font/400.css')).ok) {
            await page.addStyleTag({ url: base + '/lab-font/400.css' });
            await page.addStyleTag({ content: 'body,button,input,textarea,select,#world-backstage-root,#world-backstage-root * { font-family: "Noto Sans SC", sans-serif !important; }' });
            await page.evaluate(() => document.fonts.ready);
        }
    };
    const click = selector => page.locator(selector).first().click({ timeout: 15000 });
    const people = () => page.evaluate(() => worldBackstageHost.getPublicSurface().people);
    const openImport = async () => {
        await page.evaluate(() => worldBackstageHost.open());
        await click('[data-wb-action="set-view"][data-view="people"]');
        await click('[data-wb-action="toggle-module-settings"][data-view="people"]');
        if (!await page.locator('[data-settings-subgroup="people-worldbook"]').evaluate(node => node.open)) await click('[data-settings-subgroup="people-worldbook"] > summary');
        await page.locator('[data-wb-form="worldbook"] select[name="bookName"]').selectOption(book);
    };
    const scan = async () => { await click('[data-wb-action="scan-worldbook"]'); await page.locator('[data-wb-worldbook-entry-id="1"]').waitFor(); };
    const selectLin = async () => { for (const uid of ['1', '2', '3']) await page.locator(`[data-wb-worldbook-entry-id="${uid}"]`).check(); };
    const shot = async name => { await page.screenshot({ path: path.join(evidence, name) }); report.screenshots.push(name); };
    await page.goto(base, { waitUntil: 'domcontentloaded' }); await choose();
    await page.evaluate(upstreamUrl => {
        const context = SillyTavern.getContext();
        Object.assign(context.extensionSettings.world_backstage, { enabled: true, worldSimulationEnabled: false, autoSync: false, worldAutoEnabled: false, socialAutoEnabled: false, memorySystemEnabled: false, apiMode: 'custom', customApiUrl: upstreamUrl, customApiKey: 'worldbook-local-test', customApiModel: 'worldbook-lab', customApiTransport: 'proxy', autoRetryCount: 0, apiModuleRoutes: { observation: 'default' }, generationModuleLimits: { observation: { maxTokens: 12000, timeoutMs: 30000 } } });
        worldBackstageHost.refreshLauncher();
    }, upstreamUrl);
    await openImport(); await scan();
    await click('[data-wb-action="select-worldbook-visible"]');
    await click('[data-wb-form="worldbook"] button[type="submit"]');
    const rulePeople = await people();
    check('规则导入将姓名关键词确认的三个片段合为一人', rulePeople.filter(person => person.name === '林舟').length === 1);
    const lin = rulePeople.find(person => person.name === '林舟');
    check('长世界书字段与末尾能力限制完整保存', lin.backgroundProfile === longBackground && lin.abilityProfile === ability && lin.worldbookRaw.includes('最后回到故乡'));
    check('同名 XML 后续片段没有丢失，也没有把合集当人物', rulePeople.some(person => person.name === '小路' && person.backgroundProfile.includes('东港') && person.abilityProfile.includes('太远则无效') && person.worldbookRaw.includes('<character name="小路">')) && !rulePeople.some(person => person.name === '人物合集'));
    await selectLin(); await click('[data-wb-action="ai-import-worldbook"]');
    await page.locator('.wb-worldbook-draft-review').waitFor({ timeout: 30000 });
    check('AI 整理经真实酒馆转发，所有分块均不超过预算', report.requests.length >= 2 && report.requests.every(request => request.chars <= 6000 && request.entries.length <= 3));
    check('整理只生成草稿，未确认不改变人物', JSON.stringify(await people()) === JSON.stringify(rulePeople));
    check('不同来源的同名人物默认不勾选', await page.locator('[data-wb-draft-person]:checked').count() === 0);
    const references = await page.locator('[data-wb-draft-person]').evaluateAll(nodes => nodes.map(node => node.dataset.wbDraftPerson));
    for (let i = 0; i < references.length; i++) {
        await page.locator('[data-wb-draft-target]').nth(i).selectOption(i === 0 ? `person:${lin.id}` : `draft:${references[0]}`);
        await page.locator('[data-wb-draft-person]').nth(i).check();
    }
    await shot('390-import-review.png');
    await click('[data-wb-action="commit-worldbook-drafts"]');
    check('明确合并后仍只有一个林舟，模型编造的口癖被拦下', (await people()).filter(person => person.name === '林舟').length === 1 && !(await people()).find(person => person.name === '林舟').speakingStyle);
    check('原文全文与各来源在 AI 确认后仍完整保存', (await people()).find(person => person.id === lin.id).worldbookSources.length >= 3 && (await people()).find(person => person.id === lin.id).worldbookRaw.includes('最后回到故乡'));
    await click('.wb-module-settings-popover [data-wb-action="toggle-module-settings"][data-view="people"]');
    const linCard = page.locator(`[data-fold-key="people:${lin.id}"]`);
    if (!await linCard.evaluate(node => node.open)) await linCard.locator('summary').click();
    await click(`[data-wb-action="open-person-editor"][data-person-id="${lin.id}"]`);
    const edited = `作者手填。${'在山中学习并留下行记。'.repeat(300)}只认这份作者设定。`;
    const editedAbility = `作者指定的术式。${'须有回声才可发动。'.repeat(150)}代价是三天不能说话。`;
    await page.locator('[data-wb-form="person"] [name="backgroundProfile"]').fill(edited);
    await page.locator('[data-wb-form="person"] [name="abilityProfile"]').fill(editedAbility);
    await click('[data-wb-form="person"] button[type="submit"]');
    check('手机编辑长人物卡和能力栏位保存不截断', (await people()).find(person => person.id === lin.id).backgroundProfile === edited && (await people()).find(person => person.id === lin.id).abilityProfile === editedAbility);
    await page.evaluate(async () => { const context = SillyTavern.getContext(); await context.saveMetadata(); await context.saveChat(); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await choose();
    check('整页重新加载后长卡、能力和来源全文均恢复', (await people()).find(person => person.id === lin.id)?.backgroundProfile === edited && (await people()).find(person => person.id === lin.id)?.abilityProfile === editedAbility && (await people()).find(person => person.id === lin.id)?.worldbookRaw.includes('最后回到故乡'));
    await openImport(); await scan(); await selectLin();
    await click('[data-wb-form="worldbook"] button[type="submit"]');
    check('重新导入不会覆盖手填的长背景和能力限制', (await people()).find(person => person.id === lin.id).backgroundProfile === edited && (await people()).find(person => person.id === lin.id).abilityProfile === editedAbility);
    await selectLin();
    const beforeCancel = JSON.stringify(await people());
    delayNext = true; const beforeRequests = report.requests.length;
    await click('[data-wb-action="ai-import-worldbook"]');
    for (let i = 0; i < 100 && report.requests.length === beforeRequests; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(releaseResponse, 'upstream response is pending');
    await click('[data-wb-action="discard-worldbook-drafts"]'); releaseResponse(); releaseResponse = null;
    await page.locator('[data-wb-action="ai-import-worldbook"]:enabled').waitFor();
    check('取消正在生成的整理后，迟到响应不会写入或留下草稿', JSON.stringify(await people()) === beforeCancel && !await page.locator('.wb-worldbook-draft-review').count());
    await click('[data-wb-action="ai-import-worldbook"]'); await page.locator('.wb-worldbook-draft-review').waitFor({ timeout: 30000 });
    await page.locator('[data-wb-form="worldbook"] select[name="bookName"]').selectOption(otherBook);
    check('换世界书会作废上一本文档的审校草稿', !await page.locator('.wb-worldbook-draft-review').count() && !await page.locator('[data-wb-worldbook-entry-id]').count() && JSON.stringify(await people()) === beforeCancel);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('[data-wb-form="worldbook"] select[name="bookName"]').selectOption(book); await scan(); await selectLin();
    await click('[data-wb-action="ai-import-worldbook"]'); await page.locator('.wb-worldbook-draft-review').waitFor({ timeout: 30000 });
    check('320 像素审校表单没有横向溢出', await page.locator('[data-wb-form="worldbook"]').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await shot('320-import-review.png');
    await page.evaluate(async () => { const context = SillyTavern.getContext(); await context.eventSource.emit(context.eventTypes.CHAT_CHANGED); });
    check('切聊天事件会清除待确认草稿且不写世界', !await page.locator('.wb-worldbook-draft-review').count() && JSON.stringify(await people()) === beforeCancel);
    check('真实页面没有脚本异常', report.pageErrors.length === 0 && !(report.pluginErrors || []).length);
    report.passed = true;
} catch (error) {
    report.passed = false; report.failure = String(error.stack); console.error(report.failure);
    if (page) { await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); console.log((await page.locator('body').innerText().catch(() => '')).slice(-1800)); }
    process.exitCode = 1;
} finally {
    releaseResponse?.();
    await browser?.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
}
