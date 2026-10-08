import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { createSupabasePearlJournal } from '../../server/pearlJournal.mjs';
import { database as databaseBeforeDropMigration } from './death-journal-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, deathOp } from './death-storage.mjs';
import { WORLD } from './death-drop-storage.mjs';
import { readFile } from 'node:fs/promises';

export const deathDropSql = await readFile(new URL('../../server/migrations/011_death_drop_lifecycle.sql', import.meta.url), 'utf8');

const routes = {
  mn_resolve_pearl_intent: ['public.mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)', ['p_scope','p_family','p_operation_id','p_request','p_state']],
  mn_list_pearl_intents: ['public.mn_list_pearl_intents($1,$2::uuid,$3::integer)', ['p_scope','p_after_id','p_limit']],
  mn_load_pearl_operation: ['public.mn_load_pearl_operation($1::uuid)', ['p_operation_id']],
  mn_load_pearl_ground_operation: ['public.mn_load_pearl_ground_operation($1::uuid)', ['p_operation_id']],
  mn_load_pearl_batch_operation: ['public.mn_load_pearl_batch_operation($1::uuid)', ['p_operation_id']],
  mn_load_profile: ['public.mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['public.mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['public.mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl_ground: ['public.mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl: ['public.mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_batch: ['public.mn_commit_pearl_batch($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_prepare_pearl_intent: ['public.mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)', ['p_scope','p_family','p_operation_id','p_request']],
  mn_load_pearl_location: ['public.mn_load_pearl_location($1)', ['p_uid']],
  mn_load_death_operation: ['public.mn_load_death_operation($1::uuid)', ['p_operation_id']],
  mn_commit_death: ['public.mn_commit_death($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_list_death_drops: ['public.mn_list_death_drops($1,$2::uuid,$3::integer,$4::integer)',
    ['p_world','p_after_operation_id','p_after_ordinal','p_limit']],
  mn_commit_death_drop: ['public.mn_commit_death_drop($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_death_drop_operation: ['public.mn_load_death_drop_operation($1::uuid)', ['p_operation_id']],
  mn_load_death_drop: ['public.mn_load_death_drop($1::uuid,$2::integer)', ['p_operation_id','p_ordinal']],
  mn_list_current_death_drops: ['public.mn_list_current_death_drops($1,$2::uuid,$3::integer,$4::integer)',
    ['p_world','p_after_operation_id','p_after_ordinal','p_limit']],
};

export function adapters(db, calls = []) {
  let loseDropReply = false;
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, body: structuredClone(body) });
    try {
      const route = routes[name];
      if (!route) throw new Error(`Unknown local SQL route: ${name}`);
      const data = (await db.query(`select ${route[0]} as data`, route[1].map((key) => body[key]))).rows[0].data;
      if (name === 'mn_commit_death_drop' && loseDropReply) { loseDropReply = false; throw new Error('Lost local death-drop reply'); }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { store: createSupabaseStore(client), client, calls,
    journal: (scope) => createSupabasePearlJournal(client, scope),
    loseNextReply: () => { loseDropReply = true; } };
}

async function upgrade(legacy, path) {
  const db = legacy.db;
  await db.exec('RESET ROLE');
  await db.exec(deathDropSql);
  await db.exec(deathDropSql);
  await db.exec('SET ROLE service_role');
  return { ...adapters(db), db, close: legacy.close, path };
}

export async function database(path) {
  const legacy = await databaseBeforeDropMigration(path);
  try { return await upgrade(legacy, path); }
  catch (error) { await legacy.close(); throw error; }
}

export async function databaseWithHistoricalDeath() {
  const legacy = await databaseBeforeDropMigration();
  try {
    const f = makeDeath({ lawless: true, killer: true, loot: true, seed: 92 });
    f.world.tick = 10;
    const { request } = planRequest(f, deathOp(610));
    await seedDeathStore(legacy.store, f, request);
    const result = await legacy.store.commitDeath(request);
    if (!result.ok) throw new Error('Could not seed pre-011 death history');
    const upgraded = await upgrade(legacy);
    return { ...upgraded, historical: { request, result } };
  } catch (error) {
    await legacy.close();
    throw error;
  }
}

export { WORLD };
