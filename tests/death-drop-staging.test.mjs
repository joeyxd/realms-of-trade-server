import test from 'node:test';
import { stagingApplyContract } from './helpers/death-drop-staging.mjs';
import { memoryDropQueueSetup } from './helpers/death-drop-queue-contract.mjs';

test('M5 staged ordinary death-drop application with the memory journal', async t => {
  await stagingApplyContract(t,memoryDropQueueSetup);
});
