import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { Economy } from '../../src/sim/economy/economy.js';
import { newProfile } from '../../src/sim/systems/inventory.js';
import { contributionDelta } from '../../server/community/contributionContract.mjs';
import { database } from './ground-clock-sql.mjs';

const [mode, dataPath] = process.argv.slice(2);
if (!['before', 'after', 'inspect-before', 'inspect-after'].includes(mode) || !dataPath) {
  throw new Error('mode and database path required');
}

const WORLD = 'economic-process-world';
const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const EPOCH = '00000000-0000-4000-8000-000000000002';
const OPERATION_ID = '00000000-0000-4000-8000-000000000042';
const CLIENT_OP_ID = 'crash-project-42';
const PROJECT_ID = 'salty-shore-carpentry';
const MIGRATION = await readFile(new URL('../../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');

function initialProfile() {
  const profile = newProfile();
  profile.eco.pack.goods.madera = 3;
  return profile;
}

function initialWorld() {
  const seed = 19;
  return { v: 1, seed, economy: new Economy(seed).serialize(), community: {
    v: 1, epoch: EPOCH, project: { id: PROJECT_ID, version: 1,
      requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } },
  } };
}

function operation(profile = initialProfile(), worldData = initialWorld()) {
  const command = { type: 'community', op: 'contribute', opId: CLIENT_OP_ID,
    projectId: PROJECT_ID, good: 'madera', amount: 2, expectedRev: 1 };
  const delta = contributionDelta({ operationId: OPERATION_ID, worldId: WORLD, worldEpoch: EPOCH,
    characterId: ACCOUNT, projectId: PROJECT_ID, good: 'madera', amount: 2,
    expectedCharacterVersion: 1, expectedProjectVersion: 1 },
  { worldId: WORLD, worldEpoch: EPOCH, characterId: ACCOUNT, version: 1, data: profile },
  { worldId: WORLD, worldEpoch: EPOCH, projectId: PROJECT_ID, version: 1,
    requirements: worldData.community.project.requirements, contributed: worldData.community.project.contributed });
  assert.equal(delta.ok, true);
  const nextWorld = structuredClone(worldData);
  nextWorld.community.project.version = delta.project.version;
  nextWorld.community.project.contributed = delta.project.contributed;
  const nextProfile = delta.character.data;
  const ack = { type: 'community', op: 'contribute', opId: CLIENT_OP_ID, ok: true, why: '',
    rev: nextProfile.eco.tradeRev ?? 0, accepted: delta.accepted, good: 'madera' };
  return { operationId: OPERATION_ID, request: { world: WORLD, account: ACCOUNT, command,
    expectedProfileVersion: 1, expectedWorldVersion: 1, profile: nextProfile,
    worldData: nextWorld, ack } };
}

function localStore(db) {
  const fetch = async (input, init = {}) => {
    const name = new URL(input).pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    try {
      let data;
      if (name === 'mn_commit_economic_operation') {
        data = (await db.query('select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data',
          [body.p_operation_id, body.p_request])).rows[0].data;
      } else if (name === 'mn_load_economic_operation') {
        data = (await db.query('select public.mn_load_economic_operation($1::uuid) as data',
          [body.p_operation_id])).rows[0].data;
      } else throw new Error('unexpected local RPC');
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return createSupabaseStore(client);
}

if (mode === 'before' || mode === 'after') {
  const fixture = await database(dataPath);
  try {
    await fixture.db.exec('RESET ROLE');
    await fixture.db.exec(MIGRATION);
    await fixture.db.exec('SET ROLE service_role');
    const profile = initialProfile(), worldData = initialWorld();
    await fixture.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)',
      [ACCOUNT, profile]);
    await fixture.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)',
      [WORLD, worldData]);
    if (mode === 'after') {
      const result = await localStore(fixture.db).commitEconomicOperation(operation(profile, worldData));
      assert.equal(result.ok, true);
      assert.equal(result.replay, false);
    }
    // Keep the database open so the parent terminates a live Node process after this stage.
    process.stdout.write(`READY ${mode}\n`);
    await new Promise(() => {});
  } finally { await fixture.close(); }
} else {
  const db = new PGlite(dataPath);
  try {
    await db.exec('SET ROLE service_role');
    const store = localStore(db), raw = operation();
    const profileRow = (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
    const worldRow = (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0];
    const receipt = await store.loadEconomicOperation(OPERATION_ID);
    const receiptCount = Number((await db.query('select count(*)::integer as n from public.mn_economic_operations')).rows[0].n);
    let replay = false;
    if (mode === 'inspect-before') {
      assert.equal(receipt, null);
      assert.equal(receiptCount, 0);
      assert.equal(profileRow.version, 1);
      assert.equal(profileRow.data.eco.pack.goods.madera, 3);
      assert.equal(worldRow.version, 1);
      assert.equal(worldRow.economy.community.project.contributed.madera, 0);
    } else {
      assert.ok(receipt);
      assert.deepEqual(receipt.request, raw.request);
      assert.equal(receiptCount, 1);
      assert.equal(profileRow.version, 2);
      assert.equal(profileRow.data.eco.pack.goods.madera, 1);
      assert.equal(worldRow.version, 2);
      assert.equal(worldRow.economy.community.project.contributed.madera, 2);
      const result = await store.commitEconomicOperation(raw);
      assert.equal(result.ok, true);
      assert.equal(result.replay, true);
      replay = true;
      const profileAfterReplay = (await db.query('select data,version from public.mn_profiles where player_id=$1::uuid', [ACCOUNT])).rows[0];
      const worldAfterReplay = (await db.query('select economy,version from public.mn_worlds where world=$1', [WORLD])).rows[0];
      assert.equal(profileAfterReplay.version, 2);
      assert.equal(profileAfterReplay.data.eco.pack.goods.madera, 1);
      assert.equal(worldAfterReplay.version, 2);
      assert.equal(worldAfterReplay.economy.community.project.contributed.madera, 2);
    }
    process.stdout.write(JSON.stringify({ stage: mode, receiptCount, replay,
      profileVersion: profileRow.version, worldVersion: worldRow.version,
      remainingMadera: profileRow.data.eco.pack.goods.madera,
      contributedMadera: worldRow.economy.community.project.contributed.madera }));
  } finally { await db.close(); }
}
