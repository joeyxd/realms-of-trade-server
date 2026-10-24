import { getLocale, onLocaleChange, setLocale } from '../core/locale.js';
import { SkillPreview } from '../render/skillPreview.js';
import { stage } from '../ui/stage.js';
import { SKILLS } from '../data/weapons.js';
import { EFFECT_CATEGORIES, EFFECT_PROJECTS, effectParameters, filterEffects, getEffect } from './effectLibrary.js';
import {
  DEFAULT_SKILL_DOCUMENT, cloneSkillDocument, createDefaultSkillDocument, MAX_SKILL_DOCUMENT_BYTES,
  parseSkillDocument, validateSkillDocument,
} from './skillDocument.js';

const MAX_HISTORY = 100;
const MAX_IMPORT_BYTES = MAX_SKILL_DOCUMENT_BYTES;
const STYLE_ID = 'mn-skill-studio-style';
const labels = {
  title: ['Taller de habilidades', 'Skill Studio'], private: ['BORRADOR LOCAL · SIN PUBLICAR', 'LOCAL DRAFT · NOT PUBLISHED'],
  close: ['Cerrar', 'Close'], library: ['Biblioteca', 'Library'], tromba: ['Tromba', 'Tromba'], current: ['Efecto actual', 'Current effect'],
  search: ['Buscar nombre, familia o proyecto', 'Search name, family, or project'],
  allCategories: ['Todas las categorías', 'All categories'], allProjects: ['Todos los proyectos', 'All projects'],
  allStatuses: ['Todos los estados', 'All statuses'], readyStatus: ['Adaptado y revisado', 'Adapted and reviewed'],
  textureStatus: ['Textura animada · sistema pendiente', 'Animated texture · system pending'],
  capturedRole: ['Extracto de sistema · captura 2D', 'System excerpt · 2D capture'],
  recreatedRole: ['Recreación · adaptador listo', 'Recreation · adapter ready'],
  currentRole: ['Efecto actual del juego', 'Current game effect'],
  nativeRole: ['Nativo · medido contra UE 5.8', 'Native · measured against UE 5.8'],
  seed: ['Semilla', 'Seed'],
  nativeNote: ['Controles de presentación: no medidos contra UE. La semilla da otra distribución repetible.', 'Presentation controls: not measured against UE. The seed gives another repeatable distribution.'],
  nativeFlameLimit: ['Port nativo de NS_Flame_Single en el navegador: la simulación, el color Filmic y el DepthFade ortogonal están medidos contra UE 5.8; el DepthFade en perspectiva, la composición sobre el escenario, el orden de dibujo de llama y humo en perspectiva, los controles de presentación y la variante móvil no están medidos.', 'Native browser port of NS_Flame_Single: the simulation, the Filmic color and the orthographic DepthFade are measured against UE 5.8; the perspective DepthFade, the composite over the stage, the flame and smoke draw order in perspective, the presentation controls and the mobile variant are not measured.'],
  nativeLimit: ['Port nativo del sistema Niagara en el navegador, medido contra UE 5.8 con un perfil de color controlado; los controles de presentación, DepthFade en perspectiva y la variante móvil no están medidos.', 'Native browser port of the Niagara system, measured against UE 5.8 under a controlled color profile; presentation controls, the perspective DepthFade and the mobile variant are not measured.'],
  sourceTextureLimit: ['Se reproduce un componente del atlas fuente con un tiempo inicial del taller. Las otras capas, colores y comportamiento del sistema Niagara completo siguen pendientes.', 'A source-atlas component plays with initial studio timing. Other layers, colors, and full Niagara system behavior remain pending.'],
  capturedLimit: ['Es un extracto animado 2D desde una cámara. No conserva volumen desde otros ángulos ni ejecuta la simulación Niagara en vivo.', 'This is an animated 2D excerpt from one camera. It does not preserve volume from other angles or run live Niagara simulation.'],
  recreatedLimit: ['Es una recreación revisada en el navegador, no el runtime original de Niagara.', 'This is a reviewed browser recreation, not the original Niagara runtime.'],
  candidateStatus: ['Candidato · clase por confirmar', 'Candidate · class not confirmed'],
  candidateReason: ['Candidato del inventario: se encontró un marcador de texto; Unreal aún no confirmó la clase del paquete.', 'Inventory candidate: a text marker was found; Unreal has not confirmed the package class.'],
  referenceStatus: ['Sistema Niagara verificado \u00b7 adaptaci\u00f3n pendiente', 'Verified Niagara system \u00b7 adaptation pending'],
  pendingStatus: ['Pendiente', 'Pending'], noResults: ['No hay efectos coincidentes.', 'No matching effects.'],
  showLibrary: ['Biblioteca', 'Library'], hideLibrary: ['Cerrar biblioteca', 'Close library'],
  pendingTitle: ['Adaptación pendiente', 'Adaptation pending'], source: ['Procedencia', 'Provenance'], role: ['Representación', 'Representation'],
  referenceReason: ['Sistema inventariado. Su vista animada todavía no está disponible.', 'Catalogued system. Its animated preview is not available yet.'],
  category: ['Categoría', 'Category'], family: ['Familia', 'Family'], project: ['Proyecto', 'Project'], package: ['Paquete', 'Package'],
  evidenceClass: ['Clase del paquete', 'Package class'], evidenceMethod: ['Método de evidencia', 'Evidence method'],
  sourceCount: ['Fuentes del inventario', 'Inventory sources'],
  atlasLoading: ['Cargando atlas', 'Loading atlas'], atlasFailed: ['No se pudo cargar el atlas; el borrador se conserva.', 'Atlas failed to load; the draft is preserved.'],
  atlasReady: ['Atlas', 'Atlas'], billboardNote: ['Vista animada 2D desde una c\u00e1mara; no representa simulaci\u00f3n Niagara ni cantidad de part\u00edculas.', 'Animated 2D view from one camera; this is not Niagara simulation or a particle count.'],
  niagara: ['Referencia Niagara', 'Niagara reference'], niagaraPending: ['Pendiente: adaptación verificada', 'Pending: verified adaptation'],
  preview: ['Vista previa 3D', '3D preview'], playback: ['Reproducción', 'Playback'], play: ['Reproducir', 'Play'], pause: ['Pausar', 'Pause'],
  restart: ['Reiniciar', 'Restart'], loop: ['Repetir', 'Loop'], speed: ['Velocidad', 'Speed'], original: ['Original', 'Original'], draft: ['Borrador', 'Draft'],
  adapterOriginal: ['Base del adaptador', 'Adapter baseline'],
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
  opacity: ['Opacidad', 'Opacity'], tint: ['Tinte', 'Tint'],
  componentCategory: ['Componentes de textura', 'Texture components'],
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

/** Private, local-only visual editor for registered presentation descriptors. */
export class SkillStudio {
  constructor({ parent, renderer, scope, skin = 0, onClose } = {}) {
    if (!parent || !renderer) throw new TypeError('SkillStudio requires parent and renderer');
    Object.assign(this, { parent, renderer, skin, onClose });
    this.scope = normalizeScope(scope);
    this.legacyStorageKey = `mn.skill-studio.v1:${encodeURIComponent(this.scope)}`;
    this.legacyRecoveryKey = `${this.legacyStorageKey}:recovery`;
    this.activeEffect = DEFAULT_SKILL_DOCUMENT.effect;
    this.lang = getLocale();
    this.document = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
    this.savedDocument = cloneSkillDocument(this.document);
    this.documents = new Map(); this.savedDocuments = new Map(); this.histories = new Map();
    this.libraryLimit = 150; this.libraryOpen = false;
    this.undoStack = []; this.redoStack = []; this.gestureStart = null;
    this.preview = null; this.active = false; this.closed = false; this.root = null;
    this.epoch = 0; this.selectionEpoch = 0; this.storageUnavailable = false;
    this.previousFocus = null; this.statusText = ''; this.statusKind = '';
    this.unsubscribeLocale = onLocaleChange((lang) => { this.lang = lang; this.renderLocale(); });
    this.installStyles();
  }

  get storageKey() { return this.storageKeys(this.activeEffect).draft; }
  get recoveryKey() { return this.storageKeys(this.activeEffect).recovery; }
  get dirty() { return (getEffect(this.activeEffect)?.ready && !same(this.document, this.savedDocument))
    || [...this.documents].some(([id, doc]) => id !== this.activeEffect && !same(doc, this.savedDocuments.get(id) ?? doc)); }
  getDocument() { return getEffect(this.activeEffect)?.ready ? cloneSkillDocument(this.document) : null; }
  storageKeys(effectId) {
    if (effectId === DEFAULT_SKILL_DOCUMENT.effect) return { draft: this.legacyStorageKey, recovery: this.legacyRecoveryKey };
    const base = `mn.skill-studio.v2:${encodeURIComponent(this.scope)}:${encodeURIComponent(effectId)}`;
    return { draft: base, recovery: `${base}:recovery` };
  }

  installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID; link.rel = 'stylesheet'; link.href = new URL('./skillStudio.css', import.meta.url).href;
    document.head.append(link);
  }

  createFilter(kind, allLabel, values) {
    const select = document.createElement('select'); select.dataset.filter = kind;
    const all = document.createElement('option'); all.value = ''; all.textContent = allLabel; select.append(all);
    for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'source-components' ? t('componentCategory') : value; select.append(option); }
    select.setAttribute('aria-label', kind); return select;
  }

  renderLibrary() {
    if (!this.effectList) return;
    const matches = filterEffects({ query: this.searchInput.value, category: this.categoryFilter.value,
      project: this.projectFilter.value, status: this.statusFilter.value });
    this.effectList.replaceChildren();
    for (const effect of matches.slice(0, this.libraryLimit)) {
      const card = button('select-effect', '', `ss-library-card${effect.id === this.activeEffect ? ' is-selected' : ''}${effect.ready ? ' ss-ready' : ' ss-pending'}${effect.status === 'texture' ? ' ss-texture' : ''}`);
      card.dataset.effectId = effect.id; card.setAttribute('aria-pressed', String(effect.id === this.activeEffect));
      card.setAttribute('aria-label', `${effect.name} · ${this.effectStatus(effect)}`);
      if (effect.thumbnail) {
        const image = document.createElement('img'); image.className = 'ss-effect-thumbnail';
        image.src = effect.thumbnail; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
        image.width = 64; image.height = 64;
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        card.append(image);
      } else card.append(el('span', 'ss-effect-icon', effect.id === DEFAULT_SKILL_DOCUMENT.effect ? '≈' : '✧'));
      const category = effect.category === 'source-components' ? t('componentCategory') : effect.category || effect.family || '';
      const copy = el('span', 'ss-card-copy'); copy.append(el('strong', '', effect.name), el('small', '', `${category} · ${this.effectStatus(effect)}`));
      card.append(copy); this.effectList.append(card);
    }
    const playable = matches.filter(effect => effect.ready).length;
    this.effectCount.textContent = this.lang === 'en' ? `${matches.length} entries · ${playable} animated views` : `${matches.length} entradas · ${playable} vistas animadas`;
    this.effectCount.dataset.totalCount = String(matches.length);
    this.effectCount.dataset.visibleCount = String(Math.min(matches.length, this.libraryLimit));
    this.effectList.dataset.totalCount = String(matches.length);
    if (matches.length === 0) this.effectList.append(el('p', 'ss-no-results', t('noResults')));
    if (matches.length > this.libraryLimit) this.effectList.append(button('load-more', this.lang === 'en' ? `Show ${Math.min(150, matches.length - this.libraryLimit)} more` : `Mostrar ${Math.min(150, matches.length - this.libraryLimit)} más`, 'ss-load-more'));
    const selected = getEffect(this.activeEffect);
    this.provenance.replaceChildren();
    if (selected) {
      this.selectedName.textContent = selected.name;
      this.selectedRole.textContent = this.effectStatus(selected);
      if (this.originalInput) this.originalInput.parentElement.lastChild.textContent = `${t(['flipbook-v1', 'niagara-native-v1'].includes(selected.adapter) ? 'adapterOriginal' : 'original')} / ${t('draft')}`;
      this.provenance.append(el('summary', '', `${t('source')} · ${this.effectRoleLabel(selected)}`));
      const details = [
        `${t('category')}: ${selected.category || '-'}`,
        `${t('family')}: ${selected.family || '-'}`,
        `${t('role')}: ${this.effectRoleLabel(selected)}`,
        selected.evidence?.class ? `${t('evidenceClass')}: ${selected.evidence.class}` : '',
        selected.evidence?.method ? `${t('evidenceMethod')}: ${selected.evidence.method}` : '',
      ].filter(Boolean);
      const overview = el('p', '', details.join(' | ')); this.provenance.append(overview);
      const limitation = this.effectRoleLimitation(selected);
      if (limitation) this.provenance.append(el('p', 'ss-role-limit', limitation));
      if (selected.derivative?.captureProject) this.provenance.append(el('p', '', `${this.lang === 'en' ? 'Captured project' : 'Proyecto capturado'}: ${selected.derivative.captureProject} · ${selected.derivative.frames} ${this.lang === 'en' ? 'frames' : 'cuadros'} · ${selected.derivative.duration} s`));
      const component = selected.derivative?.component;
      if (component) this.provenance.append(el('p', '', `${this.lang === 'en' ? 'Source component' : 'Componente fuente'}: ${component.name || selected.derivative.sourceBinding?.texturePackage?.split('/').at(-1) || '-'} · ${selected.derivative.frames} ${this.lang === 'en' ? 'frames' : 'cuadros'}`));
      if (selected.sources.length) {
        const sourceDetails = document.createElement('details');
        const summary = el('summary', '', `${t('sourceCount')}: ${selected.sources.length}`); sourceDetails.append(summary);
        const list = document.createElement('ul');
        for (const source of selected.sources) {
          const item = document.createElement('li');
          item.textContent = `${t('project')}: ${source.project}; ${t('package')}: ${source.package}${source.bytes ? `; ${source.bytes} B` : ''}${source.sha256 ? `; SHA-256 ${source.sha256}` : ''}`;
          list.append(item);
        }
        sourceDetails.append(list); this.provenance.append(sourceDetails);
      }
      if (selected.sourceSystems?.length) {
        const systemDetails = document.createElement('details');
        const systems = [...new Map(selected.sourceSystems.map(source => [source.id, source])).values()];
        systemDetails.append(el('summary', '', this.lang === 'en'
          ? `Used by ${systems.length} Niagara systems · full systems pending`
          : `Usado por ${systems.length} sistemas Niagara · sistemas completos pendientes`));
        const list = document.createElement('ul');
        for (const source of systems) list.append(el('li', '', source.package));
        systemDetails.append(list); this.provenance.append(systemDetails);
      }
      this.pendingTitle.textContent = `${selected.name} · ${selected.status === 'candidate' ? t('candidateStatus') : t('pendingTitle')}`;
      this.pendingMessage.textContent = selected.ready ? '' : selected.status === 'candidate' ? t('candidateReason') : t('referenceReason');
      this.sourceThumbnail.hidden = !selected.thumbnail;
      if (selected.thumbnail) this.sourceThumbnailImage.src = selected.thumbnail;
      else this.sourceThumbnailImage.removeAttribute('src');
      this.sourceThumbnailCaption.textContent = this.lang === 'en'
        ? 'Cached Unreal editor thumbnail · static reference' : 'Miniatura guardada en Unreal · referencia estática';
    }
  }
  effectStatus(effect) {
    if (effect.ready && effect.role === 'native') return t('nativeRole');
    if (effect.status === 'texture') return t('textureStatus');
    if (effect.ready && effect.role === 'system-capture') return t('capturedRole');
    if (effect.ready && effect.role === 'recreated') return t('recreatedRole');
    if (effect.ready && effect.role === 'current-effect') return t('currentRole');
    return t(effect.ready ? 'readyStatus' : effect.status === 'candidate' ? 'candidateStatus' : 'referenceStatus');
  }
  effectRoleLabel(effect) {
    const labelsByRole = { native: 'nativeRole', 'source-texture': 'textureStatus', 'system-capture': 'capturedRole', recreated: 'recreatedRole', 'current-effect': 'currentRole' };
    return t(labelsByRole[effect.role] || 'referenceStatus');
  }
  effectRoleLimitation(effect) {
    const key = effect.role === 'native' && effect.derivative?.limitKey || { native: 'nativeLimit', 'source-texture': 'sourceTextureLimit', 'system-capture': 'capturedLimit', recreated: 'recreatedLimit' }[effect.role];
    return key ? t(key) : effect.roleLimitation || '';
  }
  toggleLibrary() {
    this.libraryOpen = !this.libraryOpen;
    this.root.classList.toggle('is-library-open', this.libraryOpen);
    this.libraryToggle.setAttribute('aria-expanded', String(this.libraryOpen));
    this.libraryToggle.textContent = t(this.libraryOpen ? 'hideLibrary' : 'showLibrary');
    if (this.stageNode) this.stageNode.inert = this.libraryOpen;
    if (this.inspectorNode) this.inspectorNode.inert = this.libraryOpen;
    if (this.libraryOpen) this.searchInput.focus(); else this.libraryToggle.focus();
  }

  stashEffect() {
    if (!getEffect(this.activeEffect)?.ready) return;
    this.documents.set(this.activeEffect, cloneSkillDocument(this.document));
    this.savedDocuments.set(this.activeEffect, cloneSkillDocument(this.savedDocument));
    this.histories.set(this.activeEffect, { undo: this.undoStack.map(cloneSkillDocument), redo: this.redoStack.map(cloneSkillDocument) });
  }
  async selectEffect(effectId) {
    const nextEffect = getEffect(effectId);
    if (!nextEffect || effectId === this.activeEffect) return;
    this.selectionEpoch++;
    this.endGesture(); this.stashEffect();
    this.activeEffect = effectId;
    this.originalInput.checked = false;
    if (nextEffect.ready) {
      this.document = cloneSkillDocument(this.documents.get(effectId) ?? createDefaultSkillDocument(effectId));
      this.savedDocument = cloneSkillDocument(this.savedDocuments.get(effectId) ?? this.document);
      const history = this.histories.get(effectId) ?? { undo: [], redo: [] };
      this.undoStack = history.undo.map(cloneSkillDocument); this.redoStack = history.redo.map(cloneSkillDocument);
      this.preview?.setDocument(this.document);
      this.preview?.setOriginal(false);
    } else {
      this.document = cloneSkillDocument(this.documents.get(effectId) ?? DEFAULT_SKILL_DOCUMENT);
      this.savedDocument = cloneSkillDocument(this.savedDocuments.get(effectId) ?? this.document);
      this.undoStack = []; this.redoStack = [];
      this.preview?.pause();
      this.preview?.flipbook.cancelLoad();
      this.preview?.native?.cancelLoad();
    }
    this.renderParameters(); this.renderLibrary(); this.updateEffectState(); this.refreshButtons(); this.updatePreviewStats();
    if (this.libraryOpen) this.toggleLibrary();
  }
  updateEffectState() {
    const effect = getEffect(this.activeEffect), ready = Boolean(effect?.ready);
    this.viewport.hidden = !ready; this.pendingOverlay.hidden = ready;
    (ready ? this.metricsNode : this.pendingOverlay).append(this.provenance);
    this.playback.setAttribute('aria-disabled', String(!ready));
    for (const control of [this.playButton, this.restartButton, this.loopInput, this.speedSelect, this.originalInput, this.seekInput, this.skinSelect, this.quality,
      ...this.parameterControls.values()].map((control) => control?.input ?? control).filter(Boolean)) control.disabled = !ready;
    for (const node of [this.saveButton, this.exportButton, this.resetButton, this.loadButton, this.recoverButton, this.importInput]) node.disabled = !ready;
    if (this.rules) this.rules.hidden = this.activeEffect !== DEFAULT_SKILL_DOCUMENT.effect;
    if (this.recoverButton) this.recoverButton.hidden = !this.readStored(this.recoveryKey, true);
  }
  renderParameters() {
    if (!this.paramSection) return;
    this.parameterControls.clear(); this.paramSection.replaceChildren();
    for (const meta of effectParameters(this.activeEffect)) {
      const label = el('label', `ss-field ss-param ss-param-${meta.key}`); label.append(el('span', '', t(meta.key)));
      if (meta.type === 'color') {
        const input = document.createElement('input'); input.type = 'color'; input.dataset.parameter = meta.key; input.value = this.document.parameters[meta.key];
        input.setAttribute('aria-label', t(meta.key)); label.append(input); this.parameterControls.set(meta.key, input);
      } else {
        const row = el('div', 'ss-range-row'); const input = document.createElement('input'); input.type = 'range'; input.min = String(meta.min); input.max = String(meta.max); input.step = String(meta.step); input.dataset.parameter = meta.key;
        input.value = String(this.document.parameters[meta.key]); input.setAttribute('aria-label', t(meta.key)); const value = el('output', '', number(this.document.parameters[meta.key]));
        row.append(input, value); label.append(row); this.parameterControls.set(meta.key, { input, value });
      }
      this.paramSection.append(label);
    }
    if (getEffect(this.activeEffect)?.role === 'native') this.paramSection.append(el('p', 'ss-native-note', t('nativeNote')));
  }

  async open() {
    if (this.active) return this;
    this.closed = false; this.active = true; this.epoch++; this.previousFocus = document.activeElement;
    this.activeEffect = DEFAULT_SKILL_DOCUMENT.effect;
    this.documents.clear(); this.savedDocuments.clear(); this.histories.clear();
    this.document = cloneSkillDocument(DEFAULT_SKILL_DOCUMENT);
    this.savedDocument = cloneSkillDocument(this.document);
    this.undoStack = []; this.redoStack = [];
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
    library.id = 'ss-library-list';
    library.append(el('h2', '', t('library')));
    const currentCard = button('select-tromba', '', 'ss-library-card is-selected'); currentCard.setAttribute('aria-pressed', 'true');
    currentCard.append(el('span', 'ss-water-icon', '≈'), el('span', 'ss-card-copy', `${t('tromba')} · ${t('current')}`));
    const niagara = button('niagara', '', 'ss-library-card ss-pending'); niagara.disabled = true;
    niagara.append(el('span', 'ss-niagara-icon', '✧'), el('span', 'ss-card-copy', `${t('niagara')} · ${t('niagaraPending')}`));
    library.append(currentCard, niagara, el('p', 'ss-library-note', t('private')));
    currentCard.remove(); niagara.remove();
    this.libraryToggle = button('toggle-library', t('showLibrary'), 'ss-library-toggle');
    this.libraryToggle.setAttribute('aria-expanded', 'false');
    this.libraryToggle.setAttribute('aria-controls', library.id);
    tools.insertBefore(this.libraryToggle, langButton);
    const searchLabel = el('label', 'ss-library-filter'); searchLabel.append(el('span', '', t('search')));
    this.searchInput = document.createElement('input'); this.searchInput.type = 'search'; this.searchInput.dataset.filter = 'query';
    this.searchInput.setAttribute('aria-label', t('search')); searchLabel.append(this.searchInput);
    const filters = el('div', 'ss-library-filters');
    this.categoryFilter = this.createFilter('category', t('allCategories'), EFFECT_CATEGORIES);
    this.projectFilter = this.createFilter('project', t('allProjects'), EFFECT_PROJECTS);
    this.statusFilter = this.createFilter('status', t('allStatuses'), ['ready', 'texture', 'candidate', 'reference']);
    filters.append(this.categoryFilter, this.projectFilter, this.statusFilter);
    this.effectCount = el('p', 'ss-effect-count', ''); this.effectList = el('div', 'ss-library-list');
    this.libraryNote = library.querySelector('.ss-library-note');
    library.append(searchLabel, filters, this.effectCount, this.effectList, this.libraryNote);

    const stage = el('section', 'ss-stage'); stage.setAttribute('aria-label', t('preview'));
    this.stageNode = stage;
    this.viewport = el('div', 'ss-viewport'); this.viewport.setAttribute('aria-label', t('preview'));
    const selectedLabel = el('div', 'ss-selected-effect');
    this.selectedName = el('strong', 'ss-selected-name', '');
    this.selectedRole = el('small', 'ss-selected-role', '');
    selectedLabel.append(this.selectedName, this.selectedRole); this.viewport.append(selectedLabel);
    this.pendingOverlay = el('div', 'ss-pending-overlay'); this.pendingOverlay.setAttribute('role', 'status');
    this.pendingTitle = el('strong', '', t('pendingTitle')); this.pendingMessage = el('p', '', ''); this.provenance = el('details', 'ss-provenance');
    this.pendingOverlay.append(this.pendingTitle, this.pendingMessage);
    this.sourceThumbnail = el('figure', 'ss-source-thumbnail'); this.sourceThumbnail.hidden = true;
    this.sourceThumbnailImage = document.createElement('img'); this.sourceThumbnailImage.width = 256; this.sourceThumbnailImage.height = 256;
    this.sourceThumbnailImage.alt = '';
    this.sourceThumbnailCaption = document.createElement('figcaption');
    this.sourceThumbnail.append(this.sourceThumbnailImage, this.sourceThumbnailCaption);
    this.pendingOverlay.append(this.sourceThumbnail);
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
    this.playback = playback;
    playback.append(this.playButton, this.restartButton, loopLabel, speedLabel, originalLabel, this.seekInput, this.timeLabel);
    const metric = el('div', 'ss-metrics'); this.metricsNode = metric; metric.append(el('b', '', t('metric')));
    this.metricsLabel = el('span', '', '—'); metric.append(this.metricsLabel, this.provenance);
    stage.append(this.viewport, this.pendingOverlay, playback, metric);

    const inspector = el('aside', 'ss-inspector'); inspector.setAttribute('aria-label', t('visual'));
    this.inspectorNode = inspector;
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
    this.paramSection = paramSection;
    const rules = el('section', 'ss-rules'); rules.append(el('h3', '', t('impact')));
    this.rules = rules;
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
      else if (action === 'restart') { if (getEffect(this.activeEffect)?.ready) this.preview?.restart(); this.updatePreviewStats(); }
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
      else if (action === 'toggle-library') this.toggleLibrary();
      else if (action === 'load-more') { this.libraryLimit += 150; this.renderLibrary(); }
      else if (action === 'select-effect') void this.selectEffect(event.target.closest('[data-effect-id]')?.dataset.effectId);
      event.stopPropagation();
    };
    this.onInput = (event) => {
      const key = event.target?.dataset?.parameter;
      if (key) this.updateParameter(key, event.target.value);
      else if (event.target === this.seekInput) this.seek(Number(this.seekInput.value));
      else if (event.target === this.searchInput) { this.libraryLimit = 150; this.renderLibrary(); }
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
      else if ([this.categoryFilter, this.projectFilter, this.statusFilter].includes(event.target)) { this.libraryLimit = 150; this.renderLibrary(); }
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
      if (!this.confirmDialog?.hidden) this.hideClosePrompt(); else if (this.libraryOpen) this.toggleLibrary(); else void this.close();
      return;
    }
    if (event.code === 'Tab') {
      const scope = !this.confirmDialog?.hidden ? this.confirmDialog : this.root;
      const focusable = this.confirmDialog?.hidden && this.libraryOpen
        ? [...this.libraryToggle ? [this.libraryToggle] : [], ...this.root.querySelector('.ss-library').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        : [...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      const visibleFocusable = focusable
        .filter(node => !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
      const first = visibleFocusable[0], last = visibleFocusable.at(-1);
      if (this.confirmDialog?.hidden && this.libraryOpen) {
        const index = visibleFocusable.findIndex(node => node === document.activeElement || node.contains(document.activeElement));
        const next = index < 0 ? (event.shiftKey ? visibleFocusable.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + visibleFocusable.length) % visibleFocusable.length;
        event.preventDefault(); visibleFocusable[next]?.focus(); event.stopPropagation(); return;
      }
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
    const meta = effectParameters(this.activeEffect).find((item) => item.key === key); if (!meta || !getEffect(this.activeEffect)?.ready) return;
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
    if (!validateSkillDocument(next).ok || next.effect !== this.activeEffect || !getEffect(this.activeEffect)?.ready) { this.showStatus(t('invalid'), 'error'); return false; }
    const clean = cloneSkillDocument(next); if (same(clean, this.document)) return true;
    if (history) this.pushUndo(this.document);
    this.document = clean; this.preview?.setDocument(clean); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); return true;
  }
  refreshParameters() { for (const meta of effectParameters(this.activeEffect)) this.syncParameter(meta.key); }
  undo() {
    this.endGesture(); if (!this.undoStack.length) return;
    this.redoStack.push(cloneSkillDocument(this.document)); this.document = this.undoStack.pop(); this.preview?.setDocument(this.document); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); this.showStatus(t('undone'), 'ok');
  }
  redo() {
    this.endGesture(); if (!this.redoStack.length) return;
    this.undoStack.push(cloneSkillDocument(this.document)); this.document = this.redoStack.pop(); this.preview?.setDocument(this.document); this.refreshParameters(); this.refreshButtons(); this.updatePreviewStats(); this.showStatus(t('redone'), 'ok');
  }
  resetDocument() { if (!getEffect(this.activeEffect)?.ready) return false; this.endGesture(); this.applyDocument(createDefaultSkillDocument(this.activeEffect)); this.showStatus(t('resetDone'), 'ok'); return true; }

  togglePlay() { if (!this.preview || !getEffect(this.activeEffect)?.ready) return; this.preview.playing ? this.preview.pause() : this.preview.play(); this.updatePreviewStats(); }
  seek(seconds) { if (!getEffect(this.activeEffect)?.ready) return; this.preview?.seek(Math.max(0, Number(seconds) || 0)); this.updatePreviewStats(); }
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
    if (!getEffect(this.activeEffect)?.ready) {
      this.seekInput.max = '1'; this.seekInput.value = '0'; this.timeLabel.textContent = `0 / 0 ${t('seconds')}`;
      this.playButton.textContent = t('play'); this.metricsLabel.textContent = '—'; return;
    }
    const time = Number(this.preview.time) || 0, duration = Math.max(.01, Number(this.preview.duration) || 1);
    this.seekInput.max = String(duration); this.seekInput.value = String(Math.min(time, duration));
    this.timeLabel.textContent = `${number(Math.min(time, duration), this.lang)} / ${number(duration, this.lang)} ${t('seconds')}`;
    this.playButton.textContent = t(this.preview.playing ? 'pause' : 'play');
    const stats = typeof this.preview.metrics === 'function'
      ? this.preview.metrics({ particles: true, cap: true, drawCalls: true }) : this.preview.metrics || {};
    const parts = [];
    if (this.activeEffect !== DEFAULT_SKILL_DOCUMENT.effect) {
      if (stats.textureState === 'loading') parts.push(t('atlasLoading'));
      else if (stats.textureState === 'error') parts.push(t('atlasFailed'));
      else if (stats.textureState === 'ready' && Number.isFinite(stats.atlasPixels)) parts.push(`${t('atlasReady')}: ${number(stats.atlasPixels, this.lang)} px`);
      if (getEffect(this.activeEffect)?.role === 'native') parts.push(`${t('particles')}: ${number(stats.particles || 0, this.lang)} / 512`);
      else parts.push(t('billboardNote'));
    } else if (Number.isFinite(stats.particles)) parts.push(`${t('particles')}: ${number(stats.particles, this.lang)}${Number.isFinite(stats.cap) ? ` / ${number(stats.cap, this.lang)}` : ''}`);
    if (Number.isFinite(stats.drawCalls)) parts.push(`DC: ${number(stats.drawCalls, this.lang)}`);
    this.metricsLabel.textContent = parts.join(' · ') || '—';
  }

  saveDraft() {
    if (!getEffect(this.activeEffect)?.ready || !validateSkillDocument(this.document).ok) return false;
    const storage = safeStorage();
    if (!storage) { this.storageUnavailable = true; this.showStatus(t('storage'), 'error'); return false; }
    try {
      const version = this.document.version;
      const envelope = version === 1
        ? { schema: 'marea.skill-studio-draft', version: 1, scope: this.scope, document: this.document }
        : { schema: 'marea.skill-studio-draft', version: 2, scope: this.scope, effectId: this.activeEffect, document: this.document };
      storage.setItem(this.storageKey, JSON.stringify(envelope)); storage.removeItem(this.recoveryKey);
      this.storageUnavailable = false; this.savedDocument = cloneSkillDocument(this.document); this.recoverButton.hidden = true;
      this.savedDocuments.set(this.activeEffect, cloneSkillDocument(this.document)); this.documents.set(this.activeEffect, cloneSkillDocument(this.document));
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
    const keys = value.version === 1 ? ['schema', 'version', 'scope', 'document'] : ['schema', 'version', 'scope', 'effectId', 'document'];
    if (!exactEnvelope(value, keys) || ![1, 2].includes(value.version) || value.scope !== this.scope || !validateSkillDocument(value.document).ok) return null;
    if (value.document.effect !== this.activeEffect) return null;
    if (value.version === 2 && (value.effectId !== this.activeEffect || value.document.effect !== value.effectId)) return null;
    if (recovery && value.schema !== 'marea.skill-studio-recovery') return null;
    if (!recovery && value.schema !== 'marea.skill-studio-draft') return null;
    return cloneSkillDocument(value.document);
  }
  loadDraft() {
    if (!getEffect(this.activeEffect)?.ready) return false;
    const next = this.readStored(this.storageKey);
    if (!next) { this.showStatus(t(this.storageUnavailable ? 'storage' : 'noDraft'), 'error'); return false; }
    this.applyDocument(next, { history: false }); this.savedDocument = cloneSkillDocument(next); this.documents.set(this.activeEffect, cloneSkillDocument(next)); this.savedDocuments.set(this.activeEffect, cloneSkillDocument(next)); this.undoStack.length = 0; this.redoStack.length = 0;
    this.showStatus(t('loaded'), 'ok'); this.refreshButtons(); return true;
  }
  saveRecovery() {
    const storage = safeStorage(); if (!storage) { this.storageUnavailable = true; this.showStatus(t('storage'), 'error'); return false; }
    this.stashEffect();
    const dirty = [...this.documents].filter(([id, doc]) => !same(doc, this.savedDocuments.get(id) ?? doc));
    try {
      for (const [effectId, doc] of dirty) {
        const keys = this.storageKeys(effectId), version = doc.version;
        const envelope = version === 1
          ? { schema: 'marea.skill-studio-recovery', version: 1, scope: this.scope, document: doc }
          : { schema: 'marea.skill-studio-recovery', version: 2, scope: this.scope, effectId, document: doc };
        storage.setItem(keys.recovery, JSON.stringify(envelope));
      }
      this.storageUnavailable = false; return true;
    } catch { this.showStatus(t('storage'), 'error'); return false; }
  }
  loadRecovery() {
    if (!getEffect(this.activeEffect)?.ready) return false;
    const next = this.readStored(this.recoveryKey, true);
    if (!next) { this.showStatus(t(this.storageUnavailable ? 'storage' : 'noRecovery'), 'error'); return false; }
    if (next.effect !== this.activeEffect) return false;
    this.applyDocument(next, { history: false }); this.documents.set(this.activeEffect, cloneSkillDocument(next)); this.showStatus(t('recovered'), 'ok'); this.recoverButton.hidden = true; return true;
  }
  exportDocument() {
    if (!getEffect(this.activeEffect)?.ready || !validateSkillDocument(this.document).ok) { this.showStatus(t('invalid'), 'error'); return false; }
    const blob = new Blob([`${JSON.stringify(this.document, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `marea-${this.activeEffect}-${Date.now()}.json`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); this.showStatus(t('exported'), 'ok'); return true;
  }
  async importFile(file) {
    if (!file) return;
    const epoch = this.epoch, selectionEpoch = this.selectionEpoch, effectId = this.activeEffect;
    if (!getEffect(effectId)?.ready) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('too-large');
      const next = parseSkillDocument(await file.text());
      if (!this.active || epoch !== this.epoch || selectionEpoch !== this.selectionEpoch || effectId !== this.activeEffect) return;
      if (!validateSkillDocument(next).ok) throw new Error('invalid');
      if (next.effect !== effectId) throw new Error('invalid');
      this.applyDocument(next); this.showStatus(t('imported'), 'ok');
    } catch (error) { if (this.active && epoch === this.epoch && selectionEpoch === this.selectionEpoch && effectId === this.activeEffect) this.showStatus(error?.message === 'too-large' ? t('tooLarge') : t('invalid'), 'error'); }
    finally { if (epoch === this.epoch && this.importInput?.isConnected) this.importInput.value = ''; }
  }
  refreshButtons() {
    if (!this.root) return;
    this.undoButton.disabled = !this.undoStack.length; this.redoButton.disabled = !this.redoStack.length;
    const ready = Boolean(getEffect(this.activeEffect)?.ready);
    this.saveButton.disabled = !ready || same(this.document, this.savedDocument);
    this.loadButton.disabled = !ready || !this.readStored(this.storageKey);
    this.root.classList.toggle('is-dirty', this.dirty);
    if (this.storageUnavailable && !this.statusNode.textContent) this.showStatus(t('storage'), 'error');
  }
  showStatus(message, kind = '') { this.statusText = message; this.statusKind = kind; if (this.statusNode) { this.statusNode.textContent = message; this.statusNode.dataset.kind = kind; } }

  showClosePrompt() {
    if (this.libraryOpen) this.toggleLibrary();
    this.confirmDialog.hidden = false; this.confirmMessage.textContent = t('dirtyBody'); this.keepButton.focus();
  }
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
    this.searchInput.setAttribute('aria-label', t('search'));
    this.searchInput.placeholder = t('search');
    this.categoryFilter.setAttribute('aria-label', t('category'));
    this.projectFilter.setAttribute('aria-label', t('project'));
    this.statusFilter.setAttribute('aria-label', t('state'));
    this.categoryFilter.options[0].textContent = t('allCategories');
    for (const option of this.categoryFilter.options) if (option.value === 'source-components') option.textContent = t('componentCategory');
    this.projectFilter.options[0].textContent = t('allProjects');
    this.statusFilter.options[0].textContent = t('allStatuses');
    this.statusFilter.options[1].textContent = t('readyStatus');
    this.statusFilter.options[2].textContent = t('textureStatus');
    this.statusFilter.options[3].textContent = t('candidateStatus');
    this.statusFilter.options[4].textContent = t('referenceStatus');
    this.libraryToggle.textContent = t(this.libraryOpen ? 'hideLibrary' : 'showLibrary');
    this.root.querySelector('.ss-library-note').textContent = t('private');
    this.root.querySelector('.ss-stage').setAttribute('aria-label', t('preview'));
    this.root.querySelector('.ss-viewport').setAttribute('aria-label', t('preview'));
    const speedOptions = [...this.speedSelect.options]; ['speedSlow','speedNormal','speedFast'].forEach((key, i) => { speedOptions[i].textContent = t(key); });
    this.loopInput.parentElement.lastChild.textContent = t('loop'); this.originalInput.parentElement.lastChild.textContent = `${t(['flipbook-v1', 'niagara-native-v1'].includes(getEffect(this.activeEffect)?.adapter) ? 'adapterOriginal' : 'original')} / ${t('draft')}`;
    this.speedSelect.setAttribute('aria-label', t('speed')); this.speedSelect.parentElement.firstChild.textContent = `${t('speed')} `;
    this.seekInput.setAttribute('aria-label', t('playback'));
    this.skinSelect.parentElement.firstChild.textContent = `${t('character')} · ${t('skin')}`; this.skinSelect.setAttribute('aria-label', t('skin'));
    [...this.skinSelect.options].forEach((option, i) => { option.textContent = `${t('skin')} ${i + 1}`; });
    this.quality.parentElement.firstChild.textContent = t('quality'); this.quality.setAttribute('aria-label', t('quality'));
    [...this.quality.options].forEach((option) => { option.textContent = t(option.value); });
    this.root.querySelector('.ss-inspector h2').textContent = t('visual');
    const nativeNote = this.root.querySelector('.ss-native-note');
    if (nativeNote) nativeNote.textContent = t('nativeNote');
    for (const meta of effectParameters(this.activeEffect)) {
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
    this.renderParameters(); this.renderLibrary(); this.updateEffectState(); this.refreshButtons(); this.updatePreviewStats();
  }
}
