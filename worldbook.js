const WB_PROFILE_MATCH_TIEBREAK = 17;

const PROFILE_LABELS = Object.freeze({
    name: ['中文名', '姓名', '名字', '角色名', 'chinese name', 'full name', 'name'],
    nickname: ['昵称', '别名', '别称', '称呼', 'nickname', 'alias', 'aliases'],
    gender: ['性别', 'gender', 'sex'],
    age: ['年龄', 'age'],
    birthday: ['生日', 'birthday', 'birth date'],
    species: ['种族', '物种', 'race', 'species'],
    identity: ['身份', '职业', '职务', '职位', 'occupation', 'profession', 'identity', 'role'],
    personality: ['性格', '人格', '个性', '性情', 'personality', 'temperament', 'character'],
    values: ['价值观', '原则', '习惯', '喜好', '偏好', 'values', 'habit', 'habits', 'likes', 'preferences'],
    mbti: ['mbti'],
    appearance: ['外貌', '外观', '长相', '体貌', 'appearance', 'looks'],
    height: ['身高', 'height'],
    body: ['体型', '身材', '身体特征', 'body', 'build'],
    clothing: ['穿着', '服装', '衣着', 'clothing', 'outfit'],
    background: ['背景', '经历', '履历', '过去', '生平', 'background story', 'background', 'history', 'backstory'],
    relations: ['关系', '人际关系', '家庭', '家人', '亲属', 'relationships', 'relations', 'family'],
    speech: ['说话方式', '说话习惯', '语言风格', '口癖', '语气', 'speech style', 'speaking style', 'speech', 'voice'],
    behavior: ['行为习惯', '行为边界', '底线', '禁忌', '雷区', 'behavior boundaries', 'behavior', 'boundaries', 'taboo'],
});

const PROFILE_LOOKUP = new Map(
    Object.entries(PROFILE_LABELS)
        .flatMap(([field, labels]) => labels.map(label => [label.toLocaleLowerCase(), field])),
);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROFILE_MARKER = new RegExp(
    `(${[...PROFILE_LOOKUP.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join('|')})\\s*(?:[（(][^）)\\n]{0,40}[）)])?\\s*[:：]`,
    'giu',
);

function compactValue(value, maximum = 900) {
    return String(value || '')
        .replace(/^[\s\-–—•·|]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

function readableText(value) {
    return String(value || '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(?:p|div|li|section|character|info|profile)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

function joinFields(parts, maximum) {
    return parts
        .map(part => compactValue(part, maximum))
        .filter(Boolean)
        .join('；')
        .slice(0, maximum);
}

export function extractWorldbookCharacterProfile(content, fallbackName = '') {
    const raw = String(content || '').trim().slice(0, 4000);
    const readable = readableText(raw);
    const matches = [...readable.matchAll(PROFILE_MARKER)];
    const values = {};

    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        const label = String(match[1] || '').toLocaleLowerCase();
        const field = PROFILE_LOOKUP.get(label);
        if (!field) continue;
        const start = Number(match.index || 0) + match[0].length;
        const end = index + 1 < matches.length
            ? Number(matches[index + 1].index || readable.length)
            : readable.length;
        const value = compactValue(readable.slice(start, end), field === 'background' ? 1400 : 900);
        if (!value) continue;
        values[field] = values[field] ? `${values[field]}；${value}` : value;
    }

    const explicitName = compactValue(values.name, 80)
        .replace(/^[-—–·•]+/, '')
        .slice(0, 80);
    const name = explicitName || String(fallbackName || '').trim().slice(0, 80);
    const identityAnchor = joinFields([
        values.nickname ? `昵称/别称：${values.nickname}` : '',
        values.gender ? `性别：${values.gender}` : '',
        values.age ? `年龄：${values.age}` : '',
        values.birthday ? `生日：${values.birthday}` : '',
        values.species ? `种族/物种：${values.species}` : '',
        values.identity ? `身份/职业：${values.identity}` : '',
    ], 500);
    const personalityAnchor = joinFields([
        values.personality,
        values.values ? `价值观/习惯：${values.values}` : '',
        values.mbti ? `MBTI：${values.mbti}` : '',
    ], 600);
    const appearanceProfile = joinFields([
        values.height ? `身高：${values.height}` : '',
        values.body ? `体型/身体特征：${values.body}` : '',
        values.appearance,
        values.clothing ? `穿着：${values.clothing}` : '',
    ], 700);
    const backgroundProfile = joinFields([
        values.background,
        values.relations ? `关系/家庭：${values.relations}` : '',
    ], 900);

    return {
        name,
        explicitName: Boolean(explicitName),
        identityAnchor,
        personalityAnchor,
        appearanceProfile,
        backgroundProfile,
        speakingStyle: compactValue(values.speech, 360),
        behaviorBoundaries: compactValue(values.behavior, 500),
        worldbookRaw: raw,
        matchedFields: Object.keys(values),
    };
}

export function detectWorldbookCharacter(entry, profile = extractWorldbookCharacterProfile(entry?.content, entry?.name)) {
    const title = `${entry?.name || ''} ${(entry?.keys || []).join(' ')}`.toLocaleLowerCase();
    const content = String(entry?.content || '');
    let score = 0;
    const signals = [];

    if (/<\s*character\b/i.test(content) || /<\s*(?:char|npc|person)\b/i.test(content)) {
        score += 3;
        signals.push('角色结构标签');
    }
    if (profile.explicitName) {
        score += 3;
        signals.push('明确姓名');
    }
    const strongFields = ['personality', 'appearance', 'background', 'speech', 'gender', 'age', 'identity'];
    const matchedStrong = strongFields.filter(field => profile.matchedFields.includes(field));
    score += Math.min(5, matchedStrong.length);
    if (matchedStrong.length >= 2) signals.push(`人物字段 ${matchedStrong.length} 项`);
    if (/(?:角色|人物|npc|character|char(?:acter)?\s*card)/iu.test(title)) {
        score += 2;
        signals.push('条目名/关键词像人物');
    }
    if (/(?:世界观|世界设定|规则|系统|教程|说明|模板|格式|地点|城市|国家|势力总览|时间线|词典|百科|剧情梗概)/iu.test(title)) {
        score -= 4;
        signals.push('条目名更像设定');
    }
    if (profile.matchedFields.length >= 4) score += 2;

    return {
        likelyPerson: score >= 5,
        characterScore: score,
        characterSignals: signals.slice(0, 4),
    };
}


const TECHNICAL_TITLE_PATTERN = /(?:mvu|变量(?:表|初始化|定义|更新)?|状态栏|状态变量|正则|regex|json\s*patch|jsonpatch|脚本|宏|指令模板|系统提示|system\s*prompt|前端(?:美化|配置)?|样式表|css|javascript)/iu;
const TECHNICAL_CONTENT_PATTERNS = [
    /<\s*(?:updatevariable|variable|variables|jsonpatch|regex|script|style)\b/iu,
    /"(?:op|path|value)"\s*:\s*"(?:replace|add|remove|\/)/iu,
    /\bjson\s*patch\b|\bjsonpatch\b/iu,
    /(?:变量更新|变量初始化|更新变量|状态变量|mvu\s*变量)/iu,
    /(?:<%|%>|\{\{[^{}]{0,120}\}\}|\$\{[^{}]{0,120}\})/u,
];

export function detectWorldbookTechnicalEntry(entry) {
    const title = `${entry?.name || ''} ${(entry?.keys || []).join(' ')} ${(entry?.tags || []).join(' ')}`.trim();
    const content = String(entry?.content || '');
    let score = 0;
    const signals = [];

    if (TECHNICAL_TITLE_PATTERN.test(title)) {
        score += 4;
        signals.push('条目名像技术/MVU配置');
    }
    for (const pattern of TECHNICAL_CONTENT_PATTERNS) {
        if (!pattern.test(content)) continue;
        score += 2;
        if (signals.length < 4) signals.push('正文含变量/脚本结构');
    }

    const codeLikeLines = content.split(/\n/).filter(line => (
        /(?:^\s*[{[]|^\s*[-+]\s*\/|"(?:op|path|value)"\s*:|^\s*(?:const|let|var|function)\b)/u.test(line)
    )).length;
    if (codeLikeLines >= 4) {
        score += 2;
        signals.push('技术结构占比较高');
    }

    return {
        technicalEntry: score >= 4,
        technicalScore: score,
        technicalSignals: signals.slice(0, 4),
    };
}

function cleanCandidateName(value) {
    return compactValue(value, 80)
        .replace(/^(?:角色|人物|npc)\s*[:：\-—]?\s*/iu, '')
        .replace(/[【】[\]<>]/g, '')
        .replace(/[：:，,。；;].*$/u, '')
        .trim()
        .slice(0, 80);
}

function candidateProfileFromBlock(block, fallbackName, parentName = '') {
    const profile = extractWorldbookCharacterProfile(block, fallbackName);
    const name = cleanCandidateName(profile.name || fallbackName);
    if (!name) return null;

    const context = String(parentName || '').trim();
    const sameAsParent = context && context.toLocaleLowerCase() === name.toLocaleLowerCase();
    if (context && !sameAsParent && !/(?:角色|人物|npc|character)/iu.test(context)) {
        const contextNote = `所属条目/势力：${context}`;
        profile.backgroundProfile = [
            profile.backgroundProfile,
            contextNote,
        ].filter(Boolean).join('；').slice(0, 900);
    }

    return {
        name,
        profile: {
            ...profile,
            name,
        },
        content: String(block || '').trim().slice(0, 4000),
    };
}

function splitByExplicitNameLabels(content, parentName = '') {
    const readable = readableText(content);
    const pattern = /(?:^|\n)\s*(?:[-*•#>]+\s*)?(?:中文名|姓名|角色名|人物名|name)\s*(?:[（(][^）)\n]{0,40}[）)])?\s*[:：]\s*([^\n|]{1,80})/giu;
    const matches = [...readable.matchAll(pattern)];
    if (matches.length < 2) return [];

    return matches.map((match, index) => {
        const start = Number(match.index || 0);
        const end = index + 1 < matches.length
            ? Number(matches[index + 1].index || readable.length)
            : readable.length;
        const block = readable.slice(start, end).trim();
        return candidateProfileFromBlock(block, match[1], parentName);
    }).filter(Boolean);
}

function splitXmlCharacterBlocks(content, parentName = '') {
    const raw = String(content || '');
    const results = [];
    const pattern = /<\s*(character|char|npc|person)\b([^>]*)>([\s\S]*?)<\s*\/\s*\1\s*>/giu;
    for (const match of raw.matchAll(pattern)) {
        const attrs = String(match[2] || '');
        const body = String(match[3] || '');
        const named = attrs.match(/\b(?:name|id)\s*=\s*["']([^"']{1,80})["']/iu)?.[1] || '';
        const candidate = candidateProfileFromBlock(body, named, parentName);
        if (candidate) results.push(candidate);
    }
    return results;
}

function splitRoleHeadings(content, parentName = '') {
    const raw = String(content || '').replace(/\r/g, '');
    const lines = raw.split('\n');
    const starts = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        let match = line.match(/^#{1,6}\s*(?:角色|人物|npc)\s*[:：\-—]?\s*([^#\n]{1,60})$/iu);
        if (!match) {
            match = line.match(/^(?:[-*•]\s*)?(?:角色|人物|npc)\s*[:：]\s*([^，,。；;\n]{1,60})$/iu);
        }
        if (!match) continue;
        const name = cleanCandidateName(match[1]);
        if (name) starts.push({ index, name });
    }

    if (!starts.length) return [];
    return starts.map((item, position) => {
        const end = position + 1 < starts.length ? starts[position + 1].index : lines.length;
        const block = lines.slice(item.index, end).join('\n').trim();
        return candidateProfileFromBlock(block, item.name, parentName);
    }).filter(Boolean);
}

function candidateStrength(candidate) {
    const profile = candidate?.profile || {};
    const strongFields = new Set([
        'personality', 'appearance', 'background', 'speech',
        'gender', 'age', 'identity', 'relations', 'behavior',
    ]);
    const strongCount = (profile.matchedFields || []).filter(field => strongFields.has(field)).length;
    let score = 0;
    if (profile.explicitName) score += 3;
    score += Math.min(5, strongCount);
    if (strongCount >= 2) score += 2;
    if (/<\s*(?:character|char|npc|person)\b/iu.test(candidate?.content || '')) score += 2;
    if (/(?:性格|外貌|身份|职业|年龄|性别|背景|经历|关系|说话|行为|personality|appearance|identity|age|gender|background)/iu.test(candidate?.content || '')) {
        score += 1;
    }
    return score;
}

export function extractWorldbookCharacterCandidates(entry) {
    const content = String(entry?.content || '').trim();
    const parentName = String(entry?.name || '').trim();
    if (!content) return [];

    const candidates = [
        ...splitXmlCharacterBlocks(content, parentName),
        ...splitByExplicitNameLabels(content, parentName),
        ...splitRoleHeadings(content, parentName),
    ];

    const seen = new Set();
    const unique = [];
    for (const candidate of candidates) {
        const key = candidate.name.toLocaleLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const technical = detectWorldbookTechnicalEntry({
            name: candidate.name,
            content: candidate.content,
            keys: [],
            tags: [],
        });
        const strength = candidateStrength(candidate);
        unique.push({
            ...candidate,
            confidence: strength >= 6 ? 'high' : strength >= 4 ? 'medium' : 'low',
            characterScore: strength,
            technicalEntry: technical.technicalEntry,
            technicalSignals: technical.technicalSignals,
        });
    }
    return unique;
}

export function planSmartWorldbookImport(entries) {
    const auto = [];
    const review = [];
    const skippedTechnical = [];
    const skippedDisabled = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (entry?.disabled) {
            skippedDisabled.push(entry);
            continue;
        }
        if (entry?.technicalEntry && !entry?.embeddedPerson) {
            skippedTechnical.push(entry);
            continue;
        }
        if (!entry?.importablePerson) continue;

        if (entry?.smartAuto) auto.push(entry);
        else review.push(entry);
    }

    return {
        auto,
        review,
        skippedTechnical,
        skippedDisabled,
    };
}

export function filterWorldbookEntries(entries, {
    query = '',
    onlyPeople = false,
    onlyEnabled = false,
} = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return (Array.isArray(entries) ? entries : []).filter(entry => {
        if (onlyPeople && !(entry?.importablePerson ?? entry?.likelyPerson)) return false;
        if (onlyEnabled && entry?.disabled) return false;
        if (!needle) return true;
        const haystack = [
            entry?.name,
            entry?.parsedName,
            ...(Array.isArray(entry?.keys) ? entry.keys : []),
            ...(Array.isArray(entry?.tags) ? entry.tags : []),
            ...(Array.isArray(entry?.formatHints) ? entry.formatHints : []),
            entry?.content,
        ].map(value => String(value || '').toLocaleLowerCase()).join('\n');
        return haystack.includes(needle);
    });
}

// ---------------------------------------------------------------------------
// AI 整理导入
//
// 模型在这里只做“搬运工”：把原文已有的文字归到对应栏位，可以删减重排，不许
// 改写、概括或补写。提示词拦不住的部分由下面的原文回查兜底——每个片段都要在
// 来源条目里查得到，查不到的直接丢，勉强查得到的记进报告让作者自己复核。
// ---------------------------------------------------------------------------

const IMPORT_GRAM_SIZE = 3;
export const IMPORT_PASS_COVERAGE = 0.85;
export const IMPORT_REVIEW_COVERAGE = 0.6;
const IMPORT_LENGTH_FUSE = 1.1;

// 长度上限对齐 core.js 的 LIMITS，避免整理出来的值在 normalizePerson 里被截断。
export const IMPORT_FIELDS = Object.freeze([
    { key: 'identityAnchor', jsonKey: 'identity_anchor', label: '身份锚点', limit: 500 },
    { key: 'appearanceProfile', jsonKey: 'appearance_profile', label: '外貌设定', limit: 700 },
    { key: 'personalityAnchor', jsonKey: 'personality_anchor', label: '人格锚点', limit: 600 },
    { key: 'backgroundProfile', jsonKey: 'background_profile', label: '背景与关系', limit: 900 },
    { key: 'speakingStyle', jsonKey: 'speaking_style', label: '说话习惯', limit: 360 },
    { key: 'behaviorBoundaries', jsonKey: 'behavior_boundaries', label: '行为边界', limit: 500 },
]);

const IMPORT_FILLER_VALUE = /^(?:无|暂无|没有|未提及|未提供|未说明|不详|未知|待补充|待确认|n\/?a|none|null|-{1,3}|—+)$/i;
const IMPORT_MACRO_NAME = /\{\{\s*(?:user|char|persona)\s*\}\}/i;
const IMPORT_USER_ALIAS = /^(?:你|我|用户|玩家|主角|user|player|persona)$/i;

function normalizeForGrounding(value) {
    return String(value || '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
}

function groundingIndex(source) {
    return { text: normalizeForGrounding(source) };
}

function coverageAgainstIndex(candidate, index) {
    const needle = normalizeForGrounding(candidate);
    // 空值不算越界：本来就允许留空。
    if (!needle) return 1;
    const haystack = index?.text || '';
    if (!haystack) return 0;
    if (needle.length <= IMPORT_GRAM_SIZE) return haystack.includes(needle) ? 1 : 0;

    let hits = 0;
    let total = 0;
    for (let start = 0; start + IMPORT_GRAM_SIZE <= needle.length; start += 1) {
        total += 1;
        if (haystack.includes(needle.slice(start, start + IMPORT_GRAM_SIZE))) hits += 1;
    }
    return total ? hits / total : 1;
}

export function groundingCoverage(candidate, source) {
    return coverageAgainstIndex(candidate, groundingIndex(source));
}

function splitImportSegments(value) {
    const parts = String(value || '').split(/([；;。\n]+)/);
    const segments = [];
    for (let index = 0; index < parts.length; index += 2) {
        const text = String(parts[index] || '').trim();
        if (!text) continue;
        const rawDelimiter = String(parts[index + 1] || '');
        segments.push({ text, delimiter: rawDelimiter.includes('。') ? '。' : '；' });
    }
    return segments;
}

function verifyImportedValue(rawValue, index, limit) {
    const kept = [];
    const dropped = [];
    let worst = 1;

    for (const segment of splitImportSegments(rawValue)) {
        const text = compactValue(segment.text, limit);
        if (!text || IMPORT_FILLER_VALUE.test(text)) continue;
        // 允许模型补上栏位前缀（height: 170cm → 身高：170cm），回查时先剥掉。
        const body = text.replace(/^[^：:]{0,8}[：:]\s*/, '') || text;
        const coverage = coverageAgainstIndex(body, index);
        if (coverage < IMPORT_REVIEW_COVERAGE) {
            dropped.push({ text, coverage });
            continue;
        }
        worst = Math.min(worst, coverage);
        kept.push({ text, delimiter: segment.delimiter, coverage });
    }

    let joined = '';
    for (let index_ = 0; index_ < kept.length; index_ += 1) {
        if (index_ > 0) joined += kept[index_ - 1].delimiter;
        joined += kept[index_].text;
    }
    const text = joined.slice(0, limit);
    return {
        text,
        coverage: kept.length ? worst : 1,
        verdict: !text ? 'empty' : worst >= IMPORT_PASS_COVERAGE ? 'pass' : 'review',
        dropped,
    };
}

function entrySourceText(entry) {
    return `${entry?.name || ''}\n${entry?.parsedName || ''}\n${entry?.content || ''}`;
}

function looksLikeUserName(name, userName = '') {
    const raw = String(name || '').trim();
    if (IMPORT_MACRO_NAME.test(raw)) return true;
    if (IMPORT_USER_ALIAS.test(raw)) return true;
    const normalized = normalizeForGrounding(raw);
    const owner = normalizeForGrounding(userName);
    return Boolean(normalized && owner && normalized === owner);
}

function nameIsGrounded(name, index, sources) {
    const normalized = normalizeForGrounding(name);
    if (!normalized) return false;
    if (index.text.includes(normalized)) return true;
    return sources.some(entry => normalizeForGrounding(entry?.name) === normalized
        || normalizeForGrounding(entry?.parsedName) === normalized);
}

export function planWorldbookImportBatches(entries, {
    maxEntriesPerBatch = 3,
    maxCharsPerBatch = 6000,
} = {}) {
    const batches = [];
    let current = [];
    let currentChars = 0;
    for (const entry of (Array.isArray(entries) ? entries : []).filter(Boolean)) {
        const chars = String(entry.content || '').length;
        const full = current.length >= maxEntriesPerBatch
            || (current.length > 0 && currentChars + chars > maxCharsPerBatch);
        if (full) {
            batches.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(entry);
        currentChars += chars;
    }
    if (current.length) batches.push(current);
    return batches;
}

export function buildWorldbookImportPrompt(entries, { userName = '' } = {}) {
    const batch = (Array.isArray(entries) ? entries : []).filter(Boolean);
    if (!batch.length) throw new Error('没有可整理的世界书条目');
    const payload = batch.map(entry => ({
        uid: String(entry.uid ?? ''),
        entry_name: String(entry.name || '').slice(0, 80),
        content: String(entry.content || '').slice(0, 4000),
    }));
    const schema = {
        people: [Object.fromEntries([
            ['name', ''],
            ['source_uids', []],
            ...IMPORT_FIELDS.map(field => [field.jsonKey, '']),
        ])],
    };

    return [
        '你是“世界背面”的档案归档员，不是作者。这里只做栏位归类，不做任何创作。',
        '下面是若干条世界书条目。请把其中的人物设定，按栏位归到对应位置。',
        '',
        '铁律：',
        '1. 只能搬运原文已有的文字。可以删减、可以去掉键名与标签、可以调整顺序，但禁止改写措辞、禁止润色、禁止概括成新句子。',
        '2. 禁止推断与延伸。原文没写的性格、动机、关系、年龄、外貌，一律留空，不要由已有信息推出来。',
        '3. 无处可归的内容（世界观、规则、系统设定、剧情梗概、其他角色的事）直接丢弃，不要硬塞进背景栏。',
        '4. 宁可留空也不要凑满。空栏位是正常结果，所有栏位都可以是空字符串。',
        '5. 一条条目里写了几个人物，就拆成几个人物；同一个人物散落在多条条目里，合并成一个。',
        `6. 不要输出玩家角色${userName ? `（${userName}）` : ''}、{{user}}、{{char}}。`,
        '7. name 必须是原文里出现过的人物名，不要自己起名或翻译。',
        '8. 只填下列栏位。当前位置、当前行动、短期意图、长期目标由世界推演产生，这里绝对不要填。',
        '9. 只返回合法 JSON，不要代码围栏和解释。',
        '',
        '栏位含义：',
        ...IMPORT_FIELDS.map(field => `· ${field.jsonKey}（${field.label}，不超过 ${field.limit} 字）`),
        '· identity_anchor：性别、称谓、物种、年龄阶段、社会身份、职业。外貌不要写在这里。',
        '· appearance_profile：身高、体型、样貌、穿着。',
        '· personality_anchor：性格、价值观、习惯、好恶。',
        '· background_profile：经历、过去、家庭、人际关系、关键事件。',
        '· speaking_style：口癖、语气、句式习惯。',
        '· behavior_boundaries：底线、禁忌、绝对不会做的事。',
        '',
        'source_uids 填这个人物取材自哪几条条目的 uid。',
        '',
        '世界书条目：',
        JSON.stringify(payload),
        '',
        '返回结构：',
        JSON.stringify(schema),
    ].join('\n');
}

export function normalizeImportedPeople(payload, entries = [], { userName = '' } = {}) {
    const list = Array.isArray(payload?.people)
        ? payload.people
        : Array.isArray(payload)
            ? payload
            : [];
    const batch = (Array.isArray(entries) ? entries : []).filter(Boolean);
    const byUid = new Map(batch.map(entry => [String(entry.uid ?? ''), entry]));
    const batchIndex = groundingIndex(batch.map(entrySourceText).join('\n'));
    const people = [];
    const skipped = [];

    for (const raw of list) {
        // uid 先解析出来：被跳过的人物也要能回指到是哪条条目，否则那条条目会
        // 在报告里彻底消失。
        const requestedUids = [...new Set((Array.isArray(raw?.source_uids)
            ? raw.source_uids
            : Array.isArray(raw?.sourceUids)
                ? raw.sourceUids
                : [raw?.source_uids ?? raw?.sourceUids])
            .map(uid => String(uid ?? '').trim())
            .filter(uid => byUid.has(uid)))];
        const sources = requestedUids.length ? requestedUids.map(uid => byUid.get(uid)) : batch;
        const index = requestedUids.length
            ? groundingIndex(sources.map(entrySourceText).join('\n'))
            : batchIndex;
        const sourceUids = requestedUids.length
            ? requestedUids
            : batch.map(entry => String(entry.uid ?? ''));

        const name = compactValue(raw?.name, 80).replace(/^[-—–·•]+/, '').trim();
        if (!name) {
            skipped.push({ name: '', sourceUids, reason: '模型没有给出人物名' });
            continue;
        }
        if (looksLikeUserName(name, userName)) {
            skipped.push({ name, sourceUids, reason: '看起来是玩家角色，按规则不建立后台 NPC' });
            continue;
        }

        if (!nameIsGrounded(name, index, sources)) {
            skipped.push({ name, sourceUids, reason: '这个人物名在原文里找不到，已拦下' });
            continue;
        }

        const values = {};
        const review = [];
        const dropped = [];
        let totalChars = 0;
        for (const field of IMPORT_FIELDS) {
            const result = verifyImportedValue(raw?.[field.jsonKey] ?? raw?.[field.key], index, field.limit);
            for (const item of result.dropped) {
                dropped.push({ field: field.key, label: field.label, ...item });
            }
            if (!result.text) continue;
            values[field.key] = result.text;
            totalChars += normalizeForGrounding(result.text).length;
            if (result.verdict === 'review') {
                review.push({ field: field.key, label: field.label, coverage: result.coverage });
            }
        }

        if (!Object.keys(values).length) {
            skipped.push({ name, sourceUids, reason: '没有一条内容通过原文回查' });
            continue;
        }

        // 搬运不可能变长。总字数超过来源就说明模型在扩写，整个人物都要复核。
        const lengthFuse = index.text.length > 0 && totalChars > index.text.length * IMPORT_LENGTH_FUSE;
        if (lengthFuse) {
            for (const field of IMPORT_FIELDS) {
                if (!values[field.key]) continue;
                if (review.some(item => item.field === field.key)) continue;
                review.push({ field: field.key, label: field.label, coverage: 0 });
            }
        }

        people.push({
            name,
            sourceUids,
            values,
            review,
            dropped,
            lengthFuse,
        });
    }

    return { people, skipped };
}

// 勾了却没产出人物的条目必须能说出原因。模型静悄悄地不返回某条条目，是这套
// 流程里最容易被忽略的失败方式。
export function summarizeUntouchedEntries(entries, {
    people = [],
    skipped = [],
    failedUids = [],
} = {}) {
    const touched = new Set();
    for (const person of people) {
        for (const uid of person?.sourceUids || []) touched.add(String(uid));
    }
    const failed = new Set(failedUids.map(String));
    const reasonsByUid = new Map();
    for (const item of skipped) {
        for (const uid of item?.sourceUids || []) {
            const key = String(uid);
            if (!reasonsByUid.has(key)) reasonsByUid.set(key, []);
            reasonsByUid.get(key).push(item);
        }
    }

    return (Array.isArray(entries) ? entries : [])
        .filter(Boolean)
        .filter(entry => !touched.has(String(entry.uid ?? '')))
        .map(entry => {
            const uid = String(entry.uid ?? '');
            const name = String(entry.name || `条目 ${uid}`);
            if (failed.has(uid)) return { uid, name, reason: '所在批次没跑成功' };
            const reasons = reasonsByUid.get(uid) || [];
            if (reasons.length) {
                return {
                    uid,
                    name,
                    reason: reasons
                        .map(item => `${item.name || '无名人物'} — ${item.reason}`)
                        .join('；'),
                };
            }
            return {
                uid,
                name,
                reason: '模型没有从这条条目里整理出人物：可能被判成非人物设定，也可能是按规则跳过的玩家角色',
            };
        });
}

// 把整理好的人物草稿换算成写入参数。一条条目拆出多个人物时，这里决定他们各自
// 的身份标识——弄错了他们会共用一条记录、互相覆盖，最后只剩一个人。
export function planImportWrites(drafts, entries = [], { bookName = '' } = {}) {
    const byUid = new Map((Array.isArray(entries) ? entries : [])
        .filter(Boolean)
        .map(entry => [String(entry.uid ?? ''), entry]));
    const list = (Array.isArray(drafts) ? drafts : []).filter(Boolean);

    const peoplePerUid = new Map();
    for (const draft of list) {
        for (const uid of draft.sourceUids || []) {
            const key = String(uid);
            peoplePerUid.set(key, (peoplePerUid.get(key) || 0) + 1);
        }
    }

    return list.map(draft => {
        const uids = (draft.sourceUids || []).map(String);
        const sources = uids.map(uid => byUid.get(uid)).filter(Boolean);
        return {
            ...draft,
            // reference 必须带上人物名：只用条目 uid 的话，同一条目里的每个人
            // 都会算出同一个 id。
            reference: `${bookName}::${uids.join('+')}::${draft.name}`,
            // 条目名只在这条条目只产出一个人物时才能当别名，否则同一条目里的
            // 所有人都会去认领同一条旧记录。
            aliases: sources
                .filter(entry => peoplePerUid.get(String(entry.uid ?? '')) === 1)
                .map(entry => String(entry.name || ''))
                .filter(Boolean),
            sourceContent: sources.map(entry => String(entry.content || '')).join('\n\n'),
        };
    });
}

export function mergeImportedDrafts(drafts) {
    const merged = new Map();
    for (const draft of (Array.isArray(drafts) ? drafts : []).filter(Boolean)) {
        const key = normalizeForGrounding(draft.name);
        if (!key) continue;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, {
                name: draft.name,
                sourceUids: [...new Set(draft.sourceUids || [])],
                values: { ...draft.values },
                review: [...(draft.review || [])],
                dropped: [...(draft.dropped || [])],
                lengthFuse: Boolean(draft.lengthFuse),
            });
            continue;
        }
        existing.sourceUids = [...new Set([...existing.sourceUids, ...(draft.sourceUids || [])])];
        existing.review.push(...(draft.review || []));
        existing.dropped.push(...(draft.dropped || []));
        existing.lengthFuse = existing.lengthFuse || Boolean(draft.lengthFuse);
        for (const field of IMPORT_FIELDS) {
            const incoming = draft.values?.[field.key];
            if (!incoming) continue;
            const current = existing.values[field.key] || '';
            if (!current) {
                existing.values[field.key] = incoming.slice(0, field.limit);
                continue;
            }
            const seen = new Set(splitImportSegments(current).map(segment => normalizeForGrounding(segment.text)));
            const additions = splitImportSegments(incoming)
                .filter(segment => !seen.has(normalizeForGrounding(segment.text)))
                .map(segment => segment.text);
            if (!additions.length) continue;
            existing.values[field.key] = `${current}；${additions.join('；')}`.slice(0, field.limit);
        }
    }
    return [...merged.values()];
}
