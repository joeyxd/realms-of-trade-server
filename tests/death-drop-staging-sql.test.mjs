import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/death-drop-journal-sql.mjs';
import { setupDropStaging, stagingApplyContract } from './helpers/death-drop-staging.mjs';

test('M5 staged ordinary death-drop applies against SQL012 receipts', async t => {
  await stagingApplyContract(t,database);
  await t.test('pickup waits for durable source receipt before local apply',async()=>{
    const f=await setupDropStaging(database,{source:790});try{
      const before={drop:structuredClone(f.drop),profile:structuredClone(f.world.profiles.get(f.entity)),events:structuredClone(f.world.events)};
      const h=f.stage.pickup(f.selectors);await f.stage.settle();assert.equal(f.stage.operations.get(h.operationId).state,'ready');
      assert.deepEqual({drop:structuredClone(f.drop),profile:structuredClone(f.world.profiles.get(f.entity)),events:structuredClone(f.world.events)},before);
      assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'picked');
      const request={operationId:h.operationId,...f.stage.operations.get(h.operationId).request};assert.equal(f.stage.drain()[0].state,'applied');assert.equal(f.world.drops.has(f.dropId),false);
      assert.equal((await f.journal.prepare('drop',request)).state,'committed');
    }finally{await f.close?.();}
  });
  await t.test('expiry stores a SQL012 receipt and changes the world only when drained',async()=>{
    const f=await setupDropStaging(database,{source:791,mode:'expire'});try{
      f.world.tick=f.drop.t+1;const h=f.stage.expire(f.selectors);await f.stage.settle();assert.equal(f.world.drops.has(f.dropId),true);
      assert.equal((await f.store.loadDeathDrop(f.drop.operationId,f.drop.ordinal)).state,'expired');
      assert.equal(f.stage.drain()[0].state,'applied');assert.equal(f.world.drops.has(f.dropId),false);
    }finally{await f.close?.();}
  });
});
