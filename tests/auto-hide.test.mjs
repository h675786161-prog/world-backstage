import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTO_HIDE_KEEP_RECENT_MESSAGES,
    AUTO_HIDDEN_MESSAGE_KEY,
    autoHideCandidateMessageIds,
    autoHideThroughMessageId,
    autoHiddenMessageIds,
} from '../auto-hide.js';

test('keeps the newest five indexed messages visible', () => {
    assert.equal(AUTO_HIDE_KEEP_RECENT_MESSAGES, 5);
    assert.equal(autoHideThroughMessageId(12, 11), 6);
    assert.deepEqual(
        autoHideCandidateMessageIds(Array.from({ length: 12 }, () => ({})), 11),
        [0, 1, 2, 3, 4, 5, 6],
    );
});

test('never hides messages newer than the memory cursor', () => {
    const chat = Array.from({ length: 20 }, () => ({}));
    assert.deepEqual(autoHideCandidateMessageIds(chat, 9), [0, 1, 2, 3, 4]);
});

test('does nothing until more than five indexed messages are covered', () => {
    const chat = Array.from({ length: 9 }, () => ({}));
    assert.deepEqual(autoHideCandidateMessageIds(chat, 4), []);
    assert.equal(autoHideThroughMessageId(chat.length, -1), -6);
});

test('leaves already hidden/system messages alone', () => {
    const chat = Array.from({ length: 10 }, () => ({}));
    chat[1].is_system = true;
    chat[3].is_system = true;
    assert.deepEqual(autoHideCandidateMessageIds(chat, 9), [0, 2, 4]);
});

test('finds only messages owned by the auto-hide marker', () => {
    const chat = [
        { is_system: true },
        { is_system: true, extra: { [AUTO_HIDDEN_MESSAGE_KEY]: { version: 1 } } },
        { extra: { [AUTO_HIDDEN_MESSAGE_KEY]: true } },
        {},
    ];
    assert.deepEqual(autoHiddenMessageIds(chat), [1, 2]);
});
