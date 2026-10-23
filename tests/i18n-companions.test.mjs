import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DEFAULT_COMPANION_PRESET, companionCreationConfig } from '../src/net/companionCreation.js';
import { ROLE_TEMPLATES, PERSONALITY_TEMPLATES, TRAIT_TEMPLATES, companionTemplateText } from '../src/net/companionTemplates.js';
import { getLocale, onLocaleChange, setLocale } from '../src/core/locale.js';
import { CompanionCreationUI } from '../src/ui/companionCreation.js';
import { CompanionConfigUI } from '../src/ui/companionConfig.js';
import { CompanionPairingUI } from '../src/ui/companionPairing.js';
import { CompanionPresenceUI } from '../src/ui/companionPresence.js';
import { CompanionsUI } from '../src/ui/companions.js';
import { InferenceConfigUI } from '../src/ui/inferenceConfig.js';

const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPANISH_ONLY = /[áéíóúñ¿¡]/i;
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const child of nodes) { this.children.push(child); child.parentNode = this; } }
  replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  querySelectorAll(selector) {
    const all = [];
    const walk = root => { for (const child of root.children) {
      if (selector === '[data-focus-key]' && child.dataset.focusKey) all.push(child);
      walk(child);
    } };
    walk(this); return all;
  }
  focus() { document.activeElement = this; }
}
class Client {
  constructor() {
    this.state = { status: 'offline', record: null, head: null, presence: null, available: false, durable: false,
      enabled: false, code: null, catalog: [], characters: [], message: '' };
    this.listeners = new Set(); this.creates = []; this.saves = [];
  }
  snapshot() { return structuredClone(this.state); }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  publish(delta) { Object.assign(this.state, structuredClone(delta)); for (const fn of this.listeners) fn(this.snapshot()); }
  load() { this.publish({ status: 'loading', message: '' }); return true; }
  create(preset) { this.creates.push(structuredClone(preset)); return true; }
  save(config) { this.saves.push(structuredClone(config)); return true; }
  issue() { return true; }
  revoke() { return true; }
  command() { return true; }
}
function setup(UI = CompanionCreationUI) {
  const previous = globalThis.document;
  globalThis.document = { head: new Element('head'), activeElement: null, getElementById: () => null,
    createElement: tag => new Element(tag) };
  const client = new Client(), ui = new UI(new Element('section'), { client });
  return { ui, client, restore: () => { globalThis.document = previous; } };
}
function ready(client, extra = {}) { client.publish({ status: 'ready', available: true, durable: true, ...extra }); }
const field = (ui, key) => ui.container.querySelectorAll('[data-focus-key]').find(el => el.dataset.focusKey === key);
const input = el => el.listeners.input?.forEach(fn => fn({ target: el }));

test('every creation role, personality, trait, lore, voice, goal and constraint renders in English and Spanish', () => {
  const { ui, client, restore } = setup();
  try {
    ui.open(); ready(client);
    for (const role of Object.keys(ROLE_TEMPLATES)) for (const personality of Object.keys(PERSONALITY_TEMPLATES)) {
      for (const trait of [null, ...Object.keys(TRAIT_TEMPLATES)]) {
        ui.draft = { ...DEFAULT_COMPANION_PRESET, role, personality, traits: trait ? [trait] : [] };
        ui.setLanguage('es'); assert.equal(ui.review(), true);
        const config = companionCreationConfig(ui.draft), es = ui.reviewPersonality.textContent;
        assert.equal(es, config.personality);
        const esGoals = ui.reviewGoals.textContent;
        ui.setLanguage('en');
        const en = ui.reviewPersonality.textContent, enGoals = ui.reviewGoals.textContent;
        assert.notEqual(en, es); assert.notEqual(enGoals, esGoals);
        assert.doesNotMatch(en + enGoals, SPANISH_ONLY);
        assert.match(en, /## Voice\n/); assert.match(en, /## Purpose and companionship/);
        assert.match(en, /## Game rules/); assert.match(en, /Only the server and runner grant permissions/);
        for (const line of es.split('\n').filter(line => line && !line.startsWith('# Brisa'))) {
          assert.notEqual(companionTemplateText(line, 'en'), line, `untranslated document line: ${line}`);
        }
        const source = ROLE_TEMPLATES[role];
        for (const text of [source.label, source.lore, source.goal, ...source.constraints,
          PERSONALITY_TEMPLATES[personality].label, PERSONALITY_TEMPLATES[personality].voice,
          ...(trait ? [TRAIT_TEMPLATES[trait]] : [])]) {
          const display = companionTemplateText(text, 'en');
          assert.notEqual(display, text); assert.doesNotMatch(display, SPANISH_ONLY);
        }
      }
    }
    ui.setLanguage('es'); assert.match(ui.looks.textContent, /Corsario/); assert.doesNotMatch(ui.looks.textContent, /Corsair/);
    ui.setLanguage('en'); assert.match(ui.looks.textContent, /Corsair/);
  } finally { restore(); }
});

test('creation config bytes match the pre-change baseline for all presets regardless of locale', () => {
  const original = getLocale(), hash = createHash('sha256');
  try {
    for (const role of Object.keys(ROLE_TEMPLATES)) for (const personality of Object.keys(PERSONALITY_TEMPLATES)) {
      for (const trait of [null, ...Object.keys(TRAIT_TEMPLATES)]) {
        const draft = { ...DEFAULT_COMPANION_PRESET, role, personality, traits: trait ? [trait] : [] };
        setLocale('es'); const es = companionCreationConfig(draft);
        setLocale('en'); const en = companionCreationConfig(draft);
        assert.deepEqual(en, es); assert.equal(JSON.stringify(en), JSON.stringify(es));
        hash.update(JSON.stringify(es));
      }
    }
    assert.equal(hash.digest('hex'), 'd435c11f0b3100fbb9e5592362fd18954455e516352bc0faffdf661736937c37');
  } finally { setLocale(original); }
});

test('the existing locale callback re-renders review and saved documents live without changing the creation payload', () => {
  const { ui, client, restore } = setup(), original = getLocale();
  // Mirror main.js's existing language-button callback without editing its owner file.
  const unsubscribe = onLocaleChange(() => ui.setLanguage(getLocale()));
  try {
    setLocale('es'); ui.setLanguage('es'); ui.open(); ready(client);
    ui.draft.name = 'Tía Perla'; ui.review();
    const preset = structuredClone(ui.draft), config = companionCreationConfig(preset);
    setLocale('en');
    assert.match(ui.reviewPersonality.textContent, /You are Tía Perla/);
    assert.doesNotMatch(ui.reviewPersonality.textContent.replaceAll('Tía Perla', ''), SPANISH_ONLY);
    ui.confirmed = true; assert.equal(ui.create(), true); assert.deepEqual(client.creates, [preset]);
    ready(client, { record: { characterKey: CHARACTER, preset, configuration: { config }, control: { stopped: true } } });
    assert.match(ui.savedPersonality.textContent, /## Voice/); assert.doesNotMatch(ui.savedGoals.textContent, SPANISH_ONLY);
    setLocale('es'); assert.equal(ui.savedPersonality.textContent, config.personality);
    assert.equal(ui.savedGoals.textContent, config.goals.map(goal => `${goal.text}\n${goal.constraints.join('\n')}`).join(''));
    assert.deepEqual(client.state.record.configuration.config, config);
  } finally { unsubscribe(); setLocale(original); restore(); }
});

test('stored profile fields show and edit the stored source in both locales, with a live bilingual note and translated aria-labels', () => {
  const { ui, client, restore } = setup(CompanionConfigUI);
  try {
    const config = companionCreationConfig(DEFAULT_COMPANION_PRESET);
    ui.open(CHARACTER, 'Brisa'); ready(client, { characterKey: CHARACTER, head: { revision: 1, config } });
    const goal = config.goals[0], key = `goal-text:${goal.id}`, ckey = `goal-constraints:${goal.id}`;
    const noteEs = 'El perfil se guarda tal como está escrito; las plantillas iniciales están en español.';
    const noteEn = 'The profile is saved exactly as written; the starter templates are in Spanish.';
    ui.setLanguage('es'); assert.equal(ui.storedNote.textContent, noteEs);
    ui.setLanguage('en'); assert.equal(ui.storedNote.textContent, noteEn);
    // The textareas are stored content: EN view shows the stored Spanish source verbatim.
    assert.equal(ui.personality.value, config.personality);
    assert.equal(field(ui, key).value, goal.text);
    assert.equal(field(ui, ckey).value, goal.constraints.join('\n'));
    // Display-only aria-label still follows the locale.
    assert.match(field(ui, `goal-status:${goal.id}`).attributes['aria-label'], /Status: Accompany/);
    ui.setLanguage('es'); assert.equal(ui.storedNote.textContent, noteEs);
    assert.match(field(ui, `goal-status:${goal.id}`).attributes['aria-label'], /^Estado: /);
    // An untouched round-trip is byte-identical in both locales.
    for (const lang of ['en', 'es']) {
      ui.setLanguage(lang); input(ui.personality); input(field(ui, key)); input(field(ui, ckey));
      assert.deepEqual(ui.draft, config); assert.equal(JSON.stringify(ui.draft), JSON.stringify(config));
      client.saves.length = 0; assert.equal(ui.save(), true);
      assert.equal(JSON.stringify(client.saves[0]), JSON.stringify(config));
      ready(client, { characterKey: CHARACTER, head: { revision: 2, config } });
    }
    // An in-line edit made in EN view applies exactly to the stored source: no English template prose is saved.
    ui.setLanguage('en');
    ui.personality.value = ui.personality.value.replace('# Brisa', '# Don Bacalao'); input(ui.personality);
    const expected = config.personality.replace('# Brisa', '# Don Bacalao');
    assert.equal(ui.draft.personality, expected);
    const goalField = field(ui, key); goalField.value = goalField.value + ' Extra.'; input(goalField);
    assert.equal(ui.draft.goals[0].text, goal.text + ' Extra.');
    const constraintsField = field(ui, ckey); constraintsField.value = constraintsField.value + '\nMy rule.'; input(constraintsField);
    assert.deepEqual(ui.draft.goals[0].constraints, [...goal.constraints, 'My rule.']);
    client.saves.length = 0; assert.equal(ui.save(), true);
    const saved = JSON.stringify(client.saves[0]);
    assert.doesNotMatch(saved, /## Voice|## Game rules|Only the server and runner/);
    assert.equal(client.saves[0].personality, expected);
  } finally { restore(); }
});

test('companion and inference panels map codes and unknown external errors to live bilingual copy', () => {
  const cases = [
    [CompanionCreationUI, ['forbidden', 'invalid_request', 'unavailable', 'conflict', 'limit', 'busy', 'timeout']],
    [CompanionConfigUI, ['forbidden', 'invalid_request', 'unavailable', 'conflict', 'busy', 'timeout']],
    [CompanionPairingUI, ['forbidden', 'invalid_request', 'unavailable', 'busy', 'stopped', 'not_created', 'timeout']],
    [CompanionPresenceUI, ['forbidden', 'invalid_request', 'unavailable', 'busy', 'conflict', 'no_companion', 'outside_anchor',
      'outside_zone', 'danger', 'hurt', 'dead', 'full', 'paired', 'recovery_required', 'blocked', 'timeout']],
    [InferenceConfigUI, ['forbidden', 'invalid_request', 'unavailable', 'conflict', 'busy', 'must_stop', 'ineligible', 'timeout']],
    [CompanionsUI, ['forbidden', 'invalid_request', 'disabled', 'stale_control', 'conflict', 'unavailable', 'busy', 'durable_control_required', 'timeout']],
  ];
  for (const [UI, codes] of cases) {
    const { ui, client, restore } = setup(UI);
    try {
      if (UI === CompanionConfigUI) ui.open(CHARACTER, 'Brisa');
      else if (UI !== CompanionPresenceUI && UI !== CompanionsUI) ui.open();
      for (const message of [...codes, 'Error externo: contraseña privada', 'provider secret failure']) {
        const state = { ...client.snapshot(), status: 'error', characterKey: CHARACTER, message };
        if (UI === CompanionsUI) ui.setState(state); else client.publish(state);
        ui.setLanguage('es'); const es = ui.status.textContent;
        ui.setLanguage('en'); const en = ui.status.textContent;
        assert.ok(es.length && en.length, `${UI.name}: ${message}`); assert.notEqual(en, es, `${UI.name}: ${message}`);
        assert.doesNotMatch(en, SPANISH_ONLY); assert.doesNotMatch(es + en, /contraseña privada|provider secret failure/);
      }
    } finally { restore(); }
  }
});
