const PATCH_KEY = Symbol.for('world_backstage.communication_voice_guard.v1');
const ECOLOGY_PATCH_KEY = Symbol.for('world_backstage.communication_ecology.v1');
const STATE_KEY = 'world_backstage_v1';
const VOICE_OPEN_TAG = '<world_backstage_character_voice>';

const SOCIAL_MARKERS = [
    '世界背面·内置社交',
    '通讯好友申请',
    '好友申请',
    '世界背面·朋友圈',
    '生活社交脉冲',
    'friend_requests',
    'remove_friends',
];

function cleanText(value, maximum = 600) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function isSocialPrompt(value, depth = 0) {
    if (depth > 7 || value == null) return false;
    if (typeof value === 'string') return SOCIAL_MARKERS.some(marker => value.includes(marker));
    if (Array.isArray(value)) return value.some(item => isSocialPrompt(item, depth + 1));
    if (typeof value !== 'object') return false;
    return Object.values(value).some(item => isSocialPrompt(item, depth + 1));
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

function promptText(value) {
    if (typeof value === 'string') return value.slice(0, 80000);
    try {
        return JSON.stringify(value).slice(0, 80000);
    } catch {
        return '';
    }
}

function normalizedRef(value) {
    return cleanText(value, 160).toLocaleLowerCase();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function promptMentionsReference(sourceText, value) {
    const reference = normalizedRef(value);
    if (!reference) return false;
    const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}_-])${escapeRegex(reference)}(?=$|[^\\p{L}\\p{N}_-])`,
        'iu',
    );
    return pattern.test(String(sourceText || ''));
}

function hasVoiceInstruction(value) {
    return promptText(value).includes(VOICE_OPEN_TAG);
}

function taskChannel(sourceText = '') {
    const text = String(sourceText || '');
    if (/朋友圈|公开动态|posts|moments/iu.test(text)) return 'public_post';
    if (/好友申请|friend_requests|建立稳定联系|建立联系/iu.test(text)) return 'contact_request';
    if (/群聊|group/iu.test(text)) return 'group_message';
    if (/电话|来电|通话/iu.test(text)) return 'call';
    if (/短信|sms/iu.test(text)) return 'sms';
    return 'private_message';
}

function relationFor(social, personId) {
    const id = String(personId || '');
    const connections = Array.isArray(social?.connections) ? social.connections : [];
    const connection = connections.find(item => String(item?.personId ?? item?.person_id ?? '') === id) || null;
    if (!connection) return { status: '', evidence: '' };
    return {
        status: cleanText(connection.status, 40),
        evidence: cleanText(connection.evidence ?? connection.reason ?? connection.note, 220),
    };
}

function collectVoiceSamples(social, personId, { maximum = 4, compact = false } = {}) {
    const id = String(personId || '');
    if (!id) return [];
    const samples = [];
    const conversations = Array.isArray(social?.conversations) ? social.conversations : [];
    for (const conversation of conversations) {
        const messages = Array.isArray(conversation?.rawMessages)
            ? conversation.rawMessages
            : Array.isArray(conversation?.messages)
                ? conversation.messages
                : [];
        for (const message of messages) {
            const senderId = String(message?.senderId ?? message?.sender_id ?? '');
            if (senderId !== id) continue;
            const text = cleanText(message?.text ?? message?.content, compact ? 150 : 280);
            if (!text) continue;
            samples.push({
                channel: conversation?.type === 'group' ? 'group_message' : 'private_message',
                text,
                at: Number(message?.worldMinute ?? message?.world_minute ?? message?.createdAt ?? 0) || 0,
            });
        }
    }

    const moments = Array.isArray(social?.moments)
        ? social.moments
        : Array.isArray(social?.posts)
            ? social.posts
            : [];
    for (const moment of moments) {
        const authorId = String(moment?.personId ?? moment?.person_id ?? moment?.authorId ?? moment?.author_id ?? '');
        if (authorId !== id) continue;
        const text = cleanText(moment?.text ?? moment?.content, compact ? 150 : 280);
        if (!text) continue;
        samples.push({
            channel: 'public_post',
            text,
            at: Number(moment?.worldMinute ?? moment?.world_minute ?? moment?.createdAt ?? 0) || 0,
        });
    }

    return samples
        .sort((a, b) => b.at - a.at)
        .slice(0, Math.max(0, Number(maximum) || 0))
        .map(({ channel, text }) => ({ channel, text }));
}

function fallbackSocialPersonIds(store) {
    const social = store?.social;
    const ids = [];
    const add = value => {
        const id = String(value || '');
        if (id && !ids.includes(id)) ids.push(id);
    };
    const conversations = Array.isArray(social?.conversations) ? social.conversations : [];
    for (const conversation of conversations.slice(-12)) {
        for (const id of Array.isArray(conversation?.memberIds) ? conversation.memberIds : []) add(id);
    }
    const connections = Array.isArray(social?.connections) ? social.connections : [];
    for (const connection of connections.slice(-18)) add(connection?.personId ?? connection?.person_id);
    return ids.slice(0, 24);
}

export function selectCommunicationVoiceProfiles(store, state, promptSource) {
    const people = (Array.isArray(state?.people) ? state.people : []).filter(person => !isUserPerson(person));
    const source = promptText(promptSource).toLocaleLowerCase();
    let selected = people.filter(person => {
        const id = normalizedRef(person?.id);
        const name = normalizedRef(person?.name);
        return Boolean(
            (id && promptMentionsReference(source, id))
            || (name && promptMentionsReference(source, name))
        );
    });

    if (!selected.length) {
        const fallbackIds = new Set(fallbackSocialPersonIds(store));
        selected = people.filter(person => fallbackIds.has(String(person?.id || '')));
    }
    selected = selected.slice(0, 24);
    const compact = selected.length > 8;
    const social = store?.social;

    return selected.map(person => {
        const relation = relationFor(social, person?.id);
        return {
            id: cleanText(person?.id, 120),
            name: cleanText(person?.name, 80),
            identity_anchor: cleanText(person?.identityAnchor ?? person?.identity_anchor, compact ? 180 : 420),
            personality_anchor: cleanText(person?.personalityAnchor ?? person?.personality_anchor, compact ? 240 : 520),
            background_profile: cleanText(person?.backgroundProfile ?? person?.background_profile, compact ? 220 : 620),
            speaking_style: cleanText(person?.speakingStyle ?? person?.speaking_style, compact ? 200 : 360),
            behavior_boundaries: cleanText(person?.behaviorBoundaries ?? person?.behavior_boundaries, compact ? 200 : 420),
            relationship: relation,
            voice_samples: collectVoiceSamples(social, person?.id, {
                maximum: compact ? 2 : 5,
                compact,
            }),
        };
    });
}

export function buildCommunicationVoiceInstruction(store, state, promptSource) {
    const source = promptText(promptSource);
    const profiles = selectCommunicationVoiceProfiles(store, state, promptSource);
    const channel = taskChannel(source);
    const player = (Array.isArray(state?.people) ? state.people : []).find(isUserPerson) || null;
    const playerAnchor = player ? {
        name: cleanText(player?.name, 80),
        identity_anchor: cleanText(player?.identityAnchor ?? player?.identity_anchor, 320),
    } : null;

    return [
        VOICE_OPEN_TAG,
        `本次通讯语域：${channel}。同一个人在私聊、群聊、电话/短信和公开动态里可以有不同表达习惯，不要把一种渠道的文风机械套到另一种渠道。`,
        '人物通讯必须先做“人物决策”，再做“语言实现”：先判断这个具体人物此刻基于目标、关系距离、情绪、行为边界和已知信息会不会主动联系、回复、建立联系或公开发言；如果不会，保持沉默/无动作就是正确结果。不得因为界面需要内容而强迫人物营业。',
        '作者维护的 identity/personality/background/speaking_style/behavior_boundaries 是人物边界，不是把性格标签翻译成模板文风的提示。冷静不等于客服或报告腔，聪明不等于术语堆砌，寡言不等于句句省略号，活泼不等于每句加表情，亲密也不等于突然撒娇。',
        'speaking_style 与 behavior_boundaries 是硬约束；同一人物已经发过的 voice_samples 是更具体的语言实现证据。参考她常用词、句长、标点、称呼、emoji/颜文字习惯、直白或含蓄程度与节奏，但不要复读原句、复制固定口癖或把单一特征夸张成表演。若旧样本与作者锚点冲突，以作者锚点为准。',
        'voice_samples 的事实内容属于“当时那条消息/动态”的历史内容，只能用于学习表达方式，绝不能因此把其中地点、状态、关系进展或旧事件当成当前事实。当前可说什么仍严格服从原任务提供的 knowledge / 人物认知账本。',
        '关系距离决定称呼、礼貌程度、亲密度、解释多少、是否主动追问、是否开玩笑以及回复长度。没有已结算的关系变化或对话证据，不得突然使用昵称、暧昧称呼、过度关心、过度客套、敌意升级或无来由的熟稔。',
        '消息要像这个人真的会发出去的通讯，不像作者旁白、人物分析、心理总结、客服答复或角色小传。不要让人物解释自己的性格标签（例如“我一向冷淡/谨慎/不善表达”）；用选择、措辞、停顿、回避、直接程度和真正关心的内容自然体现。',
        '不要为了“更像人设”最大化单一特质。人物可以懒得回复、只回半句、转移话题、答非所问、犹豫、误解、保持礼貌距离，也可以什么都不发；前提是符合她本人和当前关系。',
        '公开动态尤其不能写成人物状态总结或剧情旁白；私聊尤其不能把对方当提问用户逐条完整作答。先保留人物自己的关注点和交流目的，再决定她实际说多少。',
        `人物通讯声音档案（只约束人物身份、关系语域和表达方式；绝不替代知识账本）：${profiles.length ? JSON.stringify(profiles) : '本轮未匹配到额外人物档案，按原任务已有资料保守生成，不要自行补造口癖。'}`,
        playerAnchor ? `玩家称谓身份锚点（仅用于正确称呼，不授权推测玩家内心）：${JSON.stringify(playerAnchor)}` : '未提供额外玩家称谓身份锚点。',
        '</world_backstage_character_voice>',
    ].join('\n');
}

function prependInstructionToMessages(messages, instruction) {
    if (!Array.isArray(messages)) return messages;
    if (hasVoiceInstruction(messages)) return messages;
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

export function adaptCommunicationVoicePayload(payload, context = null) {
    if (!payload || typeof payload !== 'object' || !isSocialPrompt(payload?.messages)) return payload;
    if (hasVoiceInstruction(payload.messages)) return payload;
    const store = currentStore(context);
    if (!store) return payload;
    const state = currentState(store);
    const instruction = buildCommunicationVoiceInstruction(store, state, payload.messages);
    return {
        ...payload,
        messages: prependInstructionToMessages(payload.messages, instruction),
    };
}

function adaptGenerateRawOptions(options, context) {
    if (!options || !isSocialPrompt(options.prompt)) return options;
    if (hasVoiceInstruction(options.prompt)) return options;
    const store = currentStore(context);
    if (!store) return options;
    const state = currentState(store);
    const instruction = buildCommunicationVoiceInstruction(store, state, options.prompt);
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

    const wrappedFetch = async function worldBackstageCommunicationVoiceFetch(input, init) {
        if (typeof init?.body !== 'string') return originalFetch.call(this, input, init);
        let payload;
        try {
            payload = JSON.parse(init.body);
        } catch {
            return originalFetch.call(this, input, init);
        }
        if (!isSocialPrompt(payload?.messages)) return originalFetch.call(this, input, init);
        const adapted = adaptCommunicationVoicePayload(payload);
        if (adapted === payload) return originalFetch.call(this, input, init);
        return originalFetch.call(this, input, {
            ...init,
            body: JSON.stringify(adapted),
        });
    };
    Object.defineProperty(wrappedFetch, PATCH_KEY, { value: true, enumerable: false });
    if (originalFetch[ECOLOGY_PATCH_KEY]) {
        Object.defineProperty(wrappedFetch, ECOLOGY_PATCH_KEY, { value: true, enumerable: false });
    }
    globalThis.fetch = wrappedFetch;
    return true;
}

function installGenerateRawPolicy() {
    const tavern = globalThis.SillyTavern;
    const originalGetContext = tavern?.getContext;
    if (typeof originalGetContext !== 'function' || originalGetContext[PATCH_KEY]) return false;
    const cache = new WeakMap();

    const wrappedGetContext = function worldBackstageCommunicationVoiceGetContext(...args) {
        const context = originalGetContext.apply(this, args);
        const raw = context?.generateRaw;
        if (!context || typeof raw !== 'function' || raw[PATCH_KEY]) return context;
        let wrapped = cache.get(raw);
        if (!wrapped) {
            wrapped = function worldBackstageCommunicationVoiceGenerateRaw(options = {}) {
                return raw.call(context, adaptGenerateRawOptions(options, context));
            };
            Object.defineProperty(wrapped, PATCH_KEY, { value: true, enumerable: false });
            if (raw[ECOLOGY_PATCH_KEY]) {
                Object.defineProperty(wrapped, ECOLOGY_PATCH_KEY, { value: true, enumerable: false });
            }
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