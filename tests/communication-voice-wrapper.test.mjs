import assert from 'node:assert/strict';
import test from 'node:test';

const VOICE_KEY = Symbol.for('world_backstage.communication_voice_guard.v1');
const ECOLOGY_KEY = Symbol.for('world_backstage.communication_ecology.v1');

function makeStore() {
    return {
        currentState: {
            people: [
                {
                    id: 'aqing',
                    name: '阿青',
                    personalityAnchor: '安静。',
                    speakingStyle: '短句。',
                },
            ],
        },
        social: {
            connections: [{ personId: 'aqing', status: 'accepted' }],
            conversations: [],
        },
    };
}

test('voice guard inherits an existing ecology marker and stays stable across repeated getContext calls', async () => {
    const originalTavern = globalThis.SillyTavern;
    const originalFetch = globalThis.fetch;
    const calls = [];
    const ecologyWrappedRaw = async options => {
        calls.push(options);
        return options;
    };
    Object.defineProperty(ecologyWrappedRaw, ECOLOGY_KEY, { value: true, enumerable: false });

    const context = {
        chatMetadata: { world_backstage_v1: makeStore() },
        generateRaw: ecologyWrappedRaw,
    };
    globalThis.SillyTavern = { getContext: () => context };
    const ecologyWrappedFetch = async () => ({ ok: true });
    Object.defineProperty(ecologyWrappedFetch, ECOLOGY_KEY, { value: true, enumerable: false });
    globalThis.fetch = ecologyWrappedFetch;

    try {
        await import(`../communication-voice-guard.js?wrapper-test=${Date.now()}`);

        const first = globalThis.SillyTavern.getContext().generateRaw;
        const second = globalThis.SillyTavern.getContext().generateRaw;
        const third = globalThis.SillyTavern.getContext().generateRaw;

        assert.equal(first, second);
        assert.equal(second, third);
        assert.equal(Boolean(first[VOICE_KEY]), true);
        assert.equal(Boolean(first[ECOLOGY_KEY]), true);
        assert.equal(Boolean(globalThis.fetch[VOICE_KEY]), true);
        assert.equal(Boolean(globalThis.fetch[ECOLOGY_KEY]), true);

        const result = await third({ prompt: '世界背面·内置社交\n请判断阿青是否回复。' });
        assert.equal(calls.length, 1);
        const voiceTagCount = (String(result.prompt).match(/<world_backstage_character_voice>/g) || []).length;
        assert.equal(voiceTagCount, 1, 'repeated getContext calls must not multiply the voice instruction');
    } finally {
        globalThis.SillyTavern = originalTavern;
        globalThis.fetch = originalFetch;
    }
});
