import test from 'node:test';
import assert from 'node:assert/strict';

import {
    customProxyBase,
    extractCompletionText,
    normalizeCustomApiUrl,
    requestCustomCompletion,
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
    assert.equal(request.body.reverse_proxy, 'https://example.test/v1');
    assert.equal(request.body.proxy_password, 'plugin-secret');
    assert.equal(request.body.model, 'plugin-model');
    assert.equal(request.body.chat_completion_source, 'openai');
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
    const result = await runWithRetries(async () => {
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
