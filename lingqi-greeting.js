const STYLE_ID = 'wb-lingqi-greeting-style';
const GREETING_ID = 'wb-lingqi-greeting';

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#world-backstage-root .wb-lingqi-greeting {
    display:grid;
    gap:5px;
    margin:10px 10px 0;
    padding:10px 12px;
    flex:0 0 auto;
    border:1px solid color-mix(in srgb,var(--wb-accent) 18%,var(--wb-line));
    border-radius:14px;
    background:color-mix(in srgb,var(--wb-accent-soft) 42%,transparent);
    color:var(--wb-text-soft);
    line-height:1.55;
    pointer-events:none;
}
#world-backstage-root .wb-lingqi-greeting strong {
    color:var(--wb-text);
    font-size:calc(12px + var(--wb-reading-bump));
    font-weight:650;
}
#world-backstage-root .wb-lingqi-greeting span {
    font-size:calc(10px + var(--wb-reading-bump));
}
@media (max-width:680px) {
    #world-backstage-root .wb-lingqi-greeting {
        margin:8px 8px 0;
        padding:9px 10px;
        border-radius:12px;
    }
}
`;
    document.head.appendChild(style);
}

function greetingHtml() {
    return `
        <aside class="wb-lingqi-greeting" id="${GREETING_ID}" aria-label="玲七开场白">
            <strong>玲七在这里。</strong>
            <span>想看看世界、找个人、改点设置，或者哪里不对劲，都可以直接跟玲七说。</span>
            <span>玲七先自己翻翻；真弄不明白，再叼纸条去找妈妈 ฅ</span>
        </aside>
    `;
}

function ensureGreeting(root) {
    if (!(root instanceof HTMLElement)) return;
    if (root.querySelector(`#${GREETING_ID}`)) return;

    const layout = root.querySelector('.wb-lingqi-layout');
    const chatCard = layout?.querySelector('.wb-lingqi-chat-card');
    const chatLog = chatCard?.querySelector('.wb-lingqi-chat-log');
    if (!(chatCard instanceof HTMLElement) || !(chatLog instanceof HTMLElement)) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = greetingHtml().trim();
    const greeting = wrapper.firstElementChild;
    if (!(greeting instanceof HTMLElement)) return;
    chatCard.insertBefore(greeting, chatLog);
}

function observe(root) {
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            ensureGreeting(root);
        });
    };

    ensureGreeting(root);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
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
    waiter.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
