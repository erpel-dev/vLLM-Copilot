// Export the parity fixtures consumed by unifiedmixers/gateway's
// argument and request/stream differentials. Runs the vitest generator with the export flag
// programmatically, because cmd.exe cannot set env vars inline (CR-67).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', 'test/parityFixtures.test.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PARITY_EXPORT: '1' },
  },
);
process.exit(result.status ?? 1);
