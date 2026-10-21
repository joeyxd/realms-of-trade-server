import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedMessage, presenceMessage } from '../tools/agent/pair-companion.mjs';

const order = (op, ok, why = null, presence = null) => ({ type: 'presence_order', sessionId: 's', data: { op, ok, why, presence } });

test('connectedMessage keeps the chat text and announces body mode', () => {
  assert.equal(connectedMessage({ name: 'Luna', capabilities: ['chat'] }, 'm1'),
    'Conectado: Luna. Solo chat; modelo m1. Escribe r y Enter para actualizar contexto; Ctrl+C para detener.');
  const body = connectedMessage({ name: 'Luna', capabilities: ['chat', 'presence'] }, 'm1');
  for (const w of ['sígueme', 'espera', 'vuelve', 'm1', 'r y Enter', 'Ctrl+C']) assert.ok(body.includes(w), w);
});

test('presenceMessage names accepted orders with a fixed body status', () => {
  for (const [op, word] of [['follow', 'seguirte'], ['wait', 'esperar'], ['return', 'volver']]) {
    const m = presenceMessage(order(op, true, null, { status: 'present', order: op, revision: 1, reason: null }));
    assert.ok(m.includes(word) && m.includes('presente') && m.length < 120, m);
    assert.ok(!presenceMessage(order(op, true, null, { status: 'weird' })).includes('weird'));
    assert.ok(presenceMessage(order(op, true)).includes(word));
  }
});

test('presenceMessage maps every known why and hides unknown ones', () => {
  const seen = new Set();
  for (const why of ['conflict', 'paced', 'superseded', 'unavailable', 'closed', 'timeout', 'busy']) {
    const m = presenceMessage(order('follow', false, why));
    assert.ok(m.includes('seguirte') && m.length < 120); seen.add(m);
  }
  assert.equal(seen.size, 7);
  const generic = presenceMessage(order('wait', false, null));
  const unknown = presenceMessage(order('wait', false, 'EVIL<script>'));
  assert.equal(unknown, generic); assert.ok(!unknown.includes('EVIL'));
  assert.ok(unknown.includes('esperar'));
});

test('presenceMessage handles load, ignored events and malformed input', () => {
  assert.ok(presenceMessage(order('load', true, null, { status: 'resting' })).includes('descansando'));
  assert.equal(presenceMessage(order('load', true, null, { status: 'x' })), null);
  assert.ok(presenceMessage(order('load', false, 'timeout')).includes('estado del cuerpo'));
  assert.equal(presenceMessage({ type: 'presence', sessionId: 's', data: {} }), null);
  assert.equal(presenceMessage(order('invalid', false, 'invalid_request')), null);
  assert.equal(presenceMessage(order('other', true)), null);
  for (const bad of [null, undefined, 'x', [], [order('follow', true)], Object.create(null)]) assert.equal(presenceMessage(bad), null);
  const getter = { type: 'presence_order' };
  Object.defineProperty(getter, 'data', { enumerable: true, get() { return order('follow', true).data; } });
  assert.equal(presenceMessage(getter), null);
  class Ev { constructor() { this.type = 'presence_order'; this.data = order('follow', true).data; } }
  assert.equal(presenceMessage(new Ev()), null);
});
