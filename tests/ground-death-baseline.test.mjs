import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, joinPlayer, placeInCala, injectStep, deferred, OWNER } from './helpers/ground-death-host.mjs';
import { capturePearlProfile } from '../server/pearlProfileSnapshot.mjs';
import { hurtPlayer } from '../src/sim/systems/combat.js';

test('a terminal death waits for an older in-flight save and settles its newer completed-tick baseline', async t => {
  const f = await fixture(t), host = f.host, entered = deferred(), release = deferred();
  const save = host.store.saveProfile.bind(host.store);
  let held = false;
  host.store.saveProfile = async (...args) => {
    if (!held && args[0] === OWNER) { held = true; entered.resolve(); await release.promise; }
    return save(...args);
  };
  try {
    const victim = await joinPlayer(host), killer = await joinPlayer(host, 'other');
    placeInCala(host, victim, killer);
    const w = host.server.world, s = host.profiles.clients.get(victim.clientId), initialVersion = s.version;
    w.ecs.xp[victim.entity] = 81;
    host.profiles.save(victim.clientId, capturePearlProfile(w, victim.entity));
    await entered.promise;
    injectStep(host, () => {
      w.ecs.hp[victim.entity] = 1;
      hurtPlayer(w, victim.entity, 9999, { x: w.ecs.x[victim.entity], z: w.ecs.z[victim.entity],
        kind: 'melee', seq: 77, by: killer.entity, pierce: true, noInv: true, knock: 0 });
      w.ecs.xp[victim.entity] += 5;
    });
    assert.equal(host.server.step(), true);
    assert.equal(w.ecs.xp[victim.entity], 86);
    assert.equal(host.groundAuthority.busy, true);
    assert.equal(host.server.step(), false);
    assert.equal(f.transactions.filter(r => r.request.family === 'death').length, 0,
      'the death cannot commit over the older profile CAS');
    release.resolve(); await host.groundAuthority.settle();
    const op = f.transactions.find(r => r.request.family === 'death')?.request.operation;
    assert.ok(op);
    assert.equal(op.rules.xpBefore, 86);
    const actor = op.profiles.find(p => p.id === OWNER);
    assert.equal(actor.before.xp, 86);
    assert.equal(actor.expectedVersion, initialVersion + 2, 'older save and terminal baseline settled in order');
    assert.equal(actor.data.xp, 77.4);
    assert.equal(s.confirmed.xp, 86, 'SQL receipt readiness has not installed the death locally');
    assert.equal((await host.store.loadProfile(OWNER)).data.xp, 77.4);
    host.server.step();
    assert.equal(host.groundAuthority.status().failed, false);
    assert.equal(w.profiles.get(victim.entity).xp, 77.4);
    assert.equal(s.version, initialVersion + 3);
    assert.equal(s.confirmed.stats.deaths, 1);
    await host.profiles.flush();
    assert.equal((await host.store.loadProfile(OWNER)).data.xp, 77.4,
      'no older pending autosave overwrites the confirmed death');
  } finally {
    release.resolve(); host.store.saveProfile = save;
    await host.close().catch(() => {});
  }
});
