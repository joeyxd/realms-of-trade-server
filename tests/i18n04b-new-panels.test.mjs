import test from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../src/core/i18n.js';
import { ARTISAN } from '../src/data/artisan.js';
import { ArtisanPanel } from '../src/ui/artisan.js';
import { loggingSkillHtml } from '../src/ui/loggingSkill.js';
import { packInventoryHtml } from '../src/ui/packInventory.js';
import { lessonCommand, lessonPresentation } from '../src/ui/navalLessonState.js';
import { RaftEditor } from '../src/ui/raftEditor.js';
import { RaftLanternActions } from '../src/ui/raftLanternActions.js';
import { PersonalLanternActions } from '../src/ui/personalLanternActions.js';
import { lanternPoint } from '../src/sim/naval/lantern.js';

function element() {
  return { textContent: '', innerHTML: '', hidden: false, disabled: false, style: {}, dataset: {}, attrs: {},
    classList: { toggle() {} }, setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener() {}, querySelector() { return element(); }, remove() {}, focus() {} };
}

test('logging, pack and naval lesson snapshots localize without changing their source state or command', () => {
  const progression = { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] };
  const profile = { progression, eco: { pack: { cap: 50, goods: { madera: 3 } } } };
  const before = structuredClone(profile);
  assert.match(loggingSkillHtml(progression, 'es'), /Tala/);
  assert.match(loggingSkillHtml(progression, 'en'), /Logging/);
  const esPack = packInventoryHtml(profile, {}, 'es');
  const enPack = packInventoryHtml(profile, {}, 'en');
  assert.match(esPack, /Madera/);
  assert.match(enPack, /Timber/);
  assert.deepEqual(profile, before, 'rendering either locale does not mutate the profile');

  const lesson = { available: true, active: false, canStart: true, status: 'ready', learning: { learned: true, persistence: 'pending' } };
  const commandBefore = lessonCommand(lesson, 21);
  assert.match(lessonPresentation(lesson, 'es').learningLabel, /Guardado pendiente/);
  assert.match(lessonPresentation(lesson, 'en').learningLabel, /Save pending/);
  assert.deepEqual(lessonCommand(lesson, 21), commandBefore, 'locale projection does not alter lesson command data');
});

test('artisan locale events refresh a pending learning label without resending or replacing its command', (t) => {
  const originalLocale = globalThis.document;
  const original = globalThis.document;
  const previous = original?.documentElement?.lang || 'es';
  t.after(() => { setLocale(previous); globalThis.document = originalLocale; });
  const nodes = new Map();
  const root = element();
  root.querySelector = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const parent = { appendChild() {} };
  globalThis.document = { ...original, documentElement: { lang: 'es' }, createElement: () => root };
  setLocale('es');
  const profile = { progression: { v: 1, practice: { logging: 60 }, milestones: ['logging_steady'], knowledge: [] },
    eco: { tradeRev: 4, pack: { cap: 50, goods: { madera: 2 } } } };
  const sent = [];
  const panel = new ArtisanPanel({ parent, profile: () => profile, context: () => ({ profile }), enabled: () => true,
    submit: command => { sent.push(command); return true; }, getLocale: () => undefined });
  panel.pending = { command: Object.freeze({ t: 'cmd', type: 'artisan', op: 'learn', opId: 'learn-pending', lesson: ARTISAN.lesson, expectedRev: 4, expectedProjectRev: 8 }),
    sentAt: performance.now(), op: 'learn', ackRev: null };
  panel.status = panel.copy().waiting;
  const pending = panel.pending, command = pending.command;
  setLocale('en');
  assert.equal(panel.pending, pending);
  assert.equal(panel.pending.command, command);
  assert.equal(sent.length, 0, 'language refresh does not submit or retry learning');
  assert.match(nodes.get('[data-status]').textContent, /Sending request/);
  setLocale('es');
  assert.equal(panel.pending.command, command);
  assert.match(nodes.get('[data-status]').textContent, /Enviando solicitud/);
  panel.dispose();
});

test('storage locale rerender preserves the pending placement snapshot and never calls retry', () => {
  const editor = Object.create(RaftEditor.prototype);
  const original = globalThis.document;
  const previous = original?.documentElement?.lang || 'es';
  const span = element(), button = element();
  button.querySelector = () => span;
  let sends = 0, palettePasses = 0, renderPasses = 0;
  editor.$ = () => button;
  editor.profile = () => ({ progression: { v: 1, practice: { logging: 60 }, milestones: [], knowledge: [] } });
  editor.pending = { id: 'store-op', op: 'place', sentAt: 10,
    message: Object.freeze({ t: 'cmd', type: 'raftEdit', op: 'place', id: 'raft-a', opId: 'store-op', piece: [ARTISAN.part, 2, 2, 0] }) };
  editor.send = () => { sends++; };
  editor.renderPalette = () => { palettePasses++; editor.syncStoragePalette(); };
  editor.render = () => { renderPasses++; };
  const pending = editor.pending, message = pending.message;
  globalThis.document = { ...original, documentElement: { lang: 'es' } };
  try {
    editor.renderPalette(); editor.render();
    assert.equal(span.textContent, 'Bodega');
    globalThis.document.documentElement.lang = 'en';
    editor.launcher = element(); editor.launcher.textContent = 'Build · B';
    editor.renderPalette(); editor.render();
    assert.equal(span.textContent, 'Storage');
    assert.match(button.title, /workbench artisan/);
    assert.equal(editor.pending, pending);
    assert.equal(editor.pending.message, message);
    assert.equal(sends, 0, 'palette and panel refreshes cannot resend storage');
    assert.equal(palettePasses, 2);
    assert.equal(renderPasses, 2);
  } finally { setLocale(previous); globalThis.document = original; }
});

test('raft and personal lantern language refreshes preserve pending intent and do not send again', (t) => {
  const previous = globalThis.document?.documentElement?.lang || 'es';
  t.after(() => setLocale(previous));
  let locale = 'es', now = 0;
  const sent = [], lanternPart = ['lantern', 2, -1, 0, 0], record = { id: 'raft-a', owner: 90, x: 0, y: 0, z: 0, yaw: 0, rev: 12,
    partHealth: [{ id: 'lamp-a', part: lanternPart, hp: 10, maxHp: 10 }], litLanterns: [] };
  const raftClient = { joined: true, youServer: 42, cur: lanternPoint(record, record.partHealth[0].part), pred: { rafts: [record] },
    naval: { active: false }, deck: { active: false }, send: command => sent.push(command) };
  const raft = new RaftLanternActions({ client: () => raftClient, locale: () => locale, now: () => now });
  const action = raft.interaction();
  assert.equal(action.run(), true);
  const raftCommand = sent[0], raftPending = raft.pending;
  locale = 'en';
  assert.equal(raft.interaction().prompt, 'Lighting…');
  assert.equal(raft.pending, raftPending);
  assert.equal(raft.pending.command, raftCommand);
  assert.equal(sent.length, 1);

  const button = element(), parent = { ownerDocument: { createElement: () => button }, appendChild() {} };
  const entity = { r: { act: 0, hp: 100 } };
  const personalClient = { joined: true, youServer: 17, personalLantern: false, entities: new Map([[17, entity]]), send: command => sent.push(command) };
  const personal = new PersonalLanternActions({ client: () => personalClient, parent, locale: () => locale, now: () => now });
  assert.equal(personal.toggle(), true);
  const personalCommand = sent[1], personalPending = personal.pending;
  locale = 'es'; personal.update();
  assert.equal(button.textContent, 'Farol N');
  assert.equal(button.getAttribute?.('aria-label') ?? button.attrs['aria-label'], 'Encendiendo… (N)');
  assert.equal(personal.pending, personalPending);
  assert.equal(personal.pending.command, personalCommand);
  assert.equal(sent.length, 2, 'rendering updated labels without triggering the timed retry');
  personal.dispose(); raft.dispose?.();
});
