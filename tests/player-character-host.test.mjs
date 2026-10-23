import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { GameHost } from '../server/host.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { ProfileSessions } from '../server/profileSessions.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { hmacSaves } from '../server/saves.mjs';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const signed = hmacSaves('slots-test');
const resolvePlayer = async (_, hello) => {
  if (!Object.hasOwn(hello, 'token')) return null;
  if (hello.token === 'A') return A;
  if (hello.token === 'B') return B;
  throw new Error('private-provider-token');
};
class Socket extends EventEmitter {
  readyState = 1; messages = [];
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
}
async function join(h, extra) {
  const ws = new Socket(); h.onConnection(ws, { headers: {}, socket: { remoteAddress: 'slots-test' } });
  ws.emit('message', Buffer.from(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Forged look', skin: 0, weapon: 0, ...extra })), false);
  await Promise.all([...h.joins]); return ws;
}
async function host(t) {
  const h = new GameHost({ seed: 42, bots: 0, store: createMemoryStore(), saves: signed,
    resolvePlayer, initializeAccounts: true, log() {} });
  await h.playerCharacters.prepare(); t.after(() => h.close()); return h;
}
test('legacy profile keeps its UUID and state; a new Buccaneer loads its own guns and stored appearance', async t => {
  const h = await host(t), old = newProfile(); old.gold = 987; old.pirateId = `account:${A}`;
  await h.store.initializeProfile(A, old);
  const before = await h.store.loadProfile(A);
  const legacy = await h.playerCharacters.create(A, { requestId: randomUUID(), mode: 'legacy', name: 'Espadachin', skin: 0 });
  const buc = await h.playerCharacters.create(A, { requestId: randomUUID(), mode: 'new', name: 'Bucanero', skin: 2 });
  assert.equal(legacy.id, A); assert.notEqual(buc.id, A);
  assert.deepEqual(await h.store.loadProfile(A), before);
  const first = await join(h, { token: 'A', characterId: buc.id });
  assert.ok(first.messages.some(m => m.t === MSG.WELCOME));
  const session = [...h.profiles.clients.values()][0];
  assert.equal(session.key, buc.id); assert.equal(session.ownerKey, A);
  const c = h.server.clients.get(session.id), ecs = h.server.world.ecs;
  assert.equal(ecs.skin[c.entity], 2); assert.equal(ecs.names[c.entity], 'Bucanero'); assert.equal(ecs.weapon[c.entity], 1);
  assert.equal(session.confirmed.gold, 0);
  const changed = h.server.world.profiles.get(c.entity); changed.gold = 61;
  h.profiles.save(session.id, changed);
  const other = await join(h, { token: 'A', characterId: legacy.id });
  assert.equal(other.messages.find(m => m.t === MSG.ERROR)?.code, 'session');
  first.close(); await h.profiles.flush();
  const second = await join(h, { token: 'A', characterId: legacy.id });
  assert.ok(second.messages.some(m => m.t === MSG.WELCOME));
  assert.equal([...h.profiles.clients.values()][0].confirmed.gold, 987);
  second.close(); await h.profiles.flush();
  const third = await join(h, { token: 'A', characterId: buc.id });
  assert.ok(third.messages.some(m => m.t === MSG.WELCOME));
  assert.equal([...h.profiles.clients.values()][0].confirmed.gold, 61);
  const roster = await h.store.listPlayerCharacters(A);
  assert.equal(roster.characters.find(c => c.lastPlayed).id, buc.id);
});
test('foreign, guest, and agent selectors cannot borrow a human profile', async t => {
  const h = await host(t);
  const c = await h.playerCharacters.create(A, { requestId: randomUUID(), mode: 'new', name: 'A', skin: 2 });
  for (const extra of [{ token: 'B', characterId: c.id }, { characterId: c.id }, { token: 'A', agent: true, characterId: c.id }]) {
    const ws = await join(h, extra);
    assert.equal(ws.messages.some(m => m.t === MSG.WELCOME), false);
    assert.ok(['auth', 'forbidden'].includes(ws.messages.find(m => m.t === MSG.ERROR)?.code)); ws.close();
  }
  assert.equal(await h.store.loadProfile(B), null);
  const missing = await join(h, { token: 'A' });
  assert.equal(missing.messages.find(m => m.t === MSG.ERROR)?.code, 'characters_required');
  assert.equal(await h.store.loadProfile(A), null); missing.close();
});
test('account reservation survives close until final profile write settles', async () => {
  const store = createMemoryStore(), sessions = new ProfileSessions(store);
  const c = randomUUID(), d = randomUUID();
  await store.initializeProfile(c, newProfile()); await store.initializeProfile(d, newProfile());
  const profile = await sessions.open(1, c, 0, null, A);
  let finish; const save = store.saveProfile;
  store.saveProfile = (...args) => new Promise(resolve => { finish = async () => resolve(await save(...args)); });
  profile.gold = 10; sessions.save(1, profile); await new Promise(r => setImmediate(r)); sessions.close(1);
  await assert.rejects(sessions.open(2, d, 0, null, A), { code: 'session' });
  await finish(); await sessions.flush();
  await sessions.open(2, d, 0, null, A); sessions.close(2);
});
test('authenticated HTTP creates idempotently, never accepts client profile, and keeps guest import one-time', async t => {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, seed: 42, store: createMemoryStore(),
    resolvePlayer, initializeAccounts: true, saveSecret: 'slots-test', log() {} });
  const port = await gs.listen(); t.after(() => gs.close());
  const url = `http://127.0.0.1:${port}/api/characters`;
  const post = async (body, token = 'A') => {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await fetch(url)).status, 401);
  const request = { requestId: randomUUID(), mode: 'new', name: 'Bucanero', skin: 2 };
  assert.equal((await post({ ...request, profile: { gold: 999 } })).body.ok, false);
  assert.equal((await post(request, 'invalid')).status, 401);
  const created = await post(request), replay = await post(request);
  assert.equal(created.status, 200); assert.equal(replay.body.character.id, created.body.character.id);
  const old = newProfile(); old.pirateId = 'old:p1'; old.gold = 45;
  const imported = await post({ requestId: randomUUID(), mode: 'import', name: 'Old', skin: 0, save: signed.store(old) }, 'B');
  assert.equal(imported.status, 200); assert.equal(imported.body.character.id, B);
  assert.equal((await gs.game.store.loadProfile(B)).data.gold, 45);
  assert.equal((await gs.game.store.loadProfile(created.body.character.id)).data.gold, 0);
  const restored = await join(gs.game, { save: signed.store(old) });
  assert.equal(restored.messages.find(m => m.t === MSG.ERROR)?.code, 'legacy_used'); restored.close();
});
