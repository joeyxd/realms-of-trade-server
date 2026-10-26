import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './death-drop-sql.mjs';
import { ProfileSessions } from '../../server/profileSessions.mjs';
import { StoreError } from '../../server/store.mjs';
import { pearlMutationGate } from '../../server/pearlMutationGate.mjs';
import { seedDeathDropScenario, pickupRequest, expiryRequest, KILLER, WORLD } from './death-drop-storage.mjs';
const [mode, dataPath, evidencePath]=process.argv.slice(2);
if(mode==='seed') {
  const f=await database(dataPath);try {
    const sql=await readFile(new URL('../../server/migrations/012_death_drop_journal.sql',import.meta.url),'utf8');
    await f.db.exec('RESET ROLE');await f.db.exec(sql);await f.db.exec('SET ROLE service_role');
    const source=await seedDeathDropScenario(f.store),pickup=await pickupRequest(f.store,source);
    const expiry=await expiryRequest({...source,itemDrop:source.potionDrop},{operation:955});
    let sends=0;
    const s=new ProfileSessions({...f.store,async commitDeathDrop(r){sends++;await f.store.commitDeathDrop(r);throw new StoreError('unavailable');},
      async loadDeathDropOperation(){throw new StoreError('unavailable');}},null,{journal:f.journal(WORLD)});
    await s.recoverPearls();await s.open(1,KILLER);
    await assert.rejects(s.commitDeathDrop(pickup),{code:'unavailable'});assert.equal(sends,2);
    assert.equal(s.pearls.unresolved.size,1);
    await f.journal(WORLD).prepare('drop',expiry);
    await writeFile(evidencePath,JSON.stringify({source,pickup,expiry,profile:await f.store.loadProfile(KILLER)}));
  }finally{await f.close();}
}else {
  const db=new PGlite(dataPath);try {
    await db.exec('SET ROLE service_role');const f=adapters(db), e=JSON.parse(await readFile(evidencePath,'utf8'));
    let sends=0;
    const s=new ProfileSessions({...f.store,async commitDeathDrop(r){sends++;assert.equal(mode,'resume');assert.deepEqual(r,e.expiry);return f.store.commitDeathDrop(r);}},null,{journal:f.journal(WORLD)});
    if(mode==='resume') {
      assert.deepEqual(await s.recoverPearls(),[{operationId:e.pickup.operationId,outcome:'committed'},{operationId:e.expiry.operationId,outcome:'pending'}]);
      assert.equal(sends,0);assert.throws(()=>pearlMutationGate(s).assertAvailable({drops:[e.expiry.drop.operationId+':'+e.expiry.drop.ordinal]}),{code:'busy'});
      assert.deepEqual(await f.store.loadProfile(KILLER),e.profile);await assert.rejects(s.flush(),{code:'flush'});
      const result=await s.resumeDeathDrop(e.expiry.operationId);assert.equal(sends,1);assert.equal(result.receipt.drop.state,'expired');
      await s.flush();assert.deepEqual(await f.journal(WORLD).list(),[]);
      const row=await f.store.loadProfile(KILLER);row.data.gold++;
      assert.equal((await f.store.saveProfile(KILLER,row.data,row.version)).ok,true);
      e.profile=await f.store.loadProfile(KILLER);e.ground=await f.store.listCurrentDeathDrops(WORLD);
      await writeFile(evidencePath,JSON.stringify(e));
    }else if(mode==='audit') {
      assert.deepEqual(await s.recoverPearls(),[]);assert.equal(sends,0);await s.flush();
      assert.deepEqual(await f.store.loadProfile(KILLER),e.profile);
      assert.deepEqual(await f.store.listCurrentDeathDrops(WORLD),e.ground);
      assert.equal((await f.store.loadDeathDrop(e.pickup.drop.operationId,e.pickup.drop.ordinal)).state,'picked');
      assert.equal((await f.store.loadDeathDrop(e.expiry.drop.operationId,e.expiry.drop.ordinal)).state,'expired');
      assert.equal(e.ground.length,e.source.death.drops.length-2);
      assert.equal((await f.journal(WORLD).prepare('drop',e.pickup)).state,'committed');
      assert.equal((await f.journal(WORLD).prepare('drop',e.expiry)).state,'committed');
    }else throw Error('Unknown process mode');
  }finally{await db.close();}
}
console.log('drop recovery subprocess '+mode+' passed');
