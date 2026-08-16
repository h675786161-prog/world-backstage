import fs from 'node:fs';

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: whole-day precision follow-up applied`);
}

const authorityPath = 'world-clock-authority.js';
let authority = fs.readFileSync(authorityPath, 'utf8');
const authorityBefore = authority;

const oldPrecisionBlock = `            if (transition.daypart) {
                precision = 'daypart';
                resolvedDaypart = transition.daypart;
            } else if (!wholeDayShift && precision === 'daypart') {
                // Exact minute precision survives exact elapsed duration. A fuzzy
                // daypart does not remain trustworthy after an arbitrary duration.
                precision = coarsePrecision;
                resolvedDaypart = '';
            }`;

const newPrecisionBlock = `            if (transition.daypart) {
                precision = 'daypart';
                resolvedDaypart = transition.daypart;
            } else if (wholeDayShift) {
                // A whole-day/date jump proves which day the world reached, but it
                // does not prove that the old clock minute survived unchanged. Keep
                // the internal minute only as a calculation coordinate and lower the
                // exposed fact precision so stale exact time cannot propagate.
                precision = coarsePrecision;
                resolvedDaypart = '';
            } else if (precision === 'daypart') {
                // An exact elapsed duration can preserve exact-minute precision, but
                // a fuzzy daypart cannot remain authoritative after arbitrary time.
                precision = coarsePrecision;
                resolvedDaypart = '';
            }`;

if (authority.includes(oldPrecisionBlock)) {
    authority = authority.replace(oldPrecisionBlock, newPrecisionBlock);
} else if (!authority.includes(newPrecisionBlock)) {
    throw new Error('missing narrative precision transition block');
}
writeIfChanged(authorityPath, authorityBefore, authority);

const testsPath = 'tests/world-clock-authority.test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
const testsBefore = tests;
const marker = "test('whole-day transition drops stale minute precision instead of inventing a clock time'";

if (!tests.includes(marker)) {
    tests += `\n\ntest('whole-day transition drops stale minute precision instead of inventing a clock time', () => {\n    const base = day(3) + 9 * 60 + 17;\n    const result = resolveNarrativeTimeTransition('第二天，她去了学校。', {\n        currentAbsoluteMinute: base,\n        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },\n        calendarBound: true,\n        currentPrecision: 'minute',\n    });\n    assert.ok(result);\n    // The minute coordinate is retained internally for deterministic arithmetic,\n    // but it is no longer an asserted fact after a coarse whole-day jump.\n    assert.equal(result.targetAbsoluteMinute, day(4) + 9 * 60 + 17);\n    assert.equal(result.precision, 'date');\n    assert.equal(result.daypart, '');\n});\n\ntest('unbound whole-day transition falls back to story-day precision', () => {\n    const base = day(3) + 9 * 60 + 17;\n    const result = resolveNarrativeTimeTransition('隔天，她才重新出门。', {\n        currentAbsoluteMinute: base,\n        calendarBound: false,\n        currentPrecision: 'minute',\n    });\n    assert.ok(result);\n    assert.equal(result.targetAbsoluteMinute, day(4) + 9 * 60 + 17);\n    assert.equal(result.precision, 'day');\n    assert.equal(result.daypart, '');\n});\n\ntest('explicit daypart on a whole-day transition replaces stale minute precision', () => {\n    const base = day(3) + 9 * 60 + 17;\n    const result = resolveNarrativeTimeTransition('第二天下午，她去了学校。', {\n        currentAbsoluteMinute: base,\n        currentCalendar: { year: 2138, month: 1, dayOfMonth: 3 },\n        calendarBound: true,\n        currentPrecision: 'minute',\n    });\n    assert.ok(result);\n    assert.equal(result.targetAbsoluteMinute, day(4) + 15 * 60);\n    assert.equal(result.precision, 'daypart');\n    assert.equal(result.daypart, '下午');\n});\n`;
}
writeIfChanged(testsPath, testsBefore, tests);

const coreTestsPath = 'tests/world-clock-core.test.mjs';
let coreTests = fs.readFileSync(coreTestsPath, 'utf8');
const coreTestsBefore = coreTests;
const coreMarker = "test('core does not propagate stale minute precision across a coarse next-day jump'";

if (!coreTests.includes(coreMarker)) {
    coreTests += `\n\ntest('core does not propagate stale minute precision across a coarse next-day jump', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 3 * 24 * 60 + 9 * 60 + 17;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = true;\n    state.clock.precision = 'minute';\n    state.clock.daypart = '';\n    const before = state.clock.absoluteMinute;\n\n    state = applySimulationResult(state, minimalPayload(), {\n        messageId: 89,\n        sourceKey: 'test:coarse-next-day',\n        timePolicy: 'world',\n        narrativeText: '第二天，她去了学校。',\n    });\n\n    assert.equal(state.clock.absoluteMinute, before + 24 * 60);\n    assert.equal(state.clock.precision, 'date');\n    assert.equal(state.clock.daypart, '');\n});\n`;
}
writeIfChanged(coreTestsPath, coreTestsBefore, coreTests);
