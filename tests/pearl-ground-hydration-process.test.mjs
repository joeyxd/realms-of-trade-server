import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('current ground and profile authority reconstruct from SQL008 images in six fresh Node processes', async (t) => {
  const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url)); await mkdir(scratch, { recursive: true });
  for (const mode of ['death','replace']) await t.test(mode, async () => {
    const path = await mkdtemp(join(scratch, `ground-hydration-${mode}-`));
    for (const phase of ['prepare','restore','verify']) {
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/pearl-ground-hydration-process.mjs', import.meta.url)),
        phase, path, mode], { encoding: 'utf8', timeout: 120000, windowsHide: true });
      assert.equal(run.status, 0, `${phase}: ${run.error?.code ?? ''} ${run.stderr || run.stdout}`);
      assert.deepEqual(JSON.parse(run.stdout.trim()), { phase, mode, passed: true });
    }
  });
});
