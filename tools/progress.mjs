// Headless progression playtest (balance, PLAN-M4.md P8): the scripted player of tools/botbrain.mjs with a real
// profile does La Prueba de Fuego again and again. After each win it opens its chest, walks over its drops, wears
// whatever scores better (same kit: mastery is per weapon), breaks the rest and climbs to the highest Marea it has
// opened. God mode, but every hit is counted after its defence (how much of your life a run costs).
// Usage: RUNS=8 LV=5 SKILL=0.8 [WEAPON=pistolas] [TIER=climb|1|2|3] node tools/progress.mjs
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { GAME } from '../src/data/meta.js';
import { DT } from '../src/data/tuning.js';
import { C } from '../src/sim/ecs.js';
import { weaponIndex, WEAPON_KINDS } from '../src/data/weapons.js';
import { BASES, RARITIES } from '../src/data/items.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { installInventory, newProfile, attachProfile, openChest, stepDrops, equipItem, salvageItem } from '../src/sim/systems/inventory.js';
import { itemScore } from '../src/sim/items.js';
import { masteryOf } from '../src/sim/systems/stats.js';
import { mitigate } from '../src/sim/systems/combat.js';
import { makeBrain } from './botbrain.mjs';

const RUNS = +(process.env.RUNS || 8), LV = +(process.env.LV || 5), SKILL = +(process.env.SKILL || 0.8);
const WEAPON = process.env.WEAPON || 'sable', TIER = process.env.TIER || 'climb';
const map = generateWorld(GAME.seed);
const w = new World(GAME.seed, { map, server: true });
installInventory(w);
w.populate();
const enc = w.encounters[0], ecs = w.ecs, H = w.hazards;
const e = w.spawnPlayer({ x: enc.cx, z: enc.cz, level: LV, weapon: weaponIndex(WEAPON) });
const p = newProfile({ weapon: weaponIndex(WEAPON) });
p.lvl = LV;
attachProfile(w, e, p);
ecs.god[e] = 1;
const brain = makeBrain({ weapon: WEAPON, skill: SKILL });
// Every XP point (also past the level cap: it still feeds the mastery).
let xpRun = 0;
const onXp = w.onXp;
w.onXp = (pl, n, sq) => { if (pl === e) xpRun += n; return onXp(pl, n, sq); };
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
const idle = () => ({ seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e], az: ecs.z[e], btn: 0, prs: 0, pt: w.tick });
let got = [0, 0, 0, 0, 0];
const step = (cmd) => {
  w.applyCommand(e, cmd || idle()); w.stepWorld();
  const evs = w.events.slice(); w.events.length = 0;
  for (const ev of evs) if (ev.type === 'pickup' && ev.e === e && ev.item) got[ev.item.r]++;
  return evs;
};
const to = (x, z) => { ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z); };
const kit = () => WEAPON_KINDS[ecs.weapon[e]];
const gearScore = () => Object.values(p.eq).reduce((s, it) => s + (it ? itemScore(it) : 0), 0);

console.log(`${WEAPON} · LV ${LV} · skill ${SKILL} · Marea ${TIER}`);
console.log('run  marea      time  life%    xp  lvl  M   atk def   hp   gold (+run)  items c/u/r/e/l  score');
const T = ENCOUNTERS.caldera.tiers;
for (let run = 1; run <= RUNS; run++) {
  // Pick the Marea, skip the 40 s rest between trials, stand on the runes.
  p.flags.tierSel = TIER === 'climb' ? p.flags.tier : Math.min(+TIER, p.flags.tier);
  enc.cool = 0;
  to(enc.cx, enc.cz);
  ecs.hp[e] = ecs.maxHp[e];
  const t0 = w.tick;
  got = [0, 0, 0, 0, 0]; xpRun = 0;
  let hurt = 0, tier = 0, end = 0;
  const gold0 = p.gold;
  while (!end && w.tick - t0 < 60 * 900) {
    for (const ev of step(policy())) {
      if (ev.type === 'hurt' && ev.e === e) hurt += mitigate(ev.raw, ecs.def[e]);
      else if (ev.type === 'enc' && ev.st === 'intro') tier = ev.tier || enc.tier || 1;
      else if (ev.type === 'enc' && ev.st === 'victory') end = 1;
    }
  }
  const time = (w.tick - t0) * DT;
  if (!end) { console.log(`run ${run}: no victory in ${time.toFixed(0)} s`); break; }
  // The chest, then every drop of yours (walk over it; the bag may fill).
  for (let k = 0; k < 120; k++) step();
  for (const d of [...w.drops.values()]) if (d.to === e && d.kind === 'chest') { to(d.x, d.z); openChest(w, e, d.id); }
  for (let k = 0; k < 60; k++) step();
  for (const d of [...w.drops.values()]) {
    if (d.to !== e || d.kind === 'chest') continue;
    to(d.x, d.z);
    for (let k = 0; k < 3; k++) { step(); stepDrops(w); }
  }
  // Wear what scores better (rings: against the weaker one), break the rest.
  for (const it of [...p.bag].sort((a, b) => itemScore(b) - itemScore(a))) {
    const B = BASES[it.b];
    if (B.slot === 'weapon' && B.weapon !== kit()) continue;
    const slot = B.slot === 'ring' ? (!p.eq.ring1 ? 'ring1' : !p.eq.ring2 ? 'ring2' : itemScore(p.eq.ring1) <= itemScore(p.eq.ring2) ? 'ring1' : 'ring2') : B.slot;
    if (!p.eq[slot] || itemScore(it) > itemScore(p.eq[slot])) equipItem(w, e, it.u, slot);
  }
  for (const it of [...p.bag]) salvageItem(w, e, it.u);
  w.events.length = 0;
  const life = Math.round((hurt / ecs.maxHp[e]) * 100);
  console.log(`${String(run).padStart(3)}  ${T[tier - 1].name.padEnd(9)} ${time.toFixed(0).padStart(4)}s ${String(life).padStart(5)}% ${String(Math.round(xpRun)).padStart(5)}  ${String(ecs.level[e]).padStart(3)}  ${String(masteryOf(ecs, e)).padStart(2)}  ${String(ecs.atk[e]).padStart(4)} ${String(ecs.def[e]).padStart(3)} ${String(ecs.maxHp[e]).padStart(4)}  ${String(p.gold).padStart(5)} (+${p.gold - gold0})`.padEnd(78) + `${got.join('/').padEnd(16)} ${gearScore().toFixed(0)}`);
}
console.log('worn:', Object.entries(p.eq).map(([k, it]) => `${k} ${it ? `${BASES[it.b].name} ${RARITIES[it.r].name} nv${it.l}` : '—'}`).join(' · '));
console.log('stats', JSON.stringify(p.stats), 'mastery', JSON.stringify(p.mast));
