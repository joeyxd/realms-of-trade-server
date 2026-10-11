import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './pearl-batch-sql.mjs';
import { seed, request, state, A, op } from './pearl-batch.mjs';
import { batchOperation, batchResult } from '../../server/pearlBatch.mjs';

const [phase, path, mode] = process.argv.slice(2);
assert.ok(['prepare','recover'].includes(phase)); assert.ok(['death','replace'].includes(mode));
let f;
try {
  if (phase === 'prepare') {
    f = await database(join(path,'db'));
    const p = await seed(f.store), raw = request(p,mode);
    const expected = batchResult(batchOperation(raw).request);
    assert.deepEqual(await f.store.commitPearlBatch(raw),expected);
    await writeFile(join(path,'request.json'),JSON.stringify({ raw, expected, committed:await state(f.store) }),{ flag:'wx' });
  } else {
    const db = new PGlite(join(path,'db')); await db.exec('SET ROLE service_role');
    f = { db,...adapters(db),close:() => db.close() };
    const { raw, expected, committed } = JSON.parse(await readFile(join(path,'request.json'),'utf8'));
    assert.deepEqual(await state(f.store),committed);
    assert.deepEqual(await f.store.loadPearlBatchOperation(op(20)),{ request:batchOperation(raw).request,result:expected });
    assert.equal(f.calls.filter((c) => c.name === 'mn_commit_pearl_batch').length,0,'recovery receipt read sends no mutation');
    assert.deepEqual(await f.store.commitPearlBatch(raw),{ ...expected,replay:true });
    assert.deepEqual(await state(f.store),committed);
    const record = await f.store.loadProfile(A); record.data.xp += 7;
    assert.equal((await f.store.saveProfile(A,record.data,record.version)).ok,true);
    const advanced = await state(f.store);
    assert.deepEqual(await f.store.commitPearlBatch(raw),{ ...expected,replay:true });
    assert.deepEqual(await state(f.store),advanced);
  }
  process.stdout.write(JSON.stringify({ phase, mode, passed:true })+'\n');
} finally { await f?.close(); }
