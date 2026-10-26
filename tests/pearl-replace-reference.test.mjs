import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, state } from './helpers/pearl-replace-staging.mjs';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { PEARL_IDS } from '../src/data/pearls.js';

for (const kind of PEARL_IDS) test(`simulation refuses to replace a swallowed pearl with ${kind}`, async () => {
  const f = await fixture({ incomingKind: kind });
  try {
    const before = state(f.world), cmd = f.command();
    assert.equal(swallowPearl(f.world, f.entities[0], cmd.uid, cmd.replaceUid), false);
    const after = state(f.world); after.events = before.events;
    assert.deepEqual(after, before, 'denial leaves pearl ownership, ECS, drops, counters and dirty state intact');
    assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, cmd.replaceUid);
    assert.equal(f.world.drops.size, 0);
    assert.deepEqual(f.world.events.map((event) => [event.type, event.why]), [['pearlDenied', 'bound']]);
  } finally { await f.close(); }
});
