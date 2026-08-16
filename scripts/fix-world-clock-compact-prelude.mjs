import fs from 'node:fs';

const path = 'core.js';
const before = fs.readFileSync(path, 'utf8');
let source = before;

const already = '        world_now_coordinate_only: state.clock?.precision !== \'minute\',';
if (!source.includes(already)) {
    const functionStart = source.indexOf('export function compactStateForModel(state, {');
    const blockStart = source.indexOf('        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,', functionStart);
    const worldStart = source.indexOf('        world: {', blockStart);
    if (functionStart < 0 || blockStart < 0 || worldStart < 0) {
        throw new Error('cannot locate compactStateForModel clock header');
    }
    const current = source.slice(blockStart, worldStart);
    if (!current.includes('world_now_label') || !current.includes('world_clock_precision')) {
        throw new Error('unexpected compact clock header; refusing broad replacement');
    }
    const replacement = `        // world_now remains the internal scheduling coordinate for compatibility.
        // When precision is coarse, consumers must not present its minute component
        // as a fact; world_now_label is the authoritative human/model-facing label.
        world_now: state.clock?.anchored ? state.clock.absoluteMinute : null,
        world_story_minute: state.clock?.absoluteMinute ?? 0,
        world_now_coordinate_only: state.clock?.precision !== 'minute',
        world_now_label: formatWorldClockFactLabel(state),
        world_clock_anchored: Boolean(state.clock?.anchored),
        world_clock_precision: state.clock?.precision || 'day',
`;
    source = source.slice(0, blockStart) + replacement + source.slice(worldStart);
}

if (source === before) {
    console.log('core.js: compact clock exposure already safe');
} else {
    fs.writeFileSync(path, source, 'utf8');
    console.log('core.js: compact clock exposure hardened');
}
