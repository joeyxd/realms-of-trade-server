import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from '../../server/store.mjs';
import { database as databaseBeforeJournal, reopenDatabase as reopenBeforeJournal } from './ground-transaction-sql.mjs';

export const groundTransactionJournalSql = await readFile(
  new URL('../../server/migrations/019_ground_transaction_journal.sql', import.meta.url), 'utf8');

function attachJournal(base) {
  const calls = [];
  let loseCommitReply = false;
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), args = JSON.parse(init.body ?? '{}');
    calls.push({ name, args: structuredClone(args) });
    try {
      let data;
        if (name === 'mn_load_world') {
          data = (await base.db.query('select public.mn_load_world($1) as data', [args.p_world])).rows[0].data;
        } else if (name === 'mn_ground_transaction_journal_ready') {
          data = (await base.db.query('select public.mn_ground_transaction_journal_ready() as data')).rows[0].data;
        } else if (name === 'mn_prepare_ground_transaction_intent') {
          data = (await base.db.query('select public.mn_prepare_ground_transaction_intent($1::uuid,$2::jsonb) as data',
            [args.p_operation_id, args.p_request])).rows[0].data;
        } else if (name === 'mn_load_ground_transaction_intent') {
          data = (await base.db.query('select public.mn_load_ground_transaction_intent($1::uuid) as data',
            [args.p_operation_id])).rows[0].data;
        } else if (name === 'mn_list_ground_transaction_intents') {
          data = (await base.db.query('select public.mn_list_ground_transaction_intents($1,$2::uuid,$3::int) as data',
            [args.p_world, args.p_after_id ?? null, args.p_limit ?? 64])).rows[0].data;
        } else if (name === 'mn_commit_ground_transaction') {
          data = (await base.db.query('select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
            [args.p_operation_id, args.p_request])).rows[0].data;
        } else {
          const { data: result, error } = await base.client.rpc(name, args);
          if (error) throw error;
          data = result;
        }
        if (name === 'mn_commit_ground_transaction' && loseCommitReply) {
          loseCommitReply = false;
          throw new Error('Lost local ground-transaction commit reply');
        }
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ message: error.message ?? 'Local SQL rejection', code: error.code ?? 'XX000' }),
          { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  const journalClient = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  const store = { ...base.store, loadWorld: createSupabaseStore(journalClient).loadWorld, async commitGroundTransaction(raw) {
    const result = await base.store.commitGroundTransaction(raw);
    if (loseCommitReply) { loseCommitReply = false; throw new Error('Lost local ground-transaction commit reply'); }
    return result;
  } };
  let closed = false;
  return { ...base, store, calls, journalClient, loseNextCommitReply: () => { loseCommitReply = true; },
    loseNextReply: () => { loseCommitReply = true; },
    close: async () => { if (closed) return; closed = true; await base.close(); } };
}

async function migrate(base) {
  await base.db.exec('RESET ROLE');
  await base.db.exec(groundTransactionJournalSql);
  await base.db.exec(groundTransactionJournalSql);
  await base.db.exec('SET ROLE service_role');
  return attachJournal(base);
}

export async function database(path) {
  const base = await databaseBeforeJournal(path);
  try { return await migrate(base); }
  catch (error) { await base.close(); throw error; }
}

export async function reopenDatabase(path) {
  const base = await reopenBeforeJournal(path);
  return attachJournal(base);
}
