// Register the P02b body studies as prepared references without changing runtime manifests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalogFile = path.join(root, 'tools/art-catalog/catalog.json');
const source = 'docs/art/source/characters-base-v2';
const qa = 'docs/art/characters-base-v2';
const v0 = 'docs/art/source/characters-base-v0';
const plan = `${source}/plan-snapshot-v3.md`;
const delivery = 'docs/delivery/characters-base-v2.md';

const sourceSnapshots = [
  ['Generador GLB · snapshot', `${source}/generate.mjs.txt`],
  ['Generador de cuerpo · snapshot', `${source}/body.mjs.txt`],
  ['Generador de cabeza · snapshot', `${source}/head.mjs.txt`],
  ['Generador de texturas · snapshot', `${source}/textures.mjs.txt`],
  ['Inspector GLB · snapshot', `${source}/inspect.mjs.txt`],
  ['Auditor de poses · snapshot', `${source}/audit-poses.mjs.txt`],
].map(([label, artifact]) => ({ label, path: artifact, role: 'source' }));

const commonFiles = [
  ...sourceSnapshots,
  { label: 'Recibo de modelos v2', path: `${source}/models-receipt.json`, role: 'source' },
  { label: 'Reporte de entrega P02b', path: delivery, role: 'evidence' },
];
const commonReferences = [
  { label: 'Plan del creador · snapshot v3', path: plan, role: 'reference' },
  { label: 'Prompts de conceptos v0', path: `${v0}/prompts.json`, role: 'reference' },
  { label: 'Recibo de conceptos v0', path: `${v0}/concepts-receipt.json`, role: 'reference' },
];

const bodies = [
  { id: 'char-base-male-v2', name: 'Base masculina v2', body: 'male' },
  { id: 'char-base-female-v2', name: 'Base femenina v2', body: 'female' },
];

function desiredRow({ id, name, body }) {
  const files = [
    { label: `${name} · escritorio GLB`, path: `${source}/${body}-base-v2.glb`, role: 'model' },
    { label: `${name} · GLB móvil`, path: `${source}/${body}-base-v2-mobile.glb`, role: 'mobile' },
    ...commonFiles,
  ];
  const evidence = [
    { label: 'Browser QA · P02b', path: `${qa}/browser-evidence-v2.json`, role: 'evidence' },
    { label: 'Articulación CPU · P02b', path: `${qa}/pose-evidence-v2.json`, role: 'evidence' },
    { label: 'Descargas HTTP · P02b', path: `${qa}/artifact-evidence-v2.json`, role: 'evidence' },
    ...['face', 'joints', 'uv'].map((view) => ({
      label: `${name} · ${view} escritorio`, path: `${qa}/desktop-${body}-${view}-v2.png`, role: 'evidence',
    })),
    { label: `${name} · frente móvil`, path: `${qa}/mobile-${body}-front-v2.png`, role: 'evidence' },
  ];
  return {
    id,
    name,
    category: 'Personajes modulares',
    priority: 'P0',
    kind: 'model',
    description: `Estudio P02b de superficie, parches y atlas regional para la ${name.toLowerCase()}; acabado e integración pendientes.`,
    variants: ['escritorio', 'móvil'],
    destination: ['src/render/assets/manifest.js', 'src/render/characters.js'],
    state: 'prepared',
    nextStep: 'Completar revisión artística del acabado y evaluar integración después del corte P02b.',
    notes: 'Estudio P02b de superficie continua mediante anillos/parches y atlas regional. El acabado artístico y la integración en juego siguen pendientes; se preservan las bases v0/v1.',
    references: [
      { label: `${name} · vista frontal de QA`, path: `${qa}/desktop-${body}-front-v2.png`, role: 'preview' },
      { label: `${name} · concepto pintado v0`, path: `${v0}/${body}-concept-v1.png`, role: 'reference' },
      ...commonReferences,
    ],
    files,
    evidence,
  };
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const checkOnly = process.argv.includes('--check');
const before = fs.readFileSync(catalogFile);
const data = JSON.parse(before);
if (!data || !Array.isArray(data.rows) || !Number.isInteger(data.revision)) throw new Error('Invalid catalog format');

const desired = bodies.map(desiredRow);
const allArtifacts = new Set();
for (const row of desired) for (const field of ['references', 'files', 'evidence']) {
  for (const entry of row[field]) allArtifacts.add(entry.path);
}
for (const artifact of allArtifacts) {
  if (!fs.existsSync(path.join(root, artifact))) throw new Error(`Missing character base v2 artifact: ${artifact}`);
}

const planned = data.rows.slice();
let changed = false;
for (const row of desired) {
  const index = planned.findIndex((existing) => existing.id === row.id);
  if (index < 0) {
    if (checkOnly) throw new Error(`Catalog row ${row.id} is missing`);
    planned.push(row); changed = true;
  } else if (!same(planned[index], row)) {
    throw new Error(`Catalog row ${row.id} differs from the P02b registration; review before proceeding`);
  }
}

if (checkOnly) {
  console.log(JSON.stringify({ check: 'ok', rows: desired.map((row) => row.id), artifacts: allArtifacts.size }));
} else if (changed) {
  data.rows = planned;
  data.revision++;
  data.updatedAt = new Date().toISOString();
  const temp = `${catalogFile}.${process.pid}.character-base-v2.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    if (!fs.readFileSync(catalogFile).equals(before)) throw new Error('Catalog changed concurrently');
    fs.renameSync(temp, catalogFile);
  } finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  console.log(JSON.stringify({ revision: data.revision, rows: data.rows.length, registered: desired.map((row) => row.id) }));
} else {
  console.log(JSON.stringify({ revision: data.revision, rows: data.rows.length, registered: desired.map((row) => row.id), changed: false }));
}
