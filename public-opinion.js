const PUBLIC_VISIBILITY = new Set(['known', 'direct']);
const VALID_CONFIDENCE = new Set(['high', 'medium']);
const VALID_CLAIM_STATUS = new Set(['fact', 'mixed', 'rumor']);
const VALID_SOURCE_TYPE = new Set(['official', 'unofficial']);

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asText(value, maximum = 600) {
    return String(value ?? '').trim().slice(0, maximum);
}

function clampInteger(value, fallback = 1, minimum = 0, maximum = 9) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, numeric));
}

function uniqueStrings(value, maximum = 6) {
    return [...new Set(asArray(value)
        .map(item => asText(item, 60))
        .filter(Boolean))]
        .slice(0, maximum);
}

function uniqueBy(items, keyFor) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFor(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeSourceType(value, fallback = 'unofficial') {
    const normalized = asText(value, 20).toLowerCase();
    return VALID_SOURCE_TYPE.has(normalized) ? normalized : fallback;
}

export function emptyPublicOpinionCache({
    generatedAt = '',
    sourceRevision = -1,
    sourceWorldMinute = -1,
} = {}) {
    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        news: [],
        forums: [],
    };
}

export function eligiblePublicOpinionEvents(state) {
    return asArray(state?.events)
        .filter(event => PUBLIC_VISIBILITY.has(String(event?.visibility || '')))
        .filter(event => String(event?.title || '').trim())
        .sort((a, b) => Number(b?.updatedAt || b?.resolvedAt || 0) - Number(a?.updatedAt || a?.resolvedAt || 0))
        .slice(0, 24)
        .map(event => ({
            id: asText(event.id, 120),
            title: asText(event.title, 140),
            place: asText(event.place, 140),
            summary: asText(event.summary, 420),
            result: asText(event.result || event.consequence || event.expectedResult, 520),
            status: asText(event.status, 30),
            visibility: asText(event.visibility, 20),
        }));
}

export function buildPublicOpinionPrompt(state, { clockLabel = '' } = {}) {
    const events = eligiblePublicOpinionEvents(state);
    const context = {
        world_name: asText(state?.world?.name || '主世界', 80),
        world_time: asText(clockLabel, 100),
        public_event_candidates: events,
    };

    return [
        '你是“世界背面”的世界舆情观察器。你只生成只读的新闻与论坛快照，不修改世界状态、人物认知、事件、记忆、时间或正文。不会写回人物认知，也不会触发新的世界变化。',
        '只能依据下方 public_event_candidates。不得使用任何未提供的幕后事实，不得把隐藏事件、私人行动或角色秘密写成公开消息。',
        '不是每个事件都值得成为新闻或热帖。私人小事、影响范围很小的事件可以完全不生成舆情。宁可安静，也不要为了热闹硬造内容。',
        '新闻与论坛是“传播载体”，source_type 才表示消息来源层级：official = 官方/机构/权威渠道，unofficial = 目击、匿名爆料、民间媒体、论坛、小道消息。官方消息也可能措辞保守、选择性披露；非官方消息也可能碰巧为真。来源层级不等于世界真相。',
        '新闻偏事实传播：只报道有公共传播价值的内容；无法确认的原因不要擅自下结论。论坛偏群众反应：允许猜测、误解、玩梗和传闻，但必须通过 claim_status 明确区分 fact / mixed / rumor，且不得把传闻写回成事实。',
        '每条消息给出 audience_tags：只写“哪些类型的人可能更关注这条消息”，例如当地居民、行业从业者、某组织成员、记者、学生等。它只是受众标签，不代表任何具体 NPC 已经看到或相信该消息，也不需要读取完整世界书。',
        'scope 用一句很短的话概括传播范围，例如“本地居民圈”“行业内部”“全城公开”“小范围匿名流传”。',
        'related_event_id 必须来自 public_event_candidates 中已有的 id。不得虚构新的事件 ID。',
        '最多生成 3 条新闻、4 个论坛主题；每个论坛主题最多 4 条代表回复。没有合适内容时对应数组返回空。官方/非官方不需要凑齐，按世界实际情况生成。',
        '只输出 JSON，不要 Markdown，不要代码块，不要解释。',
        JSON.stringify({
            output_schema: {
                news: [{
                    category: '城市 / 社会 / 商业 / 公告 / 其他',
                    headline: '标题',
                    summary: '简短报道，1-3句',
                    source: '媒体、机构、组织或公开信息来源名称，可为泛称',
                    source_type: 'official | unofficial',
                    audience_tags: ['可能关注的人群，1-5个'],
                    scope: '传播范围，短句',
                    related_event_id: '必须来自输入',
                    confidence: 'high | medium',
                    heat: '1-3',
                }],
                forums: [{
                    board: '版块名称',
                    title: '帖子标题',
                    summary: '楼主或主题摘要',
                    source_type: 'official | unofficial（论坛通常为 unofficial，官方账号发布时可为 official）',
                    audience_tags: ['可能关注的人群，1-5个'],
                    scope: '传播范围，短句',
                    related_event_id: '必须来自输入',
                    claim_status: 'fact | mixed | rumor',
                    heat: '1-5',
                    replies: [{ author: '匿名昵称', text: '代表回复' }],
                }],
            },
            context,
        }, null, 2),
    ].join('\n\n');
}

export function normalizePublicOpinionPayload(payload, {
    validEventIds = [],
    sourceRevision = -1,
    sourceWorldMinute = -1,
    generatedAt = new Date().toISOString(),
} = {}) {
    const allowedIds = new Set(asArray(validEventIds).map(item => String(item || '')).filter(Boolean));
    const news = uniqueBy(
        asArray(payload?.news).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            const headline = asText(item?.headline ?? item?.title, 160);
            const summary = asText(item?.summary, 700);
            if (!headline || !summary) return null;
            const confidenceRaw = asText(item?.confidence, 20).toLowerCase();
            return {
                id: `news_${index}_${relatedEventId}`,
                category: asText(item?.category, 40) || '世界新闻',
                headline,
                summary,
                source: asText(item?.source, 100) || '公开信息',
                sourceType: normalizeSourceType(item?.source_type ?? item?.sourceType, 'official'),
                audienceTags: uniqueStrings(item?.audience_tags ?? item?.audienceTags, 5),
                scope: asText(item?.scope, 80),
                relatedEventId,
                confidence: VALID_CONFIDENCE.has(confidenceRaw) ? confidenceRaw : 'medium',
                heat: clampInteger(item?.heat, 1, 1, 3),
            };
        }).filter(Boolean).slice(0, 3),
        item => `${item.relatedEventId}\u0000${item.headline}`,
    );

    const forums = uniqueBy(
        asArray(payload?.forums).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            const title = asText(item?.title, 180);
            const summary = asText(item?.summary, 700);
            if (!title || !summary) return null;
            const claimRaw = asText(item?.claim_status ?? item?.claimStatus, 20).toLowerCase();
            const replies = asArray(item?.replies).map((reply, replyIndex) => {
                const text = asText(reply?.text ?? reply?.content, 360);
                if (!text) return null;
                return {
                    id: `reply_${index}_${replyIndex}`,
                    author: asText(reply?.author ?? reply?.name, 60) || `匿名${replyIndex + 1}`,
                    text,
                };
            }).filter(Boolean).slice(0, 4);
            return {
                id: `forum_${index}_${relatedEventId}`,
                board: asText(item?.board, 60) || '闲聊',
                title,
                summary,
                sourceType: normalizeSourceType(item?.source_type ?? item?.sourceType, 'unofficial'),
                audienceTags: uniqueStrings(item?.audience_tags ?? item?.audienceTags, 5),
                scope: asText(item?.scope, 80),
                relatedEventId,
                claimStatus: VALID_CLAIM_STATUS.has(claimRaw) ? claimRaw : 'mixed',
                heat: clampInteger(item?.heat, 1, 1, 5),
                replies,
            };
        }).filter(Boolean).slice(0, 4),
        item => `${item.relatedEventId}\u0000${item.title}`,
    );

    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        news,
        forums,
    };
}

export function normalizePublicOpinionCache(raw) {
    const sourceRevision = clampInteger(raw?.sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER);
    const sourceWorldMinute = clampInteger(raw?.sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER);
    const validEventIds = [
        ...asArray(raw?.news).map(item => item?.relatedEventId),
        ...asArray(raw?.forums).map(item => item?.relatedEventId),
    ].filter(Boolean);
    return normalizePublicOpinionPayload(raw, {
        validEventIds,
        sourceRevision,
        sourceWorldMinute,
        generatedAt: raw?.generatedAt || '',
    });
}
