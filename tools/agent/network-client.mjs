import { GameClient } from '../../src/client/gameClient.js';
import { randomUUID } from 'node:crypto';
import { WsTransport } from '../../src/net/wsTransport.js';
import { ENT, MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { PLAYER_FIELDS, KIND } from '../../src/sim/ecs.js';
import { BTN } from '../../src/sim/systems/movement.js';
import { generateWorld } from '../../src/sim/worldgen.js';
import { DT } from '../../src/data/tuning.js';
import { AgentSession } from './session.mjs';
import { AgentChat } from './chat.mjs';
import { AgentInventory } from './inventory.mjs';
import { AgentMarket } from './market.mjs';
import { labLimits, validGrant, integer } from './contract.mjs';

const fields = Object.fromEntries(PLAYER_FIELDS.map((name, i) => [name, i]));
const neutral = () => ({ mx: 0, mz: 0, ax: 0, az: 0, btn: 0, prs: 0, w: 0 });
const kinds = { [KIND.PLAYER]: 'player', [KIND.NPC]: 'npc', [KIND.ENEMY]: 'enemy' };
const copy = (v) => structuredClone(v);
const clock = () => Math.floor(performance.timeOrigin + performance.now());

// Ordinary inputs only. An optional authenticated policy supplies the server controller grant.
export class AgentNetworkClient {
  #t; #client = null; #session; #chat; #limits; #now; #feedback; #state = 'idle';
  #metadata = new Map(); #birth = 0; #revision = 0; #lastTick = -1; #initial = [];
  #identity = null; #timer = null; #settle = null; #reject = null; #readyTimer = null;
  #viewReport = null;
  #serverPerception = null;
  #nearbyPlayer = false;
  #life = randomUUID(); #termination = null; #closedPromise; #closedResolve;
  #actionMeta = new Map(); #receipt = 0; #name; #skin; #weapon; #facade; #inventory; #market;
  #authorization; #authority = null; #controlAwaiting = null; #directPending = null;
  constructor({ url, grant, name = 'Brisa [IA]', skin = 0, weapon = 0, now = clock,
    onFeedback = () => {}, limits = {}, chatTimeoutMs = 6000, inventoryTimeoutMs = 3000, marketTimeoutMs = 3000, authorization = null, transportFactory = (address) => new WsTransport(address) }) {
    const address = new URL(url);
    if (!['ws:', 'wss:'].includes(address.protocol) || address.username || address.password || address.search || address.hash) throw new TypeError('invalid game URL');
    if (!validGrant(grant) || typeof now !== 'function' || typeof onFeedback !== 'function') throw new TypeError('invalid agent configuration');
    if (authorization !== null && (!authorization || Object.keys(authorization).length !== 1 ||
        typeof authorization.token !== 'string' || !authorization.token || authorization.token.length > 8192 || /\s/.test(authorization.token))) throw new TypeError('invalid authorization');
    this.#authorization = authorization === null ? null : { token: authorization.token };
    if (typeof name !== 'string' || name.length > 32 || !integer(skin) || skin > 4 || weapon !== 0) throw new TypeError('invalid character configuration');
    this.#limits = labLimits(limits); this.#now = now; this.#feedback = onFeedback;
    this.#name = name; this.#skin = skin; this.#weapon = weapon;
    this.#session = new AgentSession({ grant, limits, source: 'server' });
    this.#chat = new AgentChat({ characterId: grant.scope.characterId, limits: this.#limits, now,
      timeoutMs: chatTimeoutMs, onFeedback: (type, data) => this.#emit(type, data), send: (message) => {
        if (this.#state !== 'ready' || this.#t.closed || this.#t.ws.readyState !== 1) throw new Error('transport_closed');
        this.#t.send(this.#authority ? { ...message, control: { epoch: this.grant.controlRevision } } : message);
      } });
    this.#t = transportFactory(address.href);
    this.#inventory = new AgentInventory({ now, limits: this.#limits, timeoutMs: inventoryTimeoutMs,
      onFeedback: (type, data) => this.#emit(type, data),
      send: (message) => {
        if (this.#state !== 'ready' || this.#t.closed || this.#t.ws.readyState !== 1) throw new Error('transport_closed');
        this.#t.send(message);
      } });
    this.#market = new AgentMarket({ now, limits: this.#limits, timeoutMs: marketTimeoutMs,
      onFeedback: (type, data) => this.#emit(type, data), send: (message) => {
        if (this.#state !== 'ready' || this.#t.closed || this.#t.ws.readyState !== 1) throw new Error('transport_closed');
        this.#t.send(message);
      } });
    this.#closedPromise = new Promise((resolve) => { this.#closedResolve = resolve; });
    // GameClient receives only this private facade. Chat has its own validated private send lane.
    const messages = [], snapshots = [];
    this.#facade = {
      onMessage: (cb) => messages.push(cb), onSnapshot: (cb) => snapshots.push(cb), start() {},
      send: (message) => {
        if (this.#state !== 'connecting' || message.t !== MSG.HELLO) throw new TypeError('unsupported agent message');
        this.#t.send(this.#authorization ? { ...message, agent: true, token: this.#authorization.token } : message);
      },
      sendInput: (tick, command) => this.#t.sendInput(tick, command),
      messages, snapshots,
    };
    this.#t.onMessage((message) => this.#message(message));
    this.#t.onSnapshot((snapshot) => this.#snapshot(snapshot));
    this.#t.onClose(() => { this.#closedResolve(); this.#halt('disconnect', false); });
  }
  get state() { return this.#state; }
  get identity() { return copy(this.#identity); }
  get authority() { return copy(this.#authority); }
  get viewReport() { return copy(this.#viewReport); }
  get observation() { return this.#session.observation; }
  get actions() { return this.#session.actions; }
  get chat() { return this.#chat.state; }
  get inventory() { return this.#inventory.state; }
  get inventoryRequests() { return this.#inventory.requests; }
  get market() { return this.#market.state; }
  get marketRequests() { return this.#market.requests; }
  get nowMs() { return this.#now(); }
  get maxObservationAgeMs() { return this.#limits.maxObservationAgeMs; }
  get grant() { return this.#session.grant; }
  get termination() { return copy(this.#termination); }
  async waitClosed(timeoutMs = 2000) {
    if (!integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('invalid close timeout');
    if (this.#t.closed) return true;
    let timer;
    try { return await Promise.race([this.#closedPromise.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  #emit(type, data) { this.#feedback({ type, data: copy(data) }); }
  async connect({ timeoutMs = 10000, autoTick = true } = {}) {
    if (this.#state !== 'idle' || !integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || typeof autoTick !== 'boolean') throw new TypeError('invalid connect');
    this.#state = 'connecting';
    const ready = new Promise((resolve, reject) => { this.#settle = resolve; this.#reject = reject; });
    this.#readyTimer = setTimeout(() => this.#fail('admission_timeout'), timeoutMs);
    // Attach the rejection handler before waiting for a socket that may never open.
    const opened = Promise.resolve(this.#t.opened).then((ok) => {
      if (!ok) { this.#fail('socket_unavailable'); return; }
      if (this.#state !== 'connecting') return;
      this.#t.start();
      GameClient.prototype.join.call({ t: this.#facade }, this.#name, this.#skin, this.#weapon);
    }).catch(() => this.#fail('socket_unavailable'));
    try { await ready; await opened; }
    catch (error) { this.#t.close(); throw error; }
    if (autoTick && this.#state === 'ready') this.#timer = setInterval(() => this.pump(), DT * 1000);
    return { ok: true, identity: this.identity, observation: this.observation };
  }
  #fail(code) {
    const reject = this.#reject; this.#reject = null; this.#settle = null;
    clearTimeout(this.#readyTimer);
    this.#halt('disconnect', false);
    reject?.(Object.assign(new Error(`agent admission failed: ${code}`), { code }));
    this.#t.close();
  }
  #message(m) {
    if (m?.t === MSG.AGENT_STATE && this.#authorization) { this.#serverControl(m); return; }
    if (!m || typeof m !== 'object' || this.#state === 'stopped') return;
    if (m.t === MSG.AGENT_INVENTORY_RESULT) { this.#inventory.receive(m); return; }
    if (m.t === MSG.AGENT_MARKET_RESULT) { this.#market.receive(m); return; }
    if (m.t === MSG.FULL || m.t === MSG.ERROR) { this.#fail(m.t === MSG.FULL ? 'full' : `server_${m.code || 'error'}`); return; }
    if (m.t === MSG.SPAWN && integer(m.e?.id) && kinds[m.e.kind]) {
      if (!this.#metadata.has(m.e.id) && this.#metadata.size >= 4096) { this.#fail('entity_capacity'); return; }
      this.#retireTarget(m.e.id);
      this.#metadata.set(m.e.id, { life: this.#authorization && typeof m.e.life === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(m.e.life)
        ? m.e.life : `life-${this.#life}-${++this.#birth}`, kind: kinds[m.e.kind] });
    }
    if (m.t === MSG.DESPAWN) {
      if (m.id === this.#identity?.entityId) { this.#halt('disconnect', true); return; }
      this.#retireTarget(m.id); this.#metadata.delete(m.id);
    }
    if (!this.#client) {
      if (this.#initial.length >= 4096) { this.#fail('initial_capacity'); return; }
      if (m.t !== MSG.READY && m.t !== MSG.PONG) this.#initial.push(copy(m));
      if (m.t !== MSG.WELCOME) return;
      if (m.v !== PROTOCOL_VERSION || !integer(m.you) || !m.you || !integer(m.seed) || m.seed > 0xffffffff) { this.#fail('invalid_welcome'); return; }
      if (this.#authorization) {
        const expected = this.grant, state = m.control;
        if (!validGrant(state?.grant) || state.state !== 'active' || !integer(state.taskRevision) ||
            !['ownerId', 'characterId', 'worldId'].every((key) => expected.scope[key] === state.grant.scope[key]) ||
            state.grant.expiresAtMs <= this.#now()) { this.#fail('invalid_server_grant'); return; }
        const grant = { ...state.grant, expiresAtMs: Math.min(expected.expiresAtMs, state.grant.expiresAtMs),
          capabilities: expected.capabilities.filter((cap) => state.grant.capabilities.includes(cap)) };
        this.#session = new AgentSession({ grant, limits: this.#limits, source: 'server' });
        this.#authority = copy(state);
      }
      this.#identity = { entityId: m.you, serverSeed: m.seed, protocol: m.v,
        authorization: this.#authority ? 'server' : 'local', mode: this.#authority ? 'agent' : 'guest' };
      if (this.#authority && m.perception?.v === 1 && m.perception.serverEnforced === true &&
          m.perception.policy === 'server_radius_colliders' && m.perception.radius === 24 && m.perception.maxEntities === 64)
        this.#serverPerception = copy(m.perception);
      this.#client = new GameClient(this.#facade, generateWorld(m.seed), { emit() {} });
      for (const prior of this.#initial) {
        if (this.#chat.receive(prior, this.#identity.entityId)) { this.#halt('revoked', true); return; }
        for (const cb of this.#facade.messages) cb(prior);
      }
      this.#initial = [];
      this.#emit('admitted', this.identity);
      return;
    }
    // This runs before GameClient's visual deduplication and prediction feedback.
    if (this.#chat.receive(m, this.#identity.entityId)) { this.#halt('revoked', true); return; }
    if (m.t === MSG.EVENT) this.#event(m.ev);
    if (this.#state !== 'stopped') for (const cb of this.#facade.messages) cb(m);
  }
  #retireTarget(entityId) {
    for (const action of this.actions) {
      const matches = ['attack_pve', 'follow', 'keep_distance'].includes(action.order.type) && action.order.args.target.entityId === entityId;
      const bodyMatches = action.body && [action.body.target, action.body.protect].some((ref) => ref?.entityId === entityId);
      if ((matches || bodyMatches) && ['accepted', 'sent', 'executing'].includes(action.state))
        this.#session.cancel(action.order.actionId, this.#now(), 'target_unavailable');
    }
  }
  #snapshot(s) {
    if (!this.#client || !['connecting', 'ready'].includes(this.#state) || !integer(s?.tick) || s.tick <= this.#lastTick ||
        !integer(s.ack) || !Array.isArray(s.you) || s.you.length !== PLAYER_FIELDS.length ||
        !s.you.every((v) => typeof v === 'number' && Number.isFinite(v)) || !Array.isArray(s.ents)) return;
    // Save authoritative arrays before reconcile replays pending commands into client.pred.
    const raw = { tick: s.tick, ack: s.ack, you: [...s.you], ents: s.ents.map((e) => Array.isArray(e) ? [...e] : null) };
    for (const cb of this.#facade.snapshots) cb(s);
    if (this.#state === 'stopped') return;
    if (this.#client.lastSnapshotTick !== s.tick || !this.#client.joined) return;
    if (this.#client.naval.active || this.#client.deck.active) { this.#halt('revoked', true); return; }
    const a = raw.you;
    const self = { position: { x: a[fields.x], y: a[fields.y], z: a[fields.z] }, hp: a[fields.hp], maxHp: a[fields.maxHp], dead: a[fields.hp] === 0 };
    const entities = raw.ents.flatMap((e) => {
      const meta = e && this.#metadata.get(e[ENT.ID]);
      if (!meta || e[ENT.ID] === this.#identity.entityId || e.length < ENT.ELEM + 1) return [];
      const position = { x: e[ENT.X], y: e[ENT.Y], z: e[ENT.Z] };
      const distance = Math.hypot(position.x - self.position.x, position.y - self.position.y, position.z - self.position.z);
      // Guest relevance filter; the opt-in managed pilot already limits data before transport.
      return distance <= 24 ? [{ ref: { entityId: e[ENT.ID], life: meta.life }, kind: meta.kind, position, hp: e[ENT.HP], distance }] : [];
    }).sort((a, b) => a.distance - b.distance || a.ref.entityId - b.ref.entityId);
    const nearbyPlayer = entities.some((e) => e.kind === 'player' && e.distance < 8);
    // Decode our existing private snapshot before prediction; never estimate reserves from ACKs.
    const combat = { weapon: a[fields.weapon], attackStage: a[fields.atkStage], stagger: a[fields.stagger],
      castLock: a[fields.castLock], guardStamina: Math.max(0, a[fields.guardSt]), potions: a[fields.potions],
      potionCooldown: a[fields.potCd], playerNearby: nearbyPlayer, guardRaised: a[fields.guardT] >= 0 };
    const observation = { v: 1, scope: this.grant.scope, controlRevision: this.grant.controlRevision,
      revision: this.#revision + 1, tick: s.tick, receivedAtMs: this.#now(), source: 'server',
      confirmed: { self, entities: entities.slice(0, this.#limits.maxEntities).map(({ distance, ...e }) => e), combat },
      predicted: null, chat: this.#chat.observation, historyGap: this.#chat.historyGap };
    const accepted = this.#session.observe(observation, observation.receivedAtMs);
    if (!accepted.ok) { if (accepted.why === 'dead' || accepted.why === 'authorization_expired') this.#halt(accepted.why === 'dead' ? 'death' : 'expired', true); return; }
    this.#lastTick = s.tick; this.#revision++;
    this.#updateReads();
    this.#nearbyPlayer = nearbyPlayer;
    this.#viewReport = this.#serverPerception && s.perception?.policy === this.#serverPerception.policy &&
      s.perception.serverEnforced === true && s.perception.tick === s.tick ?
      { ...copy(s.perception), localOmittedEntities: Math.max(0, entities.length - this.#limits.maxEntities) } :
      { policy: 'local_radius_filter', radius: 24, omittedEntities: Math.max(0, entities.length - this.#limits.maxEntities), serverEnforced: false };
    for (const action of this.actions) {
      if (action.body) {
        const meta = this.#actionMeta.get(action.order.actionId);
        if (meta && (meta.bodyStatus !== action.body.status || (['accepted', 'sent', 'executing'].includes(action.state) &&
            (meta.bodyAt === undefined || observation.receivedAtMs - meta.bodyAt >= 500)))) {
          this.#emit('body', { actionId: action.order.actionId, state: action.state, body: action.body,
            basis: 'confirmed_snapshot_local_controller', serverQueueRevocation: 'unproven' });
          meta.bodyAt = observation.receivedAtMs; meta.bodyStatus = action.body.status;
        }
        if (combat.guardRaised && ['sent', 'executing'].includes(action.state) && action.inputRange && raw.ack >= action.inputRange.first &&
            !action.effects.some((e) => e.code === 'body_guard_observed'))
          this.#evidence(action, 'body_guard_observed', 'Guardia propia observada en snapshot confirmado; no acredita protección del aliado.', s.tick, 'partial');
      }
      if (action.navigation) {
        const meta = this.#actionMeta.get(action.order.actionId);
        if (meta && (meta.navigationStatus !== action.navigation.status || !meta.navigationAt || observation.receivedAtMs - meta.navigationAt >= 500)) {
          this.#emit('navigation', { actionId: action.order.actionId, state: action.state, navigation: action.navigation,
            basis: 'confirmed_position_local_controller', serverQueueRevocation: 'unproven' });
          meta.navigationAt = observation.receivedAtMs; meta.navigationStatus = action.navigation.status;
        }
        if (action.order.type === 'go_to' && action.navigation.status === 'arrived' && !action.result &&
            !['cancelled', 'uncertain'].includes(action.state) && (!action.inputRange || raw.ack >= action.inputRange.last)) {
          this.#evidence(action, 'destination_observed', `Posición confirmada dentro de radio ${action.order.args.tolerance}; criterio espacial, sin causalidad exclusiva ni guardado durable.`, s.tick);
        }
      }
      if (!action.inputRange) continue;
      if (raw.ack >= action.inputRange.first) this.#session.acknowledge(action.order.actionId, Math.min(raw.ack, action.inputRange.last));
      const meta = this.#actionMeta.get(action.order.actionId);
      if (!meta || meta.reported || action.order.type !== 'move' || action.result || ['cancelled', 'uncertain'].includes(action.state)) continue;
      const delta = { x: self.position.x - meta.start.x, z: self.position.z - meta.start.z };
      if (observation.receivedAtMs >= action.acceptedAtMs + action.order.args.durationMs && raw.ack >= action.inputRange.last &&
          delta.x * action.order.args.mx + delta.z * action.order.args.mz > 0.1) {
        this.#evidence(action, 'position_observed', `Desplazamiento observado: dx=${delta.x.toFixed(3)}, dz=${delta.z.toFixed(3)}; sin prueba de llegada ni causalidad exclusiva.`, s.tick, 'partial');
        meta.reported = true;
      }
    }
    this.#emit('observation', { observation: this.observation, inputAck: s.ack, viewReport: this.viewReport });
    if (this.#state === 'connecting') {
      this.#state = 'ready'; clearTimeout(this.#readyTimer);
      this.#updateReads();
      this.#settle?.(); this.#settle = this.#reject = null;
    }
    this.#applyDirect();
  }
  #serverControl(message) {
    const state = message.state, prior = this.#authority;
    if (prior && !state && message.ok === false) {
      if (['control_mismatch', 'disabled'].includes(message.why)) { this.#halt('revoked', false); return; }
      if (this.#controlAwaiting?.actionId) this.#session.cancel(this.#controlAwaiting.actionId, this.#now(), 'superseded');
      this.#controlAwaiting = null; this.#emit('authority_rejected', { why: message.why }); return;
    }
    if (!prior || !validGrant(state?.grant) || !integer(state.taskRevision) ||
        !['ownerId', 'characterId', 'worldId', 'sessionId'].every((key) => state.grant.scope[key] === prior.grant.scope[key]) ||
        state.grant.controlRevision < prior.grant.controlRevision ||
        (state.grant.controlRevision === prior.grant.controlRevision && state.taskRevision < prior.taskRevision)) return;
    this.#authority = { ...copy(state), receipt: copy(message.receipt ?? null) };
    this.#updateReads();
    if (state.state === 'revoked') {
      this.#halt(['stop', 'death', 'expired', 'disconnect'].includes(state.why) ? state.why : 'revoked', false); return;
    }
    if (state.state !== 'active') return;
    if (state.taskRevision > prior.taskRevision) {
      this.#t.outbox.length = 0;
      if (this.#client) { this.#client.pending.length = 0; this.#client.predicted.clear(); }
      for (const action of this.actions) if (['accepted', 'sent', 'executing'].includes(action.state) &&
          action.order.actionId !== state.task?.actionId) this.#session.cancel(action.order.actionId, this.#now(), 'superseded');
    }
    if (this.#controlAwaiting) {
      if (!message.ok || state.task?.actionId !== this.#controlAwaiting.actionId) {
        if (this.#controlAwaiting.actionId) this.#session.cancel(this.#controlAwaiting.actionId, this.#now(), 'superseded');
      }
      this.#controlAwaiting = null;
    }
    if (state.task?.priority === 'direct') this.#directPending = copy(state.task);
    else this.#directPending = null;
    this.#emit('authority', { ok: message.ok, why: message.why ?? null, authority: this.authority });
    this.#applyDirect();
  }
  #applyDirect() {
    const task = this.#directPending;
    if (!task || this.#state !== 'ready' || !this.observation) return;
    this.#directPending = null;
    if (this.actions.some((action) => action.order.actionId === task.actionId)) return;
    const durationMs = Math.min(task.args.durationMs, task.expiresAtMs - this.#now());
    if (durationMs < 1) return;
    const order = { v: 1, actionId: task.actionId, scope: this.grant.scope, controlRevision: this.grant.controlRevision,
      observationRevision: this.observation.revision, type: task.type, args: { ...task.args, durationMs } };
    this.#acceptOrder(order, true);
  }
  #flushInput() {
    if (!this.#authority) { this.#t.flush(); return; }
    if (!this.#t.outbox.length) return;
    const cmds = this.#t.outbox.splice(0);
    this.#t.send({ t: MSG.INPUTS, control: { epoch: this.grant.controlRevision, taskRevision: this.#authority.taskRevision }, cmds });
  }
  #evidence(action, code, effect, tick, outcome = 'confirmed') {
    const evidence = { v: 1, actionId: action.order.actionId, scope: action.order.scope, controlRevision: action.order.controlRevision,
      source: 'server', evidenceId: `wire-${++this.#receipt}`, tick, outcome, code, effect, durability: 'not_applicable' };
    const result = this.#session.recordEvidence(evidence);
    if (result.ok) this.#emit(outcome === 'partial' ? 'action_effect' : 'action_result', { ...result, basis: 'adapter_correlated_server_data' });
  }
  #event(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'death' && ev.id === this.#identity.entityId) { this.#halt('death', true); return; }
    if (!['swing', 'potion'].includes(ev.type) || ev.e !== this.#identity.entityId || !integer(ev.seq)) return;
    const action = this.actions.find((a) => ['attack_pve', 'body_pve'].includes(a.order.type) && a.inputRange && ev.seq >= a.inputRange.first && ev.seq <= a.inputRange.last);
    if (!action) return;
    if (action.order.type === 'body_pve') {
      const code = ev.type === 'swing' ? 'body_swing_started' : ev.denied ? 'body_potion_denied' : 'body_potion_used';
      if (action.effects.some((e) => e.code === code)) return;
      const effect = ev.type === 'swing' ? `Inicio de swing para seq=${ev.seq}; impacto/daño no confirmados.` :
        ev.denied ? `Poción rechazada para seq=${ev.seq}; reservas/recarga resueltas por el servidor.` :
          `Poción usada para seq=${ev.seq}; curación=${ev.heal}, reserva=${ev.n}.`;
      this.#evidence(action, code, `${effect} Tick del snapshot previo.`, Math.max(action.observationTick, this.#lastTick), 'partial');
      return;
    }
    if (ev.type !== 'swing') return;
    // The wire swing lacks a tick. Use the preceding accepted snapshot's lower-bound tick,
    // and state that explicitly; never fabricate an event timestamp or claim a hit.
    this.#evidence(action, 'swing_started', `Swing confirmado para input seq=${ev.seq}; no confirma impacto. Tick del snapshot previo.`, Math.max(action.observationTick, this.#lastTick));
  }
  order(order) { return this.#acceptOrder(order, false); }
  #acceptOrder(order, direct) {
    if (this.#state !== 'ready') return { ok: false, why: 'not_ready' };
    if (this.#authority && !direct && (this.#controlAwaiting || this.#authority.task?.priority === 'direct'))
      return { ok: false, why: this.#controlAwaiting ? 'control_pending' : 'priority' };
    if (this.chat.requests.some((r) => r.order.actionId === order?.actionId)) return { ok: false, why: 'action_id_conflict' };
    if (order?.type === 'attack_pve') {
      if (this.#nearbyPlayer) return { ok: false, why: 'pve_player_nearby' };
      const target = order.args?.target, meta = this.#metadata.get(target?.entityId);
      if (!meta || meta.kind !== 'enemy' || meta.life !== target.life) return { ok: false, why: 'target_unavailable' };
    }
    if (order?.type === 'body_pve' && this.observation.confirmed.entities.some((entity) => {
      if (!['enemy', 'player'].includes(entity.kind)) return false;
      const meta = this.#metadata.get(entity.ref.entityId);
      return !meta || meta.kind !== entity.kind || meta.life !== entity.ref.life;
    })) return { ok: false, why: 'stale_observation' };
    const result = this.#session.accept(order, this.#now());
    if (result.ok && !result.replay) this.#actionMeta.set(order.actionId, { start: copy(this.observation.confirmed.self.position) });
    if (result.ok && !result.replay && this.#authority && !direct) {
      this.#controlAwaiting = { actionId: order.actionId, deadline: this.#now() + 3000 };
      this.#t.outbox.length = 0;
      this.#t.send({ t: MSG.AGENT_TASK, epoch: this.grant.controlRevision, expectedTaskRevision: this.#authority.taskRevision,
        actionId: order.actionId, type: order.type, args: order.args, priority: 'goal' });
    }
    this.#emit('order', result);
    return result;
  }
  sendChat(order) {
    if (this.actions.some((a) => a.order.actionId === order?.actionId)) return { ok: false, why: 'action_id_conflict' };
    const result = this.#chat.send(order, { grant: this.grant, observation: this.observation, ready: this.#state === 'ready' });
    this.#emit('chat_response', result); return result;
  }
  #updateReads() {
    const context = { ready: this.#state === 'ready', authenticated: !!this.#authorization,
      grant: this.grant, authority: this.#authority, observation: this.observation };
    this.#inventory.updateContext(context); this.#market.updateContext(context);
  }
  readInventory(query) { return this.#inventory.read(query); }
  readMarket(query) { return this.#market.read(query); }
  retryChat(requestId) {
    const result = this.#chat.retry(requestId, { grant: this.grant, observation: this.observation, ready: this.#state === 'ready' });
    this.#emit('chat_retry_response', result); return result;
  }
  cancel(actionId, ownerId) {
    if (ownerId !== this.grant.scope.ownerId) return { ok: false, why: 'owner_mismatch' };
    const active = this.actions.find((a) => a.order.actionId === actionId && ['accepted', 'sent', 'executing'].includes(a.state));
    if (this.#authority?.task?.priority === 'direct') return { ok: false, why: 'priority' };
    const result = this.#session.cancel(actionId, this.#now());
    if (result.ok && active && this.#state === 'ready') {
      this.#t.outbox.length = 0;
      if (this.#authority) {
        this.#controlAwaiting = { actionId: null, deadline: this.#now() + 3000 };
        this.#t.send({ t: MSG.AGENT_CANCEL, epoch: this.grant.controlRevision, expectedTaskRevision: this.#authority.taskRevision });
        this.#emit('cancel', { ...result, serverQueueRevocation: 'pending' }); return result;
      }
      try { this.#client.tickInput(neutral()); this.#t.flush(); }
      catch { this.#halt('disconnect', false); }
    }
    this.#emit('cancel', { ...result, serverQueueRevocation: 'unproven' });
    return result;
  }
  pump() {
    if (this.#state !== 'ready') return { ok: false, why: 'not_ready' };
    this.#inventory.expire();
    this.#market.expire();
    if (this.#t.closed || this.#t.ws.readyState !== 1) { this.#halt('disconnect', false); return { ok: false, why: 'transport_closed' }; }
    if (this.#authority && (this.#controlAwaiting || !this.#authority.task || this.#authority.state !== 'active')) {
      if (this.#now() >= this.grant.expiresAtMs) this.#halt('expired', false);
      else if (this.#controlAwaiting && this.#now() >= this.#controlAwaiting.deadline) this.#halt('disconnect', false);
      return { ok: false, why: 'control_pending' };
    }
    const now = this.#now(), input = { ...this.#session.step(now), w: 0 };
    this.#chat.expire();
    if (this.grant.controlRevision !== this.observation?.controlRevision) { this.#halt('expired', true); return { ok: false, why: 'not_ready' }; }
    const active = this.actions.find((a) => ['accepted', 'sent', 'executing'].includes(a.state) && now < a.acceptedAtMs + a.order.args.durationMs &&
      (!a.navigation || ['moving', 'holding'].includes(a.navigation.status)));
    if (active?.order.type === 'aim' || active?.order.type === 'attack_pve') input.btn |= BTN.AIM;
    // Refuse PvE pulses if another player entered the local melee safety margin meanwhile.
    if (active?.order.type === 'attack_pve' && this.#nearbyPlayer) {
      this.#halt('revoked', true); return { ok: false, why: 'pve_player_nearby' };
    }
    const before = this.#client.seq;
    try {
      this.#client.tickInput(input);
      if (active && this.#client.seq > before) {
        const meta = this.#actionMeta.get(active.order.actionId);
        if (!active.inputRange) meta.start = copy(this.observation.confirmed.self.position);
        // Conservatively record submission before the flush. Neither stage proves delivery.
        if (!this.#session.markSent(active.order.actionId, { first: before + 1, last: this.#client.seq }, now).ok) throw new Error('emission_rejected');
      }
      this.#flushInput(); this.#client.update(DT, DT);
    } catch {
      this.#halt('disconnect', false); return { ok: false, why: 'transport_or_prediction_error' };
    }
    this.#emit('input', { actionId: active?.order.actionId ?? null, sequence: this.#client.seq, input });
    return { ok: true, input, sequence: this.#client.seq, actionId: active?.order.actionId ?? null };
  }
  #halt(reason, sendNeutral) {
    if (this.#state === 'stopped') return;
    clearInterval(this.#timer); clearTimeout(this.#readyTimer);
    this.#state = 'stopped';
    this.#chat.stop(reason);
    this.#inventory.stop(reason);
    this.#market.stop(reason);
    // Drop any unsent outbox before sending a final neutral command on the live socket.
    this.#t.outbox.length = 0;
    if (sendNeutral && !this.#authority && this.#client?.joined && this.#t.ws.readyState === 1) {
      try { this.#client.tickInput(neutral()); this.#t.flush(); }
      catch { this.#t.outbox.length = 0; /* Close still retires the normal player connection. */ }
    }
    const result = this.#session.interrupt(reason, this.#now());
    if (this.#client) { this.#client.pending.length = 0; this.#client.predicted.clear(); }
    this.#t.outbox.length = 0; this.#initial = []; this.#metadata.clear(); this.#actionMeta.clear();
    this.#termination = { reason: result.reason, stoppedAtMs: this.#now(), localBuffersCleared: true,
      neutralAttempted: !!(sendNeutral && !this.#authority && this.#client?.joined && this.#t.ws.readyState === 1),
      serverQueueRevocation: this.#authority?.state === 'revoked' && this.#authority.receipt?.neutralPending === true ? 'confirmed' : 'unproven',
      serverReceipt: copy(this.#authority?.receipt ?? null), durability: 'process_only' };
    const reject = this.#reject; this.#reject = this.#settle = null;
    reject?.(Object.assign(new Error('agent admission interrupted'), { code: 'disconnected' }));
    this.#t.close();
    this.#emit('stopped', { ...result, termination: this.termination });
  }
  stop(ownerId) {
    if (ownerId !== this.grant.scope.ownerId) return { ok: false, why: 'owner_mismatch' };
    if (this.#authority?.state === 'active' && this.#state === 'ready') {
      const epoch = this.#authority.grant.controlRevision;
      clearInterval(this.#timer); this.#session.interrupt('stop', this.#now()); this.#chat.stop('stop');
      this.#inventory.stop('stop');
      this.#market.stop('stop');
      this.#t.outbox.length = 0; this.#client.pending.length = 0; this.#client.predicted.clear(); this.#state = 'stopping';
      this.#t.send({ t: MSG.AGENT_RELEASE, epoch });
      this.#readyTimer = setTimeout(() => this.#halt('stop', false), 1000);
      return { ok: true, state: this.state, serverQueueRevocation: 'pending', actions: this.actions };
    }
    this.#halt('stop', true); return { ok: true, state: this.state, actions: this.actions };
  }
  close() { this.#halt('disconnect', true); }
}
