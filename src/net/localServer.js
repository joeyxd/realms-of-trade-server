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
import { trustSaves, SAVE_TIMING, SAVE_NOW, MAX_SAVE } from './saves.js';
import { MSG, PROTOCOL_VERSION, encodeEntity, sanitizeCmd, cleanName } from './protocol.js';

const MAX_CMDS_PER_TICK = 2; // normal pace
const CATCHUP_CMDS = 4;      // when a client's queue backs up
const MAX_QUEUE = 30;        // anything beyond is dropped (anti speed-hack / tab stalls)

export class LocalServer {
  constructor({ seed, send, bots = 5, debug = false, dev = true, instanceTime = true, enemies = true, maxPlayers = Infinity, pausable = true, fill = false, saves = trustSaves, onSave = null, now = () => performance.now() }) {
    // Saved games (M4): solo trusts the blob it gets back, the Node server signs it (server/saves.mjs).
    this.saves = saves;
    this.onSave = onSave; // Server-owned snapshots; asynchronous storage stays outside the simulation.
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
    // Quests (M4): quest items drop only while wanted; picking one up counts.
    this.world.questWants = (e, item) => questWants(this.world, e, item);
    this.world.onPickup = (e, d) => { if (d.kind === 'quest') questEvent(this.world, e, 'collect', { item: d.q }); };
    this.send = send; // (clientId, msg) => void
    this.now = now;
    this.clients = new Map(); // clientId -> {entity, queue, ack}
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
    for (let e = 1; e < ecs.cap; e++) if (ecs.alive[e]) this.send(clientId, { t: MSG.SPAWN, e: this.world.describe(e) });
  }

  disconnect(clientId) {
    const c = this.clients.get(clientId);
    if (c && c.entity) {
      const p = detachProfile(this.world, c.entity);
      if (p && this.onSave) this.onSave(clientId, p);
      this.world.despawn(c.entity); this.flushEvents();
    }
    this.clients.delete(clientId);
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
        c.serverProfile = trustedProfile !== undefined;
        c.entity = this.world.spawnPlayer({ name, skin, level: prof.lvl, clientId, facing: 2.4, weapon: weaponIndex(kitOf(prof.eq.weapon)) });
        attachProfile(this.world, c.entity, prof);
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
        this.send(clientId, { t: MSG.WELCOME, v: PROTOCOL_VERSION, you: c.entity, tick: this.world.tick, seed: this.world.seed });
        this.flushEvents(); // Private events and already circulating pearls now know who "you" is.
        this.sendProfile(clientId, c);
        break;
      }
      case MSG.INPUTS: {
        if (!c.entity || !Array.isArray(msg.cmds)) return;
        for (const raw of msg.cmds) {
          const cmd = sanitizeCmd(raw);
          if (cmd && cmd.seq > c.ack && (c.queue.length === 0 || cmd.seq > c.queue[c.queue.length - 1].seq)) c.queue.push(cmd);
        }
        // Too many waiting: the oldest go, but what they pressed is kept for the next one played.
        if (c.queue.length > MAX_QUEUE) for (const d of c.queue.splice(0, c.queue.length - MAX_QUEUE)) { c.carry |= d.prs; this.stats.trimmed++; }
        break;
      }
      case MSG.CMD: {
        if (msg.type === 'pause') { c.paused = this.pausable && !!msg.on; break; }
        // Local-only debug teleport (used by tools/shot.mjs). A real server never implements this.
        if (this.debug && msg.type === 'debug_teleport' && c.entity && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
          const ecs = this.world.ecs;
          ecs.x[c.entity] = msg.x; ecs.z[c.entity] = msg.z; ecs.y[c.entity] = this.world.map.groundAt(msg.x, msg.z);
          ecs.vx[c.entity] = 0; ecs.vz[c.entity] = 0;
        }
        if (this.dev && msg.type === 'dev' && c.entity) this.devCommand(c, msg);
        else if (c.entity) this.playerCommand(c, msg);
        break;
      }
      case MSG.PING:
        this.send(clientId, { t: MSG.PONG, t0: msg.t0, tick: this.world.tick });
        break;
      default:
        break;
    }
  }

  // What a player asks for with what they own (M4): the bag, the equipment, a chest.
  playerCommand(c, msg) {
    const w = this.world, e = c.entity, uid = msg.uid | 0;
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
      case 'market': marketCmd(w, e, msg); break;
      default: break;
    }
  }

  sendProfile(id, c) {
    const p = syncProfile(this.world, c.entity);
    if (!p) return;
    c.profT = this.world.tick;
    this.world.profileDirty.delete(c.entity);
    this.send(id, { t: MSG.PROFILE, p });
    this.saveSoon(c, SAVE_TIMING.after);
  }

  saveSoon(c, secs) {
    const at = this.world.tick + Math.round(secs / DT);
    if (c.saveAt == null || at < c.saveAt) c.saveAt = at;
  }

  // A fresh blob for the player to keep (only when it changed).
  sendSave(id, c) {
    c.saveAt = null;
    const p = syncProfile(this.world, c.entity);
    if (!p) return;
    if (this.onSave) this.onSave(id, p);
    // An account snapshot must not become a reusable anonymous save. P2's one-time import is separate.
    if (c.serverProfile) return;
    const blob = this.saves.store(p);
    if (blob === c.lastBlob) return;
    c.lastBlob = blob;
    this.send(id, { t: MSG.SAVE, blob });
  }

  // F4 panel (local server only).
  devCommand(c, msg) {
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
  }

  start() {
    this.last = this.now();
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  pump() {
    const t = this.now();
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25; // tab stall: don't spiral
    // Everyone in the instance paused (single player: the pause menu): the world waits.
    let anyone = false, allPaused = true;
    for (const c of this.clients.values()) if (c.entity) { anyone = true; if (!c.paused) allPaused = false; }
    if (anyone && allPaused) return;
    if (this.freeze > 0) { const h = Math.min(this.freeze, dt); this.freeze -= h; dt -= h; }
    if (this.slowT > 0) { const h = Math.min(this.slowT, dt); this.slowT -= h; dt += h * (this.slowScale - 1); }
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.step();
    }
  }

  step() {
    const w = this.world;
    for (const c of this.clients.values()) {
      if (!c.entity) continue;
      // Commands the fillers already stood in for (they arrived late, from before fillPt): dropped, their
      // presses kept for the next real command.
      while (c.fillPt && c.queue.length && c.queue[0].pt <= c.fillPt) {
        const cmd = c.queue.shift();
        c.carry |= cmd.prs; c.ack = cmd.seq; this.stats.late++;
      }
      if (!c.queue.length) {
        if (this.fill && ++c.starve > tuning.combat.starveTicks) this.applyFiller(c);
        continue;
      }
      c.starve = 0; c.fillPt = 0;
      const n = c.queue.length > 6 ? CATCHUP_CMDS : MAX_CMDS_PER_TICK;
      // Process at most one per tick unless backlog: keeps the player in step with real time.
      const take = c.queue.length > 2 ? Math.min(n, c.queue.length) : Math.min(1, c.queue.length);
      for (let i = 0; i < take; i++) {
        const cmd = c.queue.shift();
        if (c.carry) { cmd.prs |= c.carry; c.carry = 0; }
        if (cmd.pt < w.tick - tuning.combat.rewind) this.stats.clamped++;
        w.applyCommand(c.entity, cmd);
        c.ack = cmd.seq; c.lastPt = cmd.pt; c.last = cmd;
      }
    }
    w.stepWorld();
    this.flushEvents();
    if (w.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
    // Saves: the ones due, and a look at everyone every SAVE_TIMING.every s (sent only if it changed).
    const sweep = w.tick % Math.round(SAVE_TIMING.every / DT) === 0;
    for (const [id, c] of this.clients) {
      if (!c.entity) continue;
      if (sweep && c.saveAt == null) c.saveAt = w.tick;
      if (c.saveAt != null && w.tick >= c.saveAt) this.sendSave(id, c);
    }
  }

  // One neutral tick for a silent client: no movement, no buttons, aim kept, projectile time moving on
  // (the world clamps it to the rewind window). The ack does not move: the client reconciles from it.
  applyFiller(c) {
    const pt = Math.max(c.lastPt + 1, this.world.tick - tuning.combat.rewind);
    c.lastPt = c.fillPt = pt;
    const l = c.last;
    this.world.applyCommand(c.entity, { seq: c.ack, mx: 0, mz: 0, ax: l ? l.ax : 0, az: l ? l.az : 0, btn: l ? l.btn & BTN.AIM : 0, prs: 0, pt, w: 0 });
    this.stats.fill++;
  }

  flushEvents() {
    const w = this.world;
    for (const ev of w.events) {
      // Private (M4): loot, pickups, masteries… only for the player it is about.
      if (ev.to) {
        const id = this.clientOf(ev.to);
        if (id !== undefined) {
          this.send(id, { t: MSG.EVENT, ev });
          if (SAVE_NOW.has(ev.type)) this.saveSoon(this.clients.get(id), 0);
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
    const w = this.world, ecs = w.ecs;
    const ents = [], enc = w.encounters.map((q) => encounterState(w, q));
    // Keep expired field history too: a live bullet may already have lost travel time in it.
    // Sending only active fields would make a late joiner move that bullet too far ahead.
    const frost = w.hazards.frostFields.map(({ e, seq, x, z, r, t0, tEnd, slow }) => ({ e, seq, x, z, r, t0, tEnd, slow }));
    const storm = w.hazards.stormSnapshot();
    const ink = { clouds: w.inkClouds.filter((f) => f.tEnd > w.tick).map(({ e, seq, x, z, r, t0, tEnd }) => ({ e, seq, x, z, r, t0, tEnd })), marks: [] };
    const clock = { tick: w.tick, hours: w.gameHoursAt(), daySec: CLOCK.daySec };
    for (let e = 1; e < ecs.cap; e++) {
      if (!ecs.alive[e] || !(ecs.mask[e] & C.POS)) continue;
      ents.push(encodeEntity(ecs, e));
      if ((ecs.mask[e] & C.ENEMY) && ecs.dead[e] <= 0 && ecs.brain[e]?.inkEnd > w.tick) ink.marks.push({ e, tEnd: ecs.brain[e].inkEnd });
    }
    for (const [id, c] of this.clients) {
      this.send(id, { t: MSG.SNAPSHOT, tick: w.tick, ack: c.ack, ents, you: c.entity ? w.playerState(c.entity) : null, enc, frost, storm, ink, clock });
    }
  }
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
