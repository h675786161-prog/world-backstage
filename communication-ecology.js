const PATCH_KEY = Symbol.for('world_backstage.communication_ecology.v1');
const MODULE_ID = 'world_backstage';
const STATE_KEY = 'world_backstage_v1';

const SOCIAL_MARKERS = [
    '世界背面·内置社交',
    '通讯好友申请',
    '好友申请',
    '世界背面·朋友圈',
    '生活社交脉冲',
    'friend_requests',
    'remove_friends',
];

const SCORE_RULES = Object.freeze({
    modern: [
        [/手机|智能机|电话|短信|微信|QQ|聊天软件|即时通讯|社交平台|社交媒体|互联网|网络账号|邮箱|电子邮件|APP|直播|视频通话/giu, 6],
        [/现代|都市|公司|办公室|大学|高中|医院|警局|商场|地铁|出租车|网吧|电脑|摄影棚|经纪公司/giu, 1],
    ],
    historical: [
        [/古代|王朝|朝廷|皇帝|皇后|太后|王爷|公主|驸马|宫廷|王府|县衙|驿站|驿传|飞鸽|书信|家书|拜帖|名帖|信使|口信|传话|奏折|邸报/giu, 5],
        [/江湖|门派|掌门|少侠|侠客|客栈|镖局|科举|官府|太守|知府|县令|侍卫|内侍|宫女/giu, 2],
    ],
    scifi: [
        [/星际|星舰|宇宙航行|太空站|殖民星|跃迁|曲率|量子通讯|光脑|终端|全息通讯|通讯器|舰载频道|神经接口|赛博|网络空间|星网/giu, 6],
        [/飞船|舰桥|机甲|人工智能|仿生人|殖民地|轨道站/giu, 2],
    ],
    lowtech: [
        [/原始社会|史前|荒岛|孤岛求生|与世隔绝|无通讯|无法通讯|通讯中断|断网|失联|无线电静默|荒野求生/giu, 7],
    ],
    supernatural: [
        [/魔法|魔力|法术|巫术|术式|灵力|灵气|修仙|仙门|神术|异能|超能力|咒术|魔导|炼金|使魔|精灵|妖怪|神明/giu, 2],
        [/传讯术|传音|传音入密|神识传音|念话|心灵感应|通讯魔法|通讯水晶|魔法水晶|传讯水晶|灵符传讯|符箓传讯|飞剑传书|使魔传信|魔法信件/giu, 8],
    ],
});

function cleanText(value, maximum = 4000) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function scoreText(source, rules) {
    let score = 0;
    for (const [pattern, weight] of rules) {
        pattern.lastIndex = 0;
        const matches = source.match(pattern);
        if (matches?.length) score += Math.min(4, matches.length) * weight;
    }
    return score;
}

function selectedWorldEvidence(state = {}, store = null) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const events = Array.isArray(state?.events) ? state.events : [];
    const facts = Array.isArray(state?.storyMemory?.facts) ? state.storyMemory.facts : [];
    const summaries = Array.isArray(state?.storyMemory?.summaries) ? state.storyMemory.summaries : [];
    const clues = Array.isArray(state?.storyMemory?.clues) ? state.storyMemory.clues : [];

    const parts = [
        state?.worldBackground,
        state?.worldSetting,
        state?.setting,
        state?.background,
        state?.summary,
        state?.location,
        store?.initialState?.worldBackground,
        store?.initialState?.worldSetting,
        store?.initialState?.setting,
        ...people.slice(0, 48).flatMap(person => [
            person?.identityAnchor,
            person?.backgroundProfile,
            person?.worldbookRaw,
            person?.location,
            person?.action,
            person?.intent,
        ]),
        ...events.slice(-36).map(item => JSON.stringify(item)),
        ...facts.slice(-48).map(item => JSON.stringify(item)),
        ...summaries.slice(-24).map(item => JSON.stringify(item)),
        ...clues.slice(-24).map(item => JSON.stringify(item)),
    ];

    let output = '';
    for (const value of parts) {
        if (value == null) continue;
        const chunk = cleanText(typeof value === 'string' ? value : JSON.stringify(value), 5000);
        if (!chunk) continue;
        output += `${chunk}\n`;
        if (output.length >= 48000) break;
    }
    return output.slice(0, 48000);
}

function technologyProfile(scores) {
    const ordered = [
        ['scifi', scores.scifi],
        ['historical', scores.historical],
        ['modern', scores.modern],
        ['lowtech', scores.lowtech],
    ].sort((a, b) => b[1] - a[1]);
    const [winner, winnerScore] = ordered[0];
    const secondScore = ordered[1][1];

    if (winnerScore <= 1) return { technology: 'unknown', confidence: 'low' };
    if (winnerScore === secondScore && winnerScore < 8) return { technology: 'unknown', confidence: 'low' };
    return {
        technology: winner,
        confidence: winnerScore >= secondScore + 6 || winnerScore >= 12 ? 'high' : 'medium',
    };
}

function labelsFor(technology, supernatural) {
    const base = {
        modern: {
            privateChannel: '即时通讯、电话、短信或世界中已确认的现代通信',
            publicChannel: '社交平台、公开动态或世界中已确认的公开网络',
            contactConcept: '联系方式 / 联系人',
            delivery: '通常可即时送达，但仍受离线、屏蔽、网络与人物意愿影响',
            realtime: 'usually',
            publicStream: 'usually',
            groupChannel: 'usually',
        },
        historical: {
            privateChannel: '书信、口信、信使、驿传、拜帖或其他时代内合理方式',
            publicChannel: '公告、邸报、诗帖、宴会消息、市井传播等真实存在的公开渠道',
            contactConcept: '稳定往来渠道 / 可托人传话的关系',
            delivery: '默认不是即时；必须考虑距离、信使、驿路、身份与送达时间',
            realtime: 'rare',
            publicStream: 'conditional',
            groupChannel: 'conditional',
        },
        scifi: {
            privateChannel: '终端、通讯器、舰内频道、星网或世界中已确认的未来通信',
            publicChannel: '公共频道、星网、广播或世界中已确认的公开信息网络',
            contactConcept: '通讯权限 / 联系节点',
            delivery: '局域通讯可即时；跨区域、跨星系是否延迟必须服从世界规则',
            realtime: 'conditional',
            publicStream: 'usually',
            groupChannel: 'usually',
        },
        lowtech: {
            privateChannel: '当面交谈、托人传话、记号、纸条或环境中实际可用的低技术方式',
            publicChannel: '集会、公告、口耳传播等；不存在就不要强行生成',
            contactConcept: '可接触 / 可托人找到的关系',
            delivery: '默认不是即时；没有现实路径就视为暂时无法送达',
            realtime: 'rare',
            publicStream: 'rare',
            groupChannel: 'rare',
        },
        unknown: {
            privateChannel: '只使用世界设定已经证明存在的通讯方式',
            publicChannel: '只使用世界设定已经证明存在的公开传播渠道',
            contactConcept: '可联系关系',
            delivery: '未知；不得默认智能手机、互联网、魔法通讯或其他未被证明的媒介',
            realtime: 'unknown',
            publicStream: 'unknown',
            groupChannel: 'unknown',
        },
    }[technology] || null;

    if (!supernatural) return base;
    return {
        ...base,
        privateChannel: `${base.privateChannel}；若设定明确存在传讯术、传音、使魔、通讯水晶等，也可以使用，但绝不能只因“这是魔法世界”就凭空创造远程通讯能力`,
        delivery: `${base.delivery}；超自然通讯的距离、耗时、消耗、权限与屏蔽规则同样必须服从既有设定`,
    };
}

export function inferCommunicationEcology(state = {}, store = null) {
    const evidence = selectedWorldEvidence(state, store);
    const scores = {
        modern: scoreText(evidence, SCORE_RULES.modern),
        historical: scoreText(evidence, SCORE_RULES.historical),
        scifi: scoreText(evidence, SCORE_RULES.scifi),
        lowtech: scoreText(evidence, SCORE_RULES.lowtech),
        supernatural: scoreText(evidence, SCORE_RULES.supernatural),
    };
    const tech = technologyProfile(scores);
    const supernatural = scores.supernatural >= 4;
    const labels = labelsFor(tech.technology, supernatural);

    return {
        schemaVersion: 1,
        technology: tech.technology,
        supernatural,
        confidence: tech.confidence,
        ...labels,
        scores,
    };
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

function pendingPrivateMessages(store, state) {
    const social = store?.social;
    const conversations = Array.isArray(social?.conversations) ? social.conversations : [];
    const people = new Map((Array.isArray(state?.people) ? state.people : []).map(person => [String(person?.id || ''), person]));
    const now = Math.max(0, Number(state?.clock?.absoluteMinute) || 0);
    const pending = [];

    for (const conversation of conversations) {
        if (conversation?.type !== 'direct' || !Array.isArray(conversation.rawMessages)) continue;
        const messages = conversation.rawMessages;
        let lastUserIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index]?.senderId === 'user') {
                lastUserIndex = index;
                break;
            }
        }
        if (lastUserIndex < 0) continue;
        const hasLaterReply = messages.slice(lastUserIndex + 1).some(message => message?.senderId !== 'user');
        if (hasLaterReply) continue;
        const message = messages[lastUserIndex];
        const personId = String(conversation.memberIds?.[0] || '');
        const person = people.get(personId);
        const sentAt = Math.max(0, Number(message?.worldMinute) || 0);
        pending.push({
            conversation_id: String(conversation.id || ''),
            person_id: personId,
            person_name: cleanText(person?.name, 120),
            person_location: cleanText(person?.location, 180),
            sent_world_minute: sentAt,
            elapsed_world_minutes: Math.max(0, now - sentAt),
            text: cleanText(message?.text, 500),
        });
    }
    return pending.slice(0, 12);
}

export function communicationEcologyInstruction(ecology, { store = null, state = null } = {}) {
    const activeState = state || currentState(store);
    const pending = pendingPrivateMessages(store, activeState);
    const internalFieldNote = [
        '兼容字段说明：social 数据里的 accepted / pending / friend_request / remove_friend / posts / group 等字段只是内部协议名。',
        '它们不证明这个世界存在“好友申请、朋友圈、点赞、群聊、手机或互联网”。除非世界事实明确支持，否则角色可见文字禁止照搬这些现代产品词。',
        'friend_request 应理解为“尝试建立稳定联系渠道”；remove_friend 应理解为“中止或切断该联系渠道”；posts 应理解为“人物主动公开或半公开传播的内容”。',
    ].join('\n');

    return [
        '<world_backstage_communication_ecology>',
        '通讯系统必须服从当前世界本身，而不是让世界服从插件 UI。正文和 UI 中的“通讯”只是观察入口。',
        `当前技术生态推断：${ecology.technology}${ecology.supernatural ? ' + 超自然要素' : ''}（置信度：${ecology.confidence}）。`,
        `私密通讯只可使用：${ecology.privateChannel}。`,
        `公开传播只可使用：${ecology.publicChannel}。`,
        `“联系人”在世界内应理解为：${ecology.contactConcept}。`,
        `送达规则：${ecology.delivery}。`,
        internalFieldNote,
        '知识隔离：后台知道消息内容不等于角色已经收到。saw 必须表示消息已通过合理渠道真正抵达并被该角色看到；knows 仍只表示角色是否有知识回答。',
        '如果当前媒介无法即时送达，本轮刚发出的消息应保持 saw=false，不得为了“聊天体验”瞬间回复。之后世界时间推进、现实送达条件满足时，社交脉冲可以自然处理迟到的回复。',
        '如果世界中根本没有合理的远程/间接联系路径，允许本轮完全无回复、无公开动态、无新联系；不要为了让功能显得活跃而发明通信科技或魔法。',
        pending.length ? `当前仍待真实送达/回应的私密消息：${JSON.stringify(pending)}` : '当前没有检测到待回应的私密消息。',
        '</world_backstage_communication_ecology>',
    ].join('\n');
}

function isSocialPrompt(value, depth = 0) {
    if (depth > 7 || value == null) return false;
    if (typeof value === 'string') return SOCIAL_MARKERS.some(marker => value.includes(marker));
    if (Array.isArray(value)) return value.some(item => isSocialPrompt(item, depth + 1));
    if (typeof value !== 'object') return false;
    return Object.values(value).some(item => isSocialPrompt(item, depth + 1));
}

function prependInstructionToMessages(messages, instruction) {
    if (!Array.isArray(messages)) return messages;
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

export function adaptSocialPromptPayload(payload, context = null) {
    if (!payload || typeof payload !== 'object' || !isSocialPrompt(payload?.messages)) return payload;
    const store = currentStore(context);
    if (!store) return payload;
    const state = currentState(store);
    const ecology = inferCommunicationEcology(state, store);
    const instruction = communicationEcologyInstruction(ecology, { store, state });
    store.communicationEcology = {
        ...ecology,
        updatedAt: new Date().toISOString(),
    };
    return {
        ...payload,
        messages: prependInstructionToMessages(payload.messages, instruction),
    };
}

function adaptGenerateRawOptions(options, context) {
    if (!options || !isSocialPrompt(options.prompt)) return options;
    const store = currentStore(context);
    if (!store) return options;
    const state = currentState(store);
    const ecology = inferCommunicationEcology(state, store);
    const instruction = communicationEcologyInstruction(ecology, { store, state });
    store.communicationEcology = {
        ...ecology,
        updatedAt: new Date().toISOString(),
    };
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

    const wrappedFetch = async function worldBackstageCommunicationFetch(input, init) {
        if (typeof init?.body !== 'string') return originalFetch.call(this, input, init);
        let payload;
        try {
            payload = JSON.parse(init.body);
        } catch {
            return originalFetch.call(this, input, init);
        }
        if (!isSocialPrompt(payload?.messages)) return originalFetch.call(this, input, init);
        const adapted = adaptSocialPromptPayload(payload);
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

    const wrappedGetContext = function worldBackstageCommunicationGetContext(...args) {
        const context = originalGetContext.apply(this, args);
        const raw = context?.generateRaw;
        if (!context || typeof raw !== 'function' || raw[PATCH_KEY]) return context;
        let wrapped = cache.get(raw);
        if (!wrapped) {
            wrapped = function worldBackstageCommunicationGenerateRaw(options = {}) {
                return raw.call(context, adaptGenerateRawOptions(options, context));
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
