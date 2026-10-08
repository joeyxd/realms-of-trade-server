import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, focusDrop, wireEvents, Socket } from './helpers/death-drop-host.mjs';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { GameHost } from '../server/host.mjs';
import { WORLD } from './helpers/death-storage.mjs';
import { KILLER, VICTIM } from './helpers/death-storage.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

for (const [name, backend] of [['memory', undefined]]) {
  test(name + ': persisted source pickup holds the completed world tick and publishes only after apply', async () => {
    const entered = deferred(), reply = deferred();
    const f = await fixture({ backend, wrap: store => ({ ...store, async commitDeathDrop(request) {
      const result = await store.commitDeathDrop(request); entered.resolve(); await reply.promise; return result;
    } }) });
    try {
      const drops = await f.makeDrops(), item = drops.find(d => d.kind === 'item');
      const received = f.world.profiles.get(f.killer);
      focusDrop(f, item); const tick = f.world.tick, profile = structuredClone(received), source = structuredClone(item);
      assert.equal(f.server.step(), false); await entered.promise;
      assert.equal(f.lifecycle.pending, true); assert.equal(f.world.tick, tick);
      assert.equal(f.world.drops.get(item.id), item); assert.deepEqual(received, profile);
      assert.equal(wireEvents(f, 'pickup').length, 0); assert.equal(wireEvents(f, 'unloot').length, 0);
      reply.resolve(); await f.host.deathDropStaging.settle();
      assert.equal(f.server.step(), true); assert.equal(f.world.tick, tick + 1);
      assert.equal(f.world.drops.has(item.id), false); assert.equal(received.bag.length, profile.bag.length + 1);
      assert.equal(received.bag.at(-1).u, profile.uid); assert.equal(received.uid, profile.uid + 1);
      assert.equal(received.stats.items, profile.stats.items + 1); assert.deepEqual(item.item, source.item);
      assert.equal(wireEvents(f, 'pickup').length, 1); assert.ok(wireEvents(f, 'unloot').length >= 1);
      assert.equal((await f.db.store.loadDeathDrop(source.operationId, source.ordinal)).state, 'picked');
    } finally { reply.resolve(); await f.close(); }
  });

  test(name + ': ordered public scan skips a full first receiver and multiple drops use fresh UIDs and versions', async () => {
    const requests = [];
    const f = await fixture({ backend, tokens: ['v', 'k', 't'], wrap: store => ({ ...store, async commitDeathDrop(r) {
      requests.push(structuredClone(r)); return store.commitDeathDrop(r);
    } }) });
    try {
      const drops = await f.makeDrops(), items = drops.filter(d => d.kind === 'item'); assert.ok(items.length >= 2);
      const first = f.killer, second = f.server.clients.get(3).entity, profileA = f.world.profiles.get(first);
      const template = structuredClone(profileA.eq.weapon);
      profileA.bag = Array.from({ length: 24 }, (_, i) => ({ ...structuredClone(template), u: i }));
      for (const item of items.slice(0, 2)) {
        focusDrop(f, item, [first, second]);
        assert.equal(f.server.step(), false); await f.host.deathDropStaging.settle(); assert.equal(f.server.step(), true);
      }
      assert.equal(requests.length, 2); assert.equal(requests[0].profile.id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      assert.equal(requests[1].profile.expectedVersion, requests[0].profile.expectedVersion + 1);
      const receiver = f.world.profiles.get(second);
      assert.equal(receiver.bag.length, 2); assert.deepEqual(receiver.bag.map(x => x.u), [receiver.uid - 2, receiver.uid - 1]);
      assert.equal(profileA.bag.length, 24); assert.ok(wireEvents(f, 'full').filter(m => m.ev.e === first).length >= 1);
    } finally { await f.close(); }
  });

  test(name + ': full potion carrier is notified once, then next eligible authenticated carrier receives it', async () => {
    const f = await fixture({ backend, tokens: ['v', 'k', 't'] });
    try {
      const potion = (await f.makeDrops()).find(d => d.kind === 'potion'); assert.ok(potion);
      const a = f.killer, b = f.server.clients.get(3).entity;
      f.world.ecs.potions[a] = 5; f.world.profiles.get(a).pot = 5;
      const beforeB = f.world.ecs.potions[b]; focusDrop(f, potion, [a, b]);
      assert.equal(f.server.step(), false);
      assert.equal(f.world.events.filter(ev => ev.type === 'full' && ev.e === a).length, 1);
      for (let n = 0; n < 20 && (f.world.drops.has(potion.id) || f.lifecycle.pending); n++) {
        if (!f.server.step()) await f.host.deathDropStaging.settle();
      }
      assert.equal(f.world.ecs.potions[a], 5); assert.ok(f.world.ecs.potions[b] > beforeB);
      assert.equal((await f.db.store.loadDeathDrop(potion.operationId, potion.ordinal)).state, 'picked');
      assert.ok(f.world.ecs.potions[b] > beforeB);
      assert.ok(wireEvents(f, 'pickup').some(m => m.ev.id === potion.id), JSON.stringify(wireEvents(f, 'pickup')));
    } finally { await f.close(); }
  });

  test(name + ': expiration is journaled before removal and managed sources bypass native stepDrops', async () => {
    const f = await fixture({ backend });
    try {
      const drops = await f.makeDrops(), drop = drops[0];
      assert.ok(drop);
      f.world.tick = Math.max(f.world.tick, drop.t + 1); f.world.tick += (3 - f.world.tick % 3) % 3;
      const tick = f.world.tick;
      stepDrops(f.world);
      assert.equal(f.world.drops.get(drop.id), drop, 'native simulation cannot consume a durable source');
      for (const e of f.world.profiles.keys()) { f.world.ecs.x[e] = drop.x + 1000; f.world.ecs.z[e] = drop.z + 1000; }
      const due = drops.filter(d => f.world.drops.has(d.id));
      for (let n = 0; n < due.length * 2 + 2 && due.some(d => f.world.drops.has(d.id)); n++) {
        if (!f.server.step()) await f.host.deathDropStaging.settle();
      }
      assert.equal(f.world.tick, tick + 1); assert.ok(due.every(d => !f.world.drops.has(d.id)));
      for (const d of due) assert.equal((await f.db.store.loadDeathDrop(d.operationId, d.ordinal)).state, 'expired');
    } finally { await f.close(); }
  });
}

test('legacy public item and potion retain native immediate pickup without durable receipts', async () => {
  const f = await fixture();
  try {
    const e = f.killer, receiver = f.world.profiles.get(e), initialPotions = f.world.ecs.potions[e], d1 = { id: f.world.nextDrop++, to: 0, kind: 'item', x: f.world.ecs.x[e], z: f.world.ecs.z[e], t: f.world.tick + 50,
      item: { u: 999, id: 'legacy', r: 1, lvl: 1 } }, d2 = { id: f.world.nextDrop++, to: 0, kind: 'potion', x: f.world.ecs.x[e], z: f.world.ecs.z[e], t: f.world.tick + 50 };
    f.world.drops.set(d1.id, d1); f.world.drops.set(d2.id, d2); f.world.tick += (3 - f.world.tick % 3) % 3;
    assert.equal(f.server.step(), true); assert.equal(f.world.drops.has(d1.id), false); assert.equal(f.world.drops.has(d2.id), false);
    assert.equal(receiver.bag.at(-1).id, 'legacy'); assert.equal(f.world.ecs.potions[e], initialPotions + 1);
    assert.equal((await f.db.store.listDeathDrops(WORLD)).length, 0);
  } finally { await f.close(); }
});

test('close while receipt is pending settles storage but never applies the source', async () => {
  const entered = deferred(), reply = deferred();
  const f = await fixture({ wrap: store => ({ ...store, async commitDeathDrop(r) { const v = await store.commitDeathDrop(r); entered.resolve(); await reply.promise; return v; } }) });
  try {
    const drop = (await f.makeDrops()).find(d => d.kind === 'item'); focusDrop(f, drop); const receiver = f.world.profiles.get(f.killer);
    f.server.step(); await entered.promise; const closing = f.host.close(); const rejected = assert.rejects(closing, { code: 'flush' });
    reply.resolve(); await rejected; assert.equal(f.world.drops.has(drop.id), true); assert.equal(receiver.bag.length, 0);
    assert.equal((await f.db.store.loadDeathDrop(drop.operationId, drop.ordinal)).state, 'picked');
  } finally { reply.resolve(); await f.close(); }
});

test('changed tick or source and managed-hook replacement fence the lifecycle before apply', async () => {
  for (const drift of ['tick', 'source', 'actor', 'hook']) {
    const entered = deferred(), reply = deferred();
    const f = await fixture({ wrap: store => ({ ...store, async commitDeathDrop(r) { const v = await store.commitDeathDrop(r); entered.resolve(); await reply.promise; return v; } }) });
    try {
      const drop = (await f.makeDrops()).find(d => d.kind === 'item'); focusDrop(f, drop); const receiver = f.world.profiles.get(f.killer), before = structuredClone(receiver);
      f.server.step(); await entered.promise;
      if (drift === 'tick') f.world.tick++;
      if (drift === 'source') drop.x += 1;
      if (drift === 'actor') f.world.ecs.x[f.killer] += 1;
      if (drift === 'hook') f.world.isDeathDropManaged = () => false;
      reply.resolve(); await f.host.deathDropStaging.settle();
      assert.equal(f.server.step(), false); assert.equal(f.lifecycle.failed, true); assert.equal(f.host.closing, true);
      assert.deepEqual(receiver, before); assert.equal(f.world.drops.has(drop.id), true);
    } finally { reply.resolve(); await f.close(); }
  }
});

test('default hosts stay dormant and explicit mount rejects invalid order, duplicate, bots, guests, and async hooks', async t => {
  const plain = new GameHost({ bots: 0, log() {} });
  try { assert.equal(plain.deathDrops, null); assert.throws(() => plain.mountDeathDrops(), { code: 'configuration' }); }
  finally { await plain.close(); }
  const h = new GameHost({ bots: 0, resolvePlayer: async () => VICTIM, log() {} });
  try {
    h.mountPearlStaging({ scope: WORLD }); h.mountDeathStaging({ scope: WORLD }); h.mountCombatDeaths();
    assert.throws(() => h.mountDeathDrops({}), { code: 'configuration' });
    assert.ok(h.mountDeathDrops()); assert.throws(() => h.mountDeathDrops(), { code: 'configuration' });
  } finally { await h.close(); }
  for (const invalid of ['late', 'bots', 'promise']) {
      const x = new GameHost({ bots: invalid === 'bots' ? 1 : 0, resolvePlayer: async () => VICTIM, log() {} });
    try {
      if (invalid === 'late') { x.mountPearlStaging({ scope: WORLD }); x.mountDeathStaging({ scope: WORLD }); x.mountCombatDeaths(); await x.prepare(); assert.throws(() => x.mountDeathDrops(), { code: 'configuration' }); }
      else if (invalid === 'bots') { x.mountPearlStaging({ scope: WORLD }); assert.throws(() => x.mountDeathStaging({ scope: WORLD }), { code: 'configuration' }); }
      else {
        x.mountPearlStaging({ scope: WORLD }); x.mountDeathStaging({ scope: WORLD }); x.mountCombatDeaths();
        if (invalid === 'promise') { x.server.beforeTick = () => Promise.resolve(true); assert.throws(() => x.mountDeathDrops(), { code: 'effect' }); }
        else assert.ok(x.mountDeathDrops());
      }
    } finally { await x.close().catch(() => {}); }
  }
  const guest = new GameHost({ bots: 0, resolvePlayer: async () => null, log() {} });
  try {
    guest.mountPearlStaging({ scope: WORLD }); guest.mountDeathStaging({ scope: WORLD }); guest.mountCombatDeaths(); guest.mountDeathDrops();
    await guest.prepare(); const socket = new Socket(); guest.onConnection(socket, { headers: {}, socket: { remoteAddress: 'test' } });
    socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'guest', token: 'guest' })), false);
    await Promise.all([...guest.joins]);
    assert.equal(guest.server.clients.get(1).entity, 0); assert.equal(guest.profiles.accounts.size, 0);
    assert.ok(socket.messages.some(m => m.t === MSG.ERROR && m.code === 'auth'));
  } finally { await guest.close(); }
});
