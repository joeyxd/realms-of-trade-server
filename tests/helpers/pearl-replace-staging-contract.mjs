import test from 'node:test';
import assert from 'node:assert/strict';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { PEARL_IDS } from '../../src/data/pearls.js';
import { accounts, incomingUid, outgoingUid, state } from './pearl-replace-staging.mjs';

// Replacement is retired by policy. Exercise every public/trusted selector shape without
// opening storage, reservation, simulation, or recovery paths.
export function replacementContract(setup) {
  for (const [name, action] of [['trusted', (f, raw) => f.staging.replace(raw)],
    ['managed', (f, raw) => f.staging.request(raw)]]) {
    test(`${name} replacement is denied before reads, IO, reservations, or world effects`, async () => {
      let reads = 0, saves = 0, commits = 0, prepares = 0;
      const f = await setup({ wrapStore: (base) => ({ ...base,
        async loadUnique(...args) { reads++; return base.loadUnique(...args); },
        async saveProfile(...args) { saves++; return base.saveProfile(...args); },
        async commitPearlBatch(...args) { commits++; return base.commitPearlBatch(...args); },
      }), wrapJournal: (base) => ({ ...base, async prepare(...args) { prepares++; return base.prepare(...args); } }) });
      try {
        const before = state(f.world), command = f.command();
        // Keep a real swallowed pearl and all four possible incoming kinds represented by fixture cases.
        assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, outgoingUid);
        reads = saves = commits = prepares = 0;
        const attempts = [command,
          { ...command, replaceUid: 'stale-confirmation' },
          { ...command, expectedVersion: 91, replaceExpectedVersion: 92 },
          { ...command, expectedVersion: 1, replaceExpectedVersion: 2 },
        ];
        for (const raw of attempts) {
          assert.throws(() => action(f, { ...raw, action: 'replace' }), { code: 'bound' });
          assert.deepEqual(state(f.world), before);
          assert.equal(f.staging.operations.size, 0);
          f.staging.assertAvailable({ uids: [incomingUid, outgoingUid], accounts: [accounts[0]] });
        }
        let getterCalls = 0;
        const getter = { action: 'replace', get uid() { getterCalls++; return incomingUid; },
          get replaceUid() { getterCalls++; return outgoingUid; }, source: command.source };
        assert.throws(() => action(f, getter), { code: name === 'managed' ? 'operation' : 'bound' });
        assert.equal(getterCalls, 0, 'policy denial precedes selector property access');
        await f.staging.settle();
        assert.deepEqual([reads, saves, commits, prepares], [0, 0, 0, 0]);
        assert.deepEqual(state(f.world), before);
        assert.equal(f.staging.operations.size, 0); assert.equal(f.staging.tasks.size, 0);
        assert.equal(f.world.pearlLedger.get(outgoingUid).place, 'profile');
        assert.equal([...f.world.drops.values()].some((drop) => [incomingUid, outgoingUid].includes(drop.pearl?.uid)), false);
        f.staging.assertAvailable({ uids: [incomingUid, outgoingUid] });
        pearlMutationGate(f.sessions).assertWorldAvailable();
      } finally { await f.close(); }
    });
  }

  for (const kind of PEARL_IDS) test(`replacement policy applies to incoming ${kind} without inspecting kind`, async () => {
    let reads = 0, commits = 0, prepares = 0;
    const f = await setup({ incomingKind: kind, wrapStore: (base) => ({ ...base,
      async loadUnique(...args) { reads++; return base.loadUnique(...args); },
      async commitPearlBatch(...args) { commits++; return base.commitPearlBatch(...args); },
    }), wrapJournal: (base) => ({ ...base, async prepare(...args) { prepares++; return base.prepare(...args); } }) });
    try {
      reads = commits = prepares = 0;
      const before = state(f.world), command = f.command();
      assert.throws(() => f.staging.replace(command), { code: 'bound' });
      assert.deepEqual([reads, commits, prepares], [0, 0, 0]);
      assert.deepEqual(state(f.world), before);
      assert.equal(f.world.profiles.get(f.entities[0]).pearls.swallowed.uid, outgoingUid);
      assert.equal(f.world.pearlLedger.get(incomingUid).place, 'profile');
      assert.equal(f.world.events.length, 0); assert.equal(f.world.nextDrop, before.nextDrop);
      assert.equal(f.staging.operations.size, 0); pearlMutationGate(f.sessions).assertWorldAvailable();
    } finally { await f.close(); }
  });
}
