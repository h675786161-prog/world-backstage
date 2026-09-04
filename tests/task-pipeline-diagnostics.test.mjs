import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../ui.js', import.meta.url), 'utf8');

test('simulation diagnostics distinguish response, parsing, validation and commit', () => {
    for (const field of [
        'responseOutcome',
        'parseOutcome',
        'validationOutcome',
        'commitOutcome',
        'responseCharacters',
        'attemptHistory',
    ]) {
        assert.match(source, new RegExp(`\\b${field}\\b`));
    }
    assert.match(source, /outcomeScope:\s*'response'/);
    assert.match(source, /GENERATION_TIMEOUT'[\s\S]*?'timeout'/);
});

test('world simulation does not retry deterministic client failures', () => {
    assert.match(source, /status >= 400 && status < 500/);
    assert.match(source, /\[408, 409, 425, 429\]/);
    assert.match(source, /authorization.*quota-exhausted/s);
});

test('every simulation exit records a terminal pipeline result', () => {
    for (const phase of ['success', 'error', 'cancelled', 'superseded']) {
        assert.match(source, new RegExp(`finishTaskTrace\\('${phase}'`));
    }
});

test('current Tavern generation is included in the physical request timeline', () => {
    assert.match(source, /return await runInConnectionLane\(taskKind, requestSignal/);
});

test('shareable diagnostics expose configuration shape without secret values', () => {
    for (const field of [
        'defaultIndependentConfiguration',
        'savedIndependentProfiles',
        'apiKeyPresent',
        'lengthRange',
        'leadingOrTrailingWhitespace',
        'moduleRoutes',
        'missingField',
        'messageCharacters',
        'dataHealth',
        'serializedCharacters',
        'narrativeSync',
        'moduleStatus',
        'timingsMs',
        'settingsPersistence',
        'consistencyConflictLedger',
        'installationDiagnostics',
        'requestShape',
        'secretsRedacted',
        'privacyLevel',
    ]) {
        assert.match(source, new RegExp(`\\b${field}\\b`));
    }
    assert.match(source, /profile names and identifiers/);
    assert.match(source, /API keys and authorization headers/);
    assert.doesNotMatch(source, /safeToShare:\s*true/);
    assert.match(source, /\['simulation', 'person-observation', 'history', 'public-opinion'\]/);
    assert.match(source, /terminalError[\s\S]*?: 'none'/);
    assert.match(source, /await refreshInstallationDiagnostics\(\)/);
    assert.match(source, /runtime\.lastTaskTrace\?\.request \|\| runtime\.lastRequestShape/);
});

test('independent model selection cannot masquerade as an applied setting', () => {
    assert.match(uiSource, /保存默认独立接口并生效/);
    assert.match(uiSource, /模型已选但尚未保存/);
    assert.match(uiSource, /getDiagnosticDraftStatus/);
});
