import fs from 'node:fs';

function writeIfChanged(path, before, after) {
    if (before === after) {
        console.log(`${path}: already up to date`);
        return;
    }
    fs.writeFileSync(path, after, 'utf8');
    console.log(`${path}: model clock coordinate exposure hardened`);
}

const corePath = 'core.js';
let core = fs.readFileSync(corePath, 'utf8');
const coreBefore = core;

const functionStart = core.indexOf('export function compactStateForModel(state, {');
const returnStart = core.indexOf('    return {', functionStart);
const worldStart = core.indexOf('        world: {', returnStart);
if (functionStart < 0 || returnStart < 0 || worldStart < 0) {
    throw new Error('cannot locate compactStateForModel clock exposure');
}

const clockHeader = core.slice(returnStart + '    return {\n'.length, worldStart);
const safeMarker = 'world_day_index: Math.floor((state.clock?.absoluteMinute ?? 0) / MINUTES_PER_DAY),';
if (!clockHeader.includes(safeMarker)) {
    if (!clockHeader.includes('world_now_label: formatWorldClockFactLabel(state)')) {
        throw new Error('unexpected compact clock header; refusing replacement');
    }
    const replacement = `        // Numeric minute coordinates are model-visible only when minute precision is
        // actually known. Coarse date/day/daypart states keep their internal minute
        // solely for deterministic scheduling; exposing it here would let the model
        // reconstruct a clock time that the narrative never established.
        world_now: state.clock?.anchored && state.clock?.precision === 'minute'
            ? state.clock.absoluteMinute
            : null,
        world_story_minute: state.clock?.precision === 'minute'
            ? state.clock?.absoluteMinute ?? 0
            : null,
        world_day_index: Math.floor((state.clock?.absoluteMinute ?? 0) / MINUTES_PER_DAY),
        world_now_coordinate_only: state.clock?.precision !== 'minute',
        world_now_label: formatWorldClockFactLabel(state),
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'day',
`;
    core = core.slice(0, returnStart + '    return {\n'.length) + replacement + core.slice(worldStart);
}

writeIfChanged(corePath, coreBefore, core);

const testsPath = 'tests/world-clock-core.test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
const testsBefore = tests;

tests = tests.replace(
    `    assert.equal(compact.world_now_coordinate_only, true);\n    assert.equal(compact.world_now, state.clock.absoluteMinute);`,
    `    assert.equal(compact.world_now_coordinate_only, true);\n    assert.equal(compact.world_now, null);\n    assert.equal(compact.world_story_minute, null);\n    assert.equal(compact.world_day_index, 3);`,
);
tests = tests.replace(
    `    assert.equal(compact.world_now, null);\n    assert.equal(compact.world_story_minute, state.clock.absoluteMinute);\n    assert.equal(compact.world_now_label, label);`,
    `    assert.equal(compact.world_now, null);\n    assert.equal(compact.world_story_minute, null);\n    assert.equal(compact.world_day_index, 5);\n    assert.equal(compact.world_now_label, label);`,
);

const marker = "test('model context exposes numeric minute coordinate only when minute precision is factual'";
if (!tests.includes(marker)) {
    tests += `\n\ntest('model context exposes numeric minute coordinate only when minute precision is factual', () => {\n    let state = createInitialState();\n    state.clock.absoluteMinute = 2 * 24 * 60 + 14 * 60 + 26;\n    state.clock.lastCheckedAt = state.clock.absoluteMinute;\n    state.clock.anchored = true;\n    state.clock.precision = 'minute';\n    state.world.calendar = {\n        name: '主世界历',\n        anchorAbsoluteDay: 2,\n        anchorYear: 2138,\n        anchorMonth: 1,\n        anchorDay: 2,\n    };\n\n    const compact = compactStateForModel(state);\n    assert.equal(compact.world_now, state.clock.absoluteMinute);\n    assert.equal(compact.world_story_minute, state.clock.absoluteMinute);\n    assert.equal(compact.world_day_index, 2);\n    assert.equal(compact.world_now_coordinate_only, false);\n    assert.match(compact.world_now_label, /14:26/);\n});\n`;
}

writeIfChanged(testsPath, testsBefore, tests);
