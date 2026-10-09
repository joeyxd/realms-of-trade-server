import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pending asset intent and receipt resume across three fresh Node processes', async () => {
  const location = path.join(await mkdtemp(path.join(tmpdir(), 'mn-web3-registry-')), 'postgres');
  const runner = fileURLToPath(new URL('./helpers/web3-asset-registry-process.mjs', import.meta.url));
  const invoke = (mode) => {
    const result = spawnSync(process.execPath, [runner, mode, location], {
      encoding: 'utf8', windowsHide: true, timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout.trim());
  };
  const prepared = invoke('prepare');
  assert.equal(prepared.lost, 'unavailable');
  assert.equal(prepared.request.operationId, '00000000-0000-4000-8000-000000000384');
  const resumed = invoke('resume');
  assert.equal(resumed.state, 'pending');
  assert.equal(resumed.committed.asset.assetId, prepared.request.assetId);
  assert.equal(resumed.committed.asset.ownerId, prepared.request.to);
  assert.equal(resumed.committed.asset.version, 1);
  const recovered = invoke('read');
  assert.equal(recovered.operation.state, 'committed');
  assert.deepEqual(recovered.asset, resumed.committed.asset);
  assert.deepEqual(recovered.replay, { ok: true, replay: true, asset: resumed.committed.asset });
});
