import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IMPORT_PASS_COVERAGE,
    buildWorldbookImportPrompt,
    groundingCoverage,
    mergeImportedDrafts,
    normalizeImportedPeople,
    planImportWrites,
    planWorldbookImportBatches,
    splitLongEntries,
    summarizeUntouchedEntries,
} from '../worldbook.js';

const nanfeng = {
    uid: '12',
    name: '南枫',
    content: [
        '# SFW - 人物设定',
        'name: 南枫',
        'nicknames: [南枫, 枫姐, 老板娘, 疯(网名), 枫]',
        'age: 32',
        'gender: Female',
        'identities:',
        '- 表象身份：琴行"灵汐塔(Lichtgestalt)"老板，前哥特摇滚乐队"心房"主唱',
        'appearance:',
        '  height: 170cm',
        '  body_shape: 体型修长骨感中带有肉感，比例极佳，一双大长腿十分吸睛',
        'core:',
        '- 愤世嫉俗，厌恶虚伪与崇洋媚外，追求精神与文化的深度共鸣',
        'surface:',
        '- 高冷御姐，言辞犀利，行事作风干练洒脱',
        'background: 独立自主多年，与家庭关系疏离，习惯了自己掌控生活。',
    ].join('\n'),
};

const carried = {
    name: '南枫',
    source_uids: ['12'],
    identity_anchor: '性别：Female；年龄：32；身份：琴行"灵汐塔(Lichtgestalt)"老板，前哥特摇滚乐队"心房"主唱',
    appearance_profile: '身高：170cm；体型修长骨感中带有肉感，比例极佳，一双大长腿十分吸睛',
    personality_anchor: '愤世嫉俗，厌恶虚伪与崇洋媚外；高冷御姐，言辞犀利，行事作风干练洒脱',
    background_profile: '独立自主多年，与家庭关系疏离，习惯了自己掌控生活。',
    speaking_style: '',
    behavior_boundaries: '',
};

test('照搬原文的栏位全部通过回查', () => {
    const { people, skipped } = normalizeImportedPeople({ people: [carried] }, [nanfeng]);
    assert.equal(skipped.length, 0);
    assert.equal(people.length, 1);
    const [person] = people;
    assert.equal(person.name, '南枫');
    assert.deepEqual(person.sourceUids, ['12']);
    assert.match(person.values.identityAnchor, /灵汐塔/);
    assert.match(person.values.appearanceProfile, /170cm/);
    assert.equal(person.review.length, 0);
    assert.equal(person.dropped.length, 0);
    assert.equal(person.lengthFuse, false);
});

test('没有原文依据的栏位保持空，不被凑满', () => {
    const { people } = normalizeImportedPeople({ people: [carried] }, [nanfeng]);
    assert.equal(people[0].values.speakingStyle, undefined);
    assert.equal(people[0].values.behaviorBoundaries, undefined);
});

test('模型自己总结出来的句子被拦下，同栏位的搬运内容保留', () => {
    const { people } = normalizeImportedPeople({
        people: [{
            ...carried,
            personality_anchor: '愤世嫉俗，厌恶虚伪与崇洋媚外；她本质上是个渴望被理解的孤独灵魂，用尖锐的外壳保护自己不受伤害',
        }],
    }, [nanfeng]);
    const [person] = people;
    assert.match(person.values.personalityAnchor, /愤世嫉俗/);
    assert.doesNotMatch(person.values.personalityAnchor, /孤独灵魂/);
    assert.equal(person.dropped.length, 1);
    assert.equal(person.dropped[0].field, 'personalityAnchor');
    assert.ok(person.dropped[0].coverage < 0.6);
});

test('整栏都是推断时该人物被完全跳过', () => {
    const { people, skipped } = normalizeImportedPeople({
        people: [{
            name: '南枫',
            source_uids: ['12'],
            personality_anchor: '她其实非常缺乏安全感，害怕被抛弃，所以才把所有人推开',
            background_profile: '童年时父母离异，被寄养在外婆家，这段经历塑造了她的疏离感',
        }],
    }, [nanfeng]);
    assert.equal(people.length, 0);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /原文回查/);
});

test('“无 / 未提及”这类填充值不写进栏位', () => {
    const { people } = normalizeImportedPeople({
        people: [{ ...carried, speaking_style: '未提及', behavior_boundaries: '无' }],
    }, [nanfeng]);
    assert.equal(people[0].values.speakingStyle, undefined);
    assert.equal(people[0].values.behaviorBoundaries, undefined);
});

test('总字数超过原文时熔断，整个人物标记为需复核', () => {
    const terse = { uid: '3', name: '阿明', content: '阿明 话很少' };
    const { people } = normalizeImportedPeople({
        people: [{
            name: '阿明',
            source_uids: ['3'],
            identity_anchor: '阿明',
            personality_anchor: '话很少',
            background_profile: '话很少',
            speaking_style: '话很少',
            behavior_boundaries: '话很少',
        }],
    }, [terse]);
    assert.equal(people.length, 1);
    assert.equal(people[0].lengthFuse, true);
    assert.equal(people[0].review.length, Object.keys(people[0].values).length);
});

test('玩家角色与宏名不会被建成后台 NPC', () => {
    const { people, skipped } = normalizeImportedPeople({
        people: [
            carried,
            { name: '{{user}}', source_uids: ['12'], identity_anchor: '性别：Female' },
            { name: '林澈', source_uids: ['12'], identity_anchor: '性别：Female' },
        ],
    }, [nanfeng], { userName: '林澈' });
    assert.deepEqual(people.map(person => person.name), ['南枫']);
    assert.equal(skipped.length, 2);
    assert.ok(skipped.every(item => /玩家角色/.test(item.reason)));
});

test('凭空拆出来的人物名被拦下', () => {
    const { people, skipped } = normalizeImportedPeople({
        people: [{ name: '苏晚晴', source_uids: ['12'], identity_anchor: '性别：Female' }],
    }, [nanfeng]);
    assert.equal(people.length, 0);
    assert.match(skipped[0].reason, /找不到/);
});

test('一条条目里的多个人物会拆成多个 NPC', () => {
    const pair = {
        uid: '20',
        name: '双人组',
        content: '南枫：琴行老板，言辞犀利。\n黄语情：南枫的下属，说话软软的。',
    };
    const { people } = normalizeImportedPeople({
        people: [
            { name: '南枫', source_uids: ['20'], identity_anchor: '琴行老板', personality_anchor: '言辞犀利' },
            { name: '黄语情', source_uids: ['20'], identity_anchor: '南枫的下属', speaking_style: '说话软软的' },
        ],
    }, [pair]);
    assert.deepEqual(people.map(person => person.name), ['南枫', '黄语情']);
    assert.equal(people[1].values.speakingStyle, '说话软软的');
});

test('来源有交集的同名人物合并且不重复堆叠', () => {
    const merged = mergeImportedDrafts([
        {
            name: '南枫',
            sourceUids: ['12'],
            values: { identityAnchor: '琴行老板', personalityAnchor: '言辞犀利' },
            review: [],
            dropped: [],
            lengthFuse: false,
        },
        {
            name: '南枫',
            sourceUids: ['12', '31'],
            values: { identityAnchor: '琴行老板；前乐队主唱', backgroundProfile: '与家庭关系疏离' },
            review: [{ field: 'backgroundProfile', label: '背景与关系', coverage: 0.7 }],
            dropped: [],
            lengthFuse: false,
        },
    ]);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].sourceUids, ['12', '31']);
    assert.equal(merged[0].values.identityAnchor, '琴行老板；前乐队主唱');
    assert.equal(merged[0].values.personalityAnchor, '言辞犀利');
    assert.equal(merged[0].values.backgroundProfile, '与家庭关系疏离');
    assert.equal(merged[0].review.length, 1);
    assert.equal(merged[0].nameConflict, false);
});

test('来源互不相干的同名不合并，各自保留并标成撞名', () => {
    const merged = mergeImportedDrafts([
        { name: '老板', sourceUids: ['12'], values: { identityAnchor: '琴行老板' } },
        { name: '老板', sourceUids: ['77'], values: { identityAnchor: '面馆老板' } },
    ]);
    assert.equal(merged.length, 2, '不同来源的同名不能被静默并成一个人');
    assert.ok(merged.every(item => item.nameConflict === true));
    assert.deepEqual(merged.map(item => item.values.identityAnchor), ['琴行老板', '面馆老板']);
});

test('模型自造的前缀不能当成通行证夹带断言', () => {
    const entry = { uid: '12', name: '南枫', content: 'name: 南枫\nage: 32\nheight: 170cm' };
    const { people } = normalizeImportedPeople({
        people: [{
            name: '南枫',
            source_uids: ['12'],
            // 「恋人」不是字段名。剥掉前缀后剩下的「南枫」确实在原文里，
            // 但「恋人」这个断言原文根本没有。
            identity_anchor: '恋人：南枫；身高：170cm',
        }],
    }, [entry]);
    assert.equal(people.length, 1);
    assert.equal(people[0].values.identityAnchor, '身高：170cm', '白名单字段名前缀仍然放行');
    assert.deepEqual(people[0].dropped.map(item => item.text), ['恋人：南枫']);
});

test('短片段必须整串在原文里出现，不接受零散拼凑', () => {
    const source = '南枫是琴行老板，性格高冷。';
    assert.equal(groundingCoverage('琴行老板', source), 1);
    assert.equal(groundingCoverage('老板琴行', source), 0, '重排过的短片段不是搬运');
    assert.equal(groundingCoverage('南枫高冷', source), 0, '跨句拼出来的短片段不算命中');
});

test('source_uids 失效时按人物名定位来源，不拿整批兜底', () => {
    const batch = [
        { uid: '1', name: '南枫', content: 'name: 南枫\n愤世嫉俗，厌恶虚伪与崇洋媚外' },
        { uid: '2', name: '黄语情', content: 'name: 黄语情\n说话软软的，做事细致周到' },
    ];
    // uid 是假的，且这段设定其实是黄语情的。旧实现会拿整批当来源，让它蒙混过关。
    const { people, skipped } = normalizeImportedPeople({
        people: [{
            name: '南枫',
            source_uids: ['999'],
            personality_anchor: '说话软软的，做事细致周到',
        }],
    }, batch);
    assert.equal(people.length, 0, 'A 人物不能套用同批 B 人物的原文');
    assert.deepEqual(skipped[0].sourceUids, ['1'], '来源应定位到写着「南枫」的那条');
    assert.match(skipped[0].reason, /原文回查/);
});

test('人物名在整批里都定位不到时直接拦下', () => {
    const batch = [{ uid: '1', name: '南枫', content: 'name: 南枫\nage: 32' }];
    const { people, skipped } = normalizeImportedPeople({
        people: [{ name: '苏晚晴', identity_anchor: 'age: 32' }],
    }, batch);
    assert.equal(people.length, 0);
    assert.match(skipped[0].reason, /定位不到出处/);
});

test('同一条目拆出的多个人物拿到互不相同的身份标识', () => {
    const entry = { uid: '7', name: '城堡仆从', content: '塞巴斯：管家。玛莎：厨娘。艾伦：马夫。' };
    const writes = planImportWrites([
        { name: '塞巴斯', sourceUids: ['7'], values: { identityAnchor: '管家' } },
        { name: '玛莎', sourceUids: ['7'], values: { identityAnchor: '厨娘' } },
        { name: '艾伦', sourceUids: ['7'], values: { identityAnchor: '马夫' } },
    ], [entry], { bookName: '瓦伦希尔' });

    const references = writes.map(write => write.reference);
    assert.equal(new Set(references).size, 3, '三个人物必须拿到三个不同的 reference');
    assert.ok(references.every(reference => reference.startsWith('瓦伦希尔::7::')));
    // 条目名此时不能当别名，否则三个人会一起去认领同一条旧记录。
    assert.deepEqual(writes.map(write => write.aliases), [[], [], []]);
    assert.ok(writes.every(write => write.sourceContent.includes('塞巴斯：管家')));
});

test('条目只产出一个人物时才把条目名当别名', () => {
    const entry = { uid: '9', name: '南枫 nicknames: [枫姐] version: 4', content: 'name: 南枫\nage: 32' };
    const [write] = planImportWrites(
        [{ name: '南枫', sourceUids: ['9'], values: { identityAnchor: '年龄：32' } }],
        [entry],
        { bookName: '灵汐塔' },
    );
    assert.deepEqual(write.aliases, ['南枫 nicknames: [枫姐] version: 4']);
    assert.equal(write.reference, '灵汐塔::9::南枫');
});

test('勾了却没产出人物的条目一定会带原因出现在报告里', () => {
    const entries = [
        { uid: '1', name: '南枫' },
        { uid: '2', name: 'USER 玩家设定' },
        { uid: '3', name: '王国编年史' },
        { uid: '4', name: '断线的一条' },
    ];
    const untouched = summarizeUntouchedEntries(entries, {
        people: [{ name: '南枫', sourceUids: ['1'] }],
        skipped: [{ name: '{{user}}', sourceUids: ['2'], reason: '看起来是玩家角色，按规则不建立后台 NPC' }],
        failedUids: ['4'],
    });

    assert.deepEqual(untouched.map(item => item.uid), ['2', '3', '4']);
    assert.match(untouched[0].reason, /玩家角色/);
    assert.match(untouched[1].reason, /没有从这条条目里整理出人物/);
    assert.match(untouched[2].reason, /批次没跑成功/);
});

test('被跳过的人物带着来源 uid，能回指到具体条目', () => {
    const entry = { uid: '2', name: 'USER', content: '{{user}}：一位年轻的领主。' };
    const { people, skipped } = normalizeImportedPeople({
        people: [{ name: '{{user}}', source_uids: ['2'], identity_anchor: '一位年轻的领主' }],
    }, [entry]);
    assert.equal(people.length, 0);
    assert.deepEqual(skipped[0].sourceUids, ['2']);
    assert.deepEqual(summarizeUntouchedEntries([entry], { people, skipped }).map(item => item.uid), ['2']);
});

test('原文覆盖率能区分搬运与改写', () => {
    const source = '愤世嫉俗，厌恶虚伪与崇洋媚外，追求精神与文化的深度共鸣';
    assert.ok(groundingCoverage('厌恶虚伪与崇洋媚外', source) >= IMPORT_PASS_COVERAGE);
    assert.ok(groundingCoverage('她对世界抱有一种疲惫的敌意', source) < 0.6);
    assert.equal(groundingCoverage('', source), 1);
});

test('超长条目切成带重叠的片段，不直接截断', () => {
    const long = { uid: '5', name: '王国志', content: 'A'.repeat(7000) };
    const chunks = splitLongEntries([long], { maxChars: 3000, overlap: 300 });

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.uid === '5'), '片段共享 uid，才能在合并时拼回同一个人');
    assert.ok(chunks.every(chunk => chunk.content.length <= 3000));
    assert.deepEqual(chunks.map(chunk => chunk.chunk), [1, 2, 3]);
    assert.ok(chunks.every(chunk => chunk.chunkTotal === 3));
    // 覆盖到最后一个字符，中间有重叠，边界上的设定不会被切没。
    assert.equal(chunks.at(-1).content.at(-1), 'A');
    const covered = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    assert.ok(covered > 7000, '有重叠，总长应大于原文');

    const short = { uid: '6', content: 'B'.repeat(100) };
    assert.deepEqual(splitLongEntries([short]), [short], '短条目原样通过，不加 chunk 标记');
});

test('分块后的片段会告诉模型这只是片段', () => {
    const chunks = splitLongEntries([{ uid: '5', name: '王国志', content: 'A'.repeat(7000) }]);
    const prompt = buildWorldbookImportPrompt([chunks[1]]);
    assert.match(prompt, /"fragment":"这是该条目的第 2\/3 段/);
});

test('批次按条数与字数双重上限切分', () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
        uid: String(index),
        name: `条目${index}`,
        content: 'x'.repeat(1000),
    }));
    const batches = planWorldbookImportBatches(entries);
    assert.deepEqual(batches.map(batch => batch.length), [3, 3, 1]);

    const huge = [
        { uid: 'a', content: 'x'.repeat(5000) },
        { uid: 'b', content: 'x'.repeat(4000) },
    ];
    assert.deepEqual(planWorldbookImportBatches(huge).map(batch => batch.length), [1, 1]);
    assert.deepEqual(planWorldbookImportBatches([]), []);
});

test('提示词带上条目 uid、栏位定义与禁止延伸的铁律', () => {
    const prompt = buildWorldbookImportPrompt([nanfeng], { userName: '林澈' });
    assert.match(prompt, /"uid":"12"/);
    assert.match(prompt, /禁止推断与延伸/);
    assert.match(prompt, /宁可留空/);
    assert.match(prompt, /identity_anchor/);
    assert.match(prompt, /林澈/);
    assert.throws(() => buildWorldbookImportPrompt([]), /没有可整理/);
});
