import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentControl } from '../server/agentControl.mjs';

const WORLD = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHARACTER = '33333333-3333-4333-8333-333333333333';
const OTHER_OWNER = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const MOVE = { mx: 1, mz: 0, durationMs: 1000 };
const moveTask = (epoch, expectedTaskRevision, actionId, priority = 'goal', args = MOVE) => ({
  epoch, expectedTaskRevision, actionId, type: 'move', args, priority,
});

function registry({ now = () => 100, ttlMs = 5000, capabilities = ['move', 'aim', 'attack_pve', 'body_pve', 'chat'], sessionId = () => SESSION } = {}) {
  return new AgentControl({ worldId: WORLD, ttlMs,
    bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities }],
  }, { now, sessionId });
}

function sessionSequence() {
  const ids = [SESSION, '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'];
  let index = 0;
  return () => ids[index++];
}

test('AgentControl accepts only canonical server bindings and keeps owner and character identities separate', () => {
  for (const config of [
    { worldId: 'not-a-uuid', bindings: [] },
    { worldId: WORLD, bindings: [{ ownerId: 'opaque-owner', characterId: CHARACTER, capabilities: [] }] },
    { worldId: WORLD, bindings: [{ ownerId: CHARACTER, characterId: CHARACTER, capabilities: [] }] },
    { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['move', 'move'] }] },
    { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: ['dev'] }] },
    { worldId: WORLD, bindings: [{ ownerId: OWNER, characterId: CHARACTER, capabilities: [] },
      { ownerId: OTHER_OWNER, characterId: CHARACTER, capabilities: [] }] },
  ]) assert.throws(() => new AgentControl(config, { sessionId: SESSION }));

  assert.equal(registry().binding(CHARACTER), true);
  assert.equal(registry().binding(OWNER), false, 'an owner UUID is not a managed character UUID');
  assert.equal(registry().binding('opaque-character'), false, 'client supplied labels cannot create bindings');
  const lab = new AgentControl({ worldId: 'authority-lab', bindings: [
    { ownerId: OWNER, characterId: CHARACTER, capabilities: ['move'] },
  ] }, { sessionId: () => SESSION });
  assert.equal(lab.admit(CHARACTER, 19, 0).state.grant.scope.worldId, 'authority-lab',
    'world scope is an opaque server-owned id and need not be a UUID');
});

test('admission uses the resolved character UUID, reserves entity zero, and issues a detached scoped grant', () => {
  const control = registry();
  assert.deepEqual(control.admit(OTHER_OWNER, 1, 0), { ok: false, why: 'unmapped' });
  assert.deepEqual(control.admit(CHARACTER, -1, 0), { ok: false, why: 'unmapped' });
  const admitted = control.admit(CHARACTER, 17, 0);
  assert.equal(admitted.ok, true);
  assert.deepEqual(admitted.state.grant, {
    v: 1, scope: { ownerId: OWNER, characterId: CHARACTER, worldId: WORLD, sessionId: SESSION },
    controlRevision: 1, expiresAtMs: 5100,
    capabilities: ['aim', 'attack_pve', 'body_pve', 'chat', 'move'],
  });
  assert.equal(control.byClient(17).state, 'active');
  assert.equal(control.byCharacter(CHARACTER).state, 'active');
  admitted.state.grant.scope.characterId = OWNER;
  admitted.state.grant.capabilities.push('dev');
  assert.deepEqual(control.byClient(17).grant.scope.characterId, CHARACTER);
  assert.equal(control.byClient(17).grant.capabilities.includes('dev'), false);
  assert.deepEqual(control.admit(CHARACTER, 18, 2), { ok: false, why: 'occupied' });
});

test('task revisions are CAS guarded, priority orders direct over goal over reflex, and cancel advances revision', () => {
  const control = registry();
  const { state } = control.admit(CHARACTER, 17, 0);
  const epoch = state.grant.controlRevision;
  const first = control.task(17, moveTask(epoch, 0, 'goal-1', 'goal'));
  assert.equal(first.ok, true);
  assert.equal(first.state.taskRevision, 1);
  assert.equal(first.state.task.priority, 'goal');

  assert.equal(control.task(17, moveTask(epoch, 1, 'reflex-1', 'reflex')).why, 'priority');
  assert.equal(control.task(17, moveTask(epoch, 0, 'stale-goal', 'goal')).why, 'stale_task');
  assert.equal(control.task(17, moveTask(epoch, 1, 'direct-forged', 'direct')).why, 'invalid_task',
    'the agent cannot self-assign owner priority');

  const direct = control.direct(OWNER, CHARACTER, {
    epoch, expectedTaskRevision: 1, actionId: 'owner-direct', type: 'move', args: MOVE,
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.state.task.priority, 'direct');
  assert.equal(direct.state.taskRevision, 2);
  assert.deepEqual(control.direct(OTHER_OWNER, CHARACTER, {
    epoch, expectedTaskRevision: 2, actionId: 'wrong-owner', type: 'move', args: MOVE,
  }), { ok: false, why: 'unmapped' });
  assert.equal(control.cancel(17, { epoch, expectedTaskRevision: 1 }).why, 'stale_task');
  assert.equal(control.cancel(17, { epoch, expectedTaskRevision: 2 }).why, 'priority',
    'an agent cannot cancel an owner direct order');
  const cancelled = control.cancelOwner(OWNER, CHARACTER, { epoch, expectedTaskRevision: 2 });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.state.task, null);
  assert.equal(cancelled.state.taskRevision, 3);
  assert.equal(control.task(17, moveTask(epoch, 3, 'goal-1', 'goal')).why, 'action_id_conflict',
    'an action id remains reserved for the whole grant after cancellation');
});

test('capability and task schemas reject unsupported authority and unsafe object data', () => {
  const control = registry({ capabilities: ['move'] });
  const { state } = control.admit(CHARACTER, 17, 3);
  const epoch = state.grant.controlRevision;
  assert.equal(control.task(17, { ...moveTask(epoch, 0, 'chat-task'), type: 'chat_send', args: { durationMs: 1 } }).why, 'invalid_task');
  assert.equal(control.task(17, { ...moveTask(epoch, 0, 'wait-task'), type: 'wait', args: { durationMs: 1 } }).why, 'invalid_task');
  assert.equal(control.task(17, { ...moveTask(epoch, 0, 'aim-task'), type: 'aim', args: { ax: 0, az: 1, durationMs: 100 } }).why, 'forbidden');
  assert.equal(control.task(17, { ...moveTask(epoch, 0, 'unknown-field'), args: { ...MOVE, ownerId: OWNER } }).why, 'invalid_task');
  const accessorArgs = { durationMs: 100 };
  Object.defineProperty(accessorArgs, 'mx', { enumerable: true, get() { throw new Error('must not invoke'); } });
  Object.defineProperty(accessorArgs, 'mz', { enumerable: true, value: 0 });
  assert.equal(control.task(17, moveTask(epoch, 0, 'accessor', 'goal', accessorArgs)).why, 'invalid_task');
});

test('task and grant expiry are enforced at authorization and swept without reviving work', () => {
  let now = 100;
  const control = registry({ now: () => now, ttlMs: 500, sessionId: sessionSequence() });
  const admitted = control.admit(CHARACTER, 17, 3);
  const epoch = admitted.state.grant.controlRevision;
  assert.equal(control.task(17, moveTask(epoch, 0, 'short-task', 'goal', { ...MOVE, durationMs: 100 })).ok, true);
  now = 200;
  const expiredTask = control.sweep();
  assert.equal(expiredTask.length, 1);
  assert.equal(expiredTask[0].state, 'active');
  assert.equal(expiredTask[0].task, null);
  assert.equal(expiredTask[0].taskRevision, 2);
  assert.equal(control.authorize(17, epoch), true);
  assert.equal(control.authorize(17, epoch, 2), false);

  assert.equal(control.task(17, moveTask(epoch, 2, 'near-lease-expiry')).ok, true);
  now = 600;
  const expiredLease = control.sweep();
  assert.equal(expiredLease.length, 1);
  assert.equal(expiredLease[0].state, 'revoked');
  assert.equal(expiredLease[0].why, 'expired');
  assert.equal(expiredLease[0].task, null);
  assert.equal(control.authorize(17, epoch), false);
  assert.equal(control.admit(CHARACTER, 18, 4).ok, true, 'expired grants do not retain the character lock');
});

test('revoke disables authority and clears tasks; resume requires fresh admission and never restores the old grant', () => {
  const control = registry({ sessionId: sessionSequence() });
  const admitted = control.admit(CHARACTER, 17, 0);
  const oldEpoch = admitted.state.grant.controlRevision;
  assert.equal(control.task(17, moveTask(oldEpoch, 0, 'must-clear')).ok, true);

  const revoked = control.revoke(OWNER, CHARACTER, 'owner_stop');
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.why, 'owner_stop');
  assert.equal(revoked.task, null);
  assert.equal(control.authorize(17, oldEpoch), false);
  assert.equal(control.binding(CHARACTER), true, 'the server mapping remains configured while admission is disabled');
  assert.deepEqual(control.admit(CHARACTER, 18, 0), { ok: false, why: 'disabled' });
  assert.equal(control.resume(OTHER_OWNER, CHARACTER), false);
  assert.equal(control.resume(OWNER, CHARACTER), true);
  assert.equal(control.admit(CHARACTER, 18, 0).ok, true);
  const fresh = control.byClient(18);
  assert.notEqual(fresh.grant.controlRevision, oldEpoch);
  assert.notEqual(fresh.grant.scope.sessionId, admitted.state.grant.scope.sessionId);
  assert.equal(fresh.task, null);
  assert.equal(fresh.taskRevision, 0);
  assert.equal(control.authorize(17, oldEpoch), false);
  assert.equal(control.task(17, moveTask(oldEpoch, 0, 'old-response')).ok, false);
});

test('disconnect and task expiry snapshots are detached and cannot mutate authoritative state', () => {
  const control = registry({ sessionId: sessionSequence() });
  const admitted = control.admit(CHARACTER, 17, 0);
  const epoch = admitted.state.grant.controlRevision;
  const set = control.task(17, moveTask(epoch, 0, 'detached-task'));
  set.state.task.args.mx = -1;
  set.state.grant.scope.ownerId = OTHER_OWNER;
  assert.equal(control.byClient(17).task.args.mx, 1);
  assert.equal(control.byClient(17).grant.scope.ownerId, OWNER);

  const retired = control.retire(17, 'disconnect');
  assert.equal(retired.state, 'revoked');
  assert.equal(retired.task, null);
  assert.equal(control.byClient(17), null);
  assert.equal(control.byCharacter(CHARACTER).task, null);
  assert.equal(control.admit(CHARACTER, 18, 0).ok, true);
});
