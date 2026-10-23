import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameHost } from '../../server/host.mjs';
import { createMemoryStore, StoreError } from '../../server/store.mjs';
import { createMemoryPearlJournals } from '../../server/pearlJournal.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { MSG, PROTOCOL_VERSION, sanitizeCmd } from '../../src/net/protocol.js';
import { DT, tuning } from '../../src/data/tuning.js';
import { C } from '../../src/sim/ecs.js';
import { makeDeath, planRequest, seedDeathStore, VICTIM, KILLER, WORLD as scope } from './death-storage.mjs';

export const turn = () => new Promise((r) => setImmediate(r));
export const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
export const command = (seq) => sanitizeCmd({ seq, pt: seq, mx: 1, mz: 1, ax: 10, az: 10, btn: 0x3ff, prs: 0x3ff, w: 1 });
export class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { if (this.readyState !== 1) return; this.onClosing?.(); this.readyState = 3; this.emit('close'); }
  ping() {}
}
export async function fixture({ combat = true, tokens = ['v','k'], backend, wrap = (s) => s, lawless = false, journal = false, pearlCount = 2 } = {}) {
  const db = backend ? await backend() : { store: createMemoryStore(), close: async () => {} };
  const f = makeDeath({ lawless, killer: true, loot: true, pearlCount }), { request } = planRequest(f);
  await seedDeathStore(db.store, f, request);
  if (!request.killer) { const p = newProfile(); p.pirateId = 'account:' + KILLER; await db.store.saveProfile(KILLER, p, 0); }
  if (tokens.includes('t')) {
    const p = newProfile(); p.pirateId = 'account:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.store.saveProfile('cccccccc-cccc-4ccc-8ccc-cccccccccccc', p, 0);
  }
  const j = journal ? createMemoryPearlJournals(db.store)(scope) : null;
  const h = new GameHost({ seed: 42, bots: 0, store: wrap(db.store), resolvePlayer: async (_req, msg) => msg.token === 'v' ? VICTIM : msg.token === 'k' ? KILLER : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ...(j ? { worldId: scope, pearlJournal: j } : {}), log() {} });
  h.mountPearlStaging({ scope }); h.mountDeathStaging({ scope });
  if (combat) h.mountCombatDeaths();
  if (j) h.mountPearlStartup({ accountPolicy: 'accounts-only', mapClock: (g) => ({ availableAt: g.availableAt, returnAt: g.returnAt }) });
  await h.prepare();
  const sockets = [];
  for (const token of tokens) {
    const ws = new Socket(); sockets.push(ws);
    h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'death-test' } });
    ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: token, token })), false);
    await Promise.all([...h.joins]);
  }
  const w = h.server.world, c = h.server.clients.get(1), e = c.entity, k = h.server.clients.get(2).entity;
  assert.ok(e && k);
  const point = lawless ? w.map.cala : w.map.landmarks.arena;
  w.ecs.x[e] = point.x; w.ecs.z[e] = point.z; w.ecs.x[k] = point.x + 8; w.ecs.z[k] = point.z;
  for (let id = 1; id < w.ecs.cap; id++) if (w.ecs.mask[id] & C.ENEMY) { w.ecs.alive[id] = 0; w.ecs.mask[id] = 0; }
  w.events.length = 0; w.profileDirty.clear(); sockets.forEach((ws) => { ws.messages.length = 0; });
  return { db, h, w, c, e, k, sockets, p: w.profiles.get(e), j,
    request: () => h.requestDeath({ victim: { clientId: 1, entity: e }, killer: { clientId: 2, entity: k }, seq: 9 }),
    async close() { await h.deathStaging.settle(); await h.close().catch(() => {}); await db.close(); } };
}
export const snapshot = (f) => structuredClone({ tick: f.w.tick, ecs: Object.fromEntries(Object.entries(f.w.ecs).map(([key,v]) =>
  [key, ArrayBuffer.isView(v) ? Array.from(v) : v])), profiles: [...f.w.profiles], drops: [...f.w.drops], ledger: [...f.w.pearlLedger],
  events: f.w.events, dirty: [...f.w.profileDirty], nextDrop: f.w.nextDrop, rng: f.w.lootRng.state() });
export const events = (f, type) => f.sockets[0].messages.filter((m) => m.t === MSG.EVENT && m.ev.type === type);
