// Explicit live canary: isolated accounts/UIDs only; immutable journal audit rows are retained.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore, StoreError } from '../server/store.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { newProfile, sanitizeProfile } from '../src/sim/systems/inventory.js';

if (!process.argv.includes('--live')) {
  console.log('Usage: node tools/verify-pearl-journal.mjs --live');
  console.log('Uses server .env credentials. Retains four terminal audit rows in an isolated canary scope.');
  console.log('On success, automatically deletes the exact synthetic profiles, UID ledger/location and operation receipts.');
  process.exitCode = 1;
} else {
  const phaseAt = process.argv.indexOf('--phase');
  if (phaseAt < 0) run();
  else await phase(process.argv[phaseAt + 1], process.argv[phaseAt + 2]);
}

function run() {
  const token = randomUUID(), scope = `canary-journal-${token}`;
  const accounts = [randomUUID(), randomUUID()];
  const uids = ['sale', 'pearl', 'mint'].map((name) => `canary-journal-${name}-${token}`);
  const operations = Array.from({ length: 5 }, () => randomUUID());
  const data = accounts.map((id, i) => { const p = newProfile(); p.pirateId = `account:${id}`; p.gold = 10 + i * 10; return sanitizeProfile(p); });
  const owned = structuredClone(data[0]); owned.pearls.bag.push({ uid: uids[0], kind: 'brasa' });
  const sold = structuredClone(data[0]); sold.gold += 600;
  const granted = structuredClone(data[1]); granted.pearls.bag.push({ uid: uids[1], kind: 'escarcha' });
  const minted = structuredClone(sold); minted.pearls.bag.push({ uid: uids[2], kind: 'tinta' });
  const ground = { x: 4, z: 9, availableAt: 100, returnAt: 200 };
  const profile = (id, expectedVersion, data) => ({ id, expectedVersion, data });
  const seed = { operationId: operations[0], uid: uids[0], kind: 'brasa', from: null, to: accounts[0], expectedVersion: 0,
    profiles: [profile(accounts[0], 1, owned)] };
  const sale = { operationId: operations[1], uid: uids[0], kind: 'brasa', from: accounts[0], to: null, expectedVersion: 1,
    profiles: [profile(accounts[0], 2, sold)], world: scope, ground };
  const pearl = { operationId: operations[2], uid: uids[1], kind: 'escarcha', from: null, to: accounts[1], expectedVersion: 0,
    profiles: [profile(accounts[1], 1, granted)] };
  const mint = { operationId: operations[3], uid: uids[2], kind: 'tinta', from: null, to: accounts[0], expectedVersion: 0,
    profiles: [profile(accounts[0], 3, minted)], world: scope, ground: null };
  const relocate = { operationId: operations[4], uid: uids[0], kind: 'brasa', from: null, to: null, expectedVersion: 2,
    profiles: [], world: scope, ground: { ...ground, x: -7 } };
  const fixture = { scope, accounts, uids, operations, data, seed, sale, pearl, mint, relocate };
  fs.mkdirSync('.scratch', { recursive: true }); fs.mkdirSync('shots/review', { recursive: true });
  const file = path.resolve('.scratch', `m5-journal-live-${token}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2));
  let log = '', passed = true, cleanup = false;
  for (const name of ['prepare-committed', 'recover-committed', 'prepare-unsent', 'resume-unsent', 'lost-terminal-reply']) {
    const child = spawnSync(process.execPath, [process.argv[1], '--live', '--phase', name, file], { encoding: 'utf8', timeout: 90000 });
    log += child.stdout ?? '';
    // Provider exceptions can contain credentials. Child output is structured/redacted; never print stderr.
    if (child.status !== 0) { passed = false; break; }
  }
  // Only a completely settled run is eligible for fixture deletion. Failed runs keep exact recovery evidence.
  if (passed) {
    const child = spawnSync(process.execPath, [process.argv[1], '--live', '--phase', 'cleanup', file], { encoding: 'utf8', timeout: 90000 });
    log += child.stdout ?? ''; cleanup = child.status === 0; passed &&= cleanup;
  }
  fs.writeFileSync('shots/review/m5-journal-live-canary.log', log);
  const checks = log.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  fs.writeFileSync('shots/review/m5-journal-live-canary.json', JSON.stringify({ scope: fixture.scope,
    fixtureFile: path.relative(process.cwd(), file), phases: checks, passed, gameplayFixturesRemoved: cleanup,
    retainedAuditRows: cleanup ? 4 : null }, null, 2));
  console.log(log.trim());
  console.log(JSON.stringify({ passed, gameplayFixturesRemoved: cleanup, retainedAuditRows: cleanup ? 4 : null }));
  process.exitCode = passed ? 0 : 1;
}

async function phase(name, file) {
  let check = name;
  const record = (ok) => console.log(JSON.stringify({ phase: name, check, ok }));
  try {
    const resolved = path.resolve(file);
    assert.equal(path.dirname(resolved), path.resolve('.scratch'));
    assert.match(path.basename(resolved), /^m5-journal-live-[0-9a-f-]{36}\.json$/);
    const f = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    assert.match(f.scope, /^canary-journal-[0-9a-f-]{36}$/);
    for (const uid of f.uids) assert.match(uid, /^canary-journal-(sale|pearl|mint)-[0-9a-f-]{36}$/);
    for (const id of [...f.accounts, ...f.operations]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Set(f.accounts).size, 2); assert.equal(new Set(f.uids).size, 3); assert.equal(new Set(f.operations).size, 5);
    process.loadEnvFile('.env');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) } };
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, options);
    const store = createSupabaseStore(admin), journal = createSupabasePearlJournal(admin, f.scope);
    const audited = [['ground', f.sale], ['pearl', f.pearl], ['ground', f.mint], ['ground', f.relocate]];
    let mutations = 0;
    const controlled = { ...store,
      async commitPearl(raw) { mutations++; return store.commitPearl(raw); },
      async commitPearlGround(raw) { mutations++; assert.deepEqual(raw, name === 'resume-unsent' ? f.mint : f.relocate); return store.commitPearlGround(raw); },
    };
    if (name === 'prepare-committed') {
      check = 'isolated-fixture-absence-and-profiles';
      for (const id of f.accounts) assert.equal(await store.loadProfile(id), null);
      for (const uid of f.uids) assert.equal(await store.loadUnique(uid), null);
      assert.deepEqual(await journal.list(), []);
      for (let i = 0; i < f.accounts.length; i++) assert.equal((await store.initializeProfile(f.accounts[i], f.data[i])).version, 1);
      assert.equal((await store.commitPearl(f.seed)).ok, true); record(true);
      check = 'exact-prepare-idempotence-and-identity-guards';
      const sale = await journal.prepare('ground', f.sale);
      assert.deepEqual(await journal.prepare('ground', f.sale), sale);
      await assert.rejects(journal.prepare('ground', { ...f.sale, ground: { ...f.sale.ground, x: 3 } }), { code: 'operation' });
      await assert.rejects(createSupabasePearlJournal(admin, `${f.scope}-other`).prepare('ground', { ...f.sale, world: `${f.scope}-other` }), { code: 'operation' });
      await journal.prepare('pearl', f.pearl); record(true);
      check = 'exclusive-paging-and-scope-isolation';
      const ids = [f.sale.operationId, f.pearl.operationId].sort();
      const first = await journal.list({ limit: 1 }); assert.equal(first[0].operationId, ids[0]);
      const second = await journal.list({ limit: 1, afterId: ids[0] }); assert.equal(second[0].operationId, ids[1]);
      assert.deepEqual(await journal.list({ afterId: ids[1] }), []);
      assert.deepEqual(await createSupabasePearlJournal(admin, `${f.scope}-other`).list(), []); record(true);
      check = 'both-families-committed-before-process-exit';
      assert.equal((await store.commitPearlGround(f.sale)).ok, true);
      assert.equal((await store.commitPearl(f.pearl)).ok, true);
      assert.equal((await journal.list()).length, 2); record(true);
    } else if (name === 'recover-committed') {
      check = 'fresh-process-admission-gate-and-read-only-recovery';
      const sessions = new ProfileSessions(controlled, null, { journal });
      await assert.rejects(sessions.open(1, f.accounts[0]), { code: 'recovery' });
      const expected = [f.sale, f.pearl].map((r) => ({ operationId: r.operationId, outcome: 'committed' })).sort((a, b) => a.operationId.localeCompare(b.operationId));
      assert.deepEqual(await sessions.recoverPearls(), expected); assert.equal(mutations, 0); record(true);
      check = 'gold-once-authoritative-profiles-and-terminal-omission';
      assert.equal((await sessions.open(1, f.accounts[0])).gold, 610);
      assert.equal((await sessions.open(2, f.accounts[1])).pearls.bag[0].uid, f.uids[1]);
      assert.equal((await store.loadPearlLocation(f.uids[0])).version, 2);
      assert.deepEqual(await journal.list(), []); await sessions.flush(); record(true);
    } else if (name === 'prepare-unsent') {
      check = 'request-persisted-without-dispatch';
      await journal.prepare('ground', f.mint);
      assert.equal(await store.loadUnique(f.uids[2]), null);
      assert.equal(await store.loadPearlGroundOperation(f.mint.operationId), null);
      assert.equal((await journal.list())[0].operationId, f.mint.operationId); record(true);
    } else if (name === 'resume-unsent') {
      check = 'fresh-process-pending-account-and-UID-fences';
      const sessions = new ProfileSessions(controlled, null, { journal });
      await assert.rejects(sessions.open(1, f.accounts[0]), { code: 'recovery' });
      assert.deepEqual(await sessions.recoverPearls(), [{ operationId: f.mint.operationId, outcome: 'pending' }]);
      assert.equal(mutations, 0);
      await assert.rejects(sessions.open(1, f.accounts[0]), { code: 'busy' });
      await sessions.open(2, f.accounts[1]);
      await assert.rejects(sessions.commitPearlGround({ ...f.mint, operationId: randomUUID() }, () => { throw new Error('builder must not run'); }), { code: 'busy' });
      await assert.rejects(sessions.resumePearl(f.mint.operationId), { code: 'operation' }); record(true);
      check = 'one-exact-persisted-request-no-new-builder-or-UUID';
      assert.equal((await sessions.resumePearlGround(f.mint.operationId)).receipt.location.version, 1);
      await assert.rejects(sessions.resumePearlGround(f.mint.operationId), { code: 'operation' });
      assert.equal(mutations, 1);
      assert.equal((await sessions.open(1, f.accounts[0])).gold, 610);
      assert.equal((await store.loadProfile(f.accounts[0])).data.pearls.bag[0].uid, f.uids[2]);
      assert.deepEqual(await journal.list(), []); await sessions.flush(); record(true);
    } else if (name === 'lost-terminal-reply') {
      check = 'applied-terminal-write-lost-reply-keeps-local-fence';
      let lose = true;
      const wrapped = { ...journal, async resolve(...args) {
        const reply = await journal.resolve(...args);
        if (lose) { lose = false; throw new StoreError('unavailable'); }
        return reply;
      } };
      const sessions = new ProfileSessions(controlled, null, { journal: wrapped }); await sessions.recoverPearls();
      await assert.rejects(sessions.commitPearlGround(f.relocate, () => []), { code: 'unavailable' });
      assert.equal(mutations, 1);
      await assert.rejects(sessions.commitPearlGround({ ...f.relocate, operationId: randomUUID(), expectedVersion: 3 }, () => []), { code: 'busy' });
      assert.deepEqual(await journal.list(), []); record(true);
      check = 'read-only-reconciliation-no-second-relocation';
      assert.equal((await sessions.reconcilePearlGround(f.relocate.operationId)).receipt.location.version, 3);
      assert.equal(mutations, 1);
      assert.deepEqual((await store.loadPearlLocation(f.uids[0])).ground, f.relocate.ground);
      await assert.rejects(sessions.flush(), { code: 'flush' }); // Permanent error accounting survives recovery.
      record(true);
      check = 'terminal-idempotence-and-reopen-denied';
      for (const [family, concrete] of audited) {
        const row = await journal.prepare(family, concrete); assert.equal(row.state, 'committed');
        assert.deepEqual(await journal.resolve(family, concrete, 'committed'), row);
        await assert.rejects(journal.resolve(family, concrete, 'rejected'), { code: 'operation' });
      }
      const { world: _world, ground: _ground, ...wrongFamily } = f.sale;
      await assert.rejects(journal.prepare('pearl', wrongFamily), { code: 'operation' }); record(true);
      check = 'service-delete-denied-and-audit-retained';
      const denied = await admin.from('mn_pearl_intents').delete().eq('operation_id', f.sale.operationId);
      assert.ok(['42501', 'MNP02'].includes(denied.error?.code));
      assert.equal((await journal.prepare('ground', f.sale)).state, 'committed'); record(true);
      check = 'public-journal-writes-denied';
      const publicClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLIC_KEY, options);
      const { operationId: _id, ...request } = f.sale;
      for (const reply of [
        await publicClient.from('mn_pearl_intents').insert({ operation_id: randomUUID(), scope: f.scope, family: 'ground', request, state: 'pending' }),
        await publicClient.from('mn_pearl_intents').update({ state: 'rejected' }).eq('operation_id', f.sale.operationId),
        await publicClient.from('mn_pearl_intents').delete().eq('operation_id', f.sale.operationId),
      ]) assert.equal(reply.error?.code, '42501');
      record(true);
    } else if (name === 'cleanup') {
      check = 'all-four-journal-rows-terminal-before-cleanup';
      assert.deepEqual(await journal.list(), []);
      for (const [family, concrete] of audited) assert.equal((await journal.prepare(family, concrete)).state, 'committed');
      record(true);
      check = 'exact-gameplay-fixtures-removed-and-audit-retained';
      for (const [table, key, values] of [
        ['mn_pearl_ground_operations', 'operation_id', f.operations], ['mn_pearl_operations', 'operation_id', f.operations],
        ['mn_unique_items', 'uid', f.uids], ['mn_profiles', 'player_id', f.accounts],
      ]) {
        const reply = await admin.from(table).delete().in(key, values); assert.equal(reply.error, null);
        const remaining = await admin.from(table).select(key).in(key, values); assert.equal(remaining.error, null); assert.deepEqual(remaining.data, []);
      }
      const locations = await admin.from('mn_pearl_locations').select('uid').in('uid', f.uids);
      assert.equal(locations.error, null); assert.deepEqual(locations.data, []);
      assert.deepEqual(await store.listPearlGround(f.scope), []);
      const audit = await admin.from('mn_pearl_intents').select('operation_id,state').in('operation_id', audited.map(([, r]) => r.operationId));
      assert.equal(audit.error, null); assert.equal(audit.data.length, 4); assert.ok(audit.data.every((r) => r.state === 'committed'));
      record(true);
    } else throw new Error('phase');
  } catch (error) {
    record(false); console.log(JSON.stringify({ phase: name, failureType: error.name, code: error.code ?? null })); process.exitCode = 1;
  }
}
