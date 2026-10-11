import { DEFAULT_COMPANION_PRESET, companionCreationConfig, randomCompanionPreset, validateCompanionPreset } from '../net/companionCreation.js';
import { PERSONALITY_TEMPLATES, ROLE_TEMPLATES, TRAIT_TEMPLATES, COMPANION_LOOKS } from '../net/companionTemplates.js';

const COPY = {
  es: { title: 'Crear compañero', back: 'Volver', name: 'Nombre', role: 'Oficio y perspectiva', personality: 'Personalidad',
    traits: 'Rasgos (hasta 3)', look: 'Aspecto', random: 'Sortear opciones', review: 'Revisar documentos', edit: 'Volver al borrador',
    confirmation: 'Confirmo la creación de este compañero y sus documentos.', create: 'Crear compañero', creating: 'Creando…', reload: 'Recargar estado',
    unavailable: 'La creación durable no está disponible. Puedes volver o recargar el estado.', loading: 'Consultando el servidor…',
    ready: 'Revisa el borrador y confirma cuando esté listo.', uncertain: 'No se pudo confirmar la creación. Recarga para comprobar el resultado; si sigue incierto puedes repetir la misma solicitud.',
    retry: 'Repetir la misma solicitud', forbidden: 'Esta cuenta no puede crear un compañero.', invalid_request: 'Revisa los datos del borrador.',
    conflict: 'Ya existe una creación para esta cuenta. Recarga el estado.', limit: 'Se alcanzó el límite de compañeros.', busy: 'Hay otra operación en curso.',
    error: 'No se pudo completar la solicitud.', saved: 'Compañero preparado y detenido.', identity: 'Identidad', status: 'Estado', stopped: 'Detenido',
    personalityDoc: 'Documento de personalidad guardado', goals: 'Objetivos guardados', prepared: 'Preparado', confirmationRequired: 'Confirma antes de crear.',
    nextStep: 'El siguiente paso será emparejar el runner local y entrar al mundo. Este estado no activa una conexión.',
    looksNames: { Corsario: 'Corsair', Exploradora: 'Explorer', Bucanero: 'Buccaneer', Tormenta: 'Storm', Brasa: 'Ember' },
    roleNames: { sailor: 'Marinero', marine: 'Infante de marina', builder: 'Constructor', harvester: 'Recolector', resident: 'Residente de Salty Shore' },
    personalityNames: { warm: 'Cálida', calm: 'Serena', curious: 'Curiosa', direct: 'Directa', playful: 'Juguetona' },
    traitsNames: { curious: 'Curiosa', prudent: 'Prudente', kind: 'Bondadosa', brave: 'Valiente', patient: 'Paciente', resourceful: 'Ingeniosa', sociable: 'Sociable', steadfast: 'Firme' } },
  en: { title: 'Create companion', back: 'Back', name: 'Name', role: 'Role and perspective', personality: 'Personality',
    traits: 'Traits (up to 3)', look: 'Appearance', random: 'Randomize choices', review: 'Review documents', edit: 'Back to draft',
    confirmation: 'I confirm creation of this companion and its documents.', create: 'Create companion', creating: 'Creating…', reload: 'Reload status',
    unavailable: 'Durable creation is unavailable. You can go back or reload the status.', loading: 'Checking the server…',
    ready: 'Review the draft and confirm when it is ready.', uncertain: 'Creation could not be confirmed. Reload to check the result; if it remains uncertain, retry the same request.',
    retry: 'Retry the same request', forbidden: 'This account cannot create a companion.', invalid_request: 'Check the draft fields.',
    conflict: 'A companion already exists for this account. Reload the status.', limit: 'The companion limit was reached.', busy: 'Another operation is in progress.',
    error: 'The request could not be completed.', saved: 'Companion prepared and stopped.', identity: 'Identity', status: 'Status', stopped: 'Stopped',
    personalityDoc: 'Saved personality document', goals: 'Saved goals', prepared: 'Prepared', confirmationRequired: 'Confirm before creating.',
    nextStep: 'Next, pair the local runner and enter the world. This prepared state does not activate a connection.',
    looksNames: { Corsario: 'Corsair', Exploradora: 'Explorer', Bucanero: 'Buccaneer', Tormenta: 'Storm', Brasa: 'Ember' },
    roleNames: { sailor: 'Sailor', marine: 'Marine', builder: 'Builder', harvester: 'Harvester', resident: 'Salty Shore resident' },
    personalityNames: { warm: 'Warm', calm: 'Calm', curious: 'Curious', direct: 'Direct', playful: 'Playful' },
    traitsNames: { curious: 'Curious', prudent: 'Prudent', kind: 'Kind', brave: 'Brave', patient: 'Patient', resourceful: 'Resourceful', sociable: 'Sociable', steadfast: 'Steadfast' } },
};
const node = (tag, className = '', text = '') => { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; };
const clone = value => structuredClone(value);
let instanceSequence = 0;
const CSS = `.mn-companion-create{display:grid;gap:12px;min-width:0;width:100%;max-width:100%;box-sizing:border-box}.mn-companion-create[hidden],.mn-companion-create [hidden]{display:none!important}.mn-companion-create>*{min-width:0;overflow-wrap:anywhere}.mn-companion-create-header,.mn-companion-create-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.mn-companion-create-header h3{margin:0;font-size:1.05rem}.mn-companion-create label{display:grid;gap:6px;font-weight:650}.mn-companion-create input,.mn-companion-create select,.mn-companion-create textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid #78674f;border-radius:8px;background:#211e19;color:#f4ead6;padding:10px;font:500 14px/1.4 system-ui,sans-serif}.mn-companion-create button{min-height:44px;border:1px solid #8c7656;border-radius:9px;background:#29241e;color:#f4ead6;padding:9px 12px;font:600 14px/1.3 system-ui,sans-serif;cursor:pointer}.mn-companion-create button:disabled{opacity:.6;cursor:wait}.mn-companion-create button:focus-visible,.mn-companion-create input:focus-visible,.mn-companion-create select:focus-visible{outline:2px solid #e5c477;outline-offset:2px}.mn-companion-create-status{min-height:1.4em;margin:0;color:#d6c6aa}.mn-companion-create-traits,.mn-companion-create-looks{display:grid;gap:8px}.mn-companion-create-choice{display:flex!important;align-items:center;gap:8px!important}.mn-companion-create-choice input{width:20px}.mn-companion-create-review,.mn-companion-create-saved{display:grid;gap:8px;padding:12px;border:1px solid #514736;border-radius:10px;background:#211e19}.mn-companion-create-doc{white-space:pre-wrap;overflow-wrap:anywhere}.mn-companion-create-actions{flex-wrap:wrap}@media(max-width:600px){.mn-companion-create-header,.mn-companion-create-actions{align-items:stretch;flex-direction:column}.mn-companion-create-header button,.mn-companion-create-actions button{width:100%}.mn-companion-create input,.mn-companion-create select{font-size:16px}}`;

/** Owner-facing creation wizard; documents remain in memory until a durable receipt arrives. */
export class CompanionCreationUI {
  constructor(parent, { client, lang = 'es', onClose = () => {} } = {}) {
    if (!parent?.append || !client?.load || !client?.create || !client?.subscribe) throw new TypeError('CompanionCreationUI requiere parent y client.');
    this.parent = parent; this.client = client; this.lang = lang === 'en' ? 'en' : 'es'; this.onClose = onClose;
    this.active = false; this.reviewing = false; this.confirmed = false; this.draft = null; this.state = client.snapshot?.() || { status: 'offline', record: null, available: false, durable: false };
    this.statusKey = '';
    const id = ++instanceSequence;
    this.container = node('section', 'mn-companion-create'); this.container.hidden = true;
    this.container.setAttribute('aria-labelledby', `mn-companion-create-title-${id}`);
    this.title = node('h3'); this.title.id = `mn-companion-create-title-${id}`;
    this.backButton = node('button', 'mn-companion-create-back'); this.backButton.type = 'button';
    this.backButton.addEventListener('click', () => { this.close(); this.onClose(); });
    const header = node('header', 'mn-companion-create-header'); header.append(this.title, this.backButton);
    this.status = node('p', 'mn-companion-create-status'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.form = node('div', 'mn-companion-create-form');
    this.nameInput = this.input('text', 'name'); this.nameInput.maxLength = 16;
    this.roleSelect = this.select('role'); this.personalitySelect = this.select('personality');
    this.traits = node('fieldset', 'mn-companion-create-traits'); this.traitsLegend = node('legend'); this.traits.append(this.traitsLegend);
    this.looks = node('fieldset', 'mn-companion-create-looks'); this.looksLegend = node('legend'); this.looks.append(this.looksLegend);
    this.randomButton = node('button'); this.randomButton.type = 'button'; this.randomButton.addEventListener('click', () => this.randomize());
    this.reviewButton = node('button'); this.reviewButton.type = 'button'; this.reviewButton.addEventListener('click', () => this.review());
    this.form.append(this.nameInput.label, this.roleSelect.label, this.personalitySelect.label, this.traits, this.looks, this.randomButton, this.reviewButton);
    this.reviewPanel = node('section', 'mn-companion-create-review'); this.reviewPanel.hidden = true;
    this.reviewHeading = node('h4'); this.reviewPersonality = node('pre', 'mn-companion-create-doc'); this.reviewGoals = node('ul');
    this.confirmLabel = node('label', 'mn-companion-create-choice'); this.confirmInput = node('input'); this.confirmInput.type = 'checkbox';
    this.confirmInput.addEventListener('change', () => { this.confirmed = this.confirmInput.checked; this.render(); });
    this.confirmText = node('span'); this.confirmLabel.append(this.confirmInput, this.confirmText);
    this.createButton = node('button'); this.createButton.type = 'button'; this.createButton.addEventListener('click', () => this.create());
    this.reviewBackButton = node('button'); this.reviewBackButton.type = 'button'; this.reviewBackButton.addEventListener('click', () => { this.reviewing = false; this.confirmed = false; this.render(); });
    this.reviewPanel.append(this.reviewHeading, this.reviewPersonality, this.reviewGoals, this.confirmLabel, this.reviewBackButton, this.createButton);
    this.saved = node('section', 'mn-companion-create-saved'); this.saved.hidden = true;
    this.savedHeading = node('h4'); this.identity = node('p'); this.savedStatus = node('p'); this.savedName = node('p');
    this.nextStep = node('p', 'mn-companion-create-note');
    this.savedPersonalityTitle = node('h5'); this.savedPersonality = node('pre', 'mn-companion-create-doc'); this.savedGoalsTitle = node('h5'); this.savedGoals = node('ul');
    this.saved.append(this.savedHeading, this.identity, this.savedStatus, this.savedName, this.nextStep, this.savedPersonalityTitle, this.savedPersonality, this.savedGoalsTitle, this.savedGoals);
    this.reloadButton = node('button'); this.reloadButton.type = 'button'; this.reloadButton.addEventListener('click', () => this.reload());
    this.retryButton = node('button'); this.retryButton.type = 'button'; this.retryButton.addEventListener('click', () => this.client.retry?.());
    const actions = node('footer', 'mn-companion-create-actions'); actions.append(this.reloadButton, this.retryButton);
    this.container.append(header, this.status, this.form, this.reviewPanel, this.saved, actions); this.element = this.container; parent.append(this.container);
    this.installStyles();
    this.unsubscribe = client.subscribe(state => this.onClientState(state));
    this.container.addEventListener('change', event => this.onChoiceChange(event));
    this.render();
  }
  input(type, key) {
    const label = node('label'); const title = node('span'); const input = node('input'); input.type = type; input.dataset.field = key;
    label.append(title, input); input.addEventListener('input', () => { if (this.draft) { this.draft[key] = input.value; this.confirmed = false; } });
    return { label, title, input };
  }
  select(key) { const label = node('label'); const title = node('span'); const select = node('select'); select.dataset.field = key;
    label.append(title, select); select.addEventListener('change', () => { if (this.draft) { this.draft[key] = select.value; this.confirmed = false; } });
    return { label, title, select };
  }
  get isOpen() { return this.active; }
  installStyles() { if (!document.head || document.getElementById?.('mn-companion-create-style')) return; const style = node('style'); style.id = 'mn-companion-create-style'; style.textContent = CSS; document.head.append(style); }
  text() { return COPY[this.lang]; }
  setLanguage(lang) { this.lang = lang === 'en' ? 'en' : 'es'; this.render(); }
  open() {
    this.active = true; this.reviewing = false; this.confirmed = false; this.draft = clone(DEFAULT_COMPANION_PRESET);
    this.statusKey = '';
    this.state = this.client.snapshot?.() || this.state; this.container.hidden = false; this.render();
    if (!this.client.load()) { this.statusKey = 'busy'; this.render(); return false; }
    return true;
  }
  close() { if (!this.active) return false; this.active = false; this.container.hidden = true; return true; }
  reset() {
    this.active = false; this.reviewing = false; this.confirmed = false; this.draft = null;
    this.state = { ...this.state, available: false, durable: false, record: null };
    this.container.hidden = true; this.nameInput.input.value = ''; this.reviewPersonality.textContent = ''; this.savedPersonality.textContent = '';
    this.reviewGoals.replaceChildren(); this.savedGoals.replaceChildren(); this.status.textContent = '';
    this.identity.textContent = ''; this.savedStatus.textContent = ''; this.savedName.textContent = ''; this.nextStep.textContent = '';
    this.savedHeading.textContent = ''; this.savedPersonalityTitle.textContent = ''; this.savedGoalsTitle.textContent = '';
    this.roleSelect.select.replaceChildren(); this.personalitySelect.select.replaceChildren(); this.confirmInput.checked = false;
    this.saved.hidden = true; this.form.hidden = false; this.reviewPanel.hidden = true;
    this.traits.replaceChildren(this.traitsLegend); this.looks.replaceChildren(this.looksLegend); this.statusKey = ''; return false;
  }
  onClientState(state) {
    if (state.status === 'signed_out' || state.status === 'offline') { this.state = state; this.reset(); return; }
    this.state = state;
    if (state.status === 'ready') {
      this.statusKey = '';
      if (state.record) { this.draft = clone(state.record.preset); this.reviewing = false; }
      else if (!this.draft) this.draft = clone(DEFAULT_COMPANION_PRESET);
    } else if (state.status === 'uncertain') this.statusKey = 'uncertain';
    else if (state.status === 'loading') this.statusKey = 'loading';
    else if (state.status === 'creating') this.statusKey = 'creating';
    else if (state.status === 'error') this.statusKey = state.message || 'error';
    if (this.active) this.render();
  }
  onChoiceChange(event) {
    const field = event.target?.dataset?.field;
    if (field === 'trait' && this.draft) {
      const selected = [...this.traits.querySelectorAll?.('input[data-field="trait"]') || []].filter(input => input.checked).map(input => input.value);
      const focusKey = event.target.dataset.focusKey;
      if (selected.length > 3) { event.target.checked = false; event.target.focus?.(); return; }
      this.draft.traits = selected; this.confirmed = false; this.render(focusKey);
    } else if (field === 'skin' && this.draft) {
      const focusKey = event.target.dataset.focusKey; this.draft.skin = Number(event.target.value); this.confirmed = false; this.render(focusKey);
    }
  }
  randomize() {
    if (!this.active || !this.draft || this.state.status === 'creating') return false;
    this.draft = randomCompanionPreset(crypto.randomUUID(), { name: this.draft.name }); this.reviewing = false; this.confirmed = false; this.render(); return true;
  }
  review() {
    if (!this.active || !this.draft || this.state.status === 'creating') return false;
    try { this.draft = validateCompanionPreset(this.draft); } catch { this.statusKey = 'invalid_request'; this.render(); return false; }
    this.reviewing = true; this.confirmed = false; this.statusKey = ''; this.render(); return true;
  }
  create() {
    if (!this.active || !this.reviewing || !this.confirmed || this.state.status !== 'ready' || !this.state.available || !this.state.durable || this.state.record) return false;
    const sent = this.client.create(clone(this.draft));
    if (!sent) { this.statusKey = this.state.status === 'uncertain' ? 'uncertain' : 'error'; this.render(); }
    return sent;
  }
  reload() {
    if (!this.active || this.state.status === 'loading' || this.state.status === 'creating') return false;
    this.statusKey = 'loading'; this.render();
    const sent = this.client.load();
    if (!sent) { this.statusKey = 'busy'; this.render(); }
    return sent;
  }
  render(focusKey = null) {
    const priorFocus = focusKey || document.activeElement?.dataset?.focusKey || null;
    const c = this.text(); this.title.textContent = c.title; this.backButton.textContent = c.back;
    this.nameInput.title.textContent = c.name; this.roleSelect.title.textContent = c.role; this.personalitySelect.title.textContent = c.personality;
    this.traitsLegend.textContent = c.traits; this.looksLegend.textContent = c.look; this.randomButton.textContent = c.random;
    this.reviewButton.textContent = c.review; this.reviewHeading.textContent = c.review; this.reviewBackButton.textContent = c.edit;
    this.confirmText.textContent = c.confirmation; this.createButton.textContent = this.state.status === 'creating' ? c.creating : c.create;
    this.reloadButton.textContent = c.reload; this.retryButton.textContent = c.retry;
    const record = this.state.record;
    this.form.hidden = !!record || this.reviewing; this.reviewPanel.hidden = !this.reviewing || !!record; this.saved.hidden = !record;
    this.reloadButton.hidden = this.state.status !== 'error' && this.state.status !== 'uncertain' && this.state.status !== 'ready';
    this.retryButton.hidden = this.state.status !== 'uncertain';
    this.status.textContent = this.statusKey ? c[this.statusKey] || c.error : this.state.status === 'ready' && !record
      ? (!this.state.available || !this.state.durable ? c.unavailable : c.ready) : '';
    const locked = this.state.status === 'creating' || this.state.status === 'loading';
    this.nameInput.input.value = this.draft?.name || ''; this.nameInput.input.disabled = locked;
    const options = (select, values, names, selected) => { select.replaceChildren(); for (const [key, item] of Object.entries(values)) { const option = node('option', '', names[key] || item.label || key); option.value = key; option.selected = key === selected; select.append(option); } select.disabled = locked; };
    options(this.roleSelect.select, ROLE_TEMPLATES, c.roleNames, this.draft?.role); options(this.personalitySelect.select, PERSONALITY_TEMPLATES, c.personalityNames, this.draft?.personality);
    this.traits.replaceChildren(this.traitsLegend);
    for (const [key, description] of Object.entries(TRAIT_TEMPLATES)) { const label = node('label', 'mn-companion-create-choice'); const check = node('input'); check.type = 'checkbox'; check.value = key; check.dataset.field = 'trait'; check.dataset.focusKey = `trait:${key}`; check.checked = this.draft?.traits.includes(key) || false; check.disabled = locked || (this.draft?.traits.length >= 3 && !check.checked); label.append(check, node('span', '', c.traitsNames[key] || description)); this.traits.append(label); }
    this.looks.replaceChildren(this.looksLegend);
    for (const option of COMPANION_LOOKS) { const label = node('label', 'mn-companion-create-choice'); const radio = node('input'); radio.type = 'radio'; radio.name = `companion-look-${this.title.id}`; radio.value = String(option.skin); radio.dataset.field = 'skin'; radio.dataset.focusKey = `skin:${option.skin}`; radio.checked = this.draft?.skin === option.skin; radio.disabled = locked; label.append(radio, node('span', '', c.looksNames[option.name] || option.name)); this.looks.append(label); }
    this.randomButton.disabled = locked || !this.draft; this.reviewButton.disabled = locked || !this.draft;
    if (this.reviewing && this.draft && !record) {
      try { const preview = companionCreationConfig(this.draft); this.reviewPersonality.textContent = preview.personality; this.reviewGoals.replaceChildren(...preview.goals.map(goal => node('li', '', `${goal.text}\n${goal.constraints.join('\n')}`))); }
      catch { this.reviewPersonality.textContent = ''; this.reviewGoals.replaceChildren(); }
    }
    this.confirmInput.checked = this.confirmed; this.confirmInput.disabled = locked;
    this.createButton.disabled = locked || !this.confirmed || !this.state.available || !this.state.durable || !!record || this.state.status !== 'ready';
    if (record) {
      const config = record.configuration.config; this.savedHeading.textContent = c.saved; this.identity.textContent = `${c.identity}: ${record.characterKey}`;
      this.savedStatus.textContent = `${c.status}: ${record.control.stopped ? c.stopped : c.prepared}`; this.savedName.textContent = `${c.name}: ${record.preset.name}`;
      this.nextStep.textContent = c.nextStep;
      this.savedPersonalityTitle.textContent = c.personalityDoc; this.savedPersonality.textContent = config.personality;
      this.savedGoalsTitle.textContent = c.goals; this.savedGoals.replaceChildren(...config.goals.map(goal => node('li', '', `${goal.text}\n${goal.constraints.join('\n')}`)));
    }
    if (priorFocus) [...this.container.querySelectorAll?.('[data-focus-key]') || []].find(item => item.dataset.focusKey === priorFocus)?.focus?.({ preventScroll: true });
  }
}
