import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVAL_LESSON } from '../src/data/navalLesson.js';
import { NavalLesson } from '../src/sim/naval/lesson.js';

function fixture({ layout = true, owners = [1], routeActive = false } = {}) {
  const map = layout ? {
    half: 140,
    dock: { end: { x: 0, z: 0 }, dir: { x: 0, z: 1 } },
    groundAt: () => -1,
    onDock: () => false,
  } : { half: 140 };
  const contexts = new Map(), guests = new Map();
  for (const owner of owners) contexts.set(owner, {
    epoch: 4, shipId: `ship-${owner}`, helm: true, ashore: false,
    home: { x: 0, z: 0 }, body: { pose: { x: 0, z: 0 }, operational: { disabled: false } },
  });
  const world = { isServer: true, tick: 0, map,
    navalTrial: { navigation: true },
    navalPilot: {
      routeContext: (owner) => contexts.get(owner) || null,
      recipients: (shipId) => guests.get(shipId) || [],
    },
    navalRoute: { active: () => routeActive },
  };
  const lesson = new NavalLesson(world);
  return { world, contexts, guests, lesson };
}

function candidate(tick, x, z, vx = 0, vz = 0, extra = {}) {
  return { pose: { x, z }, state: { tick, vx, vz }, operational: { disabled: false }, ...extra };
}

function commitTick(f, owner, tick, body) {
  const plan = f.lesson.plan(owner, `ship-${owner}`, body);
  assert.ok(plan, 'active run produces a plan');
  assert.equal(f.lesson.commit(plan), true);
  f.world.tick = tick;
  return plan;
}

function reachManeuver(f, owner = 1) {
  assert.equal(f.lesson.start(owner, 4), true);
  const first = f.lesson.snapshot(owner).buoys[0];
  commitTick(f, owner, 1, candidate(1, first.x, first.z));
  assert.equal(f.lesson.snapshot(owner).status, 'maneuver');
  return f.lesson.snapshot(owner).buoys[1];
}

test('layout exposes two ordered buoys and requires 45 continuous stopped ticks before return', () => {
  const f = fixture(), second = reachManeuver(f), snap = f.lesson.snapshot(1);
  assert.equal(snap.buoys.length, 2);
  assert.equal(snap.target.id, second.id);
  for (let tick = 2; tick <= NAVAL_LESSON.stableTicks + 1; tick++)
    commitTick(f, 1, tick, candidate(tick, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).status, 'returning');
  assert.equal(f.lesson.snapshot(1).next, 2);
  assert.deepEqual(f.lesson.snapshot(1).target, { x: 0, z: 0 });
});

test('second buoy resets stability when too fast or outside its radius; only dock completes', () => {
  const f = fixture(), second = reachManeuver(f);
  commitTick(f, 1, 2, candidate(2, second.x, second.z, 1, 0));
  assert.equal(f.lesson.snapshot(1).stableTicks, 0);
  commitTick(f, 1, 3, candidate(3, second.x + second.radius + 1, second.z));
  assert.equal(f.lesson.snapshot(1).stableTicks, 0);
  for (let tick = 4; tick < 3 + NAVAL_LESSON.stableTicks; tick++)
    commitTick(f, 1, tick, candidate(tick, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).status, 'maneuver');
  commitTick(f, 1, 3 + NAVAL_LESSON.stableTicks, candidate(3 + NAVAL_LESSON.stableTicks, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).status, 'returning');
  f.world.tick++;
  f.lesson.end(1, 'dock');
  assert.equal(f.lesson.snapshot(1).status, 'complete');

  const early = fixture();
  reachManeuver(early);
  early.lesson.end(1, 'dock');
  assert.equal(early.lesson.snapshot(1).status, 'aborted');
});

test('start checks helm epoch, range, route conflict, duplicate runs, and active-run cap', () => {
  const f = fixture({ owners: [1, 2, 3, 4, 5] });
  assert.equal(f.lesson.start(1, 3), false);
  f.contexts.get(1).body.pose.x = 25;
  assert.equal(f.lesson.start(1, 4), false);
  f.contexts.get(1).body.pose.x = 0;
  assert.equal(f.lesson.start(1, 4), true);
  assert.equal(f.lesson.start(1, 4), false);
  assert.equal(f.lesson.start(2, 4), true);
  assert.equal(f.lesson.start(3, 4), true);
  assert.equal(f.lesson.start(4, 4), true);
  assert.equal(f.lesson.snapshot(5).canStart, false);

  const conflict = fixture({ routeActive: true });
  assert.equal(conflict.lesson.start(1, 4), false);
  assert.equal(conflict.lesson.snapshot(1).canStart, false);
});

test('guests can observe an active owner run but cannot start or abort it', () => {
  const f = fixture();
  f.guests.set('ship-1', [1, 9]);
  assert.equal(f.lesson.start(1, 4), true);
  const guest = f.lesson.snapshot(9);
  assert.equal(guest.active, true);
  assert.equal(guest.shipId, 'ship-1');
  assert.equal(guest.canAbort, false);
  assert.equal(guest.canStart, false);
  assert.equal(f.lesson.abort(9, 4), false);
});

test('plans are body-pure and stale plans cannot replace newer committed state', () => {
  const f = fixture(), first = f.lesson.snapshot(1).buoys[0];
  assert.equal(f.lesson.start(1, 4), true);
  const body = candidate(1, first.x, first.z), beforeBody = structuredClone(body);
  const plan = f.lesson.plan(1, 'ship-1', body);
  assert.deepEqual(body, beforeBody);
  assert.equal(f.lesson.snapshot(1).status, 'outbound', 'planning alone has no live effect');
  assert.equal(f.lesson.commit(plan), true);
  assert.equal(f.lesson.commit(plan), false, 'the old plan reference is stale after commit');
  assert.equal(f.lesson.snapshot(1).status, 'maneuver');
});

test('duplicate ticks, tick gaps, and leaving the helm reset maneuver stability', () => {
  const f = fixture(), second = reachManeuver(f);
  const duplicate = candidate(1, second.x, second.z);
  assert.equal(f.lesson.plan(1, 'ship-1', duplicate), null, 'the committed buoy tick cannot be counted twice');
  for (let tick = 2; tick <= 8; tick++)
    commitTick(f, 1, tick, candidate(tick, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).stableTicks, 7);

  commitTick(f, 1, 10, candidate(10, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).stableTicks, 0, 'a missing fixed tick breaks continuity');

  f.contexts.get(1).helm = false;
  commitTick(f, 1, 11, candidate(11, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).stableTicks, 0, 'deck mode does not accumulate pilot maneuver ticks');

  f.contexts.get(1).helm = true;
  for (let tick = 12; tick < 11 + NAVAL_LESSON.stableTicks; tick++)
    commitTick(f, 1, tick, candidate(tick, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).stableTicks, NAVAL_LESSON.stableTicks - 1);
  commitTick(f, 1, 11 + NAVAL_LESSON.stableTicks,
    candidate(11 + NAVAL_LESSON.stableTicks, second.x, second.z));
  assert.equal(f.lesson.snapshot(1).status, 'returning');
});

test('a later candidate failure leaves every already planned owner unchanged', () => {
  const f = fixture({ owners: [1, 2] });
  assert.equal(f.lesson.start(1, 4), true);
  assert.equal(f.lesson.start(2, 4), true);
  const before = [f.lesson.snapshot(1), f.lesson.snapshot(2)];
  const firstBody = candidate(1, 1, 1), firstCopy = structuredClone(firstBody);
  const firstPlan = f.lesson.plan(1, 'ship-1', firstBody);
  assert.ok(firstPlan);
  assert.deepEqual(firstBody, firstCopy);
  assert.equal(f.lesson.plan(2, 'ship-2', candidate(1, 1, 1, Number.NaN, 0)), null,
    'invalid later candidate fails before commit');
  assert.deepEqual(f.lesson.snapshot(1), before[0]);
  assert.deepEqual(f.lesson.snapshot(2), before[1]);
});

test('cancel, shore, disabled, timeout, detach, and close have bounded session outcomes', () => {
  const cancel = fixture();
  assert.equal(cancel.lesson.start(1, 4), true);
  assert.equal(cancel.lesson.abort(1, 4), true);
  assert.equal(cancel.lesson.snapshot(1).reason, 'cancelled');
  assert.equal(cancel.lesson.abort(1, 4), false);

  for (const [extra, reason] of [[{ parked: true }, 'shore'], [{ operational: { disabled: true } }, 'disabled']]) {
    const f = fixture();
    assert.equal(f.lesson.start(1, 4), true);
    commitTick(f, 1, 1, candidate(1, 0, 0, 0, 0, extra));
    assert.equal(f.lesson.snapshot(1).reason, reason);
  }
  const timeout = fixture();
  assert.equal(timeout.lesson.start(1, 4), true);
  commitTick(timeout, 1, NAVAL_LESSON.timeoutTicks,
    candidate(NAVAL_LESSON.timeoutTicks, 0, 0));
  assert.equal(timeout.lesson.snapshot(1).reason, 'timeout');
  const detached = fixture();
  assert.equal(detached.lesson.start(1, 4), true);
  detached.lesson.end(1, 'detach');
  assert.equal(detached.lesson.snapshot(1).runId, null);
  const closed = fixture();
  assert.equal(closed.lesson.start(1, 4), true);
  closed.lesson.end(1, 'close');
  assert.equal(closed.lesson.snapshot(1).runId, null);
});

test('missing coastal layout disables the lesson without starting a session', () => {
  const f = fixture({ layout: false });
  assert.equal(f.lesson.snapshot(1).available, false);
  assert.equal(f.lesson.snapshot(1).canStart, false);
  assert.equal(f.lesson.start(1, 4), false);
});
