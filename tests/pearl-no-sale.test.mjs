import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { PEARL_IDS } from '../src/data/pearls.js';
import { attachProfile, installInventory, newProfile } from '../src/sim/systems/inventory.js';
import { dropPearl, givePearl, sellPearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { GAME } from '../src/data/meta.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { LocalServer } from '../src/net/localServer.js';
import { Rewards } from '../src/ui/rewards.js';
import { sfx } from '../src/audio/sfx.js';
import { map, A } from './helpers.mjs';

function fixture() {
  const world = new World(GAME.seed, { map, server: true });
  installInventory(world, 'pearl-no-sale');
  const profile = newProfile();
  profile.gold = 731;
  const entity = world.spawnPlayer({ x: A.x, z: A.z + 5 });
  attachProfile(world, entity, profile);
  world.ecs.regenT[entity] = 99;
  dropPearl(world, { uid: 'ground:preserved', kind: 'brasa' }, A.x + 1, A.z + 4);
  const vendor = world.map.npcs.find((npc) => npc.id === 'vendor');
  assert.ok(vendor);
  return { world, entity, profile, vendor };
}

function snapshot(world, entity, profile) {
  const ecs = Object.fromEntries(Object.entries(world.ecs)
    .filter(([, value]) => ArrayBuffer.isView(value))
    .map(([key, value]) => [key, value.slice()]));
  return {
    profileRef: profile,
    profile: structuredClone(profile),
    pearlsRef: profile.pearls,
    bagRef: profile.pearls.bag,
    bagItems: [...profile.pearls.bag],
    swallowedRef: profile.pearls.swallowed,
    ecs,
    dropsRef: world.drops,
    drops: structuredClone([...world.drops]),
    dropEntries: [...world.drops],
    ledgerRef: world.pearlLedger,
    ledger: structuredClone([...world.pearlLedger]),
    ledgerEntries: [...world.pearlLedger],
    dirtyRef: world.profileDirty,
    dirty: [...world.profileDirty],
    nextDrop: world.nextDrop,
    nextPearl: world.nextPearl,
    lootRng: world.lootRng.state(),
    eventsRef: world.events,
    events: structuredClone(world.events),
    entity,
  };
}

function assertHarmlessDenial(world, profile, before, { denials = 1 } = {}) {
  assert.strictEqual(world.profiles.get(before.entity), profile);
  assert.strictEqual(profile, before.profileRef);
  assert.deepEqual(profile, before.profile);
  assert.strictEqual(profile.pearls, before.pearlsRef);
  assert.strictEqual(profile.pearls.bag, before.bagRef);
  assert.deepEqual(profile.pearls.bag, before.bagItems);
  for (let i = 0; i < before.bagItems.length; i++) assert.strictEqual(profile.pearls.bag[i], before.bagItems[i]);
  assert.strictEqual(profile.pearls.swallowed, before.swallowedRef);
  for (const [key, column] of Object.entries(before.ecs)) assert.deepEqual(world.ecs[key], column, `ECS ${key}`);
  assert.strictEqual(world.drops, before.dropsRef);
  assert.deepEqual([...world.drops], before.drops);
  for (const [id, drop] of before.dropEntries) assert.strictEqual(world.drops.get(id), drop);
  assert.strictEqual(world.pearlLedger, before.ledgerRef);
  assert.deepEqual([...world.pearlLedger], before.ledger);
  for (const [uid, entry] of before.ledgerEntries) assert.strictEqual(world.pearlLedger.get(uid), entry);
  assert.strictEqual(world.profileDirty, before.dirtyRef);
  assert.deepEqual([...world.profileDirty], before.dirty);
  assert.equal(world.nextDrop, before.nextDrop);
  assert.equal(world.nextPearl, before.nextPearl);
  assert.equal(world.lootRng.state(), before.lootRng);
  assert.strictEqual(world.events, before.eventsRef);
  assert.deepEqual(world.events.slice(0, before.events.length), before.events);
  assert.deepEqual(world.events.slice(before.events.length), Array.from({ length: denials }, () =>
    ({ type: 'pearlDenied', to: before.entity, e: before.entity, why: 'notForSale', elem: world.ecs.elem[before.entity] })));
}

function putAtVendor(world, entity, vendor) {
  world.ecs.x[entity] = vendor.x;
  world.ecs.z[entity] = vendor.z;
}

test('legacy sale denies each found pearl kind at the vendor without changing gameplay state', async (t) => {
  for (const kind of PEARL_IDS) await t.test(kind, () => {
    const f = fixture();
    putAtVendor(f.world, f.entity, f.vendor);
    const pearl = givePearl(f.world, f.entity, kind);
    const before = snapshot(f.world, f.entity, f.profile);
    assert.equal(sellPearl(f.world, f.entity, pearl.uid), false);
    assertHarmlessDenial(f.world, f.profile, before);
  });
});

test('legacy sale denial is independent of distance, combat, holding location, and UID validity', async (t) => {
  const cases = [
    ['far from vendor', (f) => { f.world.ecs.x[f.entity] = A.x; f.world.ecs.z[f.entity] = A.z + 5; }, 'bag'],
    ['in combat beside vendor', (f) => { putAtVendor(f.world, f.entity, f.vendor); f.world.ecs.regenT[f.entity] = 0; }, 'bag'],
    ['swallowed pearl beside vendor', (f) => putAtVendor(f.world, f.entity, f.vendor), 'swallowed'],
    ['unknown UID beside vendor', (f) => putAtVendor(f.world, f.entity, f.vendor), 'unknown'],
  ];
  for (const [label, place, holding] of cases) await t.test(label, () => {
    const f = fixture();
    place(f);
    let uid = 'missing-pearl';
    if (holding === 'bag') uid = givePearl(f.world, f.entity, 'escarcha').uid;
    if (holding === 'swallowed') {
      const pearl = givePearl(f.world, f.entity, 'tormenta');
      assert.equal(swallowPearl(f.world, f.entity, pearl.uid), true);
      uid = pearl.uid;
    }
    const before = snapshot(f.world, f.entity, f.profile);
    assert.equal(sellPearl(f.world, f.entity, uid), false);
    assertHarmlessDenial(f.world, f.profile, before);
  });
});

test('replaying legacy sale commands emits only a denial and never changes their held pearl', () => {
  const f = fixture();
  putAtVendor(f.world, f.entity, f.vendor);
  const pearl = givePearl(f.world, f.entity, 'brasa');
  const before = snapshot(f.world, f.entity, f.profile);
  assert.equal(sellPearl(f.world, f.entity, pearl.uid), false);
  assert.equal(sellPearl(f.world, f.entity, pearl.uid), false);
  assertHarmlessDenial(f.world, f.profile, before, { denials: 2 });
});

test('legacy sale with no profile returns false and emits no denial', () => {
  const f = fixture();
  f.world.profiles.delete(f.entity);
  const before = snapshot(f.world, f.entity, f.profile);
  assert.equal(sellPearl(f.world, f.entity, 'missing-pearl'), false);
  assert.equal(f.world.profiles.has(f.entity), false);
  assert.deepEqual(f.world.events, before.events);
  assert.strictEqual(f.world.events, before.eventsRef);
  for (const [key, column] of Object.entries(before.ecs)) assert.deepEqual(f.world.ecs[key], column, `ECS ${key}`);
  assert.strictEqual(f.world.drops, before.dropsRef);
  assert.deepEqual([...f.world.drops], before.drops);
  assert.strictEqual(f.world.pearlLedger, before.ledgerRef);
  assert.deepEqual([...f.world.pearlLedger], before.ledger);
  assert.strictEqual(f.world.profileDirty, before.dirtyRef);
  assert.deepEqual([...f.world.profileDirty], before.dirty);
  assert.equal(f.world.nextDrop, before.nextDrop);
  assert.equal(f.world.nextPearl, before.nextPearl);
  assert.equal(f.world.lootRng.state(), before.lootRng);
});

test('legacy wire sale commands for bagged and swallowed pearls cause private denial only', () => {
  const sent = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send: (id, message) => sent.push({ id, message: structuredClone(message) }) });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Pearl Test', skin: 0, weapon: 0, save: '' });
  const live = server.clients.get(1), entity = live.entity, world = server.world, profile = world.profiles.get(entity);
  server.connect(2);
  server.receive(2, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Other Pirate', skin: 1, weapon: 0, save: '' });
  const other = server.clients.get(2), otherProfile = world.profiles.get(other.entity);
  const vendor = world.map.npcs.find((npc) => npc.id === 'vendor');
  assert.ok(vendor);
  world.ecs.x[entity] = vendor.x; world.ecs.z[entity] = vendor.z;
  world.ecs.regenT[entity] = 99;
  profile.gold = 999;
  dropPearl(world, { uid: 'wire:ground-preserved', kind: 'brasa' }, vendor.x + 1, vendor.z + 1);
  const bagged = givePearl(world, entity, 'tinta');
  const swallowed = givePearl(world, entity, 'escarcha');
  assert.equal(swallowPearl(world, entity, swallowed.uid), true);
  const saveBlob = server.saves.store(profile);
  world.profileDirty.delete(entity);
  sent.length = 0;
  const before = snapshot(world, entity, profile);
  const otherBefore = structuredClone(otherProfile);

  server.receive(1, { t: MSG.CMD, type: 'pearl', op: 'sell', uid: bagged.uid });
  server.receive(1, { t: MSG.CMD, type: 'pearl', op: 'sell', uid: swallowed.uid });

  assertHarmlessDenial(world, profile, before, { denials: 2 });
  server.flushEvents();
  const deniedMessages = sent.filter(({ message }) => message.t === MSG.EVENT && message.ev.type === 'pearlDenied');
  assert.deepEqual(deniedMessages.map(({ id, message }) => ({ id, ev: message.ev })), [
    { id: 1, ev: { type: 'pearlDenied', to: entity, e: entity, why: 'notForSale', elem: world.ecs.elem[entity] } },
    { id: 1, ev: { type: 'pearlDenied', to: entity, e: entity, why: 'notForSale', elem: world.ecs.elem[entity] } },
  ]);
  assert.equal(sent.some(({ message }) => message.t === MSG.EVENT && message.ev.type === 'pearlChanged' && message.ev.op === 'sell'), false);
  assert.deepEqual(otherProfile, otherBefore);
  assert.equal(server.saves.store(profile), saveBlob);
  assert.equal(world.profileDirty.has(entity), false);
});

test('Rewards shows the not-for-sale denial and preserves only give/leave pearl feedback', () => {
  const toasts = [], floats = [], sounds = [];
  const hud = { toast: (html, ms) => toasts.push({ html, ms }) };
  const worldUI = { float: (...args) => floats.push(args) };
  const rewards = new Rewards({ world: {}, hud, worldUI, ps: { x: 0, y: 0, z: 0 }, map, settings: {} });
  const originals = Object.fromEntries(['denied', 'coins', 'equip'].map((key) => [key, sfx[key]]));
  for (const key of Object.keys(originals)) sfx[key] = () => sounds.push(key);
  try {
    rewards.handle({ type: 'pearlDenied', why: 'notForSale', me: true });
    assert.deepEqual(toasts, [{ html: '<b>Las perlas se encuentran; ningún puesto las compra ni las vende.</b>', ms: 5000 }]);
    assert.equal(floats.length, 0);
    assert.deepEqual(sounds, ['denied']);

    toasts.length = 0; sounds.length = 0;
    rewards.handle({ type: 'pearlChanged', op: 'sell', gold: 600, me: true });
    assert.deepEqual(toasts, []);
    assert.deepEqual(floats, []);
    assert.deepEqual(sounds, []);

    rewards.handle({ type: 'pearlChanged', op: 'give', me: true });
    rewards.handle({ type: 'pearlChanged', op: 'leave', me: true });
    assert.deepEqual(toasts.map(({ html }) => html), [
      '<b>Perla entregada.</b>', '<b>Perla en el suelo.</b> Cualquiera puede recogerla.',
    ]);
    assert.deepEqual(sounds, ['equip', 'equip']);
    assert.deepEqual(floats, []);
  } finally {
    for (const [key, fn] of Object.entries(originals)) sfx[key] = fn;
  }
});
