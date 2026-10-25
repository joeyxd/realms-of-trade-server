import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationClient, PRESENTATION_PREVIEW_KEY } from '../src/net/presentationClient.js';
import { emptyPresentationBindings, defaultPresentationBinding } from '../src/data/presentationBindings.js';
const flame = 'niagara-985a431dc6c0d1ca';
const doc = (...slots) => ({ ...emptyPresentationBindings(), bindings: Object.fromEntries(slots.map(slot => [slot, defaultPresentationBinding(slot, flame)])) });
const response = (body, status = 200) => ({ status, json: async () => body });
function storage(initial = null) { let value = initial; return { getItem: () => value, setItem(key, next) { assert.equal(key, PRESENTATION_PREVIEW_KEY); value = next; }, removeItem() { value = null; } }; }
test('overlay is per slot; preview survives storage and clears without changing publication', async () => {
  const local = storage(), published = doc('campfire', 'brazier');
  const client = createPresentationClient({ storage: local, fetchImpl: async () => response({ revision: 2, document: published }) });
  const events = []; client.onChange(value => events.push(value)); await client.load();
  const preview = doc('campfire'); preview.bindings.campfire.parameters.scale = 2;
  assert.equal(client.setPreview(preview), true); assert.equal(events.length, 2);
  assert.equal(client.effective().bindings.campfire.parameters.scale, 2); assert.ok(client.effective().bindings.brazier);
  assert.equal(client.published.bindings.campfire.parameters.scale, 1);
  assert.equal(createPresentationClient({ online: false, storage: local }).effective().bindings.campfire.parameters.scale, 2);
  client.clearPreview(); assert.deepEqual(client.effective(), published); assert.equal(local.getItem(), null);
  const copy = client.effective(); copy.bindings = {}; assert.deepEqual(client.effective(), published);
});
test('invalid preview ignored, invalid published or failed fetch becomes empty, 304 emits no change', async () => {
  let next = response({ revision: 1, document: doc('campfire') }); const requests = [];
  const client = createPresentationClient({ storage: storage('{"bindings":{}}'), fetchImpl: async (_url, options) => { requests.push(options); return next; } });
  assert.deepEqual(client.preview, emptyPresentationBindings()); let count = 0; client.onChange(() => count++);
  await client.load(); assert.equal(count, 1);
  next = response(null, 304); await client.load(); assert.equal(count, 1);
  assert.equal(requests[1].headers['if-none-match'], '"p1"');
  // An invalid or failed read after a good one keeps the last good publication (a flaky poll must not drop the effects).
  next = response({ revision: 2, document: {} }); await client.load(); assert.equal(client.revision, 1); assert.deepEqual(Object.keys(client.effective().bindings), ['campfire']);
  next = Promise.reject(new Error('network')); await client.load(); assert.equal(client.revision, 1); assert.equal(count, 1);
  assert.equal(client.setPreview({}), false);
  const failed = createPresentationClient({ fetchImpl: async () => { throw new Error('network'); } });
  assert.deepEqual((await failed.load()).document, emptyPresentationBindings());
  const timeout = createPresentationClient({ fetchImpl: () => new Promise(() => {}), timeoutMs: 5 });
  await timeout.load(); assert.deepEqual(timeout.effective(), emptyPresentationBindings());
});
test('solo applies preview only; publish uses CAS and token, stale never overwrites local state', async () => {
  const solo = createPresentationClient({ online: false, fetchImpl: () => { throw new Error('unexpected network'); } });
  await solo.load(); assert.equal((await solo.publish(doc(), 0, 'gm')).ok, false);
  let status = 200; const requests = [];
  const client = createPresentationClient({ httpBase: 'http://game.test/path', fetchImpl: async (url, options) => {
    requests.push({ url, options }); return response({ revision: 1 }, status);
  } });
  assert.deepEqual(await client.publish(doc('campfire'), 0, 'gm'), { ok: true, revision: 1 });
  assert.equal(requests[0].url, 'http://game.test/api/gm/presentation'); assert.equal(requests[0].options.headers.authorization, 'Bearer gm');
  assert.equal(JSON.parse(requests[0].options.body).expectedRevision, 0);
  status = 409; assert.equal((await client.publish(doc('brazier'), 0, 'gm')).status, 409); assert.ok(client.published.bindings.campfire);
});
test('shadowed publication changes do not emit effective changes just because slot order differs', async () => {
  let published = doc('campfire', 'brazier');
  const client = createPresentationClient({ fetchImpl: async () => response({ revision: 1, document: published }) });
  client.setPreview(doc('campfire')); await client.load();
  let changes = 0, stateChanges = 0; client.onChange(() => changes++); client.onStateChange(() => stateChanges++);
  published = doc('brazier'); await client.load(); assert.equal(changes, 0);
  assert.equal(stateChanges, 1); await client.load(); assert.equal(stateChanges, 1);
});
test('a delayed GET cannot undo a successful publication', async () => {
  let finishPut, finishGet;
  const client = createPresentationClient({ fetchImpl: async (_url, options) => options.method === 'PUT'
    ? new Promise(resolve => { finishPut = resolve; }) : new Promise(resolve => { finishGet = resolve; }) });
  const writing = client.publish(doc('campfire'), 0, 'gm');
  while (!finishPut) await new Promise(resolve => setImmediate(resolve));
  const polling = client.load();
  while (!finishGet) await new Promise(resolve => setImmediate(resolve));
  finishPut(response({ revision: 1 })); await writing;
  finishGet(response({ revision: 0, document: emptyPresentationBindings() })); await polling;
  assert.equal(client.revision, 1); assert.ok(client.effective().bindings.campfire);
});
test('polls every 60 seconds only while visible and stops cleanly', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, handler;
  const target = { visibilityState: 'hidden', addEventListener(_name, fn) { handler = fn; }, removeEventListener() { handler = null; } };
  const client = createPresentationClient({ fetchImpl: async () => { calls++; return response(null, 304); } });
  t.after(() => client.stop()); client.start(target);
  t.mock.timers.tick(60_000); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
  target.visibilityState = 'visible'; t.mock.timers.tick(59_999);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
  t.mock.timers.tick(1); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  target.visibilityState = 'hidden'; t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  target.visibilityState = 'visible'; handler(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
  client.stop(); assert.equal(handler, null); t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
});
