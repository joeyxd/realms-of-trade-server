// Release-image guards: only Node, src/ and assets/; never import three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NIAGARA_NATIVE, NATIVE_SIMULATIONS, NATIVE_MOBILE_GPU_CAP, nativeStep, nativeEndStep, nativeTextureBytes } from '../src/editor/niagaraNative.js';
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

// Header-only KTX2 reader: the formula below is the contract of the mobile 12 MiB cap (it must not trust the registry).
function ktx2Header(bytes) {
  assert.equal(bytes.subarray(0, 12).toString('latin1'), '\xabKTX 20\xbb\r\n\x1a\n');
  const u32 = at => bytes.readUInt32LE(at), dfd = u32(48);
  return { vkFormat: u32(12), width: u32(20), height: u32(24), depth: u32(28), layers: u32(32), faces: u32(36), levels: u32(40), supercompression: u32(44),
    model: bytes[dfd + 12], primaries: bytes[dfd + 13], transfer: bytes[dfd + 14] };
}
const uastcChainBytes = (w, h, levels) => Array.from({ length: levels }, (_, i) => Math.ceil(Math.max(1, w >> i) / 4) * Math.ceil(Math.max(1, h >> i) / 4) * 16).reduce((a, b) => a + b, 0);
function webpSize(bytes) { // lossless VP8L: 14-bit width-1 and height-1 right after the 0x2f signature
  assert.equal(bytes.subarray(8, 16).toString('latin1'), 'WEBPVP8L'); assert.equal(bytes[20], 0x2f);
  return [1 + (bytes[21] | (bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6 | bytes[23] << 2 | (bytes[24] & 0xf) << 10)];
}

test('mobile KTX2 UASTC set: full resolution, full mip chain, sRGB, at most 12 MiB of GPU memory per effect', () => {
  assert.equal(NATIVE_MOBILE_GPU_CAP, 12 * 1024 * 1024); assert.equal(NATIVE_MOBILE_GPU_CAP, 12582912);
  const film = JSON.parse(read(entry.files.film.url)).lut, lut = film.size ** 3 * 4 * 2; // Data3DTexture, RGBA half float
  assert.equal(lut, 262144);
  for (const [item, expected] of [[entry, 8650816], [flame, 8301344]]) {
    assert.deepEqual(Object.keys(item.mobileFiles), Object.keys(item.files).slice(2)); assert.equal(Object.isFrozen(item.mobileFiles), true);
    let total = lut;
    for (const key of Object.keys(item.mobileFiles)) {
      const file = item.mobileFiles[key], bytes = read(file.url), header = ktx2Header(bytes);
      assert.match(file.url, /\.ktx2$/); assert.equal(hash(bytes), file.sha256, file.url);
      assert.deepEqual([header.width, header.height], webpSize(read(item.files[key].url)), `${key}: same size as the desktop WebP`);
      assert.deepEqual([header.vkFormat, header.depth, header.layers, header.faces, header.supercompression], [0, 0, 0, 1, 2]);
      assert.equal(header.levels, Math.floor(Math.log2(Math.max(header.width, header.height))) + 1, `${key}: full mip chain`);
      assert.deepEqual([header.model, header.primaries, header.transfer], [166, 1, 2]); // UASTC, BT.709, sRGB
      total += uastcChainBytes(header.width, header.height, header.levels);
    }
    assert.equal(total, expected, item.id); assert.ok(total <= NATIVE_MOBILE_GPU_CAP, `${item.id} ${total}`);
  }
});

test('desktop keeps the pinned lossless WebP set, and mobile never falls back to it', () => {
  assert.deepEqual(Object.values(entry.files).map(f => [f.url, f.sha256]), [
    ['/src/render/vfx/niagara/basichit-source.json', '6388736b01d507edeeb18db23193be9ba4646185f3362332be2778d62f49950b'],
    ['/src/render/vfx/niagara/film-source.json', 'df3b1ba15eb364130e0e212ee111c7e97c00f8cbe0f4ee53cb1c71714b7174c0'],
    ['/assets/vfx/niagara/native/basichit-v1/fireball-v1.webp', 'a936de7a6b489b297893d235892010fa469a6c1f3410eefc3055e2f0cfb3a003'],
    ['/assets/vfx/niagara/native/basichit-v1/hit-circle-v1.webp', 'ec0c1aa72e55e61f4ef20c2be9f1f0aafa3a78b5341d265e34f61e117935551c']]);
  assert.deepEqual(Object.values(flame.files).map(f => [f.url, f.sha256]), [
    ['/src/render/vfx/niagara/pilot-source.json', '85b251ab3c249aed61cd5fd6be16d0ace0229f88bbd7e03c45718d9e41e472a5'],
    ['/src/render/vfx/niagara/film-source.json', 'df3b1ba15eb364130e0e212ee111c7e97c00f8cbe0f4ee53cb1c71714b7174c0'],
    ['/assets/vfx/niagara/native/flame-single-v1/flame-v1.webp', 'cc80a1d651f272f13a99f49b85a10415907a6a6b3abb138a42e27ffcba558a0d'],
    ['/assets/vfx/niagara/native/flame-single-v1/smoke-v1.webp', 'b9890532ed794b80a0501098a3a80c79b3a0da5d7ac885eccd509fdb07e61ec1']]);
  const code = read('src/render/vfx/niagara/nativeEffect.js').toString();
  assert.ok(code.includes("const mobile = quality === 'mobile';") && code.includes('if (mobile && !effect.mobileFiles) throw'));
  assert.ok(code.includes('{ ...effect.files, ...effect.mobileFiles } : effect.files'));
  // The Studio quality reaches the native effect on load and on every switch.
  const preview = read('src/render/skillPreview.js').toString();
  assert.equal(preview.split('{ quality: this.quality, renderer: this.renderer }').length, 3);
});

test('the Taller readout counts GPU bytes from the transcoded mip chain, else RGBA8 over the full generated chain', () => {
  assert.equal(nativeTextureBytes({ mipmaps: [], image: { width: 4, height: 2 } }), (8 + 2 + 1) * 4);
  assert.equal(nativeTextureBytes({ mipmaps: [], image: { width: 1, height: 1 } }), 4);
  // A UASTC chain transcoded to a 16-byte-block format (ASTC 4x4, BC7, ETC2 RGBA) is exactly the cap formula of the KTX2 test.
  const chain = (w, h, levels) => Array.from({ length: levels }, (_, i) => ({ data: { byteLength: uastcChainBytes(Math.max(1, w >> i), Math.max(1, h >> i), 1) } }));
  assert.equal(nativeTextureBytes({ mipmaps: chain(2048, 1024, 12), image: { width: 2048, height: 1024 } }), uastcChainBytes(2048, 1024, 12));
  const code = read('src/render/vfx/niagara/nativeEffect.js').toString(), studio = read('src/editor/skillStudio.js').toString();
  assert.ok(code.includes('gpuBytes: textures.reduce((sum, texture) => sum + nativeTextureBytes(texture), lut.image.data.byteLength)'));
  assert.ok(code.includes("gpuCap: mobile ? NATIVE_MOBILE_GPU_CAP : null") && code.includes("[THREE.RGBAFormat, 'RGBA8']"));
  assert.ok(studio.includes("if (load.gpuCap && load.gpuBytes > load.gpuCap) parts.push(t('overGpuCap'));"));
});
