import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAssetRegistry, AssetRegistryError } from '../server/web3/assetRegistry.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:coral', GENERATION = id(1), OWNER = id(2), BUYER = id(3), OTHER = id(4);
const hash = (digit) => digit.repeat(64);
const register = (n, assetClass = 'equipment', sourceKey = `source:${n}`) => ({
  operationId: id(100 + n), action: 'register', assetId: id(200 + n), worldId: WORLD,
  worldGeneration: GENERATION, assetClass, sourceKey, contentId: `content:${n}`,
  contentHash: hash('a'), rightsHash: hash('b'), to: OWNER,
});
const transfer = (n, assetId, from = OWNER, to = BUYER, expectedVersion = 1) => ({
  operationId: id(300 + n), action: 'transfer', assetId, worldId: WORLD,
  worldGeneration: GENERATION, from, to, expectedVersion,
});

test('memory W01 registers equipment and plots, then transfers each asset once', async (t) => {
  const registry = createMemoryAssetRegistry();
  assert.equal(registry.kind, 'memory'); assert.equal(registry.durable, false);
  for (const [n, cls] of [[1, 'equipment'], [2, 'plot']]) await t.test(cls, async () => {
    const request = register(n, cls), prepared = await registry.prepare(request);
    assert.deepEqual(prepared, { ok: true, replay: false, operation: {
      operationId: request.operationId, request, state: 'pending', result: null,
    } });
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: OWNER, version: 1 }),
      { ok: false, why: 'busy' });
    const receipt = await registry.commit(request.operationId);
    assert.deepEqual(receipt, { ok: true, replay: false, asset: {
      assetId: request.assetId, worldId: WORLD, worldGeneration: GENERATION, assetClass: cls,
      sourceKey: request.sourceKey, contentId: request.contentId, contentHash: hash('a'),
      rightsHash: hash('b'), ownerId: OWNER, version: 1,
    } });
    const moved = transfer(n, request.assetId);
    assert.equal((await registry.prepare(moved)).ok, true);
    const after = await registry.commit(moved.operationId);
    assert.equal(after.asset.ownerId, BUYER); assert.equal(after.asset.version, 2);
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: OWNER, version: 1 }),
      { ok: false, why: 'ownership' });
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: BUYER, version: 2 }), { ok: true });
    assert.deepEqual(await registry.checkClaim({ assetId: request.assetId, ownerId: BUYER, version: 1 }),
      { ok: false, why: 'conflict' });
  });
});

test('memory replay keeps terminal receipts historical after later ownership changes', async () => {
  const registry = createMemoryAssetRegistry(), first = register(10);
  await registry.prepare(first); await registry.commit(first.operationId);
  const move1 = transfer(10, first.assetId); await registry.prepare(move1);
  const receipt2 = await registry.commit(move1.operationId);
  const move2 = transfer(11, first.assetId, BUYER, OTHER, 2); await registry.prepare(move2);
  const receipt3 = await registry.commit(move2.operationId);
  assert.equal(receipt3.asset.ownerId, OTHER); assert.equal(receipt3.asset.version, 3);
  assert.deepEqual(await registry.prepare(move1), { ok: true, replay: true, operation: {
    operationId: move1.operationId, request: move1, state: 'committed',
    result: { ok: true, asset: receipt2.asset },
  } });
  assert.deepEqual(await registry.commit(move1.operationId), { ok: true, replay: true, asset: receipt2.asset });
  assert.deepEqual(await registry.loadAsset(first.assetId), receipt3.asset);
});

test('memory prepares reserve an asset and its origin for one buyer at a time', async () => {
  const registry = createMemoryAssetRegistry(), first = register(20);
  await registry.prepare(first); await registry.commit(first.operationId);
  const buyerA = transfer(20, first.assetId), buyerB = transfer(21, first.assetId, OWNER, OTHER, 1);
  assert.equal((await registry.prepare(buyerA)).ok, true);
  assert.deepEqual(await registry.prepare(buyerB), { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.checkClaim({ assetId: first.assetId, ownerId: OTHER, version: 1 }),
    { ok: false, why: 'busy' });
  assert.deepEqual(await registry.prepare({ ...register(22), sourceKey: first.sourceKey }),
    { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.loadAsset(first.assetId), {
    assetId: first.assetId, worldId: WORLD, worldGeneration: GENERATION, assetClass: 'equipment',
    sourceKey: first.sourceKey, contentId: first.contentId, contentHash: hash('a'), rightsHash: hash('b'),
    ownerId: OWNER, version: 1,
  });
});

test('memory register reservations take priority over asset and source duplicates', async () => {
  const registry = createMemoryAssetRegistry(), first = register(25);
  assert.equal((await registry.prepare(first)).ok, true);
  assert.deepEqual(await registry.prepare({ ...register(26), assetId: first.assetId }),
    { ok: false, replay: false, why: 'busy' });
  assert.deepEqual(await registry.prepare({ ...register(27), sourceKey: first.sourceKey }),
    { ok: false, replay: false, why: 'busy' });
});

test('memory rejects reused asset/source identity and preserves ownership', async () => {
  const registry = createMemoryAssetRegistry(), first = register(30);
  await registry.prepare(first); await registry.commit(first.operationId);
  assert.deepEqual(await registry.prepare({ ...register(31), operationId: first.operationId }),
    { ok: false, replay: false, why: 'operation' });
  assert.deepEqual(await registry.prepare({ ...register(31), assetId: first.assetId }),
    { ok: false, replay: false, why: 'conflict' });
  assert.deepEqual(await registry.prepare({ ...register(32), sourceKey: first.sourceKey }),
    { ok: false, replay: false, why: 'identity' });
  for (const bad of [
    transfer(32, first.assetId, OTHER, BUYER, 1),
    transfer(33, first.assetId, OWNER, BUYER, 2),
    { ...transfer(34, first.assetId), worldId: 'elsewhere' },
    { ...transfer(35, first.assetId), worldGeneration: id(99) },
    transfer(36, id(999), OWNER, BUYER, 1),
  ]) assert.equal((await registry.prepare(bad)).ok, false);
  assert.equal((await registry.loadAsset(first.assetId)).ownerId, OWNER);
  assert.equal((await registry.loadAsset(first.assetId)).version, 1);
});

test('memory cancellation releases reservations and missing operations stay explicit', async () => {
  const registry = createMemoryAssetRegistry(), first = register(40);
  await registry.prepare(first);
  assert.deepEqual(await registry.cancel(first.operationId), { ok: false, why: 'cancelled', replay: false });
  assert.equal((await registry.loadOperation(first.operationId)).state, 'cancelled');
  assert.deepEqual(await registry.commit(first.operationId), { ok: false, replay: true, why: 'cancelled' });
  assert.deepEqual(await registry.cancel(id(9999)), { ok: false, replay: false, why: 'missing' });
  assert.deepEqual(await registry.listPending(WORLD, GENERATION), []);
  const next = { ...register(41), assetId: first.assetId, sourceKey: first.sourceKey };
  assert.equal((await registry.prepare(next)).ok, true);
});

test('memory pending pages are world-scoped, ordered, and exclusive of the cursor', async () => {
  const registry = createMemoryAssetRegistry();
  const first = register(42), second = register(43), elsewhere = { ...register(44), worldId: 'world:other' };
  await registry.prepare(second); await registry.prepare(elsewhere); await registry.prepare(first);
  const page = await registry.listPending(WORLD, GENERATION, { limit: 1 });
  assert.deepEqual(page.map((operation) => operation.operationId), [first.operationId]);
  const next = await registry.listPending(WORLD, GENERATION, { afterId: page[0].operationId, limit: 2 });
  assert.deepEqual(next.map((operation) => operation.operationId), [second.operationId]);
});

test('memory rejects strict-contract malformed requests and read arguments', async () => {
  const registry = createMemoryAssetRegistry(), valid = register(50);
  const malformed = [
    { ...valid, extra: 1 }, { ...valid, worldGeneration: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
    { ...valid, contentHash: hash('A') }, { ...valid, rightsHash: null },
    { ...valid, worldId: 'bad space' }, { ...valid, sourceKey: 'x'.repeat(161) },
    { ...valid, contentId: null }, { ...valid, to: '00000000-0000-0000-0000-000000000000' },
    { ...valid, worldGeneration: 0 },
    { ...transfer(51, valid.assetId), expectedVersion: 0 },
    { ...transfer(53, valid.assetId), expectedVersion: 1.5 },
    { ...transfer(54, valid.assetId), expectedVersion: '1' },
    { ...transfer(52, valid.assetId), to: OWNER },
  ];
  for (const request of malformed) await assert.rejects(registry.prepare(request),
    (error) => error instanceof AssetRegistryError && error.code === 'input');
  await assert.rejects(registry.listPending(WORLD, GENERATION, { limit: 0 }),
    (error) => error instanceof AssetRegistryError && error.code === 'input');
  assert.equal(await registry.loadAsset(valid.assetId), null);
});
