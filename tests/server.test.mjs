// M3.6 P1: the real Node server. The same LocalServer behind WebSockets (Node 22's global WebSocket is
// the client here): joining, seeing each other, inputs, leaving, limits, junk, static files.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.mjs';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';

const servers = [];
async function boot(o = {}) {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, ...o });
  const port = await gs.listen();
  servers.push(gs);
  return { gs, port, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}
afterEach(async () => { for (const s of servers.splice(0)) await s.close(); });

// A raw protocol client: collects every message, waits for the one you want.
function connect(url) {
  const ws = new WebSocket(url);
  const c = { ws, msgs: [], waiters: [], closed: null };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    c.msgs.push(m);
    for (const w of [...c.waiters]) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); }
  };
  ws.onclose = (ev) => { c.closed = ev.code; for (const w of c.waiters) w.resolve(null); };
  c.open = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  c.send = (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  c.wait = (pred, ms = 3000) => {
    const old = c.msgs.find(pred);
    if (old) return Promise.resolve(old);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      c.waiters.push(w);
      setTimeout(() => { const i = c.waiters.indexOf(w); if (i >= 0) { c.waiters.splice(i, 1); reject(new Error('timeout')); } }, ms);
    });
  };
  c.hello = (name, extra = {}) => c.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 1, weapon: 0, ...extra });
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('/health, /status and only the client files are served', async () => {
  const { http } = await boot();
  assert.equal(await (await fetch(http + '/health')).text(), 'ok');
  const st = await (await fetch(http + '/status')).json();
  assert.equal(st.game, 'MAREA NEGRA');
  assert.equal(st.players, 0);
  assert.equal(st.max, 4);
  const page = await fetch(http + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /src\/main\.js/);
  assert.match(html, /<meta name="mn-server"/, 'the page says it came from a game server');
  assert.equal((await fetch(http + '/src/net/protocol.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  for (const p of ['/server/host.mjs', '/package.json', '/src/../server/index.mjs', '/..%2f..%2fetc/passwd', '/.git/config']) {
    assert.equal((await fetch(http + p)).status, 404, p);
  }
});

test('two players join the same island, see each other move, and leaving despawns', { timeout: 30000 }, async () => {
  const { url } = await boot();
  const a = connect(url), b = connect(url);
  try {
    await Promise.all([a.open, b.open]);
    a.hello('Ana');
    const wa = await a.wait((m) => m.t === MSG.WELCOME, 8000);
    b.hello('Ana'); // same name: the server makes it unique
    const wb = await b.wait((m) => m.t === MSG.WELCOME, 8000);
    assert.notEqual(wa.you, wb.you);
    // Each sees the other as a human player (B got A's spawn on connect, A gets B's when B joins).
    const sa = await b.wait((m) => m.t === MSG.SPAWN && m.e.id === wa.you, 8000);
    const sb = await a.wait((m) => m.t === MSG.SPAWN && m.e.id === wb.you, 8000);
    assert.equal(sa.e.human, 1);
    assert.equal(sb.e.name, 'Ana 2');
    // A walks +x. Keep feeding bounded batches until a snapshot proves the full displacement;
    // a fixed burst can all arrive between slow simulation ticks on the one-CPU offline runner.
    const x0 = (await b.wait((m) => m.t === MSG.SNAPSHOT && m.ents.some((e) => e[ENT.ID] === wa.you), 8000))
      .ents.find((e) => e[ENT.ID] === wa.you)[ENT.X];
    const moved = (m) => m.t === MSG.SNAPSHOT && m.ents.some((e) => e[ENT.ID] === wa.you && e[ENT.X] > x0 + 3);
    let seq = 0, snap = b.msgs.find(moved);
    const movementDeadline = Date.now() + 15000;
    while (!snap && Date.now() < movementDeadline) {
      // `pt` is the server tick the client is playing against. A constant zero is
      // immediately behind the server's filler watermark, so those commands are
      // acknowledged as late without ever reaching movement simulation.
      const latestSnapshot = [...a.msgs].reverse().find((m) => m.t === MSG.SNAPSHOT);
      const pt = Math.max(1, latestSnapshot?.tick ?? 1);
      a.send({ t: MSG.INPUTS, cmds: Array.from({ length: 6 }, () => ({ seq: ++seq, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt })) });
      await sleep(100);
      snap = b.msgs.find(moved);
    }
    assert.ok(snap, 'B observes A move more than three units before the bounded deadline');
    const hasAck = (m) => m.t === MSG.SNAPSHOT && m.ack >= seq - 2;
    let mine = a.msgs.find(hasAck);
    const ackDeadline = Date.now() + 5000;
    while (!mine && Date.now() < ackDeadline) { await sleep(100); mine = a.msgs.find(hasAck); }
    assert.ok(mine, 'A receives acknowledgement for the submitted movement');
    assert.ok(mine.you && mine.you.length > 10, 'A gets its own full state');
    a.ws.close();
    await b.wait((m) => m.t === MSG.DESPAWN && m.id === wa.you, 8000);
  } finally {
    if (a.ws.readyState !== WebSocket.CLOSED && a.ws.readyState !== WebSocket.CLOSING) a.ws.close();
    if (b.ws.readyState !== WebSocket.CLOSED && b.ws.readyState !== WebSocket.CLOSING) b.ws.close();
  }
});

test('a full instance and a wrong protocol version are refused politely', async () => {
  const { url, gs } = await boot({ maxPlayers: 1 });
  const a = connect(url), b = connect(url), c = connect(url);
  await Promise.all([a.open, b.open, c.open]);
  a.hello('Uno');
  await a.wait((m) => m.t === MSG.WELCOME);
  b.hello('Dos');
  const full = await b.wait((m) => m.t === MSG.FULL);
  assert.equal(full.max, 1);
  c.send({ t: MSG.HELLO, v: PROTOCOL_VERSION - 1, name: 'Viejo' });
  const err = await c.wait((m) => m.t === MSG.ERROR);
  assert.equal(err.code, 'version');
  assert.equal(gs.game.status().players, 1);
  // The refused sockets still spectate (snapshots keep coming).
  await b.wait((m) => m.t === MSG.SNAPSHOT);
  for (const k of [a, b, c]) k.ws.close();
});

test('junk does not hurt the server: malformed messages close only that socket', async () => {
  const { url, gs } = await boot();
  const bad = connect(url), good = connect(url);
  await Promise.all([bad.open, good.open]);
  good.hello('Buena');
  await good.wait((m) => m.t === MSG.WELCOME);
  for (const j of ['nope', '{"t":5}', '[]', 'null', '{"x":1}', '{']) bad.send(j);
  bad.send({ t: MSG.INPUTS, cmds: 'x' });
  bad.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: { evil: true }, skin: 'x', weapon: -99 });
  for (let i = 0; i < 50 && bad.closed === null; i++) await sleep(20);
  assert.equal(bad.closed, 1008);
  // A huge inputs message is trimmed, odd fields sanitized; the good client carries on.
  good.send({ t: MSG.INPUTS, cmds: Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, mx: 1e9, mz: 'a', btn: -1, pt: -5 })) });
  await sleep(300);
  const snap = await good.wait((m) => m.t === MSG.SNAPSHOT && m.ack > 0);
  assert.ok(snap.ack <= 500);
  assert.equal(gs.game.errors, 0);
  assert.equal(gs.game.status().players, 1);
  good.ws.close();
});

test('names are cleaned: control characters, markup and length', async () => {
  const { url } = await boot();
  const a = connect(url);
  await a.open;
  a.hello('  Capi\u0007tana <b>Rojo</b>   de los Siete Mares ');
  const w = await a.wait((m) => m.t === MSG.WELCOME);
  const sp = await a.wait((m) => m.t === MSG.SPAWN && m.e.id === w.you);
  assert.ok(!/[<>\u0007]/.test(sp.e.name));
  assert.ok(sp.e.name.length <= 16);
  assert.match(sp.e.name, /^Capitana bRojo/);
  a.ws.close();
});
