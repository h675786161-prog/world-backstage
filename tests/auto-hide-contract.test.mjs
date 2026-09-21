import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const uiSource = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

test('auto-hide requires memory collection and memory injection', () => {
    assert.match(
        indexSource,
        /!settings\.memorySystemEnabled[\s\S]*?!settings\.injectionMemory[\s\S]*?!settings\.autoHideArchivedFloors/,
    );
});

test('turning off an auto-hide dependency restores owned hidden floors', () => {
    assert.match(indexSource, /payload\.enabled === false/);
    assert.match(indexSource, /payload\.memorySystemEnabled === false/);
    assert.match(indexSource, /payload\.injectionMemory === false/);
    assert.match(indexSource, /payload\.autoHideArchivedFloors === false/);
    assert.match(
        indexSource,
        /autoHideDependencyDisabled[\s\S]*?restoreAutoHiddenFloors\(\{ quiet: true \}\)/,
    );
});

test('manual restore first disables auto-hide and never claims manual hides', () => {
    assert.match(
        indexSource,
        /action === 'restore-auto-hidden-floors'[\s\S]*?autoHideArchivedFloors: false/,
    );
    assert.match(uiSource, /不会碰你手动 \/hide 的内容/);
});

test('auto-hide UI explains the five-floor buffer and memory-injection dependency', () => {
    assert.match(uiSource, /固定留最近 5 层缓冲/);
    assert.match(uiSource, /长期记忆注入关闭时不会工作/);
});
