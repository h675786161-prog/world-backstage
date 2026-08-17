import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('social instant reply and manual cat delivery stay wired', async () => {
    const [index, ui] = await Promise.all([
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../ui.js', import.meta.url), 'utf8'),
    ]);

    assert.match(index, /socialInstantReply:\s*true/);
    assert.match(index, /async function sendSocialMessage\(conversationId, messageText, \{ requestOnly = false \} = \{\}\)/);
    assert.match(index, /getSettings\(\)\.socialInstantReply === false/);
    assert.match(index, /waitingForManualReply:\s*true/);
    assert.match(index, /action === 'social-request-reply'/);
    assert.match(index, /requestOnly:\s*true/);

    assert.match(ui, /data-wb-setting="socialInstantReply"/);
    assert.match(ui, />及时回复</);
    assert.match(ui, /data-wb-action="social-request-reply"/);
    assert.match(ui, /小猫传递/);
});
