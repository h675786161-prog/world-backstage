import fs from 'node:fs';

function replaceOnce(text, pattern, replacement, label) {
    const matches = typeof pattern === 'string'
        ? text.split(pattern).length - 1
        : [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
    if (matches !== 1) throw new Error(`${label}: expected exactly one match, got ${matches}`);
    return text.replace(pattern, replacement);
}

const join = lines => lines.join('\n');

let ui = fs.readFileSync('ui.js', 'utf8');
ui = replaceOnce(
    ui,
    /                <label>预计结果<textarea name="expectedResult" maxlength="420" rows="2">\$\{escapeHtml\(event\?\.expectedResult \|\| event\?\.consequence \|\| ''\)\}<\/textarea><\/label>/,
    join([
        "                <label>预计结果<textarea name=\"expectedResult\" maxlength=\"420\" rows=\"2\">${escapeHtml(event?.expectedResult || event?.consequence || '')}</textarea></label>",
        '                ${isEdit ? `',
        '                    <div class="wb-form-grid">',
        '                        <label>当前状态',
        '                            <select name="status">',
        "                                <option value=\"active\" ${event?.status === 'active' ? 'selected' : ''}>发展中</option>",
        "                                <option value=\"waiting\" ${event?.status === 'waiting' ? 'selected' : ''}>等待条件</option>",
        "                                <option value=\"ready\" ${event?.status === 'ready' ? 'selected' : ''}>到时待确认</option>",
        "                                <option value=\"resolved\" ${event?.status === 'resolved' ? 'selected' : ''}>已结束</option>",
        "                                <option value=\"cancelled\" ${event?.status === 'cancelled' ? 'selected' : ''}>已取消</option>",
        "                                <option value=\"missed\" ${event?.status === 'missed' ? 'selected' : ''}>已错过</option>",
        '                            </select>',
        '                        </label>',
        '                        <label>实际结果（可选）',
        "                            <textarea name=\"result\" maxlength=\"620\" rows=\"2\" placeholder=\"只写已经真实形成的结果\">${escapeHtml(event?.result || '')}</textarea>",
        '                        </label>',
        '                    </div>',
        '                    <p class="wb-form-hint">手动状态是当前世界事实；标记为已结束 / 已取消 / 已错过后，后台推演不会把这条旧暗流偷偷改回发展中。若后来真的出现新后果，应作为新的暗流继续。</p>',
        "                ` : ''}",
    ]),
    'event editor status fields',
);
ui = replaceOnce(ui, "        resolved: '结果已形成',", "        resolved: '已结束',", 'resolved label');
fs.writeFileSync('ui.js', ui);

let index = fs.readFileSync('index.js', 'utf8');
index = replaceOnce(
    index,
    /        const timingChanged = previousClockMode !== clockMode \|\| previousDuration !== durationMinutes;/,
    join([
        '        const timingChanged = previousClockMode !== clockMode || previousDuration !== durationMinutes;',
        '        const previousStatus = event.status;',
        "        const previousWasTerminal = ['resolved', 'cancelled', 'missed'].includes(previousStatus);",
        "        const requestedStatus = ['active', 'waiting', 'ready', 'resolved', 'cancelled', 'missed']",
        '            .includes(payload.status)',
        '            ? payload.status',
        '            : previousStatus;',
        "        const hasManualResult = Object.prototype.hasOwnProperty.call(payload, 'result');",
    ]),
    'manual event requested status',
);
index = replaceOnce(
    index,
    /        event\.updatedAt = next\.clock\.absoluteMinute;\r?\n        event\.resolvedAt = null;\r?\n        commitManualState\(next, `暗流“\$\{event\.title\}”已经更新。`\);/,
    join([
        '        event.status = requestedStatus;',
        "        if (['resolved', 'cancelled', 'missed'].includes(requestedStatus)) {",
        "            if (hasManualResult) event.result = String(payload.result || '').trim().slice(0, 620);",
        '            event.resolvedAt = previousWasTerminal',
        '                ? (event.resolvedAt ?? next.clock.absoluteMinute)',
        '                : next.clock.absoluteMinute;',
        '        } else {',
        "            if (previousWasTerminal && requestedStatus !== previousStatus) event.result = '';",
        '            event.resolvedAt = null;',
        '        }',
        '        event.updatedAt = next.clock.absoluteMinute;',
        '        commitManualState(next, `暗流“${event.title}”已经更新。`);',
    ]),
    'manual event terminal commit',
);
fs.writeFileSync('index.js', index);

let core = fs.readFileSync('core.js', 'utf8');
core = replaceOnce(
    core,
    /    for \(const rawEvent of payload\.eventsCreate\) \{\r?\n        const existing = findEvent\(state, rawEvent\);\r?\n        const event = normalizeEvent\(rawEvent, worldMinute, existing\);\r?\n        event\.updatedAt = worldMinute;\r?\n        if \(existing\) \{\r?\n            Object\.assign\(existing, event\);/,
    join([
        '    for (const rawEvent of payload.eventsCreate) {',
        '        const existing = findEvent(state, rawEvent);',
        '        const terminalBeforeMerge = existing && isTerminalEvent(existing)',
        '            ? {',
        '                status: existing.status,',
        '                result: existing.result,',
        '                resolvedAt: existing.resolvedAt,',
        '            }',
        '            : null;',
        '        const event = normalizeEvent(rawEvent, worldMinute, existing);',
        '        event.updatedAt = worldMinute;',
        '        if (existing) {',
        '            // A finished event is a settled world fact. Routine background inference',
        '            // may enrich its metadata, but it must not resurrect the old process.',
        '            if (terminalBeforeMerge && !isTerminalEvent(event)) {',
        '                Object.assign(event, terminalBeforeMerge);',
        '            }',
        '            Object.assign(existing, event);',
    ]),
    'events_create terminal guard',
);
core = replaceOnce(
    core,
    /    for \(const update of payload\.eventsUpdate\) \{\r?\n        const event = findEvent\(state, update\);\r?\n        if \(!event\) continue;\r?\n\r?\n        const workedMinutes = asInteger\(/,
    join([
        '    for (const update of payload.eventsUpdate) {',
        '        const event = findEvent(state, update);',
        '        if (!event) continue;',
        '        const terminalBeforeUpdate = isTerminalEvent(event)',
        '            ? {',
        '                status: event.status,',
        '                result: event.result,',
        '                resolvedAt: event.resolvedAt,',
        '            }',
        '            : null;',
        '',
        '        const workedMinutes = asInteger(',
    ]),
    'events_update terminal snapshot',
);
core = replaceOnce(
    core,
    /        const requestedStatus = normalizeEventStatus\(update\?\.status \?\? event\.status\);\r?\n        if \(TERMINAL_EVENT_STATES\.has\(requestedStatus\)\) \{/,
    join([
        '        const requestedStatus = normalizeEventStatus(update?.status ?? event.status);',
        '        if (terminalBeforeUpdate && !TERMINAL_EVENT_STATES.has(requestedStatus)) {',
        '            // Terminal means this process has ended. A later simulation may create a',
        '            // consequence event, but cannot turn the old event back into an active one.',
        '            event.status = terminalBeforeUpdate.status;',
        '            event.result = terminalBeforeUpdate.result;',
        '            event.resolvedAt = terminalBeforeUpdate.resolvedAt;',
        '            event.updatedAt = worldMinute;',
        '        } else if (TERMINAL_EVENT_STATES.has(requestedStatus)) {',
    ]),
    'events_update terminal guard',
);
fs.writeFileSync('core.js', core);

console.log('Applied manual event status correction and terminal-event anti-resurrection guards.');
