import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const smoke = path.join(root, 'tests', 'world-clock-real-sillytavern-smoke.mjs');
const result = spawnSync(process.execPath, [smoke], {
    stdio: 'inherit',
    env: {
        ...process.env,
        WB_TAVERN_URL: process.env.LAB_ST_URL,
        WB_PLAYWRIGHT_CORE_ENTRY: process.env.LAB_PLAYWRIGHT_CORE_ENTRY,
        WB_CHROMIUM_EXECUTABLE: process.env.LAB_CHROME,
        WB_CLOCK_EVIDENCE: path.join(process.env.LAB_EVIDENCE_DIR, 'world-clock-real'),
    },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`World-clock real SillyTavern smoke failed: ${result.status}`);
