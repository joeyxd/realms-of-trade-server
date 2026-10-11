import test from 'node:test';
import { createMemoryStore } from '../server/store.mjs';
import { createMemoryPearlJournals } from '../server/pearlJournal.mjs';
import { WORLD } from './helpers/death-drop-storage.mjs';
import { deathDropQueueContract } from './helpers/death-drop-queue-contract.mjs';

test('death-drop queue memory contract', (t) => deathDropQueueContract(t, async () => {
  const store = createMemoryStore();
  return { store, journal: createMemoryPearlJournals(store)(WORLD) };
}));
