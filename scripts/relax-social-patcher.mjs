import fs from 'node:fs';

const path = 'scripts/apply-social-memory-swipe-fixes.mjs';
let source = fs.readFileSync(path, 'utf8');

function replaceSection(startMarker, endMarker, replacement) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error(`patch markers not found: ${startMarker}`);
    source = source.slice(0, start) + replacement + source.slice(end);
}

replaceSection(
    '// 2) Swiping is browsing, not acceptance. Persist a pending branch, but do not call the model until play continues.',
    '// 3) Memory UI needs a real summary-coverage signal, not only the index cursor.',
    `// 2) Swiping is browsing, not acceptance. Do not call the model just because a swipe was selected.
index = replaceOnce(
    index,
    /\\r?\\n\\s*if \\(message\\.mes && message\\.mes !== '\\.\\.\\.' && getSettings\\(\\)\\.worldAutoEnabled\\) \\{\\s*scheduleAutoSync\\(Number\\(messageId\\), 'swipe'\\);\\s*\\}/,
    '',
    'remove swipe auto-sync',
);

`,
);

replaceSection(
    '// 3) Memory UI needs a real summary-coverage signal, not only the index cursor.',
    '// 4) Social autonomy gets its own due gate. No every-reply model call.',
    `// 3) Memory UI needs a real summary-coverage signal, not only the index cursor.
index = replaceOnce(
    index,
    /(\\s*pendingRollup:\\s*Boolean\\(planMemoryRollup\\(state\\)\\),\\r?\\n)/,
    \`$1            latestSummaryMessageId: Math.max(\n                -1,\n                ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),\n            ),\n            summaryBehind: (() => {\n                const indexedThrough = Number(state.storyMemory?.indexedThroughMessageId ?? -1);\n                const latestSummaryMessageId = Math.max(\n                    -1,\n                    ...(state.storyMemory?.summaries || []).map(summary => Number(summary?.endMessageId ?? -1)),\n                );\n                return indexedThrough >= 0 && latestSummaryMessageId < indexedThrough;\n            })(),\n\`,
    'memory summary coverage fields',
);

`,
);

source = source.replace("    assert.match(swipeBlock, /trigger: 'swipe-selected'/);\n", '');
fs.writeFileSync(path, source);
console.log('Adjusted swipe and memory patchers to current branch layout.');
