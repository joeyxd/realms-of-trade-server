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

test('a parry in the first 80 ms is PERFECT, later in the window it is normal', () => {
  for (const [lead, perfect] of [[1, 1], [8, 0]]) {
    const { w, e, step } = arena();
    const id = incoming(w, e);
    // Press so the projectile enters the 1.6 u sector `lead` ticks after the window opens.
    const enter = ticksUntil(w, e, id, tuning.parry.radius + 0.28);
    for (let i = 0; i < enter - lead; i++) step();
    let got = null;
    for (let i = 0; i < 20 && !got; i++) for (const ev of step(i === 0 ? { prs: BTN.PARRY } : {})) if (ev.type === 'parry') got = ev;
    assert.ok(got, 'parried');
    assert.equal(got.perfect, perfect, `lead ${lead} ticks`);
    assert.equal(w.ecs.riposte[e], perfect ? tuning.parry.riposte.perfect : tuning.parry.riposte.normal);
    assert.equal(w.shots.count, 1, 'reflected into a shot');
    assert.equal(w.ecs.hp[e], w.ecs.maxHp[e], 'no damage');
  }
});

test('a whiff locks the parry for 0.35 s; a successful parry does not', () => {
  const { w, e, step } = arena();
  step({ prs: BTN.PARRY });
  let whiff = false;
  for (let i = 0; i < 15; i++) for (const ev of step()) if (ev.type === 'whiff') whiff = true;
  assert.ok(whiff, 'whiff after an empty window');
  assert.ok(w.ecs.parryLock[e] > 0);
  step({ prs: BTN.PARRY });
  assert.ok(w.ecs.parryT[e] < 0, 'no new window during the lock');
  for (let i = 0; i < Math.ceil(tuning.parry.whiffRecovery / DT); i++) step();
  step({ prs: BTN.PARRY });
  assert.ok(w.ecs.parryT[e] >= 0, 'the lock ends');
});

test('coyote: RMB within 60 ms of a parryable touching you cancels its damage', () => {
  for (const [late, hurt] of [[2, false], [6, true]]) {
    const { w, e, step } = arena();
    const id = incoming(w, e);
    let touched = -1;
    for (let i = 0; i < 120 && touched < 0; i++) for (const ev of step()) if (ev.type === 'phit' && ev.pid === id) touched = i;
    assert.ok(touched >= 0, 'touched');
    for (let i = 0; i < late - 1; i++) step();
    const evs = step({ prs: BTN.PARRY });
    const parry = evs.find((ev) => ev.type === 'parry');
    for (let i = 0; i < 10; i++) step();
    if (hurt) assert.ok(w.ecs.hp[e] < w.ecs.maxHp[e], `${late} ticks late: damage lands`);
    else {
      assert.ok(parry && parry.coyote === 1 && parry.perfect === 0, 'converted into a normal parry');
      assert.equal(w.ecs.hp[e], w.ecs.maxHp[e], 'no damage');
    }
  }
});

test('heavy orbs: a normal parry blocks (half damage), only a PERFECT reflects', () => {
  {
    const { w, e, step } = arena();
    const id = incoming(w, e, PTYPE.HEAVY, 6, 4.5, 22);
    const enter = ticksUntil(w, e, id, tuning.parry.radius + 0.65);
    for (let i = 0; i < enter - 8; i++) step();
    const evs = [];
    for (let i = 0; i < 14; i++) evs.push(...step(i === 0 ? { prs: BTN.PARRY } : {}));
    assert.ok(evs.some((ev) => ev.type === 'block'), 'blocked');
    assert.equal(w.ecs.maxHp[e] - w.ecs.hp[e], 11 * 0 + Math.max(1, Math.round(11 * (1 - 2 / 42))), 'half damage after DEF');
    assert.equal(w.shots.count, 0);
  }
  {
    const { w, e, step } = arena();
    const id = incoming(w, e, PTYPE.HEAVY, 6, 4.5, 22);
    const enter = ticksUntil(w, e, id, tuning.parry.radius + 0.65);
    for (let i = 0; i < enter - 1; i++) step();
    const evs = [];
    for (let i = 0; i < 6; i++) evs.push(...step(i === 0 ? { prs: BTN.PARRY } : {}));
    const p = evs.find((ev) => ev.type === 'parry');
    assert.ok(p && p.perfect && p.heavy, 'perfect reflects the heavy orb');
    assert.equal(w.shots.heavy[w.shots.slot.get(w.nextSid - 1)], 1);
  }
});

test('unstoppable spikes: parrying them is punished, dashing through them is FANTASMA', () => {
  {
    const { w, e, step } = arena();
    incoming(w, e, PTYPE.UNSTOP, 6, 10, 14);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...step(i === 25 ? { prs: BTN.PARRY } : {}));
    const hurt = evs.find((ev) => ev.type === 'hurt');
    assert.ok(hurt && hurt.kind === 'punish', 'punished');
    assert.ok(evs.some((ev) => ev.type === 'parry') === false, 'never reflected');
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

test('lag compensation: the server judges a parry at the projectile tick the client saw', () => {
  const { w, e, step } = arena();
  const id = incoming(w, e);
  const enter = ticksUntil(w, e, id, tuning.parry.radius);
  // The client was 8 ticks behind: at server time the arrow is already past the parry sector…
  for (let i = 0; i < enter + 8; i++) w.stepWorld();
  w.events.length = 0;
  const evs = step({ prs: BTN.PARRY, pt: w.tick - 8 });
  assert.ok(evs.some((ev) => ev.type === 'parry'), 'parried at the rewound tick');
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

test('client prediction with projectiles, parries and the combo matches the server exactly', () => {
  const { server, client, deliver, shown, sp, se, ecs } = clientAndServer();
  // Fight: parry now and then, swing now and then.
  let maxErr = 0;
  for (let i = 0; i < 900; i++) {
    client.update(DT);
    const prs = (i % 23 === 0 ? BTN.PARRY : 0) | (i % 41 === 0 ? BTN.ATTACK : 0) | (i === 450 ? BTN.DASH : 0);
    client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: 0, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  const ce = client.youLocal, pe = client.pred.ecs;
  assert.equal(maxErr, 0, 'zero prediction error');
  for (const k of ['x', 'z', 'hp', 'riposte', 'chain', 'xp']) assert.equal(pe[k][ce], ecs[k][se], k);
  const parries = shown.filter((ev) => ev.type === 'parry');
  assert.ok(parries.length > 0, 'some parries happened');
  assert.ok(shown.some((ev) => ev.type === 'hurt' || ev.type === 'graze'), 'and some arrows got through');
  assert.ok(parries.every((ev) => ev.predicted), 'every parry was shown from prediction (none late from the server)');
});

test('a client running at half the server rate keeps its projectile clock, pool and prediction', () => {
  const { server, client, deliver, sp, se, ecs } = clientAndServer();
  let maxErr = 0, maxLag = 0;
  for (let i = 0; i < 1200; i++) {
    // The device only manages one command for every two server ticks.
    client.update(DT);
    client.tickInput({ mx: 0, mz: 0, ax: sp.x, az: sp.z, btn: 0, prs: i % 19 === 0 ? BTN.PARRY : 0 });
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
