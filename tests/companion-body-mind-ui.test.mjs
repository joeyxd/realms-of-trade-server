// IC03a (L03g-b) client side: pairing waits for a live body; the presence card says whether a mind is connected.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionPairingClient } from '../src/client/companionPairing.js';
import { CompanionPresenceClient } from '../src/client/companionPresence.js';
import { CompanionPairingUI } from '../src/ui/companionPairing.js';
import { CompanionPresenceUI } from '../src/ui/companionPresence.js';
import { MSG } from '../src/net/protocol.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const presence = (status = 'present') => ({ characterKey: CHARACTER, name: 'Brisa', status, order: 'wait', revision: 3,
  entity: status === 'present' ? 42 : null, reason: null });
const presenceReceipt = (status, enabled = true) => ({ t: MSG.AGENT_COMPANION_PRESENCE_RESULT, requestId: 'presence-x',
  ok: true, why: null, enabled, presence: presence(status) });
const ownerList = online => ({ t: MSG.AGENT_OWNER_RESULT, requestId: 'owner-x', ok: true, why: null, enabled: true,
  companions: [{ characterKey: CHARACTER, name: 'Brisa', online, active: online, stopped: false, epoch: online ? 4 : null,
    capabilities: ['chat', 'presence'] }] });

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  remove() { this.removed = true; }
}

function wire() {
  const sent = [], listeners = [];
  const auth = { subscribe(callback) { callback({ signedIn: true, accountId: ACCOUNT }); return () => {}; } };
  const transport = { onMessage(callback) { listeners.push(callback); }, onClose() {}, send(message) { sent.push(structuredClone(message)); } };
  return { auth, transport, sent, receive: message => listeners.forEach(callback => callback(message)) };
}
function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { head: new MockElement('head'), getElementById: () => null, createElement: tag => new MockElement(tag) };
  try { return run(); } finally { globalThis.document = previous; }
}
function pairingFixture() {
  const w = wire();
  const client = new CompanionPairingClient({ transport: w.transport, auth: w.auth, joined: () => true, timeoutMs: 50,
    makeRequestId: (() => { let n = 0; return () => `pair-${++n}`; })() });
  client.setSession(ACCOUNT);
  const reply = (fields = {}) => w.receive({ t: MSG.AGENT_COMPANION_PAIR_RESULT, requestId: w.sent.at(-1).requestId,
    ok: true, why: null, enabled: true, code: null, expiresAtMs: null, bootstrap: null, ...fields });
  return { ...w, client, reply };
}

test('the pairing client reads the body gate from presence receipts and keeps it unknown with presence off', () => {
  const f = pairingFixture();
  assert.equal(f.client.bodyGate(), null, 'unknown until a presence receipt arrives');
  f.receive(presenceReceipt('resting'));
  assert.deepEqual(f.client.bodyGate(), { present: false });
  f.receive(presenceReceipt('present'));
  assert.deepEqual(f.client.bodyGate(), { present: true });
  f.receive({ ...presenceReceipt('present'), extra: true });
  assert.deepEqual(f.client.bodyGate(), { present: true }, 'a malformed receipt changes nothing');
  f.receive(presenceReceipt('resting', false));
  assert.equal(f.client.bodyGate(), null, 'presence off keeps the L03f pairing flow');
  f.client.load(); f.reply();
  assert.equal(f.client.issue(), true);
  f.reply({ ok: false, why: 'presence_body_required' });
  assert.deepEqual(f.client.snapshot(), { status: 'error', enabled: true, code: null, expiresAtMs: null, message: 'presence_body_required' });
  assert.deepEqual(f.client.bodyGate(), { present: false }, 'the host refusal also closes the gate');
  f.client.disconnect();
  assert.equal(f.client.bodyGate(), null);
  f.client.destroy();
});

test('the pairing panel offers a code only while the body is present and says why otherwise (ES and EN)', () => withDocument(() => {
  const f = pairingFixture(), parent = new MockElement('section');
  f.client.load(); f.reply(); // The companions panel has already read the pairing state.
  const ui = new CompanionPairingUI(parent, { client: f.client, lang: 'es' });
  assert.equal(ui.open(), true); f.reply();
  assert.equal(ui.generateButton.disabled, false, 'unknown body state keeps today\'s behaviour');
  assert.equal(ui.bodyNote.hidden, true);
  f.receive(presenceReceipt('resting'));
  assert.equal(ui.generateButton.disabled, true);
  assert.equal(ui.bodyNote.hidden, false);
  assert.equal(ui.bodyNote.textContent, 'Invoca primero a tu compañero.');
  assert.equal(ui.generate(), false, 'no code request without a body');
  assert.equal(f.sent.filter(message => message.op === 'issue').length, 0);
  ui.setLanguage('en');
  assert.equal(ui.bodyNote.textContent, 'Summon your companion first.');
  f.receive(presenceReceipt('present'));
  assert.equal(ui.generateButton.disabled, false);
  assert.equal(ui.bodyNote.hidden, true);
  assert.equal(ui.generate(), true);
  f.reply({ ok: false, why: 'presence_body_required' });
  assert.equal(ui.status.textContent, 'Summon your companion first.', 'the host reason is shown in the chosen language');
  f.client.destroy();
}));

test('the presence card says whether a mind is connected, from the owner list on the same transport', () => withDocument(() => {
  const w = wire(), parent = new MockElement('section');
  const client = new CompanionPresenceClient({ transport: w.transport, auth: w.auth, joined: () => true, timeoutMs: 50,
    makeRequestId: (() => { let n = 0; return () => `presence-${++n}`; })() });
  client.setSession(ACCOUNT);
  const ui = new CompanionPresenceUI(parent, { client, lang: 'es' });
  client.load();
  w.receive({ ...presenceReceipt('present'), requestId: w.sent.at(-1).requestId });
  assert.equal(client.mindConnected(), null);
  assert.equal(ui.mindNote.hidden, true, 'unknown until the owner list arrives');
  w.receive(ownerList(true));
  assert.equal(client.mindConnected(), true);
  assert.equal(ui.mindNote.hidden, false);
  assert.match(ui.mindNote.textContent, /^Mente conectada/);
  ui.setLanguage('en');
  assert.match(ui.mindNote.textContent, /^Mind connected/);
  w.receive(ownerList(false));
  assert.equal(ui.mindNote.textContent, 'No mind is connected to this body.');
  w.receive({ ...ownerList(true), companions: [{ ...ownerList(true).companions[0], characterKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] });
  assert.equal(client.mindConnected(), null, 'another companion row says nothing about this body');
  assert.equal(ui.mindNote.hidden, true);
  w.receive(ownerList(true));
  client.load();
  w.receive({ ...presenceReceipt('resting'), requestId: w.sent.at(-1).requestId });
  assert.equal(ui.mindNote.hidden, true, 'a resting body has no mind line');
  ui.destroy(); client.destroy();
}));
