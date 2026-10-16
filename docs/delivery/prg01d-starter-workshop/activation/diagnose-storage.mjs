// Read-only reconstruction for the exact failed disposable workshop canary.
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../../../../server/store.mjs';
import { storageProfileDelta } from '../../../../src/sim/systems/raftEditor.js';
import { economicOperationId } from '../../../../server/economicAuthority.mjs';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('../realms-of-trade-server/.env');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const marker = 'mnQaWorkshopPublic:' + process.argv[2];
if (!/^mnQaWorkshopPublic:[0-9a-f-]{36}$/.test(marker)) throw Error('exact QA marker required');
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (list.error) throw Error('QA identity lookup failed');
const matches = list.data.users.filter(user => user.user_metadata?.mn_qa_marker === marker);
if (matches.length !== 1) throw Error('exact QA identity missing or ambiguous');
const account = matches[0].id, store = storeFromEnv(), p = await store.loadProfile(account), w = await store.loadWorld('marea-negra');
if (p?.data?.pirateId !== `account:${account}`) throw Error('QA profile ownership mismatch');
const ship = p.data.eco.ships.find(s => s.kind === 'raft');
const command = { type: 'raft', op: 'place', opId: 'workshop-first-storage-credit', id: ship.id,
  expectedRev: ship.rev, piece: ['storage', 0, 1, 0, 0], rules: 2 };
const operation = economicOperationId('marea-negra', account, command.opId), delta = storageProfileDelta(p.data, command);
const receipt = await store.loadEconomicOperation(operation);
const request = { world: 'marea-negra', account, command, expectedProfileVersion: p.version, expectedWorldVersion: w.version,
  before: p.data, profile: delta.profile, worldData: w.data, ack: { type: 'raftEdit', id: ship.id, op: command.op,
    opId: command.opId, ok: true, why: '', rev: ship.rev + 1 } };
const valid = await admin.rpc('mn_valid_economic_request', { p_operation_id: operation, p_request: request });
const control = structuredClone(request); control.command.id = ship.id.replaceAll(':', '_'); control.ack.id = control.command.id;
const controlValid = await admin.rpc('mn_valid_economic_request', { p_operation_id: operation, p_request: control });
if (valid.error || controlValid.error) throw Error('read-only validator diagnostic unavailable');
const evidence = { at: new Date().toISOString(), failedReceiptAbsent: receipt === null, candidateWhy: delta.why,
  persistedCredit: p.data.workshop.storageCredit, persistedKitCount: p.data.workshop.crateKits,
  raftId: { length: ship.id.length, containsColon: ship.id.includes(':'), acceptedByHostPattern: /^[A-Za-z0-9:_-]{1,120}$/.test(ship.id) },
  exactCandidateValidator: valid.data, identifierControlValidator: controlValid.data, profileVersion: p.version, worldVersion: w.version };
console.log(JSON.stringify(evidence));
await writeFile(new URL('./storage-diagnostic.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
