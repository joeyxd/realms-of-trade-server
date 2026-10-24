import { NIAGARA_CATALOG } from './niagaraCatalog.js';
import { NIAGARA_NATIVE } from './niagaraNative.js';
import { NIAGARA_COMPONENT_ATLASES, NIAGARA_COMPONENT_LIBRARY, NIAGARA_DERIVATIVES } from './niagaraDerivatives.js';

const TROMBA_ID = 'tromba-current-v1';
const ROLE_DETAILS = Object.freeze({
  'source-texture': Object.freeze({
    status: 'texture',
    limitation: 'Animated source-atlas component is playable; full Niagara system timing and behavior remain pending.',
  }),
  'system-capture': Object.freeze({
    status: 'ready',
    limitation: 'Captured system output is represented by a reviewed browser adapter; this is not live Niagara simulation.',
  }),
  recreated: Object.freeze({
    status: 'ready',
    limitation: 'Browser recreation is reviewed; it is not the original Niagara runtime.',
  }),
});
const TROMBA_PARAMETERS = Object.freeze([
  Object.freeze({ key: 'scale', min: 0.5, max: 1.5, step: 0.01, default: 1 }),
  Object.freeze({ key: 'height', min: 0.5, max: 1.75, step: 0.01, default: 1 }),
  Object.freeze({ key: 'duration', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'density', min: 0, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'spread', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'speed', min: 0.5, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'brightness', min: 0.5, max: 1.5, step: 0.01, default: 1 }),
  Object.freeze({ key: 'deep', type: 'color', default: '#1f86c0' }),
  Object.freeze({ key: 'foam', type: 'color', default: '#dff7ff' }),
]);
export const FLIPBOOK_PARAMETERS = Object.freeze([
  Object.freeze({ key: 'scale', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'height', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'duration', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'speed', min: 0.25, max: 3, step: 0.01, default: 1 }),
  Object.freeze({ key: 'brightness', min: 0.25, max: 2, step: 0.01, default: 1 }),
  Object.freeze({ key: 'opacity', min: 0, max: 1, step: 0.01, default: 1 }),
  Object.freeze({ key: 'tint', type: 'color', default: '#ffffff' }),
]);

const NATIVE_PARAMETERS = Object.freeze([Object.freeze({ key: 'seed', min: 0, max: 65533, step: 1, default: 6371, integer: true }), ...FLIPBOOK_PARAMETERS]);
function text(value) { return typeof value === 'string' ? value : ''; }
function sourceProject(source) { return text(source?.project); }
function sameSourceComponent(a, b) {
  return /^[0-9a-f]{64}$/.test(a?.textureSha256 || '')
    && a.textureSha256 === b?.textureSha256
    && Number.isInteger(a.columns) && a.columns > 0 && a.columns === b.columns
    && Number.isInteger(a.rows) && a.rows > 0 && a.rows === b.rows
    && ['original-rgba', 'original-alpha-to-white', 'luminance-to-white-alpha'].includes(a.mapping)
    && a.mapping === b.mapping;
}
function hasAtlas(derivative) {
  if (!derivative || derivative.adapter !== 'flipbook-v1' || !ROLE_DETAILS[derivative.role] || !derivative.atlas) return false;
  const { desktop, mobile } = derivative.atlas;
  const atlasId = derivative.atlasId ?? derivative.id;
  // A shared component must retain the reviewed owner's pixel interpretation and geometry.
  // Unrelated source identities cannot borrow a registered atlas merely by naming its ID.
  if (atlasId !== derivative.id) {
    const owner = NIAGARA_COMPONENT_ATLASES[atlasId] || NIAGARA_DERIVATIVES[atlasId];
    if (!owner || derivative.role !== 'source-texture' || owner.role !== 'source-texture'
      || (owner.atlasId && owner.atlasId !== atlasId)
      || !sameSourceComponent(derivative.component, owner.component)
      || ['adapter', 'columns', 'rows', 'frames', 'duration', 'width', 'height', 'blend']
        .some(key => derivative[key] !== owner[key])) return false;
  }
  return desktop === `/assets/vfx/niagara/${atlasId}-desktop.webp`
    && mobile === `/assets/vfx/niagara/${atlasId}-mobile.webp`
    && Number.isInteger(derivative.columns) && derivative.columns > 0 && derivative.columns <= 8
    && Number.isInteger(derivative.rows) && derivative.rows > 0 && derivative.rows <= 8
    && Number.isInteger(derivative.frames) && derivative.frames > 0 && derivative.frames <= derivative.columns * derivative.rows
    && Number.isFinite(derivative.duration) && derivative.duration > 0 && derivative.duration <= 20
    && Number.isFinite(derivative.width) && derivative.width > 0 && derivative.width <= 100
    && Number.isFinite(derivative.height) && derivative.height > 0 && derivative.height <= 100
    && ['alpha', 'additive'].includes(derivative.blend);
}

const tromba = Object.freeze({
  id: TROMBA_ID, name: 'Tromba', category: 'current', family: 'water',
  sources: Object.freeze([]), status: 'ready', role: 'current-effect', imported: true, ready: true,
  adapter: 'tromba-v1', reason: '', evidence: 'Current in-game Three.js effect',
});

export function buildCatalogEntry(item, rawDerivative = NIAGARA_DERIVATIVES[item.id]) {
  const native = NIAGARA_NATIVE[item.id];
  if (native && item.sources?.length === 1 && item.sources[0].sha256 === native.sourceSha256 && item.sources[0].project === native.project) {
    return Object.freeze({ ...item, sources: Object.freeze(item.sources.map(s => Object.freeze({ ...s }))),
      role: 'native', status: 'ready', ready: true, adapter: native.adapter, derivative: native,
      roleLimitation: 'Native browser port of the Niagara system, measured against UE 5.8 under a controlled color profile; presentation controls, the perspective DepthFade and the mobile variant are not measured.',
      imported: false, catalogued: true, reason: '' });
  }
  const derivative = rawDerivative ? Object.freeze({ ...rawDerivative, id: item.id,
    atlas: Object.freeze({ ...rawDerivative.atlas }),
    ...(rawDerivative.component && { component: Object.freeze({ ...rawDerivative.component }) }),
    ...(rawDerivative.sourceBinding && { sourceBinding: Object.freeze({ ...rawDerivative.sourceBinding }) }),
  }) : null;
  const shared = derivative?.atlasId && derivative.atlasId !== item.id;
  const binding = derivative?.sourceBinding;
  const boundSource = shared && item.sources?.find(source => source.sha256 === binding?.systemSha256);
  const prefix = boundSource && `${boundSource.package}.${boundSource.package.split('/').at(-1)}:`;
  const ready = Boolean(hasAtlas(derivative) && (!shared || (prefix
    && text(binding.rendererPath).startsWith(prefix)
    && text(binding.materialPackage).startsWith('/Game/')
    && text(binding.texturePackage).startsWith('/Game/'))));
  const role = ready ? derivative.role : 'unreviewed-source';
  const roleDetails = ROLE_DETAILS[role] || null;
  const markerOnly = item.evidence?.method === 'literal class-name marker in source .uasset bytes; package class not loaded';
  return Object.freeze({
    ...item, evidence: item.evidence && typeof item.evidence === 'object' ? Object.freeze({ ...item.evidence }) : item.evidence,
    sources: Object.freeze((Array.isArray(item.sources) ? item.sources : []).map((source) => Object.freeze({ ...source }))),
    sourceSystems: Object.freeze((Array.isArray(item.sourceSystems) ? item.sourceSystems : []).map((source) => Object.freeze({ ...source }))),
    category: text(item.category).replace(/^\s*\/\s*/, ''), status: ready ? (roleDetails?.status || 'ready') : markerOnly ? 'candidate' : 'reference', role, roleLimitation: roleDetails?.limitation || '', imported: false, catalogued: true, ready,
    adapter: ready ? derivative.adapter : null, derivative: ready ? derivative : null,
    reason: ready ? '' : (markerOnly
      ? 'Candidate: a source byte marker was found; Unreal did not confirm its package class.'
      : text(item.evidence?.method) || 'Source identified; browser adaptation has not been reviewed.'),
  });
}

// A shared smoke texture is one component, not eighteen converted Niagara systems.
const catalogEntries = [...NIAGARA_CATALOG, ...NIAGARA_COMPONENT_LIBRARY].map((item) => buildCatalogEntry(item));
catalogEntries.sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
export const EFFECT_LIBRARY = Object.freeze([tromba, ...catalogEntries]);
const byId = new Map(EFFECT_LIBRARY.map((effect) => [effect.id, effect]));

export function getEffect(id) { return byId.get(id) ?? null; }
export function effectParameters(effectId) {
  const effect = getEffect(effectId);
  if (!effect?.ready) return Object.freeze([]);
  return effect.id === TROMBA_ID ? TROMBA_PARAMETERS : effect.adapter === 'niagara-native-v1' ? NATIVE_PARAMETERS : FLIPBOOK_PARAMETERS;
}
export function defaultEffectDocument(effectId) {
  const effect = getEffect(effectId);
  if (!effect?.ready) return null;
  if (effect.id === TROMBA_ID) return Object.freeze({
    schema: 'marea.skill-presentation', version: 1, skill: 'tromba', effect: TROMBA_ID,
    parameters: Object.freeze({ scale: 1, height: 1, duration: 1, density: 1, spread: 1, speed: 1, brightness: 1, deep: '#1f86c0', foam: '#dff7ff' }),
  });
  return Object.freeze({
    schema: 'marea.skill-presentation', version: effect.adapter === 'niagara-native-v1' ? 3 : 2, skill: 'preview', effect: effect.id,
    parameters: Object.freeze(Object.fromEntries(effectParameters(effect.id).map(({ key, default: value }) => [key, value]))),
  });
}

export function filterEffects({ query = '', category = '', project = '', status = '' } = {}, effects = EFFECT_LIBRARY) {
  const normalize = (value) => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const needle = normalize(query).trim();
  return effects.filter((effect) => {
    if (category && effect.category !== category && effect.family !== category) return false;
    if (project && !effect.sources.some((source) => sourceProject(source) === project)) return false;
    if (status && effect.status !== status) return false;
    if (!needle) return true;
    const fields = [effect.name, effect.category, effect.family, effect.role, effect.roleLimitation, effect.evidence?.class, effect.evidence?.method, effect.reason,
      ...effect.sources.flatMap((source) => [source.project, source.package])];
    fields.push(...(effect.sourceSystems || []).flatMap(source => [source.name, source.package]));
    if (/^[0-9a-f]{8,64}$/.test(needle) || /^(niagara-|component-)/.test(needle)) {
      fields.push(effect.id, ...effect.sources.map(source => source.sha256),
        ...(effect.sourceSystems || []).map(source => source.systemSha256));
    }
    return fields.some((field) => normalize(field).includes(needle));
  });
}

export const EFFECT_CATEGORIES = Object.freeze([...new Set(EFFECT_LIBRARY.map((effect) => effect.category).filter(Boolean))].sort());
export const EFFECT_PROJECTS = Object.freeze([...new Set(EFFECT_LIBRARY.flatMap((effect) => effect.sources.map(sourceProject)).filter(Boolean))].sort());
