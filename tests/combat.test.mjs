// Combat rules (DESIGN §6–§9) on the pure sim: parry windows, coyote, heavy / unstoppable rules,
// destroy, graze, ghost, lag compensation, enemy AI and the client's prediction with projectiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { World } from '../src/sim/world.js';
import { LocalServer } from '../src/net/localServer.js';
import { GameClient } from '../src/client/gameClient.js';
import { MSG } from '../src/net/protocol.js';
import { BTN } from '../src/sim/systems/movement.js';
import { PTYPE, NEVER } from '../src/sim/projectiles.js';
import { timeToContact, reflectTier } from '../src/sim/systems/combat.js';
import { waitForTier } from './helpers.mjs';
import { tuning, DT } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';

const map = generateWorld(GAME.seed);
const A = map.landmarks.arena; // flat, open floor

// A server world with one player standing in the arena facing +x, no map enemies.
function arena() {
  const w = new World(GAME.seed, { map, server: true });
  const e = w.spawnPlayer({ x: A.x, z: A.z + 4, facing: Math.PI / 2 });
  w.events.length = 0;
  let seq = 0;
  const step = (o = {}) => {
    const cmd = { seq: ++seq, mx: 0, mz: 0, ax: w.ecs.x[e] + 5, az: w.ecs.z[e], prs: 0, pt: w.tick, ...o };
    w.applyCommand(e, cmd);
    w.stepWorld();
    const evs = w.events.slice();
    w.events.length = 0;
    return evs;
  };
  return { w, e, step };
}

// A projectile flying at the player along -x, starting `dist` u in front of them.
function incoming(w, e, type = PTYPE.PARRY, dist = 6, speed = 10, dmg = 8, offZ = 0) {
  const id = w.nextPid++;
  w.hazards.spawn(id, type, 0, w.ecs.x[e] + dist, w.ecs.y[e] + 1.1, w.ecs.z[e] + offZ, -speed, 0, w.tick, dmg, map);
  return id;
}

const ticksUntil = (w, e, id, d) => {
  const H = w.hazards, s = H.slot.get(id);
  let t = w.tick;
  while (H.px(s, t) - w.ecs.x[e] > d && t < w.tick + 600) t++;
  return t - w.tick;
};

const TT = { timeToContact, reflectTier, tuning };
// Press LMB `d` commands from now and collect the events of the next 14 commands.
function swingAfter(step, d, extra = {}) {
  for (let i = 0; i < d; i++) step();
  const evs = [];
  for (let i = 0; i < 14; i++) evs.push(...step(i === 0 ? { prs: BTN.ATTACK, ...extra } : {}));
  return evs;
}

test('the timed sword reflect: EXCELENTE, BUENO and POBRE by how close the bullet was', () => {
  const want = {
    3: { speed: 10 * 1.9, dmg: 3 * 8, spread: 0 },
    2: { speed: 10 * 1.4, dmg: 2 * 8, spread: 10 },
    1: { speed: 10 * 1.0, dmg: 1 * 8, spread: 35 },
  };
  for (const tier of [3, 2, 1]) {
    const { w, e, step } = arena();
    const id = incoming(w, e);
    const d = waitForTier(w, e, id, tier, TT);
    assert.ok(d >= 0, `a press reaches tier ${tier}`);
    const evs = swingAfter(step, d);
    const p = evs.find((ev) => ev.type === 'parry');
    assert.ok(p && p.tier === tier, `tier ${tier} (got ${p && p.tier})`);
    assert.equal(p.perfect, tier === 3 ? 1 : 0);
    const shot = evs.find((ev) => ev.type === 'shot');
    assert.ok(Math.abs(shot.speed - want[tier].speed) < 1e-9, `speed × (${shot.speed})`);
    assert.ok(Math.abs(shot.dmg - want[tier].dmg) < 1e-9, `damage × (${shot.dmg})`);
    const off = Math.abs(Math.atan2(shot.dx, shot.dz) - Math.PI / 2) * 180 / Math.PI;
    assert.ok(off <= want[tier].spread + 1e-9, `spread ≤ ${want[tier].spread}° (${off.toFixed(2)}°)`);
    if (tier === 3) assert.ok(off < 1e-9, 'EXCELENTE goes straight at the cursor');
    assert.equal(w.ecs.hp[e], w.ecs.maxHp[e], 'no damage');
    assert.equal(w.ecs.riposte[e], tuning.sword[['', 'poor', 'good', 'excellent'][tier]].riposte);
  }
});

test('the spread of BUENO / POBRE reflects is the same on every machine (hash of id and seq)', () => {
  const dirs = [];
  for (let k = 0; k < 2; k++) {
    const { w, e, step } = arena();
    const id = incoming(w, e);
    const evs = swingAfter(step, waitForTier(w, e, id, 1, TT));
    const shot = evs.find((ev) => ev.type === 'shot');
    dirs.push(Math.atan2(shot.dx, shot.dz));
  }
  assert.equal(dirs[0], dirs[1]);
  assert.ok(Math.abs(dirs[0] - Math.PI / 2) > 1e-6, 'and it does deviate');
});

test('a slow bullet hit early is destroyed, not reflected; mashing LMB mostly destroys', () => {
  const { w, e, step } = arena();
  const id = incoming(w, e, PTYPE.PARRY, 4, 3);
  for (let i = 0; i < 12; i++) step(); // armed, inside the arc
  const evs = swingAfter(step, 0);
  assert.ok(evs.some((ev) => ev.type === 'destroy' && ev.pid === id), 'destroyed');
  assert.ok(!evs.some((ev) => ev.type === 'parry'), 'not reflected');
  // A swing every 12 commands against a stream of bullets: most of them die far out.
  const m = arena();
  for (let k = 0; k < 12; k++) {
    const pid = m.w.nextPid++;
    m.w.hazards.spawn(pid, PTYPE.PARRY, 0, m.w.ecs.x[m.e] + 6, m.w.ecs.y[m.e] + 1.1, m.w.ecs.z[m.e], -8, 0, m.w.tick + k * 9, 8, map);
  }
  const tiers = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 160; i++) for (const ev of m.step(i % 12 === 0 ? { prs: BTN.ATTACK } : {})) {
    if (ev.type === 'parry') tiers[ev.tier]++;
    if (ev.type === 'destroy') tiers[0]++;
  }
  assert.ok(tiers[3] <= 3, `few EXCELENTE from mashing (${JSON.stringify(tiers)})`);
});

test('heavy orbs: only an EXCELENTE swing sends them back; earlier swings clunk', () => {
  for (const [tier, back] of [[3, true], [2, false]]) {
    const { w, e, step } = arena();
    const id = incoming(w, e, PTYPE.HEAVY, 6, 4.5, 22);
    const evs = swingAfter(step, waitForTier(w, e, id, tier, TT));
    const p = evs.find((ev) => ev.type === 'parry');
    if (back) { assert.ok(p && p.tier === 3 && p.heavy, 'reflected'); assert.equal(w.shots.heavy[w.shots.slot.get(w.nextSid - 1)], 1); }
    else { assert.ok(!p, 'not reflected'); assert.ok(evs.some((ev) => ev.type === 'clunk' && ev.pid === id), 'clunk'); }
  }
});

test('guard: blocks × 0.25 from the front for stamina; nothing from behind', () => {
  {
    const { w, e, step } = arena();
    incoming(w, e);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...step({ btn: BTN.GUARD }));
    const g = evs.find((ev) => ev.type === 'guard' && ev.st === 'block');
    assert.ok(g, 'blocked');
    assert.equal(w.ecs.maxHp[e] - w.ecs.hp[e], Math.max(1, Math.round(8 * 0.25 * (1 - 2 / 42))), 'a quarter, after DEF');
    assert.equal(w.ecs.guardSt[e], tuning.guard.stamina - 8, 'stamina');
    assert.equal(w.ecs.catchN[e], 0, 'raised long before: not perfect');
    assert.equal(w.ecs.hurtInv[e], 0, 'a block gives no i-frames');
  }
  {
    const { w, e, step } = arena();
    const id = w.nextPid++;
    w.hazards.spawn(id, PTYPE.PARRY, 0, w.ecs.x[e] - 6, w.ecs.y[e] + 1.1, w.ecs.z[e], 10, 0, w.tick, 8, map);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...step({ btn: BTN.GUARD }));
    assert.ok(!evs.some((ev) => ev.type === 'guard' && ev.st === 'block'), 'not from behind');
    assert.ok(w.ecs.hp[e] < w.ecs.maxHp[e] - 4, 'full damage');
  }
});

test('perfect guard catches the bullet and the next swing throws it back; mashing RMB does not re-arm', () => {
  const { w, e, step } = arena();
  const id = incoming(w, e);
  const t = ticksUntil(w, e, id, 0.64);
  for (let i = 0; i < t - 4; i++) step();
  const evs = [];
  for (let i = 0; i < 10; i++) evs.push(...step({ btn: BTN.GUARD }));
  const g = evs.find((ev) => ev.type === 'guard' && ev.st === 'perfect');
  assert.ok(g && g.pid === id, '¡ATRAPADA!');
  assert.equal(w.ecs.catchN[e], 1);
  assert.equal(w.ecs.hp[e], w.ecs.maxHp[e], 'no damage');
  assert.equal(w.ecs.guardSt[e], tuning.guard.stamina, 'no stamina');
  for (let i = 0; i < 5; i++) step();
  const rel = step({ prs: BTN.ATTACK });
  const r = rel.find((ev) => ev.type === 'release');
  assert.ok(r && r.n === 1, 'released');
  const shot = rel.find((ev) => ev.type === 'shot');
  assert.ok(shot && shot.key < 0 && shot.dmg === 2 * 8, 'thrown back at 2 × R');
  assert.equal(w.ecs.catchN[e], 0);
  // Re-raising within 0.45 s gives no new perfect window.
  const m = arena();
  const id2 = incoming(m.w, m.e);
  const t2 = ticksUntil(m.w, m.e, id2, 0.64);
  for (let i = 0; i < t2 - 16; i++) m.step();
  for (let i = 0; i < 4; i++) m.step({ btn: BTN.GUARD });
  for (let i = 0; i < 6; i++) m.step();
  const evs2 = [];
  for (let i = 0; i < 12; i++) evs2.push(...m.step({ btn: BTN.GUARD }));
  assert.ok(evs2.some((ev) => ev.type === 'guard' && ev.st === 'block'), 'a block, not a catch');
  assert.equal(m.w.ecs.catchN[m.e], 0);
});

test('guard stamina runs out: GUARDIA ROTA stuns you', () => {
  const { w, e, step } = arena();
  for (let k = 0; k < 10; k++) {
    const pid = w.nextPid++;
    w.hazards.spawn(pid, PTYPE.PARRY, 0, w.ecs.x[e] + 5, w.ecs.y[e] + 1.1, w.ecs.z[e], -10, 0, w.tick + 20 + k * 4, 8, map);
  }
  let broke = false;
  for (let i = 0; i < 90 && !broke; i++) for (const ev of step({ btn: BTN.GUARD })) if (ev.type === 'guard' && ev.st === 'break') broke = true;
  assert.ok(broke, 'broken');
  assert.ok(w.ecs.stagger[e] > 0.5, 'stunned');
  assert.equal(w.ecs.guardT[e], -1, 'guard down');
});

test('heavy orb on the guard: × 0.4 and a push; a perfect guard catches it and throws back a heavy shot', () => {
  {
    const { w, e, step } = arena();
    incoming(w, e, PTYPE.HEAVY, 6, 4.5, 22);
    const evs = [];
    for (let i = 0; i < 100; i++) evs.push(...step({ btn: BTN.GUARD }));
    assert.ok(evs.some((ev) => ev.type === 'guard' && ev.st === 'block' && ev.heavy), 'blocked');
    assert.equal(w.ecs.maxHp[e] - w.ecs.hp[e], Math.max(1, Math.round(22 * 0.4 * (1 - 2 / 42))));
  }
  {
    const { w, e, step } = arena();
    const id = incoming(w, e, PTYPE.HEAVY, 6, 4.5, 22);
    const t = ticksUntil(w, e, id, 0.36 + 0.65);
    for (let i = 0; i < t - 3; i++) step();
    for (let i = 0; i < 8; i++) step({ btn: BTN.GUARD });
    assert.equal(w.ecs.catchHv[e], 1, 'caught a heavy one');
    const rel = step({ prs: BTN.ATTACK });
    const shot = rel.find((ev) => ev.type === 'shot');
    assert.ok(shot && shot.heavy === 1 && shot.dmg === 3 * 22, 'heavy, × 3');
  }
});

test('unstoppable spikes pierce the guard and stun; dashing through them is FANTASMA', () => {
  {
    const { w, e, step } = arena();
    incoming(w, e, PTYPE.UNSTOP, 6, 10, 14);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...step({ btn: BTN.GUARD }));
    const hurt = evs.find((ev) => ev.type === 'hurt');
    assert.ok(hurt && hurt.kind === 'punish', 'punished');
    assert.ok(!evs.some((ev) => ev.type === 'guard' && (ev.st === 'block' || ev.st === 'perfect')), 'never blocked');
  }
  {
    const { w, e, step } = arena();
    const id = incoming(w, e, PTYPE.UNSTOP, 6, 10, 14);
    const at = ticksUntil(w, e, id, 1.3);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...step(i === at ? { prs: BTN.DASH, mx: 1 } : {}));
    assert.ok(evs.some((ev) => ev.type === 'ghost'), 'ghost');
    assert.equal(w.ecs.hp[e], w.ecs.maxHp[e], 'no damage through the dash');
    assert.equal(w.ecs.riposte[e], tuning.parry.riposte.ghost);
  }
});

test('coyote: LMB within 60 ms of a parryable touching you is a POBRE reflect, RMB a block', () => {
  for (const [late, btn, expect] of [[2, BTN.ATTACK, 'poor'], [2, BTN.GUARD, 'block'], [6, BTN.ATTACK, 'hurt']]) {
    const { w, e, step } = arena();
    const id = incoming(w, e);
    let touched = -1;
    for (let i = 0; i < 120 && touched < 0; i++) for (const ev of step()) if (ev.type === 'phit' && ev.pid === id) touched = i;
    assert.ok(touched >= 0, 'touched');
    for (let i = 0; i < late - 1; i++) step();
    const evs = step({ prs: btn });
    for (let i = 0; i < 10; i++) evs.push(...step());
    const lost = w.ecs.maxHp[e] - w.ecs.hp[e];
    if (expect === 'poor') {
      const p = evs.find((ev) => ev.type === 'parry');
      assert.ok(p && p.coyote === 1 && p.tier === 1, 'converted into a POBRE reflect');
      assert.equal(lost, 0, 'no damage');
    } else if (expect === 'block') {
      assert.ok(evs.some((ev) => ev.type === 'guard' && ev.st === 'block' && ev.coyote), 'converted into a block');
      assert.equal(lost, Math.max(1, Math.round(8 * 0.25 * (1 - 2 / 42))));
    } else assert.ok(lost >= 7, `${late} ticks late: the damage lands`);
  }
});

test('a guarded melee circle from in front; a mortar shell from the sky is not guarded', () => {
  for (const [keep, guarded] of [[0, true], [1, false]]) {
    const { w, e, step } = arena();
    w.addAoe({ owner: 0, x: w.ecs.x[e] + 0.6, z: w.ecs.z[e], r: 1.2, tAct: w.tick + 30, dmg: 12, keep, sx: w.ecs.x[e] + 1.4, sz: w.ecs.z[e] });
    const evs = [];
    for (let i = 0; i < 40; i++) evs.push(...step({ btn: BTN.GUARD }));
    assert.equal(evs.some((ev) => ev.type === 'guard' && ev.st === 'block' && ev.aoe), guarded, keep ? 'shell' : 'bite');
    assert.equal(w.ecs.maxHp[e] - w.ecs.hp[e], guarded ? Math.max(1, Math.round(12 * 0.25 * (1 - 2 / 42))) : Math.round(12 * (1 - 2 / 42)));
  }
});

test('the active frames of a swing destroy parryables and clunk on heavy orbs', () => {
  const { w, e, step } = arena();
  const a = incoming(w, e, PTYPE.PARRY, 2.4, 3, 8, 0.4);
  const b = incoming(w, e, PTYPE.HEAVY, 2.6, 2, 22, -0.6);
  const evs = [];
  for (let i = 0; i < 4; i++) step(); // arm time
  for (let i = 0; i < 14; i++) evs.push(...step(i === 0 ? { prs: BTN.ATTACK } : {}));
  assert.ok(evs.some((ev) => ev.type === 'destroy' && ev.pid === a), 'destroyed');
  assert.ok(evs.some((ev) => ev.type === 'clunk' && ev.pid === b), 'clunk');
  assert.equal(w.hazards.dead[w.hazards.slot.get(b)], NEVER, 'the heavy orb keeps going');
  assert.equal(w.ecs.riposte[e], tuning.parry.riposte.destroy);
});

test('the combo chains 3 stages with buffered presses, and restarts after the gap', () => {
  const { w, e, step } = arena();
  const stages = [];
  for (let i = 0; i < 90; i++) for (const ev of step(i % 12 === 0 && i < 40 ? { prs: BTN.ATTACK } : {})) if (ev.type === 'swing') stages.push(ev.stage);
  assert.deepEqual(stages, [1, 2, 3]);
  for (let i = 0; i < 40; i++) step();
  const again = [];
  for (const ev of step({ prs: BTN.ATTACK })) if (ev.type === 'swing') again.push(ev.stage);
  assert.deepEqual(again, [1], 'a press long after stage 3 starts over');
});

test('a projectile brushing past is a graze, once', () => {
  const { w, e, step } = arena();
  incoming(w, e, PTYPE.PARRY, 6, 10, 8, 0.36 + 0.28 + 0.2);
  let n = 0;
  for (let i = 0; i < 80; i++) for (const ev of step()) if (ev.type === 'graze') n++;
  assert.equal(n, 1);
  assert.equal(w.ecs.hp[e], w.ecs.maxHp[e]);
  assert.equal(w.ecs.riposte[e], tuning.parry.riposte.graze);
});

test('lag compensation: the server judges a swing at the projectile tick the client saw', () => {
  const { w, e, step } = arena();
  const id = incoming(w, e);
  const d = waitForTier(w, e, id, 3, TT);
  // The client was 8 ticks behind: at server time the arrow has already hit…
  for (let i = 0; i < d + 8; i++) w.stepWorld();
  w.events.length = 0;
  const evs = [];
  for (let i = 0; i < 6; i++) evs.push(...step({ prs: i === 0 ? BTN.ATTACK : 0, pt: w.tick - 8 }));
  const p = evs.find((ev) => ev.type === 'parry');
  assert.ok(p && p.tier === 3, 'EXCELENTE at the rewound tick');
  // …and far-off ticks are clamped to the rewind budget.
  assert.equal(w.cmdTick(e, { pt: 1 }), w.tick - tuning.combat.rewind);
});

test('the archer fires aimed bursts of 3 that hit an idle player', () => {
  const w = new World(GAME.seed, { map, server: true });
  w.populate();
  const sp = map.enemySpawns.find((s) => s.kind === 'archer');
  const e = w.spawnPlayer({ x: sp.x - 9, z: sp.z });
  let patterns = 0, hits = 0;
  for (let i = 0; i < 60 * 8; i++) {
    w.applyCommand(e, { seq: i + 1, mx: 0, mz: 0, prs: 0, ax: 0, az: 0, pt: w.tick });
    w.stepWorld();
    for (const ev of w.events) { if (ev.type === 'pattern') { patterns++; assert.equal(ev.n, 3); } if (ev.type === 'hurt') hits++; }
    w.events.length = 0;
  }
  assert.ok(patterns >= 3, `volleys: ${patterns}`);
  assert.ok(hits >= 1, `hits: ${hits}`);
});

test('reflected arrows kill an archer, XP goes to the player and levels them up', () => {
  const w = new World(GAME.seed, { map, server: true });
  const p = w.spawnPlayer({ x: A.x - 6, z: A.z, facing: Math.PI / 2 });
  w.ecs.xp[p] = 90;
  const a = w.debugSpawn('archer', A.x + 4, A.z, -Math.PI / 2);
  const evs = [];
  for (let k = 0; k < 3; k++) w.spawnShot(p, { pid: 0, type: PTYPE.PARRY, x: A.x - 4, y: 5.7, z: A.z, dx: 1, dz: 0, speed: 14, dmg: 16, life: 2.5, r: 0.25, heavy: false, seq: 0 });
  for (let i = 0; i < 60; i++) { w.stepWorld(); evs.push(...w.events); w.events.length = 0; }
  assert.ok(evs.some((ev) => ev.type === 'kill' && ev.id === a), 'killed');
  assert.ok(!w.ecs.alive[a]);
  assert.equal(w.ecs.level[p], 2, 'level up (90 + 25 XP)');
  assert.equal(w.ecs.dashMax[p], 2, 'Lv2: second dash charge');
});

test('melee hits enemies where the attacker saw them (interp delay rewind)', () => {
  const w = new World(GAME.seed, { map, server: true });
  const p = w.spawnPlayer({ x: A.x, z: A.z, facing: Math.PI / 2 });
  const d = w.debugSpawn('dummy', A.x + 1.6, A.z);
  for (let i = 0; i < 40; i++) w.stepWorld();
  // The dummy "was" in front 6 ticks ago and has since been moved away (as if it walked).
  w.ecs.x[d] = A.x + 6;
  const evs = [];
  let seq = 0;
  for (let i = 0; i < 12; i++) {
    w.applyCommand(p, { seq: ++seq, mx: 0, mz: 0, ax: A.x + 5, az: A.z, prs: i === 0 ? BTN.ATTACK : 0, pt: w.tick });
    w.stepWorld();
    evs.push(...w.events); w.events.length = 0;
  }
  const hit = evs.find((ev) => ev.type === 'damage' && ev.id === d);
  assert.ok(hit && hit.dmg >= 10, 'hit at the rewound position');
});

// A GameClient wired to a LocalServer in-process (messages cloned like the worker would).
function clientAndServer() {
  const toClient = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, send: (_id, m) => toClient.push(JSON.parse(JSON.stringify(m))) });
  const snaps = [], msgs = [];
  const transport = {
    onSnapshot: (cb) => snaps.push(cb), onMessage: (cb) => msgs.push(cb), start() {},
    sendInput: (_s, cmd) => server.receive(1, { t: MSG.INPUTS, cmds: [cmd] }),
    send: (m) => server.receive(1, m),
  };
  const shown = [];
  const bus = { emit: (type, ev) => { if (type === 'combat') shown.push(ev); } };
  const client = new GameClient(transport, map, bus);
  client.start();
  const deliver = () => {
    while (toClient.length) {
      const m = toClient.shift();
      if (m.t === MSG.SNAPSHOT) snaps.forEach((cb) => cb(m)); else msgs.forEach((cb) => cb(m));
    }
  };
  server.connect(1);
  deliver();
  client.join('Test', 1);
  deliver();
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.ok(client.joined);
  // Stand near an archer.
  const sp = map.enemySpawns.find((s) => s.kind === 'archer');
  const se = server.clients.get(1).entity;
  const ecs = server.world.ecs;
  ecs.x[se] = sp.x - 8; ecs.z[se] = sp.z; ecs.y[se] = map.groundAt(sp.x - 8, sp.z);
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  return { server, client, deliver, shown, sp, se, ecs };
}

test('client prediction with projectiles, sword reflects, guards and the combo matches the server exactly', () => {
  const { server, client, deliver, shown, sp, se, ecs } = clientAndServer();
  // Fight: swing now and then, hold the guard now and then.
  let maxErr = 0;
  for (let i = 0; i < 900; i++) {
    client.update(DT);
    const guard = i % 120 >= 60;
    const prs = (i % 11 === 0 && !guard ? BTN.ATTACK : 0) | (i === 450 ? BTN.DASH : 0);
    client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: guard ? BTN.GUARD : 0, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  const ce = client.youLocal, pe = client.pred.ecs;
  assert.equal(maxErr, 0, 'zero prediction error');
  for (const k of ['x', 'z', 'hp', 'riposte', 'chain', 'xp']) assert.equal(pe[k][ce], ecs[k][se], k);
  const parries = shown.filter((ev) => ev.type === 'parry' || ev.type === 'destroy');
  assert.ok(parries.length > 0, 'some reflects / destroys happened');
  assert.ok(shown.some((ev) => ev.type === 'guard' && ev.st === 'block'), 'some blocks');
  assert.ok(shown.some((ev) => ev.type === 'hurt' || ev.type === 'graze'), 'and some arrows got through');
  assert.ok(parries.every((ev) => ev.predicted), 'every reflect was shown from prediction (none late from the server)');
});

test('a client running at half the server rate keeps its projectile clock, pool and prediction', () => {
  const { server, client, deliver, sp, se, ecs } = clientAndServer();
  let maxErr = 0, maxLag = 0;
  for (let i = 0; i < 1200; i++) {
    // The device only manages one command for every two server ticks.
    client.update(DT);
    client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: i % 90 < 30 ? BTN.GUARD : 0, prs: i % 19 === 0 ? BTN.ATTACK : 0 });
    server.step(); server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
    if (i > 300) maxLag = Math.max(maxLag, Math.abs(client.stats.ptLag));
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  assert.ok(maxLag <= 6, `projectile tick stays close to the server clock (lag ${maxLag})`);
  const live = server.world.hazards.count;
  assert.ok(client.hazards.count <= live + 8, `client pool is swept (${client.hazards.count} vs server ${live})`);
  for (const k of ['hp', 'riposte', 'xp']) assert.equal(client.pred.ecs[k][client.youLocal], ecs[k][se], k);
});
