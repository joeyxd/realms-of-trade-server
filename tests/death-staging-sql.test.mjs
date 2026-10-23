import test from 'node:test';
import { stagingContract } from './helpers/death-staging.mjs';
import { database } from './helpers/death-journal-sql.mjs';
import { WORLD } from './helpers/death-storage.mjs';
test('whole-death staging against SDK and SQL001-010',t=>stagingContract(t,async()=>{const db=await database();return {...db,journal:db.journal(WORLD)};}));
