import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../bootstrap.js', import.meta.url), 'utf8');
const orb = await readFile(new URL('../orb-motion-randomizer.js', import.meta.url), 'utf8');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');

test('lab: bootstrap has one adaptive social owner and no legacy mobile social race', () => {
    assert.doesNotMatch(bootstrap, /import ['"]\.\/mobile-social-fix\.js['"]/);
    assert.match(bootstrap, /social-responsive-adapter\.js\?v=1/);
});

test('lab: orb uses the current cache-busted living-motion module', () => {
    assert.match(bootstrap, /orb-motion-randomizer\.js\?v=8/);
    assert.match(orb, /wb-orb-organic-motion-v8/);
});

test('lab: orb remains the native SillyTavern-side visual instead of growing a replacement globe', () => {
    assert.doesNotMatch(orb, /className\s*=\s*['"]wb-orb-globe['"]/);
    assert.doesNotMatch(orb, /innerHTML\s*=.*wb-orb-continent/s);
    assert.match(style, /\.wb-world-orb\s*\{/);
    assert.match(style, /\.wb-orb-ring\.ring-one/);
    assert.match(style, /\.wb-orb-ring\.ring-two/);
});

test('lab: living orb motion is continuous and not gated by simulation state', () => {
    assert.match(orb, /requestAnimationFrame\(frame\)/);
    assert.doesNotMatch(orb, /classList\.contains\(['"]is-processing['"]\)/);
    assert.doesNotMatch(orb, /\.wb-world-orb\.is-processing\s+\.wb-orb-ring/);
});

test('lab: reduced-motion preference does not create a second visual structure', () => {
    assert.match(orb, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(orb, /wb-orb-clouds|wb-orb-continent|wb-orb-shadow|wb-orb-glimmer/);
});
