import test from 'node:test';
import { deathQueueContract, memorySetup } from './helpers/death-queue-contract.mjs';
test('whole-death queue memory contract', t => deathQueueContract(t, memorySetup));
