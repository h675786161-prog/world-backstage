import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
        const affinity = await import('/scripts/extensions/third-party/world-backstage/affinity.js?lab-smoke=1');
        const affinityInitial = affinity.createInitialRelationshipState();
        const affinitySettled = affinity.applyRelationshipEvent(affinityInitial, {
            id: 'lab-affinity-event', sourceId: 'npc', targetId: 'player',
            sourceKey: 'lab:affinity:1', initialValues: { affection: 40 },
            deltas: { affection: 5 },
        });
        const relationshipState = core.createInitialState();
        relationshipState.people.push({ id: 'npc_ash', name: '阿什莉', isUser: false });
        const relationshipSettled = affinity.applyRelationshipEvent(relationshipState.relationships, {
            id: 'lab-relationship-context', sourceId: 'npc_ash', targetId: '__wb_player__',
            sourceKey: 'lab:relationship-context:1',
            initialValues: { affection: 87, trust: 13 },
            deltas: { affection: 0, trust: 0 },
            memoryNote: '阿什莉记得玩家曾在危机中帮助她。',
        });
        relationshipState.relationships = relationshipSettled.state;
        const relationshipPackage = core.buildInjectionPackage(relationshipState, {
            enabled: true, worldSimulationEnabled: false, worldPromptInjection: true,
            affinityContextInjection: true, affinityRomanceEnabled: true,
            memorySystemEnabled: false, injectionMemory: false,
        }, '阿什莉向你道歉。');
        const relationshipPackageDisabled = core.buildInjectionPackage(relationshipState, {
            enabled: true, worldSimulationEnabled: false, worldPromptInjection: true,
            affinityContextInjection: false, affinityRomanceEnabled: true,
            memorySystemEnabled: false, injectionMemory: false,
        }, '阿什莉向你道歉。');
        const relationshipSupport = relationshipPackage.supportText || '';
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
            affinityModuleLoaded: typeof affinity.detectAffinityCandidate === 'function',
            affinitySettlementWorks: affinitySettled.applied
                && affinity.getRelationship(affinitySettled.state, 'npc', 'player')?.values.affection === 45,
            affinityContextInjected: relationshipSupport.includes('阿什莉')
                && relationshipSupport.includes('好感很高')
                && relationshipSupport.includes('信任极低'),
            affinityScoresHidden: !relationshipSupport.includes('87') && !relationshipSupport.includes('13'),
            affinityContextToggleWorks: !String(relationshipPackageDisabled.supportText || '').includes('阿什莉'),
        };
    });

    await page.evaluate(() => globalThis.worldBackstageHost.open());
    await page.waitForTimeout(150);
    const settingsButton = page.locator('[data-wb-action="toggle-settings"]').first();
    if (!(await settingsButton.count())) throw new Error('Global settings button not rendered');
    await settingsButton.evaluate(element => element.click());
    await page.waitForTimeout(160);

    await page.locator('button[data-wb-action="settings-section"][data-section="connection"]').evaluate(element => element.click());
    const affinityRouteGroup = page.locator('details[data-settings-subgroup="connection-routing"]');
    await affinityRouteGroup.waitFor({ state: 'attached', timeout: 5000 });
    if (await affinityRouteGroup.getAttribute('open') === null) {
        await affinityRouteGroup.locator('summary').evaluate(element => element.click());
    }
    const affinityRoute = page.locator('select[data-wb-api-route="affinity"]');
    await affinityRoute.waitFor({ state: 'visible', timeout: 5000 });
    const affinityRouteValue = await affinityRoute.inputValue();

    await page.locator('button[data-wb-action="settings-section"][data-section="advanced"]').evaluate(element => element.click());
    const affinitySettingsGroup = page.locator('details[data-settings-subgroup="advanced-affinity"]');
    await affinitySettingsGroup.waitFor({ state: 'attached', timeout: 5000 });
    if (await affinitySettingsGroup.getAttribute('open') === null) {
        await affinitySettingsGroup.locator('summary').evaluate(element => element.click());
    }
    const affinityPrompt = page.locator('textarea[data-wb-setting="affinityPrompt"]');
    await affinityPrompt.waitFor({ state: 'visible', timeout: 5000 });
    const affinityUi = {
        routeVisible: true,
        routeValue: affinityRouteValue,
        promptVisible: true,
        promptLength: (await affinityPrompt.inputValue()).length,
        enabledToggleVisible: await page.locator('input[data-wb-setting="affinityEnabled"]').isVisible(),
        autoToggleVisible: await page.locator('input[data-wb-setting="affinityAutoEnabled"]').isVisible(),
        romanceToggleVisible: await page.locator('input[data-wb-setting="affinityRomanceEnabled"]').isVisible(),
    };

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
        if (!context.characters.length) {
            const response = await fetch('/api/characters/create', {
                method: 'POST', headers: {
                    ...context.getRequestHeaders(), 'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ch_name: 'LAB记忆验证角色',
                    description: '仅供隔离测试的成年角色。', first_mes: '欢迎来到记忆测试。' }),
            });
            if (!response.ok) throw new Error(`Could not create LAB character: ${response.status}`);
            const { getCharacters } = await import('/script.js');
            await getCharacters();
        }
        const loadedContext = globalThis.SillyTavern.getContext();
        if (!loadedContext.characters.length) throw new Error('LAB character was not loaded');
        await loadedContext.selectCharacterById(0);
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
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const support = context.extensionPrompts.world_backstage_context_support?.value || '';
        return context.extensionSettings.world_backstage.memorySystemEnabled === false
            && !/LAB持续经过|LAB最近经历/.test(support);
    }, null, { timeout: 12_000 }).catch(() => {});
    Object.assign(runtime, await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const support = context.extensionPrompts.world_backstage_context_support?.value || '';
        return {
            restoredOnMemoryDisable: context.chat.every((message, id) => id === 1 || !message.is_system),
            manualHidePreserved: context.chat[1].is_system === true,
            memoryRemovedFromPrompt: !/LAB持续经过|LAB最近经历/.test(support),
            memorySettingDisabled: context.extensionSettings.world_backstage.memorySystemEnabled === false,
            injectedSupportExcerpt: support.slice(0, 520),
        };
    }));

    // Exercise the relationship details UI in real SillyTavern, including
    // manual settlement, persisted chat metadata, confirmed reset and narrow view.
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const affinity = await import('/scripts/extensions/third-party/world-backstage/affinity.js');
        const store = context.chatMetadata[core.STATE_KEY];
        if (!store) throw new Error('No chat store available for relationship UI smoke');
        let state = store.currentState || core.createInitialState();
        state.people = Array.isArray(state.people) ? state.people : [];
        if (!state.people.some(person => person.id === 'lab_affinity_npc')) {
            state.people.push({
                id: 'lab_affinity_npc', name: 'LAB关系验证人物', isUser: false,
                knowledge: 'known', locked: true,
            });
        }
        const seeded = affinity.applyRelationshipEvent(
            affinity.createInitialRelationshipState(),
            {
                id: 'lab-affinity-ui-seed', idempotencyKey: 'lab-affinity-ui-seed',
                sourceId: 'lab_affinity_npc', targetId: '__wb_player__',
                sourceKey: 'lab:affinity-ui-seed',
                initialValues: { affection: null, trust: 31, romance: null },
                deltas: { affection: 0, trust: 0, romance: 0 },
                reason: 'LAB 历史记录：角色曾因玩家的可靠行动建立初步信任。',
                createdAt: new Date().toISOString(),
            },
        );
        if (!seeded.applied) throw new Error('Could not seed relationship UI state');
        state.relationships = seeded.state;
        store.branchOverrides = {};
        store.currentState = state;
        await context.saveChat?.();
        globalThis.worldBackstageHost.open();
    });
    const peopleNav = page.locator('.wb-side-nav [data-wb-action="set-view"][data-view="people"]');
    await peopleNav.waitFor({ state: 'visible', timeout: 8_000 });
    await peopleNav.evaluate(element => element.click());
    const relationManager = page.locator('.wb-affinity-manager');
    await relationManager.waitFor({ state: 'visible', timeout: 5_000 });
    const relationCard = relationManager.locator('.wb-affinity-relation-list .wb-affinity-relation-card').filter({
        hasText: 'LAB关系验证人物',
    }).first();
    await relationCard.waitFor({ state: 'visible', timeout: 5_000 });
    const unknownBeforeEdit = await relationCard.locator('input[name="affection"]').inputValue() === ''
        && await relationCard.locator('input[name="romance"]').inputValue() === '';
    await relationCard.locator('.wb-affinity-history summary').evaluate(element => element.click());
    const historyBeforeEdit = await relationCard.locator('.wb-affinity-history').innerText();
    if (!historyBeforeEdit.includes('LAB 历史记录')) throw new Error('Relationship event history was not rendered');
    await relationCard.evaluate(card => {
        for (const [name, value] of Object.entries({
            affection: '67', trust: '44', tags: '朋友，戒备',
        })) {
            const input = card.querySelector(`[name="${name}"]`);
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    const editorBeforeSave = await relationCard.evaluate(card => ({
        fields: [...card.querySelectorAll('[name]')].map(input => ({ name: input.name, value: input.value })),
        forms: [...card.querySelectorAll('form')].map(form => ({
            hasRelationshipMarker: form.hasAttribute('data-wb-relationship-form'),
            fields: [...form.elements].map(input => ({ name: input.name, value: input.value })),
        })),
    }));
    console.log(`Relationship editor fields before save: ${JSON.stringify(editorBeforeSave)}`);
        await relationCard.locator('[data-wb-action="save-relationship"]').evaluate(element => element.click());
    const manualSaveCommitted = await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const state = context.chatMetadata?.world_backstage_v1?.currentState;
        const relation = state?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === 67 && relation?.values?.trust === 44
            && relation?.tags?.includes('朋友') && state.relationships.events.at(-1)?.origin === 'manual';
    }, null, { timeout: 5_000 }).then(() => true).catch(() => false);
    if (!manualSaveCommitted) {
        const diagnostic = await page.evaluate(() => {
            const context = globalThis.SillyTavern.getContext();
            const state = context.chatMetadata?.world_backstage_v1?.currentState;
            const relation = state?.relationships?.relations?.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
            return {
                chatMetadataKeys: Object.keys(context.chatMetadata || {}),
                relation: relation || null,
                latestEvents: state?.relationships?.events?.slice(-3) || [],
                alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.innerText),
            };
        });
        throw new Error(`Manual relationship save did not persist: ${JSON.stringify(diagnostic)}`);
    }
    const rootOverrideAfterEdit = await page.evaluate(() => {
        const store = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1;
        const snapshot = store?.branchOverrides?.root;
        const relation = snapshot?.state?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return {
            sourceKey: snapshot?.meta?.sourceKey || null,
            affection: relation?.values?.affection ?? null,
            trust: relation?.values?.trust ?? null,
        };
    });
    if (rootOverrideAfterEdit.sourceKey !== 'root'
        || rootOverrideAfterEdit.affection !== 67 || rootOverrideAfterEdit.trust !== 44) {
        throw new Error(`Manual edit has no recoverable root override: ${JSON.stringify(rootOverrideAfterEdit)}`);
    }
    // Reproduce root-override semantics through SillyTavern's real swipe event
    // before any swipe has a committed world snapshot.
    const rootSwipeState = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const store = context.chatMetadata[core.STATE_KEY];
        context.chat.splice(0, context.chat.length, {
            name: context.name2, is_user: false, is_system: false, mes: '根前 swipe A',
            swipes: ['根前 swipe A', '根前 swipe B'], swipe_id: 0,
            swipe_info: [{ extra: {} }, { extra: {} }], extra: {},
        });
        const types = context.eventTypes || context.event_types;
        context.chat[0].swipe_id = 1;
        context.chat[0].mes = context.chat[0].swipes[1];
        await context.eventSource.emit(types.MESSAGE_SWIPED, 0);
        return {
            values: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            rootOverride: Boolean(store.branchOverrides?.root),
        };
    });
    console.log(`Root override after real pre-snapshot swipe: ${JSON.stringify(rootSwipeState)}`);
    if (rootSwipeState.values?.affection !== 67 || rootSwipeState.values?.trust !== 44) {
        throw new Error(`Chat-root manual relationship edit was lost on a pre-snapshot swipe: ${JSON.stringify(rootSwipeState)}`);
    }

    const preSnapshotLifecycle = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const store = context.chatMetadata[core.STATE_KEY];
        const types = context.eventTypes || context.event_types;
        const read = () => {
            const relation = store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
            return relation?.values?.affection ?? null;
        };
        const swipeStates = [];
        for (const swipe of [0, 1, 0]) {
            context.chat[0].swipe_id = swipe;
            context.chat[0].mes = context.chat[0].swipes[swipe];
            await context.eventSource.emit(types.MESSAGE_SWIPED, 0);
            swipeStates.push(read());
        }
        context.chat[0].mes = '根前编辑后的正文';
        await context.eventSource.emit(types.MESSAGE_EDITED, 0);
        const afterEdit = read();
        context.chat.splice(0, 1);
        await context.eventSource.emit(types.MESSAGE_DELETED, 0);
        return { swipeStates, afterEdit, afterDelete: read(), events: store.currentState.relationships.events };
    });
    console.log(`Pre-snapshot root lifecycle: ${JSON.stringify(preSnapshotLifecycle)}`);
    if (preSnapshotLifecycle.swipeStates.join(',') !== '67,67,67'
        || preSnapshotLifecycle.afterEdit !== 67 || preSnapshotLifecycle.afterDelete !== 67) {
        throw new Error(`Root relationship semantics changed across swipe/edit/delete: ${JSON.stringify(preSnapshotLifecycle)}`);
    }

    const desktopManagerBox = await relationManager.boundingBox();
    await page.screenshot({
        path: path.join(evidenceDir, 'world-backstage-affinity-relationship-desktop.png'),
        fullPage: true,
    });
    const relationshipChat = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        return { chatId: context.chatId, chatFile: context.characters[0]?.chat };
    });
    console.log(`Pre-reload relationship chat: ${JSON.stringify(relationshipChat)}`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
        () => Boolean(globalThis.__worldBackstageLoaded && globalThis.worldBackstageHost),
        null,
        { timeout: 30_000 },
    );
    await page.evaluate(async () => {
        const { getCharacters } = await import('/script.js');
        await getCharacters();
    });
    await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext?.()?.characters?.length), null, {
        timeout: 15_000,
    });
    await page.evaluate(async chatId => {
        const context = globalThis.SillyTavern.getContext();
        await context.selectCharacterById(0);
        context.characters[0].chat = chatId;
        const { getChat } = await import('/script.js');
        await getChat();
    }, relationshipChat.chatFile || relationshipChat.chatId);
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern?.getContext?.();
        return Boolean(context?.chat?.length && context?.chatMetadata?.world_backstage_v1);
    }, null, { timeout: 15_000 });
    await page.evaluate(() => globalThis.worldBackstageHost.open());
    const peopleNavAfterReload = page.locator(
        '.wb-root:visible .wb-side-nav [data-wb-action="set-view"][data-view="people"]',
    );
    await peopleNavAfterReload.waitFor({ state: 'visible', timeout: 8_000 });
    const reloadNavigationBlocker = await page.evaluate(() => {
        const visibleRoot = [...document.querySelectorAll('.wb-root')]
            .find(element => element.getClientRects().length > 0);
        return {
            dialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => ({
                className: dialog.className,
                text: dialog.innerText.slice(0, 1600),
                buttons: [...dialog.querySelectorAll('button')].map(button => ({
                    text: button.innerText.trim(),
                    disabled: button.disabled,
                })),
                html: dialog.outerHTML.slice(0, 8000),
            })),
            heading: visibleRoot?.querySelector('.wb-view-header h2')?.textContent || '',
            nav: [...(visibleRoot?.querySelectorAll('.wb-side-nav [data-wb-action="set-view"]') || [])]
                .map(button => ({
                    view: button.dataset.view,
                    current: button.getAttribute('aria-current'),
                    visible: Boolean(button.getClientRects().length),
                })),
            panelClass: visibleRoot?.querySelector('.wb-panel')?.className || '',
            currentChatId: globalThis.SillyTavern?.getContext?.()?.chatId || '',
        };
    });
    console.log(`Before reload navigation click: ${JSON.stringify(reloadNavigationBlocker)}`);
    if (reloadNavigationBlocker.dialogs.length) {
        await fs.writeFile(
            path.join(evidenceDir, 'world-backstage-affinity-reload-navigation-blocker.json'),
            JSON.stringify(reloadNavigationBlocker, null, 2),
        );
        await page.screenshot({
            path: path.join(evidenceDir, 'world-backstage-affinity-reload-navigation-blocker.png'),
            fullPage: true,
        });
    }
    const onboardingDialog = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    if (await onboardingDialog.count()) {
        const personaName = onboardingDialog.locator('textarea.popup-input');
        await personaName.waitFor({ state: 'visible', timeout: 3_000 });
        await personaName.fill('LAB测试用户');
        await onboardingDialog.locator('.popup-button-ok').click();
        await onboardingDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    }
    await page.waitForFunction(() => (
        globalThis.localStorage?.getItem('world-backstage:mama-note:seen') === '1'
        || Boolean(document.querySelector('#wb-mama-note-modal'))
    ), null, { timeout: 5_000 });
    const mamaNote = page.locator('#wb-mama-note-modal');
    if (await mamaNote.isVisible()) {
        const closeNote = mamaNote.locator('[data-wb-mama-note-close]');
        await closeNote.waitFor({ state: 'visible', timeout: 3_000 });
        await closeNote.click();
        await mamaNote.waitFor({ state: 'hidden', timeout: 3_000 });
    }
    await peopleNavAfterReload.click({ timeout: 5_000 });
    await page.waitForFunction(() => [...document.querySelectorAll(
        '.wb-root .wb-side-nav [data-wb-action="set-view"][data-view="people"]',
    )].some(button => button.closest('.wb-root')?.getClientRects().length
        && button.getAttribute('aria-current') === 'page'), null, { timeout: 5_000 });

    const relationshipReloadDiagnostics = async () => page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata?.world_backstage_v1;
        const state = store?.currentState;
        const root = [...document.querySelectorAll('.wb-root')]
            .find(element => element.getClientRects().length > 0);
        const nav = [...(root?.querySelectorAll('.wb-side-nav [data-wb-action="set-view"]') || [])]
            .map(button => ({
                view: button.dataset.view,
                current: button.getAttribute('aria-current'),
                className: button.className,
                visible: Boolean(button.getClientRects().length),
            }));
        const content = root?.querySelector('.wb-view-content');
        return {
            chatId: context.chatId,
            chatLength: context.chat?.length || 0,
            metadataKeys: Object.keys(context.chatMetadata || {}),
            people: state?.people?.map(person => ({ id: person.id, name: person.name })) || [],
            relations: state?.relationships?.relations || [],
            activeNavigation: nav,
            viewHeading: root?.querySelector('.wb-view-header h2')?.textContent || '',
            viewContentClass: content?.className || '',
            visibleText: content?.innerText?.slice(0, 3000) || '',
            rootClass: root?.className || '',
            rootPanel: root?.querySelector('.wb-panel')?.className || '',
            settingsPanelCount: root?.querySelectorAll('.wb-settings-panel').length || 0,
            relationshipManagerCount: root?.querySelectorAll('.wb-affinity-manager').length || 0,
            cards: [...(root?.querySelectorAll('.wb-affinity-relation-card') || [])]
                .map(card => card.innerText.slice(0, 180)),
            rootHtml: root?.innerHTML?.slice(0, 16_000) || '',
        };
    });
    const relationCardAfterReload = page.locator(
        '.wb-root:visible .wb-affinity-manager .wb-affinity-relation-list .wb-affinity-relation-card',
    ).filter({ hasText: 'LAB关系验证人物' }).first();
    try {
        await relationCardAfterReload.waitFor({ state: 'visible', timeout: 5_000 });
    } catch (error) {
        const diagnostics = await relationshipReloadDiagnostics();
        const evidence = {
            failure: String(error?.stack || error),
            diagnostics,
        };
        await fs.writeFile(
            path.join(evidenceDir, 'world-backstage-affinity-reload-failure.json'),
            JSON.stringify(evidence, null, 2),
        );
        await page.screenshot({
            path: path.join(evidenceDir, 'world-backstage-affinity-reload-failure.png'),
            fullPage: true,
        });
        console.log(`Affinity reload failure DOM evidence: ${JSON.stringify(evidence)}`);
        throw new Error(`Reloaded relationship UI failed: ${String(error?.message || error)}; ${JSON.stringify({
            chatId: diagnostics.chatId,
            viewHeading: diagnostics.viewHeading,
            activeNavigation: diagnostics.activeNavigation,
            relationshipManagerCount: diagnostics.relationshipManagerCount,
            relationCount: diagnostics.relations.length,
            cards: diagnostics.cards,
        })}`);
    }
    const relationshipReloadState = await relationshipReloadDiagnostics();
    console.log(`After reload relationship state: ${JSON.stringify({
        chatId: relationshipReloadState.chatId,
        viewHeading: relationshipReloadState.viewHeading,
        activeNavigation: relationshipReloadState.activeNavigation,
        people: relationshipReloadState.people,
        relations: relationshipReloadState.relations,
        cards: relationshipReloadState.cards,
    })}`);
    const persistedAfterRefresh = await relationCardAfterReload.locator('input[name="affection"]').inputValue() === '67'
        && await relationCardAfterReload.locator('input[name="trust"]').inputValue() === '44';
    const invalidationDialog = page.waitForEvent('dialog');
    const resetClick = relationCardAfterReload.locator('[data-wb-action="reset-relationship"]').evaluate(element => element.click());
    const dialog = await invalidationDialog;
    const resetConfirmationShown = dialog.type() === 'confirm';
    await dialog.accept();
    await resetClick;
    await page.waitForFunction(() => {
        const state = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1?.currentState;
        const relation = state?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === null && relation?.values?.trust === null
            && relation?.values?.romance === null;
    }, null, { timeout: 5_000 });
    const history = relationCardAfterReload.locator('.wb-affinity-history');
    await page.waitForFunction(() => [...document.querySelectorAll('.wb-affinity-relation-list .wb-affinity-history')]
        .some(element => element.textContent.includes('用户手动重置')), null, { timeout: 5_000 });
    if (await history.getAttribute('open') === null) {
        await history.locator('summary').evaluate(element => element.click());
    }
    await history.locator('.wb-affinity-history-item').filter({ hasText: '用户手动重置' }).waitFor({ state: 'visible', timeout: 5_000 });
    const resetPreservedHistory = (await history.innerText()).includes('用户手动重置');
    const eventCountBeforeInvalidInput = await page.evaluate(() =>
        globalThis.SillyTavern.getContext().chatMetadata.world_backstage_v1.currentState.relationships.events.length);
    await relationCardAfterReload.locator('input[name="affection"]').evaluate(input => {
        input.value = '101';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const invalidValueEntered = await relationCardAfterReload.locator('input[name="affection"]').inputValue() === '101';
    await relationCardAfterReload.locator('[data-wb-action="save-relationship"]').evaluate(element => element.click());
    const invalidInputRejected = invalidValueEntered && await page.evaluate(expectedCount => {
        const state = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1?.currentState;
        const relation = state?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === null && state.relationships.events.length === expectedCount;
    }, eventCountBeforeInvalidInput);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileManagerBox = await page.locator('.wb-affinity-manager').boundingBox();
    const mobileLayout = Boolean(mobileManagerBox && mobileManagerBox.width <= 390
        && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({
        path: path.join(evidenceDir, 'world-backstage-affinity-relationship-mobile.png'),
        fullPage: true,
    });
    const affinityUiRuntime = {
        unknownBeforeEdit,
        historyRendered: historyBeforeEdit.includes('LAB 历史记录'),
        manuallySaved: true,
        persistedAfterRefresh,
        resetConfirmationShown,
        resetPreservedHistory,
        invalidInputRejected,
        desktopWidth: desktopManagerBox?.width || 0,
        mobileWidth: mobileManagerBox?.width || 0,
        mobileLayout,
    };
    await fs.writeFile(
        path.join(evidenceDir, 'world-backstage-affinity-relationship-ui.json'),
        JSON.stringify(affinityUiRuntime, null, 2),
    );
    if (!unknownBeforeEdit) throw new Error('Unknown relationship dimensions were not blank');
    if (!persistedAfterRefresh) throw new Error('Manual relationship edit did not survive refresh');
    if (!resetConfirmationShown) throw new Error('Relationship reset did not ask for confirmation');
    if (!resetPreservedHistory) throw new Error('Relationship reset did not preserve its audit history');
    if (!invalidInputRejected) throw new Error('Out-of-range relationship input was persisted');
    if (!mobileLayout) throw new Error('Relationship detail layout overflows the 390px viewport');

    // An older committed result may already have an override, while a newer
    // assistant message has no simulation snapshot. Edits must update the
    // recoverable override without altering the sibling swipe.
    const branchFixture = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const affinity = await import('/scripts/extensions/third-party/world-backstage/affinity.js');
        const store = context.chatMetadata[core.STATE_KEY];
        const texts = ['LAB关系验证人物：LAB分支甲', 'LAB关系验证人物：LAB分支乙'];
        const keys = texts.map((text, swipe) => `0:${swipe}:${core.hashText(text)}`);
        function stateFor(value, key, swipe) {
            const state = structuredClone(store.currentState);
            const changed = affinity.applyManualRelationshipEdit(state.relationships, {
                sourceId: 'lab_affinity_npc', targetId: '__wb_player__',
                validPersonIds: ['lab_affinity_npc'], playerId: '__wb_player__',
                values: { affection: value, trust: 44, romance: null }, tags: [],
            });
            if (!changed.applied) throw new Error('Could not build branch fixture');
            state.relationships = changed.state;
            state.lastCommit = { messageId: 0, swipeId: swipe, sourceKey: key, at: 0 };
            return state;
        }
        const originalA = stateFor(10, keys[0], 0);
        const priorOverrideA = stateFor(25, keys[0], 0);
        const stateB = stateFor(40, keys[1], 1);
        const snapshot = (state, key, swipe) => core.createCompactSnapshot(state, {
            messageId: 0, swipeId: swipe, sourceKey: key, kind: 'result',
        });
        const records = [
            { sourceKey: keys[0], status: 'committed', result: snapshot(originalA, keys[0], 0), stale: false },
            { sourceKey: keys[1], status: 'committed', result: snapshot(stateB, keys[1], 1), stale: false },
        ];
        context.chat.splice(0, context.chat.length,
            { name: context.name2, is_user: false, is_system: false, mes: texts[0], swipes: texts,
                swipe_id: 0, swipe_info: records.map(record => ({ extra: { [core.SNAPSHOT_KEY]: record } })), extra: {} },
            { name: context.name2, is_user: false, is_system: false, mes: '未推演的新正文', extra: {} });
        store.currentState = priorOverrideA;
        store.branchOverrides = {
            [keys[0]]: snapshot(priorOverrideA, keys[0], 0),
            [keys[1]]: snapshot(stateB, keys[1], 1),
        };
        globalThis.worldBackstageHost.open();
        return { keys };
    });
    const branchCard = page.locator('.wb-affinity-manager .wb-affinity-relation-list .wb-affinity-relation-card')
        .filter({ hasText: 'LAB关系验证人物' }).first();
    await branchCard.waitFor({ state: 'visible', timeout: 5_000 });
    await branchCard.locator('input[name="affection"]').evaluate(input => {
        input.value = '73';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await branchCard.locator('[data-wb-action="save-relationship"]').evaluate(element => element.click());
    await page.waitForFunction(key => {
        const store = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1;
        return store?.branchOverrides?.[key]?.state?.relationships?.relations
            ?.find(item => item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')
            ?.values?.affection === 73;
    }, branchFixture.keys[0], { timeout: 5_000 });
    const siblingBeforeSwitch = await page.evaluate(key => {
        const store = globalThis.SillyTavern.getContext().chatMetadata.world_backstage_v1;
        return store.branchOverrides[key].state.relationships.relations
            .find(item => item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__').values.affection;
    }, branchFixture.keys[1]);
    if (siblingBeforeSwitch !== 40) throw new Error('Manual edit changed the sibling branch');
    for (const [swipe, expected] of [[1, 40], [0, 73], [1, 40]]) {
        await page.evaluate(async index => {
            const context = globalThis.SillyTavern.getContext();
            context.chat[0].swipe_id = index;
            context.chat[0].mes = context.chat[0].swipes[index];
            const types = context.eventTypes || context.event_types;
            await context.eventSource.emit(types.MESSAGE_SWIPED, 0);
        }, swipe);
        await page.waitForFunction(value => {
            const state = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1?.currentState;
            return state?.relationships?.relations?.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')
                ?.values?.affection === value;
        }, expected, { timeout: 5_000 });
    }

    const committedSourceLifecycle = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const affinity = await import('/scripts/extensions/third-party/world-backstage/affinity.js');
        const source = context.chat[0];
        const types = context.eventTypes || context.event_types;
        source.swipe_id = 0;
        source.mes = 'LAB关系验证人物：编辑已提交的 swipe A';
        await context.eventSource.emit(types.MESSAGE_EDITED, 0);
        const afterEdit = {
            selectedAStale: source.swipe_info[0].extra.world_backstage.status === 'committed'
                && source.swipe_info[0].extra.world_backstage.stale === true,
            siblingBStillValid: source.swipe_info[1].extra.world_backstage.status === 'committed'
                && source.swipe_info[1].extra.world_backstage.stale === false,
            currentAffection: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values.affection ?? null,
            relationshipInjected: String(context.extensionPrompts.world_backstage_context_support?.value || '')
                .includes('LAB关系验证人物'),
        };
        source.swipe_id = 1;
        source.mes = source.swipes[1];
        await context.eventSource.emit(types.MESSAGE_SWIPED, 0);
        afterEdit.siblingRestore = store.currentState.relationships.relations.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values.affection ?? null;
        afterEdit.siblingInjectionRestored = String(context.extensionPrompts.world_backstage_context_support?.value || '')
            .includes('LAB关系验证人物');
        const futureText = 'LAB关系验证人物：删除点之后，仍记得玩家救下我的经历。';
        const futureKey = `1:0:${core.hashText(futureText)}`;
        const futureState = structuredClone(store.currentState);
        const futureAnalysis = affinity.applyAffinityAnalysisPayload(futureState.relationships, {
            changes: [{
                source_id: 'lab_affinity_npc', target_id: '__wb_player__',
                affection_delta: 12, trust_delta: 9, romance_delta: 0,
                relation_tag_suggestion: ['共同经历', '信任增加'],
                reason: '来源删除回归：人物回应一次救援经历。',
                memory_note: '来源删除回归的关系记忆标记：她记得玩家救下了她。',
            }],
        }, {
            validPersonIds: ['lab_affinity_npc'], playerId: '__wb_player__',
            sourceKey: futureKey, sourceMessageId: 1, sourceSwipeId: 0,
            romanceEnabled: false,
        });
        if (futureAnalysis.appliedCount !== 1) throw new Error('Could not prepare post-source AI relationship snapshot');
        futureState.relationships = futureAnalysis.state;
        futureState.lastCommit = { messageId: 1, swipeId: 0, sourceKey: futureKey, at: 1 };
        const futureRecord = {
            sourceKey: futureKey, status: 'committed', stale: false,
            result: core.createCompactSnapshot(futureState, {
                messageId: 1, swipeId: 0, sourceKey: futureKey, kind: 'result',
            }),
        };
        const futureMessage = context.chat[1];
        futureMessage.name = context.name2;
        futureMessage.is_user = false;
        futureMessage.mes = futureText;
        futureMessage.extra ||= {};
        futureMessage.extra[core.SNAPSHOT_KEY] = futureRecord;
        context.chat.splice(0, 1);
        await context.eventSource.emit(types.MESSAGE_DELETED, 0);
        return {
            afterEdit,
            deletedSourceRemoved: !context.chat.includes(source),
            postSourceSnapshotStale: futureRecord.stale === true,
            afterDeleteAffection: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values.affection ?? null,
            afterDeleteInjection: String(context.extensionPrompts.world_backstage_context_support?.value || '')
                .includes('LAB关系验证人物'),
            afterDeleteMemoryNoteInjected: String(context.extensionPrompts.world_backstage_context_support?.value || '')
                .includes('来源删除回归的关系记忆标记'),
            activeDeletedSourceEvents: store.currentState.relationships.events.filter(event =>
                event.status === 'active' && event.sourceKey === futureKey).length,
        };
    });
    console.log(`Committed source lifecycle: ${JSON.stringify(committedSourceLifecycle)}`);
    if (!committedSourceLifecycle.afterEdit.selectedAStale
        || !committedSourceLifecycle.afterEdit.siblingBStillValid
        || committedSourceLifecycle.afterEdit.currentAffection !== null
        || committedSourceLifecycle.afterEdit.siblingRestore !== 40
        || committedSourceLifecycle.afterEdit.relationshipInjected
        || !committedSourceLifecycle.afterEdit.siblingInjectionRestored
        || !committedSourceLifecycle.deletedSourceRemoved
        || !committedSourceLifecycle.postSourceSnapshotStale
        || committedSourceLifecycle.afterDeleteAffection !== null
        || committedSourceLifecycle.afterDeleteInjection
        || committedSourceLifecycle.afterDeleteMemoryNoteInjected
        || committedSourceLifecycle.activeDeletedSourceEvents !== 0) {
        throw new Error(`Committed swipe edit/delete rollback mismatch: ${JSON.stringify(committedSourceLifecycle)}`);
    }

    // Use a real MESSAGE_RECEIVED host event and a controlled proxy response
    // that distinguishes world simulation from the subsequent affinity task.
    const affinityFixtureReady = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const affinity = await import('/scripts/extensions/third-party/world-backstage/affinity.js');
        const store = context.chatMetadata[core.STATE_KEY];
        const state = structuredClone(store.currentState);
        state.people = Array.isArray(state.people) ? state.people : [];
        if (!state.people.some(person => person.id === 'lab_affinity_npc')) {
            state.people.push({
                id: 'lab_affinity_npc', name: 'LAB关系验证人物', isUser: false,
                knowledge: 'known', locked: true,
            });
        }
        state.lastCommit = null;
        const baseline = affinity.applyManualRelationshipEdit(state.relationships, {
            sourceId: 'lab_affinity_npc', targetId: '__wb_player__',
            validPersonIds: ['lab_affinity_npc'], playerId: '__wb_player__',
            values: { affection: 40, trust: 40, romance: null }, tags: [],
        });
        if (!baseline.applied) throw new Error('Could not seed affinity fixture relationship');
        state.relationships = baseline.state;
        store.currentState = state;
        store.branchOverrides = {};
        context.chat.splice(0, context.chat.length,
            { name: context.name1, is_user: true, is_system: false, mes: '我和她一起经历了危险。', extra: {} },
            {
                name: context.name2, is_user: false, is_system: false,
                mes: 'LAB关系验证人物：谢谢你救了我，我很感谢你，也开始信任你。',
                swipes: ['LAB关系验证人物：谢谢你救了我，我很感谢你，也开始信任你。'],
                swipe_id: 0, extra: {},
            });
        const settings = context.extensionSettings.world_backstage;
        globalThis.__wbAffinityFixtureSavedSettings = structuredClone(settings);
        Object.assign(settings, {
            enabled: true, worldSimulationEnabled: true, worldAutoEnabled: true,
            autoSimulationInterval: 1, affinityEnabled: true, affinityAutoEnabled: true,
            affinityRomanceEnabled: false, apiMode: 'custom',
            customApiUrl: 'https://controlled-response.invalid/v1/chat/completions',
            customApiKey: 'fixture-only', customApiModel: 'controlled-response-fixture',
            customApiTransport: 'proxy', autoRetryCount: 0,
            apiModuleRoutes: { ...(settings.apiModuleRoutes || {}), simulation: 'default', affinity: 'default' },
        });
        const originalFetch = globalThis.fetch.bind(globalThis);
        const payload = {
            changes: [{
                source_id: 'lab_affinity_npc', target_id: '__wb_player__',
                affection_delta: 17, trust_delta: -11, romance_delta: 19,
                relation_tag_suggestion: ['感激', '谨慎'],
                reason: '可控响应：救援带来感激，但戒心仍在。',
                memory_note: '可控夹具记载：玩家救下了LAB关系验证人物。',
            }],
        };
        const response = (analysisPayload = payload) => ({
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisPayload) }, finish_reason: 'stop' }] }),
        });
        const fixture = {
            calls: { simulation: 0, affinity: 0 }, heldAffinity: null, holdNextAffinity: false,
            neutralUnheldAffinity: false,
            restore: () => { globalThis.fetch = originalFetch; },
            releaseHeldAffinity() {
                const held = this.heldAffinity;
                if (!held) throw new Error('No held affinity request');
                held.released = true;
                held.signalAbortedAtRelease = Boolean(held.signal?.aborted);
                held.resolve({
                    ...response(held.payload),
                    text: async () => { held.responseRead = true; return (await response(held.payload).text()); },
                });
            },
        };
        globalThis.__wbAffinityFixture = fixture;
        const marker = '【任务】判断输入事件是否对人物之间的持续关系造成了变化。';
        globalThis.fetch = (input, options = {}) => {
            if (!String(input).includes('/api/backends/chat-completions/generate')) return originalFetch(input, options);
            let body = '';
            try { body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body || {}); } catch {}
            if (body.includes(marker)) {
                fixture.calls.affinity += 1;
                const analysisPayload = fixture.neutralUnheldAffinity ? { changes: [] } : payload;
                if (fixture.holdNextAffinity) {
                    fixture.holdNextAffinity = false;
                    return new Promise(resolve => {
                        fixture.heldAffinity = {
                            resolve, payload: analysisPayload, signal: options.signal, released: false,
                            responseRead: false, signalAbortedAtRelease: false,
                        };
                    });
                }
                return Promise.resolve(response(analysisPayload));
            }
            fixture.calls.simulation += 1;
            return Promise.resolve({
                ok: true, status: 200,
                text: async () => JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
            });
        };
        globalThis.worldBackstageHost.open();
        return true;
    });
    if (!affinityFixtureReady) throw new Error('Could not prepare affinity response fixture');
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const types = context.eventTypes || context.event_types;
        await context.eventSource.emit(types.MESSAGE_RECEIVED, 1, 'normal');
    });
    await page.waitForFunction(() => {
        const status = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.();
        return status?.lastTask?.phase === 'success'
            && status.lastTask.stage === 'committed'
            && status.lastTask.commitOutcome === 'success'
            && status.lastTask.finishedAt && status.activeTasks.length === 0;
    }, null, { timeout: 30_000 });
    const positive = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const state = context.chatMetadata.world_backstage_v1.currentState;
        const relation = state.relationships.relations.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        const event = [...state.relationships.events].reverse().find(item =>
            item.origin === 'ai' && item.sourceMessageId === 1);
        return {
            calls: { ...globalThis.__wbAffinityFixture.calls },
            values: relation?.values || null, tags: relation?.tags || [],
            event: event || null,
            prompt: context.extensionPrompts.world_backstage_context_support?.value || '',
            romanceDisabled: context.extensionSettings.world_backstage.affinityRomanceEnabled === false,
        };
    });
    console.log('Affinity positive control: ' + JSON.stringify(positive));
    if (positive.calls.simulation < 1 || positive.calls.affinity !== 1
        || positive.values?.affection !== 57 || positive.values?.trust !== 29
        || positive.values?.romance !== null
        || !positive.tags.includes('感激') || !positive.tags.includes('谨慎')
        || positive.event?.sourceId !== 'lab_affinity_npc'
        || positive.event?.targetId !== '__wb_player__'
        || !positive.event?.reason?.includes('可控响应')
        || !positive.event?.memoryNote?.includes('救下')
        || positive.event?.sourceMessageId !== 1
        || !positive.romanceDisabled) {
        throw new Error('Affinity positive-control payload did not commit: ' + JSON.stringify(positive));
    }

    // Reprocessing the committed host message must not create another affinity event.
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const types = context.eventTypes || context.event_types;
        await context.eventSource.emit(types.MESSAGE_RECEIVED, 1, 'normal');
    });
    await page.waitForFunction(() => {
        const fixture = globalThis.__wbAffinityFixture;
        const task = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.();
        return fixture?.calls.affinity === 1 && task?.activeTasks?.length === 0;
    }, null, { timeout: 5_000 });
    const duplicate = await page.evaluate(() => {
        const state = globalThis.SillyTavern.getContext().chatMetadata.world_backstage_v1.currentState;
        const relation = state.relationships.relations.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return {
            calls: globalThis.__wbAffinityFixture.calls.affinity,
            values: relation?.values || null,
            tags: relation?.tags || [],
            aiEvents: state.relationships.events.filter(event => event.origin === 'ai').length,
        };
    });
    if (duplicate.calls !== 1 || duplicate.values?.affection !== 57 || duplicate.values?.trust !== 29
        || duplicate.values?.romance !== null || !duplicate.tags.includes('感激')
        || !duplicate.tags.includes('谨慎') || duplicate.aiEvents !== 1) {
        throw new Error('Repeated source processing accumulated a duplicate relationship: ' + JSON.stringify(duplicate));
    }

    const readyForLateAffinity = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const fixture = globalThis.__wbAffinityFixture;
        fixture.holdNextAffinity = true;
        context.chat.push(
            { name: context.name1, is_user: true, is_system: false, mes: '我又想起那次危险。', extra: {} },
            {
                name: context.name2, is_user: false, is_system: false,
                mes: 'LAB关系验证人物：我感谢你救了我，但信任需要时间。',
                swipes: ['LAB关系验证人物：我感谢你救了我，但信任需要时间。'],
                swipe_id: 0, extra: {},
            },
        );
        return true;
    });
    if (!readyForLateAffinity) throw new Error('Could not prepare delayed affinity event');
    const peopleNavForRace = page.locator('.wb-side-nav [data-wb-action="set-view"][data-view="people"]');
    await peopleNavForRace.waitFor({ state: 'visible', timeout: 5_000 });
    await peopleNavForRace.evaluate(element => element.click());
    const raceCard = page.locator('.wb-affinity-manager .wb-affinity-relation-list .wb-affinity-relation-card')
        .filter({ hasText: 'LAB关系验证人物' }).first();
    await raceCard.waitFor({ state: 'visible', timeout: 5_000 });
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const types = context.eventTypes || context.event_types;
        await context.eventSource.emit(types.MESSAGE_RECEIVED, 3, 'normal');
    });
    await page.waitForFunction(() => Boolean(globalThis.__wbAffinityFixture?.heldAffinity), null, { timeout: 30_000 });
    await raceCard.evaluate(card => {
        for (const [name, value] of Object.entries({ affection: '73', trust: '44', tags: '朋友，戒备' })) {
            const input = card.querySelector('[name="' + name + '"]');
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    await raceCard.locator('[data-wb-action="save-relationship"]').evaluate(element => element.click());
    await page.waitForFunction(() => {
        const state = globalThis.SillyTavern.getContext().chatMetadata?.world_backstage_v1?.currentState;
        const relation = state?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === 73 && relation?.values?.trust === 44
            && state.relationships.events.at(-1)?.origin === 'manual';
    }, null, { timeout: 5_000 });
    await page.evaluate(() => {
            const fixture = globalThis.__wbAffinityFixture;
            fixture.neutralUnheldAffinity = true;
            fixture.releaseHeldAffinity();
        });
    await page.waitForFunction(() => {
        const task = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.();
        return task?.lastTask?.phase === 'cancelled' && task.lastTask.stage === 'cancelled'
            && task.lastTask.finishedAt && task.activeTasks.length === 0;
    }, null, { timeout: 20_000 });
    const delayed = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        const state = store.currentState;
        const relation = state.relationships.relations.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        const held = globalThis.__wbAffinityFixture.heldAffinity;
        const source = context.chat[3]?.extra?.world_backstage;
        const prompt = context.extensionPrompts.world_backstage_context_support?.value || '';
        return {
            values: relation?.values || null, tags: relation?.tags || [],
            lastOrigin: state.relationships.events.at(-1)?.origin || '',
            lateAiEvent: state.relationships.events.some(event =>
                event.origin === 'ai' && event.sourceMessageId === 3),
            manualEvent: state.relationships.events.some(event =>
                event.origin === 'manual' && event.manualValues?.affection === 73),
            promptHasManual: prompt.includes('朋友') && prompt.includes('戒备'),
            sourceStatus: source?.status || '',
            released: held.released, responseRead: held.responseRead,
            abortedAtRelease: held.signalAbortedAtRelease,
            task: globalThis.worldBackstageHost.getRuntimeTaskStatus().lastTask,
        };
    });
    console.log('Delayed affinity response after manual edit: ' + JSON.stringify(delayed));
    if (delayed.values?.affection !== 73 || delayed.values?.trust !== 44
        || !delayed.tags.includes('朋友') || !delayed.tags.includes('戒备')
        || delayed.lastOrigin !== 'manual' || delayed.lateAiEvent || !delayed.manualEvent
        || !delayed.promptHasManual || delayed.sourceStatus === 'committed'
        || !delayed.released || !delayed.responseRead || !delayed.abortedAtRelease
        || delayed.task.phase !== 'cancelled') {
        throw new Error('Late affinity payload overwrote manual state: ' + JSON.stringify(delayed));
    }


    // Create and persist a second real SillyTavern chat for the same character.
    // openCharacterChat/getChat/reloadCurrentChat exercise the host's file-backed
    // chat lifecycle; this does not replace the live context.chat object.
    const separateChats = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const types = context.eventTypes || context.event_types;
        // The manual-edit race above deliberately leaves its source pending.
        // Roll that source back through the real host deletion event before
        // using this chat as a persistence baseline.
        if (context.chat.length > 3) {
            context.chat.splice(2);
            await context.eventSource.emit(types.MESSAGE_DELETED, 2);
        }
        const nameA = context.getCurrentChatId();
        const preIsolationStore = context.chatMetadata[core.STATE_KEY];
        preIsolationStore.currentState.pendingSync = false;
        await context.saveMetadata();
        await context.saveChat();
        const storeA = context.chatMetadata[core.STATE_KEY];
        const aState = structuredClone(storeA.currentState);
        aState.lastCommit = null;
        aState.pendingSync = false;
        const a = {
            name: nameA,
            relation: storeA.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__') || null,
            history: storeA.currentState.relationships.events.map(item => item.id),
            rootOverride: Boolean(storeA.branchOverrides?.root),
            branchOverrides: Object.keys(storeA.branchOverrides || {}).filter(key => key !== 'root'),
        };
        const nameB = 'WB-affinity-isolation-' + Date.now();
        await context.openCharacterChat(nameB);
        context.chat.splice(0, context.chat.length,
            { name: context.name1, is_user: true, is_system: false, mes: 'CHAT_B_ONLY_MARKER：LAB关系验证人物，我在聊天B记下这段关系。', extra: {} },
            { name: context.name2, is_user: false, is_system: false, mes: 'LAB关系验证人物记住了聊天B。', extra: {} });
        await context.saveChat();
        return { a, aState, nameB };
    });
    if (!separateChats.a.name || !separateChats.nameB
        || separateChats.a.relation?.values?.affection !== 73
        || separateChats.a.relation?.values?.trust !== 44
        || !separateChats.a.branchOverrides.length) {
        throw new Error('Chat A did not have the expected persisted relationship baseline: ' + JSON.stringify(separateChats.a));
    }
    await page.evaluate(() => globalThis.worldBackstageHost?.open?.());
    const settingsLayerForImport = page.locator('.wb-root .wb-settings-layer');
    if (!(await settingsLayerForImport.isVisible())) {
        await page.locator('.wb-root button[data-wb-action="toggle-settings"][aria-label="全局设置"]')
            .first().evaluate(element => element.click());
        await settingsLayerForImport.waitFor({ state: 'visible', timeout: 5_000 });
    }
    const advancedData = page.locator('details[data-settings-subgroup="advanced-data"]').first();
    await advancedData.evaluate(element => { element.open = true; });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.wb-import-input').first().setInputFiles({
        name: 'chat-a-relationship-baseline.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
            format: 'world-backstage-state', version: 26,
            state: separateChats.aState,
        })),
    });
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata?.world_backstage_v1;
        const relation = store?.currentState?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return store?.currentState?.people?.some(person => person.id === 'lab_affinity_npc')
            && relation?.values?.affection === 73 && relation?.values?.trust === 44
            && store.branchOverrides?.root;
    }, null, { timeout: 10_000 });
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        await context.saveChat();
        await context.reloadCurrentChat();
    });
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata?.world_backstage_v1;
        const relation = store?.currentState?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === 73 && relation?.values?.trust === 44;
    }, null, { timeout: 10_000 });
    await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        context.chatMetadata.world_backstage_v1.currentState.lastCommit = null;
        globalThis.worldBackstageHost?.refreshLauncher?.();
    });
    await page.locator('.wb-side-nav [data-wb-action="set-view"][data-view="people"]:visible').last()
        .evaluate(element => element.click());
    const chatBDiagnostic = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        return {
            chatId: context.getCurrentChatId(),
            personIds: store.currentState.people.map(person => person.id),
            relations: store.currentState.relationships.relations.map(item => ({
                sourceId: item.sourceId, targetId: item.targetId, values: item.values, tags: item.tags,
            })),
            rootOverride: Boolean(store.branchOverrides?.root),
            currentView: document.querySelector('.wb-side-nav [data-view="people"]')?.getAttribute('aria-current'),
            managerCount: document.querySelectorAll('.wb-affinity-manager').length,
            managerText: document.querySelector('.wb-affinity-manager')?.innerText || '',
            visibleCards: [...document.querySelectorAll('.wb-affinity-relation-card')].filter(node =>
                Boolean(node.getClientRects().length)).map(node => node.innerText),
        };
    });
    console.log('New chat relationship view before edit: ' + JSON.stringify(chatBDiagnostic));
    await page.screenshot({ path: path.join(evidenceDir, 'world-backstage-chat-b-before-edit.png'), fullPage: true });
    const chatBCard = page.locator('.wb-affinity-manager .wb-affinity-relation-list .wb-affinity-relation-card:visible')
        .filter({ hasText: 'LAB关系验证人物' }).first();
    await chatBCard.waitFor({ state: 'visible', timeout: 5_000 });
    await chatBCard.evaluate(card => {
        for (const [name, value] of Object.entries({ affection: '24', trust: '76', romance: '', tags: 'B-only，B-history' })) {
            const input = card.querySelector('[name="' + name + '"]');
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
    await chatBCard.locator('[data-wb-action="save-relationship"]').evaluate(element => element.click());
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata?.world_backstage_v1;
        const relation = store?.currentState?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return relation?.values?.affection === 24 && relation?.values?.trust === 76;
    }, null, { timeout: 5_000 });
    const bManualHistoryId = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        await context.saveChat();
        const events = context.chatMetadata.world_backstage_v1.currentState.relationships.events;
        return [...events].reverse().find(item =>
            item.origin === 'manual' && item.manualValues?.affection === 24)?.id || '';
    });
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
    }, separateChats.a.name);
    await page.waitForFunction(expected =>
        globalThis.SillyTavern.getContext().getCurrentChatId() === expected,
    separateChats.a.name, { timeout: 10_000 });
    const switchedBackA = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata?.world_backstage_v1;
        const relation = store?.currentState?.relationships?.relations?.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return {
            chatId: context.getCurrentChatId(),
            values: relation?.values || null,
            tags: relation?.tags || [],
            history: store?.currentState?.relationships?.events?.map(item => ({
                id: item.id, origin: item.origin, values: item.manualValues, reason: item.reason,
            })) || [],
            rootOverride: Boolean(store?.branchOverrides?.root),
            branchKeys: Object.keys(store?.branchOverrides || {}).filter(key => key !== 'root'),
            initialRelation: store?.initialState?.relationships?.relations?.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
        };
    });
    console.log('A chat after file switch before reload: ' + JSON.stringify(switchedBackA));
    if (switchedBackA.values?.affection !== 73 || switchedBackA.values?.trust !== 44) {
        throw new Error('Chat A state did not restore after switching back: ' + JSON.stringify(switchedBackA));
    }
    await page.evaluate(async () => globalThis.SillyTavern.getContext().reloadCurrentChat());
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const prompt = context.extensionPrompts.world_backstage_context_support?.value || '';
        return prompt.includes('朋友') && prompt.includes('戒备');
    }, null, { timeout: 10_000 });
    const reloadedA = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        return {
            chatId: context.getCurrentChatId(),
            values: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            tags: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.tags || [],
            historyHasA: store.currentState.relationships.events.some(item =>
                item.origin === 'manual' && item.manualValues?.affection === 73),
            hasRoot: Boolean(store.branchOverrides?.root),
            branchKeys: Object.keys(store.branchOverrides || {}).filter(key => key !== 'root'),
            injection: context.extensionPrompts.world_backstage_context_support?.value || '',
        };
    });
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
        await context.reloadCurrentChat();
    }, separateChats.nameB);
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        const prompt = context.extensionPrompts.world_backstage_context_support?.value || '';
        return prompt.includes('B-only') && prompt.includes('B-history');
    }, null, { timeout: 10_000 });
    const reloadedB = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const diskResponse = await fetch('/api/chats/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ch_name: context.name2, file_name: context.getCurrentChatId(),
                avatar_url: context.characters?.[context.characterId]?.avatar,
            }),
        });
        const diskPayload = await diskResponse.json();
        const diskStore = diskPayload?.[0]?.chat_metadata?.world_backstage_v1;
        const store = context.chatMetadata.world_backstage_v1;
        const relation = store.currentState.relationships.relations.find(item =>
            item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__');
        return {
            chatId: context.getCurrentChatId(),
            values: relation?.values || null,
            tags: relation?.tags || [],
            historyHasB: store.currentState.relationships.events.some(item =>
                item.origin === 'manual' && item.manualValues?.affection === 24),
            hasRoot: Boolean(store.branchOverrides?.root),
            branchKeys: Object.keys(store.branchOverrides || {}).filter(key => key !== 'root'),
            injection: context.extensionPrompts.world_backstage_context_support?.value || '',
            diskValues: diskStore?.currentState?.relationships?.relations?.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            diskRoot: Boolean(diskStore?.branchOverrides?.root),
            diskHistoryCount: diskStore?.currentState?.relationships?.events?.length || 0,
        };
    });
    console.log('B chat after file reload and direct disk read: ' + JSON.stringify(reloadedB));
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
        await context.reloadCurrentChat();
    }, separateChats.a.name);
    const chatIsolation = {
        a: reloadedA,
        b: reloadedB,
        diskNamesDistinct: reloadedA.chatId !== reloadedB.chatId,
    };
    console.log('Real ST A→B→A chat-file isolation: ' + JSON.stringify(chatIsolation));
    await page.evaluate(data => {
        globalThis.__wbAffinityAcceptanceEvidence = { chatIsolation: data, lateAffinity: [] };
    }, chatIsolation);
    if (reloadedA.chatId !== separateChats.a.name || reloadedB.chatId !== separateChats.nameB
        || !chatIsolation.diskNamesDistinct || reloadedA.values?.affection !== 73
        || reloadedA.values?.trust !== 44 || !reloadedA.historyHasA
        || !reloadedA.tags.includes('朋友') || !reloadedA.tags.includes('戒备')
        || !reloadedA.injection.includes('LAB关系验证人物')
        || !reloadedA.injection.includes('朋友') || !reloadedA.injection.includes('戒备')
        || reloadedB.values?.affection !== 24 || reloadedB.values?.trust !== 76
        || !reloadedB.historyHasB || !reloadedB.tags.includes('B-history')
        || !reloadedB.hasRoot || reloadedA.historyHasB || reloadedB.historyHasA) {
        throw new Error('Real ST chat files shared or lost relationship state: ' + JSON.stringify(chatIsolation));
    }
    if (!separateChats.a.branchOverrides.length || !reloadedA.branchKeys.length) {
        throw new Error('Chat A lost its saved branch override keys after server reload');
    }

    const lateAffinityResults = [];
    const runLateAffinityCase = async (name, operation) => {
        await page.waitForFunction(() => {
            const status = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.();
            return status && status.activeTasks.length === 0
                && !['running', 'cancelling'].includes(status.lastTask?.phase);
        }, null, { timeout: 30_000 });
        const preflight = await page.evaluate(() => {
            const context = globalThis.SillyTavern.getContext();
            const status = globalThis.worldBackstageHost.getRuntimeTaskStatus();
            return {
                chatId: context.getCurrentChatId(),
                calls: { ...globalThis.__wbAffinityFixture.calls },
                activeTasks: status.activeTasks,
                lastTask: status.lastTask,
            };
        });
        console.log('Late affinity preflight: ' + JSON.stringify({ name, ...preflight }));
        const prepared = await page.evaluate(async name => {
            const context = globalThis.SillyTavern.getContext();
            const fixture = globalThis.__wbAffinityFixture;
            const types = context.eventTypes || context.event_types;
            const priorTaskMessageId = Number(
                globalThis.worldBackstageHost.getRuntimeTaskStatus().lastTask?.messageId ?? -1,
            );
            let messageId = context.chat.length + 1;
            while (messageId <= priorTaskMessageId) {
                const pad = context.chat.length;
                context.chat.push(
                    { name: context.name1, is_user: true, is_system: false, mes: '旧任务之后的隔离占位', extra: {} },
                    { name: context.name2, is_user: false, is_system: false, mes: '隔离占位，不触发关系事件。', extra: {} },
                );
                messageId = pad + 3;
            }
            const text = '我冒险救下了LAB关系验证人物。';
            context.chat.push(
                { name: context.name1, is_user: true, is_system: false, mes: text, extra: {} },
                {
                    name: context.name2, is_user: false, is_system: false,
                    mes: 'LAB关系验证人物：我感谢你救了我，我开始信任你。',
                    extra: {},
                },
            );
            if (name === 'swipe') {
                const assistant = context.chat[messageId];
                assistant.swipes = [assistant.mes, assistant.mes + '（另一条重抽）'];
                assistant.swipe_id = 0;
            }
            await context.saveChat();
            fixture.heldAffinity = null;
            fixture.neutralUnheldAffinity = false;
            fixture.holdNextAffinity = true;
            await context.eventSource.emit(types.MESSAGE_RECEIVED, messageId, 'normal');
            return { messageId, chatId: context.getCurrentChatId(), typeName: types.MESSAGE_RECEIVED };
        }, name);
        await page.waitForFunction(expected => {
            const fixture = globalThis.__wbAffinityFixture;
            const task = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.()?.lastTask;
            return fixture?.heldAffinity && task?.messageId === expected.messageId
                && task?.chatToken === expected.chatId;
        }, { messageId: prepared.messageId, chatId: prepared.chatId }, { timeout: 30_000 });
        const heldBeforeOperation = await page.evaluate(() => {
            const held = globalThis.__wbAffinityFixture.heldAffinity;
            return Boolean(held && !held.released && !held.responseRead);
        });
        if (!heldBeforeOperation) throw new Error(name + ': affinity response was not held before the host action');
        await operation(prepared);
        const beforeRelease = await page.evaluate(expected => {
            const context = globalThis.SillyTavern.getContext();
            const store = context.chatMetadata?.world_backstage_v1;
            const state = store?.currentState;
            const task = globalThis.worldBackstageHost.getRuntimeTaskStatus().lastTask;
            return {
                chatId: context.getCurrentChatId(),
                messageId: expected.messageId,
                state: structuredClone(state),
                branchOverrides: structuredClone(store?.branchOverrides || {}),
                injection: context.extensionPrompts.world_backstage_context_support?.value || '',
                sourceSnapshot: structuredClone(context.chat[expected.messageId]?.extra?.world_backstage || null),
                task: task && { ...task },
                sourcePresent: Boolean(context.chat[expected.messageId]),
            };
        }, prepared);
        await page.evaluate(() => globalThis.__wbAffinityFixture.releaseHeldAffinity());
        await page.waitForFunction(expected => {
            const task = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.()?.lastTask;
            return task?.phase === 'cancelled' && task.stage === 'cancelled'
                && task.finishedAt && task.messageId === expected.messageId
                && task.chatToken === expected.chatId
                && globalThis.worldBackstageHost.getRuntimeTaskStatus().activeTasks.length === 0;
        }, { messageId: prepared.messageId, chatId: prepared.chatId }, { timeout: 20_000 });
        const afterRelease = await page.evaluate(expected => {
            const context = globalThis.SillyTavern.getContext();
            const store = context.chatMetadata?.world_backstage_v1;
            const held = globalThis.__wbAffinityFixture.heldAffinity;
            const task = globalThis.worldBackstageHost.getRuntimeTaskStatus().lastTask;
            return {
                chatId: context.getCurrentChatId(),
                state: structuredClone(store?.currentState),
                branchOverrides: structuredClone(store?.branchOverrides || {}),
                injection: context.extensionPrompts.world_backstage_context_support?.value || '',
                sourceSnapshot: structuredClone(context.chat[expected.messageId]?.extra?.world_backstage || null),
                held: { released: held.released, responseRead: held.responseRead, abortedAtRelease: held.signalAbortedAtRelease },
                task: task && { ...task },
                activeTasks: globalThis.worldBackstageHost.getRuntimeTaskStatus().activeTasks,
            };
        }, prepared);
        const comparableState = state => {
            if (!state) return state;
            const copy = structuredClone(state);
            delete copy.updatedAt;
            return copy;
        };
        const noLateCommit = JSON.stringify(comparableState(beforeRelease.state)) === JSON.stringify(comparableState(afterRelease.state))
            && JSON.stringify(beforeRelease.sourceSnapshot) === JSON.stringify(afterRelease.sourceSnapshot)
            && JSON.stringify(beforeRelease.branchOverrides) === JSON.stringify(afterRelease.branchOverrides)
            && beforeRelease.injection === afterRelease.injection
            && !afterRelease.state.relationships.events.some(event =>
                event.origin === 'ai' && event.sourceMessageId === prepared.messageId)
            && !afterRelease.state.relationships.events.some(event =>
                event.sourceMessageId === prepared.messageId
                && event.memoryNote?.includes('可控夹具记载'))
            && afterRelease.held.released && afterRelease.held.responseRead
            && afterRelease.held.abortedAtRelease
            && afterRelease.task?.phase === 'cancelled'
            && afterRelease.task?.commitOutcome === 'none'
            && afterRelease.task?.finishedAt
            && afterRelease.task?.messageId === prepared.messageId
            && afterRelease.task?.chatToken === prepared.chatId
            && afterRelease.activeTasks.length === 0;
        const result = { name, prepared, beforeRelease, afterRelease, noLateCommit };
        lateAffinityResults.push(result);
        await page.evaluate(data => {
            globalThis.__wbAffinityAcceptanceEvidence ||= { lateAffinity: [] };
            globalThis.__wbAffinityAcceptanceEvidence.lateAffinity ||= [];
            globalThis.__wbAffinityAcceptanceEvidence.lateAffinity.push(data);
        }, result);
        console.log('Late affinity scenario: ' + JSON.stringify(result));
        if (!noLateCommit) throw new Error(name + ': released stale affinity payload altered saved relationship state');
        return result;
    };

    await runLateAffinityCase('swipe', async prepared => {
        await page.evaluate(async id => {
            const context = globalThis.SillyTavern.getContext();
            const types = context.eventTypes || context.event_types;
            const message = context.chat[id];
            message.swipe_id = 1;
            message.mes = message.swipes[1];
            await context.eventSource.emit(types.MESSAGE_SWIPED, id);
            await context.saveChat();
        }, prepared.messageId);
    });
    await runLateAffinityCase('edit', async prepared => {
        await page.evaluate(async id => {
            const context = globalThis.SillyTavern.getContext();
            const types = context.eventTypes || context.event_types;
            context.chat[id].mes += '（来源消息已编辑）';
            await context.eventSource.emit(types.MESSAGE_EDITED, id);
            await context.saveChat();
        }, prepared.messageId);
    });
    await runLateAffinityCase('delete', async prepared => {
        await page.evaluate(async id => {
            const context = globalThis.SillyTavern.getContext();
            const types = context.eventTypes || context.event_types;
            context.chat.splice(id, 1);
            await context.eventSource.emit(types.MESSAGE_DELETED, id);
            await context.saveChat();
        }, prepared.messageId);
    });
    await runLateAffinityCase('stop', async () => {
        const stop = page.locator('[data-wb-action="cancel-simulation"]:visible').last();
        await stop.waitFor({ state: 'visible', timeout: 5_000 });
        await stop.evaluate(element => element.click());
    });
    const stopRace = lateAffinityResults.find(item => item.name === 'stop');
    const retryMessage = stopRace.prepared.messageId;
    const affinityCallsBeforeRetry = await page.evaluate(() => globalThis.__wbAffinityFixture.calls.affinity);
    await page.evaluate(() => { globalThis.__wbAffinityFixture.neutralUnheldAffinity = false; });
    await page.locator('[data-wb-action="manual-sync"]:visible').last()
        .evaluate(element => element.click());
    await page.waitForFunction(expected => {
        const task = globalThis.worldBackstageHost?.getRuntimeTaskStatus?.()?.lastTask;
        return task?.phase === 'success' && task.stage === 'committed'
            && task.commitOutcome === 'success' && task.finishedAt
            && task.messageId === expected;
    }, retryMessage, { timeout: 30_000 });
    const retryResult = await page.evaluate(id => {
        const context = globalThis.SillyTavern.getContext();
        const state = context.chatMetadata.world_backstage_v1.currentState;
        const events = state.relationships.events.filter(event =>
            event.origin === 'ai' && event.sourceMessageId === id);
        return {
            eventCount: events.length,
            values: state.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            sourceStatus: context.chat[id]?.extra?.world_backstage?.status || '',
            task: globalThis.worldBackstageHost.getRuntimeTaskStatus().lastTask,
            affinityCalls: globalThis.__wbAffinityFixture.calls.affinity,
        };
    }, retryMessage);
    retryResult.callsBefore = affinityCallsBeforeRetry;
    console.log('Explicit retry after cancellation: ' + JSON.stringify(retryResult));
    await page.evaluate(data => {
        globalThis.__wbAffinityAcceptanceEvidence ||= {};
        globalThis.__wbAffinityAcceptanceEvidence.retryAfterCancel = data;
    }, retryResult);

    const chatSwitchRace = await runLateAffinityCase('chat-switch', async () => {
        await page.evaluate(async name => {
            const context = globalThis.SillyTavern.getContext();
            await context.saveChat();
            await context.openCharacterChat(name);
        }, separateChats.nameB);
    });
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
        await context.reloadCurrentChat();
    }, separateChats.a.name);
    const afterChatSwitchA = await page.evaluate(expectedMessageId => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        return {
            chatId: context.getCurrentChatId(),
            values: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            events: store.currentState.relationships.events.map(item => item.id),
            lateSourceEvents: store.currentState.relationships.events.filter(item =>
                item.origin === 'ai' && item.sourceMessageId === expectedMessageId),
        };
    }, chatSwitchRace.prepared.messageId);
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
        await context.reloadCurrentChat();
    }, separateChats.nameB);
    const afterChatSwitchB = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const store = context.chatMetadata.world_backstage_v1;
        return {
            chatId: context.getCurrentChatId(),
            values: store.currentState.relationships.relations.find(item =>
                item.sourceId === 'lab_affinity_npc' && item.targetId === '__wb_player__')?.values || null,
            historyHasB: store.currentState.relationships.events.some(item =>
                item.origin === 'manual' && item.manualValues?.affection === 24),
            lateAiEvents: store.currentState.relationships.events.filter(item =>
                item.origin === 'ai' && item.sourceMessageId === chatSwitchRace.prepared.messageId).length,
        };
    });
    await page.evaluate(async name => {
        const context = globalThis.SillyTavern.getContext();
        await context.openCharacterChat(name);
        await context.reloadCurrentChat();
    }, separateChats.a.name);

    if (chatSwitchRace.beforeRelease.chatId !== separateChats.nameB
        || !chatSwitchRace.noLateCommit
        || afterChatSwitchA.values?.affection !== 90
        || afterChatSwitchA.values?.trust !== 33
        || afterChatSwitchA.lateSourceEvents.length !== 0
        || afterChatSwitchB.values?.affection !== 24
        || afterChatSwitchB.values?.trust !== 76
        || !afterChatSwitchB.historyHasB || afterChatSwitchB.lateAiEvents !== 0) {
        throw new Error('Late affinity result crossed or altered real chat files: ' +
            JSON.stringify({ chatSwitchRace, afterChatSwitchA, afterChatSwitchB }));
    }

    if (retryResult.eventCount !== 1 || retryResult.sourceStatus !== 'committed'
        || retryResult.affinityCalls - retryResult.callsBefore !== 1
        || retryResult.values?.affection !== 90 || retryResult.values?.trust !== 33) {
        throw new Error('Cancelled affinity source could not be explicitly retried exactly once: ' + JSON.stringify(retryResult));
    }

    // Run a 121-floor archived chat through the real ST context, settings UI and
    // extension prompt bridge. A missing L0 at floor 50 must remain visible.
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const core = await import('/scripts/extensions/third-party/world-backstage/core.js');
        const lines = Array.from({ length: 121 }, (_, id) => `第${id}层：圣堂里的日常对话。`);
        lines[0] = '我初到圣堂，跨门槛时踢歪了门垫。';
        lines[1] = '伊莱恩先扶正烛台，再捡起信封。';
        lines[2] = '我交出银书签，取回的暗号是“晚钟九号”。';
        lines[4] = '我拿回银书签，转交守门人苏姨保管。';
        lines[72] = '我从苏姨处取回银书签，转交修书匠乔保管。';
        lines[73] = '伊莱恩确认现在由乔保管银书签。';
        lines[90] = '原定周六上午十点的见面改为周日正午，敲门改成一长两短。';
        lines[91] = '伊莱恩确认新的时间与敲门节奏。';
        lines[120] = '最初门口我弄歪了什么？银书签取回暗号是什么？现在由谁保管？';
        context.chat.splice(0, context.chat.length, ...lines.map((mes, id) => ({
            name: id % 2 ? context.name2 : context.name1,
            is_user: id % 2 === 0, is_system: false, mes, extra: {},
        })));
        let state = core.createInitialState();
        for (let start = 0; start < lines.length; start += 12) {
            const end = Math.min(start + 12, lines.length);
            const summaries = lines.slice(start, end).flatMap((summary, offset) => {
                const id = start + offset;
                return id === 50 ? [] : [{ source_message_id: id, summary }];
            });
            state = core.applyHistoryIndexResult(state, {
                memory_digest: { text: start < 72
                    ? '玩家在圣堂交出了银书签，后来转交苏姨。'
                    : '玩家最初进入圣堂；银书签后来转交修书匠乔。约见改为周日正午，敲门一长两短。' },
                turn_summaries: summaries,
                facts_upsert: start === 0 ? [
                    { key: '银书签:保管人', subject: '银书签', predicate: '保管人', value: '苏姨', visibility: 'known' },
                ] : start === 72 ? [
                    { key: '银书签:保管人', subject: '银书签', predicate: '保管人', value: '修书匠乔', visibility: 'known' },
                ] : [],
            }, { startMessageId: start, endMessageId: end - 1 });
            let plan;
            while ((plan = core.planMemoryRollup(state))) {
                state = core.applyMemoryRollupResult(state, {
                    summary_rollup: {
                        title: `消息${plan.summaries[0].startMessageId}—${plan.summaries.at(-1).endMessageId}`,
                        summary: plan.summaries.map(item => item.summary).join('；').slice(0, 1100),
                    },
                }, plan);
            }
        }
        const store = context.chatMetadata[core.STATE_KEY];
        if (!store) throw new Error('Long-floor chat did not attach to World Backstage');
        store.currentState = state;
    });
    await page.evaluate(() => globalThis.worldBackstageHost?.open?.());
    const memorySetting = page.locator('[data-wb-setting="memorySystemEnabled"]').first();
    const settingsLayer = page.locator('.wb-root .wb-settings-layer');
    if (!(await settingsLayer.isVisible())) {
        const toggleSettings = page.locator('.wb-root button[data-wb-action="toggle-settings"][aria-label="全局设置"]').first();
        await toggleSettings.waitFor({ state: 'attached', timeout: 5_000 });
        await toggleSettings.evaluate(element => element.click());
        await settingsLayer.waitFor({ state: 'visible', timeout: 5_000 });
    }
    await memorySetting.waitFor({ state: 'attached', timeout: 5_000 });
    await memorySetting.evaluate(el => {
        if (!el.checked) el.click();
    });
    // Disabling memory in the earlier scenario also disables auto-hide by design.
    // Re-enable both settings through the actual UI for this separate chat.
    await page.waitForFunction(() =>
        globalThis.SillyTavern.getContext().extensionSettings.world_backstage.memorySystemEnabled === true,
    );
    await page.locator('[data-wb-setting="autoHideArchivedFloors"]').first().evaluate(el => {
        if (!el.checked) el.click();
    });
    await page.waitForFunction(() => {
        const context = globalThis.SillyTavern.getContext();
        return context.chat[0]?.is_system === true
            && (context.extensionPrompts.world_backstage_context_support?.value || '').includes('晚钟九号');
    }, null, { timeout: 20_000 }).catch(async error => {
        const diagnostic = await page.evaluate(() => {
            const context = globalThis.SillyTavern.getContext();
            return {
                settings: {
                    memorySystemEnabled: context.extensionSettings.world_backstage.memorySystemEnabled,
                    autoHideArchivedFloors: context.extensionSettings.world_backstage.autoHideArchivedFloors,
                    injectionMemory: context.extensionSettings.world_backstage.injectionMemory,
                },
                firstHidden: context.chat[0]?.is_system,
                hiddenCount: context.chat.filter(message => message.extra?.world_backstage_auto_hidden).length,
                prompt: (context.extensionPrompts.world_backstage_context_support?.value || '').slice(0, 1500),
            };
        });
        throw new Error(`Real ST long-floor timeout: ${error.message}; ${JSON.stringify(diagnostic)}`);
    });
    const longRuntime = await page.evaluate(() => {
        const context = globalThis.SillyTavern.getContext();
        const support = context.extensionPrompts.world_backstage_context_support?.value || '';
        return {
            floorCount: context.chat.length,
            hiddenCount: context.chat.filter(message => message.extra?.world_backstage_auto_hidden).length,
            uncoveredVisible: context.chat[50].is_system === false,
            recentFiveVisible: context.chat.slice(-5).every(message => !message.is_system),
            openingRecalled: support.includes('踢歪了门垫'),
            passwordRecalled: support.includes('晚钟九号'),
            latestHolderRecalled: support.includes('修书匠乔'),
            supportLength: support.length,
            supportExcerpt: support.slice(0, 1300),
        };
    });

    report = {
        ...(report || {}),
        pluginLoaded: true,
        helper,
        runtime,
        longRuntime,
        affinityUiRuntime,
        ui: {
            autoHideToggleRendered: true,
            restoreButtonRendered: true,
            persistedSetting: persistedSetting === true,
            disabledAfterRestore,
            affinity: affinityUi,
        },
        pageErrors,
    };

    if (!helper.marked) throw new Error('Auto-hide helper did not mark eligible messages');
    if (!helper.manualHidePreserved) throw new Error('Restore touched a pre-existing manual/system hide');
    if (!helper.autoHideRestored) throw new Error('Auto-hide helper failed to restore its own messages');
    if (!helper.memoryRecalled) throw new Error('Narrative memory was absent from the foreground prompt');
    if (!helper.missingTurnsStayVisible) throw new Error('Uncovered turns were hidden from the model');
    if (!helper.affinityModuleLoaded) throw new Error('Affinity module did not load in the real browser');
    if (!helper.affinitySettlementWorks) throw new Error('Affinity relationship settlement failed in the real browser');
    if (!helper.affinityContextInjected) throw new Error('Relationship continuity was not injected into the RP support context');
    if (!helper.affinityScoresHidden) throw new Error('Raw relationship scores leaked into the RP support context');
    if (!helper.affinityContextToggleWorks) throw new Error('Relationship context injection toggle did not disable injection');
    if (!affinityUi.routeVisible || !affinityUi.promptVisible) throw new Error('Affinity route or prompt settings are not visible');
    if (!affinityUi.enabledToggleVisible || !affinityUi.autoToggleVisible || !affinityUi.romanceToggleVisible) {
        throw new Error('One or more affinity settings toggles are missing');
    }
    if (affinityUi.promptLength < 100) throw new Error('Default affinity prompt did not load');
    if (persistedSetting !== true) throw new Error('Auto-hide setting did not persist through the real UI');
    if (!disabledAfterRestore) throw new Error('Restore action did not disable auto-hide before restoring floors');
    if (JSON.stringify(runtime.hiddenIds) !== JSON.stringify([0, 2, 4, 5, 6])) {
        throw new Error(`Unexpected real chat hidden floors: ${JSON.stringify(runtime.hiddenIds)}`);
    }
    for (const [key, value] of Object.entries(runtime)) {
        if (!['hiddenIds', 'injectedSupportExcerpt'].includes(key) && value !== true) {
            throw new Error(`Real ST continuity check failed: ${key}; support=${runtime.injectedSupportExcerpt}`);
        }
    }
    if (longRuntime.floorCount !== 121 || longRuntime.hiddenCount !== 115
        || longRuntime.supportLength > 4200) {
        throw new Error(`Real ST long-floor counts failed: ${JSON.stringify(longRuntime)}`);
    }
    for (const key of ['uncoveredVisible', 'recentFiveVisible', 'openingRecalled',
        'passwordRecalled', 'latestHolderRecalled']) {
        if (!longRuntime[key]) throw new Error(`Real ST long-floor recall failed: ${key}`);
    }
    if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(' | ')}`);
} finally {
    try {
        const acceptanceEvidence = await page.evaluate(() => globalThis.__wbAffinityAcceptanceEvidence || null);
        report = { ...(report || {}), acceptanceEvidence };
        await page.evaluate(() => {
            const fixture = globalThis.__wbAffinityFixture;
            if (fixture?.heldAffinity && !fixture.heldAffinity.released) {
                fixture.releaseHeldAffinity();
            }
            fixture?.restore?.();
            const settings = globalThis.SillyTavern?.getContext?.().extensionSettings?.world_backstage;
            if (settings && globalThis.__wbAffinityFixtureSavedSettings) {
                Object.assign(settings, globalThis.__wbAffinityFixtureSavedSettings);
            }
            delete globalThis.__wbAffinityFixture;
            delete globalThis.__wbAffinityFixtureSavedSettings;
        });
    } catch (cleanupError) {
        pageErrors.push('Fixture cleanup failed: ' + String(cleanupError?.stack || cleanupError));
    }
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

const importSmoke = spawnSync(process.execPath, [
    new URL('../tests/worldbook-import-browser-smoke.mjs', import.meta.url).pathname,
], {
    stdio: 'inherit',
    env: {
        ...process.env,
        WB_TAVERN_URL: baseUrl,
        WB_EXTENSION_NAME: process.env.LAB_EXTENSION_NAME || 'world-backstage',
        WB_PLAYWRIGHT_CORE_ENTRY: process.env.LAB_PLAYWRIGHT_CORE_ENTRY,
        WB_CHROMIUM_EXECUTABLE: process.env.LAB_CHROME,
        WB_IMPORT_EVIDENCE: path.join(evidenceDir, 'worldbook-import'),
    },
});
if (importSmoke.error) throw importSmoke.error;
if (importSmoke.status !== 0) throw new Error(`Worldbook import browser smoke failed: ${importSmoke.status}`);
