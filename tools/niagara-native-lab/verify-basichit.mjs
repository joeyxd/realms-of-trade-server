// NS_BasicHit native simulation against basichit-reference03, plus the digest checkpoint (T-1021-03).
// Captured states are validation targets only; none is passed to BasicHitSimulation. Prints one
// deterministic JSON line and exits 1 on any failure. The default run writes nothing;
// --write-checkpoint (re)generates the checkpoint after the reference comparison passes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BasicHitSimulation, MAX_STEP, NAMES } from './basichit-simulation.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = 'tools/niagara-native-lab/basichit-source.json';
const REFERENCE = 'docs/delivery/st01c/basichit/reference-checkpoint.json';
const RUN = 'basichit-reference03';
const SCHEMA = 'st01c-basichit-simulation-checkpoint/v1';
// Same limit values as verify-native.mjs; rotation, lifetime and age must be exact.
const limits = { positionCm: .002, velocityCmPerSecond: .001, ageSeconds: .00001, alpha: .00001, rgb: .00001, subImage: .001, sizeCm: .001 };
const EXACT = ['ageSeconds', 'rotation', 'lifetimeSeconds'];
// Digest of every snapshot of steps 0..MAX_STEP, then a backwards seek that must replay identically.
const CONFIGURATIONS = { 'basichit.default': {}, 'basichit.seed0': { seed: 0 }, 'basichit.seed12345': { seed: 12345 }, 'basichit.seed65533': { seed: 65533 } };
const REPLAY_STEP = 12;

let checkpointPath = path.join(ROOT, 'docs/delivery/st01c/basichit/simulation-checkpoint.json'), write = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--checkpoint' && process.argv[i + 1]) checkpointPath = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--write-checkpoint') write = true;
  else throw new Error('Usage: node tools/niagara-native-lab/verify-basichit.mjs [--checkpoint <path>] [--write-checkpoint]');
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const relative = file => path.relative(ROOT, file).split(path.sep).join('/');

// ---------- Inputs: the versioned source; the pinned reference run (targets only).
const sourceBytes = await fs.readFile(path.join(ROOT, SOURCE));
const source = JSON.parse(sourceBytes);
const reference = JSON.parse(await fs.readFile(path.join(ROOT, REFERENCE)));
check(reference.referenceRun === RUN, 'Reference checkpoint run');
const pins = new Map(reference.referenceFiles.map(f => [f.file, f.sha256]));
async function pinned(file) {
  const bytes = await fs.readFile(path.join(ROOT, '.scratch/unreal', RUN, file));
  check(pins.has(file) && sha(bytes) === pins.get(file), 'Reference pin ' + file);
  return JSON.parse(bytes);
}
const capture = await pinned('capture-report.json');
check(capture.status === 'complete' && capture.settings.fixed_dt_seconds === 1 / 60, 'Reference capture settings');
// Seeds as the reference used them: fixtureSeedBase + handle index.
const seedBase = reference.seedConfiguration.fixtureSeedBase;
const handles = capture.seed_configuration.result.emitters;
check(JSON.stringify(handles.map(h => h.name)) === JSON.stringify(NAMES) && handles.every((h, i) => h.fixtureSeed === seedBase + i) &&
  reference.seedConfiguration.handles.every((h, i) => h.name === NAMES[i] && h.seed === seedBase + i), 'Reference seeds');

// ---------- Reference comparison: every frame, counts and uniqueId order at every step.
const metrics = e => ['positionCm', 'velocityCmPerSecond', 'sizeCm', 'rgb', 'alpha', 'rotation', 'ageSeconds', 'lifetimeSeconds', ...(e === 0 ? ['subImage'] : [])];
const rows = NAMES.map((name, e) => ({ name, seed: seedBase + e, states: 0, countMismatchSteps: [], idOrderMismatchSteps: [],
  maxErrors: Object.fromEntries(metrics(e).map(m => [m, 0])), worstStep: {} }));
const sim = new BasicHitSimulation(source, { seed: seedBase });
let frames = 0, statesCompared = 0;
for (let step = 0; step <= capture.settings.steps; step++) {
  const actual = sim.seek(step), expected = await pinned(`particles/step_${String(step).padStart(4, '0')}.json`);
  frames++;
  for (let e = 0; e < NAMES.length; e++) {
    check(expected.emitters[e].name === NAMES[e], 'Reference emitter order');
    const r = rows[e], a = actual.emitters[e].particles, b = expected.emitters[e].particles;
    if (a.length !== b.length) { r.countMismatchSteps.push(step); continue; }
    if (a.some((p, i) => p.uniqueId !== b[i].uniqueId)) { r.idOrderMismatchSteps.push(step); continue; }
    a.forEach((p, i) => {
      const q = b[i];
      r.states++; statesCompared++;
      // Fail closed: a NaN or missing native value sticks as NaN and fails its tolerance.
      const put = (metric, d) => { if (!Number.isNaN(r.maxErrors[metric]) && !(d <= r.maxErrors[metric])) { r.maxErrors[metric] = d; r.worstStep[metric] = step; } };
      q.position.forEach((v, k) => put('positionCm', Math.abs(p.position[k] - v)));
      q.velocity.forEach((v, k) => put('velocityCmPerSecond', Math.abs(p.velocity[k] - v)));
      q.size.forEach((v, k) => put('sizeCm', Math.abs(p.size[k] - v)));
      q.color.forEach((v, k) => put(k === 3 ? 'alpha' : 'rgb', Math.abs(p.color[k] - v)));
      put('rotation', Math.abs(p.rotation - q.rotation));
      put('ageSeconds', Math.abs(p.age - q.age));
      put('lifetimeSeconds', Math.abs(p.lifetime - q.lifetime));
      if (e === 0) put('subImage', Math.abs(p.subImage - q.subImage));
    });
  }
}
const liveIdsAndOrderMatch = rows.every(r => r.countMismatchSteps.length === 0 && r.idOrderMismatchSteps.length === 0);
for (const r of rows) r.withinTolerance = Object.fromEntries(Object.entries(r.maxErrors).map(([m, v]) =>
  [m, EXACT.includes(m) ? v === 0 : v <= limits[m]]));
const referencePassed = frames === 241 && liveIdsAndOrderMatch && rows.every(r => Object.values(r.withinTolerance).every(Boolean));

// ---------- Checkpoint: digests of the native snapshots.
function digest(options) {
  const s = new BasicHitSimulation(source, options), h = crypto.createHash('sha256');
  for (let step = 0; step <= MAX_STEP; step++) h.update(JSON.stringify(s.seek(step)));
  h.update(JSON.stringify(s.seek(REPLAY_STEP)));
  return h.digest('hex');
}
const digests = Object.fromEntries(Object.entries(CONFIGURATIONS).map(([name, options]) => [name, digest(options)]));
const expectedCheckpoint = { schema: SCHEMA,
  scope: 'Digests of BasicHitSimulation snapshots, steps 0..480 then seek(12); verify-basichit.mjs also compares basichit-reference03.',
  source: { file: SOURCE, sha256: sha(sourceBytes), hashing: 'sha256 of the work-tree bytes, LF (tools/niagara-native-lab/** text eol=lf)' },
  steps: MAX_STEP, replayStep: REPLAY_STEP, configurations: CONFIGURATIONS, digests };
if (write) {
  check(referencePassed, 'The reference comparison fails; checkpoint not written');
  await fs.writeFile(checkpointPath, JSON.stringify(expectedCheckpoint, null, 2) + '\n');
}
let checkpoint = null;
try { checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')); } catch { checkpoint = null; }
const checkpointMatch = JSON.stringify(checkpoint) === JSON.stringify(expectedCheckpoint);

const result = { schema: 'st01c-basichit-validation/v1', run: RUN, frames, statesCompared, capturedStatesUsedAsInputs: 0,
  liveIdsAndOrderMatch, seeds: rows.map(r => r.seed), sourceSha256: sha(sourceBytes),
  emitters: rows.map(r => ({ name: r.name, seed: r.seed, states: r.states, countMismatchSteps: r.countMismatchSteps,
    idOrderMismatchSteps: r.idOrderMismatchSteps, worstStep: r.worstStep, withinTolerance: r.withinTolerance })),
  maxErrors: Object.fromEntries(rows.map(r => [r.name, r.maxErrors])),
  tolerances: limits, exactRequired: EXACT,
  checkpoint: { file: relative(checkpointPath), written: write, match: checkpointMatch, digests },
  passed: referencePassed && checkpointMatch };
console.log(JSON.stringify(result));
process.exit(result.passed ? 0 : 1);
