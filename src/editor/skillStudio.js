import { getLocale, onLocaleChange, setLocale } from '../core/locale.js';
import { SkillPreview } from '../render/skillPreview.js';
import { stage } from '../ui/stage.js';
import { SKILLS } from '../data/weapons.js';
import {
  DEFAULT_SKILL_DOCUMENT, SKILL_PARAMETERS, cloneSkillDocument, parseSkillDocument, validateSkillDocument,
} from './skillDocument.js';

const MAX_HISTORY = 100;
const MAX_IMPORT_BYTES = 16 * 1024;
const STYLE_ID = 'mn-skill-studio-style';
const labels = {
  title: ['Taller de habilidades', 'Skill Studio'], private: ['BORRADOR LOCAL · SIN PUBLICAR', 'LOCAL DRAFT · NOT PUBLISHED'],
  close: ['Cerrar', 'Close'], library: ['Biblioteca', 'Library'], tromba: ['Tromba', 'Tromba'], current: ['Efecto actual', 'Current effect'],
  niagara: ['Referencia Niagara', 'Niagara reference'], niagaraPending: ['Pendiente: adaptación verificada', 'Pending: verified adaptation'],
  preview: ['Vista previa 3D', '3D preview'], playback: ['Reproducción', 'Playback'], play: ['Reproducir', 'Play'], pause: ['Pausar', 'Pause'],
  restart: ['Reiniciar', 'Restart'], loop: ['Repetir', 'Loop'], speed: ['Velocidad', 'Speed'], original: ['Original', 'Original'], draft: ['Borrador', 'Draft'],
  visual: ['Parámetros visuales', 'Visual parameters'], character: ['Personaje', 'Character'], skin: ['Aspecto', 'Look'], quality: ['Calidad', 'Quality'],
  desktop: ['Escritorio', 'Desktop'], mobile: ['Móvil', 'Mobile'], impact: ['Reglas de juego (solo lectura)', 'Gameplay rules (read only)'],
  radius: ['Radio', 'Radius'], cooldown: ['Recarga', 'Cooldown'], delay: ['Retardo', 'Delay'], seconds: ['s', 's'], particles: ['Partículas', 'Particles'],
  save: ['Guardar borrador local', 'Save local draft'], load: ['Cargar borrador', 'Load draft'], recover: ['Recuperar cambios', 'Recover changes'],
  export: ['Exportar', 'Export'], import: ['Importar', 'Import'], reset: ['Restaurar valores', 'Reset values'], undo: ['Deshacer', 'Undo'], redo: ['Rehacer', 'Redo'],
  dirtyTitle: ['Hay cambios sin guardar', 'Unsaved changes'], dirtyBody: ['¿Cerrar y conservar una recuperación local?', 'Close and keep a local recovery copy?'],
  stay: ['Seguir editando', 'Keep editing'], discard: ['Cerrar sin guardar', 'Close without saving'], cancel: ['Cancelar', 'Cancel'],
  saved: ['Borrador guardado en este dispositivo.', 'Draft saved on this device.'], loaded: ['Borrador local cargado.', 'Local draft loaded.'],
  recovered: ['Recuperación cargada.', 'Recovery loaded.'], exported: ['Archivo exportado.', 'File exported.'], imported: ['Borrador importado.', 'Draft imported.'],
  resetDone: ['Se restauraron los valores originales.', 'Values restored to defaults.'], undone: ['Cambio deshecho.', 'Change undone.'], redone: ['Cambio rehecho.', 'Change redone.'],
  noDraft: ['No hay un borrador local guardado.', 'There is no saved local draft.'], noRecovery: ['No hay cambios recuperables.', 'There are no recoverable changes.'],
  invalid: ['El documento no es válido. Se conservaron los cambios actuales.', 'The document is invalid. Current changes were kept.'],
  tooLarge: ['El archivo supera 16 KiB.', 'The file exceeds 16 KiB.'], storage: ['El almacenamiento local no está disponible; el borrador sigue abierto en memoria.', 'Local storage is unavailable; the draft remains open in memory.'],
  openFailed: ['No se pudo iniciar la vista previa 3D.', 'The 3D preview could not start.'], closeQuestion: ['¿Cerrar el taller?', 'Close Skill Studio?'],
  metric: ['Coste visual estimado', 'Estimated visual cost'], state: ['Estado', 'Status'], speedNormal: ['Normal', 'Normal'], speedSlow: ['Lento', 'Slow'], speedFast: ['Rápido', 'Fast'],
  duration: ['Duración', 'Duration'], density: ['Densidad', 'Density'], scale: ['Tamaño', 'Scale'], height: ['Altura', 'Height'], spread: ['Dispersión', 'Spread'],
  brightness: ['Brillo', 'Brightness'], deep: ['Agua profunda', 'Deep water'], foam: ['Espuma', 'Foam'],
};
const t = (key, lang = getLocale()) => labels[key]?.[lang === 'en' ? 1 : 0] ?? key;
const number = (value, lang = getLocale()) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-ES', { maximumFractionDigits: 2 }).format(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (action, label, className = '') => {
  const node = el('button', className, label); node.type = 'button'; node.dataset.action = action; return node;
};

function normalizeScope(scope) {
  if (typeof scope === 'string' && scope.trim()) return scope.trim();
  if (scope && typeof scope === 'object') {
    const account = scope.accountId ?? scope.account ?? scope.uid ?? 'local';
    const server = scope.serverId ?? scope.server ?? scope.origin ?? 'local';
    return `${String(server)}:${String(account)}`;
  }
  return 'local:anonymous';
}
function safeStorage() { try { return globalThis.localStorage || null; } catch { return null; } }
function exactEnvelope(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Private, local-only visual editor for the closed Tromba presentation descriptor. */
export class SkillStudio {
  constructor({ parent, renderer, scope, skin = 0, onClose } = {}) {
    if (!parent || !renderer) throw new TypeError('SkillStudio requires parent and renderer');
    Object.assign(this, { parent, renderer, skin, onClose });
    this.scope = normalizeScope(scope);
    this.storageKey = `mn.skill-studio.v1:${encodeURIComponent(this.scope)}`;
    this.recoveryKey = `${this.storageKey}:recovery`;
    this.lang = getLocale();
    this.document = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
    this.savedDocument = cloneSkillDocument(this.document);
    this.undoStack = []; this.redoStack = []; this.gestureStart = null;
    this.preview = null; this.active = false; this.closed = false; this.root = null;
    this.epoch = 0; this.storageUnavailable = false;
    this.previousFocus = null; this.statusText = ''; this.statusKind = '';
    this.unsubscribeLocale = onLocaleChange((lang) => { this.lang = lang; this.renderLocale(); });
    this.installStyles();
  }

  get dirty() { return !same(this.document, this.savedDocument); }

  installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID; link.rel = 'stylesheet'; link.href = new URL('./skillStudio.css', import.meta.url).href;
    document.head.append(link);
  }

  async open() {
    if (this.active) return this;
    this.closed = false; this.active = true; this.epoch++; this.previousFocus = document.activeElement;
    this.document = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
    this.savedDocument = cloneSkillDocument(this.document);
    this.undoStack.length = 0; this.redoStack.length = 0;
    try {
      this.buildUI(); this.parent.append(this.root); this.updateLayout();
      const preferredQuality = globalThis.matchMedia?.('(pointer: coarse)')?.matches || stage.w < 760 ? 'mobile' : 'desktop';
      this.quality.value = preferredQuality;
      this.preview = new SkillPreview({ renderer: this.renderer, viewport: this.viewport, skin: this.skin });
      this.preview.setDocument(this.document);
      this.preview.setOriginal(false);
      this.preview.setLoop(true);
      this.preview.setQuality(this.quality.value);
      this.updatePreviewStats();
      this.refreshButtons();
      this.root.focus({ preventScroll: true });
      return this;
    } catch (error) {
      this.showStatus(t('openFailed'), 'error');
      this.disposePreview(); window.removeEventListener('keydown', this.onWindowKeyDown, true);
      this.active = false; this.epoch++; this.root?.remove(); this.root = null;
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
      throw error;
    }
  }

  buildUI() {
    const root = el('section', 'skill-studio');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'skill-studio-title'); root.tabIndex = -1;
    const head = el('header', 'ss-head');
    const title = el('div', 'ss-brand'); const h1 = el('h1', '', t('title')); h1.id = 'skill-studio-title';
    title.append(h1, el('span', 'ss-private', t('private')));
    const tools = el('div', 'ss-top-actions');
    this.undoButton = button('undo', t('undo')); this.redoButton = button('redo', t('redo'));
    this.saveButton = button('save', t('save'), 'ss-primary');
    const langButton = button('language', this.lang === 'es' ? 'English' : 'Español'); langButton.setAttribute('aria-label', 'Language / Idioma');
    const closeButton = button('close', t('close'), 'ss-close');
    tools.append(this.undoButton, this.redoButton, this.saveButton, langButton, closeButton); head.append(title, tools);

    const workspace = el('div', 'ss-workspace');
    const library = el('aside', 'ss-library'); library.setAttribute('aria-label', t('library'));
    library.append(el('h2', '', t('library')));
    const currentCard = button('select-tromba', '', 'ss-library-card is-selected'); currentCard.setAttribute('aria-pressed', 'true');
    currentCard.append(el('span', 'ss-water-icon', '≈'), el('span', 'ss-card-copy', `${t('tromba')} · ${t('current')}`));
    const niagara = button('niagara', '', 'ss-library-card ss-pending'); niagara.disabled = true;
    niagara.append(el('span', 'ss-niagara-icon', '✧'), el('span', 'ss-card-copy', `${t('niagara')} · ${t('niagaraPending')}`));
    library.append(currentCard, niagara, el('p', 'ss-library-note', t('private')));

    const stage = el('section', 'ss-stage'); stage.setAttribute('aria-label', t('preview'));
    this.viewport = el('div', 'ss-viewport'); this.viewport.setAttribute('aria-label', t('preview'));
    const playback = el('div', 'ss-playback');
    this.playButton = button('play', t('pause'));
    this.restartButton = button('restart', t('restart'));
    const loopLabel = el('label', 'ss-loop'); this.loopInput = document.createElement('input'); this.loopInput.type = 'checkbox'; this.loopInput.checked = true;
    loopLabel.append(this.loopInput, document.createTextNode(t('loop')));
    const speedLabel = el('label', 'ss-speed'); speedLabel.append(document.createTextNode(`${t('speed')} `));
    this.speedSelect = document.createElement('select'); this.speedSelect.setAttribute('aria-label', t('speed'));
    for (const [value, key] of [['0.5', 'speedSlow'], ['1', 'speedNormal'], ['2', 'speedFast']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = t(key); this.speedSelect.append(option);
    }
    this.speedSelect.value = '1';
    speedLabel.append(this.speedSelect);
    const originalLabel = el('label', 'ss-compare'); this.originalInput = document.createElement('input'); this.originalInput.type = 'checkbox';
    originalLabel.append(this.originalInput, document.createTextNode(`${t('original')} / ${t('draft')}`));
    this.seekInput = document.createElement('input'); this.seekInput.type = 'range'; this.seekInput.min = '0'; this.seekInput.max = '1'; this.seekInput.step = '0.01'; this.seekInput.setAttribute('aria-label', t('playback'));
    this.timeLabel = el('output', 'ss-time', '0.00 / 0.00 s');
    playback.append(this.playButton, this.restartButton, loopLabel, speedLabel, originalLabel, this.seekInput, this.timeLabel);
    const metric = el('div', 'ss-metrics'); metric.append(el('b', '', t('metric')));
    this.metricsLabel = el('span', '', '—'); metric.append(this.metricsLabel);
    stage.append(this.viewport, playback, metric);

    const inspector = el('aside', 'ss-inspector'); inspector.setAttribute('aria-label', t('visual'));
    inspector.append(el('h2', '', t('visual')));
    const skinLabel = el('label', 'ss-field'); skinLabel.append(el('span', '', `${t('character')} · ${t('skin')}`));
    this.skinSelect = document.createElement('select'); this.skinSelect.setAttribute('aria-label', t('skin'));
    for (let i = 0; i < 5; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `${t('skin')} ${i + 1}`; this.skinSelect.append(option); }
    this.skinSelect.value = String(Math.max(0, Math.min(4, Number(this.skin) || 0))); skinLabel.append(this.skinSelect);
    const qualityLabel = el('label', 'ss-field'); qualityLabel.append(el('span', '', t('quality')));
    this.quality = document.createElement('select'); this.quality.setAttribute('aria-label', t('quality'));
    for (const [value, key] of [['desktop', 'desktop'], ['mobile', 'mobile']]) { const option = document.createElement('option'); option.value = value; option.textContent = t(key); this.quality.append(option); }
    qualityLabel.append(this.quality); inspector.append(skinLabel, qualityLabel);
    this.parameterControls = new Map();
    const paramSection = el('section', 'ss-param-section');
    for (const meta of SKILL_PARAMETERS) {
      const label = el('label', `ss-field ss-param ss-param-${meta.key}`); label.append(el('span', '', t(meta.key)));
      if (meta.type === 'color') {
        const input = document.createElement('input'); input.type = 'color'; input.dataset.parameter = meta.key; input.value = this.document.parameters[meta.key];
        input.setAttribute('aria-label', t(meta.key)); label.append(input); this.parameterControls.set(meta.key, input);
      } else {
        const row = el('div', 'ss-range-row'); const input = document.createElement('input'); input.type = 'range'; input.min = String(meta.min); input.max = String(meta.max); input.step = String(meta.step); input.dataset.parameter = meta.key;
        input.value = String(meta.default); input.setAttribute('aria-label', t(meta.key)); const value = el('output', '', number(meta.default));
        row.append(input, value); label.append(row); this.parameterControls.set(meta.key, { input, value });
      }
      paramSection.append(label);
    }
    const rules = el('section', 'ss-rules'); rules.append(el('h3', '', t('impact')));
    this.ruleLabels = [
      el('p', '', `${t('radius')}: ${number(SKILLS.tromba.r, this.lang)}`), el('p', '', `${t('cooldown')}: ${number(SKILLS.tromba.cd, this.lang)} ${t('seconds')}`), el('p', '', `${t('delay')}: ${number(SKILLS.tromba.delay, this.lang)} ${t('seconds')}`),
    ]; rules.append(...this.ruleLabels); inspector.append(paramSection, rules);

    const footer = el('footer', 'ss-footer');
    this.loadButton = button('load', t('load')); this.recoverButton = button('recover', t('recover')); this.recoverButton.hidden = !this.readStored(this.recoveryKey, true);
    this.exportButton = button('export', t('export')); const importLabel = el('label', 'ss-import'); importLabel.append(el('span', '', t('import')));
    this.importInput = document.createElement('input'); this.importInput.type = 'file'; this.importInput.accept = 'application/json,.json'; this.importInput.setAttribute('aria-label', t('import')); importLabel.append(this.importInput);
    this.resetButton = button('reset', t('reset'));
    this.statusNode = el('p', 'ss-status', ''); this.statusNode.setAttribute('role', 'status'); this.statusNode.setAttribute('aria-live', 'polite');
    footer.append(this.loadButton, this.recoverButton, this.exportButton, importLabel, this.resetButton, this.statusNode);
    workspace.append(library, stage, inspector);
    const dialog = el('div', 'ss-confirm'); dialog.hidden = true; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'ss-confirm-title');
    const confirmTitle = el('h2', '', t('dirtyTitle')); confirmTitle.id = 'ss-confirm-title';
    this.confirmMessage = el('p', '', t('dirtyBody'));
    this.stayButton = button('stay', t('stay')); this.discardButton = button('discard', t('discard'), 'ss-danger'); this.keepButton = button('keep-recovery', t('recover'), 'ss-primary');
    dialog.append(confirmTitle, this.confirmMessage, this.stayButton, this.keepButton, this.discardButton);
    root.append(head, workspace, footer, dialog); this.confirmDialog = dialog;
    this.root = root;
    this.bindEvents(); this.renderLocale();
  }

  bindEvents() {
    this.onClick = (event) => {
      const action = event.target.closest?.('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'close') void this.close();
      else if (action === 'language') setLocale(this.lang === 'es' ? 'en' : 'es');
      else if (action === 'play') this.togglePlay();
      else if (action === 'restart') { this.preview?.restart(); this.updatePreviewStats(); }
      else if (action === 'save') this.saveDraft();
      else if (action === 'load') this.loadDraft();
      else if (action === 'recover') this.loadRecovery();
      else if (action === 'export') this.exportDocument();
      else if (action === 'reset') this.resetDocument();
      else if (action === 'undo') this.undo();
      else if (action === 'redo') this.redo();
      else if (action === 'stay') this.hideClosePrompt();
      else if (action === 'discard') { this.hideClosePrompt(); this.finishClose(); }
      else if (action === 'keep-recovery') { if (this.saveRecovery()) { this.hideClosePrompt(); this.finishClose(); } }
      event.stopPropagation();
    };
    this.onInput = (event) => {
      const key = event.target?.dataset?.parameter;
      if (key) this.updateParameter(key, event.target.value);
      else if (event.target === this.seekInput) this.seek(Number(this.seekInput.value));
    };
    this.onChange = (event) => {
      const key = event.target?.dataset?.parameter;
      if (key) this.endGesture();
      else if (event.target === this.loopInput) this.preview?.setLoop(this.loopInput.checked);
      else if (event.target === this.speedSelect) { this.preview?.setSpeed(Number(this.speedSelect.value)); this.updatePreviewStats(); }
      else if (event.target === this.quality) { this.preview?.setQuality(this.quality.value); this.updatePreviewStats(); }
      else if (event.target === this.skinSelect) { this.skin = Number(this.skinSelect.value); this.preview?.setSkin(this.skin); }
      else if (event.target === this.originalInput) this.preview?.setOriginal(this.originalInput.checked);
      else if (event.target === this.importInput) void this.importFile(this.importInput.files?.[0]);
    };
    this.onPointerDown = (event) => { if (event.target?.dataset?.parameter) this.beginGesture(); };
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onFocusOut = () => { if (this.gestureStart) this.endGesture(); };
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('keydown', this.onKeyDown, true);
    this.root.addEventListener('keyup', (event) => event.stopPropagation(), true);
    this.root.addEventListener('focusout', this.onFocusOut);
    this.onWindowKeyDown = (event) => { if (this.active && !this.root?.contains(event.target)) this.handleKeyDown(event); };
    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  handleKeyDown(event) {
    if (!this.active || !this.root) return;
    const target = event.target;
    const editing = target instanceof Element && target.matches('input,select,textarea,[contenteditable="true"]');
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!this.confirmDialog?.hidden) this.hideClosePrompt(); else void this.close();
      return;
    }
    if (event.code === 'Tab') {
      const scope = !this.confirmDialog?.hidden ? this.confirmDialog : this.root;
      const focusable = [...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(node => !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.root)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === this.root)) { event.preventDefault(); first?.focus(); }
      event.stopPropagation(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !editing) { event.preventDefault(); event.stopPropagation(); event.shiftKey ? this.redo() : this.undo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY' && !editing) { event.preventDefault(); event.stopPropagation(); this.redo(); return; }
    // Keep gameplay key handlers from seeing editor input, while allowing normal text entry.
    event.stopPropagation();
  }

  beginGesture() { if (!this.gestureStart) this.gestureStart = cloneSkillDocument(this.document); }
  endGesture() {
    if (!this.gestureStart) return;
    if (!same(this.gestureStart, this.document)) this.pushUndo(this.gestureStart);
    this.gestureStart = null; this.refreshButtons();
  }
  pushUndo(doc) { this.undoStack.push(cloneSkillDocument(doc)); if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift(); this.redoStack.length = 0; }

  updateParameter(key, raw) {
    const meta = SKILL_PARAMETERS.find((item) => item.key === key); if (!meta) return;
    this.beginGesture();
    const value = meta.type === 'color' ? raw : Number(raw);
    const next = cloneSkillDocument(this.document); next.parameters[key] = value;
    if (!validateSkillDocument(next).ok) return;
    this.document = next; this.preview?.setDocument(next); this.syncParameter(key); this.refreshButtons(); this.updatePreviewStats();
  }
  syncParameter(key) {
    const control = this.parameterControls.get(key); if (!control) return;
    const value = this.document.parameters[key];
    if (control.tagName === 'INPUT') control.value = value;
    else { control.input.value = String(value); control.value.textContent = number(value, this.lang); }
  }
  applyDocument(next, { history = true } = {}) {
    if (!validateSkillDocument(next).ok) { this.showStatus(t('invalid'), 'error'); return false; }
    const clean = cloneSkillDocument(next); if (same(clean, this.document)) return true;
    if (history) this.pushUndo(this.document);
    this.document = clean; this.preview?.setDocument(clean); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); return true;
  }
  refreshParameters() { for (const meta of SKILL_PARAMETERS) this.syncParameter(meta.key); }
  undo() {
    this.endGesture(); if (!this.undoStack.length) return;
    this.redoStack.push(cloneSkillDocument(this.document)); this.document = this.undoStack.pop(); this.preview?.setDocument(this.document); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); this.showStatus(t('undone'), 'ok');
  }
  redo() {
    this.endGesture(); if (!this.redoStack.length) return;
    this.undoStack.push(cloneSkillDocument(this.document)); this.document = this.redoStack.pop(); this.preview?.setDocument(this.document); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); this.showStatus(t('redone'), 'ok');
  }
  resetDocument() { this.endGesture(); this.applyDocument(DEFAULT_SKILL_DOCUMENT); this.showStatus(t('resetDone'), 'ok'); }

  togglePlay() { if (!this.preview) return; this.preview.playing ? this.preview.pause() : this.preview.play(); this.updatePreviewStats(); }
  seek(seconds) { this.preview?.seek(Math.max(0, Number(seconds) || 0)); this.updatePreviewStats(); }
  update(dt) {
    if (!this.active || !this.preview) return;
    this.updateLayout();
    this.preview.render(Math.max(0, Math.min(.1, Number(dt) || 0)));
    this.updatePreviewStats();
  }
  updateLayout() {
    if (!this.root) return;
    const rect = this.root.getBoundingClientRect();
    const width = stage.w > 0 ? stage.w : (this.root.clientWidth || rect.width);
    const height = stage.h > 0 ? stage.h : (this.root.clientHeight || rect.height);
    const layout = width > height && width <= 1000 ? 'compact-landscape'
      : width <= 760 && height >= width ? 'compact-portrait' : 'wide';
    if (this.root.dataset.layout !== layout) this.root.dataset.layout = layout;
  }
  updatePreviewStats() {
    if (!this.preview || !this.active) return;
    const time = Number(this.preview.time) || 0, duration = Math.max(.01, Number(this.preview.duration) || 1);
    this.seekInput.max = String(duration); this.seekInput.value = String(Math.min(time, duration));
    this.timeLabel.textContent = `${number(Math.min(time, duration), this.lang)} / ${number(duration, this.lang)} ${t('seconds')}`;
    this.playButton.textContent = t(this.preview.playing ? 'pause' : 'play');
    const stats = typeof this.preview.metrics === 'function'
      ? this.preview.metrics({ particles: true, cap: true, drawCalls: true }) : this.preview.metrics || {};
    const parts = [];
    if (Number.isFinite(stats.particles)) parts.push(`${t('particles')}: ${number(stats.particles, this.lang)}${Number.isFinite(stats.cap) ? ` / ${number(stats.cap, this.lang)}` : ''}`);
    if (Number.isFinite(stats.drawCalls)) parts.push(`DC: ${number(stats.drawCalls, this.lang)}`);
    this.metricsLabel.textContent = parts.join(' · ') || '—';
  }

  saveDraft() {
    const storage = safeStorage();
    if (!storage) { this.storageUnavailable = true; this.showStatus(t('storage'), 'error'); return false; }
    try {
      const envelope = { schema: 'marea.skill-studio-draft', version: 1, scope: this.scope, document: this.document };
      storage.setItem(this.storageKey, JSON.stringify(envelope)); storage.removeItem(this.recoveryKey);
      this.storageUnavailable = false; this.savedDocument = cloneSkillDocument(this.document); this.recoverButton.hidden = true;
      this.showStatus(t('saved'), 'ok'); this.refreshButtons(); return true;
    } catch { this.showStatus(t('storage'), 'error'); return false; }
  }
  readStored(key, recovery = false) {
    const storage = safeStorage(); if (!storage) { this.storageUnavailable = true; return null; }
    let raw;
    try { raw = storage.getItem(key); }
    catch { this.storageUnavailable = true; return null; }
    this.storageUnavailable = false;
    if (!raw) return null;
    let value; try { value = JSON.parse(raw); } catch { return null; }
    const keys = ['schema', 'version', 'scope', 'document'];
    if (!exactEnvelope(value, keys) || value.version !== 1 || value.scope !== this.scope || !validateSkillDocument(value.document).ok) return null;
    if (recovery && value.schema !== 'marea.skill-studio-recovery') return null;
    if (!recovery && value.schema !== 'marea.skill-studio-draft') return null;
    return cloneSkillDocument(value.document);
  }
  loadDraft() {
    const next = this.readStored(this.storageKey);
    if (!next) { this.showStatus(t(this.storageUnavailable ? 'storage' : 'noDraft'), 'error'); return false; }
    this.applyDocument(next, { history: false }); this.savedDocument = cloneSkillDocument(next); this.undoStack.length = 0; this.redoStack.length = 0;
    this.showStatus(t('loaded'), 'ok'); this.refreshButtons(); return true;
  }
  saveRecovery() {
    const storage = safeStorage(); if (!storage) { this.storageUnavailable = true; this.showStatus(t('storage'), 'error'); return false; }
    try { storage.setItem(this.recoveryKey, JSON.stringify({ schema: 'marea.skill-studio-recovery', version: 1, scope: this.scope, document: this.document })); this.storageUnavailable = false; return true; }
    catch { this.showStatus(t('storage'), 'error'); return false; }
  }
  loadRecovery() {
    const next = this.readStored(this.recoveryKey, true);
    if (!next) { this.showStatus(t(this.storageUnavailable ? 'storage' : 'noRecovery'), 'error'); return false; }
    this.applyDocument(next, { history: false }); this.showStatus(t('recovered'), 'ok'); this.recoverButton.hidden = true; return true;
  }
  exportDocument() {
    if (!validateSkillDocument(this.document).ok) { this.showStatus(t('invalid'), 'error'); return false; }
    const blob = new Blob([`${JSON.stringify(this.document, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `marea-tromba-${Date.now()}.json`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); this.showStatus(t('exported'), 'ok'); return true;
  }
  async importFile(file) {
    if (!file) return;
    const epoch = this.epoch;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('too-large');
      const next = parseSkillDocument(await file.text());
      if (!this.active || epoch !== this.epoch) return;
      if (!validateSkillDocument(next).ok) throw new Error('invalid');
      this.applyDocument(next); this.showStatus(t('imported'), 'ok');
    } catch (error) { if (this.active && epoch === this.epoch) this.showStatus(error?.message === 'too-large' ? t('tooLarge') : t('invalid'), 'error'); }
    finally { if (epoch === this.epoch && this.importInput?.isConnected) this.importInput.value = ''; }
  }
  refreshButtons() {
    if (!this.root) return;
    this.undoButton.disabled = !this.undoStack.length; this.redoButton.disabled = !this.redoStack.length;
    this.saveButton.disabled = !this.dirty; this.loadButton.disabled = !this.readStored(this.storageKey);
    this.root.classList.toggle('is-dirty', this.dirty);
    if (this.storageUnavailable && !this.statusNode.textContent) this.showStatus(t('storage'), 'error');
  }
  showStatus(message, kind = '') { this.statusText = message; this.statusKind = kind; if (this.statusNode) { this.statusNode.textContent = message; this.statusNode.dataset.kind = kind; } }

  showClosePrompt() { this.confirmDialog.hidden = false; this.confirmMessage.textContent = t('dirtyBody'); this.keepButton.focus(); }
  hideClosePrompt() { if (!this.confirmDialog) return; this.confirmDialog.hidden = true; this.root?.querySelector('[data-action="close"]')?.focus(); }
  async close({ force = false } = {}) {
    if (!this.active) return true;
    this.endGesture();
    if (this.dirty && !force) { this.showClosePrompt(); return false; }
    if (this.dirty && force) this.saveRecovery();
    this.finishClose(); return true;
  }
  finishClose() {
    if (this.closed) return;
    this.closed = true; this.active = false; this.epoch++;
    this.disposePreview(); this.root?.remove(); this.root = null;
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.onClose?.();
  }
  disposePreview() { try { this.preview?.dispose(); } catch { /* Best-effort renderer cleanup. */ } this.preview = null; }
  dispose() {
    if (this.active) { this.endGesture(); if (this.dirty) this.saveRecovery(); this.finishClose(); }
    this.unsubscribeLocale?.(); this.unsubscribeLocale = null;
  }

  renderLocale() {
    if (!this.root) return;
    this.root.querySelector('#skill-studio-title').textContent = t('title');
    this.root.querySelector('.ss-private').textContent = t('private');
    const setActionText = (action, key) => { const node = this.root.querySelector(`[data-action="${action}"]`); if (node) node.textContent = t(key); };
    for (const [action, key] of [['close','close'],['undo','undo'],['redo','redo'],['save','save'],['restart','restart'],['reset','reset'],['load','load'],['recover','recover'],['export','export'],['play',this.preview?.playing ? 'pause' : 'play']]) setActionText(action, key);
    this.root.querySelector('[data-action="language"]').textContent = this.lang === 'es' ? 'English' : 'Español';
    this.root.querySelector('.ss-library').setAttribute('aria-label', t('library'));
    this.root.querySelector('.ss-library h2').textContent = t('library');
    const cards = this.root.querySelectorAll('.ss-library-card');
    cards[0].querySelector('.ss-card-copy').textContent = `${t('tromba')} · ${t('current')}`;
    cards[1].querySelector('.ss-card-copy').textContent = `${t('niagara')} · ${t('niagaraPending')}`;
    this.root.querySelector('.ss-library-note').textContent = t('private');
    this.root.querySelector('.ss-stage').setAttribute('aria-label', t('preview'));
    this.root.querySelector('.ss-viewport').setAttribute('aria-label', t('preview'));
    const speedOptions = [...this.speedSelect.options]; ['speedSlow','speedNormal','speedFast'].forEach((key, i) => { speedOptions[i].textContent = t(key); });
    this.loopInput.parentElement.lastChild.textContent = t('loop'); this.originalInput.parentElement.lastChild.textContent = `${t('original')} / ${t('draft')}`;
    this.speedSelect.setAttribute('aria-label', t('speed')); this.speedSelect.parentElement.firstChild.textContent = `${t('speed')} `;
    this.seekInput.setAttribute('aria-label', t('playback'));
    this.skinSelect.parentElement.firstChild.textContent = `${t('character')} · ${t('skin')}`; this.skinSelect.setAttribute('aria-label', t('skin'));
    [...this.skinSelect.options].forEach((option, i) => { option.textContent = `${t('skin')} ${i + 1}`; });
    this.quality.parentElement.firstChild.textContent = t('quality'); this.quality.setAttribute('aria-label', t('quality'));
    [...this.quality.options].forEach((option) => { option.textContent = t(option.value); });
    this.root.querySelector('.ss-inspector h2').textContent = t('visual');
    for (const meta of SKILL_PARAMETERS) {
      const control = this.parameterControls.get(meta.key), input = control?.tagName === 'INPUT' ? control : control?.input;
      input?.closest('label')?.querySelector('span')?.replaceChildren(document.createTextNode(t(meta.key)));
      input?.setAttribute('aria-label', t(meta.key));
    }
    this.root.querySelector('.ss-rules h3').textContent = t('impact');
    this.ruleLabels[0].textContent = `${t('radius')}: ${number(SKILLS.tromba.r, this.lang)}`;
    this.ruleLabels[1].textContent = `${t('cooldown')}: ${number(SKILLS.tromba.cd, this.lang)} ${t('seconds')}`;
    this.ruleLabels[2].textContent = `${t('delay')}: ${number(SKILLS.tromba.delay, this.lang)} ${t('seconds')}`;
    this.root.querySelector('.ss-metrics b').textContent = t('metric');
    this.root.querySelector('.ss-import span').textContent = t('import');
    this.confirmDialog.querySelector('h2').textContent = t('dirtyTitle'); this.confirmMessage.textContent = t('dirtyBody');
    this.stayButton.textContent = t('stay'); this.discardButton.textContent = t('discard'); this.keepButton.textContent = t('recover');
    if (this.statusNode) this.statusNode.textContent = '';
    this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats();
  }
}
