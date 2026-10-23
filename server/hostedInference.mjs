// IC08 hosted inference (docs/briefs/ic08-hosted-inference.md): the owner registers an OpenAI-compatible
// endpoint in the game, the key is sealed on the data volume, and a hosted PairedCompanion runs the
// companion's mind on this server. Logs carry codes only: never a key, a URL, a prompt or a reply.
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { MSG } from '../src/net/protocol.js';
import { HOSTED_LIMITS, HOSTED_OPS, HOSTED_RATES, HOSTED_RATE_CLASS, HOSTED_WHY, validHostedRequest,
  validHostedRequestId, unavailableHostedState } from '../src/net/hostedInference.js';
import { parseGmAccountIds } from './gmSession.mjs';
import { createInferenceCenter } from './agent/inference-center.mjs';
import { createEgressGuard } from './agent/egress-guard.mjs';
import { PairedCompanion } from './agent/paired-companion.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sessionOwner = session => session.ownerKey ?? session.key;
const ACTIVE = new Set(['starting', 'running']);
const KNOWN_WHY = new Set(HOSTED_WHY);
const SEALED = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/;

/** AES-256-GCM with a random 12-byte IV; `aad` binds the ciphertext to its owner and endpoint. */
export function sealSecret(key, aad, plaintext) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

export function openSecret(key, aad, sealed) {
  const match = typeof sealed === 'string' ? SEALED.exec(sealed) : null;
  if (!match) throw new Error('sealed_invalid');
  const iv = Buffer.from(match[1], 'base64url'), body = Buffer.from(match[2], 'base64url');
  if (iv.length !== 12 || body.length < 16) throw new Error('sealed_invalid');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
}

/** Raw switches; the service validates them and reports 'misconfigured' instead of stopping the boot. */
export function hostedInferenceFromEnv(env) {
  return { enabled: env.MN_HOSTED_INFERENCE === '1', key: env.MN_HOSTED_INFERENCE_KEY, accounts: env.MN_HOSTED_INFERENCE_ACCOUNTS,
    max: env.MN_HOSTED_INFERENCE_MAX, dir: env.MN_HOSTED_INFERENCE_DIR };
}

function parseConfig({ enabled = false, key, accounts, max, dir } = {}) {
  if (enabled !== true) return { reason: 'disabled', max: 2 };
  let maxRunning = 2;
  if (max !== undefined && max !== null && max !== '') {
    maxRunning = typeof max === 'string' && /^[1-8]$/.test(max.trim()) ? Number(max.trim()) : Number.isInteger(max) ? max : NaN;
    if (!(maxRunning >= 1 && maxRunning <= 8)) return { reason: 'misconfigured', field: 'max', max: 2 };
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key.trim())) return { reason: 'misconfigured', field: 'key', max: maxRunning };
  let allowed = [];
  if (typeof accounts === 'string' && accounts.trim()) {
    try { allowed = parseGmAccountIds(accounts); } catch { return { reason: 'misconfigured', field: 'accounts', max: maxRunning }; }
  } else if (accounts !== undefined && accounts !== null && accounts !== '' && typeof accounts !== 'string') {
    return { reason: 'misconfigured', field: 'accounts', max: maxRunning };
  }
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { reason: 'misconfigured', field: 'dir', max: maxRunning };
  return { reason: null, key: Buffer.from(key.trim(), 'base64'), accounts: new Set(allowed), max: maxRunning, dir: path.resolve(dir) };
}

const mapWhy = why => why === null || why === undefined || why === 'ok' ? null
  : why === 'invalid_store' ? 'storage_error' : KNOWN_WHY.has(why) ? why : 'unavailable';

export class HostedInferenceService {
  // `egress` is a test seam only: production builds the strict fence and no switch relaxes it.
  constructor(host, { egress = null, ...config } = {}) {
    const parsed = parseConfig(config);
    Object.assign(this, { host, reason: parsed.reason, maxRunning: parsed.max, key: parsed.key ?? null,
      accounts: parsed.accounts ?? new Set(), dir: parsed.dir ?? null });
    if (egress !== null && typeof egress?.vet !== 'function') throw new TypeError('invalid hosted inference egress');
    this.egress = egress ?? createEgressGuard();
    this.centers = new Map(); this.entries = new Map(); this.rates = new Map();
    if (parsed.reason === 'misconfigured') host.log?.(`[hosted] misconfigured: ${parsed.field}`);
  }

  get enabled() { return this.reason === null; }
  principal(sock) { return this.host.companionControl?.principal(sock) ?? null; }
  gate(owner) { return this.reason ?? (this.accounts.has(owner) ? null : 'not_allowed'); }
  limits() { return { maxEndpoints: HOSTED_LIMITS.maxEndpoints, maxRunning: this.maxRunning }; }
  active() { return [...this.entries.values()].filter(entry => ACTIVE.has(entry.status)).length; }

  quota(owner, op) {
    const now = Date.now(), key = `${owner}:${HOSTED_RATE_CLASS[op]}`;
    for (const [id, row] of this.rates) if (now - row.at >= 60000) this.rates.delete(id);
    const row = this.rates.get(key);
    if (row && row.count >= HOSTED_RATES[op]) return false;
    this.rates.set(key, { at: row?.at ?? now, count: (row?.count ?? 0) + 1 });
    return true;
  }

  center(owner) {
    let pending = this.centers.get(owner);
    if (!pending) {
      const ownerHash = sha256(owner), key = this.key;
      pending = createInferenceCenter({ inferenceHome: path.join(this.dir, 'owners', ownerHash), egress: this.egress,
        maxEndpoints: HOSTED_LIMITS.maxEndpoints, sealer: {
          seal: (plaintext, id) => sealSecret(key, `${ownerHash}:${id}`, plaintext),
          open: (sealed, id) => openSecret(key, `${ownerHash}:${id}`, sealed) } });
      pending.catch(() => this.centers.delete(owner));
      this.centers.set(owner, pending);
    }
    return pending;
  }

  nameOf(owner, character) {
    const record = this.host.companionPairing?.owners?.get(owner)?.record;
    return record?.characterKey === character && typeof record.preset?.name === 'string' ? record.preset.name : null;
  }

  async state(owner) {
    const reason = owner ? this.gate(owner) : this.reason ?? 'not_allowed';
    if (reason) return unavailableHostedState(reason, this.maxRunning);
    const view = (await this.center(owner)).view();
    const companions = new Map();
    for (const row of this.host.agentControl?.listOwned(owner) ?? []) companions.set(row.characterKey, { character: row.characterKey,
      name: this.nameOf(owner, row.characterKey), status: 'stopped', endpointId: null, modelId: null, error: null });
    const entry = this.entries.get(owner);
    if (entry) companions.set(entry.character, { character: entry.character, name: entry.name ?? this.nameOf(owner, entry.character),
      status: entry.status, endpointId: entry.endpointId, modelId: entry.modelId, error: entry.error });
    return { available: true, reason: null,
      endpoints: view.endpoints.map(item => ({ id: item.id, label: item.label, baseUrl: item.baseUrl, keyHint: item.keyHint,
        defaultModel: item.defaultModel, models: item.models, catalogUpdatedAt: item.catalogUpdatedAt, catalogError: item.catalogError,
        usage: { requests: item.usage.requests, failures: item.usage.failures, promptTokens: item.usage.promptTokens,
          completionTokens: item.usage.completionTokens } })),
      companions: [...companions.values()].sort((a, b) => a.character.localeCompare(b.character)).slice(0, 16),
      limits: this.limits() };
  }

  current(sock, session) {
    const h = this.host;
    return h.sockets.get(sock.id) === sock && sock.ws?.readyState === 1 && !h.closing && (!session || this.principal(sock) === session);
  }

  handle(sock, message) {
    if (message?.t !== MSG.HOSTED_INFERENCE) return false;
    void this.dispatch(sock, message).catch(() => {});
    return true;
  }

  async dispatch(sock, message) {
    const session = this.principal(sock), owner = session ? sessionOwner(session) : null;
    const requestId = validHostedRequestId(message.requestId) ? message.requestId : null;
    const op = HOSTED_OPS.includes(message.op) ? message.op : null;
    const reply = async (why, test = null) => {
      let state;
      try { state = await this.state(owner); } catch { state = unavailableHostedState(this.reason ?? 'misconfigured', this.maxRunning); }
      if (!this.current(sock, session)) return;
      this.host.sendTo(sock.id, { t: MSG.HOSTED_INFERENCE_RESULT, requestId, op, ok: why === null, why, state, ...(test ? { test } : {}) });
    };
    if (!session) return reply('forbidden');
    if (!validHostedRequest(message)) return reply('invalid_request');
    const gate = this.gate(owner);
    if (gate) return reply(gate);
    if (!this.quota(owner, op)) return reply('busy');
    let result;
    try { result = await this.operate(sock, session, owner, message); } catch { result = { why: 'unavailable' }; }
    return reply(result.why, result.test ?? null);
  }

  async operate(sock, session, owner, message) {
    if (message.op === 'load') return { why: null };
    if (message.op === 'start') return this.start(sock, owner, message);
    if (message.op === 'stop') return this.stop(owner, message.character);
    const center = await this.center(owner);
    if (message.op === 'save') {
      const { id, label, baseUrl, defaultModel } = message.endpoint;
      return { why: mapWhy((await center.save({ id, label, baseUrl, defaultModel,
        ...(Object.hasOwn(message.endpoint, 'apiKey') ? { apiKey: message.endpoint.apiKey } : {}) })).why) };
    }
    if (message.op === 'delete') return { why: mapWhy((await center.delete(message.id)).why) };
    if (message.op === 'probe') { const result = await center.probe(message.id); return { why: result.ok ? null : mapWhy(result.why) }; }
    const result = await center.test(message.id, message.modelId, message.prompt);
    if (!result.ok) return { why: mapWhy(result.why) };
    return { why: null, test: { text: typeof result.text === 'string' ? result.text.slice(0, HOSTED_LIMITS.text) : '',
      usage: result.usage ?? null, latencyMs: result.latencyMs, servedModel: result.servedModel ?? null, modelMismatch: result.modelMismatch === true } };
  }

  port() { const address = this.host.wss?.options?.server?.address?.(); return Number.isInteger(address?.port) ? address.port : null; }
  origin(port) { return this.host.origins?.[0] ?? `http://127.0.0.1:${port}`; }

  async start(sock, owner, { character, endpointId, modelId }) {
    const previous = this.entries.get(owner) ?? null;
    if (previous && ACTIVE.has(previous.status)) return { why: previous.character === character ? 'busy' : 'limit' };
    if (this.active() >= this.maxRunning) return { why: 'limit' };
    const port = this.port();
    if (!port) return { why: 'unavailable' };
    // Reserved before any await so concurrent starts count it; nothing is pushed until a code exists.
    const entry = { owner, character, name: null, status: 'starting', endpointId, modelId, error: null, controller: null };
    this.entries.set(owner, entry);
    const pairing = this.host.companionPairing;
    const abort = (why, revoke = false) => {
      if (revoke) pairing?.revokeOwner(owner, 'revoked');
      if (this.entries.get(owner) === entry) { if (previous) this.entries.set(owner, previous); else this.entries.delete(owner); }
      return { why };
    };
    try {
      const resolved = await (await this.center(owner)).resolve(endpointId, modelId);
      if (!resolved.ok) return abort(mapWhy(resolved.why));
      if (!pairing || this.entries.get(owner) !== entry || entry.status !== 'starting' || this.host.closing) return abort('unavailable');
      const issued = await pairing.issueHosted(sock, character);
      if (issued?.why !== null || typeof issued.code !== 'string') return abort(mapWhy(issued?.why) ?? 'unavailable');
      if (this.entries.get(owner) !== entry || entry.status !== 'starting' || this.host.closing) return abort('unavailable', true);
      entry.name = this.nameOf(owner, character);
      entry.controller = new PairedCompanion({ directory: path.join(this.dir, 'owners', sha256(owner), 'companions', sha256(character)),
        url: `ws://127.0.0.1:${port}/ws`, modelId, maxCalls: 8, maxTokens: 262144,
        hosted: { origin: this.origin(port), endpointId, endpoint: { baseUrl: resolved.endpoint.baseUrl, apiKey: resolved.endpoint.apiKey },
          egress: this.egress } });
      void this.push(owner);
      void this.launch(entry, issued.code);
      return { why: null };
    } catch {
      return abort('unavailable', true);
    }
  }

  async launch(entry, code) {
    const controller = entry.controller;
    const started = await controller.start(code).catch(() => ({ ok: false }));
    if (this.entries.get(entry.owner) !== entry || entry.status !== 'starting' || entry.controller !== controller) { controller.close(); return; }
    if (!started.ok) {
      this.host.companionPairing?.revokeOwner(entry.owner, 'revoked');
      this.host.log?.('[hosted] companion failed: start');
      this.finish(entry, 'failed', 'unavailable');
      return;
    }
    entry.status = 'running';
    void this.push(entry.owner);
    await controller.waitForStop();
    // Revoked, owner left, expiry or a closed socket: the controller ended on its own.
    if (this.entries.get(entry.owner) === entry && entry.status === 'running' && entry.controller === controller) this.finish(entry, 'stopped', null);
  }

  finish(entry, status, error) {
    const controller = entry.controller;
    entry.status = status; entry.error = error; entry.controller = null;
    controller?.close();
    void this.push(entry.owner);
  }

  stop(owner, character) {
    const entry = this.entries.get(owner);
    if (!entry || entry.character !== character || !ACTIVE.has(entry.status)) return { why: null };
    this.finish(entry, 'stopped', null);
    this.host.companionPairing?.revokeOwner(owner, 'revoked');
    return { why: null };
  }

  async push(owner) {
    if (this.host.closing) return;
    let state;
    try { state = await this.state(owner); } catch { return; }
    for (const sock of this.host.sockets.values()) {
      const session = this.principal(sock);
      if (!session || sessionOwner(session) !== owner || !this.current(sock, session)) continue;
      this.host.sendTo(sock.id, { t: MSG.HOSTED_INFERENCE_RESULT, requestId: null, op: 'status', ok: true, why: null, state });
    }
  }

  // Host shutdown or a fenced world: every hosted controller ends; nothing is restored at boot.
  close() {
    for (const entry of this.entries.values()) {
      const controller = entry.controller;
      if (ACTIVE.has(entry.status)) { entry.status = 'stopped'; entry.error = null; }
      entry.controller = null;
      try { controller?.close(); } catch { /* already closed */ }
    }
  }
}
