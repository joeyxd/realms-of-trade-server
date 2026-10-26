import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, itemStats, rollItem } from '../src/sim/items.js';
import { BASES, RARITIES } from '../src/data/items.js';
import { mulberry32 } from '../src/core/rng.js';
import { equipmentContentFor, equipmentContentHash, equipmentDefinition, equipmentRegistration,
  equipmentStats } from '../server/web3/equipmentContent.mjs';
import { AssetRegistryError, createMemoryAssetRegistry } from '../server/web3/assetRegistry.mjs';

const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:coral', GENERATION = id(1), OWNER = id(2), BUYER = id(3);
const HASH = 'a'.repeat(64), RIGHTS = 'b'.repeat(64);
const appearance = (baseId = 'sable') => ({
  v: 1, mode: 'appearance', baseId, appearanceId: 'skin:storm', appearanceHash: HASH,
});
const functional = (item = { b: 'sable', r: 1, l: 1, a: [['atk', 1.23]] }) => ({
  v: 1, mode: 'functional', item,
});
const failsInput = (fn) => assert.throws(fn, (error) => error instanceof AssetRegistryError && error.code === 'input');
const failsResponse = (fn) => assert.throws(fn, (error) => error instanceof AssetRegistryError && error.code === 'response');

test('appearance definitions are exact, known-base licenses with zero gameplay stats', () => {
  const raw = appearance();
  const definition = equipmentDefinition(raw);
  assert.deepEqual(definition, raw);
  assert.deepEqual(equipmentStats(raw), emptyStats());

  for (const bad of [
    { ...raw, atk: 100 },
    { ...raw, stats: { atk: 100 } },
    { ...raw, affixes: [['atk', 100]] },
    { ...raw, effects: ['damage'] },
    { ...raw, item: { b: 'sable', r: 4, l: 15, a: [] } },
    { ...raw, baseId: 'toString' },
    { ...raw, appearanceHash: 'A'.repeat(64) },
    { ...raw, appearanceHash: 'f'.repeat(63) },
    { ...raw, v: '1' },
  ]) failsInput(() => equipmentDefinition(bad));
});

test('functional definitions preserve rollItem/itemStats for every slot base and rarity', () => {
  for (const [baseIndex, [base, baseDefinition]] of Object.entries(BASES).entries()) {
    for (const rarity of RARITIES.keys()) for (const requestedLevel of [1, 7, 15]) {
      // Bases introduced after level 1 start at their configured minimum.
      const level = Math.max(requestedLevel, baseDefinition.min);
      const rolled = rollItem(mulberry32(baseIndex * 10000 + rarity * 100 + level),
        { base, lvl: level, rarity, uid: 987 });
      const content = functional({ b: rolled.b, r: rolled.r, l: rolled.l, a: rolled.a });
      const definition = equipmentDefinition(content);
      const label = `${base} rarity ${rarity} level ${level}`;
      assert.deepEqual(definition, content, label);
      assert.deepEqual(equipmentStats(content), itemStats(rolled), label);
    }
  }
});

test('functional content rejects coercion, normalization, local identity, starter flags, and prototype bases', () => {
  const valid = functional();
  const mutations = [
    { ...valid, v: '1' },
    { ...valid, extra: true },
    functional({ ...valid.item, u: 9 }),
    functional({ ...valid.item, s: 1 }),
    functional({ ...valid.item, r: '1' }),
    functional({ ...valid.item, r: -1 }),
    functional({ ...valid.item, r: RARITIES.length }),
    functional({ ...valid.item, l: 1.5 }),
    functional({ ...valid.item, l: 0 }),
    functional({ ...valid.item, l: 16 }),
    functional({ ...valid.item, a: [['atk', 1.234]] }), // sanitizeItem would round this.
    functional({ ...valid.item, a: [['atk', 2]] }), // sanitizeItem would clamp this to the roll limit.
    functional({ ...valid.item, b: 'toString' }),
    functional({ ...valid.item, b: 'constructor' }),
    functional({ ...valid.item, b: '__proto__' }),
  ];
  for (const bad of mutations) failsInput(() => equipmentDefinition(bad));

  const inherited = Object.assign(Object.create({ inherited: true }), valid);
  failsInput(() => equipmentDefinition(inherited));
  const inheritedItem = Object.assign(Object.create({ inherited: true }), valid.item);
  failsInput(() => equipmentDefinition(functional(inheritedItem)));
});

test('functional affixes must be unique, slot-legal, finite, and within their unmodified budget', () => {
  const invalid = [
    functional({ b: 'sable', r: 2, l: 1, a: [['atk', 1], ['atk', 1]] }),
    functional({ b: 'panuelo', r: 1, l: 1, a: [['atk', 1]] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', Number.NaN]] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', Number.POSITIVE_INFINITY]] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', '1']] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', -0.01]] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', 1.821]] }),
    functional({ b: 'sable', r: 0, l: 1, a: [['atk', 1]] }), // common permits no affixes.
    functional({ b: 'sable', r: 1, l: 1, a: [['atk', 1, 'extra']] }),
    functional({ b: 'sable', r: 1, l: 1, a: [['unknown', 1]] }),
  ];
  for (const bad of invalid) failsInput(() => equipmentDefinition(bad));
});

test('functional affix arrays must be plain, dense, and free of extra own keys', () => {
  const sparseAffixes = new Array(1);
  const sparseTuple = ['atk', 1];
  delete sparseTuple[1];
  const keyedAffixes = [['atk', 1]];
  keyedAffixes.extra = true;
  const symbolAffixes = [['atk', 1]];
  symbolAffixes[Symbol('extra')] = true;
  const keyedTuple = ['atk', 1];
  keyedTuple.extra = true;
  const symbolTuple = ['atk', 1];
  symbolTuple[Symbol('extra')] = true;
  class AffixTuple extends Array {}
  const subclassTuple = new AffixTuple();
  subclassTuple.push('atk', 1);

  for (const affixes of [sparseAffixes, [sparseTuple], keyedAffixes, symbolAffixes,
    [keyedTuple], [symbolTuple], [subclassTuple]]) {
    failsInput(() => equipmentDefinition(functional({ b: 'sable', r: 1, l: 1, a: affixes })));
  }
});

test('content hashes are canonical and returned definitions do not alias caller objects', () => {
  const first = functional({ b: 'sable', r: 2, l: 7, a: [['atk', 3.21], ['crit', 0.04]] });
  const reordered = { item: { a: first.item.a.map((x) => [...x]), l: 7, r: 2, b: 'sable' }, mode: 'functional', v: 1 };
  assert.equal(equipmentContentHash(first), equipmentContentHash(reordered));
  assert.notEqual(equipmentContentHash(first), equipmentContentHash(functional({ ...first.item, l: 8 })));

  const definition = equipmentDefinition(first);
  assert.notEqual(definition, first);
  assert.notEqual(definition.item, first.item);
  assert.notEqual(definition.item.a, first.item.a);
  assert.notEqual(definition.item.a[0], first.item.a[0]);
  first.item.a[0][1] = 99;
  assert.deepEqual(definition.item.a[0], ['atk', 3.21]);
});

test('equipmentRegistration creates the exact W01 register DTO and binds the content hash', () => {
  const raw = {
    operationId: id(10), assetId: id(11), worldId: WORLD, worldGeneration: GENERATION,
    sourceKey: 'drop:source:1', contentId: 'content:equipment:1', rightsHash: RIGHTS, to: OWNER,
  };
  const request = equipmentRegistration(raw, functional());
  assert.deepEqual(request, {
    ...raw, action: 'register', assetClass: 'equipment', contentHash: equipmentContentHash(functional()),
  });
  failsInput(() => equipmentRegistration({ ...raw, unexpected: true }, functional()));
});

test('equipmentContentFor rejects class/hash mismatches and malformed asset responses', () => {
  const content = appearance();
  const request = equipmentRegistration({
    operationId: id(20), assetId: id(21), worldId: WORLD, worldGeneration: GENERATION,
    sourceKey: 'drop:source:2', contentId: 'content:appearance:1', rightsHash: RIGHTS, to: OWNER,
  }, content);
  const asset = {
    assetId: request.assetId, worldId: WORLD, worldGeneration: GENERATION, assetClass: 'equipment',
    sourceKey: request.sourceKey, contentId: request.contentId, contentHash: request.contentHash,
    rightsHash: RIGHTS, ownerId: OWNER, version: 1,
  };
  assert.deepEqual(equipmentContentFor(asset, content), equipmentDefinition(content));
  failsResponse(() => equipmentContentFor({ ...asset, assetClass: 'plot' }, content));
  failsResponse(() => equipmentContentFor({ ...asset, contentHash: 'c'.repeat(64) }, content));
  failsResponse(() => equipmentContentFor(asset, { ...content, appearanceHash: 'c'.repeat(64) }));
  failsResponse(() => equipmentContentFor({ ...asset, unexpected: true }, content));
});

test('memory W01 registers and transfers both equipment modes without changing their content', async (t) => {
  const registry = createMemoryAssetRegistry();
  const contents = [appearance('sable'), functional({ b: 'tricornio', r: 3, l: 9,
    a: [['def', 1.11], ['hp', 2.22], ['crit', 0.03]] })];
  for (const [index, content] of contents.entries()) await t.test(content.mode, async () => {
    const registration = equipmentRegistration({
      operationId: id(30 + index), assetId: id(40 + index), worldId: WORLD, worldGeneration: GENERATION,
      sourceKey: `loot:${index}`, contentId: `equipment:${index}`, rightsHash: RIGHTS, to: OWNER,
    }, content);
    const registered = await registry.prepare(registration);
    assert.equal(registered.ok, true);
    const created = await registry.commit(registration.operationId);
    assert.equal(created.asset.contentHash, equipmentContentHash(content));
    const initialDefinition = equipmentContentFor(created.asset, content);

    const movedRequest = {
      operationId: id(50 + index), action: 'transfer', assetId: registration.assetId, worldId: WORLD,
      worldGeneration: GENERATION, from: OWNER, to: BUYER, expectedVersion: 1,
    };
    assert.equal((await registry.prepare(movedRequest)).ok, true);
    const moved = await registry.commit(movedRequest.operationId);
    assert.equal(moved.asset.ownerId, BUYER);
    assert.equal(moved.asset.contentHash, created.asset.contentHash);
    assert.deepEqual(equipmentContentFor(moved.asset, content), initialDefinition);
    assert.deepEqual(equipmentContentFor(await registry.loadAsset(registration.assetId), initialDefinition), initialDefinition);
  });
});
