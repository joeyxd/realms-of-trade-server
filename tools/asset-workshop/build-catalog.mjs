import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const requestedResearch = process.argv.find((arg) => arg.startsWith('--research='))?.slice('--research='.length);
const researchCandidates = [requestedResearch, path.join(root, 'docs/research/unreal-assets/intake-2026-10-14-batch2'),
  path.resolve(root, '../realms-of-trade-server/docs/research/unreal-assets/intake-2026-10-14-batch2')]
  .filter(Boolean).map((value) => path.resolve(value));
let research = '';
for (const candidate of researchCandidates) {
  try { await access(path.join(candidate, 'review-candidates.json')); research = candidate; break; } catch { /* Try the next explicit metadata location. */ }
}
if (!research) throw new Error('No se encontró intake batch2; usa --research=<directorio de metadata>.');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const packTitles = {
  AdvancedVillagePack: 'Advanced Village Pack', RPGEnvironmentVFX: 'RPG Environment VFX',
  UltimateFarming: 'Ultimate Farming', PN_Banana: 'Tropical Vegetation: Banana Plants',
  Kobo_Nature: 'Kobo Nature', Greek_island: 'Greek Island', Bazaar_Meshingun: 'The Bazaar',
  'FANTASTIC_-_Village_Pack-52529a12': 'FANTASTIC - Village Pack', AnimalVarietyPack: 'Animal Variety Pack',
  Goblin: 'Goblin', ROG_Modular_Armor: 'ROG Modular Armor', InfinityBladeWeapons: 'Infinity Blade Weapons',
  Hack_And_Slash_FX: 'Hack and Slash FX', HumanVocalizations: 'Human Vocalizations',
  CraftResourcesIcons: 'Craft Resources Icons',
};

const labels = {
  'aw-pilot-01': { aliases: ['caldero', 'olla', 'caldero village', 'cauldron'], categories: ['Construcción', 'Decoración', 'Fabricación'], tags: ['comparación nueva', 'malla estática'] },
  'aw-pilot-02': { aliases: ['caldero anterior', 'demo cauldron', 'olla antigua'], categories: ['Construcción', 'Decoración', 'Fabricación'], tags: ['control anterior', 'malla estática'] },
  'aw-pilot-03': { aliases: ['algodón', 'cotton', 'planta de algodón', 'cosechado', 'harvested'], categories: ['Plantas', 'Recursos'], tags: ['dos estados', 'variantes'] },
  'aw-pilot-04': { aliases: ['banana', 'plátano', 'banano', 'planta de plátano'], categories: ['Plantas', 'Recursos'], tags: ['vegetación tropical'] },
  'aw-pilot-05': { aliases: ['palma', 'palm', 'kobo'], categories: ['Plantas', 'Decoración'], tags: ['vegetación tropical'] },
  'aw-pilot-06': { aliases: ['puerta', 'door', 'puerta de casa'], categories: ['Construcción', 'Decoración'], tags: ['malla estática'] },
  'aw-pilot-07': { aliases: ['barco', 'boat', 'bote griego', 'embarcación'], categories: ['Transporte', 'Decoración'], tags: ['referencia visual'] },
  'aw-pilot-08': { aliases: ['madera', 'wood', 'trimsheet', 'trim sheet', 'atlas madera'], categories: ['Materiales', 'Construcción'], tags: ['madera'] },
  'aw-pilot-09': { aliases: ['metal', 'metalware', 'material metálico'], categories: ['Materiales', 'Decoración'], tags: ['metal'] },
  'aw-pilot-10': { aliases: ['vidrio', 'cristal', 'glass'], categories: ['Materiales'], tags: ['transparencia'] },
  'aw-pilot-11': { aliases: ['cuero', 'piel', 'leather'], categories: ['Materiales', 'Recursos'], tags: ['textura'] },
  'aw-pilot-12': { aliases: ['balcón', 'balcon', 'balcony'], categories: ['Construcción', 'Decoración'], tags: ['fbx', 'arquitectura'] },
  'aw-pilot-13': { aliases: ['cierva', 'venado', 'deer', 'walk', 'caminar'], categories: ['Personajes', 'Animación'], tags: ['animal', 'esqueleto'] },
  'aw-pilot-14': { aliases: ['goblin', 'duende', 'ataque'], categories: ['Personajes', 'Combate'], tags: ['esqueleto', 'animación'] },
  'aw-pilot-15': { aliases: ['brazalete', 'bracer', 'armadura modular', 'rog'], categories: ['Personajes', 'Equipo'], tags: ['accesorio'] },
  'aw-pilot-16': { aliases: ['espada', 'sword', 'dragon sword', 'arma'], categories: ['Combate', 'Equipo'], tags: ['arma'] },
  'aw-pilot-17': { aliases: ['fuego', 'fire', 'impacto', 'slash', 'niagara'], categories: ['Efectos', 'Combate'], tags: ['niagara', 'efecto'] },
  'aw-pilot-18': { aliases: ['voz', 'vocalización', 'vocalizacion', 'attack voice', 'audio'], categories: ['Audio', 'Combate'], tags: ['cue de audio'] },
  'aw-pilot-19': { aliases: ['icono de cuero', 'leather icon', 'icono piel'], categories: ['Interfaz', 'Recursos'], tags: ['icono', 'textura'] },
  'aw-pilot-20': { aliases: ['chispas', 'forja', 'forge sparks', 'spark', 'niagara'], categories: ['Efectos', 'Materiales'], tags: ['control de efecto', 'niagara'] },
};

const controls = [
  { id: 'model:coast-rock-v1', name: 'Roca costera integrada', aliases: ['roca', 'coast rock'], categories: ['Control integrado', 'Decoración'] },
  { id: 'model:beach-shell-fan-v1', name: 'Concha abanico integrada', aliases: ['concha', 'shell'], categories: ['Control integrado', 'Recursos'] },
  { id: 'model:palm-tall-v1', name: 'Palma alta integrada', aliases: ['palmera', 'palm'], categories: ['Control integrado', 'Plantas'] },
  { id: 'model:palm-base-open-v1', name: 'Base de palma abierta integrada', aliases: ['base de palma'], categories: ['Control integrado', 'Plantas'] },
  { id: 'model:shrub-round-v1', name: 'Arbusto redondo integrado', aliases: ['arbusto', 'shrub'], categories: ['Control integrado', 'Plantas'] },
  { id: 'model:beach-debris-branch-v1', name: 'Rama de costa integrada', aliases: ['rama', 'debris'], categories: ['Control integrado', 'Decoración'] },
  { id: 'model:item-resina-v1', name: 'Resina integrada', aliases: ['resina', 'resin'], categories: ['Control integrado', 'Recursos'] },
  { id: 'model:item-antorcha-v1', name: 'Antorcha integrada', aliases: ['antorcha', 'torch'], categories: ['Control integrado', 'Recursos'] },
];

function kindFor(unit) {
  const joined = unit.paths.join(' ').toLowerCase();
  if (joined.endsWith('.png') || /\b(textura|icono)\b/.test(unit.label.toLowerCase())) return 'texture';
  if (/\bmi_|\bm_/.test(joined)) return 'material';
  if (/\bsk_|skeletal/.test(joined)) return 'skeletal-mesh';
  if (/\banim|walk/.test(joined)) return 'animation';
  if (/\bns_|niagara/.test(joined)) return 'effect';
  if (/\bcue\b|vocalization/.test(joined)) return 'audio';
  return 'model';
}

function packForPath(filePath) {
  const first = filePath.split('/')[0];
  return [first, packTitles[first] || first.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')];
}

function entryFromUnit(unit, sourceRevision) {
  const metadata = labels[unit.id] || { aliases: [], categories: ['Otros'], tags: [] };
  const firstPath = unit.paths[0];
  const [packId, packName] = packForPath(firstPath);
  const type = kindFor(unit);
  const paths = unit.paths;
  const material = type === 'material' ? paths.map((value) => value.split('/').at(-1).replace(/\.uasset$/i, '')) : [];
  return {
    id: unit.id,
    name: unit.label,
    originalName: paths.map((value) => value.split('/').at(-1).replace(/\.(uasset|fbx|png)$/i, '')).join(' + '),
    packId,
    packName,
    type,
    categories: metadata.categories,
    materials: material,
    tags: [...metadata.tags, unit.stage],
    aliases: metadata.aliases,
    notes: metadata.tags.join(' · '),
    isNew: !['aw-pilot-02', 'aw-pilot-20'].includes(unit.id),
    sourceRevision,
    source: {
      project: unit.root === 'fab' ? 'FabLibrary' : 'survival project',
      package: firstPath,
      paths,
    },
    preview: null,
    limitations: ['Candidato de metadata: clase, preview y conversión no verificados; esta ficha no certifica portabilidad.'],
  };
}

function glbExternalUris(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') return [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length;
    if (end > bytes.length) throw new Error('Chunk GLB truncado.');
    if (type === 0x4e4f534a) {
      const json = JSON.parse(bytes.toString('utf8', start, end).replace(/[\u0000\s]+$/g, ''));
      return [...(json.buffers || []), ...(json.images || [])].map((item) => item.uri)
        .filter((uri) => typeof uri === 'string' && !uri.startsWith('data:'));
    }
    offset = end;
  }
  return [];
}

async function verifiedFile(assetRelativePath) {
  const normalized = assetRelativePath.replaceAll('\\', '/');
  const absolute = path.resolve(root, 'assets', normalized);
  const assetsRoot = path.resolve(root, 'assets') + path.sep;
  if (!absolute.startsWith(assetsRoot)) throw new Error(`Ruta integrada fuera de assets: ${assetRelativePath}`);
  const data = await readFile(absolute);
  return { url: `assets/${normalized}`, bytes: data.byteLength, sha256: sha256(data), data };
}

async function controlPreview(asset) {
  const desktop = await verifiedFile(asset.src);
  const dependencies = [];
  const mobile = asset.mobileSrc ? await verifiedFile(asset.mobileSrc) : desktop;
  for (const [profile, source] of [['desktop', desktop], ['mobile', mobile]]) {
    const sourcePath = profile === 'mobile' && asset.mobileSrc ? asset.mobileSrc : asset.src;
    for (const uri of glbExternalUris(source.data)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath.replaceAll('\\', '/')), decodeURIComponent(uri.split(/[?#]/)[0])));
      const file = await verifiedFile(dependency);
      dependencies.push({ profile, path: dependency, bytes: file.bytes, sha256: file.sha256 });
    }
  }
  const sourceRevision = `integrated:sha256:${sha256(JSON.stringify({
    manifest: { src: asset.src, mobileSrc: asset.mobileSrc || null },
    desktop: desktop.sha256, mobile: mobile.sha256, dependencies,
  }))}`;
  return {
    sourceRevision,
    dependencies,
    preview: {
      kind: 'model',
      desktop: { url: desktop.url, bytes: desktop.bytes, sha256: desktop.sha256 },
      mobile: {
        url: mobile.url, bytes: mobile.bytes, sha256: mobile.sha256,
        ...(!asset.mobileSrc ? { label: 'Derivado compartido: aún sin variante móvil optimizada' } : {}),
      },
      label: 'Referencia integrada del juego; no es una importación del piloto Unreal.',
    },
  };
}

const candidatesPath = path.join(research, 'review-candidates.json');
const manifestPath = path.join(root, 'assets/manifest.json');
const validationPath = path.join(research, 'validation.json');
const [candidateDoc, manifest, validation] = await Promise.all([readJson(candidatesPath), readJson(manifestPath), readJson(validationPath)]);
const snapshotHash = validation.artifact_sha256?.['docs/research/unreal-assets/intake-2026-10-14-batch2/files.jsonl'];
if (candidateDoc.status !== 'planning-only' || candidateDoc.classVerified !== false || candidateDoc.previewReviewed !== false ||
    !Array.isArray(candidateDoc.units) || candidateDoc.units.length !== 20 || !snapshotHash) {
  throw new Error('El lote de candidatos no coincide con el intake congelado esperado.');
}
if (!Array.isArray(manifest.assets)) throw new Error('No se pudo leer el manifiesto integrado.');
const staticCatalog = await readFile(path.join(root, 'src/editor/catalog.js'), 'utf8');
if (!staticCatalog.includes("['model', 'prop']")) throw new Error('El catálogo estático ya no declara sus modelos integrados como esperado.');
const entries = candidateDoc.units.map((unit) => entryFromUnit(unit, `intake-2026-10-14-batch2:${snapshotHash}`));
const seen = new Set(entries.map((entry) => entry.id));
for (const control of controls) {
  const asset = manifest.assets.find((item) => item.id === control.id);
  if (!asset || !['model', 'prop'].includes(asset.kind || 'model') || !asset.src) throw new Error(`Control integrado no encontrado en manifest: ${control.id}`);
  if (seen.has(asset.id)) throw new Error(`ID integrado duplicado: ${asset.id}`);
  seen.add(asset.id);
  const verified = await controlPreview(asset);
  entries.push({
    id: asset.id,
    name: control.name,
    originalName: asset.id,
    packId: 'marea-negra-integrated',
    packName: 'MAREA NEGRA integrado',
    type: 'model',
    categories: control.categories,
    materials: [],
    tags: ['integrado', 'control AW01'],
    aliases: control.aliases,
    notes: asset.notes || 'Activo integrado que sirve como referencia comparativa local.',
    isNew: false,
    sourceRevision: verified.sourceRevision,
    source: { project: 'MAREA NEGRA', package: asset.src, paths: [asset.src, ...(asset.mobileSrc ? [asset.mobileSrc] : [])], dependencies: verified.dependencies },
    preview: verified.preview,
    limitations: ['Control de referencia integrado; ficha de biblioteca para comparar búsqueda y revisión, sin publicar cambios al juego.'],
  });
}
if (new Set(entries.map((entry) => entry.id)).size !== 28) throw new Error('La cobertura del piloto debe tener 20 candidatos y 8 controles.');
const output = {
  schema: 'marea.asset-workshop.catalog.v1',
  generatedAt: '2026-10-14',
  coverage: {
    label: 'Muestra piloto AW01; no es catálogo completo',
    pilotCandidates: 20,
    integratedControls: 8,
    indexedEntries: entries.length,
    fullCatalog: false,
    frozenSourceCensus: { physicalFiles: 53947, unrealManifestPacks: 48, sourceSnapshot: 'intake-2026-10-14-batch2' },
  },
  entries,
};
await mkdir(path.join(root, 'assets/workshop'), { recursive: true });
await writeFile(path.join(root, 'assets/workshop/catalog.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`AW catalog: ${entries.length} entries (${candidateDoc.units.length} candidates + ${controls.length} integrated controls)`);
