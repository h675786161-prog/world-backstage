export const TRADITIONAL_QUARTER_MINUTES = 15;

export const TRADITIONAL_SHICHEN = Object.freeze([
    { branch: '子', startMinute: 23 * 60 },
    { branch: '丑', startMinute: 1 * 60 },
    { branch: '寅', startMinute: 3 * 60 },
    { branch: '卯', startMinute: 5 * 60 },
    { branch: '辰', startMinute: 7 * 60 },
    { branch: '巳', startMinute: 9 * 60 },
    { branch: '午', startMinute: 11 * 60 },
    { branch: '未', startMinute: 13 * 60 },
    { branch: '申', startMinute: 15 * 60 },
    { branch: '酉', startMinute: 17 * 60 },
    { branch: '戌', startMinute: 19 * 60 },
    { branch: '亥', startMinute: 21 * 60 },
]);

const SHICHEN_BY_BRANCH = new Map(TRADITIONAL_SHICHEN.map(item => [item.branch, item]));
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const CHINESE_DIGITS = Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 });

function quarterNumber(value = '') {
    const source = String(value || '').trim();
    if (!source) return null;
    if (/^\d+$/.test(source)) return Number(source);
    if (Object.hasOwn(CHINESE_DIGITS, source)) return CHINESE_DIGITS[source];
    return null;
}

function normalizedMinute(total) {
    const value = Math.trunc(Number(total) || 0);
    return ((value % 1440) + 1440) % 1440;
}

function buildCandidate(match, branchIndex, phaseIndex, quarterIndex) {
    const branch = String(match[branchIndex] || '');
    const shichen = SHICHEN_BY_BRANCH.get(branch);
    if (!shichen) return null;
    const phase = String(match[phaseIndex] || '');
    const rawQuarter = String(match[quarterIndex] || '');
    const quarter = rawQuarter ? quarterNumber(rawQuarter) : null;
    const maxQuarter = phase ? 3 : 7;
    if (rawQuarter && (!Number.isFinite(quarter) || quarter < 0 || quarter > maxQuarter)) return null;

    let offset = phase === '正' ? 60 : 0;
    if (Number.isFinite(quarter)) offset += quarter * TRADITIONAL_QUARTER_MINUTES;
    const precise = Boolean(phase || rawQuarter);
    const absoluteFromCivilStart = shichen.startMinute + offset;
    const minuteOfDay = normalizedMinute(absoluteFromCivilStart);
    return {
        branch,
        periodLabel: `${branch}时`,
        label: String(match[0] || '').trim(),
        sourceText: String(match[0] || '').trim(),
        index: Number(match.index || 0),
        minuteOfDay,
        hour: Math.floor(minuteOfDay / 60),
        minute: minuteOfDay % 60,
        phase,
        quarter: Number.isFinite(quarter) ? quarter : null,
        precise,
        precision: precise ? 'minute' : 'daypart',
        crossesMidnight: branch === '子' && absoluteFromCivilStart >= 1440,
    };
}

/**
 * Parse the latest traditional Chinese two-hour time expression.
 * Compatibility convention: one 刻 = 15 modern minutes. “初” is the start of
 * a shichen; “正” is its midpoint. A bare “卯时” remains daypart precision.
 */
export function parseTraditionalClock(text = '') {
    const source = String(text || '');
    const candidates = [];
    const patterns = [
        {
            regex: new RegExp(`([${BRANCHES}])时\\s*(?:(初|正)\\s*)?(?:(\\d+|[零〇一二两三四五六七八九])\\s*刻)?`, 'gu'),
            branch: 1,
            phase: 2,
            quarter: 3,
        },
        {
            regex: new RegExp(`([${BRANCHES}])(初|正)\\s*(?:(\\d+|[零〇一二两三四五六七八九])\\s*刻)?`, 'gu'),
            branch: 1,
            phase: 2,
            quarter: 3,
        },
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern.regex)) {
            const candidate = buildCandidate(match, pattern.branch, pattern.phase, pattern.quarter);
            if (candidate) candidates.push(candidate);
        }
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => left.index - right.index || left.sourceText.length - right.sourceText.length);
    return candidates.at(-1);
}

function shichenForMinute(value) {
    const minute = normalizedMinute(value);
    if (minute >= 23 * 60 || minute < 60) return SHICHEN_BY_BRANCH.get('子');
    return TRADITIONAL_SHICHEN.find(item => minute >= item.startMinute && minute < item.startMinute + 120) || null;
}

/** Display-only alternate representation. It never changes the authoritative clock. */
export function formatTraditionalTime(totalMinutes = 0) {
    const minuteOfDay = normalizedMinute(totalMinutes);
    const shichen = shichenForMinute(minuteOfDay);
    if (!shichen) return '';

    let elapsed = minuteOfDay - shichen.startMinute;
    if (shichen.branch === '子' && minuteOfDay < 60) elapsed = minuteOfDay + 60;
    if (elapsed < 0) elapsed += 1440;
    elapsed = Math.max(0, Math.min(119, elapsed));

    if (elapsed === 0) return `${shichen.branch}初`;
    if (elapsed === 60) return `${shichen.branch}正`;

    const secondHalf = elapsed > 60;
    const local = secondHalf ? elapsed - 60 : elapsed;
    const quarters = Math.floor(local / TRADITIONAL_QUARTER_MINUTES);
    const remainder = local % TRADITIONAL_QUARTER_MINUTES;
    const chineseQuarter = ['', '一', '二', '三'][quarters] || String(quarters);
    let label = secondHalf
        ? `${shichen.branch}正${quarters ? `${chineseQuarter}刻` : ''}`
        : `${shichen.branch}时${quarters ? `${chineseQuarter}刻` : ''}`;
    if (remainder) label += `余${remainder}分`;
    return label;
}