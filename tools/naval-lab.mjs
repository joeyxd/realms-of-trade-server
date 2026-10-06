// A narrow loopback static server for the isolated D08 handling lab.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.ktx2': 'image/ktx2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream',
});

const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

function resolveRequestTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('#'))
    return { status: 400 };
  const q = rawUrl.indexOf('?');
  const rawPath = q < 0 ? rawUrl : rawUrl.slice(0, q);
  const rawQuery = q < 0 ? '' : rawUrl.slice(q + 1);
  // Lab assets use plain ASCII names. Reject all escapes (including double encoding), backslashes,
  // control bytes, and dot segments before URL parsing can normalize them away.
  if (!/^\/[A-Za-z0-9._/-]*$/.test(rawPath) || rawPath.includes('\\')) return { status: 400 };
  if (rawPath !== '/') {
    const segments = rawPath.slice(1).split('/');
    if (segments.at(-1) === '') segments.pop();
    if (!segments.length || segments.some((part) => !part || part === '.' || part === '..')) return { status: 400 };
  }
  if (rawQuery) {
    const params = new URLSearchParams(rawQuery);
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length || keys.some((key) => key !== 'v' && key !== 'mobile') || rawQuery.includes('#'))
      return { status: 400 };
    if (params.has('v') && !/^[A-Za-z0-9._-]{1,100}$/.test(params.get('v'))) return { status: 400 };
    const isLabPage = rawPath === '/' || rawPath === '/tools/naval-lab/' || rawPath === '/tools/naval-lab/index.html';
    if (params.has('mobile') && (!isLabPage || !['0', '1'].includes(params.get('mobile')))) return { status: 400 };
  }
  let pathname = rawPath;
  if (pathname === '/' || pathname === '/tools/naval-lab/') pathname = '/tools/naval-lab/index.html';
  return { pathname };
}

function allowedPrefix(relative, extension) {
  if (relative.startsWith('tools/naval-lab/')) return ['.html', '.css', '.js'].includes(extension);
  if (relative.startsWith('src/')) return extension === '.js';
  if (relative.startsWith('assets/')) return ['.json', '.glb', '.gltf', '.bin', '.ktx2', '.png', '.jpg', '.jpeg', '.webp'].includes(extension);
  if (relative === 'node_modules/three/build/three.module.js') return true;
  if (relative.startsWith('node_modules/three/examples/jsm/')) return extension === '.js';
  return false;
}

export function createNavalLabServer() {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end();
      return;
    }
    const parsed = resolveRequestTarget(req.url);
    if (parsed.status) { res.writeHead(parsed.status, { 'Cache-Control': 'no-store' }).end(); return; }
    const relative = parsed.pathname.slice(1);
    const extension = path.extname(relative);
    if (!allowedPrefix(relative, extension)) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }

    try {
      const repoReal = await fs.realpath(ROOT);
      const requested = path.resolve(ROOT, relative);
      if (!inside(ROOT, requested)) { res.writeHead(404).end(); return; }
      const realFile = await fs.realpath(requested);
      if (!inside(repoReal, realFile)) { res.writeHead(404).end(); return; }
      const candidatePrefixes = ['tools/naval-lab', 'src', 'assets', 'node_modules/three/build', 'node_modules/three/examples/jsm']
        .filter((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
      let contained = false;
      for (const prefix of candidatePrefixes) {
        try {
          const realPrefix = await fs.realpath(path.join(ROOT, prefix));
          if (inside(repoReal, realPrefix) && inside(realPrefix, realFile)) { contained = true; break; }
        } catch { /* An absent optional prefix cannot authorize a file. */ }
      }
      if (!contained) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
      const stat = await fs.stat(realFile);
      if (!stat.isFile()) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[extension], 'Content-Length': stat.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      const body = await fs.readFile(realFile);
      res.end(body);
    } catch {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
    }
  });
}

function portFromArgs(args) {
  const values = args.filter((arg) => arg.startsWith('--port='));
  if (values.length > 1) throw new Error('Use at most one --port value');
  if (!values.length) return 5180;
  const value = values[0].slice('--port='.length);
  if (!/^(0|[1-9]\d{0,4})$/.test(value) || Number(value) > 65535) throw new Error('Port must be an integer from 0 to 65535');
  return Number(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const port = portFromArgs(process.argv.slice(2));
    const server = createNavalLabServer();
    server.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      console.log(`Naval handling lab: http://127.0.0.1:${address.port}/tools/naval-lab/`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
