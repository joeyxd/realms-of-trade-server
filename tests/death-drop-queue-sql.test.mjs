import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/death-drop-journal-sql.mjs';
import { deathDropQueueContract } from './helpers/death-drop-queue-contract.mjs';
import { seedDeathDropScenario, pickupRequest, WORLD } from './helpers/death-drop-storage.mjs';

async function sqlSetup() {
  const sql = await database();
  return { ...sql, journal: sql.journal(WORLD) };
}

test('death-drop queue SQL contract', (t) => deathDropQueueContract(t, sqlSetup));

test('012 service journal stores exact drop intents and blocks cross-family operation reuse', async () => {
  const sql = await database();
  try {
    const source = await seedDeathDropScenario(sql.store, { sourceOperation: 740 });
    const raw = await pickupRequest(sql.store, source, { operation: 1040 });
    const clientJournal = sql.journal(WORLD);
    const prepared = await clientJournal.prepare('drop', raw);
    assert.equal(prepared.family, 'drop'); assert.equal(prepared.state, 'pending');
    assert.deepEqual(prepared.request, (({ operationId: _id, ...request }) => request)(raw));
    assert.deepEqual(await sql.journal(WORLD).list(), [prepared], 'a reconstructed client reads the exact pending intent');
    const receiver = await sql.store.loadProfile(raw.profile.id), data = structuredClone(receiver.data);
    data.pearls.bag.push({ uid: 'sql-drop-collision', kind: 'brasa' });
    await assert.rejects(clientJournal.prepare('pearl', { operationId: raw.operationId, uid: 'sql-drop-collision', kind: 'brasa',
      from: null, to: raw.profile.id, expectedVersion: 0,
      profiles: [{ id: raw.profile.id, expectedVersion: receiver.version, data }] }), { code: 'operation' });
    assert.equal((await sql.db.query("select has_function_privilege('anon','public.mn_prepare_pearl_intent(text,text,uuid,jsonb)','EXECUTE') as allowed")).rows[0].allowed, false);
    assert.equal((await sql.db.query("select has_function_privilege('authenticated','public.mn_list_pearl_intents(text,uuid,integer)','EXECUTE') as allowed")).rows[0].allowed, false);
    assert.equal((await sql.db.query("select has_function_privilege('service_role','public.mn_prepare_pearl_intent(text,text,uuid,jsonb)','EXECUTE') as allowed")).rows[0].allowed, true);
  } finally { await sql.close(); }
});
