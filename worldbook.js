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

export function filterWorldbookEntries(entries, {
    query = '',
    onlyPeople = false,
    onlyEnabled = false,
} = {}) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return (Array.isArray(entries) ? entries : []).filter(entry => {
        if (onlyPeople && !entry?.likelyPerson) return false;
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
