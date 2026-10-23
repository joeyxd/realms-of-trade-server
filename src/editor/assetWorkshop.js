import { loadAssetLibrary, filterAssets, assetFacets, hasAssetPreview, publicationState } from './assetLibrary.js';
import { AssetReviewStore, DECISIONS, REVIEW_TASKS } from './assetReview.js';
import { AssetPreview } from '../render/assetPreview.js';
import { getLocale } from '../core/locale.js';

const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const button = (text, action, cls = '') => { const el = node('button', cls, text); el.type = 'button'; el.dataset.action = action; return el; };
const safeStorage = () => { try { return localStorage; } catch { return null; } };
const bytes = value => value ? `${(value / 1048576).toFixed(2)} MiB` : 'sin medir';
const typeNames = { 'static-mesh': 'Malla estática', 'skeletal-mesh': 'Malla con rig', animation: 'Animación', texture: 'Textura', material: 'Material', icon: 'Icono', vfx: 'Efecto', audio: 'Sonido', model: 'Modelo' };
const publishedText = { published: { es: 'Publicado en el editor GM', en: 'Published to the GM editor' }, 'published-other-revision': { es: 'Publicado (otra revisión)', en: 'Published (other revision)' } };
const useHint = { es: 'Usar recomienda la pieza; publicarla al editor GM es un paso del operador (PUBLICACION.md)', en: 'Usar recommends the piece; publishing it to the GM editor is an operator step (PUBLICACION.md)' };
const lang = () => (getLocale() === 'en' ? 'en' : 'es');
const symbols = { texture: '▧', material: '◉', icon: '✦', 'skeletal-mesh': '♙', animation: '↝', vfx: '✧', audio: '♪' };

/** A private asset review session. It never publishes content or joins a gameplay body. */
export class AssetWorkshop {
  constructor({ parent, renderer, scope, onClose, libraryLoader = loadAssetLibrary, storage = safeStorage() }) {
    Object.assign(this, { parent, renderer, scope, onClose, libraryLoader });
    this.store = new AssetReviewStore({ scope, storage }); this.store.load();
    this.drafts = new Map(); this.active = false; this.page = 0; this.pageSize = 24;
    this.view = 'all'; this.variantId = 'base'; this.jobs = new Map(); this.epoch = 0;
    if (!document.getElementById('mn-asset-workshop-style')) {
      const link = node('link'); link.id = 'mn-asset-workshop-style'; link.rel = 'stylesheet';
      link.href = new URL('../../styles/assetWorkshop.css', import.meta.url).href; document.head.append(link);
    }
  }
  async open() {
    if (this.active) return;
    this.active = true; const epoch = ++this.epoch; this.previousFocus = document.activeElement; this.events = new AbortController();
    this.build(); this.parent.append(this.root);
    this.preview = new AssetPreview({ renderer: this.renderer, viewport: this.viewport, onState: state => this.previewState(state) });
    this.root.focus();
    try {
      const result = await this.libraryLoader({ signal: this.events.signal }); if (!this.active || epoch !== this.epoch) return;
      this.entries = result.entries; this.published = result.published || new Map(); this.coverage = result.coverage; this.warnings = result.warnings || [];
      const facets = assetFacets(this.entries);
      this.addOptions(this.category, facets.categories.map(id => ({ id, name: id })));
      this.addOptions(this.pack, facets.packs);
      this.renderLibrary(); this.renderCoverage();
      if (this.warnings.length) this.message(this.warnings.join(' '), 'error');
      await this.select(this.entries.find(entry => hasAssetPreview(entry, this.quality.value))?.id || this.entries[0]?.id);
    } catch (error) { if (error.name === 'AbortError' && epoch !== this.epoch) return; if (epoch === this.epoch) this.close({ force: true }); throw error; }
  }
  selectControl(label, field, choices = []) {
    const select = node('select'); select.dataset.field = field; select.setAttribute('aria-label', label);
    const option = node('option', '', label); option.value = ''; select.append(option);
    this.addOptions(select, choices); return select;
  }
  addOptions(select, choices) { for (const { id, name } of choices) { const option = node('option', '', name); option.value = id; select.append(option); } }
  build() {
    const options = { signal: this.events.signal };
    this.root = node('section', 'aw-root'); this.root.id = 'asset-workshop'; this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'aw-title');
    const header = node('header', 'aw-header'), heading = node('div', 'aw-heading');
    heading.append(node('span', 'aw-eyebrow', 'BIBLIOTECA DE MAREA NEGRA'));
    const title = node('h1', '', 'Taller de assets'); title.id = 'aw-title'; heading.append(title);
    header.append(heading, node('span', 'aw-private', 'REVISIÓN LOCAL · BORRADOR'), button('Exportar sesión', 'export'), button('Importar', 'import'), button('Cerrar ×', 'close', 'aw-close'));
    this.fileInput = node('input'); this.fileInput.type = 'file'; this.fileInput.accept = '.json,application/json'; this.fileInput.hidden = true; header.append(this.fileInput);
    const toolbar = node('div', 'aw-toolbar'); this.tabs = node('nav', 'aw-tabs'); this.tabs.setAttribute('aria-label', 'Vistas de la biblioteca');
    for (const [id, label] of [['all', 'Biblioteca'], ['new', 'Nuevos'], ['ready', 'Listos para probar'], ['collection', 'Mi colección'], ['pending', 'Pendientes']]) {
      const tab = button(label, 'view'); tab.dataset.view = id; this.tabs.append(tab);
    }
    this.coverageNode = node('span', 'aw-coverage');
    this.mobileSwitches = node('div', 'aw-mobile-switches'); this.mobileSwitches.append(button('Biblioteca', 'library-panel'), button('Revisión', 'review-panel'));
    toolbar.append(this.tabs, this.coverageNode, this.mobileSwitches);
    this.library = node('aside', 'aw-library'); this.library.setAttribute('aria-label', 'Catálogo de piezas');
    this.search = node('input', 'aw-search'); this.search.type = 'search'; this.search.placeholder = 'Buscar madera, algodón, pack…'; this.search.setAttribute('aria-label', 'Buscar assets');
    this.category = this.selectControl('Todas las categorías', 'category'); this.pack = this.selectControl('Todos los packs', 'pack');
    this.status = this.selectControl('Todas las decisiones', 'status', [{ id: 'unreviewed', name: 'Sin revisar' }, { id: 'reviewed', name: 'Revisados' }]);
    const filters = node('div', 'aw-filters'); filters.append(this.category, this.pack, this.status);
    this.count = node('p', 'aw-count'); this.list = node('div', 'aw-cards');
    this.pagination = node('div', 'aw-pagination'); this.pageLabel = node('span'); this.pagination.append(button('←', 'previous'), this.pageLabel, button('→', 'next'));
    this.library.append(this.search, filters, this.count, this.list, this.pagination);
    this.center = node('main', 'aw-center'); const selected = node('div', 'aw-selected');
    this.selectedName = node('h2', '', 'Preparando biblioteca…'); this.selectedPack = node('p', 'aw-subtitle'); selected.append(this.selectedName, this.selectedPack);
    this.variant = node('select'); this.variant.setAttribute('aria-label', 'Variante de la pieza'); this.variant.dataset.field = 'variant'; selected.append(this.variant);
    this.center.append(selected);
    this.sourceWarning = node('p', 'aw-source-warning'); this.sourceWarning.hidden = true; this.center.append(this.sourceWarning);
    const viewbar = node('div', 'aw-viewbar');
    this.presentation = this.selectControl('Presentación', 'presentation', [{ id: 'pbr', name: 'PBR exportado' }, { id: 'toon', name: 'Material toon del juego' }, { id: 'compare', name: 'A/B · PBR / toon' }, { id: 'geometry', name: 'Diagnóstico · geometría' }, { id: 'wireframe', name: 'Diagnóstico · wireframe' }, { id: 'reference', name: 'Referencia fuente' }]); this.presentation.value = 'pbr';
    this.quality = this.selectControl('Perfil', 'quality', [{ id: 'desktop', name: 'Escritorio' }, { id: 'mobile', name: 'Móvil' }]); this.quality.value = matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
    this.light = this.selectControl('Luz', 'light', [{ id: 'warm', name: 'Luz cálida' }, { id: 'soft', name: 'Luz suave' }]); this.light.value = 'warm';
    viewbar.append(this.presentation, this.quality, this.light); this.center.append(viewbar);
    this.viewport = node('div', 'aw-viewport'); this.viewport.setAttribute('aria-label', 'Vista 3D: arrastrar para girar y rueda para acercar');
    this.overlay = node('div', 'aw-overlay'); this.overlay.setAttribute('role', 'status'); this.viewport.append(this.overlay);
    this.compareLabels = node('div', 'aw-compare-labels'); this.compareLabels.hidden = true; this.compareLabels.append(node('span', '', 'PBR EXPORTADO'), node('span', '', 'TOON DEL JUEGO')); this.viewport.append(this.compareLabels);
    const stageHint = node('span', 'aw-stage-hint', 'Arrastra para girar · rueda / + − para acercar'); this.viewport.append(stageHint); this.center.append(this.viewport);
    const controls = node('div', 'aw-camera-tools'); controls.append(button('↻ Giro', 'rotate'), button('+', 'zoom-in'), button('−', 'zoom-out'), button('Centrar', 'reset-camera'), button('Cámara de juego', 'game-camera'), button('Reintentar', 'retry'));
    this.metrics = node('p', 'aw-metrics', 'Selecciona una pieza para inspeccionarla.');
    this.presentationNote = node('p', 'aw-note', 'PBR y toon muestran el derivado real. La referencia Unreal y la aceptación dentro del mundo se verifican por separado.');
    this.center.append(controls, this.metrics, this.presentationNote);
    this.inspector = node('aside', 'aw-inspector'); this.inspector.setAttribute('aria-label', 'Decisión y procedencia');
    this.inspector.append(node('span', 'aw-eyebrow', 'DARLE UN DESTINO'), node('h2', '', 'Nuestra revisión'));
    this.decisionButtons = node('div', 'aw-decisions');
    for (const decision of DECISIONS) { const control = button(decision.label, 'decision'); control.dataset.decision = decision.id; this.decisionButtons.append(control); }
    this.use = node('input'); this.use.maxLength = 160; this.use.placeholder = 'Ej. estación de cocina'; this.use.dataset.reviewField = 'use';
    this.collection = node('input'); this.collection.maxLength = 100; this.collection.placeholder = 'Ej. taller de cuero'; this.collection.dataset.reviewField = 'collection';
    this.publishedBadge = node('p', 'aw-published'); this.publishedBadge.hidden = true;
    const hint = node('p', 'aw-note aw-use-hint', `${useHint[lang()]}.`);
    this.inspector.append(this.decisionButtons, hint, this.publishedBadge, this.field('Uso previsto', this.use), this.field('Colección de trabajo', this.collection));
    const tasks = node('fieldset', 'aw-tasks'); tasks.append(node('legend', '', 'Trabajo que necesita'));
    for (const task of REVIEW_TASKS) { const label = node('label'), input = node('input'); input.type = 'checkbox'; input.value = task.id; input.dataset.reviewTask = task.id; label.append(input, node('span', '', task.label)); tasks.append(label); }
    this.inspector.append(tasks);
    this.notes = node('textarea'); this.notes.rows = 4; this.notes.maxLength = 4000; this.notes.placeholder = 'Qué nos gusta, qué falla, qué probar…'; this.notes.dataset.reviewField = 'notes';
    this.inspector.append(this.field('Notas', this.notes));
    this.saveStatus = node('p', 'aw-save-status'); this.saveStatus.setAttribute('role', 'status');
    this.inspector.append(button('Guardar revisión', 'save', 'aw-primary'), this.saveStatus);
    this.conflictButton = button('Cargar revisión guardada', 'reload-review'); this.conflictButton.hidden = true; this.inspector.append(this.conflictButton);
    this.recoveryButton = button('Recuperar borradores del archivo', 'recover-import'); this.recoveryButton.hidden = true; this.inspector.append(this.recoveryButton);
    this.provenance = node('details', 'aw-provenance'); this.provenance.open = true; this.inspector.append(this.provenance, button('Añadir al lote de preparación', 'queue'));
    const footer = node('footer', 'aw-footer'); this.statusNode = node('p'); this.statusNode.setAttribute('role', 'status'); this.queueCount = node('span'); footer.append(this.statusNode, this.queueCount, button('Exportar lote', 'export-jobs'));
    this.root.append(header, toolbar, this.library, this.center, this.inspector, footer);
    this.root.addEventListener('click', event => this.action(event), options);
    this.root.addEventListener('input', event => {
      if (event.target === this.search) { this.page = 0; this.renderLibrary(); }
      if (event.target.dataset.reviewField) this.updateDraft();
    }, options);
    this.root.addEventListener('change', event => {
      if (event.target.dataset.reviewTask) this.updateDraft();
      if ([this.category, this.pack, this.status].includes(event.target)) { this.page = 0; this.renderLibrary(); }
      if (event.target === this.variant) void this.changeVariant(this.variant.value);
      if (event.target === this.quality) { this.renderLibrary(); void this.loadPreview(); }
      if (event.target === this.light) this.preview.setLight(this.light.value);
      if (event.target === this.presentation) { this.preview.mode = this.presentation.value; this.showPresentation(); }
    }, options);
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) { this.message('La sesión supera 2 MiB.', 'error'); return; }
      if (!this.flushAll()) { this.message('Exporta los cambios pendientes antes de importar otra sesión.', 'error'); return; }
      const text = await file.text(), result = this.store.import(text, { mode: 'merge' });
      if (result.error === 'pending_drafts') { this.importRecovery = { text, drafts: result.recoverableDrafts }; this.recoveryButton.hidden = false; this.message('El archivo contiene borradores pendientes. Usa Recuperar borradores para revisarlos sin sobrescribir notas.', 'error'); }
      else if (!result.ok) this.message(`No se importó la sesión: ${result.error}`, 'error');
      else { this.drafts.clear(); this.renderReview(); this.renderLibrary(); this.message('Sesión importada en esta cuenta y servidor.'); }
      this.fileInput.value = '';
    }, options);
    window.addEventListener('keydown', event => {
      if (!this.active) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key === 'Tab') {
        const focusable = [...this.root.querySelectorAll('button,input,select,textarea,summary')].filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && [first, this.root].includes(document.activeElement)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && [last, this.root].includes(document.activeElement)) { event.preventDefault(); first?.focus(); }
      }
    }, { ...options, capture: true });
    window.addEventListener('pagehide', () => this.flushAll(), options);
    this.renderQueue();
  }
  field(label, input) { const el = node('label', 'aw-field'); el.append(node('span', '', label), input); return el; }
  reviewMap() {
    return Object.fromEntries((this.entries || []).map(entry => {
      const variants = entry.variants?.length ? entry.variants.map(v => v.id) : ['base'];
      if (this.selected?.id === entry.id) variants.sort(id => id === this.variantId ? -1 : 1);
      const records = variants.map(id => this.drafts.get(`${entry.id}:${id}`)?.value || this.store.get(entry, id)).filter(Boolean);
      const current = records[0];
      return [entry.id, current ? { ...current, collection: records.find(record => record.collection)?.collection || '', notes: records.map(record => record.notes).join(' ') } : null];
    }));
  }
  renderLibrary() {
    if (!this.entries) return;
    const reviews = this.reviewMap();
    let entries = filterAssets(this.entries, { query: this.search.value, category: this.category.value, pack: this.pack.value, status: this.status.value, newOnly: this.view === 'new', reviews });
    if (this.view === 'ready') entries = entries.filter(entry => hasAssetPreview(entry, this.quality.value));
    if (this.view === 'pending') entries = entries.filter(entry => !hasAssetPreview(entry, this.quality.value));
    if (this.view === 'collection') entries = entries.filter(entry => reviews[entry.id]?.collection);
    const pages = Math.max(1, Math.ceil(entries.length / this.pageSize)); this.page = Math.min(this.page, pages - 1);
    this.list.replaceChildren();
    for (const entry of entries.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) {
      const card = button('', 'select', `aw-card${entry.id === this.selected?.id ? ' is-selected' : ''}`); card.dataset.assetId = entry.id; card.setAttribute('aria-pressed', String(entry.id === this.selected?.id));
      const visual = node('span', 'aw-card-visual', symbols[entry.type] || '⬡');
      const thumbnail = entry.thumbnail || (['texture', 'icon'].includes(entry.preview?.kind) ? entry.preview.mobile?.url : null);
      if (thumbnail) { visual.textContent = ''; const img = node('img'); img.src = thumbnail; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => { img.remove(); visual.textContent = symbols[entry.type] || '⬡'; }, { once: true }); visual.append(img); }
      const copy = node('span', 'aw-card-copy'); copy.append(node('strong', '', entry.name), node('small', '', entry.packName));
      const ready = hasAssetPreview(entry, this.quality.value);
      const limits = [...(entry.limitations || []), ...(entry.variants || []).flatMap(variant => variant.limitations || [])];
      const geometryOnly = limits.some(text => /geometry|geometría|placeholder|retextur/i.test(text));
      const badge = node('span', `aw-badge ${ready ? 'is-ready' : ''}`, ready ? geometryOnly ? 'Geometría · material pendiente' : 'Prueba disponible' : 'Preparación pendiente');
      const decision = reviews[entry.id]?.decision; copy.append(badge);
      const publication = publicationState(entry, this.published);
      if (publication) copy.append(node('span', `aw-published${publication === 'published' ? '' : ' is-other-revision'}`, publishedText[publication][lang()]));
      if (decision && decision !== 'unreviewed') copy.append(node('small', 'aw-card-decision', DECISIONS.find(d => d.id === decision)?.label || decision));
      card.append(visual, copy); this.list.append(card);
    }
    if (!entries.length) this.list.append(node('p', 'aw-empty', 'No hay piezas con estos filtros.'));
    this.count.textContent = `${entries.length} piezas · ${entries.filter(entry => hasAssetPreview(entry, this.quality.value)).length} pruebas disponibles`;
    this.pageLabel.textContent = `${this.page + 1} / ${pages}`;
    this.pagination.querySelector('[data-action="previous"]').disabled = this.page === 0;
    this.pagination.querySelector('[data-action="next"]').disabled = this.page === pages - 1;
    this.tabs.querySelectorAll('button').forEach(tab => { tab.classList.toggle('is-active', tab.dataset.view === this.view); tab.setAttribute('aria-pressed', String(tab.dataset.view === this.view)); });
  }
  renderCoverage() {
    this.coverageNode.textContent = `SESIÓN PILOTO · ${this.entries.length} piezas`;
    this.coverageNode.title = 'El inventario completo es la base de investigación. Esta sesión prepara una selección de piezas; no implica revisión de todo el Vault.';
  }
  async select(id) {
    const entry = this.entries?.find(entry => entry.id === id); if (!entry) return;
    this.flushCurrent(); this.selected = entry; this.variantId = entry.variants?.[0]?.id || 'base';
    this.selectedName.textContent = entry.name; this.selectedPack.textContent = `${entry.packName} · ${typeNames[entry.type] || entry.type}`;
    this.variant.replaceChildren();
    this.addOptions(this.variant, entry.variants?.length ? entry.variants.map(v => ({ id: v.id, name: v.label || v.id })) : [{ id: 'base', name: 'Variante base' }]); this.variant.value = this.variantId; this.variant.hidden = !entry.variants?.length;
    const limits = [...(entry.limitations || []), ...(entry.variants?.find(v => v.id === this.variantId)?.limitations || [])];
    this.presentation.value = limits.some(text => /geometry|geometría|placeholder|retextur/i.test(text)) ? 'geometry' : 'pbr';
    this.preview.mode = this.presentation.value;
    this.root.classList.remove('aw-show-library'); this.mobileSwitches.querySelector('[data-action="library-panel"]').setAttribute('aria-expanded', 'false');
    this.renderPublication(); this.renderReview(); this.renderProvenance(); this.renderLibrary(); await this.loadPreview();
  }
  renderPublication() {
    const publication = publicationState(this.selected, this.published);
    this.publishedBadge.hidden = !publication;
    this.publishedBadge.className = `aw-published${publication === 'published-other-revision' ? ' is-other-revision' : ''}`;
    this.publishedBadge.textContent = publication ? publishedText[publication][lang()] : '';
  }
  async changeVariant(id) { this.flushCurrent(); this.variantId = id; this.renderReview(); this.renderProvenance(); await this.loadPreview(); }
  async loadPreview() {
    const preview = this.preview, epoch = this.epoch;
    if (this.selected && this.active && preview) { await preview.select(this.selected, this.quality.value, this.variantId); if (this.active && this.epoch === epoch && this.preview === preview) this.showPresentation(); }
  }
  showPresentation() {
    const reference = this.presentation.value === 'reference';
    this.preview.mode = reference ? 'pbr' : this.presentation.value; this.compareLabels.hidden = this.preview.mode !== 'compare' || reference;
    const variant = this.selected?.variants?.find(v => v.id === this.variantId);
    const limits = [...(this.selected?.limitations || []), ...(variant?.limitations || [])];
    const geometryOnly = limits.some(text => /geometry|geometría|placeholder|retextur/i.test(text));
    this.sourceWarning.hidden = !geometryOnly;
    this.sourceWarning.textContent = geometryOnly ? 'Revisión de geometría: materiales incompletos. El aspecto fuente todavía necesita preparación.' : '';
    this.presentationNote.textContent = ['geometry', 'wireframe'].includes(this.presentation.value)
      ? 'Diagnóstico de la malla fuente con material neutro. Permite inspeccionar la forma; no muestra la apariencia original.'
      : 'PBR y toon muestran el derivado real. La referencia Unreal y la aceptación dentro del mundo se verifican por separado.';
    if (reference) { this.overlay.hidden = false; this.overlay.textContent = 'Referencia fuente pendiente de captura. El render navegable se ofrece en PBR / toon; no se presenta como una captura de Unreal.'; }
    else this.previewState(this.preview.state);
  }
  previewState(state) {
    if (!this.active || !this.overlay) return;
    this.overlay.hidden = state.status === 'ready'; this.overlay.dataset.status = state.status;
    this.overlay.textContent = state.status === 'loading' ? 'Preparando la pieza en el visor…' : state.message || 'Selecciona una pieza.';
    if (state.status === 'ready') {
      const dimensions = state.textureDimensions.map(t => `${t.width}×${t.height}`).join(', ') || 'sin texturas';
      this.metrics.textContent = `${state.triangles.toLocaleString('es-MX')} triángulos · ${state.materialCount} materiales · ${bytes(state.bytes)} descargados · texturas ${dimensions} · memoria RGBA estimada ${bytes(state.estimatedTextureBytes)}`;
      this.metrics.title = state.url;
    } else this.metrics.textContent = state.status === 'pending' ? 'La fuente está inventariada; su render y su coste todavía no están comprobados.' : 'El visor carga una sola pieza a la vez.';
    if (this.presentation.value === 'reference') this.showPresentation();
  }
  draftKey() { return this.selected ? `${this.selected.id}:${this.variantId}` : ''; }
  draft() {
    const key = this.draftKey(); if (!key) return null;
    if (!this.drafts.has(key)) {
      const record = this.store.get(this.selected, this.variantId);
      this.drafts.set(key, { entry: this.selected, variantId: this.variantId, expectedRevision: record?.revision || 0,
        value: { decision: record?.decision || 'unreviewed', tasks: [...(record?.tasks || [])], use: record?.use || '', collection: record?.collection || '', notes: record?.notes || '' }, dirty: false });
    }
    return this.drafts.get(key);
  }
  renderReview() {
    const draft = this.draft(); if (!draft) return;
    for (const key of ['use', 'collection', 'notes']) this[key].value = draft.value[key];
    this.inspector.querySelectorAll('[data-review-task]').forEach(input => { input.checked = draft.value.tasks.includes(input.value); });
    this.decisionButtons.querySelectorAll('button').forEach(control => { const selected = control.dataset.decision === draft.value.decision; control.classList.toggle('is-selected', selected); control.setAttribute('aria-pressed', String(selected)); });
    this.saveStatus.textContent = draft.dirty ? 'Cambios pendientes de guardar.' : draft.expectedRevision ? `Revisión ${draft.expectedRevision} · guardada en este dispositivo` : 'Sin revisar · guardado local por cuenta y servidor';
    this.conflictButton.hidden = true;
    const history = this.store.getHistory(this.selected, this.variantId);
    if (history?.some(record => record.sourceRevision !== this.selected.sourceRevision)) this.saveStatus.textContent += ' · Existe una revisión de otra versión fuente.';
  }
  updateDraft(decision) {
    const draft = this.draft(); if (!draft) return;
    if (decision) draft.value.decision = decision;
    for (const key of ['use', 'collection', 'notes']) draft.value[key] = this[key].value;
    draft.value.tasks = [...this.inspector.querySelectorAll('[data-review-task]:checked')].map(input => input.value);
    draft.dirty = true; this.renderReview(); clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.flushCurrent(); this.renderLibrary(); }, 450);
  }
  flushDraft(draft) {
    if (!draft?.dirty) return true;
    const result = this.store.save(draft.entry, { ...draft.value, variantId: draft.variantId }, { expectedRevision: draft.expectedRevision });
    if (result.ok) { draft.dirty = false; draft.expectedRevision = result.record.revision; if (this.draft() === draft) { this.saveStatus.textContent = `Revisión ${result.record.revision} · guardada en este dispositivo`; this.conflictButton.hidden = true; } return true; }
    const message = result.error === 'conflict' ? 'Otra sesión cambió esta revisión. Tus notas se conservan; exporta o carga la versión guardada.' : 'No se pudo guardar en este dispositivo. Conservamos tus cambios en esta sesión; expórtalos.';
    this.message(message, 'error'); this.saveStatus.textContent = message;
    this.conflictButton.hidden = result.error !== 'conflict'; return false;
  }
  flushCurrent() { clearTimeout(this.saveTimer); return this.flushDraft(this.drafts.get(this.draftKey())); }
  flushAll() { clearTimeout(this.saveTimer); let ok = true; for (const draft of this.drafts.values()) if (!this.flushDraft(draft)) ok = false; return ok; }
  renderProvenance() {
    this.provenance.replaceChildren(node('summary', '', 'Procedencia y límites'));
    const entry = this.selected;
    this.provenance.append(node('p', '', entry.originalName || entry.name), node('code', '', entry.source?.paths?.join('\n') || entry.source?.package || entry.source?.path || 'Catálogo integrado'));
    this.provenance.append(node('p', '', `Versión: ${(entry.sourceRevision || '').slice(0, 16)}…`));
    const variant = entry.variants?.find(v => v.id === this.variantId);
    for (const limitation of [...(entry.limitations || []), ...(variant?.limitations || [])]) this.provenance.append(node('p', 'aw-limit', limitation));
    this.provenance.append(node('p', 'aw-limit', 'Prueba disponible significa que podemos inspeccionar el derivado. Su aceptación para un uso concreto depende de nuestra revisión.'));
  }
  queueSelected() {
    const entry = this.selected; if (!entry) return;
    this.jobs.set(entry.id, { assetId: entry.id, sourceRevision: entry.sourceRevision, variantId: this.variantId, profiles: ['desktop', 'mobile'], requested: ['source-reference', 'interactive-preview'], use: this.draft()?.value.use || '' });
    this.renderQueue(); this.message('Pieza añadida al lote. Exporta el lote para prepararlo localmente.');
  }
  renderQueue() { this.queueCount.textContent = `${this.jobs.size} piezas en lote`; }
  download(text, name) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  exportSession() {
    this.flushAll();
    const document = JSON.parse(this.store.export());
    // Failed saves are exported separately, never disguised as committed review history.
    const pending = [...this.drafts.values()].filter(draft => draft.dirty).map(draft => ({ assetId: draft.entry.id, sourceRevision: draft.entry.sourceRevision, variantId: draft.variantId, expectedRevision: draft.expectedRevision, ...draft.value }));
    if (pending.length) document.pendingDrafts = pending;
    this.download(JSON.stringify(document, null, 2), 'marea-revision-assets.json'); this.message('Sesión exportada con cualquier borrador pendiente.');
  }
  recoverImport() {
    if (!this.importRecovery) return;
    const document = JSON.parse(this.importRecovery.text); delete document.pendingDrafts;
    const result = this.store.import(JSON.stringify(document), { mode: 'merge' });
    if (!result.ok) { this.message(`La recuperación conserva el archivo original: ${result.error}`, 'error'); return; }
    let recovered = 0;
    for (const record of this.importRecovery.drafts) {
      const entry = this.entries.find(entry => entry.id === record.assetId && entry.sourceRevision === record.sourceRevision);
      if (!entry || !(entry.variants?.map(v => v.id) || ['base']).includes(record.variantId)) continue;
      const key = `${entry.id}:${record.variantId}`;
      if (this.drafts.get(key)?.dirty) continue;
      this.drafts.set(key, { entry, variantId: record.variantId, expectedRevision: record.expectedRevision,
        value: { decision: record.decision, tasks: record.tasks, use: record.use, collection: record.collection, notes: record.notes }, dirty: true }); recovered++;
    }
    this.recoveryButton.hidden = true; this.importRecovery = null; this.renderReview(); this.renderLibrary();
    this.message(`${recovered} borradores recuperados. Guarda tras revisarlos; fuentes distintas o notas ya abiertas se conservaron aparte.`);
  }
  action(event) {
    const control = event.target.closest('[data-action]'); if (!control) return;
    const action = control.dataset.action;
    if (action === 'select') void this.select(control.dataset.assetId);
    if (action === 'view') { this.view = control.dataset.view; this.page = 0; this.renderLibrary(); }
    if (action === 'previous' || action === 'next') { this.page += action === 'next' ? 1 : -1; this.renderLibrary(); }
    if (action === 'decision') this.updateDraft(control.dataset.decision);
    if (action === 'save') { this.flushCurrent(); this.renderLibrary(); }
    if (action === 'reload-review') { this.drafts.delete(this.draftKey()); this.store.load(); this.renderReview(); this.renderLibrary(); }
    if (action === 'reset-camera') this.preview.resetCamera();
    if (action === 'game-camera') this.preview.gameCamera();
    if (action === 'rotate') { this.preview.rotating = !this.preview.rotating; control.setAttribute('aria-pressed', String(this.preview.rotating)); }
    if (action === 'zoom-in' || action === 'zoom-out') this.preview.distance = Math.max(3.5, Math.min(16, this.preview.distance + (action === 'zoom-in' ? -1 : 1)));
    if (action === 'retry') void this.loadPreview();
    if (action === 'export') this.exportSession();
    if (action === 'import') this.fileInput.click();
    if (action === 'recover-import') this.recoverImport();
    if (action === 'library-panel' || action === 'review-panel') {
      const ownClass = action === 'library-panel' ? 'aw-show-library' : 'aw-show-review';
      const otherClass = action === 'library-panel' ? 'aw-show-review' : 'aw-show-library';
      this.root.classList.remove(otherClass); this.root.classList.toggle(ownClass);
      this.mobileSwitches.querySelectorAll('button').forEach(button => button.setAttribute('aria-expanded', String(this.root.classList.contains(button.dataset.action === 'library-panel' ? 'aw-show-library' : 'aw-show-review'))));
    }
    if (action === 'queue') this.queueSelected();
    if (action === 'export-jobs') this.download(JSON.stringify({ schema: 'marea.asset-preparation-batch.v1', createdAt: new Date().toISOString(), jobs: [...this.jobs.values()] }, null, 2), 'marea-lote-assets.json');
    if (action === 'close') this.close();
  }
  message(text, kind = '') { this.statusNode.textContent = text; this.statusNode.dataset.kind = kind; }
  update(dt) { if (this.active) this.preview?.render(dt); }
  close({ force = false } = {}) {
    if (!this.active) return true;
    if (!this.flushAll() && !force) { this.message('Los cambios siguen abiertos. Exporta la sesión para conservarlos antes de cerrar.', 'error'); return false; }
    this.active = false; this.epoch++; this.events.abort(); this.preview?.dispose(); this.preview = null; this.root.remove();
    this.previousFocus?.isConnected && this.previousFocus.focus({ preventScroll: true }); this.onClose?.(); return true;
  }
  dispose() { this.close({ force: true }); clearTimeout(this.saveTimer); }
}
