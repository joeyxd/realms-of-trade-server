// Town slope survey: walks the town ground with the sim's own uphill rule and reports where a player could get stuck.
// Usage: node tools/town-slope-survey.mjs  (prints one JSON line). Also imported by tests/map-revamp.test.mjs.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { World } from '../src/sim/world.js';
import { canStand } from '../src/sim/systems/movement.js';

export const SURVEY_STEP = 0.5, SURVEY_D = 0.15;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => { const n = Math.hypot(a, b); return [a / n, b / n]; });

export function gameSeed() {
  const file = new URL('../docs/art/map-revamp/baseline-v1.json', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')).seed;
}

// Steepest uphill rate around (x, z) over 8 directions at distance d, the same ratio movement.js walkStep tests (dh / d).
export function slopeAt(map, x, z, d = SURVEY_D) {
  const h0 = map.groundAt(x, z); let worst = -Infinity;
  for (const [a, b] of DIRS) worst = Math.max(worst, (map.groundAt(x + a * d, z + b * d) - h0) / d);
  return worst;
}

// Region R: normalized town ellipse radius <= 1, u >= -132, standable for the player radius, on a 0.5-unit world grid.
export function townCells(world, step = SURVEY_STEP) {
  const map = world.map, cells = [], lim = Math.ceil(map.half);
  for (let z = -lim; z <= lim; z += step) for (let x = -lim; x <= lim; x += step) {
    const { u, v } = map.toUV(x, z);
    if (u < -132 || Math.hypot((u + 102) / 43, (v + 6) / 39) > 1) continue;
    if (canStand(world, x, z)) cells.push({ x, z, u, v });
  }
  return cells;
}

export function surveyTown(world) {
  const map = world.map, cells = townCells(world);
  let maxSlope = -Infinity, over080 = 0, over100 = 0; const all = [];
  for (const c of cells) {
    const slope = slopeAt(map, c.x, c.z);
    maxSlope = Math.max(maxSlope, slope);
    if (slope > 0.8) over080++;
    if (slope > 1.0) over100++;
    all.push({ ...c, slope, h: map.groundAt(c.x, c.z) });
  }
  const r = n => Math.round(n * 1000) / 1000;
  const worst = all.sort((a, b) => b.slope - a.slope).slice(0, 10).map(c => ({ x: r(c.x), z: r(c.z), u: r(c.u), v: r(c.v), slope: r(c.slope), h: r(c.h) }));
  return { cells: cells.length, maxSlope: r(maxSlope), over080, over100, worst };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(surveyTown(new World(gameSeed()))));
}
