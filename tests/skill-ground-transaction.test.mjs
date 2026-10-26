import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile } from '../src/sim/systems/inventory.js';
import { Economy } from '../src/sim/economy/economy.js';
import { createMemoryStore } from '../server/store.mjs';
import { draftSkills, validStoredSkillRequest } from '../server/skillOperation.mjs';
import { upgradeTimingState } from '../server/resourceState.mjs';
import { groundTransactionOperation, checkedGroundTransactionReceipt } from '../server/groundTransaction.mjs';
import { checkedGroundTransactionIntent } from '../server/groundTransactionJournal.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const clone = structuredClone, account = id(1), world = 'skills-contract', TICK = 100;
const community = () => ({ v: 1, epoch: id(700), project: { id: 'salty-shore-carpentry', version: 7,
  requirements: { madera: 4, piedra: 2 }, contributed: { madera: 4, piedra: 2 } } });
async function fixture() {
  const store = createMemoryStore(), p = newProfile(), w = { v: 1, seed: 77, economy: new Economy(77).serialize(),
    community: community(), resources: upgradeTimingState({ v: 1, tick: TICK,
      nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} }) };
  p.mast = [[4, 0], [1, 0]]; p.gold = 200;
  await store.initializeProfile(account, p); await store.saveWorld(world, w, 0);
  return { store, p, w, pv: 1, wv: 1 };
}
function proposal(f, opId, n) {
  const command = { type: 'skills', op: 'assign', opId, expectedRev: f.p.eco.tradeRev, tree: 'combat', node: 'lunge' };
  const changed = draftSkills(f.p, command);
  return { operationId: id(n), request: { world, account, command, expectedProfileVersion: f.pv,
    expectedWorldVersion: f.wv, before: clone(f.p), profile: changed.profile, worldData: clone(f.w), ack: changed.ack } };
}
// A fresh live-catalog request, and one valid by stored shape only (the live rules would now deny it).
async function requests() {
  const f = await fixture(), fresh = proposal(f, 'assign-lunge', 10);
  const first = await f.store.commitEconomicOperation(fresh);
  assert.equal(first.ok, true);
  f.p = clone(fresh.request.profile); f.w = clone(fresh.request.worldData); f.pv = first.profileVersion; f.wv = first.worldVersion;
  const old = proposal(f, 'old-rules', 16);
  assert.equal(old.request.ack.ok, true);
  for (const p of [old.request.before, old.request.profile]) p.mast = [[1, 0], [1, 0]];
  assert.equal(draftSkills(old.request.before, old.request.command).ack.ok, false);
  assert.equal(validStoredSkillRequest(old.request), true);
  return { fresh, old };
}
const wrap = (operation, n = 50, patch = {}) => ({ operationId: id(n), request: { world, expectedWorldVersion: operation.request.expectedWorldVersion,
  worldData: clone(operation.request.worldData), family: 'economic', operation: clone(operation.request),
  clock: { operationId: id(n + 1), expectedVersion: 1, expectedTick: TICK, tick: TICK }, ...patch } });
const groundResult = (outer, effect) => ({ ok: true, replay: false, worldVersion: outer.request.expectedWorldVersion + 1,
  clock: { world, tick: TICK, version: 1, operationId: outer.request.clock.operationId }, effect });
const economicResult = request => ({ ok: true, replay: false, profileVersion: request.expectedProfileVersion + 1,
  worldVersion: request.expectedWorldVersion + 1, ack: clone(request.ack) });
const receipt = outer => ({ request: clone(outer.request), result: groundResult(outer, economicResult(outer.request.operation)) });
const intent = (outer, state) => ({ operationId: outer.operationId, request: clone(outer.request), state,
  result: state === 'pending' ? null : receipt(outer).result });

test('a ground receipt or intent of an older skill catalog is accepted by stored shape, new input is not', async () => {
  const { old } = await requests(), outer = wrap(old);
  assert.throws(() => groundTransactionOperation(outer), { code: 'operation' });
  assert.throws(() => groundTransactionOperation(outer, 'input'), { code: 'operation' });
  const stored = groundTransactionOperation(outer, 'stored');
  assert.deepEqual(stored, outer);
  const raw = receipt(outer);
  assert.deepEqual(checkedGroundTransactionReceipt(raw, outer.operationId), raw);
  for (const state of ['committed', 'pending']) {
    const row = intent(outer, state);
    assert.deepEqual(checkedGroundTransactionIntent(row, world, outer.operationId), row, state);
  }
});

test('a forged stored skill request is still refused inside a ground receipt or intent', async () => {
  const { old, fresh } = await requests();
  for (const source of [old, fresh]) for (const edit of [
    r => { r.profile.gold--; },
    r => { r.profile.progression.skills.lunge = 4; },
    r => { r.profile.progression.practice.trade = 1; },
    r => { r.ack.why = 'points'; },
    r => { r.ack.rev++; },
    r => { r.command.extra = true; },
    r => { r.command.tree = 'pirates'; },
  ]) {
    const forged = clone(source); edit(forged.request);
    // The result mirrors the forged ack so only the stored skill shape can refuse it.
    const outer = wrap(forged, 60);
    assert.equal(validStoredSkillRequest(forged.request), false, String(edit));
    assert.throws(() => checkedGroundTransactionReceipt(receipt(outer), outer.operationId), { code: 'response' }, String(edit));
    for (const state of ['committed', 'pending'])
      assert.throws(() => checkedGroundTransactionIntent(intent(outer, state), world, outer.operationId), { code: 'response' }, `${state}: ${edit}`);
  }
});

test('a fresh live-catalog skill request still passes the default input path', async () => {
  const { fresh } = await requests(), outer = wrap(fresh, 70);
  assert.deepEqual(groundTransactionOperation(outer), outer);
  assert.deepEqual(groundTransactionOperation(outer, 'stored'), outer);
  const raw = receipt(outer);
  assert.deepEqual(checkedGroundTransactionReceipt(raw, outer.operationId), raw);
  const row = intent(outer, 'committed');
  assert.deepEqual(checkedGroundTransactionIntent(row, world, outer.operationId), row);
});
