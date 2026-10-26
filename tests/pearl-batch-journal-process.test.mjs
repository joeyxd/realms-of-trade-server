import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('batch intent and receipt recovery survives twelve fresh SDK/SQL008 Node processes', async (t) => {
  const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url)); await mkdir(scratch, { recursive: true });
  for (const mode of ['death','replace']) for (const committed of ['yes','no']) await t.test(`${mode}/committed=${committed}`, async () => {
    const path = await mkdtemp(join(scratch, `batch-journal-${mode}-${committed}-`));
    for (const phase of ['prepare','recover','verify']) {
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/pearl-batch-journal-process.mjs', import.meta.url)),
        phase, path, mode, committed], { encoding: 'utf8', timeout: 45000, windowsHide: true });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.deepEqual(JSON.parse(run.stdout.trim()), { phase, mode, committed, passed: true });
    }
  });
});
