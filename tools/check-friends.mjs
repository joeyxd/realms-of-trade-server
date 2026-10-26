// Live HTTP + two-player WebSocket canary, usable against localhost or the shared HTTPS URL.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { MSG, ENT, PROTOCOL_VERSION } from '../src/net/protocol.js';

const base = new URL(process.argv[2] || 'http://localhost:5173');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Use an HTTP(S) game URL.');
const httpBase = base.origin;
const socketUrl = httpBase.replace(/^http/, 'ws') + '/ws';
const clients = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (route) => fetch(httpBase + route, { signal: AbortSignal.timeout(10000) });

function connect(name) {
  const ws = new WebSocket(socketUrl, { origin: httpBase, handshakeTimeout: 10000 });
  const messages = [], waiters = new Set();
  const c = { ws, messages, tick: 0 };
  clients.push(c);
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (Number.isFinite(message.tick)) c.tick = Math.max(c.tick, message.tick);
    messages.push(message);
    if (messages.length > 500) messages.shift();
    for (const waiter of [...waiters]) if (waiter.predicate(message)) waiter.finish(null, message);
  });
  ws.on('error', (error) => { for (const waiter of [...waiters]) waiter.finish(error); });
  ws.on('close', () => { for (const waiter of [...waiters]) waiter.finish(new Error('Socket closed before the expected message')); });
  c.open = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  c.wait = (predicate, description = 'game message') => {
    const old = messages.find(predicate);
    if (old) return Promise.resolve(old);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, finish(error, message) {
        clearTimeout(timer); waiters.delete(waiter);
        error ? reject(error) : resolve(message);
      } };
      const timer = setTimeout(() => waiter.finish(new Error(`Timed out waiting for ${description}`)), 10000);
      waiters.add(waiter);
    });
  };
  c.send = (message) => ws.send(JSON.stringify(message));
  c.hello = () => c.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name, skin: 1, weapon: 0 });
  return c;
}

try {
  const [health, page, status] = await Promise.all([request('/health'), request('/'), request('/status')]);
  assert.equal(await health.text(), 'ok');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<meta name="mn-server"/);
  const info = await status.json();
  assert.ok(info.max - info.players >= 2, 'Need two available player slots for the canary');
  const blocked = ['/.env', '/.git/config', '/server/index.mjs', '/.scratch/pc-host/session.json'];
  const responses = await Promise.all(blocked.map(request));
  for (let i = 0; i < blocked.length; i++) assert.equal(responses[i].status, 404, blocked[i]);
  const a = connect('Prueba A'), b = connect('Prueba B');
  await Promise.all([a.open, b.open]);
  a.hello();
  const wa = await a.wait((m) => m.t === MSG.WELCOME, 'A welcome');
  b.hello();
  const wb = await b.wait((m) => m.t === MSG.WELCOME, 'B welcome');
  assert.notEqual(wa.you, wb.you);
  await a.wait((m) => m.t === MSG.SPAWN && m.e.id === wb.you && m.e.human === 1);
  await b.wait((m) => m.t === MSG.SPAWN && m.e.id === wa.you && m.e.human === 1);
  const initial = await b.wait((m) => m.t === MSG.SNAPSHOT && m.ents.some((e) => e[ENT.ID] === wa.you));
  const x0 = initial.ents.find((e) => e[ENT.ID] === wa.you)[ENT.X];
  let seq = 0, pt = a.tick;
  for (let i = 0; i < 12; i++) {
    // Follow the observed server clock; pt=0 would be discarded after network starvation fills.
    pt = Math.max(pt, a.tick);
    a.send({ t: MSG.INPUTS, cmds: Array.from({ length: 6 }, () => ({ seq: ++seq, mx: 1, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, pt: ++pt })) });
    await sleep(100);
  }
  await b.wait((m) => m.t === MSG.SNAPSHOT && m.ents.some((e) => e[ENT.ID] === wa.you && e[ENT.X] > x0 + 3), 'movement visible to B');
  a.ws.close();
  await b.wait((m) => m.t === MSG.DESPAWN && m.id === wa.you);
  console.log(JSON.stringify({ url: httpBase, game: info.game, version: info.version, protocol: PROTOCOL_VERSION,
    http: 'ok', privateFiles: '404', players: 2, sharedMovement: 'ok', leaving: 'ok' }));
} finally {
  for (const c of clients) c.ws.terminate();
}
