import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { newProfile } from '../src/sim/systems/inventory.js';
import { GameHost } from '../server/host.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { newCommunityState } from '../server/communityProject.mjs';
import { newResourceState, upgradeLoggingState } from '../server/resourceState.mjs';
import { database, reopenDatabase } from './helpers/ground-host-authority-sql.mjs';
import { connect } from './helpers/resource-authority-fixture.mjs';
import { MSG } from '../src/net/protocol.js';
import { TOWNS } from '../src/data/towns.js';
import { sanitizeRaftCondition } from '../src/sim/naval/condition.js';
import { economicOperationId } from '../server/economicAuthority.mjs';

const WORLD = 'ground-host-sql';
const SEED = 97;
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = n => `a1500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const turn = () => new Promise(resolve => setImmediate(resolve));
const copy = value => structuredClone(value);

function seededProfile(account, { artisan = false, goods = {} } = {}) {
  // This fixture deliberately exercises SQL001-021 with workshop operations disabled.
  const profile = newProfile({ starter: false });
  profile.pirateId = `account:${account}`;
  profile.tools.axe = 1;
  profile.gold = 1000;
  profile.eco.pack.goods = { ...goods };
  if (artisan) profile.progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  return profile;
}

async function seedDatabase(f) {
  const template = new GameHost({ seed: SEED, bots: 0, store: createMemoryStore(), log() {} });
  try {
    const resources = upgradeLoggingState(newResourceState(template.server.world));
    assert.equal(resources.nodes.length, template.server.world.resources.nodes.size,
      'fixture includes every node in the deterministic resource layout');
    resources.tick = 1000;
    const palm = resources.nodes.find(row => row.kind === 'palm');
    assert.ok(palm);
    palm.rev = 3; palm.hits = 2;
    resources.logging[palm.id] = { cycle: 1, contributors: [{ actor: ACCOUNT_A, hits: 2 }] };
    const community = newCommunityState(WORLD, { madera: 4, piedra: 2 });
    community.project.version = 4;
    community.project.contributed = { madera: 3, piedra: 2 };
    const data = { v: 1, seed: SEED, economy: template.server.world.economy.serialize(), community, resources };
    await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [WORLD, data]);
    await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1),($3::uuid,$4::jsonb,1)',
      [ACCOUNT_A, seededProfile(ACCOUNT_A), ACCOUNT_B, seededProfile(ACCOUNT_B, {
        artisan: true, goods: { madera: 2 },
      })]);
    const clock = await f.store.commitGroundClock({ operationId: ID(1), world: WORLD,
      expectedVersion: 0, expectedTick: 0, tick: 1000 });
    assert.equal(clock.ok, true, 'the resource snapshot and SQL013 clock begin on one durable tick');
  } finally { await template.close(); }
}

function hostFor(f) {
  return new GameHost({ seed: SEED, bots: 0, store: f.store, worldId: WORLD, log() {},
    resolvePlayer: async (_request, hello) => hello.name === 'A' ? ACCOUNT_A : hello.name === 'B' ? ACCOUNT_B : null,
    economicOperations: true, resourceOperations: true, loggingOperations: true, artisanOperations: true,
    communityRequirements: { madera: 4, piedra: 2 }, groundTransactions: { journal: f.journal(WORLD) } });
}

async function connectAccount(host, name) {
  const client = connect(host, name);
  client.hello();
  await Promise.all([...host.joins]);
  assert.equal(client.of(MSG.WELCOME).length, 1, `${name} joins from its stored account profile`);
  return client;
}

async function sendAndPump(host, client, command) {
  client.send(command);
  for (let i = 0; i < 160; i++) {
    await turn();
    assert.equal(client.events(command.opId).length, 0, `no ACK for ${command.opId} can publish before the host step drains durable work`);
    host.server.step();
    const ack = client.events(command.opId).at(-1);
    if (ack) return ack;
  }
  assert.fail(`no authoritative ACK for ${command.opId}: ${JSON.stringify({
    ground: host.groundAuthority?.status(), economic: host.economicAuthority?.status(), world: host.worldState?.status(),
  })}`);
}

async function pumpCheckpoint(host, previousVersion) {
  for (let i = 0; i < 160; i++) {
    await turn();
    host.server.step();
    if (host.worldState.version > previousVersion && !host.groundAuthority.busy && !host.worldState.running) return;
  }
  assert.fail(`checkpoint did not drain: ${JSON.stringify({ ground: host.groundAuthority.status(), world: host.worldState.status() })}`);
}

function positionAt(host, entity, point) {
  const world = host.server.world, ecs = world.ecs;
  ecs.x[entity] = point.x; ecs.z[entity] = point.z;
  ecs.y[entity] = Number.isFinite(point.y) ? point.y : world.map.groundAt(point.x, point.z);
  ecs.regenT[entity] = 100; ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0; ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

function standOnRaft(host, entity, raft) {
  const ecs = host.server.world.ecs, angle = ecs.facing[raft.entity];
  const c = Math.cos(angle), s = Math.sin(angle);
  ecs.x[entity] = ecs.x[raft.entity] + c + s;
  ecs.z[entity] = ecs.z[raft.entity] - s + c;
  ecs.y[entity] = ecs.y[raft.entity]; ecs.regenT[entity] = 100;
  ecs.moveMag[entity] = 0; ecs.vx[entity] = 0; ecs.vz[entity] = 0;
  ecs.dashT[entity] = -1; ecs.dashBuffer[entity] = 0;
  ecs.castK[entity] = 0; ecs.castLock[entity] = 0; ecs.atkStage[entity] = 0;
}

async function closeHost(host) {
  if (host && !host.closePromise) await host.close();
}

test('SQL018/019 GameHost routes human operations and world checkpoints through one recovered authority', async t => {
  const path = join(await mkdtemp(join(tmpdir(), 'ground-host-sql-')), 'db');
  let fixture = await database(path), host = null, restarted = null;
  t.after(async () => {
    await closeHost(host); await closeHost(restarted); await fixture.close();
  });
  await seedDatabase(fixture);
  host = hostFor(fixture);
  await host.prepare();
  assert.equal(host.groundAuthority.ready, true);
  assert.equal(host.groundAuthority.status().clock.tick, 1000);
  const a = await connectAccount(host, 'A'), b = await connectAccount(host, 'B');
  const entity = host.server.clients.get(b.id).entity;

  const palm = [...host.server.world.resources.nodes.values()].find(node => node.kind === 'palm' && node.rev === 3);
  assert.ok(palm);
  positionAt(host, entity, host.server.world.resources.bench);
  const wood = await sendAndPump(host, b, { type: 'community', op: 'contribute', opId: 'sql-project-wood',
    projectId: 'salty-shore-carpentry', good: 'madera', amount: 1, expectedRev: host.worldState.community.project.version });
  assert.equal(wood.ok, true, 'a contribution and profile debit commit through SQL018/019');
  assert.equal(wood.project.complete, true, 'the seeded cooperative project accepts only its final wood unit');

  positionAt(host, entity, palm);
  const logged = await sendAndPump(host, b, { type: 'resource', op: 'gather', opId: 'sql-cooperative-palm', node: palm.id, expectedRev: palm.rev });
  assert.equal(logged.ok, true, `the finishing palm hit commits with both contributors under SQL019: ${JSON.stringify(logged)}`);
  assert.ok(host.profiles.accounts.get(ACCOUNT_A).confirmed.progression.practice.logging > 0,
    'the earlier contributor receives the durable cooperative practice award');
  for (let i = 0; i < 60; i++) host.server.step();
  positionAt(host, entity, host.server.world.resources.bench);
  const profile = host.server.world.profiles.get(entity);
  const crafted = await sendAndPump(host, b, { type: 'resource', op: 'craft', opId: 'sql-artisan-craft', recipe: 'madera', n: 1,
    expectedRev: profile.eco.tradeRev });
  assert.equal(crafted.ok, true, `the resource craft commits through SQL019: ${JSON.stringify(crafted)}`);
  const learned = await sendAndPump(host, b, { type: 'artisan', op: 'learn', opId: 'sql-artisan-learn', lesson: 'raft_storage',
    expectedRev: profile.eco.tradeRev, expectedProjectRev: host.worldState.community.project.version });
  assert.equal(learned.ok, true, `SQL021 artisan teaching is nested in the same SQL018/019 receipt path: ${JSON.stringify(learned)}`);

  const townData = TOWNS.aldea;
  const town = host.server.world.map.landmarks[townData.landmark] || host.server.world.map[townData.landmark];
  positionAt(host, entity, town);
  const buyQuote = host.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  const buy = { type: 'commerce', op: 'buy', opId: 'sql-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: buyQuote.total };
  const bought = await sendAndPump(host, b, buy);
  assert.equal(bought.ok, true, `commerce applies after SQL018 preparation and server-step drain: ${JSON.stringify({
    bought, ground: host.groundAuthority.status(), economic: host.economicAuthority.status(), world: host.worldState.status(),
  })}`);

  const checkpointVersion = host.worldState.version;
  host.server.world.economy.markets.aldea.stock.fruta++;
  host.worldState.save(host.server.world.economy);
  await pumpCheckpoint(host, checkpointVersion);

  fixture.loseNextReply();
  const lostQuote = host.server.world.economy.quote('aldea', 'fruta', 1, 'buy');
  const lostBuy = { type: 'commerce', op: 'buy', opId: 'sql-lost-reply-buy', town: 'aldea', g: 'fruta', n: 1, expectedTotal: lostQuote.total };
  assert.equal((await sendAndPump(host, b, lostBuy)).ok, true, 'receipt lookup recovers the intentionally lost commit response');
  const profileBeforeRestart = copy(host.server.world.profiles.get(entity));
  let persistedWorldBeforeRestart;
  const familyCounts = (await fixture.db.query('select request->>\'family\' as family,count(*)::int as count '
    + 'from public.mn_ground_transaction_intents where world=$1 group by family', [WORLD])).rows;
  const counts = Object.fromEntries(familyCounts.map(row => [row.family, row.count]));
  assert.ok(counts.economic >= 5, `economic operations committed through SQL018/019: ${JSON.stringify(counts)}`);
  assert.ok(counts.checkpoint >= 1, `world flush committed through the checkpoint family: ${JSON.stringify(counts)}`);
  assert.equal((await fixture.db.query('select count(*)::int as n from public.mn_ground_transaction_intents where world=$1 and state<>\'committed\'', [WORLD])).rows[0].n, 0);

  await closeHost(host); host = null;
  persistedWorldBeforeRestart = await fixture.store.loadWorld(WORLD);
  const intentCountBeforeRestart = (await fixture.db.query('select count(*)::int as n from public.mn_ground_transaction_intents where world=$1', [WORLD])).rows[0].n;
  await fixture.close();
  fixture = await reopenDatabase(path);
  restarted = hostFor(fixture);
  await restarted.prepare();
  assert.equal(restarted.groundAuthority.ready, true, 'restart adopts current clock/world rows before accounts can join');
  const replayClient = await connectAccount(restarted, 'B');
  const entity2 = restarted.server.clients.get(replayClient.id).entity;
  const versionBeforeReplay = restarted.worldState.version;
  const profileVersionBeforeReplay = restarted.profiles.accounts.get(ACCOUNT_B).version;
  const replay = await sendAndPump(restarted, replayClient, lostBuy);
  assert.equal(replay.ok, true); assert.equal(replay.replay, true);
  assert.equal(restarted.worldState.version, versionBeforeReplay);
  assert.equal(restarted.profiles.accounts.get(ACCOUNT_B).version, profileVersionBeforeReplay);
  assert.deepEqual(restarted.server.world.profiles.get(entity2), profileBeforeRestart,
    'historical replay after restart does not install an older profile or change the receipt rows');
  assert.deepEqual(await fixture.store.loadWorld(WORLD), persistedWorldBeforeRestart);
  assert.equal((await fixture.db.query('select count(*)::int as n from public.mn_ground_transaction_intents where world=$1', [WORLD])).rows[0].n,
    intentCountBeforeRestart, 'retry reuses the exact intent/receipt rather than adding another row');
  assert.equal((await fixture.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n, counts.economic,
    'the underlying economic ledger also remains single-application after lost reply and restart');
  t.diagnostic('SQL001–021 service-role PGlite integration: commerce, cooperative logging, community contribution, artisan learning, checkpoint, lost response and restart replay.');
});

test('SQL018/019 GameHost durably places and removes a learned storage piece', async t => {
  const path = join(await mkdtemp(join(tmpdir(), 'ground-storage-sql-')), 'db');
  const fixture = await database(path);
  let host = null;
  t.after(async () => { await closeHost(host); await fixture.close(); });
  await seedDatabase(fixture);

  const profileRow = (await fixture.db.query('select data from public.mn_profiles where player_id=$1::uuid', [ACCOUNT_B])).rows[0];
  const profile = profileRow.data;
  profile.progression.knowledge = ['raft_storage'];
  profile.eco.pack.goods = { madera: 2 };
  const ship = profile.eco.ships.find(value => value.kind === 'raft');
  assert.ok(ship, 'the seeded profile has its normal starter raft');
  ship.grid.parts.push(['crate', 0, 1, 0, 0]);
  ship.condition = sanitizeRaftCondition(ship.condition, ship.grid.parts);
  ship.hold.cap = 12;
  ship.hold.goods = { madera: 4 };
  await fixture.db.query('update public.mn_profiles set data=$2::jsonb where player_id=$1::uuid', [ACCOUNT_B, profile]);

  host = hostFor(fixture);
  await host.prepare();
  const client = await connectAccount(host, 'B');
  const entity = host.server.clients.get(client.id).entity;
  const joinedProfile = host.server.world.profiles.get(entity);
  const joinedShip = joinedProfile.eco.ships.find(value => value.kind === 'raft');
  const initialShipId = joinedShip.id;
  const raft = host.server.world.rafts.get(joinedShip.id);
  assert.ok(raft, 'the actual starter raft is mounted in the server world');
  assert.deepEqual(joinedShip.grid.parts.find(part => part[0] === 'crate' && part[1] === 0 && part[2] === 1),
    ['crate', 0, 1, 0, 0]);

  const piece = ['storage', 1, 0, 0, 0];
  standOnRaft(host, entity, raft);
  const placed = await sendAndPump(host, client, { type: 'raft', op: 'place', id: joinedShip.id,
    expectedRev: joinedShip.rev, piece, opId: 'sql-storage-place' });
  assert.equal(placed.ok, true, `storage placement uses the normal raft editor: ${JSON.stringify(placed)}`);
  assert.equal(joinedShip.id, initialShipId, 'placement preserves the original starter raft identity');
  assert.ok(joinedShip.grid.parts.some(part => JSON.stringify(part) === JSON.stringify(piece)));
  assert.equal(joinedShip.hold.cap, 32, 'storage adds its full 20-unit capacity');
  assert.equal(joinedShip.hold.goods.madera, undefined);
  assert.equal(joinedProfile.eco.pack.goods.madera, undefined, 'placement debits all six wood once');

  const removedIndex = joinedShip.grid.parts.findIndex(part => JSON.stringify(part) === JSON.stringify(piece));
  standOnRaft(host, entity, raft);
  const removed = await sendAndPump(host, client, { type: 'raft', op: 'remove', id: joinedShip.id,
    expectedRev: joinedShip.rev, piece, index: removedIndex, opId: 'sql-storage-remove' });
  assert.equal(removed.ok, true, `storage removal commits and refunds the documented salvage: ${JSON.stringify(removed)}`);
  assert.equal(joinedShip.id, initialShipId);
  assert.equal(joinedShip.grid.parts.some(part => JSON.stringify(part) === JSON.stringify(piece)), false);
  assert.equal(joinedShip.hold.cap, 12);
  assert.equal(joinedShip.hold.goods.madera, 3, 'removal refunds exactly half of the six-wood storage cost into available raft capacity');
  assert.equal(joinedProfile.eco.pack.goods.madera, undefined);
  assert.equal((joinedShip.hold.goods.madera || 0) + (joinedProfile.eco.pack.goods.madera || 0), 3);

  for (const opId of ['sql-storage-place', 'sql-storage-remove']) {
    const operationId = economicOperationId(WORLD, ACCOUNT_B, opId);
    const outer = await fixture.db.query('select count(*)::int as n from public.mn_ground_transactions where operation_id=$1::uuid', [operationId]);
    const intent = await fixture.db.query('select count(*)::int as n from public.mn_ground_transaction_intents where operation_id=$1::uuid and state=\'committed\'', [operationId]);
    const economic = await fixture.db.query('select count(*)::int as n from public.mn_economic_operations where operation_id=$1::uuid', [operationId]);
    assert.equal(outer.rows[0].n, 1, `${opId} has one SQL018 outer receipt`);
    assert.equal(intent.rows[0].n, 1, `${opId} has one committed SQL019 journal intent`);
    assert.equal(economic.rows[0].n, 1, `${opId} has one SQL014 economic receipt`);
    const receipt = await fixture.store.loadEconomicOperation(operationId);
    assert.equal(receipt.result.ack.ok, true);
  }
  t.diagnostic('SQL001–021 storage editor integration: one place and one removal, exact material/capacity deltas, and one SQL014/018/019 receipt each.');
});
