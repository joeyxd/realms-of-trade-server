// M4.7 P1: GPU detection for the Ultra comic tier. Real renderer strings from browsers -> weak | mid | strong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGpu, cleanGpuName, gpuInfo } from '../src/render/gpu.js';

const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const RX = 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)';
const HD = 'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const UHD = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const ARC = 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
const M2 = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';

test('tiers of real renderer strings', () => {
  const t = (name, mobile = false) => classifyGpu(cleanGpuName(name), mobile);
  assert.equal(t(SWIFT), 'weak');
  assert.equal(t('llvmpipe (LLVM 15.0.7, 256 bits)'), 'weak');
  assert.equal(t('Microsoft Basic Render Driver'), 'weak');
  assert.equal(t(RTX), 'strong');
  assert.equal(t(RX), 'strong');
  assert.equal(t(ARC), 'strong');
  assert.equal(t(M2), 'strong');
  assert.equal(t('Apple M2'), 'strong');
  assert.equal(t('Apple GPU', false), 'strong', 'Safari on a Mac');
  assert.equal(t('Apple GPU', true), 'mid', 'an iPhone or iPad');
  assert.equal(t('Adreno (TM) 740', true), 'strong');
  assert.equal(t('Adreno (TM) 610', true), 'mid');
  assert.equal(t('Adreno (TM) 506', true), 'weak');
  assert.equal(t('Mali-G78', true), 'mid');
  assert.equal(t('Mali-T720', true), 'weak');
  assert.equal(t(UHD), 'mid');
  assert.equal(t(HD), 'weak');
  assert.equal(t('PowerVR Rogue GE8320', true), 'weak');
  assert.equal(t(''), 'mid', 'a browser that hides it');
});

test('ANGLE wrappers are cleaned to the card name', () => {
  assert.equal(cleanGpuName(RTX), 'NVIDIA GeForce RTX 3060');
  assert.equal(cleanGpuName(RX), 'AMD Radeon RX 6700 XT');
  assert.equal(cleanGpuName(HD), 'Intel(R) HD Graphics 4000');
  assert.equal(cleanGpuName(M2), 'Apple M2');
  assert.equal(cleanGpuName(SWIFT), 'SwiftShader Device (Subzero)');
  assert.equal(cleanGpuName('Adreno (TM) 740'), 'Adreno (TM) 740');
  assert.equal(cleanGpuName(''), '');
});

test('gpuInfo reads the unmasked renderer, falls back to RENDERER, survives a failing context', () => {
  const fake = (str, hasExt = true) => ({
    getContext: () => ({
      getExtension: () => (hasExt ? { UNMASKED_RENDERER_WEBGL: 37446 } : null),
      RENDERER: 7937,
      getParameter: (p) => (p === 37446 ? str : p === 7937 ? 'WebKit WebGL' : ''),
    }),
  });
  assert.deepEqual(gpuInfo(fake(RTX)), { name: 'NVIDIA GeForce RTX 3060', tier: 'strong' });
  assert.deepEqual(gpuInfo(fake(RTX, false)), { name: 'WebKit WebGL', tier: 'mid' });
  assert.deepEqual(gpuInfo(fake('Apple GPU'), true), { name: 'Apple GPU', tier: 'mid' });
  assert.deepEqual(gpuInfo({ getContext() { throw new Error('lost'); } }), { name: '', tier: 'mid' });
});

// ---- the Ultra tier (quality.js) ----
globalThis.window = globalThis.window || { devicePixelRatio: 1 };
const { TIERS, tierConfig, Quality } = await import('../src/render/quality.js');

test('ultra is high plus the comic knobs; the other tiers switch them off explicitly', () => {
  assert.deepEqual(TIERS, ['low', 'medium', 'high', 'ultra']);
  const hi = tierConfig('high'), ul = tierConfig('ultra');
  assert.deepEqual(ul, { ...hi, name: 'ultra', ink: 2, comic: 1, outlineMul: 1.3 });
  for (const t of ['low', 'medium', 'high']) {
    const c = tierConfig(t);
    assert.equal(c.comic, 0);
    assert.equal(c.outlineMul, 1);
    assert.ok(c.ink <= 1);
  }
});

test('AUTO starts a phone on medium, a strong GPU on ultra and the rest on high; below 45 fps it steps down one tier', () => {
  const run = (mobile, gpu) => new Quality(() => {}, 'auto', mobile, gpu);
  assert.equal(run(true, 'strong').current, 'medium');
  assert.equal(run(false, 'strong').current, 'ultra');
  assert.equal(run(false, 'mid').current, 'high');
  assert.equal(run(false, 'weak').current, 'high');
  assert.equal(run(false).current, 'high');
  const q = run(false, 'strong');
  q.frame(2.5, true); // warm-up
  for (let i = 0; i < 40; i++) q.frame(0.1, true); // 10 fps for 4 s
  assert.equal(q.current, 'high');
  assert.equal(new Quality(() => {}, 'ultra', false, 'weak').current, 'ultra', 'picked by hand: no gate on the GPU');
});
