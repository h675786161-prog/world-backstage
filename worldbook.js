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
    const readable = readableText(content);
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

    // 很多世界书会直接用人物姓名作为条目名，正文则是自然语言描述，
    // 并不会写成“姓名：/性格：”字段表。旧判断几乎只认字段表，因而会漏掉这类常见人物卡。
    const standaloneName = cleanCandidateName(profile.name || entry?.name || '');
    const looksLikeSettingTitle = /(?:世界观|世界设定|规则|系统|教程|说明|模板|格式|地点|地区|区域|城市|国家|组织|势力|地图|商店|物品|道具|技能|魔法|时间线|词典|百科|剧情|章节|变量|状态栏)/iu.test(title);
    const looksLikeStandaloneName = Boolean(
        standaloneName
        && standaloneName.length <= 40
        && !looksLikeSettingTitle
    );
    const personalCues = readable.match(/(?:她|他|少女|少年|女性|男性|女孩|男孩|性格|口癖|说话|喜欢|讨厌|擅长|害怕|穿着|发色|瞳色|身高|年龄|\d{1,3}\s*岁|职业|身份|出身|过去|经历|关系)/giu) || [];
    const nameMentions = standaloneName
        ? (readable.match(new RegExp(escapeRegExp(standaloneName), 'giu')) || []).length
        : 0;
    if (looksLikeStandaloneName && personalCues.length >= 2) {
        score += 4;
        signals.push('姓名条目含人物描述');
    }
    if (looksLikeStandaloneName && nameMentions > 0 && personalCues.length > 0) {
        score += 2;
        signals.push('正文围绕该人物');
    }

    return {
        likelyPerson: score >= 5,
        characterScore: score,
        characterSignals: signals.slice(0, 4),
    };
}

export function isWorldbookEntryManuallySelectable(entry) {
    return Boolean(
        entry
        && String(entry.content || '').trim()
        && !entry.mixedSource
    );
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
