// M4.8 P4: Tinta's mark, concealment cloud, and authoritative day/night curse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AimCast } from '../src/client/aimcast.js';
import { PEARLS, newPearls } from '../src/data/pearls.js';
import { SKILLS } from '../src/data/weapons.js';
import { SKILL_IDS, skillId, skillIndex, castKind } from '../src/data/tattoos.js';
import { GAME } from '../src/data/meta.js';
import { DT } from '../src/data/tuning.js';
import { World } from '../src/sim/world.js';
import { ENEMIES } from '../src/data/enemies.js';
import { pickTarget } from '../src/sim/systems/enemies.js';
import { installInventory, newProfile, sanitizeProfile, attachProfile, devLoadout } from '../src/sim/systems/inventory.js';
import { givePearl, swallowPearl } from '../src/sim/systems/pearls.js';
import { addInkCloud, inkHidden, inkTargetPoint } from '../src/sim/systems/ink.js';
import { installTrade } from '../src/sim/systems/trade.js';
import { hurtPlayer, usePotion } from '../src/sim/systems/combat.js';
import { stepEnemy } from '../src/sim/systems/enemies.js';
import { bossFire } from '../src/sim/systems/boss.js';
import { BTN } from '../src/sim/systems/movement.js';
import { GameClient } from '../src/client/gameClient.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG } from '../src/net/protocol.js';
import { trustSaves } from '../src/net/saves.js';
import { A, map, incoming } from './helpers.mjs';

function fixture(kind = 'tinta') {
  const w = new World(GAME.seed, { map, server: true });
  installInventory(w, 'tinta-test');
  installTrade(w);
  const e = w.spawnPlayer({ x: A.x, z: A.z + 5, facing: Math.PI / 2 });
  const profile = newProfile();
  attachProfile(w, e, profile);
  const ecs = w.ecs;
  ecs.regenT[e] = 99;
  let seq = 0;
  const step = (cmd = {}) => {
    w.applyCommand(e, { seq: ++seq, mx: 0, mz: 0, ax: ecs.x[e] + 5, az: ecs.z[e], btn: 0, prs: 0, pt: w.tick, ...cmd });
    w.stepWorld();
    const events = w.events.slice();
    w.events.length = 0;
    return events;
  };
  let pearl = null;
  if (kind) {
    pearl = givePearl(w, e, kind);
    assert.ok(pearl, `fixture pearl ${kind}`);
    assert.ok(swallowPearl(w, e, pearl.uid));
    ecs.cdG[e] = 0;
    ecs.regenT[e] = 99;
    w.events.length = 0;
  }
  return { w, e, ecs, profile, pearl, step };
}

function network() {
  const queues = new Map(), bindings = new Map();
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, dev: false,
    send: (id, msg) => queues.get(id)?.push(structuredClone(msg)) });
  const deliver = (id, holdSnapshots = false) => {
    const q = queues.get(id), keep = [];
    const n = q.length;
    for (let i = 0; i < n; i++) {
      const m = q.shift();
      if (holdSnapshots && m.t === MSG.SNAPSHOT) keep.push(m);
      else {
        const b = bindings.get(id);
        if (m.t === MSG.SNAPSHOT) b.snapshot(m); else b.message(m);
      }
    }
    q.push(...keep);
  };
  const join = (id) => {
    queues.set(id, []);
    const binding = {}; bindings.set(id, binding);
    const transport = {
      onMessage: (cb) => { binding.message = cb; },
      onSnapshot: (cb) => { binding.snapshot = cb; },
      start() {},
      sendInput: (_seq, cmd) => server.receive(id, { t: MSG.INPUTS, cmds: [cmd] }),
      send: (msg) => server.receive(id, msg),
    };
    const shown = [];
    const client = new GameClient(transport, map, { emit: (type, ev) => { if (type === 'combat') shown.push(ev); } });
    client.start(); server.connect(id); deliver(id);
    client.join(`Tinta ${id}`, 0); deliver(id);
    server.broadcastSnapshot(); deliver(id);
    return { client, e: server.clients.get(id).entity, shown };
  };
  return { server, deliver, join };
}

test('Tinta registers as a ground pearl without moving persisted tattoo indices', () => {
  assert.equal(PEARLS.tinta.elem, 4);
  assert.equal(PEARLS.tinta.skill, 'inkcloud');
  assert.equal(SKILL_IDS[8], 'comet');
  assert.equal(SKILL_IDS[9], 'iceanchor');
  assert.equal(SKILL_IDS[10], 'mastbolt');
  assert.equal(SKILL_IDS[11], 'inkcloud');
  assert.equal(skillIndex('inkcloud'), 11);
  assert.equal(skillId(11), 'inkcloud');
  assert.equal(castKind('inkcloud'), 'ground');
  assert.deepEqual(newProfile().pearls, newPearls());

  const { w, e, profile } = fixture();
  assert.equal(skillId(w.ecs.skG[e]), 'inkcloud');
  assert.equal(w.ecs.elem[e], 4);
  assert.equal(devLoadout(w, e, 'q', 'inkcloud'), false);
  assert.equal(devLoadout(w, e, 'e', 'inkcloud'), false);
  assert.equal(SKILLS.inkcloud.r, 3);
  const sanitized = sanitizeProfile(profile);
  const loaded = trustSaves.load(trustSaves.store(profile));
  assert.equal(sanitized.pearls.swallowed.kind, 'tinta');
  assert.deepEqual(loaded.pearls, sanitized.pearls, 'sanitizing and save/load preserve the swallowed Tinta pearl');
});

test('ground G previews while held, casts on release, and cancel or lost focus clears the aim', () => {
  const aim = new AimCast();
  const keys = (g = false) => ({ q: false, e: false, r: false, g });
  const tick = ({ down = false, up = false, held = false, cancel = false } = {}) => aim.step({
    down: keys(down), up: keys(up), held: keys(held), cancel,
    kinds: { q: 'dir', e: 'dir', r: 'self', g: castKind(PEARLS.tinta.skill) },
  });

  let out = tick({ down: true, held: true });
  assert.equal(out.prs, 0);
  assert.deepEqual(out.preview, { slot: 'g', kind: 'ground' });
  out = tick({ up: true });
  assert.equal(out.prs, BTN.G);
  assert.equal(out.fire, 'g');
  assert.equal(out.preview, null);

  tick({ down: true, held: true });
  assert.equal(tick({ held: true, cancel: true }).preview, null);
  assert.equal(tick({ up: true }).prs, 0);
  tick({ down: true, held: true });
  assert.equal(tick().preview, null, 'lost focus discards the pending cloud placement');
});

test('the server clamps Ink Cloud to range, starts its cooldown, and rejects G without Tinta', () => {
  const { w, e, ecs, step } = fixture();
  const x = ecs.x[e], z = ecs.z[e];
  step({ prs: BTN.G, ax: x + 40, az: z });
  for (let i = 0; i < 30; i++) step({ ax: x + 40, az: z });
  const cloud = w.inkClouds.find((f) => f.e === e);
  assert.ok(cloud, 'the authoritative world created the cloud');
  assert.ok(Math.abs(Math.hypot(cloud.x - x, cloud.z - z) - SKILLS.inkcloud.range) < 1e-6);
  assert.equal(cloud.r, SKILLS.inkcloud.r);
  assert.ok(Math.abs((cloud.tEnd - cloud.t0) * DT - SKILLS.inkcloud.dur) <= DT);
  assert.ok(ecs.cdG[e] > SKILLS.inkcloud.cd - 1);

  const bare = fixture(null);
  bare.step({ prs: BTN.G });
  for (let i = 0; i < 30; i++) bare.step();
  assert.equal(bare.w.inkClouds.length, 0);
  assert.equal(bare.ecs.cdG[bare.e], 0);
});

test('Tinta marks only after a successful hit, boosts later hits from any attacker, and renews without stacking', () => {
  const { w, e, ecs } = fixture();
  const other = w.spawnPlayer({ x: ecs.x[e] + 2, z: ecs.z[e] });
  const target = w.spawnEnemy('archer', ecs.x[e] + 7, ecs.z[e]);
  ecs.def[target] = 0; ecs.maxHp[target] = ecs.hp[target] = 1000;
  const hit = (by, raw = 10) => w.strike(target, raw, {
    by, kind: 'skill', x: ecs.x[by], z: ecs.z[by], knock: 0, noCrit: true, elem: ecs.elem[by],
  });

  assert.equal(hit(e), 10, 'the hit that applies the mark is not boosted');
  const end = ecs.brain[target].inkEnd;
  assert.equal(end, w.tick + 4 / DT);
  assert.equal(hit(other), 11, 'a different attacker receives the marked-target bonus');
  w.tick += 60;
  assert.equal(hit(other), 11, 'repeated hits do not compound the mark multiplier');
  assert.equal(ecs.brain[target].inkEnd, end, 'other attackers do not extend Tinta status');
  assert.equal(hit(e), 11, 'Tinta also receives only one marked-target multiplier');
  assert.equal(ecs.brain[target].inkEnd, w.tick + 4 / DT, 'a successful hit renews its four-second duration');

  const noDamageTarget = w.spawnEnemy('archer', ecs.x[e] + 9, ecs.z[e]);
  ecs.dead[noDamageTarget] = 1;
  assert.equal(w.strike(noDamageTarget, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem: 4 }), 0);
  assert.equal(ecs.brain[noDamageTarget].inkEnd || 0, 0, 'dead NPCs cannot receive a mark');
  const otherHp = ecs.hp[other];
  w.strike(other, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem: 4 });
  assert.ok(ecs.hp[other] < otherHp, 'the strike still follows normal PvP damage rules');
  assert.equal(ecs.brain[other], null, 'marks are stored only on NPC state');
});

test('marks expire at four seconds, ignore immune targets and noElement hits, and clear on death and slot reuse', () => {
  const { w, e, ecs } = fixture();
  const options = (elem = 4, noElement = false) => ({
    by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem, noElement,
  });
  const target = w.spawnEnemy('archer', ecs.x[e] + 7, ecs.z[e]);
  ecs.maxHp[target] = ecs.hp[target] = 1000; ecs.def[target] = 0;
  w.strike(target, 10, options());
  const end = ecs.brain[target].inkEnd;
  assert.equal(end, w.tick + 240);
  w.tick = end - 1;
  assert.equal(w.strike(target, 10, { ...options(), elem: 0 }), 11, 'the mark remains active through the prior tick');
  w.tick = end;
  assert.equal(w.strike(target, 10, { ...options(), elem: 0 }), 10, 'the mark is inactive at its exact expiry tick');

  const noElement = w.spawnEnemy('archer', ecs.x[e] + 8, ecs.z[e]);
  ecs.def[noElement] = 0;
  assert.ok(w.strike(noElement, 10, options(4, true)) > 0);
  assert.equal(ecs.brain[noElement].inkEnd || 0, 0, 'noElement suppresses the new mark');

  for (const [kind, setup] of [
    ['cannon', (enemy) => {}],
    ['hellfire', (enemy) => { ecs.brain[enemy].inv = 1; }],
  ]) {
    const immune = w.spawnEnemy(kind, ecs.x[e] + 9, ecs.z[e]);
    setup(immune);
    assert.equal(w.strike(immune, 10, options()), 0, `${kind} rejects damage while immune`);
    assert.equal(ecs.brain[immune].inkEnd || 0, 0, `${kind} cannot receive a mark while immune`);
  }

  const lethal = w.spawnEnemy('archer', ecs.x[e] + 10, ecs.z[e]);
  ecs.def[lethal] = 0; ecs.hp[lethal] = 1;
  assert.ok(w.strike(lethal, 10, options()) > 0);
  assert.equal(ecs.alive[lethal], 0, 'the lethal Tinta hit despawns the NPC before a mark can persist');
  const reused = w.spawnEnemy('archer', ecs.x[e] + 10, ecs.z[e]);
  assert.equal(reused, lethal, 'the freed NPC slot is reused');
  assert.equal(ecs.brain[reused].inkEnd || 0, 0, 'a new NPC does not inherit the old mark');
});

test('ordinary, cannon, mortar, and boss attacks target the remembered point inside an ink cloud', () => {
  const aimedSetup = (kind) => {
    const { w, e, ecs } = fixture(null);
    ecs.x[e] = A.x - 40;
    const enemy = w.spawnEnemy(kind, A.x - 5, A.z);
    const target = w.spawnPlayer({ x: A.x - 1, z: A.z });
    const brain = ecs.brain[enemy];
    const seen = inkTargetPoint(w, brain, target);
    addInkCloud(w, { e, seq: 1, x: seen.x, z: seen.z, r: 3, t0: w.tick, tEnd: w.tick + 300 });
    ecs.z[target] += 2; // Still covered, but far enough to produce a different live aim.
    assert.equal(inkHidden(w, target), true);
    return { w, ecs, enemy, target, brain, seen };
  };

  for (const kind of ['archer', 'cannon']) {
    const { w, ecs, enemy, target, brain, seen } = aimedSetup(kind);
    const def = ENEMIES[kind], initial = Math.atan2(seen.x - ecs.x[enemy], seen.z - ecs.z[enemy]);
    ecs.facing[enemy] = initial;
    brain.target = target; brain.state = 'windup'; brain.atk = 0; brain.t = 0;
    w.events.length = 0;
    for (let i = 0; i < Math.ceil(def.attacks[0].windup / DT) + 1; i++) {
      stepEnemy(w, enemy, DT);
      w.tick++;
    }
    const shot = w.events.find((ev) => ev.type === 'pattern' && ev.src === enemy);
    assert.ok(shot, `${kind} fired its real targeted pattern`);
    assert.ok(Math.abs(shot.ang - initial) < 1e-9, `${kind} aimed at the frozen last-seen point`);
  }

  const mortar = aimedSetup('crab');
  const crabDef = ENEMIES.crab, crabBrain = mortar.brain;
  crabBrain.target = mortar.target; crabBrain.state = 'windup'; crabBrain.atk = 0; crabBrain.t = 0;
  mortar.w.events.length = 0;
  for (let i = 0; i < Math.ceil(crabDef.attacks[0].windup / DT) + 1; i++) {
    stepEnemy(mortar.w, mortar.enemy, DT);
    mortar.w.tick++;
  }
  const firstShell = mortar.w.hazards.aoes.find((a) => a.owner === mortar.enemy);
  assert.ok(firstShell, 'the crab committed its mortar shells');
  assert.equal(firstShell.z, mortar.seen.z, 'the shell row uses the stored z even though the hidden pirate moved');

  const boss = aimedSetup('hellfire');
  const bdef = ENEMIES.hellfire, attack = bdef.attacks.find((a) => a.id === 'meteors');
  boss.brain.target = boss.target;
  assert.equal(bossFire(boss.w, boss.enemy, bdef, boss.brain, attack), true);
  const aimedMeteor = boss.w.hazards.aoes.find((a) => a.owner === boss.enemy);
  assert.ok(aimedMeteor, 'Hellfire committed its aimed meteor');
  assert.deepEqual({ x: aimedMeteor.x, z: aimedMeteor.z }, { x: boss.seen.x, z: boss.seen.z },
    'the boss uses the frozen last-seen coordinates rather than the hidden pirate position');
});

test('ink clouds preserve committed danger and do not grant invulnerability or clear hostile bullets', () => {
  const { w, e, ecs } = fixture(null);
  const aoe = w.addAoe({ owner: 0, x: ecs.x[e], z: ecs.z[e], r: 2, t0: w.tick, tAct: w.tick + 30, dmg: 10, keep: 1 });
  const bullet = incoming(w, e, 0, 6, 10, 8);
  const slot = w.hazards.slot.get(bullet);
  const invulnerability = ecs.hurtInv[e];
  addInkCloud(w, { e, seq: 2, x: ecs.x[e], z: ecs.z[e], r: 3, t0: w.tick, tEnd: w.tick + 300 });
  assert.equal(inkHidden(w, e), true);
  assert.ok(w.hazards.aoes.includes(aoe) && !aoe.cancel, 'a committed AOE remains active through the cloud cast');
  assert.equal(w.hazards.live(slot, w.tick), true, 'the cloud does not clear or remove the hostile bullet');
  assert.equal(ecs.hurtInv[e], invulnerability, 'concealment does not add invulnerability frames');
  const hp = ecs.hp[e];
  hurtPlayer(w, e, 10, { x: ecs.x[e] + 1, z: ecs.z[e], kind: 'bullet', src: 0, by: 0, seq: 3, knock: 0 });
  assert.ok(ecs.hp[e] < hp, 'a covered pirate can still take ordinary damage');
});

test('cloud concealment covers every living pirate and freezes each NPC last-seen aim point', () => {
  const { w, e, ecs } = fixture(null);
  const hidden = w.spawnPlayer({ x: ecs.x[e] + 1, z: ecs.z[e] });
  const neverSeen = w.spawnPlayer({ x: ecs.x[e] + 2, z: ecs.z[e] });
  const watcher = w.spawnEnemy('archer', ecs.x[e] - 5, ecs.z[e]);
  const brain = ecs.brain[watcher];
  const visiblePoint = { x: ecs.x[hidden], y: ecs.y[hidden], z: ecs.z[hidden] };
  assert.deepEqual(inkTargetPoint(w, brain, hidden), visiblePoint, 'visible targets update their last-seen position');
  const cloud = { e, seq: 5, x: ecs.x[e], z: ecs.z[e], r: 3, t0: w.tick, tEnd: w.tick + 300 };
  addInkCloud(w, cloud);

  assert.equal(inkHidden(w, e), true);
  assert.equal(inkHidden(w, hidden), true, 'one cloud conceals all covered pirates');
  const lastSeen = inkTargetPoint(w, brain, hidden);
  assert.deepEqual(lastSeen, visiblePoint);
  ecs.x[hidden] += 1; ecs.y[hidden] += 0.25; ecs.z[hidden] += 0.5;
  assert.deepEqual(inkTargetPoint(w, brain, hidden), lastSeen, 'a hidden target stays fixed at its last visible point');
  assert.equal(inkTargetPoint(w, brain, neverSeen), null, 'a hidden pirate with no visible history has no aim point');

  w.tick = cloud.tEnd;
  assert.equal(inkHidden(w, hidden), false, 'the field ends at its exclusive tEnd');
  assert.deepEqual(inkTargetPoint(w, brain, hidden), { x: ecs.x[hidden], y: ecs.y[hidden], z: ecs.z[hidden] });
  ecs.dead[hidden] = 1;
  assert.equal(inkHidden(w, hidden), false, 'dead pirates do not count as hidden targets');
});

test('NPCs cannot acquire a never-seen hidden pirate and prefer a visible replacement over a hidden target', () => {
  const { w, e, ecs } = fixture(null);
  ecs.x[e] = A.x - 40;
  const enemy = w.spawnEnemy('archer', A.x - 2, A.z);
  const hidden = w.spawnPlayer({ x: A.x - 1, z: A.z });
  const visible = w.spawnPlayer({ x: A.x + 3, z: A.z });
  const brain = ecs.brain[enemy];
  const def = ENEMIES.archer;
  addInkCloud(w, { e: e, seq: 1, x: ecs.x[hidden], z: ecs.z[hidden], r: 3, t0: w.tick, tEnd: w.tick + 300 });

  ecs.dead[visible] = 1;
  assert.equal(pickTarget(w, enemy, def, brain), 0, 'no hidden player is acquired without prior sight');
  ecs.dead[visible] = 0;
  brain.inkSeenId = hidden;
  brain.inkSeenX = ecs.x[hidden]; brain.inkSeenY = ecs.y[hidden]; brain.inkSeenZ = ecs.z[hidden];
  brain.target = hidden;
  assert.equal(pickTarget(w, enemy, def, brain), visible, 'a visible pirate replaces an obscured current target');
});

test('daylight weakens potion healing, nighttime boosts outgoing damage, and the snapshot carries authority time', () => {
  const { w, e, ecs } = fixture();
  ecs.hp[e] = 1; ecs.potions[e] = 2; ecs.potCd[e] = 0;
  w.economy.hours = 12;
  assert.equal(w.isNightAt(w.tick), false);
  usePotion(w, e, 1);
  const dayHeal = w.events.find((v) => v.type === 'potion' && v.seq === 1).heal;
  assert.equal(dayHeal, Math.round(ecs.maxHp[e] * 0.4 * 0.7));

  ecs.hp[e] = 1; ecs.potCd[e] = 0; w.economy.hours = 22;
  assert.equal(w.isNightAt(w.tick), true);
  usePotion(w, e, 2);
  const nightHeal = w.events.find((v) => v.type === 'potion' && v.seq === 2).heal;
  assert.equal(nightHeal, Math.round(ecs.maxHp[e] * 0.4), 'night restores the potion to its normal amount');

  const foe = w.spawnEnemy('grunt', ecs.x[e] + 7, ecs.z[e]);
  ecs.def[foe] = 0;
  assert.equal(w.strike(foe, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem: 4 }), 11,
    'night damage applies once before integer damage rounding');
  const plainFoe = w.spawnEnemy('grunt', ecs.x[e] + 9, ecs.z[e]);
  ecs.def[plainFoe] = 0;
  assert.equal(w.strike(plainFoe, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem: 0 }), 11,
    'night damage applies to the full outgoing kit');
  assert.equal(w.strike(foe, 10, { by: e, kind: 'skill', x: ecs.x[e], z: ecs.z[e], noCrit: true, elem: 0 }), 12,
    'night damage composes with the marked-target multiplier before rounding');

  const n = network(), { client } = n.join(1);
  n.server.world.economy.hours = 22;
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.equal(n.server.world.isNightAt(n.server.world.tick), true);
  assert.equal(client.pred.isNightAt(client.pred.tick), true, 'the client uses server snapshot clock, not its lighting setting');
  assert.equal(client.pred.gameHoursAt(client.pred.tick), 22);

  const clockWorld = new World(GAME.seed, { map });
  clockWorld.clock = { tick: 0, hours: 0, daySec: 960 };
  for (const [hours, night] of [[0, true], [5.999, true], [6, false], [19.999, false], [20, true], [23.999, true], [24, true]]) {
    clockWorld.clock.hours = hours;
    assert.equal(clockWorld.isNightAt(0), night, `night classification at game hour ${hours}`);
  }
  clockWorld.clock.hours = 23.99;
  assert.ok(clockWorld.hourAt(24) < 1e-6 || clockWorld.hourAt(24) > 23.999999,
    'the server clock rolls from hour 24 back to hour 0');
  assert.equal(clockWorld.isNightAt(24), true, 'the rollover remains in nighttime');

  const anchor = structuredClone(client.pred.clock);
  client.onSnapshot({ tick: anchor.tick - 1, ack: client.ackSeq, ents: [], enc: [],
    clock: { tick: anchor.tick - 1, hours: 12, daySec: 960 } });
  assert.deepEqual(client.pred.clock, anchor, 'an older snapshot cannot rewind the authoritative clock anchor');
  const beforeClaim = n.server.world.economy.hours;
  n.server.receive(1, { t: MSG.CMD, type: 'dev', op: 'clock', hours: 6 });
  assert.equal(n.server.world.economy.hours, beforeClaim, 'a dev clock command is ignored on a dev:false server');
});

test('a rejected predicted cloud is removed by reconciliation; snapshots recover canonical clouds and marks', () => {
  const n = network(), { client, e } = n.join(1), w = n.server.world;
  const c = n.server.clients.get(1);
  w.ecs.regenT[e] = 99;
  const pearl = givePearl(w, e, 'tinta');
  assert.ok(swallowPearl(w, e, pearl.uid));
  w.ecs.cdG[e] = 0;
  n.server.sendProfile(1, c);
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.equal(client.pred.ecs.elem[client.youLocal], 4);
  client.pred.ecs.cdG[client.youLocal] = 0;

  w.ecs.cdG[e] = 8;
  client.pred.ecs.cdG[client.youLocal] = 0;
  for (let i = 0; i < 80; i++) {
    client.tickInput({ mx: 0, mz: 0, ax: client.pred.ecs.x[client.youLocal] + 8, az: client.pred.ecs.z[client.youLocal], btn: 0, prs: i === 0 ? BTN.G : 0 });
    n.server.step(); n.deliver(1, true);
  }
  assert.ok(client.pred.inkClouds.some((f) => f.predicted), 'local input predicted a cloud');
  assert.equal(w.inkClouds.length, 0, 'server cooldown rejected the cast');
  n.deliver(1);
  assert.equal(client.pred.inkClouds.some((f) => f.predicted), false, 'the delayed authoritative state removes the rejected cloud');

  const field = { e: 777, seq: 19, x: A.x, z: A.z, r: 3, t0: w.tick, tEnd: w.tick + 300 };
  addInkCloud(w, field);
  const marked = w.spawnEnemy('grunt', A.x + 8, A.z);
  w.ecs.def[marked] = 0;
  assert.ok(w.strike(marked, 10, { by: e, kind: 'skill', x: w.ecs.x[e], z: w.ecs.z[e], noCrit: true, elem: 4 }) > 0);
  const markEnd = w.ecs.brain[marked].inkEnd;
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.ok(client.pred.inkClouds.some((f) => f.e === field.e && f.seq === field.seq), 'snapshot repairs a missed cloud event');
  assert.ok(client.pred.inkMarks.some((m) => m.e === marked && m.tEnd === markEnd), 'snapshot restores active NPC marks');
  const late = n.join(2);
  n.server.broadcastSnapshot(); n.deliver(1); n.deliver(2);
  assert.ok(late.client.pred.inkClouds.some((f) => f.e === field.e && f.seq === field.seq), 'late join restores the live cloud');
  assert.ok(late.client.pred.inkMarks.some((m) => m.e === marked && m.tEnd === markEnd), 'late join restores active mark state');
});

test('an accepted G prediction is adopted once and its cloud feedback is shown once', () => {
  const n = network(), { client, e, shown } = n.join(1), w = n.server.world;
  const c = n.server.clients.get(1);
  w.ecs.regenT[e] = 99;
  const pearl = givePearl(w, e, 'tinta');
  assert.ok(swallowPearl(w, e, pearl.uid));
  w.ecs.cdG[e] = 0;
  n.server.sendProfile(1, c);
  n.server.broadcastSnapshot(); n.deliver(1);
  assert.equal(client.pred.ecs.elem[client.youLocal], 4);
  client.pred.ecs.cdG[client.youLocal] = 0;

  for (let i = 0; i < 40; i++) {
    client.tickInput({ mx: 0, mz: 0, ax: client.pred.ecs.x[client.youLocal] + 8, az: client.pred.ecs.z[client.youLocal], btn: 0, prs: i === 0 ? BTN.G : 0 });
    n.server.step(); n.deliver(1);
  }
  const canonical = w.inkClouds.filter((f) => f.e === e);
  const predicted = client.pred.inkClouds.filter((f) => f.e === e);
  assert.equal(canonical.length, 1, 'the authoritative input creates one cloud');
  assert.equal(predicted.length, 1, 'the local copy adopts that field instead of duplicating it');
  assert.equal(predicted[0].predicted, false, 'the matching server event or snapshot owns the surviving field');
  const feedback = shown.filter((ev) => ev.type === 'inkCloud' && ev.e === e);
  assert.equal(feedback.length, 1, 'prediction and the server event produce one cloud feedback');
  assert.equal(feedback[0].predicted, true, 'the immediate predicted feedback is retained');
});
