// M3.6 P5: two real clients (GameClient + WsTransport over Node's WebSocket) on the Node server with 100 ms of
// round trip. Prediction holds (no corrections while nothing pushes you), each sees the other walk and swing,
// the round trip is what the link says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { WsTransport } from '../src/net/wsTransport.js';
import { GameClient } from '../src/client/gameClient.js';
import { DT } from '../src/data/tuning.js';
import { map } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(url, name, skin) {
  const t = new WsTransport(url);
  assert.ok(await t.opened);
  const seen = [];
  const bus = { emit: (type, ev) => { if (type === 'combat') seen.push(ev); } };
  const c = new GameClient(t, map, bus);
  c.start();
  c.join(name, skin, 0);
  for (let k = 0; k < 300 && !c.joined; k++) await sleep(10);
  assert.ok(c.joined, name + ' joined');
  return { t, c, seen, acc: 0, n: 0, corr0: 0 };
}

test('two players at 100 ms RTT: prediction holds, they see each other walk and swing', { timeout: 30000 }, async (t) => {
  let gs, a, b, timer;
  // A timeout must release the loop, sockets and host just like a successful run.
  t.after(async () => {
    clearInterval(timer);
    let cleanupError;
    for (const close of [() => a?.t.close(), () => b?.t.close(), () => gs?.close()]) {
      try { await close(); } catch (error) { cleanupError ??= error; }
    }
    if (cleanupError && !t.signal.aborted) throw cleanupError;
  });
  gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, lagMs: 50, log: () => {} });
  const port = await gs.listen();
  const url = `ws://127.0.0.1:${port}/ws`;
  a = await player(url, 'Ana', 1); b = await player(url, 'Bruno', 3);
  t.signal.throwIfAborted();
  await sleep(400);
  a.corr0 = a.c.stats.corrections; b.corr0 = b.c.stats.corrections;
  // A walks a square on the beach; B stands and swings its cutlass now and then.
  const inputs = {
    a: (n) => { const k = Math.floor(n / 45) % 4; return { mx: [1, 0, -1, 0][k], mz: [0, 1, 0, -1][k], ax: 0, az: 0, btn: 0, prs: 0 }; },
    b: (n) => ({ mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: n % 50 === 10 ? 2 : 0 }),
  };
  const xs = [];
  let last = performance.now();
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearInterval(timer);
      t.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(t.signal.reason);
    t.signal.addEventListener('abort', abort, { once: true });
    if (t.signal.aborted) { abort(); return; }
    timer = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const [k, p] of [['a', a], ['b', b]]) {
        p.acc += dt;
        while (p.acc >= DT) { p.acc -= DT; p.c.tickInput({ ...inputs[k](p.n++), w: 0 }); }
        p.t.flush();
        p.c.update(dt, dt);
      }
      const ra = b.c.entities.get(a.c.youServer);
      if (ra && ra.ready) xs.push(ra.r.x);
      if (a.n > 60 * 5) {
        finish();
      }
    }, 16);
  });
  await sleep(300);
  // Nothing pushed A around: what it predicted is what the server did.
  assert.equal(a.c.stats.corrections - a.corr0, 0, 'no prediction corrections while walking');
  assert.ok(a.c.stats.pending < 30, `pending ${a.c.stats.pending}`);
  // B saw A walk (interpolated), and A saw B's swings.
  assert.ok(Math.max(...xs) - Math.min(...xs) > 3, 'B sees A move');
  const swings = a.seen.filter((ev) => ev.type === 'swing' && ev.e === b.c.youServer && !ev.me);
  assert.ok(swings.length >= 3, `A saw ${swings.length} of B's swings`);
  assert.equal(a.c.humans, 2);
  assert.equal(b.c.humans, 2);
  assert.ok(a.t.rtt > 80 && a.t.rtt < 160, `rtt ${a.t.rtt.toFixed(0)} ms`);
  // The server never needed fillers or dropped anything for these two.
  const st = gs.game.server.stats;
  assert.equal(st.late + st.trimmed, 0, JSON.stringify(st));
});

test('a death still flying on a shot waits for it: the despawn is held, and a newcomer reusing the id is not touched', async () => {
  const { MSG } = await import('../src/net/protocol.js');
  const { KIND } = await import('../src/sim/ecs.js');
  const { ENEMY_KINDS } = await import('../src/data/enemies.js');
  const { PTYPE } = await import('../src/sim/projectiles.js');
  const msgs = [];
  const transport = { onSnapshot() {}, onMessage: (cb) => msgs.push(cb), start() {}, send() {}, sendInput() {} };
  const log = [];
  let client = null;
  const bus = { emit: (type, ev) => log.push({ type, ev, at50: client && client.entities.get(50) }) };
  client = new GameClient(transport, map, bus);
  const feed = (m) => msgs.forEach((cb) => cb(m));
  const enemy = (kind, maxHp) => ({ t: MSG.SPAWN, e: { id: 50, kind: KIND.ENEMY, name: kind, title: '', skin: 0, level: 1, enemy: ENEMY_KINDS.indexOf(kind), maxHp } });
  const shotAt = (sid) => {
    feed({ t: MSG.EVENT, ev: { type: 'shot', sid, pid: 0, key: 0, owner: 99, x: 0, y: 1, z: 0, dx: 1, dz: 0, speed: 14, dmg: 5, life: 2, r: 0.25, ptype: PTYPE.PARRY, heavy: 0, seq: 0, homing: 0, cone: 0 } });
    feed({ t: MSG.EVENT, ev: { type: 'shotEnd', sid, x: 6, z: 0, hit: 50 } });
    feed({ t: MSG.EVENT, ev: { type: 'kill', id: 50, by: 99, x: 6, z: 0, xp: 5 } });
    feed({ t: MSG.DESPAWN, id: 50 });
  };
  // 1) The shot lands (client update): the kill plays on the archer, then it goes.
  feed(enemy('archer', 30));
  const archer = client.entities.get(50);
  shotAt(7);
  assert.equal(client.entities.get(50), archer, 'despawn held while its death is in flight');
  for (let i = 0; i < 20; i++) client.update(1 / 60);
  const k1 = log.find((l) => l.type === 'combat' && l.ev.type === 'kill');
  assert.ok(k1 && k1.at50 === archer, 'the death played on the archer');
  assert.ok(!client.entities.has(50), 'then it was despawned');
  // 2) The id comes back before the shot lands (the boss rises on the freed slot).
  log.length = 0;
  feed(enemy('archer', 30));
  const second = client.entities.get(50);
  shotAt(8);
  feed(enemy('hellfire', 5600));
  const kill = log.findIndex((l) => l.type === 'combat' && l.ev.type === 'kill');
  const gone = log.findIndex((l) => l.type === 'entity:despawn' && l.ev === second);
  const born = log.findIndex((l) => l.type === 'entity:spawn' && l.ev.enemy === 'hellfire');
  assert.ok(kill >= 0 && kill < gone && gone < born, `order kill ${kill} < despawn ${gone} < spawn ${born}`);
  assert.equal(log[kill].at50, second, 'the late death is the old archer’s');
  const boss = client.entities.get(50);
  assert.equal(boss.enemy, 'hellfire');
  assert.ok(!boss.dying, 'the boss is not marked dying');
});
