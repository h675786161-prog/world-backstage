import {
    eventProgress,
    formatDuration,
    formatWorldCalendar,
    formatWorldMinute,
    isActiveEvent,
    isTerminalEvent,
} from './core.js';

const VIEWS = [
    { id: 'now', label: '此刻', eyebrow: 'NOW' },
    { id: 'people', label: '人物', eyebrow: 'PEOPLE' },
    { id: 'currents', label: '暗流', eyebrow: 'CURRENTS' },
    { id: 'echoes', label: '回声', eyebrow: 'ECHOES' },
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
    const glyph = person.monogram || person.name?.slice(0, 1) || '·';
    return `
        <span class="wb-person-avatar ${size}">
            ${escapeHtml(glyph)}
            <i></i>
        </span>
    `;
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

export function renderPersonCard(person, observerMode, worldMinute) {
    return `
        <article class="wb-person-card" role="button" tabindex="0"
            data-wb-action="select-person" data-person-id="${escapeAttr(person.id)}">
            <span class="wb-person-card-top">
                ${renderPersonAvatar(person, 'is-large')}
                <span class="wb-person-place">${escapeHtml(person.location)}</span>
            </span>
            <h3>${escapeHtml(person.name)}</h3>
            <p>${escapeHtml(person.action)}</p>
            <span class="wb-person-thread">
                <small>短期意图</small>
                <strong>${escapeHtml(person.intent)}</strong>
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
            <span class="wb-person-sim-state ${person.simulationEnabled === false ? 'is-sleeping' : ''}">
                ${person.simulationEnabled === false ? '后台休眠' : '参与后台推演'}
            </span>
            <button class="wb-person-edit-button" type="button" data-wb-action="open-person-editor"
                data-person-id="${escapeAttr(person.id)}">编辑人物卡</button>
        </article>
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

function renderEventCard(event, state, wide = false) {
    return `
        <article class="wb-event-card ${wide ? 'is-wide' : ''}">
            <div class="wb-event-topline">
                <span class="wb-phase phase-${escapeAttr(event.status)}">${escapeHtml(eventStatusLabel(event))}</span>
                <span>${escapeHtml(event.place)}</span>
            </div>
            <h3>${escapeHtml(event.title)}</h3>
            <p>${escapeHtml(event.summary || event.consequence || '事件仍在形成。')}</p>
            ${wide && event.consequence ? `
                <div class="wb-consequence">
                    <span>可能后果</span>
                    <strong>${escapeHtml(event.consequence)}</strong>
                </div>
            ` : ''}
            ${renderProgress(event, state, wide)}
            <div class="wb-route">
                <i></i>
                ${escapeHtml(visibilityLabel(event.visibility))}
            </div>
            <button class="wb-event-delivery-toggle ${event.delivery?.manualQueued ? 'is-queued' : ''}"
                type="button" data-wb-action="toggle-event-delivery"
                data-event-id="${escapeAttr(event.id)}"
                ${event.visibility === 'hidden' ? 'disabled' : ''}>
                ${event.delivery?.manualQueued ? '✓ 下一轮显露' : '下一轮显露'}
            </button>
        </article>
    `;
}

function renderOutcome(event, state) {
    const time = formatWorldCalendar(
        state,
        event.resolvedAt ?? event.updatedAt ?? event.dueAt ?? 0,
    );
    return `
        <article class="wb-echo-item">
            <time>${escapeHtml(`${time.shortDate} ${time.time}`)}</time>
            <span class="wb-timeline-node state-${escapeAttr(event.delivery?.state || 'none')}"></span>
            <div class="wb-echo-card">
                <div>
                    <h3>${escapeHtml(event.title)}</h3>
                    <p>${escapeHtml(event.result || event.expectedResult || event.consequence || '结果等待确认。')}</p>
                </div>
                <span>${escapeHtml(deliveryLabel(event))}</span>
            </div>
        </article>
    `;
}

function renderArchiveEntry(entry, state) {
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

    return `
        <article class="wb-archive-entry">
            <div class="wb-archive-date">
                <strong>${time ? time.date : '日期未定'}</strong>
                <span>${time ? time.time : '—'}</span>
            </div>
            <span class="wb-archive-rule"></span>
            <div class="wb-archive-copy">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(text || '这件事已经成为世界事实。')}</p>
                <div>${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            </div>
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
    const connection = status.connection || {};
    const memoryPhase = status.memory?.phase;
    const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
    const phase = memoryTakesFocus ? memoryPhase : (status.phase || 'idle');
    const detail = memoryTakesFocus
        ? status.memory?.message || (memoryPhase === 'error' ? '记忆整理没有完成' : '正在整理长期记忆')
        : status.error || status.message || '尚未进行世界推演';
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
            <summary>本次变化与用量</summary>
            <div>
                <span>世界时间</span><strong>${summary.elapsedMinutes > 0 ? `+${escapeHtml(formatDuration(summary.elapsedMinutes))}` : '未推进'}</strong>
                <span>人物变化</span><strong>${summary.peopleChanged || 0} 人 ${changedNames}</strong>
                <span>事件变化</span><strong>新增 ${summary.eventsAdded || 0} · 更新 ${summary.eventsUpdated || 0} ${eventNames}</strong>
                <span>记忆变化</span><strong>新增 ${summary.memoryAdded || 0} · 更新 ${summary.memoryUpdated || 0}</strong>
                <span>推演上下文</span><strong>约 ${summary.promptTokens || 0} token · ${summary.promptCharacters || 0} 字符</strong>
                <span>模型输出</span><strong>约 ${summary.outputTokens || 0} / ${summary.outputBudget || 0} token · ${summary.attempts || 1} 次请求</strong>
                <span>正文注入</span><strong>${summary.injectionCharacters || 0} 字符 · ${summary.injectionEvents || 0} 个事件${summary.omittedInjectionLines ? ` · 压缩 ${summary.omittedInjectionLines} 行` : ''}</strong>
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

function renderSettings(state, settings, syncStatus, openGroups = new Set(), apiDraft = null) {
    const clock = formatWorldCalendar(state);
    const connection = syncStatus?.connection || {};
    const memory = syncStatus?.memory || {};
    const phase = syncStatus?.phase || 'idle';
    const historyRunning = memory.phase === 'running';
    const availableModels = Array.isArray(syncStatus?.availableModels)
        ? syncStatus.availableModels
        : [];
    const modelPull = syncStatus?.modelPull || { phase: 'idle', message: '' };
    const worldbook = syncStatus?.worldbook || { books: [], entries: [], phase: 'idle' };
    const worldbookBooks = Array.isArray(worldbook.books) ? worldbook.books : [];
    const worldbookEntries = Array.isArray(worldbook.entries) ? worldbook.entries : [];
    const hasSavedApiKey = Boolean(settings.customApiKey);
    const apiValues = {
        customApiUrl: apiDraft?.customApiUrl ?? settings.customApiUrl,
        customApiCredential: apiDraft?.customApiCredential ?? '',
        customApiModel: apiDraft?.customApiModel ?? settings.customApiModel,
        customApiTransport: apiDraft?.customApiTransport ?? settings.customApiTransport,
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
    const groupOpen = id => openGroups.has(id) ? 'open' : '';

    return `
        <div class="wb-settings-popover" role="dialog" aria-modal="true" aria-label="世界背面设置">
            <div class="wb-popover-heading">
                <div><span>OBSERVATION</span><h3>观测设置</h3></div>
                <button type="button" data-wb-action="toggle-settings" aria-label="关闭设置">×</button>
            </div>

            <details class="wb-settings-group" data-settings-group="connection" ${groupOpen('connection')}>
                <summary><span>连接</span><small>API 与模型</small></summary>
                <div class="wb-settings-group-body">
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
                    ? '独立接口只复用酒馆的网络转发，不继承当前聊天模型、预设或上下文。'
                    : '当前跟随酒馆主 API；切换到独立接口后可单独填写地址、Key 与模型。'}</small>
            </div>

            <div class="wb-setting-block">
                <label>世界推演连接</label>
                <div class="wb-option-row">
                    ${settingButton('apiMode', settings.apiMode, 'tavern', '跟随酒馆')}
                    ${settingButton('apiMode', settings.apiMode, 'custom', '独立接口')}
                </div>
                <p>独立接口只用于世界推演、历史建档和人物观测，不会改变主聊天连接。</p>
            </div>

            ${settings.apiMode === 'custom' ? `
                <form class="wb-api-form" data-wb-form="api" autocomplete="off">
                    <div class="wb-api-draft-heading">
                        <span>${hasSavedApiKey ? '已保存独立接口；旧 Key 不会再次显示。' : '尚未保存独立接口。'}</span>
                        <button type="button" data-wb-action="reset-api-draft">清空重填</button>
                    </div>
                    <label>接口地址
                        <input name="customApiUrl" type="url" required
                            value="${escapeAttr(apiValues.customApiUrl)}"
                            autocomplete="off" inputmode="url" autocapitalize="none" spellcheck="false"
                            placeholder="https://example.com/v1">
                    </label>
                    <p>请填到版本层，例如 <code>/v1</code>；插件只会自动补上 <code>/chat/completions</code>。</p>
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
                        ? '输入新 Key 会替换旧 Key；留空则沿用。为了避免手机自动回填，旧 Key 不会放回输入框。'
                        : 'Key 只保存在本机的 SillyTavern 扩展设置中，不会写进导出的世界状态。'}</p>
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
                    <div class="wb-api-actions">
                        <button type="submit">保存独立接口</button>
                        <button type="button" data-wb-action="test-api">测试连接</button>
                        <button type="button" data-wb-action="pull-api-models"
                            ${modelPull.phase === 'running' ? 'disabled' : ''}>
                            ${modelPull.phase === 'running' ? '正在拉取…' : '拉取模型列表'}
                        </button>
                    </div>
                    ${modelPull.message ? `<p class="wb-api-model-status is-${escapeAttr(modelPull.phase)}">${escapeHtml(modelPull.message)}</p>` : ''}
                </form>
            ` : ''}

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="appearance" ${groupOpen('appearance')}>
                <summary><span>界面与显露</span><small>主题、字号、正文注入</small></summary>
                <div class="wb-settings-group-body">
            <div class="wb-setting-block">
                <label>界面明暗</label>
                <div class="wb-option-row">
                    ${themeButton('auto', '自动')}
                    ${themeButton('day', '日间')}
                    ${themeButton('night', '夜间')}
                </div>
                <p>自动模式跟随主世界昼夜，手动选择不会改动世界时间。</p>
            </div>

            <div class="wb-setting-block">
                <label>界面字号</label>
                <div class="wb-option-row">
                    ${settingButton('uiScale', settings.uiScale, 'compact', '紧凑')}
                    ${settingButton('uiScale', settings.uiScale, 'comfortable', '标准')}
                    ${settingButton('uiScale', settings.uiScale, 'large', '大字')}
                </div>
                <p>控制整个插件的阅读字号；下方“均衡”只控制剧情显露频率，与字体无关。</p>
            </div>

            <div class="wb-setting-block">
                <label>正文显露度</label>
                <div class="wb-option-row">
                    ${densityButton('restrained', '克制')}
                    ${densityButton('balanced', '均衡')}
                    ${densityButton('active', '活跃')}
                </div>
                <p>只改变既成结果靠近镜头的密度，不会关闭后台世界。</p>
            </div>

            <div class="wb-setting-block">
                <label for="wb-scene-timing">显露时机</label>
                <select id="wb-scene-timing" data-wb-setting="sceneTiming">
                    <option value="strict" ${settings.sceneTiming === 'strict' ? 'selected' : ''}>严格：只在转场或空档</option>
                    <option value="smart" ${settings.sceneTiming === 'smart' ? 'selected' : ''}>智能：关键场景延后</option>
                    <option value="open" ${settings.sceneTiming === 'open' ? 'selected' : ''}>开放：允许简短自然变化</option>
                </select>
            </div>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="simulation" ${groupOpen('simulation')}>
                <summary><span>自动推演</span><small>频率、重试、NPC 与时间</small></summary>
                <div class="wb-settings-group-body">
            <div class="wb-setting-toggle">
                <div><strong>启用世界推演</strong><span>关闭后不再生成或推进，但保留现有世界数据</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldSimulationEnabled"
                        ${settings.worldSimulationEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-setting-toggle">
                <div><strong>推演结果注入正文</strong><span>关闭后后台世界照常运行，只是不参与主对话生成</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="worldPromptInjection"
                        ${settings.worldPromptInjection ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-setting-block">
                <label>自动推演方式</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'manual', '手动')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'light', '轻量')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'balanced', '均衡')}
                    ${settingButton('autoSimulationMode', settings.autoSimulationMode, 'deep', '深入')}
                </div>
                <p>手动模式只标记待推演；其他档位会在 AI 回复后使用上方连接自动运行。</p>
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
                <p>设为 N 轮时会按顺序合并这 N 轮新正文进行一次推演，不会只处理最后一条。</p>
                <label>推演失败自动重试</label>
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
                <p>重试会复用同一份推演前快照；只有取得合法结果后才写入状态，因此不会重复推进时间。</p>
                <label>单次最大输出</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 0, '自动')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 4000, '4K')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 8000, '8K')}
                    ${settingButton('maxOutputTokens', settings.maxOutputTokens, 12000, '12K')}
                </div>
                <label class="wb-number-setting">
                    自定义输出 token
                    <input type="number" min="0" max="16000" step="500"
                        data-wb-setting="maxOutputTokens"
                        value="${escapeAttr(settings.maxOutputTokens)}">
                </label>
                <p>遇到 JSON 截断或模型提示输出上限时可调高；设为 0 时按轻量、均衡、深入档位自动分配。</p>
                <label class="wb-custom-instruction">
                    自定义推演要求
                    <textarea data-wb-setting="customSimulationInstruction" maxlength="1000" rows="3"
                        placeholder="例如：少制造新事件；更关注商会与港口的变化。">${escapeHtml(settings.customSimulationInstruction)}</textarea>
                </label>
            </div>

            <div class="wb-setting-block">
                <label>后台 NPC 预算</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 0, '不主动推演')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 2, '最多 2 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 4, '最多 4 人')}
                    ${settingButton('backgroundNpcBudget', settings.backgroundNpcBudget, 8, '最多 8 人')}
                </div>
                <label class="wb-number-setting">
                    自定义人数上限
                    <input type="number" min="0" max="12" step="1"
                        data-wb-setting="backgroundNpcBudget"
                        value="${escapeAttr(settings.backgroundNpcBudget)}">
                </label>
                <p>入镜人物始终正常更新；上限只约束镜头外 NPC。其余人物保持休眠，群体变化会优先合并成势力或地点事件。</p>
            </div>

            <div class="wb-setting-toggle">
                <div><strong>描写玩家内心</strong><span>默认关闭，避免插件替你决定想法与立场</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="includeUserInnerVoice"
                        ${settings.includeUserInnerVoice ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>

            <div class="wb-setting-block">
                <label class="wb-custom-instruction">
                    玩家角色身份锚点
                    <textarea data-wb-setting="playerIdentityAnchor" maxlength="400" rows="3"
                        placeholder="例如：男性，外表偏女性，使用“他”和男性称谓；狐族人外，不要因外貌误判性别。">${escapeHtml(settings.playerIdentityAnchor)}</textarea>
                </label>
                <p>可填写性别身份、称谓/代词、外貌表达、身体设定、物种与年龄阶段。外貌、衣着和物种不会被自动当成性别依据。</p>
            </div>

            <div class="wb-setting-block">
                <label>正文读取范围</label>
                <div class="wb-option-row">
                    ${settingButton('contextTurns', settings.contextTurns, 1, '最近 1 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 3, '最近 3 轮')}
                    ${settingButton('contextTurns', settings.contextTurns, 5, '最近 5 轮')}
                </div>
                <p>默认读取最近 5 轮；较早内容由阶段摘要与相关伏笔补足，不会重复推进时间。</p>
            </div>

            <div class="wb-setting-block">
                <label>时间推进</label>
                <div class="wb-option-row">
                    ${settingButton('timePolicy', settings.timePolicy, 'explicit', '严格')}
                    ${settingButton('timePolicy', settings.timePolicy, 'cautious', '克制')}
                    ${settingButton('timePolicy', settings.timePolicy, 'open', '开放')}
                </div>
                <p>严格模式下，没有明确几点或经过多少分钟/小时/天，世界时钟就保持不动。</p>
            </div>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="worldbook" ${groupOpen('worldbook')}>
                <summary><span>世界书人物</span><small>手动读取、预览与选择</small></summary>
                <div class="wb-settings-group-body">
                    <form class="wb-worldbook-import" data-wb-form="worldbook">
                        <label>选择世界书
                            <select name="bookName" ${worldbookBooks.length ? '' : 'disabled'}>
                                ${worldbookBooks.length
                                    ? worldbookBooks.map(book => `<option value="${escapeAttr(book)}"
                                        ${book === worldbook.bookName ? 'selected' : ''}>${escapeHtml(book)}</option>`).join('')
                                    : '<option value="">酒馆当前没有可读取的世界书</option>'}
                            </select>
                        </label>
                        <button type="button" data-wb-action="scan-worldbook"
                            ${worldbook.phase === 'running' || !worldbookBooks.length ? 'disabled' : ''}>
                            ${worldbook.phase === 'running' ? '正在读取…' : '读取条目预览'}
                        </button>
                        <p>插件只在你点击时读取一次，不会每轮扫描世界书，也不会自动把所有条目当成 NPC。</p>
                        ${worldbook.message ? `<div class="wb-worldbook-status is-${escapeAttr(worldbook.phase)}">${escapeHtml(worldbook.message)}</div>` : ''}
                        ${worldbookEntries.length ? `
                            <div class="wb-worldbook-entry-list">
                                ${worldbookEntries.map(entry => `
                                    <label class="wb-worldbook-entry ${entry.disabled ? 'is-disabled-entry' : ''}">
                                        <input type="checkbox" name="entryIds" value="${escapeAttr(entry.uid)}">
                                        <span>
                                            <strong>${escapeHtml(entry.name)}</strong>
                                            <small>${entry.disabled ? '世界书中已停用 · ' : ''}${escapeHtml((entry.keys || []).join('、') || `UID ${entry.uid}`)}</small>
                                            <p>${escapeHtml(entry.content.slice(0, 220))}${entry.content.length > 220 ? '…' : ''}</p>
                                        </span>
                                    </label>
                                `).join('')}
                            </div>
                            <button class="wb-primary-button" type="submit">导入勾选人物</button>
                        ` : ''}
                    </form>
                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="memory" ${groupOpen('memory')}>
                <summary><span>长期记忆</span><small>自动整理与历史建档</small></summary>
                <div class="wb-settings-group-body">
            <div class="wb-setting-toggle">
                <div><strong>启用记忆系统</strong><span>关闭后停止整理与写入，但保留已有记忆</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="memorySystemEnabled"
                        ${settings.memorySystemEnabled ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-setting-toggle">
                <div><strong>记忆注入正文</strong><span>关闭后仍会整理和保存，只是不参与主对话生成</span></div>
                <label class="wb-switch">
                    <input type="checkbox" data-wb-setting="memoryPromptInjection"
                        ${settings.memoryPromptInjection ? 'checked' : ''}>
                    <i></i>
                </label>
            </div>
            <div class="wb-history-settings">
                <div class="wb-history-heading">
                    <div>
                        <label>长篇历史档案</label>
                        <strong>${escapeHtml(
                            historyRunning
                                ? memory.message || '正在扫描'
                                : `${memory.facts || 0} 条事实 · ${memory.clues || 0} 条伏笔 · ${memory.summaries || 0} 段经历`,
                        )}</strong>
                    </div>
                    <span>${historyRunning ? `${historyPercent}%` : `已到第 ${Math.max(-1, Number(memory.indexedThroughMessageId ?? -1))} 层`}</span>
                </div>
                ${historyRunning ? `
                    <div class="wb-history-progress"><i style="width:${historyPercent}%"></i></div>
                ` : ''}
                <p>首次使用时分批扫描当前重抽分支；以后只整理新增正文。每批都会更新持续摘要、长期事实和伏笔状态。</p>
                <div class="wb-memory-queue">
                    <span>尚有 ${Math.max(0, Number(memory.pendingAssistantResponses || 0))} 条 AI 正文未整理</span>
                    <strong>${settings.memoryAutoIndexInterval > 0
                        ? `自动阈值 ${settings.memoryAutoIndexInterval} 条`
                        : '当前仅手动整理'}</strong>
                </div>
                <label>自动整理记忆</label>
                <div class="wb-option-row wb-option-row-four">
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 0, '手动')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 5, '每 5 轮')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 10, '每 10 轮')}
                    ${settingButton('memoryAutoIndexInterval', settings.memoryAutoIndexInterval, 20, '每 20 轮')}
                </div>
                <label class="wb-number-setting">
                    自定义新增回复数
                    <input type="number" min="0" max="50" step="1"
                        data-wb-setting="memoryAutoIndexInterval"
                        value="${escapeAttr(settings.memoryAutoIndexInterval)}">
                </label>
                <p>设为 N 后，每累计 N 条尚未整理的 AI 正文，自动整理一个新增批次；设为 0 则只手动整理。</p>
                <button type="button" data-wb-action="scan-history"
                    ${historyRunning || !settings.memorySystemEnabled ? 'disabled' : ''}>
                    ${Number(memory.indexedThroughMessageId ?? -1) < 0 ? '建立初始记忆档案' : '立即整理新增正文'}
                </button>
            </div>

                </div>
            </details>

            <details class="wb-settings-group" data-settings-group="calendar" ${groupOpen('calendar')}>
                <summary><span>日历与数据</span><small>日期校准、导入与导出</small></summary>
                <div class="wb-settings-group-body">
            <form class="wb-clock-form" data-wb-form="clock">
                <div class="wb-clock-form-heading">
                    <div><label>主世界日历</label><strong>${escapeHtml(clock.stamp)}</strong></div>
                    <span>每个聊天独立保存</span>
                </div>
                <label class="wb-calendar-name-field">
                    历法名称
                    <input name="calendarName" maxlength="40"
                        value="${escapeAttr(clock.calendarName)}" placeholder="例如：帝国历">
                </label>
                <div class="wb-calendar-date-fields">
                    <label><input name="year" type="number" min="1" max="9999"
                        value="${clock.year}"> 年</label>
                    <label><input name="month" type="number" min="1" max="12"
                        value="${clock.month}"> 月</label>
                    <label><input name="day" type="number" min="1" max="31"
                        value="${clock.dayOfMonth}"> 日</label>
                </div>
                <div class="wb-clock-fields">
                    <label><input name="hour" type="number" min="0" max="23" value="${clock.hour}"> 时</label>
                    <label><input name="minute" type="number" min="0" max="59" value="${clock.minute}"> 分</label>
                    <button type="submit">校准</button>
                </div>
                <div class="wb-time-actions">
                    <button type="button" data-wb-action="advance-clock" data-minutes="60">+ 1 小时</button>
                    <button type="button" data-wb-action="advance-clock" data-minutes="360">+ 6 小时</button>
                    <button type="button" data-wb-action="advance-clock" data-minutes="1440">+ 1 天</button>
                </div>
            </form>

            <div class="wb-setting-actions">
                <button type="button" data-wb-action="export-state">导出当前世界</button>
                <button type="button" data-wb-action="import-state">导入世界状态</button>
                <input class="wb-import-input" type="file" accept=".json,application/json">
            </div>
                </div>
            </details>
        </div>
    `;
}

function renderAddEventModal(state) {
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-event-form">
            <form class="wb-event-form" data-wb-form="event">
                <div class="wb-form-heading">
                    <div><span>NEW CURRENT</span><h3>放入一条暗流</h3></div>
                    <button type="button" data-wb-action="close-event-form">×</button>
                </div>
                <label>事件名称<input name="title" required maxlength="140" placeholder="例如：修复一台旧通讯器"></label>
                <label>地点<input name="place" maxlength="140" placeholder="南岸维修站"></label>
                <label>正在发生什么<textarea name="summary" maxlength="420" rows="3"></textarea></label>
                <label>预计结果<textarea name="expectedResult" maxlength="420" rows="2"></textarea></label>
                <div class="wb-form-grid">
                    <label>计时方式
                        <select name="clockMode">
                            <option value="duration">自然流逝</option>
                            <option value="active">有效工时</option>
                            <option value="scheduled">预定时间</option>
                            <option value="condition">条件等待</option>
                        </select>
                    </label>
                    <label>预计耗时（小时）
                        <input name="durationHours" type="number" min="0" step="0.5" value="12">
                    </label>
                </div>
                <label>可见边界
                    <select name="visibility">
                        <option value="hidden">角色尚不可知</option>
                        <option value="trace">可由痕迹察觉</option>
                        <option value="known">可经消息获知</option>
                        <option value="direct">可以直接感知</option>
                    </select>
                </label>
                <div class="wb-form-note">
                    从 ${escapeHtml(formatWorldCalendar(state).stamp)} 开始计时。
                    回复轮次不会增加进度。
                </div>
                <button class="wb-primary-button" type="submit">开始在后台发展</button>
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
                    data-person-id="${escapeAttr(person.id)}">编辑人物卡</button>
                <div class="wb-drawer-section"><span>正在做</span><strong>${escapeHtml(person.action)}</strong></div>
                <div class="wb-drawer-section"><span>短期意图</span><strong>${escapeHtml(person.intent)}</strong></div>
                ${person.longTermGoal ? `
                    <div class="wb-drawer-section"><span>长期目标</span><strong>${escapeHtml(person.longTermGoal)}</strong></div>
                ` : ''}
                ${person.personalityAnchor ? `
                    <div class="wb-drawer-section is-character-anchor"><span>人格锚点</span><strong>${escapeHtml(person.personalityAnchor)}</strong></div>
                ` : ''}
                ${person.speakingStyle ? `
                    <div class="wb-drawer-section is-character-anchor"><span>说话习惯</span><strong>${escapeHtml(person.speakingStyle)}</strong></div>
                ` : ''}
                ${person.behaviorBoundaries ? `
                    <div class="wb-drawer-section is-character-anchor"><span>行为边界</span><strong>${escapeHtml(person.behaviorBoundaries)}</strong></div>
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
                            ? '玩家角色不使用镜头外人物观测。'
                            : observerMode !== 'backstage'
                                ? '切回幕后视角后可以观测镜头外人物。'
                                : '这个人物正在本轮镜头中，无需另行观测。'}</p>
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

function renderNowView(state, observerMode, people, activeEvents) {
    const clock = formatWorldCalendar(state);
    return `
        <div class="wb-overview">
            <section class="wb-world-card">
                <div class="wb-world-card-copy">
                    <span class="wb-section-kicker">WORLD STATE · ${escapeHtml(clock.stamp)}</span>
                    <h3>${escapeHtml(state.world.title)}</h3>
                    <p>${escapeHtml(state.world.detail)}</p>
                </div>
                <div class="wb-world-pulse" aria-hidden="true">
                    <i></i><i></i><span></span>
                    <strong>${state.pendingSync ? '待推演' : '持续中'}</strong>
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
                            || renderEmpty('当前没有活动事件', '世界仍可继续推演人物状态。')}
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
                        )).join('') || renderEmpty('还没有人物轨迹', '完成一次世界推演后会出现在这里。')}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderPeopleView(state, observerMode, people) {
    return `
        <div class="wb-view-intro">
            <p>人物的行动首先属于她们自己。她们未说出口的心声只存在于幕后，不会偷渡成主角的知识。</p>
            <div class="wb-memory-intro-actions">
                <span>${people.length} 条可观测轨迹</span>
                <button type="button" data-wb-action="open-person-editor">＋ 添加后台 NPC</button>
            </div>
        </div>
        <div class="wb-people-grid">
            ${people.map(person => renderPersonCard(
                person,
                observerMode,
                state.clock.absoluteMinute,
            )).join('') || renderEmpty(
                observerMode === 'known' ? '角色目前没有可确认的人物轨迹' : '后台人物尚未建立',
                observerMode === 'known' ? '切回幕后视角可以查看未知轨迹。' : '回复后自动推演或手动推演一次。',
            )}
        </div>
    `;
}

function renderPersonEditorModal(state, editor) {
    const person = state.people.find(item => item.id === editor?.id) || null;
    return `
        <div class="wb-drawer-scrim" data-wb-action="close-person-editor">
            <form class="wb-event-form wb-person-editor" data-wb-form="person">
                <div class="wb-form-heading">
                    <div><span>BACKSTAGE CAST</span><h3>${person ? '编辑后台人物' : '添加后台 NPC'}</h3></div>
                    <button type="button" data-wb-action="close-person-editor">×</button>
                </div>
                <input type="hidden" name="id" value="${escapeAttr(person?.id || '')}">
                <label>姓名<input name="name" required maxlength="80" value="${escapeAttr(person?.name || '')}"></label>
                <label>当前位置<input name="location" maxlength="160" value="${escapeAttr(person?.location || '')}"></label>
                <label>正在做<textarea name="action" maxlength="280" rows="2">${escapeHtml(person?.action || '')}</textarea></label>
                <label>短期意图<textarea name="intent" maxlength="320" rows="2">${escapeHtml(person?.intent || '')}</textarea></label>
                <label>长期目标<textarea name="longTermGoal" maxlength="420" rows="3">${escapeHtml(person?.longTermGoal || '')}</textarea></label>
                <fieldset class="wb-character-anchor-fields">
                    <legend><span>角色约束</span><small>推演与即时观测都会遵守，AI 不会自动改写</small></legend>
                    <label>人格锚点<textarea name="personalityAnchor" maxlength="600" rows="3"
                        placeholder="例如：外冷内热，警惕权威；重视承诺，但不轻易示弱。">${escapeHtml(person?.personalityAnchor || '')}</textarea></label>
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
                    ${person ? `<button type="button" data-wb-action="delete-manual-person"
                        data-person-id="${escapeAttr(person.id)}" ${person.locked ? 'disabled' : ''}>删除人物</button>` : ''}
                    <button class="wb-primary-button" type="submit">${person ? '保存人物卡' : '加入后台名单'}</button>
                </div>
            </form>
        </div>
    `;
}

function renderCurrentsView(state, activeEvents) {
    return `
        <div class="wb-view-intro">
            <p>每条事件都锚定主世界时间。AI回复只触发推演，时钟没有前进时，事件也不会凭轮次长到100%。</p>
            <button class="wb-inline-add" type="button" data-wb-action="open-event-form">＋ 放入一条暗流</button>
        </div>
        <div class="wb-event-list is-full">
            ${activeEvents.map(event => renderEventCard(event, state, true)).join('')
                || renderEmpty('进行中列表已经清空', '到时、取消或错过的事件会离开这里，结果转入回声。')}
        </div>
    `;
}

function renderEchoesView(state, outcomes) {
    return `
        <div class="wb-view-intro">
            <p>到时事件从进行中列表离开。只有正文真正承接过的结果，才会被标为“已由正文承接”。</p>
            <span>最近结果</span>
        </div>
        <div class="wb-echo-timeline">
            ${outcomes.map(event => renderOutcome(event, state)).join('')
                || renderEmpty('还没有形成结果', '后台发生不等于已经递交前台。')}
        </div>
    `;
}

function clueStatusLabel(status) {
    return {
        open: '尚未呼应',
        echoed: '已经回响',
        resolved: '已经解决',
        discarded: '不再有效',
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
        ...(item?.tags || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized);
}

function renderMemoryActions(kind, item) {
    return `
        <div class="wb-memory-card-actions">
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
        Number(['open', 'echoed'].includes(b.status))
        - Number(['open', 'echoed'].includes(a.status))
        || Number(b.importance || 0) - Number(a.importance || 0)
        || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
    ));
    const allSummaries = observerMode === 'backstage'
        ? [...(memory.summaries || [])].sort(
            (a, b) => Number(b.endMessageId || 0) - Number(a.endMessageId || 0),
        )
        : [];
    const digest = observerMode === 'backstage' ? memory.digest : null;
    const normalizedFilter = ['active', 'facts', 'clues', 'episodes', 'all'].includes(filter)
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
        && (
            normalizedFilter === 'all'
            || normalizedFilter === 'clues'
            || (normalizedFilter === 'active' && ['open', 'echoed'].includes(clue.status))
        )
    ));
    const summaries = allSummaries.filter(summary => (
        memoryItemMatches(summary, query)
        && ['all', 'episodes'].includes(normalizedFilter)
    ));
    const shownFacts = facts.slice(0, maximum);
    const shownClues = clues.slice(0, maximum);
    const shownSummaries = summaries.slice(0, maximum);
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
    return `
        <div class="wb-view-intro">
            <p>记忆会区分长期事实、未回收伏笔和阶段经历；旧说法被新正文改变时会保留版本关系，不把废弃分支悄悄混回来。</p>
            <div class="wb-memory-intro-actions">
                <span>${allFacts.filter(fact => ['active', 'disputed'].includes(fact.status)).length} 条有效事实 · ${allClues.filter(clue => ['open', 'echoed'].includes(clue.status)).length} 条待回收伏笔</span>
                <button type="button" data-wb-action="open-memory-editor" data-memory-kind="fact">＋ 新增记忆</button>
            </div>
        </div>
        <div class="wb-memory-shell">
            <div class="wb-memory-tools">
                <div class="wb-memory-filters" aria-label="记忆筛选">
                    ${filterButton('active', '进行中')}
                    ${filterButton('facts', '事实')}
                    ${filterButton('clues', '伏笔')}
                    ${filterButton('episodes', '经历')}
                    ${filterButton('all', '全部')}
                </div>
                <label class="wb-memory-search">
                    <span>搜索记忆</span>
                    <input type="search" data-wb-memory-search maxlength="80"
                        value="${escapeAttr(query)}" placeholder="人物、地点、物品或关键词">
                </label>
                <small>${query ? `找到 ${resultCount} 条` : `当前分类 ${resultCount} 条`}</small>
            </div>
            ${digest?.text ? `
                <section class="wb-memory-digest">
                    <div>
                        <span>CONTINUOUS MEMORY</span>
                        <h3>持续摘要</h3>
                    </div>
                    <p>${escapeHtml(digest.text)}</p>
                    <small>整理至消息 ${escapeHtml(digest.throughMessageId)}</small>
                </section>
            ` : ''}
            ${resultCount === 0 ? renderEmpty(
                query ? '没有找到匹配的记忆' : '这个分类暂时是空的',
                query ? '换一个人物、地点、物品或关键词试试。' : '新的正文整理后会自动补充。',
            ) : `
            <div class="wb-memory-layout">
                <section class="wb-memory-section ${shownFacts.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading">
                        <div><span>DURABLE FACTS</span><h3>长期事实</h3></div>
                    </div>
                    <div class="wb-memory-fact-list">
                        ${shownFacts.map(fact => `
                            <article class="wb-memory-fact-card is-${escapeAttr(fact.status)}">
                                <div class="wb-memory-fact-meta">
                                    <span>${escapeHtml(memoryFactStatusLabel(fact.status))}</span>
                                    <span>${escapeHtml(memoryConfidenceLabel(fact.confidence))} · 来源 ${escapeHtml(fact.sourceMessageId)}:${escapeHtml(fact.sourceSwipeId)}</span>
                                </div>
                                <h4>${escapeHtml(fact.subject || fact.key)}</h4>
                                ${fact.predicate ? `<small>${escapeHtml(fact.predicate)}</small>` : ''}
                                <p>${escapeHtml(fact.value)}</p>
                                ${fact.invalidationReason
                                    ? `<div class="wb-memory-fact-note">${escapeHtml(fact.invalidationReason)}</div>`
                                    : ''}
                                ${renderMemoryActions('fact', fact)}
                            </article>
                        `).join('') || renderEmpty('还没有长期事实', '明确成立且未来仍有用的信息会沉淀在这里。')}
                    </div>
                </section>
                <section class="wb-memory-section ${shownClues.length ? '' : 'is-hidden'}">
                    <div class="wb-section-heading">
                        <div><span>UNRESOLVED THREADS</span><h3>伏笔簿</h3></div>
                    </div>
                    <div class="wb-clue-list">
                        ${shownClues.map(clue => `
                            <article class="wb-clue-card is-${escapeAttr(clue.status)}">
                                <div class="wb-clue-meta">
                                    <span>${escapeHtml(clueStatusLabel(clue.status))}</span>
                                    <span>第 ${escapeHtml(clue.sourceMessageId)} 层 · 重抽 ${escapeHtml(clue.sourceSwipeId)}</span>
                                </div>
                                <h4>${escapeHtml(clue.title)}</h4>
                                <p>${escapeHtml(clue.text)}</p>
                                ${clue.sourceExcerpt ? `<blockquote>${escapeHtml(clue.sourceExcerpt)}</blockquote>` : ''}
                                ${clue.resolution ? `<div class="wb-clue-resolution">${escapeHtml(clue.resolution)}</div>` : ''}
                                ${renderMemoryActions('clue', clue)}
                            </article>
                        `).join('') || renderEmpty('伏笔簿还是空的', '真正需要回收的线索会出现在这里。')}
                    </div>
                </section>
            </div>
            <section class="wb-memory-summary-section ${shownSummaries.length ? '' : 'is-hidden'}">
                <div class="wb-section-heading">
                    <div><span>EPISODIC MEMORY</span><h3>阶段经历</h3></div>
                </div>
                <div class="wb-summary-list">
                    ${shownSummaries.map(summary => `
                        <article class="wb-summary-card">
                            <span>消息 ${escapeHtml(summary.startMessageId)}—${escapeHtml(summary.endMessageId)}</span>
                            <h4>${escapeHtml(summary.title)}</h4>
                            <p>${escapeHtml(summary.summary)}</p>
                            ${renderMemoryActions('summary', summary)}
                        </article>
                    `).join('') || renderEmpty(
                        observerMode === 'backstage' ? '还没有阶段经历' : '阶段经历只在幕后视角显示',
                        observerMode === 'backstage' ? '自动整理或建立历史档案后会出现在这里。' : '',
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

function renderArchiveView(state, outcomes) {
    const combined = [
        ...state.archive,
        ...outcomes.filter(event => (
            ['delivered', 'expired'].includes(event.delivery?.state)
            || event.visibility === 'hidden'
        )),
    ];
    const seen = new Set();
    const archived = combined.filter(entry => {
        const key = entry.eventId || entry.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return `
        <div class="wb-view-intro">
            <p>没有抵达镜头的故事也不会凭空消失。这里保留世界后果，不把它们冒充成任何角色的记忆。</p>
            <span>世界账本</span>
        </div>
        <div class="wb-archive-ledger">
            ${archived.map(entry => renderArchiveEntry(entry, state)).join('')
                || renderEmpty('纪事还是空的', '稳定结果形成后会留下可追溯记录。')}
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

export function createWorldBackstageUI({
    getState,
    getSettings,
    getSyncStatus = () => ({ phase: 'idle', message: '尚未进行世界推演' }),
    onAction,
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

    let activeView = 'now';
    let renderedView = activeView;
    let observerMode = 'backstage';
    let isOpen = false;
    let settingsOpen = false;
    let eventFormOpen = false;
    let selectedPersonId = null;
    let personObservation = null;
    let busy = false;
    let toast = '';
    let toastTimer = null;
    let closeTimer = null;
    let closing = false;
    let panelEntrancePending = false;
    let memorySearchTimer = null;
    let memoryFilter = 'active';
    let memoryQuery = '';
    let memoryVisibleCount = 12;
    let memoryEditor = null;
    let personEditor = null;
    let settingsScrollTop = 0;
    let openSettingsGroups = new Set(['connection', 'simulation']);
    let eventFormDraft = null;
    let apiFormDraft = null;
    let skipApiDraftCapture = false;
    const viewScrollTop = new Map();
    let orbDrag = null;
    let suppressOrbClick = false;

    function notify(message, tone = 'normal') {
        toast = String(message || '');
        root.dataset.toastTone = tone;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            toast = '';
            render();
        }, tone === 'error' ? 5600 : 3200);
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
            eventFormDraft = null;
            memoryEditor = null;
            personEditor = null;
            selectedPersonId = null;
            personObservation = null;
            render();
        }, closeDelay);
    }

    function render() {
        const viewChanged = activeView !== renderedView;
        const animatePanelEntrance = Boolean(isOpen && panelEntrancePending);
        const previousContent = root.querySelector('.wb-view-content');
        if (previousContent) viewScrollTop.set(renderedView, previousContent.scrollTop);
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
        const previousEventForm = root.querySelector('[data-wb-form="event"]');
        if (previousEventForm && eventFormOpen) {
            eventFormDraft = Object.fromEntries(new FormData(previousEventForm).entries());
        }
        const previousApiForm = root.querySelector('[data-wb-form="api"]');
        if (previousApiForm && !skipApiDraftCapture) {
            readApiForm(previousApiForm);
        }
        skipApiDraftCapture = false;
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
        const canCancelSimulation = Boolean(syncStatus.canCancelSimulation);
        const memoryPhase = syncStatus.memory?.phase;
        if (['running', 'error'].includes(memoryPhase)) openSettingsGroups.add('memory');
        const memoryTakesFocus = ['running', 'error'].includes(memoryPhase);
        const displayPhase = memoryTakesFocus ? memoryPhase : syncStatus.phase;
        const displayPhaseLabel = memoryTakesFocus
            ? (memoryPhase === 'error' ? '记忆失败' : '整理记忆中')
            : syncPhaseLabel(syncStatus.phase);
        const theme = themeFor(state, settings);
        const clock = formatWorldCalendar(state);
        const orbStyles = orbInlineStyles(settings.orbPosition);
        const currentView = VIEWS.find(view => view.id === activeView) || VIEWS[0];
        const userName = String(syncStatus.userName || '').toLocaleLowerCase();
        const displayPeople = state.people.map(person => {
            const isUser = Boolean(
                person.isUser
                || (userName && person.name?.toLocaleLowerCase() === userName)
            );
            return isUser && !settings.includeUserInnerVoice
                ? { ...person, isUser: true, innerVoice: '' }
                : { ...person, isUser };
        });
        const visiblePeople = observerMode === 'backstage'
            ? displayPeople
            : displayPeople.filter(person => person.knowledge === 'known');
        const visibleEvents = observerMode === 'backstage'
            ? state.events
            : state.events.filter(event => event.visibility !== 'hidden');
        const activeEvents = visibleEvents.filter(isActiveEvent);
        const outcomes = visibleEvents
            .filter(event => event.status === 'ready' || isTerminalEvent(event))
            .sort((a, b) => Number(b.resolvedAt ?? b.updatedAt) - Number(a.resolvedAt ?? a.updatedAt));
        const person = displayPeople.find(item => item.id === selectedPersonId);
        const presentPersonIds = new Set(syncStatus.presentPersonIds || []);
        const canObservePerson = Boolean(
            person
            && observerMode === 'backstage'
            && !presentPersonIds.has(person.id)
            && !person.isUser
        );
        const pendingDeliveries = state.events.filter(event => event.delivery?.state === 'pending').length;
        const orbProcessing = (
            ['queued', 'running', 'cancelling'].includes(syncStatus.phase)
            || syncStatus.memory?.phase === 'running'
        );
        const needsAttention = (
            pendingDeliveries
            || state.pendingSync
            || ['error', 'pending', 'queued'].includes(syncStatus.phase)
            || memoryPhase === 'error'
        );

        let content = '';
        if (activeView === 'now') content = renderNowView(state, observerMode, visiblePeople, activeEvents);
        if (activeView === 'people') content = renderPeopleView(state, observerMode, visiblePeople);
        if (activeView === 'currents') content = renderCurrentsView(state, activeEvents);
        if (activeView === 'echoes') content = renderEchoesView(state, outcomes);
        if (activeView === 'memory') content = renderMemoryView(state, observerMode, {
            query: memoryQuery,
            filter: memoryFilter,
            visibleCount: memoryVisibleCount,
        });
        if (activeView === 'archive') content = renderArchiveView(state, outcomes);

        root.className = `wb-root theme-${theme} wb-size-${settings.uiScale} ${settings.enabled ? 'is-enabled' : 'is-disabled'}`;
        root.innerHTML = `
            <button class="wb-world-orb ${isOpen ? 'is-open' : ''} ${orbProcessing ? 'is-processing' : ''} ${settings.orbPosition ? 'has-custom-position' : ''}" type="button"
                style="${orbStyles.orb}" data-wb-action="toggle-panel"
                aria-label="${isOpen ? '收起世界背面' : '打开世界背面'}">
                <span class="wb-orb-halo"></span>
                <span class="wb-orb-ring ring-one"></span>
                <span class="wb-orb-ring ring-two"></span>
                <span class="wb-orb-core"></span>
                ${needsAttention ? '<i class="wb-orb-notice"></i>' : ''}
            </button>
            <div class="wb-orb-caption ${!isOpen && needsAttention ? 'is-visible' : ''}"
                style="${orbStyles.caption}">
                <strong>世界背面</strong>
                <span>${escapeHtml(
                    memoryPhase === 'error'
                        ? syncStatus.memory?.message || '上次记忆整理失败，打开可查看原因'
                        : memoryPhase === 'running'
                        ? syncStatus.memory.message || '正在整理长期记忆'
                        : orbProcessing
                            ? syncStatus.message || '世界正在推演'
                            : syncStatus.phase === 'error'
                                ? '上次推演失败，打开可查看原因'
                                : state.pendingSync
                                    ? '最新正文等待推演'
                                    : `${pendingDeliveries} 条变化正在靠近镜头`,
                )}</span>
            </div>

            ${isOpen ? `
                <div class="wb-panel-scrim ${animatePanelEntrance ? 'is-opening' : ''}" data-wb-action="close-panel">
                    <section class="wb-window" role="dialog" aria-modal="true" aria-label="世界背面">
                        <header class="wb-window-header">
                            <div class="wb-brand">
                                ${renderBrandMark()}
                                <div>
                        <span class="wb-brand-line"><h1>世界背面</h1><i>试用版 0.7.3</i></span>
                                    <p>镜头之外，世界仍在继续</p>
                                </div>
                            </div>
                            <div class="wb-header-center">
                                <time class="wb-world-calendar" datetime="${escapeAttr(
                                    `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.dayOfMonth).padStart(2, '0')}T${clock.time}`,
                                )}" aria-label="${escapeAttr(clock.stamp)}">
                                    <span class="wb-calendar-page" aria-hidden="true">
                                        <small>${escapeHtml(`${clock.month}月`)}</small>
                                        <strong>${escapeHtml(String(clock.dayOfMonth).padStart(2, '0'))}</strong>
                                    </span>
                                    <span class="wb-calendar-copy">
                                        <small>${escapeHtml(`${state.world.name} · ${clock.calendarName}`)}</small>
                                        <strong>${escapeHtml(`${clock.year} 年 ${clock.month} 月`)}</strong>
                                        <em>${escapeHtml(clock.time)}</em>
                                    </span>
                                </time>
                                <span class="wb-live-status is-${escapeAttr(displayPhase)}">
                                    <i></i>${escapeHtml(displayPhaseLabel)}
                                </span>
                            </div>
                            <div class="wb-header-actions">
                                <button type="button" class="wb-round-action" data-wb-action="cycle-theme"
                                    aria-label="切换界面明暗"><span class="wb-theme-glyph"></span></button>
                                <button type="button" class="wb-round-action ${settingsOpen ? 'is-active' : ''}"
                                    data-wb-action="toggle-settings" aria-label="观测设置">
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
                                <button class="wb-side-sync wb-sim-action ${canCancelSimulation ? 'is-cancel' : ''}"
                                    type="button" data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                    ${busy && !canCancelSimulation ? 'disabled' : ''}>
                                    <i aria-hidden="true"></i><span>${canCancelSimulation ? '停止推演' : '推演世界'}</span>
                                </button>
                            </nav>

                            <div class="wb-content-column">
                                <div class="wb-view-header">
                                    <div><span>${currentView.eyebrow}</span><h2>${currentView.label}</h2></div>
                                    <div class="wb-observer-switch">
                                        <button type="button" data-wb-action="set-observer" data-mode="backstage"
                                            aria-pressed="${observerMode === 'backstage'}"
                                            class="${observerMode === 'backstage' ? 'is-active' : ''}">幕后视角</button>
                                        <button type="button" data-wb-action="set-observer" data-mode="known"
                                            aria-pressed="${observerMode === 'known'}"
                                            class="${observerMode === 'known' ? 'is-active' : ''}">角色所知</button>
                                    </div>
                                </div>
                                ${renderSyncStrip(syncStatus)}
                                <div class="wb-view-content ${viewChanged ? 'is-entering' : ''}">${content}</div>
                                <footer class="wb-window-footer">
                                    <div>
                                        <span>主世界 ${escapeHtml(clock.stamp)}</span><i></i>
                                        <span>AI回复：只触发推演，不自动计时</span><i></i>
                                        <span>独白：仅幕后可见</span>
                                    </div>
                                    <button class="wb-sim-action ${canCancelSimulation ? 'is-cancel' : ''}" type="button"
                                        data-wb-action="${canCancelSimulation ? 'cancel-simulation' : 'manual-sync'}"
                                        ${busy && !canCancelSimulation ? 'disabled' : ''}>
                                        <i aria-hidden="true"></i><span>${canCancelSimulation ? '停止本次推演' : '推演最新正文'}</span>
                                    </button>
                                </footer>
                            </div>
                        </div>

                    </section>
                    ${settingsOpen ? `
                        <div class="wb-settings-layer">
                            ${renderSettings(state, settings, syncStatus, openSettingsGroups, apiFormDraft)}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            ${eventFormOpen ? renderAddEventModal(state) : ''}
            ${memoryEditor ? renderMemoryEditorModal(state, memoryEditor) : ''}
            ${personEditor ? renderPersonEditorModal(state, personEditor) : ''}
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
                    <p>${escapeHtml(toast)}</p>
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
        const currentSettings = root.querySelector('.wb-settings-popover');
        if (currentSettings) currentSettings.scrollTop = settingsScrollTop;
        const currentEventForm = root.querySelector('[data-wb-form="event"]');
        if (currentEventForm && eventFormDraft) {
            for (const [name, value] of Object.entries(eventFormDraft)) {
                const field = currentEventForm.elements.namedItem(name);
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
            const captionWidth = 210;
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

    root.addEventListener('pointerdown', event => {
        const orb = event.target.closest('.wb-world-orb');
        if (!orb || event.button !== 0) return;
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
        if (action === 'set-view') {
            activeView = target.dataset.view || 'now';
            render();
            return;
        }
        if (action === 'set-memory-filter') {
            memoryFilter = target.dataset.filter || 'active';
            memoryVisibleCount = 12;
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
        if (action === 'toggle-memory-flag') {
            await invokeAction('toggle-memory-flag', {
                kind: target.dataset.memoryKind || 'fact',
                id: target.dataset.memoryId || '',
                field: target.dataset.memoryField || 'important',
            });
            render();
            return;
        }
        if (action === 'delete-memory-item') {
            const confirmed = globalThis.confirm?.('确定删除这条记忆吗？此操作可以用底部撤销恢复。');
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
            settingsOpen = !settingsOpen;
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
            personEditor = { id: target.dataset.personId || '' };
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
        if (action === 'delete-manual-person') {
            const confirmed = globalThis.confirm?.('确定从后台人物名单中删除这个 NPC 吗？');
            if (confirmed === false) return;
            const completed = await invokeAction('delete-manual-person', {
                id: target.dataset.personId || '',
            });
            if (completed) personEditor = null;
            render();
            return;
        }
        if (action === 'open-event-form') {
            eventFormDraft = null;
            eventFormOpen = true;
            render();
            return;
        }
        if (action === 'close-event-form') {
            eventFormDraft = null;
            eventFormOpen = false;
            render();
            return;
        }
        if (action === 'setting-button') {
            await invokeAction('update-settings', {
                [target.dataset.setting]: target.dataset.value,
            });
            render();
            return;
        }
        if (action === 'cycle-theme') {
            const settings = getSettings();
            const next = settings.theme === 'auto'
                ? 'day'
                : settings.theme === 'day'
                    ? 'night'
                    : 'auto';
            await invokeAction('update-settings', { theme: next });
            render();
            return;
        }
        if (action === 'advance-clock') {
            await invokeAction('advance-clock', { minutes: Number(target.dataset.minutes) || 0 });
            render();
            return;
        }
        if (action === 'scan-worldbook') {
            const form = target.closest('[data-wb-form="worldbook"]');
            await invokeAction('scan-worldbook', {
                bookName: form?.elements?.bookName?.value || '',
            });
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
        if (action === 'test-api') {
            const form = target.closest('[data-wb-form="api"]');
            if (form) {
                if (!form.reportValidity()) return;
                const data = readApiForm(form);
                const completed = await invokeAction('update-settings', apiSettingsFromDraft(data));
                if (!completed) return;
                forgetApiKeyDraft(data);
            }
            await invokeAction('test-api');
            render();
            return;
        }
        if (action === 'pull-api-models') {
            const form = target.closest('[data-wb-form="api"]');
            if (form) {
                if (!form.reportValidity()) return;
                const data = readApiForm(form);
                const completed = await invokeAction('update-settings', apiSettingsFromDraft(data));
                if (!completed) return;
                forgetApiKeyDraft(data);
            }
            await invokeAction('pull-api-models');
            render();
            return;
        }
        if (action === 'reset-api-draft') {
            apiFormDraft = {
                customApiUrl: '',
                customApiCredential: '',
                customApiModel: '',
                customApiTransport: getSettings().customApiTransport,
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

        await invokeAction(action, {});
        render();
    });

    root.addEventListener('change', async event => {
        const apiForm = event.target.closest?.('[data-wb-form="api"]');
        if (apiForm) {
            readApiForm(apiForm);
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

        if (!event.target.matches?.('[data-wb-memory-search]')) return;
        memoryQuery = String(event.target.value || '').slice(0, 80);
        memoryVisibleCount = 12;
        window.clearTimeout(memorySearchTimer);
        memorySearchTimer = window.setTimeout(render, 120);
    });

    root.addEventListener('submit', async event => {
        const form = event.target.closest('[data-wb-form]');
        if (!form) return;
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());

        if (form.dataset.wbForm === 'clock') {
            await invokeAction('set-clock', data);
        }
        if (form.dataset.wbForm === 'api') {
            apiFormDraft = { ...data };
            const completed = await invokeAction('update-settings', apiSettingsFromDraft(data));
            if (completed) {
                forgetApiKeyDraft(data);
                notify('独立接口设置已保存，旧值不会再自动填回。', 'success');
            }
        }
        if (form.dataset.wbForm === 'event') {
            const completed = await invokeAction('add-event', data);
            if (completed) {
                eventFormOpen = false;
                eventFormDraft = null;
            }
        }
        if (form.dataset.wbForm === 'memory') {
            const completed = await invokeAction('save-memory-item', {
                id: data.id || '',
                kind: data.kind || 'fact',
                title: data.title || '',
                relation: data.relation || '',
                content: data.content || '',
                important: form.elements.important?.checked || false,
                locked: form.elements.locked?.checked || false,
            });
            if (completed) memoryEditor = null;
        }
        if (form.dataset.wbForm === 'person') {
            const completed = await invokeAction('save-manual-person', {
                id: data.id || '',
                name: data.name || '',
                location: data.location || '',
                action: data.action || '',
                intent: data.intent || '',
                longTermGoal: data.longTermGoal || '',
                personalityAnchor: data.personalityAnchor || '',
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
            await invokeAction('import-worldbook-people', {
                bookName: String(formData.get('bookName') || ''),
                entryIds: formData.getAll('entryIds').map(String),
            });
        }
        render();
    });

    const onKeydown = event => {
        if (
            ['Enter', ' '].includes(event.key)
            && event.target.matches?.('[role="button"][data-wb-action]')
        ) {
            event.preventDefault();
            event.target.click();
            return;
        }
        if (event.key !== 'Escape') return;
        if (selectedPersonId) selectedPersonId = null;
        else if (eventFormOpen) {
            eventFormOpen = false;
            eventFormDraft = null;
        }
        else if (settingsOpen) settingsOpen = false;
        else if (isOpen) {
            close();
            return;
        }
        render();
    };
    const onResize = () => {
        syncVisualViewportInsets();
        if (getSettings().orbPosition) render();
    };
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', syncVisualViewportInsets);
    window.visualViewport?.addEventListener('scroll', syncVisualViewportInsets);

    render();
    return {
        render,
        notify,
        setBusy,
        open,
        close,
        destroy() {
            window.clearTimeout(toastTimer);
            window.clearTimeout(memorySearchTimer);
            window.clearTimeout(closeTimer);
            document.removeEventListener('keydown', onKeydown);
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', syncVisualViewportInsets);
            window.visualViewport?.removeEventListener('scroll', syncVisualViewportInsets);
            root.remove();
        },
    };
}
