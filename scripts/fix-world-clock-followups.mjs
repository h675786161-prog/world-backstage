import fs from 'node:fs';

function replaceOnce(source, needle, replacement, label) {
    const first = source.indexOf(needle);
    if (first < 0) throw new Error(`missing ${label}`);
    if (source.indexOf(needle, first + needle.length) >= 0) {
        throw new Error(`ambiguous ${label}`);
    }
    return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

let authority = fs.readFileSync('world-clock-authority.js', 'utf8').replaceAll('\r\n', '\n');
authority = replaceOnce(
    authority,
    `    const minute = Number.isFinite(Number(desiredMinuteOfDay))\n        ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Number(desiredMinuteOfDay)))\n        : minuteOfDay(baseAbsoluteMinute);`,
    `    const hasDesiredMinute = desiredMinuteOfDay !== null\n        && desiredMinuteOfDay !== undefined\n        && Number.isFinite(Number(desiredMinuteOfDay));\n    const minute = hasDesiredMinute\n        ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Number(desiredMinuteOfDay)))\n        : minuteOfDay(baseAbsoluteMinute);`,
    'nullable desired minute guard',
);
fs.writeFileSync('world-clock-authority.js', authority, 'utf8');

let core = fs.readFileSync('core.js', 'utf8').replaceAll('\r\n', '\n');
core = replaceOnce(
    core,
    `        precision: legacyCalendarLooksPlaceholder\n            ? 'uninitialized'\n            : (['minute', 'daypart', 'date', 'uninitialized'].includes(state.clock?.precision)\n                ? state.clock.precision\n                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))\n                    ? 'minute'\n                    : 'uninitialized')),\n    };`,
    `        precision: legacyCalendarLooksPlaceholder\n            ? 'day'\n            : (['minute', 'daypart', 'date', 'day'].includes(state.clock?.precision)\n                ? state.clock.precision\n                : ((state.clock?.anchored === undefined ? inferredAnchored : Boolean(state.clock?.anchored))\n                    ? 'minute'\n                    : 'day')),\n        daypart: asString(state.clock?.daypart, '', 20),\n    };`,
    'trimState clock precision/daypart',
);
fs.writeFileSync('core.js', core, 'utf8');

console.log('world clock follow-up fixes applied');
