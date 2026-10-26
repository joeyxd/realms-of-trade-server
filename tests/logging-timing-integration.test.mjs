import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedResourceState, draftResource, upgradeTimingState } from '../server/resourceState.mjs';
import { loggingWorldTransition } from '../server/loggingOperation.mjs';
import { createLoggingChallenge } from '../src/sim/systems/loggingTiming.js';
import { C } from '../src/sim/ecs.js';
import { newProfile } from '../src/sim/systems/inventory.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const palm = () => ({ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 });
function fixture(raw = { v: 1, tick: 100, nodes: [palm()], cooldowns: {} }) {
  const vector = () => new Float64Array(3);
  const world = { tick: 100, economy: { stable: true }, map: { groundAt: () => 2, onDock: () => false },
    raftDeck: { surface: () => null }, ecs: { alive: new Uint8Array(3), dead: vector(), mask: new Uint16Array(3),
      hp: vector(), x: vector(), y: vector(), z: vector(), moveMag: vector(), vx: vector(), vz: vector(),
      dashT: new Float64Array(3).fill(-1), dashBuffer: vector(), castK: vector(), castLock: vector(),
      atkStage: vector(), regenT: new Float64Array(3).fill(100) }, profiles: new Map(), profileDirty: new Set(),
    resources: { nodes: new Map([['palm-1', { ...palm(), x: 0, y: 2, z: 0, readyTick: 0 }]]),
      cooldowns: new Map(), receipts: new Map(), bench: null } };
  world.ecs.alive[1] = 1; world.ecs.mask[1] = C.PLAYER; world.ecs.hp[1] = 100;
  world.ecs.x[1] = world.ecs.z[1] = 0; world.ecs.y[1] = 2;
  const profile = newProfile(); profile.tools.axe = 1;
  world.profiles.set(1, profile);
  return { world, profile: structuredClone(profile), state: upgradeTimingState(raw) };
}

test('timing upgrade creates v3 ledgers and keeps legacy partial trees uncredited', () => {
  const source = { v: 2, tick: 100, nodes: [palm()], cooldowns: {}, logging: { 'palm-1': { cycle: 1, contributors: [] } } };
  const upgraded = upgradeTimingState(source);
  assert.equal(upgraded.v, 3);
  assert.deepEqual(upgraded.logging['palm-1'], { cycle: 1, contributors: [], quality: 0 });
  const partial = upgradeTimingState({ ...source, nodes: [{ ...palm(), rev: 2, hits: 1 }],
    logging: { 'palm-1': null } });
  assert.equal(partial.logging['palm-1'], null);
  assert.deepEqual(checkedResourceState(upgraded), upgraded);
  const bad = structuredClone(upgraded); bad.logging['palm-1'].quality = 1;
  assert.throws(() => checkedResourceState(bad), { code: 'world_format' }, 'quality cannot exceed hit count');
});

test('v3 authoritative proof accumulates perfect quality and determines three-to-six log yield', () => {
  const f = fixture(), before = structuredClone(f.state), profileBefore = structuredClone(f.profile);
  let state = f.state, profile = f.profile, tick = 100, operation = 0;
  const qualities = [1, 0, 1];
  for (const quality of qualities) {
    const row = state.nodes[0];
    const challenge = createLoggingChallenge({ node: row.id, rev: row.rev, startTick: tick - 45, practice: 0 });
    const receivedTick = tick + (quality ? 0 : 6);
    const timing = { challenge, receivedTick, quality };
    const command = { type: 'resource', op: 'gather', opId: `timed-${++operation}`, node: row.id,
      expectedRev: row.rev, challenge: `challenge-${operation}` };
    const proposal = draftResource(f.world, 1, command, profile, state, A, receivedTick, new Map([[A, profile]]), timing);
    assert.equal(proposal.ack.ok, true, proposal.ack.why);
    assert.equal(proposal.ack.timing.quality, quality);
    assert.equal(proposal.ack.count, row.hits === 2 ? 5 : 0);
    const request = { command, ack: proposal.ack, account: A, beneficiaries: [{ account: A,
      expectedVersion: operation, before: profile, profile: proposal.profile }], worldData: { resources: proposal.resources } };
    assert.equal(loggingWorldTransition(state, request), true);
    state = proposal.resources; profile = proposal.profile;
    Object.assign(f.world.resources.nodes.get('palm-1'), proposal.resourceRuntime.nodes.get('palm-1'));
    f.world.tick = receivedTick + proposal.ack.actionTicks; tick = f.world.tick;
  }
  assert.equal(state.logging['palm-1'].quality, 2);
  assert.equal(profile.eco.pack.goods.tronco, 5);
  assert.equal(profile.progression.practice.logging, 10);
  assert.equal(before.nodes[0].hits, 0, 'input state stays detached');
  assert.equal(profileBefore.eco.pack.goods.tronco, undefined);
});

test('v3 palm hits require an authoritative proof and reject forged quality', () => {
  const f = fixture(), command = { type: 'resource', op: 'gather', opId: 'no-proof', node: 'palm-1', expectedRev: 1,
    challenge: 'challenge-1' };
  const missing = draftResource(f.world, 1, command, f.profile, f.state, A, 100, new Map([[A, f.profile]]));
  assert.equal(missing.ack.ok, false);
  assert.equal(missing.ack.why, 'timing');
  const challenge = createLoggingChallenge({ node: 'palm-1', rev: 1, startTick: 55, practice: 0 });
  const forged = draftResource(f.world, 1, command, f.profile, f.state, A, 100,
    new Map([[A, f.profile]]), { challenge, receivedTick: 100, quality: 0 });
  assert.equal(forged.ack.ok, false);
  assert.equal(forged.ack.why, 'timing');
});

