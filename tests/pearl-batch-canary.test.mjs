import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../server/store.mjs';
import { createSupabasePearlJournal } from '../server/pearlJournal.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { database } from './helpers/pearl-batch-sql.mjs';
import { batchPhases, batchFixture, newBatchManifest, checkedBatchManifest, verifyBatchPhase } from '../tools/verify-pearl-batch.mjs';

// Exercise the live runner itself through the SDK against local SQL; no .env or external requests.
const routes = {
  mn_initialize_profile: ['mn_initialize_profile($1::uuid,$2::jsonb,$3)', ['p_player_id','p_data','p_legacy_key']],
  mn_load_profile: ['mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl: ['mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_ground: ['mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_location: ['mn_load_pearl_location($1)', ['p_uid']],
  mn_list_pearl_ground: ['mn_list_pearl_ground($1,$2,$3::integer)', ['p_world','p_after_uid','p_limit']],
  mn_load_pearl_ground_operation: ['mn_load_pearl_ground_operation($1::uuid)', ['p_operation_id']],
  mn_commit_pearl_batch: ['mn_commit_pearl_batch($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_batch_operation: ['mn_load_pearl_batch_operation($1::uuid)', ['p_operation_id']],
  mn_valid_pearl_batch: ['mn_valid_pearl_batch($1::jsonb)', ['p_request']],
  mn_prepare_pearl_intent: ['mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)', ['p_scope','p_family','p_operation_id','p_request']],
  mn_resolve_pearl_intent: ['mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)', ['p_scope','p_family','p_operation_id','p_request','p_state']],
  mn_list_pearl_intents: ['mn_list_pearl_intents($1,$2::uuid,$3::integer)', ['p_scope','p_after_id','p_limit']],
};
const tables = { mn_profiles: 'player_id', mn_unique_items: 'uid', mn_pearl_locations: 'uid',
  mn_pearl_operations: 'operation_id', mn_pearl_ground_operations: 'operation_id',
  mn_pearl_batch_operations: 'operation_id', mn_pearl_intents: 'operation_id' };
function client(db, publicRole = false, calls = []) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method: init.method });
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    try {
      if (publicRole) await db.exec('RESET ROLE; SET ROLE anon');
      if (url.pathname.includes('/rpc/')) {
        const [sql, keys] = routes[name];
        return response((await db.query(`select public.${sql} as data`, keys.map((k) => body[k]))).rows[0].data);
      }
      const key = tables[name]; assert.ok(key);
      if (init.method === 'POST') {
        await db.query(`insert into public.${name}(operation_id,request) values($1::uuid,$2::jsonb)`, [body.operation_id, body.request]);
        return response(null);
      }
      const filter = url.searchParams.get(key); assert.ok(filter);
      const values = filter.startsWith('in.(') ? filter.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')) : [filter.slice(3)];
      const cast = key === 'uid' ? 'text' : 'uuid';
      if (init.method === 'DELETE') {
        const args = [], clauses = [];
        for (const [column, filter] of url.searchParams) {
          assert.match(column, /^[a-z_]+$/);
          if (filter === 'is.null') { clauses.push(`${column} IS NULL`); continue; }
          assert.ok(filter.startsWith('eq.'));
          const columnCast = ['request','result','data','ground'].includes(column) ? 'jsonb' :
            ['player_id','operation_id','holder'].includes(column) ? 'uuid' : column === 'version' ? 'integer' : column === 'since' ? 'timestamptz' : 'text';
          args.push(filter.slice(3)); clauses.push(`${column}=$${args.length}::${columnCast}`);
        }
        await db.query(`delete from public.${name} where ${clauses.join(' AND ')}`, args); return response(null);
      }
      const columns = url.searchParams.get('select');
      assert.match(columns, /^[a-z_,]+$/);
      const rows = (await db.query(`select ${columns} from public.${name} where ${key}=ANY($1::${cast}[]) order by ${key}`, [values])).rows;
      const single = new Headers(init.headers).get('accept')?.includes('object+json');
      return response(single ? rows[0] ?? null : rows);
    } catch (err) { return response({ message: 'Local SQL rejection', code: err.code ?? 'XX000' }, 400); }
    finally { if (publicRole) await db.exec('RESET ROLE; SET ROLE service_role'); }
  };
  return createClient('http://supabase.test', 'canary-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
}
async function context(db, manifest, checks) {
  const f = batchFixture(manifest.ids), admin = client(db);
  return { admin, store: createSupabaseStore(admin), journal: createSupabasePearlJournal(admin, f.scope),
    publicClient: client(db, true), record: (label) => checks.push(label), persist: async () => {} };
}

test('live batch runner requires explicit opt-in without reading environment', () => {
  const r = spawnSync(process.execPath, ['tools/verify-pearl-batch.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 1); assert.match(r.stdout, /Usage:.*--live/); assert.equal(r.stderr, '');
});
test('CLI refuses a scratch junction before creating a live manifest or reading credentials', () => {
  fs.mkdirSync('.scratch', { recursive: true });
  const root = path.resolve(fs.mkdtempSync(path.join('.scratch', 'batch-canary-path-'))), target = path.join(root, 'outside');
  fs.mkdirSync(target); fs.symlinkSync(target, path.join(root, '.scratch'), 'junction');
  const script = fileURLToPath(new URL('../tools/verify-pearl-batch.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--live'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 1); assert.match(r.stderr, /AssertionError/); assert.deepEqual(fs.readdirSync(target), []);
});
test('batch canary rejects altered identifiers, phases and paths before any dependency access', async () => {
  const manifest = newBatchManifest(); checkedBatchManifest(manifest, 'prepare');
  for (const mutate of [
    (m) => { m.extra = true; }, (m) => { m.ids.token = 'broken'; },
    (m) => { m.ids.accounts[1] = m.ids.accounts[0]; }, (m) => { m.ids.operations.extra = randomUUID(); },
    (m) => { m.ids.operations.death = m.ids.accounts[0]; }, (m) => { m.since = []; },
  ]) { const bad = structuredClone(manifest); mutate(bad); assert.throws(() => checkedBatchManifest(bad, 'prepare')); }
  assert.throws(() => checkedBatchManifest(manifest, 'prepare', '../outside.json'));
  assert.throws(() => checkedBatchManifest(manifest, 'prepare', '.scratch/m5-batch-live-wrong.json'));
  assert.throws(() => checkedBatchManifest(manifest, 'arbitrary'));
  assert.throws(() => checkedBatchManifest(manifest, 'cleanup'));
  await assert.rejects(verifyBatchPhase('invalid', manifest, { admin: null }), { name: 'AssertionError' });
});
test('all four live canary phases pass against SQL007, clean exact fixtures and preserve unrelated profile', async () => {
  const f = await database();
  try {
    const manifest = newBatchManifest(), checks = [], other = randomUUID(), otherProfile = newProfile();
    const initial = await f.store.saveProfile(other, otherProfile, 0); assert.equal(initial.ok, true);
    for (const phase of batchPhases) await verifyBatchPhase(phase, manifest, await context(f.db, manifest, checks));
    assert.equal(checks.length, 31);
    assert.deepEqual(await f.store.loadProfile(other), { data: otherProfile, version: 1 });
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_intents')).rows.length, 1);
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length, 0);
  } finally { await f.close(); }
});
test('cleanup refuses drift before its first deletion and retains all recovery receipts', async () => {
  const f = await database();
  try {
    const manifest = newBatchManifest(), checks = [], ctx = await context(f.db, manifest, checks);
    for (const phase of batchPhases.slice(0, 3)) await verifyBatchPhase(phase, manifest, ctx);
    const current = await ctx.store.loadProfile(manifest.ids.accounts[1]); current.data.xp++;
    assert.equal((await ctx.store.saveProfile(manifest.ids.accounts[1], current.data, current.version)).ok, true);
    const before = (await f.db.query('select uid,version from public.mn_unique_items order by uid')).rows;
    await assert.rejects(verifyBatchPhase('cleanup', manifest, ctx), { name: 'AssertionError' });
    assert.deepEqual((await f.db.query('select uid,version from public.mn_unique_items order by uid')).rows, before);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_batch_operations')).rows.length, 3);
    assert.equal((await f.db.query('select player_id from public.mn_profiles')).rows.length, 2);
  } finally { await f.close(); }
});
test('partial seeding before since checkpoint has an exact explicit cleanup path', async () => {
  const f = await database();
  try {
    const manifest = newBatchManifest(), checks = [], ctx = await context(f.db, manifest, checks), fixture = batchFixture(manifest.ids);
    for (let i = 0; i < 2; i++) await ctx.store.initializeProfile(manifest.ids.accounts[i], fixture.data[i]);
    for (const raw of fixture.grants.slice(0, 4)) assert.equal((await ctx.store.commitPearlGround(raw)).ok, true);
    assert.equal(manifest.since, null);
    await verifyBatchPhase('cleanup-partial', manifest, ctx);
    assert.equal((await f.db.query('select player_id from public.mn_profiles')).rows.length, 0);
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length, 0);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_operations')).rows.length, 0);
    await verifyBatchPhase('cleanup-partial', manifest, ctx);
  } finally { await f.close(); }
});
test('cleanup resumes after one confirmed delete loses its response', async () => {
  const f = await database();
  try {
    const manifest = newBatchManifest(), checks = [], ctx = await context(f.db, manifest, checks);
    for (const phase of batchPhases.slice(0, 3)) await verifyBatchPhase(phase, manifest, ctx);
    let dropped = false;
    const ambiguous = { ...ctx, admin: { ...ctx.admin, from(table) {
      const query = ctx.admin.from(table);
      return Object.assign(Object.create(query), { delete() {
        const deletion = query.delete();
        const then = deletion.then.bind(deletion);
        deletion.then = (yes, no) => then((reply) => {
          if (!dropped) { dropped = true; throw new Error('Lost cleanup response'); }
          return reply;
        }).then(yes, no);
        return deletion;
      } });
    } } };
    await assert.rejects(verifyBatchPhase('cleanup', manifest, ambiguous), /Lost cleanup response/);
    assert.ok(manifest.cleanup); assert.equal(dropped, true);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_batch_operations')).rows.length, 2);
    await verifyBatchPhase('cleanup', manifest, ctx);
    assert.equal((await f.db.query('select player_id from public.mn_profiles')).rows.length, 0);
    assert.equal((await f.db.query('select uid from public.mn_unique_items')).rows.length, 0);
    assert.equal((await f.db.query('select operation_id from public.mn_pearl_intents')).rows.length, 1);
    await verifyBatchPhase('cleanup', manifest, ctx);
  } finally { await f.close(); }
});
