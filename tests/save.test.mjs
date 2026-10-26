// M4 P3: saved games. Profiles to blobs and back, made safe; signed blobs on the Node server (no database:
// a restart with the same SAVE_SECRET still knows your game); the server sends a fresh blob when it matters.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/data/tuning.js';
import { ITEMS } from '../src/data/items.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { trustSaves, SAVE_TIMING } from '../src/net/saves.js';
import { newProfile, sanitizeProfile, PROFILE_VERSION } from '../src/sim/systems/inventory.js';
import { hmacSaves } from '../server/saves.mjs';
import { createGameServer } from '../server/index.mjs';
import { GAME } from '../src/data/meta.js';
import { map } from './helpers.mjs';

const richProfile = () => {
  const p = newProfile({ weapon: 1 });
  p.lvl = 6; p.xp = 123.5; p.gold = 777; p.pot = 4; p.cp = 'aldea';
  p.bag.push({ u: p.uid++, b: 'tricornio', r: 2, l: 6, a: [['crit', 4], ['hp', 5]] }, { u: p.uid++, b: 'daga', r: 4, l: 9, a: [['atk', 8], ['crit', 7], ['rip', 7], ['refl', 7]] });
  p.eq.boots = { u: p.uid++, b: 'botas', r: 1, l: 3, a: [['spd', 2]] };
  p.mast = [[4, 30], [2, 10]];
  p.quests = { brea: [2, 0], sendero: [1, 2] };
  p.flags = { tut: 5, tier: 2, tierSel: 2 };
  p.items = { coral: 3 };
  return p;
};

test('profiles survive the trip and are made safe on the way back', () => {
  const p = richProfile();
  assert.deepEqual(trustSaves.load(trustSaves.store(p)), p);
  assert.equal(trustSaves.load('not json'), null);
  assert.equal(trustSaves.load(JSON.stringify({ ...p, v: 99 })), null, 'an unknown version is not ours');
  const bad = sanitizeProfile({
    ...p, lvl: 99, gold: -5, pot: 50,
    bag: [...p.bag, { u: 1, b: 'excalibur', r: 4, l: 9, a: [] }, ...Array.from({ length: 40 }, () => ({ u: 3, b: 'panuelo', r: 0, l: 1, a: [] }))],
    eq: { weapon: null, head: { u: 99, b: 'botas', r: 0, l: 1, a: [] } },
    mast: [[42, -1]], flags: { tut: 3, tier: 2, tierSel: 7 },
  });
  assert.equal(bad.lvl, 10);
  assert.equal(bad.gold, 0);
  assert.equal(bad.pot, 5);
  assert.ok(bad.bag.length <= ITEMS.bag && bad.bag.every((it) => it.b !== 'excalibur'));
  assert.equal(new Set([...bad.bag.map((it) => it.u), bad.eq.weapon.u]).size, bad.bag.length + 1, 'every item has its own uid');
  assert.equal(bad.eq.head, null, 'boots do not go on your head');
  assert.equal(bad.eq.weapon.b, 'sable', 'never without a weapon');
  assert.deepEqual(bad.mast, [[10, 0], [1, 0]]);
  assert.equal(bad.flags.tierSel, 2, 'cannot pick a Marea you have not opened');
  assert.equal(PROFILE_VERSION, 1);
});

test('signed saves: what the server wrote loads; any change, another secret or junk does not', () => {
  const S = hmacSaves('secreto de la isla'), p = richProfile();
  const blob = S.store(p);
  assert.deepEqual(S.load(blob), p);
  const [body, sig] = blob.split('.');
  const forged = Buffer.from(JSON.stringify({ ...p, gold: 999999 })).toString('base64url');
  assert.equal(S.load(forged + '.' + sig), null, 'edited gold');
  assert.equal(S.load(body + '.' + sig.slice(0, -2) + 'AA'), null, 'edited signature');
  assert.equal(hmacSaves('otro secreto').load(blob), null, 'another server');
  for (const junk of ['', '.', 'abc', JSON.stringify(p), 'x'.repeat(40000), null, 42]) assert.equal(S.load(junk), null);
});

// LocalServer with a save adapter; join(id, save) → entity; blobs(id) = the saves it was sent.
function server(saves) {
  const sent = new Map();
  const s = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, saves, send: (id, m) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(JSON.parse(JSON.stringify(m))); } });
  const join = (id, save = '') => { s.connect(id); s.receive(id, { t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'P' + id, skin: 0, weapon: 0, save }); return s.clients.get(id).entity; };
  const blobs = (id) => (sent.get(id) || []).filter((m) => m.t === MSG.SAVE).map((m) => m.blob);
  const events = (id, type) => (sent.get(id) || []).filter((m) => m.t === MSG.EVENT && m.ev.type === type).map((m) => m.ev);
  const run = (n) => { for (let i = 0; i < n; i++) s.step(); };
  return { s, w: s.world, ecs: s.world.ecs, join, blobs, events, run };
}

test('the server sends a fresh save: at once on joining and after what matters, later for small things, never twice the same', () => {
  const { s, w, ecs, join, blobs, run } = server(trustSaves);
  const e = join(1);
  run(2);
  assert.equal(blobs(1).length, 1, 'right after joining');
  run(Math.round(SAVE_TIMING.every / DT) + 2);
  assert.equal(blobs(1).length, 1, 'nothing changed: no new blob');
  // Something that matters (an item) goes out at once.
  const p = w.profiles.get(e);
  w.drops.set(999, { id: 999, to: e, kind: 'item', x: ecs.x[e], z: ecs.z[e], t: w.tick + 600, item: { u: p.uid++, b: 'anillo', r: 1, l: 2, a: [['atk', 1]] } });
  run(4);
  assert.equal(blobs(1).length, 2);
  assert.equal(JSON.parse(blobs(1)[1]).bag.length, 1);
  // XP alone waits for the periodic look.
  ecs.xp[e] += 7;
  run(Math.round(SAVE_TIMING.every / DT) + 2);
  assert.equal(JSON.parse(blobs(1).at(-1)).xp, 7);
  assert.ok(s);
});

test('a new server (a restart) gives you your game back where you left it; a refused save starts fresh and says so', () => {
  const S = hmacSaves('k');
  const a = server(S);
  const e = a.join(1);
  const p = a.w.profiles.get(e);
  p.gold = 321;
  p.bag.push({ u: p.uid++, b: 'casaca', r: 3, l: 7, a: [['def', 3], ['hp', 3], ['rip', 3]] });
  const cp = map.checkpoints.aldea;
  a.ecs.cpX[e] = cp.x; a.ecs.cpZ[e] = cp.z;
  a.ecs.level[e] = 4;
  a.w.profileDirty.add(e);
  a.run(Math.round(SAVE_TIMING.every / DT) + 2);
  const blob = a.blobs(1).at(-1);
  // "Restart": another LocalServer with the same secret.
  const b = server(hmacSaves('k'));
  const e2 = b.join(7, blob);
  const q = b.w.profiles.get(e2);
  assert.equal(q.gold, 321);
  assert.equal(q.bag.at(-1).b, 'casaca');
  assert.equal(b.ecs.level[e2], 4);
  assert.ok(Math.hypot(b.ecs.x[e2] - cp.x, b.ecs.z[e2] - cp.z) < 0.01, 'back at the village');
  assert.equal(b.events(7, 'note').length, 0);
  // A server with another secret does not know it.
  const c = server(hmacSaves('otra'));
  const e3 = c.join(3, blob);
  c.run(1);
  assert.equal(c.w.profiles.get(e3).gold, 0);
  assert.equal(c.events(3, 'note')[0].code, 'save');
});

after(async () => { for (const g of games) await g.close(); });
const games = [];

test('the Node server signs saves: same SAVE_SECRET after a restart = same game, over real WebSockets', { timeout: 30000 }, async () => {
  const boot = async (saveSecret) => { const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: true, log: () => {}, saveSecret }); games.push(gs); return { gs, port: await gs.listen() }; };
  const play = async (port, save) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), msgs = [];
    ws.onmessage = (ev) => msgs.push(JSON.parse(ev.data));
    await new Promise((r) => { ws.onopen = r; });
    ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: 'Ana', skin: 1, weapon: 0, save }));
    const until = async (pred) => { for (let i = 0; i < 600; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 10)); } return null; };
    return { ws, msgs, until };
  };
  const one = await boot('mar de fondo');
  const a = await play(one.port, '');
  assert.ok(await a.until((m) => m.t === MSG.SAVE), 'a save right away');
  a.ws.send(JSON.stringify({ t: MSG.CMD, type: 'dev', op: 'gold', n: 55 }));
  const blob = (await a.until((m) => m.t === MSG.SAVE && m.blob.length && JSON.parse(Buffer.from(m.blob.split('.')[0], 'base64url')).gold === 55)).blob;
  a.ws.close();
  await one.gs.close();
  const two = await boot('mar de fondo');
  const b = await play(two.port, blob);
  const prof = await b.until((m) => m.t === MSG.PROFILE);
  assert.equal(prof.p.gold, 55, 'the restarted server knows the game');
  b.ws.close();
  const three = await boot('otro mar');
  const c = await play(three.port, blob);
  const note = await c.until((m) => m.t === MSG.EVENT && m.ev.type === 'note');
  assert.equal(note.ev.code, 'save');
  assert.equal((await c.until((m) => m.t === MSG.PROFILE)).p.gold, 0);
  c.ws.close();
});
