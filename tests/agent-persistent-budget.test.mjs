import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';
import { createBudgetAdministration, PersistentInferenceBudget } from '../tools/agent/persistent-budget.mjs';

const scope = { ownerId: 'owner-1', characterId: 'captain-1', worldId: 'world-1' };
const limits = { maxCalls: 10, maxTokens: 1000, maxCostUnits: 1000, maxEntries: 20 };
const policy = { allowanceId: 'allowance-1', period: { startsAtMs: 100, endsAtMs: 10_000 }, limits };
const input = (requestId, inputTokens = 10, outputTokens = 10, maxCostUnits = 20) => ({
  requestId, kind: 'decision', inputTokens, outputTokens, maxCostUnits, countMode: 'simulated_tokens',
});
const usage = (inputTokens = 10, outputTokens = 10, costUnits = 20) => ({ inputTokens, outputTokens, costUnits });
const fixture = async (fn) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marea-persistent-budget-'));
  try { await fn(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
};
const make = (directory, clock = { value: 200 }) => createBudgetAdministration({ directory, scope, now: () => clock.value });
const init = async (admin, overrides = {}) => admin.initialize({ ...policy, ...overrides });
const raw = async (directory) => JSON.parse(await fs.readFile(path.join(directory, 'inference-budget.json'), 'utf8'));
const writeRaw = async (directory, state) => fs.writeFile(path.join(directory, 'inference-budget.json'), JSON.stringify(state));

test('lowered limits fence an already reserved dispatch, preserving its hold until safe cancellation', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  await admin.reserve(input('reserved'));
  const lower = { ...limits, maxTokens: 19 };
  assert.equal((await admin.configure({ expectedRevision: 1, enabled: true, limits: lower })).ok, true);
  assert.equal((await admin.markDispatched('reserved')).why, 'max_tokens');
  assert.equal((await admin.inspect()).snapshot.totals.reservedEntries, 1);
  assert.equal((await admin.cancelBeforeDispatch('reserved')).ok, true);
  assert.equal((await admin.reserve({ ...input('estimated'), countMode: 'estimated_tokens' })).why, 'invalid_reservation');
}));

test('owner policy changes preserve event capacity for the last inflight reconciliation', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  await admin.reserve(input('last')); await admin.markDispatched('last');
  const state = await raw(directory);
  state.events.push(...Array.from({ length: 2044 }, () => ({ type: 'configure', atMs: 200, enabled: true, limits })));
  await writeRaw(directory, state);
  assert.equal((await admin.configure({ expectedRevision: 2046, enabled: false, limits })).why, 'budget_event_capacity');
  assert.equal((await admin.markUnknown('last', 'usage_unknown')).ok, true);
  assert.equal((await admin.settle('last', usage())).ok, true);
  const result = await admin.inspect();
  assert.equal(result.snapshot.persistence.revision, 2048);
  assert.equal(result.snapshot.totals.unresolvedTokens, 0);
  assert.equal(result.snapshot.totals.confirmedTokens, 20);
}));

test('initialization binds scope and period permanently and rejects reinitialization', async () => fixture(async (directory) => {
  const admin = make(directory);
  assert.equal((await init(admin)).ok, true);
  assert.equal((await init(admin, { allowanceId: 'replacement' })).why, 'budget_exists');
  const changedScope = createBudgetAdministration({ directory, scope: { ...scope, worldId: 'other-world' }, now: () => 200 });
  assert.equal((await changedScope.inspect()).why, 'budget_invalid_state');
  const saved = await raw(directory);
  assert.equal(saved.scope.worldId, scope.worldId);
  assert.deepEqual(saved.period, policy.period);
}));

test('restart replays reservation, dispatch, unknown usage, settlement, and duplicate protection', async () => fixture(async (directory) => {
  let clock = { value: 200 };
  const first = make(directory, clock);
  await init(first);
  assert.equal((await first.reserve(input('r1'))).ok, true);
  assert.equal((await first.markDispatched('r1')).ok, true);
  assert.equal((await first.markUnknown('r1', 'usage_unknown')).ok, true);
  const restarted = make(directory, clock);
  assert.equal((await restarted.inspect()).snapshot.totals.unknownEntries, 1);
  assert.equal((await restarted.reserve(input('r1'))).replay, true);
  assert.equal((await restarted.reserve(input('r1', 11, 10, 20))).why, 'request_id_conflict');
  assert.equal((await restarted.settle('r1', usage())).ok, true);
  const after = make(directory, clock);
  assert.equal((await after.inspect()).snapshot.totals.confirmedTokens, 20);
  assert.equal((await after.settle('r1', usage())).replay, true);
  assert.equal((await after.settle('r1', usage(11, 10, 20))).why, 'usage_conflict');
  assert.equal((await after.reserve(input('r1'))).replay, true);
}));

test('multiple administrations compete for admission through durable lock and preserve safe retry', async () => fixture(async (directory) => {
  const one = make(directory); const two = make(directory);
  await init(one);
  const lock = path.join(directory, '.inference-budget.lock');
  const held = await fs.open(lock, 'wx');
  assert.equal((await two.reserve(input('busy'))).why, 'budget_lock_busy');
  await held.close(); await fs.rm(lock);
  assert.equal((await one.reserve(input('winner'))).ok, true);
  assert.equal((await two.reserve(input('winner'))).replay, true);
  assert.equal((await two.reserve(input('other'))).ok, true);
}));

test('revocation and re-enable invalidate old dispatched calls for active provider work', async () => fixture(async (directory) => {
  const admin = make(directory);
  await init(admin);
  await admin.reserve(input('inflight'));
  await admin.markDispatched('inflight');
  assert.equal((await admin.checkActive('inflight')).ok, true);
  assert.equal((await admin.configure({ expectedRevision: 2, enabled: false, limits })).ok, true);
  assert.equal((await admin.checkActive('inflight')).why, 'budget_revoked');
  assert.equal((await admin.configure({ expectedRevision: 3, enabled: true, limits })).ok, true);
  assert.equal((await admin.checkActive('inflight')).why, 'budget_policy_changed');
  assert.equal((await admin.markDispatched('inflight')).why, 'not_reserved');
}));

test('configure uses revision CAS, retains usage and holds under lower caps, and resumes admission when raised', async () => fixture(async (directory) => {
  const admin = make(directory);
  await init(admin);
  await admin.reserve(input('held'));
  await admin.markDispatched('held');
  await admin.reserve(input('settled'));
  await admin.markDispatched('settled');
  await admin.settle('settled', usage());
  assert.equal((await admin.configure({ expectedRevision: 4, enabled: true, limits })).why, 'budget_revision_conflict');
  const lower = { maxCalls: 10, maxTokens: 30, maxCostUnits: 30, maxEntries: 20 };
  const configured = await admin.configure({ expectedRevision: 5, enabled: true, limits: lower });
  assert.equal(configured.ok, true);
  assert.equal(configured.snapshot.totals.confirmedTokens, 20);
  assert.equal(configured.snapshot.totals.heldTokens, 20);
  assert.equal((await admin.reserve(input('blocked'))).why, 'max_tokens');
  const raised = await admin.configure({ expectedRevision: 6, enabled: true, limits });
  assert.equal(raised.snapshot.totals.confirmedCostUnits, 20);
  assert.equal(raised.snapshot.totals.heldCostUnits, 20);
  assert.equal((await admin.reserve(input('after-raised-limits'))).ok, true);
  assert.equal((await admin.inspect()).snapshot.totals.confirmedTokens, 20);
  assert.equal((await admin.inspect()).snapshot.totals.heldTokens, 40);
}));

test('period bounds, expiry, invalid clock, and clock rewind fail closed', async () => fixture(async (directory) => {
  const clock = { value: 99 }; const admin = make(directory, clock);
  await init(admin);
  assert.equal((await admin.reserve(input('early'))).why, 'budget_not_started');
  clock.value = 100;
  assert.equal((await admin.reserve(input('at-start'))).ok, true);
  clock.value = 99;
  assert.equal((await admin.reserve(input('rewound'))).why, 'budget_clock_rewind');
  clock.value = Number.NaN;
  assert.equal((await admin.inspect()).snapshot.persistence.admissionWhy, 'invalid_clock');
  clock.value = policy.period.endsAtMs;
  assert.equal((await admin.reserve(input('expired'))).why, 'budget_expired');
}));

test('proxies, getters, sparse arrays, extra replay fields, and malformed states fail closed', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  const getterInput = input('getter');
  Object.defineProperty(getterInput, 'inputTokens', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal((await admin.reserve(getterInput)).why, 'invalid_reservation');
  const proxyInput = new Proxy(input('proxy'), { ownKeys() { throw new Error('trap'); } });
  assert.equal((await admin.reserve(proxyInput)).why, 'invalid_reservation');
  const state = await raw(directory);
  state.events = new Array(1);
  await writeRaw(directory, state);
  assert.equal((await admin.inspect()).why, 'budget_invalid_state');
  state.events = [];
  state.injected = true;
  await writeRaw(directory, state);
  assert.equal((await admin.inspect()).why, 'budget_invalid_state');
  delete state.injected; state.events = [{ type: 'configure', atMs: 200, enabled: true, limits, injected: 1 }];
  await writeRaw(directory, state);
  assert.equal((await admin.inspect()).why, 'budget_invalid_state');
}));

test('provider actual overrun stays latched after the owner raises limits and restart', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  await admin.reserve(input('too-large', 1, 1, 1));
  await admin.markDispatched('too-large');
  const settled = await admin.settle('too-large', usage(2, 2, 2));
  assert.equal(settled.ok, true);
  assert.equal(settled.snapshot.totals.overrun, true);
  await admin.configure({ expectedRevision: 3, enabled: true,
    limits: { maxCalls: 100, maxTokens: 10000, maxCostUnits: 10000, maxEntries: 20 } });
  assert.equal((await make(directory).inspect()).snapshot.totals.overrun, true);
  assert.equal((await admin.reserve(input('after-overrun'))).why, 'budget_overrun');
}));

test('event capacity never evicts evidence or mutates state on rejection', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  const before = await raw(directory);
  before.events = Array.from({ length: 2048 }, () => ({ type: 'configure', atMs: 200, enabled: true, limits }));
  await writeRaw(directory, before);
  assert.equal(before.events.length, 2048);
  assert.equal((await admin.configure({ expectedRevision: 2048, enabled: true, limits })).why, 'budget_event_capacity');
  const after = await raw(directory);
  assert.equal(after.events.length, 2048);
  assert.deepEqual(after.events[0], before.events[0]);
}));

test('malformed JSON and corrupt replay evidence fail closed on all administrative operations', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  await fs.writeFile(path.join(directory, 'inference-budget.json'), '{bad json');
  assert.equal((await admin.inspect()).why, 'budget_invalid_state');
  assert.equal((await admin.reserve(input('cannot-write'))).why, 'budget_invalid_state');
}));

test('persistent view is detached and rejects process-local policy mutation', async () => fixture(async (directory) => {
  const admin = make(directory); await init(admin);
  const budget = await PersistentInferenceBudget.open({ directory, scope, now: () => 200 });
  const view = budget.snapshot; view.scope.worldId = 'forged';
  assert.equal(budget.snapshot.scope.worldId, scope.worldId);
  const detachedInput = input('detached-input');
  const pending = budget.reserve(detachedInput);
  detachedInput.requestId = 'mutated-after-call';
  assert.equal((await pending).ok, true);
  assert.equal(budget.snapshot.entries.some((entry) => entry.requestId === 'detached-input'), true);
  const trappedInput = new Proxy(input('trapped-input'), { ownKeys() { throw new Error('trap'); } });
  assert.equal((await budget.reserve(trappedInput)).why, 'invalid_reservation');
  assert.throws(() => budget.setLimits(limits), /owner_configuration_required/);
}));

test('independent child processes cannot both consume the final admission slot', async () => fixture(async (directory) => {
  const script = `import { createBudgetAdministration } from ${JSON.stringify(new URL('../tools/agent/persistent-budget.mjs', import.meta.url).href)};
const admin=createBudgetAdministration({directory:process.argv[1],scope:${JSON.stringify(scope)},now:()=>200});
const result=await admin.reserve({requestId:process.argv[2],kind:'decision',inputTokens:1,outputTokens:1,maxCostUnits:1,countMode:'simulated_tokens'});
process.stdout.write(JSON.stringify(result));`;
  const admin = make(directory); await init(admin, { limits: { ...limits, maxCalls: 1 } });
  const run = (id) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, directory, id], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.setEncoding('utf8').on('data', (part) => { out += part; });
    child.stderr.setEncoding('utf8').on('data', (part) => { err += part; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
  const results = await Promise.all([run('child-a'), run('child-b')]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.every((r) => ['max_calls', 'budget_lock_busy'].includes(r.why) || r.ok), true);
  assert.equal((await run('child-c')).why, 'max_calls');
  assert.equal((await admin.inspect()).snapshot.totals.calls, 1);
}));

test('manage-budget CLI initializes, inspects, configures, reconciles, marks unknown, and cancels reserved work', async () => {
  const cli = new URL('../tools/agent/manage-budget.mjs', import.meta.url);
  await fs.access(cli);
  await fixture(async (directory) => {
    const files = path.join(directory, 'files'); await fs.mkdir(files);
    const owner = 'owner-cli'; const character = 'captain-cli'; const world = 'world-cli';
    const execute = async (message) => {
      const child = spawn(process.execPath, [fileURLToPath(cli), '--files', files, '--owner', owner, '--character', character, '--world', world], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (part) => { stdout += part; });
      child.stderr.setEncoding('utf8').on('data', (part) => { stderr += part; });
      child.stdin.end(message ? `${JSON.stringify(message)}\n` : '');
      const [code] = await once(child, 'close');
      assert.equal(code, 0, stderr);
      return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).data);
    };
    const cliPeriod = { startsAtMs: 0, endsAtMs: Number.MAX_SAFE_INTEGER };
    assert.equal((await execute({ type: 'initialize', allowanceId: 'cli-allowance', period: cliPeriod, limits }))[0].ok, true);
    assert.equal((await execute({ type: 'inspect' }))[0].ok, true);
    const configured = await execute({ type: 'configure', expectedRevision: 0, enabled: true, limits });
    assert.equal(configured[0].ok, true);
    const cliScope = { ownerId: owner, characterId: character, worldId: world };
    const adapter = createBudgetAdministration({ directory: files, scope: cliScope });
    assert.equal((await adapter.reserve(input('cli-reconcile'))).ok, true);
    assert.equal((await adapter.markDispatched('cli-reconcile')).ok, true);
    assert.equal((await execute({ type: 'reconcile', requestId: 'cli-reconcile', usage: usage() }))[0].ok, true);
    assert.equal((await adapter.reserve(input('cli-unknown'))).ok, true);
    assert.equal((await adapter.markDispatched('cli-unknown')).ok, true);
    assert.equal((await execute({ type: 'mark_unknown', requestId: 'cli-unknown' }))[0].ok, true);
    assert.equal((await adapter.reserve(input('cli-cancel'))).ok, true);
    assert.equal((await execute({ type: 'cancel_reserved', requestId: 'cli-cancel' }))[0].ok, true);
    assert.deepEqual(await execute({ type: 'exit' }), [{ ok: true, closed: true }]);
  });
});
