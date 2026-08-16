import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { requestCustomCompletion } from '../api.js';

function response(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        async text() {
            return JSON.stringify(payload);
        },
    };
}

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../api.js', import.meta.url), 'utf8');

test('automatic generation mode does not turn task budgets into hard token caps', () => {
    assert.match(indexSource, /const maxTokens = tokenCap > 0[\s\S]*?: 0;/);
    assert.doesNotMatch(indexSource, /const maxTokens = tokenCap > 0[\s\S]*?: requested;/);
    assert.match(indexSource, /effectiveMaxTokens > 0 \? effectiveMaxTokens : undefined/);
    assert.match(indexSource, /responseLength: effectiveMaxTokens > 0 \? effectiveMaxTokens : undefined/);
    assert.match(apiSource, /maxTokens = 0,/);
});

test('custom API omits max_tokens in automatic mode', async () => {
    let body = null;
    await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'secret',
        customApiModel: 'model',
        customApiTransport: 'direct',
    }, [{ role: 'user', content: 'test' }], {
        maxTokens: 0,
        timeoutMs: 0,
        fetchImpl: async (_url, options) => {
            body = JSON.parse(options.body);
            return response({ choices: [{ message: { content: '{"ok":true}' } }] });
        },
    });
    assert.equal(Object.hasOwn(body, 'max_tokens'), false);
});

test('custom API only sends an explicit positive user token cap', async () => {
    let body = null;
    await requestCustomCompletion({
        customApiUrl: 'https://example.test/v1',
        customApiKey: 'secret',
        customApiModel: 'model',
        customApiTransport: 'direct',
    }, [{ role: 'user', content: 'test' }], {
        maxTokens: 8192,
        timeoutMs: 0,
        fetchImpl: async (_url, options) => {
            body = JSON.parse(options.body);
            return response({ choices: [{ message: { content: '{"ok":true}' } }] });
        },
    });
    assert.equal(body.max_tokens, 8192);
});
