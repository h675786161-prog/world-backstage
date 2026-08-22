const STYLE_ID = 'wb-orb-motion-randomizer-test-v1';
const CSS = `
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='sweep'] .wb-orb-ring.ring-one { animation: wb-orb-test-sweep-one 4.1s cubic-bezier(.45,0,.55,1) infinite alternate !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='sweep'] .wb-orb-ring.ring-two { animation: wb-orb-test-sweep-two 6.9s cubic-bezier(.38,.05,.62,.95) infinite alternate-reverse !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='counter'] .wb-orb-ring.ring-one { animation: wb-orb-test-counter-one 6.4s cubic-bezier(.42,0,.58,1) infinite alternate-reverse !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='counter'] .wb-orb-ring.ring-two { animation: wb-orb-test-counter-two 4.6s cubic-bezier(.45,0,.55,1) infinite alternate !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='drift'] .wb-orb-ring.ring-one { animation: wb-orb-test-drift-one 7.8s ease-in-out infinite alternate !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='drift'] .wb-orb-ring.ring-two { animation: wb-orb-test-drift-two 5.7s ease-in-out infinite alternate-reverse !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='cross'] .wb-orb-ring.ring-one { animation: wb-orb-test-cross-one 5.2s cubic-bezier(.37,.08,.63,.92) infinite alternate !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='cross'] .wb-orb-ring.ring-two { animation: wb-orb-test-cross-two 8.1s cubic-bezier(.45,0,.55,1) infinite alternate !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='orbit'] .wb-orb-ring.ring-one { animation: wb-orb-test-orbit-one 9.2s linear infinite !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='orbit'] .wb-orb-ring.ring-two { animation: wb-orb-test-orbit-two 12.6s linear infinite reverse !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='sweep'] .wb-orb-core { animation-duration: 2.35s !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='counter'] .wb-orb-core { animation-duration: 3.05s !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='drift'] .wb-orb-core { animation-duration: 3.65s !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='cross'] .wb-orb-core { animation-duration: 2.7s !important; }
#world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion='orbit'] .wb-orb-core { animation-duration: 3.25s !important; }
@keyframes wb-orb-test-sweep-one { from { transform: rotate(20deg) scale(.985); opacity:.46; } to { transform: rotate(146deg) scale(1.018); opacity:.72; } }
@keyframes wb-orb-test-sweep-two { from { transform: rotate(79deg) scale(1.015); opacity:.61; } to { transform: rotate(-34deg) scale(.975); opacity:.39; } }
@keyframes wb-orb-test-counter-one { from { transform: rotate(20deg) scale(.99); opacity:.48; } to { transform: rotate(-76deg) scale(1.02); opacity:.69; } }
@keyframes wb-orb-test-counter-two { from { transform: rotate(79deg) scale(1.02); opacity:.64; } to { transform: rotate(172deg) scale(.98); opacity:.4; } }
@keyframes wb-orb-test-drift-one { 0% { transform: rotate(20deg) scale(.985); opacity:.46; } 52% { transform: rotate(83deg) scale(1.018); opacity:.68; } 100% { transform: rotate(128deg) scale(.995); opacity:.56; } }
@keyframes wb-orb-test-drift-two { 0% { transform: rotate(79deg) scale(1.015); opacity:.62; } 46% { transform: rotate(24deg) scale(.98); opacity:.4; } 100% { transform: rotate(-12deg) scale(1.01); opacity:.54; } }
@keyframes wb-orb-test-cross-one { from { transform: rotate(20deg) scale(.98); opacity:.44; } to { transform: rotate(118deg) scale(1.025); opacity:.74; } }
@keyframes wb-orb-test-cross-two { from { transform: rotate(79deg) scale(1.02); opacity:.64; } to { transform: rotate(-61deg) scale(.97); opacity:.36; } }
@keyframes wb-orb-test-orbit-one { from { transform: rotate(20deg) scale(.995); opacity:.54; } 50% { opacity:.7; } to { transform: rotate(380deg) scale(1.01); opacity:.54; } }
@keyframes wb-orb-test-orbit-two { from { transform: rotate(79deg) scale(1.01); opacity:.58; } 50% { opacity:.4; } to { transform: rotate(439deg) scale(.985); opacity:.58; } }
@media (prefers-reduced-motion: reduce) { #world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion] .wb-orb-ring, #world-backstage-root .wb-world-orb.is-processing[data-wb-orb-motion] .wb-orb-core { animation:none !important; } }
`;
const PROFILES = ['sweep','counter','drift','cross','orbit'];
let lastProfile = '', activeProfile = '', wasProcessing = false, longRunTimer = 0;
function installStyle(){ if(document.getElementById(STYLE_ID)) return; const style=document.createElement('style'); style.id=STYLE_ID; style.textContent=CSS; document.head.appendChild(style); }
function chooseProfile(){ const candidates=PROFILES.filter(item=>item!==lastProfile); const profile=candidates[Math.floor(Math.random()*candidates.length)]||PROFILES[0]; lastProfile=profile; return profile; }
function clearLongRunTimer(){ if(!longRunTimer) return; clearTimeout(longRunTimer); longRunTimer=0; }
function scheduleLongRunShuffle(root){ clearLongRunTimer(); const delay=18000+Math.floor(Math.random()*11000); longRunTimer=window.setTimeout(()=>{ const orb=root.querySelector('.wb-world-orb'); if(!(orb instanceof HTMLElement)||!orb.classList.contains('is-processing')) return; activeProfile=chooseProfile(); orb.dataset.wbOrbMotion=activeProfile; scheduleLongRunShuffle(root); },delay); }
function syncOrb(root){ const orb=root.querySelector('.wb-world-orb'); if(!(orb instanceof HTMLElement)){ wasProcessing=false; activeProfile=''; clearLongRunTimer(); return; } const processing=orb.classList.contains('is-processing'); if(processing&&!wasProcessing){ activeProfile=chooseProfile(); scheduleLongRunShuffle(root); } if(processing){ if(!activeProfile) activeProfile=chooseProfile(); orb.dataset.wbOrbMotion=activeProfile; } else { orb.removeAttribute('data-wb-orb-motion'); activeProfile=''; clearLongRunTimer(); } wasProcessing=processing; }
function start(){ installStyle(); const attach=root=>{ let queued=false; syncOrb(root); const observer=new MutationObserver(()=>{ if(queued) return; queued=true; requestAnimationFrame(()=>{ queued=false; syncOrb(root); }); }); observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']}); window.addEventListener('pagehide',()=>{ clearLongRunTimer(); observer.disconnect(); },{once:true}); }; const root=document.getElementById('world-backstage-root'); if(root) return attach(root); const waiter=new MutationObserver(()=>{ const nextRoot=document.getElementById('world-backstage-root'); if(!nextRoot) return; waiter.disconnect(); attach(nextRoot); }); waiter.observe(document.documentElement,{childList:true,subtree:true}); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
