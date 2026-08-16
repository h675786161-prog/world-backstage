import fs from 'node:fs';

const path = 'scripts/apply-world-clock-authority.mjs';
let source = fs.readFileSync(path, 'utf8');

const oldBraceLogic = `    const braceStart = source.indexOf('{', start + signature.length);\n    if (braceStart < 0) throw new Error(\`missing function brace \${signature}\`);`;
const newBraceLogic = `    const bodyMarker = source.indexOf(') {', start + signature.length);\n    if (bodyMarker < 0) throw new Error(\`missing function body \${signature}\`);\n    const braceStart = bodyMarker + 2;`;
if (!source.includes(oldBraceLogic)) {
    throw new Error('prepare patcher: function body locator not found');
}
source = source.replace(oldBraceLogic, newBraceLogic);

const oldBlock = `core = replaceOnce(\n    core,\n    "    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n    "    const clockAuthorityRule = '绝对日期、星期和精确钟点由插件的确定性时间权威层处理。clock_anchor.mode 必须返回 none；不要猜年月日、星期或当前几点。你只负责 elapsed_minutes（本批 new=true 正文真正经过的时长）和 time_reason。正文已经明确写出的时间证据会由插件代码单独解析。';\\n    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n    'simulation clock rule constant',\n);\ncore = replaceOnce(\n    core,\n    '        timeRule,',\n    '        timeRule,\\n        clockAuthorityRule,',\n    'simulation clock rule injection',\n);`;

const newBlock = `{\n    const block = functionBlock(core, 'export function buildSimulationPrompt');\n    let simulation = block.text;\n    simulation = replaceOnce(\n        simulation,\n        "    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n        "    const clockAuthorityRule = '绝对日期、星期和精确钟点由插件的确定性时间权威层处理。clock_anchor.mode 必须返回 none；不要猜年月日、星期或当前几点。你只负责 elapsed_minutes（本批 new=true 正文真正经过的时长）和 time_reason。正文已经明确写出的时间证据会由插件代码单独解析。';\\n    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n        'simulation clock rule constant',\n    );\n    simulation = replaceOnce(\n        simulation,\n        '        timeRule,',\n        '        timeRule,\\n        clockAuthorityRule,',\n        'simulation clock rule injection',\n    );\n    core = core.slice(0, block.start) + simulation + core.slice(block.end);\n}`;

if (!source.includes(oldBlock)) {
    throw new Error('prepare patcher: target block not found');
}
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source, 'utf8');
console.log('patcher function boundaries and prompt scope prepared');
