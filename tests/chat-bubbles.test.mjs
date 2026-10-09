import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatBubbles } from '../src/ui/chatBubbles.js';

const people = [
  { id: 'self-token', entity: 1, name: 'Yo' },
  { id: 'peer-token', entity: 2, name: 'Marina' },
  { id: 'other-token', entity: 3, name: 'Náufrago' },
];

function harness() {
  const shown = [];
  const removed = [];
  let clears = 0;
  const bubbles = new ChatBubbles({
    show: (...args) => shown.push(args),
    remove: (entity) => removed.push(entity),
    clear: () => { clears += 1; },
  });
  const state = (overrides = {}) => bubbles.onState({
    self: 'self-token',
    peers: people,
    config: { enabled: true, localRadius: 31 },
    ...overrides,
  });
  state();
  return { bubbles, shown, removed, get clears() { return clears; }, state };
}

const local = (id, sender = people[1], text = '¡Hola!') => ({ id, channel: 'local', sender, text });
const whisper = (id, sender, target, text = 'Te leo') => ({ id, channel: 'whisper', sender, target, text });

test('only live local chat creates a nearby bubble with state-derived identity and radius', () => {
  const h = harness();
  h.bubbles.onMessage(local('m1', { ...people[1], name: 'Falso' }));
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0][0], 2);
  assert.deepEqual(h.shown[0][1], {
    text: '¡Hola!', channel: 'local', label: 'Cerca · Marina', own: false, range: 31,
  });
  assert.equal(h.shown[0][2], 5100);
});

test('world and unrelated channels never create bubbles', () => {
  const h = harness();
  h.bubbles.onMessage({ ...local('world-1'), channel: 'world' });
  h.bubbles.onMessage({ ...local('other-1'), channel: 'system' });
  assert.equal(h.shown.length, 0);
});

test('empty and non-string text is ignored before deduplication or display', () => {
  const h = harness();
  h.bubbles.onMessage(local('bad-number', people[1], 42));
  h.bubbles.onMessage(local('bad-object', people[1], { text: 'spoofed' }));
  h.bubbles.onMessage(local('bad-empty', people[1], '   '));
  assert.equal(h.shown.length, 0);

  h.bubbles.onMessage(local('bad-number', people[1], 'valid retry'));
  assert.equal(h.shown.length, 1, 'invalid text does not consume the message ID');
});

test('whispers are limited to the sender or current target and use trusted labels', () => {
  const h = harness();
  h.bubbles.onMessage(whisper('third-party', people[1], people[2]));
  assert.equal(h.shown.length, 0);

  h.bubbles.onMessage(whisper('incoming', people[1], people[0]));
  h.bubbles.onMessage(whisper('outgoing', people[0], people[1]));
  assert.equal(h.shown.length, 2);
  assert.equal(h.shown[0][1].label, 'Privado · Marina → ti');
  assert.equal(h.shown[1][1].label, 'Privado · Tú → Marina');
  assert.equal(h.shown[0][1].own, false);
  assert.equal(h.shown[1][1].own, true);
});

test('sender and whisper target must match current opaque token and entity mapping', () => {
  const h = harness();
  h.bubbles.onMessage(local('wrong-entity', { ...people[1], entity: 9 }));
  h.bubbles.onMessage(local('unknown-token', { id: 'old-token', entity: 2 }));
  h.bubbles.onMessage(whisper('wrong-target', people[0], { ...people[1], entity: 8 }));
  assert.equal(h.shown.length, 0);

  h.bubbles.forgetEntity(2);
  h.bubbles.onMessage(local('recycled-entity', people[1]));
  assert.equal(h.shown.length, 0, 'a forgotten mapping stays invalid until a later state arrives');
});

test('leave and entity remap remove the old bubble; disable, self change, and disconnect clear all', () => {
  const h = harness();
  h.bubbles.onMessage(local('before-leave'));
  h.state({ peers: [people[0], { ...people[1], entity: 4 }, people[2]] });
  assert.deepEqual(h.removed, [2]);

  h.bubbles.onMessage(local('after-remap', { ...people[1], entity: 4 }));
  h.state({ peers: [people[0], people[2]] });
  assert.deepEqual(h.removed, [2, 4]);

  h.bubbles.onMessage(local('before-disable', people[2]));
  h.state({ config: { enabled: false, localRadius: 31 } });
  assert.equal(h.clears, 1);
  assert.equal(h.shown.length, 3);

  h.state();
  h.bubbles.onMessage(local('before-self-change'));
  h.state({ self: 'new-session', peers: [{ id: 'new-session', entity: 9, name: 'Yo' }] });
  assert.equal(h.clears, 2);
  h.bubbles.disconnected();
  assert.equal(h.clears, 2, 'disconnect clears visible nodes only once');
  h.bubbles.onMessage(local('after-disconnect'));
  assert.equal(h.shown.length, 4, 'disconnect invalidates session and peer mappings');
});

test('state updates never replay prior history and duplicate live IDs are suppressed', () => {
  const h = harness();
  h.bubbles.onMessage(local('live-1'));
  h.state({ history: [local('historical')] });
  h.bubbles.onMessage(local('live-1'));
  h.bubbles.onMessage(local('live-2'));
  assert.equal(h.shown.length, 2);

  h.state({
    self: 'new-session',
    peers: [{ id: 'new-session', entity: 9, name: 'Yo' }],
    history: [local('historical-after-self-change')],
  });
  assert.equal(h.shown.length, 2, 'a new session state also never animates attached history');
});

test('Unicode text is truncated by code point and lifetime stays within five to eight seconds', () => {
  const h = harness();
  const text = '🧭'.repeat(220);
  h.bubbles.onMessage(local('long-1', people[1], text));
  assert.equal(Array.from(h.shown[0][1].text).length, 180);
  assert.equal(h.shown[0][1].text.endsWith('…'), true);
  assert.equal(h.shown[0][2], 8000);

  h.bubbles.onMessage(local('short-1', people[2], 'x'));
  assert.ok(h.shown[1][2] >= 5000 && h.shown[1][2] <= 8000);
});

