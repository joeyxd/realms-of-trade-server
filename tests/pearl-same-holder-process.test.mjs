import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./helpers/pearl-same-holder-process.mjs', import.meta.url));
for (const committed of ['yes', 'no']) test(`fresh-process same-holder ${committed === 'yes' ? 'committed receipt recovers read-only' : 'unsent request resumes once'} survives SQL restart`, async () => {
  const tempRoot = resolve(tmpdir()), dir = await mkdtemp(join(tempRoot, 'mn-same-holder-'));
  try {
    for (const phase of ['prepare', 'recover', 'verify']) {
      const run = spawnSync(process.execPath, [script, phase, dir, committed], { encoding: 'utf8', timeout: 30000 });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assert.deepEqual(JSON.parse(run.stdout), { phase, committed, ok: true });
    }
  } finally {
    if (dirname(resolve(dir)) !== tempRoot || !basename(dir).startsWith('mn-same-holder-')) throw new Error('Unexpected cleanup target');
    await rm(dir, { recursive: true, force: true });
  }
});
