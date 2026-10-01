// M2.5 «La Prueba de Fuego» (PLAN-M2.5.md): new patterns, melee minions, bounces, dodges, the encounter
// and the Hellfire boss, on the pure sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { Hazards, emitPattern, patternCount, patternSpan, PTYPE } from '../src/sim/projectiles.js';
import { DT } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena;

test('multi-arm spirals and staggered rings expand identically on server and client', () => {
  const pats = [
    { pat: 'spiral', arms: 4, n: 48, gap: 0.05, spread: 9, ptype: 'parry' },
    { pat: 'rings', n: 16, waves: 3, gap: 0.45, spread: 11.25, alt: 1, ptype: 'parry' },
    { pat: 'ring', n: 12, alt: 1, ptype: 'parry' },
  ];
  for (const p of pats) {
    const ev = { pid0: 100, tick: 50, src: 7, speed: 6, dmg: 8, x: A.x, y: 1.2, z: A.z, ang: 0.3, slope: 0, ...p };
    const a = new Hazards(), b = new Hazards();
    assert.equal(emitPattern(a, ev, map), patternCount(ev));
    emitPattern(b, JSON.parse(JSON.stringify(ev)), map); // the client gets it through the wire
    const n = patternCount(ev);
    assert.equal(a.count, n);
    const t = 50 + Math.round(patternSpan(ev) / DT) + 20;
    const types = new Set(), angles = new Set();
    for (let k = 0; k < n; k++) {
      const sa = a.slot.get(100 + k), sb = b.slot.get(100 + k);
      assert.ok(sa !== undefined && sb !== undefined);
      assert.equal(a.t0[sa], b.t0[sb]);
      assert.equal(a.px(sa, t), b.px(sb, t));
      assert.equal(a.pz(sa, t), b.pz(sb, t));
      types.add(a.type[sa]);
      angles.add(Math.round(Math.atan2(a.vx[sa], a.vz[sa]) * 1000));
    }
    if (p.alt) assert.deepEqual([...types].sort(), [PTYPE.PARRY, PTYPE.UNSTOP]);
    assert.ok(angles.size >= n * 0.6, `${p.pat}: shots go in many directions`);
  }
  // Timing: the 4-arm spiral fires 4 at a time, 12 steps 0.05 s apart; 3 rings 0.45 s apart.
  assert.equal(patternSpan({ pat: 'spiral', arms: 4, n: 48, gap: 0.05 }).toFixed(2), '0.55');
  assert.equal(patternSpan({ pat: 'rings', n: 16, waves: 3, gap: 0.45 }).toFixed(2), '0.90');
  assert.equal(patternCount({ pat: 'rings', n: 16, waves: 3 }), 48);
});
