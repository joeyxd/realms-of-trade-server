import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { database } from './pearl-batch-journal-sql.mjs';
import { canaryClient } from './pearl-canary-sql-client.mjs';
import { createSupabaseStore } from '../../server/store.mjs';
import { createSupabasePearlJournal } from '../../server/pearlJournal.mjs';
import { journalPhases, journalFixture, newJournalManifest, verifyJournalPhase } from '../../tools/verify-pearl-batch-journal.mjs';

const [phase,root]=process.argv.slice(2);
assert.ok(journalPhases.includes(phase));assert.equal(fs.realpathSync(root),path.resolve(root));
const manifestFile=path.join(root,'manifest.json'),dbPath=path.join(root,'db');
let db;
try {
  if(phase==='prepare') {
    db=(await database(dbPath)).db;
    fs.writeFileSync(manifestFile,JSON.stringify(newJournalManifest()),{flag:'wx'});
  } else {db=new PGlite(dbPath);await db.exec('SET ROLE service_role');}
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),f=journalFixture(manifest.ids),checks=[],calls=[];
  const admin=canaryClient(db,false,calls);
  await verifyJournalPhase(phase,manifest,{admin,store:createSupabaseStore(admin),journal:createSupabasePearlJournal(admin,f.scope),
    publicClient:canaryClient(db,true,calls),persist:async(m)=>fs.writeFileSync(manifestFile,JSON.stringify(m)),record:(label)=>checks.push(label)});
  fs.writeFileSync(path.join(root,`${phase}.json`),JSON.stringify({phase,checks,calls:calls.map(({name,method})=>({name,method}))}),{flag:'wx'});
  process.stdout.write(JSON.stringify({phase,passed:true,checks:checks.length})+'\n');
}finally{await db?.close();}
