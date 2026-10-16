import test from 'node:test';
import { database } from './helpers/pearl-batch-journal-sql.mjs';
import { queueContract } from './helpers/pearl-batch-queue-contract.mjs';

test('batch queue SDK/SQL008 contract', async (t) => queueContract(t, database));
