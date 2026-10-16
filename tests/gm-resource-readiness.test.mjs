import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../server/store.mjs';

function adapter({ ready = 1, answers = [false, false, true], failure = null } = {}) {
  const calls = [];
  const store = createSupabaseStore({ async rpc(name, args) {
    calls.push({ name, args });
    if (failure && name === failure.name) throw new Error(failure.message);
    if (name === 'mn_gm_resource_roster_ready') return { data: { version: ready }, error: null };
    if (name === 'mn_valid_resource_state_v1') return { data: answers.shift(), error: null };
    throw new Error(`unexpected RPC ${name}`);
  } });
  return { store, calls };
}

test('GM roster readiness probes the deployed validator semantics and exact resource shapes', async () => {
  const f = adapter();
  assert.deepEqual(await f.store.checkGmResourceRoster(), { version: 1 });
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls[0], { name: 'mn_gm_resource_roster_ready', args: {} });
  assert.deepEqual(f.calls.slice(1).map(call => call.name), Array(3).fill('mn_valid_resource_state_v1'));
  assert.deepEqual(f.calls.slice(1).map(call => Object.keys(call.args)), Array(3).fill(['p_resources']));
  const states = f.calls.slice(1).map(call => call.args.p_resources);
  assert.deepEqual(states[0], { v: 1, tick: 0,
    nodes: [{ id: `gm_${'a'.repeat(32)}`, kind: 'stone', rev: 2, hits: 1, readyAt: 0 }], cooldowns: {} });
  assert.deepEqual(states[1], { v: 1, tick: 0,
    nodes: [{ id: 'gm_bad', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} });
  assert.deepEqual(states[2], { v: 1, tick: 0, cooldowns: {}, nodes: Array.from({ length: 1024 }, (_, i) => ({
    id: `gm_${i.toString(16).padStart(32, '0')}`, kind: 'stone', rev: 1, hits: 0, readyAt: 0,
  })) });
});

test('stale readiness cannot hide invalid validator behavior, while unavailable roster skips probes', async () => {
  for (const [answers, expectedCalls] of [[[true, false, true], 2], [[false, false, false], 4]]) {
    const f = adapter({ answers });
    assert.deepEqual(await f.store.checkGmResourceRoster(), { version: 0 });
    assert.equal(f.calls.length, expectedCalls);
  }
  const absent = adapter({ ready: 0 });
  assert.deepEqual(await absent.store.checkGmResourceRoster(), { version: 0 });
  assert.deepEqual(absent.calls, [{ name: 'mn_gm_resource_roster_ready', args: {} }]);
});

test('roster readiness continues to redact and propagate validator RPC failures', async () => {
  const f = adapter({ failure: { name: 'mn_valid_resource_state_v1', message: 'provider secret' } });
  await assert.rejects(f.store.checkGmResourceRoster(), error => error.code === 'unavailable'
    && !error.message.includes('provider secret'));
});
