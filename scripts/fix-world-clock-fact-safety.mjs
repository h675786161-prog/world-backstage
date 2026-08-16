import fs from 'node:fs';

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: clock fact safety applied`);
}

function insertBeforeOnce(source, marker, insertion, label) {
    if (source.includes(insertion.trim())) return source;
    const index = source.indexOf(marker);
    if (index < 0) throw new Error(`missing ${label}`);
    return source.slice(0, index) + insertion + source.slice(index);
}

const corePath = 'core.js';
let core = fs.readFileSync(corePath, 'utf8');
const coreBefore = core;

if (!core.includes('export function formatWorldClockFactLabel(')) {
    core = insertBeforeOnce(
        core,
        'export function formatDuration(minutes) {',
        `export function formatWorldClockFactLabel(state, totalMinutes = state?.clock?.absoluteMinute ?? 0) {
    const formatted = formatWorldCalendar(state, totalMinutes);
    const precision = String(state?.clock?.precision || 'day');
    const daypart = asString(state?.clock?.daypart, '', 20);
    const anchored = Boolean(state?.clock?.anchored);

    if (anchored) {
        if (precision === 'minute') return formatted.stamp;
        if (precision === 'daypart' && daypart) {
            return \`${'${formatted.calendarName} ${formatted.date}'} · ${'${daypart}'}（具体钟点未确定）\`;
        }
        return \`${'${formatted.calendarName} ${formatted.date}'}（具体钟点未确定）\`;
    }

    const relative = formatWorldMinute(totalMinutes);
    if (precision === 'minute') return \`故事第 ${'${relative.day}'} 日 ${'${relative.time}'}\`;
    if (precision === 'daypart' && daypart) {
        return \`故事第 ${'${relative.day}'} 日 · ${'${daypart}'}（具体钟点未确定）\`;
    }
    return \`故事第 ${'${relative.day}'} 日（具体钟点未确定）\`;
}

`,
        'formatDuration marker',
    );
}

core = core.replaceAll(
    `主世界时间：${'${formatWorldCalendar(state).stamp}'}`,
    `主世界时间：${'${formatWorldClockFactLabel(state)}'}`,
);

writeIfChanged(corePath, coreBefore, core);

const indexPath = 'index.js';
let index = fs.readFileSync(indexPath, 'utf8');
const indexBefore = index;

if (!/\bformatWorldClockFactLabel\s*,/.test(index)) {
    const importMarker = /(\s+formatWorldCalendar,\r?\n)/;
    if (!importMarker.test(index)) throw new Error('missing index formatWorldCalendar import');
    index = index.replace(importMarker, `$1    formatWorldClockFactLabel,\n`);
}

index = index.replace(
    /clockLabel:\s*formatWorldCalendar\(state\)\?\.stamp\s*\|\|\s*''\s*,/g,
    'clockLabel: formatWorldClockFactLabel(state),',
);
index = index.replace(
    /clock:\s*state\.clock\?\.anchored\s*\?\s*clock\.stamp\s*:\s*'尚未建立时间锚点'\s*,/g,
    'clock: formatWorldClockFactLabel(state),',
);

writeIfChanged(indexPath, indexBefore, index);

const testsPath = 'tests/world-clock-core.test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
const testsBefore = tests;

function ensureCoreTestImport(name) {
    const importBlockEnd = tests.indexOf("} from '../core.js';");
    if (importBlockEnd < 0) throw new Error('missing core test import block');
    const importBlockStart = tests.lastIndexOf('import {', importBlockEnd);
    const importBlock = tests.slice(importBlockStart, importBlockEnd);
    if (new RegExp(`\\b${name}\\s*,`).test(importBlock)) return;
    const anchor = '    applySimulationResult,';
    const anchorIndex = tests.indexOf(anchor, importBlockStart);
    if (anchorIndex < 0 || anchorIndex > importBlockEnd) throw new Error(`missing test import anchor for ${name}`);
    const lineEnd = tests.indexOf('\n', anchorIndex) + 1;
    tests = tests.slice(0, lineEnd) + `    ${name},\n` + tests.slice(lineEnd);
}

ensureCoreTestImport('compactStateForModel');
ensureCoreTestImport('formatWorldClockFactLabel');

const factMarker = "test('coarse clock precision never exposes the internal minute as a fact label'";
if (!tests.includes(factMarker)) {
    tests += `\n\ntest('coarse clock precision never exposes the internal minute as a fact label', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 3 * 24 * 60 + 9 * 60 + 17;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = true;\n    state.clock.precision = 'date';\n    state.world.calendar = {\n        name: '主世界历',\n        anchorAbsoluteDay: 3,\n        anchorYear: 2138,\n        anchorMonth: 1,\n        anchorDay: 3,\n    };\n\n    const label = formatWorldClockFactLabel(state);\n    const compact = compactStateForModel(state);\n    assert.match(label, /2138年1月3日/);\n    assert.doesNotMatch(label, /09:17/);\n    assert.match(label, /具体钟点未确定/);\n    assert.equal(compact.world_now_label, label);\n    assert.equal(compact.world_now_coordinate_only, true);\n    assert.equal(compact.world_now, state.clock.absoluteMinute);\n});\n\ntest('unbound story clock exposes story-day fact instead of a fake calendar date', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 5 * 24 * 60 + 13 * 60 + 41;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = false;\n    state.clock.precision = 'day';\n\n    const label = formatWorldClockFactLabel(state);\n    const compact = compactStateForModel(state);\n    assert.match(label, /故事第 5 日/);\n    assert.doesNotMatch(label, /13:41/);\n    assert.equal(compact.world_now, null);\n    assert.equal(compact.world_story_minute, state.clock.absoluteMinute);\n    assert.equal(compact.world_now_label, label);\n});\n\ntest('schema-24 uninitialized clock migrates conservatively without inventing minute precision', () => {\n    const legacy = createInitialState();\n    legacy.schemaVersion = 24;\n    legacy.clock.anchored = false;\n    legacy.clock.precision = 'uninitialized';\n    legacy.clock.absoluteMinute = 6 * 24 * 60 + 8 * 60 + 23;\n    legacy.clock.lastCheckedAt = legacy.clock.absoluteMinute;\n\n    const migrated = trimState(legacy);\n    assert.equal(migrated.clock.anchored, false);\n    assert.equal(migrated.clock.precision, 'day');\n    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /08:23/);\n});\n\ntest('legacy save with no calendar evidence cannot revive a synthetic calendar anchor', () => {\n    const legacy = createInitialState();\n    legacy.schemaVersion = 7;\n    legacy.world.calendar = undefined;\n    legacy.clock = {\n        absoluteMinute: 7 * 24 * 60 + 11 * 60 + 9,\n        lastCheckedAt: 7 * 24 * 60 + 11 * 60 + 9,\n        source: 'narrative',\n        reason: 'legacy narrative progress',\n    };\n    legacy.audit = [];\n\n    const migrated = trimState(legacy);\n    assert.equal(migrated.clock.anchored, false);\n    assert.equal(migrated.clock.precision, 'day');\n    assert.match(formatWorldClockFactLabel(migrated), /故事第 7 日/);\n    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /11:09/);\n});\n`;
}

writeIfChanged(testsPath, testsBefore, tests);
