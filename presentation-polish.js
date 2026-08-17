const STYLE_ID = 'wb-presentation-polish-v250';

const CSS = `
/* 2.5.0 · 只保留通讯排版优化；不修改原生悬浮球。 */
#world-backstage-root .wb-social-shell.is-page-messages {
  grid-template-rows: 54px 44px minmax(0,1fr) !important;
  min-height: 0;
  overflow: hidden;
  align-content: stretch;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-page-body {
  min-height: 0;
  overflow: hidden;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout {
  grid-template-columns: clamp(220px,28%,276px) minmax(0,1fr) !important;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  gap: 0 !important;
  border: 1px solid var(--wb-line);
  border-radius: 18px;
  background: color-mix(in srgb,var(--wb-panel) 92%,transparent);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar {
  padding: 0 !important;
  border-right: 1px solid var(--wb-line);
  background: color-mix(in srgb,var(--wb-panel-strong) 88%,var(--wb-bg-soft));
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head {
  min-height: 48px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 7px;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts {
  display: grid;
  gap: 4px;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button:hover,
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button:hover {
  border-color: var(--wb-line);
  background: var(--wb-panel-faint);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button.is-active {
  border-color: color-mix(in srgb,var(--wb-accent) 38%,var(--wb-line));
  background: color-mix(in srgb,var(--wb-accent-soft) 82%,var(--wb-panel));
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-isolation-control {
  min-height: 44px;
  margin: 0;
  padding: 7px 10px;
  border-top: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg,var(--wb-panel-faint),transparent 28%);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread > header {
  flex: 0 0 auto;
  min-height: 50px;
  padding: 8px 13px;
  border-bottom: 1px solid var(--wb-line);
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-log {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px 16px;
}
#world-backstage-root .wb-social-shell.is-page-messages .wb-social-message-main {
  max-width: min(76%,560px);
}
#world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle {
  align-self: center !important;
  width: calc(100% - 24px) !important;
  height: 36px !important;
  min-height: 36px !important;
  max-height: 36px !important;
  margin: 0 12px !important;
  padding: 5px 9px !important;
  overflow: hidden !important;
  border-radius: 11px;
  background: color-mix(in srgb,var(--wb-panel-faint) 68%,transparent);
}
#world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle > div {
  min-width: 0;
  grid-template-columns: auto minmax(0,1fr);
  align-items: baseline;
  column-gap: 8px;
}
#world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle strong {
  white-space: nowrap;
}
#world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle > div > span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#world-backstage-root .wb-social-cat-delivery {
  flex: 0 0 auto;
  margin: 0 12px 6px auto;
  padding: 7px 10px;
  border-radius: 999px;
  box-shadow: none;
}
#world-backstage-root .wb-social-compose {
  flex: 0 0 auto;
  gap: 8px;
  margin: 0 !important;
  padding: 9px 12px 11px !important;
  border-top: 1px solid var(--wb-line);
  background: color-mix(in srgb,var(--wb-panel-strong) 76%,transparent);
}
#world-backstage-root .wb-social-compose textarea {
  min-height: 38px;
  max-height: 120px;
  padding: 9px 12px;
  border-radius: 14px;
  resize: none;
}
#world-backstage-root .wb-social-compose button[type='submit'] {
  min-width: 72px;
  min-height: 38px;
  padding-inline: 12px;
  border-radius: 13px;
}

@media (max-width:680px),(max-height:520px) and (pointer:coarse) {
  #world-backstage-root .wb-social-shell.is-page-messages {
    grid-template-rows: 48px 38px minmax(0,1fr) !important;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-layout {
    grid-template-columns: minmax(112px,34%) minmax(0,1fr) !important;
    border-radius: 14px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head {
    min-height: 42px;
    padding: 6px;
    gap: 4px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head strong {
    font-size: 10px;
    white-space: nowrap;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head button {
    width: 29px;
    min-width: 29px;
    min-height: 29px;
    padding: 0;
    overflow: hidden;
    font-size: 0;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-head button span {
    font-size: 16px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-sidebar-scroll {
    padding: 4px;
    scrollbar-gutter: auto;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button {
    grid-template-columns: 28px minmax(0,1fr);
    min-height: 43px;
    gap: 5px;
    padding: 5px 4px;
    border-radius: 10px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-person-avatar.is-social,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-group-avatar {
    width: 28px;
    height: 28px;
    min-width: 28px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-conversations button small,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-contacts button small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-isolation-control {
    min-height: 38px;
    padding: 5px 6px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread > header {
    min-height: 42px;
    padding: 6px 8px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread-contact h3,
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-thread-contact span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-log {
    padding: 8px;
    scrollbar-gutter: auto;
  }
  #world-backstage-root .wb-social-shell.is-page-messages .wb-social-message-main {
    max-width: 88%;
  }
  #world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle {
    width: calc(100% - 12px) !important;
    height: 32px !important;
    min-height: 32px !important;
    max-height: 32px !important;
    margin: 0 6px !important;
    padding: 4px 7px !important;
    gap: 7px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle strong {
    font-size: 9px;
  }
  #world-backstage-root .wb-social-shell.is-page-messages > .wb-social-reply-toggle > div > span {
    font-size: 8px;
  }
  #world-backstage-root .wb-social-cat-delivery {
    margin: 0 7px 4px auto;
    padding: 5px 8px;
    font-size: 9px;
  }
  #world-backstage-root .wb-social-compose {
    gap: 5px;
    padding: 6px 7px 7px !important;
  }
  #world-backstage-root .wb-social-compose textarea {
    min-height: 34px;
    max-height: 86px;
    padding: 7px 8px;
    border-radius: 11px;
    font-size: 11px;
  }
  #world-backstage-root .wb-social-compose button[type='submit'] {
    min-width: 56px;
    min-height: 34px;
    padding-inline: 7px;
    border-radius: 10px;
    font-size: 10px;
  }
}
`;

function installStyle() {
  document.getElementById('wb-presentation-polish-v248')?.remove();
  document.getElementById('wb-presentation-polish-v249')?.remove();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installStyle, { once: true });
} else {
  installStyle();
}
