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

`;
source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace("    assert.match(swipeBlock, /trigger: 'swipe-selected'/);\n", '');
fs.writeFileSync(path, source);
console.log('Narrowed swipe patch to eager-generation removal.');
