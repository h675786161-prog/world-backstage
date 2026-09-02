const WB_TRANSPORT_TRACE_WINDOW = Object.freeze([11, 5, 8]);

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

let lastCustomApiOperation = null;
let customApiOperationSequence = 0;

const retryCooldowns = new Map();
const retryFlights = new Map();

function cleanRetryKey(value) {
    return cleanText(value).slice(0, 240);
}

function rateLimitError(error) {
    return error?.errorType === 'rate-limit'
        || error?.code === 'RATE_LIMIT'
        || Number(error?.upstreamStatus) === 429
        || /429|too many requests|rate[_\s-]*limit|限流|频率限制|请求过于频繁/i
            .test(String(error?.message || error || ''));
}

function parseRetryAfterValue(value, nowMs = Date.now()) {
    const text = cleanText(value);
    if (!text) return 0;
    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(10 * 60_000, Math.round(seconds * 1000));
    }
    const timestamp = Date.parse(text);
    if (Number.isFinite(timestamp)) {
        return Math.min(10 * 60_000, Math.max(0, timestamp - nowMs));
    }
    return 0;
}

function retryAfterFromResponse(response, data, nowMs = Date.now()) {
    const header = response?.headers?.get?.('retry-after')
        || response?.headers?.get?.('Retry-After')
        || '';
    const fromHeader = parseRetryAfterValue(header, nowMs);
    if (fromHeader > 0) return fromHeader;

    const raw = data?.error?.retry_after_ms
        ?? data?.retry_after_ms
        ?? data?.error?.retryAfterMs
        ?? data?.retryAfterMs
        ?? null;
    const milliseconds = Number(raw);
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
        return Math.min(10 * 60_000, Math.round(milliseconds));
    }

    const rawSeconds = data?.error?.retry_after
        ?? data?.retry_after
        ?? data?.error?.retryAfter
        ?? data?.retryAfter
        ?? data?.error?.wait_seconds
        ?? data?.wait_seconds
        ?? null;
    const seconds = Number(rawSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(10 * 60_000, Math.round(seconds * 1000));
    }
    return 0;
}

export function retryDelayForError(error, {
    attempt = 1,
    delayMs = 750,
    random = Math.random,
} = {}) {
    const retryIndex = Math.max(1, Number.parseInt(attempt, 10) || 1);
    if (rateLimitError(error)) {
        // 429 never gets an eager retry. Prefer server guidance, otherwise use a
        // conservative exponential cooldown with small jitter so multiple modules
        // do not wake up at the exact same millisecond.
        const serverDelay = Math.max(0, Number(error?.retryAfterMs) || 0);
        const exponential = Math.min(60_000, 4_000 * (2 ** (retryIndex - 1)));
        const base = Math.max(serverDelay, exponential);
        const jitter = Math.round(base * 0.15 * Math.max(0, Math.min(1, Number(random?.() ?? 0.5))));
        return Math.min(90_000, base + jitter);
    }
    return Math.min(
        5_000,
        Math.max(0, Number(delayMs) || 0) * (2 ** (retryIndex - 1)),
    );
}

function setRetryCooldown(key, milliseconds, {
    reason = 'rate-limit',
    nowMs = Date.now(),
} = {}) {
    const normalizedKey = cleanRetryKey(key);
    const delay = Math.max(0, Number(milliseconds) || 0);
    if (!normalizedKey || delay <= 0) return null;

    const old = retryCooldowns.get(normalizedKey);
    const until = Math.max(Number(old?.until || 0), nowMs + delay);
    const next = {
        until,
        reason: cleanText(reason) || 'rate-limit',
        updatedAt: nowMs,
    };
    retryCooldowns.set(normalizedKey, next);
    return { ...next, remainingMs: Math.max(0, until - nowMs) };
}

export function retryCooldownStatus(key, nowMs = Date.now()) {
    const normalizedKey = cleanRetryKey(key);
    if (!normalizedKey) return null;
    const current = retryCooldowns.get(normalizedKey);
    if (!current) return null;
    const remainingMs = Math.max(0, Number(current.until || 0) - nowMs);
    if (remainingMs <= 0) {
        retryCooldowns.delete(normalizedKey);
        return null;
    }
    return { ...current, remainingMs };
}

export function getRetryControlStatus(nowMs = Date.now()) {
    let activeCooldowns = 0;
    let longestCooldownMs = 0;
    for (const key of [...retryCooldowns.keys()]) {
        const current = retryCooldownStatus(key, nowMs);
        if (!current) continue;
        activeCooldowns += 1;
        longestCooldownMs = Math.max(longestCooldownMs, current.remainingMs);
    }
    return {
        activeCooldowns,
        longestCooldownMs,
        activeFlights: retryFlights.size,
    };
}

export function resetRetryControl() {
    retryCooldowns.clear();
    retryFlights.clear();
}

async function waitForRouteCooldown(key, {
    wait,
    signal,
    onCooldown = null,
} = {}) {
    const normalizedKey = cleanRetryKey(key);
    if (!normalizedKey) return;

    while (true) {
        if (signal?.aborted) throw cancellationError();
        await waitUntilPageVisible(signal);
        const cooldown = retryCooldownStatus(normalizedKey);
        if (!cooldown) return;

        await onCooldown?.({
            delayMs: cooldown.remainingMs,
            reason: cooldown.reason,
        });
        await waitForRetry(wait, cooldown.remainingMs, signal);
    }
}

function beginCustomApiOperation({
    operation = 'request',
    route = '',
    model = '',
    transport = '',
    request = null,
} = {}) {
    const id = ++customApiOperationSequence;
    lastCustomApiOperation = {
        id,
        phase: 'running',
        operation,
        source: 'custom-independent',
        route: cleanText(route),
        model: cleanText(model),
        transport: cleanText(transport),
        transportStatus: null,
        upstreamStatus: null,
        retryAfterMs: 0,
        errorType: 'none',
        errorSummary: '',
        request: request && typeof request === 'object' ? { ...request } : null,
        attemptedAt: new Date().toISOString(),
        succeededAt: '',
        failedAt: '',
    };
    return id;
}

function failCustomApiConfiguration(operationId, message, missingField) {
    const error = new Error(message);
    error.errorType = 'configuration';
    error.missingField = cleanText(missingField);
    finishCustomApiOperation(operationId, {
        phase: 'error',
        errorType: error.errorType,
        errorSummary: error.message,
        missingField: error.missingField,
        failedAt: new Date().toISOString(),
    });
    throw error;
}

function finishCustomApiOperation(id, patch = {}) {
    if (!lastCustomApiOperation || lastCustomApiOperation.id !== id) return;
    lastCustomApiOperation = {
        ...lastCustomApiOperation,
        ...patch,
    };
}

export function getLastCustomApiOperation() {
    return lastCustomApiOperation ? { ...lastCustomApiOperation } : null;
}

export function resetLastCustomApiOperation() {
    lastCustomApiOperation = null;
}


async function runWithRetriesInternal(operation, {
    retries = 0,
    delayMs = 750,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    onRetry = null,
    onCooldown = null,
    shouldRetry = () => true,
    signal = null,
    cooldownKey = '',
    random = Math.random,
} = {}) {
    const maximumRetries = Math.min(5, Math.max(0, Number.parseInt(retries, 10) || 0));
    let attempt = 0;

    while (true) {
        try {
            if (signal?.aborted) throw cancellationError();
            // A 429 from any module sharing this route cools the route for every
            // other task too. New tasks wait here instead of sending another request.
            await waitForRouteCooldown(cooldownKey, {
                wait,
                signal,
                onCooldown,
            });
            return await operation(attempt);
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) throw cancellationError();

            const nextAttempt = attempt + 1;
            const milliseconds = retryDelayForError(error, {
                attempt: nextAttempt,
                delayMs,
                random,
            });

            // Even when this task itself has no retry left, a 429 still cools the
            // shared route. Otherwise another module could immediately fire on the
            // same公益站 line and defeat the whole point of backoff.
            if (rateLimitError(error) && cooldownKey) {
                setRetryCooldown(cooldownKey, milliseconds, {
                    reason: 'rate-limit',
                });
            }

            if (attempt >= maximumRetries || !shouldRetry(error, attempt)) throw error;

            attempt = nextAttempt;
            await onRetry?.({
                attempt,
                total: maximumRetries,
                delayMs: milliseconds,
                error,
                rateLimited: rateLimitError(error),
            });

            await waitUntilPageVisible(signal);
            if (rateLimitError(error) && cooldownKey) {
                // Use the shared route cooldown so another task extending the same
                // cooldown is respected too; do not additionally sleep twice.
                await waitForRouteCooldown(cooldownKey, {
                    wait,
                    signal,
                    onCooldown,
                });
            } else if (milliseconds > 0) {
                await waitForRetry(wait, milliseconds, signal);
            }
        }
    }
}

export function runWithRetries(operation, options = {}) {
    const taskKey = cleanRetryKey(options?.taskKey);
    if (!taskKey) return runWithRetriesInternal(operation, options);

    const existing = retryFlights.get(taskKey);
    if (existing) return existing;

    const task = runWithRetriesInternal(operation, options)
        .finally(() => {
            if (retryFlights.get(taskKey) === task) retryFlights.delete(taskKey);
        });
    retryFlights.set(taskKey, task);
    return task;
}

function cancellationError() {
    const error = new Error('推演已由用户取消');
    error.name = 'AbortError';
    return error;
}

export function isAbortError(error) {
    return error?.name === 'AbortError'
        || /aborted|aborterror|已由用户取消|用户取消/i.test(String(error?.message || error || ''));
}

async function waitForRetry(wait, milliseconds, signal) {
    if (!signal) {
        await wait(milliseconds);
        return;
    }
    if (signal.aborted) throw cancellationError();
    let abort;
    try {
        await Promise.race([
            wait(milliseconds),
            new Promise((_, reject) => {
                abort = () => reject(cancellationError());
                signal.addEventListener('abort', abort, { once: true });
            }),
        ]);
    } finally {
        if (abort) signal.removeEventListener('abort', abort);
    }
}

export function normalizeCustomApiUrl(value) {
    const url = cleanText(value).replace(/\/+$/, '');
    if (!url) return '';
    if (/\/chat\/completions$/i.test(url)) return url;
    return `${url}/chat/completions`;
}

export function customProxyBase(value) {
    return normalizeCustomApiUrl(value).replace(/\/chat\/completions$/i, '');
}

export function normalizeCustomModelsUrl(value) {
    const base = customProxyBase(value).replace(/\/+$/, '');
    return base ? `${base}/models` : '';
}

export function normalizeImageApiUrl(value) {
    const url = cleanText(value).replace(/\/+$/, '');
    if (!url) return '';
    if (/\/images\/generations$/i.test(url)) return url;
    return `${url}/images/generations`;
}

function contentText(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return contentText(value.text ?? value.value ?? value.content ?? '');
    }
    if (!Array.isArray(value)) return '';
    return value
        .map(part => (
            typeof part === 'string'
                ? part
                : contentText(part?.text ?? part?.value ?? part?.content ?? '')
        ))
        .filter(Boolean)
        .join('');
}

function responsesApiText(payload) {
    if (!Array.isArray(payload?.output)) return '';
    return payload.output
        .map(item => contentText(item?.content ?? item?.text ?? ''))
        .filter(Boolean)
        .join('');
}

function isDeepSeekV4Model(model) {
    return /(?:^|[^a-z0-9])deepseek[-_]?v?4(?:[^a-z0-9]|$)/i.test(String(model || ''));
}

export function extractCompletionText(payload) {
    const choice = payload?.choices?.[0];
    return cleanText(
        contentText(choice?.message?.content)
        || contentText(choice?.message?.output_text)
        || choice?.text
        || payload?.output_text
        || responsesApiText(payload)
        || contentText(payload?.content)
        || payload?.response,
    );
}

export function extractCompletionFinishReason(payload) {
    return cleanText(
        payload?.choices?.[0]?.finish_reason
        || payload?.choices?.[0]?.finishReason
        || payload?.finish_reason
        || payload?.finishReason,
    );
}

async function readResponse(response) {
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            if (response.ok) {
                throw new Error(`接口返回的不是 JSON：${text.slice(0, 180)}`);
            }
        }
    }
    return { text, data };
}

function errorDetail(data, text) {
    const error = data?.error;
    return cleanText(
        error?.message
        || error?.detail
        || error?.code
        || data?.message
        || (typeof error === 'string' ? error : '')
        || text,
    ).slice(0, 360);
}

function classifyUpstreamError(response, data, detail = '') {
    const text = [
        detail,
        data?.error?.code,
        data?.error?.type,
        data?.code,
        data?.type,
    ].filter(Boolean).join(' ').toLocaleLowerCase();

    if (
        /insufficient[_\s-]*quota|quota\s*(?:exceeded|exhausted|depleted)|credits?\s*(?:exhausted|depleted)|额度(?:不足|耗尽)|余额不足/.test(text)
    ) {
        return { errorType: 'quota-exhausted', upstreamStatus: response?.status === 429 ? 429 : null };
    }
    if (
        Number(response?.status) === 429
        || /too many requests|rate[_\s-]*limit(?:ed|_exceeded)?|请求过于频繁|限流|频率限制/.test(text)
    ) {
        return { errorType: 'rate-limit', upstreamStatus: 429 };
    }
    if (
        Number(response?.status) === 401
        || Number(response?.status) === 403
        || /unauthorized|forbidden|invalid[_\s-]*(?:api[_\s-]*)?key|authentication|authorization|鉴权|认证失败|密钥无效/.test(text)
    ) {
        const status = /forbidden/.test(text) || Number(response?.status) === 403 ? 403 : 401;
        return { errorType: 'authorization', upstreamStatus: status };
    }
    if (
        Number(response?.status) === 404
        || /\bnot found\b|model[_\s-]*not[_\s-]*found|route[_\s-]*not[_\s-]*found|找不到(?:模型|路由|接口)|不存在的(?:模型|路由|接口)/.test(text)
    ) {
        return { errorType: 'not-found', upstreamStatus: 404 };
    }
    return { errorType: 'other', upstreamStatus: null };
}

function buildCustomApiResponseError(response, data, text, subject = '独立 API') {
    const detail = errorDetail(data, text);
    const classified = classifyUpstreamError(response, data, detail);
    let message;
    if (classified.errorType === 'rate-limit') {
        message = `${subject} 被上游限流：${detail || 'Too Many Requests'}（429 类错误`;
        if (Number(response?.status) === 200) message += '；酒馆转发层 HTTP 200';
        message += '）。稍后再试，或检查该接口/模型的频率限制。';
    } else if (classified.errorType === 'quota-exhausted') {
        message = `${subject} 额度已耗尽：${detail || 'quota exhausted'}`;
        if (Number(response?.status) === 200) message += '（酒馆转发层 HTTP 200）';
        message += '。请检查该接口/模型的额度或余额。';
    } else if (classified.errorType === 'authorization') {
        const status = Number(response?.status) || classified.upstreamStatus || 401;
        message = `${subject} 鉴权失败（HTTP ${status}）：${detail || 'Unauthorized'}`;
        if (Number(response?.status) === 200) message += '（酒馆转发层 HTTP 200）';
        message += '。请检查该方案的密钥/权限，或确认接口要求的认证头。';
    } else if (classified.errorType === 'not-found') {
        message = `${subject} 没找到请求目标：${detail || 'Not Found'}`;
        if (Number(response?.status) === 200) message += '（酒馆转发层 HTTP 200）';
        message += '。请检查基础地址、模型名或上游路由。';
    } else {
        message = `${subject} 返回 HTTP ${response?.status}${detail ? `：${detail}` : ''}`;
    }
    const error = new Error(message);
    error.errorType = classified.errorType;
    error.transportStatus = Number(response?.status) || null;
    error.upstreamStatus = classified.upstreamStatus;
    error.upstreamMessage = detail;
    error.retryAfterMs = classified.errorType === 'rate-limit'
        ? retryAfterFromResponse(response, data)
        : 0;
    if (classified.errorType === 'rate-limit') error.code = 'RATE_LIMIT';
    if (classified.errorType === 'quota-exhausted') error.code = 'QUOTA_EXHAUSTED';
    return error;
}

function headersFrom(getRequestHeaders) {
    const headers = typeof getRequestHeaders === 'function'
        ? { ...(getRequestHeaders() || {}) }
        : {};
    if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

function timeoutError(timeoutMs) {
    const error = new Error(`独立 API 请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    error.code = 'REQUEST_TIMEOUT';
    error.errorType = 'timeout';
    error.timeoutMs = Number(timeoutMs) || 0;
    return error;
}

function visibilityDocument() {
    const documentRef = globalThis.document;
    return documentRef
        && typeof documentRef.addEventListener === 'function'
        && typeof documentRef.removeEventListener === 'function'
        ? documentRef
        : null;
}

function pageIsHidden(documentRef = visibilityDocument()) {
    return Boolean(documentRef?.hidden);
}

async function waitUntilPageVisible(signal, documentRef = visibilityDocument()) {
    if (!documentRef || !pageIsHidden(documentRef)) return;
    if (signal?.aborted) throw cancellationError();

    await new Promise((resolve, reject) => {
        const cleanup = () => {
            documentRef.removeEventListener('visibilitychange', onVisibility);
            signal?.removeEventListener?.('abort', onAbort);
        };
        const onVisibility = () => {
            if (pageIsHidden(documentRef)) return;
            cleanup();
            resolve();
        };
        const onAbort = () => {
            cleanup();
            reject(cancellationError());
        };
        documentRef.addEventListener('visibilitychange', onVisibility);
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal) {
    if (!(timeoutMs > 0)) {
        return fetchImpl(url, { ...options, signal: externalSignal || undefined });
    }

    const controller = new AbortController();
    const documentRef = visibilityDocument();
    let timedOut = false;
    let timer = null;
    let remainingMs = Math.max(1, Number(timeoutMs) || 1);
    let activeSince = 0;
    const now = () => globalThis.performance?.now?.() ?? Date.now();

    const pauseTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (activeSince > 0) {
            remainingMs = Math.max(0, remainingMs - Math.max(0, now() - activeSince));
            activeSince = 0;
        }
    };
    const resumeTimer = () => {
        if (controller.signal.aborted || pageIsHidden(documentRef) || timer !== null) return;
        if (remainingMs <= 0) {
            timedOut = true;
            controller.abort();
            return;
        }
        activeSince = now();
        timer = setTimeout(() => {
            timer = null;
            activeSince = 0;
            timedOut = true;
            controller.abort();
        }, remainingMs);
    };
    const onVisibility = () => {
        if (pageIsHidden(documentRef)) pauseTimer();
        else resumeTimer();
    };
    const abort = () => controller.abort();

    if (documentRef) documentRef.addEventListener('visibilitychange', onVisibility);
    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', abort, { once: true });
    }
    resumeTimer();

    try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (timedOut) throw timeoutError(timeoutMs);
        throw error;
    } finally {
        pauseTimer();
        documentRef?.removeEventListener?.('visibilitychange', onVisibility);
        externalSignal?.removeEventListener?.('abort', abort);
    }
}

function modelIdsFrom(payload) {
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.models)
                ? payload.models
                : Array.isArray(payload?.model_names)
                    ? payload.model_names
                    : [];
    return [...new Set(candidates
        .map(item => cleanText(
            typeof item === 'string' ? item : item?.id || item?.name || item?.model,
        ))
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

export async function requestCustomModels(settings, {
    fetchImpl = globalThis.fetch,
    getRequestHeaders = null,
    timeoutMs = null,
    signal = null,
    routeLabel = '',
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    const modelsUrl = normalizeCustomModelsUrl(settings?.customApiUrl);
    const apiKey = cleanText(settings?.customApiKey);
    const transport = settings?.customApiTransport === 'direct' ? 'direct' : 'proxy';
    const requestTimeout = Number(timeoutMs ?? settings?.customApiTimeoutMs ?? 120000);
    const operationId = beginCustomApiOperation({
        operation: 'model-list',
        route: routeLabel,
        model: cleanText(settings?.customApiModel),
        transport,
        request: {
            endpointKind: 'models',
            method: transport === 'direct' ? 'GET' : 'POST',
            timeoutMs: requestTimeout,
            apiUrlPresent: Boolean(cleanText(settings?.customApiUrl)),
            apiKeyPresent: Boolean(apiKey),
            modelPresent: Boolean(cleanText(settings?.customApiModel)),
        },
    });
    if (!modelsUrl) failCustomApiConfiguration(operationId, '请先填写独立 API 地址', 'customApiUrl');
    if (!apiKey) failCustomApiConfiguration(operationId, '请先填写独立 API Key', 'customApiKey');

    let target = modelsUrl;
    let options = {
        method: 'GET',
        cache: 'no-cache',
        headers: { Authorization: `Bearer ${apiKey}` },
    };
    if (transport === 'proxy') {
        target = '/api/backends/chat-completions/status';
        options = {
            method: 'POST',
            cache: 'no-cache',
            headers: headersFrom(getRequestHeaders),
            body: JSON.stringify({
                chat_completion_source: 'openai',
                reverse_proxy: customProxyBase(settings.customApiUrl),
                proxy_password: apiKey,
            }),
        };
    }

    try {
        const response = await fetchWithTimeout(fetchImpl, target, options, requestTimeout, signal);
        const { text, data } = await readResponse(response);
        if (!response.ok || data?.error) {
            throw buildCustomApiResponseError(response, data, text, '模型列表请求');
        }
        const models = modelIdsFrom(data);
        if (!models.length) {
            throw new Error('接口连接成功，但没有返回可识别的模型列表；仍可手动填写模型名称');
        }
        finishCustomApiOperation(operationId, {
            phase: 'success',
            transportStatus: Number(response.status) || null,
            succeededAt: new Date().toISOString(),
        });
        return models;
    } catch (error) {
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error?.transportStatus ?? null,
            upstreamStatus: error?.upstreamStatus ?? null,
            retryAfterMs: Number(error?.retryAfterMs) || 0,
            errorType: error?.errorType || 'other',
            errorSummary: cleanText(error?.message || error).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
}

export async function requestCustomCompletion(settings, messages, {
    fetchImpl = globalThis.fetch,
    getRequestHeaders = null,
    maxTokens = 0,
    temperature = 0.2,
    timeoutMs = null,
    signal = null,
    rejectTruncated = false,
    operation = 'completion',
    routeLabel = '',
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境不支持网络请求');
    }

    const apiUrl = normalizeCustomApiUrl(settings?.customApiUrl);
    const model = cleanText(settings?.customApiModel);
    const apiKey = cleanText(settings?.customApiKey);
    const transport = settings?.customApiTransport === 'direct' ? 'direct' : 'proxy';
    const requestTimeout = Number(timeoutMs ?? settings?.customApiTimeoutMs ?? 120000);
    const messageList = Array.isArray(messages) ? messages : [];
    const configuredMaxTokens = Number.parseInt(maxTokens, 10);
    const operationId = beginCustomApiOperation({
        operation,
        route: routeLabel,
        model,
        transport,
        request: {
            endpointKind: 'chat-completions',
            method: 'POST',
            timeoutMs: requestTimeout,
            apiUrlPresent: Boolean(cleanText(settings?.customApiUrl)),
            apiKeyPresent: Boolean(apiKey),
            modelPresent: Boolean(model),
            messageCount: messageList.length,
            messageCharacters: messageList.reduce((total, item) => (
                total + cleanText(item?.content).length
            ), 0),
            maxTokensSent: Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
                ? Math.max(64, configuredMaxTokens)
                : 0,
            temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
            stream: false,
            deepSeekV4Compatibility: isDeepSeekV4Model(model),
        },
    });

    if (!apiUrl) failCustomApiConfiguration(operationId, '请先填写独立 API 地址', 'customApiUrl');
    if (!model) failCustomApiConfiguration(operationId, '请先填写独立 API 模型名', 'customApiModel');
    if (!apiKey) failCustomApiConfiguration(operationId, '请先填写独立 API Key', 'customApiKey');

    const body = {
        model,
        messages: messageList,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
        stream: false,
    };
    if (Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0) {
        body.max_tokens = Math.max(64, configuredMaxTokens);
    }
    const useDeepSeekV4Compatibility = isDeepSeekV4Model(model);
    if (useDeepSeekV4Compatibility) {
        // DeepSeek V4 defaults to thinking mode. Structured background work does
        // not need hidden reasoning, and it can otherwise consume the completion
        // budget before message.content is produced.
        body.thinking = { type: 'disabled' };
    }

    let target = apiUrl;
    let headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };
    let payload = body;

    if (transport === 'proxy') {
        target = '/api/backends/chat-completions/generate';
        headers = headersFrom(getRequestHeaders);
        // The independent route owns both its URL and key. SillyTavern's CUSTOM
        // dispatcher reads the key from Tavern's secret store, not this plugin.
        // Its generic OpenAI-compatible reverse proxy accepts both explicitly.
        payload = {
            chat_completion_source: 'openai',
            reverse_proxy: customProxyBase(settings.customApiUrl),
            proxy_password: apiKey,
            include_reasoning: false,
            ...body,
        };
    }

    let response;
    try {
        response = await fetchWithTimeout(fetchImpl, target, {
            method: 'POST',
            cache: 'no-cache',
            headers,
            body: JSON.stringify(payload),
        }, requestTimeout, signal);
    } catch (error) {
        let nextError = error;
        if (transport === 'direct' && /fetch|network|cors/i.test(String(error?.message || error))) {
            nextError = new Error('浏览器直连接口失败，可能是跨域限制；请改用“经酒馆转发”');
        }
        finishCustomApiOperation(operationId, {
            phase: 'error',
            errorType: nextError?.errorType || 'network',
            errorSummary: cleanText(nextError?.message || nextError).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw nextError;
    }

    let text;
    let data;
    try {
        ({ text, data } = await readResponse(response));
    } catch (error) {
        error.errorType ||= 'invalid-json';
        error.transportStatus ??= Number(response.status) || null;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message || error).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    if (!response.ok || data?.error) {
        const detail = errorDetail(data, text);
        let error;
        if (/no message generated|empty (?:message|response)|no content/i.test(detail)) {
            error = new Error(
                '独立 API 没有返回最终正文（No message generated）。'
                + (useDeepSeekV4Compatibility
                    ? '插件已请求关闭 DS4 思考；若仍为空，通常是中转站未转发该参数或接口输出额度耗尽'
                    : '请检查模型输出额度或改用能稳定返回正文的模型'),
            );
            error.errorType = 'empty-response';
            error.transportStatus = Number(response.status) || null;
        } else {
            error = buildCustomApiResponseError(response, data, text, '独立 API');
        }
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus ?? (Number(response.status) || null),
            upstreamStatus: error.upstreamStatus ?? null,
            retryAfterMs: Number(error.retryAfterMs) || 0,
            errorType: error.errorType || 'other',
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }

    const completion = extractCompletionText(data);
    const finishReason = extractCompletionFinishReason(data);
    if (!completion) {
        const hitLengthLimit = /length|max[_\s-]*tokens?|token[_\s-]*limit/i.test(finishReason);
        const error = hitLengthLimit
            ? new Error(`独立 API 输出达到长度上限（${finishReason}），且没有返回可恢复的正文`)
            : new Error(
                '独立 API 返回成功，但没有可读取的最终正文。'
                + (useDeepSeekV4Compatibility ? 'DS4 思考可能占满了中转站的输出额度' : ''),
            );
        error.errorType = hitLengthLimit ? 'output-limit' : 'empty-response';
        error.transportStatus = Number(response.status) || null;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    const hitLengthLimit = /length|max[_\s-]*tokens?|token[_\s-]*limit/i.test(finishReason);
    if (hitLengthLimit && rejectTruncated) {
        const error = new Error(`独立 API 输出达到长度上限（${finishReason}），本任务不接受被截断的结果`);
        error.code = 'OUTPUT_TRUNCATED';
        error.errorType = 'output-limit';
        error.transportStatus = Number(response.status) || null;
        error.finishReason = finishReason;
        error.partialText = completion;
        finishCustomApiOperation(operationId, {
            phase: 'error',
            transportStatus: error.transportStatus,
            upstreamStatus: null,
            errorType: error.errorType,
            errorSummary: cleanText(error.message).slice(0, 420),
            failedAt: new Date().toISOString(),
        });
        throw error;
    }
    // Structured simulation calls may still receive a complete JSON object even
    // when a provider reports MAX_TOKENS. Preserve non-empty output there and let
    // the JSON parser decide whether compact retry is necessary.
    finishCustomApiOperation(operationId, {
        phase: 'success',
        transportStatus: Number(response.status) || null,
        succeededAt: new Date().toISOString(),
    });
    return completion;
}

export async function requestImageGeneration(settings, {
    prompt = '',
    fetchImpl = globalThis.fetch,
    timeoutMs = null,
    signal = null,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持网络请求');
    const apiUrl = normalizeImageApiUrl(settings?.imageApiUrl);
    const apiKey = cleanText(settings?.imageApiKey);
    const model = cleanText(settings?.imageApiModel);
    const imagePrompt = cleanText(prompt).slice(0, 4000);
    const size = ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'].includes(settings?.imageApiSize)
        ? settings.imageApiSize
        : '1024x1024';
    const requestTimeout = Number(timeoutMs ?? settings?.imageApiTimeoutMs ?? 180000);
    if (!apiUrl) throw new Error('请先填写生图 API 地址');
    if (!apiKey) throw new Error('请先填写生图 API Key');
    if (!model) throw new Error('请先填写生图模型名');
    if (!imagePrompt) throw new Error('生图提示词为空');

    const response = await fetchWithTimeout(fetchImpl, apiUrl, {
        method: 'POST',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            prompt: imagePrompt,
            n: 1,
            size,
            response_format: 'b64_json',
        }),
    }, requestTimeout, signal);
    const { text: responseText, data } = await readResponse(response);
    if (!response.ok || data?.error) {
        throw buildCustomApiResponseError(response, data, responseText, '生图请求');
    }
    const first = Array.isArray(data?.data) ? data.data[0] : null;
    const base64 = cleanText(first?.b64_json ?? first?.b64Json);
    const url = cleanText(first?.url);
    if (base64) {
        return {
            imageUrl: `data:image/png;base64,${base64}`,
            revisedPrompt: cleanText(first?.revised_prompt ?? first?.revisedPrompt),
        };
    }
    if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) {
        return {
            imageUrl: url,
            revisedPrompt: cleanText(first?.revised_prompt ?? first?.revisedPrompt),
        };
    }
    throw new Error('生图接口返回成功，但没有找到图片数据');
}
