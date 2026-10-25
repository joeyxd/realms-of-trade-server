import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { registerHooks } from 'node:module';

// Isolate this gate contract from T-1025-22's concurrent document validator. Only the HTTP/store imports use
// this identity validator; all other imports (including the server's validators) retain their native modules.
const parents = new Set(['../server/gmDraftHttp.mjs', '../server/gmDraftStore.mjs'].map(path => new URL(path, import.meta.url).href));
const stub = 'data:text/javascript,export function validateDocument(value) { return structuredClone(value); }';
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (parents.has(context.parentURL) && specifier === '../src/editor/document.js') return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { createGmDraftHandler } = await import('../server/gmDraftHttp.mjs');
const { createMemoryGmDraftMethods, createSupabaseGmDraftMethods } = await import('../server/gmDraftStore.mjs');
hooks.deregister();
const { createMemoryStore } = await import('../server/store.mjs');
const { createGameServer } = await import('../server/index.mjs');

const GM = '50000000-0000-4000-8000-000000000001';
const OP = '60000000-0000-4000-8000-000000000001';
const document = (version = 6) => ({ schema: 'marea.gm.map-draft', version,
  base: { seed: 42, revision: 'terrain-s21-v1' }, objects: [], baseOverrides: [],
  terrain: version === 6 ? { version: 4, tileSize: 70, domain: { minTx: -12, maxTx: 3, minTz: -4, maxTz: 3 }, tiles: [] }
    : { version: 3, tileSize: 70, tiles: [] } });
async function serve(handler, run) {
  assert.equal(await handler.prepare(), true);
  const server = http.createServer((req, res) => { void handler.handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const put = (url, version = 6) => fetch(`${url}/api/gm/draft`, { method: 'PUT',
  headers: { authorization: 'Bearer gm', 'content-type': 'application/json' },
  body: JSON.stringify({ operationId: OP, expectedRevision: 0, document: document(version) }) });
function fixture({ domains = async () => ({ version: 1 }), tiles = true, saveCode = null } = {}) {
  let saves = 0, probes = 0;
  const store = { durable: true, async checkGmDrafts() { return { version: 1 }; },
    async checkGmTerrainTiles() { return { version: tiles ? 1 : 0 }; },
    ...(domains === null ? {} : { async checkGmTerrainDomains() { probes++; return domains(); } }),
    async saveGmDraft(input) {
      saves++; if (saveCode) throw Object.assign(new Error('readiness changed'), { code: saveCode });
      return { ok: true, replay: false, head: { revision: 1, document: input.document, savedAt: new Date().toISOString() } };
    } };
  const handler = createGmDraftHandler({ store, resolvePlayer: async () => GM, accountIds: [GM],
    worldId: 'domains-http', seed: 42, validateReferences: () => true });
  return { handler, counts: () => ({ saves, probes }) };
}

test('v6 HTTP fails closed for absent, failed or malformed readiness, including absent SQL042', async () => {
  for (const options of [{ domains: null }, { domains: async () => { throw new Error('SQL044 absent'); } },
    { domains: async () => ({ version: 0 }) }, { tiles: false }]) {
    const f = fixture(options);
    await serve(f.handler, async url => {
      const response = await put(url);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, code: 'terrain_domains_not_ready' });
    });
    assert.equal(f.counts().saves, 0);
  }
});

test('v6 saves when ready; v5 never probes the domain RPC; a later store readiness failure stays 503', async () => {
  for (const version of [5, 6]) {
    const f = fixture();
    await serve(f.handler, async url => {
      const response = await put(url, version); assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).head.document, document(version));
    });
    assert.deepEqual(f.counts(), { saves: 1, probes: version === 6 ? 1 : 0 });
  }
  const f = fixture({ saveCode: 'terrain_domains_not_ready' });
  await serve(f.handler, async url => {
    const response = await put(url); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: 'terrain_domains_not_ready' });
  });
});

test('Supabase store probes domains only for v6 and refuses absent, malformed or failing SQL044', async () => {
  assert.deepEqual(await createMemoryGmDraftMethods().checkGmTerrainDomains(), { version: 1 });
  for (const result of [{ data: { version: 1 } }, { error: { code: '42883' } },
    { error: { code: '42501' } }, { data: { version: 1, extra: true } }, { data: null }]) {
    const calls = [];
    const store = createSupabaseGmDraftMethods({ async rpc(name, args) {
      calls.push(name);
      if (name === 'mn_gm_terrain_domains_ready') return result;
      if (name.endsWith('_ready')) return { data: { version: 1 } };
      return { data: { ok: true, replay: false, head: { revision: 1, document: args.p_request.document, savedAt: new Date().toISOString() } } };
    } });
    const input = { world: 'domains-http', owner: GM, operationId: OP, expectedRevision: 0, document: document() };
    if (result.data?.version === 1 && !result.data.extra) assert.equal((await store.saveGmDraft(input)).ok, true);
    else await assert.rejects(store.saveGmDraft(input), { code: 'terrain_domains_not_ready' });
    assert.deepEqual(calls.slice(0, 2), ['mn_gm_terrain_tiles_ready', 'mn_gm_terrain_domains_ready']);
    calls.length = 0;
    assert.equal((await store.saveGmDraft({ ...input, document: document(5) })).ok, true);
    assert.deepEqual(calls, ['mn_gm_terrain_tiles_ready', 'mn_save_gm_draft']);
  }
});

test('/status carries gmTerrainDomains true or false; missing SQL044 never blocks boot', async () => {
  for (const ready of [true, false, null]) {
    const store = createMemoryStore();
    if (ready === false) store.checkGmTerrainDomains = async () => { throw new Error('SQL044 absent'); };
    if (ready === null) delete store.checkGmTerrainDomains;
    const server = createGameServer({ port: 0, host: '127.0.0.1', seed: 42, bots: 0, store,
      saveSecret: 'terrain-domains-http-only', log() {} });
    const port = await server.listen();
    try {
      const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
      assert.equal(status.storage.gmTerrainDomains, ready === true);
    } finally { await server.close(); }
  }
});
