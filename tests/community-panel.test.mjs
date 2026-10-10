import test from 'node:test';
import assert from 'node:assert/strict';
import { communityReason, communityRows } from '../src/ui/community.js';
import { GameClient } from '../src/client/gameClient.js';

test('community progress projects server requirements against only the current profile pack', () => {
  const rows = communityRows({ requirements: { madera: 18, piedra: 6 }, contributed: { madera: 7, piedra: 6 } }, {
    eco: { pack: { goods: { madera: 4, tronco: 50 } } },
  });
  assert.deepEqual(rows, [
    { good: 'madera', name: 'Madera', required: 18, current: 7, remaining: 11, owned: 4, percent: 39 },
    { good: 'piedra', name: 'Piedra', required: 6, current: 6, remaining: 0, owned: 0, percent: 100 },
  ]);
});

test('community progress accepts row contracts and clamps display progress to requirements', () => {
  const rows = communityRows({ requirements: [{ good: 'tronco', amount: 3 }], contributed: [{ good: 'tronco', amount: 9 }] }, null);
  assert.deepEqual(rows, [
    { good: 'tronco', name: 'Tronco recogido', required: 3, current: 3, remaining: 0, owned: 0, percent: 100 },
  ]);
});

test('community server failures map to short Spanish recovery guidance', () => {
  assert.match(communityReason('account_required'), /Vincula una cuenta/);
  assert.match(communityReason('revision'), /cambió/);
  assert.match(communityReason('unrecognized'), /No se pudo completar/);
});

test('GameClient forwards community receipts only to the addressed entity', () => {
  const received = [], client = Object.create(GameClient.prototype);
  client.youServer = 4; client.bus = { emit: (type, payload) => received.push({ type, payload }) };
  const event = { type: 'community', to: 4, op: 'list', opId: 'exact-id', ok: true };
  client.onEvent(event);
  client.onEvent({ ...event, to: 5 });
  assert.deepEqual(received, [{ type: 'community', payload: event }]);
});
