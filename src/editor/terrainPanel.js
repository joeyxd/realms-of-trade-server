import { onLocaleChange } from '../core/locale.js';
import { mapAtlas } from '../ui/mapCanvas.js';

const labels = {
  title: ['Terrain sculpt', 'Escultura del terreno'],
  tool: ['Tool', 'Herramienta'], radius: ['Radius', 'Radio'], strength: ['Strength', 'Fuerza'],
  falloff: ['Soft edge', 'Caída suave'], level: ['Level', 'Nivel'],
  map: ['Current terrain', 'Terreno actual'],
  dryHelp: ['Sculpting only affects existing dry ground. Paths, services, docks and protected props block the whole stroke.',
    'La escultura solo afecta suelo seco existente. Caminos, servicios, muelles y props protegidos bloquean el trazo completo.'],
  strengthHelp: ['Strength sets the height change for raise/lower and the blend amount for flatten/smooth. A ramp uses its two endpoints and ignores strength.',
    'La fuerza define el cambio de altura al subir/bajar y la mezcla al aplanar/suavizar. La rampa usa sus dos extremos e ignora la fuerza.'],
  rampHelp: ['Ramp: select Ramp, click the start, move to the end and click again. Escape cancels.',
    'Rampa: elige Rampa, pulsa el inicio, mueve el cursor al final y pulsa otra vez. Escape cancela.'],
  raise: ['Raise', 'Subir'], lower: ['Lower', 'Bajar'], flatten: ['Flatten', 'Aplanar'],
  smooth: ['Smooth', 'Suavizar'], ramp: ['Ramp', 'Rampa'],
};
const tools = ['raise', 'lower', 'flatten', 'smooth', 'ramp'];

/** Standalone terrain controls; pointer gestures and document edits stay with the editor root. */
export class TerrainPanel {
  constructor({ root, editor, onTool = () => {} } = {}) {
    if (!root || !editor) throw new TypeError('TerrainPanel requires root and editor');
    this.root = root; this.editor = editor; this.document = root.ownerDocument || document; this.onTool = onTool;
    this.tool = null; this.radius = 6; this.strength = 0.5; this.falloff = 0.5; this.level = 2.4;
    this.mapCanvas = null; this.renderedMap = null;
    this.element = this.document.createElement('section'); this.element.className = 'gm-terrain-panel';
    this.onChange = (event) => {
      const control = event.target;
      if (Object.hasOwn(control.dataset || {}, 'terrainTool')) {
        if (event.type === 'change') this.select(control.value || null);
        return;
      }
      const field = control.dataset.terrainField;
      if (field) this[field] = Number(control.value);
      this._syncValues();
    };
    this.element.addEventListener('change', this.onChange);
    this.element.addEventListener('input', this.onChange);
    root.appendChild(this.element);
    this.unsubscribeLocale = onLocaleChange(() => this.render());
    this.render();
  }

  t(key) { const pair = labels[key]; return this.editor._t(pair[0], pair[1]); }
  _input(field, min, max, step) {
    const label = this.document.createElement('label');
    const caption = this.document.createElement('span'); caption.textContent = this.t(field);
    const input = this.document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.value = this[field]; input.dataset.terrainField = field;
    const value = this.document.createElement('output'); value.dataset.terrainValue = field;
    label.append(caption, input, value); return label;
  }
  render() {
    const doc = this.document;
    const title = doc.createElement('h3'); title.textContent = this.t('title');
    const selectLabel = doc.createElement('label'), selectTitle = doc.createElement('span');
    selectTitle.textContent = this.t('tool');
    const select = doc.createElement('select'); select.dataset.terrainTool = '';
    const none = doc.createElement('option'); none.value = ''; none.textContent = this.editor._t('Choose a tool', 'Elige una herramienta'); select.append(none);
    for (const key of tools) { const option = doc.createElement('option'); option.value = key; option.textContent = this.t(key); select.append(option); }
    select.value = this.tool || ''; selectLabel.append(selectTitle, select);
    if (!this.mapCanvas) {
      this.mapCanvas = doc.createElement('canvas'); this.mapCanvas.width = 168; this.mapCanvas.height = 168;
      this.mapCanvas.className = 'gm-terrain-map'; this.mapCanvas.setAttribute('role', 'img');
    }
    const map = this.editor.draftMap || this.editor.map;
    if (map && map !== this.renderedMap) {
      const atlas = mapAtlas(map, doc), context = this.mapCanvas.getContext('2d');
      this.mapCanvas.setAttribute('aria-label', this.editor._t('Current terrain preview', 'Vista previa del terreno actual'));
      context?.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
      context?.drawImage(atlas.base, 0, 0, this.mapCanvas.width, this.mapCanvas.height);
      this.renderedMap = map;
    }
    const mapLabel = doc.createElement('h4'); mapLabel.textContent = this.t('map');
    const dryHelp = doc.createElement('p'); dryHelp.className = 'gm-terrain-help'; dryHelp.textContent = this.t('dryHelp');
    const strengthHelp = doc.createElement('p'); strengthHelp.className = 'gm-terrain-help'; strengthHelp.textContent = this.t('strengthHelp');
    const rampHelp = doc.createElement('p'); rampHelp.className = 'gm-terrain-help'; rampHelp.textContent = this.t('rampHelp');
    this.element.replaceChildren(title, mapLabel, this.mapCanvas, selectLabel, this._input('radius', 2, 24, 0.5), this._input('strength', 0.05, 1, 0.05),
      this._input('falloff', 0, 1, 0.05), this._input('level', 0.75, 100, 0.1), dryHelp, strengthHelp, rampHelp);
    this._syncValues();
  }
  _syncValues() {
    for (const field of ['radius', 'strength', 'falloff', 'level']) {
      const output = this.element.querySelector(`[data-terrain-value="${field}"]`);
      if (output) output.value = Number(this[field]).toFixed(field === 'radius' || field === 'level' ? 1 : 2);
    }
  }
  parameters() { return { tool: this.tool, radius: this.radius, strength: this.strength, falloff: this.falloff, level: this.level }; }
  select(tool) {
    if (tool !== null && !tools.includes(tool)) throw new RangeError('Unknown terrain tool');
    this.tool = tool;
    const control = this.element.querySelector('[data-terrain-tool]'); if (control) control.value = tool || '';
    this.onTool(tool);
  }
  dispose() {
    this.unsubscribeLocale?.();
    this.element.removeEventListener('change', this.onChange);
    this.element.removeEventListener('input', this.onChange);
    this.element.remove();
  }
}
