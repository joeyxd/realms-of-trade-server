// PT06: the jump inside the world: the switch (off is today's game), cliffs, fall damage, water, the dash charge,
// prediction against the server, the height history and the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arena, clientAndServer, map } from './helpers.mjs';
import { World } from '../src/sim/world.js';
import { BTN } from '../src/sim/systems/movement.js';
import { STATE } from '../src/sim/ecs.js';
import { DT, tuning } from '../src/data/tuning.js';
import { GAME } from '../src/data/meta.js';
import { ENT, PROTOCOL_VERSION, encodeEntity, sanitizeCmd } from '../src/net/protocol.js';
import { jumpFromEnv } from '../server/index.mjs';
import { createGameServer } from '../server/index.mjs';
import { createMemoryStore } from '../server/store.mjs';

const J = BTN.JUMP, FLOOR = 5;
const base = { ...map, queryColliders: () => [], onDock: () => false };
const world = (groundAt, o = {}) => ({ ...base, groundAt, ...o });
const flat = world(() => FLOOR);
const air = (a) => a.w.ecs.jmpAct[a.e] >= 1 && a.w.ecs.jmpAct[a.e] <= 4;
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} vs ${want} +-${tol}`);

// Airborne at `h` above the floor, in freefall, until it lands (or dies).
function fall(mode, h, mp = flat, o = {}) {
  const a = arena({ jump: mode, map: mp, x: 0, z: 0, ...o });
  const ecs = a.w.ecs, e = a.e, maxHp = ecs.maxHp[e], y = ecs.y[e] + h;
  ecs.y[e] = y; ecs.jmpAct[e] = 4; ecs.jmpPeak[e] = y;
  for (let i = 0; i < 900 && air(a); i++) a.step({});
  return { a, maxHp, lost: maxHp - ecs.hp[e], dead: ecs.dead[e] > 0 };
}

test('the default is off: the jump bit does nothing and y follows the floor on every tick of a cliff walk', () => {
  assert.equal(new World(GAME.seed, { map }).jumpMode, 'off');
  const cliff = world((x) => (x < 3 ? FLOOR + 10 : FLOOR));
  const a = arena({ map: cliff, x: 0, z: 0 });
  const ecs = a.w.ecs, e = a.e;
  assert.equal(a.w.jumpMode, 'off');
  for (let i = 0; i < 90; i++) {
    a.step({ mx: 1, prs: i % 7 === 0 ? J : 0, btn: J });
    assert.equal(ecs.y[e], cliff.groundAt(ecs.x[e], ecs.z[e]), `y on tick ${i}`);
    assert.equal(ecs.jmpAct[e], 0);
  }
  assert.ok(ecs.x[e] > 3 && ecs.y[e] === FLOOR, 'walked off the 10 u cliff and stood on the lower floor');
  assert.equal(ecs.dashCharges[e], 1, 'no charge spent');
  assert.equal(Math.hypot(ecs.vx[e], ecs.vz[e]) <= tuning.player.runSpeed + 1e-9, true, 'off keeps run speed 6.5');
});

test('lab: walking off a 5 u drop is a freefall that lands; lab run speed 8.5', () => {
  const a = arena({ jump: 'lab', map: world((x) => (x < 3 ? FLOOR + 5 : FLOOR)), x: 0, z: 0 });
  const ecs = a.w.ecs, e = a.e;
  const acts = new Set();
  for (let i = 0; i < 90; i++) { a.step({ mx: 1 }); acts.add(ecs.jmpAct[e]); }
  assert.ok(acts.has(4), 'FREEFALL');
  assert.ok(acts.has(8), 'FREEFALL_LAND');
  assert.equal(ecs.y[e], FLOOR);
  assert.equal(ecs.hp[e], ecs.maxHp[e], '5 u hurts nobody');
  near(Math.hypot(ecs.vx[e], ecs.vz[e]), 8.5, 1e-6, 'lab run speed');
});

test('fall damage: 13.5 u costs 25 percent, 12.5 u nothing, 34 u half in lab and death in game', () => {
  const t1 = fall('lab', 13.5);
  assert.equal(t1.lost, Math.round(t1.maxHp * 0.25));
  assert.equal(t1.a.w.ecs.jmpSq[t1.a.e] > 20, true, 'squish timer running');
  assert.equal(fall('lab', 12.5).lost, 0);
  assert.equal(fall('lab', 12.5).dead, false);
  const big = fall('lab', 34);
  assert.equal(big.lost, Math.round(big.maxHp * 0.5));
  assert.equal(big.dead, false);
  const g = fall('game', 34);
  assert.equal(g.dead, true, 'in game mode a big fall kills');
  assert.equal(fall('game', 13.5).lost, Math.round(g.maxHp * 0.25), 'game tier 1 is the same 25 percent');
  // God mode is respected: true damage still goes through hurtPlayer.
  const a = arena({ jump: 'game', map: flat, x: 0, z: 0 });
  a.w.ecs.god[a.e] = 1;
  const y = a.w.ecs.y[a.e] + 34;
  a.w.ecs.y[a.e] = y; a.w.ecs.jmpAct[a.e] = 4; a.w.ecs.jmpPeak[a.e] = y;
  for (let i = 0; i < 900 && air(a); i++) a.step({});
  assert.equal(a.w.ecs.hp[a.e], a.w.ecs.maxHp[a.e]);
});

test('prediction never hurts: a client world (not a server) takes no fall damage', () => {
  const w = new World(GAME.seed, { map: flat }); // isServer false
  w.jumpMode = 'game';
  const e = w.spawnPlayer({ x: 0, z: 0 });
  const y = w.ecs.y[e] + 34;
  w.ecs.y[e] = y; w.ecs.jmpAct[e] = 4; w.ecs.jmpPeak[e] = y;
  for (let i = 0; i < 900 && w.ecs.jmpAct[e] === 4; i++) w.applyCommand(e, { seq: i + 1, mx: 0, mz: 0, ax: 5, az: 0, btn: 0, prs: 0, pt: 0, w: 0 });
  assert.ok(w.ecs.jmpAct[e] >= 5, 'landed');
  assert.equal(w.ecs.hp[e], w.ecs.maxHp[e]);
});

test('after a tier-1 fall a jump within 30 frames is a single at half vy', () => {
  const { a } = fall('lab', 13.5);
  const ecs = a.w.ecs, e = a.e;
  for (let i = 0; i < 10; i++) a.step({}); // 5 frames
  a.step({ prs: J, btn: J });
  for (let i = 0; i < 2 && !air(a); i++) a.step({ btn: J });
  assert.equal(ecs.jmpAct[e], 1, 'a single, not the double the chain would give');
  near(ecs.jmpVy[e], 14.175 * 0.5, 1e-9, 'half vy');
});

test('landing in deep water from 20 u: no damage, the body swims', () => {
  const sea = world((x) => (x < 0 ? FLOOR : -6));
  const a = arena({ jump: 'lab', map: sea, x: 10, z: 0 });
  const ecs = a.w.ecs, e = a.e;
  ecs.y[e] = 20; ecs.jmpAct[e] = 4; ecs.jmpPeak[e] = 20;
  for (let i = 0; i < 300 && air(a); i++) a.step({});
  assert.equal(ecs.swim[e], 1);
  assert.equal(ecs.state[e], STATE.SWIM);
  assert.equal(ecs.hp[e], ecs.maxHp[e]);
  assert.equal(ecs.jmpAct[e], 0);
  near(ecs.y[e], tuning.world.waterLevel - tuning.swim.bodyDepth, 1e-9, 'swim height');
});

test('a 40 u slope of 2.75 (70 degrees) ends in death at the bottom in game mode: steep contact keeps the peak', () => {
  const H = 40, S = 2.75, L = H / S;
  const ramp = world((x) => (x < 0 ? FLOOR + H : x < L ? FLOOR + H - S * x : FLOOR));
  for (const [mode, lethal] of [['game', true], ['lab', false]]) {
    const a = arena({ jump: mode, map: ramp, x: -2, z: 0 });
    const ecs = a.w.ecs, e = a.e;
    let steep = false, stage6 = false;
    for (let i = 0; i < 900 && !ecs.dead[e] && !(ecs.jmpAct[e] >= 5); i++) {
      a.step({ mx: ecs.jmpAct[e] ? 0 : 1 }); // walk to the edge, then let go of the stick
      if (ecs.jmpSteep[e] > 0) steep = true;
      if (encodeEntity(ecs, e)[ENT.JMP] === 6) stage6 = true;
    }
    assert.ok(steep && stage6, `${mode}: slid on the steep ground`);
    if (lethal) assert.ok(ecs.dead[e] > 0, 'dead at the bottom');
    else { assert.equal(ecs.dead[e], 0); assert.equal(ecs.maxHp[e] - ecs.hp[e], Math.round(ecs.maxHp[e] * 0.5)); }
    assert.ok(ecs.x[e] > L - 1, 'reached the bottom of the ramp');
  }
});

test('game mode spends one dash charge per jump and with none the press does nothing; lab spends none', () => {
  const g = arena({ jump: 'game', map: flat, x: 0, z: 0 });
  const ecs = g.w.ecs, e = g.e;
  assert.equal(ecs.dashCharges[e], 1);
  g.step({ prs: J, btn: J });
  assert.ok(air(g));
  assert.equal(ecs.dashCharges[e], 0);
  while (air(g)) g.step({ btn: J });
  g.step({ prs: J, btn: J });
  for (let i = 0; i < 3; i++) g.step({ btn: J });
  assert.ok(!air(g), 'no charge, no jump');
  near(Math.hypot(ecs.vx[e], ecs.vz[e]), 0, 1e-9, 'standing');
  for (let i = 0; i < 70; i++) g.step({}); // the charge is back after 0.9 s
  assert.equal(ecs.dashCharges[e], 1);
  g.step({ prs: J, btn: J });
  assert.ok(air(g));
  const l = arena({ jump: 'lab', map: flat, x: 0, z: 0 });
  l.step({ prs: J, btn: J });
  assert.ok(air(l));
  assert.equal(l.w.ecs.dashCharges[l.e], 1);
});

test('the jump is refused while swimming and on a raft deck; in the air dash and attack presses are ignored', () => {
  const sea = arena({ jump: 'lab', map: world(() => -6), x: 0, z: 0 });
  sea.step({});
  assert.equal(sea.w.ecs.swim[sea.e], 1);
  sea.step({ prs: J });
  assert.ok(!air(sea) && sea.w.ecs.jmpAct[sea.e] === 0);
  const deck = arena({ jump: 'lab', map: flat, x: 0, z: 0 });
  deck.w.raftDeck = { size: 0, surface: () => ({ y: FLOOR, kind: 'deck', id: 1 }), blocked: () => false, update() {} }; // a stand-in deck under the feet
  deck.step({ prs: J });
  assert.ok(!air(deck), 'no jump from a raft deck');
  const a = arena({ jump: 'lab', map: flat, x: 0, z: 0 });
  a.step({ prs: BTN.ATTACK });
  assert.ok(a.w.ecs.atkStage[a.e] > 0, 'a swing started');
  a.step({ prs: J, btn: J });
  assert.ok(air(a));
  assert.equal(a.w.ecs.atkStage[a.e], 0, 'the jump cancelled the swing like a dash');
  a.step({ prs: BTN.ATTACK | BTN.DASH | BTN.POTION | BTN.Q, btn: BTN.GUARD | J });
  assert.equal(a.w.ecs.atkStage[a.e], 0);
  assert.equal(a.w.ecs.atkBuf[a.e], 0, 'nothing is buffered in the air');
  assert.equal(a.w.ecs.dashBuffer[a.e], 0);
  assert.equal(a.w.ecs.guardT[a.e], -1);
});

test('client prediction through a single, double and triple jump matches the server (reconcile error < 0.01)', () => {
  const { server, client, deliver, ecs, se } = clientAndServer(() => [-150, -140], { jump: 'lab' });
  assert.equal(client.pred.jumpMode, 'lab', 'WELCOME carries the mode');
  const pe = client.pred.ecs, ce = client.youLocal;
  const kinds = new Set();
  let maxErr = 0;
  for (let i = 0; i < 700; i++) {
    client.update(DT);
    const act = pe.jmpAct[ce];
    const inAir = act >= 1 && act <= 4;
    if (inAir) kinds.add(act);
    const prs = i > 30 && ((act === 0 && kinds.size === 0) || (act >= 5 && act <= 8 && kinds.size < 3)) ? J : 0;
    client.tickInput({ mx: 1, mz: 0, ax: pe.x[ce] + 5, az: pe.z[ce], btn: inAir || prs ? J : 0, prs });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.ok(kinds.has(1) && kinds.has(2) && kinds.has(3), `single, double and triple seen: ${[...kinds]}`);
  assert.ok(maxErr < 0.01, `reconcile error ${maxErr}`);
  for (const k of ['x', 'y', 'z', 'jmpAct', 'jmpPh', 'jmpVy', 'jmpFwd']) assert.equal(pe[k][ce], ecs[k][se], k);
});

test('the height history: a shot tested at a rewound tick uses the feet where the shooter saw them', () => {
  const cala = map.cala;
  const spot = world(() => FLOOR);
  const run = (mode, back) => {
    const { w, e, step } = arena({ jump: mode, map: spot, x: cala.x, z: cala.z });
    const shooter = w.spawnPlayer({ name: 'Tirador', x: cala.x - 5, z: cala.z, facing: Math.PI / 2 });
    assert.ok(w.lawless(e) && w.lawless(shooter), 'both stand in the Cala');
    step({ prs: J, btn: J });
    let apexTick = 0, apexY = 0;
    for (let i = 0; i < 70; i++) {
      step({ btn: J });
      if (w.ecs.y[e] > apexY) { apexY = w.ecs.y[e]; apexTick = w.tick; }
      if (w.ecs.jmpAct[e] >= 5 && i > 10) break;
    }
    for (let i = 0; i < 3; i++) step({});
    const lag = back ? w.tick - apexTick : 0;
    if (back && mode !== 'off') near(w.lagPos(e, lag, { x: 0, z: 0, y: 0 }).y, apexY, 0.05, 'rewound y is the apex');
    const hp = w.ecs.hp[e];
    w.spawnShot(shooter, { x: cala.x - 5, y: FLOOR + 1.3, z: cala.z, dx: 1, dz: 0, speed: 26, dmg: 30, life: 1, r: 0.2, homing: 0, lag });
    for (let i = 0; i < 20; i++) step({});
    return { hit: w.ecs.hp[e] < hp, lag };
  };
  const rewound = run('lab', true);
  assert.ok(rewound.lag > 15 && rewound.lag < 31, `lag ${rewound.lag}`);
  assert.equal(rewound.hit, false, 'a jumper at its apex in the rewound tick is missed by a shot at 1.3 u');
  assert.equal(run('lab', false).hit, true, 'the same shot at the present tick hits a jumper standing on the floor');
});

test('the wire: BTN.JUMP survives sanitizeCmd, ENT carries the stage, protocol 67 or later', () => {
  assert.ok(PROTOCOL_VERSION >= 67, `protocol ${PROTOCOL_VERSION}`); // the jump wire landed in 67
  assert.equal(ENT.JMP, 20);
  assert.equal(BTN.JUMP, 1024);
  const c = sanitizeCmd({ seq: 1, btn: J | BTN.DASH, prs: J, mx: 0, mz: 0 });
  assert.equal(c.btn, J | BTN.DASH);
  assert.equal(c.prs, J);
  assert.equal(sanitizeCmd({ seq: 1, btn: 0xffff, prs: 0xffff }).btn, 0x7ff);
  const a = arena({ jump: 'lab', map: flat, x: 0, z: 0 });
  assert.equal(encodeEntity(a.w.ecs, a.e)[ENT.JMP], 0);
  a.step({ prs: J, btn: J });
  assert.equal(encodeEntity(a.w.ecs, a.e)[ENT.JMP], 1);
});

test('MN_JUMP: off | lab | game; unset or unknown is off with one warning; /status shows the mode', async (t) => {
  assert.equal(jumpFromEnv(undefined), 'off');
  assert.equal(jumpFromEnv('lab'), 'lab');
  assert.equal(jumpFromEnv('game'), 'game');
  const warn = console.warn, seen = [];
  console.warn = (m) => seen.push(m);
  try { assert.equal(jumpFromEnv('mario'), 'off'); } finally { console.warn = warn; }
  assert.equal(seen.length, 1);
  const gs = createGameServer({ port: 0, host: '127.0.0.1', bots: 0, log: () => {}, saveSecret: 'test-secret', store: createMemoryStore(), jump: 'game' });
  const port = await gs.listen(); t.after(() => gs.close());
  const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
  assert.deepEqual(status.storage.jump, { mode: 'game' });
  assert.equal(gs.game.server.world.jumpMode, 'game');
});
