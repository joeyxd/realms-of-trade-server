import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, sanitizeCmd } from '../../src/net/protocol.js';
import { C } from '../../src/sim/ecs.js';
import { makeDeath, planRequest, seedDeathStore, VICTIM, KILLER, WORLD } from './death-storage.mjs';

export const turn = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const command = seq => sanitizeCmd({ seq, pt: seq, mx: 0, mz: 0, ax: 10, az: 10, btn: 0, prs: 0 });
export class Socket extends EventEmitter {
  readyState = 1;
  messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.onClosing?.(); this.readyState = 3; this.emit('close'); }
  ping() {}
}

export async function fixture({ backend, wrap = store => store, tokens = ['v', 'k'], lawless = true } = {}) {
  const db = backend ? await backend() : { store: createMemoryStore(), close: async () => {} };
  const f = makeDeath({ lawless, killer: true, loot: true, pearlCount: 2 });
  const { request } = planRequest(f);
  await seedDeathStore(db.store, f, request);
  if (tokens.includes('t')) {
    const profile = newProfile();
    profile.pirateId = 'account:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.store.saveProfile('cccccccc-cccc-4ccc-8ccc-cccccccccccc', profile, 0);
  }
  const journal = backend ? db.journal(WORLD) : createMemoryPearlJournals(db.store)(WORLD);
  const host = new GameHost({ seed: 42, bots: 0, store: wrap(db.store), worldId: WORLD, pearlJournal: journal,
    resolvePlayer: async (_req, msg) => msg.token === 'v' ? VICTIM : msg.token === 'k' ? KILLER : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', log() {} });
  host.mountPearlStaging({ scope: WORLD });
  host.mountDeathStaging({ scope: WORLD });
  host.mountCombatDeaths();
  const lifecycle = host.mountDeathDrops();
  host.mountPearlStartup({ accountPolicy: 'accounts-only', mapClock: g => ({ availableAt: g.availableAt, returnAt: g.returnAt }) });
  await host.prepare();
  const sockets = [];
  for (const token of tokens) {
    const socket = new Socket(); sockets.push(socket);
    host.onConnection(socket, { headers: {}, socket: { remoteAddress: 'drop-host-test' } });
    socket.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
    await Promise.all([...host.joins]);
  }
  const world = host.server.world, client = host.server.clients.get(1), entity = client.entity;
  const killer = host.server.clients.get(2).entity;
  assert.ok(entity && killer);
  const point = world.map.cala;
  world.ecs.x[entity] = point.x; world.ecs.z[entity] = point.z;
  world.ecs.x[killer] = point.x + 8; world.ecs.z[killer] = point.z;
  for (let id = 1; id < world.ecs.cap; id++) if (world.ecs.mask[id] & C.ENEMY) { world.ecs.alive[id] = 0; world.ecs.mask[id] = 0; }
  world.events.length = 0; world.profileDirty.clear(); sockets.forEach(s => { s.messages.length = 0; });
    return { db, host, journal, lifecycle, world, server: host.server, client, entity, killer, sockets, profile: world.profiles.get(entity),
    async makeDrops() {
      assert.ok(host.requestDeath({ victim: { clientId: 1, entity }, killer: { clientId: 2, entity: killer }, seq: 9 }).operationId);
      host.server.step();
      await host.deathStaging.settle();
      assert.equal(host.server.step(), true);
      const ordinary = [...world.drops.values()].filter(d => d.kind === 'item' || d.kind === 'potion');
      assert.ok(ordinary.length >= 2, 'real whole-death spill supplies managed ordinary drops');
      assert.ok(ordinary.every(d => d.operationId && Number.isSafeInteger(d.ordinal)));
      return ordinary;
    },
    async close() { await host.deathDropStaging.settle(); await host.deathStaging.settle(); await host.close().catch(() => {}); await db.close?.(); } };
}

export function focusDrop(f, drop, entities = [f.killer]) {
  for (const e of [f.entity, f.killer, ...f.server.clients.values()].map(x => typeof x === 'number' ? x : x?.entity).filter(Boolean)) {
    f.world.ecs.x[e] = drop.x + 100; f.world.ecs.z[e] = drop.z + 100;
  }
  for (const e of entities) { f.world.ecs.x[e] = drop.x; f.world.ecs.z[e] = drop.z; }
  f.world.tick += (3 - f.world.tick % 3) % 3;
}

export const wireEvents = (f, type) => f.sockets.flatMap(s => s.messages).filter(m => m.t === MSG.EVENT && m.ev.type === type);
