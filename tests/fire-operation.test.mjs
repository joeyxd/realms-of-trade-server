import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { fireMutation, fireProfileDelta, fireWorldTransition } from '../server/fireOperation.mjs';
import { newFire, remainingFire } from '../src/sim/economy/fire.js';

const command = (op, changes = {}) => ({ type: 'fire', op, opId: `fire-${op}`, ship: '', part: 'hand',
  kind: 'handTorch', expectedRev: 0, lit: false, ...changes });
const profile = () => { const p = newProfile(); p.eco.pack.goods.madera = 2; return p; };

test('hand torch fuel load debits exactly one madera and increments both bounded revisions', () => {
  const before = profile(), cmd = command('load');
  const result = fireProfileDelta(before, cmd, 12);
  assert.equal(result.why, '');
  assert.equal(result.profile.eco.pack.goods.madera, 1);
  assert.equal(result.profile.eco.tradeRev, before.eco.tradeRev + 1);
  assert.equal(result.profile.fire.rev, 1);
  assert.deepEqual(result.profile.fire.slots.hand, { kind: 'handTorch', seconds: 1200, since: 0, lit: false });
  assert.equal(before.fire, undefined, 'legacy profile remains untouched');
  assert.equal(fireProfileDelta(result.profile, command('load', { expectedRev: 1 }), 12).why, 'occupied');
});

test('set settles elapsed fire time by flooring remaining fuel and never spends wood', () => {
  const before = profile(); before.fire = newFire();
  before.fire.slots.hand = { kind: 'handTorch', seconds: 100, since: 10, lit: true };
  const result = fireProfileDelta(before, command('set', { expectedRev: 0, lit: false }), 10.9);
  assert.equal(result.why, '');
  assert.deepEqual(result.profile.fire.slots.hand, { kind: 'handTorch', seconds: 99, since: 0, lit: false });
  assert.equal(result.profile.eco.pack.goods.madera, 2);
  assert.equal(result.profile.eco.tradeRev, before.eco.tradeRev);
  assert.equal(result.profile.fire.rev, 1);
});

test('raft fuel uses only the owner profile and matching living condition identity', () => {
  const before = profile(), ship = before.eco.ships[0];
  ship.id = 'raft-one'; ship.hold.goods.madera = 1;
  ship.grid.parts.push(['lantern', 0, 0, 0, 0]);
  ship.condition = { v: 1, next: 2, entries: [
    ['p1', 'lantern', 0, 0, 0, 0, 10],
  ] };
  const cmd = command('load', { ship: ship.id, part: 'p1', kind: 'lantern' });
  const result = fireProfileDelta(before, cmd, 0);
  assert.equal(result.why, '');
  assert.equal(result.profile.eco.ships[0].hold.goods.madera, undefined);
  assert.equal(result.profile.eco.tradeRev, 1);
  assert.equal(result.profile.fire.slots['["raft-one","p1"]'].kind, 'lantern');

  const fromPack = structuredClone(result.profile);
  fromPack.fire = newFire(); fromPack.eco.ships[0].hold.goods = {};
  const fallback = fireProfileDelta(fromPack, { ...cmd, opId: 'station-pack-fallback', expectedRev: 0 }, 0);
  assert.equal(fallback.why, '');
  assert.equal(fallback.profile.eco.pack.goods.madera, 1, 'station draws from the pack after the hold is empty');
  const both = structuredClone(before); both.eco.pack.goods.madera = 2; both.eco.ships[0].hold.goods.madera = 1;
  const holdFirst = fireProfileDelta(both, cmd, 0);
  assert.equal(holdFirst.profile.eco.ships[0].hold.goods.madera, undefined);
  assert.equal(holdFirst.profile.eco.pack.goods.madera, 2, 'station consumes hold wood before pack wood');

  const unrelated = structuredClone(before); unrelated.eco.ships[0].id = 'raft-other';
  assert.equal(fireProfileDelta(unrelated, cmd, 0).why, 'ownership');
  ship.condition.entries[0][6] = 0;
  assert.equal(fireProfileDelta(before, cmd, 0).why, 'ownership');
});

test('malformed fire state and unauthorized profile deltas are rejected', () => {
  const before = profile(); before.fire = { v: 1, rev: 0, slots: { bad: 'not a slot' } };
  assert.equal(fireProfileDelta(before, command('set'), 0).why, 'input');
  const clean = profile(), result = fireProfileDelta(clean, command('load'), 0);
  assert.equal(fireMutation(command('load')), true);
  const tampered = structuredClone(result.profile); tampered.gold++;
  const request = { command: command('load'), before: clean, profile: tampered,
    worldData: { v: 1, seed: 1, economy: { hours: 2 }, resources: { tick: 0 } },
    ack: { ok: true, rev: 1 } };
  assert.equal(fireWorldTransition({ ...request.worldData, resources: { tick: 0 } }, request), false);
  assert.equal(remainingFire({ kind: 'handTorch', seconds: 100, since: 0, lit: true }, 1), 99);

  const accepted = fireProfileDelta(clean, command('load'), 80);
  const goodRequest = { ...request, profile: accepted.profile,
    ack: { ok: true, rev: accepted.profile.fire.rev } };
  assert.equal(fireWorldTransition(request.worldData, goodRequest), true);
  const denied = { ...goodRequest, profile: clean, ack: { ok: false, rev: 0 } };
  assert.equal(fireWorldTransition(request.worldData, denied), true);
});
