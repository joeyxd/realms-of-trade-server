import test from 'node:test';
import { deathQueueContract } from './helpers/death-queue-contract.mjs';
import { database } from './helpers/death-journal-sql.mjs';
import { WORLD } from './helpers/death-storage.mjs';
test('whole-death queue SQL010/SDK contract', t => deathQueueContract(t, async () => {
  const f=await database();return {...f,journal:f.journal(WORLD)};
}));
