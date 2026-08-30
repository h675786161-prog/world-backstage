import fs from 'node:fs';

const path = 'world-clock-authority.js';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function replaceRequired(from, to, label) {
    if (text.includes(to)) return;
    if (!text.includes(from)) throw new Error(`patch target missing: ${label}`);
    text = text.replace(from, to);
}

replaceRequired(
    `{ pattern: /(大后天|后天|明天|今天|今晚|明早|明晨|明晚)/gu, type: 'relative-word' },`,
    `{ pattern: /(大后天|后天|明天|今天|今晚|明早|明晨|明晚|今日|明日|翌日|今夜)/gu, type: 'relative-word' },`,
    'expanded relative date words',
);

replaceRequired(
    `    const implicitDaypart = relativeWord === '今晚' || relativeWord === '明晚'\n        ? '晚上'`,
    `    const implicitDaypart = ['今晚', '明晚', '今夜'].includes(relativeWord)\n        ? '晚上'`,
    'night aliases',
);

replaceRequired(
    `        if (['今天', '今晚'].includes(word)) dayDelta = 0;\n        else if (['明天', '明早', '明晨', '明晚'].includes(word)) dayDelta = 1;`,
    `        if (['今天', '今晚', '今日', '今夜'].includes(word)) dayDelta = 0;\n        else if (['明天', '明早', '明晨', '明晚', '明日', '翌日'].includes(word)) dayDelta = 1;`,
    'relative date settlement aliases',
);

fs.writeFileSync(path, text);
console.log('formal relative time words patched');
