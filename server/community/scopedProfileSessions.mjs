// Optional A1b2a authority seam: ordinary saves and contributions use the same scoped row.
// This is not mounted in GameHost. A future owner must stop gameplay mutations while busy,
// provide authenticated admission, and publish staged state synchronously at its tick boundary.
import {
  ContributionError, canonical, contributionCharacter, contributionProject, contributionRequest,
  contributionScopeKey,
} from './contributionContract.mjs';

const copy = value => structuredClone(value);
const fail = code => { throw new ContributionError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTENT = ['operationId', 'projectId', 'good', 'amount', 'expectedProjectVersion'];
function exact(value, fields) {
  canonical(value);
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) fail('input');
}
function binding(raw) {
  exact(raw, ['accountId', 'worldId', 'worldEpoch', 'characterId']);
  if (!UUID.test(raw.accountId) || raw.accountId === '00000000-0000-0000-0000-000000000000') fail('identity');
  contributionCharacter({ worldId: raw.worldId, worldEpoch: raw.worldEpoch, characterId: raw.characterId,
    version: 1, data: { v: 1, eco: { pack: { goods: {} } } } });
  return copy(raw);
}
function scopedCharacter(raw, identity) {
  const row = contributionCharacter(raw);
  if (row.worldId !== identity.worldId || row.worldEpoch !== identity.worldEpoch
    || row.characterId !== identity.characterId) fail('response');
  return row;
}
function outcome(raw, request) {
  try {
    if (raw?.ok === false) {
      exact(raw, ['ok', 'why', 'replay']);
      if (!['missing', 'scope', 'conflict', 'material', 'complete', 'goods', 'operation'].includes(raw.why)) fail('response');
    } else {
      exact(raw, ['ok', 'accepted', 'character', 'project', 'replay']);
      const c = scopedCharacter(raw.character, request), p = contributionProject(raw.project);
      if (raw.ok !== true || !Number.isSafeInteger(raw.accepted) || raw.accepted < 1 || raw.accepted > request.amount
        || c.version !== request.expectedCharacterVersion + 1 || p.version !== request.expectedProjectVersion + 1
        || p.worldId !== request.worldId || p.worldEpoch !== request.worldEpoch || p.projectId !== request.projectId) fail('response');
    }
    if (typeof raw.replay !== 'boolean' || (raw.why === 'operation' && raw.replay)) fail('response');
    return copy(raw);
  } catch { fail('response'); }
}

export class ScopedProfileSessions {
  constructor(store, { resolveBinding } = {}) {
    if (['loadCharacter', 'saveCharacter', 'commitContribution', 'loadContributionReceipt', 'loadProject']
      .some(name => typeof store?.[name] !== 'function') || typeof resolveBinding !== 'function') fail('configuration');
    this.store = store;
    this.resolveBinding = resolveBinding;
    this.clients = new Map();
    this.accounts = new Map();
    this.characters = new Map();
    this.draining = false;
  }

  // The resolver is trusted host code, not a client-supplied account or scope claim.
  async open(clientId) {
    if (typeof clientId !== 'string' || !clientId.length || clientId.length > 100 || this.clients.has(clientId)) fail('session');
    const identity = binding(this.resolveBinding(clientId));
    const key = contributionScopeKey(identity, identity.characterId);
    if (this.accounts.has(identity.accountId) || this.characters.has(key)) fail('session');
    const s = { clientId, identity, key, phase: 'loading', closed: false, row: null, token: null,
      operation: null, staged: null, running: false, reason: null };
    this.clients.set(clientId, s); this.accounts.set(identity.accountId, s); this.characters.set(key, s);
    try {
      const row = await this.current(s);
      if (s.closed || !this.live(s)) fail('identity');
      s.row = row; s.phase = 'ready'; s.token = Object.freeze({ revision: row.version });
      return this.view(clientId);
    } catch (err) { this.release(s); throw err; }
  }

  live(s) {
    try { return !s.closed && canonical(binding(this.resolveBinding(s.clientId))) === canonical(s.identity); }
    catch { return false; }
  }
  session(clientId) {
    const s = this.clients.get(clientId);
    if (!s) fail('session');
    return s;
  }
  canMutate(clientId) {
    const s = this.clients.get(clientId);
    return !!s && s.phase === 'ready' && this.live(s);
  }
  view(clientId) {
    const s = this.session(clientId);
    return { phase: s.closed ? 'closed' : s.phase, binding: copy(s.identity), character: copy(s.row),
      token: s.phase === 'ready' && this.live(s) ? s.token : null, reason: s.reason,
      pending: s.operation ? copy(s.operation) : null };
  }
  authorize(s, token) {
    if (!this.live(s)) { this.fence(s, 'identity'); fail('identity'); }
    if (s.phase !== 'ready') fail('busy');
    if (token !== s.token) fail('stale');
  }
  async current(s) {
    const row = await this.store.loadCharacter(s.identity.worldId, s.identity.worldEpoch, s.identity.characterId);
    if (!row) fail('missing');
    const checked = scopedCharacter(row, s.identity);
    if (s.row && checked.version < s.row.version) fail('response');
    return checked;
  }
  fence(s, reason) { s.phase = 'fenced'; s.reason = reason; s.token = null; s.staged = null; }
  release(s) {
    if (this.clients.get(s.clientId) === s) this.clients.delete(s.clientId);
    if (this.accounts.get(s.identity.accountId) === s) this.accounts.delete(s.identity.accountId);
    if (this.characters.get(s.key) === s) this.characters.delete(s.key);
  }
  async stage(s, result) {
    const row = await this.current(s);
    const acknowledged = result?.ok === true ? result.character : null;
    if (acknowledged && (row.version < acknowledged.version || (row.version === acknowledged.version
      && canonical(row) !== canonical(acknowledged)))) fail('response');
    let project = null;
    if (s.operation.kind === 'contribution') {
      const r = s.operation.request;
      const loaded = await this.store.loadProject(r.worldId, r.worldEpoch, r.projectId);
      if (loaded !== null) {
        project = contributionProject(loaded);
        if (project.worldId !== r.worldId || project.worldEpoch !== r.worldEpoch || project.projectId !== r.projectId
          || (result?.ok && (project.version < result.project.version || (project.version === result.project.version
            && canonical(project) !== canonical(result.project))))) fail('response');
      } else if (result?.ok) fail('response');
    }
    s.operation.settled = true;
    if (s.closed) { this.release(s); return; }
    // Keep historical receipt snapshots out of the publication event. Its only snapshots
    // are current rows; operation metadata acknowledges the fact, not a previous state.
    const summary = result?.ok ? { ok: true,
      ...(Object.hasOwn(result, 'accepted') ? { accepted: result.accepted } : {}),
      ...(Object.hasOwn(result, 'replay') ? { replay: result.replay } : {}),
    } : copy(result);
    s.staged = { character: row, project, outcome: summary };
    s.phase = 'pending'; s.reason = null;
  }
  async run(s, work) {
    s.running = true;
    try { return await work(); }
    catch (err) {
      this.fence(s, err instanceof ContributionError ? err.code : 'unavailable');
      return { ok: false, why: s.reason };
    } finally { s.running = false; }
  }

  save(clientId, token, data) {
    const s = this.session(clientId); this.authorize(s, token);
    const row = contributionCharacter({ ...s.row, data });
    if (row.version === 2147483647) fail('input');
    s.operation = { kind: 'save', row, settled: false };
    s.phase = 'saving'; s.token = null;
    return this.run(s, async () => {
      const result = await this.store.saveCharacter(row);
      if (result?.ok !== true) {
        if (!['missing', 'conflict'].includes(result?.why)) fail('response');
        s.operation.settled = true; this.fence(s, result.why);
        if (s.closed) this.release(s);
        return copy(result);
      }
      exact(result, ['ok', 'character']);
      if (canonical(result.character) !== canonical({ ...row, version: row.version + 1 })) fail('response');
      await this.stage(s, result);
      return copy(result);
    });
  }

  contribute(clientId, token, intent) {
    const s = this.session(clientId); this.authorize(s, token); exact(intent, INTENT);
    const request = contributionRequest({ ...intent, worldId: s.identity.worldId, worldEpoch: s.identity.worldEpoch,
      characterId: s.identity.characterId, expectedCharacterVersion: s.row.version });
    s.operation = { kind: 'contribution', request, settled: false };
    s.phase = 'contributing'; s.token = null;
    return this.run(s, async () => {
      let prior;
      try { prior = await this.receipt(s); }
      catch (err) {
        if (err?.code !== 'operation') throw err;
        // A verified UUID collision is a terminal rejection, not an ambiguous write.
        // No commit has been sent, and no other character's receipt is exposed.
        const rejected = { ok: false, why: 'operation', replay: false };
        await this.stage(s, rejected);
        return rejected;
      }
      // Repeated intent resolves its original revision; it does not invent a new request.
      const result = prior ? { ...prior.result, replay: true }
        : outcome(await this.store.commitContribution(request), request);
      await this.stage(s, result);
      return copy(result);
    });
  }

  async receipt(s, recovery = false) {
    const pending = s.operation.request;
    const raw = await this.store.loadContributionReceipt(pending.operationId);
    if (raw === null) return null;
    try {
      exact(raw, ['request', 'result']);
      const r = contributionRequest(raw.request);
      const fields = Object.keys(pending).filter(k => k !== 'expectedCharacterVersion');
      if (fields.some(k => r[k] !== pending[k]) || (recovery && canonical(r) !== canonical(pending))) fail('operation');
      const result = outcome(raw.result, r);
      if (result.replay || result.why === 'operation') fail('response');
      s.operation.request = r;
      return { request: r, result };
    } catch (err) { if (err?.code === 'operation') throw err; fail('response'); }
  }

  // No automatic retry. A missing receipt/current baseline leaves the character reserved.
  // Explicit retry uses the frozen request or original save CAS, never a fresh UUID/revision.
  recover(clientId, { retry = false } = {}) {
    const s = this.session(clientId);
    if (typeof retry !== 'boolean' || s.running || s.phase !== 'fenced' || !s.operation) fail('session');
    if (!s.closed && !this.live(s)) fail('identity');
    if (s.operation.settled && s.operation.kind === 'save') {
      if (!s.closed) fail('conflict');
      return this.run(s, async () => { await this.current(s); this.release(s); return { ok: true, recovered: true }; });
    }
    return this.run(s, async () => {
      let result = null;
      if (s.operation.kind === 'contribution') {
        const prior = await this.receipt(s, true);
        if (prior) result = { ...prior.result, replay: true };
        else if (retry) result = outcome(await this.store.commitContribution(s.operation.request), s.operation.request);
        else return { ok: false, why: 'pending' };
      } else {
        const before = s.operation.row;
        let row = await this.current(s);
        if (row.version === before.version) {
          if (!retry) return { ok: false, why: 'pending' };
          const response = await this.store.saveCharacter(before);
          if (response?.ok !== true && response?.why !== 'conflict') fail('response');
          row = await this.current(s);
          if (row.version <= before.version) fail('response');
        }
        // A higher revision makes a late original save's CAS harmless. Publish current state,
        // without pretending a read can identify which process committed an unreceipted save.
        if (row.version <= before.version) fail('response');
      }
      await this.stage(s, result);
      return result ?? { ok: true, recovered: true };
    });
  }

  // Promises only stage data. The owner calls drain at its synchronous publication boundary.
  // publish must be atomic and synchronous; it owns rollback if its own world writes throw.
  drain(publish) {
    if (typeof publish !== 'function' || publish.constructor?.name === 'AsyncFunction') fail('configuration');
    if (this.draining) fail('busy');
    this.draining = true;
    const emitted = [];
    try {
      for (const s of [...this.clients.values()]) {
        if (s.phase !== 'pending' || s.running || !s.staged) continue;
        if (!this.live(s)) { this.fence(s, 'identity'); continue; }
        const nextToken = Object.freeze({ revision: s.staged.character.version });
        const event = { clientId: s.clientId, binding: copy(s.identity), ...copy(s.staged), token: nextToken };
        s.phase = 'publishing';
        try {
          const returned = publish(event);
          if (returned && typeof returned.then === 'function') { Promise.resolve(returned).catch(() => {}); fail('publication'); }
          if (!this.live(s) || s.phase !== 'publishing') fail('identity');
          s.row = copy(s.staged.character); s.token = nextToken; s.staged = null;
          s.operation = null; s.phase = 'ready'; s.reason = null;
          emitted.push(s.clientId);
        } catch { this.fence(s, 'publication'); }
      }
      return emitted;
    } finally { this.draining = false; }
  }

  close(clientId) {
    const s = this.clients.get(clientId);
    if (!s) return;
    s.closed = true; s.token = null; s.staged = null;
    if (!s.running && (!s.operation || s.operation.settled)) this.release(s);
    else this.fence(s, 'closed');
  }
}
