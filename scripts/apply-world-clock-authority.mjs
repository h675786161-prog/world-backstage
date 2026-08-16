import fs from 'node:fs';

function read(path) {
    return fs.readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function write(path, content) {
    fs.writeFileSync(path, content, 'utf8');
}

function replaceOnce(source, needle, replacement, label) {
    const first = source.indexOf(needle);
    if (first < 0) throw new Error(`missing ${label}`);
    if (source.indexOf(needle, first + needle.length) >= 0) {
        throw new Error(`ambiguous ${label}`);
    }
    return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceAllChecked(source, needle, replacement, expected, label) {
    const count = source.split(needle).length - 1;
    if (count !== expected) throw new Error(`${label}: expected ${expected}, got ${count}`);
    return source.split(needle).join(replacement);
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error(`missing start ${label}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error(`missing end ${label}`);
    return source.slice(0, start) + replacement + source.slice(end);
}

function functionBlock(source, signature) {
    const start = source.indexOf(signature);
    if (start < 0) throw new Error(`missing function ${signature}`);
    const braceStart = source.indexOf('{', start + signature.length);
    if (braceStart < 0) throw new Error(`missing function brace ${signature}`);
    let depth = 0;
    let quote = '';
    let escaped = false;
    let templateDepth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];
        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (quote === '`' && char === '$' && next === '{') {
                templateDepth += 1;
                index += 1;
                continue;
            }
            if (quote === '`' && templateDepth > 0) {
                if (char === '{') templateDepth += 1;
                else if (char === '}') templateDepth -= 1;
                continue;
            }
            if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '/' && next === '/') {
            const newline = source.indexOf('\n', index + 2);
            index = newline < 0 ? source.length : newline;
            continue;
        }
        if (char === '/' && next === '*') {
            const close = source.indexOf('*/', index + 2);
            if (close < 0) throw new Error(`unclosed comment in ${signature}`);
            index = close + 1;
            continue;
        }
        if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return { start, end: index + 1, text: source.slice(start, index + 1) };
        }
    }
    throw new Error(`unclosed function ${signature}`);
}

function replaceFunction(source, signature, replacement) {
    const block = functionBlock(source, signature);
    return source.slice(0, block.start) + replacement + source.slice(block.end);
}

let core = read('core.js');

core = replaceOnce(
    core,
    "const WB_STATE_RECONCILE_ORDER = Object.freeze([3, 1, 4, 2]);",
    `import {\n    buildClockAuthorityLines,\n    normalizeClueTiming,\n    resolveFutureTimeExpression,\n    resolveNarrativeTimeTransition,\n} from './world-clock-authority.js';\n\nconst WB_STATE_RECONCILE_ORDER = Object.freeze([3, 1, 4, 2]);`,
    'clock authority import',
);
core = replaceOnce(core, 'export const SCHEMA_VERSION = 24;', 'export const SCHEMA_VERSION = 25;', 'schema version');
core = replaceOnce(
    core,
    "            anchored: false,\n            precision: 'uninitialized',",
    "            anchored: false,\n            precision: 'day',\n            daypart: '',",
    'initial relative clock',
);
core = replaceOnce(
    core,
    "        resolvedMessageId: raw?.resolved_message_id ?? raw?.resolvedMessageId\n            ?? existing?.resolvedMessageId\n            ?? null,\n        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),",
    "        resolvedMessageId: raw?.resolved_message_id ?? raw?.resolvedMessageId\n            ?? existing?.resolvedMessageId\n            ?? null,\n        timing: normalizeClueTiming(\n            raw?.timing ?? existing?.timing,\n            worldMinute,\n        ),\n        createdAt: asInteger(raw?.created_at ?? raw?.createdAt, existing?.createdAt ?? worldMinute, 0),",
    'clue timing field',
);

const clueFunction = `function applyClueUpdates(state, {\n    cluesUpsert = [],\n    cluesResolve = [],\n} = {}, {\n    sourceMessageId = null,\n    sourceSwipeId = null,\n} = {}) {\n    state.storyMemory = normalizeStoryMemory(state.storyMemory, state.clock.absoluteMinute);\n\n    const anchorTiming = (clue, { force = false } = {}) => {\n        if (!clue) return;\n        const currentMinute = state.clock?.absoluteMinute || 0;\n        if (clue.timing && !force) {\n            clue.timing = normalizeClueTiming(clue.timing, currentMinute);\n            return;\n        }\n        const sourceText = [clue.sourceExcerpt, clue.text].filter(Boolean).join('\\n');\n        if (!sourceText) {\n            clue.timing = null;\n            return;\n        }\n        const baseMinute = asInteger(clue.createdAt, currentMinute, 0);\n        clue.timing = resolveFutureTimeExpression(sourceText, {\n            baseAbsoluteMinute: baseMinute,\n            baseCalendar: formatWorldCalendar(state, baseMinute),\n            calendarBound: Boolean(state.clock?.anchored),\n        });\n        if (clue.timing) clue.timing = normalizeClueTiming(clue.timing, currentMinute);\n    };\n\n    // Old saves may contain only natural-language clues. Anchor them from the\n    // moment they were created; never reinterpret “后天” from today's clock.\n    for (const clue of state.storyMemory.clues) anchorTiming(clue);\n\n    for (const rawClue of asArray(cluesUpsert).slice(0, 24)) {\n        const existing = findClue(state.storyMemory, rawClue);\n        if (existing?.locked) continue;\n        const previousText = existing?.text || '';\n        const previousExcerpt = existing?.sourceExcerpt || '';\n        const clue = normalizeClue(rawClue, existing, state.clock.absoluteMinute, {\n            sourceMessageId,\n            sourceSwipeId,\n        });\n        if (!clue.text) continue;\n        const sourceChanged = Boolean(\n            existing\n            && (previousText !== clue.text || previousExcerpt !== clue.sourceExcerpt)\n        );\n        // Model-supplied timing is never authoritative. Resolve it from the actual\n        // clue/source text and the world clock instead.\n        if (!existing || sourceChanged) clue.timing = null;\n        anchorTiming(clue, { force: !existing || sourceChanged });\n        if (existing) Object.assign(existing, clue);\n        else state.storyMemory.clues.unshift(clue);\n    }\n\n    for (const rawResolution of asArray(cluesResolve).slice(0, 24)) {\n        const resolution = typeof rawResolution === 'string'\n            ? { id: rawResolution }\n            : rawResolution;\n        const clue = findClue(state.storyMemory, resolution);\n        if (!clue || clue.locked) continue;\n        clue.status = VALID_CLUE_STATES.has(resolution?.status)\n            ? resolution.status\n            : 'resolved';\n        clue.resolution = asString(\n            resolution?.resolution,\n            clue.resolution || (clue.status === 'discarded' ? '后续发展已证明这条线索无需继续追踪' : '已由后续正文呼应或解决'),\n            520,\n        );\n        clue.lifecycleReason = asString(\n            resolution?.reason ?? resolution?.lifecycle_reason ?? resolution?.lifecycleReason,\n            clue.lifecycleReason || clue.resolution,\n            360,\n        );\n        clue.resolvedMessageId = asInteger(\n            resolution?.message_id ?? resolution?.messageId,\n            sourceMessageId ?? clue.resolvedMessageId ?? 0,\n            0,\n        );\n        clue.updatedAt = state.clock.absoluteMinute;\n        appendMemoryMetabolism(state, {\n            kind: 'clue',\n            action: clue.status,\n            targetId: clue.id,\n            reason: clue.lifecycleReason || clue.resolution,\n            sourceMessageId: sourceMessageId ?? clue.resolvedMessageId ?? 0,\n        });\n    }\n}\n`;
core = replaceFunction(core, 'function applyClueUpdates', clueFunction.trimEnd());

const timeSection = `    const baseClockAnchored = Boolean(baseState?.clock?.anchored);\n    // Model clock_anchor is advisory only. Absolute world time is a deterministic\n    // state authority: model guesses may estimate elapsed duration, never date us.\n    const modelClockAnchor = payload.clockAnchor;\n    void modelClockAnchor;\n    const currentCalendar = formatWorldCalendar(baseState);\n    const narrativeCalendar = extractExplicitCalendarDate(narrativeText);\n    const narrativeAnchor = extractNarrativeTimeAnchor(narrativeText);\n    const relativeTransition = resolveNarrativeTimeTransition(narrativeText, {\n        currentAbsoluteMinute: baseState.clock?.absoluteMinute || 0,\n        currentCalendar,\n        calendarBound: baseClockAnchored,\n        narrativeAnchor,\n    });\n    const anchor = {\n        mode: 'none',\n        calendarName: '',\n        year: 0,\n        month: 0,\n        day: 0,\n        hour: 0,\n        minute: 0,\n        hasDate: false,\n        hasTime: false,\n        precision: 'date',\n        confidence: 'low',\n        sourceExcerpt: '',\n        reason: '',\n    };\n\n    const currentMinuteOfDay = currentCalendar.hour * 60 + currentCalendar.minute;\n    const narrativeMinuteOfDay = narrativeAnchor\n        && narrativeAnchor.hour !== null\n        && narrativeAnchor.minute !== null\n        ? Number(narrativeAnchor.hour) * 60 + Number(narrativeAnchor.minute)\n        : null;\n    const structuredForwardExact = Boolean(\n        baseClockAnchored\n        && narrativeAnchor?.structured\n        && Number.isFinite(narrativeMinuteOfDay)\n        && narrativeMinuteOfDay >= currentMinuteOfDay\n    );\n    const narrativeDayDelta = narrativeCalendar\n        ? calendarDayDifference({\n            year: currentCalendar.year,\n            month: currentCalendar.month,\n            day: currentCalendar.dayOfMonth,\n        }, {\n            year: narrativeCalendar.year,\n            month: narrativeCalendar.month,\n            day: narrativeCalendar.day,\n        })\n        : null;\n    const narrativeDateReliable = Boolean(\n        narrativeCalendar\n        && (narrativeAnchor?.structured || Number(narrativeCalendar.index) <= 500)\n    );\n    const narrativeDateCanCalibrate = Boolean(\n        narrativeDateReliable\n        && (!baseClockAnchored || Number(narrativeDayDelta) >= 0)\n    );\n\n    if (narrativeDateCanCalibrate) {\n        const dateChanged = !baseClockAnchored || Number(narrativeDayDelta) !== 0;\n        const reliableExact = Boolean(\n            narrativeAnchor\n            && narrativeAnchor.hour !== null\n            && narrativeAnchor.minute !== null\n            && (\n                !baseClockAnchored\n                || dateChanged\n                || structuredForwardExact\n                || /→|->|至|到/.test(narrativeAnchor.excerpt || '')\n            )\n        );\n        anchor.mode = baseClockAnchored ? 'calibrate' : 'initialize';\n        anchor.year = narrativeCalendar.year;\n        anchor.month = narrativeCalendar.month;\n        anchor.day = narrativeCalendar.day;\n        anchor.hasDate = true;\n        if (reliableExact) {\n            anchor.hour = narrativeAnchor.hour;\n            anchor.minute = narrativeAnchor.minute;\n            anchor.hasTime = true;\n            anchor.precision = 'minute';\n        } else {\n            anchor.precision = narrativeAnchor?.daypart ? 'daypart' : 'date';\n        }\n        anchor.confidence = 'high';\n        anchor.sourceExcerpt = narrativeAnchor?.excerpt || narrativeCalendar.excerpt;\n        anchor.reason = baseClockAnchored\n            ? '正文给出新的可靠时间证据，按确定性规则校准主世界时间'\n            : '正文给出可靠年月日，将既有相对世界时钟绑定到主世界历';\n    } else if (structuredForwardExact) {\n        anchor.mode = 'calibrate';\n        anchor.year = currentCalendar.year;\n        anchor.month = currentCalendar.month;\n        anchor.day = currentCalendar.dayOfMonth;\n        anchor.hour = narrativeAnchor.hour;\n        anchor.minute = narrativeAnchor.minute;\n        anchor.hasDate = true;\n        anchor.hasTime = true;\n        anchor.precision = 'minute';\n        anchor.confidence = 'high';\n        anchor.sourceExcerpt = narrativeAnchor.excerpt;\n        anchor.reason = '正文时间栏给出更晚的明确钟点，自动校准主世界时间';\n    }\n\n    const anchorHasDate = Boolean(anchor?.hasDate);\n    const anchorHasExactTime = Boolean(anchor?.hasTime);\n    const initializeClock = !baseClockAnchored\n        && anchorHasDate\n        && anchor?.mode === 'initialize'\n        && anchor?.confidence === 'high';\n    const recalibrateClock = baseClockAnchored\n        && anchorHasDate\n        && anchor?.mode === 'calibrate'\n        && anchor?.confidence === 'high';\n    const anchorApplied = initializeClock || recalibrateClock;\n\n    const requestedElapsedMinutes = payload.elapsedMinutes;\n    const explicitTimeEvidence = hasExplicitTimeEvidence(narrativeText);\n    if (anchorApplied || relativeTransition) {\n        // Both are end-of-batch time evidence. Adding model elapsed_minutes again\n        // would double-count the same date/transition.\n        payload.elapsedMinutes = 0;\n    } else {\n        payload.elapsedMinutes = resolveElapsedMinutes(\n            requestedElapsedMinutes,\n            narrativeText,\n            timePolicy,\n        );\n    }\n    if (!explicitTimeEvidence && !['open', 'world'].includes(timePolicy)) {\n        for (const update of payload.eventsUpdate) {\n            const requestedWork = asInteger(\n                update?.worked_minutes ?? update?.workedMinutes,\n                0,\n                0,\n            );\n            const guardedWork = timePolicy === 'cautious'\n                ? Math.min(requestedWork, 180)\n                : 0;\n            update.worked_minutes = guardedWork;\n            update.workedMinutes = guardedWork;\n        }\n    }\n    if (anchorApplied) {\n        payload.timeReason = anchor.reason;\n    } else if (relativeTransition) {\n        payload.timeReason = relativeTransition.reason;\n    } else if (!baseClockAnchored && timePolicy === 'world') {\n        payload.timeReason = payload.elapsedMinutes > 0\n            ? '具体历法日期尚未绑定；沿用相对世界时钟并按本批真实耗时推进'\n            : '具体历法日期尚未绑定；相对世界时钟保持连续';\n    } else if (requestedElapsedMinutes > 0 && payload.elapsedMinutes === 0) {\n        payload.timeReason = '正文没有明确、可计算的时间证据，本轮保持世界时钟不动';\n    } else if (payload.elapsedMinutes < requestedElapsedMinutes) {\n        payload.timeReason = \`正文时间较含糊，本轮最多推进 \${payload.elapsedMinutes} 分钟\`;\n    }\n`;
core = replaceBetween(
    core,
    '    const baseClockAnchored = Boolean(baseState?.clock?.anchored);',
    '    let anchoredBaseState = baseState;',
    timeSection,
    'simulation clock authority section',
);
core = replaceAllChecked(
    core,
    '        anchoredBaseState.clock.precision = anchor.precision;',
    "        anchoredBaseState.clock.precision = anchor.precision;\n        anchoredBaseState.clock.daypart = narrativeAnchor?.daypart || '';",
    2,
    'anchored clock precision',
);
core = replaceOnce(
    core,
    `    let state = settleTimedEvents(\n        anchoredBaseState,\n        anchoredBaseState.clock.absoluteMinute + payload.elapsedMinutes,\n        {\n            source: anchorApplied ? anchoredBaseState.clock.source : 'narrative',\n            reason: payload.timeReason || '正文推演',\n        },\n    );\n    const worldMinute = state.clock.absoluteMinute;`,
    `    const transitionTarget = !anchorApplied && relativeTransition\n        ? Number(relativeTransition.targetAbsoluteMinute)\n        : Number.NaN;\n    const targetWorldMinute = Number.isFinite(transitionTarget)\n        ? Math.max(0, transitionTarget)\n        : anchoredBaseState.clock.absoluteMinute + payload.elapsedMinutes;\n    let state = settleTimedEvents(\n        anchoredBaseState,\n        targetWorldMinute,\n        {\n            source: anchorApplied\n                ? anchoredBaseState.clock.source\n                : relativeTransition\n                    ? 'narrative-time-evidence'\n                    : 'world-clock',\n            reason: payload.timeReason || '正文推演',\n        },\n    );\n    if (!anchorApplied && relativeTransition) {\n        state.clock.precision = relativeTransition.precision || state.clock.precision || 'day';\n        state.clock.daypart = relativeTransition.daypart || '';\n        state.clock.source = 'narrative-time-evidence';\n        state.clock.reason = relativeTransition.reason || payload.timeReason;\n    } else if (!state.clock.anchored && !['minute', 'daypart', 'date', 'day'].includes(state.clock.precision)) {\n        state.clock.precision = 'day';\n        state.clock.daypart = '';\n    }\n    const worldMinute = state.clock.absoluteMinute;`,
    'settle simulation world clock',
);

core = replaceBetween(
    core,
    "    if (timeMode !== 'off') {",
    '    if (people.length) {',
    "    authorityLines.push(...buildClockAuthorityLines(state, clock, timeMode));\n\n",
    'time injection block',
);

core = replaceOnce(
    core,
    "    const identityAnchor = modelText(playerIdentityAnchor, 400);",
    "    const clockAuthorityRule = '绝对日期、星期和精确钟点由插件的确定性时间权威层处理。clock_anchor.mode 必须返回 none；不要猜年月日、星期或当前几点。你只负责 elapsed_minutes（本批 new=true 正文真正经过的时长）和 time_reason。正文已经明确写出的时间证据会由插件代码单独解析。';\n    const identityAnchor = modelText(playerIdentityAnchor, 400);",
    'simulation clock rule constant',
);
core = replaceOnce(
    core,
    '        timeRule,',
    '        timeRule,\n        clockAuthorityRule,',
    'simulation clock rule injection',
);
core = replaceOnce(
    core,
    "        '6. clock_anchor 只使用本批中最晚、最可靠的故事绝对时间。能确定日期但不能确定分钟时，只给 date/daypart 精度；绝不为了完整字段编时间。',",
    "        '6. 绝对时间由插件代码从历史正文确定性解析。clock_anchor.mode 必须返回 none；不要猜年月日、星期或钟点。历史回溯只恢复正文已经发生的状态。',",
    'history clock rule',
);

write('core.js', core);

let index = read('index.js');
index = replaceOnce(
    index,
    "import { buildBackstageMessages } from './prompt-bridge.js';",
    "import { buildBackstageMessages } from './prompt-bridge.js';\nimport { normalizeClueTiming, resolveFutureTimeExpression } from './world-clock-authority.js';",
    'index clock authority import',
);
index = replaceOnce(index, "const PLUGIN_VERSION = '2.4.0';", "const PLUGIN_VERSION = '2.5.0';", 'plugin version');
index = replaceOnce(
    index,
    "                createdAt: existing?.createdAt ?? next.clock.absoluteMinute,\n            };",
    "                createdAt: existing?.createdAt ?? next.clock.absoluteMinute,\n            };\n            const timingBaseMinute = Number(updated.createdAt ?? next.clock.absoluteMinute) || next.clock.absoluteMinute;\n            updated.timing = resolveFutureTimeExpression(\n                [updated.sourceExcerpt, updated.text].filter(Boolean).join('\\n'),\n                {\n                    baseAbsoluteMinute: timingBaseMinute,\n                    baseCalendar: formatWorldCalendar(next, timingBaseMinute),\n                    calendarBound: Boolean(next.clock?.anchored),\n                },\n            );\n            if (updated.timing) {\n                updated.timing = normalizeClueTiming(updated.timing, next.clock.absoluteMinute);\n            }",
    'manual clue timing',
);
write('index.js', index);

let manifest = read('manifest.json');
manifest = replaceOnce(manifest, '"version": "2.4.7"', '"version": "2.5.0"', 'manifest version');
write('manifest.json', manifest);

let pkg = read('package.json');
pkg = replaceOnce(pkg, '"version": "2.4.6"', '"version": "2.5.0"', 'package version');
pkg = replaceOnce(
    pkg,
    'node --check settings-persistence-guard.js && node --check index.js',
    'node --check settings-persistence-guard.js && node --check world-clock-authority.js && node --check index.js',
    'package check world clock',
);
write('package.json', pkg);

console.log('world clock authority patch applied');
