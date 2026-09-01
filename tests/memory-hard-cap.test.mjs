import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, trimState } from '../core.js';

test('memory fact pool stays bounded while preserving locked manual anchors', () => {
    const state = createInitialState();
    state.storyMemory.facts.push({
        id: 'manual-fact-anchor-cap',
        key: 'manual:fact:anchor-cap',
        subject: '守门人',
        predicate: '不可丢失事实',
        value: '左眼失明',
        status: 'active',
        confidence: 'high',
        importance: 3,
        visibility: 'known',
        locked: true,
        manual: true,
    });
    for (let index = 0; index < 900; index += 1) {
        state.storyMemory.facts.push({
            id: `cap-fact-${index}`,
            key: `cap:fact:${index}`,
            subject: `背景${index}`,
            predicate: '普通事实',
            value: `普通值${index}`,
            status: 'active',
            confidence: 'medium',
            importance: index % 90 === 0 ? 3 : 1,
            visibility: 'known',
            updatedAt: index,
        });
    }
    const trimmed = trimState(state);
    assert.equal(trimmed.storyMemory.facts.length <= 720, true);
    assert.equal(trimmed.storyMemory.facts.some(item => item.id === 'manual-fact-anchor-cap'), true);
});

test('active clue pool stays bounded while preserving locked manual clues', () => {
    const state = createInitialState();
    state.storyMemory.clues.push({
        id: 'manual-clue-anchor-cap',
        title: '手动锁定伏笔',
        text: '这条伏笔不能被普通容量压力挤掉。',
        status: 'open',
        importance: 3,
        locked: true,
        manual: true,
    });
    for (let index = 0; index < 650; index += 1) {
        state.storyMemory.clues.push({
            id: `cap-clue-${index}`,
            title: `普通伏笔${index}`,
            text: `普通伏笔内容${index}`,
            status: 'open',
            importance: index % 100 === 0 ? 3 : 1,
            updatedAt: index,
        });
    }
    const trimmed = trimState(state);
    assert.equal(trimmed.storyMemory.clues.length <= 480, true);
    assert.equal(trimmed.storyMemory.clues.some(item => item.id === 'manual-clue-anchor-cap'), true);
});
