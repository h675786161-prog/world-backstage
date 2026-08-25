const STYLE_ID = 'wb-orb-organic-motion-v8';
const LEGACY_STYLE_IDS = [
    'wb-orb-motion-randomizer-test-v1',
    'wb-orb-living-world-v4',
    'wb-orb-organic-motion-v5',
    'wb-orb-organic-motion-v6',
    'wb-orb-organic-motion-v7',
];

const CSS = `
#world-backstage-root .wb-world-orb .wb-orb-ring.ring-one,
#world-backstage-root .wb-world-orb .wb-orb-ring.ring-two,
#world-backstage-root .wb-world-orb .wb-orb-halo,
#world-backstage-root .wb-world-orb .wb-orb-core {
    animation: none !important;
    transition: none !important;
    will-change: transform, opacity, filter;
}
#world-backstage-root .wb-world-orb .wb-orb-ring.ring-one,
#world-backstage-root .wb-world-orb .wb-orb-ring.ring-two {
    transform-origin: 50% 50%;
}
`;

const controllers = new WeakMap();
const random = (min, max) => min + Math.random() * (max - min);

function installStyle() {
    for (const id of LEGACY_STYLE_IDS) document.getElementById(id)?.remove();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function removeLegacyGlobe(orb) {
    orb.querySelectorAll('.wb-orb-globe').forEach(node => node.remove());
}

function reducedMotion() {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function stop(orb) {
    const controller = controllers.get(orb);
    if (!controller) return;
    controller.stopped = true;
    if (controller.raf) cancelAnimationFrame(controller.raf);
    controllers.delete(orb);
}

function start(orb) {
    if (!(orb instanceof HTMLElement) || controllers.has(orb)) return;

    const ringOne = orb.querySelector('.wb-orb-ring.ring-one');
    const ringTwo = orb.querySelector('.wb-orb-ring.ring-two');
    const halo = orb.querySelector('.wb-orb-halo');
    const core = orb.querySelector('.wb-orb-core');
    if (!(ringOne instanceof HTMLElement) || !(ringTwo instanceof HTMLElement)) return;

    const controller = {
        stopped: false,
        raf: 0,
        last: performance.now(),
        elapsed: random(0, 60),
        ringOneAngle: random(10, 40),
        ringTwoAngle: random(55, 105),
        phaseA: random(0, Math.PI * 2),
        phaseB: random(0, Math.PI * 2),
        phaseC: random(0, Math.PI * 2),
        phaseD: random(0, Math.PI * 2),
        speedOne: random(2.7, 3.5),
        speedTwo: random(1.7, 2.4),
    };
    controllers.set(orb, controller);

    const frame = now => {
        if (controller.stopped || !orb.isConnected) {
            stop(orb);
            return;
        }

        const deltaSeconds = Math.min(0.05, Math.max(0, (now - controller.last) / 1000));
        controller.last = now;
        controller.elapsed += deltaSeconds;
        const t = controller.elapsed;

        if (!reducedMotion()) {
            // Continuous rotation with slowly drifting speed. Two incommensurate
            // waves prevent a short, obvious loop while keeping movement smooth.
            const driftOne = 1
                + Math.sin(t / 7.7 + controller.phaseA) * 0.24
                + Math.sin(t / 19.3 + controller.phaseB) * 0.11;
            const driftTwo = 1
                + Math.sin(t / 9.9 + controller.phaseC) * 0.22
                + Math.sin(t / 23.7 + controller.phaseD) * 0.10;

            controller.ringOneAngle += controller.speedOne * driftOne * deltaSeconds;
            controller.ringTwoAngle -= controller.speedTwo * driftTwo * deltaSeconds;

            const ringOneScale = 1
                + Math.sin(t / 6.6 + controller.phaseB) * 0.010
                + Math.sin(t / 15.4 + controller.phaseC) * 0.004;
            const ringTwoScale = 1
                + Math.sin(t / 8.2 + controller.phaseD) * 0.009
                + Math.sin(t / 18.7 + controller.phaseA) * 0.004;

            ringOne.style.transform = `rotate(${controller.ringOneAngle.toFixed(3)}deg) scale(${ringOneScale.toFixed(4)})`;
            ringTwo.style.transform = `rotate(${controller.ringTwoAngle.toFixed(3)}deg) scale(${ringTwoScale.toFixed(4)})`;
            ringOne.style.opacity = (0.57 + Math.sin(t / 10.8 + controller.phaseA) * 0.08).toFixed(3);
            ringTwo.style.opacity = (0.53 + Math.sin(t / 13.1 + controller.phaseD) * 0.08).toFixed(3);

            if (halo instanceof HTMLElement) {
                const haloScale = 1
                    + Math.sin(t / 4.8 + controller.phaseA) * 0.025
                    + Math.sin(t / 11.9 + controller.phaseC) * 0.009;
                halo.style.transform = `scale(${haloScale.toFixed(4)})`;
                halo.style.opacity = (0.84 + Math.sin(t / 7.4 + controller.phaseB) * 0.10).toFixed(3);
            }

            if (core instanceof HTMLElement) {
                const coreScale = 1
                    + Math.sin(t / 3.9 + controller.phaseD) * 0.040
                    + Math.sin(t / 9.7 + controller.phaseB) * 0.012;
                const brightness = 1.02
                    + Math.sin(t / 5.3 + controller.phaseC) * 0.10
                    + Math.sin(t / 13.6 + controller.phaseA) * 0.04;
                core.style.transform = `scale(${coreScale.toFixed(4)})`;
                core.style.opacity = (0.88 + Math.sin(t / 6.1 + controller.phaseA) * 0.10).toFixed(3);
                core.style.filter = `brightness(${Math.max(0.88, brightness).toFixed(3)})`;
            }
        }

        controller.raf = requestAnimationFrame(frame);
    };

    controller.raf = requestAnimationFrame(frame);
}

function attach(root) {
    let currentOrb = null;

    const scan = () => {
        const nextOrb = root.querySelector('.wb-world-orb');
        if (!(nextOrb instanceof HTMLElement)) return;
        removeLegacyGlobe(nextOrb);
        if (nextOrb === currentOrb) return;
        if (currentOrb) stop(currentOrb);
        currentOrb = nextOrb;
        start(currentOrb);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });

    window.addEventListener('pagehide', () => {
        observer.disconnect();
        if (currentOrb) stop(currentOrb);
    }, { once: true });
}

function startAll() {
    installStyle();
    const root = document.getElementById('world-backstage-root');
    if (root) {
        attach(root);
        return;
    }

    const waiter = new MutationObserver(() => {
        const nextRoot = document.getElementById('world-backstage-root');
        if (!nextRoot) return;
        waiter.disconnect();
        attach(nextRoot);
    });
    waiter.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAll, { once: true });
else startAll();
