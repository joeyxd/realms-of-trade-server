import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainPanel } from '../src/editor/terrainPanel.js';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map((item) => item.textContent).join(''); }
  set className(value) { this._className = value; }
  append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } }
  appendChild(item) { this.append(item); return item; }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  removeEventListener(name, listener) { this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== listener); }
  querySelector(selector) {
    const value = selector.match(/\[data-terrain-value="([^"]+)"\]/)?.[1];
    const match = selector.match(/\[data-terrain-([a-zA-Z]+)(?:="([^"]+)")?\]/);
    const key = match?.[1] ? `terrain${match[1][0].toUpperCase()}${match[1].slice(1)}` : null;
    const expected = match?.[2];
    const visit = (node) => {
      for (const child of node.children) {
        if (value && child.dataset.terrainValue === value) return child;
        if (key && Object.hasOwn(child.dataset, key) && (expected === undefined || child.dataset[key] === expected)) return child;
        const found = visit(child); if (found) return found;
      }
      return null;
    };
    return visit(this);
  }
  setAttribute(name, value) { (this.attributes ||= {})[name] = String(value); }
  getContext() {
    this.draws ||= [];
    return {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image) => { this.imageData = image; this.draws.push([image]); }, clearRect: () => {},
      drawImage: (...args) => this.draws.push(args),
    };
  }
  remove() { this.removed = true; }
  dispatch(type, target = this) { for (const listener of this.listeners[type] || []) listener({ type, target }); }
}

test('tool and paint controls expose shared brush parameters with relevant controls', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'), selected = [];
  const chartMap = () => ({ size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false });
  const editor = { _t: (en) => en, map: chartMap(), draftMap: null };
  const panel = new TerrainPanel({ root, editor, onTool: (tool) => selected.push(tool) });
  try {
    const tool = panel.element.querySelector('[data-terrain-tool]');
    tool.value = 'raise'; panel.element.dispatch('change', tool);
    assert.deepEqual(selected, ['raise']);
    assert.equal(panel.parameters().tool, 'raise');
    tool.value = ''; panel.element.dispatch('change', tool);
    assert.deepEqual(selected, ['raise', null]);
    assert.equal(panel.parameters().tool, null);
    assert.equal(panel.mapCanvas.width, 168);
    assert.equal(panel.mapCanvas.draws.length, 1);
    editor.draftMap = chartMap(); panel.render();
    assert.equal(panel.mapCanvas.draws.length, 2, 'the chart switches from the base map to the projected draft');

    const radius = new Element('input'); radius.dataset.terrainField = 'radius'; radius.value = '12.5';
    panel.element.dispatch('input', radius);
    assert.equal(panel.parameters().radius, 12.5);
    assert.equal(panel.element.querySelector('[data-terrain-value="radius"]').value, '12.5');
    tool.value = 'paint'; panel.element.dispatch('change', tool);
    assert.deepEqual(selected, ['raise', null, 'paint']);
    const family = panel.element.querySelector('[data-terrain-select="material"]');
    family.value = 'rock'; panel.element.dispatch('change', family);
    const shape = panel.element.querySelector('[data-terrain-select="shape"]');
    shape.value = 'ellipse'; panel.element.dispatch('change', shape);
    const aspect = panel.element.querySelector('[data-terrain-value="aspect"]');
    assert.ok(aspect, 'aspect output remains available to existing panel selectors');
    const aspectInput = panel.element.children.flatMap(node => node.children).find(node => node.dataset.terrainField === 'aspect');
    aspectInput.value = '0.35'; panel.element.dispatch('input', aspectInput);
    const rotationInput = panel.element.children.flatMap(node => node.children).find(node => node.dataset.terrainField === 'rotation');
    rotationInput.value = '45'; panel.element.dispatch('input', rotationInput);
    assert.deepEqual(panel.parameters(), { tool: 'paint', radius: 12.5, strength: 0.5, falloff: 0.5, level: 2.4,
      material: 'rock', shape: 'ellipse', aspect: 0.35, rotation: 45, flow: 'stroke', selection: 'brush', feather: 4, amount: 2, passes: 4,
      amplitude: 2, octaves: 4, scale: 32, seed: 1, talus: 35, iterations: 50, droplets: 10000 });
    assert.equal(panel.element.querySelector('[data-terrain-control="material"]').hidden, false);
    assert.equal(panel.element.querySelector('[data-terrain-control="level"]').hidden, true);
    shape.value = 'circle'; panel.element.dispatch('change', shape);
    assert.equal(panel.element.querySelector('[data-terrain-control="aspect"]').hidden, true);
    tool.value = 'erase'; panel.element.dispatch('change', tool);
    assert.equal(panel.parameters().tool, 'erase');
    assert.equal(panel.element.querySelector('[data-terrain-control="material"]').hidden, true);
    tool.value = 'ramp'; panel.element.dispatch('change', tool);
    assert.equal(panel.parameters().shape, 'circle', 'ramp parameters force the circular corridor');
    assert.equal(panel.element.querySelector('[data-terrain-control="shape"]').hidden, true);
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});

test('GM08b: a region hides the brush controls and shows feather, amount, passes and the level eyedropper', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'), selected = [];
  const editor = { _t: (en) => en, map: { size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false }, draftMap: null };
  const panel = new TerrainPanel({ root, editor, onTool: (tool) => selected.push(tool) });
  const hidden = (field) => panel.element.querySelector(`[data-terrain-control="${field}"]`).hidden;
  try {
    const tool = panel.element.querySelector('[data-terrain-tool]');
    tool.value = 'raise'; panel.element.dispatch('change', tool);
    const area = panel.element.querySelector('[data-terrain-select="selection"]');
    area.value = 'lasso'; panel.element.dispatch('change', area);
    assert.deepEqual(selected, ['raise', 'raise'], 'a new area re-selects the tool (cancel and hint)');
    assert.equal(panel.parameters().selection, 'lasso');
    for (const field of ['radius', 'falloff', 'flow', 'shape', 'strength', 'passes']) assert.equal(hidden(field), true, field);
    for (const field of ['feather', 'amount', 'selection']) assert.equal(hidden(field), false, field);
    assert.equal(panel.element.querySelector('[data-terrain-help="regionHelp"]').hidden, false);
    const amount = new Element('input'); amount.dataset.terrainField = 'amount'; amount.value = '7.5';
    panel.element.dispatch('input', amount);
    assert.equal(panel.parameters().amount, 7.5);

    tool.value = 'smooth'; panel.element.dispatch('change', tool);
    assert.equal(hidden('passes'), false); assert.equal(hidden('amount'), true);
    tool.value = 'paint'; panel.element.dispatch('change', tool);
    assert.equal(hidden('strength'), false, 'paint and erase blend by the strength'); assert.equal(hidden('material'), false);
    tool.value = 'flatten'; panel.element.dispatch('change', tool);
    assert.equal(hidden('level'), false); assert.equal(hidden('pick'), false);
    const pick = panel.element.querySelector('[data-terrain-pick]');
    panel.element.dispatch('click', pick);
    assert.equal(panel.picking, true);
    assert.equal(panel.element.querySelector('[data-terrain-pick]').textContent, 'Click the ground (Escape cancels)');
    panel.element.dispatch('click', panel.element.querySelector('[data-terrain-pick]'));
    assert.equal(panel.picking, false);

    tool.value = 'ramp'; panel.element.dispatch('change', tool);
    assert.equal(panel.parameters().selection, 'brush', 'ramps are brush only');
    assert.equal(hidden('selection'), true); assert.equal(hidden('feather'), true); assert.equal(hidden('radius'), false);
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});

test('GM08b: a held region shows its area with Apply and Drop, only in a region area', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'), actions = [];
  const editor = { _t: (en) => en, map: { size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false }, draftMap: null };
  const panel = new TerrainPanel({ root, editor, onRegion: (action) => actions.push(action) });
  const hidden = () => panel.element.querySelector('[data-terrain-control="held"]').hidden;
  try {
    panel.selection = 'rect'; panel.select('flatten');
    assert.equal(hidden(), true, 'nothing held yet');
    panel.held = 1240.4; panel.render();
    assert.equal(hidden(), false);
    assert.match(panel.element.querySelector('[data-terrain-control="held"]').textContent, /Selected region: 1,240 m²/);
    panel.element.dispatch('click', panel.element.querySelector('[data-terrain-apply]'));
    panel.element.dispatch('click', panel.element.querySelector('[data-terrain-release]'));
    assert.deepEqual(actions, ['apply', 'release']);
    panel.select('ramp');
    assert.equal(hidden(), true, 'ramps are brush only');
    panel.selection = 'brush'; panel.select('raise');
    assert.equal(hidden(), true);
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});

test('GM08c: noise on a brush or a region; the erosions on a region only, each with its own controls', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'), selected = [];
  const editor = { _t: (en) => en, map: { size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false }, draftMap: null };
  const panel = new TerrainPanel({ root, editor, onTool: (tool) => selected.push(tool) });
  const hidden = (field) => panel.element.querySelector(`[data-terrain-control="${field}"]`).hidden;
  const help = (key) => panel.element.querySelector(`[data-terrain-help="${key}"]`).hidden;
  try {
    const tool = panel.element.querySelector('[data-terrain-tool]');
    tool.value = 'noise'; panel.element.dispatch('change', tool);
    assert.equal(panel.parameters().selection, 'brush', 'noise works as a brush');
    for (const field of ['amplitude', 'octaves', 'scale', 'seed', 'reseed', 'radius', 'strength', 'flow']) assert.equal(hidden(field), false, field);
    for (const field of ['talus', 'iterations', 'droplets', 'level', 'amount']) assert.equal(hidden(field), true, field);
    assert.equal(help('noiseHelp'), false); assert.equal(help('erosionHelp'), true);
    const amplitude = new Element('input'); amplitude.dataset.terrainField = 'amplitude'; amplitude.value = '7.5';
    panel.element.dispatch('input', amplitude);
    assert.equal(panel.parameters().amplitude, 7.5);
    assert.equal(panel.element.querySelector('[data-terrain-value="amplitude"]').value, '7.5');
    const seed = panel.seed;
    panel.element.dispatch('click', panel.element.querySelector('[data-terrain-reseed]'));
    assert.ok(Number.isInteger(panel.seed) && panel.seed >= 1 && panel.seed <= 9999);
    if (panel.seed === seed) panel.element.dispatch('click', panel.element.querySelector('[data-terrain-reseed]'));
    assert.notEqual(panel.parameters().seed, seed, 'a new seed');

    // The erosions switch a brush to a rectangle, and a brush cannot be chosen while one is selected.
    tool.value = 'thermal'; panel.element.dispatch('change', tool);
    assert.equal(panel.parameters().selection, 'rect');
    assert.equal(panel.element.querySelector('[data-terrain-select="selection"]').value, 'rect');
    for (const field of ['talus', 'iterations', 'feather']) assert.equal(hidden(field), false, field);
    for (const field of ['radius', 'strength', 'amplitude', 'seed', 'droplets']) assert.equal(hidden(field), true, field);
    assert.equal(help('erosionHelp'), false);
    const area = panel.element.querySelector('[data-terrain-select="selection"]');
    area.value = 'brush'; panel.element.dispatch('change', area);
    assert.equal(panel.parameters().selection, 'rect'); assert.equal(area.value, 'rect');
    area.value = 'lasso'; panel.element.dispatch('change', area);
    assert.equal(panel.parameters().selection, 'lasso');
    tool.value = 'hydraulic'; panel.element.dispatch('change', tool);
    for (const field of ['droplets', 'seed', 'reseed', 'feather']) assert.equal(hidden(field), false, field);
    for (const field of ['talus', 'iterations', 'amplitude']) assert.equal(hidden(field), true, field);
    assert.deepEqual(selected.slice(-1), ['hydraulic']);
    const { tool: chosen, droplets, talus, iterations } = panel.parameters();
    assert.deepEqual({ chosen, droplets, talus, iterations }, { chosen: 'hydraulic', droplets: 10000, talus: 35, iterations: 50 });
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});

test('GM08d: the heightmap block exports, imports the chosen files and keeps the black and white heights, whatever the tool', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'), calls = [];
  const editor = { _t: (en) => en, map: { size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false }, draftMap: null };
  const panel = new TerrainPanel({ root, editor, onHeightmap: (...args) => calls.push(args) });
  try {
    assert.equal(panel.tool, null);
    panel.element.dispatch('click', panel.element.querySelector('[data-terrain-export]'));
    assert.deepEqual(calls, [['export']]);
    const black = panel.element.querySelector('[data-terrain-field="importMin"]'), white = panel.element.querySelector('[data-terrain-field="importMax"]');
    assert.deepEqual([black.type, white.type, Number(black.value), Number(white.value)], ['number', 'number', 0, 40]);
    black.value = '-12.5'; panel.element.dispatch('input', black);
    white.value = '60'; panel.element.dispatch('change', white);
    assert.deepEqual([panel.importMin, panel.importMax], [-12.5, 60]);
    const file = panel.element.querySelector('[data-terrain-import]');
    assert.deepEqual([file.type, file.accept, file.multiple], ['file', '.png,.r16,.raw,.json', true]);
    const chosen = [{ name: 'isla.png' }, { name: 'isla.json' }];
    file.files = chosen; file.value = 'C:\\fakepath\\isla.png';
    panel.element.dispatch('input', file);
    assert.equal(calls.length, 1, 'input alone does not import');
    panel.element.dispatch('change', file);
    assert.deepEqual(calls[1], ['import', chosen]);
    assert.equal(file.value, '', 'the same file can be chosen again');
    panel.render();
    assert.equal(Number(panel.element.querySelector('[data-terrain-field="importMin"]').value), -12.5, 'a render keeps the range');
    assert.match(panel.element.textContent, /16-bit grey PNG/);
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});

test('GM11a: the single-load meter shows the share, its detail and a note from 70 %', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element('root');
  const limits = { vertices: 1_000_000, tileBytes: 8 * 1048576, objects: 1000 };
  let budget = { level: 'ok', share: 0.3147, vertices: 314_721, tileBytes: 245_300, objects: 12, limits };
  const editor = { _t: (en) => en, map: { size: 12, half: 6, mapSpan: 1, landmarks: { spawn: { x: 0, z: 0 }, village: { x: 2, z: 2 } },
    groundAt: () => 1, masks: () => ({}), onDock: () => false }, draftMap: null, loadBudget: () => budget };
  const panel = new TerrainPanel({ root, editor });
  const meter = () => panel.element.querySelector('[data-terrain-load]');
  try {
    assert.equal(meter().dataset.terrainLoad, 'ok');
    assert.match(meter().textContent, /^Single load: 31 %/);
    assert.match(meter().textContent, /Terrain 314,721 \/ 1,000,000 · Tiles 0\.2 \/ 8\.0 MB · Objects 12 \/ 1,000$/);
    assert.equal(meter().children.length, 3, 'no note under 70 %');
    budget = { ...budget, level: 'near', share: 0.72, objects: 720 }; panel.render();
    assert.equal(meter().dataset.terrainLoad, 'near');
    assert.match(meter().textContent, /Above 100 % it cannot be published/);
    budget = { ...budget, level: 'over', share: 1.1 }; panel.render();
    assert.match(meter().textContent, /^Single load: 110 %/);
    assert.match(meter().textContent, /no longer fits in one load/);
    assert.equal(meter().children[1].value, 1, 'the bar is full above 100 %');
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});
