import {
    MINUTES_PER_DAY,
    buildClockAuthorityLines,
    extractStructuredTimeScope,
    normalizeClueTiming,
    resolveFutureTimeExpression,
    resolveNarrativeTimeTransition as resolveNarrativeTimeTransitionBase,
} from './world-clock-authority-base.js';

export {
    MINUTES_PER_DAY,
    buildClockAuthorityLines,
    extractStructuredTimeScope,
    normalizeClueTiming,
    resolveFutureTimeExpression,
};

function trailingStructuredExactClockRefinement(text = '', options = {}) {
    if (!options?.calendarBound) return null;
    if (!['date', 'day'].includes(String(options?.currentPrecision || ''))) return null;

    const source = String(text || '');
    const structuredScope = extractStructuredTimeScope(source);
    if (!structuredScope) return null;

    // Only a trailing time block may refine a coarse clock backwards. An opening
    // time header is a scene start and must never swallow actions/elapsed time
    // that occur after it.
    const scopeIndex = source.lastIndexOf(structuredScope);
    if (scopeIndex < 0 || source.slice(scopeIndex + structuredScope.length).trim()) return null;

    const clocks = [...structuredScope.matchAll(
        /(?:^|[^\d])([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?!\d)/gu,
    )];
    const exact = clocks.at(-1);
    if (!exact) return null;

    const baseAbsoluteMinute = Math.max(0, Number.parseInt(options?.currentAbsoluteMinute, 10) || 0);
    const hour = Number(exact[1]);
    const minute = Number(exact[2]);
    const targetAbsoluteMinute = Math.floor(baseAbsoluteMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY
        + hour * 60
        + minute;

    // Forward/equal clocks are already handled by the base resolver. This branch
    // exists solely because a date-only clock can retain an internal arithmetic
    // minute that is not an asserted fact and therefore must not block refinement.
    if (targetAbsoluteMinute >= baseAbsoluteMinute) return null;

    return {
        kind: 'structured-clock-coarse-refinement',
        targetAbsoluteMinute,
        replaceCurrent: false,
        precision: 'minute',
        daypart: '',
        sourceText: exact[0].trim(),
        reason: '正文末尾时间栏给出明确钟点，细化此前只有日期精度的世界钟；内部分钟坐标不作为已知钟点阻止校准',
    };
}

export function resolveNarrativeTimeTransition(text = '', options = {}) {
    const resolved = resolveNarrativeTimeTransitionBase(text, options);
    if (resolved) return resolved;
    return trailingStructuredExactClockRefinement(text, options);
}
