// Authoritative server that runs the shared sim. Lives in a Web Worker (or in-process as a fallback) for
// solo play, and inside the Node server (server/host.mjs) behind WebSockets for online play.
// Instance time: this server is one instance (like an MMO dungeon), so hitstop and slow-mo are
// decided here and slow the whole world down; clients apply the same 'time' events to their loop.
// An open-world server would set instanceTime: false and leave hitstop cosmetic on the client.
import { DT, SNAPSHOT_EVERY, tuning } from '../data/tuning.js';
import { CLOCK } from '../data/clock.js';
import { ENEMIES } from '../data/enemies.js';
import { applyLevel } from '../sim/systems/combat.js';
import { setWeapon } from '../sim/systems/skills.js';
import { WEAPON_KINDS, SKILLS, weaponIndex } from '../data/weapons.js';
import { World } from '../sim/world.js';
import { givePearl, swallowPearl, spitPearl, leavePearl, transferPearl, sellPearl } from '../sim/systems/pearls.js';
import { C, KIND } from '../sim/ecs.js';
import { BTN } from '../sim/systems/movement.js';
import { BOT_NAMES } from '../sim/systems/bots.js';
import { encounterState, encounterDev } from '../sim/systems/encounter.js';
import { installInventory, newProfile, attachProfile, detachProfile, syncProfile, kitOf, equipItem, unequipItem, salvageItem, openChest, giveItem, setMastery, spawnDrop, publicDrops, setLoadout, setForm, learnTattoo, devTattoos, devTattoo, devLoadout } from '../sim/systems/inventory.js';
import { rollItem } from '../sim/items.js';
import { startQuests, questEvent, questWants, talkTo, acceptQuest, turnInQuest, buy, sell, setTutorial, setTier } from '../sim/systems/quests.js';
import { DROPS } from '../data/loot.js';
import { installTrade, marketCmd } from '../sim/systems/trade.js';
import { installRafts, prepareRaftProfile, attachRafts, detachRafts, publicRafts } from '../sim/systems/rafts.js';
import { raftCmd } from '../sim/systems/raftEditor.js';
import { raftDoorCmd } from '../sim/systems/raftDoors.js';
import { raftLanternCmd } from '../sim/systems/raftLanterns.js';
import { personalLanternCmd, clearPersonalLantern } from '../sim/systems/personalLantern.js';
import { commerceCmd, clearCommerceReceipts } from '../sim/systems/commerce.js';
import { installResources, resourceCmd, publicResources, clearResourceReceipts } from '../sim/systems/resources.js';
import { stepRaftWork } from '../sim/systems/raftProduction.js';
import { ownerRaftCapacity } from '../sim/systems/raftCapacity.js';
import { trustSaves, SAVE_TIMING, SAVE_NOW, MAX_SAVE } from './saves.js';
import { MSG, PROTOCOL_VERSION, encodeEntity, sanitizeCmd, cleanName } from './protocol.js';
import { preparePearlInputs } from './pearlInputBoundary.js';
import { prepareDeathInputs } from './deathInputBoundary.js';
import { ChatService } from './chatService.js';
import { NavalTrial } from '../sim/naval/trial.js';
import { NavalPilot } from '../sim/naval/pilot.js';
import { NavalRoute } from '../sim/naval/route.js';
import { NavalLesson } from '../sim/naval/lesson.js';
import { PILOTING } from '../data/progression.js';

const MAX_CMDS_PER_TICK = 2; // normal pace
const CATCHUP_CMDS = 4;      // when a client's queue backs up
const MAX_QUEUE = 30;        // anything beyond is dropped (anti speed-hack / tab stalls)

const PLAYER_COMMANDS = new Set(['equip', 'unequip', 'salvage', 'open', 'talk', 'quest', 'buy', 'sell',
  'tut', 'tier', 'loadout', 'form', 'learn', 'pearl', 'market', 'commerce', 'raft', 'resource']);
const PEARL_COMMANDS = new Set(['swallow', 'spit', 'leave', 'give', 'sell']);
const WORLD_COMMANDS = new Set(['open', 'talk', 'quest', 'buy', 'market', 'commerce', 'raft', 'resource']);
const DEV_COMMANDS = new Set(['tune', 'spawn', 'clear', 'enc', 'god', 'weapon', 'heal', 'clock', 'riposte',
  'level', 'mastery', 'tattoos', 'pearl', 'tattoo', 'loadout', 'tier', 'gold', 'drop', 'potions', 'item']);
const WORLD_DEV_COMMANDS = new Set(['tune', 'spawn', 'clear', 'enc', 'clock', 'pearl', 'drop', 'item']);

export class LocalServer {
  #applyingTick = false;
  #checkingTick = false;
  #runningTick = false;
  #applyFailed = false;
  #ownsTickPublication = false;
  #afterWorld = false; #holdingPublication = false;

  constructor({ seed, send, bots = 5, debug = false, dev = true, instanceTime = true, enemies = true, maxPlayers = Infinity, pausable = true, fill = false, saves = trustSaves, onSave = null, profileAccess = null, beforeDetach = null, commandAccess = null, beforeTick = null, afterTick = null, tickAccess = null, progressionPersistence = null, now = () => performance.now(), chat = {}, navigation = true }) {
    // Saved games (M4): solo trusts the blob it gets back, the Node server signs it (server/saves.mjs).
    this.saves = saves;
    this.onSave = onSave; // Server-owned snapshots; asynchronous storage stays outside the simulation.
    if (progressionPersistence !== null && typeof progressionPersistence !== 'function') throw new TypeError('progression hook');
    this.progressionPersistence = progressionPersistence; // Read confirmed storage evidence; never dispatch I/O.
    if ([profileAccess, beforeDetach].some((hook) => hook !== null && typeof hook !== 'function')) throw new TypeError('profile hook');
    this.profileAccess = profileAccess;
    this.beforeDetach = beforeDetach;
    if (commandAccess !== null && typeof commandAccess !== 'function') throw new TypeError('command hook');
    this.commandAccess = commandAccess;
    if (beforeTick !== null && typeof beforeTick !== 'function') throw new TypeError('tick apply hook');
    this.beforeTick = beforeTick; // Trusted synchronous apply adapter; never dispatch or await storage here.
    this.#ownsTickPublication = beforeTick !== null;
    if (afterTick !== null && typeof afterTick !== 'function') throw new TypeError('tick completion hook');
    this.afterTick = afterTick; // Synchronous post-world capture, before any terminal tick publication.
    if (tickAccess !== null && typeof tickAccess !== 'function') throw new TypeError('tick hook');
    this.tickAccess = tickAccess;
    this.tickBlocked = false; this.holdAcc = 0;
    this.debug = debug;
    this.dev = dev; // F4 panel: live tuning, spawns, god mode (a public server never enables this)
    this.instanceTime = instanceTime;
    this.maxPlayers = maxPlayers;
    this.pausable = pausable; // solo: the pause menu stops the world; online it never does
    // Online: a client that stops sending (hidden tab, lag spike) gets neutral filler commands, so the world
    // keeps acting on it. Solo leaves a stalled player alone (a slow device is not punished).
    this.fill = fill;
    this.stats = { fill: 0, late: 0, trimmed: 0, clamped: 0 };
    this.freeze = 0; this.slowT = 0; this.slowScale = 1;
    this.world = new World(seed, { server: true });
    // A session namespace is generated outside the deterministic simulation. New UIDs cannot collide
    // with pearls imported from a previous server run; injected test worlds use a seeded namespace.
    const crypto = globalThis.crypto;
    const namespace = crypto.randomUUID ? crypto.randomUUID() :
      Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('');
    installInventory(this.world, namespace);
    installTrade(this.world); // M7: the economy (markets, plots) and the market command
    installRafts(this.world, namespace);
    installResources(this.world);
    if (typeof navigation !== 'boolean') throw new TypeError('navigation option');
    if (navigation) {
      this.world.navalTrial = new NavalTrial(this.world, { coast: true, navigation: true });
      this.world.navalPilot = new NavalPilot(this.world, { live: true });
      this.world.navalRoute = new NavalRoute(this.world);
      this.world.navalLesson = new NavalLesson(this.world);
    }
    // Quests (M4): quest items drop only while wanted; picking one up counts.
    this.world.questWants = (e, item) => questWants(this.world, e, item);
    this.world.onPickup = (e, d) => { if (d.kind === 'quest') questEvent(this.world, e, 'collect', { item: d.q }); };
    this.send = send; // (clientId, msg) => void
    this.now = now;
    this.clients = new Map(); // clientId -> {entity, queue, ack}
    this.inputAccess = null; // Optional host-owned controller gate, checked at enqueue and consumption.
    this.chat = new ChatService({ config: chat, now, send, peers: () => {
      const ecs = this.world.ecs;
      return [...this.clients].filter(([, c]) => c.entity && ecs.alive[c.entity]).map(([clientId, c]) => ({
        clientId, entity: c.entity, name: ecs.names[c.entity], x: ecs.x[c.entity], y: ecs.y[c.entity], z: ecs.z[c.entity],
      }));
    } });
    this.world.economy.onAdvance = (sec) => stepRaftWork(this.world, sec / CLOCK.daySec,
      (owner, p) => {
        const c = this.clients.get(this.clientOf(owner));
        return !!c && (c.serverProfile === true || this.saves.store(p).length <= MAX_SAVE);
      });
    this.acc = 0;
    this.last = 0;
    this.timer = null;
    for (const npc of this.world.map.npcs) this.world.spawnNpc(npc);
    const rng = this.world.rng;
    for (let i = 0; i < bots; i++) {
      const wp = this.world.map.botWaypoints[i % this.world.map.botWaypoints.length];
      this.world.spawnPlayer({
        name: BOT_NAMES[i % BOT_NAMES.length], skin: (i + 1) % 5, level: rng.int(2, 9),
        x: wp.x + rng.range(-1, 1), z: wp.z + rng.range(-1, 1), bot: true, facing: rng.range(0, 6.28),
      });
    }
    if (enemies) this.world.populate();
    this.world.events.length = 0;
  }

  // Connected clients spectate (see bots, NPCs) until they say hello and get a player entity.
  connect(clientId) {
    this.clients.set(clientId, { entity: 0, queue: [], ack: 0, paused: false, starve: 0, fillPt: 0, lastPt: 0, carry: 0, last: null });
    const ecs = this.world.ecs;
    for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e] && !(ecs.mask[e] & C.VEHICLE)) this.send(clientId, { t: MSG.SPAWN, e: this.world.describe(e) });
  }

  disconnect(clientId) {
    const c = this.clients.get(clientId);
    if (c && c.entity) {
      // Invalidate pending effects before any lifecycle mutation. A blocked final snapshot cannot be
      // retried after detachment; the host must retain its fence and report an incomplete flush.
      const save = this.beforeDetach ? profileDecision(this.beforeDetach(clientId, c.entity)) :
        this.profileAllowed(clientId, c, 'save');
      clearCommerceReceipts(this.world, c.entity);
      clearResourceReceipts(this.world, c.entity);
      detachRafts(this.world, c.entity);
      clearPersonalLantern(this.world, c.entity);
      const p = detachProfile(this.world, c.entity);
      if (save && p && this.onSave) this.onSave(clientId, p);
      this.world.despawn(c.entity); this.flushEvents();
    }
    this.clients.delete(clientId);
    this.chat.leave(clientId);
  }

  // The client of a player entity (private events and profiles go only there).
  clientOf(e) { for (const [id, c] of this.clients) if (c.entity === e) return id; return undefined; }

  isHuman(e) { for (const c of this.clients.values()) if (c.entity === e) return true; return false; }

  // Players with an entity (bots are not clients).
  get humans() { let n = 0; for (const c of this.clients.values()) if (c.entity) n++; return n; }

  // A name nobody else in the instance has: «Grumete», «Grumete 2»…
  uniqueName(name) {
    const ecs = this.world.ecs, taken = new Set();
    for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e] && (ecs.mask[e] & C.PLAYER)) taken.add(String(ecs.names[e]).toLowerCase());
    if (!taken.has(name.toLowerCase())) return name;
    for (let k = 2; ; k++) { const n = name.slice(0, 13) + ' ' + k; if (!taken.has(n.toLowerCase())) return n; }
  }

  receive(clientId, msg, trustedProfile = undefined) {
    const c = this.clients.get(clientId);
    if (!c || !msg) return;
    switch (msg.t) {
      case MSG.HELLO: {
        if (c.entity) return;
        if (msg.v !== PROTOCOL_VERSION) { this.send(clientId, { t: MSG.ERROR, code: 'version', v: PROTOCOL_VERSION }); return; }
        if (this.humans >= this.maxPlayers) { this.send(clientId, { t: MSG.FULL, max: this.maxPlayers }); return; }
        const name = this.uniqueName(cleanName(msg.name));
        const skin = Math.max(0, Math.min(4, msg.skin | 0));
        // The weapon you last used (the client remembers it); after that you change it at a rack.
        const weapon = Math.max(0, Math.min(WEAPON_KINDS.length - 1, msg.weapon | 0));
        // Your saved game, if it is one of ours; otherwise a fresh start (and you are told why).
        // The third argument is host-owned, never read from the message. Account imports belong to P2;
        // a browser's old signed blob cannot overwrite a stored account profile.
        const saved = trustedProfile === undefined
          ? (typeof msg.save === 'string' && msg.save.length <= MAX_SAVE && msg.save ? this.saves.load(msg.save) : null)
          : trustedProfile;
        const prof = saved || newProfile({ weapon });
        if (!prepareRaftProfile(this.world, prof)) { this.send(clientId, { t: MSG.ERROR, code: 'session' }); return; }
        c.serverProfile = trustedProfile !== undefined;
        c.entity = this.world.spawnPlayer({ name, skin, level: prof.lvl, clientId, facing: 2.4, weapon: weaponIndex(kitOf(prof.eq.weapon)) });
        attachProfile(this.world, c.entity, prof);
        attachRafts(this.world, c.entity, prof);
        startQuests(this.world, c.entity);
        // The Cala's public loot already on the ground (M4.5).
        const pub = publicDrops(this.world);
        if (pub.length) this.world.emit({ type: 'loot', to: c.entity, e: c.entity, pub: 1, late: 1, fx: pub[0].x, fz: pub[0].z, drops: pub });
        if (trustedProfile === undefined && msg.save && !saved) this.world.emit({ type: 'note', to: c.entity, e: c.entity, code: 'save' });
        c.saveAt = this.world.tick + 1;
        // Own spawn must precede welcome (name, skin and weapon); welcome must precede private loot.
        const birth = this.world.events.findIndex((ev) => ev.type === 'spawn' && ev.id === c.entity);
        if (birth >= 0) {
          this.world.events.splice(birth, 1);
          this.broadcast({ t: MSG.SPAWN, e: this.world.describe(c.entity) });
        }
        // Pre-admission snapshots may precede the browser's snapshot listener while assets load.
        // Admission must resend the catalogue even when the world has not changed.
        c.resourceSignature = null;
        this.send(clientId, { t: MSG.WELCOME, v: PROTOCOL_VERSION, you: c.entity, tick: this.world.tick, seed: this.world.seed });
        this.flushEvents(); // Private events and already circulating pearls now know who "you" is.
        this.sendProfile(clientId, c);
        this.chat.join(clientId);
        break;
      }
      case MSG.INPUTS: {
        if (!c.entity || !Array.isArray(msg.cmds)) return;
        if (this.inputAccess && !this.inputAccess(clientId, msg.control ?? null, null)) return;
        for (const raw of msg.cmds) {
          const cmd = sanitizeCmd(raw);
          if (cmd && (!this.inputAccess || this.inputAccess(clientId, msg.control ?? null, cmd)) &&
              cmd.seq > c.ack && (c.queue.length === 0 || cmd.seq > c.queue[c.queue.length - 1].seq)) {
            if (msg.control) cmd.control = { ...msg.control };
            c.queue.push(cmd);
          }
        }
        // Too many waiting: the oldest go, but what they pressed is kept for the next one played.
        if (c.queue.length > MAX_QUEUE) for (const d of c.queue.splice(0, c.queue.length - MAX_QUEUE)) { c.carry |= d.prs; this.stats.trimmed++; }
        break;
      }
      case MSG.SHIP_INPUT:
      case MSG.DECK_INPUT: {
        const pilot = this.world.navalPilot;
        if (!pilot || !c.entity || c.paused || this.tickBlocked ||
            !this.commandAllowed(c, { world: true, target: null })) return;
        // Identity is the authenticated connection. Reject unknown keys before projecting axes.
        const keys = msg.t === MSG.SHIP_INPUT ? ['t', 'epoch', 'seq', 'throttle', 'brake', 'steer', 'capture'] :
          ['t', 'epoch', 'seq', 'mx', 'mz'];
        if (Object.keys(msg).some((key) => !keys.includes(key))) return;
        const { t, ...command } = msg;
        if (t === MSG.SHIP_INPUT) pilot.input(c.entity, command);
        else pilot.deckInput(c.entity, command);
        break;
      }
      case MSG.CMD: {
        if (msg.type === 'pause') {
          c.paused = this.pausable && !!msg.on;
          if (msg.on) this.world.navalPilot?.neutral?.(c.entity);
          break;
        }
        // Local-only debug teleport (used by tools/shot.mjs). A real server never implements this.
        if (msg.type === 'debug_teleport') { this.debugTeleport(c, msg); break; }
        if (this.dev && msg.type === 'dev' && c.entity) this.devCommand(c, msg);
        else if (c.entity) this.playerCommand(c, msg);
        break;
      }
      case MSG.PING:
        this.send(clientId, { t: MSG.PONG, t0: msg.t0, tick: this.world.tick });
        break;
      case MSG.CHAT_SEND:
        this.chat.receive(clientId, msg, this.world.tick);
        break;
      default:
        break;
    }
  }

  // What a player asks for with what they own (M4): the bag, the equipment, a chest.
  playerCommand(c, msg) {
    if (msg?.type === 'navalPilot') return this.navalCommand(c, msg);
    if (msg?.type === 'raftDoor') return this.doorCommand(c, msg);
    if (msg?.type === 'raftLantern') return this.lanternCommand(c, msg);
    if (msg?.type === 'personalLantern') return this.personalLanternCommand(c, msg);
    if (!msg || !PLAYER_COMMANDS.has(msg.type) ||
        (msg.type === 'pearl' && !PEARL_COMMANDS.has(msg.op))) return false;
    // Classify without calling a helper: even talk/list/quote can change progress or receipt caches.
    // Unknown mint UIDs and shared RNG/markets/decks require the conservative world preflight.
    const pearl = msg.type === 'pearl';
    if (!this.commandAllowed(c, { world: WORLD_COMMANDS.has(msg.type) || (pearl && msg.op !== 'give'),
      target: pearl && msg.op === 'give' ? msg.target | 0 : null })) return false;
    const w = this.world, e = c.entity, uid = msg.uid | 0;
    // Cargo mass and blueprint are captured for the whole voyage, including coastal exploration.
    // Keep economy helpers' own locks as well: trusted callers must not bypass this transport check.
    if (w.navalPilot?.locked?.(e) && ['raft', 'commerce', 'market', 'buy', 'sell'].includes(msg.type)) {
      w.emit({ type: 'commandDenied', to: e, e, why: 'navigation' });
      return false;
    }
    if (w.navalPilot?.aboard(e)) return false;
    switch (msg.type) {
      case 'equip': equipItem(w, e, uid, typeof msg.slot === 'string' ? msg.slot : undefined); break;
      case 'unequip': unequipItem(w, e, String(msg.slot)); break;
      case 'salvage': salvageItem(w, e, uid); break;
      case 'open': openChest(w, e, msg.drop | 0); break;
      case 'talk': talkTo(w, e, msg.npc | 0); break;
      case 'quest': if (msg.op === 'accept') acceptQuest(w, e, String(msg.id)); else if (msg.op === 'turnin') turnInQuest(w, e, String(msg.id)); break;
      case 'buy': buy(w, e, String(msg.what)); break;
      case 'sell': sell(w, e, uid); break;
      case 'tut': setTutorial(w, e, msg.i | 0); break;
      case 'tier': setTier(w, e, msg.tier | 0); break;
      // Tattoos (M4.7): the Q / E slots, a tattoo's form, learning one from Doña Sepia.
      case 'loadout': setLoadout(w, e, String(msg.slot), String(msg.id)); break;
      case 'form': setForm(w, e, String(msg.id), msg.form); break;
      case 'learn': learnTattoo(w, e, String(msg.id)); break;
      case 'pearl': {
        const pearlUid = typeof msg.uid === 'string' ? msg.uid : '';
        if (msg.op === 'swallow') swallowPearl(w, e, pearlUid, msg.replaceUid);
        else if (msg.op === 'spit') spitPearl(w, e);
        else if (msg.op === 'leave') leavePearl(w, e, pearlUid);
        else if (msg.op === 'give') transferPearl(w, e, pearlUid, msg.target | 0);
        else if (msg.op === 'sell') sellPearl(w, e, pearlUid);
        break;
      }
      // Trade (M7): a town's board, buying and selling goods into your pack.
      case 'market': marketCmd(w, e, msg, (p) => c.serverProfile || this.saves.store(p).length <= MAX_SAVE); break;
      case 'commerce': commerceCmd(w, e, msg, (p) => c.serverProfile || this.saves.store(p).length <= MAX_SAVE); break;
      case 'resource': resourceCmd(w, e, msg, (p) => c.serverProfile || this.saves.store(p).length <= MAX_SAVE); break;
      case 'raft': raftCmd(w, e, msg, (p) => c.serverProfile || this.saves.store(p).length <= MAX_SAVE); break;
      default: break;
    }
    return true; // Dispatched, not an acknowledgement of helper success or durable storage.
  }

  doorCommand(c, msg) {
    if (c?.paused || this.tickBlocked) return false;
    const source = this.world.rafts?.get(msg.id), ownerId = source && this.clientOf(source.owner);
    const owner = this.clients.get(ownerId);
    if (!this.commandAllowed(c, { world: true, target: source && source.owner !== c.entity ? source.owner : null })) return false;
    const ack = raftDoorCmd(this.world, c.entity, msg,
      (p) => !!owner && (owner.serverProfile || this.saves.store(p).length <= MAX_SAVE));
    if (ack.ok && ack.changed) {
      // Visitors operate an unlocked door, but only the ship owner's canonical profile is saved.
      this.sendSave(ownerId, owner); this.sendProfile(ownerId, owner);
      this.broadcastSnapshot();
    }
    return ack.ok;
  }

  lanternCommand(c, msg) {
    if (c?.paused || this.tickBlocked) return false;
    const source = this.world.rafts?.get(msg.id), ownerId = source && this.clientOf(source.owner);
    const owner = this.clients.get(ownerId);
    if (!this.commandAllowed(c, { world: true, target: source && source.owner !== c.entity ? source.owner : null })) return false;
    const ack = raftLanternCmd(this.world, c.entity, msg,
      (p) => !!owner && (owner.serverProfile || this.saves.store(p).length <= MAX_SAVE));
    if (ack.ok && ack.changed) {
      this.sendSave(ownerId, owner); this.sendProfile(ownerId, owner);
      this.broadcastSnapshot();
    }
    return ack.ok;
  }

  personalLanternCommand(c, msg) {
    if (c?.paused || this.tickBlocked || !this.commandAllowed(c, { world: true, target: null })) return false;
    const ack = personalLanternCmd(this.world, c.entity, msg);
    if (ack.ok && ack.changed) this.broadcastSnapshot();
    return ack.ok;
  }

  navalCommand(c, msg) {
    const pilot = this.world.navalPilot;
    if (!pilot || c?.paused || this.tickBlocked || !this.commandAllowed(c, { world: true, target: null })) return false;
    const fields = { mount: ['shipId'], reboard: ['shipId'], invite: ['shipId', 'target'], board: ['shipId'],
      walk: ['epoch'], helm: ['epoch'], land: ['epoch'], dock: ['epoch'], recall: [], leave: ['epoch'], deckleave: ['epoch'],
      routeStart: ['epoch'], routeAbort: ['epoch'], lessonStart: ['epoch'], lessonAbort: ['epoch'] };
    if (!Object.hasOwn(fields, msg.op) || Object.keys(msg).some((key) => !['t', 'type', 'op', ...fields[msg.op]].includes(key))) return false;
    let ok = false;
    const e = c.entity;
    switch (msg.op) {
      case 'mount': ok = pilot.mount(e, msg.shipId); break;
      case 'reboard': ok = pilot.reboard?.(e, msg.shipId) || false; break;
      case 'invite': ok = pilot.invite(e, msg.shipId, msg.target); break;
      case 'board': ok = pilot.board(e, msg.shipId); break;
      case 'walk': ok = pilot.walk(e, msg.epoch); break;
      case 'helm': ok = pilot.helm(e, msg.epoch); break;
      case 'land': ok = pilot.land?.(e, msg.epoch) || false; break;
      case 'dock': ok = pilot.dock?.(e, msg.epoch) || false; break;
      case 'recall': ok = pilot.recall?.(e) || false; break;
      case 'routeStart': ok = this.world.navalRoute?.start(e, msg.epoch) || false; break;
      case 'routeAbort': ok = this.world.navalRoute?.abort(e, msg.epoch) || false; break;
      case 'lessonStart': ok = this.world.navalLesson?.start(e, msg.epoch) || false; break;
      case 'lessonAbort': ok = this.world.navalLesson?.abort(e, msg.epoch) || false; break;
      // In the live game leaving is a nearby docking request, never an offshore teleport.
      case 'leave': ok = pilot.dock?.(e, msg.epoch) || false; break;
      case 'deckleave': ok = pilot.land?.(e, pilot.snapshot(e).epoch) || false; break;
    }
    if (ok) { c.queue.length = 0; c.carry = 0; c.last = null; c.fillPt = 0; }
    const source = this.world.rafts.get(msg.shipId);
    const load = !ok && source && (msg.op === 'mount' && source.owner === e || msg.op === 'board')
      ? pilot.loadCapacity(msg.shipId, msg.op === 'board' ? e : null) : null;
    this.world.emit({ type: 'navalPilot', to: e, op: msg.op, ok,
      ...(load?.status === 'overloaded' ? { why: 'capacity' } : {}), ...pilot.snapshot(e) });
    if (ok && ['dock', 'leave'].includes(msg.op)) {
      // This set-add has no economic side effect. Use the existing profile CAS writer immediately;
      // queued is not saved: the separate trusted snapshot getter observes confirmed storage.
      this.sendSave(this.clientOf(e), c);
      this.sendProfile(this.clientOf(e), c);
    }
    // Publish the transition immediately so a rapid shore/reboard cannot race an obsolete epoch.
    this.broadcastSnapshot();
    return ok;
  }

  commandAllowed(c, plan) {
    const id = c && this.clientOf(c.entity);
    if (!c?.entity || this.clients.get(id) !== c || !this.world.ecs.alive[c.entity] ||
        !this.world.profiles.has(c.entity)) return false;
    if (this.commandAccess === null || profileDecision(this.commandAccess(id, c.entity, Object.freeze(plan)), 'command')) return true;
    // Send feedback directly: a denied command must not touch world events, dirty flags or saveAt.
    this.send(id, { t: MSG.EVENT, ev: { type: 'commandDenied', to: c.entity, e: c.entity, why: 'busy' } });
    return false;
  }

  debugTeleport(c, msg) {
    if (!this.debug || !msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z) ||
        !this.commandAllowed(c, { world: false, target: null })) return false;
    const ecs = this.world.ecs;
    ecs.x[c.entity] = msg.x; ecs.z[c.entity] = msg.z; ecs.y[c.entity] = this.world.map.groundAt(msg.x, msg.z);
    ecs.vx[c.entity] = 0; ecs.vz[c.entity] = 0;
    return true;
  }

  profileAllowed(id, c, purpose) {
    if (!c || this.clients.get(id) !== c || !c.entity) return false;
    return this.profileAccess === null || profileDecision(this.profileAccess(id, c.entity, purpose));
  }

  // Internal staging adapter. Neither transport messages nor a normal running tick may clear
  // another command's actions; this reversible effect belongs to the synchronous apply phase.
  preparePearlInputs(id, entity) {
    return preparePearlInputs(this, id, entity, () => {
      if (!this.#applyingTick || this.#checkingTick || this.#runningTick || this.#applyFailed) {
        throw new TypeError('pearl inputs require tick apply');
      }
    });
  }

  // Trusted death requests may capture only between complete outer tick entries.
  // An expected rejected request does not poison the ordinary simulation.
  assertTickIdle() {
    if (this.#applyingTick || this.#checkingTick || this.#runningTick || this.#applyFailed) {
      throw new TypeError('death request requires idle tick');
    }
  }

  assertCombatTick() {
    if (!this.#runningTick || this.#afterWorld || this.#applyingTick || this.#checkingTick || this.#applyFailed) {
      throw new TypeError('fatal combat requires a full simulation tick');
    }
  }

  holdCombatPublication() {
    this.assertCombatTick();
    this.#holdingPublication = true;
  }

  assertDropApplyBoundary() {
    if (!this.#applyingTick || this.#runningTick || this.#checkingTick || this.#applyFailed) {
      throw new TypeError('drop lifecycle requires tick apply');
    }
  }

  holdDropPublication() {
    this.assertDropApplyBoundary();
    this.#holdingPublication = true;
  }

  assertDeathCaptureBoundary() {
    if ((!this.#afterWorld && !this.#applyingTick) || this.#checkingTick || this.#applyFailed) {
      throw new TypeError('death capture requires a trusted tick boundary');
    }
  }

  prepareDeathInputs(id, entity) {
    return prepareDeathInputs(this, id, entity, () => {
      if (!this.#applyingTick || this.#checkingTick || this.#runningTick || this.#applyFailed) {
        throw new TypeError('death inputs require tick apply');
      }
    });
  }

  sendProfile(id, c) {
    if (this.#holdingPublication || !this.profileAllowed(id, c, 'publish')) return false;
    const p = syncProfile(this.world, c.entity);
    if (!p) return false;
    this.send(id, { t: MSG.PROFILE, p });
    c.profT = this.world.tick;
    this.world.profileDirty.delete(c.entity);
    this.saveSoon(c, SAVE_TIMING.after);
    return true;
  }

  saveSoon(c, secs) {
    const at = this.world.tick + Math.round(secs / DT);
    if (c.saveAt == null || at < c.saveAt) c.saveAt = at;
  }

  // A fresh blob for the player to keep (only when it changed).
  sendSave(id, c) {
    if (this.#holdingPublication || !this.profileAllowed(id, c, 'save')) return false;
    const p = syncProfile(this.world, c.entity);
    if (!p) return false;
    if (this.onSave && this.onSave(id, p) === false) return false;
    // An account snapshot must not become a reusable anonymous save. P2's one-time import is separate.
    if (c.serverProfile) { c.saveAt = null; return true; }
    const blob = this.saves.store(p);
    if (blob !== c.lastBlob) {
      this.send(id, { t: MSG.SAVE, blob });
      c.lastBlob = blob;
    }
    c.saveAt = null;
    return true;
  }

  // F4 panel (local server only).
  devCommand(c, msg) {
    if (!this.dev || !msg || !DEV_COMMANDS.has(msg.op) ||
        !this.commandAllowed(c, { world: WORLD_DEV_COMMANDS.has(msg.op), target: null })) return false;
    const w = this.world, ecs = w.ecs, e = c.entity;
    const f = (v, d = 0) => (Number.isFinite(v) ? v : d);
    switch (msg.op) {
      case 'tune': setPath(msg.root === 'enemies' ? ENEMIES : msg.root === 'skills' ? SKILLS : tuning, msg.path, msg.value); break;
      case 'spawn': {
        const a = f(msg.ang, ecs.facing[e]), d = f(msg.dist, 8);
        w.debugSpawn(String(msg.kind), ecs.x[e] + Math.sin(a) * d, ecs.z[e] + Math.cos(a) * d, a + Math.PI);
        break;
      }
      case 'clear': w.debugClear(); break;
      case 'enc': { const q = w.encounters[0]; if (q) encounterDev(w, q, String(msg.sub)); break; }
      case 'god': ecs.god[e] = msg.on ? 1 : 0; break;
      case 'weapon': setWeapon(w, e, Math.max(0, Math.min(WEAPON_KINDS.length - 1, f(msg.weapon) | 0))); break;
      case 'heal': ecs.hp[e] = ecs.maxHp[e]; break;
      case 'clock':
        if (Number.isFinite(msg.hours)) { w.economy.hours = Math.max(0, msg.hours); w.economy.acc = 0; }
        break;
      case 'riposte': ecs.riposte[e] = tuning.parry.riposte.max; break;
      case 'level': applyLevel(w, e, Math.max(1, Math.min(tuning.stats.maxLevel, f(msg.level, 1) | 0))); ecs.hp[e] = ecs.maxHp[e]; ecs.xp[e] = 0; w.profileDirty.add(e); break;
      case 'mastery': setMastery(w, e, f(msg.level, 1)); break;
      case 'tattoos': devTattoos(w, e, f(msg.rank, 1)); break;
      case 'pearl': givePearl(w, e, String(msg.kind || 'brasa')); break;
      case 'tattoo': devTattoo(w, e, String(msg.id), f(msg.rank, 1), f(msg.form)); break;
      case 'loadout': devLoadout(w, e, String(msg.slot), String(msg.id)); break;
      case 'tier': { const p = w.profiles.get(e); if (p) { p.flags.tier = p.flags.tierSel = Math.max(1, Math.min(3, f(msg.tier, 1) | 0)); w.profileDirty.add(e); } break; }
      case 'gold': { const p = w.profiles.get(e); if (p) { p.gold = Math.max(0, p.gold + (f(msg.n) | 0)); w.profileDirty.add(e); } break; }
      case 'drop': {
        const kind = ['item', 'gold', 'potion', 'quest', 'chest'].includes(msg.kind) ? msg.kind : 'item';
        const r = msg.rarity === undefined ? undefined : Math.max(0, Math.min(4, f(msg.rarity) | 0));
        const item = kind === 'item' || kind === 'chest' ? rollItem(w.lootRng, { lvl: f(msg.lvl, ecs.level[e]), rarity: r, slot: typeof msg.slot === 'string' ? msg.slot : undefined, uid: w.profiles.get(e).uid++ }) : undefined;
        spawnDrop(w, e, kind, kind === 'gold' ? { n: Math.max(1, f(msg.n, 25) | 0) } : kind === 'quest' ? { q: 'coral' } : item ? { item } : {});
        break;
      }
      case 'potions': ecs.potions[e] = Math.max(0, Math.min(5, f(msg.n, 5) | 0)); break;
      case 'item': giveItem(w, e, rollItem(w.lootRng, { lvl: f(msg.lvl, ecs.level[e]), rarity: msg.rarity === undefined ? undefined : Math.max(0, Math.min(4, f(msg.rarity) | 0)), slot: typeof msg.slot === 'string' ? msg.slot : undefined })); break;
      default: break;
    }
    return true;
  }

  start() {
    this.last = this.now();
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  pump() {
    this.#assertTickEntry();
    const t = this.now();
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25; // tab stall: don't spiral
    // Ready effects must be able to release their own reservation, even while paused or blocked.
    // Drain once per outer entry, never again from a filler inside an already admitted tick.
    if (!this.#prepareTick()) {
      if (!this.#applyFailed) this.waitForTick(dt);
      return;
    }
    // Everyone in the instance paused (single player: the pause menu): the world waits.
    let anyone = false, allPaused = true;
    for (const c of this.clients.values()) if (c.entity) { anyone = true; if (!c.paused) allPaused = false; }
    if (anyone && allPaused) return;
    // The current tick mixes movement, combat, loot and production. Wait before any of it changes,
    // rather than skip individual effects after their winner, clock or RNG was already consumed.
    if (this.freeze > 0) { const h = Math.min(this.freeze, dt); this.freeze -= h; dt -= h; }
    if (this.slowT > 0) { const h = Math.min(this.slowT, dt); this.slowT -= h; dt += h * (this.slowScale - 1); }
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      if (!this.tickAllowed()) { if (!this.#applyFailed) this.waitForTick(dt); break; }
      this.#step();
    }
  }

  #assertTickEntry() {
    if (!this.#applyingTick && !this.#checkingTick && !this.#runningTick) return;
    this.#applyFailed = true; this.tickBlocked = true; this.acc = 0;
    throw new TypeError('reentrant tick boundary');
  }

  #prepareTick() {
    this.#assertTickEntry();
    let applied = false;
    try {
      if (this.#applyFailed) return false;
      if (this.beforeTick !== null) this.#ownsTickPublication = true;
      this.#applyingTick = true;
      applied = this.beforeTick === null || profileDecision(this.beforeTick(), 'tick apply');
      if (this.#applyFailed) applied = false; // A swallowed reentrancy error still cannot authorize simulation.
    } catch (error) {
      // A faulty apply may have changed local state. Never poll it again or resume merely because
      // a later callback returns true; its owner must reconcile/fence and replace this server.
      this.#applyFailed = true;
      throw error;
    } finally {
      this.#applyingTick = false;
      if (!applied) { this.tickBlocked = true; this.acc = 0; }
    }
    const allowed = applied && this.tickAllowed();
    if (allowed) this.#holdingPublication = false;
    return allowed;
  }

  tickAllowed() {
    if (this.#checkingTick) this.#assertTickEntry();
    let allowed = false;
    this.#checkingTick = true;
    try {
      allowed = this.tickAccess === null || profileDecision(this.tickAccess(), 'tick');
      if (this.#applyFailed) allowed = false;
    }
    finally {
      this.#checkingTick = false;
      this.tickBlocked = !allowed;
      if (allowed) this.holdAcc = 0;
      else this.acc = 0; // Storage latency never becomes simulation catch-up debt.
    }
    return allowed;
  }

  waitForTick(dt) {
    if (this.#holdingPublication) return;
    // Keep read-only state/ACK heartbeats on their usual cadence, including spectators. No events,
    // profile sync or save scheduling are flushed while a reservation owns the simulation boundary.
    this.holdAcc += Math.max(0, dt);
    const every = DT * SNAPSHOT_EVERY;
    if (this.holdAcc >= every) { this.holdAcc %= every; this.broadcastSnapshot(); }
  }

  step() {
    if (!this.#prepareTick()) return false;
    return this.#step();
  }

  #step() {
    const completion = this.afterTick;
    this.#runningTick = true;
    try { return this.#stepWorld(completion); }
    catch (error) {
      if (completion !== null || this.afterTick !== completion) {
        // A partial tick cannot be replayed or captured as a completed death baseline.
        this.#applyFailed = true; this.#holdingPublication = true; this.tickBlocked = true; this.acc = 0;
        try { if (completion !== null) profileDecision(completion(false), 'tick completion'); } catch { /* Preserve the original fault. */ }
      }
      throw error;
    } finally { this.#afterWorld = false; this.#runningTick = false; }
  }

  #stepWorld(completion) {
    const w = this.world;
    for (const [id, c] of this.clients) {
      if (!c.entity) continue;
      // The host invalidates queues synchronously; physical neutralization remains inside a tick.
      if (c.controlNeutral) {
        c.controlNeutral = false;
        const ecs = w.ecs, e = c.entity;
        for (const field of ['atkBuf', 'dashBuffer', 'rBuf', 'qBuf', 'eBuf']) if (ecs[field]) ecs[field][e] = 0;
        this.#applyFiller(c);
        continue;
      }
      if (this.inputAccess) {
        c.queue = c.queue.filter((cmd) => this.inputAccess(id, cmd.control ?? null, cmd));
        if (!this.inputAccess(id, null, null, 'active')) { this.#applyFiller(c); continue; }
      }
      // Commands the fillers already stood in for (they arrived late, from before fillPt): dropped, their
      // presses kept for the next real command.
      while (c.fillPt && c.queue.length && c.queue[0].pt <= c.fillPt) {
        const cmd = c.queue.shift();
        c.carry |= cmd.prs; c.ack = cmd.seq; this.stats.late++;
      }
      if (!c.queue.length) {
        if (this.fill && ++c.starve > tuning.combat.starveTicks) this.#applyFiller(c);
        continue;
      }
      c.starve = 0; c.fillPt = 0;
      const n = c.queue.length > 6 ? CATCHUP_CMDS : MAX_CMDS_PER_TICK;
      // Process at most one per tick unless backlog: keeps the player in step with real time.
      const take = c.queue.length > 2 ? Math.min(n, c.queue.length) : Math.min(1, c.queue.length);
      for (let i = 0; i < take; i++) {
        const cmd = c.queue.shift();
        if (c.carry) { cmd.prs |= c.carry; c.carry = 0; }
        if (this.inputAccess && !this.inputAccess(id, cmd.control ?? null, cmd)) continue;
        if (cmd.pt < w.tick - tuning.combat.rewind) this.stats.clamped++;
        w.applyCommand(c.entity, cmd);
        if (this.#applyFailed) throw new TypeError('failed tick boundary');
        c.ack = cmd.seq; c.lastPt = cmd.pt; c.last = cmd;
      }
    }
    w.stepWorld();
    if (this.#applyFailed) throw new TypeError('failed tick boundary');
    // Retain the admitted completion owner across the whole step. A world callback cannot remove
    // or replace it to publish around persistent capture, even when the replacement returns true.
    if (this.afterTick !== completion) throw new TypeError('changed tick completion owner');
    if (completion !== null) {
      this.#afterWorld = true;
      // Block direct publication during capture, including synchronous callback reentry.
      this.#holdingPublication = true;
      const complete = profileDecision(completion(true), 'tick completion');
      this.#afterWorld = false;
      if (this.#applyFailed) throw new TypeError('failed tick boundary');
      if (this.afterTick !== completion) throw new TypeError('changed tick completion owner');
      if (!complete) { this.tickBlocked = true; this.acc = 0; return true; }
      this.#holdingPublication = false;
    }
    this.flushEvents();
    if (w.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    // Saves: the ones due, and a look at everyone every SAVE_TIMING.every s (sent only if it changed).
    const sweep = w.tick % Math.round(SAVE_TIMING.every / DT) === 0;
    for (const [id, c] of this.clients) {
      if (!c.entity) continue;
      if (sweep && c.saveAt == null) c.saveAt = w.tick;
      if (c.saveAt != null && w.tick >= c.saveAt) this.sendSave(id, c);
    }
    return true;
  }

  // One neutral tick for a silent client: no movement, no buttons, aim kept, projectile time moving on
  // (the world clamps it to the rewind window). The ack does not move: the client reconciles from it.
  applyFiller(c) {
    if (this.afterTick !== null) throw new TypeError('standalone filler has no completed world boundary');
    if (!this.#prepareTick()) return false;
    this.#runningTick = true;
    try { return this.#applyFiller(c); }
    finally { this.#runningTick = false; }
  }

  #applyFiller(c) {
    const pt = Math.max(c.lastPt + 1, this.world.tick - tuning.combat.rewind);
    c.lastPt = c.fillPt = pt;
    const l = c.last;
    this.world.applyCommand(c.entity, { seq: c.ack, mx: 0, mz: 0, ax: l ? l.ax : 0, az: l ? l.az : 0, btn: l ? l.btn & BTN.AIM : 0, prs: 0, pt, w: 0 });
    if (this.#applyFailed) throw new TypeError('failed tick boundary');
    this.stats.fill++;
    return true;
  }

  flushEvents() {
    // Once an apply adapter owns this boundary, HELLO/disconnect cannot flush its retained events.
    // Only an admitted tick publishes them; a faulty adapter remains closed even if removed later.
    if (this.#holdingPublication || this.#applyFailed || (this.#ownsTickPublication && !this.#runningTick)) return;
    const w = this.world;
    for (const ev of w.events) {
      // Private (M4): loot, pickups, masteries… only for the player it is about.
      if (ev.to) {
        const id = this.clientOf(ev.to);
        if (id !== undefined) {
          this.send(id, { t: MSG.EVENT, ev });
          if (SAVE_NOW.has(ev.type) || (ev.type === 'raftEdit' && ev.ok && ev.op !== 'quote')
              || (ev.type === 'navalPilot' && ev.ok !== false)
              || (ev.type === 'navalImpact' && ev.damage > 0)
              || (ev.type === 'commerce' && ev.ok && ['buy', 'sell', 'transfer'].includes(ev.op))
              || (ev.type === 'resource' && ev.ok)
              || (ev.type === 'raftProduction' && Object.keys(ev.made).length)) this.saveSoon(this.clients.get(id), 0);
        }
        continue;
      }
      if (ev.type === 'level') { const id = this.clientOf(ev.e); if (id !== undefined) this.saveSoon(this.clients.get(id), 0); }
      if (ev.type === 'spawn') this.broadcast({ t: MSG.SPAWN, e: w.describe(ev.id) });
      else if (ev.type === 'despawn') this.broadcast({ t: MSG.DESPAWN, id: ev.id });
      else {
        if (ev.type === 'time') {
          // Instance time: world events (e 0: the boss falls) always; a player's own hitstop only while they
          // are the only human here (with company it stays on their screen; bots never stop the world).
          ev.inst = this.instanceTime && (!ev.e || (this.humans <= 1 && this.isHuman(ev.e))) ? 1 : 0;
          if (ev.inst) {
            this.freeze = Math.max(this.freeze, ev.hitstop || 0);
            if (ev.scale < 1 && ev.dur > 0) { this.slowScale = ev.scale; this.slowT = Math.max(this.slowT, ev.dur); }
          }
        }
        this.broadcast({ t: MSG.EVENT, ev });
      }
    }
    w.events.length = 0;
    // Profiles that changed, at most every DROPS.profileEvery ticks per player.
    if (w.profileDirty && w.profileDirty.size) {
      for (const [id, c] of this.clients) {
        if (c.entity && w.profileDirty.has(c.entity) && !(w.tick - (c.profT ?? -1e9) < DROPS.profileEvery)) this.sendProfile(id, c);
      }
    }
  }

  broadcast(msg) {
    for (const id of this.clients.keys()) this.send(id, msg);
  }

  broadcastSnapshot() {
    if (this.#holdingPublication || this.#applyFailed) return;
    // Movement/combat tuples contain no profile inventory, pearl UID, save blob or durable receipt.
    // Transport stays live while PROFILE/SAVE waits. During a tick hold, ACK remains the last
    // command actually applied; a snapshot heartbeat never acknowledges merely buffered input.
    const w = this.world, ecs = w.ecs;
    const ents = [], enc = w.encounters.map((q) => encounterState(w, q));
    // Keep expired field history too: a live bullet may already have lost travel time in it.
    // Sending only active fields would make a late joiner move that bullet too far ahead.
    const frost = w.hazards.frostFields.map(({ e, seq, x, z, r, t0, tEnd, slow }) => ({ e, seq, x, z, r, t0, tEnd, slow }));
    const storm = w.hazards.stormSnapshot();
    const ink = { clouds: w.inkClouds.filter((f) => f.tEnd > w.tick).map(({ e, seq, x, z, r, t0, tEnd }) => ({ e, seq, x, z, r, t0, tEnd })), marks: [] };
    const clock = { tick: w.tick, hours: w.gameHoursAt(), daySec: CLOCK.daySec };
    const rafts = publicRafts(w);
    const resources = publicResources(w);
    // Resource positions are a catalogue, not a movement stream. Send it on admission or a
    // state change; countdowns derive from the accompanying tick on the client.
    const resourceSignature = JSON.stringify({ ...resources,
      nodes: resources.nodes.map(({ wait, ...node }) => node) });
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.POS) || (ecs.mask[e] & C.VEHICLE)) continue;
      ents.push(encodeEntity(ecs, e));
      if ((ecs.mask[e] & C.ENEMY) && ecs.dead[e] <= 0 && ecs.brain[e]?.inkEnd > w.tick) ink.marks.push({ e, tEnd: ecs.brain[e].inkEnd });
    }
    for (const [id, c] of this.clients) {
      const resourceChanged = c.resourceSignature !== resourceSignature;
      this.send(id, { t: MSG.SNAPSHOT, tick: w.tick, ack: c.ack, ents, you: c.entity ? w.playerState(c.entity) : null, enc, frost, storm, ink, clock, rafts,
        ...(resourceChanged ? { resources } : {}),
        capacity: c.entity ? ownerRaftCapacity(w, c.entity, rafts) : null,
        ...(w.navalPilot ? { naval: w.navalPilot.snapshot(c.entity), deck: w.navalPilot.deckSnapshot(c.entity),
          voyage: w.navalPilot.voyageSnapshot?.(c.entity) || { active: false }, route: w.navalRoute?.snapshot(c.entity) || null,
          lesson: w.navalLesson?.snapshot(c.entity, this.progressionPersistence?.(id, PILOTING.milestone) || 'local') || null } : {}) });
      c.resourceSignature = resourceSignature;
    }
  }
}

function profileDecision(value, kind = 'profile') {
  if (typeof value === 'boolean') return value;
  // Trusted hooks must be synchronous. Consume a rejected accidental Promise before failing closed.
  if (value && typeof value.then === 'function') Promise.resolve(value).catch(() => {});
  throw new TypeError(`${kind} hook must return a synchronous boolean`);
}

// 'a.b.c' → obj.a.b.c = value (numbers and booleans only; arrays by index).
export function setPath(obj, path, value) {
  if (typeof path !== 'string' || !(typeof value === 'number' || typeof value === 'boolean')) return false;
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { o = o?.[keys[i]]; if (o === null || typeof o !== 'object') return false; }
  const k = keys[keys.length - 1];
  if (!(k in o) || typeof o[k] !== typeof value) return false;
  o[k] = value;
  return true;
}

export { KIND };
