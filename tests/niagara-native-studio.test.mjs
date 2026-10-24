// Release-image guards: only Node, src/ and assets/; never import three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NIAGARA_NATIVE, NATIVE_SIMULATIONS, nativeStep, nativeEndStep } from '../src/editor/niagaraNative.js';
import { buildCatalogEntry, getEffect, effectParameters, defaultEffectDocument, FLIPBOOK_PARAMETERS } from '../src/editor/effectLibrary.js';
import { cloneSkillDocument, parseSkillDocument, validateSkillDocument, MAX_SKILL_DOCUMENT_BYTES } from '../src/editor/skillDocument.js';
import { BasicHitSimulation, MAX_STEP } from '../src/render/vfx/niagara/basichit-simulation.js';
import { NativeSimulation } from '../src/render/vfx/niagara/native-simulation.js';

const entry = NIAGARA_NATIVE['niagara-97a82bae61b29237'], id = entry.id, flame = NIAGARA_NATIVE['niagara-985a431dc6c0d1ca'];
const read = path => readFileSync(new URL('../' + path.replace(/^\//, ''), import.meta.url));
const source = JSON.parse(read(entry.files.simulation.url));
const document = () => cloneSkillDocument(defaultEffectDocument(id));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('native registry binds exactly two MyProject sources, never another BasicHit or Flame Single', () => {
  assert.deepEqual(Object.keys(NIAGARA_NATIVE), ['niagara-97a82bae61b29237', 'niagara-985a431dc6c0d1ca']);
  assert.equal(Object.isFrozen(entry.files.fireball), true);
  const effect = getEffect(id);
  assert.equal(effect.ready, true); assert.equal(effect.role, 'native'); assert.equal(effect.status, 'ready');
  assert.equal(effect.adapter, 'niagara-native-v1'); assert.equal(effect.derivative, entry);
  assert.match(effect.roleLimitation, /perspective DepthFade and the mobile variant are not measured/);
  assert.equal(getEffect('niagara-c96585d01abf2a65').ready, false);
  const pilot = getEffect(flame.id);
  assert.equal(pilot.ready, true); assert.equal(pilot.role, 'native'); assert.equal(pilot.derivative, flame);
  assert.equal(pilot.adapter, 'niagara-native-v1'); assert.equal(flame.recipe, 'flame-single-v1'); assert.equal(flame.drawOrder, 'index');
  assert.equal(Object.isFrozen(flame.files.flame), true); assert.deepEqual(Object.keys(flame.files), ['simulation', 'film', 'flame', 'smoke']);
  assert.equal(flame.files.film.sha256, entry.files.film.sha256);
  assert.match(pilot.roleLimitation, /not measured/); assert.match(pilot.roleLimitation, /perspective DepthFade, the composite over the stage/);
  assert.doesNotMatch(entry.limitation ?? '', /./); assert.equal(pilot.roleLimitation, flame.limitation);
  assert.deepEqual(effectParameters(flame.id), effectParameters(id));
  assert.equal(buildCatalogEntry({ ...pilot, sources: [{ ...pilot.sources[0], project: 'SimpleMultiplayerSurvival' }] }).ready, false);
  assert.equal(buildCatalogEntry({ ...pilot, sources: [{ ...pilot.sources[0], sha256: '0'.repeat(64) }] }).ready, false);
  // The Studio picks the per-entry limitation text by key; BasicHit keeps the shared one.
  const studio = read('src/editor/skillStudio.js').toString();
  assert.ok(studio.includes(`${flame.limitKey}: [`) && studio.includes('nativeLimit: ['));
  assert.equal(entry.limitKey, undefined);
  for (const sources of [[], [...effect.sources, ...effect.sources], [{ ...effect.sources[0], sha256: '0'.repeat(64) }],
    [{ ...effect.sources[0], project: 'SimpleMultiplayerSurvival' }]]) assert.equal(buildCatalogEntry({ ...effect, sources }).ready, false);
  assert.deepEqual(effectParameters(id).slice(1), FLIPBOOK_PARAMETERS);
});

test('v3 strict presentation document round trips and rejects wrong identity, keys and values', () => {
  const base = document();
  assert.equal(base.version, 3); assert.equal(base.parameters.seed, 6371);
  assert.deepEqual(parseSkillDocument(JSON.stringify(base)), base);
  const clone = cloneSkillDocument(base); clone.parameters.seed = 0; assert.equal(base.parameters.seed, 6371);
  for (const key of Object.keys(base)) {
    const bad = { ...base }; delete bad[key]; assert.equal(validateSkillDocument(bad).ok, false, `missing ${key}`);
  }
  for (const key of Object.keys(base.parameters)) {
    const bad = document(); delete bad.parameters[key]; assert.equal(validateSkillDocument(bad).ok, false, `missing ${key}`);
  }
  for (const bad of [{ ...base, extra: true }, { ...base, schema: 'other' }, { ...base, skill: 'tromba' },
    { ...base, effect: 'unknown' }, { ...base, version: 2 },
    { ...base, effect: 'component-26e09bd0f93cb620-7x7-luma' }, { ...base, parameters: { ...base.parameters, extra: true } }]) {
    assert.equal(validateSkillDocument(bad).ok, false); assert.throws(() => cloneSkillDocument(bad));
  }
  for (const meta of effectParameters(id)) for (const value of meta.type === 'color'
    ? ['red', '#FFFFFF', '#000', null] : [meta.min - 1, meta.max + 1, NaN, Infinity, '1', ...(meta.integer ? [1.5] : [])]) {
    const bad = document(); bad.parameters[meta.key] = value;
    assert.equal(validateSkillDocument(bad).ok, false, `${meta.key}: ${value}`);
  }
  for (const seed of [0, 65533]) { const valid = document(); valid.parameters.seed = seed; assert.equal(validateSkillDocument(valid).ok, true); }
  const pilotDocument = cloneSkillDocument(defaultEffectDocument(flame.id));
  assert.equal(pilotDocument.effect, flame.id); assert.equal(pilotDocument.parameters.seed, 6371);
  assert.deepEqual(parseSkillDocument(JSON.stringify(pilotDocument)), pilotDocument);
  assert.equal(validateSkillDocument({ ...pilotDocument, effect: id }).ok, true);
  assert.throws(() => parseSkillDocument(JSON.stringify(base) + ' '.repeat(MAX_SKILL_DOCUMENT_BYTES)));
  const flipbook = defaultEffectDocument('component-26e09bd0f93cb620-7x7-luma');
  assert.equal(validateSkillDocument({ ...flipbook, version: 3 }).ok, false);
  assert.equal(validateSkillDocument(flipbook).ok, true);
});

test('native timeline maps impact, retiming and clamp without a wall clock', () => {
  assert.equal(nativeStep(.499, .5), -1); assert.equal(nativeStep(.5, .5), 0);
  assert.equal(nativeStep(.6, .5), 6);
  assert.equal(nativeStep(.6, .5, { speed: 2, duration: 1 }), 12);
  assert.equal(nativeStep(.6, .5, { speed: 1, duration: 2 }), 3);
  assert.equal(nativeStep(100, .5), MAX_STEP);
  let previous = -1;
  for (let i = 0; i < 1000; i++) { const next = nativeStep(i / 60, .5); assert.ok(next >= previous); previous = next; }
  const end = nativeEndStep(source, 6371), simulation = new BasicHitSimulation(source);
  assert.ok(end > 0 && end <= MAX_STEP);
  assert.ok(simulation.seek(end - 1).emitters.some(e => e.particles.length));
  assert.ok(simulation.seek(end).emitters.every(e => e.particles.length === 0));
  assert.equal(nativeEndStep(source, 6371), end);
  // NS_Flame_Single emits for the whole 8 s window, so it never empties first: the end is the last step.
  const flameSource = JSON.parse(read(flame.files.simulation.url)), flameSimulation = new NativeSimulation(flameSource);
  assert.equal(nativeEndStep(flameSource, 6371, 'flame-single-v1'), MAX_STEP);
  assert.ok(flameSimulation.seek(MAX_STEP).emitters.every(e => e.particles.length > 0));
  assert.throws(() => flameSimulation.seek(MAX_STEP + 1));
});

test('all runtime file pins and the measured simulation digests match', () => {
  for (const file of [...Object.values(entry.files), ...Object.values(flame.files)]) assert.equal(hash(read(file.url)), file.sha256, file.url);
  const pilotSimulation = new NativeSimulation(JSON.parse(read(flame.files.simulation.url))), pilotDigest = createHash('sha256');
  for (let step = 0; step <= MAX_STEP; step++) pilotDigest.update(JSON.stringify(pilotSimulation.seek(step)));
  pilotDigest.update(JSON.stringify(pilotSimulation.seek(12)));
  assert.equal(pilotDigest.digest('hex'), flame.simulationDigest);
  assert.equal(flame.sourceSha256, JSON.parse(read(flame.files.simulation.url)).sourceSha256);
  const simulation = new BasicHitSimulation(source), digest = createHash('sha256');
  for (let step = 0; step <= MAX_STEP; step++) digest.update(JSON.stringify(simulation.seek(step)));
  digest.update(JSON.stringify(simulation.seek(12)));
  assert.equal(digest.digest('hex'), entry.simulationDigest);
  const checkpoint = new URL('../docs/delivery/st01c/basichit/simulation-checkpoint.json', import.meta.url);
  if (existsSync(checkpoint)) assert.equal(JSON.parse(readFileSync(checkpoint)).digests['basichit.default'], entry.simulationDigest);
});

test('composite derives the complete lab transfer, with checked single anchors', () => {
  const film = read('src/render/vfx/niagara/film-color.js').toString().match(/export const filmFragment = `([\s\S]*?)`;/)[1];
  const code = read('src/render/vfx/niagara/nativeEffect.js').toString();
  const derivation = code.slice(code.indexOf('function replaceOnce'), code.indexOf('export class')).replace('export const', 'const');
  const fragment = new Function('filmFragment', derivation + '\nreturn nativeCompositeFragment;')(film);
  assert.equal(fragment.replace(' uniform vec3 tintColor; uniform float opacity;', '').replace(' * tintColor', '')
    .replace('opacity * texture(filmLUT,coords).rgb*1.05, opacity * texture(image,vUv).a', 'texture(filmLUT,coords).rgb*1.05,1.0'), film);
  assert.throws(() => new Function('filmFragment', derivation)(film.replace('uniform float exposure;', '')), /anchor changed/);
});

test('every registered recipe has a measured simulation and a render binding, and the pilot depth opt-in is explicit', () => {
  const code = read('src/render/vfx/niagara/nativeEffect.js').toString();
  const bound = [...code.matchAll(/^\s+'([a-z0-9-]+)': \{ textures: (\d), counts: (\d)/gm)].map(m => [m[1], +m[2], +m[3]]);
  assert.deepEqual(bound, [['basichit-v1', 2, 3], ['flame-single-v1', 2, 2]]);
  for (const item of Object.values(NIAGARA_NATIVE)) {
    assert.ok(NATIVE_SIMULATIONS[item.recipe], item.recipe);
    assert.equal(Object.keys(item.files).length, 2 + bound.find(b => b[0] === item.recipe)[1]);
  }
  assert.deepEqual(Object.keys(NATIVE_SIMULATIONS), Object.values(NIAGARA_NATIVE).map(item => item.recipe));
  assert.match(read('src/render/vfx/niagara/particles.js').toString(), /setDepth\(texture, camera, width, height, enabled, \{ perspective = false \} = \{\}\)/);
});
