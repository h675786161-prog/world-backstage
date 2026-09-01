import {
    buildHistoryArchaeologyPrompt,
    mergeChronologicalHistoryArtifacts,
    planHistoryArchaeologyWindows,
    runHistoryArchaeologyPool,
} from './history-parallel-lab.js';

const MODULE_ID = 'world_backstage';
const BUTTON_ID = 'wb-history-parallel-lab-button';
const STATUS_ID = 'wb-history-parallel-lab-status';
let activeRun = null;

function context() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, '').trim();
}

function chatMessages(ctx) {
    return (Array.isArray(ctx?.chat) ? ctx.chat : [])
        .map((message, index) => {
            if (!message || message.is_system) return null;
            const swipeId = message.is_user ? 0 : Number(message.swipe_id ?? 0);
            const content = message.is_user
                ? String(message.mes || '')
                : String(message.swipes?.[swipeId] ?? message.mes ?? '');
            if (!content.trim()) return null;
            return {
                id: index,
                swipe: swipeId,
                role: message.is_user ? 'user' : 'assistant',
                content: content.trim(),
            };
        })
        .filter(Boolean);
}

function resolveSavedHistoryProfile(ctx) {
    const settings = ctx?.extensionSettings?.[MODULE_ID] || {};
    const route = String(settings.apiModuleRoutes?.history || 'default');
    let profileId = '';
    if (route.startsWith('tavern-profile:')) profileId = route.slice('tavern-profile:'.length).trim();
    else if (route === 'default' && settings.apiMode === 'tavern-profile') {
        profileId = String(settings.tavernApiProfileId || '').trim();
    }
    if (!profileId) {
        throw new Error('首轮并行实测只走“酒馆已保存方案”。当前酒馆安静生成是全局通道，不能为了测速绕过安全隔离。');
    }
    const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
    const profile = profiles.find(item => String(item?.id || '') === profileId);
    if (!profile) throw new Error('记忆模块引用的酒馆已保存方案已经不存在，请先重新选择。');
    const service = ctx?.ConnectionManagerRequestService;
    if (typeof service?.sendRequest !== 'function') {
        throw new Error('当前 SillyTavern 没有提供独立连接方案请求服务。');
    }
    return { profileId, profile, service };
}

function extractResponseText(result) {
    if (typeof result === 'string') return result;
    if (typeof result?.content === 'string') return result.content;
    if (typeof result?.text === 'string') return result.text;
    if (typeof result?.message?.content === 'string') return result.message.content;
    return '';
}

function balancedJsonCandidates(source = '') {
    const text = String(source || '');
    const candidates = [];
    for (let start = 0; start < text.length; start += 1) {
        if (text[start] !== '{') continue;
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < text.length; index += 1) {
            const char = text[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
                continue;
            }
            if (char === '"') {
                quoted = true;
                continue;
            }
            if (char === '{') depth += 1;
            else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    candidates.push(text.slice(start, index + 1));
                    break;
                }
            }
        }
    }
    return candidates;
}

function parseJsonObject(raw) {
    const source = String(raw || '').replace(/^\uFEFF/, '').trim();
    if (!source) return null;
    const fenced = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
        .map(match => match[1]?.trim())
        .filter(Boolean);
    const strippedThink = source.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const candidates = [source, strippedThink, ...fenced];
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch { /* scan balanced objects below */ }
        for (const objectText of balancedJsonCandidates(candidate)) {
            try {
                const parsed = JSON.parse(objectText);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
            } catch { /* keep looking */ }
        }
    }
    return null;
}

function validateWindowPayload(window, payload) {
    if (!payload || typeof payload !== 'object') throw new Error(`窗口 ${window.startMessageId}—${window.endMessageId} 没有返回 JSON 对象`);
    const assistantIds = window.messages
        .filter(message => message.role === 'assistant')
        .map(message => Number(message.id));
    const summaries = Array.isArray(payload.turn_summaries)
        ? payload.turn_summaries
        : Array.isArray(payload.turnSummaries) ? payload.turnSummaries : [];
    const summaryIds = new Set(summaries
        .map(item => Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId))
        .filter(Number.isFinite));
    const missing = assistantIds.filter(id => !summaryIds.has(id));
    if (missing.length) throw new Error(`窗口 ${window.startMessageId}—${window.endMessageId} 缺少 L0 摘要：${missing.join(', ')}`);

    const sourceById = new Map(window.messages.map(message => [Number(message.id), normalizeText(message.content)]));
    const checks = [];
    const addEvidenceChecks = (items, evidenceField) => {
        for (const item of Array.isArray(items) ? items : []) {
            const messageId = Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId);
            const evidence = normalizeText(item?.[evidenceField] || '');
            if (!Number.isFinite(messageId) || !evidence) continue;
            checks.push(Boolean(sourceById.get(messageId)?.includes(evidence)));
        }
    };
    addEvidenceChecks(payload.facts_upsert, 'source_excerpt');
    addEvidenceChecks(payload.event_fragments, 'evidence');
    addEvidenceChecks(payload.person_observations, 'evidence');
    addEvidenceChecks(payload.clue_fragments, 'evidence');

    return {
        payload: {
            turn_summaries: summaries,
            facts_upsert: Array.isArray(payload.facts_upsert) ? payload.facts_upsert : [],
            event_fragments: Array.isArray(payload.event_fragments) ? payload.event_fragments : [],
            person_observations: Array.isArray(payload.person_observations) ? payload.person_observations : [],
            clue_fragments: Array.isArray(payload.clue_fragments) ? payload.clue_fragments : [],
        },
        evidenceChecked: checks.length,
        evidenceAnchored: checks.filter(Boolean).length,
    };
}

function setStatus(text, tone = '') {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = text;
    node.dataset.tone = tone;
}

function setButtonRunning(running) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(running);
    button.textContent = running
        ? '并行考古测速中……'
        : '🧪 并行回溯实测（不写入世界）';
}

function compactRetryPrompt(basePrompt, window) {
    const assistantIds = window.messages
        .filter(message => message.role === 'assistant')
        .map(message => Number(message.id));
    return [
        basePrompt,
        '',
        '【格式修复重试】上一份输出没有通过机器校验。',
        '这次禁止解释、前言、后记、Markdown 代码围栏和思维过程，只返回一个 JSON 对象。',
        `turn_summaries 必须逐条覆盖这些 assistant source_message_id：${assistantIds.join(', ')}。`,
        '为了稳定，facts_upsert 最多4条，event_fragments最多4条，person_observations最多4条，clue_fragments最多3条；没有内容就返回空数组。',
        'evidence/source_excerpt 必须直接复制本窗口原文短句，不要改写。',
    ].join('\n');
}

async function requestWindowWithRetry({
    service,
    profileId,
    window,
    basePrompt,
    signal,
    onRetry,
}) {
    const attempts = [
        { prompt: basePrompt, maxTokens: 3200, temperature: 0.05 },
        { prompt: compactRetryPrompt(basePrompt, window), maxTokens: 3600, temperature: 0.02 },
    ];
    let lastError = null;
    let lastRaw = '';
    let totalMs = 0;

    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
        if (signal?.aborted) {
            const error = new Error('并行历史实验已停止');
            error.name = 'AbortError';
            throw error;
        }
        const config = attempts[attempt];
        const started = performance.now();
        const result = await service.sendRequest(
            profileId,
            [
                { role: 'system', content: '执行结构化历史证据提取。最终输出必须是单个合法 JSON 对象。不要输出 Markdown、解释或思维过程。' },
                { role: 'user', content: config.prompt },
            ],
            config.maxTokens,
            {
                stream: false,
                signal,
                extractData: true,
                includePreset: false,
                includeInstruct: true,
            },
            {
                temperature: config.temperature,
                include_reasoning: false,
            },
        );
        totalMs += Math.max(0, performance.now() - started);
        lastRaw = extractResponseText(result);
        try {
            const parsed = parseJsonObject(lastRaw);
            if (!parsed) throw new Error(`窗口 ${window.startMessageId}—${window.endMessageId} 返回格式不可解析`);
            const checked = validateWindowPayload(window, parsed);
            return {
                ...checked,
                attempts: attempt + 1,
                durationMs: totalMs,
            };
        } catch (error) {
            lastError = error;
            if (attempt + 1 < attempts.length) {
                onRetry?.({ attempt: attempt + 2, error, raw: lastRaw });
                continue;
            }
        }
    }

    globalThis.__WB_HISTORY_PARALLEL_LAB_LAST_FAILURE__ = {
        window: {
            startMessageId: window.startMessageId,
            endMessageId: window.endMessageId,
        },
        error: String(lastError?.message || lastError || ''),
        responsePreview: String(lastRaw || '').slice(0, 1800),
    };
    const error = new Error(
        `窗口 ${window.startMessageId}—${window.endMessageId} 连续两次没有通过 JSON/L0 校验`
        + (lastError?.message ? `：${lastError.message}` : ''),
    );
    error.cause = lastError;
    throw error;
}

async function runLab() {
    if (activeRun) return;
    const ctx = context();
    if (!ctx) throw new Error('还没有拿到 SillyTavern 上下文。');
    const messages = chatMessages(ctx);
    const assistantCount = messages.filter(message => message.role === 'assistant').length;
    if (assistantCount < 6) throw new Error('这段聊天太短，至少 6 条 AI 正文再测并行才有意义。');
    const { profileId, profile, service } = resolveSavedHistoryProfile(ctx);
    const windows = planHistoryArchaeologyWindows(messages, {
        assistantTurnsPerWindow: 4,
        overlapAssistantTurns: 1,
        maximumCharacters: 22000,
    });
    if (windows.length < 2) throw new Error('当前历史只切出一个窗口，没必要并行。');

    const controller = new AbortController();
    const durations = new Array(windows.length).fill(0);
    const evidence = new Array(windows.length).fill(null);
    const attempts = new Array(windows.length).fill(0);
    activeRun = { controller };
    setButtonRunning(true);
    setStatus(`准备 ${windows.length} 个重叠窗口，并发上限 2；只提取证据，不碰正式世界。`);

    try {
        const run = await runHistoryArchaeologyPool(windows, {
            concurrency: 2,
            signal: controller.signal,
            onProgress: progress => {
                if (progress.phase === 'complete') {
                    setStatus(`并行考古 ${progress.completed}/${progress.total}；当前同时最多跑 2 份，不提交世界状态。`);
                }
            },
            extract: async (window, { slot, index, signal }) => {
                const prompt = buildHistoryArchaeologyPrompt(window, {
                    userName: String(ctx.name1 || ''),
                    playerIdentityAnchor: String(ctx.extensionSettings?.[MODULE_ID]?.playerIdentityAnchor || ''),
                    recordPlayerCharacter: ctx.extensionSettings?.[MODULE_ID]?.recordPlayerCharacter !== false,
                });
                const checked = await requestWindowWithRetry({
                    service,
                    profileId,
                    window,
                    basePrompt: prompt,
                    signal,
                    onRetry: () => {
                        setStatus(`窗口 ${window.startMessageId}—${window.endMessageId} 格式歪了，正在自动收紧格式重试；世界仍未写入。`);
                    },
                });
                durations[index] = checked.durationMs;
                attempts[index] = checked.attempts;
                evidence[index] = {
                    checked: checked.evidenceChecked,
                    anchored: checked.evidenceAnchored,
                    slot,
                };
                return checked.payload;
            },
        });

        const merged = mergeChronologicalHistoryArtifacts(run.results);
        const serialEstimateMs = durations.reduce((sum, value) => sum + value, 0);
        const speedup = run.elapsedMs > 0 ? serialEstimateMs / run.elapsedMs : 0;
        const evidenceChecked = evidence.reduce((sum, item) => sum + Number(item?.checked || 0), 0);
        const evidenceAnchored = evidence.reduce((sum, item) => sum + Number(item?.anchored || 0), 0);
        const evidenceRate = evidenceChecked > 0 ? evidenceAnchored / evidenceChecked : 1;
        const assistantIds = new Set(messages.filter(message => message.role === 'assistant').map(message => Number(message.id)));
        const summaryIds = new Set(merged.turn_summaries
            .map(item => Number(item?.source_message_id ?? item?.sourceMessageId ?? item?.message_id ?? item?.messageId))
            .filter(Number.isFinite));
        const summaryCoverage = assistantIds.size
            ? [...assistantIds].filter(id => summaryIds.has(id)).length / assistantIds.size
            : 1;
        const retryWindows = attempts.filter(value => value > 1).length;

        const metrics = {
            at: new Date().toISOString(),
            profileName: String(profile?.name || '已保存方案').slice(0, 100),
            windows: windows.length,
            concurrency: 2,
            maxActive: run.maxActive,
            wallMs: Math.round(run.elapsedMs),
            serialEstimateMs: Math.round(serialEstimateMs),
            speedup: Number(speedup.toFixed(2)),
            retryWindows,
            totalRequests: attempts.reduce((sum, value) => sum + Number(value || 0), 0),
            summaryCoverage: Number(summaryCoverage.toFixed(4)),
            evidenceRate: Number(evidenceRate.toFixed(4)),
            artifacts: {
                summaries: merged.turn_summaries.length,
                facts: merged.facts_upsert.length,
                events: merged.event_fragments.length,
                people: merged.person_observations.length,
                clues: merged.clue_fragments.length,
            },
            committedWorldState: false,
        };
        globalThis.__WB_HISTORY_PARALLEL_LAB_RESULT__ = metrics;

        const coverageLabel = `${Math.round(summaryCoverage * 100)}%`;
        const evidenceLabel = evidenceChecked ? `${Math.round(evidenceRate * 100)}%` : '无可核证条目';
        setStatus(
            `完成：${windows.length} 窗口｜并发峰值 ${run.maxActive}｜实际 ${(run.elapsedMs / 1000).toFixed(1)}s｜`
            + `同批请求若串行约 ${(serialEstimateMs / 1000).toFixed(1)}s｜约 ${speedup.toFixed(2)}×｜`
            + `格式重试 ${retryWindows} 窗｜L0 覆盖 ${coverageLabel}｜原文证据命中 ${evidenceLabel}。没有写入世界。`,
            summaryCoverage === 1 && evidenceRate >= 0.95 && retryWindows <= Math.max(1, Math.floor(windows.length * 0.15))
                ? 'success'
                : 'warning',
        );
    } catch (error) {
        const message = String(error?.cause?.message || error?.message || error || '未知错误');
        const rateLimited = /429|rate.?limit|too many requests|限流/i.test(message);
        setStatus(
            rateLimited
                ? '并行实测碰到限流，整轮候选已丢弃，正式世界没动。这个接口目前不适合开并行。'
                : `并行实测停止：${message.slice(0, 300)}。候选结果全部丢弃，正式世界没动。`,
            'error',
        );
        throw error;
    } finally {
        activeRun = null;
        setButtonRunning(false);
    }
}

function mount() {
    const host = document.querySelector('#world-backstage-root .wb-world-bootstrap-settings');
    if (!host || document.getElementById(BUTTON_ID)) return;
    const wrap = document.createElement('div');
    wrap.className = 'wb-history-parallel-lab';
    wrap.innerHTML = `
        <button type="button" id="${BUTTON_ID}">🧪 并行回溯实测（不写入世界）</button>
        <p id="${STATUS_ID}">测试仓库实验入口：用两个独立请求窗口测真实耗时和证据稳定性；不会改人物、记忆、暗流或世界时间。</p>
    `;
    host.appendChild(wrap);
    wrap.querySelector(`#${BUTTON_ID}`)?.addEventListener('click', () => {
        void runLab().catch(error => console.warn('[世界背面] 并行历史实验未完成', error));
    });
}

function start() {
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => {
        activeRun?.controller?.abort?.();
        observer.disconnect();
    }, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
