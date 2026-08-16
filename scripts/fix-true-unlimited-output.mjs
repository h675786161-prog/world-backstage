import fs from 'node:fs';

function eolFor(text) {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

function block(lines, eol) {
    return lines.join(eol);
}

function replaceOnce(text, before, after, label) {
    const count = text.split(before).length - 1;
    if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
    return text.replace(before, after);
}

let index = fs.readFileSync('index.js', 'utf8');
const indexEol = eolFor(index);
index = replaceOnce(index,
    block([
        '    const maxTokens = tokenCap > 0',
        '        ? Math.max(64, Math.min(requested, tokenCap))',
        '        : requested;',
    ], indexEol),
    block([
        '    // A task\'s requestedMaxTokens is only a sizing hint. In automatic mode the',
        '    // plugin must not turn that hint into a hard response cap. Only an explicit',
        '    // user-configured positive limit is sent as a token ceiling.',
        '    const maxTokens = tokenCap > 0',
        '        ? Math.max(64, Math.round(tokenCap))',
        '        : 0;',
    ], indexEol),
    'resolveGenerationLimits',
);

index = replaceOnce(index,
    block([
        '                effectiveMaxTokens,',
        '                {',
        '                    stream: false,',
    ], indexEol),
    block([
        '                effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined,',
        '                {',
        '                    stream: false,',
    ], indexEol),
    'connection manager maxTokens',
);

const responseLengthNeedle = '                responseLength: effectiveMaxTokens,';
const responseLengthCount = index.split(responseLengthNeedle).length - 1;
if (responseLengthCount < 1 || responseLengthCount > 2) {
    throw new Error(`responseLength: expected 1-2 matches, got ${responseLengthCount}`);
}
index = index.replaceAll(
    responseLengthNeedle,
    '                responseLength: effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined,',
);

index = replaceOnce(index,
    block([
        "            const capHint = limits.tokenSource === 'module'",
        "                ? '当前模块 Token 上限限制了这次请求'",
        "                : limits.tokenSource === 'global'",
        "                    ? '全局 Token 上限限制了这次请求'",
        "                    : '模型在本次请求上限处停止';",
        '            const wrapped = new Error(',
        '                `${String(error?.message || error)}；实际输出上限 ${effectiveMaxTokens} Token，${capHint}。`',
        "                + '这和等待秒数无关；可把对应模块 Token 上限设为 0（自动），或调高后重试。',",
        '            );',
    ], indexEol),
    block([
        '            const pluginLimited = effectiveMaxTokens > 0;',
        "            const capHint = limits.tokenSource === 'module'",
        "                ? '当前模块 Token 上限限制了这次请求'",
        "                : '全局 Token 上限限制了这次请求';",
        '            const wrapped = new Error(pluginLimited',
        '                ? `${String(error?.message || error)}；插件实际输出上限 ${effectiveMaxTokens} Token，${capHint}。可把对应 Token 上限设为 0（自动）或调高后重试。`',
        '                : `${String(error?.message || error)}；插件未设置输出 Token 上限，本次截断来自模型、上游服务或酒馆当前连接本身的输出边界。`);',
    ], indexEol),
    'output-limit error message',
);
fs.writeFileSync('index.js', index);

let api = fs.readFileSync('api.js', 'utf8');
const apiEol = eolFor(api);
api = replaceOnce(api,
    block([
        'export async function requestCustomCompletion(settings, messages, {',
        '    fetchImpl = globalThis.fetch,',
        '    getRequestHeaders = null,',
        '    maxTokens = 2200,',
    ], apiEol),
    block([
        'export async function requestCustomCompletion(settings, messages, {',
        '    fetchImpl = globalThis.fetch,',
        '    getRequestHeaders = null,',
        '    maxTokens = 0,',
    ], apiEol),
    'custom API default maxTokens',
);

api = replaceOnce(api,
    block([
        '    const body = {',
        '        model,',
        '        messages: Array.isArray(messages) ? messages : [],',
        '        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,',
        '        max_tokens: Math.max(64, Number.parseInt(maxTokens, 10) || 2200),',
        '        stream: false,',
        '    };',
    ], apiEol),
    block([
        '    const body = {',
        '        model,',
        '        messages: Array.isArray(messages) ? messages : [],',
        '        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,',
        '        stream: false,',
        '    };',
        '    const configuredMaxTokens = Number.parseInt(maxTokens, 10);',
        '    if (Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0) {',
        '        body.max_tokens = Math.max(64, configuredMaxTokens);',
        '    }',
    ], apiEol),
    'custom API max_tokens',
);
fs.writeFileSync('api.js', api);

const finalIndex = fs.readFileSync('index.js', 'utf8');
const finalApi = fs.readFileSync('api.js', 'utf8');
if (!/const maxTokens = tokenCap > 0[\s\S]*?: 0;/.test(finalIndex)) throw new Error('auto mode still has an internal token cap');
if (!finalIndex.includes('effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined')) throw new Error('connection-manager auto mode still sends a task cap');
if (!finalIndex.includes('responseLength: effectiveMaxTokens > 0 ? effectiveMaxTokens : undefined')) throw new Error('tavern auto mode still sends responseLength');
if (!finalApi.includes('maxTokens = 0,')) throw new Error('custom API still defaults to an output cap');
if (!finalApi.includes('if (Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0)')) throw new Error('custom API still forces max_tokens');
console.log('Verified: auto mode sends no plugin-side output token ceiling.');
