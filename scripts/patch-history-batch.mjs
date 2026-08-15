import fs from 'node:fs';

const path = 'index.js';
let source = fs.readFileSync(path, 'utf8');
const eol = source.includes('\r\n') ? '\r\n' : '\n';

function replaceOnce(pattern, replacement, label) {
    const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
    if (matches.length !== 1) {
        throw new Error(`${label}: expected exactly one match, found ${matches.length}`);
    }
    source = source.replace(pattern, replacement);
}

replaceOnce(
    /function nextHistoryBatch\(cursor, \{\r?\n    maximumCharacters = 24000,\r?\n    maximumUserTurns = 8,\r?\n    maximumAssistantTurns = 6,\r?\n\} = \{\}\) \{/,
    [
        'function nextHistoryBatch(cursor, {',
        '    maximumCharacters = 24000,',
        '    maximumUserTurns = 10,',
        '    maximumAssistantTurns = 10,',
        '} = {}) {',
    ].join(eol),
    'history batch defaults',
);

replaceOnce(
    /    let assistantBatchLimit = checkpoint\r?\n        \? Math\.max\(1, Number\.parseInt\(checkpoint\.assistantBatchLimit, 10\) \|\| 1\)\r?\n        : 4;/,
    [
        '    // Start every history bootstrap at the normal batching target. A previous',
        '    // oversized batch may have been split to 1/2/5 temporarily; that adaptive',
        '    // fallback is not a user preference and must never poison a resume checkpoint.',
        '    const preferredAssistantBatchLimit = 10;',
        '    let assistantBatchLimit = preferredAssistantBatchLimit;',
    ].join(eol),
    'bootstrap preferred batch limit',
);

replaceOnce(
    /                    assistantBatchLimit = Math\.max\(1, Math\.floor\(assistantTurns \/ 2\)\);\r?\n                    runtime\.historyProgress\.message = `输出太胖了～自动缩成每批 \$\{assistantBatchLimit\} 轮再来`;/,
    [
        '                    assistantBatchLimit = Math.max(1, Math.floor(assistantTurns / 2));',
        '                    runtime.historyProgress.message = `这批输出太胖了～仅当前段临时缩成每批 ${assistantBatchLimit} 轮再来`;',
    ].join(eol),
    'bootstrap split message',
);

replaceOnce(
    /            cursor = batch\.nextCursor;\r?\n            saveHistoryBootstrapCheckpoint\(\{/,
    [
        '            cursor = batch.nextCursor;',
        '            // A successful smaller retry proves only that this one chunk was fat.',
        '            // Restore normal batching immediately so the remaining backlog does not',
        '            // degenerate into one API request per message.',
        '            assistantBatchLimit = preferredAssistantBatchLimit;',
        '            saveHistoryBootstrapCheckpoint({',
    ].join(eol),
    'bootstrap reset after success',
);

replaceOnce(
    /        let assistantBatchLimit = automatic\r?\n            \? Math\.min\(6, Math\.max\(1, getSettings\(\)\.memoryAutoIndexInterval\)\)\r?\n            : 6;/,
    [
        '        const preferredAssistantBatchLimit = automatic',
        '            ? Math.min(10, Math.max(1, getSettings().memoryAutoIndexInterval))',
        '            : 10;',
        '        let assistantBatchLimit = preferredAssistantBatchLimit;',
    ].join(eol),
    'memory preferred batch limit',
);

replaceOnce(
    /                    assistantBatchLimit = Math\.max\(1, Math\.floor\(assistantTurns \/ 2\)\);\r?\n                    runtime\.historyProgress\.message = `输出过长或为空，已自动缩小为每批 \$\{assistantBatchLimit\} 轮后重试`;/,
    [
        '                    assistantBatchLimit = Math.max(1, Math.floor(assistantTurns / 2));',
        '                    runtime.historyProgress.message = `当前这批输出过长或为空，临时缩小为每批 ${assistantBatchLimit} 轮后重试`;',
    ].join(eol),
    'memory split message',
);

replaceOnce(
    /            cursor = batch\.nextCursor;\r?\n            completedBatches \+= 1;/,
    [
        '            cursor = batch.nextCursor;',
        '            assistantBatchLimit = preferredAssistantBatchLimit;',
        '            completedBatches += 1;',
    ].join(eol),
    'memory reset after success',
);

fs.writeFileSync(path, source, 'utf8');
console.log('history batch policy patched successfully');
