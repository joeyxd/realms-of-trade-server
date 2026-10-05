// MAREA NEGRA game server: serves the client (static files) and runs the world (WebSocket /ws) in one
// process. Open http://localhost:5173 in two to four browsers and you share the island.
//   PORT=5173 MAX_PLAYERS=4 BOTS=3 DEV=0 ORIGINS=https://a.example,https://b.example
//   LAG_MS=60 JITTER_MS=10 (artificial latency per direction, for testing)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameHost } from './host.mjs';
import { hmacSaves, saveSecret } from './saves.mjs';
import { storeFromEnv } from './store.mjs';
import { GAME } from '../src/data/meta.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.ktx2': 'image/ktx2',
};
// Only the client is served: index.html, src/, styles/ and assets/ (imported models; never server/, tools/, .git…).
const PUBLIC = ['src', 'styles', 'assets'];

export function createGameServer({ port = 5173, host = '0.0.0.0', seed = GAME.seed, bots = 3, maxPlayers = 4, dev = false, lagMs = 0, jitterMs = 0, origins = [], log = console.log, root = ROOT, saveSecret: secret,
  store, resolvePlayer, joinTimeoutMs } = {}) {
  // Saved games are signed with SAVE_SECRET (M4): the same secret after a restart = the same saves.
  const saves = hmacSaves(secret || saveSecret(process.env, log));
  const game = new GameHost({ seed, bots, maxPlayers, dev, lagMs, jitterMs, origins, log, saves, store, resolvePlayer, joinTimeoutMs });
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return; }
    if (p === '/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ game: GAME.title, version: GAME.version, ...game.status() }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const rel = p === '/' ? 'index.html' : path.normalize(p).replace(/^[/\\]+/, '');
    const top = rel.split(/[/\\]/)[0];
    if (rel !== 'index.html' && !PUBLIC.includes(top)) { res.writeHead(404).end('not found'); return; }
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    // The page says it came from a game server (the client then plays online without probing).
    if (rel === 'index.html') {
      fs.readFile(file, 'utf8', (err, html) => {
        if (err) { res.writeHead(500).end(); return; }
        const body = html.replace('<head>', '<head>\n<meta name="mn-server" content="ws">');
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size, etag, 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  });
  game.attach(server, '/ws');
  return {
    game, server,
    listen() {
      return new Promise((resolve) => server.listen(port, host, () => { game.start(); resolve(server.address().port); }));
    },
    async close() {
      const transport = new Promise((resolve) => server.close(() => resolve()));
      await Promise.all([game.close(), transport]);
    },
  };
}

// Entry point (npm start).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env, num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
  const gs = createGameServer({
    port: num(env.PORT, 5173), host: env.HOST || '0.0.0.0', bots: num(env.BOTS, 3), maxPlayers: num(env.MAX_PLAYERS, 4),
    dev: env.DEV === '1', lagMs: num(env.LAG_MS, 0), jitterMs: num(env.JITTER_MS, 0),
    origins: (env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    store: storeFromEnv(env), // Account admission is inactive until P2 supplies the verifier.
  });
  const port = await gs.listen();
  console.log(`${GAME.title} v${GAME.version} · http://localhost:${port} · máx ${gs.game.maxPlayers} jugadores${env.DEV === '1' ? ' · DEV' : ''}${gs.game.lag.ms ? ` · lag ${gs.game.lag.ms}±${gs.game.lag.jitter} ms` : ''}`);
  const stop = async (sig) => { console.log(`[srv] ${sig}: closing`); await gs.close(); process.exit(0); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
