// Headless playtest of La Prueba de Fuego (balance, PLAN-M3.md P7, M3.5): the scripted player of
// tools/botbrain.mjs (god mode, but every hit is counted) on the server world, with no latency.
// Usage: LV=5 SKILL=0.8 [WEAPON=pistolas] node tools/playtest.mjs
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { DT } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { weaponIndex } from '../src/data/weapons.js';
import { makeBrain } from './botbrain.mjs';
const LV = +(process.env.LV || 5), SKILL = +(process.env.SKILL || 0.8), WEAPON = process.env.WEAPON || 'sable';
const map = generateWorld(GAME.seed);
const w = new World(GAME.seed, { map, server: true });
w.populate();
const enc = w.encounters[0], ecs = w.ecs, H = w.hazards;
const e = w.spawnPlayer({ x: enc.cx, z: enc.cz, level: LV, weapon: weaponIndex(WEAPON) });
ecs.god[e] = 1;
const bossDmg = {};
const stats = { dmg: 0, hits: 0, parry: 0, perfect: 0, good: 0, poor: 0, destroy: 0, block: 0, catch: 0, release: 0, broken: 0, dodge: 0, ghost: 0, graze: 0, bounce: 0, kills: 0, shotKills: 0, riposte: 0, fire: 0, cast: 0, rain: 0 };
const t0wave = {}; const log = []; const byKind = {};
// The bot sees the server world directly (no latency: tools/nettest.mjs plays it over the network).
const brain = makeBrain({ weapon: WEAPON, skill: SKILL });
let seq = 0;
function policy() {
  const enemies = [];
  for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && !ecs.dead[o] && ecs.brain[o]?.enc) enemies.push({ x: ecs.x[o], z: ecs.z[o] });
  const boss = enc.bossE && ecs.alive[enc.bossE] ? { x: ecs.x[enc.bossE], z: ecs.z[enc.bossE] } : null;
  const c = brain({
    px: ecs.x[e], pz: ecs.z[e], pt: w.tick, tick: w.tick, H, enemies, enc, boss,
    me: { dashCharges: ecs.dashCharges[e], cdQ: ecs.cdQ[e], cdE: ecs.cdE[e], riposte: ecs.riposte[e], catchN: ecs.catchN[e] },
  });
  return { seq: ++seq, ...c, pt: w.tick };
}
let boss = 0, end = 0;
const perf = { sum: 0, n: 0, max: 0, live: 0 };
for (let i = 0; i < 60 * 600 && !end; i++) {
  w.applyCommand(e, policy());
  const c0 = performance.now();
  w.stepWorld();
  const c1 = performance.now() - c0;
  perf.sum += c1; perf.n++; perf.max = Math.max(perf.max, c1);
  if (i % 10 === 0) { let live = 0; for (let s = 0; s < H.cap; s++) if (H.live(s, w.tick)) live++; perf.live = Math.max(perf.live, live); }
  for (const ev of w.events) {
    if (ev.type === 'damage' && ev.id === enc.bossE) { const k = 'p' + (ecs.brain[enc.bossE].phase + 1) + ':' + ev.kind; bossDmg[k] = (bossDmg[k] || 0) + ev.dmg; }
    if (ev.type === 'hurt' && ev.e === e) { stats.dmg += ev.raw; stats.hits++; const src = ev.kind === 'aoe' ? (H.aoes.find((a) => a.id === ev.src) || {}) : {};
      const who = src.owner && ecs.alive[src.owner] ? ['', 'ar', 'se', 'gr', 'im', 'sh', 'cr', 'HF'][ecs.enemy[src.owner] + 1] || '?' : src.keep ? 'shell' : '';
      const k = `${enc.st === 'boss' ? 'B' : 'W'}:${ev.kind}${who ? '/' + who : ''}`;
      byKind[k] = (byKind[k] || 0) + ev.raw; }
    else if (ev.type === 'parry' && ev.e === e) { stats.parry++; if (ev.tier === 3) stats.perfect++; else if (ev.tier === 2) stats.good++; else stats.poor++; }
    else if (ev.type === 'destroy' && ev.e === e) stats.destroy++;
    else if (ev.type === 'guard' && ev.e === e) { if (ev.st === 'block') stats.block++; else if (ev.st === 'perfect') stats.catch++; else if (ev.st === 'break') stats.broken++; }
    else if (ev.type === 'release') stats.release++;
    else if (ev.type === 'dodge') stats.dodge++; else if (ev.type === 'ghost') stats.ghost++; else if (ev.type === 'graze') stats.graze++;
    else if (ev.type === 'riposte') stats.riposte++;
    else if (ev.type === 'fire') stats.fire++;
    else if (ev.type === 'cast' || ev.type === 'blink') stats.cast++;
    else if (ev.type === 'rain') stats.rain++;
    else if (ev.type === 'shot' && ev.from) stats.bounce++;
    else if (ev.type === 'kill') stats.kills++;
    else if (ev.type === 'phase') log.push(`${(w.tick * DT).toFixed(1)}s PHASE ${ev.phase}`);
    else if (ev.type === 'enc') { const k = ev.st + ev.wave; if (!t0wave[k]) { t0wave[k] = 1; log.push(`${(w.tick * DT).toFixed(1)}s ${ev.st} w${ev.wave + 1}`); } if (ev.st === 'victory') end = 1; }
  }
  w.events.length = 0;
}
console.log(`LV ${LV} skill ${SKILL}:`, log.join(' | '));
console.log('boss dmg by kind', JSON.stringify(bossDmg));
console.log(JSON.stringify(stats), 'dmg/HP', (stats.dmg / ecs.maxHp[e]).toFixed(1), 'by kind', JSON.stringify(byKind));
console.log(`step ${(perf.sum / perf.n).toFixed(3)} ms avg, ${perf.max.toFixed(2)} ms max · ${perf.live} live bullets max`);
