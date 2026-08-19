import { LINGQI_ACTION_TYPES } from './lingqi-skills.js';

const HELP_TOPICS = [
    {
        id: 'world-backstage-concept',
        title: '世界背面是什么',
        keywords: ['世界背面', '后台', '正文', '镜头', '运行', '不注入', '不存在'],
        text: '世界背面就是这个故事世界本身的后台状态，正文只是当前镜头。某个模块不注入正文，不等于它不存在或停止运行；人物、事件、记忆、舆情仍会继续保存和发展。',
    },
    {
        id: 'simulation',
        title: '世界推演与停止',
        keywords: ['推演', '停止推演', '暂停', '自动推演', '手动推演', '不推演', '没推演'],
        text: '“推演世界”处理正文后的世界状态变化；“停止推演”只停当前正在运行的世界推演。“停止全部后台任务”会连记忆整理、历史回溯、舆情、观测、纠错和排队中的世界推演一起停止。若记忆整理等后台任务正在运行，“推演世界”仍可以点击，但会先安全排队，等当前任务结束后再开始，不会并发写世界状态。停止未完成任务不会回滚已经成功提交的数据。',
    },
    {
        id: 'narrative-sync-status',
        title: '最新正文是否已经推演',
        keywords: ['最新正文', '黄点', '小黄点', '待推演', '推演完成', '排队', '气泡', '弹窗'],
        text: '当前消息、滑动分支、正文内容指纹和提交快照都对得上，才算最新正文已经推演。主状态条、此刻页、悬浮球与玲七都读取同一份结果。黄色点表示正文待推演、失败或需要处理；主题色小点只表示世界有新变化还没看。',
    },
    {
        id: 'injection',
        title: '正文注入',
        keywords: ['注入', '正文注入', '人物注入', '事实注入', '回声注入', '记忆注入', '舆情注入', '通讯注入', '聊天影响正文', '时间锚点'],
        text: '正文注入只决定哪些后台信息交给正文模型看，不控制对应后台模块是否运行。总开关关闭时后台仍会继续保存与运转。通讯默认不影响正文；单独开启后也只作为“未结算通信记录”参考，聊天里的承诺、计划不会被当成已发生。时间注入有“完整 / 最小锚点 / 关闭”三档；最小锚点只负责防止时间无因果倒退或乱跳。',
    },
    {
        id: 'player-recording',
        title: '记录玩家角色',
        keywords: ['玩家角色', 'user', '记录玩家', '不记录我', '记录我', '玩家内心', 'inner_voice'],
        text: '“记录玩家角色”开启时只保存正文已经明确发生的 user 位置、行动和客观状态；关闭后 user 不会进入人物板块或后台人物推演。无论开关如何，已经发生的正文行动仍然是世界事实。插件不会保存或代写玩家 inner_voice。',
    },
    {
        id: 'people',
        title: '人物与后台人物推演',
        keywords: ['人物', 'npc', '角色', '不动', '人物推演', '后台人物', 'simulationEnabled', '强化后台人物'],
        text: '人物板块保存人物的当前后台状态。单个人物可以关闭后台推演；“强化后台人物推演”用于让更多镜头外人物按世界时间结算，不代表每轮都要给每个人单独请求一次 API。',
    },
    {
        id: 'currents-echoes',
        title: '暗流与回声',
        keywords: ['暗流', '回声', '事件', '为什么有回声', '删回声', '纪事'],
        text: '暗流是正在形成或等待条件的后台事件；回声是已经发生并留下后果、痕迹或可递交结果的记录。删除/纠错时要区分尚未发生的派生和已经真正发生的正文历史：后者不能被后台偷偷改写。',
    },
    {
        id: 'memory',
        title: '记忆',
        keywords: ['记忆', '整理记忆', '扫描历史', '历史回溯', '记错', '长期记忆', 'memory'],
        text: '记忆系统会整理长期事实、线索和分层摘要。普通记忆整理逐批保存，失败后从上次成功位置继续；“中途接入”的完整历史回溯也会逐批保存安全断点，但只有全部成功后才把暂存世界一次性提交，断点不会覆盖正式世界。关闭“记忆注入”只是不把记忆交给正文，关闭“记忆系统”才会停止记忆任务。输出达到 length 是 Token 上限，不是等待超时；应把“历史 / 记忆”Token 上限设为 0 自动或适当调高。',
    },
    {
        id: 'public-opinion',
        title: '舆情与新闻',
        keywords: ['舆情', '新闻', '论坛', '为什么没新闻', '新闻不更新', '公共信息', 'public'],
        text: '舆情由世界时间和真正公开/传播的事件驱动，不是每聊一轮就强制更新。V2.3 的“巡一圈并刷新”会在首次升级、世界时间走过至少三小时或自定义世界侧重点改变时，先轮转检查镜头外公共世界；同一世界时刻与同一侧重点不会反复巡查。新闻形成的天气、交通、公告等客观影响会接回人物认知和后续正文，但没有获知渠道的人不会自动全知。关闭舆情注入只是不往正文递，不等于舆情停止运行。',
    },
    {
        id: 'worldbook',
        title: '世界书人物导入',
        keywords: ['世界书', '导入人物', 'mvu', '变量', '一键导入', '识别人物'],
        text: '世界书人物导入默认可以一键智能识别人物，会跳过 MVU、变量、脚本、JSONPatch、正则等技术条目；人物和势力写在同一条时会尝试拆出人物。不确定的候选会留给高级手动挑选。',
    },
    {
        id: 'cache-reset',
        title: '清缓存与重置',
        keywords: ['清缓存', '缓存', '重置', '全清', '恢复点', '重新测试', '清理数据'],
        text: '“清理当前聊天缓存”只清可重建缓存和临时任务，不动人物、事件、记忆、世界钟和 API。“重置当前聊天数据”会把当前聊天的世界背面恢复为空白，同时清恢复点/分支快照以防旧数据诈尸；聊天正文和 API 配置不会删除。',
    },
    {
        id: 'fact-correction',
        title: '事实纠错',
        keywords: ['纠错', '记错', '错误', '已婚', '离婚', '事实冲突', '一步错步步错', '检查世界状态'],
        text: '事实优先级大致是：用户/手动维护 > 正文明示事实 > 已结算事件结果 > 普通 AI 推断。稳定身份/关系事实不能被后台推断无因果翻转。“检查并修正世界状态”只修有明确证据的后台错误，不能倒带已经真实发生的正文。',
    },
    {
        id: 'api',
        title: 'API、200、429 与错误',
        keywords: ['api', '200', '401', '429', 'unauthorized', '限流', '接口', '模型', '空回', '连接失败', '报错'],
        text: 'HTTP 200 只代表传输层可能成功，不保证模型真的返回了有效 completion；有些中转会用 200 包着 Unauthorized/error 正文。429 是限流，插件会保留真实冷却而不是把它当脏缓存清掉。排障时应同时看 transportStatus、upstreamStatus、errorSummary、当前模型和任务路由。',
    },
    {
        id: 'tokens-timeout',
        title: 'Token 与超时',
        keywords: ['token', '16000', '64000', '上限', '最大输出', '超时', 'timeout'],
        text: '全局与模块 Token 上限为 0 时表示自动/继承；正数表示真正的输出上限。世界推演模块留 0 继承全局时，首轮会直接把用户设置的全局值作为可用上限，不再先缩到旧的 4.6K / 6.4K；max_tokens 只是 ceiling，模型写完仍会自己停。人物观测、历史/记忆和舆情等小任务仍按各自预算运行。若世界推演返回未闭合 JSON 并判定为 output-limit，本轮人物、事件、记忆和世界时间都不会提交，应先提高世界推演或全局 Token 上限再试。插件也不应该把用户填写的更大值偷偷压回旧的 16000。',
    },
    {
        id: 'mama',
        title: '妈妈在哪里',
        keywords: ['妈妈', '找妈妈', '妈妈在哪', '妈妈在哪里', '个人社区', '社区', '玲', '小玲七的妈妈', '谁做的'],
        text: '玲七知道自己的妈妈叫“玲”，纸条署名是“小玲七的妈妈·玲”。妈妈在自己的个人社区等大家；用户想找妈妈、反馈 bug、问使用问题或许愿新功能时，可以直接去 https://discord.gg/3tdTAy2Fr，也可以点玲七页里的“妈妈的小纸条”再按“去找妈妈”。问“妈妈在哪/怎么找妈妈”时要直接说这件事，不要编“妈妈在屏幕外”“可能在忙”“玲七碰不到她”之类没有依据的话，也不要虚构现实住址。',
    },
    {
        id: 'lingqi',
        title: '玲七',
        keywords: ['玲七', '小猫', '纸条', '导演', '小管家', '问猫'],
        text: '玲七是插件内置的小猫管家：可以聊天、解释插件、汇报世界总览，查询人物/暗流/记忆/设置与通讯关系，诊断推演与人物停滞，搜索或管理自己的聊天记录，确认后代发消息、处理好友申请、刷新朋友圈，也可以把“下一段想怎么玩”翻成导演小纸条。玲七知道做出自己和世界背面的人是妈妈“玲”，需要找妈妈时可以去个人社区 https://discord.gg/3tdTAy2Fr。真正发送、解除关系或删除聊天前都会先弹确认；删除玲七聊天默认不删除长期记忆。玲七聊天本身不是世界事实，用户的猜测不会自动写进人物或世界状态。',
    },
];

function normalize(value) {
    return String(value ?? '').trim().toLocaleLowerCase();
}

export function selectLingqiHelpEntries(query, maximum = 6) {
    const text = normalize(query);
    if (!text) return HELP_TOPICS.slice(0, Math.max(1, maximum));
    return HELP_TOPICS
        .map(topic => {
            let score = 0;
            for (const keyword of topic.keywords) {
                const key = normalize(keyword);
                if (!key) continue;
                if (text.includes(key)) score += Math.max(2, Math.min(10, key.length + 1));
            }
            if (text.includes(normalize(topic.title))) score += 12;
            return { topic, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title, 'zh-CN'))
        .slice(0, Math.max(1, maximum))
        .map(item => item.topic);
}

export function buildLingqiHelpContext(query, pluginVersion = '') {
    const topics = selectLingqiHelpEntries(query, 6);
    const lines = [
        `当前插件版本：${String(pluginVersion || '未知')}`,
        '以下是当前版本内置帮助知识。只能把这里明确写出的功能说明当成已知插件规则；没有写到、当前状态也看不出来的，不要自行补设定。',
    ];
    for (const topic of topics) {
        lines.push(`- ${topic.title}：${topic.text}`);
    }
    return lines.join('\n');
}

export function normalizeLingqiButlerActions(value) {
    const source = Array.isArray(value) ? value : [];
    return source
        .slice(0, 8)
        .map(raw => {
            if (!raw || typeof raw !== 'object') return null;
            const type = String(raw.type || '').trim();
            if (!LINGQI_ACTION_TYPES.has(type)) return null;
            if (type === 'update_setting') {
                return {
                    type,
                    setting: String(raw.setting || raw.key || '').trim().slice(0, 80),
                    value: raw.value,
                };
            }
            if (type === 'set_person_simulation') {
                return {
                    type,
                    personId: String(raw.person_id ?? raw.personId ?? '').trim().slice(0, 120),
                    personName: String(raw.person_name ?? raw.personName ?? '').trim().slice(0, 100),
                    enabled: Boolean(raw.enabled),
                };
            }
            if (['prioritize_person', 'catch_up_person'].includes(type)) {
                return {
                    type,
                    personId: String(raw.person_id ?? raw.personId ?? '').trim().slice(0, 120),
                    personName: String(raw.person_name ?? raw.personName ?? '').trim().slice(0, 100),
                    enabled: type === 'prioritize_person' ? raw.enabled !== false : true,
                };
            }
            if (['social_send_message', 'social_accept_request', 'social_refuse_request', 'social_remove_friend'].includes(type)) {
                return {
                    type,
                    personId: String(raw.person_id ?? raw.personId ?? '').trim().slice(0, 120),
                    personName: String(raw.person_name ?? raw.personName ?? '').trim().slice(0, 100),
                    text: type === 'social_send_message'
                        ? String(raw.text ?? raw.message ?? '').trim().slice(0, 1600)
                        : '',
                };
            }
            if (type === 'delete_lingqi_chat') {
                const requestedMode = String(raw.mode || '').trim().toLowerCase();
                const mode = [
                    'all',
                    'recent',
                    'between',
                    'before',
                    'after',
                    'day',
                    'topic',
                ].includes(requestedMode) ? requestedMode : 'topic';
                return {
                    type,
                    mode,
                    count: Math.min(800, Math.max(1, Number.parseInt(raw.count, 10) || 1)),
                    startQuery: String(raw.start_query ?? raw.startQuery ?? '').trim().slice(0, 240),
                    endQuery: String(raw.end_query ?? raw.endQuery ?? '').trim().slice(0, 240),
                    query: String(raw.query ?? raw.topic ?? '').trim().slice(0, 240),
                    day: ['today', 'yesterday', 'day_before_yesterday'].includes(String(raw.day || '').trim().toLowerCase())
                        ? String(raw.day || '').trim().toLowerCase()
                        : '',
                };
            }
            return { type };
        })
        .filter(Boolean);
}

export const LINGQI_BUTLER_TOOL_HELP = [
    '可代办的低风险动作只有这些：',
    '1. update_setting：修改可逆的面板开关/枚举。setting 只能是：worldSimulationEnabled / worldPromptInjection / injectionTimeMode / injectionWorldBackground / injectionPeople / injectionEvents / injectionEchoes / injectionFacts / injectionMemory / injectionPublicOpinion / injectionSocial / socialAutoEnabled / memorySystemEnabled / worldAutoEnabled / publicOpinionAutoEnabled / recordPlayerCharacter / enhancedBackgroundSimulation。不要碰 API Key、URL、模型、人物核心事实、删除/重置。',
    '2. set_person_simulation：开启/关闭某个明确人物的后台推演。必须给 person_id 或准确名字；找不到/重名时不要猜。',
    '3. cancel_simulation：只停止当前世界推演。',
    '4. cancel_background_tasks：停止全部尚未完成的后台任务。',
    '5. check_world_state：用户明确要求检查/修正事实错误时，调用现有事实纠错流程。',
    '6. organize_memory：用户明确要求“整理记忆/整理一下记忆”时，启动现有长期记忆整理；这不是“重建世界历史”，不要把两者混为一谈。',
    '7. simulate_latest：只在用户明确要求推演最新正文时使用；已经追上时不得强制重跑。会调用世界推演，插件必须先向用户确认。',
    '8. refresh_public_world：只在用户明确要求“巡一圈/刷新世界舆情”时使用；复用现有公共世界巡查、三小时规则和同刻去重。会调用后台模型，插件必须先向用户确认。',
    '9. prioritize_person：让一个明确人物在下一轮后台结算中优先；不立即调用 API。必须给 person_id 或准确名字，找不到/重名时不要猜。',
    '10. catch_up_person：为一个明确人物立即补一次近况，复用现有人物补推演。会调用后台模型，插件必须先向用户确认。',
    '11. delete_lingqi_chat：只管理“玲七和用户自己的聊天记录”，不删除世界正文、不删除世界状态、不删除人物/事件，也默认不动玲七已经形成的长期记忆。用户明确要求删除玲七聊天时才可使用；支持 mode=all / recent / between / before / after / day / topic。between 用 start_query + end_query；before/after 用 query；topic 用 query；recent 用 count；day 用 today / yesterday / day_before_yesterday。插件会先在本地定位实际记录并弹出删除范围、条数和首尾预览，用户再次确认后才真正删除。找不到或存在明显歧义时不要猜。',
    '12. social_send_message：用户明确要求给一位现有通讯好友发出具体文字时使用；必须给准确人物与 text，插件会预览确认后才发送。',
    '13. social_accept_request / social_refuse_request：只处理当前真实存在的主动好友申请；必须给准确人物，插件会确认。',
    '14. social_remove_friend：删除一位现有通讯好友；只解除关系并保留历史/共同群聊，插件会确认，不得声称聊天记录也被删除。',
    '15. social_refresh_moments：用户明确要求查看新朋友圈时使用；会调用后台模型，若启用生图还可能产生一次生图费用，插件会确认。',
    '这些动作由插件本地执行。reply 不要提前声称“已经修改成功”；可以说“我来弄/我去看看”，真正成功结果会由插件补到回复后面。',
].join('\n');

export const LINGQI_SAFE_SETTING_KEYS = Object.freeze({
    worldSimulationEnabled: 'boolean',
    worldPromptInjection: 'boolean',
    injectionTimeMode: 'enum:full,anchor,off',
    injectionWorldBackground: 'boolean',
    injectionPeople: 'boolean',
    injectionEvents: 'boolean',
    injectionEchoes: 'boolean',
    injectionFacts: 'boolean',
    injectionMemory: 'boolean',
    injectionPublicOpinion: 'boolean',
    injectionSocial: 'boolean',
    socialAutoEnabled: 'boolean',
    memorySystemEnabled: 'boolean',
    worldAutoEnabled: 'boolean',
    publicOpinionAutoEnabled: 'boolean',
    recordPlayerCharacter: 'boolean',
    enhancedBackgroundSimulation: 'boolean',
});

export function isKnownLingqiHelpQuestion(query) {
    return selectLingqiHelpEntries(query, 1).length > 0;
}
