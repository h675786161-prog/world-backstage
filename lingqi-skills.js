const SKILLS = [
    { id: 'list_skills', name: '技能清单', kind: 'query', category: '管家', risk: 'low' },
    { id: 'status_overview', name: '世界状态总览', kind: 'query', category: '查询', risk: 'low' },
    { id: 'list_people', name: '人物清单', kind: 'query', category: '查询', risk: 'low' },
    { id: 'person_status', name: '人物状态查询', kind: 'query', category: '查询', risk: 'low' },
    { id: 'recent_events', name: '近期暗流查询', kind: 'query', category: '查询', risk: 'low' },
    { id: 'memory_status', name: '记忆状态盘点', kind: 'query', category: '查询', risk: 'low' },
    { id: 'settings_overview', name: '设置概览', kind: 'query', category: '查询', risk: 'low' },
    { id: 'setting_guide', name: '设置引导', kind: 'query', category: '管家', risk: 'low' },
    { id: 'diagnose_world', name: '世界推演诊断', kind: 'query', category: '诊断', risk: 'low' },
    { id: 'diagnose_person', name: '人物停滞诊断', kind: 'query', category: '诊断', risk: 'low' },
    { id: 'search_lingqi_chat', name: '玲七聊天搜索', kind: 'query', category: '整理', risk: 'low' },
    { id: 'update_setting', name: '安全设置代办', kind: 'action', category: '控制', risk: 'medium' },
    { id: 'set_person_simulation', name: '人物推演开关', kind: 'action', category: '控制', risk: 'medium' },
    { id: 'cancel_simulation', name: '停止当前推演', kind: 'action', category: '控制', risk: 'medium' },
    { id: 'cancel_background_tasks', name: '停止后台任务', kind: 'action', category: '控制', risk: 'medium' },
    { id: 'check_world_state', name: '世界事实检查', kind: 'action', category: '诊断', risk: 'medium' },
    { id: 'organize_memory', name: '整理长期记忆', kind: 'action', category: '整理', risk: 'medium' },
    { id: 'simulate_latest', name: '推演最新正文', kind: 'action', category: '控制', risk: 'medium', confirmation: true },
    { id: 'refresh_public_world', name: '巡查公共世界', kind: 'action', category: '控制', risk: 'medium', confirmation: true },
    { id: 'prioritize_person', name: '人物下轮优先', kind: 'action', category: '控制', risk: 'medium' },
    { id: 'catch_up_person', name: '人物近况补算', kind: 'action', category: '控制', risk: 'medium', confirmation: true },
    { id: 'delete_lingqi_chat', name: '删除玲七聊天', kind: 'action', category: '整理', risk: 'high', confirmation: true },
];

export const LINGQI_SKILL_REGISTRY = Object.freeze(
    SKILLS.map(skill => Object.freeze({ confirmation: false, ...skill })),
);

export const LINGQI_ACTION_TYPES = new Set(
    LINGQI_SKILL_REGISTRY.filter(skill => skill.kind === 'action').map(skill => skill.id),
);

export const LINGQI_SETTING_GUIDES = Object.freeze([
    {
        id: 'world-engine',
        title: '世界引擎',
        keywords: ['世界引擎', '世界推演总开关', '启用世界', '世界推演'],
        path: '玲七的小窝 → 全局设置 → 常用 → 启用世界引擎',
        keys: ['worldSimulationEnabled'],
        meaning: '决定世界背面是否继续结算人物、暗流和世界状态。关闭不会删除已有数据。',
        choices: ['开启：世界继续运行，可以手动或自动推演', '关闭：停止新的世界推演，已有状态原样保留'],
        recommendation: '平时建议开启；只在测试、排错或想暂时冻结后台世界时关闭。',
        delegable: true,
    },
    {
        id: 'auto-simulation',
        title: '自动运行',
        keywords: ['自动运行', '自动推演', '每轮推演'],
        path: '玲七的小窝 → 全局设置 → 常用 → 自动运行',
        keys: ['worldAutoEnabled'],
        meaning: '决定新正文出现后是否自动安排世界推演；关闭后仍可手动点“推演世界”。',
        choices: ['开启：新正文后自动排队推演', '关闭：只在你手动要求时推演'],
        recommendation: '想省心就开启；调试提示词、控制 API 消耗或逐轮检查时关闭。',
        delegable: true,
    },
    {
        id: 'prompt-injection',
        title: '正文注入',
        keywords: ['正文注入', '注入总开关', '把后台递给正文', '正文显露'],
        path: '玲七的小窝 → 全局设置 → 正文注入',
        keys: ['worldPromptInjection'],
        meaning: '只决定后台资料是否交给正文模型看，不决定后台模块是否继续运行。',
        choices: ['总开关开启：再按时间、人物、暗流、回声、事实、记忆、舆情分别选择', '总开关关闭：后台照常保存和运行，但不向正文递交'],
        recommendation: '通常开启总开关，再按需要关闭单项；不要为了停止推演而关闭注入。',
        delegable: true,
    },
    {
        id: 'time-injection',
        title: '世界时间注入',
        keywords: ['世界时间注入', '时间注入', '最小锚点', '完整时间', '正文报时'],
        path: '玲七的小窝 → 全局设置 → 正文注入 → 世界时间',
        keys: ['injectionTimeMode'],
        meaning: '决定正文模型能看到多少世界时间信息。',
        choices: ['完整：日期、时段和具体时间都递给正文', '最小锚点：只保留维持时间连续性所需的信息', '关闭：完全不递时间，时间倒退或乱跳的风险更高'],
        recommendation: '多数文游建议“最小锚点”；需要日程、倒计时或精确时间线时选“完整”。',
        delegable: true,
    },
    {
        id: 'people-injection',
        title: '人物状态注入',
        keywords: ['人物注入', '人物状态注入', '角色状态注入'],
        path: '玲七的小窝 → 全局设置 → 正文注入 → 「人物」· 当前状态',
        keys: ['injectionPeople'],
        meaning: '决定人物当前位置、行动和意图是否递给正文；关闭不等于人物停止后台生活。',
        choices: ['开启：正文更容易承接人物当前状态', '关闭：人物仍可后台推演，但正文模型看不到这份状态'],
        recommendation: '通常建议开启；只有想让正文完全不参考后台人物状态时关闭。',
        delegable: true,
    },
    {
        id: 'event-injection',
        title: '暗流与回声注入',
        keywords: ['暗流注入', '事件注入', '回声注入', '世界事实注入'],
        path: '玲七的小窝 → 全局设置 → 正文注入 → 「暗流」/「回声」/世界事实',
        keys: ['injectionEvents', 'injectionEchoes', 'injectionFacts'],
        meaning: '分别控制进行中事件、已结算后果和权威世界事实是否递给正文。',
        choices: ['暗流：让正文知道镜头外正在形成的变化', '回声：让正文承接已经发生的后果', '世界事实：防止正文与已成立事实冲突'],
        recommendation: '世界事实和回声建议保持开启；暗流可按你希望的提前显露程度决定。',
        delegable: true,
    },
    {
        id: 'memory',
        title: '长期记忆',
        keywords: ['记忆系统', '长期记忆', '记忆注入', '自动整理记忆', '记忆整理'],
        path: '玲七的小窝 → 当前聊天设置 → 长期记忆；注入开关在“全局设置 → 正文注入 → 长期记忆”',
        keys: ['memorySystemEnabled', 'injectionMemory', 'memoryAutoIndexInterval'],
        meaning: '“记忆系统”决定是否继续整理和保存；“记忆注入”只决定是否交给正文；“整理间隔”决定多久自动收拾一次。',
        choices: ['系统开启 + 注入开启：继续整理，也交给正文', '系统开启 + 注入关闭：继续整理，但正文暂时看不到', '系统关闭：不再整理新记忆，旧记忆仍保留'],
        recommendation: '通常保持系统开启；整理间隔 10 轮适合多数聊天，长篇可用 5 轮，想完全手动就选 0。',
        delegable: true,
    },
    {
        id: 'public-opinion',
        title: '舆情与新闻',
        keywords: ['舆情', '新闻', '论坛', '自动舆情', '舆情注入'],
        path: '世界背面侧栏 → 舆情；注入开关在“全局设置 → 正文注入 → 新闻与论坛”',
        keys: ['publicOpinionAutoEnabled', 'injectionPublicOpinion'],
        meaning: '自动舆情决定是否自动刷新公共声音；舆情注入只决定这些内容是否递给正文。',
        choices: ['自动开启：满足世界时间与公共事件条件时自动更新', '自动关闭：只在你手动“巡一圈”时刷新', '注入关闭：新闻仍可生成，但不会主动进入正文上下文'],
        recommendation: '希望世界有环境声就开启自动舆情；控制 API 消耗时关闭自动、保留手动巡查。',
        delegable: true,
    },
    {
        id: 'player-recording',
        title: '记录玩家角色',
        keywords: ['记录玩家角色', '玩家角色', '记录 user', '记录我'],
        path: '世界背面侧栏 → 人物 → 人物推演设置 → 记录玩家角色',
        keys: ['recordPlayerCharacter'],
        meaning: '只记录正文已经明确发生的玩家位置、行动和客观状态，不读取或代写玩家内心。',
        choices: ['开启：玩家客观状态进入人物板块', '关闭：玩家不作为后台人物记录'],
        recommendation: '需要严谨的位置和行动连续性时开启；不想插件维护玩家状态时关闭。',
        delegable: true,
    },
    {
        id: 'background-people',
        title: '强化后台人物推演',
        keywords: ['强化后台人物', '后台人物推演', 'npc 推演', '镜头外人物'],
        path: '世界背面侧栏 → 人物 → 人物推演设置 → 强化后台人物推演',
        keys: ['enhancedBackgroundSimulation'],
        meaning: '让更多镜头外人物按世界时间参与结算；不是每轮给每个人单独请求一次 API。',
        choices: ['开启：镜头外人物更活跃，状态覆盖更广', '关闭：更克制地按相关性和到期条件结算'],
        recommendation: '人物很多但希望世界更活时开启；更重视稳定与消耗时先关闭。',
        delegable: true,
    },
    {
        id: 'connection',
        title: '连接与模型',
        keywords: ['api', '接口', '连接', '模型', '中转', '酒馆连接', '模块分流'],
        path: '玲七的小窝 → 全局设置 → 连接与模型',
        keys: [],
        meaning: '先选择跟随酒馆、酒馆配置或独立接口，再为世界推演、人物观测、记忆和舆情选择默认连接或单独分流。',
        choices: ['不需要独立接口：跟随酒馆当前连接', '需要固定模型：选择酒馆配置', '需要独立 URL / Key：保存独立接口，再在“模块 API 分流”里分配'],
        recommendation: '不确定时先跟随酒馆；只有需要模型分工、独立额度或不同上下文能力时再分流。API Key 不交给玲七聊天代填。',
        delegable: false,
    },
    {
        id: 'generation-limit',
        title: 'Token 与等待时间',
        keywords: ['token', '输出上限', '生成限制', '超时', '等待时间', 'timeout'],
        path: '玲七的小窝 → 全局设置 → 高级维护 → 生成限制',
        keys: ['maxOutputTokens', 'generationTimeoutMs'],
        meaning: '全局值为 0 表示自动；模块单独留 0 表示继承全局。Token 是输出上限，不是强制写满。',
        choices: ['自动：让插件按任务类型选择', '自定义全局：统一提高或限制', '按模块单独设置：只调整世界推演、人物观测、记忆或舆情'],
        recommendation: '一般先用自动；遇到世界推演 JSON 被截断时优先提高“世界推演”模块 Token，上游慢但仍在生成时再增加等待时间。',
        delegable: false,
    },
    {
        id: 'appearance',
        title: '界面字号与悬浮球',
        keywords: ['界面字号', '字体', '字号', '悬浮球', '贴边', '界面明暗', '主题'],
        path: '玲七的小窝 → 全局设置 → 常用 → 外观',
        keys: ['uiScale', 'orbEnabled', 'orbEdgeHide', 'theme'],
        meaning: '控制世界背面自己的字号、明暗和悬浮球显示，不改变 SillyTavern 正文字体。',
        choices: ['字号：紧凑 / 标准 / 大字', '明暗：自动 / 日间 / 夜间', '悬浮球可隐藏，也可开启贴边收纳'],
        recommendation: '优先用“标准”；手机或阅读吃力时用“大字”。隐藏悬浮球后可从酒馆扩展设置重新打开。',
        delegable: false,
    },
]);

export function findLingqiSettingGuide(userText = '') {
    const raw = normalize(userText).toLocaleLowerCase();
    if (!raw || !/(?:怎么(?:设|设置|调|开|关|用)|如何(?:设|设置|开启|关闭|使用)|在哪(?:里)?(?:设|设置|开|关|找)|入口|调哪个|选哪个|什么意思|该不该开|要不要开)/u.test(raw)) return null;
    const scored = LINGQI_SETTING_GUIDES
        .map(guide => ({
            guide,
            score: guide.keywords.reduce((total, keyword) => (
                raw.includes(String(keyword).toLocaleLowerCase()) ? total + Math.max(2, keyword.length) : total
            ), 0),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.guide.title.length - a.guide.title.length);
    if (!scored.length) return null;
    return scored[0].guide;
}

function normalize(value = '') {
    return String(value || '').trim();
}

function mentionedPersonName(userText, people = []) {
    const raw = normalize(userText).toLocaleLowerCase();
    const matches = (Array.isArray(people) ? people : [])
        .map(person => String(person?.name || '').trim())
        .filter(name => name && raw.includes(name.toLocaleLowerCase()))
        .sort((a, b) => b.length - a.length);
    if (!matches.length) return '';
    const longest = matches[0];
    return matches.filter(name => name.length === longest.length).length === 1 ? longest : '';
}

export function parseLingqiLocalQueryRequest(userText = '', people = []) {
    const raw = normalize(userText);
    if (!raw) return null;

    if (/(?:你会什么|你能做什么|有什么技能|技能清单|管家能力|能帮我做什么)/u.test(raw)) {
        return { type: 'list_skills' };
    }

    const personName = mentionedPersonName(raw, people);
    if (
        personName
        && /(?:为什么|怎么).{0,12}(?:没动|不动|没推演|没更新|这么久)|(?:这么久|最近).{0,8}(?:没动|不动|没推演|没更新)/u.test(raw)
    ) {
        return { type: 'diagnose_person', personName };
    }
    if (
        personName
        && /(?:现在|目前|最近).{0,12}(?:在哪|哪里|做什么|干什么|怎么样|状态|近况)|(?:在哪|哪里|做什么|干什么|怎么样|状态|近况).{0,4}(?:呢|？|\?)*$/u.test(raw)
    ) {
        return { type: 'person_status', personName };
    }

    if (/(?:为什么|怎么).{0,12}(?:没推演|不推演|没运行|没跑|失败|报错)|(?:后台|世界推演).{0,8}(?:卡住|正常吗|怎么了|有问题)/u.test(raw)) {
        return { type: 'diagnose_world' };
    }
    const settingGuide = findLingqiSettingGuide(raw);
    if (settingGuide) return { type: 'setting_guide', guideId: settingGuide.id };
    if (/(?:世界背面|后台|世界).{0,8}(?:什么情况|怎么样|状态总览|汇报)|(?:状态总览|汇报一下|管家汇报)/u.test(raw)) {
        return { type: 'status_overview' };
    }
    if (/(?:有哪些|列出|看看|查看).{0,6}(?:人物|角色)|(?:人物|角色)(?:清单|列表|有谁)/u.test(raw)) {
        return { type: 'list_people' };
    }
    if (/(?:最近|当前|现在).{0,8}(?:发生了什么|有什么暗流|有哪些暗流|有什么事件|有哪些事件)|(?:暗流|事件)(?:清单|列表|近况)/u.test(raw)) {
        return { type: 'recent_events' };
    }
    if (/(?:记忆).{0,8}(?:什么情况|状态|多少|整理到哪|记住了什么)|(?:盘点|看看|查看).{0,6}(?:长期)?记忆/u.test(raw)) {
        return { type: 'memory_status' };
    }
    if (/(?:设置|开关).{0,8}(?:概览|总览|有哪些|什么状态|现在怎样)|(?:看看|查看).{0,6}(?:设置|开关)/u.test(raw)) {
        return { type: 'settings_overview' };
    }

    const search = raw.match(/(?:找(?:一下|找)?|搜索|翻翻|查查).{0,8}(?:我们|玲七)?(?:之前|以前)?(?:聊过|说过|提到过|提过)?(?:的)?[“「『]?([^”」』，。！？!]{2,80})[”」』]?(?:那段|的地方|在哪|记录)?/u)
        || raw.match(/(?:我们|你和我).{0,6}(?:聊过|说过|提到过|提过)[“「『]?([^”」』，。！？!]{2,80})[”」』]?(?:吗|没有|么|？|\?)/u);
    if (search) {
        const query = String(search[1] || '')
            .replace(/^(?:关于|有关)/u, '')
            .replace(/(?:的聊天|这件事|这个话题)$/u, '')
            .trim();
        if (query.length >= 2) return { type: 'search_lingqi_chat', query };
    }

    return null;
}

export function buildLingqiSkillMenuText() {
    return [
        '我现在能做这些：',
        '· 查：世界总览、人物位置/行动、近期暗流、记忆与设置状态',
        '· 诊断：为什么没推演、后台是否卡住、某个人为什么很久没动',
        '· 控制：推演最新正文、巡查公共世界、开关安全设置、停止后台任务',
        '· 人物：开关后台推演、排到下一轮优先、补一次近况',
        '· 整理：搜索或删除玲七聊天、整理长期记忆、检查世界事实',
        '改人物核心事实、删长期记忆、重置世界和改 API，我不会只凭一句话直接动。',
    ].join('\n');
}
