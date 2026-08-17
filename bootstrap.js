import './storage-guard.js';
import './mobile-social-fix.js';
import './mobile-character-search-scroll.js';
import './mobile-ui-polish.js';
import './ui-hotfix.js';
import './token-budget-policy.js';
import './communication-ecology.js';
import './settings-persistence-guard.js';
import './index.js';

void import('./presentation-polish.js?v=250').catch(error => {
    console.error('[世界背面] 通讯表现层修复加载失败', error);
});
