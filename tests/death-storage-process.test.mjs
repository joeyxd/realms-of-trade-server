import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deathResult } from '../server/deathOperation.mjs';

test('whole-death receipt, both profiles and exact ordinary/pearl ground survive three fresh Node processes', async () => {
  const location = path.join(await mkdtemp(path.join(tmpdir(), 'mn-death-storage-')), 'postgres');
  const runner = fileURLToPath(new URL('./helpers/death-storage-process.mjs', import.meta.url));
  const invoke = (mode, request = null) => {
    const result = spawnSync(process.execPath, [runner, mode, location], { encoding: 'utf8',
      input: request === null ? undefined : JSON.stringify(request), windowsHide: true, timeout: 60000 });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const { request, lost } = invoke('commit'); assert.equal(lost, 'unavailable');
  const expected = deathResult(request, request.operationId), read = invoke('read', request);
  const { operationId: _id, ...payload } = request;
  assert.deepEqual(read.receipt, { request: payload, result: expected });
  assert.equal(read.dispatchesBefore, 0); assert.equal(read.unchanged, true);
  assert.deepEqual(read.drops, expected.drops);
  assert.deepEqual(read.uniques, expected.uniques.map(({ uid, ...row }) => row));
  assert.deepEqual(read.locations, expected.locations.map(({ uid, ...row }) => row));
  for (let i = 0; i < request.profiles.length; i++) assert.deepEqual(read.profiles[i], {
    data: request.profiles[i].data, version: request.profiles[i].expectedVersion + 1 });
  const retried = invoke('replay', request);
  assert.deepEqual(retried.replay, { ...expected, replay: true }); assert.equal(retried.unchanged, true);
  assert.deepEqual(retried.profiles, read.profiles); assert.deepEqual(retried.drops, read.drops);
});
