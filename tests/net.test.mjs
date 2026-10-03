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

test('two players at 100 ms RTT: prediction holds, they see each other walk and swing', { timeout: 30000 }, async () => {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, lagMs: 50, log: () => {} });
  const port = await gs.listen();
  const url = `ws://127.0.0.1:${port}/ws`;
  const a = await player(url, 'Ana', 1), b = await player(url, 'Bruno', 3);
  await sleep(400);
  a.corr0 = a.c.stats.corrections; b.corr0 = b.c.stats.corrections;
  // A walks a square on the beach; B stands and swings its cutlass now and then.
  const inputs = {
    a: (n) => { const k = Math.floor(n / 45) % 4; return { mx: [1, 0, -1, 0][k], mz: [0, 1, 0, -1][k], ax: 0, az: 0, btn: 0, prs: 0 }; },
    b: (n) => ({ mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: n % 50 === 10 ? 2 : 0 }),
  };
  const xs = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
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
      if (a.n > 60 * 5) { clearInterval(timer); resolve(); }
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
  a.t.close(); b.t.close();
  await gs.close();
});
