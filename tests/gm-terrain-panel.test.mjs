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
      material: 'rock', shape: 'ellipse', aspect: 0.35, rotation: 45, flow: 'stroke' });
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
