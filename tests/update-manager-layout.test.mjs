import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(path.join(root, 'update-manager.js'), 'utf8');

test('update control lives in header actions and never consumes brand-line width', () => {
    assert.match(source, /querySelector\('#world-backstage-root \.wb-header-actions'\)/);
    assert.doesNotMatch(source, /querySelector\('#world-backstage-root \.wb-brand-line'\)/);
    assert.match(source, /button\.className = `wb-round-action \$\{CONTROL_CLASS\}`/);
    assert.match(source, /actions\.insertBefore\(button, collapse \|\| null\)/);
});

test('update control stays icon-sized while update availability is communicated without label growth', () => {
    assert.match(source, /wb-update-control-glyph/);
    assert.match(source, /is-update-available::after/);
    assert.match(source, /setAttribute\('aria-label', nextLabel\)/);
    assert.doesNotMatch(source, /button\.textContent = '检查更新'/);
    assert.doesNotMatch(source, /有更新 · 检查/);
});
