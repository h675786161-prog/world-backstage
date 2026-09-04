import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    RETURN_RECHECK_INTERVAL_MS,
    SESSION_RECHECK_DELAY_MS,
    shouldForceSessionRecheck,
    shouldRecheckAfterReturn,
} from '../update-session-refresh.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('test repository performs one real update check on each fresh Tavern session', () => {
    assert.equal(SESSION_RECHECK_DELAY_MS, 6500);
    assert.equal(shouldForceSessionRecheck(0, 0), true);
    assert.equal(shouldForceSessionRecheck(1234, 1234), true);
    assert.equal(shouldForceSessionRecheck(1234, 5678), false);
});

test('returning to Tavern rechecks only after a short quiet interval', () => {
    assert.equal(RETURN_RECHECK_INTERVAL_MS, 5 * 60 * 1000);
    assert.equal(shouldRecheckAfterReturn(0, 999999), false);
    assert.equal(shouldRecheckAfterReturn(1000, 1000 + RETURN_RECHECK_INTERVAL_MS - 1), false);
    assert.equal(shouldRecheckAfterReturn(1000, 1000 + RETURN_RECHECK_INTERVAL_MS), true);
});

test('bootstrap loads the updater first, then the session refresh guard with cache busting', () => {
    const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
    assert.match(bootstrap, /import\('\.\/update-manager\.js\?v=2'\)/);
    assert.match(bootstrap, /\.then\(\(\) => import\('\.\/update-session-refresh\.js\?v=1'\)\)/);
});
