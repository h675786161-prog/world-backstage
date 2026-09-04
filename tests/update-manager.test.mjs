import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    UPDATE_CHECK_INTERVAL_MS,
    checkForUpdates,
    extensionFolderFromUrl,
    requestExtensionUpdate,
    requestExtensionVersion,
    shouldAutoCheck,
} from '../update-manager.js';
import { PLUGIN_VERSION } from '../version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

test('test version stays aligned across runtime, manifest and package metadata', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(PLUGIN_VERSION, '2.5.7');
    assert.equal(manifest.version, PLUGIN_VERSION);
    assert.equal(pkg.version, PLUGIN_VERSION);
    assert.equal(manifest.auto_update, false, 'test builds may notify but must never silently self-update');
});

test('update cadence is daily and a fresh successful check is not repeated', () => {
    assert.equal(UPDATE_CHECK_INTERVAL_MS, 24 * 60 * 60 * 1000);
    assert.equal(shouldAutoCheck(0, 1000), true);
    assert.equal(shouldAutoCheck(1000, 1000 + UPDATE_CHECK_INTERVAL_MS - 1), false);
    assert.equal(shouldAutoCheck(1000, 1000 + UPDATE_CHECK_INTERVAL_MS), true);
});

test('extension folder is derived from its installed path instead of hard-coding the test repository name', () => {
    assert.equal(
        extensionFolderFromUrl('http://localhost/scripts/extensions/third-party/world-backstage-test/update-manager.js'),
        'world-backstage-test',
    );
    assert.equal(
        extensionFolderFromUrl('http://localhost/scripts/extensions/third-party/world-backstage/update-manager.js'),
        'world-backstage',
    );
});

test('version check and manual update use SillyTavern native extension endpoints', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return jsonResponse(url.endsWith('/version')
            ? { isUpToDate: false, currentBranchName: 'main', remoteUrl: 'git@example/repo.git' }
            : { isUpToDate: false, shortCommitHash: 'abcdef0' });
    };

    const version = await requestExtensionVersion('world-backstage-test', { fetchImpl });
    assert.equal(version.isUpToDate, false);
    const updated = await requestExtensionUpdate('world-backstage-test', { fetchImpl });
    assert.equal(updated.shortCommitHash, 'abcdef0');
    assert.deepEqual(calls.map(call => call.url), [
        '/api/extensions/version',
        '/api/extensions/update',
    ]);
    assert.deepEqual(calls.map(call => call.body), [
        { extensionName: 'world-backstage-test', global: false },
        { extensionName: 'world-backstage-test', global: false },
    ]);
});

test('checking for an available update never installs it implicitly', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        if (url === '/api/extensions/discover') return jsonResponse({}, 404);
        assert.equal(url, '/api/extensions/version');
        return jsonResponse({
            isUpToDate: false,
            currentBranchName: 'main',
            currentCommitHash: 'old',
            remoteUrl: 'https://github.com/example/world-backstage-test.git',
        });
    };

    const status = await checkForUpdates({ force: true, notify: false, fetchImpl, now: 123456 });
    assert.equal(status.updateAvailable, true);
    assert.equal(status.commitHash, 'old');
    assert.deepEqual(calls, ['/api/extensions/discover', '/api/extensions/version']);
    assert.equal(calls.includes('/api/extensions/update'), false);
});

test('global installation is discovered before the native version request', async () => {
    const installedName = extensionFolderFromUrl(import.meta.url.replace(/tests\/update-manager\.test\.mjs$/, 'update-manager.js'));
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
        if (url === '/api/extensions/discover') {
            return {
                ok: true,
                json: async () => [{ type: 'global', name: `third-party/${installedName}` }],
            };
        }
        return {
            ok: true,
            json: async () => ({
                currentBranchName: 'main',
                isUpToDate: true,
                remoteUrl: 'https://github.com/example/world-backstage-test.git',
            }),
        };
    };

    const status = await checkForUpdates({ force: true, fetchImpl, now: 654321 });

    assert.equal(calls[0].url, '/api/extensions/discover');
    assert.deepEqual(calls[1], {
        url: '/api/extensions/version',
        body: { extensionName: installedName, global: true },
    });
    assert.equal(calls.length, 2);
    assert.equal(status.isGlobal, true);
});
