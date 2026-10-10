// One M5 authority for profile + world + exact economic receipts. I/O never enters the simulation.
import { createHash } from 'node:crypto';
import { commerceCmd } from '../src/sim/systems/commerce.js';
import { raftCmd } from '../src/sim/systems/raftEditor.js';
import { Economy } from '../src/sim/economy/economy.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { MSG } from '../src/net/protocol.js';
import { pearlMutationGate } from './pearlMutationGate.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { communityAccess, draftCommunity, publicCommunity } from './communityProject.mjs';
import { StoreError } from './store.mjs';
import { CRAFT_RECIPES, HARVEST } from '../src/data/resources.js';
import { draftResource, applyResource, loggingAccounts } from './resourceState.mjs';
import { ARTISAN } from '../src/data/artisan.js';
import { artisanMutation, draftArtisan } from './artisanOperation.mjs';
import { restoreRaftCondition } from '../src/sim/naval/condition.js';
import { publicRafts } from '../src/sim/systems/rafts.js';

const clone = structuredClone;
const OP_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function economicOperationId(world, account, opId) {
  const h = createHash('sha256').update(JSON.stringify(['m5-economy-v1', world, account, opId])).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function economicCommand(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.opId !== 'string' || !OP_ID.test(msg.opId) ||
      (msg.t !== undefined && msg.t !== MSG.CMD)) throw new StoreError('operation');
  const fields = msg.type === 'commerce' ? {
    buy: ['town', 'g', 'n', 'expectedTotal'], sell: ['town', 'g', 'n', 'expectedTotal'],
    transfer: ['id', 'expectedRev', 'g', 'n', 'side'],
  }[msg.op] : msg.type === 'raft' ? { supply: ['id', 'expectedRev', 'g', 'n'],
    place: ['id', 'expectedRev', 'piece'], remove: ['id', 'expectedRev', 'piece', 'index'] }[msg.op] : msg.type === 'artisan' ? {
    list: [], learn: ['lesson', 'expectedRev', 'expectedProjectRev'],
  }[msg.op] : msg.type === 'community' ? {
    list: [], contribute: ['projectId', 'good', 'amount', 'expectedRev'],
  }[msg.op] : msg.type === 'resource' ? {
    gather: ['node', 'expectedRev'], craft: ['recipe', 'expectedRev', 'n'],
  }[msg.op] : null;
  if (!fields || Object.keys(msg).some(k => !['t', 'type', 'op', 'opId', ...fields].includes(k)) ||
      fields.some(k => !Object.hasOwn(msg, k) && !(msg.type === 'resource' && msg.op === 'craft' && k === 'n'))) throw new StoreError('operation');
  const out = Object.fromEntries(['type', 'op', 'opId', ...fields].map(k => [k, msg[k]]));
  if (msg.type === 'resource') {
    if (!Number.isSafeInteger(msg.expectedRev) || msg.expectedRev < (msg.op === 'gather' ? 1 : 0)
        || msg.expectedRev >= HARVEST.maxRev) throw new StoreError('operation');
    if (msg.op === 'gather') {
      if (typeof msg.node !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(msg.node)) throw new StoreError('operation');
    } else {
      if (!Object.hasOwn(msg, 'n')) out.n = 1;
      if (typeof msg.recipe !== 'string' || !Object.hasOwn(CRAFT_RECIPES, msg.recipe)
          || !Number.isSafeInteger(out.n) || out.n < 1 || out.n > CRAFT_RECIPES[msg.recipe].max) throw new StoreError('operation');
    }
  }
  if (msg.type === 'community' && msg.op === 'contribute' &&
      (typeof msg.projectId !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(msg.projectId) ||
       typeof msg.good !== 'string' || !/^[a-z_]{1,40}$/.test(msg.good) ||
       !Number.isSafeInteger(msg.amount) || msg.amount < 1 || msg.amount > 500 ||
       !Number.isSafeInteger(msg.expectedRev) || msg.expectedRev < 1 || msg.expectedRev >= 2147483647)) throw new StoreError('operation');
  if (msg.type === 'raft') {
    if (typeof msg.id !== 'string' || !/^[A-Za-z0-9:_-]{1,120}$/.test(msg.id) ||
        !Number.isSafeInteger(msg.expectedRev) || msg.expectedRev < 1 || msg.expectedRev >= 2147483647) throw new StoreError('operation');
    if (msg.op === 'supply') {
      if (!['madera', 'hierro'].includes(msg.g) || !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 10) throw new StoreError('operation');
    } else if (!Array.isArray(msg.piece) || msg.piece.length !== 5 || msg.piece[0] !== ARTISAN.part ||
        msg.piece.slice(1).some(v => !Number.isSafeInteger(v)) || Math.abs(msg.piece[1]) > 128 || Math.abs(msg.piece[2]) > 128 ||
        msg.piece[3] < 0 || msg.piece[3] > 2 || msg.piece[4] < 0 || msg.piece[4] > 3 ||
        msg.op === 'remove' && (!Number.isSafeInteger(msg.index) || msg.index < 0 || msg.index > 599)) throw new StoreError('operation');
  }
  if (msg.type === 'artisan' && msg.op === 'learn' && (msg.lesson !== ARTISAN.lesson ||
      !Number.isSafeInteger(msg.expectedRev) || msg.expectedRev < 0 || msg.expectedRev >= 2147483647 ||
      !Number.isSafeInteger(msg.expectedProjectRev) || msg.expectedProjectRev < 1 || msg.expectedProjectRev >= 2147483647)) throw new StoreError('operation');
  if (msg.type === 'commerce') {
    if (typeof msg.g !== 'string' || !/^[a-z_]{1,40}$/.test(msg.g) ||
        !Number.isSafeInteger(msg.n) || msg.n < 1 || msg.n > 500) throw new StoreError('operation');
    if (msg.op === 'transfer') {
      if (typeof msg.id !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(msg.id) ||
          !['deposit', 'withdraw'].includes(msg.side) || !Number.isSafeInteger(msg.expectedRev) ||
          msg.expectedRev < 1 || msg.expectedRev >= 2147483647) throw new StoreError('operation');
    } else if (typeof msg.town !== 'string' || !/^[a-z_]{1,32}$/.test(msg.town) ||
        !Number.isSafeInteger(msg.expectedTotal) || msg.expectedTotal < 0 || msg.expectedTotal > 1e9) throw new StoreError('operation');
  }
  return clone(out);
}

function draftCommerce(world, entity, command, profile) {
  const draft = Object.create(world);
  draft.profiles = new Map([[entity, clone(profile)]]);
  draft.economy = Economy.from(world.economy.serialize(), world.seed);
  draft.commerceReceipts = new Map(); draft.profileDirty = new Set();
  draft.raftEditReceipts = new Map();
  // Candidate construction needs the real geometry API for support/occupant checks, with an
  // independent projection so no preview can mutate the live deck before its receipt commits.
  draft.raftDeck = new world.raftDeck.constructor(world.map);
  draft.raftDeck.update(publicRafts(world));
  draft.rafts = new Map([...world.rafts].map(([id, record]) => {
    if (record.owner !== entity) return [id, record];
    const ship = draft.profiles.get(entity).eco.ships.find(s => s.id === id);
    return [id, { ...record, ship, condition: record.condition && clone(record.condition) }];
  }));
  const events = []; draft.emit = ev => events.push(clone(ev));
  // The ordinary helper owns prices, law, ownership, capacity and all gameplay preconditions.
  const helper = command.type === 'raft' ? raftCmd : commerceCmd;
  helper(draft, entity, command, p => !!sanitizeProfile(p) && Buffer.byteLength(JSON.stringify(p)) <= 131072);
  const ack = events.at(-1);
  if (!ack || ack.type !== (command.type === 'raft' ? 'raftEdit' : 'commerce')) throw new StoreError('effect');
  if (!Number.isSafeInteger(ack.rev)) ack.rev = 0;
  delete ack.to;
  return { profile: draft.profiles.get(entity), economy: draft.economy, ack };
}

export class EconomicAuthority {
  constructor(host) {
    if (!host.resolvePlayer || !host.worldState ||
        !/^[A-Za-z0-9:_-]{1,100}$/.test(host.worldState.id) ||
        !['loadEconomicOperation', 'commitEconomicOperation'].every(k => typeof host.store[k] === 'function')) throw new StoreError('configuration');
    this.host = host; this.active = null; this.failed = false; this.completed = 0; this.replays = 0;
    this.deferredCloses = new Set();
  }

  get busy() { return this.active !== null; }
  status() { return { enabled: true, pending: this.busy ? 1 : 0, failed: this.failed, completed: this.completed, replays: this.replays }; }

  reply(id, command, why, extra = {}) {
    const c = this.host.server.clients.get(id);
    if (!c?.entity) return;
    this.host.sendTo(id, { t: MSG.EVENT, ev: { type: command.type === 'raft' ? 'raftEdit' : command.type, to: c.entity,
      ...(command.type === 'raft' ? { id: command.id } : {}), op: command.op,
      opId: typeof command.opId === 'string' ? command.opId.slice(0, 64) : '', ok: false, why, rev: 0, ...extra } });
  }

  handle(sock, msg, agent = null) {
    if (msg.t !== MSG.CMD) return false;
    // This internal adapter is the only managed-agent mutation lane. Raw CMD stays closed.
    if (sock.agentIdentity && !agent) return true;
    const reject = (why, extra = {}) => agent ? agent.finish({ denial: why, ...extra }) : this.reply(sock.id, msg, why, extra);
    // Older clients must use the quoted, idempotent commerce command; never bypass the durable path.
    if (msg.type === 'market' && ['buy', 'sell'].includes(msg.op)) {
      this.host.sendTo(sock.id, { t: MSG.EVENT, ev: { type: 'tradeDenied', to: this.host.server.clients.get(sock.id)?.entity, why: 'command' } });
      return true;
    }
    if (!(msg.type === 'community' || msg.type === 'artisan' || msg.type === 'commerce' && ['buy', 'sell', 'transfer'].includes(msg.op) ||
        msg.type === 'raft' && (msg.op === 'supply' || artisanMutation(msg)) || this.host.resourceOperations && msg.type === 'resource')) return false;
    let command;
    try { command = economicCommand(msg); }
    catch { reject('command'); return true; }
    const h = this.host, c = h.server.clients.get(sock.id), s = h.profiles.clients.get(sock.id);
    if (!c?.entity) return true;
    if ((command.type === 'artisan' || artisanMutation(command)) && !h.artisanOperations) { reject('disabled'); return true; }
    if (command.op === 'list') {
      const why = this.busy ? 'busy' : !h.worldState.community ? 'disabled' : communityAccess(h.server.world, c.entity);
      this.reply(sock.id, command, why, { ok: !why, rev: h.server.world.profiles.get(c.entity)?.eco.tradeRev ?? 0,
        project: publicCommunity(h.worldState.community), durable: h.store.durable === true });
      return true;
    }
    if (!c.serverProfile || !s || s.closed || s.failed) { reject('account_required'); return true; }
    if (this.busy) {
      // A retry of the in-flight immutable command waits for its original result.
      if (this.active.id !== sock.id || canonicalText(this.active.command) !== canonicalText(command)) reject('busy');
      return true;
    }
    if (c.paused || h.pendingJoins || this.failed || !h.healthy() || !h.commandAvailable(sock.id, c.entity, { world: true, target: null })) {
      reject('busy'); return true;
    }
    try {
      const profile = capturePearlProfile(h.server.world, c.entity);
      const accounts = [...new Set([s.key, ...(h.loggingOperations
        ? loggingAccounts(h.worldState.resources, command, s.key, h.worldState.resourceTick()) : [])])].sort();
      const members = new Map(), lanes = { accounts, uids: [] };
      for (const account of accounts) {
        const session = h.profiles.accounts.get(account);
        if (!session) { members.set(account, { account }); continue; }
        const client = h.server.clients.get(session.id), entity = client?.entity;
        if (!entity || session.closed || session.failed) throw new StoreError('session');
        lanes.uids.push(...h.profileLanes(session.id, entity).uids);
        members.set(account, { account, s: session, c: client, entity, profile: account === s.key ? profile : capturePearlProfile(h.server.world, entity) });
      }
      const gate = pearlMutationGate(h.profiles), reservation = gate.reserve(lanes);
      const a = { id: sock.id, entity: c.entity, c, s, command, profile, reservation, gate,
        members, operationId: economicOperationId(h.worldState.id, s.key, command.opId), ready: false, request: null, agent };
      this.active = a;
      // Freeze the live economy/resource clock as this operation's confirmed baseline through
      // the existing world writer. A lesson/edit cannot change markets, nor restore an older
      // autosave's accumulator when ordinary ticks advanced since the last checkpoint.
      if (artisanMutation(command)) h.worldState.save(h.server.world.economy);
      h.worldState.operationBusy = true;
      if (agent) h.clearAgentInputs(sock.id);
      a.task = this.prepare(a).catch(() => { this.fence(a); });
    } catch { reject('storage'); }
    return true;
  }

  valid(a) {
    const h = this.host;
    return this.active === a && !this.failed && h.profiles.clients.get(a.id) === a.s && !a.s.failed && !a.s.closed &&
      h.server.clients.get(a.id) === a.c && a.c.entity === a.entity && h.server.world.profiles.has(a.entity) &&
      [...a.members.values()].every(m => !m.s || h.profiles.accounts.get(m.account) === m.s && !m.s.failed && !m.s.closed
        && h.server.clients.get(m.s.id) === m.c && m.c.entity === m.entity) &&
      a.gate.active(a.reservation);
  }

  cancelAgent(a, why = null) {
    if (!a.agent) return false;
    why ??= a.agent.check();
    if (!why) return false;
    a.denial = why; a.replay = true; a.ready = true;
    return true;
  }

  async agentBudget(a) {
    if (!a.agent) return null;
    return this.host.store.loadAgentGoodsBudget({ world: this.host.worldState.id,
      ownerId: a.agent.ownerId, characterId: a.s.key });
  }

  async prepare(a) {
    const h = this.host;
    // Settle old CAS writes before taking either version. New autosaves cannot enter this account/world.
    for (const m of a.members.values()) while (m.s?.running) await m.s.running;
    await h.worldState.flush();
    if (!this.valid(a)) throw new StoreError('cancelled');
    if (this.cancelAgent(a)) return;
    const prior = await (a.agent ? h.store.loadAgentTradeOperation(a.operationId) : h.store.loadEconomicOperation(a.operationId));
    if (!this.valid(a)) throw new StoreError('cancelled');
    if (this.cancelAgent(a)) return;
    if (prior) {
      // Historical evidence must retain the exact durable mandate identity, including after
      // revocation. Loading its current projection never installs a historical gameplay snapshot.
      if (a.agent) {
        a.budget = await this.agentBudget(a);
        if (!this.valid(a)) throw new StoreError('cancelled');
        if (this.cancelAgent(a)) return;
      }
      if (prior.request.world !== h.worldState.id || prior.request.account !== a.s.key ||
          a.agent && (prior.ownerId !== a.agent.ownerId || prior.budgetId !== a.budget?.budgetId) ||
          canonicalText(prior.request.command) !== canonicalText(a.command)) {
        a.ack = { type: a.command.type === 'raft' ? 'raftEdit' : a.command.type,
          ...(a.command.type === 'raft' ? { id: a.command.id } : {}),
          op: a.command.op, opId: a.command.opId, ok: false, why: 'duplicate', rev: a.profile.eco.tradeRev };
        if (a.agent) a.denial = 'duplicate';
      } else {
        a.ack = { ...clone(prior.result.ack), replay: true, historical: true };
        if (a.agent) a.agentReceipted = true;
        // Current project state is a separate observation; never hydrate from a historical receipt.
        if (a.command.type === 'community') a.ack.currentProject = publicCommunity(h.worldState.community);
        this.replays++;
      }
      a.replay = true; a.ready = true; return;
    }
    if (a.agent) {
      // A human receipt cannot be reinterpreted as agent spending, even with an identical command.
      if (await h.store.loadEconomicOperation(a.operationId)) { this.cancelAgent(a, 'duplicate'); return; }
      a.budget = await this.agentBudget(a);
      if (this.cancelAgent(a)) return;
      if (!a.budget?.enabled) { this.cancelAgent(a, 'budget'); return; }
      a.agent.budgetId = a.budget.budgetId;
    }
    // Persist the current baseline before the operation, using M5's existing writer and reservation.
    for (const m of a.members.values()) {
      if (m.s) {
        h.profiles.save(m.s.id, m.profile, a.reservation);
        while (m.s.running) await m.s.running;
        if (m.s.pending) throw new StoreError('cancelled');
        m.version = m.s.version;
      } else {
        const row = await h.store.loadProfile(m.account);
        const profile = row && sanitizeProfile(row.data);
        if (!profile || canonicalText(profile) !== canonicalText(row.data) || !Number.isSafeInteger(row.version)
            || row.version < 1 || row.version >= 2147483647) throw new StoreError('profile');
        m.profile = profile; m.version = row.version;
      }
    }
    if (!this.valid(a)) throw new StoreError('cancelled');
    if (this.cancelAgent(a)) return;
    let proposal;
    if (a.command.type === 'resource') {
      proposal = draftResource(h.server.world, a.entity, a.command, a.profile, h.worldState.resources, a.s.key,
        h.worldState.resourceTick(), new Map([...a.members].map(([key, member]) => [key, member.profile])));
      proposal.community = clone(h.worldState.community);
    } else if (a.command.type === 'artisan') {
      proposal = draftArtisan({ command: a.command, profile: clone(a.profile), state: clone(h.worldState.community),
        world: h.server.world, entity: a.entity });
      proposal.economy = h.server.world.economy;
    } else if (a.command.type === 'community') {
      proposal = draftCommunity({ command: a.command, profile: clone(a.profile), state: clone(h.worldState.community),
        world: h.server.world, entity: a.entity, worldId: h.worldState.id, account: a.s.key,
        profileVersion: a.s.version, operationId: a.operationId });
      proposal.economy = h.server.world.economy;
    } else {
      proposal = draftCommerce(h.server.world, a.entity, a.command, a.profile);
      proposal.community = clone(h.worldState.community);
      if (h.server.world.navalPilot?.aboard?.(a.entity)) {
        proposal.profile = clone(a.profile); proposal.economy = h.server.world.economy;
        proposal.ack = { type: a.command.type === 'raft' ? 'raftEdit' : 'commerce',
          ...(a.command.type === 'raft' ? { id: a.command.id } : {}),
          op: a.command.op, opId: a.command.opId, ok: false, why: 'navigation', rev: a.profile.eco.tradeRev };
      }
    }
    const data = h.worldState.snapshot(proposal.economy);
    if (proposal.community) data.community = clone(proposal.community);
    if (proposal.resources) data.resources = clone(proposal.resources);
    a.proposal = proposal;
    a.request = { world: h.worldState.id, account: a.s.key, command: a.command,
      expectedProfileVersion: a.s.version, expectedWorldVersion: h.worldState.version,
      profile: proposal.profile, worldData: data, ack: proposal.ack };
    if (artisanMutation(a.command)) a.request.before = clone(a.profile);
    if (h.loggingOperations && a.command.type === 'resource' && a.command.op === 'gather'
        && data.resources.nodes.find(n => n.id === a.command.node)?.kind === 'palm') {
      a.request.beneficiaries = [...proposal.profiles].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([account, profile]) => {
        const member = a.members.get(account);
        if (!member) throw new StoreError('effect');
        return { account, expectedVersion: member.version, before: clone(member.profile), profile: clone(profile) };
      });
    }
    // Last revocable preparation boundary. After dispatch an unknown commit must be reconciled,
    // even after stop; it may already have consumed the goods allowance atomically in M5.
    if (this.cancelAgent(a)) return;
    const commit = () => a.agent ? h.store.commitAgentTrade({ operationId: a.operationId, request: a.request,
      ownerId: a.agent.ownerId, budgetId: a.agent.budgetId }) :
      h.store.commitEconomicOperation({ operationId: a.operationId, request: a.request });
    let result;
    try { result = await commit(); }
    catch {
      // A timeout is ambiguous. Read evidence, then resend only the identical CAS request.
      const receipt = await (a.agent ? h.store.loadAgentTradeOperation(a.operationId) : h.store.loadEconomicOperation(a.operationId));
      if (receipt) {
        if (canonicalText(receipt.request) !== canonicalText(a.request) || a.agent &&
            (receipt.ownerId !== a.agent.ownerId || receipt.budgetId !== a.agent.budgetId)) throw new StoreError('operation');
        result = receipt.result;
      } else result = await commit();
    }
    if (a.agent && result?.ok === false && ['budget', 'operation'].includes(result.why)) {
      this.cancelAgent(a, result.why === 'budget' ? 'budget' : 'duplicate'); return;
    }
    if (!this.valid(a) || result?.ok !== true || result.profileVersion !== a.request.expectedProfileVersion + 1 ||
        result.worldVersion !== a.request.expectedWorldVersion + 1 || canonicalText(result.ack) !== canonicalText(a.request.ack)) throw new StoreError('conflict');
    a.result = result; a.ack = clone(result.ack);
    if (a.agent) {
      a.agentReceipted = true;
      // A projection failure cannot discard an already committed receipt or its gameplay apply.
      try { a.budget = await this.agentBudget(a); } catch { a.budget = null; }
    }
    a.ready = true;
  }

  drain() {
    const a = this.active;
    if (!a) return !this.failed;
    if (!a.ready) return false;
    if (!this.valid(a)) { this.fence(a); return false; }
    const h = this.host, w = h.server.world;
    try {
      if (!a.replay) {
        const p = w.profiles.get(a.entity), next = a.request.profile;
        if (a.command.type === 'resource') applyResource(w, a.entity, a.command, a.proposal);
        // Preserve live profile/raft object identities used by deterministic systems.
        p.gold = next.gold; p.eco.pack = clone(next.eco.pack); p.eco.tradeRev = next.eco.tradeRev;
        if (a.command.type === 'resource') p.tools = clone(next.tools);
        if (Object.hasOwn(next, 'progression')) p.progression = clone(next.progression);
        for (const ship of p.eco.ships) {
          const candidate = next.eco.ships.find(s => s.id === ship.id);
          if (candidate?.kind === 'raft') {
            ship.hold = clone(candidate.hold); ship.rev = candidate.rev;
            if (artisanMutation(a.command) && a.command.type === 'raft' && ship.id === a.command.id) {
              ship.grid = clone(candidate.grid);
              if (candidate.condition) {
                ship.condition = clone(candidate.condition);
                const active = w.rafts.get(ship.id), restored = restoreRaftCondition(ship.condition, ship.grid.parts);
                active.condition = restored.structure; active.conditionNext = restored.nextId;
              }
            }
          }
        }
        if (artisanMutation(a.command) && a.command.type === 'raft') w.raftDeck.update(publicRafts(w));
        const economy = Economy.from(a.request.worldData.economy, w.seed);
        economy.payUpkeep = w.economy.payUpkeep; economy.onAdvance = w.economy.onAdvance;
        w.economy = economy;
        h.worldState.community = clone(a.request.worldData.community ?? null);
        h.worldState.resources = clone(a.request.worldData.resources ?? null);
        a.s.version = a.result.profileVersion; a.s.confirmed = clone(next); a.s.last = JSON.stringify(next); a.s.pending = null;
        for (const row of a.request.beneficiaries ?? []) {
          const member = a.members.get(row.account);
          if (!member.s || member.s === a.s) continue;
          const live = w.profiles.get(member.entity);
          if (!live) throw new StoreError('effect');
          if (Object.hasOwn(row.profile, 'progression')) live.progression = clone(row.profile.progression);
          member.s.version = row.expectedVersion + 1; member.s.confirmed = clone(row.profile);
          member.s.last = JSON.stringify(row.profile); member.s.pending = null;
          w.profileDirty.add(member.entity);
        }
        h.worldState.version = a.result.worldVersion; h.worldState.last = JSON.stringify(a.request.worldData);
        h.worldState.pending = null;
        w.profileDirty.add(a.entity); this.completed++;
        for (const event of a.proposal?.events ?? []) w.emit(clone(event));
      }
      a.gate.release(a.reservation); a.released = true; h.worldState.operationBusy = false; this.active = null;
      // Publication follows confirmed rows and the synchronous apply, never the provider continuation.
      h.server.sendProfile(a.id, a.c);
      if (!a.replay) for (const row of a.request.beneficiaries ?? []) {
        const member = a.members.get(row.account);
        if (member.s && member.s !== a.s) h.server.sendProfile(member.s.id, member.c);
      }
      if (a.agent) a.agent.finish(a);
      else h.sendTo(a.id, { t: MSG.EVENT, ev: { ...a.ack, to: a.entity, durable: h.store.durable === true } });
      this.closeDeferred();
      return true;
    } catch { this.fence(a); return false; }
  }

  fence(a) {
    if (this.failed) return;
    this.failed = true;
    // Publication errors can occur after release; the world fence must still latch.
    if (a && !a.released) a.gate.fence(a.reservation);
    this.host.worldState.fail('operation');
    this.closeDeferred();
  }

  closeDeferred() {
    const sockets = [...this.deferredCloses]; this.deferredCloses.clear();
    for (const sock of sockets) this.host.onClose(sock, true);
  }

  async settle() { if (this.active?.task) await this.active.task; }
}
