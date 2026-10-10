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
import { storeFromEnv, StoreError } from './store.mjs';
import { accountAuthFromEnv, publicAuthConfig } from './auth.mjs';
import { worldConfigFromEnv } from './worldState.mjs';
import { GAME } from '../src/data/meta.js';
import { chatFromEnv } from '../src/data/chat.js';
import { createWalletHttpHandler } from './web3/walletHttp.mjs';
import { walletLinkFromEnv } from './web3/walletRuntime.mjs';
import { createGmSessionHandler, parseGmAccountIds } from './gmSession.mjs';
import { createGmDraftHandler } from './gmDraftHttp.mjs';
import { createGmDraftValidator } from './gmDraftValidation.mjs';
import { createGmPublicationService } from './gmPublication.mjs';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_SDK = path.join(path.dirname(fileURLToPath(import.meta.resolve('@supabase/supabase-js'))), 'umd', 'supabase.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.ktx2': 'image/ktx2',
};
// Only the client is served: index.html, src/, styles/ and assets/ (imported models; never server/, tools/, .git…).
const PUBLIC = ['src', 'styles', 'assets'];

export function createGameServer({ port = 5173, host = '0.0.0.0', seed = GAME.seed, bots = 3, maxPlayers = 4, dev = false, lagMs = 0, jitterMs = 0, origins = [], log = console.log, root = ROOT, saveSecret: secret,
  store, resolvePlayer, joinTimeoutMs, initializeAccounts = false, publicAuth,
  worldId, worldSaveMs = 60000, pearlStaging = null, pearlStartup = null, chat = chatFromEnv(process.env), walletLink = null, agentControl = null, agentPilot = null,
  economicOperations = false, communityRequirements = null, gmAccountIds = null, resourceOperations = false, loggingOperations = false, artisanOperations = false, agentTrade = false,
  gmDraftsAllowMemory = false, groundTransactions = null } = {}) {
  // Saved games are signed with SAVE_SECRET (M4): the same secret after a restart = the same saves.
  const saves = hmacSaves(secret || saveSecret(process.env, log));
  const authConfig = publicAuthConfig(publicAuth);
  if (authConfig.enabled && !resolvePlayer) throw new Error('Account verifier is required');
  if (walletLink?.prepare !== undefined && typeof walletLink.prepare !== 'function') throw new StoreError('configuration');
  const walletHttp = walletLink === null ? null : createWalletHttpHandler({ service: walletLink, resolvePlayer });
  const gmSession = createGmSessionHandler({ resolvePlayer, accountIds: gmAccountIds });
  if (pearlStartup !== null && (!pearlStartup || typeof pearlStartup !== 'object' || Array.isArray(pearlStartup) ||
      !pearlStartup.journal || pearlStaging === null || worldId === undefined ||
      Object.keys(pearlStartup).some((key) => !['journal', 'accountPolicy', 'mapClock', 'pageSize', 'maxRows'].includes(key)))) throw new StoreError('configuration');
  if (worldId === undefined) worldId = 'marea-negra';
  const game = new GameHost({ seed, bots, maxPlayers, dev, lagMs, jitterMs, origins, log, saves, store, resolvePlayer, joinTimeoutMs, initializeAccounts, worldId, worldSaveMs, chat,
    pearlJournal: pearlStartup?.journal ?? null, agentControl, agentPilot, economicOperations, communityRequirements, resourceOperations, loggingOperations, artisanOperations, agentTrade, groundTransactions });
  let gmDrafts = null;
  if (resolvePlayer && gmAccountIds?.length && worldId !== null) {
    const baseRevision = 'terrain-s21-v1';
    const validateReferences = createGmDraftValidator({ map: game.server.world.map, baseRevision,
      manifest: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/manifest.json'), 'utf8')),
      editorCatalog: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/editor/catalog.json'), 'utf8')) });
    gmDrafts = createGmDraftHandler({ store: game.store, resolvePlayer, accountIds: gmAccountIds,
      worldId, seed: game.server.world.seed, baseRevision, validateReferences, allowMemory: gmDraftsAllowMemory,
      publication: createGmPublicationService({ root: ROOT, map: game.server.world.map, baseRevision, worldId,
        validateReferences, gameVersion: GAME.version, protocolVersion: PROTOCOL_VERSION }) });
  }
  // Trusted API option only; npm start deliberately leaves durable gameplay dispatch disabled.
  if (pearlStaging !== null) game.mountPearlStaging(pearlStaging);
  if (pearlStartup !== null) {
    const { journal, ...startupOptions } = pearlStartup;
    game.mountPearlStartup(startupOptions);
  }
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (p === '/api/gm/session') { void gmSession(req, res); return; }
    if (p === '/api/gm/draft' || p === '/api/gm/prepare') {
      if (gmDrafts) void gmDrafts.handle(req, res, { prepareRevision: p === '/api/gm/prepare' });
      else { res.writeHead(503, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }).end(JSON.stringify({ ok: false, code: 'gm_drafts_unavailable' })); }
      return;
    }
    if (walletHttp?.handles(p)) { void walletHttp.handle(req, res, p); return; }
    if (p === '/web3/wallet/config') {
      res.writeHead(req.method === 'GET' ? 200 : 405, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify({ enabled: false })); return;
    }
    if (p === '/health') { const ready = game.healthy(); res.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' }).end(ready ? 'ok' : 'storage unavailable'); return; }
    if (p === '/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ game: GAME.title, version: GAME.version, ...game.status() }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (p === '/auth/config') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(authConfig)); return;
    }
    if (p === '/auth/sdk.js' && authConfig.enabled) {
      fs.readFile(AUTH_SDK, (err, body) => {
        if (err) { res.writeHead(503).end(); return; }
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
        res.end(req.method === 'HEAD' ? undefined : body);
      }); return;
    }
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
  let listening;
  return {
    game, server,
    listen() {
      if (listening) return listening;
      listening = (async () => {
        if (walletLink?.prepare) await walletLink.prepare();
        if (game.closing) throw new Error('Server is closing');
        await game.prepare();
        if (gmDrafts) await gmDrafts.prepare();
        if (game.closing) throw new Error('Server is closing');
        return new Promise((resolve, reject) => {
          const failed = (err) => { server.removeListener('error', failed); reject(err); };
          server.once('error', failed);
          server.listen(port, host, () => {
            server.removeListener('error', failed);
            if (game.closing) { reject(new Error('Server is closing')); return; }
            game.start(); resolve(server.address().port);
          });
        });
      })();
      return listening;
    },
    async close() {
      const transport = new Promise((resolve) => server.close(() => resolve()));
      await Promise.all([game.close(), transport]);
    },
  };
}

// Entry point (npm start).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const localEnv = path.join(ROOT, '.env');
  const env = process.env, num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
  let gs, port;
  try {
    if (fs.existsSync(localEnv)) process.loadEnvFile(localEnv);
    const auth = accountAuthFromEnv(env), store = storeFromEnv(env);
    const walletLink = walletLinkFromEnv(env, { auth, gameStore: store });
    gs = createGameServer({
      port: num(env.PORT, 5173), host: env.HOST || '0.0.0.0', bots: num(env.BOTS, 3), maxPlayers: num(env.MAX_PLAYERS, 4),
      dev: env.DEV === '1', lagMs: num(env.LAG_MS, 0), jitterMs: num(env.JITTER_MS, 0),
      origins: (env.ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
      store, resolvePlayer: auth.resolvePlayer, publicAuth: auth.publicConfig, walletLink,
      gmAccountIds: parseGmAccountIds(env.GM_ACCOUNT_IDS),
      initializeAccounts: auth.publicConfig.enabled,
      economicOperations: env.MN_ECONOMIC_OPERATIONS === '1',
      resourceOperations: env.MN_RESOURCE_OPERATIONS === '1',
      loggingOperations: env.MN_LOGGING_OPERATIONS === '1',
      artisanOperations: env.MN_ARTISAN_OPERATIONS === '1',
      communityRequirements: env.MN_COMMUNITY_REQUIREMENTS ? JSON.parse(env.MN_COMMUNITY_REQUIREMENTS) : null,
      ...worldConfigFromEnv(env),
    });
    port = await gs.listen();
  }
  catch {
    console.error('[srv] startup failed: configuration, wallet readiness, world storage or listener unavailable');
    try { await gs?.close(); } catch { /* failed authority */ }
    process.exit(1);
  }
  console.log(`${GAME.title} v${GAME.version} · http://localhost:${port} · máx ${gs.game.maxPlayers} jugadores${env.DEV === '1' ? ' · DEV' : ''}${gs.game.lag.ms ? ` · lag ${gs.game.lag.ms}±${gs.game.lag.jitter} ms` : ''}`);
  if (env.MN_WEB3_WALLET_ENABLED === '1') console.log('[srv] wallet linking enabled · durable storage · EOA proof only');
  const stop = async (sig) => {
    console.log(`[srv] ${sig}: closing`);
    try { await gs.close(); process.exit(0); }
    catch { console.error('[srv] shutdown failed: storage'); process.exit(1); }
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
