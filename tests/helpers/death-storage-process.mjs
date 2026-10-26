import { PGlite } from '@electric-sql/pglite';
import { database, adapters } from './death-storage-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, deathOp, WORLD } from './death-storage.mjs';

const [mode, location] = process.argv.slice(2);
let db;
try {
  if (mode === 'commit') {
    const sql = await database(location); db = sql.db;
    const f = makeDeath({ lawless: true, killer: true, pearlCount: 3, loot: true });
    const { request } = planRequest(f, deathOp(950)); await seedDeathStore(sql.store, f, request);
    sql.loseNextReply();
    let lost = null;
    try { await sql.store.commitDeath(request); } catch (error) { lost = error.code; }
    await db.close(); db = null;
    process.stdout.write(JSON.stringify({ request, lost }));
  } else {
    let input = ''; for await (const part of process.stdin) input += part;
    const request = JSON.parse(input); db = new PGlite(location); await db.exec('SET ROLE service_role');
    const sql = adapters(db), receipt = await sql.store.loadDeathOperation(request.operationId);
    const profiles = await Promise.all(request.profiles.map((p) => sql.store.loadProfile(p.id)));
    const uniques = await Promise.all(request.pearls.map((q) => sql.store.loadUnique(q.uid)));
    const locations = await Promise.all(request.pearls.map((q) => sql.store.loadPearlLocation(q.uid)));
    const drops = await sql.store.listDeathDrops(WORLD);
    const dispatchesBefore = sql.calls.filter((c) => c.name === 'mn_commit_death').length;
    const replay = mode === 'replay' ? await sql.store.commitDeath(request) : null;
    const unchanged = JSON.stringify(drops) === JSON.stringify(await sql.store.listDeathDrops(WORLD)) &&
      JSON.stringify(profiles) === JSON.stringify(await Promise.all(request.profiles.map((p) => sql.store.loadProfile(p.id))));
    await db.close(); db = null;
    process.stdout.write(JSON.stringify({ receipt, profiles, uniques, locations, drops, dispatchesBefore, replay, unchanged }));
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ message: error.message, code: error.code })); process.exitCode = 1;
} finally { if (db) await db.close(); }
