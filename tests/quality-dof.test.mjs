// T-1018-27: the depth-of-field strength per quality tier. The pass itself lives in src/render/pipeline.js, which
// loads three from a CDN and cannot be imported here; this pins the tier contract the pipeline reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || { devicePixelRatio: 1 };
const { TIERS, tierConfig } = await import('../src/render/quality.js');

test('dof shaders are warmed in prewarm', () => {
  const pipeline = readFileSync(new URL('../src/render/pipeline.js', import.meta.url), 'utf8');
  const scene = readFileSync(new URL('../src/render/scene.js', import.meta.url), 'utf8');
  const warmDof = pipeline.match(/^  warmDof\(\) \{\r?\n([\s\S]*?)^  \}/m);
  assert.ok(warmDof, 'Pipeline defines warmDof');
  assert.ok(warmDof[1].includes('compileAsync'), 'warmDof compiles the DOF programs');
  const prewarm = scene.match(/^  async prewarm\(\) \{\r?\n([\s\S]*?)^  \}/m);
  assert.ok(prewarm, 'GameScene defines prewarm');
  assert.ok(prewarm[1].includes('this.pipeline.warmDof()'), 'prewarm warms DOF');
  assert.ok(prewarm[1].includes('Promise.all([world, fxDone, dofDone])'), 'prewarm awaits all three passes');
});

test('every tier carries a numeric dof strength: 0 on low and medium, 1 or more on high and ultra', () => {
  for (const dpr of [1, 2]) {
    globalThis.window.devicePixelRatio = dpr;
    for (const t of TIERS) {
      const c = tierConfig(t);
      assert.ok(Object.hasOwn(c, 'dof'), `${t} @${dpr}x has dof`);
      assert.equal(typeof c.dof, 'number', `${t} @${dpr}x dof is a number`);
      assert.ok(Number.isFinite(c.dof) && c.dof >= 0, `${t} @${dpr}x dof is finite and not negative`);
    }
    assert.equal(tierConfig('low').dof, 0);
    assert.equal(tierConfig('medium').dof, 0);
    assert.ok(tierConfig('high').dof >= 1);
    assert.ok(tierConfig('ultra').dof >= 1);
  }
  globalThis.window.devicePixelRatio = 1;
});

test('the depth of field only rides on the outlined pipeline (it reads its scene depth and colour targets)', () => {
  for (const t of TIERS) {
    const c = tierConfig(t);
    if (c.dof > 0) assert.equal(c.outlines, true, `${t} has dof without outlines`);
  }
  assert.equal(tierConfig('anything-else').dof, tierConfig('high').dof, 'an unknown name falls back to high');
});
