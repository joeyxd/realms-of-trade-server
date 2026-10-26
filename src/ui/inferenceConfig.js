import { formatInferenceUsd, parseInferenceUsd, validateInferenceConfig } from '../net/inferenceConfig.js';

const COPY = {
  es: {
    title: 'Centro de inferencia', back: 'Volver', accountCeiling: 'Tope compartido de cuenta (USD)',
    connectionCeilings: 'Topes por conexión', characterChoices: 'Conexión y modelo por compañero',
    connection: 'Conexión', model: 'Modelo', unassigned: 'Sin asignar', chooseConnection: 'Elige una conexión', chooseModel: 'Elige un modelo',
    catalogMax: maximum => `Máximo admitido de configuración: $${maximum} USD.`,
    noCatalog: 'No hay conexiones admitidas disponibles para esta cuenta.', noCharacters: 'No hay compañeros vinculados a esta cuenta.',
    addNote: 'El tope de cuenta es compartido por todas las conexiones. Cada conexión tiene una sola fila de límite que comparten sus compañeros. Son límites preparados, no saldo ni uso.',
    prepared: 'Límites preparados; la inferencia aún no está disponible. Guardar no inicia una conexión ni genera texto.',
    catalogNote: 'El catálogo indica qué puede seleccionarse; no confirma que el proveedor esté disponible.',
    noConnectionTitle: 'Conexión al modelo pendiente',
    noConnectionHelp: 'Esta cuenta aún no tiene conexiones disponibles. Aquí todavía no puedes añadir una URL ni crear un compañero. Puedes volver al juego sin indicar un gasto.',
    preservedConfig: 'Tus límites y selecciones se conservan. Podrás editarlos cuando haya conexiones disponibles.',
    save: 'Guardar', saving: 'Guardando…', reload: 'Cargar versión del servidor', loading: 'Cargando…',
    saved: 'Configuración guardada. No inicia inferencia.', unchanged: 'Aún no hay configuración guardada.',
    durable: 'Esta configuración se guarda de forma privada y durable.', preview: 'El servidor aún no confirma almacenamiento durable.',
    conflict: 'Otra sesión guardó cambios. Tu borrador se conserva; carga la versión del servidor para adoptarlos.',
    uncertain: 'No se pudo confirmar el guardado. Tu borrador se conserva; carga la versión del servidor antes de volver a guardar.',
    timeout: 'La consulta tardó demasiado; el resultado del guardado es incierto. Carga la versión del servidor.',
    forbidden: 'No tienes acceso a esta configuración.', invalid_request: 'La configuración no es válida.',
    unavailable: 'El almacenamiento no está disponible.', busy: 'Hay otra operación en curso. Espera y carga la configuración de nuevo.',
    must_stop: 'Detén todos tus compañeros y vuelve a cargar antes de guardar esta configuración.',
    ineligible: 'Una conexión o modelo ya no está admitido. Revisa las selecciones antes de guardar.',
    offline: 'Conéctate al mundo para editar esta configuración.', signed_out: 'Inicia sesión para editar esta configuración.',
    error: 'No se pudo cargar o guardar la configuración.', invalidAmount: 'Escribe un importe en USD válido en cada campo requerido.',
    amountRequired: 'Escribe un tope de cuenta explícito; no se establece uno por defecto.',
    amountTooHigh: 'El tope de esta conexión supera el máximo admitido.', incomplete: 'Elige un modelo o quita la conexión incompleta.',
    connectionOverAccount: 'El tope de conexión no puede superar el tope compartido de cuenta.',
    unavailableChoice: 'Selección ya no disponible', remove: 'Quitar', ownerlessCharacter: 'Compañero ya no vinculado',
  },
  en: {
    title: 'Inference Center', back: 'Back', accountCeiling: 'Shared account ceiling (USD)',
    connectionCeilings: 'Connection ceilings', characterChoices: 'Connection and model per companion',
    connection: 'Connection', model: 'Model', unassigned: 'Unassigned', chooseConnection: 'Choose a connection', chooseModel: 'Choose a model',
    catalogMax: maximum => `Maximum eligible configuration ceiling: $${maximum} USD.`,
    noCatalog: 'No eligible connections are available for this account.', noCharacters: 'No companions are linked to this account.',
    addNote: 'The account ceiling is shared across all connections. Each connection has one limit row shared by its companions. These are prepared limits, not balance or usage.',
    prepared: 'Limits are prepared; inference is not available yet. Saving does not connect or generate text.',
    catalogNote: 'The catalog says what can be selected; it does not confirm provider availability.',
    noConnectionTitle: 'Model connection pending',
    noConnectionHelp: 'This account has no available connections yet. You cannot add a URL or create a companion here yet. You can return to the game without entering a spending limit.',
    preservedConfig: 'Your limits and selections are preserved. You can edit them when connections are available.',
    save: 'Save', saving: 'Saving…', reload: 'Load server version', loading: 'Loading…',
    saved: 'Configuration saved. Inference was not started.', unchanged: 'No configuration has been saved yet.',
    durable: 'This configuration is saved privately and durably.', preview: 'The server has not confirmed durable storage.',
    conflict: 'Another session saved changes. Your draft is preserved; load the server version to adopt them.',
    uncertain: 'The save could not be confirmed. Your draft is preserved; load the server version before saving again.',
    timeout: 'The request took too long; the save result is uncertain. Load the server version.',
    forbidden: 'You cannot access this configuration.', invalid_request: 'The configuration is invalid.',
    unavailable: 'Storage is unavailable.', busy: 'Another operation is in progress. Wait, then load the configuration again.',
    must_stop: 'Stop all your companions and reload before saving this configuration.',
    ineligible: 'A connection or model is no longer eligible. Review selections before saving.',
    offline: 'Connect to the world to edit this configuration.', signed_out: 'Sign in to edit this configuration.',
    error: 'Could not load or save the configuration.', invalidAmount: 'Enter a valid USD amount in each required field.',
    amountRequired: 'Enter an explicit account ceiling; none is set by default.',
    amountTooHigh: 'This connection ceiling exceeds the eligible maximum.', incomplete: 'Choose a model or remove the incomplete connection.',
    connectionOverAccount: 'A connection ceiling cannot exceed the shared account ceiling.',
    unavailableChoice: 'Selection no longer available', remove: 'Remove', ownerlessCharacter: 'Companion no longer linked',
  },
};

let instanceSequence = 0;
const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
};
const clone = value => structuredClone(value);
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const blankDraft = () => ({ ceilingUsd: '', connections: [], companions: [] });
const fromConfig = config => config ? ({
  ceilingUsd: formatInferenceUsd(config.ceilingNanoUsd),
  connections: config.connections.map(row => ({ id: row.id, ceilingUsd: formatInferenceUsd(row.ceilingNanoUsd) })),
  companions: config.companions.map(row => ({ ...row })),
}) : blankDraft();
const styleText = `.mn-inference-config{display:grid;gap:12px;min-width:0;width:100%;max-width:100%;max-height:min(70cqh,520px);overflow:auto;box-sizing:border-box}.mn-inference-config[hidden],.mn-inference-config [hidden]{display:none}.mn-inference-config-header,.mn-inference-config-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.mn-inference-config-header h3,.mn-inference-config h4{margin:0;font-size:1.05rem}.mn-inference-config label{display:grid;gap:6px;min-width:0;font-weight:650;overflow-wrap:anywhere}.mn-inference-config select,.mn-inference-config input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1px solid #78674f;border-radius:8px;background:#211e19;color:#f4ead6;padding:9px 10px;font:500 16px/1.4 system-ui,sans-serif}.mn-inference-config button{min-height:44px;border:1px solid #8c7656;border-radius:9px;background:#29241e;color:#f4ead6;padding:9px 12px;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}.mn-inference-config button:focus-visible,.mn-inference-config input:focus-visible,.mn-inference-config select:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-inference-config button:disabled{opacity:.6;cursor:wait}.mn-inference-config-note,.mn-inference-config-status{margin:0;color:#d6c6aa}.mn-inference-config-status{min-height:1.4em}.mn-inference-config-section,.mn-inference-config-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.mn-inference-config-row{display:grid;gap:8px;min-width:0;padding:10px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-inference-config-row-title{margin:0;font-weight:700;overflow-wrap:anywhere}.mn-inference-config-actions button{flex:1}.mn-companions-panel:has(.mn-inference-config:not([hidden])){overflow:hidden}.mn-inference-config>*{min-width:0;overflow-wrap:anywhere}@media(max-width:600px){.mn-inference-config-header,.mn-inference-config-actions{align-items:stretch;flex-direction:column}.mn-inference-config-header button,.mn-inference-config-actions button{width:100%}}`;

/** Owner-scoped inference configuration editor; saving only stores prepared limits/selections. */
export class InferenceConfigUI {
  constructor(parent, { client, lang = 'es', onClose = () => {} } = {}) {
    if (!parent?.append || !client?.load || !client?.save || !client?.subscribe) throw new TypeError('InferenceConfigUI requiere parent y client.');
    Object.assign(this, { parent, client, onClose, lang: lang === 'en' ? 'en' : 'es' });
    this.active = false; this.draft = null; this.head = null; this.statusKey = ''; this.reloadRequested = false; this.savePending = false;
    this.state = client.snapshot?.() || { status: 'offline', head: null, catalog: [], characters: [], durable: false, message: '' };
    const id = ++instanceSequence;
    this.container = node('section', 'mn-inference-config'); this.container.hidden = true;
    this.container.setAttribute('aria-labelledby', `mn-inference-config-title-${id}`);
    this.title = node('h3'); this.title.id = `mn-inference-config-title-${id}`;
    this.backButton = node('button', 'mn-inference-config-back', ''); this.backButton.type = 'button';
    this.backButton.addEventListener('click', () => { this.close(); this.onClose(); });
    const header = node('header', 'mn-inference-config-header'); header.append(this.title, this.backButton);
    this.status = node('p', 'mn-inference-config-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.durableNote = node('p', 'mn-inference-config-note');
    this.preparedNote = node('p', 'mn-inference-config-note');
    this.catalogNote = node('p', 'mn-inference-config-note');
    this.availability = node('section', 'mn-inference-config-row mn-inference-config-availability');
    this.availabilityTitle = node('h4'); this.availabilityHelp = node('p', 'mn-inference-config-note');
    this.availabilityPreserved = node('p', 'mn-inference-config-note');
    this.availability.append(this.availabilityTitle, this.availabilityHelp, this.availabilityPreserved);
    this.accountLabel = node('label', 'mn-inference-config-account-label'); this.accountLabelText = node('span');
    this.accountCeiling = node('input', 'mn-inference-config-account-ceiling'); this.accountCeiling.type = 'text'; this.accountCeiling.inputMode = 'decimal';
    this.accountCeiling.autocomplete = 'off'; this.accountCeiling.dataset.focusKey = 'account-ceiling';
    this.accountLabel.append(this.accountLabelText, this.accountCeiling);
    this.accountCeiling.addEventListener('input', () => { if (this.draft && !this.locked()) this.draft.ceilingUsd = this.accountCeiling.value; });
    this.connectionsHeading = node('h4', 'mn-inference-config-connections-heading'); this.connectionList = node('ul', 'mn-inference-config-list mn-inference-config-connections');
    this.connectionNote = node('p', 'mn-inference-config-note');
    this.charactersHeading = node('h4', 'mn-inference-config-characters-heading'); this.characterList = node('ul', 'mn-inference-config-list mn-inference-config-characters');
    this.saveButton = node('button', 'mn-inference-config-save'); this.saveButton.type = 'button';
    this.reloadButton = node('button', 'mn-inference-config-reload'); this.reloadButton.type = 'button';
    this.saveButton.addEventListener('click', () => this.save()); this.reloadButton.addEventListener('click', () => this.reload());
    const actions = node('footer', 'mn-inference-config-actions'); actions.append(this.reloadButton, this.saveButton);
    this.container.append(header, this.status, this.availability, this.durableNote, this.preparedNote, this.catalogNote, this.accountLabel,
      this.connectionsHeading, this.connectionList, this.connectionNote, this.charactersHeading, this.characterList, actions);
    this.element = this.container; parent.append(this.container); this.installStyles();
    this.unsubscribe = client.subscribe(state => this.onClientState(state));
    this.container.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); this.close(); this.onClose(); }
    });
    this.render();
  }
  get isOpen() { return this.active; }
  text() { return COPY[this.lang]; }
  locked() { return this.savePending || ['loading', 'saving'].includes(this.state.status) || !this.state.catalog.length; }
  installStyles() {
    if (!document.head || document.getElementById?.('mn-inference-config-style')) return;
    const style = node('style'); style.id = 'mn-inference-config-style'; style.textContent = styleText; document.head.append(style);
  }
  setLanguage(lang) { this.lang = lang === 'en' ? 'en' : 'es'; this.render(); }
  open() {
    const preserveDraft = this.draft !== null;
    this.active = true;
    if (preserveDraft) {
      const latest = this.client.snapshot?.();
      if (latest) this.onClientState(latest);
      this.container.hidden = false; this.render();
      return true;
    }
    this.head = null; this.statusKey = ''; this.reloadRequested = false; this.savePending = false;
    this.state = this.client.snapshot?.() || this.state; this.container.hidden = false; this.render();
    if (!this.client.load() && this.active) { this.state = { ...this.state, status: 'error', message: 'busy' }; this.statusKey = 'busy'; this.render(); }
    return true;
  }
  close() { if (!this.active) return false; this.active = false; this.container.hidden = true; return true; }
  reset() {
    this.active = false; this.draft = null; this.head = null; this.statusKey = ''; this.reloadRequested = false; this.savePending = false;
    this.state = { status: 'offline', head: null, catalog: [], characters: [], durable: false, message: '' };
    this.container.hidden = true; this.accountCeiling.value = ''; this.connectionList.replaceChildren(); this.characterList.replaceChildren(); this.status.textContent = '';
  }
  onClientState(state) {
    if (state.status === 'signed_out' || state.status === 'offline') { this.state = state; this.reset(); return; }
    if (!this.active) return;
    const priorStatus = this.state.status; this.state = state;
    if (state.status === 'ready' && state.head) {
      const completedSave = priorStatus === 'saving' || this.savePending;
      if (!this.draft || this.reloadRequested) this.draft = fromConfig(state.head.config);
      this.head = clone(state.head); this.reloadRequested = false; this.savePending = false;
      this.statusKey = state.durable && completedSave ? 'saved' : '';
    } else if (state.status === 'conflict') {
      this.head = state.head ? clone(state.head) : this.head; this.savePending = false; this.statusKey = 'conflict';
    } else if (state.status === 'uncertain') { this.savePending = false; this.statusKey = 'uncertain'; }
    else if (state.status === 'error') { this.savePending = false; this.statusKey = state.message || 'error'; }
    else if (state.status === 'loading') this.statusKey = 'loading';
    else if (state.status === 'saving') this.statusKey = 'saving';
    this.render();
    if (!['loading', 'saving'].includes(state.status)) this.container.scrollTop = 0;
  }
  connectionFor(id) { return this.state.catalog.find(row => row.id === id) || null; }
  ensureConnection(id) {
    if (this.draft && !this.draft.connections.some(row => row.id === id)) this.draft.connections.push({ id, ceilingUsd: '' });
  }
  setAssignment(character, connectionId) {
    if (!this.draft || this.locked()) return;
    this.draft.companions = this.draft.companions.filter(row => row.character !== character);
    if (connectionId) {
      this.ensureConnection(connectionId);
      this.draft.companions.push({ character, connectionId, modelId: '' });
    }
    this.draft.companions.sort((a, b) => compareId(a.character, b.character));
    this.render(`connection:${character}`);
  }
  setModel(character, modelId) {
    const row = this.draft?.companions.find(item => item.character === character);
    if (row && !this.locked()) row.modelId = modelId;
  }
  removeConnection(id) {
    if (!this.draft || this.locked()) return;
    this.draft.connections = this.draft.connections.filter(row => row.id !== id);
    this.draft.companions = this.draft.companions.filter(row => row.connectionId !== id);
    this.render('account-ceiling');
  }
  toConfig() {
    if (!this.draft) return null;
    if (!this.draft.ceilingUsd.trim()) throw new TypeError('amount_required');
    const ceilingNanoUsd = parseInferenceUsd(this.draft.ceilingUsd);
    if (ceilingNanoUsd === null) throw new TypeError('invalid_amount');
    const connections = this.draft.connections.map(row => {
      const ceiling = parseInferenceUsd(row.ceilingUsd), catalog = this.connectionFor(row.id);
      if (ceiling === null) throw new TypeError('invalid_amount');
      if (ceiling > ceilingNanoUsd) throw new TypeError('over_account');
      if (!catalog || ceiling > catalog.maxCeilingNanoUsd) throw new TypeError('ineligible');
      return { id: row.id, ceilingNanoUsd: ceiling };
    }).sort((a, b) => compareId(a.id, b.id));
    const companions = this.draft.companions.map(row => {
      const catalog = this.connectionFor(row.connectionId);
      if (!catalog || !catalog.models.includes(row.modelId)) throw new TypeError('incomplete');
      return { character: row.character, connectionId: row.connectionId, modelId: row.modelId };
    }).sort((a, b) => compareId(a.character, b.character));
    return validateInferenceConfig({ v: 1, ceilingNanoUsd, connections, companions });
  }
  save() {
    if (!this.active || this.locked() || !this.draft || this.state.status !== 'ready' || !this.state.durable || !this.state.catalog.length) return false;
    let config;
    try { config = this.toConfig(); }
    catch (error) { this.statusKey = error.message === 'amount_required' ? 'amountRequired' : error.message === 'invalid_amount' ? 'invalidAmount' : error.message === 'ineligible' ? 'amountTooHigh' : error.message === 'over_account' ? 'connectionOverAccount' : 'incomplete'; this.render(); return false; }
    this.savePending = true; this.statusKey = 'saving'; this.render();
    const sent = this.client.save(config);
    if (!sent) { this.savePending = false; this.statusKey = this.state.status === 'uncertain' ? 'uncertain' : 'error'; this.render(); }
    return sent;
  }
  reload() {
    if (!this.active || this.reloadRequested || ['loading', 'saving'].includes(this.state.status)) return false;
    this.reloadRequested = true; this.statusKey = 'loading'; this.render();
    const sent = this.client.load();
    if (!sent) { this.reloadRequested = false; this.statusKey = 'busy'; this.state = { ...this.state, status: 'error', message: 'busy' }; this.render(); }
    return sent;
  }
  render(focusKey = null) {
    const copy = this.text(), active = document.activeElement;
    const focus = focusKey || active?.dataset?.focusKey || null;
    const noCatalog = this.state.catalog.length === 0;
    const hasPreparedConfig = Boolean(this.head?.config || this.draft?.ceilingUsd.trim()
      || this.draft?.connections.length || this.draft?.companions.length);
    const showForm = !noCatalog || hasPreparedConfig;
    this.availability.hidden = !noCatalog || !this.head;
    this.availabilityTitle.textContent = copy.noConnectionTitle;
    this.availabilityHelp.textContent = copy.noConnectionHelp;
    this.availabilityPreserved.textContent = copy.preservedConfig;
    this.availabilityPreserved.hidden = !hasPreparedConfig;
    for (const el of [this.accountLabel, this.connectionsHeading, this.connectionList, this.connectionNote,
      this.charactersHeading, this.characterList, this.saveButton, this.durableNote, this.catalogNote]) el.hidden = !showForm;
    this.container.dataset.status = this.state.status;
    this.title.textContent = copy.title; this.backButton.textContent = copy.back;
    this.accountLabelText.textContent = copy.accountCeiling; this.accountCeiling.value = this.draft?.ceilingUsd ?? '';
    this.accountCeiling.disabled = this.locked() || !this.draft;
    this.connectionsHeading.textContent = copy.connectionCeilings; this.charactersHeading.textContent = copy.characterChoices;
    this.connectionNote.textContent = copy.addNote; this.preparedNote.textContent = copy.prepared; this.catalogNote.textContent = copy.catalogNote;
    this.durableNote.textContent = this.state.durable ? copy.durable : copy.preview;
    const key = this.statusKey || (['offline', 'signed_out'].includes(this.state.status) ? this.state.status : this.state.message || '');
    this.status.textContent = key ? copy[key] || copy.error : (this.head?.revision === 0 ? copy.unchanged : '');
    const locked = this.locked();
    this.connectionList.replaceChildren();
    for (const row of this.draft?.connections || []) {
      const catalog = this.connectionFor(row.id), item = node('li', 'mn-inference-config-row');
      item.append(node('p', 'mn-inference-config-row-title', catalog?.label || `${copy.unavailableChoice}: ${row.id}`));
      if (catalog) item.append(node('p', 'mn-inference-config-note', copy.catalogMax(formatInferenceUsd(catalog.maxCeilingNanoUsd))));
      const label = node('label'); label.append(node('span', '', `${copy.connectionCeilings}: ${catalog?.label || row.id}`));
      const input = node('input'); input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.value = row.ceilingUsd;
      input.dataset.focusKey = `connection-ceiling:${row.id}`; input.disabled = locked || !catalog;
      input.addEventListener('input', () => { if (!this.locked()) row.ceilingUsd = input.value; }); label.append(input); item.append(label);
      if (!catalog) { const remove = node('button', '', copy.remove); remove.type = 'button'; remove.dataset.focusKey = `remove-connection:${row.id}`;
        remove.disabled = locked; remove.addEventListener('click', () => this.removeConnection(row.id)); item.append(remove); }
      this.connectionList.append(item);
    }
    if (!this.state.catalog.length) this.connectionList.append(node('li', 'mn-inference-config-note', copy.noCatalog));
    this.characterList.replaceChildren();
    if (this.state.catalog.length && this.state.characters.length === 0 && !this.draft?.companions.length) {
      this.characterList.append(node('li', 'mn-inference-config-note', copy.noCharacters));
    } else if (this.state.catalog.length || this.draft?.companions.length) {
      const configuredIds = new Set(this.draft?.companions.map(row => row.character) || []);
      const characters = [...this.state.characters, ...[...configuredIds].filter(id => !this.state.characters.includes(id))].sort();
      for (const character of characters) this.characterList.append(this.characterNode(character, copy, locked));
    }
    this.saveButton.textContent = this.state.status === 'saving' || this.savePending ? copy.saving : copy.save;
    this.saveButton.disabled = locked || !this.draft || !this.state.durable || this.state.status !== 'ready' || !this.state.catalog.length;
    this.reloadButton.textContent = this.state.status === 'loading' ? copy.loading : copy.reload;
    this.reloadButton.disabled = !this.active || this.reloadRequested || ['loading', 'saving'].includes(this.state.status);
    if (focus) {
      const target = [...this.container.querySelectorAll?.('[data-focus-key]') || []].find(el => el.dataset.focusKey === focus);
      if (target && !target.disabled && showForm) target.focus?.({ preventScroll: true });
      else if (active?.dataset?.focusKey) this.backButton.focus?.({ preventScroll: true });
    }
  }
  characterNode(character, copy, locked) {
    const item = node('li', 'mn-inference-config-row');
    const index = this.state.characters.indexOf(character);
    const name = index >= 0 ? `${this.lang === 'en' ? 'Companion' : 'Compañero'} ${index + 1}` : copy.ownerlessCharacter;
    item.append(node('p', 'mn-inference-config-row-title', name));
    const assignment = this.draft?.companions.find(row => row.character === character);
    const connectionLabel = node('label'); connectionLabel.append(node('span', '', copy.connection));
    const connection = node('select'); connection.dataset.focusKey = `connection:${character}`; connection.disabled = locked || this.state.catalog.length === 0;
    const none = node('option', '', copy.unassigned); none.value = ''; none.selected = !assignment; connection.append(none);
    if (assignment && !this.connectionFor(assignment.connectionId)) {
      const stale = node('option', '', `${copy.unavailableChoice}: ${assignment.connectionId}`); stale.value = assignment.connectionId; stale.selected = true; connection.append(stale);
    }
    for (const provider of this.state.catalog) {
      const option = node('option', '', provider.label); option.value = provider.id; option.selected = assignment?.connectionId === provider.id; connection.append(option);
    }
    connection.addEventListener('change', () => this.setAssignment(character, connection.value)); connectionLabel.append(connection); item.append(connectionLabel);
    if (assignment) {
      const modelLabel = node('label'); modelLabel.append(node('span', '', copy.model));
      const model = node('select'); model.dataset.focusKey = `model:${character}`;
      const provider = this.connectionFor(assignment.connectionId); model.disabled = locked || !provider;
      const modelNone = node('option', '', copy.chooseModel); modelNone.value = ''; modelNone.selected = !assignment.modelId; model.append(modelNone);
      if (provider) for (const id of provider.models) { const option = node('option', '', id); option.value = id; option.selected = assignment.modelId === id; model.append(option); }
      else if (assignment.modelId) { const stale = node('option', '', `${copy.unavailableChoice}: ${assignment.modelId}`); stale.value = assignment.modelId; stale.selected = true; model.append(stale); }
      model.addEventListener('change', () => this.setModel(character, model.value)); modelLabel.append(model); item.append(modelLabel);
      if (index < 0) { const remove = node('button', '', copy.remove); remove.type = 'button'; remove.disabled = locked;
        remove.dataset.focusKey = `remove-character:${character}`; remove.addEventListener('click', () => this.setAssignment(character, '')); item.append(remove); }
    }
    return item;
  }
}
