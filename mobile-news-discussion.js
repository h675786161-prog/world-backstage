import { STATE_KEY } from './core.js';

const STYLE_ID = 'world-backstage-mobile-news-discussion-style';
const MOBILE_QUERY = '(max-width: 700px), (max-height: 520px) and (pointer: coarse)';
let scheduled = false;

function isMobile() {
    return globalThis.matchMedia?.(MOBILE_QUERY)?.matches === true;
}

function text(value) {
    return String(value ?? '').trim();
}

function currentStore() {
    return globalThis.SillyTavern?.getContext?.()?.chatMetadata?.[STATE_KEY] || null;
}

function currentOpinion() {
    const store = currentStore();
    const opinion = store?.publicOpinion;
    return opinion && typeof opinion === 'object' ? opinion : { news: [], forums: [] };
}

function dismissedIds(kind) {
    const store = currentStore();
    return new Set(Array.isArray(store?.publicOpinionDismissed?.[kind])
        ? store.publicOpinionDismissed[kind].map(String)
        : []);
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
@media (max-width: 700px), (max-height: 520px) and (pointer: coarse) {
    #world-backstage-root .wb-mobile-news-discussion {
        margin-top: 10px;
        border-top: 1px solid color-mix(in srgb, var(--wb-line) 76%, transparent);
        padding-top: 8px;
    }

    #world-backstage-root .wb-mobile-news-discussion > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 40px;
        padding: 7px 9px;
        border-radius: 11px;
        background: color-mix(in srgb, var(--wb-panel-faint) 72%, transparent);
        color: var(--wb-text-soft);
        cursor: pointer;
        list-style: none;
        font-size: 12px;
        font-weight: 650;
        user-select: none;
    }

    #world-backstage-root .wb-mobile-news-discussion > summary::-webkit-details-marker {
        display: none;
    }

    #world-backstage-root .wb-mobile-news-discussion > summary::after {
        content: '⌄';
        flex: none;
        color: var(--wb-accent);
        transition: transform 160ms ease;
    }

    #world-backstage-root .wb-mobile-news-discussion[open] > summary::after {
        transform: rotate(180deg);
    }

    #world-backstage-root .wb-mobile-news-discussion-list {
        display: grid;
        gap: 7px;
        padding: 7px 1px 1px;
    }

    #world-backstage-root .wb-mobile-news-discussion-topic {
        display: grid;
        gap: 4px;
        padding: 9px 10px;
        border: 1px solid color-mix(in srgb, var(--wb-line) 72%, transparent);
        border-radius: 11px;
        background: color-mix(in srgb, var(--wb-panel) 84%, transparent);
    }

    #world-backstage-root .wb-mobile-news-discussion-topic > strong {
        font-size: 12px;
        line-height: 1.4;
    }

    #world-backstage-root .wb-mobile-news-discussion-topic > p {
        margin: 0;
        color: var(--wb-text-muted);
        font-size: 11px;
        line-height: 1.5;
    }

    #world-backstage-root .wb-mobile-news-discussion-replies {
        display: grid;
        gap: 5px;
        margin-top: 3px;
        padding-top: 6px;
        border-top: 1px dashed color-mix(in srgb, var(--wb-line) 70%, transparent);
    }

    #world-backstage-root .wb-mobile-news-discussion-reply {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 6px;
        align-items: start;
        font-size: 11px;
        line-height: 1.45;
    }

    #world-backstage-root .wb-mobile-news-discussion-reply > b {
        color: var(--wb-accent);
        white-space: nowrap;
        font-weight: 650;
    }

    #world-backstage-root .wb-mobile-news-discussion-reply > span {
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--wb-text-soft);
    }
}
`;
    document.head.appendChild(style);
}

function uniqueForums(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = `${text(item?.relatedEventId)}\u0000${text(item?.board).toLocaleLowerCase()}\u0000${text(item?.title).toLocaleLowerCase()}\u0000${text(item?.summary).toLocaleLowerCase()}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function makeReply(reply) {
    const row = document.createElement('div');
    row.className = 'wb-mobile-news-discussion-reply';

    const author = document.createElement('b');
    author.textContent = text(reply?.author) || '匿名';
    const body = document.createElement('span');
    body.textContent = text(reply?.text);

    row.append(author, body);
    return row;
}

function makeTopic(forum) {
    const topic = document.createElement('div');
    topic.className = 'wb-mobile-news-discussion-topic';

    const title = document.createElement('strong');
    title.textContent = `${text(forum?.board) || '闲聊'} · ${text(forum?.title) || '相关讨论'}`;
    const summary = document.createElement('p');
    summary.textContent = text(forum?.summary);
    topic.append(title, summary);

    const replies = Array.isArray(forum?.replies)
        ? forum.replies.filter(reply => text(reply?.text)).slice(0, 4)
        : [];
    if (replies.length) {
        const replyList = document.createElement('div');
        replyList.className = 'wb-mobile-news-discussion-replies';
        replies.forEach(reply => replyList.append(makeReply(reply)));
        topic.append(replyList);
    }
    return topic;
}

function discussionSignature(forums) {
    return forums.map(item => [
        text(item?.id),
        text(item?.title),
        text(item?.summary),
        ...(Array.isArray(item?.replies) ? item.replies.map(reply => `${text(reply?.author)}:${text(reply?.text)}`) : []),
    ].join('|')).join('\n');
}

function attachDiscussion(card, forums) {
    const signature = discussionSignature(forums);
    const existing = card.querySelector(':scope > .wb-mobile-news-discussion');
    if (existing?.dataset?.signature === signature) return;
    existing?.remove();

    const details = document.createElement('details');
    details.className = 'wb-mobile-news-discussion';
    details.dataset.signature = signature;

    const replyCount = forums.reduce((sum, forum) => (
        sum + (Array.isArray(forum?.replies) ? forum.replies.filter(reply => text(reply?.text)).length : 0)
    ), 0);
    const summary = document.createElement('summary');
    summary.textContent = replyCount
        ? `💬 相关讨论 · ${forums.length} 个话题 / ${replyCount} 条回复`
        : `💬 相关讨论 · ${forums.length} 个话题`;

    const list = document.createElement('div');
    list.className = 'wb-mobile-news-discussion-list';
    forums.forEach(forum => list.append(makeTopic(forum)));
    details.append(summary, list);
    card.append(details);
}

function clearInjected() {
    document.querySelectorAll('#world-backstage-root .wb-mobile-news-discussion').forEach(node => node.remove());
}

function apply() {
    scheduled = false;
    const root = document.getElementById('world-backstage-root');
    if (!root) return;
    if (!isMobile()) {
        clearInjected();
        return;
    }

    const cards = [...root.querySelectorAll('.wb-news-grid .wb-news-card:not(.is-sandbox)')];
    if (!cards.length) return;

    const opinion = currentOpinion();
    const dismissedNews = dismissedIds('news');
    const dismissedForums = dismissedIds('forums');
    const news = (Array.isArray(opinion?.news) ? opinion.news : [])
        .filter(item => !dismissedNews.has(String(item?.id || '')));
    const forums = (Array.isArray(opinion?.forums) ? opinion.forums : [])
        .filter(item => !dismissedForums.has(String(item?.id || '')));

    for (const card of cards) {
        const headline = text(card.querySelector('h3')?.textContent);
        const newsItem = news.find(item => text(item?.headline) === headline);
        if (!newsItem?.relatedEventId) {
            card.querySelector(':scope > .wb-mobile-news-discussion')?.remove();
            continue;
        }
        const related = uniqueForums(forums.filter(item => (
            text(item?.relatedEventId) === text(newsItem.relatedEventId)
        ))).slice(0, 3);
        if (!related.length) {
            card.querySelector(':scope > .wb-mobile-news-discussion')?.remove();
            continue;
        }
        attachDiscussion(card, related);
    }
}

function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
}

function install() {
    ensureStyle();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    globalThis.matchMedia?.(MOBILE_QUERY)?.addEventListener?.('change', scheduleApply);
    scheduleApply();
}

install();
