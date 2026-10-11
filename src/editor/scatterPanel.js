import { onLocaleChange } from '../core/locale.js';

const labels = {
  title: ['Decorative scatter', 'Dispersión decorativa'],
  enabled: ['Enable scatter brush', 'Activar pincel de dispersión'],
  radius: ['Radius', 'Radio'], strength: ['Density', 'Densidad'], falloff: ['Soft edge', 'Caída suave'],
  shape: ['Brush shape', 'Forma del pincel'], aspect: ['Ellipse aspect', 'Proporción de elipse'],
  rotation: ['Brush rotation', 'Giro del pincel'], spacing: ['Minimum spacing', 'Separación mínima'],
  scaleMin: ['Smallest scale', 'Escala mínima'], scaleMax: ['Largest scale', 'Escala máxima'], seed: ['Seed', 'Semilla'],
  circle: ['Circle', 'Círculo'], square: ['Square', 'Cuadrado'], ellipse: ['Ellipse', 'Elipse'],
  noAsset: ['Choose a prepared model in the library.', 'Elige un modelo preparado en la biblioteca.'],
  ready: ['Selected model', 'Modelo seleccionado'], triangles: ['Triangles per copy', 'Triángulos por copia'],
  primitives: ['Visible primitives per copy', 'Primitivas visibles por copia'], geometry: ['Shared geometries', 'Geometrías compartidas'],
  materials: ['Shared materials', 'Materiales compartidos'], file: ['Model file', 'Archivo del modelo'], savings: ['Saved vs. original', 'Ahorro frente al original'],
  textures: ['Loaded textures', 'Texturas cargadas'], textureEstimate: ['Estimated RGBA8 + mipmaps', 'Estimación RGBA8 + mipmaps'],
  result: ['Last preview', 'Última vista previa'], decorative: ['Decorative copies only: no harvesting, cutting, terrain changes, or collision.',
    'Solo copias decorativas: no se recolectan ni talan, no cambian el terreno ni tienen colisión.'],
  private: ['Changes stay in this private draft. Per gesture: max 120 copies, 250,000 triangles, 256 visible primitives. Authored additions total: max 1,000,000 triangles and 1,024 visible primitives. Draft limit: 1,000 changes.',
    'Los cambios quedan en este borrador privado. Por trazo: máximo 120 copias, 250,000 triángulos y 256 primitivas visibles. Total añadido: máximo 1,000,000 triángulos y 1,024 primitivas visibles. Límite del borrador: 1,000 cambios.'],
  gestureCost: ['Actual gesture cost', 'Coste real del trazo'], visiblePrimitives: ['visible primitives', 'primitivas visibles'],
  authoredTotal: ['Authored content total', 'Total del contenido creado'],
  costScope: ['Measured authored content only. Base world, shadows, outline and runtime overhead are excluded; this is not an FPS estimate.',
    'Solo mide contenido creado. Excluye el mundo base, sombras, contorno y coste de ejecución; no estima FPS.'],
  errorAsset: ['Choose a prepared model first.', 'Primero elige un modelo preparado.'],
  errorPoints: ['The stroke is too long. Start a shorter gesture.', 'El trazo es demasiado largo. Empieza uno más corto.'],
  errorCapacity: ['The complete stroke exceeds a placement or draft budget.', 'El trazo completo supera el presupuesto de copias o del borrador.'],
  errorParameters: ['One or more brush settings are outside the allowed range.', 'Uno o más ajustes del pincel están fuera del rango permitido.'],
  errorMetrics: ['The selected model has incomplete cost measurements.', 'Faltan mediciones de coste del modelo seleccionado.'],
  errorProtected: ['The whole stroke does not fit on allowed dry ground.', 'El trazo completo no cabe en suelo seco permitido.'],
  errorGeneric: ['The stroke could not be previewed. Nothing was added.', 'No se pudo previsualizar el trazo. No se añadió nada.'],
};

const fields = [
  ['radius', 2, 24, .5], ['strength', .05, 1, .05], ['falloff', 0, 1, .05],
  ['shape', ['circle', 'square', 'ellipse']], ['aspect', .25, 1, .05], ['rotation', 0, 360, 5],
  ['spacing', .5, 48, .5], ['scaleMin', .1, 10, .05], ['scaleMax', .1, 10, .05], ['seed', 0, 4294967295, 1],
];
const bytes = (value) => {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} B`;
  if (value < 1e6) return `${(value / 1000).toFixed(1)} KB`;
  return `${(value / 1e6).toFixed(2)} MB`;
};
const integer = (value) => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';

/** Safe DOM-only controls and measured model-cost summary for decorative scatter. */
export class ScatterPanel {
  constructor({ root, editor, onTool = () => {} } = {}) {
    if (!root || !editor) throw new TypeError('ScatterPanel requires root and editor');
    this.root = root; this.editor = editor; this.document = root.ownerDocument || document; this.onTool = onTool;
    this.radius = 6; this.strength = .5; this.falloff = .5; this.shape = 'circle'; this.aspect = .5;
    this.rotation = 0; this.spacing = 3; this.scaleMin = .8; this.scaleMax = 1.2; this.seed = 1;
    this.entry = null; this.metrics = null; this.enabled = false; this.result = null; this.error = null;
    this.element = this.document.createElement('section'); this.element.className = 'gm-scatter-panel';
    this.onChange = (event) => {
      const control = event.target;
      if (control.dataset?.scatterTool !== undefined) { if (event.type === 'change') this.select(control.checked); return; }
      const field = control.dataset?.scatterField;
      if (field) this[field] = Number(control.value);
      const select = control.dataset?.scatterSelect;
      if (select && event.type === 'change') this[select] = control.value;
      this._syncValues(); this._syncControls();
    };
    this.element.addEventListener('input', this.onChange); this.element.addEventListener('change', this.onChange);
    root.appendChild(this.element); this.unsubscribeLocale = onLocaleChange(() => this.render()); this.render();
  }

  t(key) { const pair = labels[key]; return this.editor._t(pair[0], pair[1]); }
  parameters() { return { radius: this.radius, strength: this.strength, falloff: this.falloff, shape: this.shape,
    aspect: this.aspect, rotation: this.rotation, spacing: this.spacing, scaleMin: this.scaleMin, scaleMax: this.scaleMax, seed: this.seed }; }
  select(enabled) {
    this.enabled = !!enabled;
    const checkbox = this.element.querySelector('[data-scatter-tool]'); if (checkbox) checkbox.checked = this.enabled;
    this.onTool(this.enabled);
    this._syncControls();
  }
  setAsset(entry, metrics) { this.entry = entry || null; this.metrics = metrics || null; this.error = null; this.result = null; this.render(); }
  setResult(result, error = null) { this.result = result || null; this.error = error || null; this._renderSummary(); }
  _input(field, min, max, step) {
    const label = this.document.createElement('label'), caption = this.document.createElement('span'); caption.textContent = this.t(field);
    const input = this.document.createElement('input'); input.type = field === 'seed' ? 'number' : 'range'; input.min = min; input.max = max; input.step = step;
    input.value = String(this[field]); input.dataset.scatterField = field;
    const output = this.document.createElement('output'); output.dataset.scatterValue = field;
    label.append(caption, input, output); return label;
  }
  _select(field, options) {
    const label = this.document.createElement('label'), caption = this.document.createElement('span'); caption.textContent = this.t(field);
    const select = this.document.createElement('select'); select.dataset.scatterSelect = field;
    for (const value of options) { const option = this.document.createElement('option'); option.value = value; option.textContent = this.t(value); select.append(option); }
    select.value = this[field]; label.append(caption, select); return label;
  }
  _control(field, node) { node.dataset.scatterControl = field; return node; }
  _note(text) { const p = this.document.createElement('p'); p.className = 'gm-scatter-help'; p.textContent = text; return p; }
  render() {
    const doc = this.document, title = doc.createElement('h3'); title.textContent = this.t('title');
    const toggle = doc.createElement('label'), caption = doc.createElement('span'); caption.textContent = this.t('enabled');
    const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = this.enabled; checkbox.dataset.scatterTool = '';
    toggle.append(caption, checkbox);
    const controls = fields.map(([field, min, max, step]) => field === 'shape'
      ? this._control(field, this._select(field, min)) : this._control(field, this._input(field, min, max, step)));
    const summary = doc.createElement('div'); summary.className = 'gm-scatter-summary'; summary.dataset.scatterSummary = '';
    const help = this._note(this.t('decorative')), budget = this._note(this.t('private'));
    this.element.replaceChildren(title, toggle, summary, ...controls, help, budget);
    this._syncValues(); this._syncControls(); this._renderSummary();
  }
  _syncValues() {
    for (const [field] of fields) {
      const output = this.element.querySelector(`[data-scatter-value="${field}"]`);
      if (output) output.value = field === 'seed' ? String(this[field]) : Number(this[field]).toFixed(['radius', 'rotation', 'spacing'].includes(field) ? 1 : 2);
    }
  }
  _syncControls() {
    const checkbox = this.element.querySelector('[data-scatter-tool]'); if (checkbox) checkbox.checked = this.enabled;
    for (const node of this.element.querySelectorAll('[data-scatter-control]')) node.hidden = !this.enabled;
    const aspect = this.element.querySelector('[data-scatter-control="aspect"]'); if (aspect) aspect.hidden = !this.enabled || this.shape !== 'ellipse';
  }
  _renderSummary() {
    const node = this.element.querySelector('[data-scatter-summary]'); if (!node) return;
    const doc = this.document; const rows = [];
    const row = (name, value) => { const p = doc.createElement('p'); const b = doc.createElement('b'); b.textContent = `${name}: `; const span = doc.createElement('span'); span.textContent = String(value); p.append(b, span); rows.push(p); };
    if (!this.entry || !this.metrics) row(this.t('ready'), this.t('noAsset'));
    else {
      const m = this.metrics, stats = this.entry.stats || {};
      const modelBytes = Number(stats.bytes), originalBytes = Number(stats.sourceBytes);
      const currentEntry = this.editor.catalog?.items?.find(candidate => candidate.id === this.entry.id) || this.entry;
      const label = typeof currentEntry.label === 'string' ? currentEntry.label
        : currentEntry.label?.[this.editor.lang] || currentEntry.label?.es || currentEntry.label?.en || currentEntry.name || currentEntry.id;
      row(this.t('ready'), label);
      row(this.t('triangles'), integer(m.triangles)); row(this.t('primitives'), integer(m.primitives));
      row(this.t('geometry'), integer(m.geometries)); row(this.t('materials'), integer(m.materials));
      row(this.t('file'), Number.isFinite(modelBytes) ? bytes(modelBytes) : '—');
      row(this.t('savings'), Number.isFinite(modelBytes) && Number.isFinite(originalBytes) && originalBytes > 0
        ? `${bytes(Math.max(0, originalBytes - modelBytes))} (${Math.max(0, (1 - modelBytes / originalBytes) * 100).toFixed(1)}%)` : '—');
      row(this.t('textures'), (m.textures || []).map(({ width, height }) => `${width}×${height}`).join(', ') || '—');
      row(this.t('textureEstimate'), bytes(m.textureBytes));
    }
    if (this.result || this.error) {
      const result = this.result || {};
      row(this.t('result'), this.error ? this.t(this._errorLabel(this.error))
        : `${integer(result.plan?.placements?.length ?? result.count ?? 0)} · ${this.editor._t('skipped', 'omitidas')}: ${integer(result.plan?.skipped ?? result.skipped ?? 0)}`);
      if (this.error) rows.at(-1).dataset.kind = 'error';
      const cost = result.plan?.cost || result.cost;
      if (cost) {
        row(this.t('gestureCost'), `${integer(cost.triangles)} tris · ${integer(cost.primitives)} ${this.t('visiblePrimitives')}`);
        rows.at(-1).dataset.scatterCost = '';
        if (Number.isFinite(cost.totalTriangles) && Number.isFinite(cost.totalPrimitives)) {
          row(this.t('authoredTotal'), `${integer(cost.totalTriangles)} tris · ${integer(cost.totalPrimitives)} ${this.t('visiblePrimitives')}`);
          rows.at(-1).dataset.scatterCost = '';
          const note = doc.createElement('p'); note.className = 'gm-scatter-help'; note.textContent = this.t('costScope'); rows.push(note);
        }
      }
    }
    node.replaceChildren(...rows);
  }
  _errorLabel(error) {
    const code = String(error?.code || '').replace(/^scatter_/, '');
    if (code === 'asset') return 'errorAsset';
    if (code === 'points') return 'errorPoints';
    if (['object_limit', 'triangle_limit', 'primitive_limit', 'document_limit', 'candidate_limit',
      'authored_triangle_limit', 'authored_primitive_limit'].includes(code)) return 'errorCapacity';
    if (code === 'parameters') return 'errorParameters';
    if (code === 'metrics') return 'errorMetrics';
    if (['policy', 'map', 'protected_ground', 'protected_area', 'protected_route'].includes(code)) return 'errorProtected';
    return 'errorGeneric';
  }
  dispose() {
    this.unsubscribeLocale?.(); this.element.removeEventListener('input', this.onChange); this.element.removeEventListener('change', this.onChange); this.element.remove();
  }
}
