import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './pearl-batch-journal-sql.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { StoreError } from '../../server/store.mjs';
import { batchOperation, batchResult } from '../../server/pearlBatch.mjs';
import { seed, request, state, A } from './pearl-batch.mjs';
import { intent } from './pearl-batch-queue-contract.mjs';

const [phase, path, mode, committed] = process.argv.slice(2);
assert.ok(['prepare','recover','verify'].includes(phase));
assert.ok(['death','replace'].includes(mode)); assert.ok(['yes','no'].includes(committed));
let f;
try {
  if (phase === 'prepare') {
    f = await database(join(path, 'db'));
    const p = await seed(f.store), raw = request(p, mode), expected = batchResult(batchOperation(raw).request);
    if (committed === 'yes') {
      let builds = 0;
      const store = { ...f.store, async commitPearlBatch(r) { await f.store.commitPearlBatch(r); throw new StoreError('unavailable'); },
        async loadPearlBatchOperation() { throw new StoreError('unavailable'); } };
      const sessions = new ProfileSessions(store, null, { journal: f.journal });
      await sessions.recoverPearls(); await sessions.open(1, A);
      await assert.rejects(sessions.commitPearlBatch(intent(raw), (rows) => {
        builds++; return [{ id: A, data: request(rows[0], mode).profile.data }];
      }), { code: 'unavailable' });
      assert.equal(builds, 1); assert.equal(sessions.pearls.uids.size, raw.items.length);
      assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length, 2);
    } else await f.journal.prepare('batch', raw);
    assert.equal((await f.journal.list()).length, 1);
    await writeFile(join(path, 'request.json'), JSON.stringify({ raw, expected, initial: await state(f.store) }), { flag: 'wx' });
  } else {
    const db = new PGlite(join(path, 'db')); await db.exec('SET ROLE service_role');
    f = { db, ...adapters(db), close: () => db.close() };
    const { raw, expected, initial } = JSON.parse(await readFile(join(path, 'request.json'), 'utf8'));
    if (phase === 'recover') {
      assert.deepEqual(await state(f.store), initial);
      const sessions = new ProfileSessions(f.store, null, { journal: f.journal });
      assert.deepEqual(await sessions.recoverPearls(), [{ operationId: raw.operationId,
        outcome: committed === 'yes' ? 'committed' : 'pending' }]);
      assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length, 0);
      if (committed === 'no') {
        assert.equal(sessions.pearls.uids.size, raw.items.length);
        await assert.rejects(sessions.open(2, A), { code: 'busy' });
        const result = await sessions.resumePearlBatch(raw.operationId);
        assert.deepEqual(result.receipt, expected); assert.deepEqual(result.profiles, [{ id: A, data: raw.profile.data }]);
        const sends = f.calls.filter((c) => c.name === 'mn_commit_pearl_batch');
        assert.equal(sends.length, 1); assert.deepEqual(sends[0].body.p_request, batchOperation(raw).request);
        await assert.rejects(sessions.resumePearlBatch(raw.operationId), { code: 'operation' });
      }
      await sessions.flush(); assert.equal(sessions.pearls.uids.size, 0);
      const row = await f.store.loadProfile(A); row.data.xp += 17;
      assert.equal((await f.store.saveProfile(A, row.data, row.version)).ok, true);
      await writeFile(join(path, 'advanced.json'), JSON.stringify(await state(f.store)), { flag: 'wx' });
    } else {
      const advanced = JSON.parse(await readFile(join(path, 'advanced.json'), 'utf8'));
      const sessions = new ProfileSessions(f.store, null, { journal: f.journal });
      assert.deepEqual(await sessions.recoverPearls(), []); await sessions.flush();
      assert.deepEqual(await state(f.store), advanced);
      assert.deepEqual(await f.store.loadPearlBatchOperation(raw.operationId), { request: batchOperation(raw).request, result: expected });
      assert.equal((await f.journal.prepare('batch', raw)).state, 'committed');
      assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length, 0);
      assert.deepEqual(await f.store.commitPearlBatch(raw), { ...expected, replay: true });
      assert.deepEqual(await state(f.store), advanced);
    }
  }
  process.stdout.write(JSON.stringify({ phase, mode, committed, passed: true }) + '\n');
} finally { await f?.close(); }
