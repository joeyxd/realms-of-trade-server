// Read-only local preview for the character bases; no game host or account storage.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = process.argv.find((item) => item.startsWith('--port='));
const port = arg ? Number(arg.slice(7)) : 5194;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const allowed = ['tools/character-lab/', 'tools/character-alpha-lab/', 'docs/art/source/character-alpha-v1/', 'tools/character-appearance-v1/', 'tools/characters-base-v3/head.mjs', 'docs/art/source/character-appearance-v1/', 'docs/art/source/characters-base-v0/', 'docs/art/source/characters-base-v1/', 'docs/art/source/characters-base-v2/', 'docs/art/source/characters-base-v3/', 'node_modules/three/'];

http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'tools/character-lab/index.html' : pathname.slice(1);
    const file = path.resolve(root, relative), normalized = path.relative(root, file).replaceAll('\\', '/');
    if (normalized.startsWith('../') || !allowed.some((prefix) => normalized.startsWith(prefix))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const bytes = await fs.readFile(file), type = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400); res.end('Preview file unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`Character lab: http://127.0.0.1:${port}`));
