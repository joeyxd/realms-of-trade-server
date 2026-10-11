// Opt-in SQL007 canary. Exact generated fixtures only; failed runs retain their recovery manifest.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { batchOperation, batchResult } from '../server/pearlBatch.mjs';
import { pearlOperation, pearlResult } from '../server/pearlOperations.mjs';
import { groundOperation, groundResult } from '../server/pearlGround.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

const script = fileURLToPath(import.meta.url);
export const batchPhases = ['prepare', 'recover', 'verify', 'cleanup'];
const badNames = ['badProfile', 'badUnique', 'badOwner', 'badKind', 'badWorld', 'badGold', 'badXP',
  'badMastery', 'partialDeath', 'badOrder', 'badMetadata'];
const operationNames = [...Array.from({ length: 13 }, (_, i) => `seed${i}`), 'setupReplace', 'setupPickup',
  'death', 'replace', 'pickup', 'journalCollision', ...badNames];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const order = (a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
const ground = (i) => ({ x: i + 0.5, z: -i - 1, availableAt: 30, returnAt: 5400 });

export function batchFixture(ids) {
  assert.deepEqual(Object.keys(ids), ['token', 'accounts', 'operations']);
  assert.match(ids.token, uuid); assert.equal(ids.accounts.length, 2);
  assert.deepEqual(Object.keys(ids.operations), operationNames);
  const allIds = [ids.token, ...ids.accounts, ...Object.values(ids.operations)];
  allIds.forEach((id) => assert.match(id, uuid)); assert.equal(new Set(allIds).size, allIds.length);
  const scope = `canary-batch-${ids.token}`, kinds = ['brasa', 'escarcha', 'tormenta', 'tinta'];
  const pearls = Array.from({ length: 13 }, (_, i) => ({
    uid: `cb-${i < 9 ? 'a' : 'b'}${String(i < 9 ? i : i - 9).padStart(2, '0')}-${ids.token}`,
    kind: kinds[(i < 9 ? i : i - 9) % 4],
  }));
  const data = ids.accounts.map((id, i) => {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 37 + i; p.xp = 21 + i;
    p.mast[0] = [3, 123]; p.stats.kills = 17; return sanitizeProfile(p);
  });
  const grants = [], held = data.map((p) => structuredClone(p));
  for (let i = 0; i < pearls.length; i++) {
    const owner = i < 9 ? 0 : 1, n = i < 9 ? i : i - 9;
    if (i === 8) held[owner].pearls.swallowed = pearls[i]; else held[owner].pearls.bag.push(pearls[i]);
    const r = { operationId: ids.operations[`seed${i}`], ...pearls[i], from: null, to: ids.accounts[owner],
      expectedVersion: 0, profiles: [{ id: ids.accounts[owner], expectedVersion: n + 1, data: structuredClone(held[owner]) }] };
    grants.push(i < 9 ? { ...r, world: scope, ground: null } : r);
  }
  held[1].pearls.swallowed = held[1].pearls.bag.pop(); held[1].pearls.bag.reverse();
  const replaced = structuredClone(held[0]); replaced.pearls.bag.shift(); replaced.pearls.swallowed = pearls[0];
  const setupReplace = { operationId: ids.operations.setupReplace, world: scope, mode: 'replace',
    profile: { id: ids.accounts[0], expectedVersion: 10, data: replaced }, items: [
      { ...pearls[0], expectedVersion: 1, ground: null }, { ...pearls[8], expectedVersion: 1, ground: ground(8) },
    ] };
  const reacquired = structuredClone(replaced); reacquired.pearls.bag.push(pearls[8]);
  const setupPickup = { operationId: ids.operations.setupPickup, ...pearls[8], from: null, to: ids.accounts[0],
    expectedVersion: 2, world: scope, ground: null,
    profiles: [{ id: ids.accounts[0], expectedVersion: 11, data: reacquired }] };
  const before = [reacquired, held[1]], after = before.map((p) => structuredClone(p));
  after[0].pearls = { swallowed: null, bag: [] };
  const incoming = pearls[10], outgoing = pearls[12];
  after[1].pearls.bag = after[1].pearls.bag.filter((p) => p.uid !== incoming.uid);
  after[1].pearls.swallowed = incoming;
  const requests = [
    { operationId: ids.operations.death, world: scope, mode: 'death',
      profile: { id: ids.accounts[0], expectedVersion: 12, data: after[0] },
      items: pearls.slice(0, 9).map((p, i) => ({ ...p, expectedVersion: i === 0 ? 2 : i === 8 ? 3 : 1, ground: ground(i) })) },
    { operationId: ids.operations.replace, world: scope, mode: 'replace',
      profile: { id: ids.accounts[1], expectedVersion: 6, data: after[1] }, items: [
        { ...incoming, expectedVersion: 1, ground: null }, { ...outgoing, expectedVersion: 1, ground: ground(12) },
      ] },
  ];
  const picked = structuredClone(after[1]); picked.pearls.bag.push(pearls[8]);
  const pickup = { operationId: ids.operations.pickup, ...pearls[8], from: null, to: ids.accounts[1],
    expectedVersion: 4, world: scope, ground: null,
    profiles: [{ id: ids.accounts[1], expectedVersion: 7, data: picked }] };
  const collision = { operationId: ids.operations.journalCollision, ...pearls[9], from: ids.accounts[1], to: null,
    expectedVersion: 1, profiles: [{ id: ids.accounts[1], expectedVersion: 6, data: held[1] }],
    world: scope, ground: ground(9) };
  return { ids, scope, pearls, data, grants, held, setupReplace, setupPickup, before, after, requests, pickup, collision };
}
export function newBatchManifest() {
  return { ids: { token: randomUUID(), accounts: [randomUUID(), randomUUID()],
    operations: Object.fromEntries(operationNames.map((name) => [name, randomUUID()])) }, since: null, cleanup: null };
}
export function checkedBatchManifest(manifest, phase, file) {
  assert.ok([...batchPhases, 'cleanup-partial'].includes(phase)); assert.deepEqual(Object.keys(manifest), ['ids', 'since', 'cleanup']);
  const f = batchFixture(manifest.ids);
  if (file !== undefined) {
    const resolved = path.resolve(file);
    assert.equal(path.dirname(resolved), path.resolve('.scratch'));
    assert.equal(path.basename(resolved), `m5-batch-live-${f.ids.token}.json`);
  }
  if (phase === 'prepare' || phase === 'cleanup-partial') assert.equal(manifest.since, null);
  else {
    assert.equal(manifest.since?.length, 13);
    manifest.since.forEach((s) => assert.ok(typeof s === 'string' && s.length < 50));
  }
  if (!['cleanup', 'cleanup-partial'].includes(phase)) assert.equal(manifest.cleanup, null);
  return f;
}

// Derive every possible partial seeding state from immutable fixture inputs, never from arbitrary IDs.
function cleanupModels(f) {
  const { ids, pearls } = f;
  const state = { profiles: [null, null], uniques: [], locations: [], receipts: [[], [], []], intents: [] };
  const models = [structuredClone(state)];
  const capture = () => {
    state.uniques.sort(order); state.locations.sort(order);
    state.receipts.forEach((rows) => rows.sort((a, b) => a.operation_id < b.operation_id ? -1 : 1));
    models.push(structuredClone(state));
  };
  const write = (rows, row) => { const at = rows.findIndex((q) => q.uid === row.uid); if (at < 0) rows.push(row); else rows[at] = row; };
  const apply = (raw, family) => {
    const { request } = (family === 'batch' ? batchOperation : family === 'ground' ? groundOperation : pearlOperation)(raw);
    const result = (family === 'batch' ? batchResult : family === 'ground' ? groundResult : pearlResult)(request);
    const profiles = family === 'batch' ? [request.profile] : request.profiles;
    for (const p of profiles) state.profiles[ids.accounts.indexOf(p.id)] = { data: structuredClone(p.data), version: p.expectedVersion + 1 };
    for (const q of family === 'batch' ? result.uniques : [result.unique]) write(state.uniques, structuredClone(q));
    for (const q of family === 'batch' ? result.locations : family === 'ground' ? [result.location] : []) write(state.locations, structuredClone(q));
    state.receipts[family === 'batch' ? 2 : family === 'ground' ? 1 : 0].push({ operation_id: raw.operationId, request, result });
    if (family === 'ground') {
      const { world: _world, ground: _ground, ...child } = request;
      state.receipts[0].push({ operation_id: raw.operationId, request: child, result: pearlResult(child) });
    }
    capture();
  };
  for (let i = 0; i < 2; i++) { state.profiles[i] = { data: f.data[i], version: 1 }; capture(); }
  f.grants.forEach((r, i) => apply(r, i < 9 ? 'ground' : 'pearl'));
  state.profiles[1] = { data: f.held[1], version: 6 }; capture();
  apply(f.setupReplace, 'batch'); apply(f.setupPickup, 'ground');
  const partial = structuredClone(models);
  f.requests.forEach((r) => apply(r, 'batch'));
  state.profiles[0].data.xp += 7; state.profiles[0].version++;
  apply(f.pickup, 'ground');
  const { operationId, ...request } = f.collision;
  state.intents = [{ operation_id: operationId, scope: f.scope, family: 'ground', request, state: 'rejected' }];
  assert.equal(state.uniques.length, pearls.length);
  return { partial, full: structuredClone(state) };
}
function withoutSince(snapshot) {
  return { ...snapshot, uniques: snapshot.uniques.map(({ since: _since, ...q }) => q) };
}
function checkedCleanupPlan(plan, f, manifest, partial) {
  assert.deepEqual(Object.keys(plan), ['profiles', 'uniques', 'locations', 'receipts', 'intents']);
  const models = cleanupModels(f), actual = withoutSince(plan);
  const matches = (wanted) => { try { assert.deepEqual(actual, wanted); return true; } catch { return false; } };
  assert.ok(partial ? models.partial.some(matches) : matches(models.full), 'Cleanup requires an exact generated state');
  for (const q of plan.uniques) {
    if (q.holder === null) assert.equal(q.since, null);
    else {
      assert.ok(typeof q.since === 'string' && q.since.length < 50);
      if (!partial && q.uid !== f.pearls[8].uid) assert.equal(q.since, manifest.since[f.pearls.findIndex((p) => p.uid === q.uid)]);
    }
  }
}

// Dependency injection allows the identical checks and exact cleanup to run against local SQL first.
export async function verifyBatchPhase(name, manifest, { admin, store, journal, publicClient, record, persist, begin = () => {} }) {
  const f = checkedBatchManifest(manifest, name), { ids, scope, pearls, requests } = f;
  const operationIds = Object.values(ids.operations), uids = pearls.map((p) => p.uid);
  const rawRows = async (table, columns, key, values) => {
    const r = await admin.from(table).select(columns).in(key, values).order(key);
    assert.equal(r.error, null, 'Fixture table read failed'); return r.data;
  };
  const snapshot = async () => ({ profiles: await Promise.all(ids.accounts.map((id) => store.loadProfile(id))),
    uniques: await rawRows('mn_unique_items', 'uid,kind,holder,version,since', 'uid', uids),
    locations: await rawRows('mn_pearl_locations', 'uid,world,ground,version', 'uid', uids),
    receipts: await Promise.all(['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations']
      .map((table) => rawRows(table, 'operation_id,request,result', 'operation_id', operationIds))) });
  const expected = (r) => batchResult(batchOperation(r).request);
  const check = async (label, work) => { begin(label); await work(); record(label); };
  const assertCurrent = async (advanced = false, picked = false) => {
    for (let i = 0; i < ids.accounts.length; i++) {
      const p = structuredClone(picked && i === 1 ? f.pickup.profiles[0].data : f.after[i]);
      if (advanced && i === 0) p.xp += 7;
      assert.deepEqual(await store.loadProfile(ids.accounts[i]), { data: p, version: (i === 0 ? 13 : 7) +
        (advanced && i === 0 ? 1 : picked && i === 1 ? 1 : 0) });
    }
    const rows = await rawRows('mn_unique_items', 'uid,since', 'uid', uids), drops = [];
    for (let i = 0; i < pearls.length; i++) {
      const p = pearls[i], item = requests.flatMap((r) => r.items).find((q) => q.uid === p.uid);
      const isPicked = picked && i === 8;
      const holder = isPicked ? ids.accounts[1] : item?.ground ? null : ids.accounts[i < 9 ? 0 : 1];
      const version = isPicked ? 5 : item ? item.expectedVersion + 1 : 1;
      assert.deepEqual(await store.loadUnique(p.uid), { kind: `pearl:${p.kind}`, holder, version });
      assert.deepEqual(await store.loadPearlLocation(p.uid), item ?
        { world: scope, ground: isPicked ? null : item.ground, version } : null);
      const since = rows.find((q) => q.uid === p.uid).since;
      if (isPicked) assert.ok(typeof since === 'string' && since.length < 50);
      else assert.equal(since, item?.ground ? null : manifest.since[i]);
      if (item?.ground && !isPicked) drops.push(p.uid);
    }
    assert.deepEqual((await store.listPearlGround(scope)).map((p) => p.uid), drops.sort());
    for (const r of requests) {
      assert.deepEqual(await store.loadPearlBatchOperation(r.operationId),
        { request: batchOperation(r).request, result: expected(r) });
      assert.equal(await store.loadPearlOperation(r.operationId), null);
      assert.equal(await store.loadPearlGroundOperation(r.operationId), null);
    }
  };
  if (name === 'prepare') {
    await check('exact-fixtures-absent-before-seeding', async () => {
      for (const [table, key, values] of [
        ['mn_profiles', 'player_id', ids.accounts], ['mn_unique_items', 'uid', uids], ['mn_pearl_locations', 'uid', uids],
        ...['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations', 'mn_pearl_intents']
          .map((table) => [table, 'operation_id', operationIds]),
      ]) assert.deepEqual(await rawRows(table, key, key, values), []);
      assert.deepEqual(await journal.list(), []); assert.deepEqual(await store.listPearlGround(scope), []);
    });
    await check('two-profiles-thirteen-managed-UIDs-tracked-and-legacy-seeded', async () => {
      for (let i = 0; i < 2; i++) assert.equal((await store.initializeProfile(ids.accounts[i], f.data[i])).version, 1);
      for (let i = 0; i < f.grants.length; i++) assert.equal((await store[i < 9 ? 'commitPearlGround' : 'commitPearl'](f.grants[i])).ok, true);
      assert.deepEqual(await store.saveProfile(ids.accounts[1], f.held[1], 5), { ok: true, version: 6 });
      for (const p of pearls.slice(9)) assert.equal(await store.loadPearlLocation(p.uid), null);
    });
    await check('setup-replace-reacquire-nine-UIDs-with-generations-one-two-three', async () => {
      assert.deepEqual(await store.commitPearlBatch(f.setupReplace), expected(f.setupReplace));
      assert.equal((await store.commitPearlGround(f.setupPickup)).ok, true);
      assert.deepEqual(await store.loadProfile(ids.accounts[0]), { data: f.before[0], version: 12 });
      manifest.since = (await rawRows('mn_unique_items', 'uid,since', 'uid', uids)).map((p) => p.since);
      assert.ok(manifest.since.every((s) => typeof s === 'string' && s.length < 50)); await persist(manifest);
    });
    const baseline = await snapshot();
    for (const [label, mode, why, change] of [
      ['badProfile', 0, 'conflict', (r) => { r.profile.expectedVersion--; }],
      ['badUnique', 0, 'conflict', (r) => { r.items.at(-1).expectedVersion++; }],
      ['badOwner', 0, 'conflict', (r) => { r.profile.id = ids.accounts[1]; r.profile.expectedVersion = 6; }],
      ['badKind', 0, 'kind', (r) => { r.items.at(-1).kind = 'tinta'; }],
      ['badWorld', 0, 'ownership', (r) => { r.world = `${scope}-other`; }],
      ['badGold', 0, 'ownership', (r) => { r.profile.data.gold++; }],
      ['badXP', 0, 'ownership', (r) => { r.profile.data.xp++; }],
      ['badMastery', 0, 'ownership', (r) => { r.profile.data.mast[0][1]++; }],
      ['partialDeath', 0, 'ownership', (r) => { r.items.pop(); }],
      ['badOrder', 1, 'ownership', (r) => { r.profile.data.pearls.bag.reverse(); }],
      ['badMetadata', 0, 'operation', (r) => { r.items.reverse(); }],
    ]) await check(`${label}-rejects-whole-batch-without-state-or-receipt-change`, async () => {
      const r = structuredClone(requests[mode]); r.operationId = ids.operations[label]; change(r);
      // Direct RPC also checks SQL validation without relying on the SDK DTO for malformed ordering.
      const { operationId, ...request } = r;
      const reply = await admin.rpc('mn_commit_pearl_batch', { p_operation_id: operationId, p_request: request });
      assert.equal(reply.error, null); assert.deepEqual(reply.data, { ok: false, why });
      assert.deepEqual(await snapshot(), baseline); assert.equal(await store.loadPearlBatchOperation(operationId), null);
    });
    await check('preexisting-003-and-004-UUIDs-cannot-be-batches', async () => {
      for (const i of [0, 9]) assert.deepEqual(await store.commitPearlBatch({ ...requests[0], operationId: f.grants[i].operationId }),
        { ok: false, why: 'operation' });
      assert.deepEqual(await snapshot(), baseline);
    });
    await check('005-intent-blocks-batch-UUID-and-is-settled-without-dispatch', async () => {
      await journal.prepare('ground', f.collision);
      assert.deepEqual(await store.commitPearlBatch({ ...requests[0], operationId: f.collision.operationId }), { ok: false, why: 'operation' });
      assert.deepEqual(await snapshot(), baseline);
      assert.equal((await journal.resolve('ground', f.collision, 'rejected')).state, 'rejected');
      assert.deepEqual(await journal.list(), []);
    });
    await check('nine-UID-death-one-profile-CAS-and-independent-generations', async () => {
      assert.deepEqual(await store.commitPearlBatch(requests[0]), expected(requests[0]));
      assert.deepEqual(await store.loadProfile(ids.accounts[1]), baseline.profiles[1]);
    });
    await check('two-UID-legacy-replacement-commits-but-SDK-reply-is-discarded', async () => {
      const lost = createSupabaseStore({ async rpc(rpcName, args) {
        assert.equal(rpcName, 'mn_commit_pearl_batch'); assert.equal(args.p_operation_id, requests[1].operationId);
        const reply = await admin.rpc(rpcName, args); assert.equal(reply.error, null); assert.deepEqual(reply.data, expected(requests[1]));
        throw new Error('Discarded canary response');
      } });
      await assert.rejects(lost.commitPearlBatch(requests[1]), { code: 'unavailable' });
      await assertCurrent();
    });
  } else if (name === 'recover') {
    await check('fresh-process-read-only-receipt-recovery-zero-mutation-dispatches', async () => {
      const readOnly = createSupabaseStore({ async rpc(rpcName, args) {
        assert.equal(rpcName, 'mn_load_pearl_batch_operation'); return admin.rpc(rpcName, args);
      } });
      for (const r of requests) assert.deepEqual(await readOnly.loadPearlBatchOperation(r.operationId),
        { request: batchOperation(r).request, result: expected(r) });
      await assertCurrent();
    });
    await check('exact-replays-never-advance-profile-UID-location-or-since-again', async () => {
      const before = await snapshot();
      for (const r of requests) assert.deepEqual(await store.commitPearlBatch(r), { ...expected(r), replay: true });
      assert.deepEqual(await snapshot(), before);
    });
    await check('same-UUID-changed-ground-is-rejected-and-original-receipt-preserved', async () => {
      const before = await snapshot();
      for (const raw of requests) {
        const r = structuredClone(raw); r.items.find((q) => q.ground).ground.x++;
        assert.deepEqual(await store.commitPearlBatch(r), { ok: false, why: 'operation' });
      }
      assert.deepEqual(await snapshot(), before);
    });
    await check('batch-UUID-blocks-003-004-005-and-direct-receipt-inserts', async () => {
      const before = await snapshot();
      const single = { ...f.collision, operationId: requests[0].operationId };
      const { world: _world, ground: _ground, ...legacy } = single;
      assert.deepEqual(await store.commitPearl(legacy), { ok: false, why: 'operation' });
      assert.deepEqual(await store.commitPearlGround(single), { ok: false, why: 'operation' });
      await assert.rejects(journal.prepare('ground', single), { code: 'operation' });
      for (const table of ['mn_pearl_operations', 'mn_pearl_ground_operations']) {
        const { operationId, ...request } = table === 'mn_pearl_operations' ? legacy : single;
        const reply = await admin.from(table).insert({ operation_id: operationId, request });
        assert.equal(reply.error?.code, 'MNP02');
      }
      assert.deepEqual(await snapshot(), before); assert.deepEqual(await journal.list(), []);
    });
  } else if (name === 'verify') {
    await check('third-process-current-profile-ledger-location-receipt-and-timestamps', async () => { await assertCurrent(); });
    await check('later-progress-save-and-historical-batch-replay-preserve-new-XP', async () => {
      const p = structuredClone(f.after[0]); p.xp += 7;
      assert.deepEqual(await store.saveProfile(ids.accounts[0], p, 13), { ok: true, version: 14 });
      const before = await snapshot();
      for (const r of requests) assert.deepEqual(await store.commitPearlBatch(r), { ...expected(r), replay: true });
      assert.deepEqual(await snapshot(), before); await assertCurrent(true);
    });
    await check('004-pickup-after-death-and-old-batch-replay-cannot-resurrect-ground', async () => {
      assert.equal((await store.commitPearlGround(f.pickup)).ok, true); const before = await snapshot();
      assert.deepEqual(await store.commitPearlBatch(requests[0]), { ...expected(requests[0]), replay: true });
      assert.deepEqual(await snapshot(), before); await assertCurrent(true, true);
    });
    for (const [label, invoke] of [
      ['public-commit-RPC-denied', () => publicClient.rpc('mn_commit_pearl_batch',
        { p_operation_id: requests[0].operationId, p_request: batchOperation(requests[0]).request })],
      ['public-receipt-RPC-denied', () => publicClient.rpc('mn_load_pearl_batch_operation', { p_operation_id: requests[0].operationId })],
      ['public-validator-RPC-denied', () => publicClient.rpc('mn_valid_pearl_batch', { p_request: batchOperation(requests[0]).request })],
      ['public-batch-table-read-denied', () => publicClient.from('mn_pearl_batch_operations').select('operation_id').in('operation_id', operationIds)],
    ]) await check(label, async () => {
      const before = await snapshot(); assert.equal((await invoke()).error?.code, '42501'); assert.deepEqual(await snapshot(), before);
    });
  } else {
    const partial = name === 'cleanup-partial';
    await check('all-known-fixtures-settled-and-exact-current-state-before-cleanup', async () => {
      if (manifest.cleanup !== null) { checkedCleanupPlan(manifest.cleanup, f, manifest, partial); return; }
      if (partial) {
        const plan = { ...await snapshot(), intents: await rawRows('mn_pearl_intents', 'operation_id,scope,family,request,state', 'operation_id', operationIds) };
        checkedCleanupPlan(plan, f, manifest, true); manifest.cleanup = plan; await persist(manifest); return;
      }
      await assertCurrent(true, true); assert.deepEqual(await journal.list(), []);
      const wanted = { mn_pearl_operations: [], mn_pearl_ground_operations: [], mn_pearl_batch_operations: [] };
      for (const r of [...f.grants, f.setupPickup, f.pickup]) {
        const tracked = Object.hasOwn(r, 'world');
        const payload = (tracked ? groundOperation : pearlOperation)(r).request;
        const result = (tracked ? groundResult : pearlResult)(payload);
        wanted[tracked ? 'mn_pearl_ground_operations' : 'mn_pearl_operations'].push(
          { operation_id: r.operationId, request: payload, result });
        // 004 legitimately records an exact 003 child under the same UUID.
        if (tracked) {
          const { world: _world, ground: _ground, ...child } = payload;
          wanted.mn_pearl_operations.push({ operation_id: r.operationId, request: child, result: pearlResult(child) });
        }
      }
      for (const r of [f.setupReplace, ...requests]) wanted.mn_pearl_batch_operations.push(
        { operation_id: r.operationId, request: batchOperation(r).request, result: expected(r) });
      for (const [table, rows] of Object.entries(wanted)) assert.deepEqual(
        await rawRows(table, 'operation_id,request,result', 'operation_id', operationIds),
        rows.sort((a, b) => a.operation_id < b.operation_id ? -1 : 1));
      const { operationId, ...request } = f.collision;
      assert.deepEqual(await rawRows('mn_pearl_intents', 'operation_id,scope,family,request,state', 'operation_id', operationIds),
        [{ operation_id: operationId, scope, family: 'ground', request, state: 'rejected' }]);
      const plan = { ...await snapshot(), intents: await rawRows('mn_pearl_intents', 'operation_id,scope,family,request,state', 'operation_id', operationIds) };
      checkedCleanupPlan(plan, f, manifest, false); manifest.cleanup = plan; await persist(manifest);
    });
    await check(partial ? 'exact-partial-seeding-fixtures-removed' : 'exact-synthetic-gameplay-fixtures-removed-one-terminal-audit-retained', async () => {
      const plan = manifest.cleanup;
      const assertSubset = (current, wanted, key) => {
        for (const row of current) assert.deepEqual(row, wanted.find((q) => q[key] === row[key]), 'Changed fixture is never deleted');
      };
      const now = { ...await snapshot(), intents: await rawRows('mn_pearl_intents', 'operation_id,scope,family,request,state', 'operation_id', operationIds) };
      for (let i = 0; i < 2; i++) if (now.profiles[i] !== null) assert.deepEqual(now.profiles[i], plan.profiles[i]);
      assertSubset(now.uniques, plan.uniques, 'uid'); assertSubset(now.locations, plan.locations, 'uid');
      now.receipts.forEach((rows, i) => assertSubset(rows, plan.receipts[i], 'operation_id')); assert.deepEqual(now.intents, plan.intents);
      const remove = async (table, key, row) => {
        let query = admin.from(table).delete();
        for (const [column, value] of Object.entries(row)) query = value === null ? query.is(column, null) :
          query.eq(column, typeof value === 'object' ? JSON.stringify(value) : value);
        const reply = await query;
        assert.equal(reply.error, null, 'Conditional fixture cleanup failed');
        assert.deepEqual(await rawRows(table, key, key, [row[key]]), []);
      };
      for (const i of [2, 1, 0]) for (const row of plan.receipts[i]) await remove(
        ['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations'][i], 'operation_id', row);
      for (const row of plan.uniques) await remove('mn_unique_items', 'uid', row);
      for (let i = 0; i < 2; i++) if (plan.profiles[i]) await remove('mn_profiles', 'player_id',
        { player_id: ids.accounts[i], ...plan.profiles[i] });
      for (const table of ['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_batch_operations']) {
        assert.deepEqual(await rawRows(table, 'operation_id', 'operation_id', operationIds), []);
      }
      assert.deepEqual(await rawRows('mn_pearl_locations', 'uid', 'uid', uids), []);
      assert.deepEqual(await store.listPearlGround(scope), []);
      assert.deepEqual(await rawRows('mn_pearl_intents', 'operation_id,state', 'operation_id', operationIds),
        partial ? [] : [{ operation_id: f.collision.operationId, state: 'rejected' }]);
    });
  }
}

async function phase(name, file) {
  let check = 'validated-fixture-before-credentials';
  try {
    assert.ok([...batchPhases, 'cleanup-partial'].includes(name));
    const resolved = path.resolve(file);
    assert.equal(path.dirname(resolved), path.resolve('.scratch'));
    assert.equal(fs.realpathSync(path.dirname(resolved)), path.resolve('.scratch'));
    assert.equal(fs.realpathSync(resolved), resolved);
    assert.match(path.basename(resolved), /^m5-batch-live-[0-9a-f-]{36}\.json$/);
    const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const f = checkedBatchManifest(manifest, name, file);
    process.loadEnvFile('.env');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } };
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
    await verifyBatchPhase(name, manifest, { admin, store: createSupabaseStore(admin),
      journal: createSupabasePearlJournal(admin, f.scope),
      publicClient: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options),
      persist: async (next) => fs.writeFileSync(resolved, JSON.stringify(next, null, 2)),
      begin: (label) => { check = label; },
      record: (label) => { check = label; console.log(JSON.stringify({ phase: name, check: label, ok: true })); },
    });
  } catch (error) {
    // Provider errors and credential-bearing messages never leave the process.
    const codes = ['ERR_ASSERTION', 'unavailable', 'operation', 'response', 'configuration', 'ownership', 'conflict', 'kind', 'ENOENT', 'EACCES'];
    console.log(JSON.stringify({ phase: [...batchPhases, 'cleanup-partial'].includes(name) ? name : 'invalid', check, ok: false,
      failureType: error.name === 'AssertionError' ? 'AssertionError' : 'Error', code: codes.includes(error.code) ? error.code : null }));
    process.exitCode = 1;
  }
}
async function run() {
  const manifest = newBatchManifest(), f = batchFixture(manifest.ids);
  fs.mkdirSync('.scratch', { recursive: true }); fs.mkdirSync('shots/review', { recursive: true });
  assert.equal(fs.realpathSync('.scratch'), path.resolve('.scratch'));
  assert.equal(fs.realpathSync('shots/review'), path.resolve('shots/review'));
  const file = path.resolve('.scratch', `m5-batch-live-${f.ids.token}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  let log = '', passed = true, cleaned = false;
  for (const name of batchPhases) {
    if (!passed) break; // Never automatically clean an ambiguous or failed run.
    const ok = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, '--live', '--phase', name, file],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const timer = setTimeout(() => child.kill(), 300000);
      child.stdout.on('data', (chunk) => { const text = chunk.toString(); log += text; process.stdout.write(text); });
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    });
    passed &&= ok; if (name === 'cleanup') cleaned = ok;
  }
  const evidence = { scope: f.scope, fixtureFile: path.relative(process.cwd(), file),
    checks: log.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    passed, gameplayFixturesRemoved: cleaned, retainedTerminalAuditRows: cleaned ? 1 : null };
  fs.writeFileSync(`shots/review/m5-batch-live-${f.ids.token}.log`, log, { flag: 'wx' });
  fs.writeFileSync(`shots/review/m5-batch-live-${f.ids.token}.json`, JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, gameplayFixturesRemoved: cleaned, retainedTerminalAuditRows: evidence.retainedTerminalAuditRows }));
  process.exitCode = passed ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  if (!process.argv.includes('--live')) {
    console.log('Usage: node tools/verify-pearl-batch.mjs --live');
    console.log('Two synthetic profiles/thirteen UIDs; four fresh processes; one terminal audit row retained.');
    console.log('Failure retains the exact recovery manifest and database fixtures.'); process.exitCode = 1;
  } else {
    const at = process.argv.indexOf('--phase');
    if (at < 0) await run(); else await phase(process.argv[at + 1], process.argv[at + 2]);
  }
}
