// Headless PvP playtest for La Cala Calavera (balance, PLAN-M4.5.md P5). Two scripted pirates of tools/botbrain.mjs
// with real profiles, at a level and in gear rolled at that level, fight in the fort until one falls: how long a
// fall takes, how many blows land, how big they are, who wins. Then (MOBS=1) the Cala's own mobs are there too,
// for SECS seconds of chaos: who falls to whom, what the mobs do to each other, what changes hands. The fallen
// pirate gets back up at the checkpoint and walks straight back in (with whatever it still has).
// Usage: RUNS=12 LV=6 RAR=1 SKILL=0.8 [A=sable] [B=pistolas] [MOBS=1 SECS=300] node tools/lawless.mjs
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { DT, tuning } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { weaponIndex } from '../src/data/weapons.js';
import { RARITIES } from '../src/data/items.js';
import { LAWLESS } from '../src/data/lawless.js';
import { mulberry32 } from '../src/core/rng.js';
import { rollItem } from '../src/sim/items.js';
import { installInventory, newProfile, attachProfile, giveItem, equipItem, setMastery } from '../src/sim/systems/inventory.js';
import { makeBrain } from './botbrain.mjs';

const RUNS = +(process.env.RUNS || 12), LV = +(process.env.LV || 6), RAR = +(process.env.RAR ?? 1), SKILL = +(process.env.SKILL || 0.8);
const KITS = [process.env.A || 'sable', process.env.B || 'pistolas'];
const MOBS = !!+(process.env.MOBS || 0), SECS = +(process.env.SECS || 300);
const RTT = +(process.env.RTT || 0), owt = Math.round(RTT / 2 / 1000 / DT), viewDelay = owt + tuning.combat.interpTicks;
const map = generateWorld(GAME.seed), K = map.cala;
// Two clear spots 7 u apart inside the fort (no prop within 1.6 u of the line between them).
const SPOT = (() => {
  for (let r = 3; r < K.r - 10; r += 1) for (let a = 0; a < 6.28; a += 0.4) {
    const x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r;
    if (map.colliders.every((c) => Math.hypot(c.x - (x + Math.max(0, Math.min(7, c.x - x))), c.z - z) >= c.r + 1.6) && map.lawlessAt(x + 7, z)) return { x, z };
  }
  throw new Error('no open ground in the Cala');
})();

function setup(seed) {
  const w = new World(GAME.seed, { map, server: true });
  w.meleeVersion = process.env.MN_MELEE === '1' ? 1 : 0;
  installInventory(w);
  if (MOBS) w.populate();
  const rng = mulberry32(seed);
  const pirates = KITS.map((kit, i) => {
    const e = w.spawnPlayer({ name: ['Barbanegra', 'Mendoza'][i], x: SPOT.x + i * 7, z: SPOT.z, level: LV, weapon: weaponIndex(kit) });
    const p = newProfile({ weapon: weaponIndex(kit) });
    p.lvl = LV;
    attachProfile(w, e, p);
    setMastery(w, e, Math.min(10, Math.ceil(LV / 2)));
    const gear = [['weapon', { slot: 'weapon', weapon: kit }], ['head', { slot: 'head' }], ['chest', { slot: 'chest' }], ['boots', { slot: 'boots' }], ['ring1', { slot: 'ring' }], ['ring2', { slot: 'ring' }]];
    if (RAR >= 0) for (const [slot, o] of gear) { const it = giveItem(w, e, rollItem(rng, { lvl: LV, rarity: RAR, ...o })); if (it) equipItem(w, e, it.u, slot); }
    w.ecs.hp[e] = w.ecs.maxHp[e];
    return { e, p, kit, brain: makeBrain({ weapon: kit, skill: SKILL, seed: seed * 7 + i }), seq: 0, samples: [], queue: [] };
  });
  w.events.length = 0;
  return { w, pirates };
}

const inside = (w, e) => map.lawlessAt(w.ecs.x[e], w.ecs.z[e]);
function command(w, me, other) {
  const ecs = w.ecs, e = me.e;
  const enemies = [];
  const seen = other?.samples[0];
  if (seen && !seen.dead && map.lawlessAt(seen.x, seen.z)) enemies.push({ ...seen, pirate: true });
  if (MOBS) for (let o = 1; o < ecs.cap; o++) if (ecs.alive[o] && (ecs.mask[o] & C.ENEMY) && !ecs.dead[o] && ecs.brain[o]?.cala) enemies.push({ x: ecs.x[o], z: ecs.z[o], act: ecs.act[o], actT: ecs.actT[o], pirate: false });
  const c = me.brain({
    px: ecs.x[e], pz: ecs.z[e], pt: w.tick, tick: w.tick, H: w.hazards, enemies, enc: { cx: K.x, cz: K.z }, boss: null,
    me: { dashCharges: ecs.dashCharges[e], cdQ: ecs.cdQ[e], cdE: ecs.cdE[e], riposte: ecs.riposte[e], catchN: ecs.catchN[e] },
  });
  // Outside (just got back up): walk straight back in.
  if (!inside(w, e)) { const dx = K.x - ecs.x[e], dz = K.z - ecs.z[e], d = Math.hypot(dx, dz); c.mx = dx / d; c.mz = dz / d; c.prs = 0; c.btn = 0; }
  // Nothing pressing: pick up the nearest public drop within 6 u.
  else if (!c.prs && !c.btn) {
    let best = null, bd = 6;
    for (const d of w.drops.values()) if (!d.to) { const l = Math.hypot(d.x - ecs.x[e], d.z - ecs.z[e]); if (l < bd) { bd = l; best = d; } }
    if (best && bd > 0.3) { c.mx = (best.x - ecs.x[e]) / bd; c.mz = (best.z - ecs.z[e]) / bd; }
  }
  return { seq: ++me.seq, ...c, pt: w.tick - owt };
}

function stepPirates(w, pirates) {
  const ecs = w.ecs;
  for (const q of pirates) {
    q.samples.push({ x: ecs.x[q.e], z: ecs.z[q.e], act: ecs.act[q.e], actT: ecs.actT[q.e], dead: ecs.dead[q.e] });
    if (q.samples.length > viewDelay + 1) q.samples.shift();
  }
  for (let i = 0; i < pirates.length; i++) {
    const q = pirates[i];
    q.queue.push({ tick: w.tick + owt, cmd: command(w, q, pirates[1 - i]) });
  }
  for (const q of pirates) while (q.queue.length && q.queue[0].tick <= w.tick) w.applyCommand(q.e, q.queue.shift().cmd);
  w.stepWorld();
}
const median = (xs) => { const a = [...xs].sort((a, b) => a - b); return a.length ? (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2 : 0; };
const usable = (ev) => ev.win - RTT / 1000 - tuning.combat.interpTicks * DT;
const share = (evs) => evs.length ? evs.filter((ev) => usable(ev) >= 0.25).length / evs.length * 100 : 0;
const columns = (evs) => `${evs.length} ${share(evs).toFixed(1)}% ${Math.round(median(evs.map((ev) => ev.win)) * 1000)} ${Math.round(median(evs.map(usable)) * 1000)} ${['hit', 'block', 'perfect', 'dodge', 'mercy'].map((out) => evs.filter((ev) => ev.out === out || out === 'hit' && ev.out === 'crit').length).join('/')}`;
const n = (v, d = 1) => v.toFixed(d);
console.log(`${KITS.join(' vs ')} · LV ${LV} · gear ${RAR >= 0 ? RARITIES[RAR].name : 'none'} · skill ${SKILL} · rtt ${RTT} ms · pvp × ${LAWLESS.pvpDmg}${MOBS ? ` · with the Cala's mobs for ${SECS} s` : ''}`);

if (!MOBS) {
  console.log('run  winner        time  blows  avg  max  crits  exch tele% win use h/b/p/d/m  hp A/B   atk A/B  def A/B');
  const T = [], wins = [0, 0], exchanges = [], decisives = [], all = [];
  for (let run = 1; run <= RUNS; run++) {
    const { w, pirates } = setup(run * 977);
    const ecs = w.ecs, [a, b] = pirates;
    const blows = [], crits = [0], duels = [];
    const hp0 = pirates.map((q) => ecs.maxHp[q.e]), atk = pirates.map((q) => ecs.atk[q.e]), def = pirates.map((q) => ecs.def[q.e]);
    let winner = -1;
    const t0 = w.tick;
    while (winner < 0 && w.tick - t0 < 60 * 180) {
      stepPirates(w, pirates);
      for (const ev of w.events) {
        if (ev.type === 'duel') duels.push(ev);
        if (ev.type === 'hurt' && ev.by && ev.dmg > 0) { blows.push(ev.dmg); if (ev.crit) crits[0]++; }
        if (ev.type === 'death') winner = ev.id === a.e ? 1 : 0;
      }
      w.events.length = 0;
    }
    const time = (w.tick - t0) * DT;
    if (winner >= 0) { T.push(time); wins[winner]++; exchanges.push(duels.length); decisives.push(duels.filter((ev) => ev.dmg >= ecs.maxHp[ev.e] * 0.1).length); all.push(...duels); }
    const avg = blows.length ? blows.reduce((s, v) => s + v, 0) / blows.length : 0;
    console.log(`${String(run).padStart(3)}  ${(winner < 0 ? '— (3 min)' : `${pirates[winner].kit} (${'AB'[winner]})`).padEnd(12)} ${n(time).padStart(5)}s  ${String(blows.length).padStart(5)} ${n(avg, 0).padStart(4)} ${String(Math.max(0, ...blows)).padStart(4)}  ${String(crits[0]).padStart(5)}  ${columns(duels)}  ${hp0.join('/').padEnd(8)} ${atk.join('/').padEnd(8)} ${def.join('/')}`);
  }
  T.sort((x, y) => x - y);
  if (T.length) console.log(`falls in ${T.length}/${RUNS} · time to fall: median ${n(median(T))} s, min ${n(T[0])} s, max ${n(T[T.length - 1])} s · wins ${KITS[0]} ${wins[0]}, ${KITS[1]} ${wins[1]} · exchanges per fall ${n(median(exchanges))} · decisive exchanges per fall ${n(median(decisives))} · seconds per decisive exchange ${median(decisives) ? n(median(T) / median(decisives)) : 'n/a'} · telegraphed ${n(share(all))}% · median usable window ${Math.round(median(all.map(usable)) * 1000)} ms`);
} else {
  const { w, pirates } = setup(4242);
  const ecs = w.ecs, [a, b] = pirates;
  const isP = (e) => e === a.e || e === b.e;
  const S = { pvp: 0, byMob: 0, mobByPirate: 0, mobByMob: 0, spilt: 0, back: 0, stolen: 0, mobLoot: 0, expired: 0, ff: 0, hurtMob: 0, hurtPvp: 0 };
  const duels = [];
  const spilt = new Set(); // public drops that were a pirate's
  const t0 = w.tick;
  while (w.tick - t0 < SECS / DT) {
    stepPirates(w, pirates);
    for (const ev of w.events) {
      if (ev.type === 'duel') duels.push(ev);
      if (ev.type === 'death' && isP(ev.id)) { if (ev.by && isP(ev.by)) S.pvp++; else S.byMob++; }
      else if (ev.type === 'kill' && map.lawlessAt(ev.x, ev.z)) { if (isP(ev.by)) S.mobByPirate++; else if (ev.by) S.mobByMob++; }
      else if (ev.type === 'hurt' && isP(ev.e) && ev.dmg > 0) { if (ev.by) S.hurtPvp += ev.dmg; else S.hurtMob += ev.dmg; }
      else if (ev.type === 'spill') S.spilt += ev.n + ev.pot;
      else if (ev.type === 'loot' && ev.pub && ev.spill) for (const d of ev.drops) spilt.add(d.id);
      else if (ev.type === 'pickup' && ev.pub) { if (!spilt.has(ev.id)) S.mobLoot++; else if (ev.back) S.back++; else S.stolen++; }
      else if (ev.type === 'unloot' && ev.pub && ev.why !== 'pick') S.expired += (ev.ids || [ev.id]).length;
      else if (ev.type === 'phit' && ev.ff) S.ff++;
    }
    w.events.length = 0;
  }
  console.log(`pirate falls: ${S.pvp} to the other pirate, ${S.byMob} to the mobs · mobs down: ${S.mobByPirate} by pirates, ${S.mobByMob} by other mobs (${S.ff} bullets on each other)`);
  console.log(`life lost per pirate and minute: ${n(S.hurtMob / 2 / (SECS / 60), 0)} to the mobs, ${n(S.hurtPvp / 2 / (SECS / 60), 0)} to the other pirate`);
  console.log(`things spilt: ${S.spilt} · picked up: ${S.back} back by their owner, ${S.stolen} by the other pirate · mob loot picked up: ${S.mobLoot} · public drops left to the tide: ${S.expired}`);
  console.log(`PvP exchanges ${duels.length} · telegraphed ${n(share(duels))}% · median usable window ${Math.round(median(duels.map(usable)) * 1000)} ms`);
  for (const q of pirates) console.log(`${q.kit}: level ${ecs.level[q.e]} · worn ${Object.values(q.p.eq).filter(Boolean).length} · bag ${q.p.bag.length} · potions ${ecs.potions[q.e]} · gold ${q.p.gold} · stats ${JSON.stringify(q.p.stats)}`);
}
