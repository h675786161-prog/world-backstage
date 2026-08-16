import fs from 'node:fs';

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: clue timing granularity hardened`);
}

const authorityPath = 'world-clock-authority.js';
let source = fs.readFileSync(authorityPath, 'utf8');
const before = source;

source = source.replace(
    `            type: 'absolute-date',\n            date: { year: explicit.year, month: explicit.month, day: explicit.day },`,
    `            type: 'absolute-date',\n            index: explicit.index,\n            date: { year: explicit.year, month: explicit.month, day: explicit.day },`,
);
source = source.replace(
    `    return { type: earliest.type, match: earliest.match, sourceText: earliest.match[0] };`,
    `    return { type: earliest.type, match: earliest.match, index: earliest.index, sourceText: earliest.match[0] };`,
);

const oldTimingBlock = `    const nearby = String(text || '');\n    const daypart = latestDaypart(nearby)?.label || '';\n    const exact = latestExactClock(nearby);\n    const desiredMinute = exact\n        ? exact.hour * 60 + exact.minute\n        : daypartMinute(daypart);\n    const precision = exact ? 'minute' : daypart ? 'daypart' : 'date';`;
const newTimingBlock = `    const nearby = String(text || '');\n    const expressionIndex = Math.max(0, Number(expression.index ?? expression.match?.index ?? 0));\n    const expressionEnd = Math.min(nearby.length, expressionIndex + String(expression.sourceText || '').length);\n    const tail = nearby.slice(expressionEnd);\n    const boundaryOffset = tail.search(/[。！？!?；;\\n]/u);\n    const localEnd = boundaryOffset >= 0\n        ? expressionEnd + boundaryOffset\n        : nearby.length;\n    // Attach a clock/daypart only when it belongs to the same clause as the\n    // chosen future expression. An unrelated 09:00 elsewhere in the evidence\n    // must never turn a date-only promise into a fake 09:00 appointment.\n    const localTimingScope = nearby.slice(expressionIndex, localEnd);\n    const relativeWord = expression.type === 'relative-word' ? String(expression.match?.[1] || '') : '';\n    const implicitDaypart = relativeWord === '今晚' || relativeWord === '明晚'\n        ? '晚上'\n        : relativeWord === '明早'\n            ? '早晨'\n            : relativeWord === '明晨'\n                ? '清晨'\n                : '';\n    const daypart = latestDaypart(localTimingScope)?.label || implicitDaypart;\n    const exact = latestExactClock(localTimingScope);\n    const desiredMinute = exact\n        ? exact.hour * 60 + exact.minute\n        : daypartMinute(daypart);\n    const precision = exact ? 'minute' : daypart ? 'daypart' : 'date';`;

if (source.includes(oldTimingBlock)) {
    source = source.replace(oldTimingBlock, newTimingBlock);
} else if (!source.includes('const localTimingScope = nearby.slice(expressionIndex, localEnd);')) {
    throw new Error('missing future timing association block');
}

source = source.replace(
    `        targetWorldMinute: targetMinuteForDay(baseMinute, dayDelta, desiredMinute),`,
    `        // Date-only clues become eligible at the start of their target day.\n        // Midnight is an internal threshold, not an asserted occurrence time; the\n        // exposed precision remains \"date\". Preserving the creation clock here\n        // would incorrectly delay a \"明天\" clue until that same hour tomorrow.\n        targetWorldMinute: targetMinuteForDay(baseMinute, dayDelta, desiredMinute ?? 0),`,
);

writeIfChanged(authorityPath, before, source);

const testsPath = 'tests/world-clock-authority.test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
const testsBefore = tests;

// The old regression encoded a stronger fact than the text actually supplied:
// “后天” identifies a target day, not the creation clock time two days later.
tests = tests.replace(
    `test('clue relative day is anchored at creation world minute', () => {`,
    `test('clue relative day stays anchored to its creation day without inventing a clock time', () => {`,
);
tests = tests.replace(
    `    assert.equal(timing.targetWorldMinute, day(12) + 9 * 60);\n    assert.deepEqual(timing.targetDate, { year: 2138, month: 8, day: 14 });`,
    `    assert.equal(timing.targetWorldMinute, day(12));\n    assert.equal(timing.anchoredAtWorldMinute, base);\n    assert.equal(timing.precision, 'date');\n    assert.deepEqual(timing.targetDate, { year: 2138, month: 8, day: 14 });`,
);

const marker = "test('date-only future clue uses target-day threshold without inventing creation clock'";
if (!tests.includes(marker)) {
    tests += `\n\ntest('date-only future clue uses target-day threshold without inventing creation clock', () => {\n    const base = day(10) + 15 * 60 + 17;\n    const timing = resolveFutureTimeExpression('明天复诊。', {\n        baseAbsoluteMinute: base,\n        calendarBound: false,\n    });\n    assert.ok(timing);\n    assert.equal(timing.precision, 'date');\n    assert.equal(timing.targetWorldMinute, day(11));\n});\n\ntest('relative words with built-in dayparts keep that factual daypart', () => {\n    const base = day(10) + 15 * 60 + 17;\n    const morning = resolveFutureTimeExpression('明早去复诊。', {\n        baseAbsoluteMinute: base,\n        calendarBound: false,\n    });\n    const evening = resolveFutureTimeExpression('明晚再联系。', {\n        baseAbsoluteMinute: base,\n        calendarBound: false,\n    });\n    assert.ok(morning);\n    assert.equal(morning.precision, 'daypart');\n    assert.equal(morning.daypart, '早晨');\n    assert.equal(morning.targetWorldMinute, day(11) + 7 * 60);\n    assert.ok(evening);\n    assert.equal(evening.precision, 'daypart');\n    assert.equal(evening.daypart, '晚上');\n    assert.equal(evening.targetWorldMinute, day(11) + 20 * 60);\n});\n\ntest('future clue does not steal an unrelated clock from another sentence', () => {\n    const base = day(10) + 15 * 60 + 17;\n    const timing = resolveFutureTimeExpression('明天复诊。今天09:00出的报告记得带上。', {\n        baseAbsoluteMinute: base,\n        calendarBound: false,\n    });\n    assert.ok(timing);\n    assert.equal(timing.precision, 'date');\n    assert.equal(timing.targetWorldMinute, day(11));\n    assert.equal(timing.daypart, '');\n});\n`;
}
writeIfChanged(testsPath, testsBefore, tests);

const coreTestsPath = 'tests/world-clock-core.test.mjs';
let coreTests = fs.readFileSync(coreTestsPath, 'utf8');
const coreTestsBefore = coreTests;
coreTests = coreTests.replace(
    `    assert.equal(clue.timing.relativeLabel, '后天');\n    assert.equal(clue.timing.targetWorldMinute - clue.timing.anchoredAtWorldMinute, 2 * 24 * 60);`,
    `    assert.equal(clue.timing.relativeLabel, '后天');\n    assert.equal(clue.timing.precision, 'date');\n    assert.equal(\n        Math.floor(clue.timing.targetWorldMinute / (24 * 60)),\n        Math.floor(clue.timing.anchoredAtWorldMinute / (24 * 60)) + 2,\n    );\n    assert.equal(clue.timing.targetWorldMinute % (24 * 60), 0);`,
);
writeIfChanged(coreTestsPath, coreTestsBefore, coreTests);
