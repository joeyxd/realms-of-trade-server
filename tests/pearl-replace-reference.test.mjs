import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, state } from './helpers/pearl-replace-staging.mjs';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { PEARL_IDS } from '../src/data/pearls.js';
import { World } from '../src/sim/world.js';

// Compare the complete observable World against the established helper, including other ECS rows,
// drop metadata, event decoration, ledger and dirty flags. Persistent work must remain invisible first.
for (const kind of PEARL_IDS) test(`replacement matches the existing full swallow/drop helper for ${kind}`, async () => {
  const f = await fixture({ incomingKind: kind });
  try {
    const w = f.world, e = f.entities[0], cmd = f.command(), before = state(w);
    const expected = { ecs: structuredClone(w.ecs), profiles: new Map(structuredClone([...w.profiles])),
      map: w.map, raftDeck: w.raftDeck, tick: w.tick, nextDrop: w.nextDrop,
      drops: new Map(structuredClone([...w.drops])), pearlLedger: new Map(structuredClone([...w.pearlLedger])),
      profileDirty: new Set(w.profileDirty), events: [], emit: World.prototype.emit };
    assert.equal(swallowPearl(expected, e, cmd.uid, cmd.replaceUid), true);
    f.staging.replace(cmd); await f.staging.settle();
    assert.deepEqual(state(w), before);
    assert.equal(f.staging.drain()[0].state, 'applied');
    for (const key of ['ecs','profiles','drops','pearlLedger','profileDirty','events','nextDrop'])
      assert.deepEqual(structuredClone(w[key]), expected[key], `${kind}:${key}`);
    assert.equal(w.rng.state(), before.rng); assert.equal(w.lootRng.state(), before.lootRng);
    await f.sessions.flush();
  } finally { await f.close(); }
});
