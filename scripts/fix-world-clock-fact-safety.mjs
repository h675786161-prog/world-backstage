import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
    if (source.includes(after)) return source;
    if (!source.includes(before)) throw new Error(`missing ${label}`);
    return source.replace(before, after);
}

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: clock fact safety applied`);
}

const corePath = 'core.js';
let core = fs.readFileSync(corePath, 'utf8');
const coreBefore = core;

core = replaceOnce(
    core,
    `export function formatDuration(minutes) {`,
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

export function formatDuration(minutes) {`,
    'formatWorldClockFactLabel insertion',
);

core = replaceOnce(
    core,
    `    state.world = {
        name: asString(state.world?.name, '未命名世界', 80),
        title: asString(state.world?.title, '世界仍在继续', 180),
        detail: asString(state.world?.detail, '', 640),
        // User-authored foundation. Routine simulation can read it but never rewrites it.
        background: asString(state.world?.background, '', LIMITS.worldBackground),
        calendar: normalizeWorldCalendar(state.world?.calendar, absoluteDay),
    };
    const rawCalendar = state.world.calendar;
    const hasCalendarCalibrationAudit = asArray(state.audit).some(entry => (
        ['calendar_calibrated', 'clock_anchor_initialized', 'clock_anchor_recalibrated']
            .includes(entry?.type)
    ));
    const legacyCalendarLooksPlaceholder = previousSchemaVersion < 8
        && rawCalendar?.name === '主世界历'
        && Number(rawCalendar?.anchorYear) === 1
        && Number(rawCalendar?.anchorMonth) === 1
        && Number(rawCalendar?.anchorDay) === 1
        && !hasCalendarCalibrationAudit
        && ['initial', 'narrative', 'unknown'].includes(asString(state.clock?.source, 'initial', 40));
    const inferredAnchored = legacyCalendarLooksPlaceholder
        ? false
        : asString(state.clock?.source, 'initial', 40) !== 'initial';`,
    `    // Keep the raw calendar long enough to decide whether an old save ever had
    // real calendar evidence. Normalization manufactures a harmless calculation
    // fallback, so using the normalized object for migration would make "missing"
    // data look like a genuine Gregorian date.
    const rawCalendar = state.world?.calendar;
    state.world = {
        name: asString(state.world?.name, '未命名世界', 80),
        title: asString(state.world?.title, '世界仍在继续', 180),
        detail: asString(state.world?.detail, '', 640),
        // User-authored foundation. Routine simulation can read it but never rewrites it.
        background: asString(state.world?.background, '', LIMITS.worldBackground),
        calendar: normalizeWorldCalendar(rawCalendar, absoluteDay),
    };
    const hasCalendarCalibrationAudit = asArray(state.audit).some(entry => (
        ['calendar_calibrated', 'clock_anchor_initialized', 'clock_anchor_recalibrated']
            .includes(entry?.type)
    ));
    const rawAnchorYear = Number(rawCalendar?.anchor_year ?? rawCalendar?.anchorYear);
    const rawAnchorMonth = Number(rawCalendar?.anchor_month ?? rawCalendar?.anchorMonth);
    const rawAnchorDay = Number(rawCalendar?.anchor_day ?? rawCalendar?.anchorDay);
    const rawCalendarHasAnchor = Number.isFinite(rawAnchorYear)
        && Number.isFinite(rawAnchorMonth)
        && Number.isFinite(rawAnchorDay)
        && rawAnchorYear >= 1
        && rawAnchorMonth >= 1 && rawAnchorMonth <= 12
        && rawAnchorDay >= 1 && rawAnchorDay <= 31;
    const legacyCalendarLooksPlaceholder = previousSchemaVersion < 8
        && (!rawCalendar || (
            rawCalendar?.name === '主世界历'
            && rawAnchorYear === 1
            && rawAnchorMonth === 1
            && rawAnchorDay === 1
        ))
        && !hasCalendarCalibrationAudit
        && ['initial', 'narrative', 'unknown'].includes(asString(state.clock?.source, 'initial', 40));
    const inferredAnchored = legacyCalendarLooksPlaceholder
        ? false
        : rawCalendarHasAnchor && asString(state.clock?.source, 'initial', 40) !== 'initial';`,
    'raw calendar migration guard',
);

core = replaceOnce(
    core,
    `        \`主世界时间：${'${formatWorldCalendar(state).stamp}'}\`,`,
    `        \`主世界时间：${'${formatWorldClockFactLabel(state)}'}\`,`,
    'observation prompt clock label',
);

core = replaceOnce(
    core,
    `        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,
        world_now_label: state.clock?.anchored
            ? formatWorldCalendar(state).stamp
            : 'UNINITIALIZED_STORY_CLOCK',
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'uninitialized',`,
    `        // world_now remains the internal scheduling coordinate for compatibility.
        // When precision is coarse, consumers must not present its minute component
        // as a fact; world_now_label is the authoritative human/model-facing label.
        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,
        world_story_minute: state.clock?.absoluteMinute ?? 0,
        world_now_coordinate_only: state.clock?.precision !== 'minute',
        world_now_label: formatWorldClockFactLabel(state),
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'day',`,
    'compact state clock exposure',
);

writeIfChanged(corePath, coreBefore, core);

const indexPath = 'index.js';
let index = fs.readFileSync(indexPath, 'utf8');
const indexBefore = index;

index = replaceOnce(
    index,
    `    formatWorldCalendar,\n`,
    `    formatWorldCalendar,\n    formatWorldClockFactLabel,\n`,
    'index clock fact formatter import',
);

index = index.replaceAll(
    `clockLabel: formatWorldCalendar(state)?.stamp || '',`,
    `clockLabel: formatWorldClockFactLabel(state),`,
);
index = replaceOnce(
    index,
    `        clock: state.clock?.anchored ? clock.stamp : '尚未建立时间锚点',`,
    `        clock: formatWorldClockFactLabel(state),`,
    'Lingqi clock digest',
);

writeIfChanged(indexPath, indexBefore, index);

const testsPath = 'tests/world-clock-core.test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
const testsBefore = tests;

tests = replaceOnce(
    tests,
    `    createInitialState,\n    formatWorldCalendar,\n    trimState,`,
    `    compactStateForModel,\n    createInitialState,\n    formatWorldCalendar,\n    formatWorldClockFactLabel,\n    trimState,`,
    'core test imports',
);

const factMarker = "test('coarse clock precision never exposes the internal minute as a fact label'";
if (!tests.includes(factMarker)) {
    tests += `\n\ntest('coarse clock precision never exposes the internal minute as a fact label', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 3 * 24 * 60 + 9 * 60 + 17;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = true;\n    state.clock.precision = 'date';\n    state.world.calendar = {\n        name: '主世界历',\n        anchorAbsoluteDay: 3,\n        anchorYear: 2138,\n        anchorMonth: 1,\n        anchorDay: 3,\n    };\n\n    const label = formatWorldClockFactLabel(state);\n    const compact = compactStateForModel(state);\n    assert.match(label, /2138年1月3日/);\n    assert.doesNotMatch(label, /09:17/);\n    assert.match(label, /具体钟点未确定/);\n    assert.equal(compact.world_now_label, label);\n    assert.equal(compact.world_now_coordinate_only, true);\n    assert.equal(compact.world_now, state.clock.absoluteMinute);\n});\n\ntest('unbound story clock exposes story-day fact instead of a fake calendar date', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 5 * 24 * 60 + 13 * 60 + 41;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = false;\n    state.clock.precision = 'day';\n\n    const label = formatWorldClockFactLabel(state);\n    const compact = compactStateForModel(state);\n    assert.match(label, /故事第 5 日/);\n    assert.doesNotMatch(label, /13:41/);\n    assert.equal(compact.world_now, null);\n    assert.equal(compact.world_story_minute, state.clock.absoluteMinute);\n    assert.equal(compact.world_now_label, label);\n});\n\ntest('schema-24 uninitialized clock migrates conservatively without inventing minute precision', () => {\n    const legacy = createInitialState();\n    legacy.schemaVersion = 24;\n    legacy.clock.anchored = false;\n    legacy.clock.precision = 'uninitialized';\n    legacy.clock.absoluteMinute = 6 * 24 * 60 + 8 * 60 + 23;\n    legacy.clock.lastCheckedAt = legacy.clock.absoluteMinute;\n\n    const migrated = trimState(legacy);\n    assert.equal(migrated.clock.anchored, false);\n    assert.equal(migrated.clock.precision, 'day');\n    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /08:23/);\n});\n\ntest('legacy save with no calendar evidence cannot revive a synthetic calendar anchor', () => {\n    const legacy = createInitialState();\n    legacy.schemaVersion = 7;\n    legacy.world.calendar = undefined;\n    legacy.clock = {\n        absoluteMinute: 7 * 24 * 60 + 11 * 60 + 9,\n        lastCheckedAt: 7 * 24 * 60 + 11 * 60 + 9,\n        source: 'narrative',\n        reason: 'legacy narrative progress',\n    };\n    legacy.audit = [];\n\n    const migrated = trimState(legacy);\n    assert.equal(migrated.clock.anchored, false);\n    assert.equal(migrated.clock.precision, 'day');\n    assert.match(formatWorldClockFactLabel(migrated), /故事第 7 日/);\n    assert.doesNotMatch(formatWorldClockFactLabel(migrated), /11:09/);\n});\n`;
}

writeIfChanged(testsPath, testsBefore, tests);
