import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('SQL007 receipts and all batch state survive four fresh Node processes without host/game replay', async (t) => {
  const scratch = fileURLToPath(new URL('../.scratch/',import.meta.url)); await mkdir(scratch,{ recursive:true });
  for (const mode of ['death','replace']) await t.test(mode,async () => {
    const path = await mkdtemp(join(scratch,`pearl-batch-${mode}-`));
    for (const phase of ['prepare','recover']) {
      const result = spawnSync(process.execPath,[fileURLToPath(new URL('./helpers/pearl-batch-process.mjs',import.meta.url)),phase,path,mode],
        { encoding:'utf8',timeout:45000,windowsHide:true });
      assert.equal(result.status,0,result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()),{ phase,mode,passed:true });
    }
  });
});
