// Read-only SQL controls for the exact disposable timed-logging failure. No commit RPC is called.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { storeFromEnv } from '../../../../server/store.mjs';
import { economicOperationId } from '../../../../server/economicAuthority.mjs';
import { Economy } from '../../../../src/sim/economy/economy.js';
if (process.argv.length !== 4 || process.argv[2] !== '--env-file') throw Error('usage: node diagnose-logging-baseline.mjs --env-file PATH');
try { process.loadEnvFile(process.argv[3]); } catch { throw Error('environment file unavailable'); }
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const marker = 'mnQaWorkshopPublic:7a949137-a098-4b6d-887d-a8600c11b303';
const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
assert.equal(listed.error, null);
const matches = listed.data.users.filter(u => u.user_metadata?.mn_qa_marker === marker);
assert.equal(matches.length, 1, 'QA marker unavailable');
const account = matches[0].id, store = storeFromEnv();
const p = await store.loadProfile(account), w = await store.loadWorld('marea-negra');
assert.ok(p?.data && w?.data?.resources?.v === 3);
const node = w.data.resources.nodes.find(n => n.kind === 'palm' && n.hits === 0 && n.readyAt === 0);
assert.ok(node);
const opId = 'read-only-logging-baseline-control', operation = economicOperationId('marea-negra', account, opId);
assert.equal(await store.loadEconomicOperation(operation), null);
const request = { world: 'marea-negra', account,
  command: { type: 'resource', op: 'gather', opId, node: node.id, expectedRev: node.rev, challenge: 'invented-control' },
  expectedProfileVersion: p.version, expectedWorldVersion: w.version,
  profile: structuredClone(p.data), worldData: structuredClone(w.data),
  ack: { type: 'resource', op: 'gather', opId, ok: false, why: 'timing', rev: node.rev },
  beneficiaries: [{ account, expectedVersion: p.version, before: structuredClone(p.data), profile: structuredClone(p.data) }] };
const rpc = async (name, args) => {
  const r = await admin.rpc(name, args);
  if (r.error) throw Error('read-only validator unavailable');
  return r.data;
};
const validRequest = await rpc('mn_valid_economic_request', { p_operation_id: operation, p_request: request });
const transition = (candidate, current) => rpc('mn_valid_starter_v3_transition', {
  p_operation_id: operation, p_request: candidate, p_current: current });
const baselineValid = await transition(request, w.data);
const currentEconomy = Economy.from(w.data.economy, w.data.seed); currentEconomy.step(1 / 30);
const advanced = structuredClone(request); advanced.worldData.economy = currentEconomy.serialize();
advanced.worldData.resources.tick++;
const advancedRequestValid = await rpc('mn_valid_economic_request', { p_operation_id: operation, p_request: advanced });
const oldBaselineRejected = !(await transition(advanced, w.data));
const freshBaseline = structuredClone(w.data); freshBaseline.economy = advanced.worldData.economy;
const freshBaselineValid = await transition(advanced, freshBaseline);
const result = { at: new Date().toISOString(), readonly: true, committed: false,
  profileVersion: p.version, worldVersion: w.version, resourcesVersion: w.data.resources.v,
  validRequest, baselineValid, advancedRequestValid, oldBaselineRejected, freshBaselineValid,
  changedEconomyAccumulator: currentEconomy.acc !== w.data.economy.acc,
  deniedProfileUnchanged: JSON.stringify(advanced.profile) === JSON.stringify(p.data),
  receiptAbsent: (await store.loadEconomicOperation(operation)) === null };
assert.ok(validRequest && baselineValid && advancedRequestValid && oldBaselineRejected && freshBaselineValid);
await writeFile(new URL('./logging-baseline-diagnostic.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
