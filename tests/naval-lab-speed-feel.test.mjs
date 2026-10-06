import test from 'node:test';
import assert from 'node:assert/strict';
import { NavalSpeedFeel } from '../tools/naval-lab/speed-feel.js';

class StubElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.classList = { values: new Set(), add: (name) => this.classList.values.add(name) };
    this.parent = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(child) { child.parent = this; this.children.push(child); }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  remove() {
    if (!this.parent) return;
    const siblings = this.parent.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parent = null;
  }
}

function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, tagName) => new StubElement(tagName) };
  try { return run(); }
  finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

function makeFeel(options) {
  const host = new StubElement('host');
  return { host, feel: new NavalSpeedFeel(host, options) };
}

function pathData(feel) { return feel.lines.map((line) => line.getAttribute('d')); }

test('speed feel creates a bounded, repeatable set of mobile and desktop ink paths', () => withDocument(() => {
  for (const [mobile, expected] of [[true, 12], [false, 20]]) {
    const a = makeFeel({ mobile }), b = makeFeel({ mobile });
    assert.equal(a.feel.lines.length, expected);
    assert.equal(a.host.children.length, 1);
    assert.equal(a.host.children[0].tagName, 'svg');
    assert.equal(a.host.children[0].classList.values.has('speed-ink'), true);
    a.feel.update(0.05, { speed: 8.5, omega: 0.2 });
    b.feel.update(0.05, { speed: 8.5, omega: 0.2 });
    assert.ok(pathData(a.feel).every((path) => typeof path === 'string' && path.startsWith('M') && path.endsWith('Z')));
    assert.deepEqual(pathData(a.feel), pathData(b.feel), 'equal phase and input produce equal paths');
    a.feel.dispose(); b.feel.dispose();
  }
}));

test('pause freezes phase, ink intensity, FOV, roll, and the rendered path set', () => withDocument(() => {
  const { feel } = makeFeel({ mobile: true });
  feel.update(0.1, { speed: 80, omega: 4, boosting: true });
  const before = { ...feel.diagnostics(), phase: feel.phase, paths: pathData(feel), opacity: feel.svg.style.opacity };
  const cameraBefore = feel.update(0.1, { speed: 0, omega: -90, boosting: true, paused: true });
  assert.equal(feel.phase, before.phase);
  assert.equal(feel.intensity, before.intensity);
  assert.equal(feel.svg.style.opacity, before.opacity);
  assert.deepEqual(cameraBefore, { fov: before.fov, roll: before.roll });
  assert.deepEqual(pathData(feel), before.paths);
  feel.dispose();
}));

test('reduced motion and disabled feedback remove ink and camera effects immediately', () => withDocument(() => {
  for (const options of [{ reducedMotion: true }, {}]) {
    const { feel } = makeFeel(options);
    feel.update(0.1, { speed: 30, omega: 8, boosting: true });
    const result = feel.update(0.05, { speed: 100, omega: 100, enabled: options.reducedMotion ? true : false });
    assert.equal(feel.intensity, 0);
    assert.equal(feel.svg.style.visibility, 'hidden');
    assert.equal(result.fov, 35);
    assert.equal(result.roll, 0);
    feel.dispose();
  }
}));

test('extreme speed and turn inputs keep FOV and camera roll within their caps', () => withDocument(() => {
  for (const mobile of [true, false]) {
    const { feel } = makeFeel({ mobile });
    for (const [speed, omega, boosting] of [
      [0, 0, false], [1e9, 1e9, false], [1e9, -1e9, true], [12, 0.04, true], [6, -0.04, false],
    ]) {
      const camera = feel.update(0.1, { speed, omega, boosting });
      assert.ok(Number.isFinite(camera.fov) && camera.fov <= 41, `FOV ${camera.fov} stays at or below 41`);
      assert.ok(Number.isFinite(camera.roll) && Math.abs(camera.roll) <= 0.025, `roll ${camera.roll} stays capped`);
    }
    feel.dispose();
  }
}));

test('reset clears accumulated feedback and dispose removes the SVG host child', () => withDocument(() => {
  const { host, feel } = makeFeel({ mobile: false });
  feel.update(0.1, { speed: 60, omega: 2, boosting: true });
  assert.ok(feel.diagnostics().intensity > 0);
  feel.reset();
  assert.deepEqual({ phase: feel.phase, intensity: feel.intensity, fov: feel.fov, roll: feel.roll },
    { phase: 0, intensity: 0, fov: 35, roll: 0 });
  assert.equal(feel.svg.style.opacity, '0');
  feel.dispose();
  assert.equal(host.children.length, 0);
  assert.equal(feel.lines.length, 0);
}));
