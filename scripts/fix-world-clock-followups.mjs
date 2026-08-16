import fs from 'node:fs';

function replaceOnceIfPresent(source, needle, replacement, label) {
    const first = source.indexOf(needle);
    if (first < 0) return source;
    if (source.indexOf(needle, first + needle.length) >= 0) {
        throw new Error(`ambiguous ${label}`);
    }
    return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error(`missing start ${label}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error(`missing end ${label}`);
    return source.slice(0, start) + replacement.trimEnd() + source.slice(end);
}

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: follow-up fixes applied`);
}

const transitionCandidates = String.raw`function transitionCandidates(text = '') {
    const source = String(text || '');
    const candidates = [];
    const boundary = '(?:^|[。！？!?；;\\n])\\s*';
    const sequencePrefix = '(?:(?:随后|接着|然后|之后|此后)\\s*)?(?:又\\s*|再\\s*)?';
    const daypart = '(凌晨|黎明|清晨|早晨|上午|中午|午后|下午|傍晚|黄昏|晚上|夜晚|深夜)?';
    const add = (pattern, mapper) => {
        for (const match of source.matchAll(pattern)) {
            const candidate = mapper(match);
            if (candidate) candidates.push({ ...candidate, index: Number(match.index || 0), sourceText: match[0].trim() });
        }
    };

    add(new RegExp(`${boundary}${sequencePrefix}(次日|翌日|第二天|隔天)(?:的)?\\s*${daypart}`, 'gu'), match => ({
        dayDelta: 1,
        daypart: match[2] || '',
        confidence: 'high',
    }));

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?|醒来时(?:已经)?|一觉醒来(?:已经)?)\\s*(明天|后天|大后天)\\s*${daypart}`, 'gu'), match => ({
        dayDelta: match[1] === '明天' ? 1 : match[1] === '后天' ? 2 : 3,
        daypart: match[2] || '',
        confidence: 'high',
    }));

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?|经过|过了)\\s*(\\d+|[一二两三四五六七八九十]+)\\s*(分钟|小时|天|日)(?:后)?\\s*${daypart}`, 'gu'), match => {
        const count = chineseInteger(match[1]);
        if (!Number.isFinite(count) || count < 0) return null;
        if (match[2] === '分钟') return { minuteDelta: count, daypart: match[3] || '', confidence: 'high' };
        if (match[2] === '小时') return { minuteDelta: count * 60, daypart: match[3] || '', confidence: 'high' };
        return { dayDelta: count, daypart: match[3] || '', confidence: 'high' };
    });

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?)\\s*(下周|本周)?(?:周|星期)([一二三四五六日天])\\s*${daypart}`, 'gu'), match => ({
        weekdayMode: match[1] === '下周' ? 'next-week' : match[1] === '本周' ? 'this-week' : 'next-occurrence',
        weekday: WEEKDAY_INDEX[match[2]],
        daypart: match[3] || '',
        confidence: 'high',
    }));

    return candidates.sort((a, b) => a.index - b.index);
}`;

const narrativeTransition = String.raw`export function resolveNarrativeTimeTransition(text = '', {
    currentAbsoluteMinute = 0,
    currentCalendar = null,
    calendarBound = false,
    narrativeAnchor = null,
    currentPrecision = 'day',
    currentDaypart = '',
} = {}) {
    const source = String(text || '');
    const structuredScope = extractStructuredTimeScope(source);
    const baseAbsoluteMinute = Math.max(0, integer(currentAbsoluteMinute, 0));
    const currentDate = normalizeDate({
        year: currentCalendar?.year,
        month: currentCalendar?.month,
        day: currentCalendar?.dayOfMonth ?? currentCalendar?.day,
    });

    const exact = narrativeAnchor?.hour !== null && narrativeAnchor?.hour !== undefined
        && narrativeAnchor?.minute !== null && narrativeAnchor?.minute !== undefined
        ? {
            hour: Number(narrativeAnchor.hour),
            minute: Number(narrativeAnchor.minute),
            sourceText: narrativeAnchor.excerpt || '',
        }
        : (structuredScope ? latestExactClock(structuredScope) : null);
    const anchorDaypart = String(narrativeAnchor?.daypart || '').trim();
    const structuredDaypart = anchorDaypart || latestDaypart(structuredScope)?.label || '';

    if (structuredScope && exact) {
        const target = dayIndex(baseAbsoluteMinute) * MINUTES_PER_DAY + exact.hour * 60 + exact.minute;
        // A bare same-day clock is allowed to improve precision only forward. If it
        // points behind the authoritative world minute, it is stale/ambiguous—not a
        // licence to rewrite history or silently move the world backwards.
        if (target >= baseAbsoluteMinute) {
            return {
                kind: 'structured-clock',
                targetAbsoluteMinute: target,
                replaceCurrent: !calendarBound,
                precision: 'minute',
                daypart: structuredDaypart,
                sourceText: exact.sourceText || structuredScope.slice(0, 160),
                reason: calendarBound
                    ? '正文时间栏给出更晚的明确钟点，推进世界时钟'
                    : '正文时间栏给出明确钟点，向前校准相对世界时钟',
            };
        }
    }

    const candidates = transitionCandidates(source);
    if (candidates.length) {
        let target = baseAbsoluteMinute;
        const coarsePrecision = calendarBound ? 'date' : 'day';
        let precision = ['minute', 'daypart', 'date', 'day'].includes(currentPrecision)
            ? currentPrecision
            : coarsePrecision;
        let resolvedDaypart = precision === 'daypart' ? String(currentDaypart || '').trim() : '';
        if (precision === 'daypart' && !resolvedDaypart) precision = coarsePrecision;
        const applied = [];

        for (const transition of candidates) {
            let nextTarget = null;
            let wholeDayShift = false;
            if (Number.isFinite(transition.minuteDelta)) {
                nextTarget = target + transition.minuteDelta;
            } else if (Number.isFinite(transition.dayDelta)) {
                wholeDayShift = true;
                nextTarget = targetMinuteForDay(target, transition.dayDelta, daypartMinute(transition.daypart));
            } else if (Number.isFinite(transition.weekday) && calendarBound && currentDate) {
                const elapsedDays = dayIndex(target) - dayIndex(baseAbsoluteMinute);
                const cursorDate = addDateDays(currentDate, elapsedDays);
                const delta = weekdayDelta(cursorDate, transition.weekday, transition.weekdayMode);
                if (delta !== null) {
                    wholeDayShift = true;
                    nextTarget = targetMinuteForDay(target, delta, daypartMinute(transition.daypart));
                }
            }

            if (!Number.isFinite(nextTarget) || nextTarget < target) continue;
            target = Math.max(0, nextTarget);
            if (transition.daypart) {
                precision = 'daypart';
                resolvedDaypart = transition.daypart;
            } else if (!wholeDayShift && precision === 'daypart') {
                // “下午 + 8 小时” no longer proves it is still afternoon. Exact
                // minute precision survives exact elapsed duration; fuzzy dayparts do not.
                precision = coarsePrecision;
                resolvedDaypart = '';
            }
            applied.push(transition);
        }

        if (applied.length) {
            const finalTransition = applied.at(-1);
            return {
                kind: 'narrative-transition',
                targetAbsoluteMinute: target,
                replaceCurrent: false,
                precision,
                daypart: resolvedDaypart,
                sourceText: applied.map(item => item.sourceText).filter(Boolean).join(' → ').slice(0, 180),
                reason: applied.length > 1
                    ? `正文连续发生了 ${applied.length} 段时间推进，按出现顺序累计结算`
                    : '正文明确发生了时间跳转，按世界钟确定性推进',
                evidenceCount: applied.length,
                finalEvidence: finalTransition.sourceText,
            };
        }
    }

    if (structuredScope && structuredDaypart && !exact) {
        const desired = daypartMinute(structuredDaypart);
        if (desired !== null) {
            const target = dayIndex(baseAbsoluteMinute) * MINUTES_PER_DAY + desired;
            if (target >= baseAbsoluteMinute) {
                return {
                    kind: 'structured-daypart',
                    targetAbsoluteMinute: target,
                    replaceCurrent: !calendarBound,
                    precision: 'daypart',
                    daypart: structuredDaypart,
                    sourceText: structuredDaypart,
                    reason: '正文时间栏只给出时段，保留时段精度而不伪造精确钟点',
                };
            }
        }
    }

    return null;
}`;

let authority = fs.readFileSync('world-clock-authority.js', 'utf8');
const authorityBefore = authority;
authority = replaceOnceIfPresent(
    authority,
    `    const minute = Number.isFinite(Number(desiredMinuteOfDay))\n        ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Number(desiredMinuteOfDay)))\n        : minuteOfDay(baseAbsoluteMinute);`,
    `    const hasDesiredMinute = desiredMinuteOfDay !== null\n        && desiredMinuteOfDay !== undefined\n        && Number.isFinite(Number(desiredMinuteOfDay));\n    const minute = hasDesiredMinute\n        ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Number(desiredMinuteOfDay)))\n        : minuteOfDay(baseAbsoluteMinute);`,
    'nullable desired minute guard',
);
authority = replaceRange(
    authority,
    "function transitionCandidates(text = '') {",
    '\nfunction weekdayDelta(',
    transitionCandidates,
    'transition candidates',
);
authority = replaceRange(
    authority,
    'export function resolveNarrativeTimeTransition',
    '\nfunction findFutureExpression(',
    narrativeTransition,
    'narrative time transition',
);
writeIfChanged('world-clock-authority.js', authorityBefore, authority);

let core = fs.readFileSync('core.js', 'utf8');
const coreBefore = core;
const oldTrim = `        precision: legacyCalendarLooksPlaceholder\n            ? 'uninitialized'\n            : (['minute', 'daypart', 'date', 'uninitialized'].includes(state.clock?.precision)\n                ? state.clock.precision\n                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))\n                    ? 'minute'\n                    : 'uninitialized')),\n    };`;
const newTrim = `        precision: legacyCalendarLooksPlaceholder\n            ? 'day'\n            : (['minute', 'daypart', 'date', 'day'].includes(state.clock?.precision)\n                ? state.clock.precision\n                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))\n                    ? 'minute'\n                    : 'day')),\n        daypart: asString(state.clock?.daypart, '', 20),\n    };`;
core = replaceOnceIfPresent(core, oldTrim, newTrim, 'trimState clock precision/daypart');
if (!core.includes('currentPrecision: baseState.clock?.precision')) {
    const callPattern = /(const relativeTransition = resolveNarrativeTimeTransition\(narrativeText, \{[\s\S]*?\s+narrativeAnchor,)(\r?\n)(\s*\}\);)/;
    const match = core.match(callPattern);
    if (!match) throw new Error('missing resolveNarrativeTimeTransition call');
    const eol = match[2];
    const indent = match[3].match(/^\s*/)?.[0] || '    ';
    const optionIndent = `${indent}    `;
    core = core.replace(callPattern, `${match[1]}${eol}${optionIndent}currentPrecision: baseState.clock?.precision || (baseClockAnchored ? 'date' : 'day'),${eol}${optionIndent}currentDaypart: baseState.clock?.daypart || '',${eol}${match[3]}`);
}
writeIfChanged('core.js', coreBefore, core);

const authorityTestsPath = 'tests/world-clock-authority.test.mjs';
let authorityTests = fs.readFileSync(authorityTestsPath, 'utf8');
if (!authorityTests.includes("test('stale unbound structured clock never rewinds authoritative time'")) {
    authorityTests += `\n\ntest('stale unbound structured clock never rewinds authoritative time', () => {\n    const base = day(2) + 21 * 60;\n    const result = resolveNarrativeTimeTransition('<details><summary>时间与地点</summary>10:00 · 客厅</details>', {\n        currentAbsoluteMinute: base,\n        calendarBound: false,\n        currentPrecision: 'minute',\n        narrativeAnchor: {\n            hour: 10,\n            minute: 0,\n            structured: true,\n            excerpt: '10:00 · 客厅',\n        },\n    });\n    assert.equal(result, null);\n});\n\ntest('sequential elapsed transitions accumulate instead of keeping only the last one', () => {\n    const base = day(2) + 9 * 60;\n    const result = resolveNarrativeTimeTransition('过了2小时，她吃完饭。\\n又过了30分钟，她出了门。', {\n        currentAbsoluteMinute: base,\n        calendarBound: false,\n        currentPrecision: 'minute',\n    });\n    assert.ok(result);\n    assert.equal(result.targetAbsoluteMinute, base + 150);\n    assert.equal(result.precision, 'minute');\n    assert.equal(result.evidenceCount, 2);\n});\n`;
    fs.writeFileSync(authorityTestsPath, authorityTests, 'utf8');
    console.log(`${authorityTestsPath}: regression cases added`);
}

const coreTestsPath = 'tests/world-clock-core.test.mjs';
let coreTests = fs.readFileSync(coreTestsPath, 'utf8');
if (!coreTests.includes("test('known minute precision survives cumulative elapsed transitions'")) {
    coreTests += `\n\ntest('known minute precision survives cumulative elapsed transitions', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 24 * 60 + 9 * 60;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.precision = 'minute';\n    state.clock.daypart = '';\n    const before = state.clock.absoluteMinute;\n\n    state = applySimulationResult(state, minimalPayload(), {\n        messageId: 88,\n        sourceKey: 'test:cumulative-elapsed',\n        timePolicy: 'world',\n        narrativeText: '过了2小时，她吃完饭。\\n又过了30分钟，她出了门。',\n    });\n\n    assert.equal(state.clock.absoluteMinute, before + 150);\n    assert.equal(state.clock.precision, 'minute');\n});\n`;
    fs.writeFileSync(coreTestsPath, coreTests, 'utf8');
    console.log(`${coreTestsPath}: cumulative precision regression case added`);
}

console.log('world clock follow-up hardening complete');
