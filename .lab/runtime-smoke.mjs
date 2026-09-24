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

    report = {
        pluginLoaded: true,
        helper,
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
