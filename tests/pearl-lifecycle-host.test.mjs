import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHost } from '../server/host.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { fixture, WORLD, Socket, clockFor, turn } from './helpers/pearl-lifecycle-host.mjs';

const clone = structuredClone;
const pickupResult = (f, drop) => f.base.loadPearlLocation(drop.pearl.uid);

test('ordinary hosts stay dormant and pearl-ground mount rejects incomplete composition', async () => {
  const host = new GameHost({ bots: 0, log() {} });
  try {
    assert.equal(host.pearlGround, null);
    assert.throws(() => host.mountPearlGround(), { code: 'configuration' });
    assert.equal(host.pearlGround, null);
  } finally { await host.close(); }
});

test('explicit mounts require death/combat prerequisites and happen before preparation', async () => {
  const f = await fixture({ mount: false });
  try {
    assert.throws(() => f.host.mountPearlGround(), { code: 'configuration' });
    assert.equal(f.host.pearlGround, null);
  } finally { await f.close(); }
});

test('slow authenticated pickup holds completed tick and emits one durable pickup only after apply', async () => {
  const f = await fixture();
  const gate = f.holdNextCommit();
  try {
    const drop = f.drops[0], entity = f.entities[0]; f.position(entity, drop);
    f.world.tick = drop.pickAt; const tick = f.world.tick, source = clone(drop), profile = clone(f.world.profiles.get(entity));
    assert.equal(f.server.step(), false); await gate.entered.promise;
    assert.equal(f.lifecycle.pending, true); assert.equal(f.world.tick, tick); assert.equal(f.world.drops.get(drop.id), drop);
    assert.deepEqual(f.world.profiles.get(entity), profile); assert.equal(f.output('pickup').length, 0);
    assert.equal(f.server.step(), false); assert.equal(f.world.tick, tick);
    gate.release.resolve(); await f.lifecycle.settle();
    assert.equal(f.world.drops.get(drop.id), drop, 'the storage continuation cannot mutate the live world');
    assert.equal(f.server.step(), true); assert.equal(f.world.tick, tick + 1);
    assert.equal(f.world.drops.has(drop.id), false);
    assert.equal(f.world.profiles.get(entity).pearls.bag.at(-1).uid, source.pearl.uid);
    assert.deepEqual(await pickupResult(f, drop), { world: WORLD, ground: null, version: 2 });
    assert.equal(f.output('pickup').length, 1);
    assert.equal(f.server.step(), true); assert.equal(f.output('pickup').length, 1);
  } finally { gate.release.resolve(); await f.close(); }
});

test('scan skips a full first authenticated carrier and picks up for the next eligible carrier', async () => {
  const heldPearls = Array.from({ length: 8 }, (_, i) => ({ uid: `held-full-${i}`, kind: 'brasa' }));
  const f = await fixture({ heldPearls });
  try {
    const drop = f.drops[0], [first, second] = f.entities;
    f.position(first, drop); f.position(second, drop);
    f.world.tick = drop.pickAt;
    assert.equal(f.server.step(), false); await f.lifecycle.settle(); assert.equal(f.server.step(), true);
    assert.equal(f.world.profiles.get(first).pearls.bag.length, 8);
    assert.equal(f.world.profiles.get(second).pearls.bag.at(-1).uid, drop.pearl.uid);
    assert.equal(f.output('pearlDenied').filter(m => m.ev.to === first).length, 1);
    assert.equal(f.output('pickup').length, 1);
  } finally { await f.close(); }
});

test('full-carrier denial is once per source and account while source remains available', async () => {
  const heldPearls = Array.from({ length: 8 }, (_, i) => ({ uid: `held-denial-${i}`, kind: 'tinta' }));
  const f = await fixture({ heldPearls });
  try {
    const drop = f.drops[0], first = f.entities[0];
    f.position(first, drop); f.quiet([f.entities[1]]);
    for (const tick of [drop.pickAt, drop.pickAt + 3, drop.pickAt + 6]) {
      f.world.tick = tick; assert.equal(f.server.step(), true);
    }
    assert.equal(f.world.drops.get(drop.id), drop);
    assert.equal(f.output('pearlDenied').filter(m => m.ev.to === first).length, 1);
    assert.equal(f.output('pickup').length, 0);
  } finally { await f.close(); }
});

test('projected pearl is ignored before availability and becomes eligible at exact pickAt', async () => {
  const f = await fixture({ pearls: [{ uid: 'wait-until-six', kind: 'escarcha', availableIn: 6, returnIn: 90 }] });
  try {
    const drop = f.drops[0]; f.position(f.entities[0], drop);
    for (const tick of [0, 3]) { f.world.tick = tick; assert.equal(f.server.step(), true); }
    assert.equal(f.world.drops.get(drop.id), drop); assert.equal(f.output('pickup').length, 0);
    f.world.tick = drop.pickAt; assert.equal(drop.pickAt, 6); assert.equal(f.server.step(), false);
    await f.lifecycle.settle(); assert.equal(f.server.step(), true);
    assert.equal(f.world.drops.has(drop.id), false); assert.equal(f.output('pickup').length, 1);
  } finally { await f.close(); }
});

test('pickup is allowed at exact returnAt tick; expiry begins only strictly after it', async () => {
  const f = await fixture({ pearls: [{ uid: 'inclusive-expiry', kind: 'brasa', availableIn: 0, returnIn: 9 }] });
  try {
    const drop = f.drops[0]; f.position(f.entities[0], drop); f.quiet([f.entities[1]]);
    f.world.tick = drop.t; assert.equal(drop.t, 9); assert.equal(f.server.step(), false);
    await f.lifecycle.settle(); assert.equal(f.server.step(), true);
    assert.equal(f.world.drops.has(drop.id), false); assert.equal(f.output('pickup').length, 1);
    assert.equal(f.output('pearlReturn').length, 0);
  } finally { await f.close(); }
});

test('strictly expired pearl is durably returned before source removal', async () => {
  const f = await fixture({ pearls: [{ uid: 'return-after-nine', kind: 'tormenta', availableIn: 0, returnIn: 9 }] });
  try {
    const source = f.drops[0]; f.quiet(f.entities); f.world.tick = 12;
    assert.equal(f.server.step(), false); await f.lifecycle.settle();
    assert.equal(f.world.drops.get(source.id), source, 'source remains until synchronous apply');
    assert.equal((await f.base.loadPearlLocation(source.pearl.uid)).ground.returnAt, f.clock.at(12) + 90 * 60);
    assert.equal(f.server.step(), true);
    assert.equal(f.world.drops.has(source.id), false); assert.equal(f.world.drops.size, 1);
    assert.equal([...f.world.drops.values()][0].pearl.uid, source.pearl.uid);
    assert.equal(f.output('pearlReturn').length, f.sockets.length); assert.equal(f.output('pickup').length, 0);
  } finally { await f.close(); }
});

test('startup composes hydrated pearls with unmarked legacy drops without claiming the legacy source', async () => {
  const f = await fixture();
  try {
    const pearl = f.drops[0], entity = f.entities[0]; f.position(entity, pearl);
    const legacy = { id: f.world.nextDrop++, to: 0, kind: 'item', x: f.world.ecs.x[entity], z: f.world.ecs.z[entity],
      t: f.world.tick + 90, item: { u: 9901, id: 'legacy-host-item', r: 1, lvl: 1 } };
    f.world.drops.set(legacy.id, legacy); f.world.tick = pearl.pickAt;
    stepDrops(f.world);
    assert.equal(f.world.drops.has(legacy.id), false);
    assert.equal(f.world.drops.get(pearl.id), pearl);
    assert.ok(f.world.profiles.get(entity).bag.some(q => q.id === 'legacy-host-item'));
    const location = await pickupResult(f, pearl);
    assert.equal(location.ground.x, pearl.groundClock.ground.x);
    assert.equal(location.version, 1);
  } finally { await f.close(); }
});

test('bad projected metadata is rejected before its deadline and fences host ownership', async () => {
  const f = await fixture();
  try {
    const drop = f.drops[0]; drop.t++;
    f.world.tick = 0;
    assert.equal(f.server.step(), false);
    assert.equal(f.lifecycle.failed, true); assert.equal(f.world.drops.get(drop.id), drop);
    assert.equal(f.output('pickup').length, 0); assert.equal(f.host.closing, true);
  } finally { await f.close(); }
});

test('source drift during an in-flight receipt fences and never applies a historical pickup', async () => {
  const f = await fixture(); const gate = f.holdNextCommit();
  try {
    const drop = f.drops[0], entity = f.entities[0], profile = f.world.profiles.get(entity);
    f.position(entity, drop); f.world.tick = drop.pickAt;
    assert.equal(f.server.step(), false); await gate.entered.promise;
    drop.x += 1; gate.release.resolve(); await f.lifecycle.settle();
    assert.equal(f.server.step(), false); assert.equal(f.lifecycle.failed, true);
    assert.equal(f.world.drops.get(drop.id), drop); assert.equal(profile.pearls.bag.length, 0);
    assert.equal(f.output('pickup').length, 0); assert.equal(f.host.closing, true);
  } finally { gate.release.resolve(); await f.close(); }
});

test('actor death or movement during a receipt wait fences instead of changing the pickup winner', async () => {
  for (const change of [(world, entity) => { world.ecs.dead[entity] = 1; }, (world, entity) => { world.ecs.x[entity] += 10; }]) {
    const f = await fixture(), gate = f.holdNextCommit();
    try {
      const drop = f.drops[0], entity = f.entities[0]; f.position(entity, drop); f.world.tick = drop.pickAt;
      assert.equal(f.server.step(), false); await gate.entered.promise;
      change(f.world, entity); gate.release.resolve(); await f.lifecycle.settle();
      assert.equal(f.server.step(), false); assert.equal(f.lifecycle.failed, true);
      assert.equal(f.world.drops.get(drop.id), drop); assert.equal(f.world.profiles.get(entity).pearls.bag.length, 0);
    } finally { gate.release.resolve(); await f.close(); }
  }
});

test('close settles an in-flight receipt without applying or publishing the source', async () => {
  const f = await fixture(); const gate = f.holdNextCommit();
  try {
    const drop = f.drops[0], entity = f.entities[0], profile = f.world.profiles.get(entity);
    f.position(entity, drop); f.world.tick = drop.pickAt;
    assert.equal(f.server.step(), false); await gate.entered.promise;
    const closing = f.host.close(); await turn();
    assert.equal(f.host.closing, true); assert.equal(f.world.drops.get(drop.id), drop);
    gate.release.resolve(); await assert.rejects(closing, { code: 'flush' });
    assert.equal(f.world.drops.get(drop.id), drop); assert.equal(profile.pearls.bag.length, 0);
    assert.equal(f.output('pickup').length, 0);
  } finally { gate.release.resolve(); await f.close(); }
});

test('pending ground work exposes lifecycle wait state and blocks a second step until drain', async () => {
  const f = await fixture(); const gate = f.holdNextCommit();
  try {
    const drop = f.drops[0]; f.position(f.entities[0], drop); f.world.tick = drop.pickAt;
    assert.equal(f.lifecycle.count, 0); assert.equal(f.server.step(), false); await gate.entered.promise;
    assert.equal(f.lifecycle.pending, true); assert.equal(f.lifecycle.count, 1);
    const entity = f.entities[0], profile = f.world.profiles.get(entity);
    assert.equal(f.host.commandAvailable(1, entity, { target: null }), false);
    assert.equal(f.host.profileAvailable(1, entity, 'save'), false);
    assert.equal(f.host.saveProfile(1, profile), false);
    const newcomer = new Socket(); f.host.onConnection(newcomer, { headers: {}, socket: { remoteAddress: 'held-admission' } });
    assert.equal(newcomer.readyState, 3, 'admission is closed while a receipt owns the tick');
    assert.equal(f.output('pickup').length, 0);
    assert.equal(f.server.step(), false); assert.equal(f.world.tick, drop.pickAt);
    gate.release.resolve(); await f.lifecycle.settle();
    assert.equal(f.lifecycle.pending, true, 'settlement alone does not apply the receipt');
    assert.equal(f.server.step(), true); assert.equal(f.lifecycle.pending, false);
    assert.equal(f.lifecycle.count, 0);
  } finally { gate.release.resolve(); await f.close(); }
});

test('startup rejects a separately supplied mapClock once the host owns a deadline clock', async () => {
  const f = await fixture({ mount: false });
  try {
    f.host.mountPearlStaging({ scope: WORLD, deadlineClock: f.clock });
    f.host.mountDeathStaging({ scope: WORLD }); f.host.mountCombatDeaths(); f.host.mountDeathDrops(); f.host.mountPearlGround();
    assert.throws(() => f.host.mountPearlStartup({ accountPolicy: 'accounts-only', deathDrops: true,
      mapClock: ground => ({ availableAt: ground.availableAt, returnAt: ground.returnAt }) }), { code: 'configuration' });
  } finally { await f.close(); }
});

test('shared host clock must be a genuine clock for the same world', async () => {
  for (const invalid of [null, {}, clockFor(0, 50, 'other-world')]) {
    const f = await fixture({ mount: false });
    try {
      assert.throws(() => f.host.mountPearlStaging({ scope: WORLD, deadlineClock: invalid }), { code: 'configuration' });
    } finally { await f.close(); }
  }
});

test('distinct startup worlds and non-account startup policy remain rejected', async () => {
  const f = await fixture({ mount: false });
  try {
    f.host.mountPearlStaging({ scope: WORLD, deadlineClock: f.clock }); f.host.mountDeathStaging({ scope: WORLD });
    f.host.mountCombatDeaths(); f.host.mountDeathDrops(); f.host.mountPearlGround();
    assert.throws(() => f.host.mountPearlStartup({ accountPolicy: 'guests', deathDrops: true }), { code: 'configuration' });
  } finally { await f.close(); }
});
