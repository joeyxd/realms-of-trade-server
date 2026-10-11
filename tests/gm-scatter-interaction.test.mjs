import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/sim/worldgen.js';
import { canScatterAt } from '../src/editor/terrainData.js';
import { createDocument } from '../src/editor/document.js';
import { ScatterInteraction } from '../src/editor/scatterInteraction.js';
import { ScatterPanel } from '../src/editor/scatterPanel.js';

const map = generateWorld(20261010);
const point = (() => {
  for (let z = -220; z <= 220; z += 8) for (let x = -220; x <= 220; x += 8) {
    if (map.groundAt(x, z) > 2 && canScatterAt(map, x, z, .4)) return { x, z };
  }
  throw new Error('Could not find safe dry scatter test location');
})();

function fixture() {
  const listeners = new Map();
  const priorWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type, handler) { const set = listeners.get(type) || new Set(); set.add(handler); listeners.set(type, set); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
  };
  const document = createDocument({ seed: map.seed, baseRevision: 'scatter-interaction-test' });
  const editor = {
    active: true, map, draftMap: map, ui: { contains: target => target === 'ui' },
    scene: { add() {}, remove() {} }, canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), focus() {} },
    pointerInside: true, pointerNdc: { set() {} }, hit: { ...point },
    history: { current: () => document }, cameraController: { disable() {}, enable() {} },
    transform: { enabled: true }, walkPreview: null, remotePanel: null,
    commits: [], renders: [], statuses: [], invalidate() {}, _clearGhost() {}, _cancelTransform() {}, select() {},
    _setStatus(message, kind) { this.statuses.push({ message, kind }); },
    _terrainHits() { return this.hit ? [{ point: { ...this.hit }, distance: 1 }] : []; },
    _scatterExistingCost() { return { triangles: 120, primitives: 8 }; },
    _renderDocument(doc) { this.renders.push(doc); this.visibleDocument = doc; },
    _commit(doc) { this.commits.push(doc); this.visibleDocument = doc; },
  };
  const results = [];
  const panel = {
    entry: { id: 'prop:test-scatter', label: 'Test prop', stats: { bytes: 1200 } },
    metrics: { triangles: 20, primitives: 1, radius: .3, geometries: 1, materials: 1, textures: [], textureBytes: 0 },
    parameters: () => ({ radius: 6, strength: 1, falloff: 1, shape: 'circle', aspect: .5, rotation: 0,
      spacing: 2, scaleMin: .8, scaleMax: 1.2, seed: 9 }),
    setResult(result, error) { results.push({ result, error }); }, _syncControls() {},
  };
  const interaction = new ScatterInteraction(editor, panel);
  const fire = (type, event) => { for (const handler of listeners.get(type) || []) handler(event); };
  const down = (x = point.x, z = point.z, pointerId = 4) => {
    editor.hit = { x, z };
    interaction.down({ button: 0, pointerId, clientX: 50, clientY: 50, target: editor.canvas,
      preventDefault() {}, stopImmediatePropagation() {} });
  };
  const move = (x, z) => { editor.hit = { x, z }; interaction.move(); };
  const up = (x = point.x, z = point.z, pointerId = 4, target = editor.canvas) => {
    editor.hit = x === null ? null : { x, z };
    fire('pointerup', { button: 0, pointerId, clientX: 50, clientY: 50, target });
  };
  return { editor, panel, interaction, results, down, move, up, fire,
    restore() { interaction.dispose(); if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; } };
}

test('Escape cancellation restores the private base and commits nothing', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    assert.ok(f.editor.visibleDocument.objects.length > 0, 'preview should render placements');
    assert.equal(f.interaction.cancel(), true);
    assert.equal(f.editor.visibleDocument.objects.length, 0);
    assert.equal(f.editor.commits.length, 0);
    assert.equal(f.interaction.stroke, null);
  } finally { f.restore(); }
});

test('one matching pointer release commits once and reuses preview IDs', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    assert.deepEqual(f.interaction.stroke.existingCost, { triangles: 120, primitives: 8 });
    assert.equal(Object.isFrozen(f.interaction.stroke.existingCost), true);
    const previewIds = f.editor.visibleDocument.objects.map(item => item.id);
    assert.ok(previewIds.length > 0);
    f.move(point.x + 4, point.z + 1);
    f.up(point.x + 4, point.z + 1);
    assert.equal(f.editor.commits.length, 1);
    assert.equal(f.results.at(-1).result.plan.cost.totalTriangles,
      120 + f.results.at(-1).result.plan.cost.triangles);
    assert.equal(f.results.at(-1).result.plan.cost.totalPrimitives,
      8 + f.results.at(-1).result.plan.cost.primitives);
    assert.deepEqual(f.editor.commits[0].objects.map(item => item.id), f.editor.visibleDocument.objects.map(item => item.id));
    assert.equal(new Set(f.editor.commits[0].objects.map(item => item.id)).size, f.editor.commits[0].objects.length);
    f.up(point.x + 4, point.z + 1);
    assert.equal(f.editor.commits.length, 1);
  } finally { f.restore(); }
});

test('nonmatching pointer and editor UI release cannot commit the gesture', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    const preview = f.editor.visibleDocument;
    f.up(point.x, point.z, 999);
    assert.equal(f.editor.commits.length, 0);
    assert.equal(f.editor.visibleDocument, preview);
    f.up(point.x, point.z, 4, 'ui');
    assert.equal(f.editor.commits.length, 0);
    assert.equal(f.editor.visibleDocument.objects.length, 0);
  } finally { f.restore(); }
});

test('a second pointer cannot replace the active gesture or its ID cache', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    const stroke = f.interaction.stroke, ids = stroke.ids;
    f.down(point.x + 12, point.z + 12, 9);
    assert.equal(f.interaction.stroke, stroke);
    assert.equal(f.interaction.stroke.pointerId, 4);
    assert.equal(f.interaction.stroke.ids, ids);
    f.up(point.x, point.z, 9);
    assert.equal(f.editor.commits.length, 0);
    f.up(point.x, point.z, 4);
    assert.equal(f.editor.commits.length, 1);
  } finally { f.restore(); }
});

test('a matching release without a terrain hit discards the preview', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    f.up(null, null, 4);
    assert.equal(f.editor.commits.length, 0);
    assert.equal(f.editor.visibleDocument.objects.length, 0);
    assert.equal(f.interaction.stroke, null);
  } finally { f.restore(); }
});

test('scatter gesture beyond 256 path points is rejected atomically', () => {
  const f = fixture();
  try {
    f.interaction.select(true); f.down();
    for (let i = 1; i <= 260; i++) f.move(point.x + (i % 2 ? .7 : 0), point.z + (i % 3 ? .7 : 0));
    assert.equal(f.interaction.stroke.points.length, 256);
    assert.equal(f.interaction.stroke.error.code, 'scatter_points');
    f.up(point.x, point.z);
    assert.equal(f.editor.commits.length, 0);
    assert.equal(f.editor.visibleDocument.objects.length, 0);
    assert.equal(f.results.at(-1).error.code, 'scatter_points');
  } finally { f.restore(); }
});

class FakeElement {
  constructor(tagName, ownerDocument) { this.tagName = tagName; this.ownerDocument = ownerDocument; this.dataset = {}; this.children = []; this.listeners = new Map(); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  remove() {}
  _all() { return this.children.flatMap(child => [child, ...(child._all?.() || [])]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/); if (!match) return [];
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), expected = match[2];
    return this._all().filter(node => Object.hasOwn(node.dataset, key) && (expected === undefined || String(node.dataset[key]) === expected));
  }
}

test('panel keeps measured costs above brush controls and uses an editable numeric seed', () => {
  const doc = { createElement: tag => new FakeElement(tag, doc) }, root = new FakeElement('div', doc);
  const editor = { lang: 'es', catalog: { items: [{ id: 'prop:test', label: 'Palmera' }] }, _t: (en, es) => editor.lang === 'en' ? en : es };
  const panel = new ScatterPanel({ root, editor });
  try {
    panel.setAsset({ id: 'prop:test', label: 'Palm', stats: { bytes: 600, sourceBytes: 1200 } },
      { triangles: 30, primitives: 2, radius: .5, geometries: 1, materials: 1, textures: [{ width: 256, height: 128 }], textureBytes: 436906 });
    const title = panel.element.children[0], toggle = panel.element.children[1]; let summary = panel.element.children[2];
    assert.equal(summary.dataset.scatterSummary, '');
    assert.equal(panel.element.children.indexOf(summary) < panel.element.children.findIndex(node => node.dataset.scatterControl), true);
    assert.equal(panel.element.querySelector('[data-scatter-field="seed"]').type, 'number');
    assert.equal(summary.children.some(node => node.textContent?.includes?.('tris') || node.children?.some(child => child.textContent?.includes?.('600 B'))), true);
    assert.ok(title && toggle);
    editor.lang = 'en'; panel.render();
    const budgetEnglish = panel.element.children.find(node => node.textContent?.includes('1,000,000'))?.textContent || '';
    assert.match(budgetEnglish, /1,024 visible primitives/);
    editor.lang = 'es'; panel.render();
    const budgetSpanish = panel.element.children.find(node => node.textContent?.includes('1,000,000'))?.textContent || '';
    assert.match(budgetSpanish, /1,024 primitivas visibles/);
    summary = panel.element.children[2];
    editor.catalog.items = [{ id: 'prop:test', label: 'Tropical palm' }]; editor.lang = 'en'; panel._renderSummary();
    assert.ok(summary.children.some(row => row.children?.map(child => child.textContent).join('').includes('Tropical palm')));
    editor.catalog.items = [{ id: 'prop:test', label: 'Palmera tropical' }]; editor.lang = 'es'; panel._renderSummary();
    assert.ok(summary.children.some(row => row.children?.map(child => child.textContent).join('').includes('Palmera tropical')));
    editor.lang = 'en'; panel._renderSummary();
    panel.enabled = true; panel._syncControls();
    const aspect = panel.element.querySelector('[data-scatter-control="aspect"]');
    assert.equal(aspect.hidden, true);
    panel.onChange({ target: { dataset: { scatterSelect: 'shape' }, value: 'ellipse' }, type: 'change' });
    assert.equal(aspect.hidden, false);
    panel.setResult({ plan: { placements: [{}, {}], skipped: 1,
      cost: { triangles: 60, primitives: 4, totalTriangles: 6000, totalPrimitives: 24 } } });
    assert.ok(summary.children.some(row => Object.hasOwn(row.dataset, 'scatterCost')));
    assert.ok(summary.children.some(row => row.children?.some(child => child.textContent?.includes('600 B'))));
    assert.ok(summary.children.some(row => row.children?.some(child => child.textContent?.includes('6,000 tris'))));
    assert.ok(summary.children.some(row => row.textContent === 'Measured authored content only. Base world, shadows, outline and runtime overhead are excluded; this is not an FPS estimate.'));
    panel.setResult(null, Object.assign(new Error('internal'), { code: 'scatter_triangle_limit' }));
    const errorText = summary.children.map(row => row.children?.map(child => child.textContent).join('') || row.textContent).join(' ');
    assert.match(errorText, /complete stroke exceeds/i);
    assert.doesNotMatch(errorText, /scatter_triangle_limit/);
    assert.ok(summary.children.some(row => row.dataset.kind === 'error'));
  } finally { panel.dispose(); }
});
