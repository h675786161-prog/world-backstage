import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('settings defaults and persisted schema checkpoint stay on v31', () => {
    assert.match(source, /const DEFAULT_SETTINGS = Object\.freeze\(\{[\s\S]*?settingsVersion:\s*31,/);
    assert.match(source, /settings\.settingsVersion\s*=\s*31;/);
    assert.match(source, /if \(previousSettingsVersion < 31\) context\.saveSettingsDebounced\?\.\(\);/);
    assert.doesNotMatch(source, /settingsVersion:\s*30,/);
});

test('legacy settings gates remain explicit through the v31 migration chain', () => {
    for (const version of [9, 19, 22, 25, 26, 31]) {
        assert.match(source, new RegExp(`previousSettingsVersion < ${version}`));
    }
    assert.match(source, /settings\.worldPromptInjection\s*=\s*previous\?\.promptInjection !== false/);
    assert.match(source, /settings\.memoryPromptInjection\s*=\s*previous\?\.promptInjection !== false/);
    assert.match(source, /settings\.memoryPromptInjection\s*=\s*settings\.injectionMemory;/);
    assert.match(source, /settings\.worldAutoEnabled = previousSettingsVersion < 19/);
    assert.match(source, /settings\.recordPlayerCharacter = previousSettingsVersion < 25/);
    assert.match(source, /settings\.orbEnabled = previousSettingsVersion < 22/);
});

test('legacy manual simulation mode migrates without becoming a permanent second mode', () => {
    assert.match(source, /if \(settings\.autoSimulationMode === 'manual'\) \{[\s\S]*?settings\.worldAutoEnabled = false;[\s\S]*?settings\.autoSimulationMode = 'balanced';[\s\S]*?\}/);
});
