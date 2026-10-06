import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './pearl-same-holder-sql.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { A, UID, op, seed, request } from './pearl-same-holder.mjs';

// Each phase runs in a fresh Node process against one isolated disk database. No host or env is read.
const [phase, path, committed] = process.argv.slice(2);
if (!['prepare', 'recover', 'verify'].includes(phase) || !path || !['yes', 'no'].includes(committed)) throw new Error('Invalid test phase');
if (phase === 'prepare') {
  const f = await database(path);
  try {
    const p = await seed(f.store, true), concrete = request(p);
    await f.journal.prepare('ground', concrete);
    if (committed === 'yes') assert.equal((await f.store.commitPearlGround(concrete)).ok, true);
    assert.equal((await f.journal.list()).length, 1);
  } finally { await f.close(); }
} else {
  const db = new PGlite(path);
  try {
    await db.exec('SET ROLE service_role;');
    const f = adapters(db), sessions = new ProfileSessions(f.store, null, { journal: f.journal });
    if (phase === 'recover') {
      assert.deepEqual(await sessions.recoverPearls(), [{ operationId: op(2), outcome: committed === 'yes' ? 'committed' : 'pending' }]);
      assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length, 0);
      if (committed === 'no') {
        assert.equal(sessions.pearls.accountIds.size, 1);
        await assert.rejects(sessions.open(8, A), { code: 'busy' });
        const raw = (await f.journal.list())[0];
        await sessions.resumePearlGround(op(2));
        const sends = f.calls.filter((c) => c.name === 'mn_commit_pearl_ground');
        assert.equal(sends.length, 1);
        assert.deepEqual(sends[0].body, { p_operation_id: raw.operationId, p_request: raw.request });
      }
      assert.equal((await sessions.open(8, A)).pearls.swallowed.uid, UID);
      assert.equal(sessions.pearls.accountIds.size, 0); await sessions.flush();
    } else {
      assert.deepEqual(await sessions.recoverPearls(), []);
      const p = await f.store.loadProfile(A), unique = await f.store.loadUnique(UID), location = await f.store.loadPearlLocation(UID);
      assert.equal(p.version, 3); assert.equal(p.data.gold, 27); assert.equal(p.data.pearls.swallowed.uid, UID);
      assert.equal(unique.version, 2); assert.equal(location.version, 2); assert.equal(location.ground, null);
      assert.deepEqual(await f.journal.list(), []);
      assert.equal((await db.query('select state from public.mn_pearl_intents where operation_id=$1::uuid', [op(2)])).rows[0].state, 'committed');
      assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_ground').length, 0);
    }
  } finally { await db.close(); }
}
process.stdout.write(JSON.stringify({ phase, committed, ok: true }));
