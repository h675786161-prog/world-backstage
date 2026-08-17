import { LINGQI_MASCOT_DATA_URLS } from './lingqi-assets.js';

const STYLE_ID = 'wb-presentation-polish-v248';
const CSS = `
/* 2.4.8 · 通讯层排版修复 + 玲七悬浮入口 */
#world-backstage-root .wb-social-shell.is-page-messages {
  grid-template-rows: 54px auto minmax(0,1fr) !important;
  min-height: 0;
  overflow: hidden;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-page-body {
  min-height: 0;
  overflow: hidden;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout {
  grid-template-columns: clamp(220px,28%,276px) minmax(0,1fr) !important;
  width: 100%; height: 100%; min-height: 0; overflow: hidden;
  gap: 0 !important; border: 1px solid var(--wb-line); border-radius: 18px;
  background: color-mix(in srgb,var(--wb-panel) 92%,transparent);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread {
  min-width: 0; min-height: 0; overflow: hidden;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar {
  padding: 0 !important; border-right: 1px solid var(--wb-line);
  background: color-mix(in srgb,var(--wb-panel-strong) 88%,var(--wb-bg-soft));
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head {
  min-height: 48px; padding: 8px 10px; border-bottom: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-scroll {
  min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding: 7px;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts { display: grid; gap: 4px; }
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button {
  min-width: 0; border: 1px solid transparent; border-radius: 12px; background: transparent;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button:hover,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button:hover {
  border-color: var(--wb-line); background: var(--wb-panel-faint);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button.is-active {
  border-color: color-mix(in srgb,var(--wb-accent) 38%,var(--wb-line));
  background: color-mix(in srgb,var(--wb-accent-soft) 82%,var(--wb-panel));
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-isolation-control {
  min-height: 44px; margin: 0; padding: 7px 10px; border-top: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread {
  display: flex; flex-direction: column;
  background: linear-gradient(180deg,var(--wb-panel-faint),transparent 28%);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread > header {
  flex: 0 0 auto; min-height: 50px; padding: 8px 13px; border-bottom: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-log {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-gutter: stable; padding: 14px 16px;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-message-main { max-width: min(76%,560px); }
#world-backstage-root .wb-social-reply-toggle {
  min-height: 42px; margin: 6px 12px 8px; padding: 7px 10px; border-radius: 12px;
  background: color-mix(in srgb,var(--wb-panel-faint) 76%,transparent);
}
#world-backstage-root .wb-social-reply-toggle > div > span {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
#world-backstage-root .wb-social-cat-delivery {
  flex: 0 0 auto; margin: 0 12px 6px auto; padding: 7px 10px; border-radius: 999px; box-shadow: none;
}
#world-backstage-root .wb-social-compose {
  flex: 0 0 auto; gap: 8px; margin: 0 !important; padding: 9px 12px 11px !important;
  border-top: 1px solid var(--wb-line); background: color-mix(in srgb,var(--wb-panel-strong) 76%,transparent);
}
#world-backstage-root .wb-social-compose textarea {
  min-height: 38px; max-height: 120px; padding: 9px 12px; border-radius: 14px; resize: none;
}
#world-backstage-root .wb-social-compose button[type='submit'] {
  min-width: 72px; min-height: 38px; padding-inline: 12px; border-radius: 13px;
}

@media (max-width:680px),(max-height:520px) and (pointer:coarse) {
  #world-backstage-root .wb-social-shell.is-page-messages { grid-template-rows: 48px auto minmax(0,1fr) !important; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout {
    grid-template-columns: minmax(112px,34%) minmax(0,1fr) !important; border-radius: 14px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head { min-height: 42px; padding: 6px; gap: 4px; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head strong { font-size: 10px; white-space: nowrap; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head button {
    width: 29px; min-width: 29px; min-height: 29px; padding: 0; overflow: hidden; font-size: 0;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head button span { font-size: 16px; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-scroll { padding: 4px; scrollbar-gutter: auto; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button {
    grid-template-columns: 28px minmax(0,1fr); min-height: 43px; gap: 5px; padding: 5px 4px; border-radius: 10px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-person-avatar.is-social,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-group-avatar { width: 28px; height: 28px; min-width: 28px; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button small,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-isolation-control { min-height: 38px; padding: 5px 6px; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread > header { min-height: 42px; padding: 6px 8px; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread-contact h3,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread-contact span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-log { padding: 8px; scrollbar-gutter: auto; }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-message-main { max-width: 88%; }
  #world-backstage-root .wb-social-reply-toggle { min-height: 38px; margin: 5px 6px 6px; padding: 6px 8px; gap: 7px; }
  #world-backstage-root .wb-social-reply-toggle strong { font-size: 10px; }
  #world-backstage-root .wb-social-reply-toggle > div > span { font-size: 8px; -webkit-line-clamp: 1; }
  #world-backstage-root .wb-social-cat-delivery { margin: 0 7px 4px auto; padding: 5px 8px; font-size: 9px; }
  #world-backstage-root .wb-social-compose { gap: 5px; padding: 6px 7px 7px !important; }
  #world-backstage-root .wb-social-compose textarea { min-height: 34px; max-height: 86px; padding: 7px 8px; border-radius: 11px; font-size: 11px; }
  #world-backstage-root .wb-social-compose button[type='submit'] { min-width: 56px; min-height: 34px; padding-inline: 7px; border-radius: 10px; font-size: 10px; }
}

#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] {
  width: 58px !important; height: 58px !important; min-width: 58px !important; min-height: 58px !important;
  overflow: visible !important; border: 0 !important; background: transparent !important; box-shadow: none !important;
  isolation: isolate; transform-origin: 50% 62%;
}
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-aura { inset: 8px !important; opacity: .46 !important; filter: blur(7px); }
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-ring { inset: 8px !important; z-index: 0; opacity: .42 !important; }
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-ring-two { inset: 12px !important; opacity: .24 !important; }
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-core,
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-glint { display: none !important; }
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-mascot {
  position: absolute; z-index: 2; left: 50%; bottom: 2px; width: 64px; max-width: none; height: auto;
  pointer-events: none; user-select: none; transform: translateX(-50%); transform-origin: 50% 76%;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,.24)); animation: wb-mascot-orb-breathe 3.1s ease-in-out infinite;
}
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true']:hover .wb-orb-mascot,
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true']:focus-visible .wb-orb-mascot { animation-duration: 1.55s; }
#world-backstage-root .wb-world-orb[data-wb-mascot-orb='true']:active .wb-orb-mascot { transform: translateX(-50%) translateY(1px) scale(.97); }
@keyframes wb-mascot-orb-breathe {
  0%,100% { transform: translateX(-50%) translateY(0) rotate(-.7deg) scale(1); }
  50% { transform: translateX(-50%) translateY(-2px) rotate(.7deg) scale(1.018); }
}
@media (max-width:680px),(pointer:coarse) {
  #world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] { width: 42px !important; height: 42px !important; min-width: 42px !important; min-height: 42px !important; }
  #world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-mascot { width: 48px; bottom: 0; }
  #world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-ring { inset: 5px !important; }
  #world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-ring-two { inset: 9px !important; }
}
@media (prefers-reduced-motion:reduce) {
  #world-backstage-root .wb-world-orb[data-wb-mascot-orb='true'] .wb-orb-mascot { animation: none !important; }
}
`;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function patchOrb(root) {
  const orb = root?.querySelector?.('#wb-world-orb, .wb-world-orb');
  if (!(orb instanceof HTMLElement)) return;
  let image = orb.querySelector('.wb-orb-mascot');
  if (!(image instanceof HTMLImageElement)) {
    image = document.createElement('img');
    image.className = 'wb-orb-mascot';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.decoding = 'async';
    image.draggable = false;
    orb.appendChild(image);
  }
  const idle = LINGQI_MASCOT_DATA_URLS?.idle;
  if (idle && image.getAttribute('src') !== idle) image.setAttribute('src', idle);
  orb.setAttribute('data-wb-mascot-orb', 'true');
}

function observeRoot(root) {
  patchOrb(root);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; patchOrb(root); });
  });
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

function start() {
  installStyle();
  const root = document.getElementById('world-backstage-root');
  if (root) return observeRoot(root);
  const waiter = new MutationObserver(() => {
    const nextRoot = document.getElementById('world-backstage-root');
    if (!nextRoot) return;
    waiter.disconnect();
    observeRoot(nextRoot);
  });
  waiter.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
