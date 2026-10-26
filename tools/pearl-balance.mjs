#!/usr/bin/env node
// Deterministic M4.8 balance snapshot. It reports shared economy knobs and damage from one
// standardized ATK-sized server strike; utility and curses stay in their own fields.
import { PEARL, PEARLS } from '../src/data/pearls.js';
import { GAME } from '../src/data/meta.js';
import { World } from '../src/sim/world.js';
import { generateWorld } from '../src/sim/worldgen.js';
import { STORM_CURSE } from '../src/sim/projectiles.js';
import { installInventory, newProfile, attachProfile } from '../src/sim/systems/inventory.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

const ticksPerBurnWindow = Math.round(PEARL.burnTime * 60);

function trial(kind, cluster) {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, `pearl-balance-${kind}-${cluster ? 'cluster' : 'single'}`);
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4, facing: Math.PI / 2 });
  attachProfile(w, e, newProfile());
  const ecs = w.ecs;
  const elem = PEARLS[kind]?.elem || 0;
  ecs.elem[e] = elem;
  const first = w.debugSpawn('dummy', ecs.x[e] + 2.5, ecs.z[e], 0);
  const second = cluster ? w.debugSpawn('dummy', ecs.x[e] + 4.5, ecs.z[e], 0) : 0;
  const raw = ecs.atk[e];
  const targets = second ? [first, second] : [first];

  w.strike(first, raw, {
    by: e, kind: 'skill', skill: 'balance-sample', x: ecs.x[e], z: ecs.z[e],
    knock: 0, noCrit: true, elem, pt: w.tick,
  });
  for (let i = 0; i < ticksPerBurnWindow; i++) w.stepWorld();

  const events = w.events.filter((ev) => ev.type === 'damage' && ev.by === e);
  const dealt = Object.fromEntries(targets.map((id) => [id, 0]));
  const byKind = {};
  for (const ev of events) {
    byKind[ev.kind] = (byKind[ev.kind] || 0) + ev.dmg;
    if (Object.hasOwn(dealt, ev.id)) dealt[ev.id] += ev.dmg;
  }
  const dealtValues = Object.values(dealt).map((v) => Math.round(v * 1000) / 1000);
  return {
    rawAtk: Math.round(raw * 1000) / 1000,
    dealtPerTarget: dealtValues,
    totalDamage: Math.round(dealtValues.reduce((a, b) => a + b, 0) * 1000) / 1000,
    damageKinds: byKind,
  };
}

const chance = (base, tier) => Math.round(Math.min(1, base * (1 + PEARL.tideBonus * Math.max(0, tier - 1))) * 10000) / 10000;
const damage = Object.fromEntries([
  ['unpowered', 0], ...Object.entries(PEARLS).map(([kind, pearl]) => [kind, pearl.elem]),
].map(([kind, elem]) => [kind, {
  elem,
  single: trial(elem ? kind : '', false),
  cluster: trial(elem ? kind : '', true),
}]));

const report = {
  report: 'M4.8 pearl balance snapshot',
  seed: GAME.seed,
  assumptions: {
    damage: 'One server-side strike at the seeded player ATK, no critical, against stationary debug dummies; cluster means two targets 2 units apart. Burn is observed through the configured 3 second window.',
    scope: 'Damage is reported as simulated totals. Utility and curses are listed separately and are not converted into a score.',
  },
  circulation: {
    npcTrade: false,
    dropChance: Object.fromEntries([
      ['elite', PEARL.eliteChance], ['bossHellfire', PEARL.bossChance], ['chest', PEARL.chestChance],
    ].map(([source, base]) => [source, { tierI: chance(base, 1), tierII: chance(base, 2), tierIII: chance(base, 3) }])),
  },
  damage,
  utilities: {
    brasa: { burnSeconds: PEARL.burnTime, tickSeconds: PEARL.burnEvery, rawPerTick: '0.12 x ATK' },
    escarcha: { slowMultiplier: PEARL.chillSlow, slowSeconds: PEARL.chillTime, hitsToFreeze: PEARL.chillHits, freezeSeconds: PEARL.freezeTime, bossesFreeze: false },
    tormenta: { oneSecondaryHitMultiplier: PEARL.lightningMult, chainRange: PEARL.lightningRange, maxSecondaryTargets: 1 },
    tinta: { markSeconds: PEARL.inkMarkTime, markedFollowupMultiplier: PEARL.inkMarkMult },
  },
  curses: {
    brasa: { waterDamagePerSecondOfMaxHp: PEARL.waterDps },
    escarcha: { fireDamageMultiplier: 1.5 },
    tormenta: { projectileAttractionRange: STORM_CURSE.range, maxTurnRadiansPerSecond: STORM_CURSE.turn, maxTotalAngleRadians: STORM_CURSE.maxAngle },
    tinta: { dayPotionHealMultiplier: PEARL.inkDayHeal, nightDamageMultiplier: PEARL.inkNightMult },
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
