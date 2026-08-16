import fs from 'node:fs';

let core = fs.readFileSync('core.js', 'utf8');

const oldCreateGuard = '            if (terminalBeforeMerge && !isTerminalEvent(event)) {';
if ((core.split(oldCreateGuard).length - 1) !== 1) {
    throw new Error('events_create terminal guard not found exactly once');
}
core = core.replace(
    oldCreateGuard,
    '            if (terminalBeforeMerge) {',
);

const oldUpdateGuard = '        if (terminalBeforeUpdate && !TERMINAL_EVENT_STATES.has(requestedStatus)) {';
if ((core.split(oldUpdateGuard).length - 1) !== 1) {
    throw new Error('events_update terminal guard not found exactly once');
}
core = core.replace(
    oldUpdateGuard,
    '        if (terminalBeforeUpdate) {',
);

core = core.replace(
    '            // consequence event, but cannot turn the old event back into an active one.',
    '            // consequence event, but cannot rewrite or reopen the settled old event.',
);

fs.writeFileSync('core.js', core);
console.log('Strengthened terminal event guards: routine inference cannot rewrite settled status/result.');
