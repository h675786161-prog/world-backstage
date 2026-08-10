const WB_PUBLIC_SIGNAL_BIAS = 0x2d;

const NEWS_PUBLICITY = new Set(['public']);
const OPINION_PUBLICITY = new Set(['trace', 'public']);
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
    sourceEventSignature = '',
} = {}) {
    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceEventSignature: asText(sourceEventSignature, 240),
        forumSourceSignature: asText(sourceEventSignature, 240),
        newsSourceSignature: '',
        lastForumWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        lastNewsWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        news: [],
        forums: [],
    };
}

export function eligiblePublicOpinionEvents(state) {
    return asArray(state?.events)
        .filter(event => OPINION_PUBLICITY.has(String(event?.publicity || 'private')))
        .filter(event => String(event?.id || '').trim())
        .sort((a, b) => Number(b?.updatedAt || b?.resolvedAt || 0) - Number(a?.updatedAt || a?.resolvedAt || 0))
        .slice(0, 24)
        .map(event => {
            const publicity = asText(event.publicity || 'private', 20);
            const publicHint = asText(event.publicTrace ?? event.public_trace, 360);
            if (publicity === 'trace') {
                const place = asText(event.place, 140);
                return {
                    id: asText(event.id, 120),
                    title: '未证实的公开迹象',
                    place,
                    summary: '',
                    result: '',
                    status: asText(event.status, 30),
                    publicity,
                    visibility: asText(event.visibility, 20),
                    public_hint: publicHint || `${place ? `${place}附近` : '某处'}出现了尚未证实、但已经能被外界察觉的迹象。`,
                    public_headline: '',
                    public_summary: '',
                    public_result: '',
                    created_at: Number(event?.createdAt ?? -1),
                    updated_at: Number(event?.updatedAt ?? -1),
                    resolved_at: Number(event?.resolvedAt ?? -1),
                    clock_mode: asText(event?.clockMode, 30),
                    due_at: Number(event?.dueAt ?? -1),
                };
            }
            return {
                id: asText(event.id, 120),
                title: asText(event.title, 140),
                place: asText(event.place, 140),
                summary: '',
                result: '',
                status: asText(event.status, 30),
                publicity,
                visibility: asText(event.visibility, 20),
                public_hint: publicHint,
                public_headline: asText(event.publicHeadline ?? event.public_headline, 180),
                public_summary: asText(event.publicSummary ?? event.public_summary, 520),
                public_result: asText(event.publicResult ?? event.public_result, 520),
                created_at: Number(event?.createdAt ?? -1),
                updated_at: Number(event?.updatedAt ?? -1),
                resolved_at: Number(event?.resolvedAt ?? -1),
                clock_mode: asText(event?.clockMode, 30),
                due_at: Number(event?.dueAt ?? -1),
            };
        });
}

function publicSignalHash(value) {
    const text = String(value || '');
    let hash = (0x811c9dc5 ^ WB_PUBLIC_SIGNAL_BIAS) >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

// 只把“社会真正能看到的公开面”计入舆情来源签名。这里故意不复用
// eligiblePublicOpinionEvents：后者会按幕后 updatedAt 排序并截前 24 条，事件一多时
// 仅仅内部更新时间变化就可能把第 24/25 条换位，制造假的“公开来源变化”。
function publicOpinionSurfaceDescriptor(state, { newsOnly = false } = {}) {
    return asArray(state?.events)
        .filter(event => OPINION_PUBLICITY.has(String(event?.publicity || 'private')))
        .filter(event => String(event?.id || '').trim())
        .map(event => {
            const publicity = asText(event.publicity || 'private', 20);
            const place = asText(event.place, 140);
            const publicHint = asText(event.publicTrace ?? event.public_trace, 360);
            if (publicity === 'trace') {
                return {
                    id: asText(event.id, 120),
                    publicity: 'trace',
                    place,
                    public_hint: publicHint || `${place ? `${place}附近` : '某处'}出现了尚未证实、但已经能被外界察觉的迹象。`,
                };
            }
            return {
                id: asText(event.id, 120),
                publicity: 'public',
                place,
                public_hint: publicHint,
                public_headline: asText(event.publicHeadline ?? event.public_headline, 180),
                public_summary: asText(event.publicSummary ?? event.public_summary, 520),
                public_result: asText(event.publicResult ?? event.public_result, 520),
            };
        })
        .filter(event => !newsOnly || event.publicity === 'public')
        .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
}

export function publicOpinionSourceSignature(state) {
    return publicSignalHash(JSON.stringify(publicOpinionSurfaceDescriptor(state)));
}

export function publicOpinionNewsSourceSignature(state) {
    return publicSignalHash(JSON.stringify(publicOpinionSurfaceDescriptor(state, { newsOnly: true })));
}

export function planPublicOpinionRefresh(state, rawCache = {}, {
    force = false,
    forumIntervalMinutes = 180,
    newsIntervalMinutes = 360,
} = {}) {
    const candidates = eligiblePublicOpinionEvents(state);
    const cache = normalizePublicOpinionCache(rawCache || {});
    const worldMinute = Number(state?.clock?.absoluteMinute ?? -1);
    const sourceEventSignature = publicOpinionSourceSignature(state);
    const newsSourceSignature = publicOpinionNewsSourceSignature(state);
    const previousForumSignature = String(cache.forumSourceSignature || cache.sourceEventSignature || '');
    const previousNewsSignature = String(cache.newsSourceSignature || '');
    const forumSourceChanged = Boolean(candidates.length && sourceEventSignature !== previousForumSignature);
    const hasPublic = candidates.some(event => event.publicity === 'public');
    const hasTrace = candidates.some(event => event.publicity === 'trace');
    const newsSourceChanged = Boolean(hasPublic && newsSourceSignature !== previousNewsSignature);
    const sourceChanged = forumSourceChanged || newsSourceChanged;
    const fallbackMinute = Number(cache.sourceWorldMinute ?? -1);
    const lastForumWorldMinute = Number(cache.lastForumWorldMinute ?? fallbackMinute);
    const lastNewsWorldMinute = Number(cache.lastNewsWorldMinute ?? fallbackMinute);
    const forumElapsed = worldMinute >= 0 && lastForumWorldMinute >= 0
        ? Math.max(0, worldMinute - lastForumWorldMinute)
        : Number.POSITIVE_INFINITY;
    const newsElapsed = worldMinute >= 0 && lastNewsWorldMinute >= 0
        ? Math.max(0, worldMinute - lastNewsWorldMinute)
        : Number.POSITIVE_INFINITY;
    const forumDueByTime = Boolean(candidates.length && worldMinute >= 0 && forumElapsed >= Math.max(1, Number(forumIntervalMinutes) || 180));
    const newsDueByTime = Boolean(hasPublic && worldMinute >= 0 && newsElapsed >= Math.max(1, Number(newsIntervalMinutes) || 360));

    const allowForums = Boolean(candidates.length && (
        force
        || forumSourceChanged
        || forumDueByTime
    ));
    const allowNews = Boolean(hasPublic && (
        force
        || newsSourceChanged
        || newsDueByTime
    ));
    const due = Boolean(candidates.length && (allowForums || allowNews));

    let reason = 'idle';
    if (force && candidates.length) reason = 'manual-force';
    else if (sourceChanged) reason = 'public-source-changed';
    else if (newsDueByTime && forumDueByTime) reason = 'time-evolution-news-and-forums';
    else if (newsDueByTime) reason = 'time-evolution-news';
    else if (forumDueByTime) reason = 'time-evolution-forums';
    else if (!candidates.length) reason = 'no-public-candidates';

    return {
        due,
        reason,
        sourceChanged,
        forumSourceChanged,
        newsSourceChanged,
        sourceEventSignature,
        forumSourceSignature: sourceEventSignature,
        newsSourceSignature,
        worldMinute,
        candidates,
        hasPublic,
        hasTrace,
        allowForums,
        allowNews,
        forumElapsed,
        newsElapsed,
        nextForumAt: worldMinute >= 0
            ? Math.max(worldMinute, (lastForumWorldMinute >= 0 ? lastForumWorldMinute : worldMinute) + Math.max(1, Number(forumIntervalMinutes) || 180))
            : -1,
        nextNewsAt: worldMinute >= 0 && hasPublic
            ? Math.max(worldMinute, (lastNewsWorldMinute >= 0 ? lastNewsWorldMinute : worldMinute) + Math.max(1, Number(newsIntervalMinutes) || 360))
            : -1,
    };
}

function publicEventSourceType(event) {
    const text = [
        event?.public_hint,
        event?.public_headline,
        event?.public_summary,
        event?.public_result,
        event?.summary,
        event?.result,
    ].filter(Boolean).join(' ');
    return /公告|通报|官方|政府|机构|委员会|公司发布|声明|通知|公示|新闻发布|气象部门|交通部门|警方|消防|医院|学校|主办方|品牌方|供电|铁路|机场/i.test(text)
        ? 'official'
        : 'unofficial';
}

function publicEventTemporalState(event, worldMinute = 0) {
    const status = String(event?.status || '');
    if (['resolved', 'cancelled', 'missed'].includes(status)) return 'historical';
    const now = Number(worldMinute || 0);
    const dueAt = Number(event?.due_at);
    if (status === 'waiting') return 'upcoming';
    if (event?.clock_mode === 'scheduled' && Number.isFinite(dueAt) && dueAt > now) return 'upcoming';
    return 'current';
}

export function worldNewsFromPublicEvents(state, { maximum = 12 } = {}) {
    const worldMinute = Number(state?.clock?.absoluteMinute ?? -1);
    return eligiblePublicOpinionEvents(state)
        .filter(event => NEWS_PUBLICITY.has(String(event?.publicity || '')))
        .slice(0, Math.max(1, Number(maximum) || 12))
        .map(event => {
            const temporalState = publicEventTemporalState(event, worldMinute);
            const publicHint = asText(event.public_hint, 360);
            const terminalResult = temporalState === 'historical'
                ? asText(event.public_result, 520)
                : '';
            const publicSummary = terminalResult
                || asText(event.public_summary, 520)
                || publicHint;
            if (!publicSummary) return null;

            const fallbackHeadline = publicSummary
                .split(/[。！？!?\n]/u)
                .map(part => part.trim())
                .find(Boolean)
                ?.slice(0, 46) || '公开世界动态';
            const headline = asText(event.public_headline, 160) || fallbackHeadline;
            const sourceType = publicEventSourceType(event);
            const eventMinute = [
                Number(event?.updated_at),
                Number(event?.resolved_at),
                Number(event?.created_at),
            ].find(value => Number.isFinite(value) && value >= 0);

            return {
                id: `world_news_${event.id}`,
                category: '世界新闻',
                headline,
                summary: publicSummary,
                source: sourceType === 'official' ? '公开机构信息' : '公开世界信息',
                sourceType,
                audienceTags: [],
                scope: asText(event.place, 80) || '公开传播',
                relatedEventId: asText(event.id, 120),
                confidence: 'high',
                heat: 1,
                worldSynced: true,
                eventStatus: asText(event.status, 30),
                temporalState,
                worldMinute: clampInteger(
                    eventMinute,
                    worldMinute,
                    -1,
                    Number.MAX_SAFE_INTEGER,
                ),
            };
        })
        .filter(Boolean);
}

export function mergeWorldNewsIntoPublicOpinion(state, rawCache = {}) {
    const cache = normalizePublicOpinionCache(rawCache || {});
    const synced = worldNewsFromPublicEvents(state, { maximum: 18 });
    const existingByEvent = new Map(
        cache.news
            .filter(item => item.relatedEventId)
            .map(item => [String(item.relatedEventId), item]),
    );
    const currentIds = new Set();
    const currentNews = synced.map(worldItem => {
        const existing = existingByEvent.get(worldItem.relatedEventId);
        currentIds.add(worldItem.relatedEventId);
        return {
            ...worldItem,
            ...(existing || {}),
            id: existing?.id || worldItem.id,
            relatedEventId: worldItem.relatedEventId,
            worldSynced: true,
            // 这个 helper 只补世界事件的来源/状态元数据。已经经过舆情调度器生成的
            // headline/summary 是该传播节点自己的表述，不能再被事件最初的公开摘要覆盖。
            source: existing?.source || worldItem.source,
            audienceTags: existing?.audienceTags || worldItem.audienceTags,
            scope: existing?.scope || worldItem.scope,
            eventStatus: worldItem.eventStatus,
            temporalState: worldItem.temporalState,
            publishedAt: existing?.publishedAt || worldItem.publishedAt || '',
            updatedAt: existing?.updatedAt || worldItem.updatedAt || '',
            worldMinute: Math.max(
                Number(existing?.worldMinute ?? -1),
                Number(worldItem.worldMinute ?? -1),
            ),
        };
    });

    const historicalNews = cache.news.filter(item => (
        !item.relatedEventId || !currentIds.has(String(item.relatedEventId))
    ));

    return {
        ...cache,
        news: uniqueBy(
            [...currentNews, ...historicalNews]
                .sort(compareOpinionRecency),
            item => item.relatedEventId
                ? `event:${item.relatedEventId}`
                : `${item.headline}\u0000${item.summary}`,
        ).slice(0, 18),
        forums: cache.forums.slice(0, 12),
    };
}

function opinionItemChanged(previous, next, fields) {
    if (!previous) return true;
    return fields.some(field => String(previous?.[field] ?? '') !== String(next?.[field] ?? ''));
}

function opinionWallClockValue(item) {
    const timestamp = Date.parse(item?.updatedAt || item?.publishedAt || '');
    return Number.isFinite(timestamp) ? timestamp : -1;
}

function compareOpinionRecency(a, b) {
    // 舆情新旧以主世界时间为第一排序轴；现实生成时间只在同一世界时刻内做次级排序。
    const worldDifference = Number(b?.worldMinute ?? -1) - Number(a?.worldMinute ?? -1);
    if (worldDifference) return worldDifference;
    const wallDifference = opinionWallClockValue(b) - opinionWallClockValue(a);
    if (wallDifference) return wallDifference;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
}

export function mergePublicOpinionStream(previousRaw, nextRaw, {
    maximumNews = 18,
    maximumForums = 12,
} = {}) {
    const previous = normalizePublicOpinionCache(previousRaw || {});
    const next = normalizePublicOpinionCache(nextRaw || {});
    const generatedAt = next.generatedAt || new Date().toISOString();

    const previousNewsByEvent = new Map(
        previous.news
            .filter(item => item.relatedEventId)
            .map(item => [String(item.relatedEventId), item]),
    );
    const nextNewsEventIds = new Set();
    const freshNews = next.news.map(item => {
        const previousItem = item.relatedEventId
            ? previousNewsByEvent.get(String(item.relatedEventId))
            : null;
        if (item.relatedEventId) nextNewsEventIds.add(String(item.relatedEventId));

        const changed = opinionItemChanged(previousItem, item, [
            'headline', 'summary', 'source', 'category', 'scope',
        ]);
        return {
            ...previousItem,
            ...item,
            publishedAt: previousItem?.publishedAt || item.publishedAt || generatedAt,
            updatedAt: changed
                ? (item.updatedAt || generatedAt)
                : (previousItem?.updatedAt || item.updatedAt || generatedAt),
            worldMinute: changed
                ? Number(item.worldMinute ?? next.sourceWorldMinute ?? -1)
                : Number(previousItem?.worldMinute ?? item.worldMinute ?? -1),
        };
    });

    const retainedNews = previous.news.filter(item => (
        !item.relatedEventId || !nextNewsEventIds.has(String(item.relatedEventId))
    ));

    const nextForumEventIds = new Set(
        next.forums.map(item => String(item.relatedEventId || '')).filter(Boolean),
    );
    const freshForums = next.forums.map(item => ({
        ...item,
        publishedAt: item.publishedAt || generatedAt,
        updatedAt: item.updatedAt || generatedAt,
        worldMinute: Number(item.worldMinute ?? next.sourceWorldMinute ?? -1),
    }));
    const retainedForums = previous.forums.filter(item => (
        !item.relatedEventId || !nextForumEventIds.has(String(item.relatedEventId))
    ));

    const news = uniqueBy(
        [...freshNews, ...retainedNews]
            .sort(compareOpinionRecency),
        item => item.relatedEventId
            ? `event:${item.relatedEventId}`
            : `${item.headline}\u0000${item.summary}`,
    ).slice(0, Math.max(1, Number(maximumNews) || 18));

    const forums = uniqueBy(
        [...freshForums, ...retainedForums]
            .sort(compareOpinionRecency),
        item => `${item.relatedEventId}\u0000${item.board}\u0000${item.title}`,
    ).slice(0, Math.max(1, Number(maximumForums) || 12));

    return {
        ...next,
        news,
        forums,
    };
}

export function buildPublicOpinionPrompt(state, {
    clockLabel = '',
    previousCache = null,
    elapsedMinutes = null,
    forumElapsedMinutes = elapsedMinutes,
    newsElapsedMinutes = elapsedMinutes,
    allowNews = true,
    allowForums = true,
    reason = '',
    customInstruction = '',
} = {}) {
    const events = eligiblePublicOpinionEvents(state);
    const previous = normalizePublicOpinionCache(previousCache || {});
    const wantedIds = new Set(events.map(event => String(event.id || '')));
    const compactPrevious = {
        news: previous.news
            .filter(item => wantedIds.has(String(item.relatedEventId || '')))
            .slice(0, 8)
            .map(item => ({
                headline: item.headline,
                summary: item.summary,
                source_type: item.sourceType,
                scope: item.scope,
                related_event_id: item.relatedEventId,
                heat: item.heat,
            })),
        forums: previous.forums
            .filter(item => wantedIds.has(String(item.relatedEventId || '')))
            .slice(0, 8)
            .map(item => ({
                board: item.board,
                title: item.title,
                summary: item.summary,
                claim_status: item.claimStatus,
                scope: item.scope,
                related_event_id: item.relatedEventId,
                heat: item.heat,
            })),
    };
    const context = {
        world_name: asText(state?.world?.name || '主世界', 80),
        world_time: asText(clockLabel, 100),
        elapsed_forum_world_minutes: Math.max(0, Number(forumElapsedMinutes) || 0),
        elapsed_news_world_minutes: Math.max(0, Number(newsElapsedMinutes) || 0),
        update_reason: asText(reason, 80),
        allow_news: Boolean(allowNews),
        allow_forums: Boolean(allowForums),
        user_world_focus: asText(customInstruction, 1000),
        previous_snapshot: compactPrevious,
        public_event_candidates: events,
    };

    return [
        '你是“世界背面”的世界舆情观察器。你只生成只读的新闻与论坛快照，不修改世界状态、人物认知、事件、记忆、时间或正文。不会写回人物认知，也不会触发新的世界变化。',
        '只能依据下方 public_event_candidates。不得使用任何未提供的幕后事实，不得把私人行动或角色秘密写成公开消息。',
        'publicity=trace 的候选不是“已经公开的新闻事实”，而只是外界能察觉的一点表面迹象：只允许依据 public_hint 与 place 生成非官方论坛讨论；不得使用该事件真正标题、summary/result、隐藏原因或幕后人物信息，也不得生成新闻。',
        'publicity=public 的候选才允许生成新闻，而且只能使用 public_headline / public_summary / public_hint / place 中已经公开的信息。事件内部 title、summary、result 可能包含幕后细节，禁止直接复制进新闻。',
        '不得虚构新的正史事件。你是在“到点后检查”，不是每次都必须产出变化：即使 public_event_candidates 非空，如果这段世界时间里没有自然形成新的报道或讨论变化，也可以返回空的 news / forums。',
        'previous_snapshot 是上一轮已经存在的公开舆情。论坛与新闻有各自独立的 elapsed_*_world_minutes；分别按对应经过时间判断扩散、降温、分化、反转或后续报道，不要拿新闻经过的时间去多推进论坛，反之亦然。不要因为收到一次检查请求就改写措辞制造“变化”。',
        '严格遵守 allow_news / allow_forums。为 false 的类别必须返回空数组。allow_news=true 也不代表一定要出新闻：没有新的公开事实时可以只做持续报道或什么都不写；allow_forums=true 也可以在讨论没有自然变化时返回空数组。',
        '新闻与论坛是“传播载体”，source_type 才表示消息来源层级：official = 官方/机构/权威渠道，unofficial = 目击、匿名爆料、民间媒体、论坛、小道消息。官方消息也可能措辞保守、选择性披露；非官方消息也可能碰巧为真。来源层级不等于世界真相。',
        '新闻偏事实传播：只报道有公共传播价值的内容；无法确认的原因不要擅自下结论。世界事件只提供公开事实候选，新闻不会绕过本轮时间门槛被系统强行补出来；你生成的新闻也不能改变或增加事件事实。同一 related_event_id 是同一条持续新闻线，有足够世界时间和公开进展时可以写后续报道，不要把同一事件拆成互相重复的平行新闻。论坛偏群众反应：允许猜测、误解、玩梗和传闻，但必须通过 claim_status 明确区分 fact / mixed / rumor，且不得把传闻写回成事实。',
        'user_world_focus 是用户设置的世界推演侧重点。它可以决定候选里的选题优先级与报道角度，但不是事实来源：如果候选中没有对应公开事件，不能为了迎合它虚构新闻。',
        '不要把 visibility=direct/known 或与眼前人物更近误当成更值得报道。publicity 才决定能否传播。候选覆盖多个地点、行业或事件线时，容量允许就分散选题，避免新闻和论坛全部挤在同一条当前剧情线上；但不得为了多样性捏造候选外事实。',
        '每条消息给出 audience_tags：只写“哪些类型的人可能更关注这条消息”，例如当地居民、行业从业者、某组织成员、记者、学生等。它只是受众标签，不代表任何具体 NPC 已经看到或相信该消息，也不需要读取完整世界书。',
        'scope 用一句很短的话概括传播范围，例如“本地居民圈”“行业内部”“全城公开”“小范围匿名流传”。',
        'related_event_id 必须来自 public_event_candidates 中已有的 id。不得虚构新的事件 ID。',
        '最多生成 3 条新闻、4 个论坛主题；每个论坛主题最多 4 条代表回复。允许两个数组都为空；只要输出了内容，related_event_id 就必须来自候选。',
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
    eventVisibilityById = {},
    eventPublicityById = {},
    sourceRevision = -1,
    sourceWorldMinute = -1,
    sourceEventSignature = '',
    forumSourceSignature = sourceEventSignature,
    newsSourceSignature = '',
    generatedAt = new Date().toISOString(),
    lastForumWorldMinute = sourceWorldMinute,
    lastNewsWorldMinute = sourceWorldMinute,
    maximumNews = 3,
    maximumForums = 4,
} = {}) {
    const allowedIds = new Set(asArray(validEventIds).map(item => String(item || '')).filter(Boolean));
    const visibilityFor = id => String(eventVisibilityById?.[id] || '');
    const hasPublicity = id => Object.hasOwn(eventPublicityById || {}, id);
    const publicityFor = id => String(eventPublicityById?.[id] || '');
    const news = uniqueBy(
        asArray(payload?.news).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            if (hasPublicity(relatedEventId) && publicityFor(relatedEventId) !== 'public') return null;
            const headline = asText(item?.headline ?? item?.title, 160);
            const summary = asText(item?.summary, 700);
            if (!headline || !summary) return null;
            const confidenceRaw = asText(item?.confidence, 20).toLowerCase();
            return {
                id: asText(item?.id, 160) || `news_${index}_${relatedEventId}`,
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
                worldSynced: Boolean(item?.worldSynced ?? item?.world_synced),
                eventStatus: asText(item?.eventStatus ?? item?.event_status, 30),
                temporalState: asText(item?.temporalState ?? item?.temporal_state, 20),
                publishedAt: asText(item?.publishedAt ?? item?.published_at, 40) || asText(generatedAt, 40),
                updatedAt: asText(item?.updatedAt ?? item?.updated_at, 40) || asText(generatedAt, 40),
                worldMinute: clampInteger(
                    item?.worldMinute ?? item?.world_minute,
                    sourceWorldMinute,
                    -1,
                    Number.MAX_SAFE_INTEGER,
                ),
            };
        }).filter(Boolean).slice(0, Math.max(1, Number(maximumNews) || 3)),
        item => `${item.relatedEventId}\u0000${item.headline}`,
    );

    const forums = uniqueBy(
        asArray(payload?.forums).map((item, index) => {
            const relatedEventId = asText(item?.related_event_id ?? item?.relatedEventId, 120);
            if (!allowedIds.has(relatedEventId)) return null;
            const eventVisibility = visibilityFor(relatedEventId);
            const eventPublicity = publicityFor(relatedEventId);
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
                id: asText(item?.id, 160) || `forum_${index}_${relatedEventId}`,
                board: asText(item?.board, 60) || '闲聊',
                title,
                summary,
                sourceType: hasPublicity(relatedEventId) && eventPublicity === 'trace'
                    ? 'unofficial'
                    : normalizeSourceType(item?.source_type ?? item?.sourceType, 'unofficial'),
                audienceTags: uniqueStrings(item?.audience_tags ?? item?.audienceTags, 5),
                scope: asText(item?.scope, 80),
                relatedEventId,
                claimStatus: hasPublicity(relatedEventId) && eventPublicity === 'trace'
                    ? (claimRaw === 'rumor' ? 'rumor' : 'mixed')
                    : (VALID_CLAIM_STATUS.has(claimRaw) ? claimRaw : 'mixed'),
                heat: clampInteger(item?.heat, 1, 1, 5),
                replies,
                publishedAt: asText(item?.publishedAt ?? item?.published_at, 40) || asText(generatedAt, 40),
                updatedAt: asText(item?.updatedAt ?? item?.updated_at, 40) || asText(generatedAt, 40),
                worldMinute: clampInteger(
                    item?.worldMinute ?? item?.world_minute,
                    sourceWorldMinute,
                    -1,
                    Number.MAX_SAFE_INTEGER,
                ),
            };
        }).filter(Boolean).slice(0, Math.max(1, Number(maximumForums) || 4)),
        item => `${item.relatedEventId}\u0000${item.title}`,
    );

    return {
        generatedAt: asText(generatedAt, 40),
        sourceRevision: clampInteger(sourceRevision, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceWorldMinute: clampInteger(sourceWorldMinute, -1, -1, Number.MAX_SAFE_INTEGER),
        sourceEventSignature: asText(sourceEventSignature, 240),
        forumSourceSignature: asText(forumSourceSignature, 240),
        newsSourceSignature: asText(newsSourceSignature, 240),
        lastForumWorldMinute: clampInteger(lastForumWorldMinute, sourceWorldMinute, -1, Number.MAX_SAFE_INTEGER),
        lastNewsWorldMinute: clampInteger(lastNewsWorldMinute, sourceWorldMinute, -1, Number.MAX_SAFE_INTEGER),
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
        sourceEventSignature: raw?.sourceEventSignature || '',
        forumSourceSignature: raw?.forumSourceSignature || raw?.sourceEventSignature || '',
        newsSourceSignature: raw?.newsSourceSignature || '',
        generatedAt: raw?.generatedAt || '',
        lastForumWorldMinute: raw?.lastForumWorldMinute ?? sourceWorldMinute,
        lastNewsWorldMinute: raw?.lastNewsWorldMinute ?? sourceWorldMinute,
        maximumNews: 18,
        maximumForums: 12,
    });
}


export function emptyPublicOpinionSandbox({ generatedAt = '' } = {}) {
    return {
        generatedAt: asText(generatedAt, 40),
        nonCanon: true,
        news: [],
        forums: [],
    };
}

export function buildPublicOpinionSandboxPrompt(state, { clockLabel = '' } = {}) {
    const context = {
        world_name: asText(state?.world?.name || '主世界', 80),
        world_time: asText(clockLabel, 100),
        world_flavor: asText(state?.world?.detail || state?.world?.title || '', 700),
        world_background: asText(state?.world?.background || '', 1800),
    };
    return [
        '你是“世界背面”的闲逛舆情生成器。这里是纯娱乐沙盒：可以生成与主线、现有事件完全无关的日常新闻、论坛水帖、小广告、城市八卦、奇怪热帖和生活碎片。',
        '所有内容都必须标记为 non-canon 的娱乐快照：它们不是世界事实，不写入事件、记忆、人物认知、正文因果，也不能暗示真实主线发生了什么。',
        '可以参考 world_name / world_time / world_flavor / world_background 保持世界气质与底层规则，但不得偷用或续写当前主线、隐藏秘密、人物私事。尽量写普通社会生活，让这个世界显得有人在过日子。',
        '内容可以轻松、好笑、琐碎，宁可像真的社区闲逛，也不要每条都制造大事件。',
        '请务必生成可供闲逛的内容：至少 1 条轻新闻和 2 个论坛主题，最多 2 条轻新闻、4 个论坛主题；每个论坛最多 4 条代表回复。只输出 JSON。',
        JSON.stringify({
            output_schema: {
                news: [{ category: '生活 / 本地 / 趣闻 / 商业 / 其他', headline: '', summary: '', source: '', heat: 1 }],
                forums: [{ board: '闲聊', title: '', summary: '', heat: 1, replies: [{ author: '', text: '' }] }],
            },
            context,
        }, null, 2),
    ].join('\n\n');
}

export function normalizePublicOpinionSandboxPayload(payload, { generatedAt = new Date().toISOString() } = {}) {
    const news = uniqueBy(
        asArray(payload?.news).map((item, index) => {
            const headline = asText(item?.headline ?? item?.title, 160);
            const summary = asText(item?.summary, 700);
            if (!headline || !summary) return null;
            return {
                id: `sandbox_news_${index}`,
                category: asText(item?.category, 40) || '闲逛新闻',
                headline,
                summary,
                source: asText(item?.source, 100) || '世界里的普通公开信息',
                sourceType: 'unofficial',
                audienceTags: [],
                scope: '娱乐沙盒',
                relatedEventId: '',
                confidence: 'medium',
                heat: clampInteger(item?.heat, 1, 1, 3),
                nonCanon: true,
            };
        }).filter(Boolean).slice(0, 2),
        item => item.headline,
    );
    const forums = uniqueBy(
        asArray(payload?.forums).map((item, index) => {
            const title = asText(item?.title, 180);
            const summary = asText(item?.summary, 700);
            if (!title || !summary) return null;
            const replies = asArray(item?.replies).map((reply, replyIndex) => {
                const text = asText(reply?.text ?? reply?.content, 360);
                if (!text) return null;
                return { id: `sandbox_reply_${index}_${replyIndex}`, author: asText(reply?.author ?? reply?.name, 60) || `匿名${replyIndex + 1}`, text };
            }).filter(Boolean).slice(0, 4);
            return {
                id: `sandbox_forum_${index}`,
                board: asText(item?.board, 60) || '闲聊',
                title,
                summary,
                sourceType: 'unofficial',
                audienceTags: [],
                scope: '娱乐沙盒',
                relatedEventId: '',
                claimStatus: 'rumor',
                heat: clampInteger(item?.heat, 1, 1, 5),
                replies,
                nonCanon: true,
            };
        }).filter(Boolean).slice(0, 4),
        item => item.title,
    );
    return { generatedAt: asText(generatedAt, 40), nonCanon: true, news, forums };
}

export function normalizePublicOpinionSandbox(raw) {
    return normalizePublicOpinionSandboxPayload(raw || {}, { generatedAt: raw?.generatedAt || '' });
}
