// Opt-in live SQL006 canary. Only generated fixtures are touched; terminal audit rows remain.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

const script = fileURLToPath(import.meta.url);
const phases = ['prepare', 'recover', 'verify', 'cleanup'];
const operationNames = ['seedLeft', 'seedTarget', 'seedRight', 'seedLegacy', 'committed', 'unsent',
  'badGold', 'badProfile', 'badUnique', 'badWorld', 'badKind', 'badOrder'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

if (!process.argv.includes('--live')) {
  console.log('Usage: node tools/verify-pearl-same-holder.mjs --live');
  console.log('Creates two synthetic profiles/four UIDs; removes settled fixtures, retains two terminal audit rows.');
  console.log('A failed run retains its exact local manifest and database state for recovery.');
  process.exitCode = 1;
} else {
  const at = process.argv.indexOf('--phase');
  if (at < 0) await run();
  else await phase(process.argv[at + 1], process.argv[at + 2]);
}

function fixture(ids) {
  assert.match(ids.token, uuid);
  assert.equal(ids.accounts.length, 2);
  assert.deepEqual(Object.keys(ids.operations), operationNames);
  const allIds = [ids.token, ...ids.accounts, ...Object.values(ids.operations)];
  allIds.forEach((id) => assert.match(id, uuid));
  assert.equal(new Set(allIds).size, allIds.length);
  const scope = `canary-swallow-${ids.token}`;
  const pearls = ['left', 'target', 'right', 'legacy'].map((name, i) => ({
    uid: `canary-swallow-${name}-${ids.token}`, kind: ['escarcha', 'brasa', 'tormenta', 'tinta'][i],
  }));
  const data = ids.accounts.map((id, i) => {
    const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 37 + i * 6; p.xp = 11 + i * 2;
    return sanitizeProfile(p);
  });
  const held = data.map((p, i) => ({ ...structuredClone(p), pearls: {
    bag: structuredClone(i === 0 ? pearls.slice(0, 3) : pearls.slice(3)), swallowed: null,
  } }));
  const after = held.map((p, i) => {
    const q = structuredClone(p), selected = pearls[i === 0 ? 1 : 3];
    q.pearls.bag = q.pearls.bag.filter((r) => r.uid !== selected.uid);
    q.pearls.swallowed = structuredClone(selected); return q;
  });
  const grants = pearls.map((pearl, i) => {
    const owner = i === 3 ? 1 : 0, p = structuredClone(data[owner]);
    p.pearls.bag = structuredClone(i === 3 ? [pearl] : pearls.slice(0, i + 1));
    const r = { operationId: ids.operations[operationNames[i]], ...pearl, from: null, to: ids.accounts[owner],
      expectedVersion: 0, profiles: [{ id: ids.accounts[owner], expectedVersion: i === 3 ? 1 : i + 1, data: p }] };
    return i === 3 ? r : { ...r, world: scope, ground: null };
  });
  const requests = after.map((p, i) => ({ operationId: ids.operations[i === 0 ? 'committed' : 'unsent'],
    ...pearls[i === 0 ? 1 : 3], from: ids.accounts[i], to: ids.accounts[i], expectedVersion: 1,
    profiles: [{ id: ids.accounts[i], expectedVersion: i === 0 ? 4 : 2, data: p }], world: scope, ground: null }));
  return { ids, scope, pearls, data, held, after, grants, requests };
}

async function run() {
  const ids = { token: randomUUID(), accounts: [randomUUID(), randomUUID()],
    operations: Object.fromEntries(operationNames.map((name) => [name, randomUUID()])) };
  const f = fixture(ids);
  fs.mkdirSync('.scratch', { recursive: true }); fs.mkdirSync('shots/review', { recursive: true });
  const file = path.resolve('.scratch', `m5-swallow-live-${ids.token}.json`);
  fs.writeFileSync(file, JSON.stringify({ ids, since: null }, null, 2), { flag: 'wx' });
  let log = '', passed = true, cleanup = false;
  for (const name of phases) {
    if (!passed) break; // Never delete an unresolved operation after an unsuccessful phase.
    const ok = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script, '--live', '--phase', name, file], { stdio: ['ignore', 'pipe', 'ignore'] });
      const timeout = setTimeout(() => { child.kill(); }, 120000);
      child.stdout.on('data', (chunk) => { const text = chunk.toString(); log += text; process.stdout.write(text); });
      child.on('error', () => { clearTimeout(timeout); resolve(false); });
      child.on('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
    });
    passed &&= ok; if (name === 'cleanup') cleanup = ok;
  }
  const checks = log.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  fs.writeFileSync('shots/review/m5-swallow-live-canary.log', log);
  const evidence = { scope: f.scope, fixtureFile: path.relative(process.cwd(), file), phases: checks,
    passed, gameplayFixturesRemoved: cleanup, retainedAuditRows: cleanup ? 2 : null };
  fs.writeFileSync('shots/review/m5-swallow-live-canary.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed, gameplayFixturesRemoved: cleanup, retainedAuditRows: evidence.retainedAuditRows }));
  process.exitCode = passed ? 0 : 1;
}

async function phase(name, file) {
  let check = 'validated-fixture';
  const record = () => console.log(JSON.stringify({ phase: name, check, ok: true }));
  try {
    assert.ok(phases.includes(name));
    const resolved = path.resolve(file);
    assert.equal(path.dirname(resolved), path.resolve('.scratch'));
    assert.match(path.basename(resolved), /^m5-swallow-live-[0-9a-f-]{36}\.json$/);
    const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    assert.deepEqual(Object.keys(manifest), ['ids', 'since']);
    assert.deepEqual(Object.keys(manifest.ids), ['token', 'accounts', 'operations']);
    const f = fixture(manifest.ids), { ids, scope, pearls, grants, requests } = f;
    assert.equal(path.basename(resolved), `m5-swallow-live-${ids.token}.json`);
    if (name === 'prepare') assert.equal(manifest.since, null);
    else {
      assert.equal(manifest.since?.length, 4);
      manifest.since.forEach((s) => assert.ok(typeof s === 'string' && s.length < 50));
    }
    // No credentials are read until the phase and every identifier pass the fixture guard.
    process.loadEnvFile('.env');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } };
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
    const store = createSupabaseStore(admin), journal = createSupabasePearlJournal(admin, scope);
    const rawRows = async (table, columns, key, values) => {
      const r = await admin.from(table).select(columns).in(key, values).order(key);
      assert.equal(r.error, null, 'Fixture table read failed'); return r.data;
    };
    const snapshot = async () => ({ profiles: await Promise.all(ids.accounts.map((id) => store.loadProfile(id))),
      uniques: await rawRows('mn_unique_items', 'uid,kind,holder,version,since', 'uid', pearls.map((p) => p.uid)),
      locations: await rawRows('mn_pearl_locations', 'uid,world,ground,version', 'uid', pearls.map((p) => p.uid)) });
    const since = async () => {
      const rows = await rawRows('mn_unique_items', 'uid,since', 'uid', pearls.map((p) => p.uid));
      assert.equal(rows.length, 4);
      return pearls.map((p) => rows.find((r) => r.uid === p.uid).since);
    };
    const expectedResult = (i) => ({ ok: true, replay: false,
      profiles: [{ id: ids.accounts[i], version: i === 0 ? 5 : 3 }],
      unique: { uid: requests[i].uid, kind: `pearl:${requests[i].kind}`, holder: ids.accounts[i], version: 2 },
      location: { uid: requests[i].uid, world: scope, ground: null, version: 2 } });
    const assertCommitted = async () => {
      for (let i = 0; i < requests.length; i++) {
        assert.deepEqual(await store.loadProfile(ids.accounts[i]), { data: f.after[i], version: i === 0 ? 5 : 3 });
        assert.deepEqual(await store.loadUnique(requests[i].uid), { kind: `pearl:${requests[i].kind}`, holder: ids.accounts[i], version: 2 });
        const { uid: _uid, ...location } = expectedResult(i).location;
        assert.deepEqual(await store.loadPearlLocation(requests[i].uid), location);
        const { operationId: _id, ...request } = requests[i];
        assert.deepEqual(await store.loadPearlGroundOperation(requests[i].operationId), { request, result: expectedResult(i) });
        assert.equal(await store.loadPearlOperation(requests[i].operationId), null);
      }
      for (const p of [pearls[0], pearls[2]]) {
        assert.deepEqual(await store.loadUnique(p.uid), { kind: `pearl:${p.kind}`, holder: ids.accounts[0], version: 1 });
        assert.deepEqual(await store.loadPearlLocation(p.uid), { world: scope, ground: null, version: 1 });
      }
      assert.deepEqual(await since(), manifest.since);
      assert.deepEqual(await store.listPearlGround(scope), []);
    };
    if (name === 'prepare') {
      check = 'exact-fixtures-absent-before-seeding';
      for (const [table, key, values] of [
        ['mn_profiles', 'player_id', ids.accounts], ['mn_unique_items', 'uid', pearls.map((p) => p.uid)],
        ['mn_pearl_locations', 'uid', pearls.map((p) => p.uid)],
        ...['mn_pearl_operations', 'mn_pearl_ground_operations', 'mn_pearl_intents']
          .map((table) => [table, 'operation_id', Object.values(ids.operations)]),
      ]) assert.deepEqual(await rawRows(table, key, key, values), []);
      assert.deepEqual(await journal.list(), []); record();
      check = 'tracked-and-legacy-managed-UIDs-seeded';
      for (let i = 0; i < ids.accounts.length; i++) assert.equal((await store.initializeProfile(ids.accounts[i], f.data[i])).version, 1);
      for (let i = 0; i < grants.length; i++) assert.equal((await store[i === 3 ? 'commitPearl' : 'commitPearlGround'](grants[i])).ok, true);
      assert.equal(await store.loadPearlLocation(pearls[3].uid), null);
      manifest.since = await since(); assert.ok(manifest.since.every(Boolean));
      fs.writeFileSync(resolved, JSON.stringify(manifest, null, 2)); record();
      const baseline = await snapshot();
      for (const [label, why, change] of [
        ['badGold', 'ownership', (r) => { r.profiles[0].data.gold++; }],
        ['badProfile', 'conflict', (r) => { r.profiles[0].expectedVersion--; }],
        ['badUnique', 'conflict', (r) => { r.expectedVersion++; }],
        ['badWorld', 'ownership', (r) => { r.world = `${scope}-other`; }],
        ['badKind', 'kind', (r) => { r.kind = 'tinta'; r.profiles[0].data.pearls.swallowed.kind = 'tinta'; }],
        ['badOrder', 'ownership', (r) => { r.profiles[0].data.pearls.bag.reverse(); }],
      ]) {
        check = `${label}-rejected-with-all-state-and-receipts-unchanged`;
        const r = structuredClone(requests[0]); r.operationId = ids.operations[label]; change(r);
        assert.deepEqual(await store.commitPearlGround(r), { ok: false, why });
        assert.deepEqual(await snapshot(), baseline);
        assert.equal(await store.loadPearlGroundOperation(r.operationId), null);
        assert.equal(await store.loadPearlOperation(r.operationId), null); record();
      }
      check = 'committed-request-prepared-and-atomic-one-endpoint-result';
      const row = await journal.prepare('ground', requests[0]);
      assert.deepEqual(await journal.prepare('ground', requests[0]), row);
      assert.deepEqual(await store.commitPearlGround(requests[0]), expectedResult(0));
      assert.deepEqual(await store.loadProfile(ids.accounts[0]), { data: f.after[0], version: 5 });
      assert.deepEqual(await store.loadProfile(ids.accounts[1]), baseline.profiles[1]);
      assert.deepEqual(await since(), manifest.since);
      assert.equal(await store.loadPearlOperation(requests[0].operationId), null); record();
      check = 'exact-replay-and-UUID-payload-mismatch-without-second-effect';
      const committed = await snapshot();
      assert.deepEqual(await store.commitPearlGround(requests[0]), { ...expectedResult(0), replay: true });
      assert.deepEqual(await store.commitPearlGround({ ...requests[0], world: `${scope}-other` }), { ok: false, why: 'operation' });
      assert.deepEqual(await snapshot(), committed); record();
      check = 'second-request-persisted-unsent-and-both-journal-rows-pending';
      await journal.prepare('ground', requests[1]);
      assert.equal(await store.loadPearlGroundOperation(requests[1].operationId), null);
      assert.equal((await store.loadUnique(requests[1].uid)).version, 1);
      assert.equal((await journal.list()).length, 2); record();
    } else if (name === 'recover') {
      let sends = 0;
      const controlled = { ...store, async commitPearlGround(r) { sends++; assert.deepEqual(r, requests[1]); return store.commitPearlGround(r); },
        async commitPearl() { throw new Error('Unexpected family dispatch'); } };
      const sessions = new ProfileSessions(controlled, null, { journal });
      check = 'fresh-process-scan-admission-and-read-only-committed-recovery';
      await assert.rejects(sessions.open(1, ids.accounts[0]), { code: 'recovery' });
      const expected = requests.map((r, i) => ({ operationId: r.operationId, outcome: i === 0 ? 'committed' : 'pending' }))
        .sort((a, b) => a.operationId.localeCompare(b.operationId));
      assert.deepEqual(await sessions.recoverPearls(), expected); assert.equal(sends, 0);
      assert.deepEqual((await sessions.open(1, ids.accounts[0])).pearls, f.after[0].pearls); record();
      check = 'unsent-request-keeps-one-account-and-UID-reserved';
      assert.equal(sessions.pearls.accountIds.size, 1);
      await assert.rejects(sessions.open(2, ids.accounts[1]), { code: 'busy' });
      await assert.rejects(sessions.resumePearl(requests[1].operationId), { code: 'operation' });
      assert.equal(sends, 0); record();
      check = 'explicit-resume-one-exact-request-no-new-UUID-or-builder';
      assert.deepEqual((await sessions.resumePearlGround(requests[1].operationId)).receipt, expectedResult(1));
      assert.equal(sends, 1); assert.equal(sessions.pearls.accountIds.size, 0);
      await assert.rejects(sessions.resumePearlGround(requests[1].operationId), { code: 'operation' });
      assert.deepEqual((await sessions.open(2, ids.accounts[1])).pearls, f.after[1].pearls);
      await sessions.flush(); record();
      check = 'both-profiles-ledgers-locations-receipts-current-and-diary-terminal';
      await assertCommitted(); assert.deepEqual(await journal.list(), []);
      for (const r of requests) assert.equal((await journal.prepare('ground', r)).state, 'committed'); record();
    } else if (name === 'verify') {
      check = 'third-process-current-state-no-dispatch-or-history-apply';
      const controlled = { ...store, async commitPearlGround() { throw new Error('Unexpected dispatch'); },
        async commitPearl() { throw new Error('Unexpected dispatch'); } };
      const sessions = new ProfileSessions(controlled, null, { journal });
      assert.deepEqual(await sessions.recoverPearls(), []); await assertCommitted();
      for (let i = 0; i < ids.accounts.length; i++) assert.deepEqual(await sessions.open(i + 1, ids.accounts[i]), f.after[i]);
      await sessions.flush(); record();
      check = 'historical-replay-preserves-newer-progress';
      const progress = structuredClone(f.after[0]); progress.xp += 7;
      assert.deepEqual(await store.saveProfile(ids.accounts[0], progress, 5), { ok: true, version: 6 });
      const current = await snapshot();
      assert.deepEqual(await store.commitPearlGround(requests[0]), { ...expectedResult(0), replay: true });
      assert.deepEqual(await snapshot(), current); record();
      check = 'public-commit-RPC-denied-and-fixture-state-unchanged';
      const publicClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
      const { operationId, ...request } = requests[0];
      const denied = await publicClient.rpc('mn_commit_pearl_ground', { p_operation_id: operationId, p_request: request });
      assert.equal(denied.error?.code, '42501'); assert.deepEqual(await snapshot(), current); record();
      check = 'terminal-journal-idempotence-and-reopen-denied';
      for (const r of requests) {
        const row = await journal.prepare('ground', r); assert.equal(row.state, 'committed');
        assert.deepEqual(await journal.resolve('ground', r, 'committed'), row);
        await assert.rejects(journal.resolve('ground', r, 'rejected'), { code: 'operation' });
      }
      record();
    } else {
      check = 'all-known-gameplay-and-journal-fixtures-settled-before-cleanup';
      assert.deepEqual(await journal.list(), []);
      for (const r of requests) {
        assert.equal((await journal.prepare('ground', r)).state, 'committed');
        assert.deepEqual((await store.loadPearlGroundOperation(r.operationId)).result, expectedResult(requests.indexOf(r)));
      }
      assert.equal((await store.loadProfile(ids.accounts[0])).version, 6);
      assert.equal((await store.loadProfile(ids.accounts[1])).version, 3); record();
      check = 'exact-synthetic-fixtures-removed-two-audit-rows-retained';
      for (const [table, key, values] of [
        ['mn_pearl_ground_operations', 'operation_id', Object.values(ids.operations)],
        ['mn_pearl_operations', 'operation_id', Object.values(ids.operations)],
        ['mn_unique_items', 'uid', pearls.map((p) => p.uid)], ['mn_profiles', 'player_id', ids.accounts],
      ]) {
        const r = await admin.from(table).delete().in(key, values);
        assert.equal(r.error, null, 'Fixture cleanup failed');
        assert.deepEqual(await rawRows(table, key, key, values), []);
      }
      assert.deepEqual(await rawRows('mn_pearl_locations', 'uid', 'uid', pearls.map((p) => p.uid)), []);
      assert.deepEqual(await store.listPearlGround(scope), []);
      const audit = await rawRows('mn_pearl_intents', 'operation_id,state', 'operation_id', Object.values(ids.operations));
      assert.deepEqual(audit, requests.map((r) => ({ operation_id: r.operationId, state: 'committed' }))
        .sort((a, b) => a.operation_id.localeCompare(b.operation_id))); record();
    }
  } catch (error) {
    // Only bounded error categories leave the process; never provider messages, bodies or credentials.
    const names = ['AssertionError', 'StoreError', 'TypeError', 'SyntaxError', 'Error'];
    const codes = ['ERR_ASSERTION', 'unavailable', 'operation', 'response', 'configuration', 'ownership',
      'conflict', 'kind', 'busy', 'recovery', 'flush', 'cancelled', 'ENOENT', 'EACCES'];
    console.log(JSON.stringify({ phase: name, check, ok: false }));
    console.log(JSON.stringify({ phase: name, failureType: names.includes(error.name) ? error.name : 'Error',
      code: codes.includes(error.code) ? error.code : null }));
    process.exitCode = 1;
  }
}
