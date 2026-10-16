import test from 'node:test';
import assert from 'node:assert/strict';
import { GmEntry } from '../src/editor/entry.js';

const ACCOUNT = 'a1b2c3d4-e5f6-4789-8abc-1234567890ab';
const TOKEN = 'ephemeral-access-token';

class FakeButton {
  listeners = new Map();
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  remove() { this.removed = true; }
  click() { this.listeners.get('click')?.(); }
}

function setup({ online = true, signedIn = true, accountId = ACCOUNT, fetchImpl, onOpen = async () => {}, onRevoke = () => {}, available = () => true }) {
  const originalDocument = globalThis.document;
  const button = new FakeButton();
  globalThis.document = { createElement: (tag) => { assert.equal(tag, 'button'); return button; } };
  const parent = { append(child) { this.child = child; } };
  const auth = {
    state: { signedIn, accountId },
    listeners: new Set(),
    subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); },
    async sessionIdentity() {
      if (!this.state.signedIn) throw new Error('signed_out');
      return { accountId: this.state.accountId, token: TOKEN };
    },
    update(next) { this.state = next; for (const listener of this.listeners) listener(next); },
  };
  const entry = new GmEntry({
    parent, auth, online, httpBase: 'https://game.test/', available, onOpen, onRevoke,
    fetchImpl: fetchImpl ?? (async () => ({ ok: true, async json() { return { ok: true, accountId: ACCOUNT, capabilities: ['gm-editor'], expiresIn: 60 }; } })),
  });
  entry.ready = true;
  entry.render();
  return {
    entry, auth, button, parent,
    restore() { entry.dispose(); globalThis.document = originalDocument; },
  };
}

async function settle(predicate, message = 'condition did not settle') {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

test('allowlisted session opens through bearer check without storing the token', async () => {
  let opened = 0;
  let requestOptions;
  const state = setup({
    fetchImpl: async (_url, options) => { requestOptions = options; return { ok: true, async json() {
      return { ok: true, accountId: ACCOUNT, capabilities: ['gm-editor'], expiresIn: 60 };
    } }; },
    onOpen: async (accountId) => { assert.equal(accountId, ACCOUNT); opened++; },
  });
  try {
    await settle(() => state.entry.allowed);
    await state.entry.open();
    assert.equal(opened, 1);
    assert.equal(state.entry.active, true);
    assert.equal(requestOptions.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(requestOptions.cache, 'no-store');
    assert.equal(Object.hasOwn(state.entry, 'token'), false);
    assert.equal(Object.values(state.entry).includes(TOKEN), false);
  } finally { state.restore(); }
});

test('guest and authenticated denied account cannot reach onOpen', async () => {
  let guestOpens = 0;
  const guest = setup({ signedIn: false, accountId: '', onOpen: async () => { guestOpens++; } });
  try {
    await guest.entry.open();
    assert.equal(guestOpens, 0);
    assert.equal(guest.entry.active, false);
    assert.equal(guest.entry.button.hidden, true);
  } finally { guest.restore(); }

  let deniedOpens = 0;
  const denied = setup({
    fetchImpl: async () => ({ ok: false, async json() { return {}; } }),
    onOpen: async () => { deniedOpens++; },
  });
  try {
    await settle(() => denied.entry.allowed === false);
    await denied.entry.open();
    assert.equal(deniedOpens, 0);
    assert.equal(denied.entry.active, false);
    assert.equal(denied.entry.allowed, false);
  } finally { denied.restore(); }
});

test('sign-out during lazy editor open closes the editor after onOpen resolves', async () => {
  let finishOpen;
  let editorActive = false;
  let revokeCalls = 0;
  const state = setup({
    onOpen: async () => {
      await new Promise((resolve) => { finishOpen = resolve; });
      editorActive = true;
    },
    onRevoke: () => { revokeCalls++; editorActive = false; },
  });
  try {
    await settle(() => state.entry.allowed);
    const opening = state.entry.open();
    await settle(() => typeof finishOpen === 'function');
    state.auth.update({ signedIn: false, accountId: '' });
    finishOpen();
    await opening;
    assert.equal(editorActive, false);
    assert.equal(state.entry.active, false);
    assert.equal(revokeCalls, 1);
  } finally { state.restore(); }
});

test('periodic revalidation revokes an active editor when capability disappears', async () => {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  let intervalCallback;
  globalThis.setInterval = (callback) => { intervalCallback = callback; return 7; };
  globalThis.clearInterval = () => {};
  let responseCount = 0;
  let revokeCalls = 0;
  const state = setup({
    fetchImpl: async () => {
      responseCount++;
      return responseCount <= 2
        ? { ok: true, async json() { return { ok: true, accountId: ACCOUNT, capabilities: ['gm-editor'], expiresIn: 60 }; } }
        : { ok: false, async json() { return {}; } };
    },
    onRevoke: () => { revokeCalls++; },
  });
  try {
    await settle(() => state.entry.allowed);
    await state.entry.open();
    assert.equal(state.entry.active, true);
    intervalCallback();
    await settle(() => state.entry.active === false);
    assert.equal(state.entry.allowed, false);
    assert.equal(revokeCalls, 1);
  } finally {
    state.restore();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('a gameplay transition while the online permission check is pending cannot open the editor', async () => {
  let available = true;
  let releaseCheck;
  let fetchCount = 0;
  let opened = 0;
  const state = setup({
    available: () => available,
    fetchImpl: async () => {
      fetchCount++;
      if (fetchCount === 1) return { ok: true, async json() {
        return { ok: true, accountId: ACCOUNT, capabilities: ['gm-editor'], expiresIn: 60 };
      } };
      return new Promise((resolve) => { releaseCheck = () => resolve({ ok: true, async json() {
        return { ok: true, accountId: ACCOUNT, capabilities: ['gm-editor'], expiresIn: 60 };
      } }); });
    },
    onOpen: async () => { opened++; },
  });
  try {
    await settle(() => state.entry.allowed);
    const opening = state.entry.open();
    await settle(() => typeof releaseCheck === 'function');
    available = false; // Play has started boarding while permission revalidation was in flight.
    releaseCheck();
    await opening;
    assert.equal(opened, 0);
    assert.equal(state.entry.active, false);
  } finally { state.restore(); }
});
