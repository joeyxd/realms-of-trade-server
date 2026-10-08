import { readFile } from 'node:fs/promises';
import { database as databaseBeforeDropQueue } from './death-drop-sql.mjs';

export const dropJournalSql = await readFile(
  new URL('../../server/migrations/012_death_drop_journal.sql', import.meta.url), 'utf8');

// Apply the new journal migration as the owning service role, including the idempotent reapply path.
export async function database(path) {
  const legacy = await databaseBeforeDropQueue(path);
  try {
    await legacy.db.exec('RESET ROLE');
    await legacy.db.exec(dropJournalSql);
    await legacy.db.exec(dropJournalSql);
    await legacy.db.exec('SET ROLE service_role');
    return legacy;
  } catch (error) {
    await legacy.close();
    throw error;
  }
}
