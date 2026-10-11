import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MAX_UPLOAD = 128 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.glb', '.gltf', '.bin', '.ktx2', '.json', '.blend', '.fbx', '.obj', '.mtl', '.zip', '.psd', '.tif', '.tiff', '.exr', '.md', '.txt']);
const ROLES = new Set(['reference', 'albedo', 'normal', 'roughness', 'metallic', 'ao', 'mask', 'opacity', 'emissive', 'model', 'mobile', 'source', 'preview', 'evidence']);
const STATES = new Set(['pending', 'reference', 'prepared', 'applied']);
const PATCH_LIMITS = { notes: 12000, state: 40, nextStep: 3000 };

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function safeName(input) {
  const raw = String(input || '');
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null;
  const base = raw.normalize('NFKC');
  const clean = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/[ .]+$/g, '').slice(0, 150);
  return clean && clean !== '.' && clean !== '..' ? clean : null;
}

function hasMagic(role, name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.glb') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length;
  if (ext === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.jpg' || ext === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === '.webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return true;
}

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function insideRealPath(root, relative) {
  const candidate = path.resolve(root, relative);
  const realRoot = await fs.realpath(root);
  const realFile = await fs.realpath(candidate);
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return null;
  return realFile;
}

export function createCatalogServer({ repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), catalogDir = path.join(repoRoot, 'tools', 'art-catalog') } = {}) {
  const root = path.resolve(repoRoot);
  const uiRoot = path.resolve(catalogDir);
  const catalogPath = path.join(uiRoot, 'catalog.json');
  const fileRoot = path.join(root, 'docs', 'art', 'catalog-files');
  let mutationTail = Promise.resolve();

  const serialize = (fn) => {
    const run = mutationTail.then(fn, fn);
    mutationTail = run.catch(() => {});
    return run;
  };

  async function loadCatalog() {
    const data = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    if (!data || !Array.isArray(data.rows) || !Number.isInteger(data.revision)) throw new Error('Formato de catálogo inválido');
    return data;
  }

  async function persist(data) {
    const temp = `${catalogPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temp, catalogPath);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  function allowedOrigin(req) {
    const host = req.headers.host;
    if (!host || !/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(host)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' && parsed.host.toLowerCase() === host.toLowerCase() && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    } catch { return false; }
  }

  async function serveStatic(req, res, pathname) {
    let relative;
    try { relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)); } catch { return json(res, 400, { error: 'Ruta inválida' }); }
    if (!/^[\w./-]+$/.test(relative) || relative.split('/').some((p) => p === '..')) return json(res, 404, { error: 'No encontrado' });
    const ext = path.extname(relative).toLowerCase();
    if (!new Set(['.html', '.css', '.js', '.json']).has(ext)) return json(res, 404, { error: 'No encontrado' });
    let file;
    try { file = await insideRealPath(uiRoot, relative); } catch { return json(res, 404, { error: 'No encontrado' }); }
    if (!file) return json(res, 404, { error: 'No encontrado' });
    const mime = ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' })[ext];
    res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(await fs.readFile(file));
  }

  async function serveFile(res, rawPath) {
    let relative;
    try { relative = decodeURIComponent(rawPath); } catch { return json(res, 400, { error: 'Ruta inválida' }); }
    const catalog = await loadCatalog();
    const approvedPath = /^(assets|shots|docs)\//.test(relative) || relative === 'PLAN-VISUAL-PORT.md';
    const listed = catalog.rows.some((row) => ['references', 'evidence', 'files'].some((field) => Array.isArray(row[field]) && row[field].some((entry) => entry === relative || entry?.path === relative)));
    if (!approvedPath || (!listed && relative !== 'PLAN-VISUAL-PORT.md') || relative.split('/').some((part) => part === '..' || part === '.')) return json(res, 404, { error: 'No encontrado' });
    let file;
    try { file = await insideRealPath(root, relative); } catch { return json(res, 404, { error: 'No encontrado' }); }
    if (!file) return json(res, 404, { error: 'No encontrado' });
    const ext = path.extname(file).toLowerCase();
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
    const name = path.basename(file);
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(name).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}` });
    res.end(await fs.readFile(file));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!allowedOrigin(req)) return json(res, 403, { error: 'Origen o host no permitido' });
      if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, await loadCatalog());
      if (req.method === 'GET' && url.pathname === '/api/export') return json(res, 200, await loadCatalog(), { 'Content-Disposition': 'attachment; filename="catalog.json"' });
      if (req.method === 'GET' && url.pathname.startsWith('/files/')) return await serveFile(res, url.pathname.slice('/files/'.length));
      const rowMatch = url.pathname.match(/^\/api\/rows\/([^/]+)$/);
      if (req.method === 'PATCH' && rowMatch) {
        let body;
        try { body = JSON.parse((await readBody(req, 256 * 1024)).toString('utf8')); } catch (error) { return json(res, error.status || 400, { error: error.status ? error.message : 'JSON inválido' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'JSON inválido' });
        return await serialize(async () => {
          const catalog = await loadCatalog();
          const row = catalog.rows.find((item) => String(item.id) === decodeURIComponent(rowMatch[1]));
          if (!row) return json(res, 404, { error: 'Fila desconocida' });
          if (!Number.isInteger(body.revision) || body.revision !== catalog.revision) return json(res, 409, { error: 'Revisión obsoleta', revision: catalog.revision });
          for (const [key, limit] of Object.entries(PATCH_LIMITS)) {
            if (Object.hasOwn(body, key)) {
              if (typeof body[key] !== 'string' || body[key].length > limit || (key === 'state' && !STATES.has(body[key]))) return json(res, 400, { error: `Campo inválido: ${key}` });
              row[key] = body[key];
            }
          }
          if (Object.keys(body).some((key) => !['revision', ...Object.keys(PATCH_LIMITS)].includes(key))) return json(res, 400, { error: 'Campo no permitido' });
          if (row.state === 'prepared' && !(Array.isArray(row.files) && row.files.length)) return json(res, 400, { error: 'Añade los archivos de esta pieza antes de marcarla como preparada' });
          if (row.state === 'applied' && !(Array.isArray(row.evidence) && row.evidence.length)) return json(res, 400, { error: 'Se requiere evidencia antes de aplicar' });
          catalog.revision += 1;
          catalog.updatedAt = new Date().toISOString();
          await persist(catalog);
          return json(res, 200, { catalog, row });
        });
      }
      const uploadMatch = url.pathname.match(/^\/api\/rows\/([^/]+)\/files$/);
      if (req.method === 'POST' && uploadMatch) {
        const role = url.searchParams.get('role');
        const name = safeName(url.searchParams.get('name'));
        const revision = Number(url.searchParams.get('revision'));
        const ext = name ? path.extname(name).toLowerCase() : '';
        if (!ROLES.has(role) || !name || !EXTENSIONS.has(ext) || !Number.isInteger(revision)
          || (['reference', 'preview'].includes(role) && !IMAGE_EXTENSIONS.has(ext))
          || (role === 'evidence' && !new Set([...IMAGE_EXTENSIONS, '.md', '.txt', '.json']).has(ext))) return json(res, 400, { error: 'Rol, nombre o revisión inválidos' });
        if (Number(req.headers['content-length']) > MAX_UPLOAD) return json(res, 413, { error: 'Cuerpo demasiado grande' });
        const bytes = await readBody(req, MAX_UPLOAD);
        if (!bytes.length || !hasMagic(role, name, bytes)) return json(res, 400, { error: 'Archivo vacío o firma de archivo inválida' });
        return await serialize(async () => {
          const catalog = await loadCatalog();
          const row = catalog.rows.find((item) => String(item.id) === decodeURIComponent(uploadMatch[1]));
          if (!row) return json(res, 404, { error: 'Fila desconocida' });
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(row.id))) return json(res, 400, { error: 'Identificador de fila inválido' });
          if (catalog.revision !== revision) return json(res, 409, { error: 'Revisión obsoleta', revision: catalog.revision });
          const storedName = `${randomUUID()}-${name}`;
          const relative = path.posix.join('docs/art/catalog-files', String(row.id), storedName);
          await fs.mkdir(fileRoot, { recursive: true });
          const realRoot = await fs.realpath(root);
          const realFileRoot = await fs.realpath(fileRoot);
          if (!realFileRoot.startsWith(realRoot + path.sep)) return json(res, 400, { error: 'Destino de archivos inválido' });
          const rowDirectory = path.join(realFileRoot, String(row.id));
          await fs.mkdir(rowDirectory, { recursive: true });
          const realRowDirectory = await fs.realpath(rowDirectory);
          if (!realRowDirectory.startsWith(realFileRoot + path.sep)) return json(res, 400, { error: 'Destino de archivos inválido' });
          const safeDestination = path.join(realRowDirectory, storedName);
          if (!safeDestination.startsWith(realFileRoot + path.sep)) return json(res, 400, { error: 'Destino de archivos inválido' });
          const stagedPath = safeDestination;
          await fs.writeFile(stagedPath, bytes, { flag: 'wx' });
          const entry = { role, path: relative, name, size: bytes.length };
          const target = role === 'evidence' ? 'evidence' : role === 'reference' || role === 'preview' ? 'references' : 'files';
          if (!Array.isArray(row[target])) row[target] = [];
          row[target].push(entry);
          catalog.revision += 1;
          catalog.updatedAt = new Date().toISOString();
          try { await persist(catalog); } catch (error) { await fs.rm(stagedPath, { force: true }).catch(() => {}); throw error; }
          return json(res, 201, { catalog, row, file: entry });
        });
      }
      if (req.method === 'GET') return await serveStatic(req, res, url.pathname);
      return json(res, 404, { error: 'No encontrado' });
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : 'Error interno' });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 5190;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Puerto inválido; usa un valor entre 1 y 65535.');
    process.exitCode = 1;
  } else {
    const server = createCatalogServer();
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} ya está ocupado.` : `No se pudo iniciar el catálogo: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Catálogo local disponible en http://127.0.0.1:${port}`));
  }
}
