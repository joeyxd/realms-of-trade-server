import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createSupabaseStore } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { ACCOUNT_ONE, ACCOUNT_TWO, RESOURCE_WORLD, startResourceHost, calmAt, submitAndApply, copy } from './helpers/resource-authority-fixture.mjs';

async function databaseStore(t, missing = false) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
  for (const name of (await readdir(new URL('../server/migrations/', import.meta.url))).filter(n => /^\d.*\.sql$/.test(n)).sort()) {
    if (missing && name.startsWith('045_')) continue;
    await db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const calls = [];
  const store = createSupabaseStore({ async rpc(name, args) {
    calls.push(name);
    try {
      const keys = Object.keys(args), values = Object.values(args);
      const sql = `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) result`;
      await db.exec('SET ROLE service_role');
      const result = await db.query(sql, values.map(v => v && typeof v === 'object' ? JSON.stringify(v) : v));
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } });
  store.initializeProfile = async (id, data) => {
    await db.exec('RESET ROLE');
    await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1) on conflict do nothing', [id, data]);
    const row = (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [id])).rows[0];
    return row;
  };
  return { db, store, calls };
}
const options = { chop: true, loggingOperations: true, artisanOperations: true, workshopOperations: true,
  fireOperations: true, freshwaterOperations: true, canteenOperations: true, torchResinCoconutOperations: true };
function fell(f) {
  const { host, client } = f, w = host.server.world;
  const palm = [...w.resources.nodes.values()].find(n => n.kind === 'palm' && w.map.groundAt(n.x - 1, n.z) >= .35);
  for (let i = 0; i < 1400 && !w.resources.chop?.piles.size; i++) {
    calmAt(host, f.entity(), { ...palm, x: palm.x - 1 });
    if (i % 24 === 0) client.send({ type: 'resource', op: 'chop', node: palm.id });
    if (i === 20) client.send({ type: 'resource', op: 'crit' });
    assert.equal(host.server.step(), true);
  }
  assert.equal(w.resources.chop?.piles.size, 1, 'held swings fell a palm');
  return { palm, pile: [...w.resources.chop.piles.values()][0] };
}

test('PGlite host fells ephemeral palms, durably picks up once, shares practice, and saves the unchanged palm', async t => {
  const { store, calls } = await databaseStore(t);
  const f = await startResourceHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO], tools: { axe: 3 }, options });
  const { host, client } = f, w = host.server.world;
  assert.deepEqual(host.status().storage.chop, { enabled: true, ready: true });
  const persisted = copy((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes);
  const writesBefore = calls.filter(n => n === 'mn_commit_economic_operation').length;
  const { palm, pile } = fell(f);
  assert.equal(calls.filter(n => n === 'mn_commit_economic_operation').length, writesBefore, 'swings and fells send no RPC');
  assert.equal(palm.rev, persisted.find(n => n.id === palm.id).rev);
  pile.practice = [{ e: f.entity(), amount: 6 }, { e: f.entity(ACCOUNT_TWO), amount: 4 }];
  calmAt(host, f.entity(), pile);
  const command = { type: 'resource', op: 'pickup', pile: pile.id, expectedRev: pile.rev, opId: 'durable-chop-pickup' };
  const ack = await submitAndApply(host, client, command);
  assert.equal(ack?.ok, true, JSON.stringify({ ack, status: host.status().storage }));
  assert.equal(ack.durable, true);
  const p = w.profiles.get(f.entity()), other = w.profiles.get(f.entity(ACCOUNT_TWO));
  assert.equal(p.progression.practice.logging, 6); assert.equal(other.progression.practice.logging, 4);
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(receipt.request.beneficiaries.length, 2);
  const after = copy(p);
  assert.equal((await submitAndApply(host, client, command)).replay, true);
  assert.deepEqual(p, after);
  host.worldState.save(w.economy); await host.worldState.flush();
  assert.equal(host.status().storage.world.failed, false); assert.equal(host.status().storage.economic.failed, false);
  assert.deepEqual((await store.loadWorld(RESOURCE_WORLD)).data.resources.nodes, persisted);
});

test('missing readiness boots with chop on, refuses pickup before any economic RPC, throttles and recovers without restart', async t => {
  const { store, calls, db } = await databaseStore(t, true), lines = [];
  const f = await startResourceHost(t, store, { tools: { axe: 3 }, options: { ...options, log: line => lines.push(line) } });
  const { host, client } = f, w = host.server.world;
  assert.deepEqual(host.status().storage.chop, { enabled: true, ready: false });
  assert.equal(lines.filter(line => line.includes('CHOP PICKUP NOT READY')).length, 1);
  const { pile } = fell(f); calmAt(host, f.entity(), pile);
  const before = calls.filter(n => n === 'mn_chop_operations_ready').length;
  const command = { type: 'resource', op: 'pickup', pile: pile.id, expectedRev: pile.rev, opId: 'not-ready-pickup' };
  for (let i = 0; i < 3; i++) assert.equal((await submitAndApply(host, client, command)).why, 'notReady');
  assert.equal(calls.filter(n => n === 'mn_chop_operations_ready').length, before);
  for (const recipe of ['hacha_hierro', 'hacha_acero']) {
    const craft = { type: 'resource', op: 'craft', recipe, n: 1, expectedRev: w.profiles.get(f.entity()).eco.tradeRev, opId: `not-ready-${recipe}` };
    assert.equal((await submitAndApply(host, client, craft)).why, 'notReady');
  }
  assert.equal(calls.filter(n => n === 'mn_commit_economic_operation').length, 0);
  assert.equal(host.status().storage.world.failed, false); assert.equal(host.status().storage.economic.failed, false);
  await db.exec('RESET ROLE'); await db.exec(await readFile(new URL('../server/migrations/045_chop_operations.sql', import.meta.url), 'utf8'));
  await db.exec('SET ROLE service_role');
  host.chopProbeAt -= 60001;
  assert.equal((await submitAndApply(host, client, command)).why, 'notReady');
  await host.chopProbe;
  assert.deepEqual(host.status().storage.chop, { enabled: true, ready: true });
  const ack = await submitAndApply(host, client, command); assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(host.status().storage.world.failed, false);
});

test('partial pickup awards practice once, drops offline shares, and keeps the remaining goods', async t => {
  const { store } = await databaseStore(t);
  const f = await startResourceHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO], goods: { madera: 4 }, tools: { axe: 3 }, options });
  const { host, client } = f, w = host.server.world, { pile } = fell(f);
  pile.goods = { tronco: 8, resina: 1, coco: 1 };
  pile.practice = [{ e: f.entity(), amount: 6 }, { e: f.entity(ACCOUNT_TWO), amount: 3 }, { e: 99999, amount: 1 }];
  calmAt(host, f.entity(), pile);
  const command = { type: 'resource', op: 'pickup', pile: pile.id, expectedRev: 1, opId: 'partial-first' };
  const first = await submitAndApply(host, client, command);
  assert.deepEqual([first.ok, first.count, first.left, first.rev], [true, 2, 8, 2]);
  assert.deepEqual(w.resources.chop.piles.get(pile.id).practice, []);
  const p = w.profiles.get(f.entity()), other = w.profiles.get(f.entity(ACCOUNT_TWO));
  assert.deepEqual([p.progression.practice.logging, other.progression.practice.logging], [6, 3]);
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(receipt.request.beneficiaries.length, 2);
  p.eco.pack.goods = {};
  const second = await submitAndApply(host, client, { ...command, expectedRev: 2, opId: 'partial-second' });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual([p.progression.practice.logging, other.progression.practice.logging], [6, 3]);
  assert.equal(host.status().storage.economic.failed, false);
});
