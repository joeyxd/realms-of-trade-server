import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { createSupabasePearlJournal } from '../../server/pearlJournal.mjs';
import { database as databaseBeforeGroundClock } from './death-drop-journal-sql.mjs';

export const groundClockSql = await readFile(new URL('../../server/migrations/013_ground_clock.sql', import.meta.url), 'utf8');

async function fixture(db, legacy, close) {
  const calls = [];
  let loseReply = false;
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, body: structuredClone(body) });
    try {
      let data;
      if (name === 'mn_load_ground_clock') {
        data = (await db.query('select public.mn_load_ground_clock($1) as data', [body.p_world])).rows[0].data;
      } else if (name === 'mn_commit_ground_clock') {
        data = (await db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data', [body.p_operation_id, body.p_request])).rows[0].data;
        if (loseReply) { loseReply = false; throw new Error('Lost local ground-clock reply'); }
      } else if (name === 'mn_load_ground_clock_operation') {
        data = (await db.query('select public.mn_load_ground_clock_operation($1::uuid) as data', [body.p_operation_id])).rows[0].data;
      } else {
        if (!legacy) throw new Error(`Legacy RPC unavailable after reopen: ${name}`);
        const { data: legacyData, error } = await legacy.client.rpc(name, body);
        if (error) throw error;
        data = legacyData;
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ message: error.message ?? 'Local SQL rejection', code: error.code ?? 'XX000' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { db, client, calls, store: createSupabaseStore(client), journal: (scope) => createSupabasePearlJournal(client, scope), close,
    loseNextReply: () => { loseReply = true; } };
}

export async function database(path) {
  const legacy = await databaseBeforeGroundClock(path);
  const db = legacy.db;
  try {
    await db.exec('RESET ROLE'); await db.exec(groundClockSql); await db.exec(groundClockSql); await db.exec('SET ROLE service_role');
    return await fixture(db, legacy, legacy.close);
  } catch (error) { await legacy.close(); throw error; }
}

export async function reopenDatabase(path) {
  const db = new PGlite(path);
  try {
    await db.exec('SET ROLE service_role');
    return await fixture(db, null, () => db.close());
  } catch (error) { await db.close(); throw error; }
}
