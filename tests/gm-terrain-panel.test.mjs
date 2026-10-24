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
      material: 'rock', shape: 'ellipse', aspect: 0.35, rotation: 45, flow: 'stroke', selection: 'brush', feather: 4, amount: 2, passes: 4 });
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
