import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, joinPlayer, placeInCala, injectStep, events, deferred, restart, turn, OWNER, OTHER, command, neutral } from './helpers/ground-death-host.mjs';
import { hurtPlayer } from '../src/sim/systems/combat.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GameHost } from '../server/host.mjs';
import { A } from './helpers.mjs';

const copy = structuredClone;
const lethal = (host, victim, killer, seq = 9) => {
  const w = host.server.world;
  w.ecs.hp[victim.entity] = 1;
  return hurtPlayer(w, victim.entity, 9999, { x: w.ecs.x[victim.entity], z: w.ecs.z[victim.entity],
    kind: 'melee', seq, by: killer?.entity ?? 0, pierce: true, noInv: true, knock: 0 });
};

async function finishDeath(host) {
  for (let i = 0; i < 12 && host.combatDeaths.pending; i++) {
    await host.groundAuthority.settle();
    host.server.step();
  }
  assert.equal(host.combatDeaths.pending, false);
}

test('legacy host keeps death persistence and common family composition unmounted by default', async () => {
  const host = new GameHost({ bots: 0, log() {} });
  try {
    assert.equal(host.groundPearls, null);
    assert.equal(host.groundDeaths, null);
    assert.equal(host.combatDeaths, null);
    assert.throws(() => host.mountGroundDeaths(), { code: 'configuration' });
  } finally { await host.close(); }
});

test('GM content switching excludes a ready host with common death authorities mounted', async t => {
  const f = await fixture(t), host = f.host;
  try {
    const switching = host.contentSwitching;
    assert.equal(host.server.humans, 0);
    assert.ok(host.groundDeaths);
    assert.ok(host.combatDeaths);
    assert.ok(host.status().storage.groundDeaths);
    assert.ok(host.status().storage.combatDeaths);
    assert.ok(host.groundAuthority.canMutate());
    assert.throws(() => host.beginContentSwitch(), { code: 'gm_content_busy' });
    assert.equal(host.contentSwitching, switching, 'a rejected switch preserves its prior flag');
    assert.equal(host.healthy(), true);
    assert.equal(host.groundAuthority.canMutate(), true);
  } finally { await host.close().catch(() => {}); }
});

test('Cala fatal commits the whole captured death, but applies and publishes only on the next host boundary', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async (raw, result) => {
    entered.resolve({ raw: copy(raw), result: copy(result) }); await release.promise;
  } });
  const host = f.host;
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    const w = host.server.world, ecs = w.ecs, profile = w.profiles.get(victim.entity);
    const oldProfile = copy(profile), oldDrops = w.drops.size, oldRng = w.lootRng.state();
    const session = host.profiles.accounts.get(OWNER);
    assert.ok(session);
    const oldVersion = session.version;
    f.armCommitHook();
    injectStep(host, () => { lethal(host, victim, killer); ecs.xp[victim.entity] += 5; });
    victim.socket.messages.length = 0; killer.socket.messages.length = 0;
    assert.equal(host.server.step(), true, 'the fatal damage happens during a real server step');
    const committed = await entered.promise;
    const tx = committed.raw.request, op = tx.operation;
    assert.equal(committed.result?.ok, true, JSON.stringify(committed.result));
    assert.equal(tx.family, 'death');
    assert.equal(op.rules.lawless, true);
    assert.equal(op.rules.xpBefore, 85, 'capture sees terminal-tick ECS XP after the fatal hit');
    assert.equal(op.profiles.find(p => p.id === OWNER).data.xp, 76.5,
      'the durable profile was built from the captured XP');
    assert.equal(op.profiles.find(p => p.id === OTHER).data.stats.pk, 1);
    assert.equal(op.pearls.length, 2);
    assert.equal(op.drops.filter(d => d.kind === 'item').length, 2);
    assert.equal(op.drops.filter(d => d.kind === 'potion').length, 2);
    assert.deepEqual(profile, oldProfile, 'SQL completion has not changed the live profile');
    assert.equal(ecs.dead[victim.entity], 0, 'the provisional marker is cleared while death is pending');
    assert.equal(w.drops.size, oldDrops);
    assert.equal(w.lootRng.state(), oldRng, 'capture does not rewind or advance the live RNG');
    assert.equal(session.version, oldVersion + 1, 'the latest terminal-tick baseline is saved before its death commit');
    assert.equal(session.confirmed.xp, 85, 'ProfileSessions records the newest ECS progress before commit');
    assert.equal((await f.db.store.loadProfile(OWNER)).data.xp, 76.5, 'the SQL death receipt commits after that pre-save');
    assert.equal(events(victim, 'death').length + events(killer, 'death').length, 0);
    assert.equal(host.server.step(), false, 'pending transaction holds the following simulation tick');

    release.resolve(); await host.groundAuthority.settle();
    assert.deepEqual(w.profiles.get(victim.entity), oldProfile, 'receipt readiness alone is not a local apply');
    assert.equal(events(victim, 'death').length + events(killer, 'death').length, 0);
    assert.equal(host.server.step(), true, 'the next beforeTick drains the receipt');
    assert.equal(profile.stats.deaths, oldProfile.stats.deaths + 1);
    assert.equal(profile.xp, 76.5);
    assert.equal(w.profiles.get(killer.entity).stats.pk, 1);
    assert.equal(session.version, oldVersion + 2);
    assert.deepEqual(session.confirmed, profile, 'ProfileSessions advances with the local profile apply');
    assert.equal(w.drops.size, oldDrops + op.drops.length + op.pearls.length);
    assert.ok(ecs.deadT[victim.entity] > tuning.combat.respawnTime - 1 / 60);
    assert.equal(events(victim, 'death').length, 1);
    assert.equal(events(victim, 'respawn').length, 0);
    assert.equal((await f.db.store.loadProfile(f.seeded.victim.data.pirateId.slice(8))).data.xp, 76.5);
    assert.equal(host.groundDeaths.status().pending, 0);
    for (let i = 0; i < Math.ceil(tuning.combat.respawnTime / DT) + 2; i++) {
      host.server.clients.get(victim.clientId).queue.push(neutral(i + 10));
      if (!host.server.step()) { await host.groundAuthority.settle(); i--; }
    }
    assert.equal(ecs.dead[victim.entity], 0);
    assert.equal(events(victim, 'respawn').length, 1);
    assert.equal(profile.stats.deaths, 1, 'respawn does not replay the durable death');
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('exterior zero-pearl fatal keeps the safe-zone death result without generating loot', async t => {
  const f = await fixture(t, { pearlCount: 0, lawless: false, killer: false, loot: false }), host = f.host;
  try {
    const victim = await joinPlayer(host);
    placeInCala(host, victim);
    host.server.world.ecs.x[victim.entity] = A.x;
    host.server.world.ecs.z[victim.entity] = A.z;
    injectStep(host, () => lethal(host, victim, null));
    assert.equal(host.server.step(), true);
    await finishDeath(host);
    const operation = f.transactions.find(raw => raw.request?.family === 'death')?.request.operation;
    assert.ok(operation);
    assert.equal(operation.rules.lawless, false);
    assert.equal(operation.pearls.length, 0);
    assert.equal(operation.drops.length, 0);
    assert.equal(host.server.world.drops.size, 0);
    assert.equal(host.server.world.profiles.get(victim.entity).stats.deaths, 1);
  } finally { await host.close().catch(() => {}); }
});

test('death current rows hydrate after restart; an ordinary drop can be picked and another expired under the same owner', async t => {
  const f = await fixture(t), host = f.host;
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    injectStep(host, () => lethal(host, victim, killer));
    assert.equal(host.server.step(), true);
    await finishDeath(host);
    const local = [...host.server.world.drops.values()].filter(d => d.kind === 'item' || d.kind === 'potion');
    assert.equal(local.length, 4);
    const resumed = await restart(f);
    const drops = [...resumed.host.server.world.drops.values()];
    const ordinary = drops.filter(d => d.kind === 'item' || d.kind === 'potion');
    assert.equal(ordinary.length, 4, 'restart hydrates current ordinary death-drop rows');
    assert.equal(drops.filter(d => d.kind === 'pearl').length, 2, 'pearl locations hydrate alongside ordinary drops');
    const receiver = await joinPlayer(resumed.host, 'other');
    const item = ordinary.find(d => d.kind === 'item');
    resumed.host.server.world.ecs.x[receiver.entity] = item.x;
    resumed.host.server.world.ecs.z[receiver.entity] = item.z;
    const pickup = resumed.pearls.pickupDrop({ dropId: item.id,
      receiver: { clientId: receiver.clientId, entity: receiver.entity } });
    await resumed.host.groundAuthority.settle();
    assert.equal(resumed.host.server.world.drops.has(item.id), true, 'prepared receipt has not applied yet');
    assert.equal(resumed.host.server.step(), true);
    await pickup.result;
    assert.equal(resumed.host.server.world.drops.has(item.id), false);
    assert.ok(resumed.host.server.world.profiles.get(receiver.entity).bag.length > 0);
    await resumed.host.profiles.flush();

    resumed.host.server.world.ecs.x[receiver.entity] += 100;
    const potion = ordinary.find(d => d.kind === 'potion');
    resumed.host.server.world.tick = potion.t + 1;
    const expiry = resumed.pearls.expireDrop({ dropId: potion.id });
    await resumed.host.groundAuthority.settle();
    assert.equal(resumed.host.server.world.drops.has(potion.id), true, 'the expiry receipt is staged until beforeTick');
    for (let i = 0; i < 8 && resumed.host.server.world.drops.has(potion.id); i++) {
      if (!resumed.host.server.step()) await resumed.host.groundAuthority.settle();
    }
    await expiry.result;
    assert.equal(resumed.host.server.world.drops.has(potion.id), false);
    assert.equal(resumed.host.groundAuthority.status().failed, false);
    assert.equal(resumed.host.groundDeaths.status().failed, false);
  } finally { await host.close().catch(() => {}); }
});

test('fatal input inside a real server step neutralizes the remainder of its queued commands', async t => {
  const f = await fixture(t), host = f.host;
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    const client = host.server.clients.get(victim.clientId), w = host.server.world;
    const apply = w.applyCommand.bind(w);
    w.applyCommand = (entity, cmd) => {
      apply(entity, cmd);
      if (entity === victim.entity && cmd.seq === 1) lethal(host, victim, killer, cmd.seq);
    };
    client.queue.push(command(1), command(2), command(3)); client.last = command(0);
    assert.equal(host.server.step(), true);
    assert.deepEqual([client.last.mx, client.last.mz, client.last.btn, client.last.prs, client.last.w], [1, 1, 0x3ff, 0x3ff, 1],
      'the reversible pending interval retains the prior command snapshot');
    assert.equal(host.combatDeaths.pending, true);
    assert.equal(events(victim, 'death').length, 0);
    await finishDeath(host);
    host.server.step();
    assert.deepEqual([client.last.mx, client.last.mz, client.last.btn, client.last.prs, client.last.w], [0, 0, 0, 0, 0]);
    assert.equal(client.queue.length, 0);
  } finally { await host.close().catch(() => {}); }
});

test('fatal deaths from one terminal tick serialize profile and PK versions', async t => {
  const f = await fixture(t, { thirdPlayer: true }), host = f.host;
  try {
    const first = await joinPlayer(host), killer = await joinPlayer(host, 'other'), second = await joinPlayer(host, 'third');
    placeInCala(host, first, killer, second);
    injectStep(host, () => { lethal(host, first, killer, 11); lethal(host, second, killer, 12); });
    assert.equal(host.server.step(), true);
    await finishDeath(host);
    const deaths = f.transactions.filter(raw => raw.request?.family === 'death');
    assert.equal(deaths.length, 2, `death transactions: ${deaths.map(raw => raw.operationId).join(',')}`);
    const a = deaths[0].request.operation.profiles.find(p => p.id === OWNER);
    const b = deaths[1].request.operation.profiles.find(p => p.id.endsWith('bbbb'));
    const priorKiller = deaths[0].request.operation.profiles.find(p => p.id.endsWith('bbbb'));
    assert.ok(a && b && priorKiller);
    assert.equal(b.expectedVersion, priorKiller.expectedVersion + 1);
    assert.deepEqual(b.before, priorKiller.data);
    assert.equal(host.server.world.profiles.get(killer.entity).stats.pk, 2);
    assert.equal(host.server.world.profiles.get(first.entity).stats.deaths, 1);
    assert.equal(host.server.world.profiles.get(second.entity).stats.deaths, 1);
    const published = [...events(first, 'death'), ...events(second, 'death')];
    assert.equal(published.length, 4, 'each connected client receives both serialized death events');
    assert.deepEqual(new Set(published.map(event => event.ev.id)), new Set([first.entity, second.entity]));
  } finally { await host.close(); }
});

test('a killer who dies later in the same terminal tick transfers the killer role serially', async t => {
  const f = await fixture(t, { pearlCount: 0, thirdPlayer: true }), host = f.host;
  try {
    const first = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, first, killer);
    injectStep(host, () => { lethal(host, first, killer, 21); lethal(host, killer, first, 22); });
    assert.equal(host.server.step(), true);
    await finishDeath(host);
    const deaths = f.transactions.filter(raw => raw.request?.family === 'death');
    assert.equal(deaths.length, 2);
    assert.equal(deaths[0].request.operation.victim, OWNER);
    assert.equal(deaths[0].request.operation.killer, OTHER);
    assert.equal(deaths[1].request.operation.victim, OTHER);
    assert.equal(deaths[1].request.operation.killer, OWNER);
    const firstAfter = deaths[0].request.operation.profiles.find(p => p.id === OWNER).data;
    const firstAgain = deaths[1].request.operation.profiles.find(p => p.id === OWNER);
    assert.equal(firstAgain.expectedVersion, deaths[0].request.operation.profiles.find(p => p.id === OWNER).expectedVersion + 1);
    assert.deepEqual(firstAgain.before, firstAfter);
    assert.equal(host.server.world.profiles.get(first.entity).stats.deaths, 1);
    assert.equal(host.server.world.profiles.get(first.entity).stats.pk, 1);
    assert.equal(host.server.world.profiles.get(killer.entity).stats.deaths, 1);
    assert.equal(host.server.world.profiles.get(killer.entity).stats.pk, 1);
  } finally { await host.close().catch(() => {}); }
});

test('disconnect after SQL commit but before beforeTick fences death without local apply', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async () => { entered.resolve(); await release.promise; } });
  const host = f.host;
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    const profile = host.server.world.profiles.get(victim.entity), before = copy(profile);
    f.armCommitHook(); injectStep(host, () => lethal(host, victim, killer));
    assert.equal(host.server.step(), true);
    await entered.promise;
    host.server.disconnect(victim.clientId);
    release.resolve(); await host.groundAuthority.settle();
    assert.equal(host.server.step(), false);
    assert.deepEqual(profile, before, 'committed SQL is not replayed into a detached entity');
    assert.equal(host.server.world.drops.size, 0);
    assert.equal(host.groundDeaths.status().failed, true);
    const saved = await f.db.store.loadProfile(f.seeded.victim.data.pirateId.slice(8));
    assert.equal(saved.data.stats.deaths, before.stats.deaths + 1, 'the durable receipt remains committed');
  } finally { release.resolve(); await host.close().catch(() => {}); }
});

test('close after SQL commit but before apply preserves the local pre-death snapshot', async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { commitHook: async () => { entered.resolve(); await release.promise; } });
  const host = f.host;
  const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
  placeInCala(host, victim, killer);
  const profile = host.server.world.profiles.get(victim.entity), before = copy(profile);
  f.armCommitHook(); injectStep(host, () => lethal(host, victim, killer));
  assert.equal(host.server.step(), true); await entered.promise;
  release.resolve(); await host.groundAuthority.settle();
  await host.close().catch(() => {});
  assert.deepEqual(profile, before);
  assert.equal(host.server.world.drops.size, 0);
  assert.equal(events(victim, 'death').length, 0);
  assert.equal((await f.db.store.loadProfile(f.seeded.victim.data.pirateId.slice(8))).data.stats.deaths, before.stats.deaths + 1);
});

test('apply failure after SQL commit restores the local death projection and fences the host', async t => {
  const f = await fixture(t), host = f.host;
  const originalPush = Array.prototype.push;
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    const w = host.server.world;
    injectStep(host, () => lethal(host, victim, killer));
    assert.equal(host.server.step(), true);
    await host.groundAuthority.settle();
    const profile = w.profiles.get(victim.entity), before = copy(profile);
    const columns = Object.entries(w.ecs).filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
      .map(([key, column]) => ({ key, column, value: column[victim.entity] }));
    const client = host.server.clients.get(victim.clientId), last = copy(client.last), queue = copy(client.queue);
    const dropData = copy([...w.drops]), rng = w.lootRng.state(), eventData = copy(w.events);
    let fenceSnapshot = null;
    const captureFenceState = () => ({ profile: copy(profile), drops: copy([...w.drops]), rng: w.lootRng.state(),
      events: copy(w.events), columns: columns.map(q => [q.key, q.column[victim.entity]]),
      last: copy(client.last), queue: copy(client.queue) });
    const fence = host.fenceWorld.bind(host);
    host.fenceWorld = code => { fenceSnapshot ??= captureFenceState(); return fence(code); };
    let failedPublish = false;
    Array.prototype.push = function (...items) {
      if (this === w.events && items.some(event => event?.type === 'death')) {
        failedPublish = true; throw new Error('simulated death publication failure');
      }
      return originalPush.apply(this, items);
    };
    host.server.step();
    assert.equal(failedPublish, true, 'the injected failure interrupted death publication');
    assert.equal(host.groundAuthority.status().failed, true);
    Array.prototype.push = originalPush;
    assert.ok(fenceSnapshot, 'the failed projection fences world mutation');
    assert.deepEqual(fenceSnapshot.profile, before, 'an apply exception rolls back the exact preapply profile');
    assert.deepEqual(fenceSnapshot.drops, dropData);
    assert.equal(fenceSnapshot.rng, rng);
    assert.deepEqual(fenceSnapshot.events, eventData);
    assert.deepEqual(fenceSnapshot.columns, columns.map(q => [q.key, q.value]),
      'the failure fence observes ECS rollback before socket teardown');
    assert.deepEqual(fenceSnapshot.last, last);
    assert.deepEqual(fenceSnapshot.queue, queue);
    assert.equal(w.ecs.alive[victim.entity], 0, 'the fenced connection is retired after rollback');
    assert.equal(w.ecs.mask[victim.entity], 0);
    await turn();
    assert.equal(host.groundDeaths.status().failed, true);
    const durable = await f.db.store.loadProfile(OWNER);
    assert.equal(durable.data.stats.deaths, 1);
  } finally { Array.prototype.push = originalPush; await host.close().catch(() => {}); }
});
