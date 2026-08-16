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

const newBlock = `{\n    const block = functionBlock(core, 'export function buildSimulationPrompt');\n    let simulation = block.text;\n    simulation = replaceOnce(\n        simulation,\n        "    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n        "    const clockAuthorityRule = '绝对日期、星期和精确钟点由插件的确定性时间权威层处理。clock_anchor.mode 必须返回 none；不要猜年月日、星期或当前几点。你只负责 elapsed_minutes（本批 new=true 正文真正经过的时长）和 time_reason。正文已经明确写出的时间证据会由插件代码单独解析。';\\n    const identityAnchor = modelText(playerIdentityAnchor, 400);",\n        'simulation clock rule constant',\n    );\n    const oldClockRules = [\n        '        \\`1. 主世界时间是唯一进度轴。\\${timeRule}\\`,',\n        "        '1A. clock_anchor 是绝对时间校准口。年月日与钟点可以分开成立：若正文明确给出 Y年M月D日（年份可超过四位），即使只有“清晨/下午”等模糊时段，也必须把 year/month/day 填入 clock_anchor；只有能够可靠确定具体钟点时才填写 hour/minute。minute 精度锚点表示本批 new 正文结束时的完整时间，插件不会再叠加 elapsed_minutes；date/daypart 精度只校准历法日期，elapsed_minutes 仍用于结算本批经过时长。',",\n        "        '1B. 当推演前状态 world_clock_anchored=false：必须优先扫描当前上下文，寻找最可靠的故事时间锚点并返回 clock_anchor.mode=\\\"initialize\\\"。明确年月日属于强锚点，必须同步；钟点可以由剧情证据推断，若证据不足就只返回 date/daypart 精度，不要为了凑字段编造分钟。建立后不要每轮重猜。',",\n        "        '1C. 当 world_clock_anchored=true：旧的正文时间栏只视为展示信息，可能已经滞后，不能单凭它反向覆盖主世界时钟。只有本批新正文在剧情内容里明确建立了新的绝对时间事实（例如“第二天早上七点”“看表是15:20”“三天后上午十点”），且与连续时间明显冲突或发生跳时，才返回 clock_anchor.mode=\\\"calibrate\\\"；此时 confidence 必须为 high。',",\n        "        '1D. 模糊时段只能辅助 elapsed_minutes 或首次初始化，不得在每轮把主时钟重新对齐到某个固定“清晨/晚上”钟点。',",\n    ].join('\\n');\n    const newClockRules = [\n        '        \\`1. 主世界时间是唯一进度轴。\\${timeRule}\\`,',\n        '        clockAuthorityRule,',\n        "        '1A. 世界钟无论是否已经绑定具体年月日都持续存在。没有绝对日期时沿用故事日序与已有时间精度；不要因为正文没写日期就把时间重置或停住。',",\n        "        '1B. 正文里的“明天见/下周约”等未来承诺不是当前时间已经跳转；只把本批真正发生的等待、睡眠、路程、工作与明确转场计入 elapsed_minutes。',",\n        "        '1C. clock_anchor 只是兼容返回字段，必须保持 mode=none。模型没有权限初始化或重新校准绝对世界日期。',",\n    ].join('\\n');\n    simulation = replaceOnce(\n        simulation,\n        oldClockRules,\n        newClockRules,\n        'simulation clock authority prompt rules',\n    );\n    core = core.slice(0, block.start) + simulation + core.slice(block.end);\n}`;

if (!source.includes(oldBlock)) {
    throw new Error('prepare patcher: target block not found');
}
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source, 'utf8');
console.log('patcher function boundaries and prompt rules prepared');
