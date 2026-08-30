import fs from 'node:fs';

function replaceOne(text, pattern, replacement, label) {
    if (typeof pattern === 'string') {
        if (!text.includes(pattern)) throw new Error(`patch target missing: ${label}`);
        return text.replace(pattern, replacement);
    }
    if (!pattern.test(text)) throw new Error(`patch target missing: ${label}`);
    pattern.lastIndex = 0;
    return text.replace(pattern, replacement);
}

function patchClock() {
    const path = 'world-clock-authority.js';
    let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

    if (!text.includes("from './traditional-time.js'")) {
        text = `import { parseTraditionalClock } from './traditional-time.js';\n\n${text}`;
    }

    if (!text.includes('traditionalCrossesMidnight: Boolean(traditional.crossesMidnight)')) {
        text = replaceOne(
            text,
            /    const clocks = \[\.\.\.source\.matchAll\(\/\(\?:\^\|\[\^\\d\]\)\(\[01\]\?\\d\|2\[0-3\]\)\\s\*\[:：\]\\s\*\(\[0-5\]\\d\)\(\?!\\d\)\/gu\)\];\n    if \(!clocks\.length\) return null;\n    const match = clocks\.at\(-1\);\n    return \{\n        hour: Number\(match\[1\]\),\n        minute: Number\(match\[2\]\),\n        index: Number\(match\.index \|\| 0\),\n        sourceText: match\[0\]\.trim\(\),\n    \};/,
            `    const clocks = [...source.matchAll(/(?:^|[^\\d])([01]?\\d|2[0-3])\\s*[:：]\\s*([0-5]\\d)(?!\\d)/gu)];\n    if (clocks.length) {\n        const match = clocks.at(-1);\n        return {\n            hour: Number(match[1]),\n            minute: Number(match[2]),\n            index: Number(match.index || 0),\n            sourceText: match[0].trim(),\n        };\n    }\n    const traditional = parseTraditionalClock(source);\n    if (!traditional?.precise) return null;\n    return {\n        hour: traditional.hour,\n        minute: traditional.minute,\n        index: traditional.index,\n        sourceText: traditional.sourceText,\n        traditional: true,\n        traditionalLabel: traditional.label,\n        traditionalPeriod: traditional.periodLabel,\n        traditionalCrossesMidnight: Boolean(traditional.crossesMidnight),\n    };`,
            'traditional exact clock fallback',
        );
    }

    if (!text.includes('function traditionalCandidate(token, extra = {})')) {
        const marker = `function transitionCandidates(text = '') {`;
        const helper = `function traditionalCandidate(token, extra = {}) {\n    const parsed = parseTraditionalClock(token);\n    if (!parsed) return null;\n    return {\n        ...extra,\n        desiredMinuteOfDay: parsed.minuteOfDay,\n        traditionalPrecision: parsed.precision,\n        traditionalCrossesMidnight: Boolean(parsed.crossesMidnight),\n        daypart: parsed.periodLabel,\n        confidence: 'high',\n    };\n}\n\n`;
        text = replaceOne(text, marker, helper + marker, 'traditional transition helper');
    }

    if (!text.includes('const traditionalToken =')) {
        const oldLine = `    const daypart = '(凌晨|黎明|清晨|早晨|上午|中午|午后|下午|傍晚|黄昏|晚上|夜晚|深夜)?';`;
        const newLine = `${oldLine}\n    const traditionalToken = '([子丑寅卯辰巳午未申酉戌亥](?:时(?:\\\\s*(?:初|正))?(?:\\\\s*(?:\\\\d+|[零〇一二两三四五六七八九])\\\\s*刻)?|(?:初|正)(?:\\\\s*(?:\\\\d+|[零〇一二两三四五六七八九])\\\\s*刻)?))';`;
        text = replaceOne(text, oldLine, newLine, 'traditional transition token');
    }

    if (!text.includes('traditionalCandidate(match[2], { dayDelta: 1 })')) {
        const marker = `    add(new RegExp(\`${'${boundary}${sequencePrefix}'}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?)\\\\s*(下周|本周)?(?:周|星期)([一二三四五六日天])\\\\s*${'${daypart}'}\`, 'gu'), match => ({`;
        const addition = `    add(new RegExp(\`${'${boundary}${sequencePrefix}'}(次日|翌日|第二天|隔天)(?:的)?\\\\s*${'${traditionalToken}'}\\\\s*[，,]\`, 'gu'), match => traditionalCandidate(match[2], { dayDelta: 1 }));\n    add(new RegExp(\`${'${boundary}${sequencePrefix}'}当天\\\\s*${'${traditionalToken}'}\\\\s*[，,]\`, 'gu'), match => traditionalCandidate(match[1], { sameTraditional: true }));\n    add(new RegExp(\`${'${boundary}${sequencePrefix}'}(?:到了?|时间(?:来)?到(?:了)?|转眼(?:已经)?到了?)\\\\s*${'${traditionalToken}'}\\\\s*[，,]\`, 'gu'), match => traditionalCandidate(match[1], { sameTraditional: true }));\n\n`;
        text = replaceOne(text, marker, addition + marker, 'traditional transition patterns');
    }

    if (!text.includes('const structuredTraditional = structuredScope ? parseTraditionalClock(structuredScope) : null;')) {
        const marker = `    const currentDate = normalizeDate({\n        year: currentCalendar?.year,\n        month: currentCalendar?.month,\n        day: currentCalendar?.dayOfMonth ?? currentCalendar?.day,\n    });`;
        text = replaceOne(text, marker, `${marker}\n    const structuredTraditional = structuredScope ? parseTraditionalClock(structuredScope) : null;`, 'structured traditional parse');
    }

    if (!text.includes('exact.traditionalCrossesMidnight')) {
        text = replaceOne(
            text,
            /    if \(structuredScope && exact\) \{\n        const targetDay = structuredStoryDay \?\? dayIndex\(baseAbsoluteMinute\);\n        const target = targetDay \* MINUTES_PER_DAY \+ exact\.hour \* 60 \+ exact\.minute;[\s\S]*?        if \(target >= baseAbsoluteMinute\) \{\n            return \{\n                kind: 'structured-clock',\n                targetAbsoluteMinute: target,\n                replaceCurrent: !calendarBound,\n                precision: 'minute',\n                daypart: structuredDaypart,\n                sourceText: exact\.sourceText \|\| structuredScope\.slice\(0, 160\),\n                reason: calendarBound\n                    \? '正文时间栏给出更晚的明确钟点，推进世界时钟'\n                    : '正文时间栏给出明确钟点，向前校准相对世界时钟',\n            \};\n        \}\n    \}/,
            `    if (structuredScope && exact) {\n        const targetDay = structuredStoryDay ?? dayIndex(baseAbsoluteMinute);\n        let target = targetDay * MINUTES_PER_DAY + exact.hour * 60 + exact.minute;\n        if (\n            exact.traditionalCrossesMidnight\n            && structuredStoryDay === null\n            && minuteOfDay(baseAbsoluteMinute) >= 23 * 60\n            && target < baseAbsoluteMinute\n        ) {\n            target += MINUTES_PER_DAY;\n        }\n        if (target >= baseAbsoluteMinute) {\n            return {\n                kind: exact.traditional ? 'structured-traditional-clock' : 'structured-clock',\n                targetAbsoluteMinute: target,\n                replaceCurrent: !calendarBound,\n                precision: 'minute',\n                daypart: exact.traditionalPeriod || structuredDaypart,\n                sourceText: exact.sourceText || structuredScope.slice(0, 160),\n                reason: exact.traditional\n                    ? '正文时间栏给出明确十二时辰刻点，换算为同一权威世界钟'\n                    : calendarBound\n                        ? '正文时间栏给出更晚的明确钟点，推进世界时钟'\n                        : '正文时间栏给出明确钟点，向前校准相对世界时钟',\n            };\n        }\n    }`,
            'structured traditional rollover',
        );
    }

    if (!text.includes('transition.sameTraditional && Number.isFinite(transition.desiredMinuteOfDay)')) {
        text = replaceOne(
            text,
            `            } else if (Number.isFinite(transition.dayDelta)) {\n                wholeDayShift = true;\n                nextTarget = targetMinuteForDay(target, transition.dayDelta, daypartMinute(transition.daypart));\n            } else if (Number.isFinite(transition.weekday) && calendarBound && currentDate) {`,
            `            } else if (Number.isFinite(transition.dayDelta)) {\n                wholeDayShift = true;\n                const desired = Number.isFinite(transition.desiredMinuteOfDay)\n                    ? transition.desiredMinuteOfDay\n                    : daypartMinute(transition.daypart);\n                nextTarget = targetMinuteForDay(target, transition.dayDelta, desired);\n            } else if (transition.sameTraditional && Number.isFinite(transition.desiredMinuteOfDay)) {\n                let candidate = dayIndex(target) * MINUTES_PER_DAY + transition.desiredMinuteOfDay;\n                if (\n                    transition.traditionalCrossesMidnight\n                    && minuteOfDay(target) >= 23 * 60\n                    && candidate < target\n                ) {\n                    candidate += MINUTES_PER_DAY;\n                }\n                if (candidate >= target) nextTarget = candidate;\n            } else if (Number.isFinite(transition.weekday) && calendarBound && currentDate) {`,
            'narrative traditional settlement',
        );
    }

    if (!text.includes("if (transition.traditionalPrecision === 'minute')")) {
        text = replaceOne(
            text,
            `            if (transition.daypart) {\n                precision = 'daypart';\n                resolvedDaypart = transition.daypart;`,
            `            if (transition.traditionalPrecision === 'minute') {\n                precision = 'minute';\n                resolvedDaypart = transition.daypart || '';\n            } else if (transition.daypart) {\n                precision = 'daypart';\n                resolvedDaypart = transition.daypart;`,
            'traditional precision preservation',
        );
    }

    if (!text.includes("kind: 'structured-traditional-period'")) {
        const marker = `    if (structuredScope && structuredDaypart && !exact) {`;
        const block = `    if (structuredScope && structuredTraditional && !structuredTraditional.precise && !exact) {\n        const targetDay = structuredStoryDay ?? dayIndex(baseAbsoluteMinute);\n        const target = targetDay * MINUTES_PER_DAY + structuredTraditional.minuteOfDay;\n        if (target >= baseAbsoluteMinute) {\n            return {\n                kind: 'structured-traditional-period',\n                targetAbsoluteMinute: target,\n                replaceCurrent: !calendarBound,\n                precision: 'daypart',\n                daypart: structuredTraditional.periodLabel,\n                sourceText: structuredTraditional.sourceText,\n                reason: '正文时间栏只给出十二时辰，不伪造刻数；内部仅用该时辰起点作为结算坐标',\n            };\n        }\n    }\n\n`;
        text = replaceOne(text, marker, block + marker, 'bare shichen precision');
    }

    fs.writeFileSync(path, text);
}

function patchIndex() {
    const path = 'index.js';
    let text = fs.readFileSync(path, 'utf8');
    const nl = text.includes('\r\n') ? '\r\n' : '\n';

    if (!text.includes("from './snapshot-memory-dedupe.js'")) {
        const marker = `import { createWorldBackstageUI } from './ui.js';`;
        text = replaceOne(text, marker, `${marker}${nl}import { compactBranchDataMemory, compactSnapshotMemory, compactSnapshotMemoryLedgers } from './snapshot-memory-dedupe.js';`, 'memory dedupe import');
    }

    text = text.replace(/const PLUGIN_VERSION = '2\.5\.2';/, "const PLUGIN_VERSION = '2.5.4';");
    if (!text.includes("const PLUGIN_VERSION = '2.5.4';")) throw new Error('internal plugin version update failed');

    if (!text.includes('compactSnapshotMemory(snapshot, store);')) {
        text = replaceOne(
            text,
            /function createBranchSnapshot\(state, meta = \{\}, store = getStore\(\)\) \{\r?\n\s*mergeMemorySummaryArchive\(store, state\);\r?\n\s*return createCompactSnapshot\(state, meta\);\r?\n\}/,
            `function createBranchSnapshot(state, meta = {}, store = getStore()) {\n    mergeMemorySummaryArchive(store, state);\n    const snapshot = createCompactSnapshot(state, meta);\n    compactSnapshotMemory(snapshot, store);\n    saveStore(store);\n    return snapshot;\n}`,
            'create snapshot memory compaction',
        );
    }

    if (!/function restoreBranchSnapshot\([^\n]+\) \{\r?\n\s*compactSnapshotMemory\(snapshot, store\);/.test(text)) {
        text = replaceOne(
            text,
            /(function restoreBranchSnapshot\(snapshot, fallback = null, store = getStore\(\)\) \{\r?\n)/,
            `$1    compactSnapshotMemory(snapshot, store);\n`,
            'snapshot memory hydration',
        );
    }

    if (!text.includes('const storedData = clone(data);')) {
        text = replaceOne(
            text,
            /(function attachBranchData\(message, swipeId, data\) \{\r?\n\s*if \(!message \|\| typeof message !== 'object'\) return;\r?\n)/,
            `$1    const storedData = clone(data);\n    compactBranchDataMemory(storedData, getStore());\n`,
            'branch snapshot compaction',
        );
    }
    text = text.replace(/swipeInfo\.extra\[SNAPSHOT_KEY\] = clone\(data\);/, 'swipeInfo.extra[SNAPSHOT_KEY] = storedData;');
    text = text.replace(/message\.extra\[SNAPSHOT_KEY\] = clone\(data\);/, 'message.extra[SNAPSHOT_KEY] = storedData;');

    if (!text.includes('const memorySnapshotsCompacted = compactSnapshotMemoryLedgers(snapshotStore, chat, SNAPSHOT_KEY);')) {
        text = replaceOne(
            text,
            /(function compactBranchSnapshotStorage\(\{\r?\n\s*keepRecentAssistant = 50,\r?\n\} = \{\}\) \{\r?\n\s*const context = getContext\(\);\r?\n\s*const chat = context\?\.chat \|\| \[\];\r?\n)/,
            `$1    const snapshotStore = getStore();\n    const memorySnapshotsCompacted = compactSnapshotMemoryLedgers(snapshotStore, chat, SNAPSHOT_KEY);\n    if (memorySnapshotsCompacted) saveStore(snapshotStore);\n`,
            'historical snapshot memory compaction',
        );
        text = replaceOne(
            text,
            /(const recentStart = assistantIndexes\.length > keepRecentAssistant[\s\S]*?: -1;\r?\n\r?\n)\s*let changed = false;/,
            `$1    let changed = memorySnapshotsCompacted;`,
            'snapshot compaction changed flag',
        );
    }

    if (text.includes('extra[SNAPSHOT_KEY] = clone(data);')) throw new Error('full branch snapshot clone remains');
    fs.writeFileSync(path, text);
}

function patchManifest() {
    const path = 'manifest.json';
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    data.version = '2.5.4';
    fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

patchClock();
patchIndex();
patchManifest();
console.log('formal 2.5.4 patch prepared');
