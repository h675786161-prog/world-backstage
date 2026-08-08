function normalizeSearchText(value = '') {
    return String(value || '')
        .toLocaleLowerCase()
        .replace(/[“”‘’「」『』【】《》〈〉（）()\[\]{}]/gu, '')
        .replace(/[，。！？!?、；;：:\s…—_-]+/gu, '')
        .trim();
}

export function cleanLingqiChatAnchor(value = '') {
    return String(value || '')
        .trim()
        .replace(/^[“”‘’「」『』\s]+|[“”‘’「」『』\s]+$/gu, '')
        .replace(/^(?:我)?(?:(?:跟|和)你)?(?:说过|说|问过|问|提过|提到|聊过|聊|讲过|讲)(?:你)?(?:的)?/u, '')
        .replace(/(?:那(?:句|段|次|里|时候)|这里|那里|的时候|开始|为止)$/u, '')
        .trim();
}

function messageMatches(message, query = '') {
    const haystack = normalizeSearchText(message?.text || '');
    const needle = normalizeSearchText(cleanLingqiChatAnchor(query));
    if (!haystack || !needle) return false;
    if (haystack.includes(needle) || (needle.length >= 6 && needle.includes(haystack))) return true;
    const chunks = String(cleanLingqiChatAnchor(query) || '')
        .split(/[，。！？!?、；;：:\s]+/u)
        .map(part => normalizeSearchText(part))
        .filter(part => part.length >= 2);
    if (!chunks.length) return false;
    const matched = chunks.filter(part => haystack.includes(part));
    return matched.length >= Math.min(2, chunks.length) && matched.join('').length >= Math.min(6, needle.length);
}

export function findLingqiChatMatches(messagesValue = [], query = '', maximum = 8) {
    const messages = Array.isArray(messagesValue) ? messagesValue : [];
    const limit = Math.min(20, Math.max(1, Number.parseInt(maximum, 10) || 8));
    const matches = messages
        .map((message, index) => messageMatches(message, query) ? { message, index } : null)
        .filter(Boolean);
    return matches.slice(-limit).map(({ message, index }) => ({
        id: String(message?.id || ''),
        index,
        role: message?.role === 'user' ? 'user' : 'assistant',
        text: String(message?.text || '').trim(),
        at: String(message?.at || ''),
    }));
}

function preview(message) {
    const role = message?.role === 'user' ? '你' : '玲七';
    const text = String(message?.text || '').replace(/\s+/gu, ' ').trim();
    return `${role}：${text.length > 76 ? `${text.slice(0, 76)}…` : text}`;
}

function localDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function lingqiChatSnapshotSignature(messages = []) {
    let hash = 2166136261;
    for (const message of Array.isArray(messages) ? messages : []) {
        const value = `${message?.id || ''}\u001f${message?.role || ''}\u001f${message?.at || ''}\u001f${message?.text || ''}\u001e`;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    }
    return `${Array.isArray(messages) ? messages.length : 0}:${(hash >>> 0).toString(36)}`;
}

export function resolveLingqiChatDeletionPlan(messagesValue = [], action = {}, totalMessageCount = null) {
    const messages = Array.isArray(messagesValue) ? messagesValue : [];
    const mode = String(action.mode || '').trim().toLowerCase();
    if (!messages.length) {
        return { ok: false, message: '这里已经没有更早的玲七聊天可以删啦～' };
    }

    let startIndex = 0;
    let endIndex = messages.length - 1;
    const deleteAll = mode === 'all';
    const singleMatches = query => messages
        .map((message, index) => messageMatches(message, query) ? index : -1)
        .filter(index => index >= 0);

    if (mode === 'recent') {
        const count = Math.min(messages.length, Math.max(1, Number.parseInt(action.count, 10) || 1));
        startIndex = Math.max(0, messages.length - count);
    } else if (mode === 'between') {
        const starts = singleMatches(action.startQuery);
        const ends = singleMatches(action.endQuery);
        if (!starts.length || !ends.length) {
            return {
                ok: false,
                message: `我没把${!starts.length ? '开头' : '结尾'}认准……换一句更接近当时原话的描述给我。`,
            };
        }
        if (starts.length > 1 || ends.length > 1) {
            return { ok: false, message: '开头或结尾在记录里出现过不止一次，我怕抓错段。把那句话再说完整一点～' };
        }
        if (ends[0] < starts[0]) {
            return { ok: false, message: '我找到的结尾跑到开头前面去了……这段范围再说具体一点。' };
        }
        startIndex = starts[0];
        endIndex = ends[0];
    } else if (mode === 'before' || mode === 'after') {
        const matches = singleMatches(action.query);
        if (!matches.length) return { ok: false, message: '我没在聊天里找到你说的那个位置……再给我一点原话。' };
        if (matches.length > 1) return { ok: false, message: '这个位置出现过不止一次，我怕删错。再给我一句更完整的原话～' };
        if (mode === 'before') {
            endIndex = Math.max(0, matches[0] - 1);
            if (matches[0] === 0) return { ok: false, message: '它已经是最早一条啦，前面没有聊天可删。' };
        } else {
            startIndex = Math.min(messages.length - 1, matches[0] + 1);
            if (matches[0] === messages.length - 1) return { ok: false, message: '它已经是最新的旧记录啦，后面没有更新的聊天可删。' };
        }
    } else if (mode === 'day') {
        const offset = action.day === 'yesterday' ? -1 : action.day === 'day_before_yesterday' ? -2 : 0;
        const target = new Date();
        target.setDate(target.getDate() + offset);
        const key = localDayKey(target);
        const indices = messages
            .map((message, index) => localDayKey(message.at) === key ? index : -1)
            .filter(index => index >= 0);
        if (!indices.length) return { ok: false, message: '那一天这里没有玲七聊天记录。' };
        startIndex = indices[0];
        endIndex = indices.at(-1);
    } else if (mode === 'topic') {
        const matches = singleMatches(action.query);
        if (!matches.length) return { ok: false, message: '我翻了翻，没找到你说的那段聊天……换个更具体的关键词？' };
        const groups = [];
        for (const index of matches) {
            const last = groups.at(-1);
            if (!last || index - last.at(-1) > 6) groups.push([index]);
            else last.push(index);
        }
        if (groups.length > 1) {
            return { ok: false, message: `我找到 ${groups.length} 段都像你说的内容……怕抓错。再加一个当时说过的词给我。` };
        }
        startIndex = groups[0][0];
        endIndex = groups[0].at(-1);
        if (messages[startIndex]?.role === 'assistant' && startIndex > 0 && messages[startIndex - 1]?.role === 'user') startIndex -= 1;
        if (messages[endIndex]?.role === 'user' && endIndex < messages.length - 1 && messages[endIndex + 1]?.role === 'assistant') endIndex += 1;
    } else if (mode !== 'all') {
        return { ok: false, message: '这个删除范围我没听明白……说“全部”“最近几条”或者“从哪句到哪句”都可以。' };
    }

    const selected = messages.slice(startIndex, endIndex + 1);
    if (!selected.length) return { ok: false, message: '这个范围里没有可以删除的聊天。' };
    return {
        ok: true,
        action: {
            ...action,
            resolvedMessageIds: selected.map(message => message.id),
            deleteAll,
            resolvedCount: deleteAll
                ? Math.max(selected.length, Number(totalMessageCount) || 0)
                : selected.length,
        },
        title: deleteAll ? '清空玲七的聊天记录？' : `删除这 ${selected.length} 条聊天？`,
        detail: deleteAll
            ? '会清空当前聊天里玲七和你的全部聊天记录。玲七的长期记忆、世界状态和小纸条都不会一起删。'
            : '只删下面这段玲七聊天。玲七的长期记忆、世界状态和小纸条都不会一起删。',
        confirmLabel: deleteAll ? '全部删掉' : '删掉这段',
        previewLines: [
            `起：${preview(selected[0])}`,
            selected.length > 1 ? `止：${preview(selected.at(-1))}` : '',
        ].filter(Boolean),
        caution: '删除聊天记录 ≠ 删除长期记忆',
    };
}

export function parseLingqiLocalChatDeleteRequest(userText = '') {
    const raw = String(userText || '').trim();
    if (!/(?:聊天记录|聊天)/u.test(raw) || !/(?:删掉|删除|清掉|清除|清空)/u.test(raw)) return null;

    if (
        /(?:清空)(?:一下|掉)?(?:我们|我和你|和玲七|玲七)?(?:的)?(?:全部|所有)?(?:聊天记录|聊天)/u.test(raw)
        || /(?:删掉|删除|清掉|清除)(?:一下)?(?:我们|我和你|和玲七|玲七)?(?:的)?(?:全部|所有)(?:的)?(?:聊天记录|聊天)/u.test(raw)
        || /(?:把)?(?:我们|我和你|和玲七|玲七)?(?:的)?(?:全部|所有)(?:的)?(?:聊天记录|聊天)(?:都)?(?:删掉|删除|清掉|清除)/u.test(raw)
        || /^(?:玲七[，,]?\s*)?(?:帮我)?\s*(?:删掉|删除|清掉|清除)\s*(?:聊天记录|聊天)\s*[吧。！!]*$/u.test(raw)
    ) return { type: 'delete_lingqi_chat', mode: 'all' };

    const recent = raw.match(/(?:最近|刚才(?:的)?)\s*(\d{1,3})\s*(条|轮)(?:玲七)?(?:聊天记录|聊天)?/u);
    if (recent) {
        const count = Math.min(800, Math.max(1, Number.parseInt(recent[1], 10) || 1) * (recent[2] === '轮' ? 2 : 1));
        return { type: 'delete_lingqi_chat', mode: 'recent', count };
    }

    const dayMap = [
        { re: /前天(?:的)?(?:玲七)?(?:聊天记录|聊天)/u, day: 'day_before_yesterday' },
        { re: /昨天(?:的)?(?:玲七)?(?:聊天记录|聊天)/u, day: 'yesterday' },
        { re: /今天(?:的)?(?:玲七)?(?:聊天记录|聊天)/u, day: 'today' },
    ];
    for (const item of dayMap) {
        if (item.re.test(raw)) return { type: 'delete_lingqi_chat', mode: 'day', day: item.day };
    }

    let between = raw.match(/^(?:玲七[，,]?\s*)?(?:帮我)?\s*(?:把)?\s*从\s*(.{1,160}?)\s*(?:到|至)\s*(.{1,160}?)(?:之间|这一段|这段)?(?:的)?(?:聊天记录|聊天)?\s*(?:都)?(?:删掉|删除|清掉|清除)\s*[吧。！!]*$/u);
    if (!between) {
        between = raw.match(/^(?:玲七[，,]?\s*)?(?:帮我)?\s*(?:删掉|删除|清掉|清除)\s*(?:从\s*)?(.{1,160}?)\s*(?:到|至)\s*(.{1,160}?)(?:之间|这一段|这段)?(?:的)?(?:聊天记录|聊天)?\s*[吧。！!]*$/u);
    }
    if (between) {
        return {
            type: 'delete_lingqi_chat',
            mode: 'between',
            startQuery: cleanLingqiChatAnchor(between[1]),
            endQuery: cleanLingqiChatAnchor(between[2]),
        };
    }

    const sided = raw.match(/^(?:玲七[，,]?\s*)?(?:帮我)?\s*(?:把)?\s*(.{1,180}?)\s*(之前|以前|之后|以后)(?:的)?(?:聊天记录|聊天)\s*(?:都)?(?:删掉|删除|清掉|清除)\s*[吧。！!]*$/u)
        || raw.match(/^(?:玲七[，,]?\s*)?(?:帮我)?\s*(?:删掉|删除|清掉|清除)\s*(.{1,180}?)\s*(之前|以前|之后|以后)(?:的)?(?:聊天记录|聊天)\s*[吧。！!]*$/u);
    if (sided) {
        return {
            type: 'delete_lingqi_chat',
            mode: /之前|以前/u.test(sided[2]) ? 'before' : 'after',
            query: cleanLingqiChatAnchor(sided[1]),
        };
    }

    const topic = raw.match(/(?:把)?(?:我们|我和你|和玲七)?(?:之前|刚才|那次)?(?:聊过|聊|说过|说|讨论过|讨论)(?:的|过)?\s*([^，。！？!]{2,80}?)(?:那一段|那段|这段)(?:的)?(?:聊天记录|聊天)?(?:都)?(?:删掉|删除|清掉|清除)/u)
        || raw.match(/(?:删掉|删除|清掉|清除)(?:我们|我和你|和玲七)?(?:之前|刚才|那次)?(?:聊过|聊|说过|讨论过)(?:的|过)?\s*([^，。！？!]{2,80}?)(?:那一段|那段|这段)(?:的)?(?:聊天记录|聊天)?/u);
    if (topic) return { type: 'delete_lingqi_chat', mode: 'topic', query: cleanLingqiChatAnchor(topic[1]) };

    return null;
}
