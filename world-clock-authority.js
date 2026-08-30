import { parseTraditionalClock } from './traditional-time.js';

export const MINUTES_PER_DAY = 24 * 60;

const DAYPARTS = Object.freeze([
    { label: '凌晨', minute: 180, pattern: /凌晨/u },
    { label: '黎明', minute: 300, pattern: /黎明/u },
    { label: '清晨', minute: 360, pattern: /清晨/u },
    { label: '早晨', minute: 420, pattern: /早晨/u },
    { label: '上午', minute: 540, pattern: /上午/u },
    { label: '中午', minute: 720, pattern: /中午/u },
    { label: '午后', minute: 840, pattern: /午后/u },
    { label: '下午', minute: 900, pattern: /下午/u },
    { label: '傍晚', minute: 1080, pattern: /傍晚/u },
    { label: '黄昏', minute: 1110, pattern: /黄昏/u },
    { label: '晚上', minute: 1200, pattern: /晚上/u },
    { label: '夜晚', minute: 1260, pattern: /夜晚/u },
    { label: '深夜', minute: 1380, pattern: /深夜/u },
]);

const WEEKDAY_INDEX = Object.freeze({
    一: 0,
    二: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    日: 6,
    天: 6,
});

function integer(value, fallback = 0) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function chineseInteger(text = '') {
    const source = String(text || '').trim();
    if (!source) return null;
    if (/^\d+$/.test(source)) return Number(source);
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (source === '十') return 10;
    const ten = source.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u);
    if (ten) return (ten[1] ? digits[ten[1]] : 1) * 10 + (ten[2] ? digits[ten[2]] : 0);
    if ([...source].every(char => Object.prototype.hasOwnProperty.call(digits, char))) {
        return Number([...source].map(char => digits[char]).join(''));
    }
    return null;
}

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function normalizeDate(raw) {
    const year = integer(raw?.year, 0);
    const month = integer(raw?.month ?? raw?.monthOfYear, 0);
    const day = integer(raw?.day ?? raw?.dayOfMonth, 0);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return { year, month, day };
}

function daysBeforeYear(year) {
    const previous = Math.max(0, year - 1);
    return previous * 365
        + Math.floor(previous / 4)
        - Math.floor(previous / 100)
        + Math.floor(previous / 400);
}

function dateOrdinal(rawDate) {
    const date = normalizeDate(rawDate);
    if (!date) return null;
    let ordinal = daysBeforeYear(date.year);
    for (let month = 1; month < date.month; month += 1) ordinal += daysInMonth(date.year, month);
    return ordinal + date.day - 1;
}

function dateFromOrdinal(value) {
    let target = Math.max(0, Math.trunc(Number(value) || 0));
    let low = 1;
    let high = 999999;
    while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (daysBeforeYear(middle) <= target) low = middle;
        else high = middle - 1;
    }
    const year = low;
    let rest = target - daysBeforeYear(year);
    let month = 1;
    while (month < 12) {
        const monthDays = daysInMonth(year, month);
        if (rest < monthDays) break;
        rest -= monthDays;
        month += 1;
    }
    return { year, month, day: rest + 1 };
}

function addDateDays(date, delta) {
    const ordinal = dateOrdinal(date);
    return ordinal === null ? null : dateFromOrdinal(ordinal + integer(delta, 0));
}

function dateDifference(from, to) {
    const left = dateOrdinal(from);
    const right = dateOrdinal(to);
    return left === null || right === null ? null : right - left;
}

function weekdayIndex(date) {
    const ordinal = dateOrdinal(date);
    return ordinal === null ? null : ordinal % 7; // 0001-01-01 is Monday in proleptic Gregorian.
}

export function extractStructuredTimeScope(text = '') {
    const source = String(text || '');
    const candidates = [];
    const collect = (pattern, kind = 'line') => {
        for (const match of source.matchAll(pattern)) {
            const index = Number(match.index || 0);
            const text = String(match[0] || '');
            candidates.push({
                index,
                end: index + text.length,
                text,
                kind,
            });
        }
    };

    // Common collapsible status header used by several presets.
    collect(/<details\b[^>]*>[\s\S]*?<summary\b[^>]*>[\s\S]*?(?:时间\s*[与和]\s*地点|时间地点|time\s*(?:&|and)\s*(?:place|location))[\s\S]*?<\/summary>[\s\S]*?<\/details>/giu, 'block');

    // XML-like semantic wrappers used by prompt presets, for example
    // <time_format>...</time_format> and <scene_time>...</scene_time>.
    collect(/<(time(?:[_-]?(?:format|info|status))?|date[_-]?time|datetime|story[_-]?time|world[_-]?time|scene[_-]?time)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, 'block');

    // Plain/Markdown status lines are accepted only when explicitly labelled as
    // time. A bare clock inside narrative dialogue must never become authority.
    collect(/^(?:\s*(?:[-*#>|]+\s*)?(?:\*\*|__)?(?:当前|本轮|场景|故事|世界)?\s*(?:时间|time|date\s*(?:&|and)\s*time)(?:\*\*|__)?\s*[:：]\s*[^\n\r]+)$/gimu);

    if (!candidates.length) return '';
    const blocks = candidates.filter(candidate => candidate.kind === 'block');
    const visibleCandidates = candidates.filter(candidate => (
        candidate.kind === 'block'
        || !blocks.some(block => candidate.index >= block.index && candidate.end <= block.end)
    ));
    visibleCandidates.sort((left, right) => left.index - right.index);
    return visibleCandidates.at(-1).text;
}

function latestDaypart(text = '') {
    const source = String(text || '');
    let latest = null;
    for (const item of DAYPARTS) {
        for (const match of source.matchAll(new RegExp(item.pattern.source, 'gu'))) {
            const index = Number(match.index || 0);
            if (!latest || index >= latest.index) latest = { ...item, index, sourceText: match[0] };
        }
    }
    return latest;
}

function latestStoryDayIndex(text = '') {
    const source = String(text || '');
    const matches = [
        ...source.matchAll(/(?:故事|剧情|灾变后)?\s*第\s*(\d+|[一二两三四五六七八九十]+)\s*[日天]/gu),
        ...source.matchAll(/\bday\s*(\d+)\b/giu),
    ].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
    if (!matches.length) return null;
    const value = chineseInteger(matches.at(-1)?.[1]);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function latestExactClock(text = '') {
    const source = String(text || '');
    const transitions = [...source.matchAll(/(?:▶|>)?\s*([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\s*(?:→|->|至|到|[-–—~～])\s*([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)/gu)];
    if (transitions.length) {
        const match = transitions.at(-1);
        return {
            hour: Number(match[3]),
            minute: Number(match[4]),
            index: Number(match.index || 0),
            sourceText: match[0].trim(),
        };
    }
    const clocks = [...source.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?!\d)/gu)];
    if (clocks.length) {
        const match = clocks.at(-1);
        return {
            hour: Number(match[1]),
            minute: Number(match[2]),
            index: Number(match.index || 0),
            sourceText: match[0].trim(),
        };
    }
    const traditional = parseTraditionalClock(source);
    if (!traditional?.precise) return null;
    return {
        hour: traditional.hour,
        minute: traditional.minute,
        index: traditional.index,
        sourceText: traditional.sourceText,
        traditional: true,
        traditionalLabel: traditional.label,
        traditionalPeriod: traditional.periodLabel,
        traditionalCrossesMidnight: Boolean(traditional.crossesMidnight),
    };
}

function latestAbsoluteDate(text = '') {
    const source = String(text || '');
    const patterns = [
        /(?:^|\D)(\d{1,6})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\D|$)/gu,
        /(?:^|\D)(\d{1,6})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/gu,
    ];
    let latest = null;
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const date = normalizeDate({ year: match[1], month: match[2], day: match[3] });
            if (!date) continue;
            const index = Number(match.index || 0);
            if (!latest || index >= latest.index) latest = { ...date, index, sourceText: match[0].trim() };
        }
    }
    return latest;
}

function minuteOfDay(absoluteMinute) {
    const safe = Math.max(0, integer(absoluteMinute, 0));
    return safe % MINUTES_PER_DAY;
}

function dayIndex(absoluteMinute) {
    return Math.floor(Math.max(0, integer(absoluteMinute, 0)) / MINUTES_PER_DAY);
}

function targetMinuteForDay(baseAbsoluteMinute, dayDelta, desiredMinuteOfDay = null) {
    const baseDay = dayIndex(baseAbsoluteMinute);
    const hasDesiredMinute = desiredMinuteOfDay !== null
        && desiredMinuteOfDay !== undefined
        && Number.isFinite(Number(desiredMinuteOfDay));
    const minute = hasDesiredMinute
        ? Math.max(0, Math.min(MINUTES_PER_DAY - 1, Number(desiredMinuteOfDay)))
        : minuteOfDay(baseAbsoluteMinute);
    return (baseDay + integer(dayDelta, 0)) * MINUTES_PER_DAY + minute;
}

function traditionalCandidate(token, extra = {}) {
    const parsed = parseTraditionalClock(token);
    if (!parsed) return null;
    return {
        ...extra,
        desiredMinuteOfDay: parsed.minuteOfDay,
        traditionalPrecision: parsed.precision,
        traditionalCrossesMidnight: Boolean(parsed.crossesMidnight),
        daypart: parsed.periodLabel,
        confidence: 'high',
    };
}

function transitionCandidates(text = '') {
    const source = String(text || '');
    const candidates = [];
    const boundary = '(?:^|[。！？!?；;\\n])\\s*';
    const sequencePrefix = '(?:(?:随后|接着|然后|之后|此后)\\s*)?(?:又\\s*|再\\s*)?';
    const daypart = '(凌晨|黎明|清晨|早晨|上午|中午|午后|下午|傍晚|黄昏|晚上|夜晚|深夜)?';
    const traditionalToken = '([子丑寅卯辰巳午未申酉戌亥](?:时(?:\\s*(?:初|正))?(?:\\s*(?:\\d+|[零〇一二两三四五六七八九])\\s*刻)?|(?:初|正)(?:\\s*(?:\\d+|[零〇一二两三四五六七八九])\\s*刻)?))';
    const add = (pattern, mapper) => {
        for (const match of source.matchAll(pattern)) {
            const candidate = mapper(match);
            if (candidate) candidates.push({ ...candidate, index: Number(match.index || 0), sourceText: match[0].trim() });
        }
    };

    add(new RegExp(`${boundary}${sequencePrefix}(次日|翌日|第二天|隔天)(?:的)?\\s*${daypart}`, 'gu'), match => ({
        dayDelta: 1,
        daypart: match[2] || '',
        confidence: 'high',
    }));

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?|醒来时(?:已经)?|一觉醒来(?:已经)?)\\s*(明天|后天|大后天)\\s*${daypart}`, 'gu'), match => ({
        dayDelta: match[1] === '明天' ? 1 : match[1] === '后天' ? 2 : 3,
        daypart: match[2] || '',
        confidence: 'high',
    }));

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?|经过|过了)\\s*(\\d+|[一二两三四五六七八九十]+)\\s*(分钟|小时|天|日)(?:后)?\\s*${daypart}`, 'gu'), match => {
        const count = chineseInteger(match[1]);
        if (!Number.isFinite(count) || count < 0) return null;
        if (match[2] === '分钟') return { minuteDelta: count, daypart: match[3] || '', confidence: 'high' };
        if (match[2] === '小时') return { minuteDelta: count * 60, daypart: match[3] || '', confidence: 'high' };
        return { dayDelta: count, daypart: match[3] || '', confidence: 'high' };
    });

    add(new RegExp(`${boundary}${sequencePrefix}(次日|翌日|第二天|隔天)(?:的)?\\s*${traditionalToken}\\s*[，,]`, 'gu'), match => traditionalCandidate(match[2], { dayDelta: 1 }));
    add(new RegExp(`${boundary}${sequencePrefix}当天\\s*${traditionalToken}\\s*[，,]`, 'gu'), match => traditionalCandidate(match[1], { sameTraditional: true }));
    add(new RegExp(`${boundary}${sequencePrefix}(?:到了?|时间(?:来)?到(?:了)?|转眼(?:已经)?到了?)\\s*${traditionalToken}\\s*[，,]`, 'gu'), match => traditionalCandidate(match[1], { sameTraditional: true }));

    add(new RegExp(`${boundary}${sequencePrefix}(?:转眼|一晃|时间(?:来)?到(?:了)?|到了?)\\s*(下周|本周)?(?:周|星期)([一二三四五六日天])\\s*${daypart}`, 'gu'), match => ({
        weekdayMode: match[1] === '下周' ? 'next-week' : match[1] === '本周' ? 'this-week' : 'next-occurrence',
        weekday: WEEKDAY_INDEX[match[2]],
        daypart: match[3] || '',
        confidence: 'high',
    }));

    return candidates.sort((a, b) => a.index - b.index);
}
function weekdayDelta(currentDate, targetWeekday, mode) {
    const currentWeekday = weekdayIndex(currentDate);
    if (currentWeekday === null || !Number.isFinite(targetWeekday)) return null;
    if (mode === 'this-week') {
        const delta = targetWeekday - currentWeekday;
        return delta >= 0 ? delta : null;
    }
    if (mode === 'next-week') {
        return (7 - currentWeekday) + targetWeekday;
    }
    const delta = (targetWeekday - currentWeekday + 7) % 7;
    return delta === 0 ? 7 : delta;
}

function daypartMinute(label) {
    return DAYPARTS.find(item => item.label === label)?.minute ?? null;
}

/**
 * Resolves only evidence that the narrative has actually moved the current scene
 * time. A future promise like “明天见” is deliberately NOT a clock transition.
 */
export function resolveNarrativeTimeTransition(text = '', {
    currentAbsoluteMinute = 0,
    currentCalendar = null,
    calendarBound = false,
    narrativeAnchor = null,
    currentPrecision = 'day',
    currentDaypart = '',
} = {}) {
    const source = String(text || '');
    const structuredScope = extractStructuredTimeScope(source);
    const baseAbsoluteMinute = Math.max(0, integer(currentAbsoluteMinute, 0));
    const currentDate = normalizeDate({
        year: currentCalendar?.year,
        month: currentCalendar?.month,
        day: currentCalendar?.dayOfMonth ?? currentCalendar?.day,
    });
    const structuredTraditional = structuredScope ? parseTraditionalClock(structuredScope) : null;

    const exact = narrativeAnchor?.hour !== null && narrativeAnchor?.hour !== undefined
        && narrativeAnchor?.minute !== null && narrativeAnchor?.minute !== undefined
        ? {
            hour: Number(narrativeAnchor.hour),
            minute: Number(narrativeAnchor.minute),
            sourceText: narrativeAnchor.excerpt || '',
        }
        : (structuredScope ? latestExactClock(structuredScope) : null);
    const anchorDaypart = String(narrativeAnchor?.daypart || '').trim();
    const structuredDaypart = anchorDaypart || latestDaypart(structuredScope)?.label || '';
    const structuredStoryDay = structuredScope && !calendarBound
        ? latestStoryDayIndex(structuredScope)
        : null;

    if (structuredScope && exact) {
        const targetDay = structuredStoryDay ?? dayIndex(baseAbsoluteMinute);
        let target = targetDay * MINUTES_PER_DAY + exact.hour * 60 + exact.minute;
        if (
            exact.traditionalCrossesMidnight
            && structuredStoryDay === null
            && minuteOfDay(baseAbsoluteMinute) >= 23 * 60
            && target < baseAbsoluteMinute
        ) {
            target += MINUTES_PER_DAY;
        }
        if (target >= baseAbsoluteMinute) {
            return {
                kind: exact.traditional ? 'structured-traditional-clock' : 'structured-clock',
                targetAbsoluteMinute: target,
                replaceCurrent: !calendarBound,
                precision: 'minute',
                daypart: exact.traditionalPeriod || structuredDaypart,
                sourceText: exact.sourceText || structuredScope.slice(0, 160),
                reason: exact.traditional
                    ? '正文时间栏给出明确十二时辰刻点，换算为同一权威世界钟'
                    : calendarBound
                        ? '正文时间栏给出更晚的明确钟点，推进世界时钟'
                        : '正文时间栏给出明确钟点，向前校准相对世界时钟',
            };
        }
    }

    const candidates = transitionCandidates(source);
    if (candidates.length) {
        let target = baseAbsoluteMinute;
        const coarsePrecision = calendarBound ? 'date' : 'day';
        let precision = ['minute', 'daypart', 'date', 'day'].includes(currentPrecision)
            ? currentPrecision
            : coarsePrecision;
        let resolvedDaypart = precision === 'daypart' ? String(currentDaypart || '').trim() : '';
        if (precision === 'daypart' && !resolvedDaypart) precision = coarsePrecision;
        const applied = [];

        for (const transition of candidates) {
            let nextTarget = null;
            let wholeDayShift = false;
            if (Number.isFinite(transition.minuteDelta)) {
                nextTarget = target + transition.minuteDelta;
            } else if (Number.isFinite(transition.dayDelta)) {
                wholeDayShift = true;
                const desired = Number.isFinite(transition.desiredMinuteOfDay)
                    ? transition.desiredMinuteOfDay
                    : daypartMinute(transition.daypart);
                nextTarget = targetMinuteForDay(target, transition.dayDelta, desired);
            } else if (transition.sameTraditional && Number.isFinite(transition.desiredMinuteOfDay)) {
                let candidate = dayIndex(target) * MINUTES_PER_DAY + transition.desiredMinuteOfDay;
                if (
                    transition.traditionalCrossesMidnight
                    && minuteOfDay(target) >= 23 * 60
                    && candidate < target
                ) {
                    candidate += MINUTES_PER_DAY;
                }
                if (candidate >= target) nextTarget = candidate;
            } else if (Number.isFinite(transition.weekday) && calendarBound && currentDate) {
                const elapsedDays = dayIndex(target) - dayIndex(baseAbsoluteMinute);
                const cursorDate = addDateDays(currentDate, elapsedDays);
                const delta = weekdayDelta(cursorDate, transition.weekday, transition.weekdayMode);
                if (delta !== null) {
                    wholeDayShift = true;
                    nextTarget = targetMinuteForDay(target, delta, daypartMinute(transition.daypart));
                }
            }

            if (!Number.isFinite(nextTarget) || nextTarget < target) continue;
            target = Math.max(0, nextTarget);
            if (transition.traditionalPrecision === 'minute') {
                precision = 'minute';
                resolvedDaypart = transition.daypart || '';
            } else if (transition.daypart) {
                precision = 'daypart';
                resolvedDaypart = transition.daypart;
            } else if (wholeDayShift) {
                // A whole-day/date jump proves which day the world reached, but it
                // does not prove that the old clock minute survived unchanged. Keep
                // the internal minute only as a calculation coordinate and lower the
                // exposed fact precision so stale exact time cannot propagate.
                precision = coarsePrecision;
                resolvedDaypart = '';
            } else if (precision === 'daypart') {
                // An exact elapsed duration can preserve exact-minute precision, but
                // a fuzzy daypart cannot remain authoritative after arbitrary time.
                precision = coarsePrecision;
                resolvedDaypart = '';
            }
            applied.push(transition);
        }

        if (applied.length) {
            const finalTransition = applied.at(-1);
            return {
                kind: 'narrative-transition',
                targetAbsoluteMinute: target,
                replaceCurrent: false,
                precision,
                daypart: resolvedDaypart,
                sourceText: applied.map(item => item.sourceText).filter(Boolean).join(' → ').slice(0, 180),
                reason: applied.length > 1
                    ? `正文连续发生了 ${applied.length} 段时间推进，按出现顺序累计结算`
                    : '正文明确发生了时间跳转，按世界钟确定性推进',
                evidenceCount: applied.length,
                finalEvidence: finalTransition.sourceText,
            };
        }
    }

    if (structuredScope && structuredTraditional && !structuredTraditional.precise && !exact) {
        const targetDay = structuredStoryDay ?? dayIndex(baseAbsoluteMinute);
        const target = targetDay * MINUTES_PER_DAY + structuredTraditional.minuteOfDay;
        if (target >= baseAbsoluteMinute) {
            return {
                kind: 'structured-traditional-period',
                targetAbsoluteMinute: target,
                replaceCurrent: !calendarBound,
                precision: 'daypart',
                daypart: structuredTraditional.periodLabel,
                sourceText: structuredTraditional.sourceText,
                reason: '正文时间栏只给出十二时辰，不伪造刻数；内部仅用该时辰起点作为结算坐标',
            };
        }
    }

    if (structuredScope && structuredDaypart && !exact) {
        const desired = daypartMinute(structuredDaypart);
        if (desired !== null) {
            const targetDay = structuredStoryDay ?? dayIndex(baseAbsoluteMinute);
            const target = targetDay * MINUTES_PER_DAY + desired;
            if (target >= baseAbsoluteMinute) {
                return {
                    kind: 'structured-daypart',
                    targetAbsoluteMinute: target,
                    replaceCurrent: !calendarBound,
                    precision: 'daypart',
                    daypart: structuredDaypart,
                    sourceText: structuredDaypart,
                    reason: '正文时间栏只给出时段，保留时段精度而不伪造精确钟点',
                };
            }
        }
    }

    return null;
}
function findFutureExpression(text = '') {
    const source = String(text || '');
    const explicit = latestAbsoluteDate(source);
    if (explicit) {
        const exact = latestExactClock(source.slice(Math.max(0, explicit.index - 20), explicit.index + 100));
        const daypart = latestDaypart(source.slice(Math.max(0, explicit.index - 20), explicit.index + 100));
        return {
            type: 'absolute-date',
            index: explicit.index,
            date: { year: explicit.year, month: explicit.month, day: explicit.day },
            exact,
            daypart: daypart?.label || '',
            sourceText: explicit.sourceText,
        };
    }

    const patterns = [
        { pattern: /(大后天|后天|明天|今天|今晚|明早|明晨|明晚|今日|明日|翌日|今夜)/gu, type: 'relative-word' },
        { pattern: /(\d+|[一二两三四五六七八九十]+)\s*[天日]\s*后/gu, type: 'relative-days' },
        { pattern: /(下周|本周)?(?:周|星期)([一二三四五六日天])/gu, type: 'weekday' },
        { pattern: /(周末|以后|之后|改天|有空时|有机会时|等.+?以后)/gu, type: 'condition' },
    ];
    let earliest = null;
    for (const item of patterns) {
        for (const match of source.matchAll(item.pattern)) {
            const index = Number(match.index || 0);
            if (!earliest || index < earliest.index) earliest = { ...item, match, index };
        }
    }
    if (!earliest) return null;
    return { type: earliest.type, match: earliest.match, index: earliest.index, sourceText: earliest.match[0] };
}

export function resolveFutureTimeExpression(text = '', {
    baseAbsoluteMinute = 0,
    baseCalendar = null,
    calendarBound = false,
} = {}) {
    const expression = findFutureExpression(text);
    if (!expression) return null;
    const baseMinute = Math.max(0, integer(baseAbsoluteMinute, 0));
    const baseDate = normalizeDate({
        year: baseCalendar?.year,
        month: baseCalendar?.month,
        day: baseCalendar?.dayOfMonth ?? baseCalendar?.day,
    });
    const nearby = String(text || '');
    const expressionIndex = Math.max(0, Number(expression.index ?? expression.match?.index ?? 0));
    const expressionEnd = Math.min(nearby.length, expressionIndex + String(expression.sourceText || '').length);
    const tail = nearby.slice(expressionEnd);
    const boundaryOffset = tail.search(/[。！？!?；;\n]/u);
    const localEnd = boundaryOffset >= 0
        ? expressionEnd + boundaryOffset
        : nearby.length;
    // Attach a clock/daypart only when it belongs to the same clause as the
    // chosen future expression. An unrelated 09:00 elsewhere in the evidence
    // must never turn a date-only promise into a fake 09:00 appointment.
    const localTimingScope = nearby.slice(expressionIndex, localEnd);
    const relativeWord = expression.type === 'relative-word' ? String(expression.match?.[1] || '') : '';
    const implicitDaypart = ['今晚', '明晚', '今夜'].includes(relativeWord)
        ? '晚上'
        : relativeWord === '明早'
            ? '早晨'
            : relativeWord === '明晨'
                ? '清晨'
                : '';
    const daypart = latestDaypart(localTimingScope)?.label || implicitDaypart;
    const exact = latestExactClock(localTimingScope);
    const desiredMinute = exact
        ? exact.hour * 60 + exact.minute
        : daypartMinute(daypart);
    const precision = exact ? 'minute' : daypart ? 'daypart' : 'date';

    if (expression.type === 'condition') {
        return normalizeClueTiming({
            kind: 'condition',
            sourceText: expression.sourceText,
            targetWorldMinute: null,
            precision: 'condition',
            anchoredAtWorldMinute: baseMinute,
        }, baseMinute);
    }

    if (expression.type === 'absolute-date') {
        const targetDate = expression.date;
        const delta = calendarBound && baseDate ? dateDifference(baseDate, targetDate) : null;
        return normalizeClueTiming({
            kind: 'absolute',
            sourceText: expression.sourceText,
            targetWorldMinute: delta !== null && delta >= 0
                ? targetMinuteForDay(baseMinute, delta, desiredMinute ?? 0)
                : null,
            targetDate,
            precision,
            daypart,
            anchoredAtWorldMinute: baseMinute,
        }, baseMinute);
    }

    let dayDelta = null;
    if (expression.type === 'relative-word') {
        const word = expression.match[1];
        if (['今天', '今晚', '今日', '今夜'].includes(word)) dayDelta = 0;
        else if (['明天', '明早', '明晨', '明晚', '明日', '翌日'].includes(word)) dayDelta = 1;
        else if (word === '后天') dayDelta = 2;
        else if (word === '大后天') dayDelta = 3;
    } else if (expression.type === 'relative-days') {
        dayDelta = chineseInteger(expression.match[1]);
    } else if (expression.type === 'weekday') {
        if (calendarBound && baseDate) {
            const mode = expression.match[1] === '下周'
                ? 'next-week'
                : expression.match[1] === '本周'
                    ? 'this-week'
                    : 'next-occurrence';
            dayDelta = weekdayDelta(baseDate, WEEKDAY_INDEX[expression.match[2]], mode);
        }
    }

    if (!Number.isFinite(dayDelta) || dayDelta < 0) {
        return normalizeClueTiming({
            kind: 'condition',
            sourceText: expression.sourceText,
            targetWorldMinute: null,
            precision: 'condition',
            anchoredAtWorldMinute: baseMinute,
        }, baseMinute);
    }

    const targetDate = calendarBound && baseDate ? addDateDays(baseDate, dayDelta) : null;
    return normalizeClueTiming({
        kind: 'relative',
        sourceText: expression.sourceText,
        // Date-only clues become eligible at the start of their target day.
        // Midnight is an internal threshold, not an asserted occurrence time; the
        // exposed precision remains "date". Preserving the creation clock here
        // would incorrectly delay a "明天" clue until that same hour tomorrow.
        targetWorldMinute: targetMinuteForDay(baseMinute, dayDelta, desiredMinute ?? 0),
        targetDate,
        precision,
        daypart,
        anchoredAtWorldMinute: baseMinute,
    }, baseMinute);
}

export function normalizeClueTiming(raw, currentWorldMinute = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const target = Number(raw.targetWorldMinute ?? raw.target_world_minute);
    const targetWorldMinute = Number.isFinite(target) && target >= 0 ? Math.trunc(target) : null;
    const date = normalizeDate(raw.targetDate ?? raw.target_date);
    const kind = ['absolute', 'relative', 'condition'].includes(raw.kind) ? raw.kind : 'condition';
    const precision = ['minute', 'daypart', 'date', 'condition'].includes(raw.precision)
        ? raw.precision
        : (targetWorldMinute === null ? 'condition' : 'date');
    const nowDay = dayIndex(currentWorldMinute);
    const targetDay = targetWorldMinute === null ? null : dayIndex(targetWorldMinute);
    const dayDelta = targetDay === null ? null : targetDay - nowDay;
    let relativeLabel = '';
    if (dayDelta !== null) {
        if (dayDelta < 0) relativeLabel = `已过期 ${Math.abs(dayDelta)} 天`;
        else if (dayDelta === 0) relativeLabel = '今天';
        else if (dayDelta === 1) relativeLabel = '明天';
        else if (dayDelta === 2) relativeLabel = '后天';
        else relativeLabel = `${dayDelta} 天后`;
    }
    return {
        kind,
        sourceText: String(raw.sourceText ?? raw.source_text ?? '').trim().slice(0, 120),
        targetWorldMinute,
        targetDate: date,
        precision,
        daypart: String(raw.daypart || '').trim().slice(0, 20),
        anchoredAtWorldMinute: Math.max(0, integer(raw.anchoredAtWorldMinute ?? raw.anchored_at_world_minute, currentWorldMinute)),
        relativeLabel,
    };
}

export function buildClockAuthorityLines(state, formattedClock, mode = 'full') {
    if (mode === 'off') return [];
    const clock = state?.clock || {};
    const absoluteMinute = Math.max(0, integer(clock.absoluteMinute, 0));
    const relativeDay = dayIndex(absoluteMinute);
    const precision = String(clock.precision || 'day');
    const daypart = String(clock.daypart || '').trim();
    const exactTime = `${pad(Math.floor(minuteOfDay(absoluteMinute) / 60))}:${pad(minuteOfDay(absoluteMinute) % 60)}`;

    if (clock.anchored) {
        const dateText = formattedClock?.date || `${formattedClock?.year || ''}年${formattedClock?.month || ''}月${formattedClock?.dayOfMonth || ''}日`;
        if (mode === 'anchor') {
            const label = precision === 'minute'
                ? `${dateText} ${formattedClock?.time || exactTime}`
                : precision === 'daypart' && daypart
                    ? `${dateText} · ${daypart}`
                    : dateText;
            return [
                `最小时间一致性锚点：${label}`,
                '只用于防止正文无因果倒退、跨日或跳回旧日期；不要求主动播报时间。',
            ];
        }
        if (precision === 'minute') {
            return [
                `权威主世界时间：${state?.world?.name || '主世界'} · ${formattedClock?.stamp || `${dateText} ${exactTime}`}`,
                `权威日期字段：year=${formattedClock?.year}; month=${formattedClock?.month}; day=${formattedClock?.dayOfMonth}; time=${formattedClock?.time || exactTime}`,
                '时间一致性规则：主世界时间由世界背面维护，是本轮正文的事实源。若正文显示日期或钟点，必须与这里一致；不得保留旧日期、无因果倒退或自行另起一天。',
                `若输出“时间与地点”栏，日期应写成：${formattedClock?.year}年${formattedClock?.month}月${formattedClock?.dayOfMonth}日。`,
                '正文只负责叙事；本轮实际经过多久会在正文结束后由世界背面结算，不要为了推进剧情自行篡改世界钟。',
            ];
        }
        if (precision === 'daypart' && daypart) {
            return [
                `权威主世界时间：${dateText} · ${daypart}（具体钟点未确定）`,
                '日期和时段是事实；正文不得把它写回旧日期、跳到别的日期，也不要擅自补造精确分钟。若本轮明确给出可靠钟点，世界背面会在正文后提升时间精度。',
            ];
        }
        return [
            `权威主世界日期：${dateText}（具体钟点未确定）`,
            '当前日期已经是世界事实。正文不得无因果跨日或回到旧日期，也不要为了格式完整自行编造精确钟点。',
        ];
    }

    const relativeLabel = precision === 'minute'
        ? `故事第 ${relativeDay} 日 ${exactTime}`
        : precision === 'daypart' && daypart
            ? `故事第 ${relativeDay} 日 · ${daypart}`
            : `故事第 ${relativeDay} 日`;
    if (mode === 'anchor') {
        return [
            `最小相对时间锚点：${relativeLabel}`,
            '具体年月日尚未绑定，但故事日序已经连续存在；不要无因果重置到第一天、倒退或跨日。',
        ];
    }
    return [
        `权威主世界相对时间：${relativeLabel}${precision === 'minute' ? '' : '（精度有限）'}`,
        '世界钟已经存在，只是尚未绑定具体历法日期。正文不明确时间时继续沿用这个世界时间，不得因为缺少年月日就重新猜“现在是哪一天”。',
        '若正文明确给出可靠年月日，世界背面会在正文结束后把现有故事日序映射到该历法；此前已经经过的时间不会被抹掉。',
        precision === 'daypart'
            ? '当前只知道时段，不要擅自补造精确钟点。'
            : precision === 'minute'
                ? '当前相对钟点已经明确；除非剧情真实经过时间，否则保持连续。'
                : '当前只确定故事日序；不要擅自补造精确钟点。',
    ];
}
