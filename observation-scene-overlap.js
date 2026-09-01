const PATCH_KEY = Symbol.for('world_backstage.observation_scene_overlap.v1');
const STATE_KEY = 'world_backstage_v1';
const OBSERVATION_MARKER = '你是“世界背面”的人物即时观测器。';

function cleanText(value, maximum = 600) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizedReference(value) {
    return cleanText(value, 220).toLocaleLowerCase();
}

function normalizedLocation(value) {
    return normalizedReference(value)
        .replace(/\s+/g, '')
        .replace(/[，,。；;、·|｜/\\]+/g, '');
}

function promptText(value) {
    if (typeof value === 'string') return value.slice(0, 100000);
    try {
        return JSON.stringify(value).slice(0, 100000);
    } catch {
        return '';
    }
}

function isObservationPrompt(value, depth = 0) {
    if (depth > 7 || value == null) return false;
    if (typeof value === 'string') return value.includes(OBSERVATION_MARKER);
    if (Array.isArray(value)) return value.some(item => isObservationPrompt(item, depth + 1));
    if (typeof value !== 'object') return false;
    return Object.values(value).some(item => isObservationPrompt(item, depth + 1));
}

function currentStore(context = null) {
    let resolved = context;
    if (!resolved) {
        try {
            resolved = globalThis.SillyTavern?.getContext?.() || null;
        } catch {
            resolved = null;
        }
    }
    return resolved?.chatMetadata?.[STATE_KEY] || null;
}

function currentState(store) {
    return store?.currentState || store?.initialState || {};
}

function isUserPerson(person) {
    return Boolean(person?.isUser || person?.is_user || person?.role === 'user');
}

function extractObservationAnchor(source) {
    const text = promptText(source);
    const jsonMatch = text.match(/场景关系约束（只作一致性边界，不是角色知识）：(\{[^\n\r]+\})/u);
    if (jsonMatch?.[1]) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            return {
                personId: cleanText(parsed?.personId, 120),
                userId: cleanText(parsed?.userId, 120),
                personName: '',
            };
        } catch {
            // Fall through to the stable human-readable observation header.
        }
    }
    const nameMatch = text.match(/本次唯一观测主体是“([^”]{1,80})”/u);
    return {
        personId: '',
        userId: '',
        personName: cleanText(nameMatch?.[1], 80),
    };
}

function microSceneLocation(value) {
    const text = normalizedLocation(value);
    if (!text) return false;
    return /(?:卧室|客厅|厨房|书房|办公室|会议室|病房|教室|包厢|包间|车厢|驾驶舱|舰桥|电梯|走廊|楼梯间|阳台|浴室|卫生间|柜台|吧台|站台|候诊室|审讯室|仓库|房间|屋内|室内|门口|床边|桌边|座位|卡座|诊室|休息室|更衣室|储物间)$/u.test(text);
}

function actionProvesPerception(actor, counterpart) {
    if (!actor || !counterpart) return false;
    const source = cleanText(actor?.action ?? actor?.currentAction ?? actor?.current_action, 600);
    if (!source) return false;
    const refs = [counterpart?.id, counterpart?.name]
        .map(normalizedReference)
        .filter(value => value.length >= 1);
    const lowered = source.toLocaleLowerCase();
    if (!refs.some(ref => lowered.includes(ref))) return false;
    return /(?:看见|看到|望向|看着|盯着|注意到|发现|听见|听到|认出|回应|交谈|说话|对话|招呼|叫住|拦住|递给|接过|握住|拉住|牵着|拥抱|搀扶|碰到|面对|并肩|一起|跟随|跟着|点头|示意|回答|问道|说道|正在和|正与)/u.test(source);
}

function locationBaseRelation(personLocation, userLocation) {
    const observed = normalizedLocation(personLocation);
    const player = normalizedLocation(userLocation);
    if (!observed || !player) return 'unknown';
    if (observed === player) return 'same_place';
    if (
        observed.length >= 3
        && player.length >= 3
        && (observed.includes(player) || player.includes(observed))
    ) return 'same_area';
    return 'separate';
}

export function classifyObservationSceneOverlap(state, person, player = null) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const resolvedPlayer = player || people.find(isUserPerson) || null;
    const personLocation = cleanText(person?.location, 180);
    const userLocation = cleanText(resolvedPlayer?.location, 180);
    const base = locationBaseRelation(personLocation, userLocation);

    let kind = base;
    let perceivedBy = 'none';
    const locationOverlap = ['same_area', 'same_place'].includes(base);
    if (locationOverlap) {
        const personPerceives = actionProvesPerception(person, resolvedPlayer);
        const playerPerceives = actionProvesPerception(resolvedPlayer, person);
        if (personPerceives || playerPerceives) {
            kind = 'perceived';
            perceivedBy = personPerceives && playerPerceives
                ? 'both'
                : personPerceives
                    ? 'person'
                    : 'user';
        } else if (base === 'same_place' && microSceneLocation(personLocation) && microSceneLocation(userLocation)) {
            kind = 'same_scene';
        }
    }

    return {
        kind,
        base,
        perceivedBy,
        personId: cleanText(person?.id, 120),
        personLocation,
        userId: cleanText(resolvedPlayer?.id, 120),
        userLocation: locationOverlap ? userLocation : '',
        source: 'authoritative_person_state',
        mutableByObservation: false,
    };
}

function resolveObservationActors(store, source) {
    const state = currentState(store);
    const people = Array.isArray(state?.people) ? state.people : [];
    const anchor = extractObservationAnchor(source);
    let person = anchor.personId
        ? people.find(item => String(item?.id || '') === anchor.personId)
        : null;
    if (!person && anchor.personName) {
        const wanted = normalizedReference(anchor.personName);
        person = people.find(item => !isUserPerson(item) && normalizedReference(item?.name) === wanted) || null;
    }
    const player = anchor.userId
        ? people.find(item => String(item?.id || '') === anchor.userId) || people.find(isUserPerson) || null
        : people.find(isUserPerson) || null;
    return { state, person, player };
}

export function buildObservationSceneOverlapInstruction(store, promptSource) {
    const { state, person, player } = resolveObservationActors(store, promptSource);
    if (!person) return '';
    const relation = classifyObservationSceneOverlap(state, person, player);
    const personName = cleanText(person?.name, 80) || '该人物';
    const playerName = cleanText(player?.name, 80) || 'user';
    const lines = [
        '<world_backstage_observation_scene_overlap>',
        '这是对人物即时观测的“场景重叠校验层”。它只读取已结算 currentState 中的人物 location / action，不读取也不相信本次观测生成出来的自然语言。',
        '方向固定为：权威世界状态 → 观测。严禁反向使用观测文本修改、补全或升级世界事实；本次输出即使写了“看见/遇见/来到”，也不会因此成为权威事实。',
        `当前结构化关系：${JSON.stringify(relation)}。`,
    ];

    if (relation.kind === 'same_area') {
        lines.push(`${personName} 与 ${playerName} 只处在有范围包含关系的较大区域。不得写成同一房间、同一视线、擦肩而过或已经相遇。`);
    } else if (relation.kind === 'same_place') {
        lines.push(`${personName} 与 ${playerName} 当前记录为同一地点/场所，但粒度不足以证明同一小场景。可以保持“可能在同一场所”的空间事实，不能自动让任何一方看见、听见、注意到或围绕对方思考。`);
    } else if (relation.kind === 'same_scene') {
        lines.push(`${personName} 与 ${playerName} 已由权威位置记录落在同一个较小具体场景。这个等级只提高空间连续性，不自动授予感知：除非 action 已经证明接触，否则仍不能突然看见、听见、认出、搭话或建立互动。`);
    } else if (relation.kind === 'perceived') {
        lines.push(`权威 action 已经证明 ${personName} / ${playerName} 之间存在当前感知或互动接触（perceivedBy=${relation.perceivedBy}）。观测必须保持这条连续性，不能假装对方不存在；但只能使用实际感知得到的信息，不能因此获得对方内心、幕后真相或未说出口的知识。`);
    } else if (relation.kind === 'separate') {
        lines.push(`${personName} 与 ${playerName} 的权威位置分离。不得把玩家拉进该人物当前意识现场，也不得为了制造相遇而移动任何一方。`);
    } else {
        lines.push('当前缺少足够位置证据。保持未知，不补造同场、视线、相遇或玩家当前位置。');
    }

    lines.push('如果原始观测提示中的旧 relation 与这里的校验层冲突，以这里基于当前 currentState 重新计算的结果为准；这属于投影纠偏，不是一次世界状态写入。');
    lines.push('</world_backstage_observation_scene_overlap>');
    return lines.join('\n');
}

function prependInstructionToMessages(messages, instruction) {
    if (!Array.isArray(messages) || !instruction) return messages;
    const next = messages.map(message => ({ ...message }));
    const systemIndex = next.findIndex(message => String(message?.role || '').toLowerCase() === 'system');
    if (systemIndex >= 0) {
        next[systemIndex] = {
            ...next[systemIndex],
            content: `${instruction}\n\n${String(next[systemIndex]?.content || '')}`,
        };
    } else {
        next.unshift({ role: 'system', content: instruction });
    }
    return next;
}

export function adaptObservationScenePayload(payload, context = null) {
    if (!payload || typeof payload !== 'object' || !isObservationPrompt(payload?.messages)) return payload;
    const store = currentStore(context);
    if (!store) return payload;
    const instruction = buildObservationSceneOverlapInstruction(store, payload.messages);
    if (!instruction) return payload;
    return {
        ...payload,
        messages: prependInstructionToMessages(payload.messages, instruction),
    };
}

export function adaptObservationGenerateRawOptions(options, context = null) {
    if (!options || !isObservationPrompt(options.prompt)) return options;
    const store = currentStore(context);
    if (!store) return options;
    const instruction = buildObservationSceneOverlapInstruction(store, options.prompt);
    if (!instruction) return options;
    if (Array.isArray(options.prompt)) {
        return {
            ...options,
            prompt: prependInstructionToMessages(options.prompt, instruction),
        };
    }
    return {
        ...options,
        prompt: `${instruction}\n\n${String(options.prompt || '')}`,
    };
}

function installFetchPolicy() {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== 'function' || originalFetch[PATCH_KEY]) return false;

    const wrappedFetch = async function worldBackstageObservationSceneFetch(input, init) {
        if (typeof init?.body !== 'string') return originalFetch.call(this, input, init);
        let payload;
        try {
            payload = JSON.parse(init.body);
        } catch {
            return originalFetch.call(this, input, init);
        }
        if (!isObservationPrompt(payload?.messages)) return originalFetch.call(this, input, init);
        const adapted = adaptObservationScenePayload(payload);
        if (adapted === payload) return originalFetch.call(this, input, init);
        return originalFetch.call(this, input, {
            ...init,
            body: JSON.stringify(adapted),
        });
    };
    Object.defineProperty(wrappedFetch, PATCH_KEY, { value: true, enumerable: false });
    globalThis.fetch = wrappedFetch;
    return true;
}

function installGenerateRawPolicy() {
    const tavern = globalThis.SillyTavern;
    const originalGetContext = tavern?.getContext;
    if (typeof originalGetContext !== 'function' || originalGetContext[PATCH_KEY]) return false;
    const cache = new WeakMap();

    const wrappedGetContext = function worldBackstageObservationSceneGetContext(...args) {
        const context = originalGetContext.apply(this, args);
        const raw = context?.generateRaw;
        if (!context || typeof raw !== 'function' || raw[PATCH_KEY]) return context;
        let wrapped = cache.get(raw);
        if (!wrapped) {
            wrapped = function worldBackstageObservationSceneGenerateRaw(options = {}) {
                return raw.call(context, adaptObservationGenerateRawOptions(options, context));
            };
            Object.defineProperty(wrapped, PATCH_KEY, { value: true, enumerable: false });
            cache.set(raw, wrapped);
        }
        try {
            context.generateRaw = wrapped;
            return context;
        } catch {
            return new Proxy(context, {
                get(target, property, receiver) {
                    if (property === 'generateRaw') return wrapped;
                    return Reflect.get(target, property, receiver);
                },
            });
        }
    };
    Object.defineProperty(wrappedGetContext, PATCH_KEY, { value: true, enumerable: false });
    tavern.getContext = wrappedGetContext;
    return true;
}

function install() {
    installFetchPolicy();
    if (installGenerateRawPolicy()) return;
    let attempts = 0;
    const timer = globalThis.setInterval(() => {
        attempts += 1;
        if (installGenerateRawPolicy() || attempts >= 40) globalThis.clearInterval(timer);
    }, 250);
}

if (globalThis.SillyTavern || globalThis.document) install();
