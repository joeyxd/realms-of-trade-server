#!/usr/bin/env node
// Register the nine S14 town wood material rows only after immutable source and runtime receipts exist.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG = 'tools/art-catalog/catalog.json';
const MATERIAL_RECEIPT = 'docs/art/town-wood/material-receipt-v1.json';
const SOURCE_RECEIPT = 'docs/art/source/town-wood-v1/runtime-source-snapshot.json';
const RUNTIME = 'docs/art/town-wood/runtime-evidence-v1.json';
const BRIEF = 'docs/briefs/visual-s14-town-wood.md';
const REPORT = 'docs/delivery/town-wood-v1.md';
const PAIRS = [
  { id: 'planks', name: 'Tablones de madera' }, { id: 'patched', name: 'Tablones parchados' },
  { id: 'floor', name: 'Piso de tablones' }, { id: 'beam', name: 'Viga horizontal' },
  { id: 'timber', name: 'Madera sólida' }, { id: 'iron', name: 'Madera con refuerzo de hierro' },
  { id: 'corner', name: 'Esquina exterior de madera' }, { id: 'door', name: 'Muro de madera con puerta' },
  { id: 'window', name: 'Muro de madera con ventana' },
];
const DEVICES = ['desktop', 'mobile'];
const VIEWS = ['overview', 'house', 'stall', 'dock'];
const BEFORE = ['desktop', 'mobile', 'low'];
const AFTER = ['desktop', 'mobile', 'low', 'night', 'disabled', 'missing-albedo', 'missing-normal', 'portrait'];
const ATLAS_PATHS = {
  albedo: { desktop: 'assets/textures/town-wood-v1/atlas-albedo-desktop.webp', mobile: 'assets/textures/town-wood-v1/atlas-albedo-mobile.webp' },
  normal: { desktop: 'assets/textures/town-wood-v1/atlas-normal-desktop.webp', mobile: 'assets/textures/town-wood-v1/atlas-normal-mobile.webp' },
};
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const canonical = (value) => JSON.stringify(value);
const item = (label, file, role) => ({ label, path: file, ...(role ? { role } : {}) });
const uniqueByPath = (entries) => [...new Map(entries.map((entry) => [entry.path, entry])).values()];
const expectedSourcePaths = new Set(PAIRS.flatMap((pair) => ['albedo', 'normal'].map((channel) => `docs/art/source/town-wood-v1/textures/${pair.id}-${channel}.png`)));
const SOURCE_SCOPE = [
  ...['src/render/townMaterials.js', 'src/render/props.js', 'assets/manifest.json', 'tools/prepare-town-materials.mjs',
    'tools/register-town-manifest.mjs', 'tools/register-town-catalog.mjs', 'tools/verify-town-catalog.mjs',
    'tools/prepare-town-sources.mjs', 'tools/qa-town-wood.playwright.js', 'tests/town-materials.test.mjs', 'tests/dock-wood.test.mjs']
    .map((source) => ({ phase: 'after', source })),
  { phase: 'before', source: 'src/render/props.js', snapshot: 'docs/art/source/town-wood-v1/before/props.source.js' },
];

function validateSources(receipt) {
  assert(receipt.schema === 1 && receipt.family === 'town-wood-v1' && Array.isArray(receipt.sources), 'Recibo de snapshots S14 incompatible o incompleto.');
  const material = readJson(MATERIAL_RECEIPT);
  assert(material.schemaVersion === 1 && material.family === 'town-wood-v1' && material.sources?.length === 18, 'Recibo de materiales S14 incompatible.');
  const seen = new Set();
  for (const expected of SOURCE_SCOPE) {
    const matches = receipt.sources.filter((entry) => entry.phase === expected.phase && entry.source === expected.source);
    assert(matches.length === 1, `Falta fuente congelada ${expected.phase}: ${expected.source}`);
    const entry = matches[0];
    if (expected.snapshot) assert(entry.snapshot === expected.snapshot, `Ruta del snapshot before incorrecta: ${entry.snapshot}`);
    assert(typeof entry.snapshot === 'string' && Number.isInteger(entry.bytes) && /^[a-f0-9]{64}$/.test(entry.sha256), 'Entrada de snapshot incompleta.');
    assert(!seen.has(entry.snapshot), `Snapshot repetido: ${entry.snapshot}`);
    const bytes = fs.readFileSync(path.join(ROOT, entry.snapshot));
    assert(bytes.length === entry.bytes && hash(bytes) === entry.sha256, `Snapshot histórico inválido: ${entry.snapshot}`);
    seen.add(entry.snapshot);
  }
  assert(receipt.sources.length === SOURCE_SCOPE.length && seen.size === SOURCE_SCOPE.length, 'El snapshot debe contener once fuentes after y una fuente before.');
  const sourceCopies = new Set();
  for (const source of material.sources) {
    assert(expectedSourcePaths.has(source.path) && Number.isInteger(source.bytes) && /^[a-f0-9]{64}$/.test(source.sha256), 'Original S14 incompleto en el recibo de materiales.');
    assert(!sourceCopies.has(source.path), `Copia PNG duplicada: ${source.path}`);
    const bytes = fs.readFileSync(path.join(ROOT, source.path));
    assert(bytes.length === source.bytes && hash(bytes) === source.sha256, `Copia PNG exacta inválida: ${source.path}`);
    sourceCopies.add(source.path);
  }
  assert(sourceCopies.size === expectedSourcePaths.size, 'El recibo de materiales debe incluir las 18 copias PNG esperadas.');
  return { snapshot: receipt, material };
}
function verifyRuntime() {
  const runtime = readJson(RUNTIME);
  assert(runtime.schema === 1 && runtime.family === 'town-wood-v1', 'Runtime evidence S14 incompatible.');
  assert(canonical(runtime.before?.map((entry) => entry.device)) === canonical(BEFORE), 'Casos before incompletos o fuera de orden.');
  assert(canonical(runtime.after?.map((entry) => entry.device)) === canonical(AFTER), 'Casos after incompletos o fuera de orden.');
  const getRequests = (entry) => (entry.requests || []).map((request) => typeof request === 'string' ? request : request.url || request.href || '');
  const stateOf = (entry) => entry.state || entry;
  const atlasDevice = (device) => ['mobile', 'low', 'portrait'].includes(device) ? 'mobile' : 'desktop';
  const atlasState = (state, channel) => state.townWood?.[channel];
  const assetId = (channel) => `tex:town-wood-${channel}-v1`;
  const errorText = (error) => typeof error === 'string' ? error : `${error?.text || error?.message || ''} ${error?.url || error?.location?.url || ''}`;
  const cases = [...runtime.before.map((entry) => ({ ...entry, phase: 'before' })), ...runtime.after.map((entry) => ({ ...entry, phase: 'after' }))];
  for (const entry of cases) {
    const textureRefs = new Map();
    assert(entry.mapProps?.count === 1259 && entry.mapProps.bytes === 220024 && /^[a-f0-9]{64}$/.test(entry.mapProps.sha256), `Falta hash real de map.props: ${entry.device}.`);
    assert(Array.isArray(entry.errors) && entry.errors.length === 0, `Errores de juego en ${entry.device}.`);
    const allowedId = entry.device === 'missing-albedo' ? assetId('albedo') : entry.device === 'missing-normal' ? assetId('normal') : null;
    assert(Array.isArray(entry.consoleErrors), `Falta consoleErrors[] en ${entry.device}.`);
    const consoleErrors = entry.consoleErrors;
    assert(consoleErrors.every((error) => {
      const text = errorText(error), url = error?.location?.url || error?.url || text;
      return /404/i.test(text) && (String(url).endsWith('/favicon.ico') || (allowedId && /atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(String(url)) && String(url).includes(allowedId.slice('tex:town-wood-'.length, -'-v1'.length))));
    }), `consoleErrors no permitidos en ${entry.device}.`);
    assert(Array.isArray(entry.views) && entry.views.length === 4 && VIEWS.every((name) => entry.views.some((view) => view.name === name)), `Se requieren cuatro vistas (overview/house/stall/dock) en ${entry.device}.`);
    if (entry.phase === 'after') {
      assert(Array.isArray(entry.transitions) && entry.transitions.length === 4 && entry.transitions.every((transition) => transition.reused === true), `Transiciones de calidad sin reuso en ${entry.device}.`);
      assert(canonical(entry.transitions.map(t => t.tier)) === canonical(['high', 'low', 'medium', 'high']), `Secuencia de calidad incorrecta: ${entry.device}.`);
      if (!['disabled', 'missing-albedo'].includes(entry.device)) assert(entry.tileVertices?.length === 9 && entry.tileVertices.every(n => n > 0), `Falta uso real de algún material: ${entry.device}.`);
    }
    for (const view of [...entry.views, ...(entry.phase === 'after' ? entry.transitions : [])]) {
      const state = stateOf(view);
      assert(state.glError === 0 && state.programsLinked === true, `WebGL inválido en ${entry.device}/${view.name}.`);
      const emptyGameErrors = (Array.isArray(state.gameErrors) && state.gameErrors.length === 0) || (state.gameErrors && !Array.isArray(state.gameErrors) && Object.keys(state.gameErrors).length === 0);
      assert(emptyGameErrors, `Errores de juego en ${entry.device}/${view.name || view.tier}.`);
      assert(Array.isArray(state.assetErrors), `Falta assetErrors[] en ${entry.device}/${view.name || view.tier}.`);
      if (allowedId) assert(state.assetErrors.length === 1 && typeof state.assetErrors[0] === 'string' && state.assetErrors[0].startsWith(`${allowedId}:`), `Falta el error de asset esperado en ${entry.device}/${view.name || view.tier}.`);
      else assert(state.assetErrors.length === 0, `Errores de assets inesperados en ${entry.device}/${view.name || view.tier}.`);
      if (entry.phase === 'after') {
        const mobile = atlasDevice(entry.device) === 'mobile';
        const town = state.townWood;
        assert(town && typeof town.mapped === 'boolean' && typeof town.normalMapped === 'boolean' && Number.isInteger(town.chunks) && Array.isArray(town.materials), `townWood runtime state incompleto: ${entry.device}/${view.name}.`);
        for (const channel of ['albedo', 'normal']) {
          const atlas = atlasState(state, channel);
          const missing = allowedId === assetId(channel) || entry.device === 'disabled';
          if (missing) {
            assert(atlas === null, `El atlas ${channel} debe ser null cuando no está disponible: ${entry.device}/${view.name}.`);
            continue;
          }
          assert(atlas && atlas.width === (mobile ? 1024 : 2048) && atlas.height === atlas.width, `Atlas ${channel} con resolución incorrecta: ${entry.device}/${view.name}.`);
          assert(atlas.src?.endsWith(mobile ? `atlas-${channel}-mobile.webp` : `atlas-${channel}-desktop.webp`), `Variante ${channel} incorrecta: ${entry.device}/${view.name}.`);
          assert(atlas.data === (channel === 'normal'), `Data flag incorrecto para ${channel}.`);
          const expectedShared = !(entry.device === 'missing-albedo' && channel === 'normal');
          assert(atlas.shared === expectedShared && typeof atlas.textureRef === 'string' && atlas.textureRef.length > 0,
            `Referencia compartida de textura ${channel} incorrecta: ${entry.device}/${view.name}.`);
          if (expectedShared) {
            const key = `${channel}:${atlas.src}`;
            const priorRef = textureRefs.get(key);
            assert(!priorRef || priorRef === atlas.textureRef, `Cambió el objeto de textura compartida: ${key}.`);
            textureRefs.set(key, atlas.textureRef);
          }
          const expectedSpace = channel === 'normal' ? '' : 'srgb';
          assert(String(atlas.colorSpace).toLowerCase() === expectedSpace, `Color space incorrecto para ${channel}: ${entry.device}/${view.name}.`);
        }
        assert(town.mapped === (entry.device !== 'disabled' && entry.device !== 'missing-albedo'), `Mapped inesperado en ${entry.device}/${view.name}.`);
        assert(town.normalMapped === (entry.device !== 'disabled' && entry.device !== 'missing-normal' && entry.device !== 'missing-albedo'), `Normal mapped inesperado en ${entry.device}/${view.name || view.tier}.`);
        if (entry.device === 'disabled') assert(town.albedo === null && town.normal === null, 'Disabled debe reportar ambos atlas null.');
      }
    }
    const requests = getRequests(entry);
    const atlasRequests = requests.filter((url) => /atlas-(?:albedo|normal)-(?:desktop|mobile)\.webp/.test(url));
    const expectedCount = entry.phase === 'before' || entry.device === 'disabled' ? 0 : 2;
    assert(atlasRequests.length === expectedCount, `Solicitudes de atlas inesperadas en ${entry.phase}/${entry.device}.`);
    if (expectedCount) for (const channel of ['albedo', 'normal']) {
      const expectedPath = ATLAS_PATHS[channel][atlasDevice(entry.device)];
      const selected = atlasRequests.filter((url) => url.endsWith(`/${expectedPath}`) || url === expectedPath);
      assert(selected.length === 1, `Debe solicitar exactamente el atlas ${channel} esperado en ${entry.device}.`);
    }
  }
  for (const device of ['desktop', 'mobile', 'low']) {
    const before = runtime.before.find((entry) => entry.device === device), after = runtime.after.find((entry) => entry.device === device);
    assert(canonical(before.mapProps) === canonical(after.mapProps) && canonical(before.dock) === canonical(after.dock), `Cambió el mapa o muelle: ${device}.`);
    assert(before.views.every((view, i) => canonical(view.state.camera) === canonical(after.views[i].state.camera)), `Cambió la cámara de comparación: ${device}.`);
    const left = before.meshes || [], right = after.meshes || [];
    assert(left.length === right.length, `Cambió el conteo de meshes: ${device}.`);
    for (let meshIndex = 0; meshIndex < right.length; meshIndex++) {
      const current = right[meshIndex], prior = left[meshIndex];
      assert(prior.name === current.name && prior.animated === current.animated && prior.chunk === current.chunk && prior.triangles === current.triangles && (prior.count ?? null) === (current.count ?? null), `Cambió nombre/flags/chunk/tri/count: ${device}/${current.name}.`);
      assert(prior.chunk || canonical(prior.key) === canonical(current.key), `Cambió shader ajeno al pueblo: ${device}/${current.name}.`);
      assert(canonical({ castShadow: prior.castShadow, receiveShadow: prior.receiveShadow, normalPass: prior.normalPass }) ===
        canonical({ castShadow: current.castShadow, receiveShadow: current.receiveShadow, normalPass: current.normalPass }), `Cambió estructura de mesh: ${device}/${current.name}.`);
      const attrs = (mesh) => Object.fromEntries(Object.entries(mesh.attributes || {}).filter(([name]) => !(mesh.chunk && ['aTownWood', 'uv'].includes(name))).sort(([a], [b]) => a.localeCompare(b)));
      const hasTownUv = Object.hasOwn(current.attributes || {}, 'aTownWood');
      assert(!Object.hasOwn(prior.attributes || {}, 'aTownWood'), `aTownWood ya existía antes del cambio: ${current.name}.`);
      if (hasTownUv) assert(current.chunk === true, `aTownWood fuera de propsChunk: ${current.name}.`);
      if (!prior.animated && !current.animated) {
        assert(canonical(attrs(prior)) === canonical(attrs(current)), `Cambió una geometría existente: ${device}/${current.name}.`);
        assert(canonical(prior.matrix ?? null) === canonical(current.matrix ?? null), `Cambió matriz: ${device}/${current.name}.`);
      }
      assert(canonical(prior.index ?? null) === canonical(current.index ?? null), `Cambió índice: ${device}/${current.name}.`);
      if (current.deck === true) assert(!hasTownUv && canonical(prior) === canonical(current), `La cubierta debe quedar intacta: ${device}/${current.name}.`);
    }
    const townMeshes = right.filter((mesh) => Object.hasOwn(mesh.attributes || {}, 'aTownWood'));
    assert(townMeshes.length > 0 && townMeshes.every((mesh) => mesh.chunk === true), `UV aTownWood no quedó limitada a propsChunk: ${device}.`);
  }
  return runtime;
}

const { snapshot, material } = validateSources(readJson(SOURCE_RECEIPT));
const runtime = verifyRuntime();
const requiredScreenshots = [
  ...BEFORE.flatMap((device) => VIEWS.map((view) => `docs/art/town-wood/${device}-${view}-before-v1.png`)),
  ...AFTER.flatMap((device) => VIEWS.map((view) => `docs/art/town-wood/${device}-${view}-after-v1.png`)),
];
for (const relative of [BRIEF, REPORT, RUNTIME, SOURCE_RECEIPT, MATERIAL_RECEIPT, ...requiredScreenshots]) assert(exists(relative), `Falta artefacto S14: ${relative}`);

const catalogPath = path.join(ROOT, CATALOG);
const beforeBytes = fs.readFileSync(catalogPath);
const catalog = JSON.parse(beforeBytes.toString('utf8'));
for (const pending of catalog.rows.filter((row) => ['kit-piso', 'kit-poste', 'kit-viga-diagonal', 'muelle-soporte'].includes(row.id))) {
  assert(pending.state === 'pending', `S14 no puede cambiar ni cerrar ${pending.id}.`);
}
const snapFiles = snapshot.sources.map((source) => item(`Copia inmutable · ${path.basename(source.snapshot)}`, source.snapshot, 'source'));
const sourceReceiptFile = item('Recibo de snapshots exactos', SOURCE_RECEIPT, 'source');
const runtimeFile = item('QA runtime S14 · atlas, equivalencia y fallbacks', RUNTIME);
const materialReceiptFile = item('Recibo de mapas, atlases y hashes', MATERIAL_RECEIPT, 'source');
const screenshots = requiredScreenshots.map((relative) => item(`Captura gameplay · ${path.basename(relative, '.png')}`, relative));
let changed = false;
for (const pair of PAIRS) {
  const id = `town-wood-${pair.id}`;
  const sources = material.sources.filter((source) => source.pairId === pair.id);
  const previews = material.derivatives.filter((entry) => entry.kind === 'preview' && entry.pairId === pair.id);
  assert(sources.length === 2 && previews.length === 2, `Par S14 incompleto: ${pair.id}.`);
  const sourceFiles = sources.map((source) => item(`${source.channel === 'normal' ? 'Normal' : 'Albedo'} PNG · copia exacta`, source.path, 'source'));
  const previewFiles = previews.map((preview) => item(`${preview.channel === 'normal' ? 'Normal' : 'Albedo'} · preview 512`, preview.path, preview.channel));
  const atlasFiles = ['albedo', 'normal'].flatMap((channel) => ['desktop', 'mobile'].map((device) => {
    const relative = ATLAS_PATHS[channel][device].replace(/^assets\//, '');
    return item(`Atlas compartido ${channel} · ${device}`, `assets/${relative}`, device === 'mobile' ? 'mobile' : channel);
  }));
  const row = {
    id, name: pair.name, category: 'Kit portuario', priority: 'P0', kind: 'material',
    description: `${pair.name} ilustrados con mapas albedo y normal del material recibido; comparte los atlas de madera del kit portuario.`,
    variants: ['albedo', 'normal', 'atlas escritorio 2048', 'atlas táctil 1024'],
    destination: ['src/render/townMaterials.js', 'src/render/props.js', 'assets/textures/town-wood-v1/'],
    state: 'applied', nextStep: 'Revisión artística fina, escala de repetición y FPS en dispositivos físicos pendientes.',
    notes: `S14 aplicado localmente; ${pair.id} ocupa el tile ${PAIRS.findIndex((entry) => entry.id === pair.id)} de atlas compartidos 4×4. La preparación conserva normales RGB lineales y copias PNG exactas.`,
    references: [
      ...previews.map((preview) => item(`${pair.name} · ${preview.channel === 'normal' ? 'normal' : 'albedo'} recibido`, preview.path, 'preview')),
      item('Brief S14 · materiales de madera del puerto', BRIEF, 'reference'),
    ],
    files: uniqueByPath([...sourceFiles, ...previewFiles, ...atlasFiles, materialReceiptFile, sourceReceiptFile, runtimeFile, ...snapFiles, item('Brief S14', BRIEF, 'reference'), item('Entrega local S14', REPORT)]),
    evidence: uniqueByPath([item('Runtime · atlas, fallbacks y equivalencia', RUNTIME), item('Entrega local S14', REPORT), ...screenshots]),
  };
  for (const linked of [...row.references, ...row.files, ...row.evidence]) assert(exists(linked.path), `Falta vínculo del catálogo: ${linked.path}`);
  const existing = catalog.rows.find((entry) => entry.id === id);
  if (existing) assert(canonical(existing) === canonical(row), `La fila existente ${id} difiere; no se sobrescribe.`);
  else { catalog.rows.push(row); changed = true; }
}
if (changed) {
  catalog.revision++;
  catalog.updatedAt = new Date().toISOString();
  const temp = `${catalogPath}.${process.pid}.town-wood.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogPath).equals(beforeBytes)) throw new Error('El catálogo cambió en paralelo; conserva su revisión nueva.');
    fs.renameSync(temp, catalogPath);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
}
console.log(`S14 catálogo preparado: ${PAIRS.length} materiales; revisión ${catalog.revision}.`);
