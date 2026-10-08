import test from 'node:test';
import assert from 'node:assert/strict';
import { DeathDropStaging } from '../server/deathDropStaging.mjs';
import { setupStaging } from './helpers/death-staging.mjs';
import { memoryDropQueueSetup } from './helpers/death-drop-queue-contract.mjs';
import { database } from './helpers/death-drop-journal-sql.mjs';
import { WORLD } from './helpers/death-storage.mjs';

for (const [backend,setup] of [['memory',memoryDropQueueSetup],['SDK/SQL012',async()=>{const db=await database();return {...db,journal:db.journal(WORLD)};}]]) {
  test(`${backend}: actual staged death produces the source consumed by pickup and expiry`,async()=>{
    const f=await setupStaging(setup,{lawless:true,killer:true,pearlCount:3,loot:true});
    try{
      const death=f.stage.request(f.selectors);await f.stage.settle();assert.equal(f.stage.drain()[0].state,'applied');
      const ordinary=[...f.world.drops.values()].filter(d=>d.kind==='item'||d.kind==='potion');assert.ok(ordinary.length>=2);
      for(const d of ordinary){assert.equal(d.operationId,death.operationId);assert.ok(d.ordinal>=1);}
      const item=ordinary.find(d=>d.kind==='item'),before=structuredClone(f.world.profiles.get(f.killerEntity));
      const sourceItem=structuredClone(item.item),victimAfter=structuredClone(f.world.profiles.get(f.entity));
      f.world.ecs.x[f.killerEntity]=item.x;f.world.ecs.z[f.killerEntity]=item.z;f.world.events.length=0;
      const stage=new DeathDropStaging(f.sessions,f.world,WORLD),pick=stage.pickup({dropId:item.id,receiver:{clientId:2,entity:f.killerEntity}});
      await stage.settle();assert.equal(f.world.drops.get(item.id),item);assert.deepEqual(f.world.events,[]);
      assert.equal(stage.drain()[0].state,'applied');assert.equal(f.world.drops.has(item.id),false);
      const after=f.world.profiles.get(f.killerEntity);assert.deepEqual(after.bag,[...before.bag,{...sourceItem,u:before.uid}]);
      assert.equal(after.uid,before.uid+1);assert.equal(after.stats.items,before.stats.items+1);
      assert.deepEqual(item.item,sourceItem,'source metadata never receives the receiver item UID');
      assert.deepEqual(f.world.profiles.get(f.entity),victimAfter,'death XP loss and empty pearl/bag state stay intact');
      assert.equal((await f.store.loadDeathDrop(item.operationId,item.ordinal)).transitionOperationId,pick.operationId);
      assert.deepEqual(f.world.events.map(e=>e.type),['pickup','unloot']);
      const potion=ordinary.find(d=>d.kind==='potion');f.world.tick=potion.t+1;const receiverBeforeExpiry=structuredClone(after);
      const expire=stage.expire({dropId:potion.id});await stage.settle();assert.equal(f.world.drops.get(potion.id),potion);
      assert.equal(stage.drain()[0].state,'applied');assert.equal(f.world.drops.has(potion.id),false);
      assert.deepEqual(after,receiverBeforeExpiry);assert.equal((await f.store.loadDeathDrop(potion.operationId,potion.ordinal)).transitionOperationId,expire.operationId);
      const current=await f.store.listCurrentDeathDrops(WORLD);assert.ok(current.every(d=>d.ordinal!==item.ordinal&&d.ordinal!==potion.ordinal));
      await f.sessions.flush();
    }finally{await f.close?.();}
  });
}
