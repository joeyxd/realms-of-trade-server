// Read-only diagnosis for one exact disposable workshop QA marker. Never prints account IDs or secrets.
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeFromEnv } from '../server/store.mjs';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { economicOperation } from '../server/economicOperation.mjs';
import { loggingWorldTransition } from '../server/loggingOperation.mjs';

const fail = () => { throw new Error('read-only QA diagnosis unavailable'); };
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
let tag = null, envFile = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--tag' && process.argv[i + 1] && !tag) tag = process.argv[++i];
  else if (process.argv[i] === '--env-file' && process.argv[i + 1] && !envFile) envFile = process.argv[++i];
  else fail();
}
if (!/^[0-9a-f-]{36}$/.test(tag || '') || !envFile) fail();
try { process.loadEnvFile(path.resolve(envFile)); } catch { fail(); }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) fail();
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const store = storeFromEnv();
const marker = `mnQaWorkshopPublic:${tag}`;
const users = [];
for (let page = 1; page <= 100; page++) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) fail();
  users.push(...result.data.users);
  if (result.data.users.length < 1000) break;
}
const matches = users.filter(user => user.user_metadata?.mn_qa_marker === marker);
if (matches.length !== 1) fail();
const account = matches[0].id, worldId = process.env.WORLD_ID || 'marea-negra';
const profile = await store.loadProfile(account), world = await store.loadWorld(worldId);
if (!profile?.data || profile.data.pirateId !== `account:${account}` || !world?.data?.resources) fail();
const palms = world.data.resources.nodes.filter(row => row.kind === 'palm');
const node = palms.find(row => row.hits === 0 && row.readyAt === 0) || palms[0];
if (!node || world.data.resources.v !== 3) fail();
const opId = `diagnostic_${randomUUID()}`;
const command = { type: 'resource', op: 'gather', opId, node: node.id, expectedRev: node.rev, challenge: randomUUID() };
const ack = { type: 'resource', op: 'gather', opId, ok: false, why: 'timing', rev: node.rev };
const request = { world: worldId, account, command, expectedProfileVersion: profile.version,
  expectedWorldVersion: world.version, profile: profile.data, worldData: world.data, ack,
  beneficiaries: [{ account, expectedVersion: profile.version, before: profile.data, profile: profile.data }] };
const operationId = economicOperationId(worldId, account, opId);
async function probe(name, rpcName, args) {
  try {
    const result = await admin.rpc(rpcName, args);
    return { name, available: !result.error, value: result.error ? null : result.data };
  } catch { return { name, available: false, value: null }; }
}
const normalizedProbe = await probe('starter_v3_normalize', 'mn_starter_v3_normalize', { p_request: request });
const normalized = normalizedProbe.value;
const resourceV2Probe = await probe('resource_v3_as_v2', 'mn_resource_state_v3_as_v2',
  { p_resources: world.data.resources });
const checks = [
  await probe('resource_state', 'mn_valid_resource_state', { p_resources: world.data.resources }),
  await probe('economic_request', 'mn_valid_economic_request', { p_operation_id: operationId, p_request: request }),
];
let jsInputValid = false, jsLoggingTransition = false;
try { economicOperation({ operationId, request }); jsInputValid = true; } catch {}
try { jsLoggingTransition = loggingWorldTransition(world.data.resources, request) === true; } catch {}
if (normalized) {
  checks.push(
    await probe('logging_beneficiaries', 'mn_valid_logging_beneficiaries', { p_request: normalized }),
    await probe('logging_awards', 'mn_valid_logging_awards', { p_request: normalized }),
    await probe('economic_request_starter_base', 'mn_valid_economic_request_starter_base',
      { p_operation_id: operationId, p_request: normalized }),
  );
  if (resourceV2Probe.value) checks.push(await probe('logging_transition', 'mn_valid_logging_transition',
    { p_request: normalized, p_before: resourceV2Probe.value }));
  checks.push(await probe('starter_v3_transition', 'mn_valid_starter_v3_transition',
    { p_operation_id: operationId, p_request: request, p_current: world.data }));
}
const receiptQuery = await admin.from('mn_economic_operations').select('operation_id,created_at')
  .eq('request->>account', account).order('operation_id', { ascending: true }).limit(1000);
if (receiptQuery.error) fail();
const receipts = receiptQuery.data.map(row => ({ operationIdSha256: sha(row.operation_id), createdAt: row.created_at }));
const base = process.env.MN_WORKSHOP_TARGET || 'https://marea.62.171.136.148.sslip.io';
let publicStatus = { available: false };
try {
  const [health, response] = await Promise.all([fetch(new URL('/health', base)), fetch(new URL('/status', base))]);
  const healthy = health.ok && await health.text() === 'ok';
  publicStatus.httpStatus = response.status;
  if (response.ok) {
    const status = await response.json();
    publicStatus = { available: true, healthy, version: status.version,
      players: Number.isSafeInteger(status.players) ? status.players : null,
      sockets: Number.isSafeInteger(status.sockets) ? status.sockets : null,
      errors: Number.isSafeInteger(status.errors) ? status.errors : null,
      economicPending: Number.isSafeInteger(status.storage?.economic?.pending) ? status.storage.economic.pending : null,
      economicFailed: typeof status.storage?.economic?.failed === 'boolean' ? status.storage.economic.failed : null,
      unsaved: Number.isSafeInteger(status.storage?.unsaved) ? status.storage.unsaved : null,
      profileWrites: Number.isSafeInteger(status.storage?.profileWrites) ? status.storage.profileWrites : null,
      worldWriting: typeof status.storage?.worldWriting === 'boolean' ? status.storage.worldWriting : null,
      worldReady: typeof status.storage?.world?.ready === 'boolean' ? status.storage.world.ready : null,
      worldVersion: Number.isSafeInteger(status.storage?.world?.version) ? status.storage.world.version : null,
      serverTick: Number.isSafeInteger(status.tick) ? status.tick : null };
  }
} catch { publicStatus = { available: false }; }
const evidence = { schema: 'l03d-logging-failure-diagnostic/v1', at: new Date().toISOString(),
  fixtureMarkerSha256: sha(marker), fixtureMatchCount: matches.length,
  accountIdSha256: sha(account), profile: { ownerSentinelValid: true, version: profile.version, dataSha256: sha(stable(profile.data)),
    workshopV: profile.data.workshop?.v ?? null, crateKits: profile.data.workshop?.crateKits ?? null,
    storageCredit: profile.data.workshop?.storageCredit ?? null, axe: profile.data.tools?.axe === 1 },
  world: { id: worldId, version: world.version, dataSha256: sha(stable(world.data)), resourceV: world.data.resources.v,
    resourceTick: world.data.resources.tick,
    savedEconomyHours: Number.isFinite(world.data.economy?.hours) ? world.data.economy.hours : null,
    savedEconomyAccumulator: Number.isFinite(world.data.economy?.acc) ? world.data.economy.acc : null,
    palmCount: palms.length, chosenNodeSha256: sha(node.id),
    chosenNodeRev: node.rev, chosenNodeHits: node.hits, chosenNodeReadyAt: node.readyAt },
  candidate: { kind: 'resource.gather', denial: 'timing', inventedChallenge: true,
    operationIdSha256: sha(operationId), commandSha256: sha(stable(command)), requestSha256: sha(stable(request)),
    jsEconomicInputValid: jsInputValid, jsLoggingWorldTransition: jsLoggingTransition },
  normalizer: { available: normalizedProbe.available, returnedObject: Boolean(normalized),
    outputSha256: normalized ? sha(stable(normalized)) : null },
  validatorProbes: checks.map(row => ({ name: row.name, available: row.available,
    value: typeof row.value === 'boolean' ? row.value : row.value === null ? null : 'non-boolean' })),
  receipts: { queryAvailable: true, count: receipts.length, rows: receipts }, publicStatus };
const out = new URL('../docs/delivery/l03d-companion-control/logging-failure-diagnostic.json', import.meta.url);
await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence));
