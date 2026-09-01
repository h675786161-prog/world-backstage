import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adaptCommunicationVoicePayload,
  buildCommunicationVoiceInstruction,
  selectCommunicationVoiceProfiles,
} from '../communication-voice-guard.js';

function makeLargeFixture() {
  const people = [{
    id: 'user-ling', name: '玲', isUser: true,
    identityAnchor: '成年女性。',
  }];
  const conversations = [];
  const connections = [];
  const moments = [];

  for (let i = 0; i < 160; i += 1) {
    const id = `person-${i}`;
    const name = `人物${i}`;
    people.push({
      id,
      name,
      identityAnchor: `身份锚点-${i}`,
      personalityAnchor: `人格锚点-${i}-` + '安静但有自己的判断。'.repeat(8),
      backgroundProfile: `背景-${i}-` + '有独立生活与关系历史。'.repeat(10),
      speakingStyle: `说话风格-${i}-短句，保留个人措辞。`,
      behaviorBoundaries: `边界-${i}-不为界面强行营业。`,
    });
    connections.push({ personId: id, status: 'accepted', evidence: `关系证据-${i}` });
    conversations.push({
      id: `chat-${i}`,
      type: 'direct',
      memberIds: [id],
      rawMessages: Array.from({ length: 24 }, (_, j) => ({
        senderId: j % 2 === 0 ? id : 'user-ling',
        text: `历史消息 ${i}-${j} ` + 'x'.repeat(80),
        worldMinute: i * 100 + j,
      })),
    });
    moments.push({ personId: id, text: `公开动态 ${i} ` + 'y'.repeat(120), worldMinute: i * 100 + 50 });
  }

  const state = { people };
  const store = { currentState: state, social: { connections, conversations, moments } };
  const context = { chatMetadata: { world_backstage_v1: store } };
  return { state, store, context };
}

function countVoiceBlocks(text) {
  return (String(text || '').match(/<world_backstage_character_voice>/g) || []).length;
}

test('stress: 160-person roster still selects only prompt-relevant profiles and stays bounded', () => {
  const { state, store } = makeLargeFixture();
  const prompt = '世界背面·内置社交\n候选人物：人物37 (person-37)、人物88 (person-88)';
  const started = performance.now();
  for (let i = 0; i < 300; i += 1) {
    const profiles = selectCommunicationVoiceProfiles(store, state, prompt);
    assert.deepEqual(profiles.map(item => item.id), ['person-37', 'person-88']);
    assert.ok(profiles.every(item => item.voice_samples.length <= 5));
    const instruction = buildCommunicationVoiceInstruction(store, state, prompt);
    assert.ok(instruction.length < 20_000, `instruction unexpectedly large: ${instruction.length}`);
    assert.match(instruction, /人物37/);
    assert.match(instruction, /人物88/);
    assert.doesNotMatch(instruction, /"name":"人物159"/);
  }
  console.log(JSON.stringify({ kind: 'communication-voice-roster-stress', people: 160, rounds: 300, elapsedMs: performance.now() - started }));
});

test('stress: repeated payload adaptation is idempotent and cannot accumulate voice blocks', () => {
  const { context } = makeLargeFixture();
  let payload = {
    messages: [
      { role: 'system', content: '世界背面·内置社交：请判断人物37是否回复。' },
      { role: 'user', content: '人物37' },
    ],
  };

  const started = performance.now();
  for (let i = 0; i < 100; i += 1) {
    payload = adaptCommunicationVoicePayload(payload, context);
    assert.equal(countVoiceBlocks(payload.messages[0]?.content), 1, `voice block duplicated at round ${i}`);
    assert.ok(String(payload.messages[0]?.content || '').length < 20_000, 'adapted system prompt grew without bound');
  }
  console.log(JSON.stringify({ kind: 'communication-voice-idempotence-stress', rounds: 100, elapsedMs: performance.now() - started }));
});
