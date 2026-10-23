import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGmContentObstacles } from '../server/gmContentObstacles.mjs';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';

const WORLD = 'marea-negra';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const blankProfile = () => ({ eco: { ships: [] } });
const map = (colliders = [], checkpoints = { spawn: { x: 0, z: 0 } }) => ({ seed: 1, colliders, checkpoints });
const fixture = ({ profiles = [], ground = [], drops = [], fail = null } = {}) => {
  const calls = { profiles: 0, ground: 0, drops: 0 };
  return { calls, store: {
    async listGmContentProfiles({ after, limit }) {
      calls.profiles++;
      if (fail === 'profiles') throw new Error('private provider detail');
      return profiles.filter((r) => !after || r.accountId > after).slice(0, limit);
    },
    async listPearlGround(_world, { afterUid, limit }) {
      calls.ground++;
      if (fail === 'ground') throw new Error('private provider detail');
      return ground.filter((r) => !afterUid || r.uid > afterUid).slice(0, limit);
    },
    async listCurrentDeathDrops(_world, { after, limit }) {
      calls.drops++;
      if (fail === 'drops') throw new Error('private provider detail');
      return drops.filter((r) => !after || r.operationId > after.operationId ||
        (r.operationId === after.operationId && r.ordinal > after.ordinal)).slice(0, limit);
    },
  } };
};
const death = (n, x, z) => ({ operationId: uuid(n), ordinal: 1, world: WORLD, state: 'ground',
  ground: { x, z, availableAt: 0, expiresAt: 100 } });

test('checks all profile pages and rejects only newly added colliders over a persisted checkpoint or ground item', async () => {
  const profiles = Array.from({ length: 130 }, (_, i) => ({ accountId: uuid(i + 1), profile: i === 129 ? { ...blankProfile(), cp: 'spawn' } : blankProfile() }));
  const f = fixture({ profiles, ground: [{ uid: 'pearl-a', world: WORLD, ground: { x: 50, z: 50, availableAt: 0, returnAt: 100 } }] });
  const currentMap = map([{ x: 20, z: 20, r: 1 }]);
  const targetMap = map([{ x: 20, z: 20, r: 1 }, { x: 50, z: 50, r: 1 }]);
  await assert.rejects(validateGmContentObstacles({ store: f.store, map: { seed: 1 }, currentMap, targetMap, worldId: WORLD }),
    (error) => error.code === 'gm_content_occupied');
  assert.equal(f.calls.profiles, 2);
  assert.equal(f.calls.ground, 1);
  assert.equal(f.calls.drops, 1);
});

test('rejects a collider over an active profile checkpoint and a same-seed durable raft voyage', async () => {
  const profileFixture = fixture({ profiles: [{ accountId: uuid(1), profile: { ...blankProfile(), cp: 'spawn' } }] });
  await assert.rejects(validateGmContentObstacles({ store: profileFixture.store, map: { seed: 1 }, currentMap: map(),
    targetMap: map([{ x: 2, z: 0, r: 0.1 }]), worldId: WORLD }), (error) => error.code === 'gm_content_occupied');

  const raftProfile = { eco: { ships: [{ kind: 'raft', grid: { parts: [['foundation', 0, 0, 0, 0]] },
    voyage: { v: 1, seed: 1, pose: [0, 0, Math.PI / 4] } }] } };
  const raftFixture = fixture({ profiles: [{ accountId: uuid(3), profile: raftProfile }] });
  await assert.rejects(validateGmContentObstacles({ store: raftFixture.store, map: { seed: 1 }, currentMap: map(),
    targetMap: map([{ x: 0, z: 0, r: 0.25 }]), worldId: WORLD }), (error) => error.code === 'gm_content_occupied');
});

test('reserves all derived home berths for saved rafts and ignores voyages from another island seed', async () => {
  const dock = { base: { x: 100, z: 100 }, dir: { x: 0, z: 1 }, halfWidth: 10, len: 20 };
  const profile = { eco: { ships: [
    { kind: 'raft', at: 'aldea', grid: { parts: [['foundation', 0, 0, 0, 0]] } },
    { kind: 'raft', grid: { parts: [['foundation', 0, 0, 0, 0]] }, voyage: { v: 1, seed: 2, pose: [40, 40, 0] } },
  ] } };
  const f = fixture({ profiles: [{ accountId: uuid(4), profile }] });
  const baseMap = { ...map(), dock };
  await assert.rejects(validateGmContentObstacles({ store: f.store, map: { seed: 1, dock }, currentMap: baseMap,
    targetMap: { ...map([{ x: 87.85, z: 110, r: 0.2 }]), dock }, worldId: WORLD }),
  (error) => error.code === 'gm_content_occupied');
  const allowed = await validateGmContentObstacles({ store: f.store, map: { seed: 1, dock }, currentMap: baseMap,
    targetMap: { ...map([{ x: 40, z: 40, r: 0.2 }]), dock }, worldId: WORLD });
  assert.equal(allowed.ok, true);
});

test('checks current death-drop positions and allows an unchanged collider at a drop', async () => {
  const f = fixture({ drops: [death(2, 10, 10)] });
  const currentMap = map([{ x: 10, z: 10, r: 1 }]);
  const result = await validateGmContentObstacles({ store: f.store, map: { seed: 1 }, currentMap,
    targetMap: map([{ x: 10, z: 10, r: 1 }]), worldId: WORLD });
  assert.deepEqual(result, { ok: true, checked: { profiles: 0, ground: 0, deathDrops: 1 }, newColliders: 0 });
});

test('fails closed on missing APIs, read errors, malformed ordering and more than the bounded profile scan', async () => {
  const base = { map: { seed: 1 }, currentMap: map(), targetMap: map([{ x: 40, z: 40, r: 1 }]), worldId: WORLD };
  await assert.rejects(validateGmContentObstacles({ ...base, store: {} }), (error) => error.code === 'gm_content_unavailable');
  const broken = fixture({ fail: 'drops' });
  await assert.rejects(validateGmContentObstacles({ ...base, store: broken.store }), (error) => error.code === 'gm_content_unavailable');
  const duplicate = fixture({ profiles: [{ accountId: uuid(2), profile: blankProfile() }, { accountId: uuid(1), profile: blankProfile() }] });
  await assert.rejects(validateGmContentObstacles({ ...base, store: duplicate.store }), (error) => error.code === 'gm_content_unavailable');
  const excessive = fixture({ profiles: Array.from({ length: 4100 }, (_, i) => ({ accountId: uuid(i + 1), profile: blankProfile() })) });
  await assert.rejects(validateGmContentObstacles({ ...base, store: excessive.store }), (error) => error.code === 'gm_content_unavailable');
  const invalidVoyageProfile = { eco: { ships: [{ kind: 'raft', grid: { parts: [['foundation', 0, 0, 0, 0]] },
    voyage: { v: 1, seed: 1, pose: [0, 0] } }] } };
  const malformedVoyage = fixture({ profiles: [{ accountId: uuid(5), profile: invalidVoyageProfile }] });
  await assert.rejects(validateGmContentObstacles({ ...base, store: malformedVoyage.store }), (error) => error.code === 'gm_content_unavailable');
});

test('does not mutate the supplied store or world snapshots', async () => {
  let writes = 0;
  const f = fixture({ profiles: [{ accountId: uuid(1), profile: { ...blankProfile(), cp: 'spawn' } }] });
  const store = new Proxy(f.store, { get(target, key) { if (/^(save|commit|delete)/i.test(String(key))) return () => { writes++; }; return target[key]; } });
  const before = JSON.stringify({ current: map(), target: map([{ x: 30, z: 30, r: 1 }]) });
  await validateGmContentObstacles({ store, map: { seed: 1 }, currentMap: map(), targetMap: map([{ x: 30, z: 30, r: 1 }]), worldId: WORLD });
  assert.equal(writes, 0);
  assert.equal(JSON.stringify({ current: map(), target: map([{ x: 30, z: 30, r: 1 }]) }), before);
});

test('store profile scan is read-only, lowercase, ordered and cursor-bounded in memory and Supabase', async () => {
  const memory = createMemoryStore();
  await memory.initializeProfile(uuid(2).toUpperCase(), newProfile());
  await memory.initializeProfile(uuid(1), newProfile());
  assert.deepEqual((await memory.listGmContentProfiles({ limit: 1 })).map((r) => r.accountId), [uuid(1)]);
  assert.deepEqual((await memory.listGmContentProfiles({ after: uuid(1), limit: 1 })).map((r) => r.accountId), [uuid(2)]);

  const calls = [];
  const client = { rpc: async () => ({ data: null, error: null }), from(table) {
    const query = { table, after: null, selected: null, pageSize: null,
      select(value) { this.selected = value; return this; },
      gt(field, value) { calls.push(['gt', field, value]); this.after = value; return this; },
      order(field, options) { calls.push(['order', field, options.ascending]); return this; },
      limit(value) { this.pageSize = value; calls.push(['limit', value]); return this; },
      then(resolve) { const rows = [
        { player_id: uuid(1), data: newProfile() }, { player_id: uuid(2), data: newProfile() },
      ].filter((r) => !this.after || r.player_id > this.after).slice(0, this.pageSize);
        return Promise.resolve(resolve({ data: rows, error: null })); },
    };
    assert.equal(table, 'mn_profiles');
    return query;
  } };
  const supabase = createSupabaseStore(client);
  const page = await supabase.listGmContentProfiles({ limit: 1 });
  assert.equal(page[0].accountId, uuid(1));
  assert.deepEqual(calls, [['order', 'player_id', true], ['limit', 1]]);
  const next = await supabase.listGmContentProfiles({ after: uuid(1), limit: 1 });
  assert.equal(next[0].accountId, uuid(2));
  assert.deepEqual(calls.slice(2), [['gt', 'player_id', uuid(1)], ['order', 'player_id', true], ['limit', 1]]);
});
