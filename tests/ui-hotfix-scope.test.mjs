import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ui-hotfix.js', import.meta.url), 'utf8');

test('UI hotfix observes only the World Backstage root after startup', () => {
    assert.match(source, /document\.getElementById\('world-backstage-root'\)/);
    assert.match(source, /new MutationObserver\(scheduleRepair\)/);
    assert.match(source, /repairObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
    assert.doesNotMatch(source, /observe\(document\.(?:documentElement|body)/);
    assert.doesNotMatch(source, /setInterval\(/);
});

test('UI hotfix keeps first-click and IME guards without whole-document repair scans', () => {
    assert.match(source, /document\.addEventListener\('click', onClickCapture, true\)/);
    assert.match(source, /document\.addEventListener\('compositionstart', onCompositionStart, true\)/);
    assert.match(source, /document\.addEventListener\('compositionend', onCompositionEnd, true\)/);
    assert.match(source, /document\.addEventListener\('input', onInputCapture, true\)/);
    assert.match(source, /repairWorldTimeButtons\(root\)/);
    assert.match(source, /repairAutoTruncationMessage\(root\)/);
});
