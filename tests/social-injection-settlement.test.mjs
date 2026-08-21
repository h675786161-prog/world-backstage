import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    pendingSocialConversations,
    settleSocialConversations,
} from '../social-terminal.js';

const person = { id: 'lin', name: '林', isUser: false };
const state = { people: [person] };

function socialFixture() {
    return {
        connections: [{ personId: 'lin', status: 'accepted' }],
        conversations: [{
            id: 'chat-lin',
            type: 'direct',
            title: '林',
            memberIds: ['lin'],
            rawMessages: [
                { id: 'm1', senderId: 'user', senderName: '你', text: '明晚在车站见。' },
                { id: 'm2', senderId: 'lin', senderName: '林', text: '好，我会带上那封信。' },
                { id: 'm3', senderId: 'user', senderName: '你', text: '别让其他人知道。' },
            ],
        }],
    };
}

test('social injection keeps the complete unsettled suffix', () => {
    const pending = pendingSocialConversations(socialFixture(), state);
    assert.deepEqual(pending[0].messages.map(message => message.id), ['m1', 'm2', 'm3']);

    const settled = settleSocialConversations(socialFixture(), state, [{
        conversation_id: 'chat-lin',
        through_message_id: 'm2',
        evidence: '林已经带着信到了车站。',
    }], '夜色里，林已经带着信到了车站。');
    const remaining = pendingSocialConversations(settled, state);
    assert.deepEqual(remaining[0].messages.map(message => message.id), ['m3']);
});

test('social settlement rejects missing narrative evidence', () => {
    const unchanged = settleSocialConversations(socialFixture(), state, [{
        conversation_id: 'chat-lin',
        through_message_id: 'm3',
        evidence: '正文里不存在的句子',
    }], '林站在车站外。');
    assert.deepEqual(
        pendingSocialConversations(unchanged, state)[0].messages.map(message => message.id),
        ['m1', 'm2', 'm3'],
    );
});

test('main social injection obeys the master switch and no longer tail-slices messages', async () => {
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(indexSource, /settings\.worldPromptInjection === false \|\| settings\.injectionSocial !== true/);
    assert.match(indexSource, /pendingSocialConversations\(social \|\| emptySocialState\(\), state\)/);
    assert.doesNotMatch(indexSource, /conversation\.rawMessages\.slice\(-6\)/);
});
