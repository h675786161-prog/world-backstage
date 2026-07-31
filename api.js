function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export async function runWithRetries(operation, {
    retries = 0,
    delayMs = 750,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    onRetry = null,
    shouldRetry = () => true,
} = {}) {
    const maximumRetries = Math.min(5, Math.max(0, Number.parseInt(retries, 10) || 0));
    let attempt = 0;
    while (true) {
        try {
            return await operation(attempt);
        } catch (error) {
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
            if (milliseconds > 0) await wait(milliseconds);
        }
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

function contentText(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value
        .map(part => (
            typeof part === 'string'
                ? part
                : part?.text ?? part?.content ?? ''
        ))
        .filter(Boolean)
        .join('');
}

export function extractCompletionText(payload) {
    const choice = payload?.choices?.[0];
    return cleanText(
        contentText(choice?.message?.content)
        || choice?.text
        || payload?.output_text
        || payload?.response,
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
    return cleanText(
        data?.error?.message
        || data?.message
        || data?.error
        || text,
    ).slice(0, 360);
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

export async function requestCustomCompletion(settings, messages, {
    fetchImpl = globalThis.fetch,
    getRequestHeaders = null,
    maxTokens = 2200,
    temperature = 0.2,
    timeoutMs = null,
    signal = null,
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
            chat_completion_source: 'openai',
            reverse_proxy: customProxyBase(settings.customApiUrl),
            proxy_password: apiKey,
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
        if (transport === 'direct' && /fetch|network|cors/i.test(String(error?.message || error))) {
            throw new Error('浏览器直连接口失败，可能是跨域限制；请改用“经酒馆转发”');
        }
        throw error;
    }

    const { text, data } = await readResponse(response);
    if (!response.ok || data?.error) {
        const detail = errorDetail(data, text);
        throw new Error(`独立 API 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    const completion = extractCompletionText(data);
    if (!completion) {
        throw new Error('独立 API 返回成功，但没有可读取的正文');
    }
    return completion;
}
