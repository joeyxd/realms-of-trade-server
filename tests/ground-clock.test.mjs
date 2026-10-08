import test from 'node:test';
import { createMemoryStore } from '../server/store.mjs';
import { groundClockContract } from './helpers/ground-clock-contract.mjs';

test('memory storage ground-clock contract', async (t) => groundClockContract(t, async () => {
  let lose = false;
  const store = createMemoryStore();
  const commit = store.commitGroundClock.bind(store);
  store.commitGroundClock = async (raw) => { const result = await commit(raw); if (lose) { lose = false; throw Error('Lost reply'); } return result; };
  return { store, loseNextReply: () => { lose = true; } };
}));
