import { LINGQI_MASCOT_DATA_URLS } from './lingqi-assets.js';

const COMMUNITY_URL = 'https://discord.gg/3tdTAy2Fr';
const ENTRY_ID = 'wb-mama-note-entry';
const MODAL_ID = 'wb-mama-note-modal';
const STYLE_ID = 'wb-mama-note-entry-style';

function noteImage() {
    return LINGQI_MASCOT_DATA_URLS?.note || LINGQI_MASCOT_DATA_URLS?.idle || '';
}

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#world-backstage-root .wb-mama-note-entry {
    padding:10px 12px 0;
}
#world-backstage-root .wb-mama-note-entry-button {
    width:100%;
    min-width:0;
    display:grid;
    grid-template-columns:auto minmax(0,1fr) auto;
    align-items:center;
    gap:9px;
    padding:9px 10px;
    border:1px solid color-mix(in srgb,var(--wb-accent) 24%,var(--wb-line)) !important;
    border-radius:12px;
    background:color-mix(in srgb,var(--wb-accent-soft) 46%,transparent);
    color:var(--wb-text);
    text-align:left;
    cursor:pointer;
}
#world-backstage-root .wb-mama-note-entry-icon {
    font-size:16px;
    line-height:1;
}
#world-backstage-root .wb-mama-note-entry-copy {
    min-width:0;
    display:grid;
    gap:2px;
}
#world-backstage-root .wb-mama-note-entry-copy small {
    color:var(--wb-accent);
    font-size:calc(9px + var(--wb-reading-bump));
}
#world-backstage-root .wb-mama-note-entry-copy strong {
    overflow:hidden;
    color:var(--wb-text-soft);
    font-size:calc(10px + var(--wb-reading-bump));
    font-weight:600;
    text-overflow:ellipsis;
    white-space:nowrap;
}
#world-backstage-root .wb-mama-note-entry-arrow {
    color:var(--wb-text-faint);
    font-size:16px;
}
`;
    document.head.appendChild(style);
}

function modalHtml() {
    const image = noteImage();
    return `
        <div class="wb-mama-note-modal" id="${MODAL_ID}" role="dialog" aria-modal="true" aria-label="妈妈的小纸条">
            <article class="wb-mama-note-paper">
                ${image ? `<img class="wb-mama-note-kitten" src="${image}" alt="" aria-hidden="true">` : ''}
                <small>小玲七叼来一张纸条</small>
                <h3>妈妈没有把你们丢下。</h3>
                <p>世界背面哪里不对、不会用、出了 bug，或者有什么想要的新东西，都可以来找妈妈。</p>
                <p>小玲七会继续在这里看着世界，妈妈在那边等你们。ฅ( ̳• ·̫ • ̳ฅ)</p>
                <p class="wb-mama-note-sign">——小玲七的妈妈·玲</p>
                <div class="wb-mama-note-actions">
                    <button type="button" data-wb-mama-entry-close>收好纸条</button>
                    <a href="${COMMUNITY_URL}" target="_blank" rel="noopener noreferrer">去找妈妈</a>
                </div>
            </article>
        </div>
    `;
}

function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
}

function showModal(root) {
    if (!(root instanceof HTMLElement) || document.getElementById(MODAL_ID)) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml().trim();
    const modal = wrapper.firstElementChild;
    if (!(modal instanceof HTMLElement)) return;
    root.appendChild(modal);

    const paper = modal.querySelector('.wb-mama-note-paper');
    paper?.addEventListener('click', event => event.stopPropagation());
    modal.querySelector('[data-wb-mama-entry-close]')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
}

function ensureEntry(root) {
    if (!(root instanceof HTMLElement) || document.getElementById(ENTRY_ID)) return;
    const notesCard = root.querySelector('.wb-lingqi-notes-card');
    const notesHead = notesCard?.querySelector('.wb-lingqi-notes-head');
    if (!(notesCard instanceof HTMLElement) || !(notesHead instanceof HTMLElement)) return;

    const entry = document.createElement('div');
    entry.className = 'wb-mama-note-entry';
    entry.id = ENTRY_ID;
    entry.innerHTML = `
        <button type="button" class="wb-mama-note-entry-button" aria-label="打开妈妈的小纸条">
            <span class="wb-mama-note-entry-icon" aria-hidden="true">💌</span>
            <span class="wb-mama-note-entry-copy">
                <small>妈妈的小纸条</small>
                <strong>有事就来找妈妈</strong>
            </span>
            <span class="wb-mama-note-entry-arrow" aria-hidden="true">›</span>
        </button>
    `;
    notesHead.insertAdjacentElement('afterend', entry);
    entry.querySelector('button')?.addEventListener('click', () => showModal(root));
}

function start() {
    installStyle();
    const attach = root => {
        ensureEntry(root);
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                ensureEntry(root);
            });
        });
        observer.observe(root, { childList: true, subtree: true });
        window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    };

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
