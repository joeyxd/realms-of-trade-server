// File-backed PostgreSQL-compatible fixture; not a VM/power-loss durability claim.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { database } from './ground-clock-sql.mjs';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { Economy } from '../../src/sim/economy/economy.js';
import { teachStorage } from '../../server/artisanOperation.mjs';
import { publicCommunity } from '../../server/communityProject.mjs';
import { storageProfileDelta } from '../../src/sim/systems/raftEditor.js';
const [mode,path,stage]=process.argv.slice(2);
if(!['hold','inspect'].includes(mode)||!path||!['before','learned','built'].includes(stage))throw Error('mode/path/stage required');
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',world='artisan-process',ids={learn:'10000000-0000-4000-8000-000000000001',place:'10000000-0000-4000-8000-000000000002'};
const baseline=newProfile({starter:false});baseline.eco.pack.goods={madera:2};baseline.progression={v:1,practice:{logging:60},milestones:['logging_steady'],knowledge:[]};
const ship=baseline.eco.ships.find(s=>s.kind==='raft');ship.id='process:raft';ship.rev=1;
ship.grid={parts:[...Array.from({length:4},(_,x)=>['foundation',x,0,0,0]),...Array.from({length:3},(_,x)=>['crate',x,0,0,0])],work:{}};ship.hold={cap:18,goods:{madera:6}};
const worldData={v:1,seed:91,economy:new Economy(91).serialize(),community:{v:1,epoch:'10000000-0000-4000-8000-000000000003',project:{id:'salty-shore-carpentry',version:7,requirements:{madera:4,piedra:2},contributed:{madera:4,piedra:2}}}};
const learned=teachStorage(baseline);assert.equal(learned.why,'');
const learnCommand={type:'artisan',op:'learn',opId:'process-learn',lesson:'raft_storage',expectedRev:baseline.eco.tradeRev,expectedProjectRev:7};
const learn={world,account,command:learnCommand,expectedProfileVersion:1,expectedWorldVersion:1,before:baseline,profile:learned.profile,worldData,
  ack:{type:'artisan',op:'learn',opId:learnCommand.opId,ok:true,why:'',rev:learned.profile.eco.tradeRev,lesson:'raft_storage',project:publicCommunity(worldData.community)}};
const placeCommand={type:'raft',op:'place',opId:'process-place',id:ship.id,expectedRev:1,piece:['storage',3,0,0,0]};
const built=storageProfileDelta(learned.profile,placeCommand);assert.equal(built.why,'');
const place={world,account,command:placeCommand,expectedProfileVersion:2,expectedWorldVersion:2,before:learned.profile,profile:built.profile,worldData,
  ack:{type:'raftEdit',op:'place',opId:placeCommand.opId,id:ship.id,ok:true,why:'',rev:2}};
let db;
if(mode==='hold'){
  const f=await database(path);db=f.db;await db.exec('RESET ROLE');
  for(const name of ['014_economic_operations.sql','015_resource_operations.sql','016_logging_operations.sql','017_agent_goods_budget.sql','018_ground_transactions.sql','019_ground_transaction_journal.sql','020_gm_drafts.sql','021_artisan_operations.sql'])
    await db.exec(await readFile(new URL('../../server/migrations/'+name,import.meta.url),'utf8'));
  await db.exec('SET ROLE service_role');
  await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)',[account,baseline]);
  await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)',[world,worldData]);
  if(stage!=='before')assert.equal((await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',[ids.learn,learn])).rows[0].r.ok,true);
  if(stage==='built')assert.equal((await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',[ids.place,place])).rows[0].r.ok,true);
  process.stdout.write('READY\n');await new Promise(()=>{});
}else{
  db=new PGlite(path);await db.exec('SET ROLE service_role');
  try{
    const expected=stage==='before'?baseline:stage==='learned'?learned.profile:built.profile;
    const row=(await db.query('select data,version from public.mn_profiles where player_id=$1::uuid',[account])).rows[0];
    assert.deepEqual(row.data,expected);assert.equal(row.version,stage==='before'?1:stage==='learned'?2:3);
    const count=(await db.query('select count(*)::int n from public.mn_economic_operations')).rows[0].n;
    assert.equal(count,row.version-1);
    if(stage!=='before')assert.equal((await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',[ids.learn,learn])).rows[0].r.replay,true);
    if(stage==='built')assert.equal((await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as r',[ids.place,place])).rows[0].r.replay,true);
    assert.deepEqual((await db.query('select data,version from public.mn_profiles where player_id=$1::uuid',[account])).rows[0],row);
    assert.equal((await db.query('select version from public.mn_worlds where world=$1',[world])).rows[0].version,row.version);
    process.stdout.write(JSON.stringify({stage,version:row.version,receipts:count,known:row.data.progression.knowledge.includes('raft_storage'),storage:row.data.eco.ships[0].grid.parts.filter(p=>p[0]==='storage').length}));
  }finally{await db.close();}
}
