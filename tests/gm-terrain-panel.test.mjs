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
    const tool = selector.includes('[data-terrain-tool]');
    const visit = (node) => {
      for (const child of node.children) {
        if (value && child.dataset.terrainValue === value) return child;
        if (tool && Object.hasOwn(child.dataset, 'terrainTool')) return child;
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
      putImageData: (image) => { this.imageData = image; }, clearRect: () => {},
      drawImage: (...args) => this.draws.push(args),
    };
  }
  remove() { this.removed = true; }
  dispatch(type, target = this) { for (const listener of this.listeners[type] || []) listener({ type, target }); }
}

test('tool select events choose and clear tools; range input updates the exposed parameters', () => {
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
  } finally {
    panel.dispose();
    globalThis.document = previousDocument;
  }
});
