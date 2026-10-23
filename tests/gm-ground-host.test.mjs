import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { createGmContentService } from '../server/gmContent.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newResourceState, upgradeTimingState } from '../server/resourceState.mjs';
import { createDocument, createDecoration } from '../src/editor/document.js';
import { compileAuthoredResources } from '../src/editor/resourceAdapters.js';
import { canonicalJson, PREPARATION_SCHEMA, PUBLICATION_COMPILER_VERSION } from '../src/editor/publicationArtifact.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { database } from './helpers/ground-host-authority-sql.mjs';
import { connect, calmAt, turn } from './helpers/resource-authority-fixture.mjs';

// GM-authored resources compose with the common Ground pilot (real SQL001-040 on PGlite, real
// content registry and pointer). Under Ground the roster append is a SQL040 family operation:
// journaled intent, one commit under the Ground locks, adopted by the session before the pointer.
const WORLD = 'gm-ground-host';
const SEED = 97;
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOCK_ID = 'c0400000-0000-4000-8000-000000000140';
const TICK = 1000;
const BASE = 'terrain-s21-v1';
const OBJECTS = [['gm-40400000-0000-4000-8000-000000000001', 'prop:gm-resource-stone-v1'],
  ['gm-40400000-0000-4000-8000-000000000002', 'prop:gm-resource-palm-v1']];
const STONE = 'gm_40400000000040008000000000000001';
const PALM = 'gm_40400000000040008000000000000002';
const LATER = ['022_fire_operations', '023_ground_world_adoption', '024_starter_workshop', '025_companion_config',
  '026_workshop_raft_identifiers', '027_companion_control', '028_inference_config', '029_attribute_operations',
  '030_freshwater_operations', '031_gm_terrain_drafts', '032_canteen_survival_operations', '033_gm_terrain_materials',
  '034_companion_creation', '035_special_meal_operations', '036_gm_resource_roster', '037_torch_resin_coconut',
  '038_player_characters', '039_companion_presence'];
const LOCK = { run: async fn => fn({ assertHeld() {} }) };
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(canonicalJson(value));
const copy = value => structuredClone(value);

// The shared Ground fixture ends at SQL021: add the later migrations in production order.
async function gmDatabase({ sql040 }) {
  const f = await database();
  try {
    await f.db.exec('RESET ROLE');
    for (const name of [...LATER, ...(sql040 ? ['040_ground_gm_resources'] : [])])
      await f.db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    await f.db.exec('SET ROLE service_role');
    return f;
  } catch (error) { await f.close(); throw error; }
}

// The real store client for SQL036 readiness and the SQL040 family, routed to the same PGlite.
const SQL = {
  mn_gm_resource_roster_ready: ['select public.mn_gm_resource_roster_ready() as data', () => []],
  mn_valid_resource_state_v1: ['select public.mn_valid_resource_state_v1($1::jsonb) as data', a => [a.p_resources]],
  mn_starter_workshop_ready: ['select public.mn_starter_workshop_ready() as data', () => []],
  mn_ground_gm_resources_ready: ['select public.mn_ground_gm_resources_ready() as data', () => []],
  mn_pending_ground_gm_admission: ['select public.mn_pending_ground_gm_admission($1) as data', a => [a.p_world]],
  mn_prepare_ground_gm_admission: ['select public.mn_prepare_ground_gm_admission($1::uuid,$2::jsonb) as data',
    a => [a.p_operation_id, a.p_request]],
  mn_commit_ground_gm_admission: ['select public.mn_commit_ground_gm_admission($1::uuid,$2::jsonb) as data',
    a => [a.p_operation_id, a.p_request]],
};
function sqlStore(f) {
  return createSupabaseStore({ async rpc(name, args) {
    const entry = SQL[name];
    if (!entry) return { data: null, error: { code: '42883', message: 'Unexpected local SQL RPC' } };
    try { return { data: (await f.db.query(entry[0], entry[1](args))).rows[0].data, error: null }; }
    catch (error) { return { data: null, error: { code: error.code ?? 'XX000', message: 'Local SQL rejection' } }; }
  } });
}

// One fresh store object per host: the Ground session owns one store+world pair.
function hostFor(f, faults = {}) {
  const sql = sqlStore(f), calls = { admitGmResources: 0, saveWorld: 0, pending: 0, prepare: 0, commit: 0 };
  const store = { ...f.store,
    checkStarterWorkshop: sql.checkStarterWorkshop,
    checkGmResourceRoster: sql.checkGmResourceRoster,
    checkGroundGmResources: sql.checkGroundGmResources,
    async loadPendingGroundGmAdmission(world) { calls.pending++; return sql.loadPendingGroundGmAdmission(world); },
    async prepareGroundGmAdmission(raw) { calls.prepare++; return sql.prepareGroundGmAdmission(raw); },
    async commitGroundGmAdmission(raw) {
      calls.commit++;
      return faults.commit ? faults.commit(raw, input => sql.commitGroundGmAdmission(input)) : sql.commitGroundGmAdmission(raw);
    },
    // Spies: under Ground neither the SQL036 entry point nor a raw world save may carry the roster.
    async admitGmResources(...args) { calls.admitGmResources++; return f.store.admitGmResources(...args); },
    async saveWorld(...args) { calls.saveWorld++; return f.store.saveWorld(...args); },
    // Read-only inputs of the publication obstacle guard, read from the same database.
    async listGmContentProfiles({ after = null, limit }) {
      const rows = (await f.db.query(`select player_id::text as id, data from public.mn_profiles
        where $1::uuid is null or player_id > $1::uuid order by player_id limit $2`, [after, limit])).rows;
      return rows.map(row => ({ accountId: row.id, profile: row.data }));
    },
    async listPearlGround(world) {
      assert.equal((await f.db.query('select count(*)::int n from public.mn_pearl_locations where world=$1', [world])).rows[0].n, 0);
      return [];
    },
    async listCurrentDeathDrops(world) {
      assert.equal((await f.db.query('select count(*)::int n from public.mn_death_drops where world=$1', [world])).rows[0].n, 0);
      return [];
    },
  };
  const host = new GameHost({ seed: SEED, bots: 0, log() {}, store, worldId: WORLD,
    resolvePlayer: async (_request, hello) => hello.name === 'A' ? ACCOUNT : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true, artisanOperations: true,
    workshopOperations: true, groundTransactions: { journal: f.journal(WORLD) } });
  return { host, store, calls };
}

async function closeHost(host) {
  if (!host) return;
  try { await host.close(); } catch (error) { if (error.code !== 'flush') throw error; }
}

// World (resource v3 at the durable tick), one account and the SQL013 clock on that tick.
async function seed(f) {
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  try {
    const resources = upgradeTimingState(newResourceState(template.server.world));
    resources.tick = TICK;
    const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources };
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, data]);
    const profile = newProfile(); profile.pirateId = `account:${ACCOUNT}`;
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [ACCOUNT, profile]);
    assert.equal((await f.store.commitGroundClock({ operationId: CLOCK_ID, world: WORLD,
      expectedVersion: 0, expectedTick: 0, tick: TICK })).ok, true);
  } finally { await template.close(); }
}

async function setup(t, { sql040 = true } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'gm-ground-host-'));
  const root = path.join(temp, 'release'), directory = path.join(temp, 'registry');
  await mkdir(path.join(root, 'assets'), { recursive: true }); await mkdir(path.join(root, 'src'), { recursive: true });
  const ctx = { f: null, hosts: [], root, directory, map: null, revisions: new Map(), activation: null };
  ctx.publication = { build: async ({ document }) => ({ revision: ctx.revisions.get(canonicalJson(document)) }) };
  t.after(async () => {
    for (const host of ctx.hosts) await closeHost(host);
    await ctx.f?.close();
    await rm(temp, { recursive: true, force: true });
  });
  ctx.f = await gmDatabase({ sql040 });
  await seed(ctx.f);
  return ctx;
}

// A fresh host (fresh store + journal) and a content service on the shared registry directory.
async function open(ctx, faults = {}) {
  const opened = hostFor(ctx.f, faults);
  ctx.hosts.push(opened.host);
  ctx.map ??= { ...opened.host.server.world.map };
  opened.service = createGmContentService({ directory: ctx.directory, root: ctx.root, worldId: WORLD,
    baseMap: ctx.map, baseRevision: BASE, game: opened.host, publication: ctx.publication, lock: LOCK });
  await opened.service.prepare();
  await opened.host.prepare();
  assert.equal(opened.host.groundAuthority.ready, true);
  if (!ctx.activation) ctx.activation = await register(ctx, opened.service);
  return opened;
}

// One stone and one palm, on valid authored sites of the fixture map.
async function register(ctx, service) {
  const map = ctx.map, objects = [];
  for (const [id, assetId] of OBJECTS) {
    let found = null;
    for (let z = -240; z < 240 && !found; z += 8) for (let x = -240; x < 240 && !found; x += 8) {
      const candidate = createDecoration({ id, assetId, position: { x, y: map.groundAt(x, z), z }, collider: 'none' });
      try { compileAuthoredResources(map, { objects: [...objects, candidate] }); found = candidate; } catch { /* next site */ }
    }
    assert.ok(found, `the fixture map has a valid site for ${assetId}`);
    objects.push(found);
  }
  const bytes = Buffer.from('pinned-fixture'), assetPath = 'assets/gm-resource.glb', runtimePath = 'src/gm-resource.js';
  await writeFile(path.join(ctx.root, assetPath), bytes); await writeFile(path.join(ctx.root, runtimePath), bytes);
  const document = createDocument({ seed: map.seed, baseRevision: BASE, objects });
  const compiled = compileAuthoredResources(map, document);
  assert.deepEqual(compiled.map(node => node.id), [STONE, PALM]);
  const content = { compilerVersion: PUBLICATION_COMPILER_VERSION, worldId: WORLD, sourceRevision: 1,
    base: { seed: map.seed, revision: BASE }, document, documentHash: digest(document),
    resources: { count: compiled.length, sha256: digest(compiled) },
    runtime: { sha256: hash(bytes), files: [{ path: runtimePath, sha256: hash(bytes), bytes: bytes.length }], gameVersion: 'test', protocolVersion: PROTOCOL_VERSION },
    assets: [{ id: 'model:palm-tall-v1', src: assetPath, sha256: hash(bytes), bytes: bytes.length, status: 'ready' }],
    baselineAssets: [], collision: { count: map.colliders.length, sha256: digest(map.colliders) },
    validation: { valid: true, issues: [], summary: { edits: objects.length, errors: 0, warnings: 0, totalIssues: 0, omittedIssues: 0 } } };
  const revision = { schema: PREPARATION_SCHEMA, version: 1, revisionId: digest(content), content };
  ctx.revisions.set(canonicalJson(document), revision);
  await service.register(revision);
  return { operationId: 'gm-ground-activate', expectedGeneration: 0, revisionId: revision.revisionId };
}

async function durable(f) {
  const world = await f.store.loadWorld(WORLD), clock = await f.store.loadGroundClock(WORLD);
  const installed = (await f.db.query(`select to_regclass('public.mn_ground_gm_admissions') is not null as ok`)).rows[0].ok;
  const admissions = installed ? (await f.db.query(`select operation_id,state,request,result
    from public.mn_ground_gm_admissions order by created_at,operation_id`)).rows : null;
  return { world, clock, admissions };
}
const count = (resources, id) => resources.nodes.filter(node => node.id === id).length;

function join(host, name = 'A') {
  const client = connect(host, name);
  client.ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name,
    content: host.contentIdentity })), false);
  return client;
}

async function pump(host, until, what) {
  for (let i = 0; i < 240; i++) {
    const found = until();
    if (found) return found;
    await turn();
    host.server.step();
  }
  assert.fail(`${what}: ${JSON.stringify({ ground: host.groundAuthority.status(), economic: host.economicAuthority.status() })}`);
}

async function sendAndPump(host, client, command) {
  const seen = client.events(command.opId).length;
  client.send(command);
  return pump(host, () => client.events(command.opId).length > seen && client.events(command.opId).at(-1),
    `no ACK for ${command.opId}`);
}

test('A: a GM content switch under Ground admits the roster once through SQL040 and the session follows its version', async t => {
  const ctx = await setup(t), a = await open(ctx);
  const before = await durable(ctx.f);
  assert.equal(count(before.world.data.resources, STONE), 0);
  const result = await a.service.activate(ctx.activation);
  assert.equal(result.ok, true); assert.equal(a.service.snapshot().generation, 1);
  assert.deepEqual(a.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 1, commit: 1 },
    'one journaled SQL040 commit; neither mn_admit_gm_resources nor mn_save_world carry the admission');

  const after = await durable(ctx.f);
  assert.equal(after.world.version, before.world.version + 1);
  assert.deepEqual(after.world.data.resources.nodes.slice(-2), [
    { id: STONE, kind: 'stone', rev: 1, hits: 0, readyAt: 0 }, { id: PALM, kind: 'palm', rev: 1, hits: 0, readyAt: 0 }]);
  assert.equal(count(after.world.data.resources, STONE), 1); assert.equal(count(after.world.data.resources, PALM), 1);
  assert.deepEqual(after.world.data.resources.logging[PALM], { cycle: 1, contributors: [], quality: 0 });
  assert.deepEqual({ ...after.world.data, resources: null }, { ...before.world.data, resources: null },
    'only the roster changed in the confirmed world');
  assert.deepEqual(after.clock, before.clock, 'the admission does not move the Ground clock');
  assert.equal(after.admissions.length, 1); assert.equal(after.admissions[0].state, 'committed');
  assert.deepEqual(after.admissions[0].result, { ok: true, worldVersion: after.world.version, added: 2,
    clock: { world: WORLD, tick: TICK, version: before.clock.version, operationId: CLOCK_ID } });

  const ground = a.host.groundAuthority;
  assert.equal(ground.status().failed, false); assert.equal(ground.ready, true); assert.equal(ground.status().pending, 0);
  assert.equal(a.host.worldState.failed, false); assert.equal(a.host.worldState.version, after.world.version);
  assert.doesNotThrow(() => ground.verifyWorld(), 'the session world version and rows equal the live world');
  assert.equal(a.host.server.world.resources.nodes.has(STONE), true, 'the pointer installed the admitted nodes');

  // The next checkpoint commits on the admitted version: no stale CAS, roster preserved.
  a.host.server.world.economy.acc += 0.25;
  const acc = a.host.server.world.economy.acc;
  a.host.worldState.save(a.host.server.world.economy);
  for (let i = 0; i < 12 && a.host.worldState.version === after.world.version; i++) { await turn(); a.host.server.step(); }
  await a.host.worldState.flush();
  const checkpoint = await durable(ctx.f);
  assert.equal(checkpoint.world.version, after.world.version + 1);
  assert.equal(checkpoint.world.data.economy.acc, acc);
  assert.equal(count(checkpoint.world.data.resources, STONE), 1);
  assert.deepEqual(a.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 1, commit: 1 });
});

test('B: a gather on an admitted GM stone commits through the Ground journal once and a replay pays nothing', async t => {
  const ctx = await setup(t), a = await open(ctx);
  await a.service.activate(ctx.activation);
  const client = join(a.host); await Promise.all([...a.host.joins]);
  assert.equal(client.of(MSG.WELCOME).length, 1);
  const entity = a.host.server.clients.get(client.id).entity, live = a.host.server.world.profiles.get(entity);
  const node = a.host.server.world.resources.nodes.get(STONE);
  calmAt(a.host, entity, node);
  const command = { type: 'resource', op: 'gather', opId: 'gm-ground-stone', node: STONE, expectedRev: node.rev };
  const ack = await sendAndPump(a.host, client, command);
  assert.equal(ack.ok, true, JSON.stringify(ack)); assert.equal(ack.good, 'piedra'); assert.equal(ack.count, 1);
  assert.equal(live.eco.pack.goods.piedra, 1);

  const operationId = economicOperationId(WORLD, ACCOUNT, command.opId);
  const rows = async () => ({
    outer: (await ctx.f.db.query('select request from public.mn_ground_transactions where operation_id=$1::uuid', [operationId])).rows,
    inner: (await ctx.f.db.query('select request from public.mn_economic_operations where operation_id=$1::uuid', [operationId])).rows,
    intents: (await ctx.f.db.query('select state from public.mn_ground_transaction_intents where operation_id=$1::uuid', [operationId])).rows,
  });
  const first = await rows();
  assert.equal(first.outer.length, 1); assert.equal(first.inner.length, 1);
  assert.equal(first.outer[0].request.family, 'economic');
  assert.equal(first.outer[0].request.operation.command.node, STONE);
  assert.deepEqual(first.intents.map(row => row.state), ['committed']);
  const saved = await durable(ctx.f);
  assert.equal(saved.world.data.resources.nodes.find(row => row.id === STONE).rev, 2);
  assert.equal(saved.world.version, a.host.worldState.version);
  assert.equal((await ctx.f.store.loadProfile(ACCOUNT)).data.eco.pack.goods.piedra, 1);

  const settled = copy(live);
  const resent = await sendAndPump(a.host, client, command);
  assert.equal(resent.replay, true, 'the same operation ID is answered from its receipt');
  assert.deepEqual(live, settled, 'the replay pays no second stone');
  const again = await rows();
  assert.equal(again.outer.length, 1); assert.equal(again.inner.length, 1);
  assert.equal((await ctx.f.store.loadProfile(ACCOUNT)).data.eco.pack.goods.piedra, 1);
  assert.equal(a.host.groundAuthority.status().failed, false);
  assert.deepEqual(a.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 1, commit: 1 });
});

for (const mode of ['conflict', 'ambiguous']) {
  test(`C: an admission ${mode} fences the host and the content pointer is not installed`, async t => {
    const ctx = await setup(t);
    const a = await open(ctx, { commit: async (raw, commit) => {
      if (mode === 'conflict') {
        // Another writer moved the world behind the session: the SQL040 CAS must refuse.
        await ctx.f.db.query('update public.mn_worlds set version=version+1 where world=$1', [WORLD]);
        return commit(raw);
      }
      await commit(raw);
      throw new Error('lost SQL acknowledgement');
    } });
    const before = await durable(ctx.f);
    await assert.rejects(a.service.activate(ctx.activation), mode === 'conflict' ? { code: 'conflict' } : { code: 'unavailable' });
    assert.equal(a.service.snapshot().generation, 0, 'the durable pointer did not move');
    assert.equal((a.host.server.world.map.gmResources || []).length, 0, 'the target map was not installed');
    assert.equal(a.host.server.world.resources.nodes.has(STONE), false);
    assert.equal(a.host.worldState.failed, true); assert.equal(a.host.groundAuthority.status().failed, true);
    assert.equal(a.host.healthy(), false);
    const after = await durable(ctx.f);
    assert.equal(after.world.version, before.world.version + 1);
    assert.equal(count(after.world.data.resources, STONE), mode === 'ambiguous' ? 1 : 0);
    assert.deepEqual(after.admissions.map(row => row.state), [mode === 'conflict' ? 'conflict' : 'committed']);
    assert.deepEqual(a.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 1, commit: 1 });
  });
}

test('D: a stop after the admission commit and before the pointer recovers once on a fresh host; the retry admits nothing', async t => {
  const ctx = await setup(t);
  let a;
  a = await open(ctx, { commit: async (raw, commit) => {
    const receipt = await commit(raw);
    a.host.close().catch(() => {}); // the process stops before the content pointer can move
    return receipt;
  } });
  const before = await durable(ctx.f);
  await assert.rejects(a.service.activate(ctx.activation), { code: 'cancelled' });
  assert.equal(a.service.snapshot().generation, 0, 'the pointer never moved');
  await closeHost(a.host);
  const stopped = await durable(ctx.f);
  assert.equal(stopped.world.version, before.world.version + 1, 'the admission was durable before the stop');
  assert.deepEqual(stopped.admissions.map(row => row.state), ['committed']);

  const b = await open(ctx);
  assert.equal(b.service.snapshot().generation, 0);
  assert.equal(b.host.worldState.version, stopped.world.version, 'the fresh session loads the current committed world');
  assert.equal(count(b.host.worldState.resources, STONE), 1); assert.equal(count(b.host.worldState.resources, PALM), 1);
  assert.equal(b.host.server.world.resources.nodes.has(STONE), false, 'admitted nodes stay inert until the map uses them');
  const retried = await b.service.activate(ctx.activation);
  assert.equal(retried.ok, true); assert.equal(b.service.snapshot().generation, 1, 'the pointer then installs');
  assert.deepEqual(b.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 0, commit: 0 },
    'retrying the switch admits nothing new');
  assert.equal(b.host.server.world.resources.nodes.has(STONE), true);
  const recovered = await durable(ctx.f);
  assert.equal(recovered.world.version, stopped.world.version);
  assert.equal(count(recovered.world.data.resources, STONE), 1); assert.equal(count(recovered.world.data.resources, PALM), 1);
  assert.equal(recovered.admissions.length, 1);
  // The journaled operation answers with its stored receipt and writes nothing.
  const [row] = recovered.admissions;
  assert.deepEqual(await b.store.commitGroundGmAdmission({ operationId: row.operation_id, request: row.request }), row.result);
  assert.deepEqual(await durable(ctx.f), recovered);
  assert.equal(b.host.groundAuthority.status().failed, false);

  // A later restart with the GM map already active passes the SQL040 startup readiness.
  await closeHost(b.host);
  const c = await open(ctx);
  assert.equal(c.service.snapshot().generation, 1);
  assert.equal(c.host.server.world.resources.nodes.has(STONE), true);
  assert.equal(count(c.host.worldState.resources, STONE), 1);
  assert.deepEqual(c.calls, { admitGmResources: 0, saveWorld: 0, pending: 0, prepare: 0, commit: 0 });
});

test('D2: a stop after the journaled intent and before its commit is committed exactly once by the next switch', async t => {
  const ctx = await setup(t);
  let a;
  a = await open(ctx, { commit: async () => {
    a.host.close().catch(() => {});
    throw new Error('stopped before the admission RPC');
  } });
  const before = await durable(ctx.f);
  await assert.rejects(a.service.activate(ctx.activation));
  assert.equal(a.service.snapshot().generation, 0);
  await closeHost(a.host);
  const stopped = await durable(ctx.f);
  assert.deepEqual(stopped.world, before.world, 'nothing was admitted');
  assert.deepEqual(stopped.admissions.map(row => row.state), ['pending']);

  const b = await open(ctx);
  assert.equal(count(b.host.worldState.resources, STONE), 0);
  assert.deepEqual((await durable(ctx.f)).admissions.map(row => row.state), ['pending'], 'startup applies no historical intent');
  const retried = await b.service.activate(ctx.activation);
  assert.equal(retried.ok, true); assert.equal(b.service.snapshot().generation, 1);
  assert.deepEqual(b.calls, { admitGmResources: 0, saveWorld: 0, pending: 1, prepare: 0, commit: 1 },
    'the journaled intent is committed once and the retry finds nothing new');
  const recovered = await durable(ctx.f);
  assert.equal(recovered.world.version, before.world.version + 1);
  assert.equal(count(recovered.world.data.resources, STONE), 1); assert.equal(count(recovered.world.data.resources, PALM), 1);
  assert.deepEqual(recovered.admissions.map(row => [row.operation_id, row.state]),
    [[stopped.admissions[0].operation_id, 'committed']]);
  assert.equal(b.host.worldState.version, recovered.world.version);
  assert.doesNotThrow(() => b.host.groundAuthority.verifyWorld());
  assert.equal(b.host.server.world.resources.nodes.has(STONE), true);
});

test('E: without SQL040 a Ground host with a GM map fails closed at startup', async t => {
  const ctx = await setup(t, { sql040: false });
  const opened = hostFor(ctx.f); ctx.hosts.push(opened.host);
  const before = await durable(ctx.f);
  const node = [...opened.host.server.world.resources.nodes.values()].find(row => row.kind === 'stone');
  opened.host.server.world.map.gmResources = [{ id: STONE, kind: 'stone', x: node.x, y: node.y, z: node.z }];
  opened.host.installContentResources();
  await assert.rejects(opened.host.prepare(), { code: 'configuration' });
  assert.deepEqual((await durable(ctx.f)).world, before.world, 'no roster write');
  assert.deepEqual(opened.calls, { admitGmResources: 0, saveWorld: 0, pending: 0, prepare: 0, commit: 0 });
});

test('E: a switch without SQL040 readiness or without the authority capability is rejected before any roster write', async t => {
  for (const missing of ['readiness', 'capability']) await t.test(missing, async st => {
    const ctx = await setup(st, { sql040: missing !== 'readiness' }), a = await open(ctx);
    if (missing === 'capability') Object.defineProperty(a.host.groundAuthority, 'admitGmResources', { value: undefined });
    const before = await durable(ctx.f);
    await assert.rejects(a.service.activate(ctx.activation), { code: 'gm_resource_unavailable' });
    assert.equal(a.service.snapshot().generation, 0);
    assert.deepEqual((await durable(ctx.f)).world, before.world, 'no roster write');
    assert.deepEqual(a.calls, { admitGmResources: 0, saveWorld: 0, pending: 0, prepare: 0, commit: 0 });
    assert.equal(a.host.healthy(), true, 'a refused preflight does not fence the world');
    assert.equal(a.host.groundAuthority.status().failed, false);
  });
});
