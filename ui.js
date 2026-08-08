import { LINGQI_MASCOT_DATA_URLS } from './lingqi-assets.js';
import {
    eventProgress,
    formatDuration,
    formatWorldCalendar,
    formatWorldMinute,
    isActiveEvent,
    isTerminalEvent,
} from './core.js';
import { filterWorldbookEntries } from './worldbook.js';

const WB_PANEL_STABILITY_HINT = 'fold:7/2';

const VIEWS = [
    { id: 'now', label: '此刻', eyebrow: 'NOW' },
    { id: 'lingqi', label: '玲七', eyebrow: 'LINGQI' },
    { id: 'people', label: '人物', eyebrow: 'PEOPLE' },
    { id: 'currents', label: '暗流', eyebrow: 'CURRENTS' },
    { id: 'echoes', label: '回声', eyebrow: 'ECHOES' },
    { id: 'opinion', label: '舆情', eyebrow: 'PUBLIC' },
    { id: 'memory', label: '记忆', eyebrow: 'MEMORY' },
    { id: 'archive', label: '纪事', eyebrow: 'ARCHIVE' },
];

const TOAST_FACES = {
    success: '(｡•̀ᴗ-)✧',
    busy: '( •̀ ω •́ )',
    info: '( •ᴗ• )',
    normal: '( •ᴗ• )',
    warning: '(・_・;)',
    error: '(；′⌒`)',
};

const TOAST_LABELS = {
    success: '好啦',
    busy: '正在努力',
    info: '小提示',
    normal: '小提示',
    warning: '等一下',
    error: '出问题了',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
}


function foldOpenAttr(openFolds, key, defaultOpen = false) {
    const isOpen = openFolds instanceof Set ? openFolds.has(key) : defaultOpen;
    return isOpen ? 'open' : '';
}

function renderFoldToolbar(prefix) {
    return `
        <div class="wb-fold-toolbar" aria-label="折叠控制">
            <button type="button" data-wb-action="expand-folds" data-fold-prefix="${escapeAttr(prefix)}">全部展开</button>
            <button type="button" data-wb-action="collapse-folds" data-fold-prefix="${escapeAttr(prefix)}">全部收起</button>
        </div>
    `;
}

function compactText(value, maximum = 64) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maximum) return text;
    return `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function normalizeGroupLabel(value, fallback = '其他') {
    const label = String(value || '').trim();
    return label || fallback;
}

function groupItems(items, getGroup) {
    const groups = new Map();
    for (const item of items) {
        const descriptor = getGroup(item);
        const rawLabel = typeof descriptor === 'object' && descriptor
            ? descriptor.label
            : descriptor;
        const label = normalizeGroupLabel(rawLabel);
        const rawKey = typeof descriptor === 'object' && descriptor
            ? descriptor.key
            : label;
        const key = normalizeGroupLabel(rawKey, label).toLocaleLowerCase();
        if (!groups.has(key)) groups.set(key, { key, label, items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}
function formatLocalTimestamp(value) {
    const date = new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function worldClockLabel(state, clock = formatWorldCalendar(state)) {
    return state.clock?.anchored ? clock.stamp : '待从正文建立时间锚点';
}


function pluginReleaseStage(version = '') {
    const text = String(version || '');
    if (/-rc\./i.test(text)) return '候选版';
    if (/-alpha|dev\./i.test(text)) return '测试版';
    return '正式版';
}

function pluginDisplayVersion(version = '') {
    const text = String(version || '');
    if (/^2\.3\.0-alpha\.\d+$/i.test(text)) return '小猫版 V2.3 · 体验版';
    if (/^2\.2\.\d+$/i.test(text)) return '小猫版 V2.2';
    return `${pluginReleaseStage(text)} ${text || '1.1.0'}`;
}

function themeFor(state, settings) {
    if (settings.theme === 'day' || settings.theme === 'night') return settings.theme;
    const hour = formatWorldMinute(state.clock.absoluteMinute).hour;
    return hour >= 6 && hour < 18 ? 'day' : 'night';
}

function eventStatusLabel(event) {
    return {
        active: '发展中',
        waiting: '等待条件',
        ready: '到时待确认',
        resolved: '结果已形成',
        cancelled: '已经取消',
        missed: '已经错过',
    }[event.status] || event.status;
}

function visibilityLabel(value) {
    return {
        hidden: '角色尚不可知',
        trace: '可由痕迹察觉',
        known: '可经消息获知',
        direct: '可以直接感知',
    }[value] || '角色尚不可知';
}

function deliveryLabel(event) {
    if (event.status === 'ready') return '到时待后台确认';
    return {
        none: '只在后台生效',
        pending: '等待自然显露',
        delivered: '已由正文承接',
        expired: '未显露，转入纪事',
    }[event.delivery?.state] || '只在后台生效';
}

function clockModeLabel(value) {
    return {
        duration: '自然流逝',
        active: '有效工时',
        scheduled: '预定时间',
        condition: '条件等待',
    }[value] || '自然流逝';
}

function renderBrandMark() {
    return `
        <span class="wb-brand-mark" aria-hidden="true">
            <i class="wb-orbit wb-orbit-a"></i>
            <i class="wb-orbit wb-orbit-b"></i>
            <i class="wb-brand-core"></i>
        </span>
    `;
}

function renderEmpty(label, detail = '') {
    return `
        <div class="wb-empty">
            <span class="wb-empty-eye"></span>
            <strong>${escapeHtml(label)}</strong>
            ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
        </div>
    `;
}

function renderPersonAvatar(person, size = '') {
    const glyph = person?.monogram || person?.name?.slice(0, 1) || '·';
    const avatar = String(person?.avatarDataUrl || '');
    const image = /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(avatar)
        ? `<img src="${escapeAttr(avatar)}" alt="" loading="lazy">`
        : escapeHtml(glyph);
    return `
        <span class="wb-person-avatar ${size}">
            ${image}
            <i></i>
        </span>
    `;
}

async function readPersonAvatarFile(file) {
    if (!file) return '';
    if (!String(file.type || '').startsWith('image/')) throw new Error('这个文件看起来不是图片哦～');
    if (Number(file.size || 0) > 8 * 1024 * 1024) throw new Error('头像太大啦～先选一张 8MB 以内的图片吧。');

    const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('头像没有读成功，再换一张试试吧～'));
        reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error('这张图片浏览器没有认出来，可以换成 PNG / JPG / WebP 试试～'));
        node.src = source;
    });

    const side = Math.max(1, Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const sx = Math.max(0, ((image.naturalWidth || image.width) - side) / 2);
    const sy = Math.max(0, ((image.naturalHeight || image.height) - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前浏览器没法处理头像图片。');
    context.drawImage(image, sx, sy, side, side, 0, 0, 160, 160);
    let result = canvas.toDataURL('image/webp', 0.78);
    if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/jpeg', 0.78);
    if (result.length > 180000) result = canvas.toDataURL('image/jpeg', 0.62);
    if (result.length > 180000) throw new Error('头像压缩后还是有点太大～换一张简单一点的图试试吧。');
    return result;
}

export function renderInnerVoice(person, worldMinute, compact = false) {
    if (!person.innerVoice) return '';
    return `
        <blockquote class="wb-inner-voice ${compact ? 'is-compact' : ''}">
            <p>“${escapeHtml(person.innerVoice)}”</p>
        </blockquote>
    `;
}

function renderPersonRow(person, observerMode, worldMinute) {
    return `
        <article class="wb-person-row" role="button" tabindex="0"
            data-wb-action="select-person" data-person-id="${escapeAttr(person.id)}">
            ${renderPersonAvatar(person)}
            <span class="wb-person-row-main">
                <span class="wb-person-name-line">
                    <strong>${escapeHtml(person.name)}</strong>
                    <small>${escapeHtml(person.location)}</small>
                </span>
                <span class="wb-person-action">${escapeHtml(person.action)}</span>
                ${observerMode === 'backstage' ? renderInnerVoice(person, worldMinute, true) : ''}
            </span>
            <span class="wb-row-arrow">↗</span>
        </article>
    `;
}

export function renderPersonCard(person, observerMode, worldMinute, openFolds = new Set()) {
    const foldKey = `people:${person.id}`;
    return `
        <details class="wb-fold wb-person-card" data-fold-key="${escapeAttr(foldKey)}"
            ${foldOpenAttr(openFolds, foldKey)}>
            <summary class="wb-person-card-summary">
                <span class="wb-person-summary-main">
                    ${renderPersonAvatar(person, 'is-large')}
                    <span class="wb-person-summary-copy">
                        <span class="wb-person-summary-heading">
                            <strong>${escapeHtml(person.name)}</strong>
                            <small>${escapeHtml(person.location)}</small>
                        </span>
                        <span class="wb-person-summary-action">${escapeHtml(compactText(person.action, 72) || '暂时没有新的动作。')}</span>
                    </span>
                </span>
                <span class="wb-fold-meta">
                    <span class="wb-person-sim-state ${person.simulationEnabled === false ? 'is-sleeping' : ''}">
                        ${person.simulationEnabled === false ? '后台休眠' : '后台活动'}
                    </span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </span>
            </summary>
            <div class="wb-fold-body wb-person-card-body">
                <span class="wb-person-thread is-current-action">
                    <small>正在做</small>
                    <strong>${escapeHtml(person.action || '暂时没有新的动作。')}</strong>
                </span>
                <span class="wb-person-thread">
                    <small>短期意图</small>
                    <strong>${escapeHtml(person.intent || '暂无明确短期意图。')}</strong>
                </span>
                ${person.longTermGoal ? `
                    <span class="wb-person-thread is-long-term">
                        <small>长期目标</small>
                        <strong>${escapeHtml(person.longTermGoal)}</strong>
                    </span>
                ` : ''}
                ${observerMode === 'backstage'
                    ? renderInnerVoice(person, worldMinute)
                    : '<span class="wb-known-boundary">幕后独白已隐藏</span>'}
                <div class="wb-person-card-actions">
                    <button class="wb-card-action-button is-primary" type="button"
                        data-wb-action="select-person" data-person-id="${escapeAttr(person.id)}">查看人物详情</button>
                    <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-person-editor"
                        data-person-id="${escapeAttr(person.id)}" data-person-name="${escapeAttr(person.name)}">编辑</button>
                </div>
            </div>
        </details>
    `;
}

function renderProgress(event, state, wide = false) {
    const progress = eventProgress(event, state.clock.absoluteMinute);
    const started = formatWorldCalendar(state, event.startedAt);
    const due = Number.isFinite(Number(event.dueAt))
        ? formatWorldCalendar(state, event.dueAt)
        : null;
    const remaining = progress.remaining === null
        ? progress.phase
        : progress.remaining === 0
            ? eventStatusLabel(event)
            : `剩余 ${formatDuration(progress.remaining)}`;

    if (progress.percent === null) {
        return `
            <div class="wb-condition-progress">
                <span>${escapeHtml(clockModeLabel(event.clockMode))}</span>
                <strong>${escapeHtml(progress.phase)}</strong>
            </div>
        `;
    }

    return `
        <div class="wb-time-progress ${wide ? 'is-wide' : ''}">
            ${wide ? `
                <div class="wb-time-progress-copy">
                    <span>${escapeHtml(started.stamp)}</span>
                    <strong>${escapeHtml(clockModeLabel(event.clockMode))}</strong>
                    <span>${due ? escapeHtml(due.stamp) : '完成时间待确认'}</span>
                </div>
            ` : ''}
            <span class="wb-time-track">
                <i style="width:${progress.percent}%"></i>
                <b style="left:${progress.percent}%"></b>
            </span>
            <span class="wb-time-foot">
                <small>${escapeHtml(progress.phase)}</small>
                <strong>${escapeHtml(remaining)}</strong>
            </span>
        </div>
    `;
}

function renderEventCard(event, state, wide = false, openFolds = new Set()) {
    if (!wide) {
        return `
            <article class="wb-event-card">
                <div class="wb-event-topline">
                    <span class="wb-phase phase-${escapeAttr(event.status)}">${escapeHtml(eventStatusLabel(event))}</span>
                    <span>${escapeHtml(event.place)}</span>
                </div>
                <h3>${escapeHtml(event.title)}</h3>
                <p>${escapeHtml(event.summary || event.consequence || '事件仍在形成。')}</p>
                ${renderProgress(event, state, false)}
                <div class="wb-route">
                    <i></i>
                    ${escapeHtml(visibilityLabel(event.visibility))}
                </div>
                <div class="wb-event-card-actions">
                    <button class="wb-card-action-button is-primary wb-event-delivery-toggle ${event.delivery?.manualQueued ? 'is-queued' : ''}"
                        type="button" data-wb-action="toggle-event-delivery"
                        data-event-id="${escapeAttr(event.id)}"
                        ${event.visibility === 'hidden' ? 'disabled' : ''}>
                        ${event.delivery?.manualQueued ? '✓ 下一轮显露' : '下一轮显露'}
                    </button>
                </div>
            </article>
        `;
    }

    const progress = eventProgress(event, state.clock.absoluteMinute);
    const remaining = progress.remaining === null
        ? progress.phase
        : progress.remaining === 0
            ? eventStatusLabel(event)
            : `剩余 ${formatDuration(progress.remaining)}`;
    const foldKey = `currents:${event.id}`;
    return `
        <details class="wb-fold wb-event-card is-wide" data-fold-key="${escapeAttr(foldKey)}"
            ${foldOpenAttr(openFolds, foldKey)}>
            <summary class="wb-event-summary">
                <span class="wb-event-summary-copy">
                    <span class="wb-event-topline">
                        <span class="wb-phase phase-${escapeAttr(event.status)}">${escapeHtml(eventStatusLabel(event))}</span>
                        <span>${escapeHtml(event.place)}</span>
                    </span>
                    <strong>${escapeHtml(event.title)}</strong>
                    <small>${escapeHtml(compactText(event.summary || event.consequence || '事件仍在形成。', 90))}</small>
                </span>
                <span class="wb-fold-meta">
                    <span class="wb-fold-status">${escapeHtml(remaining)}</span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </span>
            </summary>
            <div class="wb-fold-body wb-event-card-body">
                <p>${escapeHtml(event.summary || event.consequence || '事件仍在形成。')}</p>
                ${event.consequence ? `
                    <div class="wb-consequence">
                        <span>可能后果</span>
                        <strong>${escapeHtml(event.consequence)}</strong>
                    </div>
                ` : ''}
                ${renderProgress(event, state, true)}
                <div class="wb-route">
                    <i></i>
                    ${escapeHtml(visibilityLabel(event.visibility))}
                </div>
                <div class="wb-event-card-actions">
                    <button class="wb-card-action-button is-primary wb-event-delivery-toggle ${event.delivery?.manualQueued ? 'is-queued' : ''}"
                        type="button" data-wb-action="toggle-event-delivery"
                        data-event-id="${escapeAttr(event.id)}"
                        ${event.visibility === 'hidden' ? 'disabled' : ''}>
                        ${event.delivery?.manualQueued ? '✓ 下一轮显露' : '下一轮显露'}
                    </button>
                    <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-event-editor"
                        data-event-id="${escapeAttr(event.id)}">编辑</button>
                    <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-event"
                        data-event-id="${escapeAttr(event.id)}">删除</button>
                </div>
            </div>
        </details>
    `;
}

function echoOutcomeMinute(event) {
    const resolvedAt = Number(event?.resolvedAt);
    const dueAt = Number(event?.dueAt);
    const updatedAt = Number(event?.updatedAt);
    const status = String(event?.status || '');
    const timed = ['duration', 'scheduled'].includes(event?.clockMode);

    if (status === 'ready' && Number.isFinite(dueAt)) return dueAt;
    if (
        ['resolved', 'missed'].includes(status)
        && timed
        && Number.isFinite(dueAt)
        && dueAt >= 0
        && (!Number.isFinite(resolvedAt) || dueAt <= resolvedAt)
    ) {
        return dueAt;
    }
    if (Number.isFinite(resolvedAt)) return resolvedAt;
    if (Number.isFinite(dueAt)) return dueAt;
    return Number.isFinite(updatedAt) ? updatedAt : 0;
}

function renderOutcome(event, state, openFolds = new Set()) {
    const time = formatWorldCalendar(
        state,
        echoOutcomeMinute(event),
    );
    const result = event.result || event.expectedResult || event.consequence || '结果等待确认。';
    const foldKey = `echoes:${event.id}`;
    return `
        <article class="wb-echo-item">
            <time>${escapeHtml(`${time.shortDate} ${time.time}`)}</time>
            <span class="wb-timeline-node state-${escapeAttr(event.delivery?.state || 'none')}"></span>
            <details class="wb-fold wb-echo-card" data-fold-key="${escapeAttr(foldKey)}"
                ${foldOpenAttr(openFolds, foldKey)}>
                <summary class="wb-echo-summary">
                    <span class="wb-echo-copy">
                        <strong>${escapeHtml(event.title)}</strong>
                        <small>${escapeHtml(compactText(result, 96))}</small>
                    </span>
                    <span class="wb-fold-meta">
                        <span class="wb-record-state">${escapeHtml(deliveryLabel(event))}</span>
                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                    </span>
                </summary>
                <div class="wb-fold-body wb-echo-body">
                    <p>${escapeHtml(result)}</p>
                    <div class="wb-record-actions">
                        <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-record-editor"
                            data-record-kind="echo" data-record-id="${escapeAttr(event.id)}">编辑</button>
                        <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-record"
                            data-record-kind="echo" data-record-id="${escapeAttr(event.id)}">删除</button>
                    </div>
                </div>
            </details>
        </article>
    `;
}

function renderArchiveEntry(entry, state, recordKind = 'archive', openFolds = new Set()) {
    const time = Number.isFinite(Number(entry.resolvedAt ?? entry.at))
        ? formatWorldCalendar(state, entry.resolvedAt ?? entry.at)
        : null;
    const title = entry.title || '未命名记录';
    const text = entry.result || entry.text || entry.consequence || entry.route || '';
    const tags = [
        entry.visibility ? visibilityLabel(entry.visibility) : '',
        entry.delivery?.state ? deliveryLabel(entry) : '',
        entry.deliveryState === 'expired' ? '未显露，转入纪事' : '',
    ].filter(Boolean);
    const foldKey = `archive:${recordKind}:${entry.id}`;

    return `
        <article class="wb-archive-entry">
            <div class="wb-archive-date">
                <strong>${time ? time.date : '日期未定'}</strong>
                <span>${time ? time.time : '—'}</span>
            </div>
            <span class="wb-archive-rule"></span>
            <details class="wb-fold wb-archive-copy" data-fold-key="${escapeAttr(foldKey)}"
                ${foldOpenAttr(openFolds, foldKey)}>
                <summary class="wb-archive-summary">
                    <span>
                        <strong>${escapeHtml(title)}</strong>
                        <small>${escapeHtml(compactText(text || '这件事已经成为世界事实。', 100))}</small>
                    </span>
                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                </summary>
                <div class="wb-fold-body wb-archive-body">
                    <p>${escapeHtml(text || '这件事已经成为世界事实。')}</p>
                    <div class="wb-archive-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                    <div class="wb-record-actions">
                        <button class="wb-card-action-button is-edit" type="button" data-wb-action="open-record-editor"
                            data-record-kind="${escapeAttr(recordKind)}" data-record-id="${escapeAttr(entry.id)}">编辑</button>
                        <button class="wb-card-action-button is-danger" type="button" data-wb-action="delete-record"
                            data-record-kind="${escapeAttr(recordKind)}" data-record-id="${escapeAttr(entry.id)}">删除</button>
                    </div>
                </div>
            </details>
        </article>
    `;
}

function syncPhaseLabel(phase) {
    return {
        idle: '等待正文',
        queued: '排队中',
        running: '推演中',
        cancelling: '正在停止',
        success: '推演完成',
        error: '推演失败',
        pending: '等待推演',
    }[phase] || '等待正文';
}

function renderSyncStrip(syncStatus) {
    const status = syncStatus || {};
    const connection = status.lastConnection || status.connection || {};
    const memoryPhase = status.memory?.phase;
    const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
    const phase = memoryTakesFocus ? memoryPhase : (status.phase || 'idle');
    const baseDetail = memoryTakesFocus
        ? status.memory?.message || (memoryPhase === 'error' ? '记忆整理没有完成' : '正在整理长期记忆')
        : status.error || status.message || '尚未进行世界推演';
    const waitingTurns = Math.max(0, Number(status.queue?.waitingTurns) || 0);
    const detail = !memoryTakesFocus && waitingTurns > 0 && !String(baseDetail).includes('待处理')
        ? `${baseDetail} · 后面还有 ${waitingTurns} 轮待处理`
        : baseDetail;
    const title = memoryTakesFocus
        ? (memoryPhase === 'error' ? '记忆整理失败' : '整理记忆中')
        : syncPhaseLabel(phase);
    const connectionText = [
        connection.apiLabel,
        connection.model,
    ].filter(Boolean).join(' · ');
    const summary = !memoryTakesFocus && phase === 'success' ? status.summary : null;
    const changedNames = summary?.peopleNames?.length
        ? `（${summary.peopleNames.map(escapeHtml).join('、')}）`
        : '';
    const eventNames = summary?.eventTitles?.length
        ? `（${summary.eventTitles.map(escapeHtml).join('、')}）`
        : '';
    const summaryHtml = summary ? `
        <details class="wb-sync-summary">
            <summary>本次变化</summary>
            <div>
                <span>世界时间</span><strong>${summary.elapsedMinutes > 0 ? `+${escapeHtml(formatDuration(summary.elapsedMinutes))}` : '未推进'}</strong>
                <span>人物变化</span><strong>${summary.peopleChanged || 0} 人 ${changedNames}</strong>
                <span>事件变化</span><strong>新增 ${summary.eventsAdded || 0} · 更新 ${summary.eventsUpdated || 0} ${eventNames}</strong>
                <span>记忆变化</span><strong>新增 ${summary.memoryAdded || 0} · 更新 ${summary.memoryUpdated || 0}</strong>
                <span>正文显露</span><strong>${summary.injectionEvents || 0} 个事件</strong>
            </div>
        </details>
    ` : '';

    return `
        <div class="wb-sync-strip is-${escapeAttr(phase)}" role="${phase === 'error' ? 'alert' : 'status'}">
            <i class="wb-sync-indicator"></i>
            <div class="wb-sync-copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(detail)}</span>
            </div>
            <span class="wb-sync-connection">${escapeHtml(connectionText || '跟随酒馆当前主 API')}</span>
            ${summaryHtml}
        </div>
    `;
}

function renderSettings(state, settings, syncStatus, openGroups = new Set(), openSubgroups = new Set(), apiDraft = null, tagFilterRules = null, tagCandidates = [], worldbookUi = {}, tavernProfiles = [], activeSection = 'common') {
    const clock = formatWorldCalendar(state);
    const clockLabel = worldClockLabel(state, clock);
    const connection = syncStatus?.connection || {};
    const memory = syncStatus?.memory || {};
    const phase = syncStatus?.phase || 'idle';
    const historyRunning = memory.phase === 'running';
    const availableModels = Array.isArray(syncStatus?.availableModels)
        ? syncStatus.availableModels
        : [];
    const modelPull = syncStatus?.modelPull || { phase: 'idle', message: '' };
    const worldbook = syncStatus?.worldbook || { books: [], entries: [], phase: 'idle' };
    const recovery = syncStatus?.recovery || { count: 0, latest: null };
    const latestRecovery = recovery.latest || null;
    const worldbookBooks = Array.isArray(worldbook.books) ? worldbook.books : [];
    const worldbookEntries = Array.isArray(worldbook.entries) ? worldbook.entries : [];
    const worldbookQuery = String(worldbookUi.query || '').slice(0, 120);
    const worldbookOnlyPeople = Boolean(worldbookUi.onlyPeople);
    const worldbookOnlyEnabled = Boolean(worldbookUi.onlyEnabled);
    const worldbookSelectedIds = worldbookUi.selectedIds instanceof Set
        ? worldbookUi.selectedIds
        : new Set(Array.isArray(worldbookUi.selectedIds) ? worldbookUi.selectedIds.map(String) : []);
    const filteredWorldbookEntries = filterWorldbookEntries(worldbookEntries, {
        query: worldbookQuery,
        onlyPeople: worldbookOnlyPeople,
        onlyEnabled: worldbookOnlyEnabled,
    });
    const worldbookSelectedCount = worldbookSelectedIds.size;
    const rules = Array.isArray(tagFilterRules)
        ? tagFilterRules
        : (settings.tagFilterRules || []);
    const hasSavedApiKey = Boolean(settings.customApiKey);
    const apiValues = {
        customApiUrl: apiDraft?.customApiUrl ?? settings.customApiUrl,
        customApiCredential: apiDraft?.customApiCredential ?? '',
        customApiModel: apiDraft?.customApiModel ?? settings.customApiModel,
        customApiTransport: apiDraft?.customApiTransport ?? settings.customApiTransport,
        profileName: apiDraft?.profileName ?? '',
        profileId: apiDraft?.profileId ?? '',
    };
    const apiProfiles = Array.isArray(settings.apiProfiles) ? settings.apiProfiles : [];
    const tavernApiProfiles = Array.isArray(tavernProfiles) ? tavernProfiles : [];
    const apiModuleRoutes = settings.apiModuleRoutes && typeof settings.apiModuleRoutes === 'object'
        ? settings.apiModuleRoutes
        : {};
    const tavernProfileById = id => tavernApiProfiles.find(profile => String(profile.id) === String(id || '')) || null;
    const tavernProfileSelectOptions = (currentId = '') => {
        const current = String(currentId || '');
        const currentExists = Boolean(tavernProfileById(current));
        return [
            `<option value="" ${current ? '' : 'selected'}>请选择酒馆已保存方案</option>`,
            current && !currentExists
                ? `<option value="${escapeAttr(current)}" selected disabled>原方案已不存在 · ${escapeHtml(current)}</option>`
                : '',
            ...tavernApiProfiles.map(profile => (
                `<option value="${escapeAttr(profile.id)}" ${current === String(profile.id) ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未选模型')}</option>`
            )),
        ].join('');
    };
    const routeOptions = (current = 'default') => {
        const missingTavernId = String(current).startsWith('tavern-profile:')
            ? String(current).slice('tavern-profile:'.length)
            : '';
        const missingTavern = missingTavernId && !tavernProfileById(missingTavernId);
        return [
            `<option value="default" ${current === 'default' ? 'selected' : ''}>跟随世界背面默认连接</option>`,
            `<option value="tavern" ${current === 'tavern' ? 'selected' : ''}>跟随当前酒馆</option>`,
            missingTavern
                ? `<option value="${escapeAttr(current)}" selected disabled>酒馆方案已不存在 · ${escapeHtml(missingTavernId)}</option>`
                : '',
            tavernApiProfiles.length
                ? `<optgroup label="酒馆已保存方案">${tavernApiProfiles.map(profile => {
                    const value = `tavern-profile:${profile.id}`;
                    return `<option value="${escapeAttr(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未选模型')}</option>`;
                }).join('')}</optgroup>`
                : '',
            apiProfiles.length
                ? `<optgroup label="世界背面独立方案">${apiProfiles.map(profile => {
                    const value = `profile:${profile.id}`;
                    return `<option value="${escapeAttr(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未选模型')}</option>`;
                }).join('')}</optgroup>`
                : '',
        ].join('');
    };
    const settingExplanation = (setting, value) => {
        const key = String(value);
        const maps = {
            apiMode: {
                tavern: '我跟着酒馆现在这条连接走～主聊天换模型，我这边也会跟着换。省得再填一遍 ฅ',
                'tavern-profile': '我记住酒馆那份方案的牌牌～真正的 Key、地址和模型还是让酒馆自己保管，我每次用之前再去读。',
                custom: '给我单独开条小路～我自己从这边钻出去，不踩主聊天那条路。',
            },
            theme: {
                auto: '天亮我就换亮一点，天黑我就缩进深色里～不用一直来摸开关。',
                day: '一直亮堂堂的。嗯，东西都摊在爪边，看得清楚。',
                night: '一直黑一点～晚上蹲后台不刺眼，我喜欢这个。',
            },
            uiScale: {
                compact: '我把纸片都往爪边拢一拢～一眼能多看几样。',
                comfortable: '我先摊成这样～爪子伸得开，也不会空一大片。',
                large: '字放大一点～小屏幕上不用眯着眼盯。',
            },
            deliveryDensity: {
                restrained: '我少往镜头边叼东西～后台该活的还是照样活。',
                balanced: '重要的我叼到镜头边，不重要的先压爪爪下面。嗯，这样不乱。',
                active: '我会更勤快地把变化叼到镜头边～但正忙的时候我也不会硬扑进去。',
            },
            autoSimulationMode: {

                light: '我趴着轻轻看～只管真有必要的变化，不到处乱跑。',
                balanced: '我会挨个看一眼～该动的自己动，没事我就不拿爪子乱拨。',
                deep: '我会蹲久一点，把镜头外的人和因果都盯仔细～复杂世界用这个。',
            },
            timePolicy: {
                world: '我守着世界钟～正文真说清楚几点，我就把小爪子拨过去。',
                explicit: '真的算得出来我才拨。算不准？那我不碰。',
                cautious: '可以让我猜一点点～但不确定我就把爪子收回来。',
                open: '旅行、等待、工作这种一看就会花时间的事，我就顺手把钟往前推。',
            },
            publicOpinionRevealMode: {
                observe: '我把外面的风声都压在这个角落～你来看我再掀给你，不往正文叼。',
                relevant: '真和眼前这段剧情有关系，我才叼过去一点～没关系的我继续压着。',
            },
        };
        return maps[setting]?.[key] || '';
    };
    const historyPercent = memory.total > 0
        ? Math.min(100, Math.round((Number(memory.processed) || 0) / memory.total * 100))
        : 0;
    const themeButton = (id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="theme" data-value="${id}"
            class="${settings.theme === id ? 'is-active' : ''}">${label}</button>
    `;
    const densityButton = (id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="deliveryDensity" data-value="${id}"
            class="${settings.deliveryDensity === id ? 'is-active' : ''}">${label}</button>
    `;
    const settingButton = (setting, current, id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="${setting}" data-value="${id}"
            class="${String(current) === String(id) ? 'is-active' : ''}">${label}</button>
    `;
    const generationLimits = settings.generationModuleLimits && typeof settings.generationModuleLimits === 'object'
        ? settings.generationModuleLimits
        : {};
    const automaticTimeouts = {
        simulation: 180000,
        observation: 120000,
        history: 300000,
        opinion: 150000,
    };
    const generationModuleLabel = {
        simulation: '世界推演',
        observation: '人物观测',
        history: '历史 / 记忆',
        opinion: '舆情 / 闲逛',
    };
    const generationLimitFor = key => generationLimits[key] || { maxTokens: 0, timeoutMs: 0 };
    const effectiveGenerationTokenLabel = key => {
        const moduleLimit = generationLimitFor(key);
        const cap = Number(moduleLimit.maxTokens) > 0
            ? Number(moduleLimit.maxTokens)
            : Number(settings.maxOutputTokens) > 0
                ? Number(settings.maxOutputTokens)
                : 0;
        return cap > 0 ? `最多 ${Math.round(cap / 100) / 10}K` : '自动预算';
    };
    const effectiveGenerationTimeoutLabel = key => {
        const moduleLimit = generationLimitFor(key);
        const timeoutMs = Number(moduleLimit.timeoutMs) > 0
            ? Number(moduleLimit.timeoutMs)
            : Number(settings.generationTimeoutMs) > 0
                ? Number(settings.generationTimeoutMs)
                : automaticTimeouts[key];
        return `${Math.round(timeoutMs / 1000)}s`;
    };
    const generationModuleRow = key => {
        const moduleLimit = generationLimitFor(key);
        return `
            <div class="wb-generation-module-row">
                <div class="wb-generation-module-copy">
                    <strong>${generationModuleLabel[key]}</strong>
                    <span>当前：${effectiveGenerationTokenLabel(key)} · ${effectiveGenerationTimeoutLabel(key)}</span>
                </div>
                <label>Token 上限
                    <input type="number" min="0" step="500"
                        data-wb-generation-limit="maxTokens" data-module="${key}"
                        value="${escapeAttr(moduleLimit.maxTokens || 0)}"
                        title="0 = 继承全局">
                    <small>0 = 继承</small>
                </label>
                <label>等待秒数
                    <input type="number" min="0" max="600" step="15"
                        data-wb-generation-limit="timeoutSeconds" data-module="${key}"
                        value="${escapeAttr(moduleLimit.timeoutMs ? Math.round(moduleLimit.timeoutMs / 1000) : 0)}"
                        title="0 = 继承全局">
                    <small>0 = 继承</small>
                </label>
            </div>
        `;
    };
    const groupOpen = id => openGroups.has(id) ? 'open' : '';
    const subgroupOpen = id => openSubgroups.has(id) ? 'open' : '';
    const sectionKey = ['common', 'injection', 'connection', 'advanced'].includes(activeSection)
        ? activeSection
        : 'common';
    const sectionButton = (id, label) => `
        <button type="button" data-wb-action="settings-section" data-section="${id}"
            class="${sectionKey === id ? 'is-active' : ''}">${label}</button>
    `;

    return `
        <div class="wb-settings-popover wb-settings-scope-global wb-settings-section-${sectionKey}" role="dialog" aria-modal="true"
            aria-label="全局设置">
            <div class="wb-settings-sticky-head">
                <div class="wb-popover-heading">
                    <div><span>玲七的小窝</span><h3>全局设置</h3></div>
                    <button type="button" data-wb-action="toggle-settings" aria-label="关闭设置">×</button>
                </div>
                <nav class="wb-settings-tabs" aria-label="设置分类">
                    ${sectionButton('common', '常用')}
                    ${sectionButton('injection', '正文注入')}
                    ${sectionButton('connection', '连接与模型')}
                    ${sectionButton('advanced', '高级维护')}
                </nav>
            </div>

            <section class="wb-settings-section-body wb-settings-common-section">
                <div class="wb-global-flat-block">
                    <div class="wb-flat-section-heading">
                        <div><strong>外观</strong><span>这里是我住的地方。唔……当然要铺舒服一点。</span></div>
                    </div>
                    <div class="wb-flat-setting-list">
                        <div class="wb-setting-block">
                            <label>界面明暗</label>
                            <div class="wb-option-row">
                                ${themeButton('auto', '自动')}
                                ${themeButton('day', '日间')}
                                ${themeButton('night', '夜间')}
                            </div>
                            <p class="wb-setting-explanation">${escapeHtml(settingExplanation('theme', settings.theme))}</p>
                        </div>
                        <div class="wb-setting-block">
                            <label>界面字号</label>
                            <div class="wb-option-row">
                                ${settingButton('uiScale', settings.uiScale, 'compact', '紧凑')}
                                ${settingButton('uiScale', settings.uiScale, 'comfortable', '标准')}
                                ${settingButton('uiScale', settings.uiScale, 'large', '大字')}
                            </div>
                            <p class="wb-setting-explanation">${escapeHtml(settingExplanation('uiScale', settings.uiScale))}</p>
                        </div>
                    </div>
                </div>

                <div class="wb-global-common-grid">
                    <div class="wb-setting-toggle">
                        <div>
                            <strong>显示悬浮球</strong>
                            <span>这是我家门口的小球。藏起来也行，我又不会因为看不见门牌就消失。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="orbEnabled"
                                ${settings.orbEnabled !== false ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                    <div class="wb-setting-toggle">
                        <div>
                            <strong>悬浮球贴边收纳</strong>
                            <span>不把门牌整个藏掉～吸到最近的屏幕边，正好藏一半、露一半；点它还是能直接打开。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="orbEdgeHide"
                                ${settings.orbEdgeHide ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                    <div class="wb-setting-toggle">
                        <div>
                            <strong>启用世界引擎</strong>
                            <span>关掉我就趴着不动了～已经发生过的东西我压好，不会吃掉。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="worldSimulationEnabled"
                                ${settings.worldSimulationEnabled ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                    <div class="wb-setting-toggle">
                        <div>
                            <strong>自动运行</strong>
                            <span>开着我会自己醒来巡视～关着就等你戳我。不会偷偷乱跑。</span>
                        </div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="worldAutoEnabled"
                                ${settings.worldAutoEnabled ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                </div>
                <div class="wb-settings-common-hint">
                    <strong>常用的先放爪边。别的我收里面了。</strong>
                    <span>人物、暗流、记忆、舆情各有自己的窝；哪些要叼给正文看，统一来「正文注入」告诉我。</span>
                </div>
            </section>

            <section class="wb-settings-section-body wb-settings-injection-section">
                <div class="wb-injection-intro">
                    <div>
                        <span>玲七往镜头边叼什么 · 不注入 ≠ 不运行</span>
                        <strong>它们都还在背后活着。你只要告诉我：哪些叼到镜头边，哪些先压爪爪下面。</strong>
                    </div>
                    <label class="wb-switch wb-injection-master">
                        <input type="checkbox" data-wb-setting="worldPromptInjection"
                            ${settings.worldPromptInjection ? 'checked' : ''}>
                        <i></i>
                    </label>
                </div>

                <div class="wb-injection-source-list ${settings.worldPromptInjection ? '' : 'is-master-off'}">
                    <article class="wb-injection-source is-time">
                        <div class="wb-injection-source-copy">
                            <small class="wb-injection-source-board">来自侧栏「此刻」</small>
                            <strong>世界时间</strong>
                            <span>钟我还是抱着，不会丢。这里只决定要不要把时间递给正文。</span>
                        </div>
                        <div class="wb-time-mode-picker" role="group" aria-label="世界时间注入方式">
                            <button type="button" data-wb-setting-button="injectionTimeMode" data-value="full"
                                class="${settings.injectionTimeMode === 'full' ? 'is-active' : ''}">
                                <strong>完整</strong><small>日期 + 时段 + 具体时间</small>
                            </button>
                            <button type="button" data-wb-setting-button="injectionTimeMode" data-value="anchor"
                                class="${settings.injectionTimeMode === 'anchor' ? 'is-active' : ''}">
                                <strong>最小锚点</strong><small>只留连续性需要的时间</small>
                            </button>
                            <button type="button" data-wb-setting-button="injectionTimeMode" data-value="off"
                                class="${settings.injectionTimeMode === 'off' ? 'is-active' : ''}">
                                <strong>关闭</strong><small>时间不递给正文</small>
                            </button>
                        </div>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「此刻」</small><strong>世界背景</strong><span>这是世界的地基，我会压稳，不让谁拿爪子乱刨。</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionWorldBackground" ${settings.injectionWorldBackground !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「人物」</small><strong>当前状态</strong><span>${settings.worldSimulationEnabled ? '他们还会在背后过日子，我蹲着替你看。' : '世界引擎歇着，他们先停在当前状态。'}</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionPeople" ${settings.injectionPeople !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「暗流」</small><strong>进行中事件与世界环境</strong><span>${settings.worldSimulationEnabled ? '镜头外的事还会往前走，我蹲在旁边看着。' : '世界引擎歇着，暗流先停在这里。'}</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionEvents" ${settings.injectionEvents !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「回声」</small><strong>已结算后果</strong><span>已经发生的后果，我会压住，不让它悄悄滚走。</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionEchoes" ${settings.injectionEchoes !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「此刻」</small><strong>世界事实</strong><span>这些是已经成立的事实，我得拿来对账，不能随手拨乱。</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionFacts" ${settings.injectionFacts !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「记忆」</small><strong>长期记忆</strong><span>${settings.memorySystemEnabled ? '记忆我会一张张收好，塞进该放的盒子。' : '记忆系统歇着，旧记忆还在，我没弄丢。'}</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionMemory" ${settings.injectionMemory !== false ? 'checked' : ''}><i></i></label>
                    </article>
                    <article class="wb-injection-source">
                        <div class="wb-injection-source-copy"><small class="wb-injection-source-board">来自侧栏「舆情」</small><strong>新闻与论坛</strong><span>${settings.publicOpinionAutoEnabled ? '外面的声音我还会竖着耳朵听。' : '我先不自动听风声啦，想看时还能手动叫我去。'}</span></div>
                        <label class="wb-switch"><input type="checkbox" data-wb-setting="injectionPublicOpinion" ${settings.injectionPublicOpinion !== false ? 'checked' : ''}><i></i></label>
                    </article>
                </div>

                <div class="wb-injection-behavior">
                    <div class="wb-flat-section-heading"><div><strong>显露策略</strong><span>已经允许叼出去的东西，我要离镜头多近</span></div></div>
                    <div class="wb-setting-block">
                        <label>正文显露度</label>
                        <div class="wb-option-row">
                            ${densityButton('restrained', '克制')}
                            ${densityButton('balanced', '均衡')}
                            ${densityButton('active', '活跃')}
                        </div>
                        <p class="wb-setting-explanation">${escapeHtml(settingExplanation('deliveryDensity', settings.deliveryDensity))}</p>
                    </div>
                    <div class="wb-setting-block">
                        <label for="wb-scene-timing-global">显露时机</label>
                        <select id="wb-scene-timing-global" data-wb-setting="sceneTiming">
                            <option value="strict" ${settings.sceneTiming === 'strict' ? 'selected' : ''}>严格：只在转场或空档</option>
                            <option value="smart" ${settings.sceneTiming === 'smart' ? 'selected' : ''}>智能：关键场景延后</option>
                            <option value="open" ${settings.sceneTiming === 'open' ? 'selected' : ''}>开放：允许简短自然变化</option>
                        </select>
                    </div>
                </div>
                <p class="wb-injection-bottom-note">总开关关掉，我就把东西全压在镜头后面。世界照样活，我只是一个都不往前叼。</p>
            </section>

            <details class="wb-settings-group wb-settings-connection-section" data-settings-group="connection" ${sectionKey === 'connection' ? 'open' : groupOpen('connection')}>
                <summary><span>连接</span><small>API 与模型</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <div class="wb-settings-flat-section">
            <div class="wb-connection-card is-${escapeAttr(phase)}">
                <div>
                    <span>世界推演连接</span>
                    <strong>${escapeHtml(connection.apiLabel || '跟随酒馆当前主 API')}</strong>
                </div>
                <dl>
                    <dt>模型</dt><dd>${escapeHtml(connection.model || '跟随酒馆当前模型')}</dd>
                    ${connection.profile ? `<dt>连接档案</dt><dd>${escapeHtml(connection.profile)}</dd>` : ''}
                    <dt>方式</dt><dd>${escapeHtml(connection.method || '独立上下文推演')}</dd>
                    <dt>状态</dt><dd>${escapeHtml(syncPhaseLabel(phase))}</dd>
                </dl>
                ${syncStatus?.error ? `<p>${escapeHtml(syncStatus.error)}</p>` : ''}
                <small>${settings.apiMode === 'custom'
                    ? '我走自己的小路～主聊天那边不用给我让道。'
                    : settings.apiMode === 'tavern-profile'
                        ? '我只记方案牌牌，不抄走 Key。酒馆那边改了模型或地址，我下次用的时候会读到新的。'
                        : '我跟着酒馆当前这条路走～不用再给我画第二张地图。'}</small>
            </div>

            <div class="wb-setting-block">
                <label>世界推演连接</label>
                <div class="wb-option-row">
                    ${settingButton('apiMode', settings.apiMode, 'tavern', '跟随当前酒馆')}
                    ${settingButton('apiMode', settings.apiMode, 'tavern-profile', '酒馆已存方案')}
                    ${settingButton('apiMode', settings.apiMode, 'custom', '独立接口')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('apiMode', settings.apiMode))}</p>
                ${settings.apiMode === 'tavern-profile' ? `
                    <label class="wb-tavern-profile-picker">选择酒馆方案
                        <select data-wb-tavern-profile-select>
                            ${tavernProfileSelectOptions(settings.tavernApiProfileId)}
                        </select>
                    </label>
                    <p>${tavernApiProfiles.length
                        ? '这里只保存方案 ID～Key、接口地址、模型和 Secret 都继续由 SillyTavern 管。方案被改，我下次直接读新值；方案被删，我会停下来报错，不会偷偷换路。'
                        : '我没读到可用的酒馆连接方案。先去 SillyTavern 的 Connection Manager 保存一份方案，再回来选它。'}</p>
                ` : ''}
            </div>
                    </div>
                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-custom" ${subgroupOpen('connection-custom')}>
                        <summary><span>独立接口配置</span><small>地址、Key、模型与连接方式</small></summary>
                        <div class="wb-settings-subgroup-body">
                <form class="wb-api-form" data-wb-form="api" autocomplete="off">
                    <input type="hidden" name="profileId" value="${escapeAttr(apiValues.profileId)}">
                    <div class="wb-api-draft-heading">
                        <span>${apiValues.profileId ? '我在改这份已经存好的方案～Key 留空就继续用原来的。' : (hasSavedApiKey ? '默认独立接口我已经记着啦～旧 Key 不会再摊出来给人看。' : '可以先给我一条接口试试～常用的话再存成方案，之后别的模块也能直接用。')}</span>
                        <button type="button" data-wb-action="reset-api-draft">清空重填</button>
                    </div>
                    <label>接口地址
                        <input name="customApiUrl" type="url" required
                            value="${escapeAttr(apiValues.customApiUrl)}"
                            autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false"
                            placeholder="https://example.com/v1">
                    </label>
                    <p>地址给我填到版本层就好，比如 <code>/v1</code>～后面的 <code>/chat/completions</code> 我自己会补。</p>
                    <label>API Key
                        <span class="wb-api-secret-field">
                            <input class="wb-secret-input" name="customApiCredential" type="text"
                                value="${escapeAttr(apiValues.customApiCredential)}"
                                placeholder="${hasSavedApiKey ? '留空则继续使用已保存的 Key' : '请输入 API Key'}"
                                autocomplete="one-time-code" autocapitalize="none" spellcheck="false"
                                data-lpignore="true" data-1p-ignore data-form-type="other"
                                ${hasSavedApiKey ? '' : 'required'}>
                            <button type="button" data-wb-action="toggle-api-key-visibility"
                                aria-pressed="false">显示</button>
                        </span>
                    </label>
                    <p>${hasSavedApiKey
                        ? '填新的我就换掉旧 Key；留空我继续用原来的。旧 Key 不会重新摆回输入框，免得被手机乱回填。'
                        : 'Key 我只放在本机的 SillyTavern 扩展设置里，不会塞进导出的世界状态。'}</p>
                    <label>模型名称
                        <input name="customApiModel" required list="wb-custom-model-list"
                            value="${escapeAttr(apiValues.customApiModel)}"
                            autocomplete="off" autocapitalize="none" spellcheck="false"
                            placeholder="gemini-2.5-flash">
                        <datalist id="wb-custom-model-list">
                            ${availableModels.map(model => `<option value="${escapeAttr(model)}"></option>`).join('')}
                        </datalist>
                    </label>
                    <label>连接方式
                        <select name="customApiTransport">
                            <option value="proxy" ${apiValues.customApiTransport === 'proxy' ? 'selected' : ''}>
                                经酒馆服务器转发（推荐）
                            </option>
                            <option value="direct" ${apiValues.customApiTransport === 'direct' ? 'selected' : ''}>
                                浏览器直连
                            </option>
                        </select>
                    </label>
                    <label>方案名称（可选）
                        <input name="profileName" maxlength="80"
                            value="${escapeAttr(apiValues.profileName)}"
                            autocomplete="off" placeholder="例如：主力 Pro / 公益站 Flash">
                    </label>
                    <p>只是临时试一下就不用起名字～想以后再用，我就帮你把它收成一个方案。</p>
                    <div class="wb-api-actions">
                        <button class="wb-api-action is-primary" type="submit">保存默认独立接口</button>
                        <button class="wb-api-action is-accent" type="button" data-wb-action="save-api-profile-from-form">${apiValues.profileId ? '保存方案修改' : '保存为方案'}</button>
                        <button class="wb-api-action" type="button" data-wb-action="test-api">测试连接</button>
                        <button class="wb-api-action" type="button" data-wb-action="pull-api-models"
                            ${modelPull.phase === 'running' ? 'disabled' : ''}>
                            ${modelPull.phase === 'running' ? '正在拉取…' : '拉取模型列表'}
                        </button>
                    </div>
                    ${modelPull.message ? `<p class="wb-api-model-status is-${escapeAttr(modelPull.phase)}">${escapeHtml(modelPull.message)}</p>` : ''}
                </form>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-profiles" ${subgroupOpen('connection-profiles')}>
                        <summary><span>世界背面自存方案</span><small>${apiProfiles.length ? `${apiProfiles.length} 个方案` : '还没有保存方案'}</small></summary>
                        <div class="wb-settings-subgroup-body">
                            ${apiProfiles.length ? `
                                <div class="wb-api-profile-list">
                                    ${apiProfiles.map(profile => `
                                        <article class="wb-api-profile-card">
                                            <div>
                                                <strong>${escapeHtml(profile.name)}</strong>
                                                <span>${escapeHtml(profile.model || '未选模型')} · ${escapeHtml(profile.transport === 'direct' ? '浏览器直连' : '酒馆转发')}</span>
                                            </div>
                                            <div class="wb-api-profile-actions">
                                                <button class="wb-api-profile-chip is-accent" type="button" data-wb-action="edit-api-profile" data-profile-id="${escapeAttr(profile.id)}">编辑</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="test-api-profile" data-profile-id="${escapeAttr(profile.id)}">测试</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="pull-api-profile-models" data-profile-id="${escapeAttr(profile.id)}">模型</button>
                                                <button class="wb-api-profile-chip" type="button" data-wb-action="duplicate-api-profile" data-profile-id="${escapeAttr(profile.id)}">复制</button>
                                                <button class="wb-api-profile-chip is-danger" type="button" data-wb-action="delete-api-profile" data-profile-id="${escapeAttr(profile.id)}">删除</button>
                                            </div>
                                        </article>
                                    `).join('')}
                                </div>
                            ` : '<p>常用接口可以从上面的独立接口表单一键保存～之后给不同模块分流时就不用重复填 URL 和 Key 啦 `(｡•̀ᴗ-)✧`</p>'}
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="connection-routing" ${subgroupOpen('connection-routing')}>
                        <summary><span>模块 API 分流</span><small>默认都跟随世界背面默认连接</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <p>谁要走自己的模型，就给谁指条单独的小路～没特别要求我就走默认那条，我认得回家的路。</p>
                            <div class="wb-api-route-grid">
                                <label>世界推演
                                    <select data-wb-api-route="simulation">${routeOptions(apiModuleRoutes.simulation || 'default')}</select>
                                </label>
                                <label>人物即时观测
                                    <select data-wb-api-route="observation">${routeOptions(apiModuleRoutes.observation || 'default')}</select>
                                </label>
                                <label>长期记忆 / 历史整理
                                    <select data-wb-api-route="history">${routeOptions(apiModuleRoutes.history || 'default')}</select>
                                </label>
                                <label>世界舆情
                                    <select data-wb-api-route="opinion">${routeOptions(apiModuleRoutes.opinion || 'default')}</select>
                                </label>
                            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="appearance" ${groupOpen('appearance')}>
                <summary><span>界面与显露</span><small>主题、字号、正文注入</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="appearance-ui" ${subgroupOpen('appearance-ui')}>
                        <summary><span>界面</span><small>明暗与阅读字号</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>界面明暗</label>
                <div class="wb-option-row">
                    ${themeButton('auto', '自动')}
                    ${themeButton('day', '日间')}
                    ${themeButton('night', '夜间')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('theme', settings.theme))}</p>
            </div>

            <div class="wb-setting-block">
                <label>界面字号</label>
                <div class="wb-option-row">
                    ${settingButton('uiScale', settings.uiScale, 'compact', '紧凑')}
                    ${settingButton('uiScale', settings.uiScale, 'comfortable', '标准')}
                    ${settingButton('uiScale', settings.uiScale, 'large', '大字')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('uiScale', settings.uiScale))}</p>
            </div>

            <div class="wb-setting-toggle">
                <div>
                    <strong>显示悬浮球</strong>
                    <span>不想让它一直趴在屏幕上就关掉～插件照常运行，之后也能从酒馆扩展设置里重新打开。</span>
                </div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="orbEnabled"
                        ${settings.orbEnabled !== false ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="appearance-reveal" ${subgroupOpen('appearance-reveal')}>
                        <summary><span>显露</span><small>密度与进入正文的时机</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>正文显露度</label>
                <div class="wb-option-row">
                    ${densityButton('restrained', '克制')}
                    ${densityButton('balanced', '均衡')}
                    ${densityButton('active', '活跃')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('deliveryDensity', settings.deliveryDensity))}</p>
            </div>

            <div class="wb-setting-block">
                <label for="wb-scene-timing">显露时机</label>
                <select id="wb-scene-timing" data-wb-setting="sceneTiming">
                    <option value="strict" ${settings.sceneTiming === 'strict' ? 'selected' : ''}>严格：只在转场或空档</option>
                    <option value="smart" ${settings.sceneTiming === 'smart' ? 'selected' : ''}>智能：关键场景延后</option>
                    <option value="open" ${settings.sceneTiming === 'open' ? 'selected' : ''}>开放：允许简短自然变化</option>
                </select>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>正文注入总开关</strong><span>关掉只是先不叼给正文看～人物、事件、记忆和舆情仍会在背后继续生活。</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldPromptInjection"
                        ${settings.worldPromptInjection ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>

            <div class="wb-injection-grid ${settings.worldPromptInjection ? '' : 'is-disabled'}">
                <div class="wb-setting-block wb-injection-time">
                    <label>「此刻」· 世界时间</label>
                    <div class="wb-option-row">
                        ${settingButton('injectionTimeMode', settings.injectionTimeMode, 'full', '完整')}
                        ${settingButton('injectionTimeMode', settings.injectionTimeMode, 'anchor', '最小锚点')}
                        ${settingButton('injectionTimeMode', settings.injectionTimeMode, 'off', '关闭')}
                    </div>
                    <p class="wb-setting-explanation">「最小锚点」只让我守住时间连续性～不会逼正文把钟摆到镜头正中间。</p>
                </div>
                <div class="wb-setting-toggle"><div><strong>「此刻」· 世界背景</strong><span>世界的地基我会压稳～这里只管递不递给正文。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionWorldBackground" ${settings.injectionWorldBackground !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「人物」· 当前状态</strong><span>他们的位置和行动我照常记着～这里只管递不递。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionPeople" ${settings.injectionPeople !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「暗流」· 进行中事件与世界环境</strong><span>镜头外的事照常往前走，我会蹲在旁边看。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionEvents" ${settings.injectionEvents !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「回声」· 已结算后果</strong><span>只管要不要叼进正文，不会抹掉已经发生的后果。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionEchoes" ${settings.injectionEchoes !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「此刻」· 世界事实</strong><span>已经成立的事实我会拿来对账，不让世界自己打架。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionFacts" ${settings.injectionFacts !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「记忆」· 长期记忆</strong><span>关掉后我还会收拾记忆盒子～只是不往正文里叼。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionMemory" ${settings.injectionMemory !== false ? 'checked' : ''}><i></i></label></div>
                <div class="wb-setting-toggle"><div><strong>「舆情」· 新闻与论坛</strong><span>外面的声音还会继续变化～这里只决定离镜头多近。</span></div><label class="wb-switch"><input type="checkbox" data-wb-setting="injectionPublicOpinion" ${settings.injectionPublicOpinion !== false ? 'checked' : ''}><i></i></label></div>
            </div>
            <p class="wb-setting-explanation">这里的开关都只管「给不给正文看」～压在爪爪下面，不等于它就不存在啦。</p>

            <div class="wb-setting-block">
                <label>要不要让我把风声递近一点</label>
                <div class="wb-option-row">
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'observe', '仅观察')}
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'relevant', '相关时显露')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('publicOpinionRevealMode', settings.publicOpinionRevealMode))}</p>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="simulation" ${groupOpen('simulation')}>
                <summary><span>世界运行</span><small>让镜头外的世界继续自己走～</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-switches" ${subgroupOpen('simulation-switches')}>
                        <summary><span>基础开关</span><small>要不要让后台继续转起来</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-toggle">
                <div><strong>启用世界引擎</strong><span>关掉就先让后台歇一会儿～现有世界不会丢</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldSimulationEnabled"
                        ${settings.worldSimulationEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-trigger" ${subgroupOpen('simulation-trigger')}>
                        <summary><span>运行方式</span><small>世界背面要多勤快～</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>世界运转强度</label>
                <div class="wb-option-row">
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'light', '轻量')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'balanced', '均衡')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'deep', '深入')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('autoSimulationMode', settings.autoSimulationMode))}</p>
                <label>自动触发频率</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 1, '每轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 2, '每 2 轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 3, '每 3 轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 5, '每 5 轮')}
                </div>
                <label class="wb-number-setting">
                    自定义累计轮数
                    <input type="number" min="1" max="20" step="1"
                        data-wb-setting="autoSimulationInterval"
                        value="${escapeAttr(settings.autoSimulationInterval)}">
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-output" ${subgroupOpen('simulation-output')}>
                        <summary><span>失败与附加要求</span><small>重试与推演侧重点</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>推演失败后要不要让我再试</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 0, '不重试')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 1, '重试 1 次')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 2, '重试 2 次')}
                    ${settingButton('autoRetryCount', settings.autoRetryCount, 3, '重试 3 次')}
                </div>
                <label class="wb-number-setting">
                    自定义重试次数
                    <input type="number" min="0" max="5" step="1"
                        data-wb-setting="autoRetryCount"
                        value="${escapeAttr(settings.autoRetryCount)}">
                </label>
                <label class="wb-custom-instruction">
                    自定义推演要求
                    <textarea data-wb-setting="customSimulationInstruction" maxlength="1000" rows="3"
                        placeholder="例如：少制造新事件；多看看商会和港口。玲七会按这个方向留意。">${escapeHtml(settings.customSimulationInstruction)}</textarea>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-npc" ${subgroupOpen('simulation-npc')}>
                        <summary><span>NPC 与玩家边界</span><small>后台人数与玩家内心</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>后台 NPC 预算</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 0, '不主动推演')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 2, '最多 2 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 4, '最多 4 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 8, '最多 8 人')}
                </div>
                <label class="wb-number-setting">
                    自定义单轮人数
                    <input type="number" min="0" step="1"
                        data-wb-setting="backgroundNpcBudget"
                        value="${escapeAttr(settings.backgroundNpcBudget)}">
                </label>
                <p class="wb-setting-explanation">想盯多少人都可以自己填～推荐 2～8 人，单轮尽量别超过 12 人；越大越吃 Token，也会更慢。</p>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>强化后台人物推演</strong><span>该结算的人我会顺爪带进现有世界推演～不额外单开请求，也不让他们只在镜头前才活着。</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="enhancedBackgroundSimulation"
                        ${settings.enhancedBackgroundSimulation ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>记录玩家角色</strong><span>开着时，我只记 user 在正文里明确发生的位置、行动和客观状态；关掉就不把 user 建进「人物」，但已经发生的正文事实照样算数。</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="recordPlayerCharacter"
                        ${settings.recordPlayerCharacter !== false ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="simulation-context" ${subgroupOpen('simulation-context')}>
                        <summary><span>上下文与时间</span><small>读取范围与世界钟策略</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-block">
                <label>正文读取范围</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('contextTurns', settings.contextTurns, 1, '最近 1 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 3, '最近 3 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 5, '最近 5 轮')}
                    <button type="button" data-wb-action="setting-button"
                        data-setting="contextTurns" data-value="${escapeAttr(settings.customContextTurns || 8)}"
                        class="${![1, 3, 5].includes(Number(settings.contextTurns)) ? 'is-active' : ''}">自定义</button>
                </div>
                ${![1, 3, 5].includes(Number(settings.contextTurns)) ? `
                    <label class="wb-number-setting wb-context-custom">
                        读取最近几轮
                        <input type="number" min="1" max="30" step="1"
                            data-wb-setting="contextTurns" value="${escapeAttr(settings.contextTurns)}">
                    </label>
                ` : ''}
                <p class="wb-setting-explanation">${escapeHtml(
                    [1, 3, 5].includes(Number(settings.contextTurns))
                        ? ({1: '只看最新一轮，最轻最省～适合当前信息已经很明确的剧情。', 3: '读最近 3 轮，连续性和消耗都比较轻巧，适合多数日常场景。', 5: '默认推荐～最近 5 轮通常足够接住人物与事件，又不容易把上下文撑得圆滚滚。'}[Number(settings.contextTurns)])
                        : `现在会读最近 ${settings.contextTurns} 轮～长事件和多人剧情会更稳，但轮数越高，Token 也会跟着长胖。`
                )}</p>
            </div>

            <div class="wb-setting-block">
                <label>时间推进</label>
                <div class="wb-option-row">
                    ${settingButton('timePolicy', settings.timePolicy, 'world', '世界钟')}
                    ${settingButton('timePolicy', settings.timePolicy, 'explicit', '严格')}
                    ${settingButton('timePolicy', settings.timePolicy, 'cautious', '克制')}
                    ${settingButton('timePolicy', settings.timePolicy, 'open', '开放')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(settingExplanation('timePolicy', settings.timePolicy))}</p>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="worldbook" ${groupOpen('worldbook')}>
                <summary><span>世界书人物</span><small>搜索、识别与批量导入</small></summary>
                <div class="wb-settings-group-body">
                    <div class="wb-settings-flat-section">
                    <form class="wb-worldbook-import" data-wb-form="worldbook">
                        <label>选择世界书
                            <select name="bookName" ${worldbookBooks.length ? '' : 'disabled'}>
                                ${worldbookBooks.length
                                    ? worldbookBooks.map(book => `<option value="${escapeAttr(book)}"
                                        ${book === worldbook.bookName ? 'selected' : ''}>${escapeHtml(book)}</option>`).join('')
                                    : '<option value="">我现在没找到能读的世界书</option>'}
                            </select>
                        </label>
                        <button class="wb-worldbook-scan-button" type="button" data-wb-action="scan-worldbook"
                            ${worldbook.phase === 'running' || !worldbookBooks.length ? 'disabled' : ''}>
                            ${worldbook.phase === 'running' ? '正在读取…' : '读取并识别人物'}
                        </button>
                        ${worldbook.message ? `<div class="wb-worldbook-status is-${escapeAttr(worldbook.phase)}">${escapeHtml(worldbook.message)}</div>` : ''}
                        ${worldbookEntries.length ? `
                            <div class="wb-worldbook-browser">
                                <label class="wb-worldbook-search">
                                    <span>搜索条目</span>
                                    <input type="search" name="worldbookSearch" data-wb-worldbook-search value="${escapeAttr(worldbookQuery)}"
                                        placeholder="搜人物名、条目名、关键词或正文">
                                </label>
                                <div class="wb-worldbook-filter-row">
                                    <label class="wb-worldbook-filter-chip ${worldbookOnlyPeople ? 'is-active' : ''}">
                                        <input type="checkbox" data-wb-worldbook-filter="people" ${worldbookOnlyPeople ? 'checked' : ''}>
                                        <span>只看疑似人物</span>
                                    </label>
                                    <label class="wb-worldbook-filter-chip ${worldbookOnlyEnabled ? 'is-active' : ''}">
                                        <input type="checkbox" data-wb-worldbook-filter="enabled" ${worldbookOnlyEnabled ? 'checked' : ''}>
                                        <span>只看启用条目</span>
                                    </label>
                                </div>
                                <div class="wb-worldbook-toolbar">
                                    <span>共 ${worldbookEntries.length} 条 · 当前 ${filteredWorldbookEntries.length} 条 · 已选 ${worldbookSelectedCount} 条</span>
                                    <div>
                                        <button type="button" data-wb-action="select-worldbook-visible" ${filteredWorldbookEntries.length ? '' : 'disabled'}>全选当前</button>
                                        <button type="button" data-wb-action="clear-worldbook-visible" ${filteredWorldbookEntries.length ? '' : 'disabled'}>取消当前</button>
                                    </div>
                                </div>
                                <div class="wb-worldbook-entry-list">
                                    ${filteredWorldbookEntries.length ? filteredWorldbookEntries.map(entry => `
                                        <label class="wb-worldbook-entry ${entry.disabled ? 'is-disabled-entry' : ''} ${entry.likelyPerson ? 'is-person-candidate' : ''}">
                                            <input id="wb-worldbook-entry-${escapeAttr(entry.uid)}" type="checkbox" name="entryIds" data-wb-worldbook-entry-id="${escapeAttr(entry.uid)}"
                                                value="${escapeAttr(entry.uid)}" ${worldbookSelectedIds.has(String(entry.uid)) ? 'checked' : ''}>
                                            <span>
                                                <span class="wb-worldbook-entry-heading">
                                                    <strong>${escapeHtml(entry.parsedName || entry.name)}</strong>
                                                    ${entry.likelyPerson ? '<em>疑似人物</em>' : ''}
                                                    ${entry.disabled ? '<em class="is-muted">已停用</em>' : ''}
                                                </span>
                                                ${entry.parsedName && entry.parsedName !== entry.name
                                                    ? `<small>条目：${escapeHtml(entry.name)} · ${escapeHtml((entry.keys || []).join('、') || `UID ${entry.uid}`)}</small>`
                                                    : `<small>${escapeHtml((entry.keys || []).join('、') || `UID ${entry.uid}`)}</small>`}
                                                ${entry.profile?.matchedFields?.length
                                                    ? `<div class="wb-worldbook-profile-hints">已识别：${escapeHtml(entry.profile.matchedFields.slice(0, 6).map(field => ({
                                                        name: '姓名', nickname: '别称', gender: '性别', age: '年龄', birthday: '生日', species: '种族', identity: '身份', personality: '人格', values: '偏好', mbti: 'MBTI', appearance: '外貌', height: '身高', body: '体型', clothing: '穿着', background: '背景', relations: '关系', speech: '说话', behavior: '行为边界',
                                                    }[field] || field)).join('、'))}</div>`
                                                    : ''}
                                                <p>${escapeHtml(entry.content.slice(0, 220))}${entry.content.length > 220 ? '…' : ''}</p>
                                            </span>
                                        </label>
                                    `).join('') : `<div class="wb-worldbook-empty">当前筛选下没有条目。可以取消筛选或换个关键词。</div>`}
                                </div>
                                <button class="wb-primary-button wb-worldbook-import-button" type="submit" ${worldbookSelectedCount ? '' : 'disabled'}>
                                    ${worldbookSelectedCount ? `导入已选人物（${worldbookSelectedCount}）` : '请选择要导入的人物'}
                                </button>
                            </div>
                        ` : ''}
                    </form>
                    </div>
                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="memory" ${groupOpen('memory')}>
                <summary><span>长期记忆</span><small>自动整理与历史建档</small></summary>
                <div class="wb-settings-group-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="memory-switches" ${subgroupOpen('memory-switches')}>
                        <summary><span>记忆开关</span><small>整理与正文注入</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-setting-toggle">
                <div><strong>启用记忆系统</strong><span>关掉我就不再塞新纸片～已经收好的记忆，我会原样压住。</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="memorySystemEnabled"
                        ${settings.memorySystemEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <p class="wb-setting-explanation">要不要把记忆叼给正文看，请去「正文注入」告诉我～这里仅管记忆盒子本身还收不收新东西。</p>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="memory-history" ${subgroupOpen('memory-history')}>
                        <summary><span>自动整理</span><small>进度与手动整理</small></summary>
                        <div class="wb-settings-subgroup-body">
            <div class="wb-history-settings">
                <div class="wb-history-heading">
                    <div>
                        <label>记忆整理</label>
                        <strong>${escapeHtml(
                            historyRunning
                                ? memory.message || '正在收拾记忆～'
                                : '会自己收拾长期记忆～',
                        )}</strong>
                    </div>
                    <span>${historyRunning ? `${historyPercent}%` : (Number(memory.pendingAssistantResponses || 0) > 0 ? '有新的东西等我收～' : '我已经跟上正文啦～')}</span>
                </div>
                ${historyRunning ? `
                    <div class="wb-history-progress"><i style="width:${historyPercent}%"></i></div>
                ` : ''}
                <p>会自动整理新增正文～重要事实、关系、承诺和没收尾的伏笔会乖乖留下来 (｡•̀ᴗ-)✧</p>
                <div class="wb-memory-queue">
                    <span>待整理 ${Math.max(0, Number(memory.pendingAssistantResponses || 0))} 条正文</span>
                    <strong>${settings.memoryAutoIndexInterval > 0
                        ? `自动 · 每 ${settings.memoryAutoIndexInterval} 轮`
                        : '手动整理'}</strong>
                </div>
                <label>整理方式</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 0, '手动')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 5, '每 5 轮')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 10, '每 10 轮')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 20, '每 20 轮')}
                </div>
                <label class="wb-number-setting">
                    自定义间隔（轮）
                    <input type="number" min="0" max="50" step="1"
                        data-wb-setting="memoryAutoIndexInterval"
                        value="${escapeAttr(settings.memoryAutoIndexInterval)}">
                </label>
                <button type="button" data-wb-action="scan-history"
                    ${historyRunning || !settings.memorySystemEnabled ? 'disabled' : ''}>
                    ${Number(memory.indexedThroughMessageId ?? -1) < 0 ? '整理当前记忆' : '立即整理'}
                </button>
            </div>
                        </div>
                    </details>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="calendar" ${groupOpen('calendar')}>
                <summary><span>日历</span><small>主世界时间、校准与快进</small></summary>
                <div class="wb-settings-group-body">
                    <form class="wb-clock-form" data-wb-form="clock">
                        <div class="wb-clock-form-heading">
                            <div><label>主世界日历</label><strong>${escapeHtml(clockLabel)}</strong></div>
                            <span>每个聊天独立保存</span>
                        </div>
                        <label class="wb-calendar-name-field">
                            历法名称
                            <input name="calendarName" maxlength="40"
                                value="${escapeAttr(clock.calendarName)}" placeholder="例如：帝国历">
                        </label>
                        <div class="wb-calendar-date-fields">
                            <label><input name="year" type="number" min="1" max="999999"
                                value="${clock.year}"> 年</label>
                            <label><input name="month" type="number" min="1" max="12"
                                value="${clock.month}"> 月</label>
                            <label><input name="day" type="number" min="1" max="31"
                                value="${clock.dayOfMonth}"> 日</label>
                        </div>
                        <div class="wb-clock-fields">
                            <label><input name="hour" type="number" min="0" max="23" value="${clock.hour}"> 时</label>
                            <label><input name="minute" type="number" min="0" max="59" value="${clock.minute}"> 分</label>
                            <button type="button" data-wb-action="sync-clock-from-story">与正文校准</button>
                            <button type="submit" class="wb-clock-manual-save">手动设定</button>
                        </div>
                        <p class="wb-clock-sync-note">正文真的说清楚时间，我会自己跟上～如果你比我更清楚，也可以在这里直接告诉我现在几点。</p>
                        <div class="wb-time-actions">
                            <button type="button" data-wb-action="advance-clock" data-minutes="60">+ 1 小时</button>
                            <button type="button" data-wb-action="advance-clock" data-minutes="360">+ 6 小时</button>
                            <button type="button" data-wb-action="advance-clock" data-minutes="1440">+ 1 天</button>
                        </div>
                    </form>
                </div>
            </details>

            <details class="wb-settings-group wb-settings-advanced-section" data-settings-group="advanced" ${sectionKey === 'advanced' ? 'open' : groupOpen('advanced')}>
                <summary><span>高级与维护</span><small>硬硬的东西……我先压在窝里面</small></summary>
                <div class="wb-settings-group-body wb-advanced-settings-body wb-settings-subgroup-stack">
                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-generation" ${subgroupOpen('advanced-generation')}>
                        <summary><span>生成限制</span><small>Token 与单次等待时间</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-setting-block">
                                <label>全局 Token 上限</label>
                                <div class="wb-option-row wb-option-row-four">
                                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 0, '自动')}
                                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 4000, '4K')}
                                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 8000, '8K')}
                                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 12000, '12K')}
                                </div>
                                <label class="wb-number-setting">
                                    自定义 Token 上限
                                    <input type="number" min="0" step="500"
                                        data-wb-setting="maxOutputTokens"
                                        value="${escapeAttr(settings.maxOutputTokens)}">
                                </label>
                                <p class="wb-setting-explanation">0 就让我自己算～世界推演用全局预算，小任务会各自收口；服务端上限更低时以服务端为准。</p>
                            </div>

                            <div class="wb-setting-block">
                                <label>全局最长等待</label>
                                <div class="wb-option-row wb-option-row-four">
                                    ${settingButton('generationTimeoutMs', settings.generationTimeoutMs, 0, '自动')}
                                    ${settingButton('generationTimeoutMs', settings.generationTimeoutMs, 60000, '60s')}
                                    ${settingButton('generationTimeoutMs', settings.generationTimeoutMs, 120000, '120s')}
                                    ${settingButton('generationTimeoutMs', settings.generationTimeoutMs, 180000, '180s')}
                                </div>
                                <label class="wb-number-setting">
                                    自定义等待秒数
                                    <input type="number" min="0" max="600" step="15"
                                        data-wb-setting-seconds="generationTimeoutMs"
                                        value="${escapeAttr(settings.generationTimeoutMs ? Math.round(settings.generationTimeoutMs / 1000) : 0)}">
                                </label>
                                <p class="wb-setting-explanation">0 就让我自己看着办～只数模型真正生成的时间，切后台、限流冷却和排队都不算。</p>
                            </div>

                            <details class="wb-generation-module-overrides">
                                <summary>按模块单独设置 <small>留 0 就继承全局</small></summary>
                                <div class="wb-generation-module-list">
                                    ${generationModuleRow('simulation')}
                                    ${generationModuleRow('observation')}
                                    ${generationModuleRow('history')}
                                    ${generationModuleRow('opinion')}
                                </div>
                            </details>

                            <div class="wb-generation-defaults">
                                <strong>自动等待参考</strong>
                                <span>世界推演 180s · 人物观测 120s · 历史/记忆 300s · 舆情/闲逛 150s</span>
                            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-data" ${subgroupOpen('advanced-data')}>
                        <summary><span>数据备份</span><small>我先帮这个世界留一份保险</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="export-state">导出当前世界</button>
                                <button type="button" data-wb-action="import-state">导入世界状态</button>
                                <input class="wb-import-input" type="file" accept=".json,application/json">
                            </div>
                            <p>要搬家、测试或者大改之前，先让我把这个世界装进小盒子里留一份吧～丢了会很难捡。</p>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-maintenance" ${subgroupOpen('advanced-maintenance')}>
                        <summary><span>数据维护</span><small>清缓存 / 重置当前聊天</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-maintenance-card">
                                <div>
                                    <strong>清理当前聊天缓存</strong>
                                    <p>我只扫掉临时碎屑～人物、记忆和世界状态，一爪都不碰。</p>
                                </div>
                                <button type="button" data-wb-action="clear-current-chat-cache">清理缓存</button>
                            </div>
                            <div class="wb-maintenance-card">
                                <div>
                                    <strong>让玲七检查世界状态</strong>
                                    <p>我拿正文和明确事实再对一遍。后台错了我改，已经发生的正文不碰。</p>
                                </div>
                                <button type="button" data-wb-action="check-correct-world-state">检查纠错</button>
                            </div>
                            <div class="wb-maintenance-card is-danger">
                                <div>
                                    <strong>重置当前聊天数据</strong>
                                    <p>这次是真的把这只箱子倒空。正文和 API / 模型配置我不碰。</p>
                                    <small>不可撤回～要留着就先备份，旧世界也不会再从床底下诈尸。</small>
                                </div>
                                <button type="button" class="is-danger" data-wb-action="reset-current-chat-data">一键重置</button>
                            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-tagfilter" ${subgroupOpen('advanced-tagfilter')}>
                        <summary><span>正文过滤</span><small>变量块、脚本块……硬硬的，不好吃。我只把真正的叙事叼给后台。</small></summary>
                        <div class="wb-settings-subgroup-body">
                    <div class="wb-setting-toggle">
                        <div><strong>启用标签过滤</strong><span>关掉以后 HTML 注释我还是会先挑出去，不吞。</span></div>
                        <label class="wb-switch">
                            <input type="checkbox" data-wb-setting="tagFilterEnabled"
                                ${settings.tagFilterEnabled !== false ? 'checked' : ''}>
                            <i></i>
                        </label>
                    </div>
                    <div class="wb-setting-block">
                        <div class="wb-narrative-filter-shortcuts">
                            <label>只读取某个正文标签（可选）
                                <input type="text" maxlength="80" data-wb-setting="narrativeIncludeTag"
                                    value="${escapeAttr(settings.narrativeIncludeTag || '')}"
                                    placeholder="例如 narrative（不用写 &lt; &gt;）" autocomplete="off" spellcheck="false">
                                <small>本条有这个标签时就只取标签里面；没有时保留原文，不会一口吃空～</small>
                            </label>
                            <label>额外正则排除（可选）
                                <textarea rows="3" maxlength="2200" data-wb-setting="narrativeRegexFilters"
                                    placeholder="一行一条，例如：&lt;UpdateVariable&gt;[\s\S]*?&lt;/UpdateVariable&gt;">${escapeHtml(settings.narrativeRegexFilters || '')}</textarea>
                                <small>最多 8 条～变量块、状态栏或预设附加内容都可以在进后台前先摘掉。</small>
                            </label>
                        </div>
                        <p>HTML 注释 <code>&lt;!-- ... --&gt;</code> 会整块拿掉～下面这些成对标签也可以直接排除；不需要懂正则也能用 (｡•̀ᴗ-)✧</p>
                        <div class="wb-tag-filter-list">
                            ${rules.map((rule, index) => `
                                <div class="wb-tag-filter-rule" data-tag-filter-index="${index}">
                                    <div class="wb-tag-filter-rule-head">
                                        <strong>规则 ${index + 1}</strong>
                                        <button type="button" class="wb-tag-filter-remove is-delete"
                                            data-wb-action="remove-tag-filter-rule"
                                            data-index="${index}">删除</button>
                                    </div>
                                    <label>开头标签 <span>（可空）</span>
                                        <input type="text" maxlength="80"
                                            data-wb-tag-filter-field="open" data-index="${index}"
                                            value="${escapeAttr(rule.open || '')}"
                                            placeholder="例如 &lt;options&gt;"
                                            autocomplete="off" spellcheck="false">
                                    </label>
                                    <label>结尾标签 <span>（可空）</span>
                                        <input type="text" maxlength="80"
                                            data-wb-tag-filter-field="close" data-index="${index}"
                                            value="${escapeAttr(rule.close || '')}"
                                            placeholder="例如 &lt;/options&gt;"
                                            autocomplete="off" spellcheck="false">
                                    </label>
                                </div>
                            `).join('')}
                        </div>
                        <div class="wb-tag-auto-tools">
                            <div class="wb-tag-auto-head">
                                <div><strong>自动提取候选</strong><span>我只把可疑标签扒出来给你看～不会擅自塞进规则。</span></div>
                                <div class="wb-tag-auto-actions">
                                    <button type="button" data-wb-action="scan-tag-candidates" data-count="1">扫描最新正文</button>
                                    <button type="button" data-wb-action="scan-tag-candidates" data-count="5">扫描最近 5 条</button>
                                </div>
                            </div>
                            ${tagCandidates.length ? `
                                <div class="wb-tag-candidate-list">
                                    ${tagCandidates.map((item, index) => `
                                        <label class="wb-tag-candidate ${item.broad ? 'is-risky' : ''} ${item.alreadyAdded ? 'is-added' : ''}">
                                            <input type="checkbox" data-wb-tag-candidate-index="${index}"
                                                ${item.recommended ? 'checked' : ''} ${item.alreadyAdded ? 'disabled' : ''}>
                                            <span>
                                                <strong>&lt;${escapeHtml(item.tagName)}&gt;${item.alreadyAdded ? ' · 已添加' : ''}</strong>
                                                <small>${item.count} 次${item.broad ? ' · 范围较宽，建议确认后再加' : ''}</small>
                                                <code>${escapeHtml(item.open)} … ${escapeHtml(item.close)}</code>
                                            </span>
                                        </label>
                                    `).join('')}
                                </div>
                                <button type="button" class="wb-tag-filter-add" data-wb-action="apply-tag-candidates">添加选中候选</button>
                            ` : '<p class="wb-tag-auto-empty">点击扫描后，插件会把疑似成对标签列出来供你确认。</p>'}
                        </div>

                        <button type="button" class="wb-tag-filter-add"
                            data-wb-action="add-tag-filter-rule"
                            ${rules.filter(rule => String(rule.open || '').trim() || String(rule.close || '').trim()).length >= 30 ? 'disabled' : ''}>
                            ＋ 添加规则
                        </button>
                    </div>

                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-recovery" ${subgroupOpen('advanced-recovery')}>
                        <summary><span>安全恢复</span><small>${latestRecovery ? escapeHtml(latestRecovery.label) : '我替这个世界留的保险'}</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <div class="wb-maintenance-status">
                                <strong>${latestRecovery ? escapeHtml(latestRecovery.label) : '还没有恢复点'}</strong>
                                <span>${latestRecovery ? escapeHtml(formatLocalTimestamp(latestRecovery.createdAt)) : '每个聊天我分开留'}</span>
                            </div>
                            <p>${latestRecovery
                                ? `当前保存 ${Math.max(1, Number(recovery.count) || 1)} 个恢复点，恢复后仍会先替现在的状态留一份保险。`
                                : '升级旧数据、导入世界状态时我会先留一份～你也可以现在就让我存个保险。'}</p>
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="create-recovery-point">立即保存恢复点</button>
                                <button type="button" data-wb-action="restore-latest-recovery" ${latestRecovery ? '' : 'disabled'}>恢复最近保存</button>
                            </div>
                        </div>
                    </details>

                    <details class="wb-settings-subgroup" data-settings-subgroup="advanced-diagnostics" ${subgroupOpen('advanced-diagnostics')}>
                        <summary><span>故障诊断</span><small>我把抓虫需要的东西叼出来</small></summary>
                        <div class="wb-settings-subgroup-body">
                            <p>我只把抓虫需要的版本、设备、接口模式和错误状态叼出来。Key、接口地址、正文和角色私密设定？那些我压住，不往外叼。</p>
                            <div class="wb-setting-actions">
                                <button type="button" data-wb-action="copy-diagnostics">把诊断叼出来</button>
                                <button type="button" data-wb-action="preview-notice">看看提示样式</button>
                            </div>
                        </div>
                    </details>
                </div>
            </details>

        </div>
    `;
}


function renderModuleSettings(state, settings, syncStatus, scope = 'now', openSubgroups = new Set(), worldbookUi = {}) {
    const scopeMeta = {
        now: { eyebrow: '玲七在看', title: '此刻设置' },
        people: { eyebrow: '玲七在看', title: '人物设置' },
        currents: { eyebrow: '玲七在看', title: '暗流设置' },
        opinion: { eyebrow: '玲七在听', title: '舆情设置' },
        memory: { eyebrow: '玲七在收拾', title: '记忆设置' },
    };
    const scopeKey = Object.hasOwn(scopeMeta, scope) ? scope : 'now';
    const scopeInfo = scopeMeta[scopeKey];
    const clock = formatWorldCalendar(state);
    const clockLabel = worldClockLabel(state, clock);
    const memory = syncStatus?.memory || {};
    const historyRunning = memory.phase === 'running';
    const historyPercent = memory.total > 0
        ? Math.min(100, Math.round((Number(memory.processed) || 0) / memory.total * 100))
        : 0;
    const worldbook = syncStatus?.worldbook || { books: [], entries: [], phase: 'idle' };
    const worldbookBooks = Array.isArray(worldbook.books) ? worldbook.books : [];
    const worldbookEntries = Array.isArray(worldbook.entries) ? worldbook.entries : [];
    const worldbookQuery = String(worldbookUi.query || '').slice(0, 120);
    const worldbookOnlyPeople = Boolean(worldbookUi.onlyPeople);
    const worldbookOnlyEnabled = Boolean(worldbookUi.onlyEnabled);
    const worldbookSelectedIds = worldbookUi.selectedIds instanceof Set
        ? worldbookUi.selectedIds
        : new Set(Array.isArray(worldbookUi.selectedIds) ? worldbookUi.selectedIds.map(String) : []);
    const filteredWorldbookEntries = filterWorldbookEntries(worldbookEntries, {
        query: worldbookQuery,
        onlyPeople: worldbookOnlyPeople,
        onlyEnabled: worldbookOnlyEnabled,
    });
    const worldbookSelectedCount = worldbookSelectedIds.size;
    const apiProfiles = Array.isArray(settings.apiProfiles) ? settings.apiProfiles : [];
    const apiModuleRoutes = settings.apiModuleRoutes && typeof settings.apiModuleRoutes === 'object'
        ? settings.apiModuleRoutes
        : {};
    const routeOptions = (current = 'default') => [
        `<option value="default" ${current === 'default' ? 'selected' : ''}>跟随世界背面默认连接</option>`,
        `<option value="tavern" ${current === 'tavern' ? 'selected' : ''}>跟随当前酒馆</option>`,
        ...apiProfiles.map(profile => {
            const value = `profile:${profile.id}`;
            return `<option value="${escapeAttr(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未选模型')}</option>`;
        }),
    ].join('');
    const settingButton = (setting, current, id, label) => `
        <button type="button" data-wb-action="setting-button"
            data-setting="${setting}" data-value="${id}"
            class="${String(current) === String(id) ? 'is-active' : ''}">${label}</button>
    `;
    const densityButton = (id, label) => settingButton('deliveryDensity', settings.deliveryDensity, id, label);
    const explanation = (setting, value) => ({
        deliveryDensity: {
            restrained: '我少往镜头边叼东西～后台该活的还是照样活。',
            balanced: '重要的我叼到镜头边，不重要的先压爪爪下面。嗯，这样不乱。',
            active: '我会更勤快地把变化叼到镜头边～但正忙的时候我也不会硬扑进去。',
        },
        autoSimulationMode: {
            light: '我趴着轻轻看～只管真有必要的变化，不到处乱跑。',
            balanced: '我会挨个看一眼～该动的自己动，没事我就不拿爪子乱拨。',
            deep: '我会蹲久一点，把镜头外的人和因果都盯仔细～复杂世界用这个。',
        },
        timePolicy: {
            world: '我守着世界钟～正文真说清楚几点，我就把小爪子拨过去。',
            explicit: '真的算得出来我才拨。算不准？那我不碰。',
            cautious: '可以让我猜一点点～但不确定我就把爪子收回来。',
            open: '旅行、等待、工作这种一看就会花时间的事，我就顺手把钟往前推。',
        },
        publicOpinionRevealMode: {
            observe: '我把外面的风声都压在这个角落～你来看我再掀给你，不往正文叼。',
            relevant: '真和眼前这段剧情有关系，我才叼过去一点～没关系的我继续压着。',
        },
        worldPulseActivity: {
            quiet: '世界还是会动～只是我少折腾公共变化，让外面安静一点。',
            natural: '我按平常节奏看着城市、组织、天气和社会～该变的自己变。',
            busy: '我会多留意一点镜头外的动静～但不会拿重大事故和灾难硬凑热闹。',
        },
    }[setting]?.[String(value)] || '');
    const advancedOpen = id => openSubgroups.has(id) ? 'open' : '';
    const sectionHeading = (title, note = '') => `
        <div class="wb-flat-section-heading">
            <div><strong>${escapeHtml(title)}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div>
        </div>
    `;
    const routeSetting = (key, title, note = '') => `
        <div class="wb-setting-block wb-route-setting">
            <label>${escapeHtml(title)}</label>
            <select data-wb-api-route="${escapeAttr(key)}">${routeOptions(apiModuleRoutes[key] || 'default')}</select>
            ${note ? `<p class="wb-setting-explanation">${escapeHtml(note)}</p>` : ''}
        </div>
    `;
    const injectionStatusCard = (label, enabled, detail = '') => `
        <div class="wb-module-visibility-card ${enabled ? 'is-on' : 'is-off'}">
            <div>
                <span>爪爪这边要不要递</span>
                <strong>${escapeHtml(label)} · ${enabled ? '我会叼过去' : '先压爪爪下面'}</strong>
                ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
            </div>
            <button type="button" data-wb-action="open-global-settings-section" data-section="injection">去翻一下</button>
        </div>
    `;
    const worldBackground = String(state.world?.background || '').trim();
    const worldBackgroundLength = worldBackground.length;

    const nowHtml = `
        ${injectionStatusCard(
            '此刻 · 世界时间 / 背景',
            settings.worldPromptInjection && settings.injectionTimeMode !== 'off' && settings.injectionWorldBackground !== false,
            `时间：${settings.injectionTimeMode === 'full' ? '完整' : settings.injectionTimeMode === 'anchor' ? '最小锚点' : '关闭'} · 背景：${settings.injectionWorldBackground !== false ? '开' : '关'}`,
        )}
        <div class="wb-flat-setting-list">
            <div class="wb-setting-block">
                <label>正文读取范围</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('contextTurns', settings.contextTurns, 1, '最近 1 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 3, '最近 3 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 5, '最近 5 轮')}
                    <button type="button" data-wb-action="setting-button" data-setting="contextTurns"
                        data-value="${escapeAttr(settings.customContextTurns || 8)}"
                        class="${![1, 3, 5].includes(Number(settings.contextTurns)) ? 'is-active' : ''}">自定义</button>
                </div>
                ${![1, 3, 5].includes(Number(settings.contextTurns)) ? `
                    <label class="wb-number-setting wb-context-custom">读取最近几轮
                        <input type="number" min="1" max="30" step="1" data-wb-setting="contextTurns" value="${escapeAttr(settings.contextTurns)}">
                    </label>` : ''}
                <p class="wb-setting-explanation">${escapeHtml(
                    [1, 3, 5].includes(Number(settings.contextTurns))
                        ? ({1: '我只看最新一轮～轻轻的，最省。', 3: '我往回看 3 轮～日常剧情一般够啦。', 5: '我往回看 5 轮～连续性和消耗比较刚好。'}[Number(settings.contextTurns)])
                        : `我现在会往回看 ${settings.contextTurns} 轮～长事件更稳，不过 Token 也会跟着长胖。`
                )}</p>
            </div>
            <details class="wb-setting-block wb-world-background-setting" data-settings-subgroup="now-world-background" ${advancedOpen('now-world-background')}>
                <summary class="wb-world-background-heading">
                    <strong>世界背景设定</strong>
                    <span class="${worldBackground ? 'is-set' : ''}">${worldBackground ? `已设定 · ${worldBackgroundLength} 字` : '未设定'}</span>
                </summary>
                <div class="wb-world-background-body">
                    <div class="wb-world-background-preview ${worldBackground ? 'is-set' : 'is-empty'}">
                        ${escapeHtml(worldBackground
                            ? compactText(worldBackground, 150)
                            : '把这个世界长期成立的时代、地理、势力、规则和重要时间线写给我～我会一直拿它当地基。')}
                    </div>
                    <button class="wb-world-background-action" type="button" data-wb-action="open-world-editor">
                        ${worldBackground ? '编辑世界背景' : '开始设定世界背景'}
                    </button>
                </div>
            </details>
            <div class="wb-setting-block">
                <label>时间推进</label>
                <div class="wb-option-row">
                    ${settingButton('timePolicy', settings.timePolicy, 'world', '世界钟')}
                    ${settingButton('timePolicy', settings.timePolicy, 'explicit', '严格')}
                    ${settingButton('timePolicy', settings.timePolicy, 'cautious', '克制')}
                    ${settingButton('timePolicy', settings.timePolicy, 'open', '开放')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(explanation('timePolicy', settings.timePolicy))}</p>
            </div>
        </div>
        ${sectionHeading('世界钟', '时间我来盯～你也可以自己拨一拨')}
        <form class="wb-clock-form wb-flat-clock-form" data-wb-form="clock">
            <div class="wb-clock-form-heading"><div><label>主世界日历</label><strong>${escapeHtml(clockLabel)}</strong></div><span>每个聊天我分开记</span></div>
            <label class="wb-calendar-name-field">历法名称<input name="calendarName" maxlength="40" value="${escapeAttr(clock.calendarName)}" placeholder="例如：帝国历"></label>
            <div class="wb-calendar-date-fields">
                <label><input name="year" type="number" min="1" max="999999" value="${clock.year}"> 年</label>
                <label><input name="month" type="number" min="1" max="12" value="${clock.month}"> 月</label>
                <label><input name="day" type="number" min="1" max="31" value="${clock.dayOfMonth}"> 日</label>
            </div>
            <div class="wb-clock-fields">
                <label><input name="hour" type="number" min="0" max="23" value="${clock.hour}"> 时</label>
                <label><input name="minute" type="number" min="0" max="59" value="${clock.minute}"> 分</label>
                <button type="button" data-wb-action="sync-clock-from-story">与正文校准</button>
                <button type="submit" class="wb-clock-manual-save">手动设定</button>
            </div>
            <p class="wb-clock-sync-note">正文真的说清楚时间，我会自己跟上～如果你比我更清楚，也可以在这里直接告诉我现在几点。</p>
            <div class="wb-time-actions">
                <button type="button" data-wb-action="advance-clock" data-minutes="60">+ 1 小时</button>
                <button type="button" data-wb-action="advance-clock" data-minutes="360">+ 6 小时</button>
                <button type="button" data-wb-action="advance-clock" data-minutes="1440">+ 1 天</button>
            </div>
        </form>
    `;

    const peopleHtml = `
        ${injectionStatusCard(
            '人物 · 当前状态',
            settings.worldPromptInjection && settings.injectionPeople !== false,
            '不叼给正文看也没关系～他们还是会在背后生活，我会记着。',
        )}
        <div class="wb-person-group-life-note">
            <span>群体生活 · 默认生效</span>
            <strong>同地、同行、同组织和共同事件，我会放在同一轮里对账～</strong>
            <small>真有互动就给双方都留下结果；没碰面就各过各的。它复用现有人物合批推演，不会为“群体感”多开一轮 API。</small>
        </div>
        <div class="wb-flat-setting-list">
            <div class="wb-setting-block">
                <label>后台 NPC 预算</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 0, '不主动推演')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 2, '最多 2 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 4, '最多 4 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 8, '最多 8 人')}
                </div>
                <label class="wb-number-setting">自定义单轮人数
                    <input type="number" min="0" step="1" data-wb-setting="backgroundNpcBudget" value="${escapeAttr(settings.backgroundNpcBudget)}">
                </label>
                <p class="wb-setting-explanation">想盯多少人都可以自己填～推荐 2～8 人，单轮尽量别超过 12 人；越大越吃 Token，也会更慢。</p>
            </div>
            <div class="wb-setting-toggle">
                <div><strong>强化后台人物推演</strong><span>开着的话，该结算的人我就顺爪捞进这轮世界推演一起看～不单独再跑一趟。</span></div>
                <label class="wb-switch"><input type="checkbox" data-wb-setting="enhancedBackgroundSimulation" ${settings.enhancedBackgroundSimulation ? 'checked' : ''}><i></i></label>
            </div>
            <div class="wb-setting-toggle">
                <div><strong>记录玩家角色</strong><span>关掉我就不单独给 user 立人物小牌子～但正文里真发生过的事，我认。不能装没看见。</span></div>
                <label class="wb-switch"><input type="checkbox" data-wb-setting="recordPlayerCharacter" ${settings.recordPlayerCharacter !== false ? 'checked' : ''}><i></i></label>
            </div>
            ${routeSetting('observation', '我看人物时使用的连接', '这里只告诉我看人物时走哪条路～Key 和地址还是放在全局连接里。')}
        </div>
        <details class="wb-settings-subgroup wb-module-advanced" data-settings-subgroup="people-worldbook" ${advancedOpen('people-worldbook')}>
            <summary><span>世界书人物导入</span><small>要把新人介绍给我时再掀开～我先闻闻是谁。</small></summary>
            <div class="wb-module-advanced-body">
                <form class="wb-worldbook-import" data-wb-form="worldbook">
                    <label>选择世界书
                        <select name="bookName" ${worldbookBooks.length ? '' : 'disabled'}>
                            ${worldbookBooks.length
                                ? worldbookBooks.map(book => `<option value="${escapeAttr(book)}" ${book === worldbook.bookName ? 'selected' : ''}>${escapeHtml(book)}</option>`).join('')
                                : '<option value="">我现在没找到能读的世界书</option>'}
                        </select>
                    </label>
                    <div class="wb-worldbook-action-row">
                        <button class="wb-primary-button wb-worldbook-smart-button" type="button" data-wb-action="smart-import-worldbook-people" ${worldbook.phase === 'running' || !worldbookBooks.length ? 'disabled' : ''}>
                            ${worldbook.phase === 'running' ? '正在读取…' : '一键智能导入人物'}
                        </button>
                        <button class="wb-worldbook-scan-button" type="button" data-wb-action="scan-worldbook" ${worldbook.phase === 'running' || !worldbookBooks.length ? 'disabled' : ''}>
                            高级手动挑选
                        </button>
                    </div>
                    <p class="wb-setting-explanation">MVU、变量、脚本这些我先绕开。人物和势力挤在一张纸上？唔……我先把真正的人叼出来，不把一整个组织当成人。</p>
                    ${worldbook.message ? `<div class="wb-worldbook-status is-${escapeAttr(worldbook.phase)}">${escapeHtml(worldbook.message)}</div>` : ''}
                    ${worldbookEntries.length ? `
                        <div class="wb-worldbook-browser">
                            <label class="wb-worldbook-search"><span>搜索条目</span><input type="search" name="worldbookSearch" data-wb-worldbook-search value="${escapeAttr(worldbookQuery)}" placeholder="搜人物名、条目名、关键词或正文"></label>
                            <div class="wb-worldbook-filter-row">
                                <label class="wb-worldbook-filter-chip ${worldbookOnlyPeople ? 'is-active' : ''}"><input type="checkbox" data-wb-worldbook-filter="people" ${worldbookOnlyPeople ? 'checked' : ''}><span>只看疑似人物</span></label>
                                <label class="wb-worldbook-filter-chip ${worldbookOnlyEnabled ? 'is-active' : ''}"><input type="checkbox" data-wb-worldbook-filter="enabled" ${worldbookOnlyEnabled ? 'checked' : ''}><span>只看启用条目</span></label>
                            </div>
                            <div class="wb-worldbook-toolbar"><span>候选 ${worldbookEntries.filter(entry => entry.importablePerson ?? entry.likelyPerson).length} 人 · 当前 ${filteredWorldbookEntries.length} 条 · 已选 ${worldbookSelectedCount} 人</span><div>
                                <button type="button" data-wb-action="select-worldbook-visible" ${filteredWorldbookEntries.some(entry => entry.importablePerson ?? entry.likelyPerson) ? '' : 'disabled'}>全选当前人物</button>
                                <button type="button" data-wb-action="clear-worldbook-visible" ${filteredWorldbookEntries.length ? '' : 'disabled'}>取消当前</button>
                            </div></div>
                            <div class="wb-worldbook-entry-list">
                                ${filteredWorldbookEntries.length ? filteredWorldbookEntries.map(entry => {
                                    const importable = Boolean(entry.importablePerson ?? entry.likelyPerson);
                                    const badge = entry.embeddedPerson
                                        ? '<em>从混合条目拆出</em>'
                                        : entry.smartAuto
                                            ? '<em>人物</em>'
                                            : importable
                                                ? '<em>建议确认</em>'
                                                : entry.technicalEntry
                                                    ? '<em class="is-muted">技术 / MVU</em>'
                                                    : entry.mixedSource
                                                        ? '<em class="is-muted">混合设定</em>'
                                                        : '';
                                    return `
                                    <label class="wb-worldbook-entry ${entry.disabled ? 'is-disabled-entry' : ''} ${importable ? 'is-person-candidate' : ''} ${entry.embeddedPerson ? 'is-embedded-person' : ''}">
                                        <input id="wb-worldbook-entry-${escapeAttr(entry.uid)}" type="checkbox" name="entryIds" data-wb-worldbook-entry-id="${escapeAttr(entry.uid)}" value="${escapeAttr(entry.uid)}" ${worldbookSelectedIds.has(String(entry.uid)) ? 'checked' : ''} ${importable ? '' : 'disabled'}>
                                        <span><span class="wb-worldbook-entry-heading"><strong>${escapeHtml(entry.parsedName || entry.name)}</strong>${badge}${entry.disabled ? '<em class="is-muted">已停用</em>' : ''}</span>
                                            <small>${escapeHtml(entry.embeddedPerson && entry.sourceEntryName ? `来自：${entry.sourceEntryName}` : ((entry.keys || []).join('、') || `UID ${entry.sourceUid || entry.uid}`))}</small>
                                            <p>${escapeHtml(entry.content.slice(0, 220))}${entry.content.length > 220 ? '…' : ''}</p>
                                        </span>
                                    </label>`;
                                }).join('') : '<div class="wb-worldbook-empty">这里没找到合适的条目～换个关键词或者松一点筛选再让我找找。</div>'}
                            </div>
                            <button class="wb-primary-button wb-worldbook-import-button" type="submit" ${worldbookSelectedCount ? '' : 'disabled'}>${worldbookSelectedCount ? `导入已选人物（${worldbookSelectedCount}）` : '请选择要导入的人物'}</button>
                        </div>` : ''}
                </form>
            </div>
        </details>
    `;

    const currentsHtml = `
        ${injectionStatusCard(
            '暗流 · 进行中事件 / 世界环境',
            settings.worldPromptInjection && settings.injectionEvents !== false,
            `回声：${settings.worldPromptInjection && settings.injectionEchoes !== false ? '我会递' : '我先留着'} · 世界事实：${settings.worldPromptInjection && settings.injectionFacts !== false ? '我会递' : '我先留着'}`,
        )}
        ${sectionHeading('世界运行', '镜头转开以后，我还蹲在那边看着～')}
        <div class="wb-flat-setting-list">
            <div class="wb-module-runtime-summary">
                <div><span>自动运行</span><strong>${settings.worldAutoEnabled ? '我会自己起来巡一圈' : '我趴着，等你戳我'}</strong></div>
                <button type="button" data-wb-action="open-global-settings-section" data-section="common">去常用设置</button>
            </div>
            <div class="wb-setting-block">
                <label>世界脉搏</label>
                <div class="wb-option-row">
                    ${settingButton('worldPulseActivity', settings.worldPulseActivity, 'quiet', '安静')}
                    ${settingButton('worldPulseActivity', settings.worldPulseActivity, 'natural', '自然')}
                    ${settingButton('worldPulseActivity', settings.worldPulseActivity, 'busy', '热闹')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(explanation('worldPulseActivity', settings.worldPulseActivity))}</p>
            </div>
            <div class="wb-setting-block">
                <label>世界运转强度</label>
                <div class="wb-option-row">
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'light', '轻量')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'balanced', '均衡')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'deep', '深入')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(explanation('autoSimulationMode', settings.autoSimulationMode))}</p>
            </div>
            <div class="wb-setting-block">
                <label>自动触发频率</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 1, '每轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 2, '每 2 轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 3, '每 3 轮')}
                    ${settingButton('autoSimulationInterval', settings.autoSimulationInterval, 5, '每 5 轮')}
                </div>
                <label class="wb-number-setting">自定义累计轮数<input type="number" min="1" max="20" step="1" data-wb-setting="autoSimulationInterval" value="${escapeAttr(settings.autoSimulationInterval)}"></label>
            </div>
            ${routeSetting('simulation', '我推演世界时使用的连接', '告诉我从哪条路出去推演就行～Key 和地址我回全局那个抽屉找。')}
        </div>
        <details class="wb-settings-subgroup wb-module-advanced" data-settings-subgroup="currents-advanced" ${advancedOpen('currents-advanced')}>
            <summary><span>高级</span><small>这里是失败了以后我该怎么办</small></summary>
            <div class="wb-module-advanced-body wb-flat-setting-list">
                <div class="wb-setting-block">
                    <label>推演失败后要不要让我再试</label>
                    <div class="wb-option-row wb-option-row-four">
                        ${settingButton('autoRetryCount', settings.autoRetryCount, 0, '不重试')}
                        ${settingButton('autoRetryCount', settings.autoRetryCount, 1, '重试 1 次')}
                        ${settingButton('autoRetryCount', settings.autoRetryCount, 2, '重试 2 次')}
                        ${settingButton('autoRetryCount', settings.autoRetryCount, 3, '重试 3 次')}
                    </div>
                    <label class="wb-number-setting">最多再试几次<input type="number" min="0" max="5" step="1" data-wb-setting="autoRetryCount" value="${escapeAttr(settings.autoRetryCount)}"></label>
                </div>
                <label class="wb-custom-instruction">自定义推演要求<textarea data-wb-setting="customSimulationInstruction" maxlength="1000" rows="3" placeholder="例如：少制造新事件；多看看商会和港口。玲七会按这个方向留意。">${escapeHtml(settings.customSimulationInstruction)}</textarea></label>
            </div>
        </details>
    `;

    const opinionHtml = `
        ${injectionStatusCard(
            '舆情 · 新闻 / 论坛',
            settings.worldPromptInjection && settings.injectionPublicOpinion !== false,
            '外面的风声我还是会继续听～这里只告诉你，我要不要把它递给正文。',
        )}
        <div class="wb-flat-setting-list">
            <div class="wb-setting-toggle">
                <div>
                    <strong>自动更新舆情</strong>
                    <span>外面真有值得传的动静，我会自己竖耳朵听～关掉的话，你戳我我也会去听。</span>
                </div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="publicOpinionAutoEnabled"
                        ${settings.publicOpinionAutoEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-setting-block">
                <label>要不要让我把风声递近一点</label>
                <div class="wb-option-row">
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'observe', '仅观察')}
                    ${settingButton('publicOpinionRevealMode', settings.publicOpinionRevealMode, 'relevant', '相关时显露')}
                </div>
                <p class="wb-setting-explanation">${escapeHtml(explanation('publicOpinionRevealMode', settings.publicOpinionRevealMode))}</p>
            </div>
            ${routeSetting('opinion', '我听风声时使用的连接', '告诉我从哪条路出去听风声就好～接口本体我不在这里乱搬。')}
        </div>
        <p class="wb-flat-footnote">公开新闻会把真实影响接回人物和环境，不过要先对上世界事件，再顺着地点、工作、组织和消息渠道影响该碰到的人；论坛传闻仍只是风声，我不会让全世界突然一起知道～</p>
    `;

    const memoryHtml = `
        ${injectionStatusCard(
            '记忆 · 长期记忆',
            settings.worldPromptInjection && settings.injectionMemory !== false,
            '记忆盒子归记忆盒子，正文归正文。我要不要收拾，和要不要叼出去，是两回事。',
        )}
        <div class="wb-flat-setting-list">
            <div class="wb-setting-toggle">
                <div><strong>启用记忆系统</strong><span>关掉我就先不往记忆盒子里塞新纸片～已经放好的我压着，不丢。</span></div>
                <label class="wb-switch"><input type="checkbox" data-wb-setting="memorySystemEnabled" ${settings.memorySystemEnabled ? 'checked' : ''}><i></i></label>
            </div>
            ${routeSetting('history', '我整理记忆时使用的连接', '这里只告诉我整理记忆时走哪条路～Key 和地址不用再填一遍。')}
        </div>
        ${sectionHeading('中途接入', '我来晚了？没事。我可以从前面的聊天一路闻回来～')}
        <div class="wb-history-settings wb-flat-history-settings wb-world-bootstrap-settings">
            <div class="wb-history-heading">
                <div>
                    <label>把过去接成现在</label>
                    <strong>${escapeHtml(historyRunning && memory.kind === 'world-bootstrap'
                        ? memory.message || '我正在把前面的聊天一层层捡回来……别踩，我刚排好。'
                        : '时间、人物、事实、没走完的暗流和记忆，我一起叼回来排好')}</strong>
                </div>
                <span>${historyRunning && memory.kind === 'world-bootstrap' ? `${historyPercent}%` : '一次性提交'}</span>
            </div>
            ${historyRunning && memory.kind === 'world-bootstrap'
                ? `<div class="wb-history-progress"><i style="width:${historyPercent}%"></i></div>`
                : ''}
            <p>中途才把我叫来，也行～我先把前面都闻一遍，确认能接好才一次放进去。半路摔了？那我整筐都不倒进去。</p>
            <button type="button" data-wb-action="bootstrap-history" ${historyRunning ? 'disabled' : ''}>让玲七回溯当前聊天</button>
        </div>

        ${sectionHeading('记忆整理', '这里只让我整理记忆盒子～不会顺爪把整个世界翻一遍')}
        <div class="wb-history-settings wb-flat-history-settings">
            <div class="wb-history-heading"><div><label>长期记忆</label><strong>${escapeHtml(historyRunning && memory.kind !== 'world-bootstrap' ? memory.message || '我正在收拾记忆～' : '我会自己收拾长期记忆～')}</strong></div>
                <span>${historyRunning && memory.kind !== 'world-bootstrap' ? `${historyPercent}%` : (Number(memory.pendingAssistantResponses || 0) > 0 ? '有新的东西等我收～' : '我已经跟上正文啦～')}</span></div>
            ${historyRunning && memory.kind !== 'world-bootstrap' ? `<div class="wb-history-progress"><i style="width:${historyPercent}%"></i></div>` : ''}
            <p>重要事实、关系、承诺、没收尾的伏笔，我会挑出来压好。碎屑太多会把盒子塞爆，我才不要。</p>
            <div class="wb-memory-queue"><span>待整理 ${Math.max(0, Number(memory.pendingAssistantResponses || 0))} 条正文</span><strong>${settings.memoryAutoIndexInterval > 0 ? `自动 · 每 ${settings.memoryAutoIndexInterval} 轮` : '手动整理'}</strong></div>
            <label>整理方式</label>
            <div class="wb-option-row wb-option-row-four">
                ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 0, '手动')}
                ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 5, '每 5 轮')}
                ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 10, '每 10 轮')}
                ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 20, '每 20 轮')}
            </div>
            <label class="wb-number-setting">自定义间隔（轮）<input type="number" min="0" max="50" step="1" data-wb-setting="memoryAutoIndexInterval" value="${escapeAttr(settings.memoryAutoIndexInterval)}"></label>
            <button type="button" data-wb-action="scan-history" ${historyRunning || !settings.memorySystemEnabled ? 'disabled' : ''}>让玲七整理记忆</button>
        </div>
    `;

    const contentByScope = { now: nowHtml, people: peopleHtml, currents: currentsHtml, opinion: opinionHtml, memory: memoryHtml };
    return `
        <div class="wb-settings-popover wb-module-settings-popover wb-module-settings-${scopeKey}" role="dialog" aria-modal="true" aria-label="${escapeAttr(scopeInfo.title)}">
            <div class="wb-popover-heading">
                <div><span>${scopeInfo.eyebrow}</span><h3>${scopeInfo.title}</h3></div>
                <button type="button" data-wb-action="toggle-module-settings" data-view="${scopeKey}" aria-label="关闭设置">×</button>
            </div>
            <div class="wb-module-settings-body">${contentByScope[scopeKey]}</div>
        </div>
    `;
}

function renderEventModal(state, editorId = '') {
    const event = editorId
        ? state.events.find(item => item.id === editorId) || null
        : null;
    const isEdit = Boolean(event);
    const durationHours = Math.max(0, Number(event?.durationMinutes || 0) / 60);
    const durationValue = Number.isInteger(durationHours)
        ? String(durationHours)
        : String(Number(durationHours.toFixed(2)));
    const startedStamp = event
        ? formatWorldCalendar(state, event.startedAt).stamp
        : formatWorldCalendar(state).stamp;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-event-form">
            <form class="wb-event-form" data-wb-form="event">
                <div class="wb-form-heading">
                    <div><span>${isEdit ? 'EDIT CURRENT' : 'NEW CURRENT'}</span><h3>${isEdit ? '修改这条暗流' : '放入一条暗流'}</h3></div>
                    <button type="button" data-wb-action="close-event-form">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(event?.id || '')}">
                <label>事件名称<input name="title" required maxlength="140"
                    value="${escapeAttr(event?.title || '')}" placeholder="例如：修复一台旧通讯器"></label>
                <label>地点<input name="place" maxlength="140"
                    value="${escapeAttr(event?.place || '')}" placeholder="南岸维修站"></label>
                <label>正在发生什么<textarea name="summary" maxlength="420" rows="3">${escapeHtml(event?.summary || '')}</textarea></label>
                <label>预计结果<textarea name="expectedResult" maxlength="420" rows="2">${escapeHtml(event?.expectedResult || event?.consequence || '')}</textarea></label>
                <div class="wb-form-grid">
                    <label>计时方式
                        <select name="clockMode">
                            <option value="duration" ${event?.clockMode === 'duration' || !event ? 'selected' : ''}>自然流逝</option>
                            <option value="active" ${event?.clockMode === 'active' ? 'selected' : ''}>有效工时</option>
                            <option value="scheduled" ${event?.clockMode === 'scheduled' ? 'selected' : ''}>预定时间</option>
                            <option value="condition" ${event?.clockMode === 'condition' ? 'selected' : ''}>条件等待</option>
                        </select>
                    </label>
                    <label>预计耗时（小时）
                        <input name="durationHours" type="number" min="0" step="0.5"
                            value="${isEdit ? escapeAttr(durationValue) : '12'}">
                    </label>
                </div>
                <label>可见边界
                    <select name="visibility">
                        <option value="hidden" ${event?.visibility === 'hidden' || !event ? 'selected' : ''}>角色尚不可知</option>
                        <option value="trace" ${event?.visibility === 'trace' ? 'selected' : ''}>可由痕迹察觉</option>
                        <option value="known" ${event?.visibility === 'known' ? 'selected' : ''}>可经消息获知</option>
                        <option value="direct" ${event?.visibility === 'direct' ? 'selected' : ''}>可以直接感知</option>
                    </select>
                </label>
                <div class="wb-form-note">
                    ${isEdit
                        ? `这条暗流从 ${escapeHtml(startedStamp)} 开始。修改计时方式或耗时后，会沿用原始开始时间重新计算；只改文字不会改变已有进度。`
                        : `从 ${escapeHtml(formatWorldCalendar(state).stamp)} 开始计时。回复轮次不会增加进度。`}
                </div>
                <button class="wb-primary-button" type="submit">${isEdit ? '保存暗流修改' : '开始在后台发展'}</button>
            </form>
        </div>
    `;
}

function renderPersonDrawer(person, observerMode, worldMinute, {
    canObserve = false,
    observation = null,
    busy = false,
} = {}) {
    if (!person) return '';
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-person">
            <div class="wb-person-drawer" role="dialog" aria-modal="true" aria-label="人物详情">
                <button class="wb-drawer-close" type="button" data-wb-action="close-person">×</button>
                ${renderPersonAvatar(person, 'is-feature')}
                <span class="wb-drawer-overline">LIVING TRACE</span>
                <h3>${escapeHtml(person.name)}</h3>
                <p class="wb-drawer-place">${escapeHtml(person.location)}</p>
                <button class="wb-person-edit-button" type="button" data-wb-action="open-person-editor"
                    data-person-id="${escapeAttr(person.id)}" data-person-name="${escapeAttr(person.name)}">编辑人物卡</button>
                ${!person.isUser ? `
                    <div class="wb-person-life-actions">
                        <button type="button" class="is-catchup" data-wb-action="catch-up-person"
                            data-person-id="${escapeAttr(person.id)}"
                            ${busy || person.simulationEnabled === false ? 'disabled' : ''}
                            title="不推进世界时间，只补齐这个人物截至现在的后台生活状态">
                            ${busy ? '正在结算…' : '补一下近况'}
                        </button>
                        <button type="button" class="is-priority ${person.lifeTickPriority ? 'is-active' : ''}"
                            data-wb-action="prioritize-person" data-person-id="${escapeAttr(person.id)}"
                            data-enabled="${person.lifeTickPriority ? 'false' : 'true'}"
                            aria-pressed="${person.lifeTickPriority ? 'true' : 'false'}"
                            ${busy || person.simulationEnabled === false ? 'disabled' : ''}
                            title="不立刻调用 API，把她排到下一轮后台人物结算前面">
                            ${person.lifeTickPriority ? '已排到前面' : '下一轮优先'}
                        </button>
                    </div>
                    ${person.simulationEnabled === false ? '<p class="wb-person-life-note">镜头外推演已关闭</p>' : ''}
                ` : ''}
                <div class="wb-drawer-section"><span>正在做</span><strong>${escapeHtml(person.action)}</strong></div>
                <div class="wb-drawer-section"><span>短期意图</span><strong>${escapeHtml(person.intent)}</strong></div>
                ${person.longTermGoal ? `
                    <div class="wb-drawer-section"><span>长期目标</span><strong>${escapeHtml(person.longTermGoal)}</strong></div>
                ` : ''}
                ${person.identityAnchor ? `
                    <div class="wb-drawer-section is-character-anchor"><span>身份锚点</span><strong>${escapeHtml(person.identityAnchor)}</strong></div>
                ` : ''}
                ${person.appearanceProfile ? `
                    <div class="wb-drawer-section is-character-anchor"><span>外貌设定</span><strong>${escapeHtml(person.appearanceProfile)}</strong></div>
                ` : ''}
                ${person.personalityAnchor ? `
                    <div class="wb-drawer-section is-character-anchor"><span>人格锚点</span><strong>${escapeHtml(person.personalityAnchor)}</strong></div>
                ` : ''}
                ${person.backgroundProfile ? `
                    <div class="wb-drawer-section is-character-anchor"><span>背景与关系</span><strong>${escapeHtml(person.backgroundProfile)}</strong></div>
                ` : ''}
                ${person.speakingStyle ? `
                    <div class="wb-drawer-section is-character-anchor"><span>说话习惯</span><strong>${escapeHtml(person.speakingStyle)}</strong></div>
                ` : ''}
                ${person.behaviorBoundaries ? `
                    <div class="wb-drawer-section is-character-anchor"><span>行为边界</span><strong>${escapeHtml(person.behaviorBoundaries)}</strong></div>
                ` : ''}
                ${person.worldbookRaw ? `
                    <details class="wb-worldbook-source-profile">
                        <summary><span>世界书原始设定</span><small>${String(person.worldbookRaw).length} 字 · 点击查看</small></summary>
                        <pre>${escapeHtml(person.worldbookRaw)}</pre>
                    </details>
                ` : ''}
                ${person.trace ? `
                    <div class="wb-drawer-section"><span>最近轨迹</span><strong>${escapeHtml(person.trace)}</strong></div>
                ` : ''}
                ${observerMode === 'backstage'
                    ? renderInnerVoice(person, worldMinute)
                    : `
                        <div class="wb-knowledge-boundary">
                            <i></i><div><strong>知识边界</strong><p>角色所知视角不会读取她的幕后独白。</p></div>
                        </div>
                    `}
                <div class="wb-person-observation ${observation?.personId === person.id ? 'has-result' : ''}">
                    ${observation?.personId === person.id ? `
                        <article>
                            <span>幕后观测 · ${escapeHtml(formatWorldMinute(observation.worldMinute).time)}</span>
                            <p>${escapeHtml(observation.text)}</p>
                        </article>
                    ` : ''}
                    ${canObserve ? `
                        <div class="wb-observation-primary">
                            ${observation?.personId === person.id
                                ? '<span>已保存在当前正文与世界状态下</span>'
                                : '<span>不推进时间，也不会直接写入正文</span>'}
                            <button type="button" data-wb-action="observe-person"
                                data-person-id="${escapeAttr(person.id)}"
                                data-force="${observation?.personId === person.id ? 'true' : 'false'}"
                                ${busy ? 'disabled' : ''}>
                                ${busy
                                    ? '正在观测……'
                                    : observation?.personId === person.id
                                        ? '重新观测'
                                        : `看看 ${escapeHtml(person.name)} 在做什么`}
                            </button>
                        </div>
                    ` : `
                        <p>${person.isUser
                            ? '玩家角色不使用人物即时观测。'
                            : observerMode !== 'backstage'
                                ? '切回幕后视角后可以观测人物。'
                                : '这个人物当前无法观测。'}</p>
                    `}
                </div>
                <div class="wb-knowledge-boundary wb-observation-boundary ${observation?.queued ? 'is-enabled' : ''} ${observation?.revealState === 'delivered' ? 'is-delivered' : ''}">
                    <i></i>
                    <div>
                        <strong>${observation?.revealState === 'delivered' ? '已经显露' : '自然显露'}</strong>
                        <p>${observation?.revealState === 'delivered'
                            ? '这段观测已经被后续正文自然承接；关闭观测窗口不会删除已经生成的正文。'
                            : observation?.revealState === 'expired'
                                ? '此前没有遇到合适的显露时机，已停止继续提供；你可以重新开启。'
                                : observation?.queued
                                    ? '已允许：这段观测会在后续语境合适时作为正文候选；不会强行插入，也不保证紧接下一轮出现。'
                                    : '默认关闭：仅供幕后观看，不进入正文、不推进时间，也不修改记忆。'}</p>
                    </div>
                    ${observation?.personId === person.id ? `
                        <button type="button" role="switch"
                            aria-checked="${observation.queued || observation.revealState === 'delivered' ? 'true' : 'false'}"
                            aria-label="允许这段观测自然显露"
                            data-wb-action="queue-person-observation"
                            data-person-id="${escapeAttr(person.id)}"
                            ${observation.revealState === 'delivered' ? 'disabled' : ''}>
                            <span></span>
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

export function sortEventsForDisplay(events, state, presentPeople = []) {
    const now = Number(state?.clock?.absoluteMinute || 0);
    const presentIds = new Set(presentPeople.map(person => String(person?.id || '')).filter(Boolean));
    const presentNames = new Set(presentPeople.map(person => String(person?.name || '')).filter(Boolean));
    const presentPlaces = new Set(presentPeople.map(person => String(person?.location || '')).filter(Boolean));
    const score = event => {
        let value = 0;
        if (event?.delivery?.manualQueued) value += 100000;
        const actors = new Set((event?.actors || []).map(String));
        if ([...actors].some(actor => presentIds.has(actor) || presentNames.has(actor))) value += 24000;
        if (presentPlaces.has(String(event?.place || ''))) value += 16000;
        value += ({ direct: 6000, known: 4200, trace: 2600, hidden: 0 }[event?.visibility] || 0);
        if (event?.status === 'active') value += 1800;
        if (Number.isFinite(Number(event?.dueAt)) && now > 0) {
            const remaining = Number(event.dueAt) - now;
            if (remaining <= 60 && remaining >= 0) value += 7000;
            else if (remaining <= 360 && remaining >= 0) value += 3500;
        }
        const age = Math.max(0, now - Number(event?.updatedAt || 0));
        value += Math.max(0, 1440 - Math.min(1440, age));
        return value;
    };
    return [...events].sort((a, b) => score(b) - score(a) || Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
}

export function sortPeopleForDisplay(people, activeEvents, presentPersonIds = new Set(), worldMinute = 0) {
    const activeActors = new Set();
    for (const event of activeEvents || []) {
        for (const actor of event?.actors || []) activeActors.add(String(actor));
    }
    const score = person => {
        let value = 0;
        if (presentPersonIds.has(String(person?.id || ''))) value += 100000;
        if (activeActors.has(String(person?.id || '')) || activeActors.has(String(person?.name || ''))) value += 24000;
        if (person?.simulationEnabled !== false) value += 1800;
        value += Number(person?.relevance || 0) * 3200;
        const age = Math.max(0, Number(worldMinute || 0) - Number(person?.updatedAt || 0));
        value += Math.max(0, 1440 - Math.min(1440, age));
        return value;
    };
    return [...people].sort((a, b) => score(b) - score(a) || String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN'));
}



const LINGQI_MASCOT_ASSETS = LINGQI_MASCOT_DATA_URLS;

function lingqiMascotState(lingqi = {}, _activeNotes = [], pending = null, override = '') {
    // 模型硬状态永远优先于随机待机/点击反应。
    if (lingqi.phase === 'running') return 'confused';
    if (lingqi.phase === 'error') return 'hold';
    if (Object.hasOwn(LINGQI_MASCOT_ASSETS, override)) return override;
    if (Object.hasOwn(LINGQI_MASCOT_ASSETS, lingqi.mascotState)) return lingqi.mascotState;
    if (pending) return 'note';
    if (Array.isArray(lingqi.messages) && lingqi.messages.length) return 'watch';
    return 'idle';
}

function lingqiMascotAssetState(state = 'idle') {
    return Object.hasOwn(LINGQI_MASCOT_ASSETS, state) ? state : 'idle';
}

function lingqiSupportCategoryLabel(category = 'unknown') {
    return {
        usage: '使用方式',
        settings: '设置 / 配置',
        api: 'API / 中转',
        task: '后台任务',
        memory: '记忆',
        people: '人物',
        injection: '正文注入',
        opinion: '舆情 / 新闻',
        worldbook: '世界书导入',
        data: '数据一致性',
        ui: '界面 / 交互',
        compatibility: '兼容性',
        performance: '性能 / 限流',
        unknown: '暂未归类',
    }[String(category || 'unknown')] || '暂未归类';
}

function renderLingqiView(lingqi = {}, draft = '', mascotOverride = '', openReadableKeys = new Set()) {
    const storedMessages = Array.isArray(lingqi.messages) ? lingqi.messages : [];
    const messages = storedMessages.slice(-120);
    const hiddenMessageCount = Math.max(0, storedMessages.length - messages.length);
    const notes = Array.isArray(lingqi.notes) ? lingqi.notes : [];
    const pending = lingqi.pendingProposal && typeof lingqi.pendingProposal === 'object'
        ? lingqi.pendingProposal
        : null;
    const pendingAction = lingqi.pendingAction && typeof lingqi.pendingAction === 'object'
        ? lingqi.pendingAction
        : null;
    const activeNotes = notes.filter(note => ['active', 'paused'].includes(note.status));
    const archivedNotes = notes.filter(note => ['completed', 'expired'].includes(note.status)).slice(-4).reverse();
    // Archived notes now live behind a collapsed box, so they should not keep
    // the whole notes column stretched when there is no active paper on the board.
    const notesEmpty = activeNotes.length === 0;
    const lingqiBusy = lingqi.phase === 'running';
    const mascotState = lingqiMascotState(lingqi, activeNotes, pending, mascotOverride);
    const mascotAssetState = lingqiMascotAssetState(mascotState);
    const mascotSrc = LINGQI_MASCOT_ASSETS[mascotAssetState] || LINGQI_MASCOT_ASSETS.idle;
    const noteStatus = note => ({
        active: '',
        paused: '压在爪爪下',
        completed: '做到啦',
        expired: '收起来啦',
        cancelled: '揭下来啦',
    }[note.status] || '');
    const readableOpenAttr = key => openReadableKeys?.has?.(key) ? ' open' : '';

    return `
        <div class="wb-lingqi-layout">
            <div class="wb-lingqi-surface">
                <div class="wb-lingqi-perch" aria-hidden="false">
                    <button class="wb-lingqi-mascot is-${mascotState} is-asset-${mascotAssetState}" type="button"
                        data-wb-action="lingqi-pet" data-mascot-state="${mascotState}"
                        aria-label="碰碰玲七" title="${lingqiBusy ? '玲七正在想……' : '碰碰玲七'}">
                        <img src="${escapeAttr(mascotSrc)}" alt="" draggable="false">
                    </button>
                </div>

                <section class="wb-lingqi-chat-card">
                    <div class="wb-lingqi-chat-log ${messages.length ? '' : 'is-empty'}" aria-live="polite">
                        ${hiddenMessageCount ? `
                            <div class="wb-lingqi-history-fold-note">
                                更早的 ${hiddenMessageCount} 条还收着。直接跟玲七说要找哪段、删哪段就行。
                            </div>
                        ` : ''}
                        ${messages.length ? messages.map(message => `
                            <div class="wb-lingqi-message is-${message.role === 'user' ? 'user' : 'assistant'}">
                                <p>${escapeHtml(message.text).replaceAll('\n', '<br>')}</p>
                                ${message.role !== 'user' && message.planText ? `
                                    <details class="wb-lingqi-readable"
                                        data-lingqi-readable-key="${escapeAttr(`message:${message.id}`)}"${readableOpenAttr(`message:${message.id}`)}>
                                        <summary aria-label="展开实际推进记录">⌄</summary>
                                        <div>${escapeHtml(message.planText).replaceAll('\n', '<br>')}</div>
                                    </details>
                                ` : ''}
                                ${message.role !== 'user' && message.needsAuthorHelp ? `
                                    <div class="wb-lingqi-support-card">
                                        <div class="wb-lingqi-support-head">
                                            <span class="wb-lingqi-support-note-icon" aria-hidden="true"></span>
                                            <strong>${escapeHtml(lingqiSupportCategoryLabel(message.supportTriage?.category))}</strong>
                                        </div>
                                        <p>${escapeHtml(
                                            message.supportTriage?.summary
                                            || message.supportReason
                                            || '现有状态暂时解释不了这个问题。',
                                        )}</p>
                                        ${message.supportTriage?.checked?.length ? `
                                            <small>玲七查过：${escapeHtml(message.supportTriage.checked.join('；'))}</small>
                                        ` : ''}
                                        <div class="wb-lingqi-support-row">
                                            <button type="button" class="wb-lingqi-support-note"
                                                data-wb-action="lingqi-copy-support-pack"
                                                data-message-id="${escapeAttr(message.id)}"
                                                title="接过玲七写给妈妈的小纸条">
                                                <span>接过小纸条</span>
                                            </button>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('') : ''}
                    </div>
                    ${pending ? `
                        <div class="wb-lingqi-proposal">
                            <span class="wb-lingqi-tape" aria-hidden="true"></span>
                            <p>${escapeHtml(pending.paperText)}</p>
                            ${(pending.planText || pending.directive) ? `
                                <details class="wb-lingqi-readable is-paper"
                                    data-lingqi-readable-key="pending"${readableOpenAttr('pending')}>
                                    <summary aria-label="展开实际推进记录">⌄</summary>
                                    <div>${escapeHtml(pending.planText || pending.directive).replaceAll('\n', '<br>')}</div>
                                </details>
                            ` : ''}
                            <div class="wb-lingqi-proposal-actions">
                                <button type="button" data-wb-action="lingqi-confirm-note">先留着</button>
                                <button type="button" data-wb-action="lingqi-dismiss-note">不要了</button>
                            </div>
                        </div>
                    ` : ''}
                    ${pendingAction ? `
                        <div class="wb-lingqi-action-confirm" role="alertdialog"
                            aria-label="${escapeAttr(pendingAction.title || '确认玲七代办')}">
                            <span class="wb-lingqi-action-kaomoji" aria-hidden="true">(^. .^)</span>
                            <div>
                                <strong>${escapeHtml(pendingAction.title || '要让我去弄吗？')}</strong>
                                <p>${escapeHtml(pendingAction.detail || '这个动作会调用后台模型。')}</p>
                                ${Array.isArray(pendingAction.previewLines) && pendingAction.previewLines.length ? `
                                    <div class="wb-lingqi-action-preview">
                                        ${pendingAction.previewLines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}
                                    </div>
                                ` : ''}
                                ${pendingAction.caution ? `<small>${escapeHtml(pendingAction.caution)}</small>` : ''}
                            </div>
                            <div class="wb-lingqi-action-confirm-buttons">
                                <button type="button" data-wb-action="lingqi-dismiss-action">先不要</button>
                                <button type="button" class="is-confirm" data-wb-action="lingqi-confirm-action">
                                    ${escapeHtml(pendingAction.confirmLabel || '点头')}
                                </button>
                            </div>
                        </div>
                    ` : ''}
                    <form class="wb-lingqi-input" data-wb-form="lingqi-chat">
                        <textarea name="text" rows="1" maxlength="3000" ${lingqiBusy ? 'disabled' : ''}
                            placeholder="……">${escapeHtml(draft)}</textarea>
                        <button type="submit" aria-label="戳" title="戳" ${lingqiBusy ? 'disabled' : ''}>${lingqiBusy ? '…' : '戳'}</button>
                    </form>
                </section>

                <section class="wb-lingqi-notes-card ${notesEmpty ? 'is-empty' : ''}">
                <div class="wb-lingqi-notes-head">
                    <div><span>🐾</span><strong>玲七的小纸条</strong></div>
                    ${activeNotes.length ? `<small>× ${activeNotes.length}</small>` : ''}
                </div>
                <div class="wb-lingqi-notes-scroll">
                <div class="wb-lingqi-note-board">
                    ${activeNotes.length ? activeNotes.map((note, index) => `
                        <article class="wb-lingqi-note is-${escapeAttr(note.status)} is-tone-${index % 4}" style="--wb-note-tilt:${index % 2 ? '0.8deg' : '-0.7deg'}">
                            <span class="wb-lingqi-note-tape" aria-hidden="true"></span>
                            <p>${escapeHtml(note.paperText)}</p>
                            ${note.lastComment ? `<small>${escapeHtml(note.lastComment)}</small>` : ''}
                            ${(note.planText || note.directive) ? `
                                <details class="wb-lingqi-readable is-paper"
                                    data-lingqi-readable-key="${escapeAttr(`note:${note.id}`)}"${readableOpenAttr(`note:${note.id}`)}>
                                    <summary aria-label="展开实际推进记录">⌄</summary>
                                    <div>${escapeHtml(note.planText || note.directive).replaceAll('\n', '<br>')}</div>
                                </details>
                            ` : ''}
                            <div class="wb-lingqi-note-foot">
                                ${noteStatus(note) ? `<em>${escapeHtml(noteStatus(note))}</em>` : ''}
                                <div>
                                    ${note.status === 'active' ? `
                                        <button type="button" data-wb-action="lingqi-pause-note" data-note-id="${escapeAttr(note.id)}" title="先压在爪爪下面">压住</button>
                                    ` : `
                                        <button type="button" data-wb-action="lingqi-resume-note" data-note-id="${escapeAttr(note.id)}" title="重新贴回来">贴回来</button>
                                    `}
                                    <button type="button" data-wb-action="lingqi-cancel-note" data-note-id="${escapeAttr(note.id)}">揭掉</button>
                                </div>
                            </div>
                        </article>
                    `).join('') : `
                        <div class="wb-lingqi-note-empty" aria-label="暂时没有小纸条">
                            <span aria-hidden="true">₍^. .^₎⟆</span>
                        </div>
                    `}
                </div>
                ${archivedNotes.length ? `
                    <details class="wb-lingqi-note-box"
                        data-lingqi-readable-key="archive"${readableOpenAttr('archive')}>
                        <summary>
                            <strong>小盒子里</strong>
                            <span>${archivedNotes.length} 张收好的纸条</span>
                            <i aria-hidden="true"></i>
                        </summary>
                        <div class="wb-lingqi-note-box-body">
                            ${archivedNotes.map(note => `
                                <div><span>${escapeHtml(noteStatus(note))}</span><p>${escapeHtml(note.paperText)}</p></div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}
                </div>
                </section>
            </div>
        </div>
    `;
}

function renderNowView(state, observerMode, people, activeEvents, narrativeSync = {}) {
    const clock = formatWorldCalendar(state);
    const clockLabel = worldClockLabel(state, clock);
    return `
        <div class="wb-overview">
            <section class="wb-world-card">
                <div class="wb-world-card-copy">
                    <div class="wb-world-card-heading-row">
                        <span class="wb-section-kicker">WORLD STATE · ${escapeHtml(clockLabel)}</span>
                        <button class="wb-card-action-button is-edit" type="button"
                            data-wb-action="open-world-editor" aria-label="编辑世界设定">编辑</button>
                    </div>
                    <h3>${escapeHtml(state.world.title)}</h3>
                    <p>${escapeHtml(state.world.detail)}</p>
                    ${state.world?.background
                        ? '<span class="wb-section-kicker">WORLD BACKGROUND · 已设定</span>'
                        : ''}
                </div>
                <div class="wb-world-pulse" aria-hidden="true">
                    <i></i><i></i><span></span>
                    <strong>${state.needsReconciliation ? '待校准' : narrativeSync.needsSimulation ? '待推演' : '持续中'}</strong>
                </div>
            </section>

            <div class="wb-overview-grid">
                <section class="wb-overview-section">
                    <div class="wb-section-heading">
                        <div><span>正在形成</span><h3>暗流</h3></div>
                        <button type="button" data-wb-action="set-view" data-view="currents">查看全部 →</button>
                    </div>
                    <div class="wb-event-list is-compact">
                        ${activeEvents.slice(0, 2).map(event => renderEventCard(event, state)).join('')
                            || renderEmpty('暗流今天很安静～', '没有正在发展的事件也没关系，人物们照样会过自己的日子 (˘ω˘)')}
                    </div>
                </section>

                <section class="wb-overview-section">
                    <div class="wb-section-heading">
                        <div><span>持续生活中</span><h3>人物轨迹</h3></div>
                        <button type="button" data-wb-action="set-view" data-view="people">查看全部 →</button>
                    </div>
                    <div class="wb-person-list">
                        ${people.slice(0, 3).map(person => renderPersonRow(
                            person,
                            observerMode,
                            state.clock.absoluteMinute,
                        )).join('') || renderEmpty('人物轨迹还没开张～', '跑一次世界推演，她们就会慢慢留下自己的生活痕迹。')}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderPeopleView(state, observerMode, people, openFolds = new Set()) {
    return `
        <div class="wb-view-intro">
            <div class="wb-memory-intro-actions">
                <span>${people.length} 条可观测轨迹</span>
                <button type="button" data-wb-action="open-person-editor">＋ 添加后台 NPC</button>
            </div>
        </div>
        <div class="wb-view-fold-head">
            ${renderFoldToolbar('people:')}
        </div>
        <div class="wb-people-grid">
            ${people.map(person => renderPersonCard(
                person,
                observerMode,
                state.clock.absoluteMinute,
                openFolds,
            )).join('') || renderEmpty(
                observerMode === 'known' ? '角色目前没有可确认的人物轨迹' : '后台人物尚未建立',
                observerMode === 'known' ? '切回幕后视角可以查看未知轨迹。' : '回复后自动推演或手动推演一次。',
            )}
        </div>
    `;
}

function renderPersonEditorModal(state, editor) {
    const editorId = String(editor?.id || '');
    const editorName = String(editor?.name || '');
    const person = state.people.find(item => (
        item.id === editorId
        && (!editorName || item.name === editorName)
    )) || state.people.find(item => item.id === editorId) || null;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-person-editor">
            <form class="wb-event-form wb-person-editor" data-wb-form="person">
                <div class="wb-form-heading">
                    <div><span>BACKSTAGE CAST</span><h3>${person ? '编辑后台人物' : '添加后台 NPC'}</h3></div>
                    <button type="button" data-wb-action="close-person-editor">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(person?.id || '')}">
                <input type="hidden" name="originalName" value="${escapeAttr(person?.name || '')}">
                <div class="wb-person-avatar-editor">
                    ${renderPersonAvatar(person || { name: '·', monogram: '·' }, 'is-large')}
                    <div>
                        <label class="wb-avatar-upload">换个头像～
                            <input name="avatarFile" type="file" accept="image/*">
                        </label>
                        <small>会自动裁成 160×160 的小头像保存，不会塞进模型上下文 (｡•̀ᴗ-)✧</small>
                    </div>
                    ${person?.avatarDataUrl ? `<button type="button" data-wb-action="clear-person-avatar"
                        data-person-id="${escapeAttr(person.id)}">恢复文字头像</button>` : ''}
                </div>
                <label>姓名<input name="name" required maxlength="80" value="${escapeAttr(person?.name || '')}"></label>
                <label>当前位置<input name="location" maxlength="160" value="${escapeAttr(person?.location || '')}"></label>
                <label>正在做<textarea name="action" maxlength="280" rows="2">${escapeHtml(person?.action || '')}</textarea></label>
                <label>短期意图<textarea name="intent" maxlength="320" rows="2">${escapeHtml(person?.intent || '')}</textarea></label>
                <label>长期目标<textarea name="longTermGoal" maxlength="420" rows="3">${escapeHtml(person?.longTermGoal || '')}</textarea></label>
                <label>当前幕后独白<textarea name="innerVoice" maxlength="240" rows="3"
                    placeholder="只修正她现在这一刻在想什么～后续状态真的变化时，AI 仍然可以自然更新。">${escapeHtml(person?.innerVoice || '')}</textarea>
                    <small>这是当前心声，不是永久人设锁～写歪了就直接掰回来 (｡•̀ᴗ-)✧</small>
                </label>
                <fieldset class="wb-character-anchor-fields">
                    <legend><span>角色约束</span><small>推演与即时观测都会遵守，AI 不会自动改写</small></legend>
                    <label>角色身份锚点<textarea name="identityAnchor" maxlength="500" rows="3"
                        placeholder="例如：男性，外表偏女性，使用“他”和男性称谓；狐族人外。也可填写非二元、无性别或自定义称谓。">${escapeHtml(person?.identityAnchor || '')}</textarea>
                        <small>自由填写性别身份、称谓/代词、物种、年龄阶段与社会身份；外貌请单独写在“外貌设定”。不限制为男女二选一。</small>
                    </label>
                    <label>外貌设定<textarea name="appearanceProfile" maxlength="700" rows="3"
                        placeholder="例如：黑色短发，身高185cm，常穿深色衬衫。">${escapeHtml(person?.appearanceProfile || '')}</textarea></label>
                    <label>人格锚点<textarea name="personalityAnchor" maxlength="600" rows="3"
                        placeholder="例如：外冷内热，警惕权威；重视承诺，但不轻易示弱。">${escapeHtml(person?.personalityAnchor || '')}</textarea></label>
                    <label>背景与关系<textarea name="backgroundProfile" maxlength="900" rows="4"
                        placeholder="例如：成长经历、家庭关系、社会关系和既有重要经历。">${escapeHtml(person?.backgroundProfile || '')}</textarea></label>
                    <label>说话习惯<textarea name="speakingStyle" maxlength="360" rows="2"
                        placeholder="例如：句子简短，很少使用感叹号；紧张时会转移话题。">${escapeHtml(person?.speakingStyle || '')}</textarea></label>
                    <label>行为边界<textarea name="behaviorBoundaries" maxlength="500" rows="3"
                        placeholder="例如：不会无证据背叛同伴；不替玩家做决定；不知道的幕后信息不得说出口。">${escapeHtml(person?.behaviorBoundaries || '')}</textarea></label>
                </fieldset>
                <div class="wb-form-grid">
                    <label>知识边界
                        <select name="knowledge">
                            <option value="backstage" ${person?.knowledge !== 'known' ? 'selected' : ''}>幕后未知</option>
                            <option value="known" ${person?.knowledge === 'known' ? 'selected' : ''}>角色可知</option>
                        </select>
                    </label>
                    <label>重要程度
                        <select name="relevance">
                            <option value="1" ${Number(person?.relevance || 2) === 1 ? 'selected' : ''}>普通</option>
                            <option value="2" ${Number(person?.relevance || 2) === 2 ? 'selected' : ''}>重要</option>
                            <option value="3" ${Number(person?.relevance || 2) === 3 ? 'selected' : ''}>核心</option>
                        </select>
                    </label>
                </div>
                <div class="wb-memory-editor-flags">
                    <label><input name="simulationEnabled" type="checkbox"
                        ${person?.simulationEnabled !== false ? 'checked' : ''}> 参与镜头外推演</label>
                    <label><input name="locked" type="checkbox" ${person?.locked ? 'checked' : ''}> 锁定核心设定</label>
                </div>
                <div class="wb-form-note">关闭“参与镜头外推演”后，人物仍保存在名单里；只有正文让其出场时才更新。</div>
                <div class="wb-person-editor-actions">
                    ${person ? `<button class="wb-person-delete-button" type="button" data-wb-action="delete-manual-person"
                        data-person-id="${escapeAttr(person.id)}" ${person.locked ? 'disabled' : ''}>删除人物</button>` : ''}
                    <button class="wb-primary-button" type="submit">${person ? '保存人物卡' : '加入后台名单'}</button>
                </div>
            </form>
        </div>
    `;
}

function renderCurrentsView(state, activeEvents, openFolds = new Set(), settings = {}) {
    return `
        <div class="wb-view-intro">
            <div class="wb-view-inline-actions">
                <button class="wb-inline-add" type="button" data-wb-action="open-event-form">＋ 放入一条暗流</button>
            </div>
        </div>
        <div class="wb-view-fold-head">
            ${renderFoldToolbar('currents:')}
        </div>
        <div class="wb-event-list is-full">
            ${activeEvents.map(event => renderEventCard(event, state, true, openFolds)).join('')
                || renderEmpty('暗流暂时清空啦～', '到时、取消或错过的事情会离开这里，结果会乖乖转去回声。')}
        </div>
    `;
}

function renderEchoesView(state, outcomes, openFolds = new Set()) {
    return `
        <div class="wb-view-fold-head">
            ${renderFoldToolbar('echoes:')}
        </div>
        <div class="wb-echo-timeline">
            ${outcomes.map(event => renderOutcome(event, state, openFolds)).join('')
                || renderEmpty('还没有回声呢～', '后台发生过的事，不等于已经被正文看见。等它真正形成结果再来这里。')}
        </div>
    `;
}

function publicOpinionClaimLabel(status) {
    return {
        fact: '基于公开事实',
        mixed: '事实与猜测混合',
        rumor: '传闻 / 未证实',
    }[status] || '事实与猜测混合';
}

function publicOpinionConfidenceLabel(confidence) {
    return confidence === 'high' ? '较高可信' : '信息有限';
}

function publicOpinionSourceTypeLabel(sourceType) {
    return sourceType === 'official' ? '🏛 官方 / 权威' : '🗣 非官方 / 小道';
}

function renderPublicOpinionAudience(item) {
    const audiences = Array.isArray(item?.audienceTags) ? item.audienceTags.filter(Boolean).slice(0, 5) : [];
    if (!audiences.length && !item?.scope) return '';
    return `
        <div class="wb-opinion-audience">
            ${item?.scope ? `<span class="wb-opinion-scope">${escapeHtml(item.scope)}</span>` : ''}
            ${audiences.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
        </div>
    `;
}

function publicOpinionGeneratedLabel(value) {
    if (!value) return '尚未生成';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '最近一次快照';
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function publicOpinionWorldTimeLabel(state, item) {
    const minute = Number(item?.worldMinute);
    if (!Number.isFinite(minute) || minute < 0) return '';
    const calendar = formatWorldCalendar(state, minute);
    return calendar?.stamp || formatWorldMinute(minute).stamp;
}

function renderPublicOpinionView(state, opinion = {}, mode = 'news', settings = {}) {
    const news = Array.isArray(opinion.news) ? opinion.news : [];
    const forums = Array.isArray(opinion.forums) ? opinion.forums : [];
    const interactionBusy = Boolean(opinion.interactionBusy);
    const sandboxInteractionBusy = Boolean(opinion.sandboxInteractionBusy);
    const canonRunning = Boolean(
        opinion.canonRunning
        || interactionBusy
        || opinion.phase === 'running'
        || opinion.phase === 'queued'
    );
    const sandboxStatus = opinion.sandboxStatus && typeof opinion.sandboxStatus === 'object'
        ? opinion.sandboxStatus
        : { phase: 'idle', message: '', error: '' };
    const sandboxRunning = Boolean(
        opinion.sandboxRunning
        || sandboxInteractionBusy
        || sandboxStatus.phase === 'running'
    );
    const running = canonRunning || sandboxRunning;
    const stale = Boolean(opinion.stale && opinion.generatedAt);
    const lastWorldSweepMinute = Number(state?.worldPulse?.coverage?.lastSweepAt ?? -1);
    const lastWorldSweepLabel = lastWorldSweepMinute >= 0
        ? (formatWorldCalendar(state, lastWorldSweepMinute)?.stamp || formatWorldMinute(lastWorldSweepMinute).stamp)
        : '尚未巡查';
    const recentWorldCoverageLabels = (Array.isArray(state?.worldPulse?.coverage?.entries)
        ? state.worldPulse.coverage.entries
        : [])
        .slice(0, 3)
        .map(item => String(item?.label || '').trim())
        .filter(Boolean);
    const relatedEvents = new Map((state.events || []).map(event => [event.id, event]));
    const sandbox = opinion.sandbox && typeof opinion.sandbox === 'object' ? opinion.sandbox : { news: [], forums: [], generatedAt: '' };
    const sandboxItems = [...(sandbox.news || []), ...(sandbox.forums || [])];
    const activeMode = ['forum', 'sandbox'].includes(mode) ? mode : 'news';
    const canonStatusMessage = (
        interactionBusy && !['running', 'queued', 'error'].includes(opinion.phase)
            ? '正在检查世界变化～'
            : (opinion.error || opinion.message || '')
    );
    const sandboxStatusMessage = (
        sandboxInteractionBusy && sandboxStatus.phase !== 'error'
            ? '正在街上随便逛逛～'
            : (sandboxStatus.error || sandboxStatus.message || '')
    );
    const statusMessage = activeMode === 'sandbox'
        ? sandboxStatusMessage
        : canonStatusMessage;
    const statusPhase = activeMode === 'sandbox'
        ? (sandboxStatus.phase || (sandboxInteractionBusy ? 'running' : 'idle'))
        : (opinion.phase || (interactionBusy ? 'running' : 'idle'));
    const hasMainOpinion = news.length > 0 || forums.length > 0;
    const hasSandboxOpinion = sandboxItems.length > 0;
    const showStatusMessage = Boolean(
        statusMessage
        && (
            statusPhase === 'error'
            || activeMode !== 'sandbox'
            || !hasSandboxOpinion
            || sandboxRunning
        )
    );
    const renderRelated = item => {
        const event = relatedEvents.get(item.relatedEventId);
        return event
            ? `<span class="wb-opinion-related">来源事件 · ${escapeHtml(event.title)}</span>`
            : '';
    };
    return `
        <div class="wb-opinion-toolbar" aria-busy="${running ? 'true' : 'false'}">
            <div class="wb-opinion-summary">
                <div class="wb-opinion-meta">
                    <span>更新至 · ${escapeHtml(publicOpinionGeneratedLabel(opinion.generatedAt))}</span>
                    <span>镜头外巡查 · ${escapeHtml(lastWorldSweepLabel)}</span>
                    ${recentWorldCoverageLabels.length
                        ? `<span title="最近被世界推演实际检查过的范围">巡过 · ${recentWorldCoverageLabels.map(escapeHtml).join(' / ')}</span>`
                        : ''}
                    ${stale
                        ? '<span class="is-stale">世界往前走啦 · 刷新一下更准</span>'
                        : `<span>${settings.publicOpinionRevealMode === 'relevant' ? '相关时可显露' : '安心吃瓜模式'}</span>`}
                </div>
            </div>
            <div class="wb-opinion-actions">
                ${opinion.generatedAt ? `<button type="button" data-wb-action="clear-public-opinion" title="只清空舆情列表，不删除世界事实或已经发生的影响" ${canonRunning ? 'disabled' : ''}>清空列表</button>` : ''}
                <button type="button" data-wb-action="generate-public-opinion-sandbox" ${sandboxRunning ? 'disabled' : ''}>${sandboxRunning ? '正在闲逛…' : '随便逛逛～'}</button>
                <button class="wb-inline-add" type="button" data-wb-action="generate-public-opinion" ${canonRunning ? 'disabled' : ''}
                    title="世界时间走够三小时、首次升级或侧重点改变时，我会先巡一小圈镜头外公共世界；没有真实变化时不会只为换措辞重复请求">
                    ${canonRunning ? '正在刷新…' : (opinion.generatedAt ? '巡一圈' : '生成当前舆情')}
                </button>
            </div>
        </div>
        <div class="wb-opinion-tabs" role="tablist" aria-label="舆情类型">
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="news"
                aria-selected="${activeMode === 'news'}" class="${activeMode === 'news' ? 'is-active' : ''}">📰 新闻 <small>${news.length}</small></button>
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="forum"
                aria-selected="${activeMode === 'forum'}" class="${activeMode === 'forum' ? 'is-active' : ''}">💬 论坛 <small>${forums.length}</small></button>
            <button type="button" role="tab" data-wb-action="set-public-opinion-mode" data-mode="sandbox"
                aria-selected="${activeMode === 'sandbox'}" class="${activeMode === 'sandbox' ? 'is-active' : ''}">🍿 闲逛 <small>${sandboxItems.length}</small></button>
        </div>
        ${showStatusMessage ? `<div role="status" aria-live="polite" class="wb-opinion-status is-${escapeAttr(statusPhase)} ${hasMainOpinion || hasSandboxOpinion ? 'is-compact' : ''}">${escapeHtml(statusMessage)}</div>` : ''}
        ${activeMode === 'news' ? `
            <div class="wb-news-grid">
                ${news.map(item => `
                    <article class="wb-news-card">
                        <div class="wb-news-card-top">
                            <span>${escapeHtml(item.category || '世界新闻')}${item.publishedAt && item.updatedAt && item.publishedAt !== item.updatedAt ? ' · 后续' : ''}</span>
                            <span class="wb-opinion-card-tools">
                                <small>${'●'.repeat(Math.max(1, Math.min(3, Number(item.heat) || 1)))}</small>
                                <button type="button" class="wb-opinion-delete" data-wb-action="dismiss-public-opinion-item"
                                    data-opinion-kind="news" data-item-id="${escapeAttr(item.id)}" title="从舆情列表删除这条；不会删除世界事件">×</button>
                            </span>
                        </div>
                        <div class="wb-opinion-source-row">
                            <span class="is-${escapeAttr(item.sourceType || 'official')}">${escapeHtml(publicOpinionSourceTypeLabel(item.sourceType))}</span>
                        </div>
                        <h3>${escapeHtml(item.headline)}</h3>
                        <p>${escapeHtml(item.summary)}</p>
                        ${renderPublicOpinionAudience(item)}
                        <div class="wb-news-card-foot">
                            <span>${escapeHtml(item.source || '公开信息')} · ${escapeHtml(publicOpinionConfidenceLabel(item.confidence))}${item.worldSynced ? ' · 世界事件同步' : ''}${publicOpinionWorldTimeLabel(state, item) ? ` · ${escapeHtml(publicOpinionWorldTimeLabel(state, item))}` : ''}</span>
                            ${renderRelated(item)}
                        </div>
                    </article>
                `).join('') || renderEmpty('今天的世界有点安静～', '还没有值得上新闻的事，或者你还没生成舆情快照 (˘▾˘)')}
            </div>
        ` : activeMode === 'forum' ? `
            <div class="wb-forum-list">
                ${forums.map(item => `
                    <article class="wb-forum-card">
                        <div class="wb-forum-card-top">
                            <span>${escapeHtml(item.board || '闲聊')}</span>
                            <span class="wb-opinion-card-tools">
                                <small class="is-${escapeAttr(item.claimStatus || 'mixed')}">${escapeHtml(publicOpinionClaimLabel(item.claimStatus))}</small>
                                <button type="button" class="wb-opinion-delete" data-wb-action="dismiss-public-opinion-item"
                                    data-opinion-kind="forum" data-item-id="${escapeAttr(item.id)}" title="从论坛列表删除这条讨论">×</button>
                            </span>
                        </div>
                        <div class="wb-opinion-source-row">
                            <span class="is-${escapeAttr(item.sourceType || 'unofficial')}">${escapeHtml(publicOpinionSourceTypeLabel(item.sourceType))}</span>
                        </div>
                        <h3>${escapeHtml(item.title)}</h3>
                        <p>${escapeHtml(item.summary)}</p>
                        ${renderPublicOpinionAudience(item)}
                        <div class="wb-forum-heat"><span>热度</span><strong>${'●'.repeat(Math.max(1, Math.min(5, Number(item.heat) || 1)))}</strong></div>
                        ${item.replies?.length ? `
                            <details class="wb-forum-reply-fold">
                                <summary>看看 ${item.replies.length} 条代表回复～</summary>
                                <div class="wb-forum-replies">
                                    ${item.replies.map(reply => `
                                        <div><strong>${escapeHtml(reply.author)}</strong><p>${escapeHtml(reply.text)}</p></div>
                                    `).join('')}
                                </div>
                            </details>
                        ` : ''}
                        <div class="wb-news-card-foot">
                            <span>${publicOpinionWorldTimeLabel(state, item) ? escapeHtml(publicOpinionWorldTimeLabel(state, item)) : ''}</span>
                            ${renderRelated(item)}
                        </div>
                    </article>
                `).join('') || renderEmpty('论坛今天没吵起来～', '没有适合公开讨论的事，或者你还没生成舆情快照。')}
            </div>
        ` : `
            <div class="wb-opinion-sandbox">
                <div class="wb-memory-fact-note"><strong>🍿 纯娱乐沙盒</strong> · 下面这些只是“世界里可能有人在聊什么”的随手小报，不算正史，不会写进事件、记忆、NPC认知或正文因果。</div>
                ${sandbox.generatedAt ? `<div class="wb-opinion-meta wb-opinion-meta-inline"><span>闲逛快照 · ${escapeHtml(publicOpinionGeneratedLabel(sandbox.generatedAt))}</span><button class="wb-opinion-meta-button" type="button" data-wb-action="clear-public-opinion-sandbox">收起这锅瓜</button></div>` : ''}
                <div class="wb-news-grid">
                    ${(sandbox.news || []).map(item => `
                        <article class="wb-news-card is-sandbox">
                            <div class="wb-news-card-top"><span>${escapeHtml(item.category || '闲逛新闻')}</span><small>NON-CANON</small></div>
                            <h3>${escapeHtml(item.headline)}</h3>
                            <p>${escapeHtml(item.summary)}</p>
                            <div class="wb-news-card-foot"><span>${escapeHtml(item.source || '世界里的普通公开信息')}</span></div>
                        </article>
                    `).join('')}
                </div>
                <div class="wb-forum-list">
                    ${(sandbox.forums || []).map(item => `
                        <article class="wb-forum-card is-sandbox">
                            <div class="wb-forum-card-top"><span>${escapeHtml(item.board || '闲聊')}</span><small>NON-CANON</small></div>
                            <h3>${escapeHtml(item.title)}</h3>
                            <p>${escapeHtml(item.summary)}</p>
                            ${item.replies?.length ? `<details class="wb-forum-reply-fold"><summary>看看 ${item.replies.length} 条代表回复～</summary><div class="wb-forum-replies">${item.replies.map(reply => `<div><strong>${escapeHtml(reply.author)}</strong><p>${escapeHtml(reply.text)}</p></div>`).join('')}</div></details>` : ''}
                        </article>
                    `).join('')}
                </div>
                ${sandboxItems.length ? '' : renderEmpty('今天还没随便逛～', '点一下“随便逛逛～”，抽一锅和主线无关的小新闻和论坛水帖。')}
            </div>
        `}
    `;
}

function clueStatusLabel(status) {
    return {
        open: '等待发芽',
        developing: '正在发展',
        echoed: '正在发展',
        triggered: '已经触发',
        resolved: '已经回收',
        discarded: '已经放下',
    }[status] || '尚未呼应';
}

function memoryFactStatusLabel(status) {
    return {
        active: '当前有效',
        disputed: '说法冲突',
        superseded: '已被新版本覆盖',
        invalidated: '已经失效',
    }[status] || '当前有效';
}

function memoryConfidenceLabel(confidence) {
    return {
        high: '明确',
        medium: '较可信',
        low: '待确认',
    }[confidence] || '较可信';
}

function memoryItemMatches(item, query) {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    if (!normalized) return true;
    return [
        item?.key,
        item?.subject,
        item?.predicate,
        item?.value,
        item?.title,
        item?.text,
        item?.summary,
        ...(item?.people || []),
        ...(item?.locations || []),
        ...(item?.events || []),
        ...(item?.tags || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized);
}

function resolvePersonEntity(state, value, { allowSubjectPrefix = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const token = raw.toLocaleLowerCase();
    const people = state?.people || [];
    const exact = people.find(item => (
        String(item?.id || '').trim().toLocaleLowerCase() === token
        || String(item?.name || '').trim().toLocaleLowerCase() === token
    ));
    if (exact) return exact;
    if (!allowSubjectPrefix) return null;
    return [...people]
        .filter(item => String(item?.name || '').trim())
        .sort((a, b) => String(b.name).length - String(a.name).length)
        .find(item => {
            const name = String(item.name).trim();
            return raw.startsWith(`${name}的`)
                || raw.startsWith(`${name}·`)
                || raw.startsWith(`${name}：`)
                || raw.startsWith(`${name}:`);
        }) || null;
}

function resolvePersonDisplayName(state, value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return resolvePersonEntity(state, raw)?.name || raw;
}

function memoryFactGroupDescriptor(fact, state) {
    const linkedPerson = Array.isArray(fact?.people) && fact.people.length
        ? resolvePersonEntity(state, fact.people[0])
        : null;
    const subjectPerson = linkedPerson || resolvePersonEntity(
        state,
        fact?.subject || fact?.key,
        { allowSubjectPrefix: true },
    );
    if (subjectPerson) {
        return {
            key: `person:${subjectPerson.id || subjectPerson.name}`,
            label: subjectPerson.name,
        };
    }
    const label = String(fact?.subject || fact?.key || '').trim() || '其他事实';
    return { key: `fact:${label}`, label };
}

function memoryClueGroupDescriptor(clue) {
    if (clue?.archived) return { key: 'clue:archived', label: '已归档' };
    if (['resolved', 'discarded'].includes(clue?.status)) {
        return { key: 'clue:resolved', label: '已经回收 / 放下' };
    }
    if (clue?.status === 'triggered') return { key: 'clue:triggered', label: '已经触发' };
    return { key: 'clue:active', label: '仍在发展' };
}

function memoryClueRelationMatches(clue, relationFilter = 'all', state = null) {
    const filter = String(relationFilter || 'all');
    if (filter === 'all') return true;
    const separator = filter.indexOf(':');
    if (separator < 0) return true;
    const kind = filter.slice(0, separator);
    const expected = filter.slice(separator + 1).trim().toLocaleLowerCase();
    if (!expected) return true;
    const values = kind === 'person'
        ? (clue?.people || [])
        : kind === 'location'
            ? (clue?.locations || [])
            : kind === 'event'
                ? (clue?.events || [])
                : [];
    if (kind === 'person') {
        return values.some(value => {
            const raw = String(value || '').trim();
            const person = resolvePersonEntity(state, raw);
            return [raw, person?.id, person?.name]
                .filter(Boolean)
                .some(candidate => String(candidate).trim().toLocaleLowerCase() === expected);
        });
    }
    if (kind === 'event') {
        const events = [...(state?.events || []), ...(state?.archive || [])];
        return values.some(value => {
            const raw = String(value || '').trim();
            const matched = events.find(event => (
                String(event?.id || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
                || String(event?.title || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
            ));
            return [raw, matched?.id, matched?.title]
                .filter(Boolean)
                .some(candidate => String(candidate).trim().toLocaleLowerCase() === expected);
        });
    }
    return values.some(value => String(value || '').trim().toLocaleLowerCase() === expected);
}

function clueRelationMeta(clue, state) {
    const events = [...(state?.events || []), ...(state?.archive || [])];
    const people = [...new Set((clue?.people || []).map(value => resolvePersonDisplayName(state, value)).filter(Boolean))];
    const locations = [...new Set((clue?.locations || []).map(value => String(value || '').trim()).filter(Boolean))];
    const eventItems = [...new Set((clue?.events || []).map(value => {
        const raw = String(value || '').trim();
        const event = events.find(item => (
            String(item?.id || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
            || String(item?.title || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
        ));
        return event?.title || raw;
    }).filter(Boolean))];
    return { people, locations, events: eventItems };
}


function memorySummaryLevelMeta(summary) {
    if (!summary?.hierarchyManaged) {
        return { label: '旧版经历', tone: 'legacy', description: '以前留下的阶段经历～照样会好好记着。' };
    }
    const level = Math.max(0, Math.min(3, Number(summary?.level) || 0));
    const meta = [
        { label: '近期片段', tone: 'detail', description: '离原正文最近的小片段～细节会比较多。' },
        { label: '阶段小结', tone: 'stage', description: '一小段剧情的重点都收在这里啦～' },
        { label: '章节经历', tone: 'chapter', description: '把更长一段经历收成重点～方便后面继续接上。' },
        { label: '长期经历', tone: 'longterm', description: '真正跨过很久还重要的变化，会乖乖留在这里。' },
    ];
    return meta[level];
}

function renderMemoryActions(kind, item, selectedKeys = new Set()) {
    const selectionKey = `${kind}:${item.id}`;
    return `
        <div class="wb-memory-card-actions">
            <label class="wb-memory-select">
                <input type="checkbox" data-wb-memory-select
                    data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                    ${selectedKeys.has(selectionKey) ? 'checked' : ''}
                    ${item.locked ? 'disabled' : ''}>
                <span>${item.locked ? '已锁定' : '选择'}</span>
            </label>
            <button class="is-edit" type="button" data-wb-action="open-memory-editor"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                ${item.locked ? 'disabled' : ''}>编辑</button>
            <button type="button" data-wb-action="toggle-memory-flag"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                data-memory-field="important" class="is-important ${item.important ? 'is-active' : ''}">
                ${item.important ? '已标为重要' : '标为重要'}
            </button>
            <button type="button" data-wb-action="toggle-memory-flag"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                data-memory-field="locked" class="is-lock ${item.locked ? 'is-active' : ''}">
                ${item.locked ? '已锁定' : '锁定'}
            </button>
            <button class="is-delete" type="button" data-wb-action="delete-memory-item"
                data-memory-kind="${kind}" data-memory-id="${escapeAttr(item.id)}"
                ${item.locked ? 'disabled' : ''}>删除</button>
        </div>
    `;
}

function renderMemoryView(state, observerMode, {
    query = '',
    filter = 'active',
    visibleCount = 12,
    openFolds = new Set(),
    selectedKeys = new Set(),
    clueRelationFilter = 'all',
} = {}) {
    const memory = state.storyMemory || {
        digest: null,
        facts: [],
        summaries: [],
        clues: [],
    };
    const allFacts = [...(memory.facts || [])]
        .filter(fact => observerMode === 'backstage' || fact.visibility !== 'hidden')
        .sort((a, b) => (
            Number(['active', 'disputed'].includes(b.status))
            - Number(['active', 'disputed'].includes(a.status))
            || Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ));
    const allClues = [...(memory.clues || [])]
        .filter(clue => observerMode === 'backstage' || clue.visibility !== 'hidden')
        .sort((a, b) => (
            Number(Boolean(a.archived)) - Number(Boolean(b.archived))
            || Number(['open', 'developing', 'echoed', 'triggered'].includes(b.status))
            - Number(['open', 'developing', 'echoed', 'triggered'].includes(a.status))
            || Number(b.importance || 0) - Number(a.importance || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
        ));
    const allSummaries = observerMode === 'backstage'
        ? [...(memory.summaries || [])].sort(
            (a, b) => Number(b.endMessageId || 0) - Number(a.endMessageId || 0),
        )
        : [];
    const summaryById = new Map(allSummaries.map(summary => [String(summary.id || ''), summary]));
    const digest = observerMode === 'backstage' ? memory.digest : null;
    const normalizedFilter = ['active', 'facts', 'clues', 'resolved-clues', 'archived-clues', 'episodes', 'all'].includes(filter)
        ? filter
        : 'active';
    const maximum = Math.max(6, Number(visibleCount) || 12);
    const facts = allFacts.filter(fact => (
        memoryItemMatches(fact, query)
        && (
            normalizedFilter === 'all'
            || normalizedFilter === 'facts'
            || (normalizedFilter === 'active' && ['active', 'disputed'].includes(fact.status))
        )
    ));
    const clues = allClues.filter(clue => (
        memoryItemMatches(clue, query)
        && memoryClueRelationMatches(clue, clueRelationFilter, state)
        && (
            normalizedFilter === 'all'
            || (normalizedFilter === 'clues' && !clue.archived)
            || (normalizedFilter === 'resolved-clues' && !clue.archived && ['resolved', 'discarded'].includes(clue.status))
            || (normalizedFilter === 'archived-clues' && clue.archived)
            || (
                normalizedFilter === 'active'
                && !clue.archived
                && ['open', 'developing', 'echoed', 'triggered'].includes(clue.status)
            )
        )
    ));
    const summaries = allSummaries.filter(summary => (
        memoryItemMatches(summary, query)
        && ['all', 'episodes'].includes(normalizedFilter)
    ));
    const shownFacts = facts.slice(0, maximum);
    const shownClues = clues.slice(0, maximum);
    const shownSummaries = summaries.slice(0, maximum);
    const factGroups = groupItems(shownFacts, fact => memoryFactGroupDescriptor(fact, state));
    const clueGroups = groupItems(shownClues, clue => memoryClueGroupDescriptor(clue));
    const resultCount = facts.length + clues.length + summaries.length;
    const shownCount = shownFacts.length + shownClues.length + shownSummaries.length;
    const hasMore = shownFacts.length < facts.length
        || shownClues.length < clues.length
        || shownSummaries.length < summaries.length;
    const filterButton = (id, label) => `
        <button type="button" data-wb-action="set-memory-filter" data-filter="${id}"
            aria-pressed="${normalizedFilter === id}"
            class="${normalizedFilter === id ? 'is-active' : ''}">${label}</button>
    `;
    const relationPeople = new Map();
    const relationLocations = new Set();
    const relationEvents = new Map();
    const allWorldEvents = [...(state.events || []), ...(state.archive || [])];
    for (const clue of allClues) {
        for (const value of clue.people || []) {
            const raw = String(value || '').trim();
            if (!raw) continue;
            const person = resolvePersonEntity(state, raw);
            const key = String(person?.id || person?.name || raw);
            relationPeople.set(key, person?.name || raw);
        }
        for (const value of clue.locations || []) {
            const raw = String(value || '').trim();
            if (raw) relationLocations.add(raw);
        }
        for (const value of clue.events || []) {
            const raw = String(value || '').trim();
            if (!raw) continue;
            const event = allWorldEvents.find(item => (
                String(item?.id || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
                || String(item?.title || '').trim().toLocaleLowerCase() === raw.toLocaleLowerCase()
            ));
            const key = String(event?.id || event?.title || raw);
            relationEvents.set(key, event?.title || raw);
        }
    }
    const relationOption = (value, label) => (
        `<option value="${escapeAttr(value)}" ${String(clueRelationFilter) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`
    );
    const clueRelationSelect = `
        <label class="wb-clue-relation-filter">
            <span>伏笔关联</span>
            <select data-wb-clue-relation-filter>
                ${relationOption('all', '全部关联')}
                ${relationPeople.size ? `<optgroup label="人物">${[...relationPeople.entries()].map(([id, label]) => relationOption(`person:${id}`, label)).join('')}</optgroup>` : ''}
                ${relationEvents.size ? `<optgroup label="事件">${[...relationEvents.entries()].map(([id, label]) => relationOption(`event:${id}`, label)).join('')}</optgroup>` : ''}
                ${relationLocations.size ? `<optgroup label="地点">${[...relationLocations].map(label => relationOption(`location:${label}`, label)).join('')}</optgroup>` : ''}
            </select>
        </label>
    `;
    const renderFactCard = (fact, groupLabel = '') => {
        const subject = String(fact.subject || fact.key || '').trim();
        const normalizedGroup = String(groupLabel || '').trim();
        const duplicateSubject = normalizedGroup && subject === normalizedGroup;
        return `
        <article class="wb-memory-fact-card is-${escapeAttr(fact.status)}">
            <div class="wb-memory-fact-meta">
                <span>${escapeHtml(memoryFactStatusLabel(fact.status))}</span>
                <span>${escapeHtml(memoryConfidenceLabel(fact.confidence))}</span>
            </div>
            ${!duplicateSubject && subject ? `<h4>${escapeHtml(subject)}</h4>` : ''}
            ${fact.predicate ? `<small>${escapeHtml(fact.predicate)}</small>` : ''}
            <p>${escapeHtml(fact.value)}</p>
            ${fact.invalidationReason
                ? `<div class="wb-memory-fact-note">${escapeHtml(fact.invalidationReason)}</div>`
                : ''}
            ${renderMemoryActions('fact', fact, selectedKeys)}
        </article>
    `;
    };
    const renderClueCard = clue => {
        const relations = clueRelationMeta(clue, state);
        return `
        <article class="wb-clue-card is-${escapeAttr(clue.status)} ${clue.archived ? 'is-archived' : ''}">
            <div class="wb-clue-meta">
                <span>${escapeHtml(clue.archived ? '已归档' : clueStatusLabel(clue.status))}</span>
                ${!clue.archived && ['resolved', 'discarded'].includes(clue.status)
                    ? `<button type="button" data-wb-action="set-clue-archive-state" data-clue-id="${escapeAttr(clue.id)}" data-archived="true" ${clue.locked ? 'disabled' : ''}>归档</button>`
                    : ''}
                ${clue.archived
                    ? `<button type="button" data-wb-action="set-clue-archive-state" data-clue-id="${escapeAttr(clue.id)}" data-archived="false" ${clue.locked ? 'disabled' : ''}>移回已回收</button>`
                    : ''}
            </div>
            <h4>${escapeHtml(clue.title)}</h4>
            <p>${escapeHtml(clue.text)}</p>
            ${(relations.people.length || relations.events.length || relations.locations.length) ? `
                <div class="wb-clue-relations">
                    ${relations.people.map(value => `<span class="is-person">人物 · ${escapeHtml(value)}</span>`).join('')}
                    ${relations.events.map(value => `<span class="is-event">事件 · ${escapeHtml(value)}</span>`).join('')}
                    ${relations.locations.map(value => `<span class="is-location">地点 · ${escapeHtml(value)}</span>`).join('')}
                </div>
            ` : ''}
            ${clue.sourceExcerpt ? `<blockquote>${escapeHtml(clue.sourceExcerpt)}</blockquote>` : ''}
            ${clue.resolution ? `<div class="wb-clue-resolution">${escapeHtml(clue.resolution)}</div>` : ''}
            ${clue.lifecycleReason && clue.lifecycleReason !== clue.resolution ? `<div class="wb-memory-fact-note">为什么变更：${escapeHtml(clue.lifecycleReason)}</div>` : ''}
            ${renderMemoryActions('clue', clue, selectedKeys)}
        </article>
    `;
    };
    return `
        <div class="wb-memory-shell">
            <div class="wb-memory-toolbar">
                <div class="wb-memory-toolbar-top">
                    <span class="wb-memory-toolbar-summary">${allFacts.filter(fact => ['active', 'disputed'].includes(fact.status)).length} 条事实 · ${allClues.filter(clue => !clue.archived && ['open', 'developing', 'echoed', 'triggered'].includes(clue.status)).length} 条进行中伏笔 · ${allClues.filter(clue => clue.archived).length} 条归档</span>
                    <span class="wb-memory-intro-buttons">
                        <button type="button" data-wb-action="open-memory-editor" data-memory-kind="fact">＋ 新增记忆</button>
                        <button type="button" data-wb-action="open-memory-editor" data-memory-kind="clue">＋ 新增伏笔</button>
                    </span>
                </div>
                <div class="wb-memory-tools">
                <div class="wb-memory-filters" aria-label="记忆筛选">
                    ${filterButton('active', '进行中')}
                    ${filterButton('facts', '事实')}
                    ${filterButton('clues', '伏笔')}
                    ${filterButton('resolved-clues', '已回收')}
                    ${filterButton('archived-clues', '已归档')}
                    ${filterButton('episodes', '经历')}
                    ${filterButton('all', '全部')}
                </div>
                ${clueRelationSelect}
                <label class="wb-memory-search">
                    <span>搜索记忆</span>
                    <input type="search" data-wb-memory-search maxlength="80"
                        value="${escapeAttr(query)}" placeholder="人物、地点、物品或关键词">
                </label>
                <small>${query ? `找到 ${resultCount} 条` : `${resultCount} 条`}</small>
                ${observerMode === 'backstage' && resultCount ? `
                    <div class="wb-memory-bulk-tools">
                        <button type="button" data-wb-action="select-visible-memory"
                            data-memory-items="${escapeAttr(JSON.stringify([
                                ...shownFacts.filter(item => !item.locked).map(item => ({ kind: 'fact', id: item.id })),
                                ...shownClues.filter(item => !item.locked).map(item => ({ kind: 'clue', id: item.id })),
                                ...shownSummaries.filter(item => !item.locked).map(item => ({ kind: 'summary', id: item.id })),
                            ]))}">选择当前显示</button>
                        <button type="button" data-wb-action="clear-memory-selection"
                            ${selectedKeys.size ? '' : 'disabled'}>取消全部选择</button>
                        <button type="button" data-wb-action="bulk-delete-memory" data-wb-memory-selected-count
                            ${selectedKeys.size ? '' : 'disabled'}>删除选中${selectedKeys.size ? ` · ${selectedKeys.size}` : ''}</button>
                        <button class="is-danger" type="button" data-wb-action="clear-filtered-memory">
                            ${normalizedFilter === 'all' && !query ? '清空全部未锁定记忆' : '清空当前筛选'}
                        </button>
                    </div>
                ` : ''}
                </div>
            </div>
            ${(memory.metabolismLog || []).length ? `
                <details class="wb-fold wb-memory-digest" data-fold-key="memory:metabolism"
                    ${foldOpenAttr(openFolds, 'memory:metabolism')}>
                    <summary class="wb-memory-digest-summary">
                        <span><strong>最近收拾了什么～</strong></span>
                        <span class="wb-fold-meta"><small>${Math.min(12, (memory.metabolismLog || []).length)} 条最近变化</small><i class="wb-fold-chevron" aria-hidden="true"></i></span>
                    </summary>
                    <div class="wb-fold-body wb-memory-digest-body">
                        ${(memory.metabolismLog || []).slice(-12).reverse().map(item => `<p><strong>${escapeHtml(item.kind === 'fact' ? '事实' : item.kind === 'clue' ? '伏笔' : '经历')}</strong> · ${escapeHtml(item.action || '更新')}<br><small>${escapeHtml(item.reason || '已按后续内容整理')}</small></p>`).join('')}
                    </div>
                </details>
            ` : ''}
            ${digest?.text ? `
                <details class="wb-fold wb-memory-digest" data-fold-key="memory:digest"
                    ${foldOpenAttr(openFolds, 'memory:digest')}>
                    <summary class="wb-memory-digest-summary">
                        <span><strong>长期摘要</strong></span>
                        <span class="wb-fold-meta">
                            <small>已经乖乖整理好啦～</small>
                            <i class="wb-fold-chevron" aria-hidden="true"></i>
                        </span>
                    </summary>
                    <div class="wb-fold-body wb-memory-digest-body">
                        <p>${escapeHtml(digest.text)}</p>
                    </div>
                </details>
            ` : ''}
            ${resultCount === 0 ? renderEmpty(
                query ? '没有找到匹配的记忆' : '这个分类暂时是空的',
                query ? '换一个人物、地点、物品或关键词试试。' : '新的正文整理后会自动补充。',
            ) : `
            <div class="wb-memory-layout">
                <section class="wb-memory-section ${shownFacts.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading wb-memory-heading-with-folds">
                        <div><h3>长期事实</h3></div>
                        ${renderFoldToolbar('memory:facts:')}
                    </div>
                    <div class="wb-memory-group-list">
                        ${factGroups.map(group => {
                            const foldKey = `memory:facts:${encodeURIComponent(group.key || group.label)}`;
                            return `
                                <details class="wb-fold wb-memory-group" data-fold-key="${escapeAttr(foldKey)}"
                                    ${foldOpenAttr(openFolds, foldKey)}>
                                    <summary class="wb-memory-group-summary">
                                        <span>
                                            <strong>${escapeHtml(group.label)}</strong>
                                            <small>${group.items.length} 条长期事实</small>
                                        </span>
                                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                                    </summary>
                                    <div class="wb-fold-body wb-memory-group-body">
                                        ${group.items.map(item => renderFactCard(item, group.label)).join('')}
                                    </div>
                                </details>
                            `;
                        }).join('') || renderEmpty('还没有长期事实～', '以后真的重要、还会用到的事情会慢慢留在这里。')}
                    </div>
                </section>
                <section class="wb-memory-section ${shownClues.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading wb-memory-heading-with-folds">
                        <div><h3>伏笔簿</h3></div>
                        ${renderFoldToolbar('memory:clues:')}
                    </div>
                    <div class="wb-memory-group-list">
                        ${clueGroups.map(group => {
                            const foldKey = `memory:clues:${encodeURIComponent(group.key || group.label)}`;
                            return `
                                <details class="wb-fold wb-memory-group" data-fold-key="${escapeAttr(foldKey)}"
                                    ${foldOpenAttr(openFolds, foldKey)}>
                                    <summary class="wb-memory-group-summary">
                                        <span>
                                            <strong>${escapeHtml(group.label)}</strong>
                                            <small>${group.items.length} 条相关伏笔</small>
                                        </span>
                                        <i class="wb-fold-chevron" aria-hidden="true"></i>
                                    </summary>
                                    <div class="wb-fold-body wb-memory-group-body">
                                        ${group.items.map(renderClueCard).join('')}
                                    </div>
                                </details>
                            `;
                        }).join('') || renderEmpty('伏笔簿还是空的～', '以后有需要惦记着回收的线索，它们会自己冒出来。')}
                    </div>
                </section>
            </div>
            <section class="wb-memory-summary-section ${shownSummaries.length ? '' : 'is-hidden'}">
                <div class="wb-section-heading wb-memory-heading-with-folds">
                    <div><h3>经历</h3></div>
                    ${renderFoldToolbar('memory:summary:')}
                </div>
                <div class="wb-summary-list">
                    ${shownSummaries.map(summary => {
                        const foldKey = `memory:summary:${summary.id || `${summary.startMessageId}-${summary.endMessageId}`}`;
                        const levelMeta = memorySummaryLevelMeta(summary);
                        const sourceSummaries = (summary.sourceSummaryIds || [])
                            .map(id => summaryById.get(String(id)))
                            .filter(Boolean);
                        const parent = summary.parentId ? summaryById.get(String(summary.parentId)) : null;
                        return `
                            <details class="wb-fold wb-summary-card is-${escapeAttr(levelMeta.tone)}" data-fold-key="${escapeAttr(foldKey)}"
                                ${foldOpenAttr(openFolds, foldKey)}>
                                <summary class="wb-summary-card-summary">
                                    <span><strong>${escapeHtml(summary.title)}</strong></span>
                                    <i class="wb-fold-chevron" aria-hidden="true"></i>
                                </summary>
                                <div class="wb-fold-body wb-summary-card-body">
                                    <p>${escapeHtml(summary.summary)}</p>
                                    <details class="wb-memory-lineage">
                                        <summary>这段记忆从哪来～</summary>
                                        <div>
                                            <p>${escapeHtml(levelMeta.label)} · 消息 ${escapeHtml(summary.startMessageId)}—${escapeHtml(summary.endMessageId)}</p>
                                            ${parent ? `<p>已经收进：${escapeHtml(parent.title)}</p>` : ''}
                                            ${sourceSummaries.length ? `<p>还有 ${sourceSummaries.length} 条更细的来源可以追溯～</p>` : ''}
                                        </div>
                                    </details>
                                    ${renderMemoryActions('summary', summary, selectedKeys)}
                                </div>
                            </details>
                        `;
                    }).join('') || renderEmpty(
                        observerMode === 'backstage' ? '还没有分层经历' : '分层经历只在幕后视角显示',
                        observerMode === 'backstage' ? '正文整理后，重要经历会慢慢出现在这里～' : '',
                    )}
                </div>
            </section>
            `}
            ${hasMore ? `
                <button class="wb-memory-load-more" type="button" data-wb-action="load-more-memory">
                    再显示一些 · 当前 ${shownCount}/${resultCount}
                </button>
            ` : ''}
        </div>
    `;
}

function renderMemoryEditorModal(state, editor) {
    const requestedKind = ['fact', 'clue', 'summary'].includes(editor?.kind)
        ? editor.kind
        : 'fact';
    const collection = requestedKind === 'fact'
        ? state.storyMemory?.facts
        : requestedKind === 'clue'
            ? state.storyMemory?.clues
            : state.storyMemory?.summaries;
    const item = collection?.find(entry => entry.id === editor?.id) || null;
    const title = requestedKind === 'fact' ? item?.subject : item?.title;
    const relation = requestedKind === 'fact' ? item?.predicate : '';
    const content = requestedKind === 'fact'
        ? item?.value
        : requestedKind === 'clue'
            ? item?.text
            : item?.summary;
    const peopleText = requestedKind === 'clue' ? (item?.people || []).join('、') : '';
    const locationsText = requestedKind === 'clue' ? (item?.locations || []).join('、') : '';
    const eventsText = requestedKind === 'clue' ? (item?.events || []).join('、') : '';
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-memory-editor">
            <form class="wb-event-form wb-memory-editor" data-wb-form="memory">
                <div class="wb-form-heading">
                    <div><span>MEMORY DESK</span><h3>${item ? '编辑记忆' : '手动新增记忆'}</h3></div>
                    <button type="button" data-wb-action="close-memory-editor">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(item?.id || '')}">
                <label>记忆类型
                    <select name="kind" ${item ? 'disabled' : ''}>
                        <option value="fact" ${requestedKind === 'fact' ? 'selected' : ''}>长期事实</option>
                        <option value="clue" ${requestedKind === 'clue' ? 'selected' : ''}>伏笔</option>
                        <option value="summary" ${requestedKind === 'summary' ? 'selected' : ''}>阶段经历</option>
                    </select>
                    ${item ? `<input type="hidden" name="kind" value="${requestedKind}">` : ''}
                </label>
                <label>标题<input name="title" required maxlength="120"
                    value="${escapeAttr(title || '')}" placeholder="人物、物品、约定或事件"></label>
                <label>关系（长期事实可用）<input name="relation" maxlength="100"
                    value="${escapeAttr(relation || '')}" placeholder="例如：答应、持有、真实身份"></label>
                <label>内容<textarea name="content" required maxlength="1400" rows="5"
                    placeholder="写下需要长期保留的准确内容">${escapeHtml(content || '')}</textarea></label>
                ${requestedKind === 'clue' ? `
                    <div class="wb-memory-relation-editor">
                        <label>关联人物<input name="people" maxlength="500"
                            value="${escapeAttr(peopleText)}" placeholder="可多个，用、或逗号分开"></label>
                        <label>关联事件<input name="events" maxlength="500"
                            value="${escapeAttr(eventsText)}" placeholder="事件名或事件 ID，可多个"></label>
                        <label>关联地点<input name="locations" maxlength="500"
                            value="${escapeAttr(locationsText)}" placeholder="地点名，可多个"></label>
                    </div>
                    <div class="wb-form-note">关联只是方便找伏笔，不代表它“属于”某个人。跨人物、事件、地点的线索可以同时挂多个关联。</div>
                ` : ''}
                <div class="wb-memory-editor-flags">
                    <label><input name="important" type="checkbox" ${item?.important ? 'checked' : ''}> 标记为重要</label>
                    <label><input name="locked" type="checkbox" ${item?.locked ? 'checked' : ''}> 保存后锁定</label>
                </div>
                <div class="wb-form-note">锁定后，自动整理不会覆盖或删除这条记忆；需要修改时先在卡片上解锁。</div>
                <button class="wb-primary-button" type="submit">${item ? '保存修改' : '加入记忆'}</button>
            </form>
        </div>
    `;
}

function renderArchiveView(state, openFolds = new Set()) {
    const archived = Array.isArray(state.archive) ? state.archive : [];
    return `
        <div class="wb-archive-ledger">
            ${archived.map(entry => renderArchiveEntry(entry, state, 'archive', openFolds)).join('')
                || renderEmpty('纪事簿还是空的～', '还没有哪段世界历史悄悄错过镜头 (˘ω˘)')}
        </div>
    `;
}

function renderWorldEditorModal(state) {
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-world-editor">
            <form class="wb-event-form wb-world-editor" data-wb-form="world">
                <div class="wb-form-heading">
                    <div><span>WORLD DESK</span><h3>编辑世界设定</h3></div>
                    <button type="button" data-wb-action="close-world-editor">×</button>
                </div>
                <label>世界标题
                    <input name="title" required maxlength="140" value="${escapeAttr(state.world?.title || '')}">
                </label>
                <label>当前概况
                    <textarea name="detail" required maxlength="900" rows="6">${escapeHtml(state.world?.detail || '')}</textarea>
                </label>
                <label>世界背景设定
                    <textarea name="background" maxlength="5000" rows="12"
                        placeholder="写这个世界长期成立的基础：时代与科技/魔法水平、地理与主要势力、社会规则、重要历史、原作时间线锚点……">${escapeHtml(state.world?.background || '')}</textarea>
                </label>
                <div class="wb-form-note">
                    这里是世界的“地基”～后台人物、World Pulse、公共事件和正文一致性都会参考它；普通推演不会自己改写。适合写长期规则和重要时间线，不用把整张角色卡都塞进来 (｡•̀ᴗ-)✧
                </div>
                <button class="wb-primary-button" type="submit">保存世界设定</button>
            </form>
        </div>
    `;
}

function recordEditorData(state, editor) {
    if (!editor) return null;
    if (editor.kind === 'echo') {
        const event = state.events.find(item => item.id === editor.id);
        if (!event) return null;
        return {
            kind: 'echo',
            id: event.id,
            title: event.title || '',
            text: event.result || event.expectedResult || event.consequence || '',
            place: event.place || '',
            visibility: event.visibility || 'hidden',
            deliveryState: event.delivery?.state || 'none',
        };
    }
    const entry = state.archive.find(item => item.id === editor.id);
    if (!entry) return null;
    return {
        kind: 'archive',
        id: entry.id,
        title: entry.title || '未命名记录',
        text: entry.result || entry.text || entry.consequence || entry.route || '',
        place: '',
        visibility: entry.visibility || 'hidden',
        deliveryState: entry.deliveryState || entry.delivery?.state || 'none',
    };
}

function renderRecordEditorModal(state, editor) {
    const record = recordEditorData(state, editor);
    if (!record) return '';
    const isEcho = record.kind === 'echo';
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-record-editor">
            <form class="wb-event-form wb-record-editor" data-wb-form="record">
                <div class="wb-form-heading">
                    <div><span>${isEcho ? 'ECHO DESK' : 'ARCHIVE DESK'}</span><h3>${isEcho ? '编辑回声' : '编辑纪事'}</h3></div>
                    <button type="button" data-wb-action="close-record-editor">×</button>
                </div>
                <input type="hidden" name="kind" value="${escapeAttr(record.kind)}">
                <input type="hidden" name="id" value="${escapeAttr(record.id)}">
                <label>标题
                    <input name="title" required maxlength="140" value="${escapeAttr(record.title)}">
                </label>
                <label>${isEcho ? '形成的结果' : '纪事内容'}
                    <textarea name="text" required maxlength="900" rows="6">${escapeHtml(record.text)}</textarea>
                </label>
                ${isEcho ? `<label>地点
                    <input name="place" maxlength="160" value="${escapeAttr(record.place)}">
                </label>` : ''}
                <div class="wb-form-grid">
                    <label>可见边界
                        <select name="visibility">
                            <option value="hidden" ${record.visibility === 'hidden' ? 'selected' : ''}>完全幕后</option>
                            <option value="trace" ${record.visibility === 'trace' ? 'selected' : ''}>留下痕迹</option>
                            <option value="known" ${record.visibility === 'known' ? 'selected' : ''}>角色可知</option>
                            <option value="direct" ${record.visibility === 'direct' ? 'selected' : ''}>可直接显露</option>
                        </select>
                    </label>
                    ${isEcho ? `<label>递交状态
                        <select name="deliveryState">
                            <option value="none" ${record.deliveryState === 'none' ? 'selected' : ''}>尚未递交</option>
                            <option value="pending" ${record.deliveryState === 'pending' ? 'selected' : ''}>等待显露</option>
                            <option value="delivered" ${record.deliveryState === 'delivered' ? 'selected' : ''}>正文已承接</option>
                            <option value="expired" ${record.deliveryState === 'expired' ? 'selected' : ''}>未显露归档</option>
                        </select>
                    </label>` : ''}
                </div>
                <div class="wb-form-note">修改只会修正当前世界记录，不会推进主世界时间。删除则可以用底部撤销恢复。</div>
                <button class="wb-primary-button" type="submit">保存修改</button>
            </form>
        </div>
    `;
}

function visualViewportBounds() {
    const viewport = window.visualViewport;
    const left = Math.max(0, Number(viewport?.offsetLeft || 0));
    const top = Math.max(0, Number(viewport?.offsetTop || 0));
    const width = Math.max(0, Number(viewport?.width || window.innerWidth || 0));
    const height = Math.max(0, Number(viewport?.height || window.innerHeight || 0));
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function responsiveOrbSize(
    viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
) {
    const shortestSide = Math.min(viewportWidth, viewportHeight);
    if (shortestSide > 680) return 52;
    return Math.round(Math.max(34, Math.min(38, shortestSide * 0.09)));
}

function clampOrbPosition(position) {
    if (
        !position
        || !Number.isFinite(Number(position.x))
        || !Number.isFinite(Number(position.y))
        || typeof window === 'undefined'
    ) {
        return null;
    }
    const viewport = visualViewportBounds();
    const size = responsiveOrbSize(viewport.width, viewport.height);
    const margin = 10;
    const minX = viewport.left + margin;
    const minY = viewport.top + margin;
    const maxX = Math.max(minX, viewport.right - size - margin);
    const maxY = Math.max(minY, viewport.bottom - size - margin);
    return {
        x: Math.min(maxX, Math.max(minX, Number(position.x))),
        y: Math.min(maxY, Math.max(minY, Number(position.y))),
        size,
    };
}

function orbInlineStyles(position) {
    const placed = clampOrbPosition(position);
    if (!placed) return { orb: '', caption: '' };
    const captionWidth = 210;
    const captionX = placed.x > captionWidth + 28
        ? placed.x - captionWidth - 10
        : placed.x + placed.size + 10;
    return {
        orb: `left:${Math.round(placed.x)}px;top:${Math.round(placed.y)}px;right:auto;bottom:auto;`,
        caption: `left:${Math.round(Math.max(8, Math.min(window.innerWidth - captionWidth - 8, captionX)))}px;top:${Math.round(placed.y + 5)}px;right:auto;bottom:auto;`,
    };
}

function defaultVisibleOrbPosition(side = 'right') {
    const viewport = visualViewportBounds();
    const size = responsiveOrbSize(viewport.width, viewport.height);
    const margin = 12;
    return {
        x: side === 'left'
            ? viewport.left + margin
            : viewport.right - size - margin,
        y: Math.max(viewport.top + margin, viewport.bottom - size - 24),
        size,
    };
}

function nearestOrbEdgeSide(position) {
    const placed = clampOrbPosition(position);
    if (!placed) return 'right';
    const viewport = visualViewportBounds();
    return placed.x + placed.size / 2 < viewport.left + viewport.width / 2 ? 'left' : 'right';
}

function halfDockOrbPosition(position, side = 'right') {
    const viewport = visualViewportBounds();
    const placed = clampOrbPosition(position) || defaultVisibleOrbPosition(side);
    const size = placed.size || responsiveOrbSize(viewport.width, viewport.height);
    const y = Math.min(
        Math.max(viewport.top + 8, placed.y),
        Math.max(viewport.top + 8, viewport.bottom - size - 8),
    );
    // Put the orb centre exactly on the viewport edge: half visible, half outside.
    const x = side === 'left'
        ? viewport.left - size / 2
        : viewport.right - size / 2;
    return { x, y, size };
}

function halfDockOrbInlineStyle(position, side = 'right') {
    const placed = halfDockOrbPosition(position, side);
    return `left:${Math.round(placed.x)}px;top:${Math.round(placed.y)}px;right:auto;bottom:auto;`;
}

export function createWorldBackstageUI({
    getState,
    getSettings,
    getSyncStatus = () => ({ phase: 'idle', message: '尚未进行世界推演' }),
    getTavernProfiles = () => [],
    onAction,
    pluginVersion = '',
}) {
    const root = document.createElement('div');
    root.id = 'world-backstage-root';
    document.body.appendChild(root);

    function syncVisualViewportInsets() {
        const viewport = window.visualViewport;
        const viewportWidth = Number(viewport?.width || window.innerWidth || 0);
        const viewportHeight = Number(viewport?.height || window.innerHeight || 0);
        const offsetLeft = Math.max(0, Number(viewport?.offsetLeft || 0));
        const offsetTop = Math.max(0, Number(viewport?.offsetTop || 0));
        const right = Math.max(0, Number(window.innerWidth || 0) - viewportWidth - offsetLeft);
        root.style.setProperty('--wb-visual-inset-top', `${Math.round(offsetTop)}px`);
        root.style.setProperty('--wb-visual-inset-right', `${Math.round(right)}px`);
        root.style.setProperty('--wb-visual-inset-left', `${Math.round(offsetLeft)}px`);
        root.style.setProperty('--wb-visual-width', `${Math.round(viewportWidth)}px`);
        root.style.setProperty('--wb-visual-height', `${Math.round(viewportHeight)}px`);
    }
    syncVisualViewportInsets();

    function ensureMounted() {
        if (!root.isConnected) document.body.appendChild(root);
        syncVisualViewportInsets();
        const settings = getSettings();
        const orb = root.querySelector('.wb-world-orb');
        if (settings.orbEnabled !== false) {
            if (settings.orbPosition && orb) {
                positionOrbFromSettings(settings);
            }
            if (!orb) render();
        } else if (orb) {
            render();
        }
        const latestRevision = Math.max(0, Number(getState()?.revision) || 0);
        if (latestRevision !== renderedRevision) render();
        return root.isConnected;
    }

    let activeView = 'now';
    let renderedView = activeView;
    let observerMode = 'backstage';
    let isOpen = false;
    let settingsOpen = false;
    let settingsSection = 'common';
    let moduleSettingsView = '';
    let eventFormOpen = false;
    let eventEditorId = '';
    let selectedPersonId = null;
    let personObservation = null;
    let busy = false;
    let toast = '';
    let toastTimer = null;
    let closeTimer = null;
    let closing = false;
    let panelEntrancePending = false;
    let publicOpinionMode = 'news';
    let lingqiDraft = '';
    let lingqiMascotOverride = '';
    let lingqiMascotTimer = null;
    let lingqiChatScrollState = { top: 0, atBottom: true, initialized: false };
    let lingqiNotesScrollTop = 0;
    let lingqiReadableOpenKeys = new Set();
    let lingqiPetCount = 0;
    let lingqiPetWindowAt = 0;

    function currentLingqiMascotState(override = '') {
        const latest = getSyncStatus()?.lingqi || {};
        const notes = Array.isArray(latest.notes) ? latest.notes : [];
        const activeNotes = notes.filter(note => ['active', 'paused'].includes(note.status));
        const pending = latest.pendingProposal && typeof latest.pendingProposal === 'object'
            ? latest.pendingProposal
            : null;
        return lingqiMascotState(latest, activeNotes, pending, override);
    }

    function applyLingqiMascotPose(state = '') {
        if (!isOpen || activeView !== 'lingqi') return false;
        const mascot = root.querySelector('.wb-lingqi-mascot');
        if (!mascot) return false;

        const nextState = lingqiMascotAssetState(state || currentLingqiMascotState());
        const image = mascot.querySelector('img');
        const busyNow = getSyncStatus()?.lingqi?.phase === 'running';

        for (const mascotState of Object.keys(LINGQI_MASCOT_ASSETS)) {
            mascot.classList.remove(`is-${mascotState}`, `is-asset-${mascotState}`);
        }
        mascot.classList.add(`is-${nextState}`, `is-asset-${nextState}`);
        mascot.dataset.mascotState = nextState;
        mascot.title = busyNow ? '玲七正在想……' : '碰碰玲七';
        if (image) {
            image.src = LINGQI_MASCOT_ASSETS[nextState] || LINGQI_MASCOT_ASSETS.idle;
        }
        return true;
    }

    function showLingqiMascotReaction(state, duration = 1200) {
        lingqiMascotOverride = state;
        window.clearTimeout(lingqiMascotTimer);
        // Explicit user interaction may create one short reaction, but afterwards
        // Lingqi always returns to the pose chosen by the latest reply/state.
        applyLingqiMascotPose(currentLingqiMascotState(lingqiMascotOverride));
        lingqiMascotTimer = window.setTimeout(() => {
            lingqiMascotOverride = '';
            applyLingqiMascotPose(currentLingqiMascotState());
        }, duration);
    }
    let publicOpinionActionBusy = false;
    let publicOpinionSandboxActionBusy = false;
    let memorySearchTimer = null;
    let memoryFilter = 'active';
    let memoryClueRelationFilter = 'all';
    let memoryQuery = '';
    let memoryVisibleCount = 12;
    let memorySelectedKeys = new Set();
    let memoryEditor = null;
    let personEditor = null;
    let worldEditorOpen = false;
    let recordEditor = null;
    let settingsScrollTop = 0;
    let openSettingsGroups = new Set();
    let openSettingsSubgroups = new Set();
    let openContentFolds = new Set();
    const viewFoldStates = new Map();
    let eventFormDraft = null;
    let clockFormDraft = null;
    let apiFormDraft = null;
    let tagFilterDraftRules = null; // null = use settings; array may include empty draft cards
    let tagFilterCandidates = [];
    let worldbookQuery = '';
    let worldbookOnlyPeople = false;
    let worldbookOnlyEnabled = false;
    let worldbookSelectedIds = new Set();
    let worldbookSearchTimer = null;
    let skipApiDraftCapture = false;
    let skipTagFilterDraftCapture = false;
    const viewScrollTop = new Map();
    let orbDrag = null;
    let suppressOrbClick = false;
    let renderedRevision = Math.max(0, Number(getState()?.revision) || 0);
    let lastSeenRevision = renderedRevision;
    let dismissedNarrativePromptKey = '';
    let freshOpenCheckFrame = 0;

    function notify(message, tone = 'normal') {
        toast = String(message || '');
        root.dataset.toastTone = tone;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            toast = '';
            render();
        }, tone === 'error' ? 7600 : 5200);
        render();
    }

    function readApiForm(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        apiFormDraft = { ...data };
        return data;
    }

    function apiSettingsFromDraft(data) {
        const replacementKey = String(data.customApiCredential || '').trim();
        return {
            customApiUrl: data.customApiUrl,
            customApiKey: replacementKey || getSettings().customApiKey,
            customApiModel: data.customApiModel,
            customApiTransport: data.customApiTransport,
        };
    }

    function apiRequestFromDraft(data, { requireModel = true } = {}) {
        const settings = getSettings();
        const profileId = String(data.profileId || '').trim();
        const existingProfile = (settings.apiProfiles || []).find(item => item.id === profileId);
        const key = String(data.customApiCredential || '').trim()
            || existingProfile?.key
            || (!profileId ? settings.customApiKey : '');
        const model = String(data.customApiModel || '').trim();
        if (!key) throw new Error('这个接口还缺 API Key 哦～');
        if (requireModel && !model) throw new Error('先选个模型再测试吧～');
        return {
            url: data.customApiUrl,
            key,
            model,
            transport: data.customApiTransport,
            label: String(data.profileName || existingProfile?.name || '这个接口').trim() || '这个接口',
        };
    }

    function forgetApiKeyDraft(data) {
        apiFormDraft = { ...data, customApiCredential: '' };
        skipApiDraftCapture = true;
    }

    async function invokeAction(action, payload = {}) {
        try {
            const result = await onAction(action, payload);
            return result === undefined ? true : result;
        } catch (error) {
            const message = String(error?.message || error || '未知错误');
            console.warn('[世界背面] 界面操作没有完成', error);
            notify(`操作没有完成：${message}`, 'error');
            return false;
        }
    }

    function visibleTagFilterRules(settings) {
        if (Array.isArray(tagFilterDraftRules)) return tagFilterDraftRules;
        return Array.isArray(settings.tagFilterRules)
            ? settings.tagFilterRules.map(rule => ({ open: rule.open, close: rule.close }))
            : [];
    }

    async function persistTagFilterRules(rules) {
        const persisted = rules
            .map(rule => ({
                open: String(rule.open || '').trim().slice(0, 80),
                close: String(rule.close || '').trim().slice(0, 80),
            }))
            .filter(rule => rule.open || rule.close)
            .slice(0, 30);
        tagFilterDraftRules = rules.map(rule => ({
            open: String(rule.open || ''),
            close: String(rule.close || ''),
        }));
        skipTagFilterDraftCapture = true;
        await invokeAction('update-settings', { tagFilterRules: persisted });
    }

    function setBusy(value) {
        busy = Boolean(value);
        render();
    }

    function open() {
        window.clearTimeout(closeTimer);
        closing = false;
        panelEntrancePending = !isOpen;
        isOpen = true;
        render();
        window.cancelAnimationFrame?.(freshOpenCheckFrame);
        freshOpenCheckFrame = window.requestAnimationFrame?.(() => {
            freshOpenCheckFrame = 0;
            const latestRevision = Math.max(0, Number(getState()?.revision) || 0);
            if (latestRevision !== renderedRevision) render();
        }) || 0;
    }

    function close() {
        if (!isOpen || closing) return;
        closing = true;
        root.querySelector('.wb-panel-scrim')?.classList.add('is-closing');
        const closeDelay = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 0
            : 145;
        closeTimer = window.setTimeout(() => {
            isOpen = false;
            closing = false;
            settingsOpen = false;
            eventFormOpen = false;
            eventEditorId = '';
            eventFormDraft = null;
            clockFormDraft = null;
            tagFilterDraftRules = null;
            memoryEditor = null;
            memorySelectedKeys = new Set();
            personEditor = null;
            worldEditorOpen = false;
            recordEditor = null;
            selectedPersonId = null;
            personObservation = null;
            render();
        }, closeDelay);
    }

    function resetContext() {
        eventFormOpen = false;
        eventEditorId = '';
        eventFormDraft = null;
        clockFormDraft = null;
        selectedPersonId = null;
        personObservation = null;
        personEditor = null;
        memoryEditor = null;
        memorySelectedKeys = new Set();
        memoryQuery = '';
        memoryFilter = 'active';
        memoryClueRelationFilter = 'all';
        memoryVisibleCount = 12;
        worldEditorOpen = false;
        recordEditor = null;
        worldbookSelectedIds = new Set();
        worldbookQuery = '';
        lingqiDraft = '';
        lingqiChatScrollState = { top: 0, atBottom: true, initialized: false };
        lingqiNotesScrollTop = 0;
        lingqiReadableOpenKeys = new Set();
        viewFoldStates.clear();
        viewScrollTop.clear();
        openContentFolds = new Set();
        render();
    }

    function render() {
        const viewChanged = activeView !== renderedView;
        const animatePanelEntrance = Boolean(isOpen && panelEntrancePending);
        const previousContent = root.querySelector('.wb-view-content');
        if (previousContent) viewScrollTop.set(renderedView, previousContent.scrollTop);

        // Full UI renders can still happen for real data/status changes. Preserve every
        // user-controlled Lingqi <details> fold across those legitimate rebuilds.
        const previousLingqiReadables = root.querySelectorAll(
            'details[data-lingqi-readable-key]',
        );
        for (const detail of previousLingqiReadables) {
            const key = String(detail.dataset.lingqiReadableKey || '');
            if (!key) continue;
            if (detail.open) lingqiReadableOpenKeys.add(key);
            else lingqiReadableOpenKeys.delete(key);
        }

        const previousContentFolds = root.querySelectorAll('.wb-fold[data-fold-key]');
        if (previousContentFolds.length) {
            viewFoldStates.set(renderedView, new Set(
                [...previousContentFolds]
                    .filter(item => item.open)
                    .map(item => item.dataset.foldKey)
                    .filter(Boolean),
            ));
        }
        openContentFolds = new Set(viewFoldStates.get(activeView) || []);
        const previousSettings = root.querySelector('.wb-settings-popover');
        if (previousSettings) settingsScrollTop = previousSettings.scrollTop;
        const previousSettingGroups = root.querySelectorAll('.wb-settings-group[data-settings-group]');
        if (previousSettingGroups.length) {
            openSettingsGroups = new Set(
                [...previousSettingGroups]
                    .filter(group => group.open)
                    .map(group => group.dataset.settingsGroup),
            );
        }
        const previousSettingSubgroups = root.querySelectorAll('[data-settings-subgroup]');
        if (previousSettingSubgroups.length) {
            openSettingsSubgroups = new Set(
                [...previousSettingSubgroups]
                    .filter(group => group.open)
                    .map(group => group.dataset.settingsSubgroup),
            );
        }
        const previousEventForm = root.querySelector('[data-wb-form="event"]');
        if (previousEventForm && eventFormOpen) {
            eventFormDraft = Object.fromEntries(new FormData(previousEventForm).entries());
        }
        const previousClockForm = root.querySelector('[data-wb-form="clock"]');
        if (previousClockForm && (settingsOpen || moduleSettingsView)) {
            clockFormDraft = Object.fromEntries(new FormData(previousClockForm).entries());
        }
        const previousApiForm = root.querySelector('[data-wb-form="api"]');
        if (previousApiForm && !skipApiDraftCapture) {
            readApiForm(previousApiForm);
        }
        const previousLingqiInput = root.querySelector('[data-wb-form="lingqi-chat"] textarea[name="text"]');
        if (previousLingqiInput) lingqiDraft = previousLingqiInput.value;

        const previousLingqiChat = root.querySelector('.wb-lingqi-chat-log');
        if (previousLingqiChat) {
            const bottomGap = previousLingqiChat.scrollHeight
                - previousLingqiChat.scrollTop
                - previousLingqiChat.clientHeight;
            lingqiChatScrollState = {
                top: previousLingqiChat.scrollTop,
                atBottom: bottomGap <= 28,
                initialized: true,
            };
        }
        const previousLingqiNotes = root.querySelector('.wb-lingqi-notes-scroll');
        if (previousLingqiNotes) lingqiNotesScrollTop = previousLingqiNotes.scrollTop;

        skipApiDraftCapture = false;
        if (settingsOpen && !skipTagFilterDraftCapture) {
            const previousTagFilterRules = root.querySelectorAll('.wb-tag-filter-rule');
            if (previousTagFilterRules.length) {
                tagFilterDraftRules = [...previousTagFilterRules].map(card => ({
                    open: String(card.querySelector('[data-wb-tag-filter-field="open"]')?.value || ''),
                    close: String(card.querySelector('[data-wb-tag-filter-field="close"]')?.value || ''),
                }));
            }
        }
        skipTagFilterDraftCapture = false;
        const previousFocus = root.contains(document.activeElement)
            ? {
                id: document.activeElement.id || '',
                name: document.activeElement.getAttribute?.('name') || '',
                selectionStart: document.activeElement.selectionStart,
                selectionEnd: document.activeElement.selectionEnd,
            }
            : null;

        const state = getState();
        const settings = getSettings();
        const syncStatus = getSyncStatus();
        const tavernProfilesRaw = settingsOpen ? getTavernProfiles?.() : [];
        const tavernProfiles = Array.isArray(tavernProfilesRaw) ? tavernProfilesRaw : [];
        const canCancelSimulation = Boolean(syncStatus.canCancelSimulation);
        const manualSimulationQueued = Boolean(syncStatus.manualSimulationQueued);
        const canCancelBackgroundTask = Boolean(syncStatus.canCancelBackgroundTask);
        const activeBackgroundTasks = Array.isArray(syncStatus.activeBackgroundTasks)
            ? syncStatus.activeBackgroundTasks
            : [];
        const memoryPhase = syncStatus.memory?.phase;
        if (['running', 'error'].includes(memoryPhase)) {
            openSettingsGroups.add('memory');
            openSettingsSubgroups.add('memory-history');
        }
        const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
        const displayPhase = memoryTakesFocus ? memoryPhase : syncStatus.phase;
        const displayPhaseLabel = memoryTakesFocus
            ? (memoryPhase === 'error' ? '记忆失败' : '整理记忆中')
            : `${syncPhaseLabel(syncStatus.phase)}${syncStatus.queue?.waitingTurns > 0
                ? ` · 待 ${syncStatus.queue.waitingTurns} 轮`
                : ''}`;
        const theme = themeFor(state, settings);
        const clock = formatWorldCalendar(state);
        const clockAnchored = Boolean(state.clock?.anchored);
        const clockLabel = worldClockLabel(state, clock);
        const orbStyles = orbInlineStyles(settings.orbPosition);
        const currentView = VIEWS.find(view => view.id === activeView) || VIEWS[0];
        const userName = String(syncStatus.userName || '').toLocaleLowerCase();
        const displayPeople = state.people
            .map(person => {
                const isUser = Boolean(
                    person.isUser
                    || (userName && person.name?.toLocaleLowerCase() === userName)
                );
                return { ...person, isUser, innerVoice: isUser ? '' : person.innerVoice };
            })
            .filter(person => settings.recordPlayerCharacter !== false || !person.isUser);
        const candidatePeople = observerMode === 'backstage'
            ? displayPeople
            : displayPeople.filter(person => person.knowledge === 'known');
        const visibleEvents = observerMode === 'backstage'
            ? state.events
            : state.events.filter(event => event.visibility !== 'hidden');
        const presentPersonIds = new Set(syncStatus.presentPersonIds || []);
        const presentPeople = candidatePeople.filter(person => presentPersonIds.has(person.id));
        const activeEvents = sortEventsForDisplay(visibleEvents.filter(isActiveEvent), state, presentPeople);
        const visiblePeople = sortPeopleForDisplay(
            candidatePeople,
            activeEvents,
            presentPersonIds,
            state.clock?.absoluteMinute,
        );
        const outcomes = visibleEvents
            .filter(event => (event.status === 'ready' || isTerminalEvent(event)) && event.delivery?.state !== 'expired')
            .sort((a, b) => echoOutcomeMinute(b) - echoOutcomeMinute(a));
        const person = displayPeople.find(item => item.id === selectedPersonId);
        const canObservePerson = Boolean(
            person
            && observerMode === 'backstage'
            && !person.isUser
        );
        const pendingDeliveries = state.events.filter(event => event.delivery?.state === 'pending').length;
        const narrativeSync = syncStatus.narrative || {};
        const narrativeNeedsSimulation = Boolean(narrativeSync.needsSimulation);
        const orbProcessing = (
            ['queued', 'running', 'cancelling'].includes(syncStatus.phase)
            || syncStatus.memory?.phase === 'running'
        );
        const stateRevision = Math.max(0, Number(state.revision) || 0);
        const unreadWorldRevision = !isOpen && stateRevision > lastSeenRevision;
        const narrativeNeedsAttention = Boolean(
            narrativeNeedsSimulation
            || syncStatus.editDecision?.available
            || syncStatus.phase === 'error'
            || memoryPhase === 'error'
        );
        const worldHasUnreadUpdate = Boolean(
            !narrativeNeedsAttention
            && (unreadWorldRevision || pendingDeliveries)
        );
        const needsAttention = narrativeNeedsAttention || worldHasUnreadUpdate;
        const narrativePromptKey = narrativeNeedsSimulation
            ? `${String(narrativeSync.sourceKey || narrativeSync.latestMessageId || 'latest')}:${syncStatus.phase === 'error' ? 'error' : 'pending'}`
            : '';
        const captionCanSimulate = Boolean(
            narrativeNeedsSimulation
            && !isOpen
            && !orbProcessing
            && settings.enabled
            && settings.worldSimulationEnabled
            && narrativePromptKey !== dismissedNarrativePromptKey
        );
        const captionText = memoryPhase === 'error'
            ? syncStatus.memory?.message || '记忆整理刚刚绊了一下 QAQ，点开看看原因～'
            : memoryPhase === 'running'
                ? syncStatus.memory.message || '记忆正在悄悄收拾中～ (｡•̀ᴗ-)✧'
                : orbProcessing
                    ? syncStatus.message || '镜头外的世界正在悄悄运转中… ( •̀ ω •́ )✧'
                    : syncStatus.phase === 'error'
                        ? '唔，这轮正文还没推演成功 QAQ，可以在这里重试～'
                        : narrativeNeedsSimulation
                            ? `${Math.max(1, Number(narrativeSync.pendingTurns) || 1)} 轮新正文还没推演，要现在追上吗？`
                            : pendingDeliveries > 0
                                ? `${pendingDeliveries} 条变化正慢慢靠近镜头～`
                                : unreadWorldRevision
                                    ? '世界刚刚有了新变化，点开看看吧～ (｡•̀ᴗ-)✧'
                                    : '镜头之外暂时安安静静的～ (˘ω˘)';
        const orbEdgeSide = nearestOrbEdgeSide(settings.orbPosition);
        const orbEdgeHidden = Boolean(settings.orbEdgeHide && !isOpen);
        const renderedOrbStyle = orbEdgeHidden
            ? halfDockOrbInlineStyle(settings.orbPosition, orbEdgeSide)
            : orbStyles.orb;

        let content = '';
        if (activeView === 'now') content = renderNowView(state, observerMode, visiblePeople, activeEvents, narrativeSync);
        if (activeView === 'lingqi') content = renderLingqiView(
            syncStatus.lingqi || {},
            lingqiDraft,
            lingqiMascotOverride,
            lingqiReadableOpenKeys,
        );
        if (activeView === 'people') content = renderPeopleView(state, observerMode, visiblePeople, openContentFolds);
        if (activeView === 'currents') content = renderCurrentsView(state, activeEvents, openContentFolds, settings);
        if (activeView === 'echoes') content = renderEchoesView(state, outcomes, openContentFolds);
        if (activeView === 'opinion') content = renderPublicOpinionView(
            state,
            {
                ...(syncStatus.publicOpinion || {}),
                interactionBusy: publicOpinionActionBusy,
                sandboxInteractionBusy: publicOpinionSandboxActionBusy,
            },
            publicOpinionMode,
            settings,
        );
        if (activeView === 'memory') content = renderMemoryView(state, observerMode, {
            query: memoryQuery,
            filter: memoryFilter,
            visibleCount: memoryVisibleCount,
            openFolds: openContentFolds,
            selectedKeys: memorySelectedKeys,
            clueRelationFilter: memoryClueRelationFilter,
        });
        if (activeView === 'archive') content = renderArchiveView(state, openContentFolds);

        root.className = `wb-root theme-${theme} wb-size-${settings.uiScale} ${settings.enabled ? 'is-enabled' : 'is-disabled'}`;
        root.innerHTML = `
            ${settings.orbEnabled !== false ? `
            <button class="wb-world-orb ${isOpen ? 'is-open' : ''} ${orbProcessing ? 'is-processing' : ''} ${settings.orbPosition ? 'has-custom-position' : ''} ${orbEdgeHidden ? `is-edge-hidden is-edge-${orbEdgeSide}` : ''}" type="button"
                style="${renderedOrbStyle}" data-wb-action="toggle-panel"
                aria-label="${isOpen ? '收起世界背面' : '打开世界背面'}">
                <span class="wb-orb-halo"></span>
                <span class="wb-orb-ring ring-one"></span>
                <span class="wb-orb-ring ring-two"></span>
                <span class="wb-orb-core"></span>
                ${narrativeNeedsAttention
                    ? '<i class="wb-orb-notice" aria-hidden="true"></i>'
                    : worldHasUnreadUpdate
                        ? '<i class="wb-orb-update" aria-hidden="true"></i>'
                        : ''}
            </button>
            <div class="wb-orb-caption ${!isOpen && needsAttention && !orbEdgeHidden ? 'is-visible' : ''} ${captionCanSimulate ? 'has-action' : ''}"
                style="${orbStyles.caption}" role="${captionCanSimulate ? 'dialog' : 'status'}" aria-live="polite"
                ${captionCanSimulate ? 'aria-label="发现未推演正文"' : ''}>
                <div class="wb-orb-caption-copy">
                    <strong>世界背面</strong>
                    <span>${escapeHtml(captionText)}</span>
                </div>
                ${captionCanSimulate ? `
                    <div class="wb-orb-caption-actions">
                        <button type="button" class="wb-orb-caption-later" data-wb-action="dismiss-narrative-prompt"
                            data-prompt-key="${escapeAttr(narrativePromptKey)}">稍后</button>
                        <button type="button" class="wb-orb-caption-sync" data-wb-action="manual-sync">
                            ${syncStatus.phase === 'error' ? '重新推演' : '推演'}
                        </button>
                    </div>
                ` : ''}
            </div>
            ` : ''}

            ${isOpen ? `
                <div class="wb-panel-scrim ${animatePanelEntrance ? 'is-opening' : ''}" data-wb-action="close-panel">
                    <section class="wb-window" role="dialog" aria-modal="true" aria-label="世界背面">
                        <header class="wb-window-header">
                            <div class="wb-brand">
                                ${renderBrandMark()}
                                <div>
                            <span class="wb-brand-line"><h1>世界背面</h1><i>${escapeHtml(pluginDisplayVersion(pluginVersion))}</i></span>
                                    <p>镜头之外，世界仍在继续</p>
                                </div>
                            </div>
                            <time class="wb-mobile-clock-time"
                                ${clockAnchored ? `datetime="${escapeAttr(
                                    `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.dayOfMonth).padStart(2, '0')}T${clock.time}`,
                                )}"` : ''}
                                aria-label="${clockAnchored ? `主世界时间 ${escapeAttr(clock.time)}` : '主世界时间尚未校准'}">
                                ${clockAnchored ? escapeHtml(clock.time) : '--:--'}
                            </time>
                            <div class="wb-header-center">
                                <time class="wb-world-calendar" ${clockAnchored ? `datetime="${escapeAttr(
                                    `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.dayOfMonth).padStart(2, '0')}T${clock.time}`,
                                )}"` : ''} aria-label="${escapeAttr(clockLabel)}">
                                    ${clockAnchored ? `
                                        <span class="wb-calendar-page" aria-hidden="true">
                                            <small>${escapeHtml(`${clock.month}月`)}</small>
                                            <strong>${escapeHtml(String(clock.dayOfMonth).padStart(2, '0'))}</strong>
                                        </span>
                                        <span class="wb-calendar-copy">
                                            <small>${escapeHtml(`${state.world.name} · ${clock.calendarName}`)}</small>
                                            <strong>${escapeHtml(`${clock.year} 年 ${clock.month} 月`)}</strong>
                                            <em>${escapeHtml(clock.time)}</em>
                                        </span>
                                    ` : `
                                        <span class="wb-calendar-page" aria-hidden="true">
                                            <small>时间</small>
                                            <strong>··</strong>
                                        </span>
                                        <span class="wb-calendar-copy">
                                            <small>${escapeHtml(`${state.world.name} · 主世界钟`)}</small>
                                            <strong>等待首次校准</strong>
                                            <em>推演后建立</em>
                                        </span>
                                    `}
                                </time>
                                <span class="wb-live-status is-${escapeAttr(displayPhase)}">
                                    <i></i>${escapeHtml(displayPhaseLabel)}
                                </span>
                            </div>
                            <div class="wb-header-actions">
                                <button type="button" class="wb-round-action" data-wb-action="cycle-theme"
                                    aria-label="切换日间/夜间"><span class="wb-theme-glyph"></span></button>
                                <button type="button" class="wb-round-action ${settingsOpen ? 'is-active' : ''}"
                                    data-wb-action="toggle-settings" aria-label="全局设置">
                                    <span class="wb-settings-glyph"></span>
                                </button>
                                <button type="button" class="wb-round-action" data-wb-action="toggle-panel"
                                    aria-label="收起">—</button>
                            </div>
                        </header>

                        <div class="wb-window-body">
                            <nav class="wb-side-nav">
                                ${VIEWS.map(view => `
                                    <button type="button" data-wb-action="set-view" data-view="${view.id}"
                                        aria-current="${activeView === view.id ? 'page' : 'false'}"
                                        class="${activeView === view.id ? 'is-active' : ''}">
                                        <i></i><span><small>${view.eyebrow}</small><strong>${view.label}</strong></span>
                                    </button>
                                `).join('')}
                                <button class="wb-side-sync wb-sim-action ${canCancelSimulation ? 'is-cancel' : manualSimulationQueued ? 'is-queued' : ''}"
                                    type="button" data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                    ${manualSimulationQueued ? 'disabled' : ''}
                                    title="${canCancelSimulation
                                        ? '只停止当前世界推演，不影响其他后台任务'
                                        : manualSimulationQueued
                                            ? '已排队；会在当前后台任务安全结束后自动开始'
                                            : busy
                                                ? '当前有后台任务在运行；点击后安全排队，不会并发写世界状态'
                                                : '推演最新正文'}">
                                    <i aria-hidden="true"></i><span>${canCancelSimulation ? '停止推演' : manualSimulationQueued ? '推演已排队' : '推演世界'}</span>
                                </button>
                            </nav>

                            <div class="wb-content-column ${activeView === 'lingqi' ? 'is-lingqi-column' : ''}">
                                <div class="wb-view-header">
                                    <div><span>${currentView.eyebrow}</span><h2>${currentView.label}</h2></div>
                                    <div class="wb-view-header-tools">
                                        ${activeView === 'opinion' ? `
                                            <div class="wb-public-readonly-badge wb-public-mode-badge ${settings.publicOpinionRevealMode === 'relevant' ? 'is-relevant' : 'is-observe'}"
                                                aria-live="polite" title="当前舆情显露模式">
                                                <i></i>${settings.publicOpinionRevealMode === 'relevant' ? '相关时显露' : '仅观察'}
                                            </div>
                                        ` : activeView === 'lingqi' ? `
                                            <div class="wb-lingqi-header-badge" aria-label="玲七">₍^. .^₎⟆</div>
                                        ` : `
                                            <div class="wb-observer-switch">
                                                <button type="button" data-wb-action="set-observer" data-mode="backstage"
                                                    aria-pressed="${observerMode === 'backstage'}"
                                                    class="${observerMode === 'backstage' ? 'is-active' : ''}">幕后视角</button>
                                                <button type="button" data-wb-action="set-observer" data-mode="known"
                                                    aria-pressed="${observerMode === 'known'}"
                                                    class="${observerMode === 'known' ? 'is-active' : ''}">角色所知</button>
                                            </div>
                                        `}
                                        ${['now', 'people', 'currents', 'opinion', 'memory'].includes(activeView) ? `
                                            <button type="button"
                                                class="wb-view-settings-action ${moduleSettingsView === activeView ? 'is-active' : ''}"
                                                data-wb-action="toggle-module-settings" data-view="${activeView}"
                                                aria-label="${escapeAttr(currentView.label)}设置" title="${escapeAttr(currentView.label)}设置">
                                                <span class="wb-settings-glyph" aria-hidden="true"></span>
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                                ${renderSyncStrip(syncStatus)}
                                <div class="wb-view-content ${activeView === 'lingqi' ? 'is-lingqi-view' : ''} ${viewChanged ? 'is-entering' : ''}">${content}</div>
                                <footer class="wb-window-footer">
                                    <div class="wb-footer-world-meta">
                                        <span>主世界 ${escapeHtml(clockLabel)}</span><i></i>
                                        <span>AI回复：由世界钟结算实际耗时</span><i></i>
                                        <span>独白：仅幕后可见</span>
                                    </div>
                                    <div class="wb-footer-task-controls">
                                        <button class="wb-sim-action wb-footer-sim-mobile ${canCancelSimulation ? 'is-cancel' : manualSimulationQueued ? 'is-queued' : ''}"
                                            type="button" data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                            ${manualSimulationQueued ? 'disabled' : ''}
                                            title="${canCancelSimulation
                                                ? '只停止当前世界推演，不影响其他后台任务'
                                                : manualSimulationQueued
                                                    ? '已排队；会在当前后台任务安全结束后自动开始'
                                                    : busy
                                                        ? '当前有后台任务在运行；点击后安全排队，不会并发写世界状态'
                                                        : '推演最新正文'}">
                                            <i aria-hidden="true"></i>
                                            <span>${canCancelSimulation ? '停止推演' : manualSimulationQueued ? '推演已排队' : '推演世界'}</span>
                                        </button>
                                        <button class="wb-sim-action wb-global-stop ${canCancelBackgroundTask ? 'is-cancel' : ''}" type="button"
                                            data-wb-action="cancel-background-tasks"
                                            ${canCancelBackgroundTask ? '' : 'disabled'}
                                            title="${canCancelBackgroundTask
                                                ? `正在运行：${escapeAttr(activeBackgroundTasks.join('、'))}。点击停止全部后台任务`
                                                : '当前没有正在运行或排队的后台任务'}">
                                            <i aria-hidden="true"></i><span>停止全部后台任务</span>
                                        </button>
                                    </div>
                                </footer>
                            </div>
                        </div>

                    </section>
                    ${settingsOpen ? `
                        <div class="wb-settings-layer">
                            ${renderSettings(
                                state,
                                settings,
                                syncStatus,
                                openSettingsGroups,
                                openSettingsSubgroups,
                                apiFormDraft,
                                visibleTagFilterRules(settings),
                                tagFilterCandidates,
                                {
                                    query: worldbookQuery,
                                    onlyPeople: worldbookOnlyPeople,
                                    onlyEnabled: worldbookOnlyEnabled,
                                    selectedIds: worldbookSelectedIds,
                                },
                                tavernProfiles,
                                settingsSection,
                            )}
                        </div>
                    ` : ''}
                    ${moduleSettingsView ? `
                        <div class="wb-settings-layer wb-module-settings-layer">
                            ${renderModuleSettings(
                                state,
                                settings,
                                syncStatus,
                                moduleSettingsView,
                                openSettingsSubgroups,
                                {
                                    query: worldbookQuery,
                                    onlyPeople: worldbookOnlyPeople,
                                    onlyEnabled: worldbookOnlyEnabled,
                                    selectedIds: worldbookSelectedIds,
                                },
                            )}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            ${eventFormOpen ? renderEventModal(state, eventEditorId) : ''}
            ${memoryEditor ? renderMemoryEditorModal(state, memoryEditor) : ''}
            ${personEditor ? renderPersonEditorModal(state, personEditor) : ''}
            ${worldEditorOpen ? renderWorldEditorModal(state) : ''}
            ${recordEditor ? renderRecordEditorModal(state, recordEditor) : ''}
            ${person ? renderPersonDrawer(person, observerMode, state.clock.absoluteMinute, {
                canObserve: canObservePerson,
                observation: personObservation,
                busy,
            }) : ''}
            ${syncStatus.editDecision?.available ? `
                <div class="wb-edit-choice" role="alertdialog" aria-modal="false"
                    aria-labelledby="wb-edit-choice-title" aria-describedby="wb-edit-choice-detail">
                    <span class="wb-edit-choice-face" aria-hidden="true">${escapeHtml(TOAST_FACES.warning)}</span>
                    <div class="wb-edit-choice-copy">
                        <strong id="wb-edit-choice-title">检测到已推演正文被修改</strong>
                        <p id="wb-edit-choice-detail">剧情、时间或人物行动有变化时建议重推；若只修正错字、标点或措辞，可以保留原推演。</p>
                    </div>
                    <div class="wb-edit-choice-actions">
                        <button type="button" class="is-rerun" data-wb-action="resolve-message-edit" data-mode="rerun">按修改后正文重推</button>
                        <button type="button" data-wb-action="resolve-message-edit" data-mode="keep">保留原推演</button>
                    </div>
                </div>
            ` : ''}
            ${toast ? `
                <div class="wb-toast" role="${root.dataset.toastTone === 'error' ? 'alert' : 'status'}" aria-live="polite">
                    <span aria-hidden="true">${escapeHtml(TOAST_FACES[root.dataset.toastTone] || TOAST_FACES.info)}</span>
                    <div><strong>${escapeHtml(TOAST_LABELS[root.dataset.toastTone] || TOAST_LABELS.info)}</strong><p>${escapeHtml(toast)}</p></div>
                </div>
            ` : ''}
            ${syncStatus.manualUndo?.available ? `
                <div class="wb-undo-toast" role="status">
                    <span>${escapeHtml(syncStatus.manualUndo.label)}</span>
                    <button type="button" data-wb-action="undo-manual">撤销</button>
                </div>
            ` : ''}
        `;
        panelEntrancePending = false;

        const currentContent = root.querySelector('.wb-view-content');
        if (currentContent) {
            // A module switch is a new reading context. Reusing another visit's
            // scroll offset made the first row look clipped beneath the status bar.
            currentContent.scrollTop = viewChanged ? 0 : (viewScrollTop.get(activeView) || 0);
        }
        const currentLingqiChat = root.querySelector('.wb-lingqi-chat-log');
        if (currentLingqiChat) {
            if (!lingqiChatScrollState.initialized || lingqiChatScrollState.atBottom) {
                currentLingqiChat.scrollTop = currentLingqiChat.scrollHeight;
            } else {
                currentLingqiChat.scrollTop = Math.min(
                    lingqiChatScrollState.top,
                    Math.max(0, currentLingqiChat.scrollHeight - currentLingqiChat.clientHeight),
                );
            }
            lingqiChatScrollState = {
                top: currentLingqiChat.scrollTop,
                atBottom: (
                    currentLingqiChat.scrollHeight
                    - currentLingqiChat.scrollTop
                    - currentLingqiChat.clientHeight
                ) <= 28,
                initialized: true,
            };
        }
        const currentLingqiNotes = root.querySelector('.wb-lingqi-notes-scroll');
        if (currentLingqiNotes) {
            currentLingqiNotes.scrollTop = Math.min(
                lingqiNotesScrollTop,
                Math.max(0, currentLingqiNotes.scrollHeight - currentLingqiNotes.clientHeight),
            );
        }
        const currentSettings = root.querySelector('.wb-settings-popover');
        if (currentSettings) currentSettings.scrollTop = settingsScrollTop;
        const currentEventForm = root.querySelector('[data-wb-form="event"]');
        if (currentEventForm && eventFormDraft) {
            for (const [name, value] of Object.entries(eventFormDraft)) {
                const field = currentEventForm.elements.namedItem(name);
                if (field && 'value' in field) field.value = value;
            }
        }
        const currentClockForm = root.querySelector('[data-wb-form="clock"]');
        if (currentClockForm && clockFormDraft) {
            for (const [name, value] of Object.entries(clockFormDraft)) {
                const field = currentClockForm.elements.namedItem(name);
                if (field && 'value' in field) field.value = value;
            }
        }
        if (previousFocus) {
            const selector = previousFocus.id
                ? `#${globalThis.CSS?.escape?.(previousFocus.id) || previousFocus.id}`
                : previousFocus.name
                    ? `[name="${globalThis.CSS?.escape?.(previousFocus.name) || previousFocus.name}"]`
                    : '';
            const field = selector ? root.querySelector(selector) : null;
            if (field) {
                field.focus({ preventScroll: true });
                if (
                    typeof field.setSelectionRange === 'function'
                    && Number.isInteger(previousFocus.selectionStart)
                ) {
                    field.setSelectionRange(previousFocus.selectionStart, previousFocus.selectionEnd);
                }
            }
        }
        renderedView = activeView;
        renderedRevision = stateRevision;
        if (isOpen) lastSeenRevision = Math.max(lastSeenRevision, stateRevision);
    }

    function positionOrbElements(x, y) {
        const placed = clampOrbPosition({ x, y });
        if (!placed) return null;
        const orb = root.querySelector('.wb-world-orb');
        const caption = root.querySelector('.wb-orb-caption');
        if (orb) {
            orb.style.left = `${placed.x}px`;
            orb.style.top = `${placed.y}px`;
            orb.style.right = 'auto';
            orb.style.bottom = 'auto';
        }
        if (caption) {
            const captionWidth = 238;
            const captionX = placed.x > captionWidth + 28
                ? placed.x - captionWidth - 10
                : placed.x + placed.size + 10;
            caption.style.left = `${Math.max(8, Math.min(window.innerWidth - captionWidth - 8, captionX))}px`;
            caption.style.top = `${placed.y + 5}px`;
            caption.style.right = 'auto';
            caption.style.bottom = 'auto';
        }
        return placed;
    }

    function positionOrbFromSettings(settings = getSettings()) {
        const position = settings?.orbPosition;
        if (!position) return null;
        if (settings.orbEdgeHide && !isOpen) {
            const orb = root.querySelector('.wb-world-orb');
            if (!orb) return null;
            const placed = halfDockOrbPosition(position, nearestOrbEdgeSide(position));
            orb.style.left = `${placed.x}px`;
            orb.style.top = `${placed.y}px`;
            orb.style.right = 'auto';
            orb.style.bottom = 'auto';
            return placed;
        }
        return positionOrbElements(position.x, position.y);
    }

    root.addEventListener('pointerdown', event => {
        const orb = event.target.closest('.wb-world-orb');
        if (!orb || event.button !== 0) return;
        if (orb.classList.contains('is-edge-hidden')) {
            const side = orb.classList.contains('is-edge-left') ? 'left' : 'right';
            orb.classList.remove('is-edge-hidden', 'is-edge-left', 'is-edge-right');
            const saved = getSettings().orbPosition;
            const visible = saved || defaultVisibleOrbPosition(side);
            positionOrbElements(visible.x, visible.y);
        }
        const rect = orb.getBoundingClientRect();
        orb.style.setProperty('left', `${rect.left}px`, 'important');
        orb.style.setProperty('top', `${rect.top}px`, 'important');
        orb.style.setProperty('right', 'auto', 'important');
        orb.style.setProperty('bottom', 'auto', 'important');
        orb.classList.add('has-custom-position');
        orbDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: rect.left,
            originY: rect.top,
            moved: false,
            x: rect.left,
            y: rect.top,
        };
        orb.setPointerCapture?.(event.pointerId);
        orb.classList.add('is-dragging');
    });

    root.addEventListener('pointermove', event => {
        if (!orbDrag || event.pointerId !== orbDrag.pointerId) return;
        const deltaX = event.clientX - orbDrag.startX;
        const deltaY = event.clientY - orbDrag.startY;
        if (Math.hypot(deltaX, deltaY) > 5) orbDrag.moved = true;
        if (!orbDrag.moved) return;
        const placed = positionOrbElements(orbDrag.originX + deltaX, orbDrag.originY + deltaY);
        if (placed) {
            orbDrag.x = placed.x;
            orbDrag.y = placed.y;
        }
        event.preventDefault();
    });

    const finishOrbDrag = async event => {
        if (!orbDrag || event.pointerId !== orbDrag.pointerId) return;
        const orb = root.querySelector('.wb-world-orb');
        orb?.classList.remove('is-dragging');
        orb?.releasePointerCapture?.(event.pointerId);
        const completed = orbDrag;
        orbDrag = null;
        if (!completed.moved) return;

        const viewport = visualViewportBounds();
        const orbSize = responsiveOrbSize(viewport.width, viewport.height);
        const margin = 12;
        const snappedX = completed.x + orbSize / 2 < viewport.left + viewport.width / 2
            ? viewport.left + margin
            : viewport.right - orbSize - margin;
        const placed = positionOrbElements(snappedX, completed.y);
        suppressOrbClick = true;
        window.setTimeout(() => {
            suppressOrbClick = false;
        }, 260);
        if (placed) {
            await invokeAction('update-settings', {
                orbPosition: { x: placed.x, y: placed.y },
            });
        }
    };
    root.addEventListener('pointerup', finishOrbDrag);
    root.addEventListener('pointercancel', finishOrbDrag);

    root.addEventListener('click', async event => {
        const target = event.target.closest('[data-wb-action]');
        if (!target) return;
        if (
            target.classList.contains('wb-drawer-scrim')
            && event.target.closest('.wb-event-form, .wb-person-drawer')
        ) {
            return;
        }
        const action = target.dataset.wbAction;

        if (action === 'close-panel') {
            if (event.target === target) close();
            return;
        }
        if (action === 'toggle-panel') {
            if (target.classList.contains('wb-world-orb') && suppressOrbClick) {
                suppressOrbClick = false;
                event.preventDefault();
                return;
            }
            isOpen ? close() : open();
            return;
        }
        if (action === 'dismiss-narrative-prompt') {
            dismissedNarrativePromptKey = String(target.dataset.promptKey || '');
            render();
            return;
        }
        if (action === 'set-view') {
            const nextView = target.dataset.view || 'now';
            if (activeView === 'memory' && nextView !== 'memory') memorySelectedKeys = new Set();
            if (nextView !== 'lingqi') {
                lingqiMascotOverride = '';
                window.clearTimeout(lingqiMascotTimer);
            }
            activeView = nextView;
            moduleSettingsView = '';
            render();
            return;
        }
        if (action === 'lingqi-pet') {
            const now = Date.now();
            if (now - lingqiPetWindowAt < 1800) lingqiPetCount += 1;
            else lingqiPetCount = 1;
            lingqiPetWindowAt = now;

            const nextState = lingqiPetCount >= 4
                ? 'hold'
                : lingqiPetCount === 3
                    ? 'happy'
                    : 'watch';
            showLingqiMascotReaction(nextState, nextState === 'hold' ? 1550 : 1050);
            if (lingqiPetCount >= 4) lingqiPetCount = 0;
            return;
        }

        if (action === 'lingqi-copy-support-pack') {
            const copied = await invokeAction('lingqi-copy-support-pack', {
                messageId: target.dataset.messageId || '',
            });
            if (copied) showLingqiMascotReaction('watch', 900);
            return;
        }

        if (action === 'lingqi-confirm-note') {
            const completed = await invokeAction('lingqi-confirm-note');
            if (completed) {
                notify('ฅ  贴住了', 'success');
                showLingqiMascotReaction('happy', 1250);
            } else {
                render();
            }
            return;
        }
        if (action === 'lingqi-dismiss-note') {
            await invokeAction('lingqi-dismiss-note');
            showLingqiMascotReaction('hold', 900);
            return;
        }
        if (action === 'lingqi-pause-note') {
            await invokeAction('lingqi-pause-note', { noteId: target.dataset.noteId || '' });
            showLingqiMascotReaction('hold', 1000);
            return;
        }
        if (action === 'lingqi-resume-note') {
            await invokeAction('lingqi-resume-note', { noteId: target.dataset.noteId || '' });
            showLingqiMascotReaction('note', 900);
            return;
        }
        if (action === 'lingqi-cancel-note') {
            await invokeAction('lingqi-cancel-note', { noteId: target.dataset.noteId || '' });
            showLingqiMascotReaction('hold', 900);
            return;
        }

        if (action === 'open-world-editor') {
            worldEditorOpen = true;
            render();
            return;
        }
        if (action === 'close-world-editor') {
            worldEditorOpen = false;
            render();
            return;
        }
        if (action === 'open-record-editor') {
            recordEditor = {
                kind: target.dataset.recordKind === 'archive' ? 'archive' : 'echo',
                id: target.dataset.recordId || '',
            };
            render();
            return;
        }
        if (action === 'close-record-editor') {
            recordEditor = null;
            render();
            return;
        }
        if (action === 'delete-record') {
            const kind = target.dataset.recordKind === 'archive' ? 'archive' : 'echo';
            const confirmed = globalThis.confirm?.(`(・_・;)  确定删除这条${kind === 'echo' ? '回声' : '纪事'}吗？删除后可以用底部撤销恢复。`);
            if (confirmed === false) return;
            const completed = await invokeAction('delete-record', {
                kind,
                id: target.dataset.recordId || '',
            });
            if (completed && recordEditor?.id === (target.dataset.recordId || '')) recordEditor = null;
            render();
            return;
        }
        if (action === 'expand-folds' || action === 'collapse-folds') {
            const prefix = target.dataset.foldPrefix || '';
            const shouldOpen = action === 'expand-folds';
            [...root.querySelectorAll('.wb-fold[data-fold-key]')]
                .filter(item => !prefix || String(item.dataset.foldKey || '').startsWith(prefix))
                .forEach(item => {
                    item.open = shouldOpen;
                    const key = item.dataset.foldKey;
                    if (!key) return;
                    if (shouldOpen) openContentFolds.add(key);
                    else openContentFolds.delete(key);
                });
            return;
        }
        if (action === 'set-memory-filter') {
            memoryFilter = target.dataset.filter || 'active';
            memoryVisibleCount = 12;
            memorySelectedKeys = new Set();
            render();
            return;
        }
        if (action === 'open-memory-editor') {
            memoryEditor = {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
            };
            render();
            return;
        }
        if (action === 'close-memory-editor') {
            memoryEditor = null;
            render();
            return;
        }
        if (action === 'set-clue-archive-state') {
            const archived = target.dataset.archived === 'true';
            const completed = await invokeAction('set-clue-archive-state', {
                id: target.dataset.clueId || '',
                archived,
            });
            if (completed !== false && archived && memoryFilter === 'resolved-clues') {
                memorySelectedKeys = new Set();
            }
            render();
            return;
        }
        if (action === 'toggle-memory-flag') {
            await invokeAction('toggle-memory-flag', {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
                field: target.dataset.memoryField || 'important',
            });
            render();
            return;
        }
        if (action === 'select-visible-memory') {
            let items = [];
            try {
                items = JSON.parse(target.dataset.memoryItems || '[]');
            } catch {
                items = [];
            }
            memorySelectedKeys = new Set(
                items.map(item => `${item.kind}:${item.id}`),
            );
            render();
            return;
        }
        if (action === 'clear-memory-selection') {
            memorySelectedKeys = new Set();
            render();
            return;
        }
        if (action === 'bulk-delete-memory') {
            const items = [...memorySelectedKeys].map(key => {
                const separator = key.indexOf(':');
                return {
                    kind: separator >= 0 ? key.slice(0, separator) : 'fact',
                    id: separator >= 0 ? key.slice(separator + 1) : key,
                };
            });
            if (!items.length) return;
            const confirmed = globalThis.confirm?.(
                `(・_・;)  确定删除选中的 ${items.length} 条记忆吗？\n删除前会自动建立恢复点，锁定记忆不会被删。`,
            );
            if (confirmed === false) return;
            const completed = await invokeAction('bulk-delete-memory', { items });
            if (completed !== false) memorySelectedKeys = new Set();
            render();
            return;
        }
        if (action === 'clear-filtered-memory') {
            const state = getState();
            const memory = state.storyMemory || { facts: [], clues: [], summaries: [] };
            const normalizedFilter = ['active', 'facts', 'clues', 'resolved-clues', 'archived-clues', 'episodes', 'all'].includes(memoryFilter)
                ? memoryFilter
                : 'active';
            const visibleFact = fact => (
                (observerMode === 'backstage' || fact.visibility !== 'hidden')
                && !fact.locked
                && memoryItemMatches(fact, memoryQuery)
                && (
                    normalizedFilter === 'all'
                    || normalizedFilter === 'facts'
                    || (normalizedFilter === 'active' && ['active', 'disputed'].includes(fact.status))
                )
            );
            const visibleClue = clue => (
                (observerMode === 'backstage' || clue.visibility !== 'hidden')
                && !clue.locked
                && memoryItemMatches(clue, memoryQuery)
                && memoryClueRelationMatches(clue, memoryClueRelationFilter, state)
                && (
                    normalizedFilter === 'all'
                    || (normalizedFilter === 'clues' && !clue.archived)
                    || (normalizedFilter === 'resolved-clues' && !clue.archived && ['resolved', 'discarded'].includes(clue.status))
                    || (normalizedFilter === 'archived-clues' && clue.archived)
                    || (
                        normalizedFilter === 'active'
                        && !clue.archived
                        && ['open', 'developing', 'echoed', 'triggered'].includes(clue.status)
                    )
                )
            );
            const visibleSummary = summary => (
                observerMode === 'backstage'
                && !summary.locked
                && memoryItemMatches(summary, memoryQuery)
                && ['all', 'episodes'].includes(normalizedFilter)
            );
            const items = [
                ...(memory.facts || []).filter(visibleFact).map(item => ({ kind: 'fact', id: item.id })),
                ...(memory.clues || []).filter(visibleClue).map(item => ({ kind: 'clue', id: item.id })),
                ...(memory.summaries || []).filter(visibleSummary).map(item => ({ kind: 'summary', id: item.id })),
            ];
            if (!items.length) {
                notify('这个筛选里没有可删除的未锁定记忆～', 'info');
                return;
            }
            const confirmed = globalThis.confirm?.(
                `(・_・;)  将清理当前范围内 ${items.length} 条未锁定记忆。\n锁定记忆会保留，清理前会自动建立恢复点。`,
            );
            if (confirmed === false) return;
            const completed = await invokeAction('bulk-delete-memory', { items });
            if (completed !== false) memorySelectedKeys = new Set();
            render();
            return;
        }

        if (action === 'delete-memory-item') {
            const confirmed = globalThis.confirm?.('(・_・;)  确定删除这条记忆吗？此操作可以用底部撤销恢复。');
            if (confirmed === false) return;
            await invokeAction('delete-memory-item', {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
            });
            render();
            return;
        }
        if (action === 'load-more-memory') {
            memoryVisibleCount += 12;
            render();
            return;
        }
        if (action === 'toggle-settings') {
            const opening = !settingsOpen;
            settingsOpen = opening;
            if (opening) {
                moduleSettingsView = '';
                if (!['common', 'injection', 'connection', 'advanced'].includes(settingsSection)) {
                    settingsSection = 'common';
                }
                openSettingsGroups = new Set();
                openSettingsSubgroups = new Set();
                settingsScrollTop = 0;
            } else {
                clockFormDraft = null;
                tagFilterDraftRules = null;
                tagFilterCandidates = [];
            }
            render();
            return;
        }
        if (action === 'settings-section') {
            const requested = String(target.dataset.section || 'common');
            settingsSection = ['common', 'injection', 'connection', 'advanced'].includes(requested)
                ? requested
                : 'common';
            settingsScrollTop = 0;
            render();
            return;
        }
        if (action === 'open-global-settings-section') {
            const requested = String(target.dataset.section || 'common');
            settingsSection = ['common', 'injection', 'connection', 'advanced'].includes(requested)
                ? requested
                : 'common';
            moduleSettingsView = '';
            settingsOpen = true;
            openSettingsGroups = new Set();
            openSettingsSubgroups = new Set();
            settingsScrollTop = 0;
            render();
            return;
        }
        if (action === 'toggle-module-settings') {
            const requestedView = target.dataset.view || moduleSettingsView || activeView;
            const opening = moduleSettingsView !== requestedView;
            moduleSettingsView = opening ? requestedView : '';
            if (opening) {
                settingsOpen = false;
                settingsScrollTop = 0;
                // 板块设置已经是扁平结构～不再为了旧总设置层级预展开一堆套娃。
                openSettingsGroups = new Set();
                openSettingsSubgroups = new Set();
            } else {
                clockFormDraft = null;
            }
            render();
            return;
        }
        if (action === 'add-tag-filter-rule') {
            const settings = getSettings();
            const current = visibleTagFilterRules(settings);
            tagFilterDraftRules = [...current, { open: '', close: '' }];
            skipTagFilterDraftCapture = true;
            render();
            return;
        }
        if (action === 'remove-tag-filter-rule') {
            const index = Number(target.dataset.index);
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).filter((_, i) => i !== index);
            skipTagFilterDraftCapture = true;
            await persistTagFilterRules(current);
            render();
            return;
        }
        if (action === 'scan-tag-candidates') {
            const result = await invokeAction('scan-tag-candidates', {
                count: Number(target.dataset.count) || 1,
            });
            tagFilterCandidates = Array.isArray(result) ? result : [];
            openSettingsGroups.add('advanced');
            openSettingsSubgroups.add('advanced-tagfilter');
            render();
            return;
        }
        if (action === 'apply-tag-candidates') {
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).map(rule => ({ ...rule }));
            const selected = [...root.querySelectorAll('[data-wb-tag-candidate-index]:checked')]
                .map(input => tagFilterCandidates[Number(input.dataset.wbTagCandidateIndex)])
                .filter(Boolean)
                .filter(item => !item.alreadyAdded);
            const seen = new Set(current.map(rule => `${String(rule.open || '').trim()}\u0000${String(rule.close || '').trim()}`));
            let added = 0;
            for (const item of selected) {
                const key = `${item.open}\u0000${item.close}`;
                if (seen.has(key) || current.length >= 30) continue;
                current.push({ open: item.open, close: item.close });
                seen.add(key);
                added += 1;
            }
            await persistTagFilterRules(current);
            tagFilterCandidates = tagFilterCandidates.map(item => ({
                ...item,
                alreadyAdded: item.alreadyAdded || seen.has(`${item.open}\u0000${item.close}`),
                recommended: false,
            }));
            notify(added ? `已加入 ${added} 条过滤规则。` : '没有新的候选需要加入。', added ? 'success' : 'info');
            render();
            return;
        }
        if (action === 'set-public-opinion-mode') {
            publicOpinionMode = ['forum', 'sandbox'].includes(target.dataset.mode) ? target.dataset.mode : 'news';
            render();
            return;
        }
        if (action === 'generate-public-opinion') {
            if (publicOpinionActionBusy) return;
            publicOpinionActionBusy = true;
            render();
            try {
                const result = await invokeAction('generate-public-opinion');
                if (result) {
                    notify('世界舆情检查完成～', 'success');
                }
            } finally {
                publicOpinionActionBusy = false;
                render();
            }
            return;
        }
        if (action === 'generate-public-opinion-sandbox') {
            if (publicOpinionSandboxActionBusy) return;
            publicOpinionSandboxActionBusy = true;
            render();
            try {
                const result = await invokeAction('generate-public-opinion-sandbox');
                if (result) {
                    publicOpinionMode = 'sandbox';
                    notify('随便逛到一锅新鲜瓜～放心，这些不算正史 `(≧▽≦)`', 'success');
                }
            } finally {
                publicOpinionSandboxActionBusy = false;
                render();
            }
            return;
        }
        if (action === 'clear-public-opinion-sandbox') {
            await invokeAction('clear-public-opinion-sandbox');
            render();
            return;
        }
        if (action === 'clear-public-opinion') {
            const confirmed = globalThis.confirm?.('(・_・;)  清空当前舆情快照吗？世界状态不会受到影响。');
            if (confirmed === false) return;
            await invokeAction('clear-public-opinion');
            render();
            return;
        }
        if (action === 'dismiss-public-opinion-item') {
            await invokeAction('dismiss-public-opinion-item', {
                kind: target.dataset.opinionKind === 'forum' ? 'forum' : 'news',
                itemId: target.dataset.itemId || '',
            });
            render();
            return;
        }
        if (action === 'set-observer') {
            observerMode = target.dataset.mode === 'known' ? 'known' : 'backstage';
            selectedPersonId = null;
            render();
            return;
        }
        if (action === 'select-person') {
            if (selectedPersonId !== (target.dataset.personId || null)) {
                personObservation = null;
            }
            selectedPersonId = target.dataset.personId || null;
            if (selectedPersonId) {
                personObservation = await invokeAction('get-person-observation', {
                    personId: selectedPersonId,
                }) || null;
            }
            render();
            return;
        }
        if (action === 'close-person') {
            selectedPersonId = null;
            personObservation = null;
            render();
            return;
        }
        if (action === 'open-person-editor') {
            personEditor = { id: target.dataset.personId || '', name: target.dataset.personName || '' };
            selectedPersonId = null;
            personObservation = null;
            render();
            return;
        }
        if (action === 'close-person-editor') {
            personEditor = null;
            render();
            return;
        }
        if (action === 'clear-person-avatar') {
            const completed = await invokeAction('clear-person-avatar', {
                id: target.dataset.personId || '',
            });
            if (completed) notify('头像收起来啦～又变回文字头像了 (｡•̀ᴗ-)✧', 'success');
            render();
            return;
        }
        if (action === 'delete-manual-person') {
            const confirmed = globalThis.confirm?.('(・_・;)  确定从后台人物名单中删除这个 NPC 吗？');
            if (confirmed === false) return;
            const completed = await invokeAction('delete-manual-person', {
                id: target.dataset.personId || '',
            });
            if (completed) personEditor = null;
            render();
            return;
        }
        if (action === 'open-event-form') {
            eventEditorId = '';
            eventFormDraft = null;
            eventFormOpen = true;
            render();
            return;
        }
        if (action === 'open-event-editor') {
            eventEditorId = target.dataset.eventId || '';
            eventFormDraft = null;
            eventFormOpen = Boolean(eventEditorId);
            render();
            return;
        }
        if (action === 'delete-event') {
            const eventId = target.dataset.eventId || '';
            const confirmed = globalThis.confirm?.('(・_・;)  确定删除这条暗流吗？删除后可以用底部撤销恢复。');
            if (confirmed === false) return;
            const completed = await invokeAction('delete-event', { eventId });
            if (completed && eventEditorId === eventId) {
                eventEditorId = '';
                eventFormOpen = false;
                eventFormDraft = null;
            }
            render();
            return;
        }
        if (action === 'close-event-form') {
            eventEditorId = '';
            eventFormDraft = null;
            eventFormOpen = false;
            render();
            return;
        }
        if (action === 'setting-button') {
            const setting = target.dataset.setting;
            const value = target.dataset.value;
            await invokeAction('update-settings', {
                [setting]: value,
            });
            render();
            // 选择“独立接口”后立即展开填写区，恢复一键进入配置的填写体验。
            // 用户之后仍可手动收起；普通重渲染不会强制再次展开。
            if (setting === 'apiMode' && value === 'tavern-profile') {
                settingsSection = 'connection';
                openSettingsGroups.add('connection');
                render();
                window.setTimeout(() => {
                    root.querySelector('[data-wb-tavern-profile-select]')?.focus();
                }, 0);
            }
            if (setting === 'apiMode' && value === 'custom') {
                settingsSection = 'connection';
                window.setTimeout(() => {
                    const connectionGroup = root.querySelector('.wb-settings-group[data-settings-group="connection"]');
                    const customGroup = root.querySelector('.wb-settings-subgroup[data-settings-subgroup="connection-custom"]');
                    if (connectionGroup) connectionGroup.open = true;
                    if (customGroup) customGroup.open = true;
                    openSettingsGroups.add('connection');
                    openSettingsSubgroups.add('connection-custom');
                    const form = root.querySelector('[data-wb-form="api"]');
                    if (!form) return;
                    const url = form.elements?.customApiUrl;
                    const key = form.elements?.customApiCredential;
                    const model = form.elements?.customApiModel;
                    if (!String(url?.value || '').trim()) url?.focus();
                    else if (!getSettings().customApiKey && !String(key?.value || '').trim()) key?.focus();
                    else if (!String(model?.value || '').trim()) model?.focus();
                }, 0);
            }
            return;
        }
        if (action === 'cycle-theme') {
            const settings = getSettings();
            const state = getState();
            // 顶栏快捷键只做“日间 ↔ 夜间”直切；自动模式仍可在设置页选择。
            // 旧逻辑会经过 auto，若 auto 恰好解析成当前主题，视觉上像按钮失灵。
            const currentTheme = themeFor(state, settings);
            const next = currentTheme === 'day' ? 'night' : 'day';
            await invokeAction('update-settings', { theme: next });
            render();
            return;
        }
        if (action === 'sync-clock-from-story') {
            clockFormDraft = null;
            await invokeAction('sync-clock-from-story');
            render();
            return;
        }
        if (action === 'advance-clock') {
            clockFormDraft = null;
            await invokeAction('advance-clock', { minutes: Number(target.dataset.minutes) || 0 });
            render();
            return;
        }
        if (action === 'smart-import-worldbook-people') {
            const form = target.closest('[data-wb-form="worldbook"]');
            worldbookSelectedIds = new Set();
            const result = await invokeAction('smart-import-worldbook-people', {
                bookName: form?.elements?.bookName?.value || '',
            });
            if (result && typeof result === 'object') {
                const imported = Number(result.created || 0) + Number(result.updated || 0);
                if (result.needsReview) {
                    worldbookOnlyPeople = true;
                    notify(`自动导入没有贸然下手～还有 ${Number(result.reviewCount) || 0} 个人物候选需要你确认。`, 'info');
                } else {
                    const tail = Number(result.reviewCount) > 0
                        ? `，另有 ${result.reviewCount} 个不太确定的候选留在下面`
                        : '';
                    notify(`世界书人物导入完成：处理 ${imported} 人${tail}。`, 'success');
                    worldbookOnlyPeople = Number(result.reviewCount) > 0;
                }
            }
            render();
            return;
        }
        if (action === 'scan-worldbook') {
            const form = target.closest('[data-wb-form="worldbook"]');
            worldbookSelectedIds = new Set();
            const result = await invokeAction('scan-worldbook', {
                bookName: form?.elements?.bookName?.value || '',
            });
            if (result && Array.isArray(result.entries)) {
                const personCount = result.entries.filter(entry => entry.importablePerson ?? entry.likelyPerson).length;
                if (personCount > 0 && personCount < result.entries.length) worldbookOnlyPeople = true;
            }
            render();
            return;
        }
        if (action === 'select-worldbook-visible' || action === 'clear-worldbook-visible') {
            const entries = Array.isArray(getSyncStatus()?.worldbook?.entries)
                ? getSyncStatus().worldbook.entries
                : [];
            const visible = filterWorldbookEntries(entries, {
                query: worldbookQuery,
                onlyPeople: worldbookOnlyPeople,
                onlyEnabled: worldbookOnlyEnabled,
            });
            const next = new Set(worldbookSelectedIds);
            for (const entry of visible) {
                if (action === 'select-worldbook-visible') {
                    if (entry.importablePerson ?? entry.likelyPerson) next.add(String(entry.uid));
                } else {
                    next.delete(String(entry.uid));
                }
            }
            worldbookSelectedIds = next;
            render();
            return;
        }
        if (action === 'toggle-event-delivery') {
            await invokeAction('toggle-event-delivery', {
                eventId: target.dataset.eventId || '',
            });
            render();
            return;
        }
        if (action === 'import-state') {
            root.querySelector('.wb-import-input')?.click();
            return;
        }
        if (action === 'catch-up-person') {
            await invokeAction('catch-up-person', {
                personId: target.dataset.personId || '',
            });
            render();
            return;
        }
        if (action === 'prioritize-person') {
            await invokeAction('prioritize-person', {
                personId: target.dataset.personId || '',
                enabled: target.dataset.enabled !== 'false',
            });
            render();
            return;
        }
        if (action === 'observe-person') {
            const result = await invokeAction('observe-person', {
                personId: target.dataset.personId || '',
                force: target.dataset.force === 'true',
            });
            if (result && typeof result === 'object' && result.text) {
                personObservation = result;
            }
            render();
            return;
        }
        if (action === 'queue-person-observation') {
            const result = await invokeAction('queue-person-observation', {
                personId: target.dataset.personId || '',
            });
            if (result && typeof result === 'object') personObservation = result;
            render();
            return;
        }
        if (action === 'resolve-message-edit') {
            await invokeAction('resolve-message-edit', {
                mode: target.dataset.mode === 'keep' ? 'keep' : 'rerun',
            });
            render();
            return;
        }
        if (action === 'save-api-profile-from-form') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            const urlField = form.elements?.customApiUrl;
            const modelField = form.elements?.customApiModel;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            if (modelField && !String(modelField.value || '').trim()) {
                modelField.focus();
                notify('先选个模型再保存方案吧～', 'error');
                return;
            }
            const data = readApiForm(form);
            const profileId = String(data.profileId || '').trim();
            const existingProfile = (getSettings().apiProfiles || []).find(item => item.id === profileId);
            const key = String(data.customApiCredential || '').trim()
                || existingProfile?.key
                || (!profileId ? getSettings().customApiKey : '');
            if (!key) {
                notify('这个方案还缺 API Key 哦～', 'error');
                form.elements?.customApiCredential?.focus();
                return;
            }
            const name = String(data.profileName || '').trim()
                || String(data.customApiModel || '').trim()
                || '我的独立 API';
            const completed = await invokeAction('save-api-profile', {
                id: profileId,
                name,
                url: data.customApiUrl,
                key: String(data.customApiCredential || '').trim(),
                model: data.customApiModel,
                transport: data.customApiTransport,
            });
            if (completed) {
                forgetApiKeyDraft(data);
                openSettingsSubgroups.add('connection-profiles');
            }
            render();
            return;
        }
        if (action === 'edit-api-profile') {
            const profileId = String(target.dataset.profileId || '');
            const profile = (getSettings().apiProfiles || []).find(item => item.id === profileId);
            if (!profile) {
                notify('这个 API 方案好像已经不在啦～', 'error');
                return;
            }
            apiFormDraft = {
                profileId: profile.id,
                profileName: profile.name || '',
                customApiUrl: profile.url || '',
                customApiCredential: '',
                customApiModel: profile.model || '',
                customApiTransport: profile.transport || 'proxy',
            };
            skipApiDraftCapture = true;
            settingsSection = 'connection';
            openSettingsGroups.add('connection');
            openSettingsSubgroups.add('connection-custom');
            render();
            window.setTimeout(() => {
                const group = root.querySelector('.wb-settings-group[data-settings-group="connection"]');
                const subgroup = root.querySelector('.wb-settings-subgroup[data-settings-subgroup="connection-custom"]');
                if (group) group.open = true;
                if (subgroup) subgroup.open = true;
                root.querySelector('[data-wb-form="api"] [name="profileName"]')?.focus();
            }, 0);
            return;
        }
        if (action === 'test-api-profile') {
            await invokeAction('test-api-profile', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'pull-api-profile-models') {
            await invokeAction('pull-api-profile-models', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'duplicate-api-profile') {
            await invokeAction('duplicate-api-profile', { profileId: target.dataset.profileId || '' });
            openSettingsSubgroups.add('connection-profiles');
            render();
            return;
        }
        if (action === 'delete-api-profile') {
            const settings = getSettings();
            const profile = (settings.apiProfiles || []).find(item => item.id === String(target.dataset.profileId || ''));
            const confirmed = globalThis.confirm?.(`(・_・;)  要删掉 API 方案“${profile?.name || '这个方案'}”吗？\n使用它的模块会自动退回“跟随默认”。`);
            if (confirmed === false) return;
            await invokeAction('delete-api-profile', { profileId: target.dataset.profileId || '' });
            render();
            return;
        }
        if (action === 'test-api') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            const urlField = form.elements?.customApiUrl;
            const modelField = form.elements?.customApiModel;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            if (modelField && !String(modelField.value || '').trim()) {
                modelField.focus();
                notify('先选个模型再测试吧～', 'error');
                return;
            }
            const data = readApiForm(form);
            let request;
            try {
                request = apiRequestFromDraft(data, { requireModel: true });
            } catch (error) {
                notify(String(error?.message || error), 'error');
                return;
            }
            await invokeAction('test-api-draft', request);
            render();
            return;
        }
        if (action === 'pull-api-models') {
            const form = target.closest('[data-wb-form="api"]');
            if (!form) return;
            // 拉模型只读取当前草稿，不再偷偷改默认独立接口。编辑已保存方案时，
            // Key 留空会安全沿用该方案自己的 Key，而不是串到默认配置。
            const urlField = form.elements?.customApiUrl;
            const keyField = form.elements?.customApiCredential;
            if (urlField && !urlField.checkValidity()) {
                urlField.reportValidity();
                return;
            }
            const data = readApiForm(form);
            let request;
            try {
                request = apiRequestFromDraft(data, { requireModel: false });
            } catch (error) {
                notify(String(error?.message || error), 'error');
                keyField?.focus();
                return;
            }
            await invokeAction('pull-api-draft-models', request);
            render();
            return;
        }
        if (action === 'reset-api-draft') {
            apiFormDraft = {
                customApiUrl: '',
                customApiCredential: '',
                customApiModel: '',
                customApiTransport: getSettings().customApiTransport,
                profileName: '',
                profileId: '',
            };
            skipApiDraftCapture = true;
            render();
            window.setTimeout(() => {
                root.querySelector('[data-wb-form="api"] [name="customApiUrl"]')?.focus();
            }, 0);
            return;
        }
        if (action === 'toggle-api-key-visibility') {
            const field = target.closest('.wb-api-secret-field')?.querySelector('.wb-secret-input');
            if (!field) return;
            const visible = field.classList.toggle('is-visible');
            target.setAttribute('aria-pressed', String(visible));
            target.textContent = visible ? '隐藏' : '显示';
            field.focus();
            return;
        }

        if (action === 'clear-current-chat-cache') {
            const completed = await invokeAction('clear-current-chat-cache');
            if (completed) {
                personObservation = null;
                worldbookSelectedIds = new Set();
                notify('当前聊天的可重建缓存已经清干净啦～世界数据和 API 都没动。', 'success');
            }
            render();
            return;
        }

        if (action === 'check-correct-world-state') {
            const result = await invokeAction('check-correct-world-state');
            if (result) {
                const corrected = Number(result.applied?.length || 0);
                const removed = Number(result.removedEventIds?.length || 0);
                const skipped = Number(result.skipped || 0);
                notify(
                    corrected || removed
                        ? `检查完成：修正 ${corrected} 项${removed ? `，撤销 ${removed} 条未发生派生` : ''}。`
                        : skipped
                            ? `检查完成：${skipped} 项没有足够证据，已经保守跳过，没有乱改。`
                            : '检查完成：没有发现需要修正的明确矛盾。',
                    corrected || removed ? 'success' : 'info',
                );
            }
            render();
            return;
        }

        if (action === 'reset-current-chat-data') {
            const first = globalThis.confirm?.(
                '确定要重置“当前聊天”的全部世界背面数据吗？\n\n'
                + '会清除人物、事件、暗流、回声、记忆、舆情、观测、恢复点与分支快照。\n'
                + '聊天正文和 API / 模型配置不会被删除。',
            );
            if (first === false) return;
            const second = globalThis.confirm?.(
                '最后确认：这次重置不会创建恢复点，旧世界数据将不能从世界背面恢复。\n\n确定继续吗？',
            );
            if (second === false) return;

            const result = await invokeAction('reset-current-chat-data');
            if (result) {
                selectedPersonId = null;
                personObservation = null;
                memorySelectedKeys = new Set();
                memoryEditor = null;
                personEditor = null;
                recordEditor = null;
                eventFormOpen = false;
                eventEditorId = '';
                worldEditorOpen = false;
                worldbookSelectedIds = new Set();
                worldbookQuery = '';
                worldbookOnlyPeople = false;
                worldbookOnlyEnabled = false;
                notify(
                    `当前聊天已经重置为空白世界${Number(result.removedSnapshots) > 0 ? `，并清掉 ${result.removedSnapshots} 份旧分支快照` : ''}。API 配置和聊天正文都保留。`,
                    'success',
                );
            }
            render();
            return;
        }

        await invokeAction(action, {});
        render();
    });

    root.addEventListener('change', async event => {
        const apiForm = event.target.closest?.('[data-wb-form="api"]');
        if (apiForm) {
            readApiForm(apiForm);
            return;
        }

        if (event.target.matches?.('[data-wb-clue-relation-filter]')) {
            memoryClueRelationFilter = String(event.target.value || 'all');
            memoryVisibleCount = 12;
            memorySelectedKeys = new Set();
            render();
            return;
        }

        if (event.target.matches?.('[data-wb-memory-select]')) {
            const kind = String(event.target.dataset.memoryKind || 'fact');
            const id = String(event.target.dataset.memoryId || '');
            const key = `${kind}:${id}`;
            const next = new Set(memorySelectedKeys);
            if (event.target.checked) next.add(key);
            else next.delete(key);
            memorySelectedKeys = next;
            const deleteButton = root.querySelector('[data-wb-memory-selected-count]');
            if (deleteButton) {
                deleteButton.disabled = memorySelectedKeys.size === 0;
                deleteButton.textContent = `删除选中${memorySelectedKeys.size ? ` · ${memorySelectedKeys.size}` : ''}`;
            }
            const clearButton = root.querySelector('[data-wb-action="clear-memory-selection"]');
            if (clearButton) clearButton.disabled = memorySelectedKeys.size === 0;
            return;
        }

        if (event.target.matches?.('[data-wb-worldbook-entry-id]')) {
            const uid = String(event.target.dataset.wbWorldbookEntryId || '');
            const next = new Set(worldbookSelectedIds);
            if (event.target.checked) next.add(uid);
            else next.delete(uid);
            worldbookSelectedIds = next;
            render();
            return;
        }
        const worldbookFilter = event.target.dataset?.wbWorldbookFilter;
        if (worldbookFilter === 'people' || worldbookFilter === 'enabled') {
            if (worldbookFilter === 'people') worldbookOnlyPeople = Boolean(event.target.checked);
            if (worldbookFilter === 'enabled') worldbookOnlyEnabled = Boolean(event.target.checked);
            render();
            return;
        }

        if (event.target.matches?.('[data-wb-tavern-profile-select]')) {
            await invokeAction('update-settings', {
                tavernApiProfileId: String(event.target.value || ''),
            });
            notify(event.target.value ? '酒馆方案牌牌记住啦～' : '先不绑酒馆方案了～', event.target.value ? 'success' : 'info');
            render();
            return;
        }

        const apiRouteKey = event.target.dataset?.wbApiRoute;
        if (apiRouteKey && ['simulation', 'observation', 'history', 'opinion'].includes(apiRouteKey)) {
            const settings = getSettings();
            const routes = {
                ...(settings.apiModuleRoutes || {}),
                [apiRouteKey]: String(event.target.value || 'default'),
            };
            await invokeAction('update-settings', { apiModuleRoutes: routes });
            notify('这块的 API 路线记好啦～', 'success');
            render();
            return;
        }

        const tagField = event.target.dataset?.wbTagFilterField;
        if (tagField === 'open' || tagField === 'close') {
            const index = Number(event.target.dataset.index);
            const settings = getSettings();
            const current = visibleTagFilterRules(settings).map(rule => ({ ...rule }));
            if (!current[index]) return;
            current[index] = {
                ...current[index],
                [tagField]: String(event.target.value || '').slice(0, 80),
            };
            await persistTagFilterRules(current);
            render();
            return;
        }

        const settingSeconds = event.target.dataset.wbSettingSeconds;
        if (settingSeconds) {
            const seconds = Math.max(0, Number(event.target.value) || 0);
            await invokeAction('update-settings', {
                [settingSeconds]: seconds > 0 ? Math.round(seconds * 1000) : 0,
            });
            render();
            return;
        }

        const generationLimitField = event.target.dataset.wbGenerationLimit;
        const generationLimitModule = event.target.dataset.module;
        if (
            generationLimitField
            && ['simulation', 'observation', 'history', 'opinion'].includes(generationLimitModule)
        ) {
            const settings = getSettings();
            const current = settings.generationModuleLimits && typeof settings.generationModuleLimits === 'object'
                ? settings.generationModuleLimits
                : {};
            const moduleLimit = {
                ...(current[generationLimitModule] || { maxTokens: 0, timeoutMs: 0 }),
            };
            if (generationLimitField === 'maxTokens') {
                moduleLimit.maxTokens = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
            } else if (generationLimitField === 'timeoutSeconds') {
                const seconds = Math.max(0, Number(event.target.value) || 0);
                moduleLimit.timeoutMs = seconds > 0 ? Math.round(seconds * 1000) : 0;
            } else {
                return;
            }
            await invokeAction('update-settings', {
                generationModuleLimits: {
                    ...current,
                    [generationLimitModule]: moduleLimit,
                },
            });
            render();
            return;
        }

        const setting = event.target.dataset.wbSetting;
        if (setting) {
            const value = event.target.type === 'checkbox'
                ? event.target.checked
                : event.target.value;
            await invokeAction('update-settings', { [setting]: value });
            render();
            return;
        }

        if (event.target.classList.contains('wb-import-input')) {
            const file = event.target.files?.[0];
            if (!file) return;
            await invokeAction('import-state-data', {
                name: file.name,
                text: await file.text(),
            });
            event.target.value = '';
            render();
        }
    });

    root.addEventListener('input', event => {
        const apiForm = event.target.closest?.('[data-wb-form="api"]');
        if (apiForm) {
            readApiForm(apiForm);
            return;
        }

        if (event.target.matches?.('[data-wb-worldbook-search]')) {
            worldbookQuery = String(event.target.value || '').slice(0, 120);
            window.clearTimeout(worldbookSearchTimer);
            worldbookSearchTimer = window.setTimeout(render, 100);
            return;
        }
        if (!event.target.matches?.('[data-wb-memory-search]')) return;
        const nextMemoryQuery = String(event.target.value || '').slice(0, 80);
        if (nextMemoryQuery !== memoryQuery) memorySelectedKeys = new Set();
        memoryQuery = nextMemoryQuery;
        memoryVisibleCount = 12;
        window.clearTimeout(memorySearchTimer);
        memorySearchTimer = window.setTimeout(render, 120);
    });

    root.addEventListener('submit', async event => {
        const form = event.target.closest('[data-wb-form]');
        if (!form) return;
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());

        if (form.dataset.wbForm === 'lingqi-chat') {
            const text = String(data.text || '').trim();
            if (!text) return;
            if (form.elements.text) form.elements.text.value = '';
            lingqiDraft = '';
            const completed = await invokeAction('lingqi-send-message', { text });
            if (completed === false) lingqiDraft = text;
        }
        if (form.dataset.wbForm === 'clock') {
            clockFormDraft = { ...data };
            const completed = await invokeAction('set-clock', data);
            if (completed) clockFormDraft = null;
        }
        if (form.dataset.wbForm === 'api') {
            apiFormDraft = { ...data };
            const completed = await invokeAction('update-settings', apiSettingsFromDraft(data));
            if (completed) {
                forgetApiKeyDraft(data);
                notify('独立接口存好啦～旧 Key 还是不会偷偷回填哦。', 'success');
            }
        }
        if (form.dataset.wbForm === 'world') {
            const completed = await invokeAction('save-world-summary', {
                title: data.title || '',
                detail: data.detail || '',
                background: data.background || '',
            });
            if (completed) worldEditorOpen = false;
        }
        if (form.dataset.wbForm === 'record') {
            const completed = await invokeAction('save-record', {
                kind: data.kind || 'echo',
                id: data.id || '',
                title: data.title || '',
                text: data.text || '',
                place: data.place || '',
                visibility: data.visibility || 'hidden',
                deliveryState: data.deliveryState || 'none',
            });
            if (completed) recordEditor = null;
        }
        if (form.dataset.wbForm === 'event') {
            const completed = await invokeAction(data.id ? 'update-event' : 'add-event', data);
            if (completed) {
                eventFormOpen = false;
                eventEditorId = '';
                eventFormDraft = null;
            }
        }
        if (form.dataset.wbForm === 'memory') {
            const parseRelationList = value => [...new Set(
                String(value || '')
                    .split(/[、,，;；\n]+/)
                    .map(item => item.trim())
                    .filter(Boolean),
            )];
            const completed = await invokeAction('save-memory-item', {
                id: data.id || '',
                kind: data.kind || 'fact',
                title: data.title || '',
                relation: data.relation || '',
                content: data.content || '',
                people: parseRelationList(data.people),
                events: parseRelationList(data.events),
                locations: parseRelationList(data.locations),
                important: form.elements.important?.checked || false,
                locked: form.elements.locked?.checked || false,
            });
            if (completed) memoryEditor = null;
        }
        if (form.dataset.wbForm === 'person') {
            const avatarFile = form.elements.avatarFile?.files?.[0] || null;
            let avatarDataUrl = null;
            if (avatarFile) {
                notify('正在把头像缩成小小一只～', 'info');
                try {
                    avatarDataUrl = await readPersonAvatarFile(avatarFile);
                } catch (error) {
                    notify(String(error?.message || error || '头像没有处理成功～'), 'error');
                    return;
                }
            }
            const completed = await invokeAction('save-manual-person', {
                id: data.id || '',
                originalName: data.originalName || '',
                name: data.name || '',
                avatarDataUrl,
                location: data.location || '',
                action: data.action || '',
                intent: data.intent || '',
                longTermGoal: data.longTermGoal || '',
                innerVoice: data.innerVoice || '',
                identityAnchor: data.identityAnchor || '',
                personalityAnchor: data.personalityAnchor || '',
                appearanceProfile: data.appearanceProfile || '',
                backgroundProfile: data.backgroundProfile || '',
                speakingStyle: data.speakingStyle || '',
                behaviorBoundaries: data.behaviorBoundaries || '',
                knowledge: data.knowledge || 'backstage',
                relevance: data.relevance || 2,
                simulationEnabled: form.elements.simulationEnabled?.checked || false,
                locked: form.elements.locked?.checked || false,
            });
            if (completed) personEditor = null;
        }
        if (form.dataset.wbForm === 'worldbook') {
            const formData = new FormData(form);
            const completed = await invokeAction('import-worldbook-people', {
                bookName: String(formData.get('bookName') || ''),
                entryIds: [...worldbookSelectedIds],
            });
            if (completed) worldbookSelectedIds = new Set();
        }
        render();
    });

    const onKeydown = event => {
        const lingqiTextarea = event.target.matches?.('[data-wb-form="lingqi-chat"] textarea[name="text"]')
            ? event.target
            : null;
        if (
            lingqiTextarea
            && event.key === 'Enter'
            && !event.shiftKey
            && !event.ctrlKey
            && !event.altKey
            && !event.metaKey
            && !event.isComposing
            && event.keyCode !== 229
        ) {
            event.preventDefault();
            lingqiTextarea.form?.requestSubmit();
            return;
        }
        if (
            ['Enter', ' '].includes(event.key)
            && event.target.matches?.('[role="button"][data-wb-action]')
        ) {
            event.preventDefault();
            event.target.click();
            return;
        }
        if (event.key !== 'Escape') return;
        if (recordEditor) recordEditor = null;
        else if (worldEditorOpen) worldEditorOpen = false;
        else if (selectedPersonId) selectedPersonId = null;
        else if (eventFormOpen) {
            eventFormOpen = false;
            eventEditorId = '';
            eventFormDraft = null;
        }
        else if (moduleSettingsView) {
            moduleSettingsView = '';
            clockFormDraft = null;
        }
        else if (settingsOpen) {
            settingsOpen = false;
            clockFormDraft = null;
            tagFilterDraftRules = null;
        }
        else if (isOpen) {
            close();
            return;
        }
        render();
    };
    const onResize = () => {
        syncVisualViewportInsets();
        positionOrbFromSettings();
    };
    const selfHealTimer = window.setInterval(ensureMounted, 1800);
    const onPageVisible = () => ensureMounted();
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onPageVisible);
    window.addEventListener('focus', onPageVisible);
    window.addEventListener('pageshow', onPageVisible);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);

    render();
    return {
        render,
        ensureMounted,
        notify,
        setBusy,
        open,
        close,
        resetContext,
        destroy() {
            window.clearTimeout(toastTimer);
            window.clearTimeout(memorySearchTimer);
            window.clearTimeout(closeTimer);
            window.clearTimeout(lingqiMascotTimer);
            window.cancelAnimationFrame?.(freshOpenCheckFrame);
            window.clearInterval(selfHealTimer);
            document.removeEventListener('keydown', onKeydown);
            document.removeEventListener('visibilitychange', onPageVisible);
            window.removeEventListener('focus', onPageVisible);
            window.removeEventListener('pageshow', onPageVisible);
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('scroll', onResize);
            root.remove();
        },
    };
}
