import './storage-guard.js';
import './mobile-character-search-scroll.js';
import './mobile-ui-polish.js';
import './ui-hotfix.js';
import './token-budget-policy.js';
import './communication-ecology.js';
import './communication-voice-guard.js';
import './observation-scene-overlap.js';
import './settings-persistence-guard.js';
import './social-notice-stability.js?v=3';
import './index.js';
import './phone-bridge-host.js?v=2';

void import('./update-manager.js?v=2')
    .then(() => import('./update-session-refresh.js?v=1'))
    .catch(error => {
        console.error('[世界背面] 更新检查管理器加载失败', error);
    });

void import('./social-friend-request-fix.js?v=2').catch(error => {
    console.error('[世界背面] 好友申请状态修复加载失败', error);
});

void import('./presentation-polish.js?v=251')
    .then(() => Promise.all([
        import('./social-responsive-adapter.js?v=1'),
        import('./settings-responsive-adapter.js?v=1'),
        import('./mobile-news-discussion.js?v=1'),
    ]))
    .catch(error => {
        console.error('[世界背面] 自适应表现层加载失败', error);
    });

void import('./orb-motion-randomizer.js?v=8').catch(error => {
    console.error('[世界背面] 悬浮球生命动态加载失败', error);
});

void import('./community-note.js?v=3').catch(error => {
    console.error('[世界背面] 妈妈的小纸条加载失败', error);
});

void import('./community-note-entry-fix.js?v=1').catch(error => {
    console.error('[世界背面] 妈妈的小纸条常驻入口加载失败', error);
});

void import('./lingqi-greeting.js?v=2').catch(error => {
    console.error('[世界背面] 玲七常驻开场白加载失败', error);
});

void import('./history-parallel-lab-runtime.js?v=2').catch(error => {
    console.error('[世界背面] 并行历史实验室加载失败', error);
});
