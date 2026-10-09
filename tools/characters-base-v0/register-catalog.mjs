// Register the character base concepts and prepared model artifacts without applying them in-game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogFile = path.join(root, 'tools/art-catalog/catalog.json');
const concepts = 'docs/art/source/characters-base-v0';
const plan = `${concepts}/plan-snapshot-v1.md`;
const generator = `${concepts}/generator-snapshot-v0.mjs.txt`;
const qa = 'docs/art/characters-base-v0';
const sharedFiles = [
  ['Prompts exactos de conceptos', `${concepts}/prompts.json`, 'source', 'files'],
  ['Recibo de conceptos raster', `${concepts}/concepts-receipt.json`, 'source', 'files'],
  ['Generador reproducible · snapshot', generator, 'source', 'files'],
  ['Plan del creador de personajes · snapshot', plan, 'reference', 'references'],
  ['Evidencia browser QA · v0', `${qa}/browser-evidence-v0.json`, 'evidence', 'evidence'],
];
const rows = [
  {
    id: 'char-base-male', label: 'Base masculina v0', name: 'Base masculina v0',
    concept: `${concepts}/male-concept-v1.png`, model: `${concepts}/male-base-v0.glb`,
    modelReceipt: `${concepts}/models-receipt.json`,
    screenshot: `${qa}/desktop-male-front-v0.png`,
  },
  {
    id: 'char-base-female', label: 'Base femenina v0', name: 'Base femenina v0',
    concept: `${concepts}/female-concept-v1.png`, model: `${concepts}/female-base-v0.glb`,
    modelReceipt: `${concepts}/models-receipt.json`,
    screenshot: `${qa}/desktop-female-front-v0.png`,
  },
];

function desiredRow(spec) {
  const entries = [
    [spec.label, spec.model, 'model', 'files'],
    [`Recibo del modelo · ${spec.label.toLowerCase()}`, spec.modelReceipt, 'source', 'files'],
    [`Concepto raster · ${spec.label.replace(/ v0$/, ' v1').toLowerCase()}`, spec.concept, 'preview', 'references'],
    [`Frente · ${spec.label.toLowerCase()} · QA browser`, spec.screenshot, 'evidence', 'evidence'],
    ...sharedFiles,
  ];
  const byField = { references: [], files: [], evidence: [] };
  for (const [label, artifactPath, role, field] of entries) byField[field].push({ label, path: artifactPath, role });
  return {
    id: spec.id,
    name: spec.name,
    category: 'Personajes modulares',
    priority: 'P0',
    kind: 'model',
    description: `Prototipo GLB de proporción y rig para ${spec.label.toLowerCase()}; parte de un concepto raster de referencia.`,
    variants: [],
    destination: ['src/render/assets/manifest.js', 'src/render/characters.js'],
    state: 'prepared',
    nextStep: 'Ejecutar node tools/character-lab/server.mjs y abrir http://127.0.0.1:5194; continuar P02 con anatomía y UV de producción.',
    notes: 'Prototipo v0 para proporción y rig; arte pintado y topología de producción pendientes. Concepto raster y GLB no aplicados al juego.',
    references: byField.references,
    files: byField.files,
    evidence: byField.evidence,
  };
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function mergeRow(current, desired) {
  if (!current) return desired;
  const merged = { ...current };
  for (const key of ['name', 'category', 'priority', 'kind', 'description', 'variants', 'destination', 'state', 'nextStep', 'notes']) {
    if (current[key] !== undefined && !same(current[key], desired[key])) throw new Error(`Catalog row ${current.id} has conflicting ${key}; review before registration`);
    merged[key] = desired[key];
  }
  for (const field of ['references', 'files', 'evidence']) {
    const existing = current[field] || [];
    const wanted = desired[field];
    for (const entry of existing) {
      if (wanted.some((candidate) => candidate.path === entry.path)) {
        const candidate = wanted.find((item) => item.path === entry.path);
        if (!same(entry, candidate)) throw new Error(`Catalog row ${current.id} has conflicting artifact ${entry.path}`);
      } else wanted.push(entry);
    }
    merged[field] = wanted;
  }
  return merged;
}

const checkOnly = process.argv.includes('--check');
const before = fs.readFileSync(catalogFile);
const data = JSON.parse(before);
if (!data || !Array.isArray(data.rows) || !Number.isInteger(data.revision)) throw new Error('Invalid catalog format');

// Keep catalog artifact links under served docs paths; the HTML viewer is launched from nextStep instead.
const required = new Set([plan, generator, `${concepts}/male-concept-v1.png`, `${concepts}/female-concept-v1.png`,
  `${concepts}/prompts.json`, `${concepts}/concepts-receipt.json`, `${qa}/browser-evidence-v0.json`,
  'tools/characters-base-v0/generate.mjs', 'tools/character-lab/server.mjs']);
for (const spec of rows) required.add(spec.model);
for (const spec of rows) required.add(spec.modelReceipt);
for (const artifact of required) if (!fs.existsSync(path.join(root, artifact))) throw new Error(`Missing character base artifact: ${artifact}`);

let changed = false;
for (const spec of rows) {
  const desired = desiredRow(spec);
  const index = data.rows.findIndex((row) => row.id === spec.id);
  if (index < 0) { data.rows.push(desired); changed = true; }
  else {
    const merged = mergeRow(data.rows[index], desired);
    if (!same(merged, data.rows[index])) { data.rows[index] = merged; changed = true; }
  }
}

if (checkOnly) {
  console.log(JSON.stringify({ check: 'ok', changed, rows: rows.map((r) => r.id), write: false }));
} else if (changed) {
  data.revision++;
  data.updatedAt = new Date().toISOString();
  const temp = `${catalogFile}.${process.pid}.character-bases.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogFile).equals(before)) throw new Error('Catalog changed concurrently');
    fs.renameSync(temp, catalogFile);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  console.log(JSON.stringify({ revision: data.revision, rows: data.rows.length, registered: rows.map((r) => r.id) }));
} else {
  console.log(JSON.stringify({ revision: data.revision, rows: data.rows.length, registered: rows.map((r) => r.id), changed: false }));
}
