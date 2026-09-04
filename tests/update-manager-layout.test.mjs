import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(path.join(root, 'update-manager.js'), 'utf8');

test('updater never injects a control into the world backstage header', () => {
    assert.doesNotMatch(source, /wb-update-check-control/);
    assert.doesNotMatch(source, /wb-update-control-glyph/);
    assert.doesNotMatch(source, /querySelector\('#world-backstage-root \.wb-header-actions'\)/);
    assert.doesNotMatch(source, /actions\.insertBefore\(/);
});

test('update discovery stays notification-driven without a DOM observer for header controls', () => {
    assert.match(source, /renderNotice\(\{ force: true \}\)/);
    assert.match(source, /data-wb-update-now/);
    assert.doesNotMatch(source, /new MutationObserver\(/);
    assert.doesNotMatch(source, /syncPanelControl|queuePanelSync/);
});
