import assert from 'node:assert/strict';
import test from 'node:test';
import { CompanionsUI } from '../src/ui/companions.js';

class MockElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text || this.children.map((child) => child.textContent).join(''); }
  append(...nodes) { for (const item of nodes) { this.children.push(item); item.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  closest(selector) { return selector === '[data-control-key]' && this.dataset.controlKey ? this : selector === '[data-stop-key]' && this.dataset.stopKey ? this : null; }
  focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
}

function setup(options = {}) {
  const previous = globalThis.document;
  globalThis.document = {
    head: new MockElement('head'),
    ui: new MockElement('div'),
    getElementById(id) { return id === 'ui' ? this.ui : null; },
    createElement: (tag) => new MockElement(tag),
  };
  const parent = new MockElement('main');
  const ui = new CompanionsUI(parent, options);
  return { ui, parent, restore: () => { globalThis.document = previous; } };
}

test('signed-out and offline snapshots discard companion rows and language changes update labels', () => {
  const { ui, restore } = setup();
  try {
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'brisa', online: true, active: true }] });
    assert.equal(ui.list.children.length, 1);
    ui.setState({ status: 'signed_out', enabled: true, companions: [{ characterKey: 'brisa', online: true, active: true }] });
    assert.equal(ui.list.children.length, 0);
    ui.setState({ status: 'ready', enabled: false, companions: [{ characterKey: 'legacy', stopped: false }] });
    assert.match(ui.setupNote.textContent, /configurar una conexi/);
    assert.match(ui.sessionNote.textContent, /detención de sesión/);
    assert.match(ui.status.textContent, /desactivados en este servidor/);
    ui.setLanguage('en');
    assert.equal(ui.title.textContent, 'My companions');
    assert.equal(ui.status.textContent, 'Companions are disabled on this server.');
    assert.match(ui.sessionNote.textContent, /after the server restarts/);
    ui.setState({ status: 'offline', enabled: true, companions: [{ characterKey: 'brisa', online: true, active: true }] });
    assert.equal(ui.list.children.length, 0);
  } finally { restore(); }
});

test('stop is single-flight, keeps rows visible while pending, and never renders callback errors', async () => {
  let resolveStop;
  const calls = [];
  const { ui, restore } = setup({ onStop: (key, epoch) => { calls.push([key, epoch]); return new Promise((resolve) => { resolveStop = resolve; }); } });
  try {
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'char-8', name: 'Brisa <Capitana>', online: false, active: false, epoch: 8 }] });
    ui.stopButtons[0].focus();
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'char-8', name: 'Brisa <Capitana>', online: false, active: false, epoch: 9 }] });
    assert.equal(globalThis.document.activeElement, ui.stopButtons[0], 'polling preserves focus on the matching stop action');
    const first = ui.stop('char-8');
    const duplicate = ui.stop('char-8');
    assert.deepEqual(calls, [['char-8', 9]]);
    assert.equal(ui.list.children.length, 1);
    assert.match(ui.list.children[0].textContent, /Brisa <Capitana>/);
    assert.doesNotMatch(ui.list.children[0].textContent, /char-8/);
    resolveStop();
    await Promise.all([first, duplicate]);
    assert.equal(ui.localPendingStop.size, 0);
  } finally { restore(); }
});

test('unconfigured or inactive rows have no stop action and refresh errors use fixed copy', async () => {
  const { ui, restore } = setup({ onRefresh: async () => { throw new Error('provider token=secret'); } });
  try {
    ui.setState({ status: 'ready', enabled: false, companions: [{ characterKey: 'quiet', online: false, active: false }] });
    assert.equal(ui.list.children[0].children.length, 1);
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'quiet', online: false, active: false, stopped: false }] });
    assert.equal(ui.list.children[0].children.length, 2, 'offline provisioned rows can still be stopped');
    ui.setVisible(true);
    await ui.refresh();
    assert.match(ui.status.textContent, /No se pudo actualizar/);
    assert.doesNotMatch(ui.status.textContent, /secret|token/);
  } finally { restore(); }
});

test('panel visibility callback fires only on transitions and stopped is distinct from offline', () => {
  const changes = [];
  const { ui, restore } = setup({ onVisibilityChange: (open) => {
    changes.push(open);
    // Closing another game panel may return focus to the stage during the open hook.
    if (open) globalThis.document.ui.focus();
  } });
  try {
    ui.setVisible(true);
    assert.equal(ui.open(), true);
    assert.equal(globalThis.document.activeElement, ui.closeButton, 'opening restores dialog focus after closing another panel');
    assert.equal(ui.open(), true);
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'brisa', online: false, active: false, stopped: true }] });
    ui.setLanguage('en');
    assert.match(ui.list.children[0].textContent, /Companion 1.*Offline.*Stopped/);
    assert.equal(ui.list.children[0].children.length, 1);
    ui.close();
    assert.deepEqual(changes, [true, false]);
  } finally { restore(); }
});

test('ready has a truthful label, setup note persists, and known error codes use fixed localized copy', () => {
  const { ui, restore } = setup();
  try {
    ui.setState({ status: 'ready', enabled: true, message: 'timeout', companions: [{ characterKey: 'uuid-secret', name: null, online: false, active: false, stopped: true }] });
    assert.equal(ui.status.textContent, 'La solicitud tardó demasiado; el resultado durable es incierto. Actualiza para confirmar antes de volver a intentarlo.');
    assert.equal(ui.setupNote.textContent, 'Aún no puedes configurar una conexión desde el juego.');
    assert.match(ui.list.children[0].textContent, /Compañero 1/);
    assert.doesNotMatch(ui.list.children[0].textContent, /uuid-secret/);
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'k', name: 'Brisa', online: true, active: true }] });
    assert.equal(ui.status.textContent, 'Estado actualizado.');
    ui.setState({ status: 'error', enabled: true, message: 'untrusted secret provider response', companions: [] });
    assert.equal(ui.status.textContent, 'No se pudo consultar el estado. Inténtalo de nuevo.');
    ui.setState({ status: 'error', enabled: true, message: 'conflict', companions: [] });
    assert.equal(ui.status.textContent, 'El control cambió en otro lugar. Actualiza antes de volver a intentarlo.');
    ui.setLanguage('en');
    ui.setState({ status: 'error', enabled: true, message: 'unavailable', companions: [] });
    assert.equal(ui.status.textContent, 'Durable control is unavailable. Refresh to check again.');
  } finally { restore(); }
});

test('modal keyboard flow traps Tab at both ends while native traversal and Escape remain available', () => {
  const changes = [];
  const { ui, restore } = setup({ onVisibilityChange: (open) => changes.push(open) });
  try {
    ui.setVisible(true);
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'b', name: 'Brisa', active: true }] });
    ui.open();
    assert.equal(ui.closeButton.focused, true);
    assert.equal(globalThis.document.activeElement, ui.closeButton);
    assert.equal(ui.closeButton.textContent, '×');
    assert.equal(ui.closeButton.attributes['aria-label'], 'Cerrar panel');
    let stopped = false;
    ui.panel.listeners.keydown[0]({ key: 'Tab', target: ui.closeButton, stopPropagation() { stopped = true; }, preventDefault() { assert.fail('Interior Tab traversal must remain native'); } });
    assert.equal(stopped, true);
    stopped = false;
    let prevented = false;
    ui.panel.listeners.keydown[0]({ key: 'Tab', shiftKey: true, target: ui.closeButton, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(globalThis.document.activeElement, ui.stopButtons[0]);
    prevented = false;
    stopped = false;
    ui.panel.listeners.keydown[0]({ key: 'Tab', target: ui.stopButtons[0], stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(globalThis.document.activeElement, ui.closeButton);
    stopped = false;
    ui.panel.listeners.keydown[0]({ key: 'Escape', stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    assert.equal(stopped, true);
    assert.equal(prevented, true);
    assert.equal(ui.isOpen, false);
    assert.equal(ui.toggleButton.focused, true);
    assert.deepEqual(changes, [true, false]);
  } finally { restore(); }
});

test('dialog portals to the stage UI and the HUD toggle opens and closes it', () => {
  const { ui, restore } = setup();
  try {
    assert.equal(globalThis.document.ui.children[0], ui.panel);
    assert.match(globalThis.document.head.children[0].textContent, /z-index:50/);
    assert.match(globalThis.document.head.children[0].textContent, /100cqw/);
    ui.setVisible(true);
    ui.toggleButton.listeners.click[0]();
    assert.equal(ui.isOpen, true);
    assert.equal(ui.toggleButton.attributes['aria-expanded'], 'true');
    ui.toggleButton.listeners.click[0]();
    assert.equal(ui.isOpen, false);
    assert.equal(ui.toggleButton.attributes['aria-expanded'], 'false');
  } finally { restore(); }
});

test('refresh focus moves to close before the refresh button becomes disabled', async () => {
  let finish;
  const { ui, restore } = setup({ onRefresh: () => new Promise((resolve) => { finish = resolve; }) });
  try {
    ui.setVisible(true);
    ui.setState({ status: 'ready', enabled: true, companions: [] });
    ui.open();
    ui.refreshButton.focus();
    const request = ui.refresh();
    assert.equal(ui.refreshButton.disabled, true);
    assert.equal(globalThis.document.activeElement, ui.closeButton);
    finish();
    await request;
  } finally { restore(); }
});

test('durable stop is distinguished from the local latch and owner resume keeps focus and explains reconnection', async () => {
  let finishResume;
  const calls = [];
  const { ui, restore } = setup({ onResume: (key, epoch) => { calls.push([key, epoch]); return new Promise(resolve => { finishResume = resolve; }); } });
  const confirmed = { status: 'ready', revision: 8, stopped: true, savedAt: '2026-10-10T10:00:00.000Z' };
  try {
    ui.setVisible(true);
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'private-key', name: 'Brisa', online: false, active: false, stopped: true, epoch: 9, control: confirmed }] });
    assert.match(ui.list.children[0].textContent, /Detenido.*Detención guardada/);
    assert.match(ui.sessionNote.textContent, /conserva entre sesiones/);
    assert.equal(ui.stopButtons.length, 0);
    assert.equal(ui.resumeButtons[0].textContent, 'Permitir conexión');
    assert.match(ui.sessionNote.textContent, /controlador vuelva a conectarse/);
    ui.resumeButtons[0].focus();
    const pending = ui.resume('private-key');
    assert.deepEqual(calls, [['private-key', 9]]);
    assert.equal(ui.resumeButtons[0].disabled, true);
    assert.equal(globalThis.document.activeElement, ui.closeButton, 'focus moves to a live control while the action is pending');
    finishResume(); await pending;
    ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'private-key', online: false, active: false, stopped: false, epoch: 9,
      control: { status: 'ready', revision: 9, stopped: false, savedAt: '2026-10-10T10:01:00.000Z' } }] });
    assert.equal(ui.stopButtons.length, 1);
    ui.setLanguage('en');
    assert.equal(ui.stopButtons[0].textContent, 'Stop');
    assert.match(ui.sessionNote.textContent, /preserved between sessions/);
    assert.match(globalThis.document.head.children[0].textContent, /min-height:44px/);
  } finally { restore(); }
});

test('pending, unavailable, and malformed durable control never show stop or resume actions', () => {
  const { ui, restore } = setup();
  try {
    for (const control of [
      { status: 'pending', revision: 2, stopped: false, savedAt: '2026-10-10T10:00:00.000Z' },
      { status: 'unavailable', revision: 2, stopped: false, savedAt: '2026-10-10T10:00:00.000Z' },
      { status: 'ready', revision: 2147483648, stopped: false, savedAt: '2026-10-10T10:00:00.000Z', extra: true },
    ]) {
      ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'b', stopped: true, control }] });
      assert.equal(ui.controlButtons.length, 0);
      assert.match(ui.list.children[0].textContent, /durable|durable/);
    }
    ui.setLanguage('en');
    assert.match(ui.list.children[0].textContent, /Durable control/);
  } finally { restore(); }
});

test('an unconfirmed local stop offers separate confirm-stop and allow-connection actions; revision zero is only the default', async () => {
  const stopCalls = [], resumeCalls = [];
  const options = {
    onStop: (key, epoch) => stopCalls.push([key, epoch]),
    onResume: (key, epoch) => resumeCalls.push([key, epoch]),
  };
  const stopFixture = setup(options), resumeFixture = setup(options);
  const localStopped = { status: 'ready', revision: 8, stopped: false, savedAt: '2026-10-10T10:00:00.000Z' };
  try {
    for (const ui of [stopFixture.ui, resumeFixture.ui]) {
      ui.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'b', stopped: true, epoch: 7, control: localStopped }] });
      assert.equal(ui.stopButtons[0].textContent, 'Confirmar detención');
      assert.equal(ui.resumeButtons[0].textContent, 'Permitir conexión');
      assert.equal(ui.controlButtons.length, 2, 'both choices stay independently available');
      assert.match(ui.list.children[0].textContent, /Detención local sin confirmar/);
      assert.match(stopFixture.ui.container.children[0].textContent, /Mis compañeros/);
    }
    await stopFixture.ui.stop('b');
    await resumeFixture.ui.resume('b');
    assert.deepEqual(stopCalls, [['b', 7]]);
    assert.deepEqual(resumeCalls, [['b', 7]]);

    const defaultUI = stopFixture.ui;
    defaultUI.setState({ status: 'ready', enabled: true, companions: [{ characterKey: 'default', stopped: true,
      control: { status: 'ready', revision: 0, stopped: true, savedAt: null } }] });
    assert.match(defaultUI.list.children[0].textContent, /Detenido por defecto/);
    assert.doesNotMatch(defaultUI.list.children[0].textContent, /Detención guardada/);
    defaultUI.setLanguage('en');
    assert.match(defaultUI.list.children[0].textContent, /Stopped by default/);
    assert.match(defaultUI.panel.textContent, /Confirm stop|Allow connection/);
    assert.match(globalThis.document.head.children[0].textContent, /mn-companions-actions\{display:grid/);
  } finally { resumeFixture.restore(); stopFixture.restore(); }
});

test('UI normalization preserves pending operation and character for durable controls', () => {
  const { ui, restore } = setup();
  try {
    ui.setState({ status: 'ready', enabled: true, pendingOp: 'resume', pendingCharacter: 'b',
      companions: [{ characterKey: 'b', stopped: true, control: { status: 'ready', revision: 8, stopped: true, savedAt: '2026-10-10T10:00:00.000Z' } }] });
    assert.equal(ui.state.pendingOp, 'resume');
    assert.equal(ui.state.pendingCharacter, 'b');
    assert.equal(ui.resumeButtons[0].disabled, true);
    assert.equal(ui.resumeButtons[0].textContent, 'Guardando…');
  } finally { restore(); }
});
