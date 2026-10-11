import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from './helpers/ground-host-authority-sql.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { accountProfile, calmAt, connect, findNode, makeResourceHost, turn, RESOURCE_WORLD, ACCOUNT_ONE } from './helpers/resource-authority-fixture.mjs';

const clone = structuredClone;
const migrationNames = ['022_fire_operations', '023_ground_world_adoption', '024_starter_workshop', '026_workshop_raft_identifiers'];

async function fixture(t) {
  const f = await database();
  let host = null;
  t.after(async () => {
    if (host) {
      try { await host.close(); }
      catch (error) { if (error.code !== 'flush') throw error; }
    }
    await f.close();
  });
  await f.db.exec('RESET ROLE');
  for (const name of migrationNames) await f.db.exec(await readFile(`server/migrations/${name}.sql`, 'utf8'));
  await f.db.exec('SET ROLE service_role');

  const profile = accountProfile({ tools: { axe: 1 } });
  profile.eco.ships[0].id = `raft:${ACCOUNT_ONE}:starter`;
  profile.fire = { v: 1, rev: 0, slots: {} };
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)',
    [ACCOUNT_ONE, profile]);
  f.store.checkStarterWorkshop = async () => {
    const raw = (await f.db.query('select public.mn_starter_workshop_ready() as data')).rows[0].data;
    if (raw?.version !== 1) throw new Error('Local SQL024 workshop readiness failed');
    return { version: 1 };
  };
  const commits = [];
  const profilesBeforeCommit = [];
  const commitEconomicOperation = f.store.commitEconomicOperation.bind(f.store);
  f.store.commitEconomicOperation = async raw => {
    commits.push(clone(raw.request));
    const currentProfile = await f.store.loadProfile(raw.request.account);
    profilesBeforeCommit.push(clone(currentProfile));
    if (raw.request.ack.ok === false) assert.deepEqual(raw.request.profile, currentProfile.data,
      'a denied receipt does not propose profile changes');
    const baseline = await f.store.loadWorld(RESOURCE_WORLD);
    const withoutResources = world => {
      const result = clone(world);
      delete result.resources;
      return result;
    };
    assert.deepEqual(withoutResources(raw.request.worldData), withoutResources(baseline.data),
      'the durable request non-resource snapshot matches the persisted SQL baseline at dispatch');
    return commitEconomicOperation(raw);
  };
  host = makeResourceHost(f.store, undefined, {
    loggingOperations: true, artisanOperations: true, workshopOperations: true,
  });
  await host.prepare();
  const client = connect(host);
  client.hello();
  await Promise.all([...host.joins]);
  return { ...f, host, client, commits, profilesBeforeCommit };
}

async function submit(host, client, command) {
  client.send(command);
  await turn();
  await host.economicAuthority.settle();
  host.server.step();
  return client.events(command.opId).at(-1);
}

function advance(host, ticks) {
  for (let i = 0; i < ticks; i++) host.server.step();
}

async function aimAndGather(f, index, node) {
  const { host, client } = f;
  const entity = host.server.clients.get(client.id).entity;
  if (index > 1) advance(host, 55);
  const current = host.server.world.resources.nodes.get(node.id);
  calmAt(host, entity, current);
  client.send({ type: 'resource', op: 'aim', node: current.id, expectedRev: current.rev });
  await turn();
  const event = client.ws.messages.map(message => message.ev)
    .filter(ev => ev?.type === 'loggingAim' && ev.node === current.id && ev.ok).at(-1);
  assert.ok(event?.challengeId, 'the host issues a timing challenge');
  const challenge = event.challenge;
  advance(host, challenge.targetTick - host.worldState.resourceTick());
  calmAt(host, entity, host.server.world.resources.nodes.get(node.id));
  const live = host.server.world.resources.nodes.get(node.id);
  return submit(host, client, { type: 'resource', op: 'gather', node: live.id, expectedRev: live.rev,
    challenge: event.challengeId, opId: `timed-baseline-${index}` });
}

test('a v3 timing denial receipts cleanly when the live economy is ahead of the saved baseline', async t => {
  const f = await fixture(t), { host, client, store, commits, profilesBeforeCommit } = f;
  const entity = host.server.clients.get(client.id).entity;
  const node = findNode(host, 'palm');
  const saved = await store.loadWorld(RESOURCE_WORLD);
  assert.equal(saved.data.resources.v, 3);
  assert.equal(node.hits, 0);

  advance(host, 12);
  assert.notEqual(host.server.world.economy.acc, saved.data.economy.acc,
    'ordinary simulation steps move the live serialized economy past its last database checkpoint');
  calmAt(host, entity, host.server.world.resources.nodes.get(node.id));
  const command = { type: 'resource', op: 'gather', node: node.id, expectedRev: node.rev,
    challenge: '7a949137-0000-4000-8000-000000000001', opId: 'timing-denied-single-actor' };
  const ack = await submit(host, client, command);

  assert.equal(commits.length, 1);
  assert.equal(commits[0].ack.why, 'timing');
  assert.notEqual(commits[0].worldData.economy.acc, saved.data.economy.acc,
    'the durable request uses the live host snapshot');
  assert.equal(ack?.ok, false);
  assert.equal(ack?.why, 'timing');
  assert.equal(host.economicAuthority.failed, false);
  assert.equal(host.economicAuthority.status().pending, 0);

  const persistedWorld = await store.loadWorld(RESOURCE_WORLD);
  const persistedProfile = await store.loadProfile(ACCOUNT_ONE);
  assert.deepEqual(persistedWorld.data.resources.nodes, saved.data.resources.nodes);
  assert.deepEqual(persistedWorld.data.resources.logging, saved.data.resources.logging);
  assert.deepEqual(persistedWorld.data.resources.cooldowns, saved.data.resources.cooldowns);
  assert.deepEqual(persistedProfile.data, profilesBeforeCommit[0].data);
  assert.equal(persistedProfile.version, commits[0].expectedProfileVersion + 1);
  assert.equal(persistedWorld.version, saved.version + 2,
    'the live-world baseline checkpoint and denied-attempt receipt are both durable');
  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, command.opId));
  assert.equal(receipt.result.ack.why, 'timing');
  assert.deepEqual(receipt.request, commits[0]);
});

test('three valid v3 aim hits still award once and replay their exact receipt', async t => {
  const f = await fixture(t), { host, client, store, commits } = f;
  const node = findNode(host, 'palm');
  const acks = [];
  for (let hit = 1; hit <= 3; hit++) acks.push(await aimAndGather(f, hit, node));

  assert.ok(acks.every(ack => ack?.ok === true), JSON.stringify(acks));
  assert.equal(acks[2].count, 6);
  const profile = await store.loadProfile(ACCOUNT_ONE);
  assert.equal(profile.data.eco.pack.goods.tronco, 6);
  assert.equal(profile.data.progression.practice.logging, 10);
  const lastRequest = commits.at(-1);
  const operationId = economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, lastRequest.command.opId);
  const replay = await store.commitEconomicOperation({ operationId, request: lastRequest });
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.ack, lastRequest.ack);
  assert.equal(host.economicAuthority.failed, false);
});
