import { onLocaleChange } from '../core/locale.js';
import { describeMap } from '../ui/cartography.js';
import { paintTerrain } from '../ui/mapCanvas.js';
import { TERRAIN_EDIT_FEATHER, TERRAIN_GRID_MAX_HEIGHT, TERRAIN_GRID_MIN_HEIGHT, TERRAIN_MIN_HEIGHT } from './terrainData.js';
import { TERRAIN_BRUSH_MAX_RADIUS } from './terrainBrush.js';
import { REGION_MAX_AMOUNT, REGION_MAX_FEATHER, REGION_MAX_PASSES, REGION_ONLY_TOOLS } from './terrainRegion.js';
import { HYDRAULIC_MAX_DROPLETS, HYDRAULIC_MIN_DROPLETS, NOISE_MAX_AMPLITUDE, NOISE_MAX_OCTAVES, NOISE_MAX_SCALE, NOISE_MIN_AMPLITUDE,
  NOISE_MIN_SCALE, THERMAL_MAX_ITERATIONS, THERMAL_MAX_TALUS, THERMAL_MIN_ITERATIONS, THERMAL_MIN_TALUS } from './terrainNoise.js';
import { worldLoadPercent } from './worldLoad.js';

const labels = {
  title: ['Terrain brushes', 'Pinceles de terreno'],
  tool: ['Tool', 'Herramienta'], radius: ['Radius', 'Radio'], strength: ['Strength', 'Fuerza'],
  falloff: ['Soft edge', 'Caída suave'], level: ['Level', 'Nivel'], material: ['Ground family', 'Familia de suelo'],
  shape: ['Brush shape', 'Forma del pincel'], aspect: ['Ellipse aspect', 'Proporción de elipse'], rotation: ['Rotation', 'Rotación'],
  map: ['Current terrain', 'Terreno actual'], flow: ['Flow', 'Flujo'],
  stroke: ['Single pass', 'Pasada única'], airbrush: ['Airbrush', 'Aerógrafo'],
  selection: ['Area', 'Área'], brush: ['Brush', 'Pincel'], rect: ['Rectangle', 'Rectángulo'], lasso: ['Lasso', 'Lazo'],
  feather: ['Feather (m)', 'Difuminado (m)'], amount: ['Amount (m)', 'Cantidad (m)'], passes: ['Passes', 'Pasadas'],
  pick: ['Pick level from the ground', 'Tomar el nivel del suelo'], picking: ['Click the ground (Escape cancels)', 'Pulsa el suelo (Escape cancela)'],
  regionHelp: ['Rectangle and lasso: drag on the ground; releasing applies the tool once to the whole area (flatten to the level, raise or lower by the amount, smooth with n passes, paint or erase by the strength). Feather softens the inner edge. Undo reverses it whole. The region then stays selected: change the tool or its values and apply them to it again without drawing it.',
    'Rectángulo y lazo: arrastra sobre el suelo; al soltar, la herramienta se aplica una vez a toda el área (aplanar al nivel, subir o bajar la cantidad, suavizar con n pasadas, pintar o borrar según la fuerza). El difuminado suaviza el borde interior. Deshacer lo revierte entero. Después la región sigue seleccionada: cambia la herramienta o sus valores y vuelve a aplicarlos sin dibujarla.'],
  held: ['Selected region', 'Región seleccionada'], apply: ['Apply to the region (Enter)', 'Aplicar a la región (Intro)'],
  release: ['Drop the region (Escape)', 'Soltar la región (Escape)'],
  amplitude: ['Amplitude (m)', 'Amplitud (m)'], octaves: ['Octaves', 'Octavas'], scale: ['Scale (m)', 'Escala (m)'],
  seed: ['Seed', 'Semilla'], reseed: ['New seed', 'Nueva semilla'], talus: ['Talus angle (°)', 'Ángulo de talud (°)'],
  iterations: ['Iterations', 'Iteraciones'], droplets: ['Drops', 'Gotas'],
  noiseHelp: ['Noise raises and lowers the ground by up to the amplitude in a natural pattern: scale is the size of its largest bumps, each octave adds finer detail. The same seed draws the same pattern, so strokes meet without a seam; a new seed draws another.',
    'El ruido sube y baja el suelo hasta la amplitud con un patrón natural: la escala es el tamaño de sus bultos mayores y cada octava añade detalle más fino. La misma semilla dibuja el mismo patrón, así que los trazos se unen sin costura; una semilla nueva dibuja otro.'],
  erosionHelp: ['Erosion works on a rectangle or a lasso and applies when you release it. Thermal: ground steeper than the talus angle slides down, a little more each iteration. Hydraulic: raindrops roll downhill, cut channels and leave sediment lower down; more drops cut deeper, so a small area needs few. A very large area with many iterations is refused: draw a smaller one or use fewer iterations.',
    'La erosión trabaja sobre un rectángulo o un lazo y se aplica al soltarlo. Térmica: el suelo más empinado que el ángulo de talud se desliza hacia abajo, un poco más en cada iteración. Hidráulica: las gotas de lluvia ruedan cuesta abajo, abren cauces y dejan sedimento más abajo; más gotas cortan más hondo, así que un área pequeña necesita pocas. Un área muy grande con muchas iteraciones se rechaza: dibuja una menor o usa menos iteraciones.'],
  heightmap: ['Heightmap', 'Mapa de alturas'],
  exportHeightmap: ['Export heightmap (16-bit PNG + JSON)', 'Exportar mapa de alturas (PNG 16 bits + JSON)'],
  importHeightmap: ['Import heightmap (PNG or Unreal .r16)', 'Importar mapa de alturas (PNG o .r16 de Unreal)'],
  importMin: ['Black is (m)', 'El negro es (m)'], importMax: ['White is (m)', 'El blanco es (m)'],
  heightmapHelp: ['Export saves the current terrain as a 16-bit grey PNG (one pixel per metre, column 0 at x = -280, row 0 at z = -280) and a JSON with its range. Import reads a PNG or a square Unreal Landscape .r16, stretches it over the whole map and levels the editable ground to it in one step: black and white become the two heights above, unless the file is one of our exports (it carries its own range). With a selected region it applies only inside it. Protected places, the shore and the sea keep their height. Undo reverses it whole.',
    'Exportar guarda el terreno actual como PNG gris de 16 bits (un píxel por metro, columna 0 en x = -280, fila 0 en z = -280) y un JSON con su rango. Importar lee un PNG o un .r16 cuadrado de un Landscape de Unreal, lo estira sobre todo el mapa y nivela el suelo editable a él de una vez: el negro y el blanco pasan a ser las dos alturas de arriba, salvo si el archivo es una exportación nuestra (lleva su propio rango). Con una región seleccionada se aplica solo dentro. Los lugares protegidos, la costa y el mar conservan su altura. Deshacer lo revierte entero.'],
  load: ['Single load', 'Carga única'], loadVertices: ['Terrain', 'Terreno'], loadTiles: ['Tiles', 'Teselas'],
  loadObjects: ['Objects', 'Objetos'],
  loadNear: ['From 70 % the world is getting close to what one load holds. Above 100 % it cannot be published (drafts still save).',
    'Desde el 70 % el mundo se acerca a lo que cabe en una carga. Por encima del 100 % no se puede publicar (el borrador se guarda).'],
  loadOver: ['This world no longer fits in one load: it cannot be published. Split it into zones.',
    'Este mundo ya no cabe en una sola carga: no se puede publicar. Divídelo en zonas.'],
  dryHelp: [`Brushes shape existing dry ground. Docks, paths, services, the shore and protected objects stay as they are: the brush fades out ${TERRAIN_EDIT_FEATHER} m before them.`,
    `Los pinceles modelan el suelo seco existente. Muelles, caminos, servicios, la costa y los objetos protegidos se quedan como están: el pincel se desvanece ${TERRAIN_EDIT_FEATHER} m antes.`],
  flowHelp: ['Airbrush: every pass adds more, and holding the pointer still keeps adding (about the strength per second). Single pass: going over the same ground again in one stroke adds nothing.',
    'Aerógrafo: cada pasada suma más, y mantener el puntero quieto sigue sumando (más o menos la fuerza por segundo). Pasada única: repasar el mismo suelo en un trazo no suma.'],
  strengthHelp: ['Strength sets the height change for raise/lower, the blend amount for flatten/smooth, and the paint blend amount. A ramp uses its two endpoints and ignores strength.',
    'La fuerza define el cambio de altura al subir/bajar, la mezcla al aplanar/suavizar y la intensidad de pintura. La rampa usa sus dos extremos e ignora la fuerza.'],
  paintHelp: ['Paint blends the selected ground family into terrain. Erase removes paint and restores the automatic surface.',
    'Pintar mezcla la familia elegida con el terreno. Borrar quita la pintura y recupera el acabado automático.'],
  shapeHelp: ['Circle and square use the radius as their half-width. Ellipse aspect sets its short radius as a fraction of the long radius; rotation turns square and ellipse around the cursor. Ramps always use a circular corridor.',
    'Círculo y cuadrado usan el radio como semiancho. La proporción de elipse define el radio corto como fracción del largo; la rotación gira el cuadrado y la elipse alrededor del cursor. La rampa siempre usa un corredor circular.'],
  rampHelp: ['Ramp: select Ramp, click the start, move to the end and click again. Escape cancels.',
    'Rampa: elige Rampa, pulsa el inicio, mueve el cursor al final y pulsa otra vez. Escape cancela.'],
  raise: ['Raise', 'Subir'], lower: ['Lower', 'Bajar'], flatten: ['Flatten', 'Aplanar'],
  smooth: ['Smooth', 'Suavizar'], ramp: ['Ramp', 'Rampa'], noise: ['Noise', 'Ruido'],
  thermal: ['Thermal erosion', 'Erosión térmica'], hydraulic: ['Hydraulic erosion', 'Erosión hidráulica'],
  paint: ['Paint', 'Pintar'], erase: ['Erase', 'Borrar'], grass: ['Grass', 'Hierba'], dirt: ['Dirt', 'Tierra'],
  sand: ['Sand', 'Arena'], rock: ['Rock', 'Roca'], circle: ['Circle', 'Círculo'], square: ['Square', 'Cuadrado'], ellipse: ['Ellipse', 'Elipse'],
};
const tools = ['raise', 'lower', 'flatten', 'smooth', 'ramp', 'noise', 'thermal', 'hydraulic', 'paint', 'erase'];
const regionOnly = tool => REGION_ONLY_TOOLS.includes(tool);
const NUMERIC = ['radius', 'strength', 'falloff', 'level', 'aspect', 'rotation', 'feather', 'amount', 'passes',
  'amplitude', 'octaves', 'scale', 'seed', 'talus', 'iterations', 'droplets'];
const DECIMALS = { level: 2, strength: 2, falloff: 2, aspect: 2, radius: 1, rotation: 1, amount: 1, amplitude: 1 };

/** Standalone terrain controls; pointer gestures and document edits stay with the editor root. */
export class TerrainPanel {
  constructor({ root, editor, onTool = () => {}, onRegion = () => {}, onHeightmap = () => {} } = {}) {
    if (!root || !editor) throw new TypeError('TerrainPanel requires root and editor');
    this.root = root; this.editor = editor; this.document = root.ownerDocument || document; this.onTool = onTool;
    this.onRegion = onRegion;
    // GM08d: onHeightmap('export') or onHeightmap('import', files); the range a heightmap without our sidecar maps to.
    this.onHeightmap = onHeightmap; this.importMin = 0; this.importMax = 40;
    this.tool = null; this.radius = 6; this.strength = 0.5; this.falloff = 0.5; this.level = 2.4;
    this.material = 'grass'; this.shape = 'circle'; this.aspect = 0.5; this.rotation = 0; this.flow = 'stroke';
    // GM08b: brush or a region (rect, lasso); `picking` makes the next ground click set the level (terrainInteraction.js).
    this.selection = 'brush'; this.feather = 4; this.amount = 2; this.passes = 4; this.picking = false;
    // The held region's area in m2 while the interaction keeps one selected (null otherwise); onRegion('apply' | 'release').
    this.held = null;
    // GM08c: noise and erosion parameters; the seed draws the noise and the hydraulic drops.
    this.amplitude = 2; this.octaves = 4; this.scale = 32; this.seed = 1; this.talus = 35; this.iterations = 50; this.droplets = 10000;
    this.mapCanvas = null; this.renderedMap = null;
    this.element = this.document.createElement('section'); this.element.className = 'gm-terrain-panel';
    this.onChange = (event) => {
      const control = event.target;
      if (Object.hasOwn(control.dataset || {}, 'terrainImport')) {
        if (event.type === 'change' && control.files?.length) { const files = [...control.files]; control.value = ''; this.onHeightmap('import', files); }
        return;
      }
      if (Object.hasOwn(control.dataset || {}, 'terrainTool')) {
        if (event.type === 'change') this.select(control.value || null);
        return;
      }
      if (Object.hasOwn(control.dataset || {}, 'terrainSelect')) {
        if (event.type === 'change') this[control.dataset.terrainSelect] = control.value;
        // GM08c: the erosions work on a region only.
        if (control.dataset.terrainSelect === 'selection' && regionOnly(this.tool) && this.selection === 'brush') control.value = this.selection = 'rect';
        this._syncControls();
        // A new area cancels the gesture and refreshes the hint.
        if (event.type === 'change' && control.dataset.terrainSelect === 'selection' && this.tool) this.onTool(this.tool);
        return;
      }
      const field = control.dataset.terrainField;
      if (field) this[field] = Number(control.value);
      this._syncValues();
    };
    this.onClick = (event) => {
      const dataset = event.target?.dataset || {};
      if (Object.hasOwn(dataset, 'terrainExport')) { this.onHeightmap('export'); return; }
      if (Object.hasOwn(dataset, 'terrainApply')) { this.onRegion('apply'); return; }
      if (Object.hasOwn(dataset, 'terrainRelease')) { this.onRegion('release'); return; }
      if (Object.hasOwn(dataset, 'terrainReseed')) { this.seed = 1 + Math.floor(Math.random() * 9999); this.render(); return; }
      if (!Object.hasOwn(dataset, 'terrainPick')) return;
      this.picking = !this.picking; this.render();
    };
    this.element.addEventListener('change', this.onChange);
    this.element.addEventListener('input', this.onChange);
    this.element.addEventListener('click', this.onClick);
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
  _select(field, options) {
    const label = this.document.createElement('label'), caption = this.document.createElement('span');
    caption.textContent = this.t(field);
    const select = this.document.createElement('select'); select.dataset.terrainSelect = field;
    for (const key of options) { const option = this.document.createElement('option'); option.value = key; option.textContent = this.t(key); select.append(option); }
    select.value = this[field]; label.append(caption, select); return label;
  }
  _control(field, node) { node.dataset.terrainControl = field; return node; }
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
      // Every stroke compiles a new map: paint the chart at its own 168 px, not the 640 px shared atlas (GM07c).
      const context = this.mapCanvas.getContext('2d');
      this.mapCanvas.setAttribute('aria-label', this.editor._t('Current terrain preview', 'Vista previa del terreno actual'));
      if (context) paintTerrain(context, map, describeMap(map).frame, this.mapCanvas.width);
      this.renderedMap = map;
    }
    const help = key => { const node = doc.createElement('p'); node.className = 'gm-terrain-help'; node.textContent = this.t(key); node.dataset.terrainHelp = key; return node; };
    const mapLabel = doc.createElement('h4'); mapLabel.textContent = this.t('map');
    const pick = doc.createElement('button'); pick.type = 'button'; pick.dataset.terrainPick = '';
    pick.textContent = this.t(this.picking ? 'picking' : 'pick');
    const held = doc.createElement('div'), heldCaption = doc.createElement('span');
    heldCaption.textContent = this.held ? `${this.t('held')}: ${Math.round(this.held).toLocaleString(this.editor._t('en', 'es'))} m²` : this.t('held');
    const button = (key) => { const node = doc.createElement('button'); node.type = 'button'; node.textContent = this.t(key); node.dataset[`terrain${key[0].toUpperCase()}${key.slice(1)}`] = ''; return node; };
    held.append(heldCaption, button('apply'), button('release'));
    this.element.replaceChildren(title, selectLabel, this._control('selection', this._select('selection', ['brush', 'rect', 'lasso'])),
      this._control('held', held),
      this._control('radius', this._input('radius', 2, TERRAIN_BRUSH_MAX_RADIUS, 0.5)),
      this._control('feather', this._input('feather', 0, REGION_MAX_FEATHER, 1)),
      this._control('amount', this._input('amount', 0.1, REGION_MAX_AMOUNT, 0.1)),
      this._control('passes', this._input('passes', 1, REGION_MAX_PASSES, 1)),
      this._control('amplitude', this._input('amplitude', NOISE_MIN_AMPLITUDE, NOISE_MAX_AMPLITUDE, 0.1)),
      this._control('octaves', this._input('octaves', 1, NOISE_MAX_OCTAVES, 1)),
      this._control('scale', this._input('scale', NOISE_MIN_SCALE, NOISE_MAX_SCALE, 1)),
      this._control('talus', this._input('talus', THERMAL_MIN_TALUS, THERMAL_MAX_TALUS, 1)),
      this._control('iterations', this._input('iterations', THERMAL_MIN_ITERATIONS, THERMAL_MAX_ITERATIONS, 5)),
      this._control('droplets', this._input('droplets', HYDRAULIC_MIN_DROPLETS, HYDRAULIC_MAX_DROPLETS, 1000)),
      this._control('seed', this._input('seed', 1, 9999, 1)), this._control('reseed', button('reseed')),
      this._control('strength', this._input('strength', 0.05, 1, 0.05)), this._control('falloff', this._input('falloff', 0, 1, 0.05)),
      this._control('flow', this._select('flow', ['stroke', 'airbrush'])),
      this._control('level', this._input('level', TERRAIN_MIN_HEIGHT, TERRAIN_GRID_MAX_HEIGHT, 0.1)), this._control('pick', pick),
      this._control('material', this._select('material', ['grass', 'dirt', 'sand', 'rock'])),
      this._control('shape', this._select('shape', ['circle', 'square', 'ellipse'])),
      this._control('aspect', this._input('aspect', 0.25, 1, 0.05)), this._control('rotation', this._input('rotation', 0, 360, 5)),
      help('dryHelp'), help('regionHelp'), help('strengthHelp'), help('flowHelp'), help('paintHelp'), help('shapeHelp'), help('rampHelp'),
      help('noiseHelp'), help('erosionHelp'), ...this._loadMeter(), this._heightmap(), mapLabel, this.mapCanvas);
    this._syncValues(); this._syncControls();
  }
  // GM08d: export and import of the whole heightmap, whatever the tool (terrainInteraction.js).
  _heightmap() {
    const doc = this.document, block = doc.createElement('div'); block.className = 'gm-terrain-heightmap';
    const title = doc.createElement('h4'); title.textContent = this.t('heightmap');
    const exporter = doc.createElement('button'); exporter.type = 'button'; exporter.dataset.terrainExport = '';
    exporter.textContent = this.t('exportHeightmap');
    const range = (field) => {
      const label = doc.createElement('label'), caption = doc.createElement('span'); caption.textContent = this.t(field);
      const input = doc.createElement('input'); input.type = 'number'; input.min = TERRAIN_GRID_MIN_HEIGHT; input.max = TERRAIN_GRID_MAX_HEIGHT;
      input.step = 0.1; input.value = this[field]; input.dataset.terrainField = field;
      label.append(caption, input); return label;
    };
    const importer = doc.createElement('label'), caption = doc.createElement('span'); caption.textContent = this.t('importHeightmap');
    const file = doc.createElement('input'); file.type = 'file'; file.accept = '.png,.r16,.raw,.json'; file.multiple = true;
    file.dataset.terrainImport = ''; importer.append(caption, file);
    const help = doc.createElement('p'); help.className = 'gm-terrain-help'; help.textContent = this.t('heightmapHelp');
    block.append(title, exporter, range('importMin'), range('importMax'), importer, help);
    return block;
  }
  // GM11a: the single-load meter of the current draft (editor.loadBudget, worldLoad.js), always shown.
  _loadMeter() {
    const budget = this.editor.loadBudget?.();
    if (!budget) return [];
    const doc = this.document, locale = this.editor._t('en', 'es'), count = value => Math.round(value).toLocaleString(locale);
    const block = doc.createElement('div'); block.className = 'gm-terrain-load'; block.dataset.terrainLoad = budget.level;
    const caption = doc.createElement('span'); caption.textContent = `${this.t('load')}: ${worldLoadPercent(budget)} %`;
    // The bar reads like the number; the browser colours it amber from 70 % and red when full (its high band).
    const meter = doc.createElement('meter'); meter.min = 0; meter.max = 1; meter.low = 0.7; meter.high = 1 - 1e-9; meter.optimum = 0;
    meter.value = Math.min(budget.share, 1);
    const detail = doc.createElement('p'), { limits } = budget;
    const mb = bytes => (bytes / 1048576).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    detail.textContent = `${this.t('loadVertices')} ${count(budget.vertices)} / ${count(limits.vertices)} · ` +
      `${this.t('loadTiles')} ${mb(budget.tileBytes)} / ${mb(limits.tileBytes)} MB · ${this.t('loadObjects')} ${count(budget.objects)} / ${count(limits.objects)}`;
    block.append(caption, meter, detail);
    if (budget.level !== 'ok') { const note = doc.createElement('p'); note.textContent = this.t(budget.level === 'over' ? 'loadOver' : 'loadNear'); block.append(note); }
    return [block];
  }
  _syncValues() {
    for (const field of NUMERIC) {
      const output = this.element.querySelector(`[data-terrain-value="${field}"]`);
      if (output) output.value = Number(this[field]).toFixed(DECIMALS[field] ?? 0);
    }
  }
  _syncControls() {
    const paintMode = this.tool === 'paint' || this.tool === 'erase', rampMode = this.tool === 'ramp';
    const sculptMode = ['raise', 'lower', 'flatten', 'smooth', 'noise'].includes(this.tool);
    // GM08b: a region hides the brush controls; ramps are brush only.
    const area = !!this.tool && !rampMode && this.selection !== 'brush', brush = !!this.tool && !area;
    const visibility = { selection: !!this.tool && !rampMode, material: this.tool === 'paint', level: this.tool === 'flatten',
      pick: this.tool === 'flatten', shape: brush && !rampMode, aspect: brush && !rampMode && this.shape === 'ellipse',
      rotation: brush && !rampMode && this.shape !== 'circle', radius: brush, strength: brush || (area && paintMode),
      falloff: brush, flow: brush && (sculptMode || paintMode), feather: area,
      amount: area && (this.tool === 'raise' || this.tool === 'lower'), passes: area && this.tool === 'smooth', held: area && !!this.held,
      amplitude: this.tool === 'noise', octaves: this.tool === 'noise', scale: this.tool === 'noise',
      seed: this.tool === 'noise' || this.tool === 'hydraulic', reseed: this.tool === 'noise' || this.tool === 'hydraulic',
      talus: this.tool === 'thermal', iterations: this.tool === 'thermal', droplets: this.tool === 'hydraulic' };
    for (const [field, shown] of Object.entries(visibility)) {
      const node = this.element.querySelector(`[data-terrain-control="${field}"]`);
      if (node) node.hidden = !shown;
    }
    const helps = { paintHelp: paintMode, rampHelp: rampMode, regionHelp: area, strengthHelp: brush && (sculptMode || paintMode),
      flowHelp: brush && (sculptMode || paintMode) && this.flow === 'airbrush', shapeHelp: brush, dryHelp: !!this.tool,
      noiseHelp: this.tool === 'noise', erosionHelp: regionOnly(this.tool) };
    for (const [key, shown] of Object.entries(helps)) {
      const node = this.element.querySelector(`[data-terrain-help="${key}"]`);
      if (node) node.hidden = !shown;
    }
    this._syncValues();
  }
  parameters() {
    const rampMode = this.tool === 'ramp';
    const selection = rampMode ? 'brush' : regionOnly(this.tool) && this.selection === 'brush' ? 'rect' : this.selection;
    return { tool: this.tool, radius: this.radius, strength: this.strength, falloff: this.falloff, level: this.level,
      material: this.material, shape: rampMode ? 'circle' : this.shape, aspect: this.aspect, rotation: this.rotation,
      flow: rampMode || selection !== 'brush' ? 'stroke' : this.flow, selection, feather: this.feather, amount: this.amount,
      passes: this.passes, amplitude: this.amplitude, octaves: this.octaves, scale: this.scale, seed: this.seed, talus: this.talus,
      iterations: this.iterations, droplets: this.droplets };
  }
  select(tool) {
    if (tool !== null && !tools.includes(tool)) throw new RangeError('Unknown terrain tool');
    this.tool = tool;
    const control = this.element.querySelector('[data-terrain-tool]'); if (control) control.value = tool || '';
    if (regionOnly(tool) && this.selection === 'brush') {
      this.selection = 'rect';
      const area = this.element.querySelector('[data-terrain-select="selection"]'); if (area) area.value = 'rect';
    }
    this._syncControls();
    this.onTool(tool);
  }
  dispose() {
    this.unsubscribeLocale?.();
    this.element.removeEventListener('change', this.onChange);
    this.element.removeEventListener('input', this.onChange);
    this.element.removeEventListener('click', this.onClick);
    this.element.remove();
  }
}
