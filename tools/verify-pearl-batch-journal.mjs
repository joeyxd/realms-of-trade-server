// Opt-in SQL008/ProfileSessions canary. Generated fixtures only; failures retain recovery state.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore, StoreError } from '../server/store.mjs';
import { createSupabasePearlJournal, journalEntry } from '../server/pearlJournal.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { pearlMutationGate } from '../server/pearlMutationGate.mjs';
import { batchIntent, batchOperation, batchResult } from '../server/pearlBatch.mjs';
import { pearlOperation, pearlResult } from '../server/pearlOperations.mjs';
import { groundOperation, groundResult } from '../server/pearlGround.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

const script = fileURLToPath(import.meta.url);
export const journalPhases = ['prepare', 'recover', 'verify', 'cleanup'];
const names = [...Array.from({ length: 6 }, (_, i) => `seed${i}`), 'death', 'replace', 'pickup', 'collision'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const by = (key) => (a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
const ground = (i) => ({ x: i + 0.5, z: -i - 1, availableAt: 30, returnAt: 5400 });
const meta = (r) => batchIntent({ operationId: r.operationId, actor: r.profile.id,
  world: r.world, mode: r.mode, items: r.items });
const result = (r) => batchResult(batchOperation(r).request);
const intentRow = (f, family, raw, state) => {
  const e = journalEntry(f.scope, family, raw, state);
  return { operation_id: e.operationId, scope: e.scope, family: e.family, request: e.request, state: e.state };
};

export function journalFixture(ids) {
  assert.deepEqual(Object.keys(ids), ['token', 'accounts', 'operations']);
  assert.match(ids.token, uuid); assert.equal(ids.accounts.length, 2);
  assert.deepEqual(Object.keys(ids.operations), names);
  const all = [ids.token, ...ids.accounts, ...Object.values(ids.operations)];
  all.forEach((id) => assert.match(id, uuid)); assert.equal(new Set(all).size, all.length);
  const scope = `canary-j8-${ids.token}`, kinds = ['brasa','escarcha','tormenta','tinta'];
  const pearls = Array.from({ length: 6 }, (_, i) => ({ uid: `cj-${i}-${ids.token}`, kind: kinds[i % 4] }));
  const data = ids.accounts.map((id, i) => {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 37 + i; p.xp = 21 + i;
    p.mast[0] = [3, 123]; p.stats.kills = 17; return p;
  });
  const granted = structuredClone(data), grants = pearls.map((q, i) => {
    const a = i < 3 ? 0 : 1; granted[a].pearls.bag.push(q);
    const r = { operationId: ids.operations[`seed${i}`], ...q, from: null, to: ids.accounts[a], expectedVersion: 0,
      profiles: [{ id: ids.accounts[a], expectedVersion: i % 3 + 1, data: structuredClone(granted[a]) }] };
    return a === 0 ? { ...r, world: scope, ground: null } : r;
  });
  const before = structuredClone(granted);
  for (const p of before) { p.pearls.swallowed = p.pearls.bag.pop(); p.pearls.bag.reverse(); }
  const after = structuredClone(before);
  after[0].pearls = { bag: [], swallowed: null };
  after[1].pearls.bag = after[1].pearls.bag.filter((q) => q.uid !== pearls[3].uid);
  after[1].pearls.swallowed = pearls[3];
  const batches = ['death','replace'].map((mode, a) => ({ operationId: ids.operations[mode], world: scope, mode,
    profile: { id: ids.accounts[a], expectedVersion: 5, data: after[a] },
    items: pearls.filter((_, i) => a === 0 ? i < 3 : i === 3 || i === 5).map((q, i) => ({ ...q,
      expectedVersion: 1, ground: a === 1 && q.uid === pearls[3].uid ? null : ground(i) })) }));
  batches.forEach(batchOperation);
  const picked = structuredClone(after[1]); picked.pearls.bag.push(pearls[0]);
  const pickup = { operationId: ids.operations.pickup, ...pearls[0], from: null, to: ids.accounts[1],
    expectedVersion: 2, world: scope, ground: null, profiles: [{ id: ids.accounts[1], expectedVersion: 6, data: picked }] };
  const dropped = structuredClone(before[1]); dropped.pearls.bag = dropped.pearls.bag.filter((q) => q.uid !== pearls[4].uid);
  const collision = { operationId: ids.operations.collision, ...pearls[4], from: ids.accounts[1], to: null,
    expectedVersion: 1, world: scope, ground: ground(4), profiles: [{ id: ids.accounts[1], expectedVersion: 5, data: dropped }] };
  data.concat(before, after, picked).forEach((p) => assert.deepEqual(sanitizeProfile(p), p));
  return { ids, scope, pearls, data, grants, before, after, batches, pickup, collision };
}
export function newJournalManifest() {
  return { ids: { token: randomUUID(), accounts: [randomUUID(), randomUUID()],
    operations: Object.fromEntries(names.map((n) => [n, randomUUID()])) }, since: null, cleanup: null };
}
export function checkedJournalManifest(m, phase, file = null) {
  assert.deepEqual(Object.keys(m), ['ids','since','cleanup']);
  assert.ok([...journalPhases, 'cleanup-partial'].includes(phase));
  const f = journalFixture(m.ids);
  if (file !== null) {
    assert.equal(path.dirname(path.resolve(file)), path.resolve('.scratch'));
    assert.equal(path.basename(file), `m5-j8-live-${f.ids.token}.json`);
  }
  if (phase === 'prepare' || phase === 'cleanup-partial') assert.equal(m.since, null);
  else { assert.equal(m.since.length, 6); m.since.forEach((s) => assert.ok(typeof s === 'string' && s.length < 50)); }
  if (!phase.startsWith('cleanup')) assert.equal(m.cleanup, null);
  else if (m.cleanup !== null) checkedPlan(m.cleanup, f, m, phase === 'cleanup-partial');
  return f;
}

// Derive every allowed cleanup row from the generated fixture, never from caller-supplied IDs/data.
function models(f) {
  const s = { profiles: [null,null], uniques: [], locations: [], receipts: [[],[],[]], intents: [] }, partial = [];
  const capture = () => {
    s.uniques.sort(by('uid')); s.locations.sort(by('uid')); s.receipts.forEach((r) => r.sort(by('operation_id')));
    s.intents.sort(by('operation_id')); partial.push(structuredClone(s));
  };
  const apply = (raw, family) => {
    const request = (family === 'batch' ? batchOperation : family === 'ground' ? groundOperation : pearlOperation)(raw).request;
    const reply = (family === 'batch' ? batchResult : family === 'ground' ? groundResult : pearlResult)(request);
    for (const p of family === 'batch' ? [request.profile] : request.profiles)
      s.profiles[f.ids.accounts.indexOf(p.id)] = { data: structuredClone(p.data), version: p.expectedVersion + 1 };
    const items = family === 'batch' ? request.items : [{ uid: request.uid, kind: request.kind,
      expectedVersion: request.expectedVersion, ground: family === 'ground' ? request.ground : null }];
    for (const q of items) {
      const unique = { uid: q.uid, kind: `pearl:${q.kind}`, holder: family === 'batch' ?
        q.ground === null ? request.profile.id : null : request.to, version: q.expectedVersion + 1 };
      const at = s.uniques.findIndex((p) => p.uid === q.uid);
      if (at < 0) s.uniques.push(unique); else s.uniques[at] = unique;
      if (family !== 'pearl') {
        const loc = { uid: q.uid, world: request.world, ground: q.ground, version: q.expectedVersion + 1 };
        const k = s.locations.findIndex((p) => p.uid === q.uid);
        if (k < 0) s.locations.push(loc); else s.locations[k] = loc;
      }
    }
    s.receipts[family === 'batch' ? 2 : family === 'ground' ? 1 : 0].push({ operation_id: raw.operationId, request, result: reply });
    if (family === 'ground') {
      const { world: _w, ground: _g, ...child } = request;
      s.receipts[0].push({ operation_id: raw.operationId, request: child, result: pearlResult(child) });
    }
    capture();
  };
  capture();
  for (let a = 0; a < 2; a++) { s.profiles[a] = { data: f.data[a], version: 1 }; capture(); }
  f.grants.forEach((r, i) => apply(r, i < 3 ? 'ground' : 'pearl'));
  for (let a = 0; a < 2; a++) { s.profiles[a] = { data: f.before[a], version: 5 }; capture(); }
  const seeding = structuredClone(partial);
  f.batches.forEach((r) => apply(r, 'batch'));
  s.profiles[0].data.xp += 17; s.profiles[0].version++;
  apply(f.pickup, 'ground');
  s.intents = [...f.batches.map((r) => intentRow(f, 'batch', r, 'committed')), intentRow(f, 'ground', f.collision, 'rejected')];
  capture();
  return { partial: seeding, full: structuredClone(s) };
}
function checkedPlan(plan, f, manifest, partial) {
  assert.deepEqual(Object.keys(plan), ['profiles','uniques','locations','receipts','intents']);
  const stripped = { ...plan, uniques: plan.uniques.map(({ since: _s, ...q }) => q) }, allowed = models(f);
  const matches = (wanted) => { try { assert.deepEqual(stripped, wanted); return true; } catch { return false; } };
  assert.ok(partial ? allowed.partial.some(matches) : matches(allowed.full), 'Cleanup requires exact generated state');
  for (const q of plan.uniques) {
    if (q.holder === null) assert.equal(q.since, null);
    else {
      assert.ok(typeof q.since === 'string' && q.since.length < 50);
      if (!partial && q.uid !== f.pearls[0].uid) assert.equal(q.since, manifest.since[f.pearls.findIndex((p) => p.uid === q.uid)]);
    }
  }
}

export async function verifyJournalPhase(phase, manifest, { admin, store, journal, publicClient, persist,
  record, begin = () => {} }) {
  const f = checkedJournalManifest(manifest, phase), ids = f.ids, uids = f.pearls.map((p) => p.uid);
  const operationIds = Object.values(ids.operations), tables = ['mn_pearl_operations','mn_pearl_ground_operations','mn_pearl_batch_operations'];
  const rows = async (table, columns, key, values) => {
    const r = await admin.from(table).select(columns).in(key, values).order(key);
    assert.equal(r.error, null, 'Fixture read failed'); return r.data;
  };
  const snapshot = async () => ({ profiles: await Promise.all(ids.accounts.map((id) => store.loadProfile(id))),
    uniques: await rows('mn_unique_items','uid,kind,holder,version,since','uid',uids),
    locations: await rows('mn_pearl_locations','uid,world,ground,version','uid',uids),
    receipts: await Promise.all(tables.map((t) => rows(t,'operation_id,request,result','operation_id',operationIds))),
    intents: await rows('mn_pearl_intents','operation_id,scope,family,request,state','operation_id',operationIds) });
  const check = async (label, work) => { begin(label); await work(); record(label); };
  const assertState = async (settled = false, advanced = false) => {
    for (let a = 0; a < 2; a++) {
      const data = structuredClone(a === 0 && !settled ? f.before[a] : f.after[a]);
      if (advanced && a === 0) data.xp += 17;
      if (advanced && a === 1) data.pearls.bag.push(f.pearls[0]);
      assert.deepEqual(await store.loadProfile(ids.accounts[a]), { data, version: a === 0 && !settled ? 5 : advanced ? 7 : 6 });
    }
    for (let i = 0; i < 6; i++) {
      const q = f.pearls[i], item = f.batches.flatMap((r) => r.items).find((p) => p.uid === q.uid);
      const active = i >= 3 || settled, picked = advanced && i === 0;
      const holder = picked ? ids.accounts[1] : active && item?.ground ? null : ids.accounts[i < 3 ? 0 : 1];
      const version = picked ? 3 : active && item ? 2 : 1;
      assert.deepEqual(await store.loadUnique(q.uid), { kind: `pearl:${q.kind}`, holder, version });
      assert.deepEqual(await store.loadPearlLocation(q.uid), active && item ?
        { world: f.scope, ground: picked ? null : item.ground, version } : i < 3 ? { world: f.scope, ground: null, version: 1 } : null);
    }
    const since = await rows('mn_unique_items','uid,since','uid',uids);
    for (let i = 0; i < 6; i++) {
      const q = since[i]; if (advanced && i === 0) assert.ok(typeof q.since === 'string');
      else assert.equal(q.since, (i === 5 || settled && i < 3) ? null : manifest.since[i]);
    }
    for (let a = 0; a < 2; a++) assert.deepEqual(await store.loadPearlBatchOperation(f.batches[a].operationId),
      a === 0 && !settled ? null : { request: batchOperation(f.batches[a]).request, result: result(f.batches[a]) });
  };
  if (phase === 'prepare') {
    await check('exact-generated-fixtures-absent', async () => {
      for (const [t,k,values] of [['mn_profiles','player_id',ids.accounts],['mn_unique_items','uid',uids],
        ['mn_pearl_locations','uid',uids], ...tables.concat('mn_pearl_intents').map((t) => [t,'operation_id',operationIds])])
        assert.deepEqual(await rows(t,k,k,values), []);
      assert.deepEqual(await journal.list(), []); assert.deepEqual(await store.listPearlGround(f.scope), []);
    });
    await check('two-synthetic-profiles-six-UIDs-tracked-and-legacy-seeded', async () => {
      for (let a = 0; a < 2; a++) assert.equal((await store.initializeProfile(ids.accounts[a], f.data[a])).version, 1);
      for (let i = 0; i < 6; i++) assert.equal((await store[i < 3 ? 'commitPearlGround' : 'commitPearl'](f.grants[i])).ok, true);
      for (let a = 0; a < 2; a++) assert.deepEqual(await store.saveProfile(ids.accounts[a], f.before[a], 4), { ok: true, version: 5 });
      manifest.since = (await rows('mn_unique_items','uid,since','uid',uids)).map((p) => p.since); await persist(manifest);
    });
    await check('batch-intent-blocks-003-004-and-changed-request-or-scope', async () => {
      await journal.prepare('batch', f.batches[0]); const before = await snapshot();
      const single = { ...f.collision, operationId: ids.operations.death };
      const { world: _w, ground: _g, ...legacy } = single;
      assert.deepEqual(await store.commitPearl(legacy), { ok: false, why: 'operation' });
      assert.deepEqual(await store.commitPearlGround(single), { ok: false, why: 'operation' });
      const changed = structuredClone(f.batches[0]); changed.items[0].ground.x++;
      await assert.rejects(journal.prepare('batch', changed), { code: 'operation' });
      assert.deepEqual(await store.commitPearlBatch(changed), { ok: false, why: 'operation' });
      const wrong = await admin.rpc('mn_prepare_pearl_intent', { p_scope: `${f.scope}-other`, p_family: 'batch',
        p_operation_id: ids.operations.death, p_request: batchOperation(f.batches[0]).request });
      assert.equal(wrong.error?.code, 'MNP02'); assert.deepEqual(await snapshot(), before);
    });
    await check('003-004-receipts-and-ground-intent-exclude-batch-family', async () => {
      for (const i of [0,3]) await assert.rejects(journal.prepare('batch', { ...f.batches[1],
        operationId: f.grants[i].operationId }), { code: 'operation' });
      await journal.prepare('ground', f.collision);
      assert.deepEqual(await store.commitPearlBatch({ ...f.batches[1], operationId: ids.operations.collision }), { ok: false, why: 'operation' });
      assert.equal((await journal.resolve('ground', f.collision, 'rejected')).state, 'rejected');
    });
    await check('real-session-queue-one-builder-two-exact-sends-discarded-commit-replies', async () => {
      let builds = 0, sends = 0;
      const lost = { ...store, async commitPearlBatch(raw) {
        sends++; assert.deepEqual(raw, f.batches[1]);
        assert.deepEqual(await store.commitPearlBatch(raw), { ...result(raw), replay: sends > 1 });
        throw new StoreError('unavailable');
      }, async loadPearlBatchOperation() { throw new StoreError('unavailable'); } };
      const sessions = new ProfileSessions(lost, null, { journal });
      await sessions.recoverPearls(); await sessions.open(1, ids.accounts[1]);
      await assert.rejects(sessions.commitPearlBatch(meta(f.batches[1]), (current) => {
        builds++; assert.deepEqual(current, [{ id: ids.accounts[1], data: f.before[1], version: 5 }]);
        return [{ id: ids.accounts[1], data: f.after[1] }];
      }), { code: 'unavailable' });
      assert.equal(builds, 1); assert.equal(sends, 2);
      for (const item of f.batches.flatMap((r) => r.items))
        assert.throws(() => pearlMutationGate(sessions).assertAvailable({ uids: [item.uid] }), { code: 'busy' });
      assert.equal(sessions.pearls.uids.size, 5); assert.equal(sessions.pearls.accountIds.size, 2);
      assert.equal((await journal.list()).length, 2); await assertState();
    });
  } else if (phase === 'recover') {
    let sends = 0;
    const counted = { ...store, async commitPearlBatch(raw) { sends++; assert.deepEqual(raw, f.batches[0]); return store.commitPearlBatch(raw); } };
    const sessions = new ProfileSessions(counted, null, { journal });
    await check('fresh-process-read-only-startup-settles-receipt-keeps-unsent-lanes', async () => {
      const before = await snapshot(), recovered = await sessions.recoverPearls();
      assert.deepEqual(recovered.sort(by('operationId')), f.batches.map((r, a) => ({ operationId: r.operationId,
        outcome: a === 0 ? 'pending' : 'committed' })).sort(by('operationId')));
      assert.equal(sends, 0); await assertState();
      const now = await snapshot(); assert.deepEqual({ ...now, intents: before.intents }, before);
      assert.equal(sessions.pearls.uids.size, 3); assert.equal(sessions.pearls.accountIds.size, 1);
      for (const q of f.batches[0].items) assert.throws(() => pearlMutationGate(sessions).assertAvailable({ uids: [q.uid] }), { code: 'busy' });
      await assert.rejects(sessions.open(2, ids.accounts[0]), { code: 'busy' });
      assert.deepEqual((await journal.list()).map((q) => q.operationId), [ids.operations.death]);
    });
    await check('explicit-resume-sends-one-frozen-death-request-and-settles-all-UIDs', async () => {
      const resumed = await sessions.resumePearlBatch(ids.operations.death);
      assert.deepEqual(resumed.receipt, result(f.batches[0]));
      assert.deepEqual(resumed.profiles, [{ id: ids.accounts[0], data: f.after[0] }]);
      assert.equal(sends, 1); assert.equal(sessions.pearls.uids.size, 0);
      assert.equal(sessions.pearls.accountIds.size, 0); await sessions.flush(); await assertState(true);
      await assert.rejects(sessions.resumePearlBatch(ids.operations.death), { code: 'operation' });
      assert.equal(sends, 1); assert.deepEqual(await journal.list(), []);
    });
    await check('terminal-exact-identities-return-committed-and-reject-changes', async () => {
      const before = await snapshot();
      for (const raw of f.batches) {
        assert.equal((await journal.prepare('batch', raw)).state, 'committed');
        const changed = structuredClone(raw); changed.items.at(-1).ground.x++;
        await assert.rejects(journal.prepare('batch', changed), { code: 'operation' });
        assert.deepEqual(await store.commitPearlBatch(changed), { ok: false, why: 'operation' });
      }
      assert.deepEqual(await snapshot(), before);
    });
  } else if (phase === 'verify') {
    await check('third-process-terminal-startup-read-only-and-empty', async () => {
      const before = await snapshot();
      const sessions = new ProfileSessions({ ...store, async commitPearlBatch() { assert.fail('Historical dispatch'); } }, null, { journal });
      assert.deepEqual(await sessions.recoverPearls(), []); await sessions.flush();
      assert.deepEqual(await snapshot(), before); await assertState(true);
    });
    await check('ordinary-progress-save-and-ground-pickup-survive-historical-batch-replays', async () => {
      const sessions = new ProfileSessions(store, null, { journal }); await sessions.recoverPearls();
      const p = await sessions.open(3, ids.accounts[0]); p.xp += 17; sessions.save(3, p); await sessions.flush(); sessions.close(3);
      assert.equal((await store.commitPearlGround(f.pickup)).ok, true);
      const before = await snapshot();
      for (const raw of f.batches) assert.deepEqual(await store.commitPearlBatch(raw), { ...result(raw), replay: true });
      assert.deepEqual(await snapshot(), before); await assertState(true, true);
    });
    for (const [label, call] of [
      ['public-journal-prepare-denied', () => publicClient.rpc('mn_prepare_pearl_intent', { p_scope: f.scope, p_family: 'batch',
        p_operation_id: ids.operations.death, p_request: batchOperation(f.batches[0]).request })],
      ['public-journal-resolve-denied', () => publicClient.rpc('mn_resolve_pearl_intent', { p_scope: f.scope, p_family: 'batch',
        p_operation_id: ids.operations.death, p_request: batchOperation(f.batches[0]).request, p_state: 'committed' })],
      ['public-journal-list-denied', () => publicClient.rpc('mn_list_pearl_intents', { p_scope: f.scope, p_after_id: null, p_limit: 64 })],
      ['public-intent-validator-denied', () => publicClient.rpc('mn_valid_pearl_intent', { p_scope: f.scope, p_family: 'batch',
        p_request: batchOperation(f.batches[0]).request })],
      ['public-journal-table-denied', () => publicClient.from('mn_pearl_intents').select('operation_id').in('operation_id',operationIds)],
    ]) await check(label, async () => { const before = await snapshot(); assert.equal((await call()).error?.code, '42501'); assert.deepEqual(await snapshot(), before); });
  } else {
    const partial = phase === 'cleanup-partial';
    await check('freeze-exact-generated-cleanup-plan-before-any-delete', async () => {
      if (manifest.cleanup !== null) return;
      if (!partial) { await assertState(true, true); assert.deepEqual(await journal.list(), []); }
      const plan = await snapshot(); checkedPlan(plan, f, manifest, partial); manifest.cleanup = plan; await persist(manifest);
    });
    await check('conditional-cleanup-preserves-drift-and-resumes-confirmed-absences', async () => {
      const plan = manifest.cleanup, now = await snapshot();
      for (let a = 0; a < 2; a++) if (now.profiles[a] !== null) assert.deepEqual(now.profiles[a], plan.profiles[a]);
      const subset = (current, wanted, key) => current.forEach((q) => assert.deepEqual(q, wanted.find((p) => p[key] === q[key]), 'Changed fixture is never deleted'));
      subset(now.uniques,plan.uniques,'uid'); subset(now.locations,plan.locations,'uid');
      now.receipts.forEach((r, i) => subset(r,plan.receipts[i],'operation_id')); assert.deepEqual(now.intents,plan.intents);
      const remove = async (table, key, row) => {
        let query = admin.from(table).delete();
        for (const [column, value] of Object.entries(row)) query = value === null ? query.is(column,null) :
          query.eq(column, typeof value === 'object' ? JSON.stringify(value) : value);
        assert.equal((await query).error, null, 'Conditional cleanup failed'); assert.deepEqual(await rows(table,key,key,[row[key]]), []);
      };
      for (const i of [2,1,0]) for (const row of plan.receipts[i]) await remove(tables[i],'operation_id',row);
      for (const row of plan.uniques) await remove('mn_unique_items','uid',row);
      for (let a = 0; a < 2; a++) if (plan.profiles[a]) await remove('mn_profiles','player_id',{ player_id: ids.accounts[a], ...plan.profiles[a] });
      for (const [t,k,values] of [['mn_profiles','player_id',ids.accounts],['mn_unique_items','uid',uids],
        ['mn_pearl_locations','uid',uids], ...tables.map((t) => [t,'operation_id',operationIds])]) assert.deepEqual(await rows(t,k,k,values), []);
      assert.deepEqual(await rows('mn_pearl_intents','operation_id,scope,family,request,state','operation_id',operationIds), plan.intents);
      assert.deepEqual(await store.listPearlGround(f.scope), []);
    });
    if (!partial) await check('three-terminal-audits-retained-and-no-new-dispatch-after-receipt-cleanup', async () => {
      for (const raw of f.batches) {
        assert.equal((await journal.prepare('batch', raw)).state, 'committed');
        assert.deepEqual(await store.commitPearlBatch(raw), { ok: false, why: 'operation' });
      }
      assert.equal(manifest.cleanup.intents.length, 3); assert.deepEqual(await journal.list(), []);
    });
  }
}

async function phase(name, file) {
  let check = 'validated-fixture-before-credentials';
  try {
    assert.ok([...journalPhases,'cleanup-partial'].includes(name));
    const resolved = path.resolve(file);
    assert.equal(path.dirname(resolved),path.resolve('.scratch'));
    assert.equal(fs.realpathSync(path.dirname(resolved)),path.resolve('.scratch'));
    assert.equal(fs.realpathSync(resolved),resolved);
    const manifest = JSON.parse(fs.readFileSync(resolved,'utf8')), f = checkedJournalManifest(manifest,name,file);
    process.loadEnvFile('.env');
    const options = { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
      global: { fetch: (input,init) => fetch(input,{ ...init,signal:AbortSignal.timeout(10000) }) } };
    const admin = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,options);
    await verifyJournalPhase(name,manifest,{ admin, store:createSupabaseStore(admin), journal:createSupabasePearlJournal(admin,f.scope),
      publicClient:createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLIC_KEY,options),
      persist:async (next) => fs.writeFileSync(resolved,JSON.stringify(next,null,2)),
      begin:(label) => { check=label; }, record:(label) => console.log(JSON.stringify({ phase:name,check:label,ok:true })) });
  } catch (error) {
    const codes = ['ERR_ASSERTION','unavailable','operation','response','configuration','ownership','conflict','kind','ENOENT','EACCES'];
    console.log(JSON.stringify({ phase:[...journalPhases,'cleanup-partial'].includes(name)?name:'invalid', check,ok:false,
      failureType:error.name==='AssertionError'?'AssertionError':'Error',code:codes.includes(error.code)?error.code:null })); process.exitCode=1;
  }
}
async function run() {
  const manifest=newJournalManifest(), f=journalFixture(manifest.ids);
  fs.mkdirSync('.scratch',{recursive:true}); fs.mkdirSync('shots/review',{recursive:true});
  assert.equal(fs.realpathSync('.scratch'),path.resolve('.scratch')); assert.equal(fs.realpathSync('shots/review'),path.resolve('shots/review'));
  const file=path.resolve('.scratch',`m5-j8-live-${f.ids.token}.json`);
  fs.writeFileSync(file,JSON.stringify(manifest,null,2),{flag:'wx'});
  let log='',passed=true,cleaned=false;
  for (const name of journalPhases) {
    if (!passed) break; // An ambiguous run is retained for explicit recovery, never automatically deleted.
    const ok=await new Promise((resolve) => {
      const child=spawn(process.execPath,[script,'--live','--phase',name,file],{stdio:['ignore','pipe','ignore'],windowsHide:true});
      const timer=setTimeout(()=>child.kill(),300000);
      child.stdout.on('data',(chunk)=>{const text=chunk.toString();log+=text;process.stdout.write(text);});
      child.on('error',()=>{clearTimeout(timer);resolve(false);}); child.on('close',(code)=>{clearTimeout(timer);resolve(code===0);});
    }); passed&&=ok; if(name==='cleanup')cleaned=ok;
  }
  const evidence={scope:f.scope,fixtureFile:path.relative(process.cwd(),file),checks:log.trim().split('\n').filter(Boolean).map(JSON.parse),
    passed,gameplayFixturesRemoved:cleaned,retainedTerminalAuditRows:cleaned?3:null};
  fs.writeFileSync(`shots/review/m5-j8-live-${f.ids.token}.log`,log,{flag:'wx'});
  fs.writeFileSync(`shots/review/m5-j8-live-${f.ids.token}.json`,JSON.stringify(evidence,null,2),{flag:'wx'});
  console.log(JSON.stringify({passed,gameplayFixturesRemoved:cleaned,retainedTerminalAuditRows:evidence.retainedTerminalAuditRows}));
  process.exitCode=passed?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===script) {
  if(!process.argv.includes('--live')) {
    console.log('Usage: node tools/verify-pearl-batch-journal.mjs --live');
    console.log('Two synthetic profiles/six UIDs; four fresh processes; three terminal audit rows retained.');
    console.log('Failure retains exact recovery manifest and database fixtures.'); process.exitCode=1;
  } else { const at=process.argv.indexOf('--phase'); if(at<0)await run();else await phase(process.argv[at+1],process.argv[at+2]); }
}
