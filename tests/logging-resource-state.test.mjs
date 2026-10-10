import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedResourceState, draftResource, loggingAccounts, upgradeLoggingState } from '../server/resourceState.mjs';
import { HARVEST } from '../src/data/resources.js';
import { C } from '../src/sim/ecs.js';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const palm = (rev = 1, hits = 0, readyAt = 0) => ({ id: 'palm-1', kind: 'palm', rev, hits, readyAt });
const legacy = (node = palm()) => ({ v: 1, tick: 10, nodes: [node], cooldowns: {} });
function draftWorld() {
  const vector = () => new Float64Array(3);
  const w = { tick: 100, economy: { stable: true }, events: [], emit(ev) { this.events.push(ev); },
    map: { groundAt: () => 2, onDock: () => false }, raftDeck: { surface: () => null },
    ecs: { alive: new Uint8Array(3), dead: vector(), mask: new Uint16Array(3), hp: vector(), x: vector(), y: vector(), z: vector(),
      moveMag: vector(), vx: vector(), vz: vector(), dashT: new Float64Array(3).fill(-1), dashBuffer: vector(),
      castK: vector(), castLock: vector(), atkStage: vector(), regenT: new Float64Array(3).fill(100) },
    profiles: new Map(), profileDirty: new Set(),
    resources: { nodes: new Map([['palm-1', { ...palm(), x: 0, y: 2, z: 0, readyTick: 0 }]]),
      cooldowns: new Map(), receipts: new Map(), bench: null } };
  for (const entity of [1, 2]) {
    w.ecs.alive[entity] = 1; w.ecs.mask[entity] = C.PLAYER; w.ecs.hp[entity] = 100;
    w.ecs.x[entity] = w.ecs.z[entity] = 0; w.ecs.y[entity] = 2;
    const p = newProfile(); p.tools.axe = 1; p.eco.pack = { cap: 100, goods: {} };
    w.profiles.set(entity, p);
  }
  return w;
}

test('v1 upgrade keeps clean cycles, quarantines every legacy hit, and rejects impossible history', () => {
  assert.deepEqual(upgradeLoggingState(legacy()).logging['palm-1'], { cycle: 1, contributors: [] });
  assert.equal(upgradeLoggingState(legacy(palm(2, 1))).logging['palm-1'], null);
  assert.equal(upgradeLoggingState(legacy(palm(4, 3, 20))).logging['palm-1'], null);
  assert.throws(() => upgradeLoggingState(legacy(palm(2, 0))), { code: 'world_format' });
  assert.throws(() => upgradeLoggingState(legacy(palm(4, 2))), { code: 'world_format' });
  assert.throws(() => upgradeLoggingState(legacy(palm(1, 3))), { code: 'world_format' });
  assert.throws(() => upgradeLoggingState(legacy(palm(4, 3, 0))), { code: 'world_format' });
  assert.throws(() => upgradeLoggingState(legacy(palm(2, 1, 20))), { code: 'world_format' });
});

test('unknown legacy provenance cannot bypass the respawn deadline or invent a clean cycle', () => {
  const valid = upgradeLoggingState(legacy(palm(4, 3, 20)));
  for (const node of [palm(4, 3, 0), palm(1, 0), palm(1, 3, 20), palm(2, 1, 20), palm(4, 2)]) {
    const bad = { ...valid, nodes: [node] };
    assert.throws(() => checkedResourceState(bad), { code: 'world_format' });
    assert.throws(() => loggingAccounts(bad, { op: 'gather', node: node.id, expectedRev: node.rev }, A, 21),
      { code: 'world_format' });
  }
});

test('v2 ledger is strict, canonical, and conserves node revision and hit history', () => {
  const v2 = upgradeLoggingState(legacy());
  v2.nodes[0] = palm(3, 2);
  v2.logging['palm-1'] = { cycle: 1, contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
  assert.deepEqual(checkedResourceState(v2), v2);
  for (const mutate of [
    s => { s.logging['palm-1'].contributors.reverse(); },
    s => { s.logging['palm-1'].contributors[1].hits = 2; },
    s => { s.nodes[0].rev = 4; },
    s => { s.logging.extra = null; },
  ]) {
    const bad = structuredClone(v2); mutate(bad);
    assert.throws(() => checkedResourceState(bad), { code: 'world_format' });
  }
});

test('offline completion accounts include current contributors, while expired legacy cycles start fresh', () => {
  const v2 = upgradeLoggingState(legacy());
  v2.nodes[0] = palm(3, 2);
  v2.logging['palm-1'] = { cycle: 1, contributors: [{ actor: A, hits: 1 }, { actor: B, hits: 1 }] };
  assert.deepEqual(loggingAccounts(v2, { op: 'gather', node: 'palm-1', expectedRev: 3 }, A, 30), [A, B]);
  const stale = upgradeLoggingState(legacy(palm(4, 3, 20)));
  assert.deepEqual(loggingAccounts(stale, { op: 'gather', node: 'palm-1', expectedRev: 4 }, A, 20), []);
  assert.deepEqual(loggingAccounts(stale, { op: 'gather', node: 'palm-1', expectedRev: 4 }, A, 19), []);
});

test('legacy partial cycle earns nothing; a fresh cooperative cycle credits only current contributors', () => {
  const world = draftWorld(), accounts = [A, B], profiles = new Map(accounts.map((id, i) => [id, structuredClone(world.profiles.get(i + 1))]));
  let state = upgradeLoggingState(legacy(palm(2, 1))), tick = 100;
  world.resources.nodes.set('palm-1', { ...world.resources.nodes.get('palm-1'), rev: 2, hits: 1 });
  const hit = (entity, opId) => {
    world.tick = tick;
    const account = accounts[entity - 1];
    const proposal = draftResource(world, entity, { type: 'resource', op: 'gather', opId, node: 'palm-1',
      expectedRev: world.resources.nodes.get('palm-1').rev }, profiles.get(account), state, account, tick, profiles);
    assert.equal(proposal.ack.ok, true, `${opId}: ${proposal.ack.why}`);
    for (const [id, value] of proposal.profiles) profiles.set(id, value);
    state = proposal.resources;
    Object.assign(world.resources.nodes.get('palm-1'), proposal.resourceRuntime.nodes.get('palm-1'));
    world.resources.cooldowns.set(entity, proposal.resourceRuntime.cooldown);
    tick += proposal.ack.actionTicks;
    return proposal;
  };
  assert.equal(hit(1, 'legacy-two').loggingAwards.length, 0);
  const legacyFinish = hit(2, 'legacy-three');
  assert.equal(legacyFinish.loggingAwards.length, 0);
  assert.equal(state.logging['palm-1'], null);
  tick = state.nodes[0].readyAt;
  world.tick = tick;
  hit(1, 'fresh-one');
  hit(2, 'fresh-two');
  const before = structuredClone(profiles);
  const freshFinish = hit(1, 'fresh-three');
  assert.deepEqual(freshFinish.loggingAwards.map(a => a.actor), [A, B]);
  assert.equal(freshFinish.profiles.get(A).progression.practice.logging, 7);
  assert.equal(freshFinish.profiles.get(B).progression.practice.logging, 3);
  assert.equal(before.get(A).progression.practice.logging, 0, 'proposal leaves supplied profiles untouched');
  assert.equal(freshFinish.ack.loggingStatus.practice, 0, 'ack reports the finisher before the award');
  assert.equal(freshFinish.ack.actionTicks, HARVEST.chopTicks);
});

test('normal completed cycles reset contributors after respawn and logging cadence applies after award', () => {
  const world = draftWorld(), profile = structuredClone(world.profiles.get(1));
  const profiles = new Map([[A, profile]]);
  let state = upgradeLoggingState(legacy()), tick = 100, op = 0;
  for (let practice = 0; practice < 60; practice += 10) {
    for (let hitNo = 0; hitNo < HARVEST.palmHits; hitNo++) {
      tick = Math.max(tick, state.nodes[0].readyAt);
      world.tick = tick;
      const proposal = draftResource(world, 1, { type: 'resource', op: 'gather', opId: `cycle-${++op}`,
        node: 'palm-1', expectedRev: world.resources.nodes.get('palm-1').rev }, profiles.get(A), state, A, tick, profiles);
      assert.equal(proposal.ack.ok, true, proposal.ack.why);
      for (const [id, value] of proposal.profiles) profiles.set(id, value);
      state = proposal.resources;
      Object.assign(world.resources.nodes.get('palm-1'), proposal.resourceRuntime.nodes.get('palm-1'));
      world.resources.cooldowns.set(1, proposal.resourceRuntime.cooldown);
      if (hitNo === HARVEST.palmHits - 1) {
        assert.equal(proposal.loggingAwards[0].credited, 10);
        assert.equal(proposal.ack.loggingStatus.practice, practice);
        assert.equal(proposal.ack.actionTicks, HARVEST.chopTicks);
      }
      tick += proposal.ack.actionTicks;
    }
  }
  assert.equal(profiles.get(A).progression.practice.logging, 60);
  assert.equal(state.logging['palm-1'].cycle, 6);
  assert.deepEqual(state.logging['palm-1'].contributors, [{ actor: A, hits: 3 }]);
  tick = Math.max(tick, state.nodes[0].readyAt);
  world.tick = tick;
  const next = draftResource(world, 1, { type: 'resource', op: 'gather', opId: `cycle-${++op}`,
    node: 'palm-1', expectedRev: world.resources.nodes.get('palm-1').rev }, profiles.get(A), state, A, tick, profiles);
  assert.equal(next.ack.ok, true, next.ack.why);
  assert.equal(next.ack.loggingStatus.practice, 60);
  assert.equal(next.ack.actionTicks, 45);
  assert.deepEqual(next.resources.logging['palm-1'].contributors, [{ actor: A, hits: 1 }]);
});
