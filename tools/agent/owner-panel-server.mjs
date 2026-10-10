import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createBudgetAdministration } from './persistent-budget.mjs';
import { createMemoryAdministration } from './memory-admin.mjs';
import { createOwnedRunner } from './owned-runner.mjs';

const ASSETS = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'], '/main.js': ['main.js', 'text/javascript; charset=utf-8'] };
const NAMES = { personality: 'personality.md', objectives: 'objectives.json', memory: 'memory.jsonl' };
const fail = (why) => ({ ok: false, why });
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const unavailable = () => ({ state: 'unavailable', processRunning: false, model: null, authority: null,
  inFlight: false, requests: null, observation: null, tasks: [], activity: [], termination: null, lastError: 'runner_not_configured' });
const inert = { inspect: async () => unavailable(), start: async () => fail('runner_not_configured'),
  stop: async () => ({ ...fail('runner_not_configured'), confirmed: false, confirmation: 'unproven' }),
  think: async () => fail('runner_not_configured'), close: async () => {} };

// Loopback administration is explicitly separate from game admission and server-owned grants.
export async function createOwnerPanel({ directory, budgetDirectory, scope, runner, runnerOptions } = {}) {
  const fixedScope = structuredClone(scope);
  const budget = createBudgetAdministration({ directory: budgetDirectory, scope: fixedScope });
  const panelBudget = async () => {
    const result = await budget.inspect();
    // This panel and its child runner still describe lab units and simulated inference only.
    return result.ok && result.snapshot.persistence.schema !== 'agent-inference-budget/v1' ?
      fail('native_budget_panel_unsupported') : result;
  };
  const memory = createMemoryAdministration({ directory, scope: fixedScope });
  const owned = runner ?? (runnerOptions ? createOwnedRunner({ ...runnerOptions, directory, budgetDirectory, scope: fixedScope }) : inert);
  if (['inspect', 'start', 'stop', 'think', 'close'].some((method) => typeof owned[method] !== 'function')) throw new Error('invalid_runner_configuration');
  const key = randomBytes(32).toString('hex');
  let origin = null, mutating = Promise.resolve(), closed = false;
  const serial = (operation) => { const next = mutating.then(operation, operation); mutating = next.catch(() => {}); return next; };
  const staticFiles = Object.fromEntries(await Promise.all(Object.entries(ASSETS).map(async ([route, [file, mime]]) =>
    [route, { data: await readFile(new URL(`./owner-panel/${file}`, import.meta.url)), mime }])));
  function headers(response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  }
  function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
  }
  function authenticated(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(authorization)) return false;
    return timingSafeEqual(Buffer.from(authorization.slice(7), 'hex'), Buffer.from(key, 'hex'));
  }
  async function body(request) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new Error('invalid_content_type');
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length; if (size > 16384) throw new Error('request_too_large'); chunks.push(chunk);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error('invalid_json'); }
  }
  async function files() {
    const result = await memory.files();
    if (!result.ok) return result;
    return { ok: true, files: Object.fromEntries(Object.entries(NAMES).map(([kind, filename]) => {
      const entry = result.files[kind];
      return [kind, { filename, content: entry.content, bytes: entry.bytes, sha256: entry.sha256,
        ...(entry.revision === undefined ? {} : { revision: entry.revision }) }];
    })) };
  }
  const server = createServer(async (request, response) => {
    headers(response); request.setTimeout(10000, () => request.destroy());
    try {
      if (closed || request.headers.host !== new URL(origin).host || request.headers.origin !== undefined && request.headers.origin !== origin ||
          request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) {
        request.resume(); json(response, 403, fail('origin_rejected')); return;
      }
      const raw = request.url;
      if (request.method === 'GET' && Object.hasOwn(staticFiles, raw)) {
        const asset = staticFiles[raw]; response.writeHead(200, { 'Content-Type': asset.mime }); response.end(asset.data); return;
      }
      if (!authenticated(request)) { request.resume(); json(response, 401, fail('owner_access_required')); return; }
      if (raw.includes('?') || raw.includes('#')) { request.resume(); json(response, 400, fail('invalid_route')); return; }
      if (request.method === 'GET' && raw === '/api/view') {
        const [runnerView, budgetView, fileView] = await Promise.all([owned.inspect(), panelBudget(), files()]);
        json(response, 200, { ok: true, scope: fixedScope, capturedAtMs: Date.now(), runner: runnerView, budget: budgetView, files: fileView }); return;
      }
      if (request.method === 'GET' && Object.keys(NAMES).some((kind) => raw === `/api/download/${kind}`)) {
        const kind = raw.slice('/api/download/'.length), exported = await memory.exportFiles();
        if (!exported.ok) { json(response, 409, exported); return; }
        const entry = exported.bundle.files[kind];
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${NAMES[kind]}"`,
          'X-Content-SHA256': entry.sha256 }); response.end(Buffer.from(entry.content, 'base64')); return;
      }
      if (request.method !== 'POST' || !['/api/configure', '/api/start', '/api/stop', '/api/think'].includes(raw)) {
        request.resume(); json(response, 404, fail('route_unavailable')); return;
      }
      if (request.headers.origin !== origin) { request.resume(); json(response, 403, fail('origin_required')); return; }
      if (Number(request.headers['content-length']) > 16384) { request.resume(); json(response, 413, fail('request_too_large')); return; }
      const input = await body(request);
      if (!exact(input, raw === '/api/configure' ? ['expectedRevision', 'enabled', 'limits'] : [])) {
        json(response, 400, fail('invalid_request')); return;
      }
      let result;
      if (raw === '/api/configure') result = await serial(async () => {
        const current = await panelBudget();
        return current.ok ? budget.configure(input) : current;
      });
      else if (raw === '/api/start') {
        const [fileView, budgetView] = await Promise.all([files(), panelBudget()]);
        result = !fileView.ok ? fileView : !budgetView.ok ? budgetView : await owned.start();
      } else if (raw === '/api/think') {
        const current = await panelBudget(); result = current.ok ? await owned.think() : current;
      } else result = await owned.stop();
      json(response, result.ok ? 200 : 409, result);
    } catch (error) {
      const why = ['invalid_content_type', 'request_too_large', 'invalid_json'].includes(error?.message) ? error.message : 'owner_panel_unavailable';
      if (!response.headersSent && !response.destroyed) json(response, why === 'request_too_large' ? 413 : 400, fail(why));
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return {
    async listen(port = 0) {
      if (closed || origin || !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('invalid_panel_port');
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      return { origin, key, url: `${origin}/#key=${key}` };
    },
    async close() {
      closed = true; await mutating; await owned.close();
      if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    },
  };
}
