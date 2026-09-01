const DEFAULT_MAX_CHARS = 22000;

function asMessages(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({
            id: Number.isFinite(Number(message?.id)) ? Number(message.id) : index,
            swipe: Number.isFinite(Number(message?.swipe)) ? Number(message.swipe) : 0,
            role: message?.role === 'user' ? 'user' : 'assistant',
            content: String(message?.content || '').trim(),
        }))
        .filter(message => message.content)
        .sort((a, b) => a.id - b.id);
}

function sourceMessageId(item = {}) {
    const values = [
        item.source_message_id,
        item.sourceMessageId,
        item.message_id,
        item.messageId,
        item.end_message_id,
        item.endMessageId,
        item.start_message_id,
        item.startMessageId,
    ];
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return Number.MAX_SAFE_INTEGER;
}

function stableText(value = '') {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function artifactKey(kind, item = {}) {
    const source = sourceMessageId(item);
    if (kind === 'turn_summaries') return `${source}`;
    if (kind === 'facts_upsert') {
        return `${source}|${stableText(item.key)}|${stableText(item.subject)}|${stableText(item.predicate)}|${stableText(item.value)}`;
    }
    if (kind === 'clue_fragments') {
        return `${source}|${stableText(item.id || item.title)}|${stableText(item.text)}`;
    }
    if (kind === 'event_fragments') {
        return `${source}|${stableText(item.event_key || item.eventKey || item.title)}|${stableText(item.phase || item.status)}|${stableText(item.evidence)}`;
    }
    if (kind === 'person_observations') {
        return `${source}|${stableText(item.person_key || item.personKey || item.name)}|${stableText(item.location)}|${stableText(item.action)}`;
    }
    return `${source}|${stableText(JSON.stringify(item))}`;
}

export function planHistoryArchaeologyWindows(messages = [], {
    assistantTurnsPerWindow = 4,
    overlapAssistantTurns = 1,
    maximumCharacters = DEFAULT_MAX_CHARS,
} = {}) {
    const source = asMessages(messages);
    const targetAssistantTurns = Math.max(1, Number.parseInt(assistantTurnsPerWindow, 10) || 4);
    const overlapTurns = Math.max(0, Math.min(
        targetAssistantTurns - 1,
        Number.parseInt(overlapAssistantTurns, 10) || 0,
    ));
    const maxChars = Math.max(2000, Number.parseInt(maximumCharacters, 10) || DEFAULT_MAX_CHARS);
    const windows = [];
    let start = 0;

    while (start < source.length) {
        let end = start;
        let assistantTurns = 0;
        let characters = 0;
        while (end < source.length) {
            const message = source[end];
            const nextCharacters = characters + message.content.length;
            const nextAssistantTurns = assistantTurns + (message.role === 'assistant' ? 1 : 0);
            if (
                end > start
                && (nextCharacters > maxChars || nextAssistantTurns > targetAssistantTurns)
            ) break;
            characters = nextCharacters;
            assistantTurns = nextAssistantTurns;
            end += 1;
            if (assistantTurns >= targetAssistantTurns) break;
        }
        if (end <= start) end = start + 1;

        const slice = source.slice(start, end);
        windows.push({
            index: windows.length,
            id: `history-window-${windows.length}`,
            startMessageId: slice[0]?.id ?? 0,
            endMessageId: slice.at(-1)?.id ?? slice[0]?.id ?? 0,
            assistantTurns: slice.filter(message => message.role === 'assistant').length,
            characters: slice.reduce((sum, message) => sum + message.content.length, 0),
            messages: slice,
        });
        if (end >= source.length) break;

        if (!overlapTurns) {
            start = end;
            continue;
        }

        let overlapStart = end;
        let seenAssistants = 0;
        for (let index = end - 1; index >= start; index -= 1) {
            if (source[index].role === 'assistant') seenAssistants += 1;
            if (seenAssistants >= overlapTurns) {
                overlapStart = index;
                if (index > start && source[index - 1]?.role === 'user') overlapStart = index - 1;
                break;
            }
        }
        start = Math.max(start + 1, overlapStart);
    }

    return windows;
}

export function buildHistoryArchaeologyPrompt(window, {
    userName = '',
    playerIdentityAnchor = '',
    recordPlayerCharacter = true,
} = {}) {
    const messages = asMessages(window?.messages || []);
    const source = messages.map(message => (
        `<message id="${message.id}" swipe="${message.swipe}" role="${message.role}">${message.content}</message>`
    )).join('\n');
    const assistantIds = messages.filter(message => message.role === 'assistant').map(message => message.id);

    return [
        '你是“世界背面”的历史考古提取器。这里只做证据提取，不建立当前世界，不推演未来，也不根据上一批结果猜测。',
        '你的输出会与其他历史窗口并行生成，随后由代码按 source_message_id 排序并串行重建，因此每个条目都必须能独立追溯到本窗口原文。',
        '规则：',
        '1. 只提取正文明确支持的内容。传闻、角色误解、猜测必须保持其性质，不能升级成客观事实。',
        '2. 每条 assistant 正文都必须有一条 turn_summaries；source_message_id 必须准确。',
        '3. facts_upsert 只放耐久事实候选，并尽量使用稳定语义 key。后文若改变同一事实，仍沿用同一 key，让串行重建阶段处理覆盖/争议。',
        '4. event_fragments 只是事件证据片段。event_key 应描述同一条现实事件的稳定语义身份；phase 只能写 observed/start/progress/end/cancel/miss/plan。不要生成数据库事件 id，也不要声称最终 current 状态。',
        '5. person_observations 记录“在该 source_message_id 时正文明确表现的人物状态切片”，不是人物最终状态。',
        '6. clue_fragments 记录伏笔/承诺/待办/未解信息的证据片段。resolved 只能在本窗口原文明示回收时为 true。',
        '7. 所有 evidence/source_excerpt 必须复制本窗口原文的短句；没有原文证据就不要输出。',
        '8. 不输出 memory_digest、world current state、people_remove、events_update、clock advance。时间轴由后续串行阶段处理。',
        '9. 只输出合法 JSON，不要 Markdown。',
        recordPlayerCharacter
            ? '10. 可以记录玩家已经明确发生的客观行动/状态，但不得补玩家内心。'
            : '10. 不建立玩家人物状态；玩家客观行动仍可作为事件/事实证据。',
        `玩家名：${String(userName || '未提供').slice(0, 80)}`,
        playerIdentityAnchor ? `玩家身份锚点：${String(playerIdentityAnchor).slice(0, 400)}` : '玩家身份锚点：未提供',
        `本窗口必须覆盖的 assistant 消息 id：${assistantIds.join(', ') || '无'}`,
        `窗口范围：${window?.startMessageId ?? messages[0]?.id ?? 0}—${window?.endMessageId ?? messages.at(-1)?.id ?? 0}`,
        '正文：',
        source || '（空）',
        '返回结构：',
        JSON.stringify({
            turn_summaries: [{
                source_message_id: 0,
                title: '',
                summary: '',
                people: [],
                locations: [],
                tags: [],
            }],
            facts_upsert: [{
                key: '',
                subject: '',
                predicate: '',
                value: '',
                status: 'active | disputed',
                visibility: 'hidden | trace | known | direct',
                source_message_id: 0,
                source_excerpt: '',
                people: [],
                locations: [],
                tags: [],
            }],
            event_fragments: [{
                event_key: '',
                title: '',
                phase: 'observed | start | progress | end | cancel | miss | plan',
                place: '',
                actors: [],
                evidence: '',
                publicity: 'private | trace | public',
                source_message_id: 0,
            }],
            person_observations: [{
                person_key: '',
                name: '',
                location: '',
                action: '',
                intent: '',
                physical_state: '',
                emotional_state: '',
                resource_state: '',
                evidence: '',
                source_message_id: 0,
            }],
            clue_fragments: [{
                id: '',
                title: '',
                text: '',
                resolved: false,
                resolution: '',
                evidence: '',
                people: [],
                locations: [],
                tags: [],
                source_message_id: 0,
            }],
        }),
    ].join('\n');
}

function mergedAbortSignal(externalSignal, internalController) {
    if (!externalSignal) return internalController.signal;
    if (externalSignal.aborted) internalController.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', () => internalController.abort(externalSignal.reason), { once: true });
    return internalController.signal;
}

export async function runHistoryArchaeologyPool(windows = [], {
    extract,
    concurrency = 2,
    signal = null,
    onProgress = null,
} = {}) {
    if (typeof extract !== 'function') throw new TypeError('extract must be a function');
    const tasks = Array.isArray(windows) ? windows.slice() : [];
    if (!tasks.length) return { results: [], elapsedMs: 0, maxActive: 0, completed: 0 };

    const limit = Math.max(1, Math.min(4, Number.parseInt(concurrency, 10) || 1));
    const internalController = new AbortController();
    const poolSignal = mergedAbortSignal(signal, internalController);
    const results = new Array(tasks.length);
    const startedAt = Date.now();
    let nextIndex = 0;
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    let firstError = null;

    const worker = async slot => {
        while (!poolSignal.aborted && !firstError) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= tasks.length) return;
            const window = tasks[index];
            active += 1;
            maxActive = Math.max(maxActive, active);
            onProgress?.({ phase: 'start', slot, index, window, active, completed, total: tasks.length });
            try {
                const payload = await extract(window, { slot, index, signal: poolSignal });
                if (poolSignal.aborted) return;
                results[index] = { window, payload };
                completed += 1;
                onProgress?.({ phase: 'complete', slot, index, window, active, completed, total: tasks.length });
            } catch (error) {
                if (!firstError) firstError = error;
                internalController.abort(error);
                return;
            } finally {
                active = Math.max(0, active - 1);
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, (_, slot) => worker(slot)));

    if (signal?.aborted || poolSignal.aborted) {
        if (firstError) throw firstError;
        const error = signal?.reason instanceof Error ? signal.reason : new Error('历史并行实验已停止');
        if (!error.name || error.name === 'Error') error.name = 'AbortError';
        throw error;
    }
    if (firstError) throw firstError;
    if (results.some(result => !result)) throw new Error('历史并行实验有窗口未返回结果');

    return {
        results,
        elapsedMs: Date.now() - startedAt,
        maxActive,
        completed,
    };
}

export function mergeChronologicalHistoryArtifacts(results = []) {
    const ordered = (Array.isArray(results) ? results : [])
        .filter(result => result?.payload)
        .slice()
        .sort((a, b) => (
            Number(a.window?.startMessageId ?? 0) - Number(b.window?.startMessageId ?? 0)
            || Number(a.window?.index ?? 0) - Number(b.window?.index ?? 0)
        ));
    const fields = ['turn_summaries', 'facts_upsert', 'event_fragments', 'person_observations', 'clue_fragments'];
    const merged = Object.fromEntries(fields.map(field => [field, []]));
    const seen = Object.fromEntries(fields.map(field => [field, new Set()]));

    for (const result of ordered) {
        for (const field of fields) {
            const values = Array.isArray(result.payload?.[field]) ? result.payload[field] : [];
            for (const value of values) {
                if (!value || typeof value !== 'object') continue;
                const key = artifactKey(field, value);
                if (seen[field].has(key)) continue;
                seen[field].add(key);
                merged[field].push({ ...value });
            }
        }
    }

    for (const field of fields) {
        merged[field].sort((a, b) => sourceMessageId(a) - sourceMessageId(b));
    }
    return merged;
}
