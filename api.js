function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

let lastCustomApiOperation = null;
let customApiOperationSequence = 0;

function beginCustomApiOperation({
    operation = 'request',
    route = '',
    model = '',
    transport = '',
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
        errorType: 'none',
        errorSummary: '',
        attemptedAt: new Date().toISOString(),
        succeededAt: '',
        failedAt: '',
    };
    return id;
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


export async function runWithRetries(operation, {
    retries = 0,
    delayMs = 750,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    onRetry = null,
    shouldRetry = () => true,
    signal = null,
} = {}) {
    const maximumRetries = Math.min(5, Math.max(0, Number.parseInt(retries, 10) || 0));
    let attempt = 0;
    while (true) {
        try {
            if (signal?.aborted) throw cancellationError();
            return await operation(attempt);
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) throw cancellationError();
            if (attempt >= maximumRetries || !shouldRetry(error, attempt)) throw error;
            attempt += 1;
            const milliseconds = Math.min(
                5000,
                Math.max(0, Number(delayMs) || 0) * (2 ** (attempt - 1)),
            );
            await onRetry?.({
                attempt,
                total: maximumRetries,
                delayMs: milliseconds,
                error,
            });
            if (milliseconds > 0) await waitForRetry(wait, milliseconds, signal);
        }
    }
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
    return /(?:^|[\/_-])deepseek[-_]?v?4(?:[\/_-]|$)/i.test(String(model || ''));
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
    } else {
        message = `${subject} 返回 HTTP ${response?.status}${detail ? `：${detail}` : ''}`;
    }
    const error = new Error(message);
    error.errorType = classified.errorType;
    error.transportStatus = Number(response?.status) || null;
    error.upstreamStatus = classified.upstreamStatus;
    error.upstreamMessage = detail;
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
    return new Error(`独立 API 请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal) {
    if (!(timeoutMs > 0)) {
        return fetchImpl(url, { ...options, signal: externalSignal || undefined });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', abort, { once: true });
    }

    try {
        return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (timedOut) throw timeoutError(timeoutMs);
        throw error;
    } finally {
        clearTimeout(timer);
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
    if (!modelsUrl) throw new Error('请先填写独立 API 地址');
    if (!apiKey) throw new Error('请先填写独立 API Key');

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

    const operationId = beginCustomApiOperation({
        operation: 'model-list',
        route: routeLabel,
        model: cleanText(settings?.customApiModel),
        transport,
    });
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
    maxTokens = 2200,
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

    if (!apiUrl) throw new Error('请先填写独立 API 地址');
    if (!model) throw new Error('请先填写独立 API 模型名');
    if (!apiKey) throw new Error('请先填写独立 API Key');

    const body = {
        model,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
        max_tokens: Math.max(64, Number.parseInt(maxTokens, 10) || 2200),
        stream: false,
    };
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
        payload = {
            chat_completion_source: useDeepSeekV4Compatibility ? 'deepseek' : 'openai',
            reverse_proxy: customProxyBase(settings.customApiUrl),
            proxy_password: apiKey,
            include_reasoning: false,
            ...body,
        };
        if (useDeepSeekV4Compatibility) {
            // The tavern's DeepSeek dispatcher rebuilds the upstream body from a
            // whitelist and only emits `thinking` when reasoning_effort is present,
            // so body.thinking alone is dropped on this path and V4 keeps thinking
            // on until it burns the whole completion budget before writing content.
            payload.reasoning_effort = 'none';
        }
    }

    const operationId = beginCustomApiOperation({
        operation,
        route: routeLabel,
        model,
        transport,
    });

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
