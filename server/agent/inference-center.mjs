import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkedEndpointUrl, createEndpointOpenAITransport } from './endpoint-openai-transport.mjs';
import { pinnedRequestOptions } from './egress-guard.mjs';

const fail = why => ({ ok: false, why });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const model = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const empty = () => ({ v: 1, endpoints: [], active: null, catalog: {}, usage: {} });
const emptyUsage = () => ({ requests: 0, failures: 0, promptTokens: 0, completionTokens: 0, latencyMsTotal: 0, lastAt: null, lastError: null });

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const code = value => value === null || typeof value === 'string' && /^[a-z_]{1,64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;

function validStore(data) {
  if (!exact(data, ['v', 'endpoints', 'active', 'catalog', 'usage']) || data.v !== 1 ||
      !Array.isArray(data.endpoints) || data.endpoints.length > 32 || !record(data.catalog) || !record(data.usage)) return false;
  const ids = new Set();
  for (const endpoint of data.endpoints) {
    if (!exact(endpoint, ['id', 'label', 'baseUrl', 'apiKey', 'defaultModel', 'createdAt', 'updatedAt']) ||
        typeof endpoint.id !== 'string' || !/^[a-f0-9]{16}$/.test(endpoint.id) || ids.has(endpoint.id) ||
        typeof endpoint.label !== 'string' || !endpoint.label.trim() || endpoint.label.length > 64 ||
        typeof endpoint.apiKey !== 'string' || endpoint.apiKey.length > 512 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(endpoint.apiKey) ||
        !(endpoint.defaultModel === null || model(endpoint.defaultModel)) || !iso(endpoint.createdAt) || !iso(endpoint.updatedAt)) return false;
    if (checkedEndpointUrl(endpoint.baseUrl) !== endpoint.baseUrl) return false;
    if (endpoint.apiKey) http.validateHeaderValue('Authorization', `Bearer ${endpoint.apiKey}`);
    ids.add(endpoint.id);
  }
  for (const [id, catalog] of Object.entries(data.catalog)) {
    const fields = ['models', 'updatedAt', 'error'];
    if (!ids.has(id) || !exact(catalog, Object.hasOwn(catalog ?? {}, 'checkedAt') ? [...fields, 'checkedAt'] : fields) ||
        !Array.isArray(catalog.models) || catalog.models.length > 2500 || !catalog.models.every(id => typeof id === 'string') ||
        !(catalog.updatedAt === null || iso(catalog.updatedAt)) || !code(catalog.error) ||
        Object.hasOwn(catalog, 'checkedAt') && !iso(catalog.checkedAt)) return false;
  }
  for (const [id, usage] of Object.entries(data.usage)) {
    if (!ids.has(id) || !exact(usage, Object.keys(emptyUsage())) ||
        !['requests', 'failures', 'promptTokens', 'completionTokens', 'latencyMsTotal'].every(key => count(usage[key])) ||
        usage.failures > usage.requests || !(usage.lastAt === null || iso(usage.lastAt)) || !code(usage.lastError)) return false;
  }
  if (data.active !== null) {
    if (!exact(data.active, ['endpointId', 'modelId']) || !ids.has(data.active.endpointId) || !model(data.active.modelId)) return false;
  }
  return true;
}

// No redirects, background requests or provider error text are returned to the UI.
async function probeRequest(endpoint, suffix, egress = null) {
  const url = new URL(`${endpoint.baseUrl}${suffix}`);
  let pinned = {};
  if (egress) {
    // IC08: the hosted fence vets the URL and pins the connection to the vetted address.
    let vetted = null;
    try { vetted = await egress.vet(url.href); } catch { vetted = null; }
    if (!vetted?.ok) return fail(vetted?.why === 'transport_error' ? 'transport_error' : 'egress_blocked');
    pinned = pinnedRequestOptions(vetted);
  }
  return new Promise(done => {
    let settled = false, bytes = 0, incoming, timer;
    const chunks = [];
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer); done(result);
    };
    const req = (url.protocol === 'https:' ? https : http).request({
      hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: url.pathname,
      method: 'GET', agent: false, ...pinned, headers: { Accept: 'application/json', 'User-Agent': 'marea-negra-inference/1',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) },
    }, response => {
      incoming = response;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1_048_576) { finish(fail('response_too_large')); response.destroy(); req.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', () => finish(fail('transport_error')));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) { finish(fail('http_status')); return; }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Array.isArray(body.data) || !body.data.every(item => item && typeof item.id === 'string')) {
            finish(fail('invalid_response')); return;
          }
          finish({ ok: true, models: [...new Set(body.data.map(item => item.id))].sort().slice(0, 2500) });
        } catch { finish(fail('invalid_json')); }
      });
    });
    req.on('error', () => finish(fail('transport_error')));
    timer = setTimeout(() => { finish(fail('timeout')); incoming?.destroy(); req.destroy(); }, 10000);
    req.end();
  });
}

// IC08 hosted options (all absent in the PC Studio, whose behaviour and file format stay as they were):
// `sealer` { seal(apiKey, endpointId), open(sealed, endpointId) } keeps keys sealed on disk and plaintext only in memory;
// `egress` { vet(url) } fences probe and test requests; `maxEndpoints` caps the registry and answers 'limit'.
export async function createInferenceCenter({ inferenceHome = process.env.MN_INFERENCE_HOME || join(homedir(), '.marea-negra'),
  sealer = null, egress = null, maxEndpoints = null } = {}) {
  if (sealer !== null && (typeof sealer?.seal !== 'function' || typeof sealer?.open !== 'function') ||
      egress !== null && typeof egress?.vet !== 'function' ||
      maxEndpoints !== null && (!Number.isInteger(maxEndpoints) || maxEndpoints < 1 || maxEndpoints > 32)) throw new TypeError('invalid inference center options');
  const home = resolve(inferenceHome), file = join(home, 'inference.json');
  const decode = text => {
    const parsed = JSON.parse(text);
    if (sealer && Array.isArray(parsed?.endpoints)) for (const endpoint of parsed.endpoints) {
      if (endpoint && typeof endpoint.apiKey === 'string' && endpoint.apiKey) endpoint.apiKey = sealer.open(endpoint.apiKey, endpoint.id);
    }
    return parsed;
  };
  const encode = () => !sealer ? data : { ...data, endpoints: data.endpoints.map(endpoint =>
    ({ ...endpoint, apiKey: endpoint.apiKey ? sealer.seal(endpoint.apiKey, endpoint.id) : '' })) };
  let data = empty(), loadError = null;
  try {
    data = decode(await readFile(file, 'utf8'));
    if (!validStore(data)) throw new Error('invalid_store');
  } catch (error) {
    data = empty();
    if (error.code !== 'ENOENT') loadError = 'invalid_store';
  }
  let queue = Promise.resolve();
  function view() {
    return structuredClone({ endpoints: data.endpoints.map(({ apiKey, ...endpoint }) => ({ ...endpoint,
      keyHint: apiKey.length >= 8 ? apiKey.slice(-4) : null, models: data.catalog[endpoint.id]?.models ?? [],
      catalogUpdatedAt: data.catalog[endpoint.id]?.updatedAt ?? null, catalogCheckedAt: data.catalog[endpoint.id]?.checkedAt ?? null, catalogError: data.catalog[endpoint.id]?.error ?? null,
      usage: data.usage[endpoint.id] ?? emptyUsage() })), active: data.active, ...(loadError ? { error: loadError } : {}) });
  }
  async function persist() {
    await mkdir(home, { recursive: true });
    const temp = join(home, `.inference-${randomBytes(8).toString('hex')}.tmp`);
    try { await writeFile(temp, JSON.stringify(encode(), null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
  }
  function run(action) {
    if (loadError) return Promise.resolve(fail(loadError));
    const next = queue.then(async () => {
      const before = structuredClone(data);
      try { return await action(); }
      catch { data = before; return fail('storage_error'); }
    });
    queue = next.then(() => {});
    return next;
  }
  const find = id => data.endpoints.find(endpoint => endpoint.id === id);
  return {
    view,
    resolve(endpointId, modelId) {
      const next = queue.then(async () => {
        let current;
        try { current = await readFile(file, 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') current = JSON.stringify(empty()); else return fail('storage_error'); }
        try { current = decode(current); if (!validStore(current)) return fail('invalid_store'); }
        catch { return fail('invalid_store'); }
        if (typeof endpointId !== 'string' || !/^[a-f0-9]{16}$/.test(endpointId) || !model(modelId)) return fail('invalid_request');
        const endpoint = current.endpoints.find(item => item.id === endpointId);
        if (!endpoint) return fail('endpoint_unknown');
        if (endpoint.defaultModel !== modelId && !current.catalog[endpointId]?.models.includes(modelId)) return fail('model_unknown');
        return { ok: true, endpoint: { id: endpoint.id, baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey }, modelId };
      });
      queue = next.then(() => {});
      return next;
    },
    save(endpoint) { return run(async () => {
      const fields = ['id', 'label', 'baseUrl', 'defaultModel'];
      if (!exact(endpoint, Object.hasOwn(endpoint ?? {}, 'apiKey') ? [...fields, 'apiKey'] : fields) ||
          !(endpoint.id === null || typeof endpoint.id === 'string') || typeof endpoint.label !== 'string' ||
          !endpoint.label.trim() || endpoint.label.length > 64 ||
          !(endpoint.defaultModel === null || model(endpoint.defaultModel)) ||
          Object.hasOwn(endpoint, 'apiKey') && (typeof endpoint.apiKey !== 'string' || endpoint.apiKey.length > 512 || /[\u0000-\u001f\u007f-\u009f]/.test(endpoint.apiKey))) return fail('invalid_request');
      let baseUrl;
      try {
        baseUrl = checkedEndpointUrl(endpoint.baseUrl);
        if (endpoint.apiKey) http.validateHeaderValue('Authorization', `Bearer ${endpoint.apiKey}`);
      } catch { return fail('invalid_request'); }
      const old = endpoint.id === null ? null : find(endpoint.id);
      if (endpoint.id !== null && !old) return fail('endpoint_unknown');
      if (!old && maxEndpoints !== null && data.endpoints.length >= maxEndpoints) return fail('limit');
      if (!old && data.endpoints.length >= 32) return fail('invalid_request');
      const now = new Date().toISOString();
      const record = { id: old?.id ?? randomBytes(8).toString('hex'), label: endpoint.label.trim(), baseUrl,
        apiKey: endpoint.apiKey ?? old?.apiKey ?? '', defaultModel: endpoint.defaultModel, createdAt: old?.createdAt ?? now, updatedAt: now };
      if (old) {
        if (old.baseUrl !== record.baseUrl || old.apiKey !== record.apiKey) {
          delete data.catalog[old.id]; if (data.active?.endpointId === old.id) data.active = null;
        }
        data.endpoints[data.endpoints.indexOf(old)] = record;
        if (data.active?.endpointId === old.id && !data.catalog[old.id]?.models.includes(data.active.modelId) && data.active.modelId !== record.defaultModel) data.active = null;
      } else data.endpoints.push(record);
      await persist(); return { ok: true, id: record.id };
    }); },
    delete(id) { return run(async () => {
      if (!find(id)) return fail('endpoint_unknown');
      data.endpoints = data.endpoints.filter(endpoint => endpoint.id !== id);
      delete data.catalog[id]; delete data.usage[id];
      if (data.active?.endpointId === id) data.active = null;
      await persist(); return { ok: true };
    }); },
    probe(id) { return run(async () => {
      const endpoint = find(id); if (!endpoint) return fail('endpoint_unknown');
      let result = await probeRequest(endpoint, '/models', egress);
      if (!result.ok && result.why !== 'egress_blocked' && !endpoint.baseUrl.endsWith('/v1')) result = await probeRequest(endpoint, '/v1/models', egress);
      const checkedAt = new Date().toISOString();
      data.catalog[id] = { models: result.ok ? result.models : data.catalog[id]?.models ?? [],
        updatedAt: result.ok ? checkedAt : data.catalog[id]?.updatedAt ?? null, checkedAt, error: result.ok ? null : result.why };
      await persist(); return result;
    }); },
    select(id, modelId) { return run(async () => {
      if (!model(modelId)) return fail('invalid_request');
      const endpoint = find(id); if (!endpoint) return fail('endpoint_unknown');
      if (endpoint.defaultModel !== modelId && !data.catalog[id]?.models.includes(modelId)) return fail('invalid_request');
      data.active = { endpointId: id, modelId }; await persist(); return { ok: true };
    }); },
    test(id, modelId, prompt) { return run(async () => {
      if (!model(modelId) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) return fail('invalid_request');
      const endpoint = find(id); if (!endpoint) return fail('endpoint_unknown');
      const transport = createEndpointOpenAITransport({ endpoint, modelId, maxCalls: 1, maxOutputTokens: 256, timeoutMs: 30000,
        ...(egress ? { egress } : {}) });
      const result = await transport.generate({ messages: [{ role: 'user', content: prompt }] });
      const usage = data.usage[id] ?? emptyUsage();
      usage.requests++; usage.failures += result.ok ? 0 : 1;
      usage.promptTokens += result.usage?.inputTokens ?? 0; usage.completionTokens += result.usage?.outputTokens ?? 0;
      usage.latencyMsTotal += result.latencyMs; usage.lastAt = new Date().toISOString(); usage.lastError = result.ok ? null : result.why;
      data.usage[id] = usage; await persist();
      return { ok: result.ok, text: result.text?.slice(0, 2000) ?? null, usage: result.usage,
        latencyMs: result.latencyMs, status: result.status, why: result.why, servedModel: result.servedModel, modelMismatch: result.modelMismatch };
    }); },
  };
}
