// La Prueba de Fuego in co-op over real WebSockets, with latency (PLAN-M3.6.md §2.5). For every RTT it boots a
// game server in this process (port 0, artificial latency on its sockets) and N bot clients: GameClient +
// WsTransport (Node's own WebSocket), each playing tools/botbrain.mjs on what ITS client shows (its predicted
// self, the projectiles at its projectile tick, the enemies as interpolated 100 ms back). All RTTs run at once,
// in real time. It reports how the netcode held up: victory time, damage taken, reflect tiers, prediction
// corrections, commands outside the rewind window, filler / late commands, bandwidth on the wire.
// Usage: RTTS=0,100,200 N=2 LV=6 SKILL=0.9 WEAPONS=sable,pistolas JITTER=10 MAX=420 node tools/nettest.mjs
import { createGameServer } from '../server/index.mjs';
import { WsTransport } from '../src/net/wsTransport.js';
import { GameClient } from '../src/client/gameClient.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { GAME } from '../src/data/meta.js';
import { DT } from '../src/data/tuning.js';
import { ACT } from '../src/sim/ecs.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { weaponIndex } from '../src/data/weapons.js';
import { makeBrain } from './botbrain.mjs';

const env = process.env;
const RTTS = (env.RTTS || '0,100,200').split(',').map(Number);
const N = +(env.N || 2), LV = +(env.LV || 6), SKILL = +(env.SKILL || 0.9), JITTER = +(env.JITTER || 0), MAX = +(env.MAX || 420);
const WEAPONS = (env.WEAPONS || 'sable,pistolas').split(',');
const map = generateWorld(GAME.seed);
// Enemies the bots go after: awake ones around La Caldera (archers kite out past its rim, so wider than it).
const A = map.landmarks.arena, R = ENCOUNTERS.caldera.radius + 14;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bot(i, url) {
  const weapon = WEAPONS[i % WEAPONS.length];
  const t = new WsTransport(url);
  if (!(await t.opened)) throw new Error('socket did not open');
  let client = null;
  const bus = { emit(type, ev) { if (type === 'combat' && ev.type === 'kill' && client) { const r = client.entities.get(ev.id); if (r) r.dying = true; } } };
  client = new GameClient(t, map, bus);
  client.start();
  client.join(`Bot${i + 1}`, i % 5, weaponIndex(weapon));
  for (let k = 0; k < 400 && !client.joined; k++) await sleep(10);
  if (!client.joined) throw new Error('did not join');
  const b = { i, weapon, t, client, brain: makeBrain({ weapon, skill: SKILL, seed: 12345 + i * 7919 }), acc: 0, err: { n: 0, sum: 0, max: 0 }, ptLag: [] };
  // Prediction quality: every reconcile that moved us.
  const rec = client.reconcile.bind(client);
  client.reconcile = (ack, st) => { rec(ack, st); const d = client.stats.predErr; if (d > 1e-6) { b.err.n++; b.err.sum += d; b.err.max = Math.max(b.err.max, d); } };
  return b;
}

function view(b) {
  const c = b.client, ecs = c.pred.ecs, e = c.youLocal, enemies = [];
  for (const r of c.entities.values()) {
    if (!r.enemy || !r.ready || r.dying || r.r.hp <= 0 || r.r.act === ACT.DORMANT) continue;
    if (Math.hypot(r.r.x - A.x, r.r.z - A.z) > R) continue;
    enemies.push({ x: r.r.x, z: r.r.z });
  }
  const bid = c.enc && c.enc[0] ? c.enc[0][5] : 0, br = bid ? c.entities.get(bid) : null;
  const pt = c.ptCur + 1;
  return {
    px: ecs.x[e], pz: ecs.z[e], pt, tick: pt, H: c.pred.hazards, enemies, enc: { cx: A.x, cz: A.z },
    boss: br && br.ready && !br.dying ? { x: br.r.x, z: br.r.z } : null,
    me: { dashCharges: ecs.dashCharges[e], cdQ: ecs.cdQ[e], cdE: ecs.cdE[e], riposte: ecs.riposte[e], catchN: ecs.catchN[e] },
  };
}

async function run(rtt) {
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, dev: true, lagMs: rtt / 2, jitterMs: JITTER / 2, log: () => {} });
  const port = await gs.listen();
  const srv = gs.game.server, w = srv.world, enc = w.encounters[0];
  const bots = [];
  for (let i = 0; i < N; i++) bots.push(await bot(i, `ws://127.0.0.1:${port}/ws`));
  // Server-side tally per player (the server decides every hit).
  const ents = new Map(bots.map((b) => [b.client.youServer, { dmg: 0, hits: 0, perfect: 0, good: 0, poor: 0, destroy: 0, catch: 0, block: 0, kills: 0, dealt: 0 }]));
  const log = [];
  let t0 = 0, victory = 0;
  const wipes = [];
  const flush = srv.flushEvents.bind(srv);
  srv.flushEvents = () => {
    for (const ev of w.events) {
      const s = ents.get(ev.e);
      if (ev.type === 'hurt' && s) { s.dmg += ev.raw; s.hits++; }
      else if (ev.type === 'parry' && s) { if (ev.tier === 3) s.perfect++; else if (ev.tier === 2) s.good++; else s.poor++; }
      else if (ev.type === 'destroy' && s) s.destroy++;
      else if (ev.type === 'guard' && s) { if (ev.st === 'perfect') s.catch++; else if (ev.st === 'block') s.block++; }
      else if (ev.type === 'damage' && ents.has(ev.by)) ents.get(ev.by).dealt += ev.dmg;
      else if (ev.type === 'kill' && ents.has(ev.by)) ents.get(ev.by).kills++;
      else if (ev.type === 'enc') {
        if (ev.st === 'intro' && !t0) t0 = w.tick;
        if (ev.wipe) wipes.push(+((w.tick - t0) * DT).toFixed(0));
        const k = ev.st + ev.wave;
        if (!log.includes(k) && ['wave', 'boss', 'victory'].includes(ev.st)) log.push(k);
        if (ev.st === 'victory') victory = w.tick;
      }
    }
    flush();
  };
  for (const b of bots) {
    b.t.send({ t: 'cmd', type: 'dev', op: 'level', level: LV });
    b.t.send({ t: 'cmd', type: 'dev', op: 'mastery', level: 3 }); // M4: a fresh profile has E and R locked
    b.t.send({ t: 'cmd', type: 'dev', op: 'god', on: true });
    b.t.send({ t: 'cmd', type: 'debug_teleport', x: A.x + (b.i - (N - 1) / 2) * 1.2, z: A.z });
  }
  // Count from here: the teleport into the arena is not a misprediction.
  await sleep(600 + rtt * 2);
  for (const b of bots) { b.err = { n: 0, sum: 0, max: 0 }; b.ptLag.length = 0; }
  const w0 = gs.game.wireOut(), started = performance.now();
  let last = performance.now();
  const b0 = {};
  // The clients' frames: fixed 60 Hz commands from the brain, one flush per frame, then the client update.
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const b of bots) {
        b.acc += dt;
        while (b.acc >= DT) {
          b.acc -= DT;
          b.client.tickInput({ ...b.brain(view(b)), w: 0 });
          b.ptLag.push(b.client.stats.ptLag);
        }
        b.t.flush();
        b.client.update(dt, dt);
      }
      if (env.DEBUG && (now - (b0.dbg || 0)) > 10000) {
        b0.dbg = now;
        const srvSide = [...enc.alive].filter((q) => w.ecs.alive[q]).map((q) => `${w.ecs.names[q]}@${Math.hypot(w.ecs.x[q] - A.x, w.ecs.z[q] - A.z).toFixed(0)}`).join(' ');
        const seen = bots.map((b) => { const v = view(b); return `Bot${b.i + 1}@${Math.hypot(v.px - A.x, v.pz - A.z).toFixed(0)} ve ${v.enemies.map((o) => Math.hypot(o.x - v.px, o.z - v.pz).toFixed(0)).join(',')}`; }).join(' · ');
        console.log(`[${rtt} ms ${((now - started) / 1000).toFixed(0)} s] ${enc.st} w${enc.wave + 1} · servidor: ${srvSide} · ${seen}`);
      }
      if (victory || (now - started) / 1000 > MAX) { clearInterval(timer); resolve(); }
    }, 16);
  });
  const secs = (performance.now() - started) / 1000, w1 = gs.game.wireOut(), st = gs.game.status();
  const out = {
    rtt, victory: victory ? +((victory - t0) * DT).toFixed(1) : null, reached: log.at(-1) || '-', stepMs: st.stepMs, net: srv.stats, wipes,
    boss: enc.bossE && w.ecs.alive[enc.bossE] ? `${Math.ceil(w.ecs.hp[enc.bossE])}/${w.ecs.maxHp[enc.bossE]} fase ${w.ecs.brain[enc.bossE].phase + 1}` : '',
    // Unfinished: where the encounter's enemies and the bots are (distance from the centre).
    left: victory ? '' : [...enc.alive].filter((q) => w.ecs.alive[q]).map((q) => `${w.ecs.names[q]}@${Math.hypot(w.ecs.x[q] - A.x, w.ecs.z[q] - A.z).toFixed(0)}`).join(' ')
      + ' | bots@' + bots.map((b) => Math.hypot(w.ecs.x[b.client.youServer] - A.x, w.ecs.z[b.client.youServer] - A.z).toFixed(0)).join('/'),
    players: bots.map((b) => {
      const s = ents.get(b.client.youServer), id = [...gs.game.sockets.keys()][b.i];
      return {
        bot: b.i + 1, weapon: b.weapon, ...s, rttMeasured: +b.t.rtt.toFixed(0),
        corrections: b.err.n, perMin: +(b.err.n / (secs / 60)).toFixed(1), meanErr: b.err.n ? +(b.err.sum / b.err.n).toFixed(3) : 0, maxErr: +b.err.max.toFixed(2),
        wireKBs: id !== undefined ? +((w1[id] - w0[id]) / 1024 / secs).toFixed(1) : null,
        ptLagAvg: +(b.ptLag.reduce((a, v) => a + v, 0) / Math.max(1, b.ptLag.length)).toFixed(2),
      };
    }),
  };
  for (const b of bots) b.t.close();
  await gs.close();
  return out;
}

const results = await Promise.all(RTTS.map((r) => run(r).catch((err) => ({ rtt: r, error: String(err && err.stack || err) }))));
for (const r of results) {
  if (r.error) { console.log(`RTT ${r.rtt} ms: ERROR ${r.error}`); continue; }
  console.log(`\nRTT ${r.rtt} ms (±${JITTER / 2} por sentido) · victoria ${r.victory ?? 'no'} s (llegó a ${r.reached}${r.boss ? ', jefe ' + r.boss : ''}${r.wipes.length ? ', reinicios a los ' + r.wipes.join('/') + ' s' : ''}) · servidor ${r.stepMs} ms/paso · ${JSON.stringify(r.net)}`);
  if (r.left) console.log(`  quedan: ${r.left}`);
  for (const p of r.players) {
    console.log(`  Bot${p.bot} ${p.weapon.padEnd(8)} daño recibido ${String(p.dmg).padStart(4)} (${p.hits} golpes) · reflejos E/B/P ${p.perfect}/${p.good}/${p.poor} · destruidas ${p.destroy} · atrapadas ${p.catch} · bloqueos ${p.block} · daño hecho ${p.dealt} · bajas ${p.kills}`);
    console.log(`        rtt medido ${p.rttMeasured} ms · correcciones ${p.corrections} (${p.perMin}/min, media ${p.meanErr} u, máx ${p.maxErr} u) · pt vs servidor ${p.ptLagAvg} ticks · ${p.wireKBs} KB/s`);
  }
}
process.exit(0);
