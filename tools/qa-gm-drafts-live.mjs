// Bounded GM draft canary for execution inside the configured game container.
// Reads only process.env, never prints credentials, and writes only an isolated synthetic world/owner.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore, StoreError } from '../server/store.mjs';
import { GAME } from '../src/data/meta.js';

const now = () => new Date().toISOString();
const timeoutMs = 12000;
const wantsPreflight = process.argv.includes('--preflight');
const wantsCanary = process.argv.includes('--run');
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) },
};
const out = { schema: 'marea.gm-drafts-live.v1', at: now(), mode: wantsPreflight ? 'preflight' : 'canary',
  target: 'configured-supabase', checks: [], counts: { gmRpcCalls: 0 }, retainedRecords: null };

function emit(pass, errorCode = null) {
  out.pass = pass;
  if (errorCode) out.errorCode = errorCode;
  console.log(JSON.stringify(out));
  if (!pass) process.exitCode = 1;
}

function ensure(value, check) {
  if (!value) {
    const error = new Error(check);
    error.check = check;
    throw error;
  }
  out.checks.push({ check, pass: true });
}

function safeErrorCode(error) {
  if (error instanceof StoreError && /^[a-z0-9_]{1,32}$/.test(error.code)) return error.code;
  return 'unexpected';
}

async function main() {
  if (wantsPreflight === wantsCanary) throw Object.assign(new Error('usage'), { code: 'usage' });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const publicKey = process.env.SUPABASE_PUBLIC_KEY;
  if (typeof url !== 'string' || !url || typeof serviceKey !== 'string' || !serviceKey ||
      typeof publicKey !== 'string' || !publicKey) throw Object.assign(new Error('configuration'), { code: 'configuration' });
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error('configuration'), { code: 'configuration' }); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error('configuration'), { code: 'configuration' });
  }

  const service = createClient(url, serviceKey, options);
  const publicClient = createClient(url, publicKey, options);
  const rpcNames = [];
  const auditedClient = { rpc: async (name, args) => {
    rpcNames.push(name);
    const result = await service.rpc(name, args);
    return result;
  } };
  const store = createSupabaseStore(auditedClient);
  const ready = await store.checkGmDrafts();
  ensure(ready.version === 1, 'readiness_before');
  const denied = await publicClient.rpc('mn_gm_drafts_ready', {});
  ensure(!!denied.error && (denied.error.code === '42501' || denied.status === 401 || denied.status === 403),
    'anonymous_rpc_denied');
  out.checks.push({ check: 'authenticated_rpc_acl_denial', pass: true,
    source: 'SQL readiness verifies anon and authenticated EXECUTE/table ACLs' });
  if (out.mode === 'preflight') {
    out.readiness = { before: ready.version };
    out.counts = { gmRpcCalls: rpcNames.length };
    return;
  }

  const owner = randomUUID().toLowerCase();
  const world = `gm03qa-${randomUUID().toLowerCase()}`;
  const base = { seed: GAME.seed, revision: 'terrain-s21-v1' };
  const makeDocument = (x = 1) => ({ schema: 'marea.gm.map-draft', version: 2, base,
    objects: [{ id: 'qa-crate', assetId: 'prop:storage-crate',
      transform: { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }, collider: 'none' }],
    baseOverrides: [] });
  const firstOperationId = randomUUID().toLowerCase();
  const secondOperationId = randomUUID().toLowerCase();
  const firstRequest = { world, owner, operationId: firstOperationId, expectedRevision: 0, document: makeDocument(1) };
  const empty = await store.loadGmDraft({ world, owner });
  ensure(empty.revision === 0 && empty.document === null && empty.savedAt === null, 'synthetic_head_starts_empty');
  const [first, second] = await Promise.all([
    store.saveGmDraft(firstRequest),
    store.saveGmDraft({ ...firstRequest, operationId: secondOperationId, document: makeDocument(2) }),
  ]);
  const winners = [first, second].filter(result => result.ok === true);
  const conflicts = [first, second].filter(result => result.ok === false && result.why === 'conflict');
  ensure(winners.length === 1 && conflicts.length === 1, 'concurrent_cas_single_winner');
  const winner = winners[0];
  const winningRequest = first.ok ? firstRequest
    : { ...firstRequest, operationId: secondOperationId, document: makeDocument(2) };
  const losingRequest = first.ok
    ? { ...firstRequest, operationId: secondOperationId, document: makeDocument(2) }
    : firstRequest;
  ensure(winner.head.revision === 1 && winner.head.document.base.seed === GAME.seed &&
    winner.head.document.base.revision === 'terrain-s21-v1', 'saved_document_base_and_revision');
  const loaded = await store.loadGmDraft({ world, owner });
  ensure(JSON.stringify(loaded) === JSON.stringify(winner.head), 'load_returns_exact_head');
  const replay = await store.saveGmDraft(winningRequest);
  ensure(replay.ok && replay.replay === true && JSON.stringify(replay.head) === JSON.stringify(winner.head),
    'exact_replay_preserves_head_and_timestamp');
  const conflictReplay = await store.saveGmDraft(losingRequest);
  ensure(conflictReplay.ok === false && conflictReplay.why === 'conflict' && conflictReplay.revision === 1,
    'conflict_receipt_replays');
  const changedReuse = await store.saveGmDraft({ ...winningRequest, document: makeDocument(99) });
  ensure(changedReuse.ok === false && changedReuse.why === 'operation', 'operation_uuid_reuse_rejected');

  const lostOperationId = randomUUID().toLowerCase();
  const lostRequest = { world, owner, operationId: lostOperationId, expectedRevision: 1, document: makeDocument(3) };
  let dropReply = true;
  const droppingClient = { rpc: async (name, args) => {
    const result = await auditedClient.rpc(name, args);
    if (name === 'mn_save_gm_draft' && dropReply) { dropReply = false; throw new Error('simulated lost reply'); }
    return result;
  } };
  const uncertainStore = createSupabaseStore(droppingClient);
  let lostReplyObserved = false;
  try { await uncertainStore.saveGmDraft(lostRequest); }
  catch (error) { lostReplyObserved = error instanceof StoreError && error.code === 'unavailable'; }
  ensure(lostReplyObserved, 'commit_reply_loss_is_reported_as_uncertain');
  const recoveryStore = createSupabaseStore(auditedClient);
  const recovered = await recoveryStore.saveGmDraft(lostRequest);
  ensure(recovered.ok && recovered.replay === true && recovered.head.revision === 2 &&
    recovered.head.document.objects[0].transform.position.x === 3, 'lost_reply_reconciles_exact_commit');

  const after = await store.checkGmDrafts();
  ensure(after.version === 1, 'readiness_after');
  ensure(rpcNames.every(name => ['mn_gm_drafts_ready', 'mn_load_gm_draft', 'mn_save_gm_draft'].includes(name)),
    'only_gm_storage_rpcs_used');
  out.readiness = { before: ready.version, after: after.version };
  out.scopeWorld = world;
  out.ownerFixture = owner;
  out.finalRevision = recovered.head.revision;
  out.counts = { gmRpcCalls: rpcNames.length, successfulHeads: 1, operationReceipts: 3 };
  out.retainedRecords = { heads: 1, receipts: 3, reason: 'synthetic UUID scope; service role has no direct delete privilege' };
}

try {
  await main();
  emit(true);
} catch (error) {
  const check = typeof error?.check === 'string' ? error.check : 'live_probe_failed';
  out.failedCheck = check;
  emit(false, safeErrorCode(error));
}
