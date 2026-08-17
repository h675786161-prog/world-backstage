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

replaceSection(
    '// 5) Make the social autonomy switch visible and memory status truthful.',
    "fs.writeFileSync('index.js', index);",
    `// 5) Make the social autonomy switch visible and memory status truthful.
ui = replaceOnce(
    ui,
    /(\\r?\\n\\s*)<div class="wb-settings-common-hint">/,
    \`$1<div class="wb-setting-toggle">
                        <div>
                            <strong>通讯自主活动</strong>
                            <span>关掉后，人物不会自己发消息、好友申请、删好友或发朋友圈；已有通讯录和你手动聊天仍然保留。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="socialAutoEnabled"
                                \\\${settings.socialAutoEnabled !== false ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>$1<div class="wb-settings-common-hint">\`,
    'visible social autonomy switch',
);

ui = replaceOnce(
    ui,
    /<span>\\$\\{historyRunning \\? \\`\\$\\{historyPercent\\}%\\` : \\(Number\\(memory\\.pendingAssistantResponses \\|\\| 0\\) > 0 \\? '有新的东西等我收～' : '我已经跟上正文啦～'\\)\\}<\\/span>/,
    \`<span>\\${historyRunning
                        ? \\`\\${historyPercent}%\\`
                        : Number(memory.pendingAssistantResponses || 0) > 0
                            ? '有新的东西等我收～'
                            : memory.summaryBehind
                                ? \\`长期摘要还停在第 \\${Math.max(0, Number(memory.latestSummaryMessageId || 0))} 层\\`
                                : memory.pendingRollup
                                    ? '长期摘要还在等我压一层～'
                                    : '长期记忆已追平正文～'}</span>\`,
    'truthful long-memory status',
);

`,
);

source = source.replace("    assert.match(swipeBlock, /trigger: 'swipe-selected'/);\n", '');
fs.writeFileSync(path, source);
console.log('Adjusted swipe, memory and UI patchers to current branch layout.');
