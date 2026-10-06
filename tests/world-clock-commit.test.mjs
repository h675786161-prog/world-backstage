import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as core from '../core.js';
import * as branch from '../branch-history.js';

// Execute the actual runtime pipeline with deterministic transport and storage.
// Core time parsing and per-swipe branch records remain real implementations.
const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function runtimeFunction(name) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, `Missing runtime function ${name}`);
    const rest = source.slice(start);
    const next = rest.slice(1).search(/^\s*(?:async )?function \w+\(/m);
    return next < 0 ? rest : rest.slice(0, next + 1);
}
function fixture({ skew = false, filtered = false, duringRequest = null } = {}) {
    const oldText = '<details><summary>时间与地点</summary>09:01 · 客厅</details>';
    const newText = '<details><summary>时间与地点</summary>09:05 · 客厅</details>';
    const state = core.setWorldCalendar(core.createInitialState(), {
        year: 2026, month: 10, day: 1, hour: 9, minute: 1,
    });
    state.revision = 300;
    const store = {
        initialState: structuredClone(state), currentState: structuredClone(state),
        branchOverrides: {}, lingqi: { notes: [] },
    };
    const chat = [oldText, newText].map(text => ({
        is_user: false, mes: text, swipe_id: 0, swipes: [text], swipe_info: [{ extra: {} }],
    }));
    if (skew) chat[1].mes = oldText;
    const oldKey = `0:0:${core.hashText(oldText)}`;
    store.currentState.lastCommit = { sourceKey: oldKey, messageId: 0, swipeId: 0 };
    store.initialState.lastCommit = structuredClone(store.currentState.lastCommit);
    chat[0].swipe_info[0].extra.world_backstage = {
        sourceKey: oldKey, status: 'committed',
        result: core.createCompactSnapshot(store.currentState, { sourceKey: oldKey }),
    };
    const runtime = {
        dataEpoch: 1, contextEpoch: 3, activeChatToken: 'chat', simulationCount: 0,
        queuedSimulations: new Map(), generationOffer: { eventIds: [], directorNoteIds: [] },
        injection: {}, syncStatus: {}, ui: { render() {} },
    };
    const settings = {
        enabled: true, worldSimulationEnabled: true, worldAutoEnabled: true,
        autoSimulationMode: 'deep', memorySystemEnabled: false, recordPlayerCharacter: true,
        timePolicy: 'cautious', contextTurns: 5, backgroundNpcBudget: 4, worldPromptInjection: false,
    };
    const context = { chat, name1: '玩家', saveChat: async () => {} };
    const payload = {
        elapsed_minutes: 0, clock_anchor: { mode: 'none' }, world: {},
        people_upsert: [], people_remove: [], events_create: [], events_update: [],
        deliveries_confirmed: [], front_facts: [], world_facts_upsert: [], world_pulse_upsert: [],
        consistency_conflicts: [], memory_update: {
            turn_summaries: [], facts_upsert: [], facts_invalidate: [], clues_upsert: [], clues_resolve: [],
        },
    };
    let requests = 0;
    let token = 'chat';
    const noop = () => {};
    const api = { runtime, settings, store, chat, context, setToken: value => { token = value; } };
    const sandbox = {
        ...core, ...branch, console, Date, Number, String, Boolean, Math, Set, Map, Object, Array,
        Infinity, AbortController, structuredClone, runtime,
        SCHEMA_VERSION: 25, SNAPSHOT_KEY: 'world_backstage',
        resolveTaskConnection: () => ({ mode: 'custom' }),
        getContext: () => context, getSettings: () => settings, getStore: () => store,
        getState: () => store.currentState, currentChatToken: () => token, hasChatContext: () => true,
        clone: structuredClone, waitForCoreStateWritersToSettle: async () => true,
        createBranchSnapshot: core.createCompactSnapshot,
        restoreBranchSnapshot: (snapshot, fallback) => core.restoreCompactSnapshot(snapshot, fallback),
        compactBranchDataMemory: noop, compactBranchSnapshotStorage: noop, saveStore: noop,
        refreshInjection: noop, ensureResultBranchSurface: noop, captureBranchSurface: noop,
        branchSurfaceKeyFromState: value => value.lastCommit?.sourceKey || 'root', restoreSurfaceForState: noop,
        setBusy: noop, setSyncStatus: patch => { runtime.syncStatus = { ...runtime.syncStatus, ...patch }; },
        narrativeContext: () => ({ latestTurn: newText, turns: [{ id: 1, text: newText }] }),
        selectPendingAssistantMessageIds: () => [1], countSurvivingNewAssistantTurns: () => filtered ? 0 : 1,
        narrativeMessageText: message => filtered ? '' : message.swipes?.[message.swipe_id] ?? message.mes,
        getPlayerIdentityAnchor: () => '', normalizeLingqiState: value => value,
        buildSimulationPrompt: () => '', primarySimulationRequestBudget: () => 4600,
        resolveGenerationLimits: () => ({ maxTokens: 0 }), retryTokenBudget: value => value,
        retrySimulationPrompt: value => value, runWithRetries: async fn => fn(0),
        backgroundSimulation: async () => {
            requests += 1;
            await duringRequest?.(api);
            return JSON.stringify(payload);
        },
        extractJsonObject: JSON.parse, shouldRetryWorldGeneration: () => false, retryTaskOptions: () => ({}),
        applyManualDeletionFilters: value => value, simulationSummary: () => ({}),
        recentChatText: () => '', recentForegroundIntentText: () => '',
        settleResultBranchSurface: noop, applyLingqiDirectorResult: value => value,
        schedulePublicPostProcessing: noop, isAbortError: error => error?.name === 'AbortError',
        describeError: error => String(error?.message || error), classifyDiagnosticIssue: () => 'other', toast: noop,
    };
    vm.createContext(sandbox);
    const functions = [
        'branchSourceKey', 'branchDataFromMessage', 'selectedMessageText', 'hasUsableAssistantText',
        'latestAssistantEntry', 'findLatestResultSnapshot', 'stateWithBranchOverride', 'attachBranchData',
        'markMessagePending', 'locateTargetBranch', 'ensureMonotonicRevision', 'hasNewerAssistantReply',
        'beginTaskTrace', 'updateTaskTrace', 'finishTaskTrace', 'runSimulationForMessage',
        'pendingAssistantEntriesThrough', 'latestNarrativeSyncSnapshot', 'coreSimulationBusy', 'restoreCommittedCurrentState',
    ];
    vm.runInContext(functions.map(runtimeFunction).join('\n'), sandbox);
    return {
        ...api, sandbox, run: () => sandbox.runSimulationForMessage(1),
        repair: () => sandbox.restoreCommittedCurrentState(),
        sync: () => sandbox.latestNarrativeSyncSnapshot(), requests: () => requests,
        time: () => core.formatWorldCalendar(store.currentState).time,
        record: () => branch.readBranchRecord(chat[1], 0),
    };
}

for (const skew of [false, true]) {
    test(`selected reply immediately updates current time, mirror skew=${skew}`, async () => {
        const f = fixture({ skew });
        await f.run();
        assert.equal(f.time(), '09:05');
        assert.equal(f.store.currentState.pendingSync, false);
        assert.equal(f.sync().currentStateApplied, true);
        assert.equal(f.runtime.lastTaskTrace.currentStateApplied, true);
        assert.equal(f.runtime.syncStatus.phase, 'success');
        assert.equal(f.requests(), 1);
    });
}

test('filtered-out reply commits its branch anchor without moving time or requesting a model', async () => {
    const f = fixture({ skew: true, filtered: true });
    await f.run();
    assert.equal(f.time(), '09:01');
    assert.equal(f.requests(), 0);
    assert.equal(f.sync().currentStateApplied, true);
    assert.equal(f.store.currentState.pendingSync, false);
    assert.equal(f.repair(), false);
});

test('switching the selected swipe archives the old result without claiming it updated current state', async () => {
    const f = fixture({ duringRequest: ({ chat }) => {
        chat[1].swipes.push('另一个分支，时间仍是09:01。');
        chat[1].swipe_info.push({ extra: {} });
        chat[1].swipe_id = 1;
    } });
    await f.run();
    assert.equal(f.record().status, 'committed');
    assert.equal(f.time(), '09:01');
    assert.equal(f.runtime.lastTaskTrace.phase, 'superseded');
    assert.equal(f.runtime.lastTaskTrace.currentStateApplied, false);
    assert.equal(f.runtime.lastTaskTrace.stateApplyReason, 'branch-not-selected');
    assert.equal(f.runtime.syncStatus.phase, 'pending');
    assert.equal(f.repair(), false);
});

test('a newer reply prevents historical result from overwriting current state', async () => {
    const f = fixture({ duringRequest: ({ chat }) => {
        chat.push({ is_user: false, mes: '新的正文', swipe_id: 0, swipes: ['新的正文'], swipe_info: [{ extra: {} }] });
    } });
    await f.run();
    assert.equal(f.time(), '09:01');
    assert.equal(f.runtime.lastTaskTrace.stateApplyReason, 'newer-reply');
    assert.equal(f.runtime.lastTaskTrace.currentStateApplied, false);
    assert.equal(f.runtime.syncStatus.phase, 'pending');
    assert.equal(f.repair(), false);
});

test('editing selected text rejects the outdated result', async () => {
    const f = fixture({ duringRequest: ({ chat }) => { chat[1].swipes[0] = '正文已编辑'; } });
    await f.run();
    assert.equal(f.time(), '09:01');
    assert.equal(f.record().status, 'pending');
    assert.equal(f.runtime.lastTaskTrace.commitOutcome, 'skipped');
    assert.equal(f.runtime.lastTaskTrace.currentStateApplied, false);
});

test('manual state changes during generation remain authoritative', async () => {
    const f = fixture({ duringRequest: ({ store }) => {
        store.currentState = core.setWorldCalendar(store.currentState, { year: 2026, month: 10, day: 1, hour: 10, minute: 0 });
    } });
    await f.run();
    assert.equal(f.time(), '10:00');
    assert.equal(f.record().status, 'pending');
    assert.equal(f.runtime.lastTaskTrace.commitOutcome, 'skipped');
    assert.equal(f.repair(), false);
});

test('chat changes before the response prevent old result publication', async () => {
    const f = fixture({ duringRequest: ({ setToken }) => setToken('another-chat') });
    await f.run();
    assert.equal(f.time(), '09:01');
    assert.equal(f.record().status, 'pending');
    assert.equal(f.runtime.lastTaskTrace.commitOutcome, 'skipped');
});

async function storedOnlyFixture() {
    const f = fixture();
    const previous = structuredClone(f.store.currentState);
    await f.run();
    f.store.currentState = core.markPendingSync(previous, true);
    f.runtime.activeSimulation = null;
    return f;
}

test('idle stored-only state recovers without reload or another model request', async () => {
    const f = await storedOnlyFixture();
    assert.equal(f.sync().needsStateRestore, true);
    assert.equal(f.sync().snapshotWorldMinute % 1440, 545);
    assert.equal(f.repair(), true);
    assert.equal(f.time(), '09:05');
    assert.equal(f.sync().currentStateApplied, true);
    assert.equal(f.requests(), 1);
    assert.equal(f.repair(), false);
});

test('recovery preserves the selected branch manual override even when its time is earlier', async () => {
    const f = await storedOnlyFixture();
    const snapshot = f.record().result;
    const manual = core.setWorldCalendar(core.restoreCompactSnapshot(snapshot), {
        year: 2026, month: 10, day: 1, hour: 8, minute: 30,
    });
    manual.world.background = '用户手动补充的世界设定';
    f.store.branchOverrides[snapshot.meta.sourceKey] = core.createCompactSnapshot(manual, snapshot.meta);
    assert.equal(f.repair(), true);
    assert.equal(f.time(), '08:30');
    assert.equal(f.store.currentState.world.background, manual.world.background);
    assert.equal(f.requests(), 1);
});

test('recovery waits for writers, queued work and explicit manual requests', async () => {
    const f = await storedOnlyFixture();
    for (const field of ['activeHistoryScan', 'activeSimulation', 'pendingManualSimulation', 'consistencyBarrierRunning']) {
        f.runtime[field] = {};
        assert.equal(f.repair(), false, field);
        f.runtime[field] = null;
    }
    f.runtime.queuedSimulations.set('queued', {});
    assert.equal(f.repair(), false);
    f.runtime.queuedSimulations.clear();
    assert.equal(f.repair(), true);
});

test('late save completion cannot change the new chat status', async () => {
    const f = fixture();
    f.context.saveChat = async () => {
        if (f.record()?.status !== 'committed') return;
        f.setToken('new-chat');
        f.runtime.contextEpoch += 1;
        f.runtime.syncStatus = { phase: 'idle', message: '新聊天状态' };
    };
    await f.run();
    assert.equal(f.runtime.syncStatus.phase, 'idle');
    assert.equal(f.runtime.syncStatus.message, '新聊天状态');
});
