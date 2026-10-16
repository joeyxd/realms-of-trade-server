// One-shot, bounded SQL015 acceptance against the configured public Supabase project.
// It creates and removes only a randomly named QA world; it never prints receipt contents or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { storeFromEnv } from '../server/store.mjs';

const expectedPublicTarget = 'https://marea.62.171.136.148.sslip.io';
const expectedEnvPath = path.resolve('C:/DEV/real of trade/realms-of-trade-server/.env');
const evidencePath = path.resolve('docs/delivery/m5-resource-authority/sql-live.json');
const sourceWorldId = 'marea-negra';
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
};

class QaFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const ensure = (condition, code) => { if (!condition) throw new QaFailure(code); };
const unwrap = result => {
  if (!result || result.error) throw new QaFailure(`provider_${result?.error?.code || 'error'}`);
  return result.data;
};
const sort = value => Array.isArray(value) ? value.map(sort)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]))
    : value;
const stable = value => JSON.stringify(sort(value));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const evidence = {
  schema: 'marea-negra.m5-resource-sql-live.v1',
  startedAt: new Date().toISOString(),
  target: 'public-tls',
  checks: {},
};
let admin = null, authenticatedClient = null, authUserId = null, authUserMarker = null, store = null;
let qaWorldId = null, qaWorldCreated = false, failureCode = null;

function externalEnvFile() {
  const arg = process.execArgv.find(item => item.startsWith('--env-file='));
  ensure(arg, 'external_env_file_required');
  const supplied = path.resolve(arg.slice('--env-file='.length));
  ensure(supplied.toLowerCase() === expectedEnvPath.toLowerCase(), 'external_env_file_mismatch');
  let parsed;
  try { parsed = parseEnv(fs.readFileSync(supplied, 'utf8')); }
  catch { throw new QaFailure('external_env_file_unavailable'); }
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_PUBLIC_KEY'])
    ensure(typeof parsed[key] === 'string' && parsed[key].length > 0 && parsed[key] === process.env[key], 'provider_env_mismatch');
  return supplied;
}

async function authenticatedDenial(url, publicKey) {
  const email = `qa-resource-sql-${randomUUID()}@example.invalid`;
  const password = `${randomBytes(32).toString('base64url')}Aa1!`;
  authUserMarker = randomUUID();
  const createdResult = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { mnQaResourceSqlRun: authUserMarker } }));
  const created = createdResult?.user || createdResult;
  ensure(typeof created?.id === 'string' && created.id.length > 0, 'auth_user_id_not_returned');
  authUserId = created.id;
  authenticatedClient = createClient(url, publicKey, options);
  unwrap(await authenticatedClient.auth.signInWithPassword({ email, password }));
  const result = await authenticatedClient.rpc('mn_resource_operations_ready');
  ensure(Boolean(result?.error) && result.error.code === '42501', 'authenticated_rpc_denial_code_mismatch');
  return { pass: true, denied: true, code: '42501' };
}

async function main() {
  const envPath = externalEnvFile();
  const urlValue = process.env.SUPABASE_URL;
  let providerUrl, target;
  try {
    providerUrl = new URL(urlValue);
    target = new URL(process.env.MN_M5_TARGET || expectedPublicTarget);
  } catch { throw new QaFailure('target_configuration_invalid'); }
  ensure(providerUrl.protocol === 'https:' && !providerUrl.username && !providerUrl.password
    && !providerUrl.search && !providerUrl.hash, 'provider_url_invalid');
  ensure(target.href.replace(/\/$/, '') === expectedPublicTarget, 'public_target_mismatch');
  ensure((process.env.WORLD_ID || sourceWorldId) === sourceWorldId, 'source_world_mismatch');
  evidence.checks.configuration = {
    pass: true,
    envFileHash: hash(envPath.toLowerCase()),
    providerHostHash: hash(providerUrl.host.toLowerCase()),
    publicTargetHash: hash(target.host.toLowerCase()),
  };

  admin = createClient(urlValue, process.env.SUPABASE_SERVICE_KEY, options);
  const pub = createClient(urlValue, process.env.SUPABASE_PUBLIC_KEY, options);
  try { store = storeFromEnv(); } catch { throw new QaFailure('service_store_configuration_invalid'); }

  const statusResponse = await fetch(new URL('/status', target), {
    cache: 'no-store', signal: AbortSignal.timeout(12000),
  });
  ensure(statusResponse.ok, 'public_target_status_unavailable');
  const status = await statusResponse.json();
  ensure(status?.storage?.world?.id === sourceWorldId && status.storage.world.ready === true,
    'public_target_world_mismatch');
  evidence.checks.publicTarget = { pass: true, status: statusResponse.status, worldReady: true };

  const authResponse = await fetch(new URL('/auth/config', target), {
    cache: 'no-store', signal: AbortSignal.timeout(12000),
  });
  ensure(authResponse.ok, 'public_auth_configuration_unavailable');
  const publicAuth = await authResponse.json();
  let publicAuthUrl;
  try { publicAuthUrl = new URL(publicAuth?.url); }
  catch { throw new QaFailure('public_auth_url_invalid'); }
  ensure(publicAuth?.enabled === true && publicAuthUrl.origin === providerUrl.origin,
    'public_auth_provider_mismatch');
  evidence.checks.publicAuthConfig = {
    pass: true, enabled: true, providerMatch: true, authUrlOriginHash: hash(publicAuthUrl.origin),
  };

  const ready = await store.checkResourceOperations();
  ensure(ready.version === 1, 'resource_capability_version_mismatch');
  evidence.checks.serviceReady = { pass: true, version: ready.version };

  const resources = { v: 1, tick: 0,
    nodes: [{ id: `qa-${randomUUID().replaceAll('-', '').slice(0, 20)}`, kind: 'palm', rev: 1, hits: 0, readyAt: 0 }],
    cooldowns: {},
  };
  const validState = unwrap(await admin.rpc('mn_valid_resource_state', { p_resources: resources }));
  const oldState = structuredClone(resources); delete oldState.tick;
  const legacyStateAccepted = unwrap(await admin.rpc('mn_valid_resource_state', { p_resources: oldState }));
  ensure(validState === true && legacyStateAccepted === false, 'resource_state_validation_mismatch');
  evidence.checks.resourceStateValidator = { pass: true, tickStateAccepted: true, noTickRejected: true };

  const anonResult = await pub.rpc('mn_resource_operations_ready');
  ensure(Boolean(anonResult?.error) && anonResult.error.code === '42501', 'anonymous_rpc_denial_code_mismatch');
  evidence.checks.anonymousDenied = { pass: true, code: '42501' };
  evidence.checks.authenticatedDenied = await authenticatedDenial(urlValue, process.env.SUPABASE_PUBLIC_KEY);

  const listed = unwrap(await admin.from('mn_economic_operations').select('operation_id,request,result')
    .neq('request->command->>type', 'resource').order('created_at', { ascending: true }).limit(1).maybeSingle());
  ensure(listed?.operation_id && listed.request && listed.result, 'legacy_receipt_unavailable');
  ensure(listed.request.command?.type !== 'resource', 'receipt_sample_was_not_legacy');
  const loadedReceipt = await store.loadEconomicOperation(listed.operation_id);
  ensure(loadedReceipt && hash(loadedReceipt.request) === hash(listed.request)
    && hash(loadedReceipt.result) === hash(listed.result), 'legacy_receipt_blob_changed');
  evidence.checks.legacyReceipt = {
    pass: true, legacy: true, requestHash: hash(listed.request), resultHash: hash(listed.result),
  };

  const source = await store.loadWorld(sourceWorldId);
  ensure(source?.data && Number.isSafeInteger(source.version) && source.version > 0, 'source_snapshot_unavailable');
  const clone = structuredClone(source.data);
  delete clone.resources;
  clone.resources = resources;
  qaWorldId = `qa-resource-sql-${randomUUID().replaceAll('-', '')}`;
  ensure(qaWorldId !== sourceWorldId, 'qa_world_id_collision');
  const bootstrap = await store.saveWorld(qaWorldId, clone, 0);
  ensure(bootstrap?.ok === true && bootstrap.version === 1, 'qa_world_bootstrap_failed');
  qaWorldCreated = true;

  const advanced = structuredClone(clone); advanced.resources.tick = 1;
  const checkpoint = await store.saveWorld(qaWorldId, advanced, 1);
  ensure(checkpoint?.ok === true && checkpoint.version === 2, 'resource_tick_advance_rejected');
  const rewind = structuredClone(advanced); rewind.resources.tick = 0;
  const rewindResult = await store.saveWorld(qaWorldId, rewind, 2);
  ensure(rewindResult?.ok === false && rewindResult.why === 'conflict', 'resource_tick_rewind_accepted');
  const rewritten = structuredClone(advanced); rewritten.resources.tick = 2;
  rewritten.resources.nodes[0].rev = 2; rewritten.resources.nodes[0].hits = 1;
  const rewriteResult = await store.saveWorld(qaWorldId, rewritten, 2);
  ensure(rewriteResult?.ok === false && rewriteResult.why === 'conflict', 'ordinary_node_rewrite_accepted');
  const omitted = structuredClone(advanced); delete omitted.resources;
  const omissionResult = await store.saveWorld(qaWorldId, omitted, 2);
  ensure(omissionResult?.ok === false && omissionResult.why === 'conflict', 'resource_omission_accepted');
  const persisted = await store.loadWorld(qaWorldId);
  ensure(persisted?.version === 2 && hash(persisted.data) === hash(advanced), 'qa_world_state_changed_after_rejections');
  evidence.checks.qaWorldGuards = {
    pass: true, qaWorldHash: hash(qaWorldId), bootstrapAccepted: true, tickAdvanceAccepted: true,
    rewindRejected: rewindResult.why, nodeRewriteRejected: rewriteResult.why,
    omissionRejected: omissionResult.why, persistedSnapshotHash: hash(persisted.data),
  };
}

async function cleanup() {
  const cleanup = { authUserDeleted: authUserId === null, qaWorldDeleted: qaWorldId === null };
  if (!authUserId && authUserMarker && admin) {
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const matches = !listed.error ? (listed.data.users || []).filter(user =>
        user.user_metadata?.mnQaResourceSqlRun === authUserMarker) : [];
      if (matches.length === 1) authUserId = matches[0].id;
      else if (listed.error) cleanup.authDeleteCode = listed.error.code || 'provider_error';
      else cleanup.authDeleteCode = matches.length === 0 ? 'marker_not_found' : 'marker_not_unique';
    } catch { cleanup.authDeleteCode = 'provider_error'; }
  }
  cleanup.authUserDeleted = authUserMarker === null && authUserId === null;
  if (authUserId && admin) {
    try {
      const result = await admin.auth.admin.deleteUser(authUserId);
      cleanup.authUserDeleted = !result.error;
      if (result.error) cleanup.authDeleteCode = result.error.code || 'provider_error';
    } catch { cleanup.authUserDeleted = false; cleanup.authDeleteCode = 'provider_error'; }
  }
  if (qaWorldCreated && admin && qaWorldId) {
    try {
      const result = await admin.from('mn_worlds').delete().eq('world', qaWorldId).select('world');
      cleanup.qaWorldDeleted = !result.error && Array.isArray(result.data)
        && result.data.length === 1 && result.data[0].world === qaWorldId;
      if (result.error) cleanup.worldDeleteCode = result.error.code || 'provider_error';
    } catch { cleanup.qaWorldDeleted = false; cleanup.worldDeleteCode = 'provider_error'; }
  }
  evidence.checks.cleanup = { pass: cleanup.authUserDeleted && cleanup.qaWorldDeleted, ...cleanup };
  if (!evidence.checks.cleanup.pass && !failureCode) failureCode = 'cleanup_incomplete';
}

try { await main(); }
catch (error) { failureCode = error instanceof QaFailure ? error.code : 'unexpected_failure'; }
finally {
  await cleanup();
  evidence.finishedAt = new Date().toISOString();
  evidence.pass = failureCode === null && evidence.checks.cleanup.pass === true;
  if (failureCode) evidence.failureCode = failureCode;
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(evidencePath, 0o600); } catch { /* ACLs may not expose POSIX modes on Windows. */ }
  console.log(JSON.stringify({ pass: evidence.pass, failureCode: failureCode || undefined,
    checkNames: Object.keys(evidence.checks) }));
}
if (!evidence.pass) process.exitCode = 1;
