import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerCharacters, PlayerCharactersError } from '../src/client/playerCharacters.js';

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountA = uid(100), accountB = uid(200);
const savePrefix = 'mn-test.save.';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  key(index) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const entry = (id, slot, { name = `Pirata ${slot + 1}`, skin = 0, weapon = 0, lastPlayed = false } = {}) =>
  ({ id, slot, name, skin, weapon, lastPlayed });
const roster = (characters = [], legacy = false) => ({ ok: true, characters, legacy, limit: 3 });

function makeClient({ storage = new MemoryStorage(), identity = null, fetchImpl = async () => jsonResponse(roster()),
  baseUrl = 'https://isla.example', ids = [1, 2, 3, 4] } = {}) {
  let index = 0;
  const getIdentity = typeof identity === 'function' ? identity : () => identity;
  const client = new PlayerCharacters({ baseUrl, getIdentity,
    storage, savePrefix, fetchImpl, makeRequestId: () => uid(ids[index++]) });
  return { client, storage, nextId: () => index };
}

test('empty guest creates independent slots with skin-bound starter kits and saves', async () => {
  const { client } = makeClient();
  const firstLoad = await client.load({ guestKey: 'solo', current: { name: 'Bucanero', skin: 2, weapon: 1 } });
  assert.equal(firstLoad.selected, null);
  assert.equal(firstLoad.legacy, false);

  const pistols = await client.create({ name: 'Bucanero', skin: 2, mode: 'new' });
  assert.deepEqual([pistols.slot, pistols.weapon], [0, 1]);
  assert.equal(client.selected().id, pistols.id);
  assert.equal(client.selectedSave(), '');
  client.save('bucanero-save');

  const sword = await client.create({ name: 'Grumete', skin: 0, mode: 'new' });
  assert.deepEqual([sword.slot, sword.weapon], [1, 0]);
  assert.equal(client.selectedSave(), '');
  client.save('grumete-save');
  assert.equal(client.select(pistols.id).id, pistols.id);
  assert.equal(client.selectedSave(), 'bucanero-save');
  assert.equal(client.select(sword.id).id, sword.id);
  assert.equal(client.selectedSave(), 'grumete-save');

  const tercero = await client.create({ name: 'Tercero', skin: 3, mode: 'new' });
  await assert.rejects(client.create({ name: 'Cuarto', skin: 0, mode: 'new' }), error => error.code === 'limit');
  const reloaded = await client.load({ guestKey: 'solo' });
  assert.equal(reloaded.characters.length, 3);
  assert.equal(reloaded.selected.id, tercero.id);
  assert.deepEqual(reloaded.characters.map(c => c.slot), [0, 1, 2]);
});

test('legacy guest save requires confirmation, is copied to a new per-character key, and never overwritten', async () => {
  const storage = new MemoryStorage(), oldKey = `${savePrefix}online.isla.example`;
  const original = JSON.stringify({ signed: 'old profile bytes must stay untouched' }); storage.setItem(oldKey, original);
  const { client } = makeClient({ storage });
  const loaded = await client.load({ guestKey: 'online.isla.example', legacySave: original,
    current: { name: 'Bucanero', skin: 2, weapon: 1 } });
  assert.equal(loaded.legacy, true);
  assert.equal(loaded.selected, null);
  await assert.rejects(client.create({ name: 'Nuevo', skin: 0, mode: 'new' }), error => error.code === 'legacy_required');

  const legacy = await client.create({ name: 'Bucanero', skin: 2, mode: 'legacy' });
  assert.deepEqual([legacy.slot, legacy.weapon, legacy.source], [0, 1, 'legacy']);
  assert.equal(client.selectedSave(), original);
  assert.equal(storage.getItem(oldKey), original);
  client.save('updated character save');
  assert.equal(client.selectedSave(), 'updated character save');
  assert.equal(storage.getItem(oldKey), original);
  assert.equal(client.backupSelectedSave(), true);
  assert.equal(storage.getItem(`${savePrefix}online.isla.example.character.${legacy.id}.old`), 'updated character save');

  const newCharacter = await client.create({ name: 'Otro', skin: 1, mode: 'new' });
  assert.deepEqual([newCharacter.slot, newCharacter.weapon], [1, 0]);
  assert.equal(client.selectedSave(), '');
  assert.equal(storage.getItem(oldKey), original);
});

test('account roster selection is cached by server and account, then cleared from active scope on sign-out', async () => {
  const storage = new MemoryStorage(), a = entry(uid(1), 0, { name: 'Bucanero', skin: 2, weapon: 1 }),
    b = entry(uid(2), 1, { name: 'Grumete', skin: 0, weapon: 0, lastPlayed: true });
  let identity = { accountId: accountA, token: 'token-a' };
  const fetchImpl = async url => {
    return jsonResponse(roster([a, b]));
  };
  const { client } = makeClient({ storage, identity: () => identity, fetchImpl });
  const loaded = await client.load({ guestKey: 'solo' });
  assert.equal(loaded.mode, 'account');
  assert.equal(loaded.selected.id, b.id);
  client.select(a.id);

  const second = makeClient({ storage, identity, fetchImpl }).client;
  assert.equal((await second.load({ guestKey: 'solo' })).selected.id, b.id, 'last played on the server wins over an older browser selection');
  const otherServer = makeClient({ storage, identity, fetchImpl, baseUrl: 'https://otra.example' }).client;
  assert.equal((await otherServer.load()).selected.id, b.id);

  identity = { accountId: accountB, token: 'token-b' };
  const switched = await client.load({ guestKey: 'solo' });
  assert.equal(switched.mode, 'account');
  assert.equal(switched.selected.id, b.id);
  identity = null;
  const guest = await client.load({ guestKey: 'solo' });
  assert.equal(guest.mode, 'guest');
  assert.equal(guest.selected, null);
  assert.equal(client.selected(), null);
});

test('reload resolves a creation whose responses were lost before offering another slot', async () => {
  const storage = new MemoryStorage(), identity = { accountId: accountA, token: 'token-a' };
  const created = entry(uid(7), 0, { name: 'Bucanero', skin: 2, weapon: 1, lastPlayed: true });
  let acknowledged = false, originalRequest = null;
  const fetchImpl = async (url, options) => {
    if (options.method === 'GET') return jsonResponse(roster(acknowledged ? [created] : []));
    const request = JSON.parse(options.body);
    if (!originalRequest) originalRequest = request;
    assert.deepEqual(request, originalRequest);
    if (!acknowledged) throw new Error('response lost after server commit');
    return jsonResponse({ ok: true, character: created });
  };
  const first = makeClient({ storage, identity, fetchImpl }).client;
  await first.load();
  await assert.rejects(first.create({ name: 'Bucanero', skin: 2 }), { code: 'network' });
  acknowledged = true;
  const reloaded = makeClient({ storage, identity, fetchImpl }).client;
  assert.equal((await reloaded.load()).selected.id, created.id);
  assert.equal([...storage.values.keys()].some(key => key.includes('.pending.')), false);
});

test('account import can read the latest selected guest save without changing active scope', async () => {
  const storage = new MemoryStorage(), guest = makeClient({ storage }).client;
  await guest.load({ guestKey: 'server-one' });
  await guest.create({ name: 'Bucanero', skin: 2 }); guest.save('signed-current-save');
  const account = makeClient({ storage, identity: { accountId: accountA, token: 'token-a' } }).client;
  await account.load();
  assert.equal(account.localSave('server-one', 'signed-old-save'), 'signed-current-save');
  assert.equal(account.localSave('other-server', 'different-legacy'), 'different-legacy');
  await guest.create({ name: 'Nueva partida', skin: 0 });
  assert.equal(account.localSave('server-one', 'signed-old-save'), '');
  assert.equal(account.mode, 'account');
});

test('account legacy conversion sends no browser save and imports only by explicit request on empty roster', async () => {
  const storage = new MemoryStorage(), token = 'account-token', importedSave = 'signed legacy blob';
  const identity = { accountId: accountA, token }, calls = [];
  const fetchImpl = async (_url, request) => {
    calls.push({ method: request.method, authorization: request.headers.authorization, body: request.body && JSON.parse(request.body) });
    if (request.method === 'GET') return jsonResponse(roster([], true));
    return jsonResponse({ ok: true, character: entry(uid(3), 0, { name: 'Bucanero', skin: 2, weapon: 1, lastPlayed: true }) }, 201);
  };
  const { client } = makeClient({ storage, identity, fetchImpl });
  await client.load({ guestKey: 'online.isla.example', legacySave: importedSave, current: { name: 'Bucanero', skin: 2, weapon: 1 } });
  const legacy = await client.create({ name: 'Bucanero', skin: 2, mode: 'legacy' });
  assert.equal(legacy.id, uid(3));
  assert.equal(calls[1].authorization, `Bearer ${token}`);
  assert.deepEqual(calls[1].body, { requestId: uid(1), name: 'Bucanero', skin: 2, mode: 'legacy' });
  assert.equal(JSON.stringify([...storage.values.values()]).includes(importedSave), false);

  const importCalls = [];
  const importFetch = async (_url, request) => {
    importCalls.push({ method: request.method, body: request.body && JSON.parse(request.body) });
    if (request.method === 'GET') return jsonResponse(roster([], false));
    return jsonResponse({ ok: true, character: entry(uid(4), 0, { name: 'Importado', skin: 2, weapon: 1 }) }, 201);
  };
  const importer = makeClient({ storage: new MemoryStorage(), identity, fetchImpl: importFetch, ids: [5] }).client;
  await importer.load({ guestKey: 'online.isla.example', legacySave: importedSave });
  await importer.create({ name: 'Importado', skin: 2, mode: 'import', save: importedSave });
  assert.equal(importCalls[1].body.save, importedSave);
  assert.equal(importCalls[1].body.mode, 'import');
  assert.equal(importCalls[1].body.requestId, uid(5));
});

test('uncertain account creation retries the exact request id and payload', async () => {
  const identity = { accountId: accountA, token: 'token-a' }, posts = [];
  let firstPost = true;
  const fetchImpl = async (_url, request) => {
    if (request.method === 'GET') return jsonResponse(roster());
    posts.push(JSON.parse(request.body));
    if (firstPost) { firstPost = false; throw new TypeError('connection reset after request'); }
    return jsonResponse({ ok: true, character: entry(uid(9), 0, { name: 'Bucanero', skin: 2, weapon: 1 }) }, 201);
  };
  const { client, storage } = makeClient({ identity, fetchImpl, ids: [9] });
  await client.load();
  const created = await client.create({ name: 'Bucanero', skin: 2, mode: 'new' });
  assert.equal(created.id, uid(9));
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(posts[0].requestId, uid(9));
  assert.equal([...storage.values.keys()].some(key => key.includes('.pending.')), false);
});

test('authenticated endpoint failure never creates or selects a guest fallback', async () => {
  const { client, storage } = makeClient({ identity: { accountId: accountA, token: 'x' },
    fetchImpl: async () => jsonResponse({ ok: false, code: 'busy' }, 503) });
  await assert.rejects(client.load({ guestKey: 'solo', legacySave: 'keep me' }), PlayerCharactersError);
  assert.equal(client.mode, 'account');
  assert.equal(client.selected(), null);
  assert.equal([...storage.values.keys()].some(key => key.includes('.characters.guest.')), false);
});
