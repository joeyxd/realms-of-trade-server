import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { GameHost } from '../server/host.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { createSupabaseGroundWorldAdoption } from '../server/groundWorldAdoption.mjs';
import { newResourceState, upgradeTimingState } from '../server/resourceState.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { connect, calmAt, turn } from './helpers/resource-authority-fixture.mjs';
import { database, adoptionId } from './helpers/ground-world-adoption-sql.mjs';

const WORLD = 'ground-workshop-compatibility';
const SEED = 97;
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function installWorkshopMigrations(fixture) {
  await fixture.db.exec('RESET ROLE');
  for (const name of ['024_starter_workshop.sql', '025_companion_config.sql',
    '026_workshop_raft_identifiers.sql', '027_companion_control.sql']) {
    const sql = await readFile(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8');
    await fixture.db.exec(sql);
  }
  await fixture.db.exec('SET ROLE service_role');
}

async function apply(host, client, command) {
  client.send(command);
  for (let i = 0; i < 240 && !client.events(command.opId).length; i++) {
    await turn();
    host.server.step();
  }
  const events = client.events(command.opId);
  assert.equal(events.length, 1, `expected one ACK for ${command.opId}`);
  assert.equal(events[0].ok, true, JSON.stringify(events[0]));
  return events[0];
}

function onDeck(host, entity, ship) {
  const world = host.server.world, raft = world.rafts.get(ship.id), ecs = world.ecs;
  const a = ecs.facing[raft.entity];
  calmAt(host, entity, { x: ecs.x[raft.entity] + Math.cos(a) + Math.sin(a),
    z: ecs.z[raft.entity] - Math.sin(a) + Math.cos(a), y: ecs.y[raft.entity] });
}

test('SQL023 adopts a current v3 world and GroundHost durably composes workshop, raft, and resource receipts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ground-workshop-compat-'));
  const path = join(dir, 'db');
  let fixture, host, template;
  t.after(async () => {
    await host?.close();
    await template?.close();
    await fixture?.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-workshop-compat-'));
    await rm(target, { recursive: true, force: true });
  });

  fixture = await database(path); // SQL001-023, including SQL022/023, via the shared PGlite fixture.
  await installWorkshopMigrations(fixture); // SQL024-027 under the reset/admin role.

  template = new GameHost({ seed: SEED, bots: 0, log() {} });
  const resources = upgradeTimingState(newResourceState(template.server.world));
  resources.tick = 12345;
  const worldData = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), resources };
  assert.equal(worldData.resources.v, 3);
  assert.ok(worldData.resources.nodes.length > 100, 'adopt a full current GameHost map resource layout');
  await template.close(); template = null;
  await fixture.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)',
    [WORLD, worldData]);

  const profile = newProfile();
  profile.pirateId = `account:${ACCOUNT}`;
  profile.eco.id = 'persistent-owner';
  profile.eco.ships.find(ship => ship.kind === 'raft').id = 'persisted-raft-001';
  profile.eco.pack.goods = { madera: 2 };
  profile.workshop = { v: 1, boards: 10, storageCredit: true, crateKits: 1 };
  profile.carry = { v: 1, backpack: 0 };
  profile.progression.knowledge = ['raft_storage'];
  const raftId = profile.eco.ships.find(ship => ship.kind === 'raft')?.id;
  assert.ok(raftId);
  await fixture.store.saveProfile(ACCOUNT, profile, 0);

  const adoption = createSupabaseGroundWorldAdoption(fixture.adoptionClient);
  const adoptionInput = { operationId: adoptionId(771), request: {
    world: WORLD, expectedWorldVersion: 7, worldData,
  } };
  assert.equal((await adoption.adopt(adoptionInput)).clock.tick, 12345);

  const store = { ...fixture.store, async checkStarterWorkshop() {
    return (await fixture.db.query('select public.mn_starter_workshop_ready() as data')).rows[0].data;
  } };
  const options = { seed: SEED, bots: 0, log() {}, store, worldId: WORLD, resolvePlayer: async () => ACCOUNT,
    economicOperations: true, resourceOperations: true, loggingOperations: true,
    artisanOperations: true, workshopOperations: true,
    groundTransactions: { journal: fixture.journal(WORLD) } };
  host = new GameHost(options);
  await host.prepare();
  assert.equal(host.groundAuthority.ready, true);
  assert.equal(host.groundAuthority.status().clock.tick, 12345);
  assert.equal(host.worldState.resources.v, 3);
  assert.deepEqual(host.worldState.snapshot(host.server.world.economy), worldData);

  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  assert.equal(client.of(MSG.WELCOME).length, 1);
  const entity = host.server.clients.get(client.id).entity;
  const live = host.server.world.profiles.get(entity), originalWorkshop = structuredClone(live.workshop);
  const originalCarry = structuredClone(live.carry);
  const liveRaft = live.eco.ships.find(ship => ship.id === raftId);
  assert.ok(liveRaft, 'workshop profile preserved the starter raft identifier through SQL load');

  const node = [...host.server.world.resources.nodes.values()].find(row => row.kind === 'wood');
  assert.ok(node, 'current map includes a wood node');
  calmAt(host, entity, node);
  const resourceCommand = { type: 'resource', op: 'gather', opId: 'compat-resource-gather',
    node: node.id, expectedRev: node.rev };
  await apply(host, client, resourceCommand);
  assert.ok(live.eco.pack.goods.tronco > 0);

  calmAt(host, entity, host.server.world.resources.bench);
  const workshopCommand = { type: 'artisan', op: 'craftCrate', opId: 'compat-workshop-crate',
    expectedRev: live.eco.tradeRev };
  await apply(host, client, workshopCommand);
  assert.deepEqual(live.workshop, { ...originalWorkshop, crateKits: originalWorkshop.crateKits + 1 });
  assert.deepEqual(live.carry, originalCarry);

  onDeck(host, entity, liveRaft);
  const storageCommand = { type: 'raft', op: 'place', opId: 'compat-workshop-storage', id: raftId,
    expectedRev: liveRaft.rev, piece: ['storage', 0, 1, 0, 0] };
  await apply(host, client, storageCommand);
  assert.equal(live.eco.ships.find(ship => ship.id === raftId).id, raftId);
  assert.equal(live.workshop.storageCredit, false);
  assert.deepEqual(live.carry, originalCarry);

  const opIds = [resourceCommand.opId, workshopCommand.opId, storageCommand.opId];
  for (const opId of opIds) {
    const receipt = await fixture.store.loadEconomicOperation(economicOperationId(WORLD, ACCOUNT, opId));
    assert.ok(receipt, `economic receipt exists for ${opId}`);
  }
  const journalIds = opIds.map(opId => economicOperationId(WORLD, ACCOUNT, opId));
  const committed = await fixture.db.query(
    "select count(*)::int as n from public.mn_ground_transaction_intents where world=$1 and state='committed' and operation_id=any($2::uuid[])",
    [WORLD, journalIds]);
  assert.equal(committed.rows[0].n, 3, 'each authenticated gameplay command committed through the common journal');

  const saved = await fixture.store.loadWorld(WORLD);
  assert.equal(saved.data.resources.v, 3);
  assert.equal(saved.data.resources.tick, host.groundAuthority.status().clock.tick);
  assert.equal(saved.data.resources.nodes.find(row => row.id === node.id).rev, node.rev);
  assert.ok(saved.data.resources.nodes.length > 100);
  const persistedProfile = await fixture.store.loadProfile(ACCOUNT);
  assert.deepEqual(persistedProfile.data.carry, originalCarry);
  assert.deepEqual(persistedProfile.data.workshop, live.workshop);
  assert.equal(persistedProfile.data.eco.ships.find(ship => ship.id === raftId).id, raftId);
});
