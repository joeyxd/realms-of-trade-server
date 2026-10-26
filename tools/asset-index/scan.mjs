// Asset index: every art and game file joined with the catalogs that claim it. Read-only.
// Authorities stay where they are: art-catalog rows (pieces), docs/art/items-index.json (Tripo items),
// assets/manifest.json + assets/editor/*.json + the Niagara catalog + assets/workshop/*.json (what the game loads).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const AREAS = Object.freeze({ assets: 'juego', 'docs/art': 'fuente', materials: 'bandeja' });
export const PROBLEMS = Object.freeze({
  nombre: 'Nombre con espacios, acentos u otros signos: usa ASCII [A-Za-z0-9._-].',
  'sin-ficha': 'Archivo del juego que ningún catálogo reclama: añádelo a los `files` de su fila del catálogo de arte (rol `albedo`, `normal`, `model`, `mobile`…) o a assets/manifest.json.',
  huerfano: 'Fuente/referencia que nada enlaza: añádela a su fila del catálogo, enlázala desde su DELIVERY.md o sácala de git si es una captura de QA.',
  falta: 'Un catálogo apunta a un archivo que no existe.',
  movil: 'Variante de escritorio sin su pareja `-mobile`.',
  id: 'ID de fila repetido o fuera de kebab-case ASCII.',
  bandeja: 'Archivo commiteado en materials/: archívalo en docs/art/<familia>/ y enlázalo desde su fila.',
});
const NAME = /^[A-Za-z0-9._-]+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CATALOG_FILES = new Set(['assets/manifest.json', 'assets/editor/catalog.json', 'assets/editor/thumbnails.json',
  'assets/workshop/catalog.json', 'assets/workshop/prepared.json', 'assets/workshop/thumbnails.json',
  'assets/workshop/published.json']);
const RUNTIME_CLAIMS = new Set(['catalogo', 'objetos', 'manifest', 'editor', 'niagara', 'taller', 'codigo', 'sistema']);
const PATH_RE = /(?:assets|docs\/art|materials)\/[^\s'"`)<>,;]+/g;
const EXT_RE = /\.[A-Za-z0-9]{2,5}$/;

const posix = p => p.replace(/\\/g, '/');
const norm = p => posix(String(p)).replace(/^\.?\//, '').split(/[?#]/)[0];
const strings = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
};

export function fileType(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (['glb', 'gltf', 'fbx', 'obj', 'blend'].includes(ext)) return 'modelo';
  if (['webp', 'png', 'jpg', 'jpeg', 'ktx2', 'svg', 'gif'].includes(ext)) {
    if (file.startsWith('assets/vfx/')) return 'vfx';
    if (file.startsWith('assets/ui/') || file.startsWith('assets/editor/thumbnails/')) return 'ui';
    if (file.startsWith('assets/textures/')) return 'textura';
    return 'imagen';
  }
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'zip') return 'paquete';
  if (ext === 'json') return 'datos';
  if (ext === 'md') return 'nota';
  return 'otro';
}

const gitFiles = (root, args) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', 'ls-files', '-z', ...args],
  { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);

// Tracked plus not-yet-committed (non-ignored) files, so a check before commit sees new drops.
// `untracked` lists the new ones; without git every file counts as tracked.
export function listFiles(root) {
  try {
    const tracked = gitFiles(root, ['--cached', '--', ...Object.keys(AREAS)]);
    const untracked = new Set(gitFiles(root, ['--others', '--exclude-standard', '--', ...Object.keys(AREAS)]));
    const files = [...new Set([...tracked, ...untracked])].filter(f => existsSync(path.join(root, f))).sort();
    return Object.assign(files, { untracked });
  } catch {
    const out = [];
    const walk = dir => {
      if (!existsSync(path.join(root, dir))) return;
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p); else out.push(p);
      }
    };
    for (const area of Object.keys(AREAS)) walk(area);
    return Object.assign(out.sort(), { untracked: new Set() });
  }
}

function listCode(root, dirs) {
  try { return gitFiles(root, ['--cached', '--others', '--exclude-standard', '--', ...dirs]); } catch { return []; }
}

// Whether a declared path is in the repo. Gitignored output (shots/, .scratch/) does not count, so the
// answer is the same on every machine; without git it falls back to the disk.
function repoHas(root) {
  let all = null;
  try { all = new Set(gitFiles(root, ['--cached', '--others', '--exclude-standard'])); } catch {}
  const dirs = all && new Set([...all].flatMap(f => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  return p => all ? all.has(p) || dirs.has(p.replace(/\/$/, '')) : existsSync(path.join(root, p));
}

export async function scanAssets(root) {
  const read = p => readFileSync(path.join(root, p), 'utf8');
  const json = p => existsSync(path.join(root, p)) ? JSON.parse(read(p)) : null;
  const files = listFiles(root);
  const fileSet = new Set(files);
  const claims = new Map(), declared = [];
  // `declare` adds the path to the existence check; evidence may live outside git, so it is never declared.
  const claim = (raw, source, id, role, declare = false) => {
    const p = norm(raw);
    if (!p || p.includes('${')) return;
    if (declare) declared.push({ path: p, source, id });
    let hit = fileSet.has(p) ? [p] : files.filter(f => f.startsWith(p.endsWith('/') ? p : `${p}/`));
    // Code often keeps a base name and appends the variant (`wood-boards-v2` + `-mobile.webp`).
    if (!hit.length && (source === 'codigo' || source === 'herramienta') && !EXT_RE.test(p)) {
      hit = files.filter(f => f.startsWith(p) && /^[-._]/.test(f.slice(p.length)));
    }
    for (const f of hit) {
      const list = claims.get(f) ?? [];
      if (!list.some(c => c.source === source && c.id === id && c.role === role)) list.push({ source, id, role });
      claims.set(f, list);
    }
    return hit.length;
  };

  // Pieces: one art-catalog row per piece.
  const catalog = json('tools/art-catalog/catalog.json');
  const pieces = [];
  for (const row of catalog?.rows ?? []) {
    for (const f of row.files ?? []) claim(f.path, 'catalogo', row.id, f.role || 'archivo', true);
    for (const r of row.references ?? []) claim(r.path, 'catalogo', row.id, r.role === 'preview' ? 'preview' : 'referencia', true);
    for (const e of row.evidence ?? []) claim(e.path, 'catalogo', row.id, 'evidencia');
    pieces.push({ id: row.id, source: 'catalogo', name: row.name, group: row.category, kind: row.kind, state: row.state,
      priority: row.priority, nextStep: row.nextStep, destination: row.destination ?? [],
      preview: [...(row.references ?? []), ...(row.files ?? [])].map(r => norm(r.path)).find(p => /\.(webp|png|jpe?g)$/i.test(p) && fileSet.has(p)) ?? null });
  }
  const items = json('docs/art/items-index.json');
  for (const item of items?.items ?? []) {
    claim(item.reference, 'objetos', item.id, 'referencia', true);
    claim(item.intake, 'objetos', item.id, 'entrega', true);
    pieces.push({ id: `objeto-${item.id}`, source: 'objetos', name: item.label, group: item.group, kind: 'object',
      state: /optimizado|integrad/i.test(item.modelStatus) ? 'applied' : 'pending', nextStep: `${item.iconStatus} · ${item.modelStatus}`,
      notes: item.notes, intake: norm(item.intake), model: item.model, preview: norm(item.reference), destination: [] });
  }

  // What the game loads.
  const toAsset = s => { const p = norm(s); return p.startsWith('assets/') ? p : `assets/${p}`; };
  const manifest = json('assets/manifest.json');
  for (const entry of manifest?.assets ?? []) {
    for (const s of strings(entry).filter(s => EXT_RE.test(s) && !s.includes(' '))) claim(toAsset(s), 'manifest', entry.id, 'juego', true);
  }
  const editor = json('assets/editor/catalog.json');
  for (const entry of editor?.assets ?? []) {
    for (const s of strings(entry).filter(s => EXT_RE.test(s) && !s.includes(' '))) claim(toAsset(s), 'editor', entry.id, 'juego', true);
  }
  const thumbnails = json('assets/editor/thumbnails.json');
  for (const [id, entry] of Object.entries(thumbnails?.assets ?? {})) {
    for (const s of strings(entry).filter(s => EXT_RE.test(s) && !s.includes(' '))) claim(toAsset(s), 'editor', id, 'miniatura', true);
  }
  // The asset workshop's own catalogs; Unreal package paths in them (preview, source) are not repo files.
  for (const [file, role] of [['catalog', 'juego'], ['prepared', 'juego'], ['thumbnails', 'miniatura']]) {
    for (const entry of json(`assets/workshop/${file}.json`)?.entries ?? []) {
      for (const s of strings(entry).filter(s => EXT_RE.test(s) && !s.includes(' ') && norm(s).startsWith('assets/'))) claim(norm(s), 'taller', entry.id, role, true);
    }
  }
  let niagara = [];
  if (existsSync(path.join(root, 'src/editor/niagaraCatalog.js'))) {
    niagara = (await import(pathToFileURL(path.join(root, 'src/editor/niagaraCatalog.js')).href)).NIAGARA_CATALOG;
    for (const fx of niagara) if (fx.thumbnail) claim(fx.thumbnail, 'niagara', fx.id, 'miniatura', true);
  }
  for (const f of CATALOG_FILES) if (fileSet.has(f)) claim(f, 'sistema', 'catalogo-del-juego', 'datos');

  // Literal paths in game code, tools and docs.
  const code = listCode(root, ['src', 'server', 'index.html', 'styles', 'tools'])
    .filter(p => /\.(m?js|html|css|json|py)$/.test(p) && !p.startsWith('tools/art-catalog/catalog.json') && !p.startsWith('tools/asset-index/'));
  const usedBy = new Map();
  for (const p of code) {
    const game = !p.startsWith('tools/');
    for (const m of read(p).match(PATH_RE) ?? []) {
      claim(m, game ? 'codigo' : 'herramienta', p, game ? 'juego' : 'herramienta');
      if (game) { const k = norm(m); if (!usedBy.has(k)) usedBy.set(k, new Set()); usedBy.get(k).add(p); }
    }
  }
  for (const p of listCode(root, ['*.md'])) {
    const dir = path.posix.dirname(p);
    for (const m of read(p).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      let target;
      try { target = decodeURIComponent(path.posix.normalize(path.posix.join(dir, m[1].split(/[?#]/)[0]))); } catch { continue; }
      if (target.startsWith('assets/') || target.startsWith('docs/art/') || target.startsWith('materials/')) claim(target, 'doc', p, 'documento');
    }
  }

  // Per-file record and problems.
  const problems = [];
  const problem = (kind, p, detail) => problems.push({ key: `${kind} ${p}`, kind, path: p, ...(detail ? { detail } : {}) });
  const records = files.map(f => {
    const area = Object.entries(AREAS).find(([dir]) => f.startsWith(`${dir}/`))[1];
    const c = claims.get(f) ?? [];
    let bytes = 0; try { bytes = statSync(path.join(root, f)).size; } catch {}
    // materials/ is the author's inbox: any name is fine there until it is committed.
    if (area !== 'bandeja' && !NAME.test(path.posix.basename(f))) problem('nombre', f);
    if (area === 'juego' && !c.some(x => RUNTIME_CLAIMS.has(x.source))) problem('sin-ficha', f);
    if (area === 'fuente' && !c.length) problem('huerfano', f);
    if (area === 'bandeja' && !files.untracked.has(f)) problem('bandeja', f);
    if (area === 'juego' && /-(desktop|pc)\.[a-z0-9]+$/i.test(f) && !fileSet.has(f.replace(/-(desktop|pc)(\.[a-z0-9]+)$/i, '-mobile$2'))) problem('movil', f);
    const pieceIds = [...new Set(c.filter(x => x.source === 'catalogo' || x.source === 'objetos')
      .map(x => x.source === 'objetos' ? `objeto-${x.id}` : x.id))];
    return { path: f, area, type: fileType(f), bytes, pieces: pieceIds, ...(files.untracked.has(f) ? { untracked: true } : {}),
      roles: [...new Set(c.map(x => x.role))], sources: [...new Set(c.map(x => x.source))],
      usedBy: [...(usedBy.get(f) ?? [])].slice(0, 4) };
  });
  const has = repoHas(root);
  for (const d of declared) if (!fileSet.has(d.path) && !has(d.path)) problem('falta', d.path, `${d.source}:${d.id}`);
  const ids = (catalog?.rows ?? []).map(r => r.id);
  for (const [i, id] of ids.entries()) if (!KEBAB.test(id) || ids.indexOf(id) !== i) problem('id', `tools/art-catalog/catalog.json#${id}`);

  // Game catalog entries no row claims show up as pieces of their own.
  const rowClaimed = new Set(records.filter(r => r.pieces.length).map(r => r.path));
  for (const entry of manifest?.assets ?? []) {
    const own = strings(entry).filter(s => EXT_RE.test(s) && !s.includes(' ')).map(toAsset).filter(p => fileSet.has(p));
    if (own.length && own.every(p => !rowClaimed.has(p))) {
      pieces.push({ id: entry.id, source: 'manifest', name: entry.id.replace(/^[a-z]+:/, ''), group: 'Registro del juego',
        kind: entry.kind || 'model', state: 'applied', nextStep: 'Sin fila en el catálogo de arte: crear su ficha.', destination: [],
        preview: own.find(p => /\.(webp|png|jpe?g)$/i.test(p)) ?? null, files: own });
    }
  }
  for (const r of records) for (const p of pieces) if (p.files?.includes(r.path) && !r.pieces.includes(p.id)) r.pieces.push(p.id);
  const unique = [...new Map(problems.map(p => [p.key, p])).values()].sort((a, b) => a.key.localeCompare(b.key));
  return { root, files: records, pieces, niagara: { effects: niagara.length,
    categories: Object.fromEntries(Object.entries(niagara.reduce((m, fx) => (m[fx.category] = (m[fx.category] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1])) },
  problems: unique };
}

export function loadBaseline(root) {
  const p = path.join(root, 'tools/asset-index/baseline.json');
  return existsSync(p) ? new Set(JSON.parse(readFileSync(p, 'utf8')).problems) : new Set();
}

// New problems fail; inherited ones (baseline) are listed but tolerated until fixed.
export function compareBaseline(problems, baseline) {
  const now = new Set(problems.map(p => p.key));
  return { fresh: problems.filter(p => !baseline.has(p.key)), inherited: problems.filter(p => baseline.has(p.key)),
    resolved: [...baseline].filter(k => !now.has(k)) };
}
