import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_PROFILE_FIELDS, applyImportedCharacterValues, appendWorldbookProvenance, profilePromptText,
} from '../character-profiles.js';
import { applySimulationResult, buildPersonObservationPrompt, buildSimulationPrompt, createInitialState, trimState } from '../core.js';
import {
    detectWorldbookCharacter, extractWorldbookCharacterCandidates, extractWorldbookCharacterProfile,
    groupWorldbookPersonEntries, normalizeImportedPeople, mergeImportedDrafts,
    planImportWrites, planReviewedImportWrites, matchImportTarget,
} from '../worldbook.js';

test('long author profiles and complete worldbook source survive trim, reload, and simulation', () => {
    const state = createInitialState();
    const fields = Object.fromEntries(CHARACTER_PROFILE_FIELDS.map(field => [field.key, `${field.label}：${'完整资料。'.repeat(1500)}末尾限制。`]));
    state.people.push({ id: 'linzhou', name: '林舟', ...fields, worldbookRaw: '原文'.repeat(30000), manual: true });
    const normalized = trimState(JSON.parse(JSON.stringify(state)));
    for (const [key, value] of Object.entries(fields)) assert.equal(normalized.people[0][key], value, key);
    assert.equal(normalized.people[0].worldbookRaw, state.people[0].worldbookRaw);
    const changed = applySimulationResult(normalized, { elapsed_minutes: 0, people_upsert: [{ id: 'linzhou', name: '林舟', ability_profile: '无限制的全知全能', background_profile: '改写背景' }] });
    assert.equal(changed.people[0].abilityProfile, fields.abilityProfile);
    assert.equal(changed.people[0].backgroundProfile, fields.backgroundProfile);
});

test('prompt budgeting keeps long source stored and preserves trailing ability limitations', () => {
    const state = createInitialState();
    state.people.push({ id: 'lin', name: '林舟', abilityProfile: `可以短距离移动。${'原理说明。'.repeat(2000)}使用后失去听觉，不能穿过铁墙。`, source: 'manual' });
    const normalized = trimState(state);
    const stored = normalized.people[0].abilityProfile;
    for (const prompt of [buildSimulationPrompt(normalized), buildPersonObservationPrompt(normalized, normalized.people[0])]) {
        assert.match(prompt, /使用后失去听觉，不能穿过铁墙/);
        assert.match(prompt, /资料已节选/);
        assert.ok(prompt.length < 45000, 'long stored card does not flood a prompt');
    }
    assert.equal(normalized.people[0].abilityProfile, stored);
    assert.ok(profilePromptText(stored, 1200).length <= 1200);
});

test('rule parsing preserves a long field and ability conditions at the end of a source', () => {
    const background = `出身港口。${'旅途记载'.repeat(1600)}最后在北岸定居。`;
    const raw = `姓名：林舟\n背景：${background}\n能力：折叠空间，但不能穿过铁墙，每次会失去听觉。`;
    const profile = extractWorldbookCharacterProfile(raw);
    assert.equal(profile.backgroundProfile, background);
    assert.match(profile.abilityProfile, /不能穿过铁墙/);
    assert.equal(profile.worldbookRaw, raw);
});

test('repeated XML blocks merge complementary fields instead of dropping later blocks', () => {
    const candidates = extractWorldbookCharacterCandidates({ name: '人物集', content: '<character name="林舟">外貌：黑发。性格：谨慎。</character>\n<character name="林舟">背景：来自北岸。能力：折叠空间，代价是失去听觉。</character>' });
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].profile.appearanceProfile, /黑发/);
    assert.match(candidates[0].profile.backgroundProfile, /来自北岸/);
    assert.match(candidates[0].profile.abilityProfile, /失去听觉/);
    assert.match(candidates[0].content, /来自北岸/);
});

test('section-title entries with the confirmed person key form one complete card', () => {
    const grouped = groupWorldbookPersonEntries([
        { uid: '1', name: '林舟-外貌', keys: ['林舟'], content: '外貌：黑发。' },
        { uid: '2', name: '林舟-经历', keys: ['林舟'], content: '背景：来自北岸。' },
        { uid: '3', name: '林舟-能力', keys: ['林舟'], content: '能力：折叠空间，不能穿墙。' },
    ]);
    assert.ok(detectWorldbookCharacter({ name: '林舟-外貌', keys: ['林舟'], content: '外貌：黑发。' }).likelyPerson);
    assert.ok(detectWorldbookCharacter({ name: '林舟-能力', keys: ['林舟'], content: '能力：折叠空间，不能穿墙。' }).likelyPerson);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].profile.name, '林舟');
    assert.match(grouped[0].profile.appearanceProfile, /黑发/);
    assert.match(grouped[0].profile.backgroundProfile, /北岸/);
    assert.match(grouped[0].profile.abilityProfile, /不能穿墙/);
    assert.equal(grouped[0].members.length, 3);
    assert.equal(groupWorldbookPersonEntries([{ uid: 'a', name: '老板', content: '身份：面馆老板' }, { uid: 'b', name: '老板', content: '身份：琴行老板' }]).length, 2, 'names alone do not join source records');
});

test('verified AI fragments merge beyond old field limits without dropping late ability costs', () => {
    const first = '早年经历。'.repeat(210);
    const last = '后来迁居北岸，使用能力会暂时失去听觉。';
    const a = normalizeImportedPeople({ people: [{ name: '林舟', source_uids: ['1'], background_profile: first }] }, [{ uid: '1', name: '林舟', content: first }]);
    const b = normalizeImportedPeople({ people: [{ name: '林舟', source_uids: ['1'], background_profile: last, ability_profile: '使用能力会暂时失去听觉' }] }, [{ uid: '1', name: '林舟', content: last }]);
    const [merged] = mergeImportedDrafts([...a.people, ...b.people]);
    assert.ok(merged.values.backgroundProfile.length > 900);
    assert.match(merged.values.backgroundProfile, /后来迁居北岸/);
    assert.match(merged.values.abilityProfile, /失去听觉/);
});

const draftPair = () => planImportWrites([
    { name: '林舟', sourceUids: ['1'], values: { appearanceProfile: '黑发' } },
    { name: '林舟', sourceUids: ['2'], values: { backgroundProfile: '来自北岸' } },
], [{ uid: '1', name: '外貌', content: '黑发' }, { uid: '2', name: '经历', content: '来自北岸' }], { bookName: '档案' });

test('review choices explicitly merge disjoint same-name sources with complete provenance', () => {
    const drafts = draftPair();
    const result = planReviewedImportWrites(drafts, [
        { reference: drafts[0].reference, fields: ['appearanceProfile'], target: 'new' },
        { reference: drafts[1].reference, fields: ['backgroundProfile'], target: `draft:${drafts[0].reference}` },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].values.appearanceProfile, '黑发');
    assert.equal(result[0].values.backgroundProfile, '来自北岸');
    assert.equal(result[0].sources.length, 2);
    assert.equal(result[0].createNew, true);
    assert.match(result[0].sourceContent, /黑发/);
    assert.match(result[0].sourceContent, /来自北岸/);
});

test('review cannot merge into an unchecked draft, form a cycle, or accept UI-supplied profile text', () => {
    const drafts = draftPair();
    assert.throws(() => planReviewedImportWrites(drafts, [{ reference: drafts[1].reference, fields: ['backgroundProfile'], target: `draft:${drafts[0].reference}` }]), /没有勾选/);
    assert.throws(() => planReviewedImportWrites(drafts, drafts.map((draft, i) => ({ reference: draft.reference, fields: Object.keys(draft.values), target: `draft:${drafts[1 - i].reference}` }))), /循环/);
    const result = planReviewedImportWrites(drafts, [{ reference: drafts[0].reference, fields: ['appearanceProfile', 'invented'], values: { appearanceProfile: '伪造' } }]);
    assert.equal(result[0].values.appearanceProfile, '黑发');
    assert.equal(result[0].values.invented, undefined);
});

test('re-import preserves complete source history and multiple references across serialization', () => {
    const person = { id: 'lin', name: '林舟', worldbookRef: 'old', worldbookRaw: '旧版原文', abilityProfile: '穿越后失去听觉', worldbookImportedValues: { abilityProfile: '穿越后失去听觉' } };
    const source = { reference: 'book::2', entryName: '能力', content: '新原文'.repeat(20000) };
    appendWorldbookProvenance(person, { reference: 'new', sources: [source], raw: source.content });
    appendWorldbookProvenance(person, { reference: 'new', sources: [source], raw: source.content });
    const state = createInitialState(); state.people.push(person);
    const normalized = trimState(JSON.parse(JSON.stringify(state))).people[0];
    assert.equal(normalized.worldbookSources.length, 1);
    assert.ok(normalized.worldbookRaw.startsWith('旧版原文'));
    assert.ok(normalized.worldbookRaw.endsWith(source.content));
    assert.deepEqual(normalized.worldbookRefs, ['old', 'new']);
    assert.equal(normalized.worldbookImportedValues.abilityProfile, '穿越后失去听觉');
    assert.equal(matchImportTarget([normalized], { reference: 'new', name: '改过名字' }).person.id, 'lin');
});

test('import preserves structured hand-written text and only extends untouched imported fields', () => {
    const authored = '姓名：林舟；性别：男；身份：记者；外貌：黑发；背景：作者自己维护的完整资料。';
    const person = { personalityAnchor: authored, backgroundProfile: '旧经历', worldbookImportedValues: { backgroundProfile: '旧经历' } };
    applyImportedCharacterValues(person, { personalityAnchor: '谨慎', backgroundProfile: '新经历', abilityProfile: '会短暂失去听觉' });
    assert.equal(person.personalityAnchor, authored);
    assert.match(person.backgroundProfile, /旧经历/);
    assert.match(person.backgroundProfile, /新经历/);
    assert.equal(person.abilityProfile, '会短暂失去听觉');
    person.backgroundProfile = '作者改写后的经历';
    applyImportedCharacterValues(person, { backgroundProfile: '又一份新经历' });
    assert.equal(person.backgroundProfile, '作者改写后的经历');
});
