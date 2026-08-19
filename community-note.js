import { LINGQI_MASCOT_DATA_URLS } from './lingqi-assets.js';

const COMMUNITY_URL = 'https://discord.gg/3tdTAy2Fr';
const SEEN_KEY = 'world-backstage:mama-note:seen';
const LEGACY_SEEN_KEYS = ['world-backstage:mama-note:v1'];
const STYLE_ID = 'wb-mama-note-style';
const CARD_ID = 'wb-mama-note-card';
const MODAL_ID = 'wb-mama-note-modal';

let memorySeen = false;
let initialDeliveryScheduled = false;

function noteImage() {
    return LINGQI_MASCOT_DATA_URLS?.note || LINGQI_MASCOT_DATA_URLS?.idle || '';
}

function hasSeen() {
    if (memorySeen) return true;
    try {
        const storage = globalThis.localStorage;
        if (storage?.getItem(SEEN_KEY) === '1') return true;
        for (const key of LEGACY_SEEN_KEYS) {
            if (storage?.getItem(key) !== '1') continue;
            memorySeen = true;
            storage?.setItem(SEEN_KEY, '1');
            return true;
        }
        return false;
    } catch {
        return memorySeen;
    }
}

function markSeen() {
    memorySeen = true;
    try {
        globalThis.localStorage?.setItem(SEEN_KEY, '1');
    } catch {
        // Embedded WebViews may deny localStorage. Memory still prevents repeat delivery this session.
    }
}

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#world-backstage-root .wb-mama-note-card {
    display:grid;
    grid-template-columns:76px minmax(0,1fr) auto;
    align-items:center;
    gap:14px;
    padding:13px 15px;
    margin:0 0 14px;
    border:1px solid color-mix(in srgb,var(--wb-accent) 28%,var(--wb-line));
    border-radius:18px;
    background:linear-gradient(135deg,color-mix(in srgb,var(--wb-accent-soft) 54%,transparent),transparent 56%),color-mix(in srgb,var(--wb-panel-strong) 94%,transparent);
    box-shadow:0 10px 28px rgba(0,0,0,.07);
}
#world-backstage-root .wb-mama-note-card img {
    width:76px;height:64px;object-fit:contain;object-position:center bottom;
    filter:drop-shadow(0 5px 8px rgba(0,0,0,.12));
}
#world-backstage-root .wb-mama-note-card-copy { min-width:0;display:grid;gap:4px; }
#world-backstage-root .wb-mama-note-card-copy small { color:var(--wb-accent);font-size:calc(9px + var(--wb-reading-bump));letter-spacing:.08em; }
#world-backstage-root .wb-mama-note-card-copy strong { color:var(--wb-text);font-size:calc(13px + var(--wb-reading-bump)); }
#world-backstage-root .wb-mama-note-card-copy span { color:var(--wb-text-soft);font-size:calc(10px + var(--wb-reading-bump));line-height:1.55; }
#world-backstage-root .wb-mama-note-link,
#world-backstage-root .wb-mama-note-actions a,
#world-backstage-root .wb-mama-note-actions button {
    appearance:none;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-height:36px;
    padding:8px 12px;
    border:1px solid color-mix(in srgb,var(--wb-accent) 42%,var(--wb-line));
    border-radius:12px;
    background:var(--wb-accent-soft);
    color:var(--wb-accent);
    font:inherit;
    font-size:calc(10px + var(--wb-reading-bump));
    font-weight:650;
    text-decoration:none;
    cursor:pointer;
    white-space:nowrap;
    pointer-events:auto !important;
    touch-action:manipulation;
}
#world-backstage-root .wb-mama-note-modal {
    position:fixed !important;
    inset:0 !important;
    z-index:2147483000 !important;
    display:grid !important;
    place-items:center;
    padding:18px;
    background:color-mix(in srgb,var(--wb-bg) 58%,transparent);
    backdrop-filter:blur(5px);
    pointer-events:auto !important;
    touch-action:auto;
    isolation:isolate;
}
#world-backstage-root .wb-mama-note-paper {
    position:relative;
    z-index:1;
    width:min(440px,calc(100% - 12px));
    padding:26px 26px 22px;
    border:1px solid color-mix(in srgb,var(--wb-accent) 24%,var(--wb-line));
    border-radius:22px 22px 26px 20px;
    background:repeating-linear-gradient(0deg,transparent 0 27px,color-mix(in srgb,var(--wb-accent) 7%,transparent) 28px 29px),color-mix(in srgb,var(--wb-panel-strong) 97%,#fff 3%);
    box-shadow:0 22px 70px rgba(0,0,0,.22);
    transform:rotate(-.35deg);
    animation:wb-mama-note-arrive .42s cubic-bezier(.2,.85,.25,1.08) both;
    pointer-events:auto !important;
}
#world-backstage-root .wb-mama-note-kitten {
    position:absolute;width:104px;height:86px;object-fit:contain;right:18px;top:-64px;
    filter:drop-shadow(0 7px 10px rgba(0,0,0,.16));pointer-events:none;
}
#world-backstage-root .wb-mama-note-paper small { display:block;margin-bottom:5px;color:var(--wb-accent);font-size:calc(10px + var(--wb-reading-bump));letter-spacing:.08em; }
#world-backstage-root .wb-mama-note-paper h3 { margin:0 0 12px;color:var(--wb-text);font-size:calc(18px + var(--wb-reading-bump)); }
#world-backstage-root .wb-mama-note-paper p { margin:0;color:var(--wb-text-soft);font-size:calc(12px + var(--wb-reading-bump));line-height:1.85; }
#world-backstage-root .wb-mama-note-paper p + p { margin-top:9px; }
#world-backstage-root .wb-mama-note-sign { margin-top:14px !important;text-align:right;color:var(--wb-text-faint) !important;font-size:calc(10px + var(--wb-reading-bump)) !important; }
#world-backstage-root .wb-mama-note-actions { display:flex;justify-content:flex-end;gap:8px;margin-top:18px;pointer-events:auto !important; }
#world-backstage-root .wb-mama-note-actions button { background:transparent;color:var(--wb-text-soft);border-color:var(--wb-line); }
@keyframes wb-mama-note-arrive {
    from { opacity:0;transform:translateY(18px) rotate(-1.4deg) scale(.96); }
    to { opacity:1;transform:translateY(0) rotate(-.35deg) scale(1); }
}
@media (max-width:680px) {
    #world-backstage-root .wb-mama-note-card { grid-template-columns:54px minmax(0,1fr);gap:10px;padding:11px; }
    #world-backstage-root .wb-mama-note-card img { width:54px;height:50px; }
    #world-backstage-root .wb-mama-note-link { grid-column:1 / -1;width:100%; }
    #world-backstage-root .wb-mama-note-paper { padding:22px 18px 18px; }
    #world-backstage-root .wb-mama-note-kitten { width:82px;height:70px;right:12px;top:-52px; }
    #world-backstage-root .wb-mama-note-actions { display:grid;grid-template-columns:1fr 1fr; }
}
@media (prefers-reduced-motion:reduce) {
    #world-backstage-root .wb-mama-note-paper { animation:none !important; }
}
`;
    document.head.appendChild(style);
}

function persistentCardHtml() {
    const image = noteImage();
    return `
        <section class="wb-mama-note-card" id="${CARD_ID}" aria-label="妈妈的小纸条">
            ${image ? `<img src="${image}" alt="" aria-hidden="true">` : '<span aria-hidden="true">🐾</span>'}
            <div class="wb-mama-note-card-copy">
                <small>妈妈的小纸条</small>
                <strong>有事就来找妈妈</strong>
                <span>不会用、出了 bug，或者想许愿新功能，都可以来找妈妈。妈妈没有把你们丢下。</span>
            </div>
            <a class="wb-mama-note-link" href="${COMMUNITY_URL}" target="_blank" rel="noopener noreferrer">去找妈妈</a>
        </section>
    `;
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
                    <button type="button" data-wb-mama-note-close>收好纸条</button>
                    <a href="${COMMUNITY_URL}" target="_blank" rel="noopener noreferrer" data-wb-mama-note-community>去找妈妈</a>
                </div>
            </article>
        </div>
    `;
}

function ensurePersistentCard(root) {
    if (!(root instanceof HTMLElement)) return;
    const view = root.querySelector('.wb-lingqi-view');
    if (!(view instanceof HTMLElement) || view.querySelector(`#${CARD_ID}`)) return;
    const hero = view.querySelector('.wb-lingqi-hero');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = persistentCardHtml().trim();
    const card = wrapper.firstElementChild;
    if (!card) return;
    if (hero?.nextSibling) view.insertBefore(card, hero.nextSibling);
    else view.appendChild(card);
}

function closeModal({ seen = true } = {}) {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
    if (seen) markSeen();
}

function bindModalEvents(modal) {
    if (!(modal instanceof HTMLElement) || modal.dataset.wbMamaBound === '1') return;
    modal.dataset.wbMamaBound = '1';

    const close = modal.querySelector('[data-wb-mama-note-close]');
    const community = modal.querySelector('[data-wb-mama-note-community]');
    const paper = modal.querySelector('.wb-mama-note-paper');

    const swallowPointer = event => event.stopPropagation();
    modal.addEventListener('pointerdown', swallowPointer);
    paper?.addEventListener('click', swallowPointer);

    close?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        closeModal({ seen: true });
    });

    community?.addEventListener('click', event => {
        event.stopPropagation();
        markSeen();
        window.setTimeout(() => document.getElementById(MODAL_ID)?.remove(), 0);
    });

    modal.addEventListener('click', event => {
        if (event.target !== modal) return;
        event.preventDefault();
        event.stopPropagation();
        closeModal({ seen: true });
    });

    const onKeyDown = event => {
        if (event.key !== 'Escape' || !document.getElementById(MODAL_ID)) return;
        event.preventDefault();
        event.stopPropagation();
        closeModal({ seen: true });
        document.removeEventListener('keydown', onKeyDown, true);
    };
    document.addEventListener('keydown', onKeyDown, true);
}

function showInitialDelivery(root) {
    if (!(root instanceof HTMLElement) || hasSeen() || document.getElementById(MODAL_ID)) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml().trim();
    const modal = wrapper.firstElementChild;
    if (!(modal instanceof HTMLElement)) return;
    root.appendChild(modal);
    bindModalEvents(modal);
}

function observe(root) {
    ensurePersistentCard(root);

    const observer = new MutationObserver(() => ensurePersistentCard(root));
    observer.observe(root, { childList:true, subtree:true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once:true });

    if (!hasSeen() && !initialDeliveryScheduled) {
        initialDeliveryScheduled = true;
        window.setTimeout(() => showInitialDelivery(root), 650);
    }
}

function start() {
    installStyle();
    const root = document.getElementById('world-backstage-root');
    if (root) {
        observe(root);
        return;
    }
    const waiter = new MutationObserver(() => {
        const nextRoot = document.getElementById('world-backstage-root');
        if (!nextRoot) return;
        waiter.disconnect();
        observe(nextRoot);
    });
    waiter.observe(document.documentElement, { childList:true, subtree:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
else start();
