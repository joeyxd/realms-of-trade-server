import { readFile } from 'node:fs/promises';
import { createSupabaseStore } from '../../server/store.mjs';
import { database as databaseBeforeGroundTransaction, reopenDatabase as reopenBeforeGroundTransaction } from './ground-clock-sql.mjs';

export const groundTransactionSql = await readFile(
  new URL('../../server/migrations/018_ground_transactions.sql', import.meta.url), 'utf8');
const migration014 = await readFile(new URL('../../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const migration015 = await readFile(new URL('../../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const migration016 = await readFile(new URL('../../server/migrations/016_logging_operations.sql', import.meta.url), 'utf8');
const migration017 = await readFile(new URL('../../server/migrations/017_agent_goods_budget.sql', import.meta.url), 'utf8');

function transactionAdapter(base) {
  const calls = [];
  let loseReply = false;
  const client = {
    async rpc(name, args) {
      const call = { name, args: structuredClone(args) };
      calls.push(call);
      try {
        let data;
        if (name === 'mn_commit_ground_transaction') {
          data = (await base.db.query(
            'select public.mn_commit_ground_transaction($1::uuid,$2::jsonb) as data',
            [args.p_operation_id, args.p_request])).rows[0].data;
          call.result = structuredClone(data);
          if (loseReply) { loseReply = false; throw new Error('Lost local ground-transaction reply'); }
        } else if (name === 'mn_load_ground_transaction') {
          data = (await base.db.query(
            'select public.mn_load_ground_transaction($1::uuid) as data', [args.p_operation_id])).rows[0].data;
        } else if (name === 'mn_ground_transactions_ready') {
          data = (await base.db.query('select public.mn_ground_transactions_ready() as data')).rows[0].data;
        } else throw new Error(`Unexpected ground-transaction RPC: ${name}`);
        call.result = structuredClone(data);
        return { data, error: null };
      } catch (error) {
        if (error.message === 'Lost local ground-transaction reply') throw error;
        return { data: null, error: { message: error.message ?? 'Local SQL rejection', code: error.code ?? 'XX000' } };
      }
    },
  };
  const methods = createSupabaseStore(client);
  return {
    calls,
    store: { ...base.store, commitGroundTransaction: methods.commitGroundTransaction,
      loadGroundTransaction: methods.loadGroundTransaction, checkGroundTransactions: methods.checkGroundTransactions },
    loseNextReply: () => { loseReply = true; },
  };
}

async function migrate(base) {
  await base.db.exec('RESET ROLE');
  for (const sql of [migration014, migration015, migration016, migration017, groundTransactionSql, groundTransactionSql]) {
    await base.db.exec(sql);
  }
  await base.db.exec('SET ROLE service_role');
  return { ...base, ...transactionAdapter(base), close: base.close };
}

export async function database(path) {
  const base = await databaseBeforeGroundTransaction(path);
  try { return await migrate(base); }
  catch (error) { await base.close(); throw error; }
}

export async function reopenDatabase(path) {
  const base = await reopenBeforeGroundTransaction(path);
  return { ...base, ...transactionAdapter(base), close: base.close };
}
