import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  EFFECT_LIBRARY, filterEffects, getEffect, defaultEffectDocument, effectParameters, buildCatalogEntry,
} from '../src/editor/effectLibrary.js';
import { NIAGARA_CATALOG } from '../src/editor/niagaraCatalog.js';
import { NIAGARA_COMPONENT_LIBRARY, NIAGARA_DERIVATIVES } from '../src/editor/niagaraDerivatives.js';
const WATER_COMPONENT_ID = 'component-26e09bd0f93cb620-7x7-luma';
import {
  cloneSkillDocument, DEFAULT_SKILL_DOCUMENT, MAX_SKILL_DOCUMENT_BYTES, parseSkillDocument, validateFlipbookDocument, validateSkillDocument,
} from '../src/editor/skillDocument.js';

test('catalog groups duplicate source packages under one stable effect and searches its aliases', () => {
  const aliases = EFFECT_LIBRARY.find((effect) => effect.sources.length > 1);
  assert.ok(aliases, 'census includes grouped exact duplicates');
  assert.equal(new Set(EFFECT_LIBRARY.map((effect) => effect.id)).size, EFFECT_LIBRARY.length);
  const aliasPackage = aliases.sources.at(-1).package.split('/').at(-1);
  assert.ok(filterEffects({ query: aliasPackage }).some((effect) => effect.id === aliases.id));
  assert.ok(filterEffects({ query: aliases.sources.at(-1).project }).some((effect) => effect.id === aliases.id));
});

test('library retains complete census and keeps reviewed components separate from their full systems', () => {
  assert.equal(new Set(NIAGARA_CATALOG.map((item) => item.id)).size, NIAGARA_CATALOG.length);
  const catalogSources = NIAGARA_CATALOG.reduce((count, item) => count + item.sources.length, 0);
  assert.equal(EFFECT_LIBRARY.length, NIAGARA_CATALOG.length + NIAGARA_COMPONENT_LIBRARY.length + 1);
  assert.equal(NIAGARA_CATALOG.reduce((count, item) => count + getEffect(item.id).sources.length, 0), catalogSources);
  for (const item of NIAGARA_CATALOG) {
    const libraryEntry = getEffect(item.id);
    assert.ok(libraryEntry, `catalog entry ${item.id} is present`);
    assert.deepEqual(libraryEntry.sources, item.sources, `all source aliases survive for ${item.id}`);
    assert.notEqual(libraryEntry.role, 'source-texture', 'shared components do not become whole system adaptations');
  }

  const derivativeIds = Object.keys(NIAGARA_DERIVATIVES);
  assert.ok(derivativeIds.length >= 1, 'reviewed derivatives are registered');
  for (const id of derivativeIds) {
    const registered = getEffect(id);
    assert.equal(registered?.ready, true, `registered derivative resolves: ${id}`);
    for (const url of Object.values(registered.derivative.atlas)) assert.equal(existsSync(`.${url}`), true, `packaged atlas exists: ${url}`);
  }
  const effect = getEffect(WATER_COMPONENT_ID);
  assert.ok(effect);
  assert.equal(effect.ready, true);
  assert.equal(effect.status, 'texture');
  assert.equal(effect.role, 'source-texture');
  assert.equal(effect.derivative.frames, 49);
  assert.equal(getEffect('niagara-104efce88caa3644').ready, false, 'a source component does not convert its complete Niagara system');
  assert.equal(new Set(effect.sourceSystems.map(source => source.id)).size, 1);
  assert.ok(filterEffects({ query: 'NS_Spline_WaterSplash' }).some(item => item.id === effect.id));
  for (const component of NIAGARA_COMPONENT_LIBRARY) for (const binding of component.sourceSystems) {
    const system = getEffect(binding.id);
    assert.ok(system.sources.some(source => source.sha256 === binding.systemSha256 && source.package === binding.package));
    assert.ok(binding.rendererPath.startsWith(`${binding.package}.${binding.package.split('/').at(-1)}:`));
    assert.equal(binding.texturePackage, component.sources[0].package);
  }
  for (const url of Object.values(effect.derivative.atlas)) assert.equal(existsSync(`.${url}`), true, `packaged atlas exists: ${url}`);
  assert.deepEqual(defaultEffectDocument(effect.id), {
    schema: 'marea.skill-presentation', version: 2, skill: 'preview', effect: effect.id,
    parameters: { scale: 1, height: 1, duration: 1, speed: 1, brightness: 1, opacity: 1, tint: '#ffffff' },
  });

  const document = defaultEffectDocument(effect.id);
  assert.deepEqual(validateSkillDocument(document), { ok: true });
  assert.deepEqual(parseSkillDocument(JSON.stringify(document)), document);
  assert.throws(() => parseSkillDocument(`${JSON.stringify(document)}${' '.repeat(MAX_SKILL_DOCUMENT_BYTES)}`), /Invalid skill document/);
  assert.equal(validateSkillDocument({ ...document, parameters: { ...document.parameters, density: 1 } }).ok, false);
  assert.equal(validateSkillDocument({ ...document, texture: '/outside.png' }).ok, false);
  assert.equal(validateSkillDocument({ ...document, parameters: { ...document.parameters, unknown: 1 } }).ok, false);
  const activeDraft = cloneSkillDocument(document), savedDraft = cloneSkillDocument(document);
  activeDraft.parameters.scale = 1.4;
  assert.equal(savedDraft.parameters.scale, 1, 'active and saved document copies remain independent');
});

test('catalog filters by normalized text, category, project, and explicit readiness', () => {
  const candidate = EFFECT_LIBRARY.find((effect) => effect.status === 'reference');
  assert.ok(candidate);
  assert.ok(filterEffects({ query: candidate.name.slice(0, 5).toLowerCase() }).some((effect) => effect.id === candidate.id));
  assert.ok(filterEffects({ category: candidate.category }).some((effect) => effect.id === candidate.id));
  assert.ok(filterEffects({ project: candidate.sources[0].project }).some((effect) => effect.id === candidate.id));
  assert.ok(filterEffects({ status: 'reference' }).every((effect) => effect.status === 'reference'));
  assert.ok(filterEffects({ status: 'ready' }).some((effect) => effect.id === DEFAULT_SKILL_DOCUMENT.effect));
  assert.equal(getEffect('missing-effect'), null);
  assert.equal(defaultEffectDocument(candidate.id), null, 'identified sources do not become playable by selection');
  assert.deepEqual(effectParameters(candidate.id), []);
  assert.ok(filterEffects({ query: candidate.sources[0].sha256.slice(0, 12) }).some(effect => effect.id === candidate.id));
  const numeric = [{ id: 'has-zero-0', name: 'Other', sources: [{ sha256: '0'.repeat(64) }] },
    { id: 'digit', name: '0', sources: [] }];
  assert.deepEqual(filterEffects({ query: '0' }, numeric).map(effect => effect.name), ['0'], 'short numeric names do not match every source hash');
});

test('source-texture flipbooks are playable but remain distinct from reviewed system captures', () => {
  const item = { id: 'water-splash-texture', name: 'Water Splash', category: 'water', family: 'splash',
    sources: [{ project: 'WaterWorld', package: '/Game/VFX/WaterSplash' }], evidence: { method: '64-cell SubUV texture' } };
  const derivative = { adapter: 'flipbook-v1', role: 'source-texture',
    atlas: { desktop: '/assets/vfx/niagara/water-splash-texture-desktop.webp', mobile: '/assets/vfx/niagara/water-splash-texture-mobile.webp' },
    columns: 8, rows: 8, frames: 64, duration: 2, width: 6, height: 6, blend: 'alpha' };
  const texture = buildCatalogEntry(item, derivative);
  assert.equal(texture.ready, true, 'registered flipbook can play and accept visual parameters');
  assert.equal(texture.status, 'texture', 'source texture is not mislabeled as a reviewed Niagara system');
  assert.equal(texture.role, 'source-texture');
  assert.match(texture.roleLimitation, /full Niagara system.*remain pending/i);
  const document = { schema: 'marea.skill-presentation', version: 2, skill: 'preview', effect: texture.id,
    parameters: { scale: 1, height: 1, duration: 1, speed: 1, brightness: 1, opacity: 1, tint: '#ffffff' } };
  assert.deepEqual(validateFlipbookDocument(document, texture), { ok: true });
  assert.deepEqual(filterEffects({ status: 'texture' }, [texture]), [texture]);
  assert.deepEqual(filterEffects({ status: 'ready' }, [texture]), []);

  for (const role of ['system-capture', 'recreated']) {
    const reviewed = buildCatalogEntry(item, { ...derivative, role });
    assert.equal(reviewed.status, 'ready');
    assert.equal(reviewed.ready, true);
    assert.ok(reviewed.roleLimitation);
  }
  for (const unrecognized of [
    { ...derivative, role: 'unknown-role' },
    Object.fromEntries(Object.entries(derivative).filter(([key]) => key !== 'role')),
  ]) {
    const rejected = buildCatalogEntry(item, unrecognized);
    assert.equal(rejected.ready, false, 'unknown or missing representation role cannot register as playable');
    assert.equal(rejected.status, 'reference');
    assert.equal(rejected.role, 'unreviewed-source');
  }
});

test('v2 flipbook documents require an exact ready registered adapter and bounded fields', () => {
  const effect = { id: 'test-flipbook', ready: true, adapter: 'flipbook-v1' };
  const base = { schema: 'marea.skill-presentation', version: 2, skill: 'preview', effect: effect.id,
    parameters: { scale: 1, height: 1, duration: 1, speed: 1, brightness: 1, opacity: 1, tint: '#ffffff' } };
  assert.deepEqual(validateFlipbookDocument(base, effect), { ok: true });
  assert.equal(validateFlipbookDocument({ ...base, parameters: { ...base.parameters, opacity: 1.01 } }, effect).why, 'range');
  assert.equal(validateFlipbookDocument({ ...base, parameters: { ...base.parameters, tint: '#FFFFFF' } }, effect).why, 'color');
  assert.equal(validateFlipbookDocument({ ...base, parameters: { ...base.parameters, shader: 'arbitrary' } }, effect).why, 'parameters');
  assert.equal(validateFlipbookDocument({ ...base, texture: '/arbitrary.png' }, effect).why, 'shape');
  assert.equal(validateFlipbookDocument(base, { ...effect, ready: false }).why, 'effect');
  assert.equal(validateFlipbookDocument(base, { ...effect, adapter: 'unknown' }).why, 'effect');
  assert.equal(validateSkillDocument({ ...base, effect: 'unregistered' }).ok, false);
});

test('shared source atlases require identical pixels and an exact renderer owner binding', () => {
  const ownerId = WATER_COMPONENT_ID;
  const owner = NIAGARA_DERIVATIVES[ownerId];
  const packageName = '/Game/Other/NS_Bound';
  const sourceHash = 'a'.repeat(64);
  const item = { id: `niagara-${sourceHash.slice(0, 16)}`, name: 'Bound component',
    sources: [{ package: packageName, sha256: sourceHash }] };
  const derivative = { ...owner, atlasId: ownerId, sourceBinding: {
    systemSha256: sourceHash, rendererPath: `${packageName}.NS_Bound:Emitter.Renderer`,
    materialPackage: '/Game/Materials/MI_Bound', texturePackage: '/Game/Textures/T_WaterSplash',
  } };
  assert.equal(buildCatalogEntry(item, derivative).ready, true);
  for (const bad of [
    { ...derivative, component: { ...owner.component, textureSha256: 'b'.repeat(64) } },
    { ...derivative, component: { ...owner.component, rows: 8 } },
    { ...derivative, component: { ...owner.component, mapping: 'original-rgba' } },
    { ...derivative, frames: 48 },
    { ...derivative, role: 'system-capture' },
    { ...derivative, sourceBinding: null },
    { ...derivative, sourceBinding: { ...derivative.sourceBinding, systemSha256: 'c'.repeat(64) } },
    { ...derivative, sourceBinding: { ...derivative.sourceBinding,
      rendererPath: '/Game/Other/NS_Bound_02.NS_Bound_02:Emitter.Renderer' } },
  ]) assert.equal(buildCatalogEntry(item, bad).ready, false, 'unrelated or altered alias remains pending');
});

test('Tromba v1 remains unchanged and effect document clones do not share draft parameters', () => {
  assert.deepEqual(DEFAULT_SKILL_DOCUMENT, {
    schema: 'marea.skill-presentation', version: 1, skill: 'tromba', effect: 'tromba-current-v1',
    parameters: { scale: 1, height: 1, duration: 1, density: 1, spread: 1, speed: 1, brightness: 1, deep: '#1f86c0', foam: '#dff7ff' },
  });
  const trombaDraft = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
  const trombaOriginal = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
  trombaDraft.parameters.scale = 1.25;
  assert.equal(trombaOriginal.parameters.scale, 1);
  assert.equal(trombaDraft.effect, trombaOriginal.effect);
  assert.equal(validateSkillDocument(trombaDraft).ok, true);
});
