import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { ACCOUNT_ONE, RESOURCE_WORLD, accountProfile, calmAt, connect, makeResourceHost, makeResourceStore, submitAndApply } from './helpers/resource-authority-fixture.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';

const WORLD = 'gm-resource-roster';
const MIGRATIONS = [
  '001_store','002_accounts','003_pearl_operations','004_pearl_ground','005_pearl_journal','006_pearl_same_holder',
  '007_pearl_batch','008_pearl_batch_journal','009_death_operations','010_death_journal','011_death_drop_lifecycle',
  '012_death_drop_journal','013_ground_clock','014_economic_operations','015_resource_operations','016_logging_operations',
  '017_agent_goods_budget','018_ground_transactions','019_ground_transaction_journal','020_gm_drafts','021_artisan_operations',
  '022_fire_operations','023_ground_world_adoption','024_starter_workshop','025_companion_config',
  '026_workshop_raft_identifiers','027_companion_control','028_inference_config','029_attribute_operations',
  '030_freshwater_operations','031_gm_terrain_drafts','032_canteen_survival_operations','033_gm_terrain_materials',
  '034_companion_creation','035_special_meal_operations','036_gm_resource_roster',
];
const copy = value => structuredClone(value);

async function database(resources = null, { include036 = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
    for (const name of (include036 ? MIGRATIONS : MIGRATIONS.slice(0,-1)))
      await db.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url), 'utf8'));
    if (!resources) resources = { v:1, tick:10, nodes:[
      { id:'palm-base', kind:'palm', rev:1, hits:0, readyAt:0 },
      { id:'rock-base', kind:'rock', rev:1, hits:0, readyAt:0 },
    ], cooldowns:{} };
    await db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,7)',
      [WORLD, { v:1, seed:7, economy:new Economy(7).serialize(), resources }]);
    return { db, resources, close:() => db.close() };
  } catch (error) { await db.close(); throw error; }
}

async function serviceRole(db, action) {
  await db.exec('SET ROLE service_role');
  try { return await action(); } finally { await db.exec('RESET ROLE'); }
}

function appended(resources, suffix = '1') {
  const next = copy(resources);
  const palm = { id:`gm_${suffix.padStart(32,'0')}`, kind:'palm', rev:1, hits:0, readyAt:0 };
  const stone = { id:`gm_${String(Number(suffix)+1).padStart(32,'0')}`, kind:'stone', rev:1, hits:0, readyAt:0 };
  next.nodes.push(palm, stone);
  if (next.v >= 2) next.logging[palm.id] = next.v === 3
    ? { cycle:1, contributors:[], quality:0 } : { cycle:1, contributors:[] };
  return next;
}

test('SQL036 extends v1 safely and admits append-only resource identities with CAS', async t => {
  const f = await database(); t.after(() => f.close());
  const { db, resources } = f;
  const accepted = await serviceRole(db, async () => (await db.query(
    'select public.mn_admit_gm_resources($1,$2,$3::jsonb) result', [WORLD,7,appended(resources)])).rows[0].result);
  assert.deepEqual(accepted, { ok:true, version:8 });
  const saved = (await db.query('select economy,version from public.mn_worlds where world=$1',[WORLD])).rows[0];
  assert.deepEqual(saved.economy.resources, appended(resources));
  assert.equal(saved.version,8);
  assert.deepEqual(await serviceRole(db, async () => (await db.query(
    'select public.mn_admit_gm_resources($1,$2,$3::jsonb) result', [WORLD,7,appended(resources)])).rows[0].result),
    { ok:false, why:'conflict' });
});

test('SQL036 rejects malformed, mutated, retyped, oversized and non-default appended rows without writes', async t => {
  const f = await database(); t.after(() => f.close());
  const { db, resources } = f;
  const candidates = [];
  let bad = appended(resources); bad.nodes[2].hits=1; candidates.push(bad);
  bad = appended(resources); bad.nodes[2].kind='rock'; candidates.push(bad);
  bad = appended(resources); bad.nodes[3].hits=1; candidates.push(bad);
  bad = appended(resources); bad.nodes[0].rev=2; candidates.push(bad);
  bad = appended(resources); bad.nodes[0].id='gm_bad'; candidates.push(bad);
  bad = appended(resources); bad.nodes[0]={ ...bad.nodes[0], extra:true }; candidates.push(bad);
  bad = appended(resources); bad.nodes[0]={ ...bad.nodes[0], kind:'stone' }; candidates.push(bad);
  bad = appended(resources); bad.nodes[0]={ ...bad.nodes[0], id:'palm-base-changed' }; candidates.push(bad);
  bad = appended(resources); bad.tick++; candidates.push(bad);
  bad = appended(resources); bad.nodes[0]={ ...bad.nodes[0], kind:'rock' }; candidates.push(bad);
  bad = copy(resources);
  for(let i=0;i<129;i++) bad.nodes.push({id:`gm_${i.toString(16).padStart(32,'0')}`,kind:'stone',rev:1,hits:0,readyAt:0});
  candidates.push(bad);
  for (const [index,candidate] of candidates.entries()) {
    const result = await serviceRole(db, async () => (await db.query(
      'select public.mn_admit_gm_resources($1,$2,$3::jsonb) result', [WORLD,7,candidate])).rows[0].result);
    assert.equal(result.ok,false,`candidate ${index}: ${JSON.stringify(candidate)}`);
  }
  const unchanged=(await db.query('select economy,version from public.mn_worlds where world=$1',[WORLD])).rows[0];
  assert.deepEqual(unchanged.economy.resources,resources); assert.equal(unchanged.version,7);
  const tooMany=copy(resources);
  for(let i=0;i<1023;i++) tooMany.nodes.push({id:`gm_${i.toString(16).padStart(32,'0')}`,kind:'stone',rev:1,hits:0,readyAt:0});
  assert.equal((await db.query('select public.mn_valid_resource_state_v1($1::jsonb) ok',[tooMany])).rows[0].ok,false);
  tooMany.nodes.pop();
  assert.equal((await db.query('select public.mn_valid_resource_state_v1($1::jsonb) ok',[tooMany])).rows[0].ok,true);
  const malformed=copy(resources); malformed.nodes[0].id='gm_bad';
  assert.equal((await db.query('select public.mn_valid_resource_state_v1($1::jsonb) ok',[malformed])).rows[0].ok,false);
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const rejected=await serviceRole(db,async()=> (await db.query('select public.mn_admit_gm_resources($1,7,$2::jsonb) result',[WORLD,appended(resources)])).rows[0].result);
    assert.deepEqual(rejected,{ok:false,why:'invalid'});
  } finally { await db.exec('ROLLBACK'); }
  const altered=copy(appended(resources)); altered.nodes[2].kind='stone';
  assert.equal((await db.query('select public.mn_valid_resource_state_v1($1::jsonb) ok',[altered])).rows[0].ok,true);
});

test('SQL036 preserves v1/v2/v3 validation, exact logging defaults, and freezes ordinary saves', async t => {
  const originals=[];
  for (const version of [1,2,3]) {
    let resources={ v:1,tick:10,nodes:[{id:'palm-base',kind:'palm',rev:1,hits:0,readyAt:0}],cooldowns:{} };
    if (version>=2) {
      const db0=new PGlite();
      try {
        await db0.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;');
        for (const name of MIGRATIONS.slice(0,-1)) await db0.exec(await readFile(new URL(`../server/migrations/${name}.sql`, import.meta.url),'utf8'));
        const row=(await db0.query('select public.mn_upgrade_resource_state($1::jsonb) state',[resources])).rows[0].state;
        resources=version===2 ? row : (await db0.query('select public.mn_upgrade_resource_state_timing($1::jsonb) state',[row])).rows[0].state;
      } finally { await db0.close(); }
    }
    originals.push(resources);
  }
  for (const resources of originals) {
    const f=await database(resources);
    try {
      const {db}=f; const next=appended(resources);
      assert.equal((await db.query('select public.mn_valid_resource_state($1::jsonb) ok',[resources])).rows[0].ok,true);
      assert.equal((await db.query('select public.mn_valid_resource_state($1::jsonb) ok',[next])).rows[0].ok,true);
      const result=await serviceRole(db,async()=> (await db.query(
        'select public.mn_admit_gm_resources($1,$2,$3::jsonb) result',[WORLD,7,next])).rows[0].result);
      assert.deepEqual(result,{ok:true,version:8});
      const noOp=await serviceRole(db,async()=> (await db.query(
        'select public.mn_admit_gm_resources($1,$2,$3::jsonb) result',[WORLD,8,next])).rows[0].result);
      assert.deepEqual(noOp,{ok:true,version:8});
      const frozen={v:1,seed:7,resources:next};
      const save=await serviceRole(db,async()=> (await db.query(
        'select public.mn_save_world($1,$2::jsonb,$3) result',[WORLD,frozen,8])).rows[0].result);
      assert.deepEqual(save,{ok:false,why:'conflict'});
    } finally { await f.close(); }
  }
});

test('SQL036 readiness and private helper/service RPC privileges', async t => {
  const f=await database(); t.after(()=>f.close());
  const result=await serviceRole(f.db,async()=> (await f.db.query('select public.mn_gm_resource_roster_ready() ready')).rows[0].ready);
  assert.deepEqual(result,{version:1});
  const acl=(await f.db.query(`select
    has_function_privilege('service_role','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') service_rpc,
    has_function_privilege('anon','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') anon_rpc,
    has_function_privilege('authenticated','public.mn_admit_gm_resources(text,integer,jsonb)','EXECUTE') auth_rpc,
    has_function_privilege('service_role','public.mn_valid_resource_state_v1_pre_gm(jsonb)','EXECUTE') private_helper,
    has_function_privilege('anon','public.mn_gm_resource_roster_ready()','EXECUTE') anon_ready`)).rows[0];
  assert.deepEqual(acl,{service_rpc:true,anon_rpc:false,auth_rpc:false,private_helper:false,anon_ready:false});
});

test('SQL036 keeps an already stored SQL033 receipt replayable byte-for-byte', async t => {
  const f=await database(null,{include036:false}); t.after(()=>f.close());
  const {db,resources}=f; const account='aaaa0000-0000-4000-8000-000000000036';
  const profile=newProfile();
  profile.eco.pack={cap:10,goods:{}};
  delete profile.carry; delete profile.workshop;
  profile.progression={v:1,practice:{logging:60},milestones:['logging_steady'],knowledge:[]};
  await db.query('update public.mn_worlds set version=1 where world=$1',[WORLD]);
  await db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)',[account,profile]);
  const command={type:'commerce',op:'buy',opId:'receipt-before-sql036',town:'aldea',g:'madera',n:1,expectedTotal:0};
  const worldData={v:1,seed:7,economy:new Economy(7).serialize(),resources};
  const request={world:WORLD,account,command,expectedProfileVersion:1,expectedWorldVersion:1,
    profile,worldData,ack:{type:'commerce',op:'buy',opId:command.opId,ok:true,why:'',rev:0}};
  const operation='f3600000-0000-4000-8000-000000000001';
  const saved=await serviceRole(db,async()=> (await db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result',[operation,request])).rows[0].result);
  assert.equal(saved.ok,true,JSON.stringify(saved));
  const before=(await db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',[operation])).rows[0];
  await db.exec(await readFile(new URL('../server/migrations/036_gm_resource_roster.sql',import.meta.url),'utf8'));
  const replay=await serviceRole(db,async()=> (await db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result',[operation,request])).rows[0].result);
  assert.deepEqual(replay,{...saved,replay:true});
  const after=(await db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',[operation])).rows[0];
  assert.deepEqual(after,before);
});

test('GameHost GM palm and stone receipts commit through the SQL036 economic writer', async t => {
  const f=await database(); t.after(()=>f.close());
  const {base,store:raw}=makeResourceStore();
  const store={...raw,durable:true};
  await store.initializeProfile(ACCOUNT_ONE,accountProfile({tools:{axe:1}}));
  await store.checkResourceOperations();
  const host=makeResourceHost(store,async()=>ACCOUNT_ONE,{loggingOperations:true});
  t.after(async()=>{try{await host.close();}catch(error){if(error.code!=='flush')throw error;}});
  await host.prepare();

  const palmSource=[...host.server.world.resources.nodes.values()].find(n=>n.kind==='palm');
  const stoneSource=[...host.server.world.resources.nodes.values()].find(n=>n.kind==='stone');
  assert.ok(palmSource); assert.ok(stoneSource);
  const map={gmResources:[
    {id:`gm_${'b'.repeat(32)}`,kind:'palm',x:palmSource.x,y:palmSource.y,z:palmSource.z,scale:1,rot:0},
    {id:`gm_${'c'.repeat(32)}`,kind:'stone',x:stoneSource.x,y:stoneSource.y,z:stoneSource.z},
  ]};
  const resume=host.beginContentSwitch();
  try {
    await host.prepareContentResources(map);
    host.server.world.map.gmResources=copy(map.gmResources);
    host.installContentResources();
  } finally {resume();}

  const client=connect(host);client.hello();await Promise.all([...host.joins]);
  const entity=host.server.clients.get(client.id).entity;
  const session=host.profiles.accounts.get(ACCOUNT_ONE);
  const initialProfile=await base.loadProfile(ACCOUNT_ONE);
  const initialWorld=await base.loadWorld(RESOURCE_WORLD);
  assert.equal(initialProfile.version,session.version);
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,$3)',
    [ACCOUNT_ONE,initialProfile.data,initialProfile.version]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,$3)',
    [RESOURCE_WORLD,initialWorld.data,initialWorld.version]);

  const commitEconomicOperation=async rawInput=>{
    // Mirror background autosaves and deterministic logical ticks before each authoritative receipt.
    const beforeProfile=await base.loadProfile(ACCOUNT_ONE), beforeWorld=await base.loadWorld(RESOURCE_WORLD);
    assert.equal(beforeProfile.version,rawInput.request.expectedProfileVersion);
    assert.equal(beforeWorld.version,rawInput.request.expectedWorldVersion);
    await f.db.query('update public.mn_profiles set data=$2::jsonb,version=$3 where player_id=$1::uuid',
      [ACCOUNT_ONE,beforeProfile.data,beforeProfile.version]);
    await f.db.query('update public.mn_worlds set economy=$2::jsonb,version=$3 where world=$1',
      [RESOURCE_WORLD,beforeWorld.data,beforeWorld.version]);
    const result=await serviceRole(f.db,async()=> (await f.db.query(
      'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result',
      [rawInput.operationId,rawInput.request])).rows[0].result);
    assert.equal(result.ok,true,JSON.stringify(result));
    const memoryResult=await base.commitEconomicOperation(rawInput);
    assert.equal(memoryResult.ok,true);
    return result;
  };
  store.commitEconomicOperation=commitEconomicOperation;

  const palmId=map.gmResources[0].id, palm=host.server.world.resources.nodes.get(palmId);
  for(let hit=0;hit<3;hit++){
    calmAt(host,entity,palm);
    while((host.server.world.resources.cooldowns.get(entity)||0)>host.server.world.tick) host.server.step();
    const ack=await submitAndApply(host,client,{type:'resource',op:'gather',node:palmId,expectedRev:palm.rev,opId:`sql-gm-palm-${hit}`});
    assert.equal(ack?.ok,true,JSON.stringify(ack));
    assert.equal(ack.count,hit===2?2:0);
  }
  const stoneId=map.gmResources[1].id, stone=host.server.world.resources.nodes.get(stoneId);
  calmAt(host,entity,stone);
  while((host.server.world.resources.cooldowns.get(entity)||0)>host.server.world.tick) host.server.step();
  const stoneCommand={type:'resource',op:'gather',node:stoneId,expectedRev:stone.rev,opId:'sql-gm-stone-pickup'};
  const stoneAck=await submitAndApply(host,client,stoneCommand);
  assert.equal(stoneAck?.ok,true,JSON.stringify(stoneAck));
  assert.equal(stoneAck.good,'piedra'); assert.equal(stoneAck.count,1);
  const profileAfter=copy(host.server.world.profiles.get(entity));
  assert.equal(profileAfter.eco.pack.goods.piedra,1);
  assert.equal(profileAfter.eco.pack.goods.tronco,2);
  assert.equal(profileAfter.progression.practice.logging,10);

  const stoneOperationId=economicOperationId(RESOURCE_WORLD,ACCOUNT_ONE,stoneCommand.opId);
  const receipt=(await f.db.query('select request,result from public.mn_economic_operations where operation_id=$1::uuid',[stoneOperationId])).rows[0];
  assert.equal(receipt.request.command.node,stoneId);
  const replay=await serviceRole(f.db,async()=> (await f.db.query(
    'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) result',[stoneOperationId,receipt.request])).rows[0].result);
  assert.deepEqual(replay,{...receipt.result,replay:true});
  const sqlProfile=(await f.db.query('select data,version from public.mn_profiles where player_id=$1::uuid',[ACCOUNT_ONE])).rows[0];
  const sqlWorld=(await f.db.query('select economy,version from public.mn_worlds where world=$1',[RESOURCE_WORLD])).rows[0];
  assert.deepEqual(sqlProfile.data,profileAfter);
  assert.equal(sqlProfile.version,host.profiles.accounts.get(ACCOUNT_ONE).version);
  assert.deepEqual(sqlWorld.economy.resources,host.worldState.resources);
  assert.equal(sqlWorld.version,host.worldState.version);
});
