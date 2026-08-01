import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MINUTES_PER_DAY,
    addManualEvent,
    advanceWorldClock,
    applySimulationResult,
    buildInjectionPackage,
    buildSimulationPrompt,
    createInitialState,
    createSnapshot,
    eventProgress,
    extractJsonObject,
    formatWorldCalendar,
    formatWorldMinute,
    hasExplicitTimeEvidence,
    normalizeEvent,
    recordDeliveryOffers,
    restoreSnapshot,
    selectDeliveryCandidates,
    setWorldCalendar,
    settleTimedEvents,
    trimState,
} from '../core.js';
import { renderPersonCard } from '../ui.js';

test('主世界时钟使用绝对分钟，并按日/时/分稳定还原', () => {
    const state = createInitialState({ worldName: '雾港', day: 17, hour: 22, minute: 40 });

    assert.equal(state.clock.absoluteMinute, 17 * MINUTES_PER_DAY + 22 * 60 + 40);
    assert.deepEqual(formatWorldMinute(state.clock.absoluteMinute), {
        day: 17,
        hour: 22,
        minute: 40,
        time: '22:40',
        stamp: '第 17 日 22:40',
    });
});

test('用户点名的活动事件会优先进入下一轮注入且只消费一次', () => {
    const state = addManualEvent(createInitialState(), {
        id: 'quiet-current',
        title: '港口换防',
        summary: '巡逻队正在重新部署。',
        visibility: 'trace',
    });
    state.events[0].delivery.manualQueued = true;
    const selected = selectDeliveryCandidates(state, { deliveryDensity: 'restrained' });
    assert.equal(selected[0].id, 'quiet-current');
    const offered = recordDeliveryOffers(state, ['quiet-current'], { messageId: 8 });
    assert.equal(offered.events[0].delivery.manualQueued, false);
});

test('世界与记忆注入可以彼此独立关闭', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'promise', key: 'promise', subject: '约定', predicate: '内容', value: '黎明前回来',
        status: 'active', confidence: 'high', importance: 3, visibility: 'known',
    });
    const memoryOnly = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: false,
        memorySystemEnabled: true,
        memoryPromptInjection: true,
    }, '约定');
    assert.match(memoryOnly.text, /黎明前回来/);
    assert.doesNotMatch(memoryOnly.text, /权威主世界时间/);
    const none = buildInjectionPackage(state, {
        enabled: true,
        worldSimulationEnabled: true,
        worldPromptInjection: false,
        memorySystemEnabled: true,
        memoryPromptInjection: false,
    }, '约定');
    assert.equal(none.text, '');
});

test('世界日历支持年、月、日校准，并随权威时钟自动跨月跨年', () => {
    let state = createInitialState({ day: 3, hour: 23, minute: 30 });
    state = setWorldCalendar(state, {
        calendarName: '群星历',
        year: 2026,
        month: 12,
        day: 31,
        hour: 23,
        minute: 30,
    });

    assert.deepEqual(
        {
            calendarName: formatWorldCalendar(state).calendarName,
            date: formatWorldCalendar(state).date,
            time: formatWorldCalendar(state).time,
        },
        { calendarName: '群星历', date: '2026年12月31日', time: '23:30' },
    );

    state = advanceWorldClock(state, 60, '跨年测试');
    assert.equal(formatWorldCalendar(state).stamp, '群星历 2027年1月1日 00:30');
    assert.equal(state.world.calendar.anchorAbsoluteDay, 3);
});

test('旧状态会迁移为可用日历而不改变原有绝对时间', () => {
    const legacy = createInitialState({ day: 17, hour: 22, minute: 40 });
    delete legacy.world.calendar;
    const migrated = trimState(legacy);

    assert.equal(migrated.clock.absoluteMinute, legacy.clock.absoluteMinute);
    assert.equal(formatWorldCalendar(migrated).date, '1年1月17日');
    assert.equal(formatWorldCalendar(migrated).time, '22:40');
});

test('预计十二小时的事件不会因 AI 回复次数增长', () => {
    let state = createInitialState({ day: 3, hour: 9, minute: 0 });
    state = addManualEvent(state, {
        id: 'repair-radio',
        title: '修复旧通讯器',
        clock_mode: 'duration',
        duration_minutes: 12 * 60,
        visibility: 'hidden',
    });

    const startedAt = state.clock.absoluteMinute;
    assert.equal(state.events[0].dueAt, startedAt + 12 * 60);

    for (let reply = 0; reply < 8; reply += 1) {
        state = applySimulationResult(state, {
            elapsed_minutes: 0,
            time_reason: '正文没有发生可确认的时间流逝',
        }, {
            messageId: reply,
            swipeId: 0,
            sourceKey: `${reply}:0:no-time`,
        });
    }

    assert.equal(state.clock.absoluteMinute, startedAt);
    assert.equal(state.events[0].status, 'active');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 0);

    state = settleTimedEvents(state, startedAt + 12 * 60 - 1);
    assert.equal(state.events[0].status, 'active');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).remaining, 1);

    state = settleTimedEvents(state, startedAt + 12 * 60);
    assert.equal(state.events[0].status, 'ready');
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 100);
});

test('有效工时事件只累计正文确认的实际工作分钟', () => {
    let state = createInitialState({ day: 1, hour: 8, minute: 0 });
    state = addManualEvent(state, {
        id: 'forge-key',
        title: '锻造钥匙',
        clock_mode: 'active',
        duration_minutes: 120,
        visibility: 'hidden',
    });

    state = applySimulationResult(state, {
        elapsed_minutes: 480,
        time_reason: '八小时过去，但只工作了半小时',
        events_update: [{ id: 'forge-key', status: 'active', worked_minutes: 30 }],
    });

    assert.equal(state.events[0].accruedMinutes, 30);
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 25);

    state = applySimulationResult(state, {
        elapsed_minutes: 120,
        time_reason: '人物在休息',
        events_update: [{ id: 'forge-key', status: 'active', worked_minutes: 0 }],
    });

    assert.equal(state.events[0].accruedMinutes, 30);
    assert.equal(eventProgress(state.events[0], state.clock.absoluteMinute).percent, 25);
});

test('预定事件使用明确到期时刻', () => {
    const start = 5 * MINUTES_PER_DAY + 10 * 60;
    const event = normalizeEvent({
        id: 'train-arrival',
        title: '夜车抵达',
        clock_mode: 'scheduled',
        scheduled_at: start + 95,
    }, start);

    assert.equal(event.startedAt, start);
    assert.equal(event.dueAt, start + 95);
    assert.equal(eventProgress(event, start + 94).remaining, 1);
    assert.equal(settleTimedEvents({
        ...createInitialState(),
        clock: {
            absoluteMinute: start,
            lastCheckedAt: start,
            source: 'test',
            reason: '',
        },
        events: [event],
    }, start + 95).events[0].status, 'ready');
});

test('第一视角独白底层保留生成时刻，只进入后台结算而不注入正文', () => {
    let state = createInitialState({ worldName: '雾港', day: 2, hour: 14, minute: 10 });
    const voiceAt = state.clock.absoluteMinute;
    const secret = '我得赶在潮声停下以前，把那封信藏进灯塔。';

    state = applySimulationResult(state, {
        elapsed_minutes: 0,
        people_upsert: [{
            id: 'lin',
            name: '林',
            location: '旧灯塔',
            action: '沿着旋梯向上',
            intent: '藏好来信',
            inner_voice: secret,
            knowledge: 'known',
            relevance: 3,
        }],
    });
    state = advanceWorldClock(state, 180, '测试时间推进');

    assert.equal(state.people[0].innerVoice, secret);
    assert.equal(state.people[0].innerVoiceAt, voiceAt);

    const injected = buildInjectionPackage(state, {
        enabled: true,
        promptInjection: true,
        deliveryDensity: 'restrained',
        sceneTiming: 'strict',
    }, '林正在何处？').text;
    assert.equal(injected.includes(secret), false);

    const backstagePrompt = buildSimulationPrompt(state);
    assert.equal(backstagePrompt.includes(secret), true);
});

test('第一视角独白从模型结果到分支快照与幕后界面完整落地', () => {
    const base = createInitialState({ worldName: '七侠镇', day: 4, hour: 22, minute: 5 });
    const secret = '我嘴上说不在意，可那盏迟迟没灭的灯，分明还在等一个人回来。';
    const settled = applySimulationResult(base, {
        elapsed_minutes: 15,
        people_upsert: [{
            id: 'tong-xiangyu',
            name: '佟湘玉',
            location: '同福客栈大堂',
            action: '收起最后一桌碗筷',
            intent: '等众人平安回来',
            inner_voice: secret,
            knowledge: 'known',
            relevance: 3,
            source: 'foreground',
        }],
    }, {
        messageId: 12,
        swipeId: 1,
        sourceKey: '12:1:voice',
    });
    const snapshot = createSnapshot(settled, {
        messageId: 12,
        swipeId: 1,
        sourceKey: '12:1:voice',
        kind: 'result',
    });
    const restored = restoreSnapshot(snapshot);
    const person = restored.people[0];

    assert.equal(person.innerVoice, secret);
    assert.equal(snapshot.meta.swipeId, 1);
    const backstageCard = renderPersonCard(person, 'backstage', restored.clock.absoluteMinute);
    assert.equal(backstageCard.includes(secret), true);
    assert.equal(backstageCard.includes('22:20'), false);
    assert.equal(renderPersonCard(person, 'known', restored.clock.absoluteMinute).includes(secret), false);
    assert.equal(buildInjectionPackage(restored, {
        enabled: true,
        promptInjection: true,
        deliveryDensity: 'balanced',
        sceneTiming: 'smart',
    }, '佟湘玉').text.includes(secret), false);
});

test('世界推演提示明确携带最近正文并只处理最后一条AI回复', () => {
    const state = createInitialState({ worldName: '七侠镇' });
    const prompt = buildSimulationPrompt(state, {
        trigger: 'manual',
        narrativeTurns: [
            { role: 'user', content: '我轻手轻脚走进客栈。' },
            { role: 'assistant', content: '门轴发出很轻的一声响。' },
            { role: 'user', content: '我看向仍亮着的柜台。' },
            { role: 'assistant', content: '柜台后的灯仍然亮着。' },
        ],
        userName: '狐夜',
        includeUserInnerVoice: false,
        timePolicy: 'explicit',
    });

    assert.equal(prompt.includes('我轻手轻脚走进客栈。'), true);
    assert.equal(prompt.includes('柜台后的灯仍然亮着。'), true);
    assert.equal(prompt.includes('本次只推演最后一个 assistant_turn'), true);
    assert.equal(prompt.includes('inner_voice 必须为空'), true);
    assert.equal(prompt.includes('long_term_goal'), true);
    assert.equal(prompt.includes('"inner_voice":""'), true);
    assert.equal(prompt.trimEnd().endsWith('}'), true);
});

test('累计触发会按顺序标记多轮新正文，并保留更早轮次作为因果上下文', () => {
    const prompt = buildSimulationPrompt(createInitialState(), {
        narrativeTurns: [
            { role: 'user', content: '第一轮用户消息', messageId: 20, swipeId: 0 },
            { role: 'assistant', content: '第一轮正文', messageId: 21, swipeId: 0 },
            { role: 'user', content: '第二轮用户消息', messageId: 22, swipeId: 0 },
            { role: 'assistant', content: '第二轮正文', messageId: 23, swipeId: 1 },
            { role: 'user', content: '第三轮用户消息', messageId: 24, swipeId: 0 },
            { role: 'assistant', content: '第三轮正文', messageId: 25, swipeId: 0 },
        ],
        newAssistantTurns: 2,
        simulationMode: 'deep',
        customInstruction: '优先关注城门与商会。',
        backgroundNpcBudget: 4,
    });

    assert.equal(
        prompt.includes('<assistant_turn order="2" message_id="21" swipe_id="0" new="false">'),
        true,
    );
    assert.equal(
        prompt.includes('<assistant_turn order="4" message_id="23" swipe_id="1" new="true">'),
        true,
    );
    assert.equal(
        prompt.includes('<assistant_turn order="6" message_id="25" swipe_id="0" new="true">'),
        true,
    );
    assert.equal(prompt.includes('最后 2 个 assistant_turn'), true);
    assert.equal(prompt.includes('优先关注城门与商会'), true);
    assert.equal(prompt.includes('最多更新 4 名镜头外 NPC'), true);
});

test('后台 NPC 预算由插件端执行，伪标成入镜也不能绕过零预算', () => {
    const result = applySimulationResult(createInitialState(), {
        elapsed_minutes: 0,
        people_upsert: [
            { id: 'zhang', name: '张三', source: 'foreground', action: '推门进屋' },
            { id: 'li', name: '李四', source: 'foreground', action: '在城外赶路' },
            { id: 'wang', name: '王五', source: 'background', action: '在码头等待' },
            { id: 'player', name: '狐夜', is_user: true, source: 'foreground' },
        ],
    }, {
        userName: '狐夜',
        messageId: 30,
        narrativeText: '张三推门进屋，看向了玩家。',
        backgroundNpcBudget: 0,
    });

    assert.deepEqual(
        result.people.map(person => person.name).sort(),
        ['张三', '狐夜'].sort(),
    );
    assert.equal(result.people.find(person => person.name === '张三').lastSeenMessageId, 30);
});

test('严格时间模式拒绝把夜幕等氛围词换算成几个小时', () => {
    let base = createInitialState({ day: 1, hour: 8, minute: 0 });
    base = addManualEvent(base, {
        id: 'night-watch',
        title: '守夜',
        clock_mode: 'active',
        duration_minutes: 120,
    });
    const result = applySimulationResult(base, {
        elapsed_minutes: 360,
        time_reason: '模型根据夜幕降临猜测过去六小时',
        world: { title: '第一场考试的首夜' },
        events_update: [{ id: 'night-watch', worked_minutes: 60 }],
    }, {
        timePolicy: 'explicit',
        narrativeText: '夜幕降临，岩壁带着森林特有的湿冷。',
    });

    assert.equal(hasExplicitTimeEvidence('夜幕降临，岩壁带着湿冷。'), false);
    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute);
    assert.equal(result.events[0].accruedMinutes, 0);
    assert.equal(result.clock.reason.includes('保持世界时钟不动'), true);
});

test('严格时间模式保留正文明确给出的时长', () => {
    const base = createInitialState({ day: 1, hour: 8, minute: 0 });
    const result = applySimulationResult(base, {
        elapsed_minutes: 360,
        time_reason: '正文明确写出六小时',
    }, {
        timePolicy: 'explicit',
        narrativeText: '六个小时后，天色完全暗了下来。',
    });

    assert.equal(hasExplicitTimeEvidence('六个小时后，天色完全暗了下来。'), true);
    assert.equal(result.clock.absoluteMinute, base.clock.absoluteMinute + 360);
});

test('玩家内心默认关闭，NPC独白与长期目标仍可保存', () => {
    const base = createInitialState({ worldName: '七侠镇' });
    const result = applySimulationResult(base, {
        elapsed_minutes: 0,
        people_upsert: [
            {
                id: 'huye',
                name: '狐夜',
                is_user: true,
                inner_voice: '我已经替玩家决定好了。',
                long_term_goal: '查清失踪事件的源头',
            },
            {
                id: 'laobai',
                name: '老白',
                is_user: false,
                inner_voice: '这事儿八成没表面那么简单。',
                long_term_goal: '保护同福客栈众人的安全',
            },
        ],
    }, {
        userName: '狐夜',
        allowUserInnerVoice: false,
    });

    const user = result.people.find(person => person.name === '狐夜');
    const npc = result.people.find(person => person.name === '老白');
    assert.equal(user.isUser, true);
    assert.equal(user.innerVoice, '');
    assert.equal(user.longTermGoal, '查清失踪事件的源头');
    assert.equal(npc.innerVoice, '这事儿八成没表面那么简单。');
    assert.equal(npc.longTermGoal, '保护同福客栈众人的安全');

    const next = applySimulationResult(result, {
        elapsed_minutes: 0,
        people_upsert: [{ id: 'laobai', name: '老白', long_term_goal: '' }],
    });
    assert.equal(next.people.find(person => person.name === '老白').longTermGoal, '保护同福客栈众人的安全');
});

test('快照恢复产生互不污染的重抽分支', () => {
    const root = createInitialState({ day: 7, hour: 12, minute: 0 });
    const base = createSnapshot(root, {
        messageId: 10,
        swipeId: 0,
        sourceKey: '10:0:base',
        kind: 'base',
    });

    const firstBranch = advanceWorldClock(restoreSnapshot(base), 90, '第一条正文');
    const secondBranch = advanceWorldClock(restoreSnapshot(base), 15, '重抽正文');

    assert.equal(firstBranch.clock.absoluteMinute, root.clock.absoluteMinute + 90);
    assert.equal(secondBranch.clock.absoluteMinute, root.clock.absoluteMinute + 15);
    assert.equal(restoreSnapshot(base).clock.absoluteMinute, root.clock.absoluteMinute);
});

test('未被正文承接的非直接结果在三次显露后归档', () => {
    let state = createInitialState();
    state.events = [normalizeEvent({
        id: 'harbor-rumor',
        title: '港口流言扩散',
        status: 'resolved',
        result: '流言已经传遍码头。',
        visibility: 'trace',
        delivery_state: 'pending',
    }, state.clock.absoluteMinute)];

    assert.deepEqual(
        selectDeliveryCandidates(state, { deliveryDensity: 'restrained' }).map(event => event.id),
        ['harbor-rumor'],
    );

    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 1 });
    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 2 });
    assert.equal(state.events[0].delivery.state, 'pending');

    state = recordDeliveryOffers(state, ['harbor-rumor'], { messageId: 3 });
    assert.equal(state.events[0].delivery.state, 'expired');
    assert.equal(state.archive.length, 1);
    assert.equal(state.archive[0].eventId, 'harbor-rumor');
});

test('能从带说明或代码围栏的返回中提取唯一 JSON 对象', () => {
    assert.deepEqual(
        extractJsonObject('```json\n{"elapsed_minutes":45,"people_upsert":[]}\n```'),
        { elapsed_minutes: 45, people_upsert: [] },
    );
    assert.deepEqual(
        extractJsonObject('结算如下：{"elapsed_minutes":0,"world":{"title":"静夜"}} 完毕'),
        { elapsed_minutes: 0, world: { title: '静夜' } },
    );
    assert.deepEqual(
        extractJsonObject('{"elapsed_minutes":8,"world":{"title":"雨夜\n保险柜",},}'),
        { elapsed_minutes: 8, world: { title: '雨夜\n保险柜' } },
    );
    assert.equal(
        extractJsonObject('{"elapsed_minutes":8,"world":{"title":"被截断'),
        null,
    );
    assert.equal(extractJsonObject('没有结构化内容'), null);
});
