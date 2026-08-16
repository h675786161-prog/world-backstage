import fs from 'node:fs';

const path = 'core.js';
const before = fs.readFileSync(path, 'utf8');
let source = before;

const already = `    // Keep the raw calendar long enough to decide whether an old save ever had
    // real calendar evidence. Normalization manufactures a harmless calculation
    // fallback, so using the normalized object for migration would make "missing"
    // data look like a genuine Gregorian date.`;

if (!source.includes(already)) {
    const trimStart = source.indexOf('export function trimState(inputState) {');
    const blockStart = source.indexOf('    state.world = {', trimStart);
    const blockEnd = source.indexOf('    state.clock = {', blockStart);
    if (trimStart < 0 || blockStart < 0 || blockEnd < 0) {
        throw new Error('cannot locate trimState calendar/clock migration prelude');
    }

    const current = source.slice(blockStart, blockEnd);
    if (!current.includes('const legacyCalendarLooksPlaceholder') || !current.includes('const inferredAnchored')) {
        throw new Error('unexpected trimState migration prelude; refusing broad replacement');
    }

    const replacement = `    // Keep the raw calendar long enough to decide whether an old save ever had
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
        : rawCalendarHasAnchor && asString(state.clock?.source, 'initial', 40) !== 'initial';
`;
    source = source.slice(0, blockStart) + replacement + source.slice(blockEnd);
}

if (source === before) {
    console.log('core.js: migration prelude already safe');
} else {
    fs.writeFileSync(path, source, 'utf8');
    console.log('core.js: migration prelude hardened');
}
