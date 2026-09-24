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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

let report;
try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
        () => Boolean(globalThis.__worldBackstageLoaded && globalThis.worldBackstageHost),
        null,
        { timeout: 30_000 },
    );

    const helper = await page.evaluate(async () => {
        const module = await import('/scripts/extensions/third-party/world-backstage/auto-hide.js?lab-smoke=1');
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js?lab-smoke=1');
        const chat = Array.from({ length: 10 }, () => ({ extra: {} }));
        chat[1].is_system = true;
        const hidden = module.markAutoHiddenMessages(chat, 9, {
            hiddenAt: '2026-09-21T00:00:00.000Z',
        });
        const marked = hidden.every(id => (
            chat[id]?.is_system === true
            && Boolean(chat[id]?.extra?.[module.AUTO_HIDDEN_MESSAGE_KEY])
        ));
        const restored = module.restoreAutoHiddenMessages(chat);
        const archived = core.applyHistoryIndexResult(core.createInitialState(), {
            memory_digest: { text: '医院门口有封条，主角仍在调查来源。' },
            turn_summaries: [
                { source_message_id: 0, summary: '主角在医院门口见到封条。' },
                { source_message_id: 1, summary: '施工人员拦下主角；主角追问封条来源。' },
            ],
        }, { startMessageId: 0, endMessageId: 1 });
        const continuity = core.buildInjectionPackage(archived, {
            enabled: true, worldSimulationEnabled: false,
            memorySystemEnabled: true, injectionMemory: true,
        }, '医院封条');
        const incompleteChat = Array.from({ length: 9 }, (_, id) => ({
            mes: `正文${id}`, is_user: id % 2 === 0,
        }));
        const safelyHidden = module.markAutoHiddenMessages(incompleteChat, 8, {
            summaries: archived.storyMemory.summaries,
        });
        return {
            hidden,
            restored,
            marked,
            manualHidePreserved: chat[1]?.is_system === true,
            autoHideRestored: hidden.every(id => chat[id]?.is_system === false),
            memoryRecalled: continuity.supportText.includes('施工人员拦下主角'),
            missingTurnsStayVisible: safelyHidden.every(id => id < 2)
                && incompleteChat[2].is_system !== true,
        };
    });

    await page.evaluate(() => globalThis.worldBackstageHost.open());
    await page.waitForTimeout(150);
    const settingsButton = page.locator('[data-wb-action="toggle-settings"]').first();
    if (!(await settingsButton.count())) throw new Error('Global settings button not rendered');
    await settingsButton.evaluate(element => element.click());
    await page.waitForTimeout(160);

    const toggle = page.locator('[data-wb-setting="autoHideArchivedFloors"]').first();
    const restoreButton = page.locator('[data-wb-action="restore-auto-hidden-floors"]').first();
    if (!(await toggle.count())) throw new Error('Auto-hide setting toggle not rendered');
    if (!(await restoreButton.count())) throw new Error('Auto-hide restore button not rendered');

    await toggle.evaluate(element => element.click());
    await page.waitForTimeout(180);
    const persistedSetting = await page.evaluate(() => (
        globalThis.SillyTavern?.getContext?.()?.extensionSettings?.world_backstage?.autoHideArchivedFloors
    ));

    await restoreButton.evaluate(element => element.click());
    await page.waitForTimeout(160);
    const disabledAfterRestore = await page.evaluate(() => (
        globalThis.SillyTavern?.getContext?.()?.extensionSettings?.world_backstage?.autoHideArchivedFloors === false
    ));

    // Exercise the plugin against actual ST chat metadata and extension prompts,
    // not just a separate in-memory array passed to the helper.
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        if (!context.characters.length) throw new Error('No runtime character available');
        await context.selectCharacterById(0);
    });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern.getContext().chatId));
    await page.waitForTimeout(350);
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        Object.assign(context.extensionSettings.world_backstage, {
            enabled: true, memorySystemEnabled: true, injectionMemory: true,
            worldAutoEnabled: false, memoryAutoIndexInterval: 0,
            publicOpinionAutoEnabled: false, autoHideArchivedFloors: false,
        });
        const chat = Array.from({ length: 12 }, (_, id) => ({
            name: id % 2 ? context.name2 : context.name1,
            is_user: id % 2 === 0, is_system: false,
            mes: `LAB 正文 ${id}：在医院走廊等候。`, extra: {},
        }));
        chat[1].is_system = true; // Existing manual hide must remain untouched.
        context.chat.splice(0, context.chat.length, ...chat);
        const coveredIds = [0, 2, 4, 5, 6, 7, 8, 9, 10, 11]; // Deliberately omit floor 3.
        const state = core.applyHistoryIndexResult(core.createInitialState(), {
            memory_digest: { text: 'LAB持续经过：蓝钥匙仍由林医生保管，约好周五归还。' },
            turn_summaries: coveredIds.map(id => ({
                source_message_id: id,
                summary: id === 11 ? 'LAB最近经历：在医院追问蓝钥匙。' : `已记录第${id}层经历。`,
            })),
        }, { startMessageId: 0, endMessageId: 11 });
        const store = context.chatMetadata[core.STATE_KEY];
        if (!store) throw new Error('World Backstage did not attach to the real chat');
        store.currentState = state;
        globalThis.worldBackstageHost.open();
    });
    const realToggle = page.locator('[data-wb-setting="autoHideArchivedFloors"]').first();
    if (!(await realToggle.count())) {
        await page.locator('[data-wb-action="toggle-settings"]').first().evaluate(el => el.click());
    }
    await realToggle.evaluate(el => { if (!el.checked) el.click(); });
    await page.waitForFunction(() => globalThis.SillyTavern.getContext().chat[0]?.is_system === true);
    const runtime = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const support = context.extensionPrompts.world_backstage_context_support?.value || '';
        return {
            hiddenIds: context.chat.flatMap((message, id) => message.extra?.world_backstage_auto_hidden ? [id] : []),
            uncoveredVisible: context.chat[3].is_system === false,
            recentFiveVisible: context.chat.slice(7).every(message => !message.is_system),
            digestInjected: support.includes('蓝钥匙仍由林医生保管'),
            latestInjected: support.includes('在医院追问蓝钥匙'),
        };
    });
    await page.locator('[data-wb-setting="memorySystemEnabled"]').first().evaluate(el => {
        if (el.checked) el.click();
    });
    await page.waitForFunction(() => globalThis.SillyTavern.getContext().chat[0]?.is_system === false);
    Object.assign(runtime, await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const support = context.extensionPrompts.world_backstage_context_support?.value || '';
        return {
            restoredOnMemoryDisable: context.chat.every((message, id) => id === 1 || !message.is_system),
            manualHidePreserved: context.chat[1].is_system === true,
            memoryRemovedFromPrompt: !/LAB持续经过|LAB最近经历/.test(support),
        };
    }));

    report = {
        pluginLoaded: true,
        helper,
        runtime,
        ui: {
            autoHideToggleRendered: true,
            restoreButtonRendered: true,
            persistedSetting: persistedSetting === true,
            disabledAfterRestore,
        },
        pageErrors,
    };

    if (!helper.marked) throw new Error('Auto-hide helper did not mark eligible messages');
    if (!helper.manualHidePreserved) throw new Error('Restore touched a pre-existing manual/system hide');
    if (!helper.autoHideRestored) throw new Error('Auto-hide helper failed to restore its own messages');
    if (!helper.memoryRecalled) throw new Error('Narrative memory was absent from the foreground prompt');
    if (!helper.missingTurnsStayVisible) throw new Error('Uncovered turns were hidden from the model');
    if (persistedSetting !== true) throw new Error('Auto-hide setting did not persist through the real UI');
    if (!disabledAfterRestore) throw new Error('Restore action did not disable auto-hide before restoring floors');
    if (JSON.stringify(runtime.hiddenIds) !== JSON.stringify([0, 2, 4, 5, 6])) {
        throw new Error(`Unexpected real chat hidden floors: ${JSON.stringify(runtime.hiddenIds)}`);
    }
    for (const [key, value] of Object.entries(runtime)) {
        if (key !== 'hiddenIds' && value !== true) throw new Error(`Real ST continuity check failed: ${key}`);
    }
    if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
} finally {
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(
        path.join(evidenceDir, 'world-backstage-auto-hide-smoke.json'),
        JSON.stringify(report || { pluginLoaded: false, pageErrors }, null, 2),
    );
    await page.screenshot({
        path: path.join(evidenceDir, 'world-backstage-auto-hide.png'),
        fullPage: true,
    }).catch(() => {});
    await browser.close();
}

console.log(JSON.stringify(report, null, 2));
