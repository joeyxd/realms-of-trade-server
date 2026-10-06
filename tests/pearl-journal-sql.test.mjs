import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORLD = 'island:coral';
const op = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migrations = await Promise.all([
  '001_store.sql', '002_accounts.sql', '003_pearl_operations.sql', '004_pearl_ground.sql', '005_pearl_journal.sql',
  '006_pearl_same_holder.sql',
].map((name) => readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8')));

const request = (patch = {}) => ({
  uid: 'journal-pearl-1', kind: 'brasa', from: A, to: B, expectedVersion: 2,
  profiles: [
    { id: A, expectedVersion: 4, data: { v: 1, gold: 0 } },
    { id: B, expectedVersion: 8, data: { v: 1, gold: 25 } },
  ],
  ...patch,
});
const groundRequest = (patch = {}) => ({
  uid: 'journal-ground-1', kind: 'tinta', from: null, to: null, expectedVersion: 0,
  profiles: [], world: WORLD, ground: { x: 1.5, z: -4, availableAt: 10, returnAt: 20 }, ...patch,
});

function rpcFetchFor(db, requests = []) {
  const functions = {
    mn_prepare_pearl_intent: (a) => db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb) as data',
      [a.p_scope, a.p_family, a.p_operation_id, a.p_request]),
    mn_resolve_pearl_intent: (a) => db.query('select public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5) as data',
      [a.p_scope, a.p_family, a.p_operation_id, a.p_request, a.p_state]),
    mn_list_pearl_intents: (a) => db.query('select public.mn_list_pearl_intents($1,$2::uuid,$3) as data',
      [a.p_scope, a.p_after_id, a.p_limit]),
  };
  return async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1);
    requests.push({ name, method: init.method, body: JSON.parse(init.body ?? '{}') });
    const run = functions[name];
    if (!run) return new Response(JSON.stringify({ message: 'Unknown RPC', code: '42883' }), { status: 404 });
    try {
      const args = JSON.parse(init.body ?? '{}');
      const result = await run(args);
      const data = result.rows[0].data;
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message, code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
}

function clientFor(db, requests = [], key = 'service-role-test-key') {
  return createClient('http://supabase.test', key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: rpcFetchFor(db, requests) },
  });
}

async function freshDatabase() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO PUBLIC;');
  for (const migration of migrations) await db.exec(migration);
  // Reapplication is part of the migration contract.
  await db.exec(migrations.at(-1));
  await db.exec('SET ROLE service_role');
  return db;
}

const prepare = (client, scope, family, id, payload) => client.rpc('mn_prepare_pearl_intent', {
  p_scope: scope, p_family: family, p_operation_id: id, p_request: payload,
});
const resolve = (client, scope, family, id, payload, state) => client.rpc('mn_resolve_pearl_intent', {
  p_scope: scope, p_family: family, p_operation_id: id, p_request: payload, p_state: state,
});
const list = (client, scope, after, limit) => client.rpc('mn_list_pearl_intents', {
  p_scope: scope, p_after_id: after, p_limit: limit,
});

test('journal prepare is exact and idempotent, resolve is terminal and family/scope/request bound', async () => {
  const db = await freshDatabase();
  try {
    const client = clientFor(db);
    const payload = request();
    const first = await prepare(client, WORLD, 'pearl', op(1), payload);
    assert.ifError(first.error);
    assert.deepEqual(first.data, { operationId: op(1), scope: WORLD, family: 'pearl', request: payload, state: 'pending' });
    assert.deepEqual((await prepare(client, WORLD, 'pearl', op(1), payload)).data, first.data);
    assert.deepEqual((await resolve(client, WORLD, 'pearl', op(1), payload, 'committed')).data,
      { ...first.data, state: 'committed' });
    assert.equal((await prepare(client, WORLD, 'pearl', op(1), request({ expectedVersion: 3 }))).error?.code, 'MNP02');
    assert.equal((await prepare(client, 'other:world', 'pearl', op(1), payload)).error?.code, 'MNP02');
    assert.equal((await prepare(client, WORLD, 'ground', op(1), payload)).error?.code, 'MNP02');
    // Exact prepare remains idempotent even after resolution and never reopens the row.
    assert.equal((await prepare(client, WORLD, 'pearl', op(1), payload)).data.state, 'committed');
    assert.deepEqual((await resolve(client, WORLD, 'pearl', op(1), payload, 'committed')).data,
      { ...first.data, state: 'committed' });
    for (const [scope, family, changed, state] of [
      ['other:world', 'pearl', payload, 'conflict'],
      [WORLD, 'ground', payload, 'conflict'],
      [WORLD, 'pearl', request({ expectedVersion: 3 }), 'conflict'],
      [WORLD, 'pearl', payload, 'conflict'],
    ]) {
      const result = state === 'conflict'
        ? await resolve(client, scope, family, op(1), changed, state)
        : await prepare(client, scope, family, op(1), changed);
      assert.equal(result.error?.code, 'MNP02');
    }
    assert.equal((await db.query('select state from public.mn_pearl_intents where operation_id=$1::uuid', [op(1)])).rows[0].state, 'committed');

    const pending = await prepare(client, WORLD, 'ground', op(2), groundRequest());
    assert.ifError(pending.error);
    assert.equal(pending.data.state, 'pending');
    assert.equal((await resolve(client, WORLD, 'ground', op(2), groundRequest(), 'conflict')).data.state, 'conflict');
    assert.equal((await resolve(client, WORLD, 'ground', op(2), groundRequest(), 'conflict')).data.state, 'conflict');
    assert.equal((await resolve(client, WORLD, 'ground', op(2), groundRequest(), 'rejected')).error?.code, 'MNP02');
    assert.equal((await resolve(client, WORLD, 'ground', op(2), groundRequest(), null)).error?.code, 'MNP02');
    assert.equal((await resolve(client, WORLD, 'ground', op(99), groundRequest(), 'committed')).error?.code, 'MNP02');
  } finally { await db.close(); }
});

test('pending intent pages are scope filtered, UUID sorted, exclusive and omit terminal rows', async () => {
  const db = await freshDatabase();
  try {
    const client = clientFor(db);
    await prepare(client, WORLD, 'pearl', op(9), request());
    await prepare(client, WORLD, 'ground', op(3), groundRequest());
    await prepare(client, WORLD, 'pearl', op(6), request({ uid: 'journal-pearl-6' }));
    await prepare(client, 'other:world', 'ground', op(4), groundRequest({ world: 'other:world' }));
    await resolve(client, WORLD, 'pearl', op(6), request({ uid: 'journal-pearl-6' }), 'rejected');
    const page = await list(client, WORLD, null, 1);
    assert.ifError(page.error);
    assert.deepEqual(page.data.map((row) => row.operationId), [op(3)]);
    const next = await list(client, WORLD, page.data[0].operationId, 10);
    assert.ifError(next.error);
    assert.deepEqual(next.data.map((row) => row.operationId), [op(9)]);
    assert.deepEqual(await list(client, WORLD, op(9), 10).then((r) => r.data), []);
    assert.deepEqual(await list(client, 'other:world', null, 10).then((r) => r.data.map((row) => row.operationId)), [op(4)]);
    assert.equal((await list(client, WORLD, null, 0)).error?.code, 'MNP02');
    assert.equal((await list(client, WORLD, null, 257)).error?.code, 'MNP02');
  } finally { await db.close(); }
});

test('Supabase SDK adapter sends exact journal args and accepts JSONB row/list responses', async () => {
  const db = await freshDatabase();
  try {
    const requests = [], client = clientFor(db, requests), journal = createSupabasePearlJournal(client, WORLD);
    const source = newProfile(), destination = newProfile();
    source.pearls.swallowed = { uid: 'journal-pearl-1', kind: 'brasa' };
    destination.pearls.bag = [{ uid: 'journal-pearl-1', kind: 'brasa' }];
    const pearl = request({ profiles: [
      { id: A, expectedVersion: 4, data: source }, { id: B, expectedVersion: 8, data: destination },
    ] });
    const prepared = await journal.prepare('pearl', { operationId: op(20), ...pearl });
    assert.deepEqual(prepared, { operationId: op(20), scope: WORLD, family: 'pearl', request: pearl, state: 'pending' });
    const ground = groundRequest();
    await journal.prepare('ground', { operationId: op(21), ...ground });
    assert.deepEqual((await journal.list({ afterId: op(20), limit: 8 })).map((row) => row.operationId), [op(21)]);
    const resolved = await journal.resolve('pearl', { operationId: op(20), ...pearl }, 'committed');
    assert.equal(resolved.state, 'committed');
    assert.deepEqual(requests.map((r) => r.name), [
      'mn_prepare_pearl_intent', 'mn_prepare_pearl_intent', 'mn_list_pearl_intents', 'mn_resolve_pearl_intent',
    ]);
    assert.deepEqual(requests[0].body, { p_scope: WORLD, p_family: 'pearl', p_operation_id: op(20), p_request: pearl });
    assert.deepEqual(requests[2].body, { p_scope: WORLD, p_after_id: op(20), p_limit: 8 });
    assert.deepEqual(requests[3].body, { p_scope: WORLD, p_family: 'pearl', p_operation_id: op(20), p_request: pearl, p_state: 'committed' });
  } finally { await db.close(); }
});

test('journal rejects malformed request structure, endpoint generations and ground scope/location', async () => {
  const db = await freshDatabase();
  try {
    const client = clientFor(db);
    const invalid = [
      ['pearl', request({ extra: true })],
      ['pearl', request({ kind: 'mythic' })],
      ['pearl', request({ expectedVersion: -1 })],
      ['pearl', request({ expectedVersion: 1.5 })],
      ['pearl', request({ expectedVersion: 0 })],
      ['pearl', request({ from: 'null' })],
      ['pearl', request({ from: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })],
      ['pearl', request({ profiles: [{ id: A, expectedVersion: 0, data: { v: 1 } }, { id: B, expectedVersion: 8, data: { v: 1 } }] })],
      ['pearl', request({ profiles: [{ id: A, expectedVersion: 4, data: { v: 1 } }, { id: A, expectedVersion: 8, data: { v: 1 } }] })],
      ['ground', groundRequest({ world: 'wrong:world' })],
      ['ground', groundRequest({ expectedVersion: 0, ground: { x: 0, z: 0, availableAt: 20, returnAt: 10 } })],
      ['ground', groundRequest({ ground: null, to: B })],
      ['ground', groundRequest({ profiles: [{ id: A, expectedVersion: 1, data: { v: 1 } }] })],
    ];
    for (let i = 0; i < invalid.length; i++) {
      const [family, payload] = invalid[i];
      const result = await prepare(client, WORLD, family, op(30 + i), payload);
      assert.equal(result.error?.code, 'MNP02', `invalid fixture ${i} was accepted`);
    }
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_intents')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('service raw writes cannot alter intent identity, reopen terminals, or delete journal evidence', async () => {
  const db = await freshDatabase();
  try {
    const client = clientFor(db), payload = request();
    await prepare(client, WORLD, 'pearl', op(40), payload);
    await assert.rejects(db.query('update public.mn_pearl_intents set request=$2::jsonb where operation_id=$1::uuid',
      [op(40), request({ expectedVersion: 9 })]), (error) => error.code === 'MNP02');
    await assert.rejects(db.query("update public.mn_pearl_intents set state='pending' where operation_id=$1::uuid", [op(40)]),
      (error) => error.code === 'MNP02');
    await db.query("update public.mn_pearl_intents set state='committed' where operation_id=$1::uuid", [op(40)]);
    await assert.rejects(db.query("update public.mn_pearl_intents set state='conflict' where operation_id=$1::uuid", [op(40)]),
      (error) => error.code === 'MNP02');
    await assert.rejects(db.query('delete from public.mn_pearl_intents where operation_id=$1::uuid', [op(40)]),
      (error) => error.code === 'MNP02' || error.code === '42501');
    await assert.rejects(db.query("insert into public.mn_pearl_intents(operation_id,scope,family,request,state) values ($1::uuid,$2,'pearl',$3::jsonb,'committed')",
      [op(41), WORLD, payload]), (error) => error.code === 'MNP02');
    assert.equal((await db.query('select state from public.mn_pearl_intents where operation_id=$1::uuid', [op(40)])).rows[0].state, 'committed');
  } finally { await db.close(); }
});

test('public roles cannot read journal rows or execute journal RPCs', async () => {
  const db = await freshDatabase();
  try {
    const client = clientFor(db);
    await prepare(client, WORLD, 'pearl', op(50), request());
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('select * from public.mn_pearl_intents'), (error) => error.code === '42501');
    await assert.rejects(db.query("select * from public.mn_list_pearl_intents('island:coral', null, 10)"), (error) => error.code === '42501');
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(db.query('select public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)',
      [WORLD, 'pearl', op(51), request()]), (error) => error.code === '42501');
    await assert.rejects(db.query('select public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)',
      [WORLD, 'pearl', op(50), request(), 'committed']), (error) => error.code === '42501');
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await db.query('select count(*)::int as n from public.mn_pearl_intents')).rows[0].n, 1);
  } finally { await db.close(); }
});
