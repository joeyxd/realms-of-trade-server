import { StoreError, playerKey } from './store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { legacyKey } from './legacy.mjs';
import { PlayerCharacterStoreError } from './playerCharacterStore.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  vary: 'authorization', 'x-content-type-options': 'nosniff' };

// Account authentication and human character ownership are separate authorities.
// Neither a supplied profile nor a cosmetic selection can replace a saved profile.
export class PlayerCharacterService {
  constructor(host) { this.host = host; this.ready = false; this.inFlight = 0; this.rates = new Map(); this.creating = new Set(); }
  async prepare() {
    try { this.ready = this.host.initializeAccounts && (await this.host.store.checkPlayerCharacters()).version === 1; }
    catch { this.ready = false; }
  }
  async select(owner, id) {
    if (!this.ready) throw new StoreError('characters_unavailable');
    return this.host.store.selectPlayerCharacter(playerKey(owner), playerKey(id));
  }
  async resolve(owner, id) {
    if (!this.ready) throw new StoreError('characters_unavailable');
    owner = playerKey(owner); id = playerKey(id);
    const roster = await this.host.store.listPlayerCharacters(owner);
    const character = roster.characters.find(row => row.id === id);
    if (!character) throw new StoreError('forbidden');
    return character;
  }
  async create(owner, request) {
    const h = this.host;
    if (!this.ready || h.closing) throw new StoreError('characters_unavailable');
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(k => !['requestId', 'name', 'skin', 'mode', 'save'].includes(k)) ||
        typeof request.name !== 'string' || !request.name.trim() || request.name.trim().length > 16 ||
        /[\u0000-\u001f\u007f-\u009f<>]/.test(request.name) || !Number.isInteger(request.skin) ||
        request.skin < 0 || request.skin > 4 || !['new', 'legacy', 'import'].includes(request.mode)) throw new StoreError('invalid_request');
    playerKey(request.requestId); owner = playerKey(owner);
    const metadata = { requestId: request.requestId, name: request.name.trim(), skin: request.skin,
      weapon: request.skin === 2 ? 1 : 0, mode: request.mode };
    if (request.mode !== 'import' && Object.hasOwn(request, 'save')) throw new StoreError('invalid_request');
    if (h.profiles.owners.has(owner) || this.creating.has(owner)) throw new StoreError('session');
    this.creating.add(owner);
    try {
      if (request.mode === 'legacy') return await h.store.createPlayerCharacter(owner, metadata, null);
      let profile = newProfile({ weapon: request.skin === 2 ? 1 : 0, starter: h.profiles.starter });
      if (request.mode === 'import') {
        if (h.agentPilot || h.groundAuthority) throw new StoreError('legacy');
        profile = typeof request.save === 'string' && request.save.length <= 32768 ? h.server.saves.load(request.save) : null;
        const key = legacyKey(profile);
        if (profile.pirateId.startsWith('account:')) throw new StoreError('legacy_used');
        profile.pirateId = `account:${owner}`;
        return await h.withLegacy({ id: `characters:${owner}:${request.requestId}` }, key,
          () => h.store.createPlayerCharacter(owner, metadata, profile, key));
      }
      return await h.store.createPlayerCharacter(owner, metadata, profile);
    } finally { this.creating.delete(owner); }
  }
  quota(owner) {
    const now = Date.now();
    for (const [id, value] of this.rates) if (now - value.at > 60000) this.rates.delete(id);
    const rate = this.rates.get(owner) ?? { at: now, count: 0 };
    if (this.rates.size >= 128 && !this.rates.has(owner) || rate.count >= 30) return false;
    rate.count++; this.rates.set(owner, rate); return true;
  }
  async handle(req, res) {
    const send = (status, body) => { if (!res.destroyed && !res.writableEnded) res.writeHead(status, HEADERS).end(JSON.stringify(body)); };
    if (!['GET', 'POST'].includes(req.method)) { send(405, { ok: false, code: 'method' }); return; }
    if (!this.ready || this.host.closing || this.inFlight >= 32) { send(503, { ok: false, code: 'characters_unavailable' }); return; }
    const token = /^Bearer ([^\s]{1,8192})$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!token) { send(401, { ok: false, code: 'auth' }); return; }
    const abort = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new StoreError('characters_unavailable')); }, 10000); });
    const disconnected = () => abort.abort(); req.once('aborted', disconnected);
    this.inFlight++;
    try {
      const identity = await Promise.race([Promise.resolve().then(() => this.host.resolvePlayer(req, { token }, { signal: abort.signal }))
        .catch(() => { throw new StoreError('auth'); }), timeout]);
      if (!identity) throw new StoreError('auth');
      const owner = playerKey(identity);
      if (this.host.agentControl?.binding(owner)) throw new StoreError('auth');
      if (!this.quota(owner)) { send(429, { ok: false, code: 'busy' }); return; }
      if (req.method === 'GET') {
        const roster = await Promise.race([this.host.store.listPlayerCharacters(owner), timeout]);
        send(200, { ok: true, ...roster, limit: 3 }); return;
      }
      const body = await Promise.race([(async () => {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 40000) throw new StoreError('invalid_request'); chunks.push(chunk); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new StoreError('invalid_request'); }
      })(), timeout]);
      if (abort.signal.aborted) throw new StoreError('characters_unavailable');
      const character = await Promise.race([this.create(owner, body), timeout]);
      send(200, { ok: true, character });
    } catch (err) {
      const code = (err instanceof StoreError || err instanceof PlayerCharacterStoreError) && ['auth', 'session', 'invalid_request', 'legacy', 'legacy_used', 'legacy_active',
        'limit', 'operation', 'legacy_required', 'characters_unavailable', 'forbidden'].includes(err.code) ? err.code : 'characters_unavailable';
      send(code === 'auth' ? 401 : code === 'forbidden' ? 403 : code === 'characters_unavailable' ? 503 : 409, { ok: false, code });
    } finally { clearTimeout(timer); req.removeListener('aborted', disconnected); this.inFlight--; }
  }
}
