import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalCompanion } from './local-companion.mjs';
import { DEFAULT_COMPANION_DRAFT, ROLE_TEMPLATES, PERSONALITY_TEMPLATES, TRAIT_TEMPLATES,
  COMPANION_LOOKS, validateCompanionDraft } from '../../src/net/companionTemplates.js';

const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fail = why => ({ ok: false, why });

export async function createCompanionStudio({ directory, baseUrl, modelId, port = 0,
  adapterFactory, initialCompanion = null } = {}) {
  const root = resolve(directory);
  const defaultDraft = validateCompanionDraft({ ...DEFAULT_COMPANION_DRAFT, skin: 1, baseUrl, modelId, thinkingMode: 'disabled' });
  let companion = initialCompanion, creating = false, closed = false, origin = null;
  const key = randomBytes(32).toString('hex');
  const staticFiles = new Map();
  for (const [route, file, mime] of [['/', 'index.html', 'text/html'], ['/index.html', 'index.html', 'text/html'],
    ['/main.js', 'main.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]) {
    staticFiles.set(route, { body: await readFile(new URL(`./companion-studio/${file}`, import.meta.url)), mime });
  }
  staticFiles.set('/companionTemplates.js', { body: await readFile(new URL('../../src/net/companionTemplates.js', import.meta.url)), mime: 'text/javascript' });
  staticFiles.set('/protocol.js', { body: await readFile(new URL('../../src/net/protocol.js', import.meta.url)), mime: 'text/javascript' });
  if (!companion) {
    try { await access(join(root, 'local-runtime.json')); companion = await LocalCompanion.open({ directory: root, ...(adapterFactory ? { adapterFactory } : {}) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function view() {
    const state = companion ? await companion.view() : { ok: true, created: false, draft: defaultDraft, scope: null,
      status: { state: 'not_created', connected: false, inFlight: false, public: false }, files: {}, budget: null, transcript: [] };
    return { ...state, models: [companion?.draft.modelId ?? modelId],
      templates: { roles: ROLE_TEMPLATES, personalities: PERSONALITY_TEMPLATES, traits: TRAIT_TEMPLATES }, looks: COMPANION_LOOKS };
  }
  function reply(response, status, result) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(result));
  }
  async function parseBody(request) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new Error('invalid_request');
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new Error('invalid_request'); chunks.push(chunk); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    try {
      if (closed || request.headers.host !== new URL(origin).host ||
        request.headers.origin !== undefined && request.headers.origin !== origin ||
        request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) {
        request.resume(); reply(response, 403, fail('origin_rejected')); return;
      }
      if (request.method === 'GET' && staticFiles.has(request.url)) {
        const asset = staticFiles.get(request.url); response.writeHead(200, { 'Content-Type': `${asset.mime}; charset=utf-8` }); response.end(asset.body); return;
      }
      const bearer = request.headers.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(bearer) ||
        !timingSafeEqual(Buffer.from(bearer.slice(7), 'hex'), Buffer.from(key, 'hex'))) {
        request.resume(); reply(response, 401, fail('unauthorized')); return;
      }
      if (request.method === 'GET' && request.url === '/api/state') { reply(response, 200, await view()); return; }
      if (request.method !== 'POST' || !['/api/create', '/api/start', '/api/stop', '/api/chat', '/api/remember', '/api/files', '/api/reenter',
        '/api/context/refresh', '/api/memory/compact', '/api/continuity'].includes(request.url)) {
        request.resume(); reply(response, 404, fail('route_unavailable')); return;
      }
      if (request.headers.origin !== origin) { request.resume(); reply(response, 403, fail('origin_required')); return; }
      const input = await parseBody(request), route = request.url;
      const fields = route === '/api/create' ? ['draft', 'limits'] : route === '/api/chat' ? ['text'] :
        route === '/api/memory/compact' ? ['sourceIds'] : route === '/api/continuity' ? ['autoCompact'] : [];
      if (!exact(input, fields)) { reply(response, 400, fail('invalid_request')); return; }
      if (route === '/api/memory/compact' && (!Array.isArray(input.sourceIds) || input.sourceIds.length < 1 || input.sourceIds.length > 8 ||
        new Set(input.sourceIds).size !== input.sourceIds.length || !input.sourceIds.every(id => typeof id === 'string' && /^episode:[a-f0-9]{64}$/.test(id))) ||
        route === '/api/continuity' && typeof input.autoCompact !== 'boolean') {
        reply(response, 400, fail('invalid_request')); return;
      }
      let result;
      if (route === '/api/create') {
        if (companion || creating) { reply(response, 409, fail('already_created')); return; }
        creating = true;
        try {
          companion = await LocalCompanion.create({ directory: root, draft: input.draft, limits: input.limits,
            ...(adapterFactory ? { adapterFactory } : {}) });
          result = await view();
        } finally { creating = false; }
      } else if (!companion) result = fail('not_created');
      else if (route === '/api/start') result = await companion.start();
      else if (route === '/api/stop') result = await companion.stop();
      else if (route === '/api/reenter') result = await companion.reenter();
      else if (route === '/api/chat') result = await companion.chat(input.text);
      else if (route === '/api/remember') result = await companion.remember();
      else if (route === '/api/context/refresh') result = await companion.refreshContext();
      else if (route === '/api/memory/compact') result = await companion.compactMemory(input.sourceIds);
      else if (route === '/api/continuity') result = companion.setContinuity(input);
      else result = await view();
      reply(response, result.ok ? 200 : 409, result);
    } catch { if (!response.headersSent && !response.destroyed) reply(response, 400, fail('invalid_request')); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000;
  // A chat request may wait for one bounded local inference. Stop has its own HTTP lane.
  server.timeout = 40000;
  return {
    get companion() { return companion; }, view,
    async listen() {
      if (origin || closed || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid_studio_port');
      await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
      origin = `http://127.0.0.1:${server.address().port}`;
      return { origin, key, url: `${origin}/#key=${key}` };
    },
    async close() { closed = true; await companion?.close();
      if (server.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); } },
  };
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('node tools/agent/companion-studio-server.mjs --directory NEW_OR_EXISTING_PATH --base-url http://127.0.0.1:8080/v1 --model MODEL [--port 8765]\n'); return;
  }
  const args = {};
  for (let n = 2; n < process.argv.length; n += 2) {
    const key = process.argv[n];
    if (!['--directory', '--base-url', '--model', '--port'].includes(key) || Object.hasOwn(args, key) || !process.argv[n + 1]) throw new Error('invalid_arguments');
    args[key] = process.argv[n + 1];
  }
  if (!args['--directory'] || !args['--base-url'] || !args['--model']) throw new Error('invalid_arguments');
  const directory = resolve(args['--directory']);
  await mkdir(resolve(directory, '..'), { recursive: true });
  const studio = await createCompanionStudio({ directory, baseUrl: args['--base-url'], modelId: args['--model'], port: Number(args['--port'] ?? 0) });
  const link = await studio.listen();
  process.stdout.write(JSON.stringify({ type: 'local_companion_studio', ...link, directory, public: false }) + '\n');
  const close = async () => { await studio.close(); process.exitCode = 0; };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('local_companion_studio_failed\n'); process.exitCode = 1; });
}
