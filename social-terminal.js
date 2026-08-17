const MAX_CONVERSATIONS = 80;
const MAX_MESSAGES = 400;
const MAX_CONNECTIONS = 240;
const MAX_MOMENTS = 180;
const MAX_NOTICES = 40;
const MAX_MOMENT_IMAGES = 6;
const MAX_IMAGE_URL_CHARS = 6_000_000;

function text(value, maximum = 1200) {
    return String(value ?? '').trim().slice(0, maximum);
}

function makeId(prefix = 'social') {
    const random = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
}

function normalizedMessage(raw = {}) {
    const senderId = text(raw.senderId, 120);
    const body = text(raw.text, 1600);
    if (!senderId || !body) return null;
    return {
        id: text(raw.id, 160) || makeId('social-message'),
        senderId,
        senderName: text(raw.senderName, 120) || (senderId === 'user' ? '你' : '未知人物'),
        text: body,
        worldMinute: Math.max(0, Number(raw.worldMinute) || 0),
        createdAt: text(raw.createdAt, 80) || new Date().toISOString(),
    };
}

function normalizedRouting(raw = {}, memberIds = []) {
    const members = new Set(memberIds);
    return {
        at: text(raw.at, 80),
        evaluations: (Array.isArray(raw.evaluations) ? raw.evaluations : [])
            .map(item => ({
                personId: text(item?.personId ?? item?.person_id, 120),
                saw: Boolean(item?.saw),
                knows: Boolean(item?.knows),
                willing: Boolean(item?.willing),
                outcome: item?.outcome === 'speak' ? 'speak' : 'silent',
                reason: text(item?.reason, 220),
            }))
            .filter(item => members.has(item.personId)),
    };
}

function normalizedConversation(raw = {}, validPersonIds = null) {
    const type = raw.type === 'group' ? 'group' : 'direct';
    const memberIds = [...new Set(
        (Array.isArray(raw.memberIds) ? raw.memberIds : [])
            .map(id => text(id, 120))
            .filter(id => id && (!validPersonIds || validPersonIds.has(id))),
    )].slice(0, type === 'direct' ? 1 : 24);
    if (!memberIds.length) return null;
    return {
        id: text(raw.id, 160) || makeId(type),
        type,
        title: text(raw.title, 120) || '未命名会话',
        memberIds,
        rawMessages: (Array.isArray(raw.rawMessages) ? raw.rawMessages : [])
            .map(normalizedMessage)
            .filter(Boolean)
            .slice(-MAX_MESSAGES),
        lastRouting: normalizedRouting(raw.lastRouting, memberIds),
        lastError: text(raw.lastError, 500),
        createdAt: text(raw.createdAt, 80) || new Date().toISOString(),
        updatedAt: text(raw.updatedAt, 80) || new Date().toISOString(),
    };
}

function normalizedConnection(raw = {}, validPersonIds = null) {
    const personId = text(raw.personId ?? raw.person_id, 120);
    if (!personId || (validPersonIds && !validPersonIds.has(personId))) return null;
    const status = ['accepted', 'pending', 'declined', 'suggested', 'incoming', 'removed'].includes(raw.status)
        ? raw.status
        : 'suggested';
    return {
        personId,
        status,
        source: text(raw.source, 60) || 'world',
        evidence: text(raw.evidence, 360),
        requestMessage: text(raw.requestMessage ?? raw.request_message, 300),
        decisionReason: text(raw.decisionReason ?? raw.decision_reason, 360),
        decisionReply: text(raw.decisionReply ?? raw.decision_reply, 300),
        requestedAt: text(raw.requestedAt ?? raw.requested_at, 80),
        respondedAt: text(raw.respondedAt ?? raw.responded_at, 80),
        updatedAt: text(raw.updatedAt ?? raw.updated_at, 80) || new Date().toISOString(),
    };
}

function normalizedMoment(raw = {}, validPersonIds = null) {
    const personId = text(raw.personId ?? raw.person_id, 120);
    const body = text(raw.text, 1200);
    if (!personId || !body || (validPersonIds && !validPersonIds.has(personId))) return null;
    const rawImage = text(raw.imageUrl ?? raw.image_url, MAX_IMAGE_URL_CHARS);
    const imageUrl = /^(?:https?:\/\/|data:image\/)/i.test(rawImage) ? rawImage : '';
    return {
        id: text(raw.id, 160) || makeId('moment'),
        personId,
        text: body,
        visibility: raw.visibility === 'private' ? 'private' : 'friends',
        worldMinute: Math.max(0, Number(raw.worldMinute ?? raw.world_minute) || 0),
        wantsImage: Boolean(raw.wantsImage ?? raw.wants_image),
        imagePrompt: text(raw.imagePrompt ?? raw.image_prompt, 1200),
        imageUrl,
        imageError: text(raw.imageError ?? raw.image_error, 360),
        likedByUser: Boolean(raw.likedByUser ?? raw.liked_by_user),
        likes: Math.max(0, Math.min(9999, Number(raw.likes) || 0)),
        createdAt: text(raw.createdAt ?? raw.created_at, 80) || new Date().toISOString(),
    };
}

function normalizedNotice(raw = {}, validPersonIds = null) {
    const kind = ['message', 'friend_request', 'friend_removed', 'moment'].includes(raw.kind)
        ? raw.kind
        : 'message';
    const personId = text(raw.personId ?? raw.person_id, 120);
    if (!personId || (validPersonIds && !validPersonIds.has(personId))) return null;
    return {
        id: text(raw.id, 160) || makeId('social-notice'),
        kind,
        personId,
        conversationId: text(raw.conversationId ?? raw.conversation_id, 160),
        text: text(raw.text, 500),
        createdAt: text(raw.createdAt ?? raw.created_at, 80) || new Date().toISOString(),
        readAt: text(raw.readAt ?? raw.read_at, 80),
    };
}

export function emptySocialState() {
    return {
        schemaVersion: 2,
        activeConversationId: '',
        conversations: [],
        connections: [],
        moments: [],
        notices: [],
        momentsUpdatedAt: '',
        momentsUpdatedWorldMinute: -1,
        lastPulseMessageId: -1,
        lastPulseWorldMinute: -1,
        lastPulseRelationSignature: '',
    };
}

export function normalizeSocialState(raw, people = []) {
    const validPersonIds = new Set(
        (Array.isArray(people) ? people : [])
            .filter(person => !person?.isUser)
            .map(person => text(person?.id, 120))
            .filter(Boolean),
    );
    const source = raw && typeof raw === 'object' ? raw : emptySocialState();
    const conversations = (Array.isArray(source.conversations) ? source.conversations : [])
        .map(item => normalizedConversation(item, validPersonIds))
        .filter(Boolean)
        .slice(-MAX_CONVERSATIONS);
    const activeConversationId = conversations.some(item => item.id === source.activeConversationId)
        ? source.activeConversationId
        : (conversations[0]?.id || '');
    const connectionMap = new Map();
    for (const rawConnection of Array.isArray(source.connections) ? source.connections : []) {
        const connection = normalizedConnection(rawConnection, validPersonIds);
        if (connection) connectionMap.set(connection.personId, connection);
    }
    // Existing direct/group conversations predate the friendship graph. Preserve
    // them as accepted real contacts instead of breaking users' current chats.
    for (const conversation of conversations) {
        for (const personId of conversation.memberIds) {
            const existing = connectionMap.get(personId);
            if (existing) continue;
            connectionMap.set(personId, {
                ...normalizedConnection({ personId }, validPersonIds),
                status: 'accepted',
                source: 'legacy-conversation',
                evidence: '已有通讯会话',
            });
        }
    }
    const connections = [...connectionMap.values()].slice(-MAX_CONNECTIONS);
    const acceptedIds = new Set(connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const moments = (Array.isArray(source.moments) ? source.moments : [])
        .map(item => normalizedMoment(item, validPersonIds))
        .filter(item => item && acceptedIds.has(item.personId))
        .slice(-MAX_MOMENTS);
    const imageMoments = moments.filter(item => item.imageUrl);
    for (const oldMoment of imageMoments.slice(0, Math.max(0, imageMoments.length - MAX_MOMENT_IMAGES))) {
        oldMoment.imageUrl = '';
    }
    const notices = (Array.isArray(source.notices) ? source.notices : [])
        .map(item => normalizedNotice(item, validPersonIds))
        .filter(Boolean)
        .slice(-MAX_NOTICES);
    return {
        schemaVersion: 2,
        activeConversationId,
        conversations,
        connections,
        moments,
        notices,
        momentsUpdatedAt: text(source.momentsUpdatedAt ?? source.moments_updated_at, 80),
        momentsUpdatedWorldMinute: Number.isFinite(Number(source.momentsUpdatedWorldMinute ?? source.moments_updated_world_minute))
            ? Math.max(-1, Number(source.momentsUpdatedWorldMinute ?? source.moments_updated_world_minute))
            : -1,
        lastPulseMessageId: Number.isFinite(Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            ? Math.max(-1, Number(source.lastPulseMessageId ?? source.last_pulse_message_id))
            : -1,
        lastPulseWorldMinute: Number.isFinite(Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))
            ? Math.max(-1, Number(source.lastPulseWorldMinute ?? source.last_pulse_world_minute))
            : -1,
        lastPulseRelationSignature: text(source.lastPulseRelationSignature ?? source.last_pulse_relation_signature, 160),
    };
}

export function acceptedSocialPersonIds(social, people = []) {
    return new Set(normalizeSocialState(social, people).connections
        .filter(item => item.status === 'accepted')
        .map(item => item.personId));
}

function relationEvidenceFor(person, userPerson, state, userName = '', recentNarrative = '') {
    const personId = text(person?.id, 120);
    const personName = text(person?.name, 120);
    const userId = text(userPerson?.id, 120);
    const playerName = text(userName || userPerson?.name, 120);
    const relationWords = /同事|同僚|上司|下属|主管|经理|员工|助理|秘书|搭档|队友|朋友|好友|同学|室友|家人|亲属|恋人|伴侣|夫妻|师生|导师|学生|客户|经纪人|合作伙伴/;
    const workWords = /上班|工作|值班|办公|公司|单位|部门|岗位|工位|店里|学校|医院|片场|剧组|项目|会议|出勤/;
    const personProfile = [
        person?.identityAnchor,
        person?.backgroundProfile,
        person?.worldbookRaw,
        person?.trace,
        person?.action,
        person?.intent,
        person?.location,
    ].map(value => text(value, 2200)).join('\n');
    const userProfile = [
        userPerson?.identityAnchor,
        userPerson?.backgroundProfile,
        userPerson?.worldbookRaw,
        userPerson?.trace,
        userPerson?.action,
        userPerson?.intent,
        userPerson?.location,
    ].map(value => text(value, 2200)).join('\n');
    const profileNamesRelation = relationWords.test(personProfile)
        && (playerName && personProfile.includes(playerName));
    const reverseProfileRelation = relationWords.test(userProfile)
        && personName && userProfile.includes(personName);
    if (profileNamesRelation || reverseProfileRelation) {
        return { status: 'accepted', evidence: '人物设定中存在明确的现实关系或联系方式' };
    }

    const narrative = text(recentNarrative, 18000);
    const completedContact = /(?:交换|互换|互留|留下|留了|给了|记下|存下|保存|添加|互加|加上|通过了?)(?:彼此|双方|对方|了|上|好|一下|一下子|的)?(?:联系方式|微信|qq|QQ|号码|手机号|电话|通讯号|联系人|好友)|(?:扫码|扫了码|扫二维码|扫描二维码|加了微信|加上微信|加了QQ|加上QQ|互加好友|互加微信|互加QQ|通讯录里(?:有|多了))/u;
    const notCompleted = /(?:还没|没有|没能|未能|尚未|并未|拒绝|婉拒|暂不|以后再|改天再|等.+再|如果.+(?:再|才)?|想(?:要)?|打算|准备|试图|询问|请求).{0,24}(?:交换|添加|互加|联系方式|微信|qq|QQ|号码|电话|好友)/u;
    if (personName && narrative.includes(personName)) {
        const segments = narrative
            .replace(/([。！？!?；;])/gu, '$1\n')
            .split(/\n+/u)
            .map(segment => segment.trim())
            .filter(Boolean);
        const personIndexes = segments
            .map((segment, index) => segment.includes(personName) ? index : -1)
            .filter(index => index >= 0);
        const contactIndexes = segments
            .map((segment, index) => completedContact.test(segment) && !notCompleted.test(segment) ? index : -1)
            .filter(index => index >= 0);
        const nearbyCompleted = contactIndexes.some(contactIndex => (
            personIndexes.some(personIndex => Math.abs(personIndex - contactIndex) <= 1)
        ));
        if (nearbyCompleted) {
            return { status: 'accepted', evidence: '正文已明确写成双方完成了联系方式交换' };
        }
    }

    const relationRecords = [
        ...(Array.isArray(state?.storyMemory?.facts) ? state.storyMemory.facts : []),
        ...(Array.isArray(state?.storyMemory?.summaries) ? state.storyMemory.summaries : []),
    ];
    for (const record of relationRecords.slice(-160)) {
        const recordText = JSON.stringify(record);
        const hasPerson = recordText.includes(personId) || (personName && recordText.includes(personName));
        const hasUser = (userId && recordText.includes(userId)) || (playerName && recordText.includes(playerName));
        if (hasPerson && hasUser && relationWords.test(recordText)) {
            return { status: 'accepted', evidence: '长期事实中记录了双方的现实关系' };
        }
    }

    const userAtWork = workWords.test(userProfile);
    let sharedEvent = false;
    for (const event of (Array.isArray(state?.events) ? state.events : []).slice(-80)) {
        const eventText = JSON.stringify(event);
        const hasPerson = eventText.includes(personId) || (personName && eventText.includes(personName));
        const hasUser = (userId && eventText.includes(userId)) || (playerName && eventText.includes(playerName));
        if (!hasPerson || !hasUser) continue;
        sharedEvent = true;
        if (workWords.test(eventText) && (userAtWork || relationWords.test(personProfile + eventText))) {
            return { status: 'accepted', evidence: '双方在已发生的工作关系中有通讯基础' };
        }
    }

    if (userAtWork && workWords.test(personProfile)) {
        const workMarkerPattern = /[\p{L}\p{N}·]{2,24}(?:公司|集团|部门|科室|单位|学校|学院|医院|诊所|剧组|片场|项目组|工作室|事务所|门店)/gu;
        const userMarkers = new Set(userProfile.match(workMarkerPattern) || []);
        const sharedMarker = (personProfile.match(workMarkerPattern) || []).find(marker => userMarkers.has(marker));
        if (sharedMarker) return { status: 'accepted', evidence: `双方同属已确认的工作通讯范围：${sharedMarker}` };
    }
    if (sharedEvent) return { status: 'suggested', evidence: '双方曾共同出现在已发生事件中' };
    return null;
}

export function reconcileSocialRelationships(social, state, { userName = '', recentNarrative = '' } = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const userPerson = people.find(person => person?.isUser) || null;
    const byPerson = new Map(normalized.connections.map(item => [item.personId, item]));
    for (const person of people.filter(item => !item?.isUser)) {
        const inference = relationEvidenceFor(person, userPerson, state, userName, recentNarrative);
        if (!inference) continue;
        const existing = byPerson.get(String(person.id || ''));
        if (existing?.status === 'accepted') continue;
        if (
            ['pending', 'declined', 'incoming', 'removed'].includes(existing?.status)
            && !inference.evidence.startsWith('正文已明确')
        ) continue;
        const next = normalizedConnection({
            ...existing,
            personId: person.id,
            status: inference.status,
            source: 'world-relation',
            evidence: inference.evidence,
        }, new Set(people.map(item => String(item?.id || ''))));
        if (next) byPerson.set(next.personId, next);
    }
    normalized.connections = [...byPerson.values()].slice(-MAX_CONNECTIONS);
    return normalized;
}

export function searchSocialPeople(social, state, query) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const needle = text(query, 80).toLocaleLowerCase();
    if (needle.length < 2) return [];
    const byPerson = new Map(normalized.connections.map(item => [item.personId, item]));
    return people
        .filter(person => !person?.isUser)
        .filter(person => {
            const haystack = `${text(person.name, 120)}\n${text(person.identityAnchor, 220)}`.toLocaleLowerCase();
            return haystack.includes(needle);
        })
        .slice(0, 12)
        .map(person => ({
            person,
            connection: byPerson.get(String(person.id || '')) || null,
        }));
}

export function buildFriendRequestPrompt(social, state, personId, {
    userName = '你',
    requestMessage = '',
} = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const person = people.find(item => String(item?.id || '') === text(personId, 120) && !item?.isUser);
    if (!person) throw new Error('没有找到这个人物');
    const existing = normalized.connections.find(item => item.personId === String(person.id));
    if (existing?.status === 'accepted') throw new Error('你们已经是通讯好友');
    if (existing?.status === 'pending') throw new Error('好友申请还在等待处理');
    if (existing?.status === 'incoming') throw new Error('对方已经向你发来了好友申请');
    const profile = {
        id: person.id,
        name: person.name,
        identity_anchor: text(person.identityAnchor, 500),
        personality_anchor: text(person.personalityAnchor, 600),
        background_profile: text(person.backgroundProfile, 900),
        behavior_boundaries: text(person.behaviorBoundaries, 500),
        location: text(person.location, 180),
        action: text(person.action, 260),
        intent: text(person.intent, 260),
        emotional_state: text(person.emotionalState, 220),
        knowledge: personKnowledge(person, state),
    };
    return [
        '你正在判断一个具体人物是否接受通讯好友申请。不得迎合用户，也不得为了推进功能强行同意。',
        '玲七是替当前使用者转交申请的小猫管家，只负责传递，不提供新事实，也不替这个人物答应。',
        '只站在该人物自己的认知、关系、处境、风险与行为边界上判断。她不认识申请人、正在防备、身份不便或没有理由时，可以拒绝或暂不处理。',
        'decision 只能是 accepted、declined、pending。pending 表示暂不处理，不等于同意。reason 是人物视角下的简短原因，reply 是对申请人可见的一句话；人物可以不写 reply。',
        '严格返回 JSON：{"decision":"accepted|declined|pending","reason":"内部判定依据","reply":"可见回复"}',
        `申请人：${text(userName, 120) || '你'}。验证消息：${text(requestMessage, 300) || '（没有填写）'}`,
        `已有关系证据：${text(existing?.evidence, 360) || '没有明确记录'}`,
        `人物资料：${JSON.stringify(profile)}`,
    ].join('\n');
}

export function applyFriendDecisionPayload(social, state, personId, payload, {
    requestMessage = '',
} = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const id = text(personId, 120);
    if (!people.some(person => String(person?.id || '') === id && !person?.isUser)) throw new Error('没有找到这个人物');
    const decision = ['accepted', 'declined', 'pending'].includes(payload?.decision)
        ? payload.decision
        : 'pending';
    const now = new Date().toISOString();
    const next = normalizedConnection({
        personId: id,
        status: decision,
        source: 'friend-request',
        evidence: '用户通过通讯搜索发起申请',
        requestMessage,
        decisionReason: text(payload?.reason, 360),
        decisionReply: text(payload?.reply, 300),
        requestedAt: now,
        respondedAt: decision === 'pending' ? '' : now,
        updatedAt: now,
    }, new Set(people.map(person => String(person?.id || ''))));
    normalized.connections = normalized.connections.filter(item => item.personId !== id);
    normalized.connections.unshift(next);
    return {
        social: normalized,
        decision,
        reply: next.decisionReply,
        reason: next.decisionReason,
    };
}

export function buildMomentsPrompt(social, state, { userName = '你' } = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const accepted = new Set(normalized.connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const profiles = people
        .filter(person => accepted.has(String(person?.id || '')) && !person?.isUser)
        .slice(0, 24)
        .map(person => ({
            id: person.id,
            name: person.name,
            personality_anchor: text(person.personalityAnchor, 500),
            speaking_style: text(person.speakingStyle, 320),
            behavior_boundaries: text(person.behaviorBoundaries, 420),
            location: text(person.location, 160),
            action: text(person.action, 240),
            intent: text(person.intent, 240),
            emotional_state: text(person.emotionalState, 180),
            knowledge: personKnowledge(person, state),
            last_post: normalized.moments.filter(moment => moment.personId === String(person.id)).at(-1)?.text || '',
        }));
    if (!profiles.length) throw new Error('还没有能查看朋友圈的通讯好友');
    return [
        '你正在生成“世界背面·朋友圈”的自然动态候选。这是人物主动发布的社交内容，不是旁白，也不是正式世界事实。',
        '玲七只是替当前使用者收取这些公开给好友的生活片段，不会因此知道人物没有发布的私事。',
        '逐人判断她此刻有没有发朋友圈的动机。忙碌、谨慎、没有内容、身份敏感或不爱发动态时必须不发；允许这次零条。最多三条，禁止人人轮流营业。',
        '只能使用人物自己的 knowledge、当前位置、行动与情绪；不得泄露秘密、后台全局信息或她不可能拍到的画面。',
        '文字要像生活中的本人，不要写总结报告。wants_image 只有当她确实会配图且当前能拍到/拥有该图时才为 true。image_prompt 只描述她会发布的画面，不含人物不知道的内容。',
        'visibility 目前只能是 friends。严格返回 JSON：{"posts":[{"person_id":"...","text":"...","visibility":"friends","wants_image":true,"image_prompt":"..."}]}',
        `查看者：${text(userName, 120) || '你'}。世界分钟：${Math.max(0, Number(state?.clock?.absoluteMinute) || 0)}。`,
        `好友资料：${JSON.stringify(profiles)}`,
    ].join('\n');
}

export function applyMomentsPayload(social, state, payload) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const accepted = new Set(normalized.connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const recentKeys = new Set(normalized.moments.slice(-60).map(item => `${item.personId}\n${item.text}`));
    const worldMinute = Math.max(0, Number(state?.clock?.absoluteMinute) || 0);
    const posts = (Array.isArray(payload?.posts) ? payload.posts : [])
        .map(item => normalizedMoment({
            id: makeId('moment'),
            personId: item?.person_id ?? item?.personId,
            text: item?.text,
            visibility: item?.visibility,
            worldMinute,
            wantsImage: item?.wants_image ?? item?.wantsImage,
            imagePrompt: item?.image_prompt ?? item?.imagePrompt,
        }, new Set(people.map(person => String(person?.id || '')))))
        .filter(item => item && accepted.has(item.personId))
        .filter(item => !recentKeys.has(`${item.personId}\n${item.text}`))
        .slice(0, 3);
    normalized.moments.push(...posts);
    normalized.moments = normalized.moments.slice(-MAX_MOMENTS);
    normalized.momentsUpdatedAt = new Date().toISOString();
    normalized.momentsUpdatedWorldMinute = worldMinute;
    return { social: normalized, posts };
}

export function attachMomentImage(social, state, momentId, { imageUrl = '', error = '' } = {}) {
    const normalized = normalizeSocialState(social, state?.people || []);
    const moment = normalized.moments.find(item => item.id === text(momentId, 160));
    if (!moment) return normalized;
    const candidate = text(imageUrl, MAX_IMAGE_URL_CHARS);
    moment.imageUrl = /^(?:https?:\/\/|data:image\/)/i.test(candidate) ? candidate : '';
    moment.imageError = text(error, 360);
    return normalized;
}

export function toggleMomentLike(social, state, momentId) {
    const normalized = normalizeSocialState(social, state?.people || []);
    const moment = normalized.moments.find(item => item.id === text(momentId, 160));
    if (!moment) return normalized;
    moment.likedByUser = !moment.likedByUser;
    moment.likes = Math.max(0, moment.likes + (moment.likedByUser ? 1 : -1));
    return normalized;
}

export function respondIncomingFriendRequest(social, state, personId, accept) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const id = text(personId, 120);
    const connection = normalized.connections.find(item => item.personId === id);
    if (!connection || connection.status !== 'incoming') throw new Error('这条好友申请已经不存在');
    connection.status = accept ? 'accepted' : 'declined';
    connection.source = 'incoming-request';
    connection.respondedAt = new Date().toISOString();
    connection.updatedAt = connection.respondedAt;
    connection.decisionReply = accept ? '你已接受对方的好友申请' : '你已拒绝对方的好友申请';
    const readAt = new Date().toISOString();
    normalized.notices.forEach(notice => {
        if (notice.kind === 'friend_request' && notice.personId === id && !notice.readAt) notice.readAt = readAt;
    });
    return normalized;
}

export function removeSocialFriend(social, state, personId, {
    source = 'user-removed',
    reason = '用户主动删除好友',
} = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const id = text(personId, 120);
    const connection = normalized.connections.find(item => item.personId === id);
    if (!connection || connection.status !== 'accepted') throw new Error('对方已经不在好友列表里');
    const now = new Date().toISOString();
    connection.status = 'removed';
    connection.source = text(source, 60) || 'user-removed';
    connection.decisionReason = text(reason, 360) || '用户主动删除好友';
    connection.decisionReply = '';
    connection.respondedAt = now;
    connection.updatedAt = now;
    const direct = normalized.conversations.find(item => item.type === 'direct' && item.memberIds[0] === id);
    if (direct && normalized.activeConversationId === direct.id) normalized.activeConversationId = '';
    return normalized;
}

export function markSocialNoticeRead(social, state, noticeId = '') {
    const normalized = normalizeSocialState(social, state?.people || []);
    const id = text(noticeId, 160);
    const now = new Date().toISOString();
    normalized.notices.forEach(notice => {
        if ((!id || notice.id === id) && !notice.readAt) notice.readAt = now;
    });
    return normalized;
}

export function buildSocialPulsePrompt(social, state, { userName = '你' } = {}) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const normalized = normalizeSocialState(social, people);
    const byId = new Map(people.map(person => [String(person?.id || ''), person]));
    const candidates = normalized.connections
        .filter(item => ['accepted', 'suggested'].includes(item.status))
        .map(connection => ({ connection, person: byId.get(connection.personId) }))
        .filter(item => item.person && !item.person.isUser)
        .slice(0, 24)
        .map(({ connection, person }) => ({
            id: person.id,
            name: person.name,
            relation_status: connection.status,
            relation_evidence: connection.evidence,
            personality_anchor: text(person.personalityAnchor, 500),
            speaking_style: text(person.speakingStyle, 320),
            behavior_boundaries: text(person.behaviorBoundaries, 420),
            location: text(person.location, 160),
            action: text(person.action, 240),
            intent: text(person.intent, 240),
            emotional_state: text(person.emotionalState, 180),
            knowledge: personKnowledge(person, state),
            recent_messages: normalized.conversations
                .find(conversation => conversation.type === 'direct' && conversation.memberIds[0] === String(person.id))
                ?.rawMessages.slice(-6).map(message => ({ sender: message.senderId, text: message.text })) || [],
        }));
    if (!candidates.length) return '';
    return [
        '你正在执行一次低频“生活社交脉冲”。人物不是客服，不得为了活跃界面强行行动。允许所有数组为空。总动作最多两项。',
        '玲七是替当前使用者守消息、递话的小猫管家，不是全知广播站；她的传递不能替人物补足未知信息。',
        'accepted 好友只有在当前处境中存在具体联系动机时才可主动发 message；不得复读上一条，也不得凭空知道新事实。',
        'suggested 人物只有关系证据足以让她拥有联系方式发现渠道、且她本人愿意时，才可主动发 friend_request。陌生人不能凭空搜到用户。',
        'accepted 好友也可以 remove_friend，但必须有符合人设的明确边界、关系恶化、风险或现实原因；禁止为了戏剧性随机删好友。',
        'accepted 好友可以发 post，但必须像真实朋友圈，遵守她自己的知识与隐私；忙碌、谨慎或没内容就不发。',
        '严格返回 JSON：{"messages":[{"person_id":"...","text":"...","reason":"..."}],"friend_requests":[{"person_id":"...","message":"...","reason":"..."}],"remove_friends":[{"person_id":"...","reason":"...","farewell":"可选的告别文字"}],"posts":[{"person_id":"...","text":"...","visibility":"friends","wants_image":false,"image_prompt":""}]}',
        `用户：${text(userName, 120) || '你'}。世界分钟：${Math.max(0, Number(state?.clock?.absoluteMinute) || 0)}。`,
        `候选人物：${JSON.stringify(candidates)}`,
    ].join('\n');
}

export function applySocialPulsePayload(social, state, payload) {
    const people = Array.isArray(state?.people) ? state.people : [];
    let normalized = normalizeSocialState(social, people);
    const peopleById = new Map(people.map(person => [String(person?.id || ''), person]));
    const connectionsById = new Map(normalized.connections.map(item => [item.personId, item]));
    const worldMinute = Math.max(0, Number(state?.clock?.absoluteMinute) || 0);
    let remaining = 2;
    let messageCount = 0;
    let requestCount = 0;
    let removalCount = 0;

    for (const raw of (Array.isArray(payload?.messages) ? payload.messages : [])) {
        if (remaining <= 0) break;
        const personId = text(raw?.person_id ?? raw?.personId, 120);
        const body = text(raw?.text, 1600);
        const person = peopleById.get(personId);
        if (!person || !body || connectionsById.get(personId)?.status !== 'accepted') continue;
        let conversation = normalized.conversations.find(item => item.type === 'direct' && item.memberIds[0] === personId);
        if (!conversation) {
            conversation = normalizedConversation({
                id: `direct-${personId}`,
                type: 'direct',
                title: person.name,
                memberIds: [personId],
            });
            normalized.conversations.unshift(conversation);
        }
        const last = conversation.rawMessages.at(-1);
        if (last?.senderId === personId && last?.text === body) continue;
        conversation.rawMessages.push(normalizedMessage({
            senderId: personId,
            senderName: person.name,
            text: body,
            worldMinute,
        }));
        conversation.rawMessages = conversation.rawMessages.slice(-MAX_MESSAGES);
        conversation.updatedAt = new Date().toISOString();
        normalized.notices.push(normalizedNotice({
            kind: 'message',
            personId,
            conversationId: conversation.id,
            text: body,
        }, new Set(peopleById.keys())));
        messageCount += 1;
        remaining -= 1;
    }

    for (const raw of (Array.isArray(payload?.friend_requests) ? payload.friend_requests : [])) {
        if (remaining <= 0) break;
        const personId = text(raw?.person_id ?? raw?.personId, 120);
        const connection = connectionsById.get(personId);
        if (!connection || connection.status !== 'suggested' || !peopleById.has(personId)) continue;
        connection.status = 'incoming';
        connection.source = 'proactive-request';
        connection.requestMessage = text(raw?.message, 300);
        connection.decisionReason = text(raw?.reason, 360);
        connection.requestedAt = new Date().toISOString();
        connection.updatedAt = connection.requestedAt;
        normalized.notices.push(normalizedNotice({
            kind: 'friend_request',
            personId,
            text: connection.requestMessage || `${peopleById.get(personId)?.name || '一位人物'}想添加你为好友`,
        }, new Set(peopleById.keys())));
        requestCount += 1;
        remaining -= 1;
    }

    for (const raw of (Array.isArray(payload?.remove_friends) ? payload.remove_friends : [])) {
        if (remaining <= 0) break;
        const personId = text(raw?.person_id ?? raw?.personId, 120);
        const connection = connectionsById.get(personId);
        if (!connection || connection.status !== 'accepted' || !peopleById.has(personId)) continue;
        connection.status = 'removed';
        connection.source = 'character-boundary';
        connection.decisionReason = text(raw?.reason, 360);
        connection.decisionReply = text(raw?.farewell, 300);
        connection.respondedAt = new Date().toISOString();
        connection.updatedAt = connection.respondedAt;
        const direct = normalized.conversations.find(item => item.type === 'direct' && item.memberIds[0] === personId);
        if (direct && normalized.activeConversationId === direct.id) normalized.activeConversationId = '';
        normalized.notices.push(normalizedNotice({
            kind: 'friend_removed',
            personId,
            text: connection.decisionReply || connection.decisionReason || '对方结束了好友关系',
        }, new Set(peopleById.keys())));
        removalCount += 1;
        remaining -= 1;
    }

    let momentCount = 0;
    if (remaining > 0 && Array.isArray(payload?.posts) && payload.posts.length) {
        const applied = applyMomentsPayload(normalized, state, { posts: payload.posts.slice(0, remaining) });
        normalized = applied.social;
        momentCount = applied.posts.length;
    }
    normalized.notices = normalized.notices.filter(Boolean).slice(-MAX_NOTICES);
    return { social: normalized, messageCount, requestCount, removalCount, momentCount };
}

export function openDirectConversation(social, person, people = []) {
    const normalized = normalizeSocialState(social, people);
    const personId = text(person?.id, 120);
    if (!personId || person?.isUser) throw new Error('这个人物不能加入社交会话');
    if (!normalized.connections.some(item => item.personId === personId && item.status === 'accepted')) {
        throw new Error('对方还不是你的通讯好友');
    }
    let conversation = normalized.conversations.find(item => (
        item.type === 'direct' && item.memberIds[0] === personId
    ));
    if (!conversation) {
        conversation = normalizedConversation({
            id: `direct-${personId}`,
            type: 'direct',
            title: text(person.name, 120) || '未知人物',
            memberIds: [personId],
        });
        normalized.conversations.unshift(conversation);
    } else {
        conversation.title = text(person.name, 120) || conversation.title;
    }
    normalized.activeConversationId = conversation.id;
    return normalized;
}

export function createGroupConversation(social, { title = '', memberIds = [] } = {}, people = []) {
    const normalized = normalizeSocialState(social, people);
    const peopleById = new Map((Array.isArray(people) ? people : []).map(person => [String(person?.id || ''), person]));
    const accepted = new Set(normalized.connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const members = [...new Set(memberIds.map(id => text(id, 120)))]
        .filter(id => id && accepted.has(id) && peopleById.has(id) && !peopleById.get(id)?.isUser)
        .slice(0, 24);
    if (members.length < 2) throw new Error('建群至少选择两个人物');
    const fallbackTitle = members.slice(0, 3).map(id => peopleById.get(id)?.name).filter(Boolean).join('、');
    const conversation = normalizedConversation({
        id: makeId('group'),
        type: 'group',
        title: text(title, 120) || fallbackTitle || '新群聊',
        memberIds: members,
    });
    normalized.conversations.unshift(conversation);
    normalized.activeConversationId = conversation.id;
    return normalized;
}

export function selectSocialConversation(social, conversationId, people = []) {
    const normalized = normalizeSocialState(social, people);
    const id = text(conversationId, 160);
    const accepted = new Set(normalized.connections.filter(item => item.status === 'accepted').map(item => item.personId));
    const conversation = normalized.conversations.find(item => item.id === id);
    const available = conversation && (
        conversation.type === 'group'
        || accepted.has(conversation.memberIds[0])
    );
    if (available) normalized.activeConversationId = id;
    return normalized;
}

export function appendUserSocialMessage(social, conversationId, body, worldMinute = 0, people = []) {
    const normalized = normalizeSocialState(social, people);
    const conversation = normalized.conversations.find(item => item.id === text(conversationId, 160));
    const content = text(body, 1600);
    if (!conversation) throw new Error('没有找到这个会话');
    if (!content) throw new Error('请先输入要发送的内容');
    if (conversation.type === 'direct') {
        const connection = normalized.connections.find(item => item.personId === conversation.memberIds[0]);
        if (connection?.status !== 'accepted') throw new Error('你们已经不是通讯好友，不能继续私聊');
    }
    conversation.rawMessages.push(normalizedMessage({
        id: makeId('social-message'),
        senderId: 'user',
        senderName: '你',
        text: content,
        worldMinute,
    }));
    conversation.rawMessages = conversation.rawMessages.slice(-MAX_MESSAGES);
    conversation.lastError = '';
    conversation.updatedAt = new Date().toISOString();
    normalized.activeConversationId = conversation.id;
    return normalized;
}

function personKnowledge(person, state) {
    const knownEventIds = new Set(Array.isArray(person?.knownEventIds) ? person.knownEventIds.map(String) : []);
    const knownClueIds = new Set(Array.isArray(person?.knownClueIds) ? person.knownClueIds.map(String) : []);
    return {
        events: (Array.isArray(state?.events) ? state.events : [])
            .filter(event => knownEventIds.has(String(event?.id || '')))
            .slice(-12)
            .map(event => ({
                id: event.id,
                title: text(event.title, 160),
                description: text(event.description, 500),
                state: text(event.state, 80),
            })),
        clues: (Array.isArray(state?.storyMemory?.clues) ? state.storyMemory.clues : [])
            .filter(clue => knownClueIds.has(String(clue?.id || '')))
            .slice(-12)
            .map(clue => ({ id: clue.id, text: text(clue.text ?? clue.value, 420) })),
        beliefs: (Array.isArray(person?.knownFactBeliefs) ? person.knownFactBeliefs : []).slice(-16),
    };
}

export function buildSocialReplyPrompt(social, state, conversationId, { userName = '你' } = {}) {
    const normalized = normalizeSocialState(social, state?.people || []);
    const conversation = normalized.conversations.find(item => item.id === text(conversationId, 160));
    if (!conversation) throw new Error('没有找到要生成回复的会话');
    const peopleById = new Map((state?.people || []).map(person => [String(person?.id || ''), person]));
    const members = conversation.memberIds.map(id => peopleById.get(id)).filter(Boolean);
    const participantProfiles = members.map(person => ({
        id: person.id,
        name: person.name,
        identity_anchor: text(person.identityAnchor, 500),
        personality_anchor: text(person.personalityAnchor, 600),
        background_profile: text(person.backgroundProfile, 900),
        speaking_style: text(person.speakingStyle, 360),
        behavior_boundaries: text(person.behaviorBoundaries, 500),
        location: text(person.location, 180),
        action: text(person.action, 260),
        intent: text(person.intent, 260),
        emotional_state: text(person.emotionalState, 220),
        knowledge: personKnowledge(person, state),
    }));
    const history = conversation.rawMessages.slice(-24).map(message => ({
        sender_id: message.senderId,
        sender_name: message.senderId === 'user' ? text(userName, 120) || '你' : message.senderName,
        text: message.text,
        world_minute: message.worldMinute,
    }));
    return [
        '你正在执行“世界背面·内置社交”回复路由。这是一个独立社交记录层，不是正文，也不会自动成为正式世界事实。',
        '玲七只负责把当前使用者的话送到、再把对方愿意说的话带回来；她不替人物回答，也不会把后台知识塞给人物。',
        '必须严格执行：',
        '1. 只有会话成员可以回复；不得新增路人、旁白或系统广播。',
        '2. 对每个成员依次判断 saw（是否看到这条消息）、knows（是否有足够知识回答）、willing（是否愿意回）。任一为 false 就保持沉默。',
        '3. 允许零人回复；群聊不得为了齐整让每人轮流说话，最多三人回复。私聊最多一人回复。',
        '4. 只能使用该人物自己的 knowledge 与会话历史。没在其 knowledge 里的世界事实，不得因为你看到了其他人资料就让她知道。',
        '5. 回复必须延续具体人物的人格、用词、节奏和边界；不要把性格标签翻译成通用文风。',
        '6. 不得宣称聊天已改变世界现实；承诺、决定、见面等只是会话内容，除非之后由正式世界流程结算。',
        '严格返回 JSON，不要 Markdown：',
        '{"routing":[{"person_id":"...","saw":true,"knows":true,"willing":true,"outcome":"speak|silent","reason":"简短原因"}],"replies":[{"person_id":"...","text":"人物发出的文字"}]}',
        `会话类型：${conversation.type === 'group' ? '群聊' : '私聊'}。世界分钟：${Math.max(0, Number(state?.clock?.absoluteMinute) || 0)}。`,
        `成员资料：${JSON.stringify(participantProfiles)}`,
        `会话原始记录：${JSON.stringify(history)}`,
    ].join('\n');
}

export function applySocialReplyPayload(social, conversationId, payload, state) {
    const normalized = normalizeSocialState(social, state?.people || []);
    const conversation = normalized.conversations.find(item => item.id === text(conversationId, 160));
    if (!conversation) throw new Error('没有找到这个会话');
    const peopleById = new Map((state?.people || []).map(person => [String(person?.id || ''), person]));
    const allowed = new Set(conversation.memberIds);
    const routing = (Array.isArray(payload?.routing) ? payload.routing : [])
        .map(item => ({
            personId: text(item?.person_id ?? item?.personId, 120),
            saw: Boolean(item?.saw),
            knows: Boolean(item?.knows),
            willing: Boolean(item?.willing),
            outcome: item?.outcome === 'speak' ? 'speak' : 'silent',
            reason: text(item?.reason, 220),
        }))
        .filter(item => allowed.has(item.personId));
    const routingById = new Map(routing.map(item => [item.personId, item]));
    const replyLimit = conversation.type === 'group' ? 3 : 1;
    const seenReplyIds = new Set();
    const replies = (Array.isArray(payload?.replies) ? payload.replies : [])
        .map(item => ({ personId: text(item?.person_id ?? item?.personId, 120), text: text(item?.text, 1600) }))
        .filter(item => {
            const route = routingById.get(item.personId);
            if (!item.text || !allowed.has(item.personId) || seenReplyIds.has(item.personId)) return false;
            if (!route || !route.saw || !route.knows || !route.willing || route.outcome !== 'speak') return false;
            seenReplyIds.add(item.personId);
            return true;
        })
        .slice(0, replyLimit);
    const worldMinute = Math.max(0, Number(state?.clock?.absoluteMinute) || 0);
    for (const reply of replies) {
        const person = peopleById.get(reply.personId);
        if (!person) continue;
        conversation.rawMessages.push(normalizedMessage({
            id: makeId('social-message'),
            senderId: reply.personId,
            senderName: person.name,
            text: reply.text,
            worldMinute,
        }));
    }
    conversation.rawMessages = conversation.rawMessages.slice(-MAX_MESSAGES);
    conversation.lastRouting = { at: new Date().toISOString(), evaluations: routing };
    conversation.lastError = '';
    conversation.updatedAt = new Date().toISOString();
    normalized.activeConversationId = conversation.id;
    return { social: normalized, replyCount: replies.length };
}

export function setSocialConversationError(social, conversationId, error, people = []) {
    const normalized = normalizeSocialState(social, people);
    const conversation = normalized.conversations.find(item => item.id === text(conversationId, 160));
    if (conversation) conversation.lastError = text(error?.message || error, 500);
    return normalized;
}
