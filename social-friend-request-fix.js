const STATE_KEY = 'world_backstage_v1';
const PATCH_KEY = Symbol.for('world_backstage.social_friend_request_fix.v2');

function getContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

function getStore() {
    return getContext()?.chatMetadata?.[STATE_KEY] || null;
}

function clean(value, maximum = 600) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function socialConnections(store) {
    if (!store?.social || typeof store.social !== 'object') return [];
    if (!Array.isArray(store.social.connections)) store.social.connections = [];
    return store.social.connections;
}

function personById(store, personId) {
    return (Array.isArray(store?.currentState?.people) ? store.currentState.people : [])
        .find(person => String(person?.id || '') === String(personId || '') && !person?.isUser) || null;
}

function userPerson(store) {
    return (Array.isArray(store?.currentState?.people) ? store.currentState.people : [])
        .find(person => person?.isUser) || null;
}

function recentNarrativeSnippets(targetName) {
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const name = clean(targetName, 120);
    if (!name) return [];
    const matches = [];
    for (const message of chat.slice(-16)) {
        if (!message || message.is_system) continue;
        const swipeId = Number(message.swipe_id ?? 0);
        const raw = message.is_user
            ? String(message.mes || '')
            : String(message.swipes?.[swipeId] ?? message.mes ?? '');
        const normalized = clean(raw, 1400);
        if (!normalized || !normalized.includes(name)) continue;
        matches.push(normalized.slice(0, 180));
    }
    return matches.slice(-2);
}

function groundedEvidence(store, personId, previous = '') {
    const target = personById(store, personId);
    const player = userPerson(store);
    const parts = [];
    const oldEvidence = clean(previous, 120);
    if (oldEvidence) parts.push(oldEvidence);

    const playerProfile = clean([
        player?.identityAnchor,
        player?.backgroundProfile,
        player?.worldbookRaw,
        player?.trace,
    ].filter(Boolean).join('；'), 150);
    if (playerProfile) parts.push(`申请人资料（仅供判断，不等于已确认关系）：${playerProfile}`);

    const narrative = recentNarrativeSnippets(target?.name);
    if (narrative.length) {
        parts.push(`近期正文原文片段：${narrative.join(' / ')}`);
    }

    return clean(parts.join('；'), 350);
}

function restoreConnectionSnapshot(store, personId, snapshot, temporaryConnection) {
    const connections = socialConnections(store);
    const id = String(personId || '');
    const index = connections.findIndex(item => String(item?.personId ?? item?.person_id ?? '') === id);

    if (!snapshot) {
        if (temporaryConnection && index >= 0 && connections[index] === temporaryConnection) {
            connections.splice(index, 1);
        }
        return;
    }

    const current = index >= 0 ? connections[index] : null;
    if (!current) {
        connections.unshift({ ...snapshot });
        return;
    }

    // 只恢复本次提交前临时改过的同一个对象；如果请求已经异步写回了新结果，绝不覆盖。
    if (current !== temporaryConnection) return;
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, snapshot);
}

function prepareRequestContext(personId) {
    const store = getStore();
    if (!store || !personId) return null;
    const connections = socialConnections(store);
    const id = String(personId);
    let connection = connections.find(item => String(item?.personId ?? item?.person_id ?? '') === id);
    const snapshot = connection ? { ...connection } : null;
    const now = new Date().toISOString();

    if (!connection) {
        connection = {
            personId: id,
            status: 'suggested',
            source: 'friend-request-context',
            evidence: '',
            updatedAt: now,
        };
        connections.unshift(connection);
    }

    // pending 原本会被 buildFriendRequestPrompt 直接拒绝再次提交。
    // 这里只在“构建本次申请提示词”的同步窗口里临时放行，随后马上恢复旧状态；
    // 真正的新状态只能由成功的好友申请结果写回，API 失败不会污染旧 pending。
    if (connection.status === 'pending') {
        connection.status = 'suggested';
        connection.source = 'friend-request-retry';
        connection.respondedAt = '';
    }

    const nextEvidence = groundedEvidence(store, id, connection.evidence || connection.decisionReason || '');
    if (nextEvidence) connection.evidence = nextEvidence;
    connection.updatedAt = now;

    return () => restoreConnectionSnapshot(store, id, snapshot, connection);
}

function uniquePendingPeopleByName(store) {
    const people = Array.isArray(store?.currentState?.people) ? store.currentState.people : [];
    const peopleById = new Map(people.map(person => [String(person?.id || ''), person]));
    const byName = new Map();
    for (const connection of socialConnections(store)) {
        if (connection?.status !== 'pending') continue;
        const person = peopleById.get(String(connection?.personId ?? connection?.person_id ?? ''));
        const name = clean(person?.name, 120);
        if (!name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(String(person.id));
    }
    return new Map([...byName.entries()].filter(([, ids]) => ids.length === 1).map(([name, ids]) => [name, ids[0]]));
}

function retryForm(personId) {
    const form = document.createElement('form');
    form.dataset.wbForm = 'social-friend-request';
    form.dataset.wbPendingRetry = '1';
    form.innerHTML = `<input type="hidden" name="personId" value="${String(personId).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"><input name="message" maxlength="300" placeholder="补充说明（可选）"><button type="submit">再次询问</button>`;
    return form;
}

function exposePendingRetries(root) {
    const store = getStore();
    if (!store) return;
    const pendingByName = uniquePendingPeopleByName(store);
    if (!pendingByName.size) return;

    root.querySelectorAll('.wb-social-friend-card').forEach(card => {
        if (!(card instanceof HTMLElement)) return;
        if (card.querySelector('[data-wb-pending-retry="1"]')) return;
        const button = [...card.querySelectorAll('button')].find(node => (
            node.disabled && clean(node.textContent, 40).includes('等待处理')
        ));
        if (!(button instanceof HTMLButtonElement)) return;
        const name = clean(card.querySelector(':scope > div > strong')?.textContent || card.querySelector('strong')?.textContent, 120);
        const personId = pendingByName.get(name);
        if (!personId) return;
        button.replaceWith(retryForm(personId));
    });
}

function patchGlobalRequestLock(root) {
    const requestForms = [...root.querySelectorAll('form[data-wb-form="social-friend-request"]')];
    const runningButton = requestForms
        .map(form => form.querySelector('button[type="submit"]'))
        .find(button => button instanceof HTMLButtonElement
            && button.disabled
            && clean(button.textContent, 40).includes('等待中'));

    for (const form of requestForms) {
        const button = form.querySelector('button[type="submit"]');
        if (!(button instanceof HTMLButtonElement) || button === runningButton) continue;
        if (runningButton) {
            if (!button.dataset.wbFriendFixOriginalText) {
                button.dataset.wbFriendFixOriginalText = button.textContent || '添加好友';
            }
            button.disabled = true;
            button.textContent = '上一条处理中…';
        } else if (button.dataset.wbFriendFixOriginalText) {
            button.disabled = false;
            button.textContent = button.dataset.wbFriendFixOriginalText;
            delete button.dataset.wbFriendFixOriginalText;
        }
    }
}

function settleRoot(root) {
    exposePendingRetries(root);
    patchGlobalRequestLock(root);
}

function onSubmitCapture(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form || form.dataset.wbForm !== 'social-friend-request') return;
    const root = form.closest('#world-backstage-root');
    if (!root) return;

    const runningElsewhere = [...root.querySelectorAll('form[data-wb-form="social-friend-request"] button[type="submit"]')]
        .some(button => button !== form.querySelector('button[type="submit"]')
            && button instanceof HTMLButtonElement
            && button.disabled
            && clean(button.textContent, 40).includes('等待中'));
    if (runningElsewhere) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }

    const personId = clean(new FormData(form).get('personId'), 120);
    if (!personId) return;
    const restore = prepareRequestContext(personId);
    if (typeof restore === 'function') queueMicrotask(restore);
}

function attach(root) {
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            settleRoot(root);
        });
    };

    document.addEventListener('submit', onSubmitCapture, true);
    settleRoot(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    document.addEventListener('pointerup', schedule, true);

    window.addEventListener('pagehide', () => {
        observer.disconnect();
        document.removeEventListener('submit', onSubmitCapture, true);
        document.removeEventListener('pointerup', schedule, true);
    }, { once: true });
}

function start() {
    if (globalThis[PATCH_KEY]) return;
    globalThis[PATCH_KEY] = true;
    const root = document.getElementById('world-backstage-root');
    if (root) return attach(root);
    const waiter = new MutationObserver(() => {
        const nextRoot = document.getElementById('world-backstage-root');
        if (!nextRoot) return;
        waiter.disconnect();
        attach(nextRoot);
    });
    waiter.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
