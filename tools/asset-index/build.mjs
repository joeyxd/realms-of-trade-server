// Asset protocol CLI and the browsable index (ARTE-Y-MODELOS.html, generated, not committed).
//   node tools/asset-index/build.mjs                   write ARTE-Y-MODELOS.html at the repo root
//   node tools/asset-index/build.mjs --check           fail on problems that are not in baseline.json
//   node tools/asset-index/build.mjs --find <text>     search pieces and files before creating anything
//   node tools/asset-index/build.mjs --json            print the scan as JSON
//   node tools/asset-index/build.mjs --write-baseline  drop fixed problems from baseline.json (never adds)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROBLEMS, compareBaseline, loadBaseline, scanAssets } from './scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const OUTPUT = 'ARTE-Y-MODELOS.html';
export const BASELINE = 'tools/asset-index/baseline.json';
const MODEL_EXT = /\.(glb|gltf|fbx|obj|blend|zip)$/i;
const BASELINE_NOTE = 'Problemas heredados del 2026-10-14. Solo puede encoger: arregla uno y ejecuta '
  + '`node tools/asset-index/build.mjs --write-baseline`. Nunca añadas entradas a mano. Ver docs/art/PROTOCOLO.md.';

const mb = bytes => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Everything the page needs, compact: files are rows [path, area, type, bytes, pieces, roles, untracked].
export function indexData(scan, baseline) {
  const { fresh, resolved } = compareBaseline(scan.problems, baseline);
  const freshKeys = new Set(fresh.map(p => p.key));
  const byPiece = new Map();
  for (const f of scan.files) for (const id of f.pieces) byPiece.set(id, [...(byPiece.get(id) ?? []), f.path]);
  const areas = {};
  for (const f of scan.files) { const a = areas[f.area] ??= { files: 0, bytes: 0 }; a.files++; a.bytes += f.bytes; }
  const pieces = scan.pieces.map(p => ({ ...p, files: byPiece.get(p.id) ?? p.files ?? [],
    ...(p.intake ? { received: scan.files.filter(f => f.path.startsWith(`${p.intake}/`) && MODEL_EXT.test(f.path)).map(f => f.path) } : {}) }));
  return { generated: new Date().toISOString(), areas, niagara: scan.niagara, problemText: PROBLEMS, pieces,
    files: scan.files.map(f => [f.path, f.area, f.type, f.bytes, f.pieces.join(' '), f.roles.join(' '), f.untracked ? 1 : 0]),
    problems: scan.problems.map(p => ({ kind: p.kind, path: p.path, detail: p.detail, fresh: freshKeys.has(p.key) })), resolved };
}

export function renderIndex(data) {
  const css = readFileSync(path.join(HERE, 'page.css'), 'utf8');
  const js = readFileSync(path.join(HERE, 'page.js'), 'utf8');
  // Inline JSON must not close its own <script> element.
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arte y modelos · Marea Negra</title>
<style>${css}</style></head>
<body><main>
<header>
<p class="eyebrow">Marea Negra · índice de arte generado</p>
<h1>Arte, archivos y modelos</h1>
<p class="lede">Cada pieza tiene un ID y una fila; cada archivo del juego, de fuente o de la bandeja aparece aquí con quién lo
reclama. Protocolo para añadir: <a href="docs/art/PROTOCOLO.md">docs/art/PROTOCOLO.md</a>.</p>
<div class="stats" id="stats"></div>
</header>
<nav class="tabs" role="tablist">
<button role="tab" data-tab="piezas" aria-selected="true">Piezas</button>
<button role="tab" data-tab="archivos" aria-selected="false">Archivos</button>
<button role="tab" data-tab="problemas" aria-selected="false">Problemas</button>
<button role="tab" data-tab="anadir" aria-selected="false">Añadir</button>
</nav>
<section id="piezas" class="view">
<div class="controls"><input id="piece-q" type="search" placeholder="Buscar pieza, ID o grupo…" aria-label="Buscar pieza">
<select id="piece-group" aria-label="Grupo"><option value="">Todos los grupos</option></select>
<select id="piece-state" aria-label="Estado"><option value="">Todos los estados</option></select></div>
<p class="count" id="piece-count"></p><div class="grid" id="piece-grid"></div>
</section>
<section id="archivos" class="view" hidden>
<div class="controls"><input id="file-q" type="search" placeholder="Buscar ruta…" aria-label="Buscar ruta">
<select id="file-area" aria-label="Zona"><option value="">Todas las zonas</option></select>
<select id="file-type" aria-label="Tipo"><option value="">Todos los tipos</option></select>
<select id="file-claim" aria-label="Ficha"><option value="">Con y sin pieza</option><option value="none">Sin pieza</option><option value="some">Con pieza</option></select></div>
<p class="count" id="file-count"></p><ol class="files" id="file-list"></ol>
<button class="more" id="file-more" hidden>Mostrar más</button>
</section>
<section id="problemas" class="view" hidden><div id="problem-list"></div></section>
<section id="anadir" class="view" hidden>
<ol class="steps">
<li><strong>Busca antes de crear.</strong> <code>npm run assets:find -- palmera</code> o el buscador de Piezas. Si existe, crea una versión nueva (<code>-v2</code>) de esa pieza.</li>
<li><strong>Elige el ID</strong> en kebab-case ASCII (<code>barril-ron</code>). Una pieza = un ID = una fila de <code>tools/art-catalog/catalog.json</code> (o <code>CATALOGO-DE-ARTE.cmd</code>).</li>
<li><strong>Fuentes</strong> en <code>docs/art/&lt;familia&gt;/</code> con nombres ASCII sin espacios; nunca sobrescribas: <code>-v2</code>, <code>-v3</code>.</li>
<li><strong>Archivos del juego</strong> en <code>assets/</code>, con pareja <code>-desktop</code>/<code>-mobile</code> cuando hay dos calidades, y registrados en la fila o en <code>assets/manifest.json</code>.</li>
<li><strong>Evidencia</strong> (capturas de QA) fuera de git; DELIVERY.md guarda JSON, sha256 y una imagen principal.</li>
<li><strong>Comprueba</strong> con <code>npm run assets:check</code> antes de commitear y regenera este índice con <code>ARTE-Y-MODELOS.cmd</code>.</li>
</ol>
<p class="small">La bandeja <code>materials/</code> es para soltar archivos con cualquier nombre; no se commitea. Detalle completo en <a href="docs/art/PROTOCOLO.md">PROTOCOLO.md</a>.</p>
</section>
<footer>Generado <span id="generated"></span> con <code>node tools/asset-index/build.mjs</code>. No editar a mano.</footer>
</main>
<script id="data" type="application/json">${payload}</script>
<script>${js}</script>
</body></html>
`;
}

function printProblems(list, limit = 40) {
  const byKind = new Map();
  for (const p of list) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  for (const [kind, items] of byKind) {
    console.log(`\n${kind} (${items.length}): ${PROBLEMS[kind]}`);
    for (const p of items.slice(0, limit)) console.log(`  ${p.path}${p.detail ? `  <- ${p.detail}` : ''}`);
    if (items.length > limit) console.log(`  … ${items.length - limit} más`);
  }
}

function find(scan, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hit = text => words.every(w => fold(text).includes(w));
  const pieces = scan.pieces.filter(p => hit(`${p.id} ${p.name} ${p.group} ${p.kind} ${p.notes ?? ''}`));
  const files = scan.files.filter(f => hit(f.path));
  console.log(`Piezas (${pieces.length}):`);
  for (const p of pieces.slice(0, 25)) console.log(`  ${p.id.padEnd(34)} ${String(p.state).padEnd(9)} ${p.group} · ${p.name}`);
  console.log(`Archivos (${files.length}):`);
  for (const f of files.slice(0, 40)) console.log(`  ${f.path}${f.pieces.length ? `  [${f.pieces.join(', ')}]` : ''}`);
  if (files.length > 40) console.log(`  … ${files.length - 40} más`);
  if (!pieces.length && !files.length) console.log('Nada parecido: es una pieza nueva. Sigue docs/art/PROTOCOLO.md.');
}

// The baseline is the list of inherited problems. Created once; afterwards it only loses fixed entries.
function writeBaseline(root, scan) {
  const file = path.join(root, BASELINE);
  const now = scan.problems.map(p => p.key);
  if (!existsSync(file)) {
    writeFileSync(file, `${JSON.stringify({ note: BASELINE_NOTE, problems: now }, null, 2)}\n`);
    console.log(`baseline creada con ${now.length} problemas heredados`);
    return;
  }
  const old = loadBaseline(root);
  const keep = now.filter(k => old.has(k));
  writeFileSync(file, `${JSON.stringify({ note: BASELINE_NOTE, problems: keep }, null, 2)}\n`);
  const { fresh } = compareBaseline(scan.problems, old);
  console.log(`baseline: ${old.size} -> ${keep.length} (${old.size - keep.length} resueltos)`);
  if (fresh.length) {
    console.log(`\n${fresh.length} problemas nuevos NO entran en la baseline; arréglalos:`);
    printProblems(fresh);
    process.exitCode = 1;
  }
}

export async function main(argv = process.argv.slice(2), root = ROOT) {
  const scan = await scanAssets(root);
  const baseline = loadBaseline(root);
  if (argv.includes('--json')) return void console.log(JSON.stringify(scan, null, 2));
  if (argv.includes('--find')) return find(scan, argv.slice(argv.indexOf('--find') + 1).join(' '));
  if (argv.includes('--write-baseline')) return writeBaseline(root, scan);
  const { fresh, inherited, resolved } = compareBaseline(scan.problems, baseline);
  if (argv.includes('--check')) {
    if (resolved.length) console.log(`${resolved.length} problemas heredados ya están resueltos: ejecuta --write-baseline para sacarlos.`);
    if (fresh.length) {
      console.log(`${fresh.length} problemas nuevos (heredados tolerados: ${inherited.length}). Arréglalos antes de commitear:`);
      printProblems(fresh);
      process.exitCode = 1;
    } else console.log(`Protocolo de assets OK: ${scan.files.length} archivos, ${scan.pieces.length} piezas, ${inherited.length} problemas heredados.`);
    return;
  }
  const data = indexData(scan, baseline);
  writeFileSync(path.join(root, OUTPUT), renderIndex(data));
  const areas = Object.entries(data.areas).map(([a, v]) => `${a} ${v.files} (${mb(v.bytes)})`).join(', ');
  console.log(`${OUTPUT}: ${scan.pieces.length} piezas, ${scan.files.length} archivos [${areas}], `
    + `${inherited.length} problemas heredados, ${fresh.length} nuevos.`);
  if (fresh.length) { console.log('Problemas nuevos:'); printProblems(fresh, 10); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
