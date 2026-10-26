import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContributionError, contributionCharacter, contributionDelta, contributionProject,
  contributionRequest,
} from '../server/community/contributionContract.mjs';
import { createMemoryContributionStore } from '../server/community/memoryContributionStore.mjs';

const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORLD = 'world:salty-shore', EPOCH = uuid(1), CHAR = uuid(2), PROJECT = 'salty:hall';

function character({ id = CHAR, worldId = WORLD, epoch = EPOCH, version = 1, goods = { madera: 7, piedra: 2 } } = {}) {
  return { worldId, worldEpoch: epoch, characterId: id, version, data: {
    v: 1, name: 'Nerea', gold: 321, flags: { tier: 3, nested: ['keep'] },
    eco: { tradeRev: 9, pack: { cap: 40, goods }, markets: { Aldea: { madera: 5 } } },
    raft: { id: 'raft-keep', cargo: { tronco: 4 } }, custom: { untouched: true },
  } };
}
function project({ id = PROJECT, worldId = WORLD, epoch = EPOCH, version = 1,
  requirements = { madera: 10 }, contributed = { madera: 2 } } = {}) {
  return { worldId, worldEpoch: epoch, projectId: id, version, requirements, contributed };
}
function request({ operationId = uuid(10), worldId = WORLD, epoch = EPOCH, id = CHAR, projectId = PROJECT,
  good = 'madera', amount = 4, charVersion = 1, projectVersion = 1 } = {}) {
  return { operationId, worldId, worldEpoch: epoch, characterId: id, projectId, good, amount,
    expectedCharacterVersion: charVersion, expectedProjectVersion: projectVersion };
}
function store({ characters = [character()], projects = [project()] } = {}) {
  return createMemoryContributionStore({ characters, projects });
}
const receiptOf = (result) => result.receipt ?? result;
const withoutReplay = (result) => {
  const copy = structuredClone(receiptOf(result));
  delete copy.replay;
  return copy;
};

test('contract accepts scoped snapshots and computes accepted quantity from project remainder', () => {
  const rawC = character({ goods: { madera: 10 } }), rawP = project(), rawR = request({ amount: 8 });
  assert.deepEqual(contributionCharacter(rawC), rawC);
  assert.deepEqual(contributionProject(rawP), rawP);
  assert.deepEqual(contributionRequest(rawR), rawR);
  const delta = contributionDelta(rawR, rawC, rawP);
  assert.equal(delta.ok, true);
  assert.equal(delta.accepted, 8);
  assert.equal(delta.character.data.eco.pack.goods.madera, 2);
});

test('store debits only accepted goods and preserves the complete unrelated profile', async () => {
  const initial = character({ goods: { madera: 8, piedra: 2 } });
  const s = store({ characters: [initial] });
  const result = await s.commitContribution(request({ amount: 20 }));
  const receipt = receiptOf(result);
  assert.equal(result.ok, true);
  assert.equal(receipt.accepted, 8);
  const afterC = await s.loadCharacter(WORLD, EPOCH, CHAR);
  const afterP = await s.loadProject(WORLD, EPOCH, PROJECT);
  assert.equal(afterC.data.eco.pack.goods.madera, undefined);
  assert.equal(afterC.data.eco.pack.goods.piedra, 2);
  const expectedData = structuredClone(initial.data);
  expectedData.eco.tradeRev++;
  expectedData.eco.pack.goods = { piedra: 2 };
  assert.deepEqual(afterC.data, expectedData);
  assert.equal(afterP.contributed.madera, 10);
  assert.equal(afterC.version, 2);
  assert.equal(afterP.version, 2);
  assert.deepEqual((await s.loadContributionReceipt(request({ amount: 20 }).operationId)).result, receipt);
});

test('requested amount is capped at remaining progress even when inventory is smaller than requested', async () => {
  const s = store({ characters: [character({ goods: { madera: 5 } })],
    projects: [project({ requirements: { madera: 10 }, contributed: { madera: 7 } })] });
  const result = await s.commitContribution(request({ amount: 9 }));
  assert.equal(result.ok, true);
  assert.equal(receiptOf(result).accepted, 3);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 2);
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 10);
});

test('two concurrent callers cannot spend the same final material or exceed project remainder', async () => {
  const s = store({ characters: [character({ goods: { madera: 1 } })],
    projects: [project({ requirements: { madera: 10 }, contributed: { madera: 9 } })] });
  const [a, b] = await Promise.all([
    s.commitContribution(request({ operationId: uuid(20), amount: 1 })),
    s.commitContribution(request({ operationId: uuid(21), amount: 1 })),
  ]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].filter(x => !x.ok).length, 1);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera ?? 0, 0);
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 10);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).version, 2);
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).version, 2);
  assert.ok(await s.loadContributionReceipt(uuid(20)));
  assert.ok(await s.loadContributionReceipt(uuid(21)));
});

test('exact accepted replay returns the original receipt after another contribution without reapplying', async () => {
  const s = store();
  const first = request({ operationId: uuid(30), amount: 2 });
  const accepted = await s.commitContribution(first);
  const originalReceipt = receiptOf(accepted);
  const later = await s.commitContribution(request({ operationId: uuid(31), amount: 1,
    charVersion: 2, projectVersion: 2 }));
  assert.equal(later.ok, true);
  const replay = await s.commitContribution(first);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.deepEqual(withoutReplay(replay), withoutReplay(accepted));
  assert.deepEqual(withoutReplay((await s.loadContributionReceipt(first.operationId)).result), withoutReplay(accepted));
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 4);
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 5);
});

test('operation ID reuse with another request is rejected without replacing the original receipt', async () => {
  const s = store();
  const first = request({ operationId: uuid(40), amount: 2 });
  const accepted = await s.commitContribution(first);
  const originalReceipt = receiptOf(accepted);
  const collision = await s.commitContribution({ ...first, amount: 3 });
  assert.equal(collision.ok, false);
  assert.ok(await s.loadContributionReceipt(uuid(40)));
  assert.deepEqual((await s.loadContributionReceipt(uuid(40))).result, originalReceipt);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 5);
});

test('a denied request stays terminal even when a later contribution makes its capped amount affordable', async () => {
  const other = uuid(6);
  const s = store({ characters: [character({ goods: { madera: 1 } }), character({ id: other, goods: { madera: 7 } })] });
  const deniedRequest = request({ operationId: uuid(50), amount: 4 });
  const denied = await s.commitContribution(deniedRequest);
  assert.equal(denied.ok, false);
  const denialReceipt = receiptOf(denied);
  assert.ok(await s.loadContributionReceipt(uuid(50)));
  // After another donor pays seven, only one is missing: recomputing this old request would succeed.
  const later = await s.commitContribution(request({ operationId: uuid(51), id: other, amount: 7 }));
  assert.equal(later.ok, true);
  const replay = await s.commitContribution(deniedRequest);
  assert.equal(replay.ok, false);
  assert.equal(replay.replay, true);
  assert.deepEqual(withoutReplay(replay), withoutReplay(denialReceipt));
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 9);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 1);
});

test('different donors contesting the last unit do not debit the losing character', async () => {
  const other = uuid(8);
  const s = store({ characters: [character({ goods: { madera: 1 } }), character({ id: other, goods: { madera: 1 } })],
    projects: [project({ requirements: { madera: 3 }, contributed: { madera: 2 } })] });
  const outcomes = await Promise.all([
    s.commitContribution(request({ operationId: uuid(22), amount: 1 })),
    s.commitContribution(request({ operationId: uuid(23), id: other, amount: 1 })),
  ]);
  assert.equal(outcomes.filter(x => x.ok).length, 1);
  const a = await s.loadCharacter(WORLD, EPOCH, CHAR), b = await s.loadCharacter(WORLD, EPOCH, other);
  assert.equal((a.data.eco.pack.goods.madera ?? 0) + (b.data.eco.pack.goods.madera ?? 0), 1);
  assert.equal(a.version + b.version, 3);
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 3);
});

test('operation IDs are global across scope and malformed requests do not reserve them', async () => {
  const otherWorld = 'world:other';
  const s = store({ characters: [character(), character({ worldId: otherWorld })],
    projects: [project(), project({ worldId: otherWorld })] });
  const r = request({ operationId: uuid(24), amount: 1 });
  await assert.rejects(s.commitContribution({ ...r, amount: 0 }), ContributionError);
  assert.equal(await s.loadContributionReceipt(r.operationId), null);
  const first = await s.commitContribution(r);
  assert.equal(first.ok, true);
  assert.deepEqual(await s.commitContribution({ ...r, worldId: otherWorld }), { ok: false, why: 'operation', replay: false });
  assert.equal((await s.loadCharacter(otherWorld, EPOCH, CHAR)).data.eco.pack.goods.madera, 7);
  assert.deepEqual((await s.loadContributionReceipt(r.operationId)).result, first);
});

test('exhausted inventory revision, unwanted material, and a filled requirement leave both baselines unchanged', async () => {
  const cases = [
    { c: character(), p: project(), r: request({ good: 'piedra', amount: 1 }), why: 'material' },
    { c: character(), p: project({ contributed: { madera: 10 } }), r: request(), why: 'complete' },
    { c: character(), p: project(), r: request(), why: 'conflict', exhausted: true },
  ];
  for (const fixture of cases) {
    if (fixture.exhausted) fixture.c.data.eco.tradeRev = 2147483647;
    const s = store({ characters: [fixture.c], projects: [fixture.p] });
    const result = await s.commitContribution(fixture.r);
    assert.deepEqual(result, { ok: false, why: fixture.why, replay: false });
    assert.deepEqual(await s.loadCharacter(WORLD, EPOCH, CHAR), fixture.c);
    assert.deepEqual(await s.loadProject(WORLD, EPOCH, PROJECT), fixture.p);
  }
});

test('stale versions, missing baselines, and cross-scope or epoch requests never debit', async () => {
  const cases = [
    { request: request({ operationId: uuid(60), charVersion: 2 }), characters: [character()], projects: [project()] },
    { request: request({ operationId: uuid(61), projectVersion: 2 }), characters: [character()], projects: [project()] },
    { request: request({ operationId: uuid(62), id: uuid(7) }), characters: [character()], projects: [project()] },
    { request: request({ operationId: uuid(63), epoch: uuid(9) }), characters: [character()], projects: [project()] },
    { request: request({ operationId: uuid(64), projectId: 'other:project' }), characters: [character()], projects: [project()] },
    { request: request({ operationId: uuid(65), worldId: 'world:other' }), characters: [character()], projects: [project()] },
  ];
  for (const item of cases) {
    const s = store(item);
    const beforeC = await s.loadCharacter(WORLD, EPOCH, CHAR);
    const beforeP = await s.loadProject(WORLD, EPOCH, PROJECT);
    const out = await s.commitContribution(item.request);
    assert.equal(out.ok, false);
    assert.deepEqual(await s.loadCharacter(WORLD, EPOCH, CHAR), beforeC);
    assert.deepEqual(await s.loadProject(WORLD, EPOCH, PROJECT), beforeP);
    assert.ok(await s.loadContributionReceipt(item.request.operationId));
  }
});

test('world and world epoch are independent storage scopes', async () => {
  const secondEpoch = uuid(70), otherWorld = 'world:other';
  const s = store({ characters: [character(), character({ epoch: secondEpoch }), character({ worldId: otherWorld })],
    projects: [project(), project({ epoch: secondEpoch }), project({ worldId: otherWorld })] });
  const changed = request({ operationId: uuid(71), epoch: secondEpoch });
  const accepted = await s.commitContribution(changed);
  assert.equal(accepted.ok, true);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 7);
  assert.equal((await s.loadCharacter(WORLD, secondEpoch, CHAR)).data.eco.pack.goods.madera, 3);
  assert.equal((await s.loadCharacter(otherWorld, EPOCH, CHAR)).data.eco.pack.goods.madera, 7);
  assert.ok(await s.loadContributionReceipt(uuid(71)));
});

test('only eco.pack.goods is chargeable; holds and cargo never satisfy or fund a contribution', async () => {
  const s = store({ characters: [character({ goods: {} })] });
  const out = await s.commitContribution(request({ operationId: uuid(80), amount: 1 }));
  assert.equal(out.ok, false);
  const after = await s.loadCharacter(WORLD, EPOCH, CHAR);
  assert.deepEqual(after.data.raft, { id: 'raft-keep', cargo: { tronco: 4 } });
  assert.deepEqual(after.data.eco.pack.goods, {});
  assert.equal((await s.loadProject(WORLD, EPOCH, PROJECT)).contributed.madera, 2);
});

test('constructor rejects duplicate character and project scopes', () => {
  assert.throws(() => store({ characters: [character(), character()] }));
  assert.throws(() => store({ projects: [project(), project()] }));
});

test('contract rejects malformed identity, amounts, versions, extra keys, cycles and prototype keys', () => {
  const invalidRequests = [
    { ...request(), amount: 0 }, { ...request(), amount: -1 }, { ...request(), amount: 1.5 },
    { ...request(), amount: Number.NaN }, { ...request(), amount: Number.POSITIVE_INFINITY },
    { ...request(), worldEpoch: 'not-a-uuid' }, { ...request(), characterId: 'bad' },
    { ...request(), expectedCharacterVersion: 2147483647 }, { ...request(), unexpected: true },
    Object.assign(Object.create({ inherited: true }), request()),
    { ...request(), good: '__proto__' },
  ];
  for (const invalid of invalidRequests) assert.throws(() => contributionRequest(invalid), ContributionError);
  const cyclic = character(); cyclic.data.cycle = cyclic.data;
  assert.throws(() => contributionCharacter(cyclic), ContributionError);
  for (const invalid of [
    { ...character(), version: 2147483648 },
    { ...character(), data: { ...character().data, eco: { ...character().data.eco,
      pack: { cap: 40, goods: { madera: Number.POSITIVE_INFINITY } } } } },
  ]) assert.throws(() => contributionCharacter(invalid), ContributionError);
  for (const invalid of [
    { ...project(), requirements: { madera: 10, piedra: 0 } },
    { ...project(), contributed: { madera: 11 } },
    { ...project(), requirements: { madera: 10 }, contributed: { madera: 1, piedra: 0 } },
    { ...project(), requirements: { madera: 10 }, contributed: JSON.parse('{"madera":0,"__proto__":1}') },
  ]) assert.throws(() => contributionProject(invalid), ContributionError);
});

test('version exhaustion cannot wrap into a successful contribution', () => {
  const c = character({ version: 2147483647 }), p = project();
  const r = request({ charVersion: 2147483646 });
  assert.deepEqual(contributionDelta(r, c, p), { ok: false, why: 'conflict' });
  const c2 = character(), p2 = project({ version: 2147483647 });
  const r2 = request({ projectVersion: 2147483646 });
  assert.deepEqual(contributionDelta(r2, c2, p2), { ok: false, why: 'conflict' });
});

test('constructor, loads, commit results, and receipts are defensively cloned', async () => {
  const suppliedC = character(), suppliedP = project();
  const s = store({ characters: [suppliedC], projects: [suppliedP] });
  suppliedC.data.eco.pack.goods.madera = 99;
  suppliedP.requirements.madera = 11;
  suppliedP.contributed.madera = 8;
  const loadedC = await s.loadCharacter(WORLD, EPOCH, CHAR);
  const loadedP = await s.loadProject(WORLD, EPOCH, PROJECT);
  assert.equal(loadedC.data.eco.pack.goods.madera, 7);
  assert.equal(loadedP.contributed.madera, 2);
  assert.equal(loadedP.requirements.madera, 10);
  loadedC.data.eco.pack.goods.madera = 0;
  loadedP.contributed.madera = 10;
  const result = await s.commitContribution(request({ operationId: uuid(90), amount: 1 }));
  const receipt = receiptOf(result);
  result.accepted = 999; receipt.accepted = 999;
  result.character.data.eco.pack.goods.madera = 0;
  result.project.contributed.madera = 10;
  const loadedReceipt = await s.loadContributionReceipt(uuid(90));
  assert.equal(loadedReceipt.result.accepted, 1);
  loadedReceipt.result.accepted = 50;
  const replay = await s.commitContribution(request({ operationId: uuid(90), amount: 1 }));
  assert.equal(receiptOf(replay).accepted, 1);
  assert.equal((await s.loadCharacter(WORLD, EPOCH, CHAR)).data.eco.pack.goods.madera, 6);
});
