import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createSupabaseGroundWorldAdoption } from '../server/groundWorldAdoption.mjs';
import { newResourceState, upgradeLoggingState } from '../server/resourceState.mjs';
import { newCommunityState } from '../server/communityProject.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { connect, calmAt, turn } from './helpers/resource-authority-fixture.mjs';
import { database, reopenDatabase, adoptionId } from './helpers/ground-world-adoption-sql.mjs';

test('adopted SQL023 world enters the real GameHost, gathers through its common journal, and restarts on the same clock', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ground-adoption-host-')), path = join(dir, 'db');
  let f = await database(path);
  const world = 'ground-adoption-host', seed = 97;
  const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let host, restarted;
  t.after(async () => {
    await host?.close(); await restarted?.close(); await f.close();
    const root = await realpath(tmpdir()), target = await realpath(dir), rel = relative(root, target);
    assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    assert.ok(basename(target).startsWith('ground-adoption-host-'));
    await rm(target, { recursive: true, force: true });
  });
  const template = new GameHost({ seed, bots: 0, store: createMemoryStore(), log() {} });
  const resources = upgradeLoggingState(newResourceState(template.server.world));
  resources.tick = 12345;
  const data = { v: 1, seed, economy: template.server.world.economy.serialize(),
    resources, community: newCommunityState(world, { madera: 4, piedra: 2 }) };
  await template.close();
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)', [world, data]);
  const profile = newProfile(); profile.pirateId = `account:${account}`;
  await f.store.saveProfile(account, profile, 0);
  let adoption = createSupabaseGroundWorldAdoption(f.adoptionClient);
  const input = { operationId: adoptionId(301), request: { world, expectedWorldVersion: 7, worldData: data } };
  assert.equal((await adoption.adopt(input)).clock.tick, 12345);
  const createHost = () => new GameHost({ seed, bots: 0, store: f.store, worldId: world, log() {},
    resolvePlayer: async () => account, economicOperations: true, resourceOperations: true,
    loggingOperations: true, communityRequirements: { madera: 4, piedra: 2 },
    groundTransactions: { journal: f.journal(world) } });
  host = createHost(); await host.prepare();
  assert.equal(host.groundAuthority.ready, true);
  assert.deepEqual(host.worldState.snapshot(host.server.world.economy), data);
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  assert.equal(client.of(MSG.WELCOME).length, 1);
  const node = [...host.server.world.resources.nodes.values()].find(n => n.kind === 'wood');
  const entity = host.server.clients.get(client.id).entity;
  calmAt(host, entity, node);
  const command = { type: 'resource', op: 'gather', opId: 'adopted-wood', node: node.id, expectedRev: node.rev };
  client.send(command);
  for (let i = 0; i < 160 && !client.events(command.opId).length; i++) {
    await turn(); assert.equal(client.events(command.opId).length, 0, 'the async commit alone never publishes an ACK');
    host.server.step();
  }
  assert.equal(client.events(command.opId).length, 1);
  assert.equal(client.events(command.opId)[0].ok, true);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_ground_transaction_intents where world=$1 and state=\'committed\'', [world])).rows[0].n, 1);
  const committedWorld = await f.store.loadWorld(world);
  await assert.rejects(f.store.saveWorld(world, committedWorld.data, committedWorld.version), { code: 'operation' });
  await host.close();
  const saved = await f.store.loadWorld(world), clock = await f.store.loadGroundClock(world);
  assert.equal(saved.data.resources.tick, clock.tick);
  const oldNode = saved.data.resources.nodes.find(n => n.id === node.id);
  await f.close(); f = await reopenDatabase(path);
  adoption = createSupabaseGroundWorldAdoption(f.adoptionClient);
  restarted = createHost(); await restarted.prepare();
  assert.equal(restarted.groundAuthority.status().clock.tick, clock.tick, 'no wall time is added during restart');
  assert.deepEqual(restarted.worldState.snapshot(restarted.server.world.economy), saved.data);
  assert.equal(restarted.server.world.resources.nodes.get(node.id).rev, oldNode.rev);
  assert.deepEqual(await adoption.adopt(input), { ...(await adoption.load(world)).result, replay: true });
  assert.deepEqual(await f.store.loadWorld(world), saved, 'historical adoption replay never resets the current world');
});
