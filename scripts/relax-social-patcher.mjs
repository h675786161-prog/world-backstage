import fs from 'node:fs';

const path = 'scripts/apply-social-memory-swipe-fixes.mjs';
let source = fs.readFileSync(path, 'utf8');
const startMarker = '// 2) Swiping is browsing, not acceptance. Persist a pending branch, but do not call the model until play continues.';
const endMarker = '// 3) Memory UI needs a real summary-coverage signal, not only the index cursor.';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('swipe patch markers not found');
const replacement = `// 2) Swiping is browsing, not acceptance. Do not call the model just because a swipe was selected.
index = replaceOnce(
    index,
    /\\n\\s*if \\(message\\.mes && message\\.mes !== '\\.\\.\\.' && getSettings\\(\\)\\.worldAutoEnabled\\) \\{\\s*scheduleAutoSync\\(Number\\(messageId\\), 'swipe'\\);\\s*\\}/,
    '',
    'remove swipe auto-sync',
);

// A selected alternate swipe may have no stored branch snapshot yet. Treat it as pending
// when the user actually continues from it, so the next normal world batch can include it.
index = replaceOnce(
    index,
    \`        const branch = branchDataFromMessage(message);\n        if (!branch) continue;\n        if (branch?.status === 'committed' && !branch.stale) continue;\n        entries.push({ message, index });\`,
    \`        const branch = branchDataFromMessage(message);\n        if (branch?.status === 'committed' && !branch.stale) continue;\n        entries.push({ message, index });\`,
    'branchless selected swipe remains pending',
);

`;
source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace("    assert.match(swipeBlock, /trigger: 'swipe-selected'/);\n", '');
source = source.replace(
    "    assert.doesNotMatch(swipeBlock, /scheduleAutoSync\\\\(Number\\\\(messageId\\\\), 'swipe'\\\\)/);\n",
    "    assert.doesNotMatch(swipeBlock, /scheduleAutoSync\\\\(Number\\\\(messageId\\\\), 'swipe'\\\\)/);\n    assert.doesNotMatch(index, /const branch = branchDataFromMessage\\\\(message\\\\);\\\\s*if \\\\(!branch\\\\) continue;/);\n",
);
fs.writeFileSync(path, source);
console.log('Relaxed swipe patch to current branch layout.');
