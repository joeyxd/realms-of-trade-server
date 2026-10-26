import { EventEmitter } from 'node:events';
import { GameHost } from '../../server/host.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { GroundClockEpoch } from '../../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../../server/groundDeadlineClock.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { C, KIND } from '../../src/sim/ecs.js';

export const WORLD = 'pearl-lifecycle-host';
export const ACCOUNTS = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
export const turn = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const clockFor = (localTick = 0, durableTick = 2 ** 32, worldId = WORLD) => new GroundDeadlineClock({
  worldId, sourceDomain: 'durable-ground-v1', epoch: new GroundClockEpoch({ localTick, durableTick }),
});

export class Socket extends EventEmitter {
  readyState = 1; messages = []; closes = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code = 1000, reason = '') { if (this.readyState !== 1) return; this.closes.push({ code, reason }); this.readyState = 3; this.emit('close'); }
  ping() {}
}

export async function fixture({ clock = clockFor(), pearls = [{ uid: 'host-pearl-1', kind: 'brasa', availableIn: 0, returnIn: 90 }], heldPearls = [],
  wrap = store => store, mount = true } = {}) {
  const base = createMemoryStore(), journal = createMemoryPearlJournals(base)(WORLD);
  for (const id of ACCOUNTS) { const p = newProfile(); p.pirateId = `account:${id}`; assertSave(await base.saveProfile(id, p, 0)); }
  for (let i = 0; i < heldPearls.length; i++) {
    const row = await base.loadProfile(ACCOUNTS[0]), data = structuredClone(row.data), pearl = heldPearls[i];
    data.pearls.bag.push({ uid: pearl.uid, kind: pearl.kind });
    const result = await base.commitPearl({ operationId: `78000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      uid: pearl.uid, kind: pearl.kind, from: null, to: ACCOUNTS[0], expectedVersion: 0,
      profiles: [{ id: ACCOUNTS[0], expectedVersion: row.version, data }] });
    if (!result.ok) throw new StoreError(result.why);
  }
  const seeded = [];
  for (let i = 0; i < pearls.length; i++) {
    const pearl = pearls[i], ground = { x: 1 + i * 0.5, z: -2, availableAt: clock.at(0) + (pearl.availableIn ?? 0),
      returnAt: clock.at(0) + (pearl.returnIn ?? 90) };
    const request = { operationId: `77000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      uid: pearl.uid, kind: pearl.kind, from: null, to: null, expectedVersion: 0, world: WORLD, ground, profiles: [] };
    await journal.prepare('ground', request);
    const result = await base.commitPearlGround(request);
    if (!result.ok) throw new StoreError(result.why);
    await journal.resolve('ground', request, 'committed'); seeded.push({ ...request, id: null });
  }
  let hold = null;
  const store = wrap({ ...base, async commitPearlGround(request) {
    const result = await base.commitPearlGround(request);
    if (hold) { const gate = hold; hold = null; gate.entered.resolve(); await gate.release.promise; }
    return result;
  } });
  const host = new GameHost({ seed: 97, bots: 0, store, worldId: WORLD, pearlJournal: journal,
    resolvePlayer: async (_req, message) => message.token === '0' ? ACCOUNTS[0] : message.token === '1' ? ACCOUNTS[1] : null, log() {} });
  const f = { base, journal, store, host, clock, seeded, sockets: [], entities: [], holdNextCommit() {
    const gate = { entered: deferred(), release: deferred() }; hold = gate; return gate;
  } };
  if (mount) {
    host.mountPearlStaging({ scope: WORLD, deadlineClock: clock });
    host.mountDeathStaging({ scope: WORLD }); host.mountCombatDeaths(); host.mountDeathDrops();
    f.lifecycle = host.mountPearlGround();
    host.mountPearlStartup({ accountPolicy: 'accounts-only', deathDrops: true });
    await host.prepare();
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const socket = new Socket(); f.sockets.push(socket);
      host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'pearl-lifecycle-test' } });
      socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: `host${i}`, token: String(i) })), false);
      await Promise.all([...host.joins]);
      const client = host.server.clients.get(i + 1); f.entities.push(client.entity);
    }
    f.world = host.server.world; f.server = host.server;
    for (const [index, entity] of f.entities.entries()) {
      const point = f.world.map.cala; f.world.ecs.x[entity] = point.x; f.world.ecs.z[entity] = point.z;
      f.world.ecs.alive[entity] = 1; f.world.ecs.dead[entity] = 0; f.world.ecs.mask[entity] |= C.PLAYER;
      f.world.ecs.kind[entity] = KIND.PLAYER;
      f.world.profiles.get(entity).gold = 20 + index;
    }
    for (let i = 1; i < f.world.ecs.cap; i++) if ((f.world.ecs.mask[i] & C.ENEMY) !== 0) {
      f.world.ecs.alive[i] = 0; f.world.ecs.mask[i] = 0;
    }
    f.world.events.length = 0; f.world.profileDirty.clear();
    for (const socket of f.sockets) socket.messages.length = 0;
    f.drops = [...f.world.drops.values()].filter(d => d.kind === 'pearl');
    f.drops.sort((a, b) => a.id - b.id);
    f.world.events.length = 0;
  }
  f.output = type => f.sockets.flatMap(s => s.messages).filter(m => m.t === MSG.EVENT && m.ev.type === type);
  f.position = (entity, drop) => { f.world.ecs.x[entity] = drop.x; f.world.ecs.z[entity] = drop.z; };
  f.quiet = entities => { for (const entity of entities) { f.world.ecs.x[entity] = 10000 + entity; f.world.ecs.z[entity] = 10000; } };
  f.stepBoundary = async (tick) => {
    f.world.tick = tick;
    const admitted = f.server.step();
    if (!admitted) await f.lifecycle.settle();
    return admitted;
  };
  f.close = async () => { await f.lifecycle?.settle(); await host.close().catch(() => {}); };
  return f;
}
function assertSave(result) { if (!result.ok) throw new StoreError(result.why); }
