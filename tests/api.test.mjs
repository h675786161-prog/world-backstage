import test from 'node:test';
import assert from 'node:assert/strict';

import {
    customProxyBase,
    extractCompletionFinishReason,
    extractCompletionText,
    normalizeCustomApiUrl,
    normalizeCustomModelsUrl,
    requestCustomCompletion,
    requestCustomModels,
    runWithRetries,
} from '../api.js';

function response(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(payload);
        },
    };
}

test('custom API URL only appends chat/completions', () => {
    assert.equal(
        normalizeCustomApiUrl('https://example.test/v1/'),
        'https://example.test/v1/chat/completions',
    );
    assert.equal(
        normalizeCustomApiUrl('https://example.test/api/v3/chat/completions'),
        'https://example.test/api/v3/chat/completions',
    );
    assert.equal(customProxyBase('https://example.test/api/v3'), 'https://example.test/api/v3');
    assert.equal(normalizeCustomModelsUrl('https://example.test/v1/'), 'https://example.test/v1/models');
});

test('custom API can pull and normalize model lists while keeping manual input possible', async () => {
    let directRequest = null;
    const direct = await requestCustomModels({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'direct-secret',
        customApiTransport: 'direct',
    }, {
        fetchImpl: async (url, options) => {
            directRequest = { url, options };
            return response({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] });
        },
        timeoutMs: 0,
    });
    assert.deepEqual(direct, ['model-a', 'model-b']);
    assert.equal(directRequest.url, 'https://example.test/v1/models');
    assert.equal(directRequest.options.headers.Authorization, 'Bearer direct-secret');

    let proxyRequest = null;
    const proxied = await requestCustomModels({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'proxy-secret',
        customApiTransport: 'proxy',
    }, {
        fetchImpl: async (url, options) => {
            proxyRequest = { url, body: JSON.parse(options.body) };
            return response({ models: ['gemini-test'] });
        },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        timeoutMs: 0,
    });
    assert.deepEqual(proxied, ['gemini-test']);
    assert.equal(proxyRequest.url, '/api/backends/chat-completions/status');
    assert.equal(proxyRequest.body.custom_url, 'https://example.test/v1');
    assert.match(proxyRequest.body.custom_include_headers, /Bearer proxy-secret/);
});

test('proxy request uses plugin URL, key and model instead of tavern selection', async () => {
    let request = null;
    const result = await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'plugin-secret',
        customApiModel: 'plugin-model',
        customApiTransport: 'proxy',
    }, [{ role: 'user', content: 'test' }], {
        fetchImpl: async (url, options) => {
            request = { url, options, body: JSON.parse(options.body) };
            return response({ choices: [{ message: { content: '{"ok":true}' } }] });
        },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'tavern-token' }),
        timeoutMs: 0,
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(request.url, '/api/backends/chat-completions/generate');
    assert.equal(request.body.custom_url, 'https://example.test/v1');
    assert.match(request.body.custom_include_headers, /Bearer plugin-secret/);
    assert.equal(request.body.model, 'plugin-model');
    assert.equal(request.body.chat_completion_source, 'custom');
    assert.equal(request.options.headers['X-CSRF-Token'], 'tavern-token');
});

test('direct request sends bearer key to the configured endpoint', async () => {
    let request = null;
    const result = await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'direct-secret',
        customApiModel: 'direct-model',
        customApiTransport: 'direct',
    }, [{ role: 'user', content: 'test' }], {
        fetchImpl: async (url, options) => {
            request = { url, options };
            return response({
                choices: [{ message: { content: [{ type: 'text', text: 'done' }] } }],
            });
        },
        timeoutMs: 0,
    });

    assert.equal(result, 'done');
    assert.equal(request.url, 'https://example.test/v1/chat/completions');
    assert.equal(request.options.headers.Authorization, 'Bearer direct-secret');
});

test('completion text extraction supports string and array content', () => {
    assert.equal(
        extractCompletionText({ choices: [{ message: { content: 'hello' } }] }),
        'hello',
    );
    assert.equal(
        extractCompletionText({
            choices: [{
                message: {
                    content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
                },
            }],
        }),
        'ab',
    );
    assert.equal(
        extractCompletionFinishReason({ choices: [{ finish_reason: 'length' }] }),
        'length',
    );
    assert.equal(
        extractCompletionText({
            output: [{ content: [{ type: 'output_text', text: { value: 'responses-text' } }] }],
        }),
        'responses-text',
    );
    assert.equal(
        extractCompletionText({ choices: [{ message: { output_text: 'message-output' } }] }),
        'message-output',
    );
});

test('DeepSeek V4 disables thinking and uses the tavern DeepSeek proxy path', async () => {
    let proxyRequest = null;
    const result = await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'deepseek-secret',
        customApiModel: 'deepseek-v4-flash',
        customApiTransport: 'proxy',
    }, [{ role: 'user', content: 'return json' }], {
        fetchImpl: async (url, options) => {
            proxyRequest = { url, body: JSON.parse(options.body) };
            return response({ choices: [{ message: { content: '{"ok":true}' } }] });
        },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        timeoutMs: 0,
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(proxyRequest.url, '/api/backends/chat-completions/generate');
    assert.equal(proxyRequest.body.chat_completion_source, 'deepseek');
    assert.equal(proxyRequest.body.include_reasoning, false);
    assert.deepEqual(proxyRequest.body.thinking, { type: 'disabled' });
    // The tavern dispatcher only forwards `thinking` when it sees this key.
    assert.equal(proxyRequest.body.reasoning_effort, 'none');
});

test('DeepSeek V4 direct mode also requests non-thinking output', async () => {
    let requestBody = null;
    await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'deepseek-secret',
        customApiModel: 'deepseek-v4-flash',
        customApiTransport: 'direct',
    }, [{ role: 'user', content: 'return json' }], {
        fetchImpl: async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return response({ choices: [{ message: { content: '{"ok":true}' } }] });
        },
        timeoutMs: 0,
    });
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
});

test('custom API preserves non-empty output when provider reports its token limit', async () => {
    const partial = await requestCustomCompletion({
            customApiUrl: 'https://example.test/v1',
            customApiKey: 'plugin-secret',
            customApiModel: 'plugin-model',
            customApiTransport: 'direct',
        }, [{ role: 'user', content: 'test' }], {
            fetchImpl: async () => response({
                choices: [{
                    finish_reason: 'MAX_TOKENS',
                    message: { content: '{"elapsed_minutes":8' },
                }],
            }),
            timeoutMs: 0,
        });
    assert.equal(partial, '{"elapsed_minutes":8');

    await assert.rejects(
        () => requestCustomCompletion({
            customApiUrl: 'https://example.test/v1',
            customApiKey: 'plugin-secret',
            customApiModel: 'plugin-model',
            customApiTransport: 'direct',
        }, [{ role: 'user', content: 'test' }], {
            fetchImpl: async () => response({
                choices: [{ finish_reason: 'MAX_TOKENS', message: { content: '' } }],
            }),
            timeoutMs: 0,
        }),
        /输出达到长度上限.*MAX_TOKENS.*没有返回可恢复的正文/,
    );
});

test('custom API errors are surfaced and never fall back silently', async () => {
    let calls = 0;
    await assert.rejects(
        () => requestCustomCompletion({
            customApiUrl: 'https://example.test/v1',
            customApiKey: 'wrong-key',
            customApiModel: 'plugin-model',
            customApiTransport: 'proxy',
        }, [{ role: 'user', content: 'test' }], {
            fetchImpl: async () => {
                calls += 1;
                return response({ error: { message: 'invalid api key' } }, 401);
            },
            getRequestHeaders: () => ({}),
            timeoutMs: 0,
        }),
        /HTTP 401.*invalid api key/,
    );
    assert.equal(calls, 1);
});

test('failed simulation requests retry the same operation without hiding the final error', async () => {
    let calls = 0;
    const retries = [];
    const attempts = [];
    const result = await runWithRetries(async attempt => {
        attempts.push(attempt);
        calls += 1;
        if (calls < 3) throw new Error(`temporary-${calls}`);
        return 'valid-json';
    }, {
        retries: 2,
        delayMs: 0,
        wait: async () => undefined,
        onRetry: detail => retries.push(detail.attempt),
    });

    assert.equal(result, 'valid-json');
    assert.equal(calls, 3);
    assert.deepEqual(attempts, [0, 1, 2]);
    assert.deepEqual(retries, [1, 2]);

    await assert.rejects(
        () => runWithRetries(async () => {
            throw new Error('still-broken');
        }, {
            retries: 1,
            delayMs: 0,
            wait: async () => undefined,
        }),
        /still-broken/,
    );

    let deterministicCalls = 0;
    await assert.rejects(
        () => runWithRetries(async () => {
            deterministicCalls += 1;
            throw new Error('HTTP 401: invalid key');
        }, {
            retries: 3,
            delayMs: 0,
            shouldRetry: error => !/HTTP 401/.test(error.message),
        }),
        /invalid key/,
    );
    assert.equal(deterministicCalls, 1);
});

test('user cancellation aborts the active request and never retries it', async () => {
    const requestController = new AbortController();
    let requestCalls = 0;
    const request = requestCustomCompletion({
        customApiUrl: 'https://example.com/v1',
        customApiKey: 'secret',
        customApiModel: 'test-model',
        customApiTransport: 'direct',
    }, [{ role: 'user', content: 'simulate' }], {
        signal: requestController.signal,
        timeoutMs: 0,
        fetchImpl: async (_url, options) => {
            requestCalls += 1;
            return await new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                }, { once: true });
            });
        },
    });
    requestController.abort();
    await assert.rejects(request, error => error?.name === 'AbortError');
    assert.equal(requestCalls, 1);

    const retryController = new AbortController();
    let retryCalls = 0;
    await assert.rejects(
        () => runWithRetries(async () => {
            retryCalls += 1;
            throw new Error('temporary');
        }, {
            retries: 3,
            delayMs: 1000,
            signal: retryController.signal,
            onRetry: () => retryController.abort(),
        }),
        error => error?.name === 'AbortError' && /取消/.test(error.message),
    );
    assert.equal(retryCalls, 1);
});
