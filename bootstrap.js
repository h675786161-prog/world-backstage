import './storage-guard.js';
import './mobile-character-search-scroll.js';
import './mobile-ui-polish.js';
import './ui-hotfix.js';
import './token-budget-policy.js';
import './communication-ecology.js';
import './settings-persistence-guard.js';
import './social-notice-stability.js?v=3';
import './index.js';

void import('./presentation-polish.js?v=251')
    .then(() => Promise.all([
        import('./social-responsive-adapter.js?v=1'),
        import('./settings-responsive-adapter.js?v=1'),
    ]))
    .catch(error => {
        console.error('[世界背面] 自适应表现层加载失败', error);
    });

void import('./orb-motion-randomizer.js?v=2').catch(error => {
    console.error('[世界背面] 悬浮球随机运转加载失败', error);
});

void import('./community-note.js?v=3').catch(error => {
    console.error('[世界背面] 妈妈的小纸条加载失败', error);
});

void import('./lingqi-greeting.js?v=2').catch(error => {
    console.error('[世界背面] 玲七常驻开场白加载失败', error);
});
