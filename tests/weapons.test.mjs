// M3.5 P3: weapons, racks, equip, lag-compensated shots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuning } from '../src/data/tuning.js';
import { WEAPON, WEAPON_KINDS } from '../src/data/weapons.js';
import { SHOT } from '../src/sim/projectiles.js';
import { LocalServer } from '../src/net/localServer.js';
import { MSG, ENT } from '../src/net/protocol.js';
import { GAME } from '../src/data/meta.js';
import { map, arena, clientAndServer } from './helpers.mjs';

const rack = map.racks[0];
const besideRack = () => [rack.x + 1.5, rack.z];

test('the island has racks, clear of colliders, and the weapons are indexed', () => {
  assert.ok(map.racks.length >= 2);
  assert.deepEqual(WEAPON_KINDS, ['sable', 'pistolas']);
  for (const k of map.racks) {
    assert.ok(map.groundAt(k.x, k.z) > 0.3, 'on dry land');
    const others = map.colliders.filter((c) => Math.hypot(c.x - k.x, c.z - k.z) < 2.6 && !(c.x === k.x && c.z === k.z));
    assert.equal(others.length, 0, `nothing in the way of rack ${k.id}`);
  }
});

test('the weapon only changes next to a rack (w = weapon + 1), with one equip event', () => {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  let evs = step({ w: WEAPON.PISTOLAS + 1 });
  assert.equal(ecs.weapon[e], WEAPON.SABLE, 'far from any rack: nothing');
  assert.ok(!evs.some((ev) => ev.type === 'equip'));
  const [x, z] = besideRack();
  ecs.x[e] = x; ecs.z[e] = z; ecs.y[e] = map.groundAt(x, z);
  evs = step({ w: 9 });
  assert.equal(ecs.weapon[e], WEAPON.SABLE, 'an unknown weapon is ignored');
  ecs.atkStage[e] = 2; ecs.guardT[e] = 0.1;
  evs = step({ w: WEAPON.PISTOLAS + 1 });
  assert.equal(ecs.weapon[e], WEAPON.PISTOLAS);
  assert.equal(evs.filter((ev) => ev.type === 'equip' && ev.weapon === WEAPON.PISTOLAS && ev.e === e).length, 1);
  assert.equal(ecs.atkStage[e], 0, 'the swing is dropped');
  assert.ok(ecs.guardT[e] < 0, 'the guard is dropped');
  evs = step({ w: WEAPON.PISTOLAS + 1 });
  assert.ok(!evs.some((ev) => ev.type === 'equip'), 'already carrying it');
  evs = step({ w: WEAPON.SABLE + 1 });
  assert.equal(ecs.weapon[e], WEAPON.SABLE);
});

test('HELLO picks the starting weapon; describe and the snapshot carry it', () => {
  const out = [];
  const server = new LocalServer({ seed: GAME.seed, bots: 0, enemies: false, send: (id, m) => out.push([id, m]) });
  server.connect(1);
  server.receive(1, { t: MSG.HELLO, name: 'A', skin: 0, weapon: WEAPON.PISTOLAS });
  server.connect(2);
  server.receive(2, { t: MSG.HELLO, name: 'B', skin: 0, weapon: 77 });
  const a = server.clients.get(1).entity, b = server.clients.get(2).entity, ecs = server.world.ecs;
  assert.equal(ecs.weapon[a], WEAPON.PISTOLAS);
  assert.equal(ecs.weapon[b], WEAPON_KINDS.length - 1, 'clamped');
  assert.equal(server.world.describe(a).weapon, WEAPON.PISTOLAS);
  out.length = 0;
  for (let i = 0; i < 4; i++) server.step();
  const snap = out.find(([id, m]) => id === 2 && m.t === MSG.SNAPSHOT)[1];
  assert.equal(snap.ents.find((en) => en[ENT.ID] === a)[ENT.WPN], WEAPON.PISTOLAS);
});

test('client prediction stays exact through weapon swaps at a rack; the equip is shown once', () => {
  const { server, client, deliver, shown, se, ecs } = clientAndServer(() => besideRack());
  let maxErr = 0;
  for (let i = 0; i < 160; i++) {
    const w = i === 20 ? WEAPON.PISTOLAS + 1 : i === 70 ? WEAPON.SABLE + 1 : i === 120 ? WEAPON.PISTOLAS + 1 : 0;
    // Walk away and back between swaps: the last request (120) is made out of reach and does nothing.
    const mx = i > 80 && i < 100 ? 1 : i >= 100 && i < 110 ? -1 : 0;
    client.tickInput({ mx, mz: 0, ax: ecs.x[se] + 5, az: ecs.z[se], btn: 0, prs: 0, w });
    server.step();
    deliver();
    maxErr = Math.max(maxErr, client.stats.predErr);
  }
  for (let i = 0; i < 6; i++) { server.step(); deliver(); }
  assert.equal(maxErr, 0, 'zero prediction error');
  assert.equal(client.pred.ecs.weapon[client.youLocal], ecs.weapon[se]);
  assert.equal(ecs.weapon[se], WEAPON.SABLE, 'the out-of-reach request did nothing');
  const equips = shown.filter((ev) => ev.type === 'equip');
  assert.equal(equips.length, 2, 'two swaps, each shown once');
  assert.ok(equips.every((ev) => ev.predicted && ev.me));
});

// The client saw the dummy at A (it moved to B since); a shot fired at A by a command 150 ms old hits it.
function lagShot(ptBack, kind = SHOT.REFLECT) {
  const { w, e, step } = arena();
  const ecs = w.ecs;
  const ax = ecs.x[e] + 3, az = ecs.z[e];
  const d = w.debugSpawn('dummy', ax, az, -Math.PI / 2);
  for (let i = 0; i < 40; i++) step();
  ecs.z[d] = az + 3; // moves out of the line
  for (let i = 0; i < 3; i++) step();
  w.spawnShot(e, {
    key: 0, pid: 0, type: 0, x: ecs.x[e] + 0.6, y: ecs.y[e] + 1.1, z: ecs.z[e], dx: 1, dz: 0, speed: 20, dmg: 5, life: 0.5, r: 0.2,
    heavy: false, seq: 0, bounce: 0, homing: 0, cone: 0, kind, pt: w.tick - ptBack,
  });
  const evs = [];
  for (let i = 0; i < 40; i++) evs.push(...step());
  return { d, end: evs.find((ev) => ev.type === 'shotEnd'), dmg: evs.find((ev) => ev.type === 'damage' && ev.id === d) };
}

test('shots are judged against the enemies as the shooter saw them (lag compensation)', () => {
  const lagged = lagShot(9); // 150 ms
  assert.equal(lagged.end.hit, lagged.d, 'hits where the client saw the dummy');
  assert.equal(lagged.dmg.kind, 'shot');
  const now = lagShot(0);
  assert.equal(now.end.hit, 0, 'without the lag it would have missed (the dummy is no longer there)');
  const far = lagShot(tuning.combat.rewind + 30);
  assert.equal(far.end.hit, far.d, 'an older command is clamped to the rewind budget (still in the history)');
  const bullet = lagShot(9, SHOT.BULLET);
  assert.equal(bullet.dmg.kind, 'bullet', 'pistol bullets are not reflects (armour and shields apply)');
});
