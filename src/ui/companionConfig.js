import { validateCompanionConfig } from '../net/companionConfig.js';

const COPY = {
  es: {
    title: 'Configurar a {name}', back: 'Volver', personality: 'Personalidad',
    personalityHelp: 'Describe cómo quieres que se comunique y razone este compañero.',
    goals: 'Objetivos', addGoal: 'Añadir objetivo', removeGoal: 'Quitar objetivo',
    goalText: 'Objetivo', status: 'Estado', constraints: 'Condiciones (una por línea)',
    active: 'Activo', paused: 'En pausa', completed: 'Completado', blocked: 'Bloqueado',
    busy: 'Hay otro guardado en curso. Espera y vuelve a cargar la ficha.',
    save: 'Guardar', saving: 'Guardando…', reload: 'Cargar versión del servidor', loading: 'Cargando configuración…',
    saved: 'Configuración guardada.', unchanged: 'Aún no hay una ficha guardada.',
    durable: 'Esta ficha se guarda de forma privada y durable.', preview: 'Vista de prueba: el servidor aún no confirma almacenamiento durable.',
    notApplied: 'La ficha guardada aún no cambia la mente que está ejecutándose; no activa inferencia ni conexión.',
    conflict: 'Otra sesión guardó cambios. Tu borrador se conserva; puedes cargar la versión del servidor.',
    uncertain: 'No se pudo confirmar el guardado. Tu borrador se conserva; carga la versión del servidor antes de guardar otra vez.',
    timeout: 'La consulta tardó demasiado. Inténtalo de nuevo.',
    forbidden: 'No tienes acceso a esta configuración.', invalid_request: 'La configuración no es válida.',
    unavailable: 'El almacenamiento no está disponible.',
    error: 'No se pudo cargar o guardar la configuración.', offline: 'Conéctate al mundo para editar esta ficha.',
    signed_out: 'Inicia sesión para editar esta ficha.',
  },
  en: {
    title: 'Configure {name}', back: 'Back', personality: 'Personality',
    personalityHelp: 'Describe how you want this companion to communicate and reason.',
    goals: 'Goals', addGoal: 'Add goal', removeGoal: 'Remove goal',
    goalText: 'Goal', status: 'Status', constraints: 'Constraints (one per line)',
    active: 'Active', paused: 'Paused', completed: 'Completed', blocked: 'Blocked',
    busy: 'Another save is in progress. Wait, then reload this profile.',
    save: 'Save', saving: 'Saving…', reload: 'Load server version', loading: 'Loading configuration…',
    saved: 'Configuration saved.', unchanged: 'No saved profile yet.',
    durable: 'This profile is saved privately and durably.', preview: 'Preview state: the server has not confirmed durable storage.',
    notApplied: 'The saved profile does not change the running mind yet; it does not activate inference or a connection.',
    conflict: 'Another session saved changes. Your draft is preserved; you can load the server version.',
    uncertain: 'The save could not be confirmed. Your draft is preserved; load the server version before saving again.',
    timeout: 'The request took too long. Try again.',
    forbidden: 'You cannot access this configuration.', invalid_request: 'The configuration is invalid.',
    unavailable: 'Storage is unavailable.',
    error: 'Could not load or save the configuration.', offline: 'Connect to the world to edit this profile.',
    signed_out: 'Sign in to edit this profile.',
  },
};

const STATUSES = ['active', 'paused', 'completed', 'blocked'];
let instanceSequence = 0;
const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};
const clone = (value) => structuredClone(value);
const blankConfig = () => ({ v: 1, personality: '', goals: [] });
// Keep one scroll container and avoid sticky paint layers inside the owner dialog.
const STATUS_CSS = '.mn-companions-panel:has(.mn-companion-config:not([hidden])){overflow:hidden}.mn-companion-config{grid-template-columns:minmax(0,1fr)}.mn-companion-config>*,.mn-companion-config label,.mn-companion-config-header h3{min-width:0;overflow-wrap:anywhere}.mn-companion-config-status{padding:6px 0}';

const CSS = `.mn-companion-config{display:grid;gap:12px;min-width:0;width:100%;max-width:100%;max-height:min(70cqh,520px);overflow:auto;box-sizing:border-box}.mn-companion-config[hidden]{display:none}.mn-companion-config-header,.mn-companion-config-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.mn-companion-config-header h3{margin:0;font-size:1.05rem}.mn-companion-config label{display:grid;gap:6px;font-weight:650}.mn-companion-config textarea,.mn-companion-config select{box-sizing:border-box;width:100%;min-width:0;border:1px solid #78674f;border-radius:8px;background:#211e19;color:#f4ead6;padding:10px;font:500 14px/1.4 system-ui,sans-serif}.mn-companion-config textarea{resize:vertical}.mn-companion-config-personality{min-height:84px}.mn-companion-config-goal-text{min-height:64px}.mn-companion-config-constraints{min-height:52px}.mn-companion-config-goals{display:grid;gap:10px;margin:0;padding:0;list-style:none}.mn-companion-config-goal{display:grid;gap:8px;padding:10px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companion-config button{min-height:44px;border:1px solid #8c7656;border-radius:9px;background:#29241e;color:#f4ead6;padding:9px 12px;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}.mn-companion-config button:hover{background:#393126}.mn-companion-config button:focus-visible,.mn-companion-config textarea:focus-visible,.mn-companion-config select:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companion-config button:disabled{opacity:.6;cursor:wait}.mn-companion-config-note,.mn-companion-config-status{margin:0;color:#d6c6aa}.mn-companion-config-status{min-height:1.4em}.mn-companion-config-goal-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}@media(max-width:600px){.mn-companion-config-header,.mn-companion-config-actions{align-items:stretch;flex-direction:column}.mn-companion-config-header button,.mn-companion-config-actions button,.mn-companion-config-goal-top button,.mn-companion-config-add{width:100%}.mn-companion-config-goal-top{grid-template-columns:1fr}.mn-companion-config textarea{font-size:16px}}`;

/** Private companion profile editor rendered as a subview inside the owner dialog. */
export class CompanionConfigUI {
  constructor(parent, { client, lang = 'es', onClose = () => {} } = {}) {
    if (!parent?.append || !client?.load || !client?.save || !client?.subscribe) {
      throw new TypeError('CompanionConfigUI requiere parent y client.');
    }
    this.parent = parent; this.client = client; this.lang = lang === 'en' ? 'en' : 'es'; this.onClose = onClose;
    this.active = false; this.characterKey = null; this.name = ''; this.draft = null;
    this.head = null; this.state = client.snapshot?.() || { status: 'offline', head: null, durable: false };
    this.reloadRequested = false; this.savePending = false; this.statusKey = '';
    const id = ++instanceSequence;
    this.container = node('section', 'mn-companion-config');
    this.container.hidden = true;
    this.container.setAttribute('aria-labelledby', `mn-companion-config-title-${id}`);
    this.title = node('h3'); this.title.id = `mn-companion-config-title-${id}`;
    this.backButton = node('button', 'mn-companion-config-back'); this.backButton.type = 'button';
    this.backButton.addEventListener('click', () => { this.close(); this.onClose(); });
    const header = node('header', 'mn-companion-config-header');
    header.append(this.title, this.backButton);
    this.status = node('p', 'mn-companion-config-status');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.durableNote = node('p', 'mn-companion-config-note');
    this.usageNote = node('p', 'mn-companion-config-note');

    this.personalityLabel = node('label');
    this.personalityLabelText = node('span');
    this.personality = node('textarea', 'mn-companion-config-personality');
    this.personality.maxLength = 8192;
    this.personality.id = `mn-companion-config-personality-${id}`;
    this.personality.dataset.focusKey = 'personality';
    this.personalityLabel.append(this.personalityLabelText, this.personality);
    this.personalityHelp = node('small', 'mn-companion-config-note');
    this.personalityLabel.append(this.personalityHelp);
    this.personality.addEventListener('input', () => {
      if (this.draft && !this.editingLocked()) this.draft.personality = this.personality.value;
    });

    this.goalsHeading = node('h4'); this.goalList = node('ol', 'mn-companion-config-goals');
    this.addButton = node('button', 'mn-companion-config-add'); this.addButton.type = 'button';
    this.addButton.dataset.focusKey = 'add-goal';
    this.addButton.addEventListener('click', () => this.addGoal());
    const goalSection = node('section'); goalSection.append(this.goalsHeading, this.goalList, this.addButton);

    this.saveButton = node('button', 'mn-companion-config-save'); this.saveButton.type = 'button';
    this.reloadButton = node('button', 'mn-companion-config-reload'); this.reloadButton.type = 'button';
    this.saveButton.addEventListener('click', () => this.save());
    this.reloadButton.addEventListener('click', () => this.reload());
    const actions = node('footer', 'mn-companion-config-actions'); actions.append(this.reloadButton, this.saveButton);
    this.container.append(header, this.status, this.durableNote, this.usageNote, this.personalityLabel, goalSection, actions);
    this.element = this.container;
    parent.append(this.container);
    this.installStyles();
    this.unsubscribe = client.subscribe((state) => this.onClientState(state));
    this.container.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      const idValue = event.target?.dataset?.goalId;
      if (action === 'remove-goal') this.removeGoal(idValue);
    });
    this.render();
  }

  get isOpen() { return this.active; }
  editingLocked() { return this.savePending || ['loading', 'saving'].includes(this.state.status); }
  installStyles() {
    if (!document.head || document.getElementById?.('mn-companion-config-style')) return;
    const style = node('style'); style.id = 'mn-companion-config-style'; style.textContent = CSS + STATUS_CSS; document.head.append(style);
  }
  text() { return COPY[this.lang]; }
  setLanguage(lang) { this.lang = lang === 'en' ? 'en' : 'es'; this.render(); }

  open(characterKey, name = '') {
    if (typeof characterKey !== 'string' || !characterKey) return false;
    this.active = true; this.characterKey = characterKey; this.name = typeof name === 'string' && name.trim() ? name.trim() : '';
    this.draft = null; this.head = null; this.reloadRequested = false; this.savePending = false; this.statusKey = '';
    this.state = this.client.snapshot?.() || this.state;
    this.container.hidden = false;
    this.render();
    const loaded = this.client.load(characterKey);
    if (!loaded && this.active) {
      this.state = { status: 'error', characterKey, head: null, durable: false, message: 'busy' };
      this.head = null; this.draft = null; this.statusKey = 'busy'; this.render();
    }
    return true;
  }

  close() {
    if (!this.active) return false;
    this.active = false; this.container.hidden = true;
    return false;
  }

  reset() {
    this.active = false; this.characterKey = null; this.name = ''; this.draft = null; this.head = null;
    this.reloadRequested = false; this.savePending = false; this.statusKey = '';
    this.state = { status: 'offline', characterKey: null, head: null, durable: false, message: '' };
    this.container.hidden = true; this.personality.value = '';
    this.goalList.replaceChildren(); this.status.textContent = '';
    return false;
  }

  onClientState(state) {
    const previousStatus = this.state.status;
    if (state.status === 'signed_out' || state.status === 'offline') { this.state = state; this.reset(); return; }
    if (!this.active || state.characterKey !== this.characterKey) return;
    this.state = state;
    if (state.status === 'ready' && state.head) {
      const completedSave = previousStatus === 'saving' || this.savePending;
      const shouldAdopt = !this.draft || this.reloadRequested;
      this.head = clone(state.head);
      if (shouldAdopt) this.draft = state.head.config ? clone(state.head.config) : blankConfig();
      this.reloadRequested = false;
      this.savePending = false;
      this.statusKey = state.durable && completedSave ? 'saved' : '';
    } else if (state.status === 'conflict') {
      this.head = state.head ? clone(state.head) : this.head;
      this.savePending = false;
      this.statusKey = 'conflict';
    } else if (state.status === 'uncertain') {
      this.savePending = false; this.statusKey = 'uncertain';
    } else if (state.status === 'error') {
      this.savePending = false; this.statusKey = state.message || 'error';
    } else if (state.status === 'loading') {
      this.statusKey = 'loading';
    } else if (state.status === 'saving') {
      this.statusKey = 'saving';
    }
    this.render();
    // Bring the result into view without keeping a sticky compositor layer over the form.
    if (!['loading', 'saving'].includes(state.status)) this.container.scrollTop = 0;
  }

  save() {
    if (!this.active || this.editingLocked() || !this.draft || this.state.status !== 'ready' || !this.state.durable) return false;
    let config;
    try { config = validateCompanionConfig(this.draft); } catch { this.statusKey = 'invalid_request'; this.render(); return false; }
    this.savePending = true; this.statusKey = 'saving'; this.render();
    const sent = this.client.save(config);
    if (!sent) { this.savePending = false; this.statusKey = this.state.status === 'uncertain' ? 'uncertain' : 'error'; this.render(); }
    return sent;
  }

  reload() {
    if (!this.active || this.reloadRequested || ['loading', 'saving'].includes(this.state.status)) return false;
    this.reloadRequested = true;
    this.statusKey = 'loading'; this.render();
    const sent = this.client.load(this.characterKey);
    if (!sent) {
      this.reloadRequested = false; this.statusKey = 'busy';
      this.state = { ...this.state, status: 'error', characterKey: this.characterKey, message: 'busy' };
      this.render();
    }
    return sent;
  }

  addGoal() {
    if (this.editingLocked() || !this.draft || this.draft.goals.length >= 16) return false;
    const id = `goal-${crypto.randomUUID()}`;
    this.draft.goals.push({ id, status: 'active', text: '', constraints: [] });
    this.render(`goal-text:${id}`);
    return true;
  }
  removeGoal(id) {
    if (this.editingLocked() || !this.draft || typeof id !== 'string') return;
    const index = this.draft.goals.findIndex((goal) => goal.id === id);
    this.draft.goals = this.draft.goals.filter((goal) => goal.id !== id);
    const next = this.draft.goals[index] || this.draft.goals[index - 1];
    this.render(next ? `goal-text:${next.id}` : 'add-goal');
  }

  render(focusKey = null) {
    const copy = this.text();
    const activeElement = document.activeElement;
    const priorFocus = focusKey || activeElement?.dataset?.focusKey || null;
    const name = this.name || copy.title.replace(/^Configure |^Configurar a /, '');
    this.title.textContent = copy.title.replace('{name}', name || (this.lang === 'en' ? 'companion' : 'compañero'));
    this.backButton.textContent = copy.back;
    this.personalityLabelText.textContent = copy.personality;
    this.personality.value = this.draft?.personality ?? '';
    this.personalityHelp.id ||= `${this.personality.id}-help`;
    this.personality.setAttribute('aria-describedby', this.personalityHelp.id);
    const locked = this.editingLocked();
    this.personality.disabled = locked || !this.draft;
    this.personalityHelp.textContent = copy.personalityHelp;
    this.goalsHeading.textContent = copy.goals;
    this.addButton.textContent = copy.addGoal;
    this.addButton.disabled = locked || !this.draft || this.draft.goals.length >= 16;
    this.durableNote.textContent = this.state.durable ? copy.durable : copy.preview;
    this.usageNote.textContent = copy.notApplied;
    const statusKey = this.statusKey || (this.state.status === 'offline' || this.state.status === 'signed_out' ? this.state.status : '');
    this.status.textContent = statusKey ? copy[statusKey] || copy.error : (this.head?.revision === 0 ? copy.unchanged : '');
    this.saveButton.textContent = this.state.status === 'saving' || this.savePending ? copy.saving : copy.save;
    this.saveButton.disabled = locked || !this.draft || !this.state.durable || this.state.status !== 'ready';
    this.reloadButton.textContent = this.state.status === 'loading' ? copy.loading : copy.reload;
    this.reloadButton.disabled = !this.active || this.reloadRequested || ['loading', 'saving'].includes(this.state.status);
    this.goalList.replaceChildren();
    for (const goal of this.draft?.goals || []) this.goalList.append(this.goalNode(goal, copy));
    if (priorFocus) {
      const target = [...this.container.querySelectorAll?.('[data-focus-key]') || []].find((item) => item.dataset.focusKey === priorFocus);
      target?.focus?.({ preventScroll: true });
    }
  }

  goalNode(goal, copy) {
    const item = node('li', 'mn-companion-config-goal');
    const top = node('div', 'mn-companion-config-goal-top');
    const statusLabel = node('label'); const statusName = node('span', '', copy.status);
    const select = node('select'); select.dataset.focusKey = `goal-status:${goal.id}`; select.disabled = this.editingLocked();
    select.setAttribute('aria-label', `${copy.status}: ${goal.text || copy.goalText}`);
    for (const value of STATUSES) {
      const option = node('option', '', copy[value]); option.value = value; option.selected = goal.status === value; select.append(option);
    }
    statusLabel.append(statusName, select);
    const remove = node('button'); remove.type = 'button'; remove.textContent = copy.removeGoal;
    remove.dataset.action = 'remove-goal'; remove.dataset.goalId = goal.id;
    remove.disabled = this.editingLocked();
    top.append(statusLabel, remove);
    const textLabel = node('label'); const textName = node('span', '', copy.goalText);
    const text = node('textarea', 'mn-companion-config-goal-text'); text.maxLength = 2000;
    text.dataset.focusKey = `goal-text:${goal.id}`; text.value = goal.text; text.disabled = this.editingLocked();
    textLabel.append(textName, text);
    const constraintsLabel = node('label'); const constraintsName = node('span', '', copy.constraints);
    const constraints = node('textarea', 'mn-companion-config-constraints'); constraints.maxLength = 4000;
    constraints.dataset.focusKey = `goal-constraints:${goal.id}`; constraints.value = goal.constraints.join('\n');
    constraints.disabled = this.editingLocked();
    constraintsLabel.append(constraintsName, constraints);
    select.addEventListener('change', () => { if (!this.editingLocked()) goal.status = select.value; });
    text.addEventListener('input', () => { if (!this.editingLocked()) goal.text = text.value; });
    constraints.addEventListener('input', () => {
      if (!this.editingLocked()) goal.constraints = constraints.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    });
    item.append(top, textLabel, constraintsLabel);
    return item;
  }
}
