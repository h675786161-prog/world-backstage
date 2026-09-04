import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const promptBridgeSource = await readFile(new URL('../prompt-bridge.js', import.meta.url), 'utf8');

// SillyTavern release branch contract pinned for the lab runtime:
// 1.18.0 release @ 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8
// public/scripts/st-context.js exposes ConnectionManagerRequestService,
// extensionSettings, eventSource/eventTypes, generateRaw, generateQuietPrompt,
// stopGeneration and the other extension-facing APIs used here.

test('lab: saved Tavern profiles use the 1.18.0 ConnectionManagerRequestService contract', () => {
    assert.match(indexSource, /ConnectionManagerRequestService/);
    assert.match(indexSource, /service\.sendRequest\(/);
    assert.match(indexSource, /profileId,/);
    assert.match(indexSource, /messages,/);
    assert.match(indexSource, /includePreset:\s*false/);
    assert.match(indexSource, /includeInstruct:\s*true/);
    assert.match(indexSource, /extractData:\s*true/);
    assert.match(indexSource, /stream:\s*false/);
});

test('lab: plugin reads connection profiles through SillyTavern extensionSettings instead of copying secrets', () => {
    assert.match(indexSource, /extensionSettings\?\.connectionManager\?\.profiles/);
    assert.match(indexSource, /tavernApiProfileId/);
    const listingStart = indexSource.indexOf('function listTavernConnectionProfiles');
    const listingEnd = indexSource.indexOf('function tavernProfileRoute', listingStart);
    assert.ok(listingStart >= 0 && listingEnd > listingStart);
    const listing = indexSource.slice(listingStart, listingEnd);
    assert.doesNotMatch(listing, /secret-id|proxy_password|customApiKey/);
});

test('lab: background prompt bridge stays on independent extension generation paths', () => {
    assert.match(promptBridgeSource, /buildBackstageMessages/);
    assert.doesNotMatch(promptBridgeSource, /chat\.push|characters\[.*\]\.chat/);
});
