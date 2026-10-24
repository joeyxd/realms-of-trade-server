import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Lighting } from '../src/render/lighting.js';
import { U, patchToon } from '../src/render/toon.js';

// VR10 (playtest R2): cast shadows carry no comic hatching and no edge ink; the hatching stays on a surface's own
// back side; at night there is no sun, so no cast shadow (the moon casts none) and no shadow pass.
const at = (phase, zone = false) => {
  const lighting = new Lighting(new THREE.Scene());
  lighting.setGameplay(true);
  lighting.setZone(zone, 0);
  lighting.update(0.02, new THREE.Vector3(), phase);
  return lighting;
};

test('the sun term is full by day and at dusk, and gone at night with the shadow pass', () => {
  let l = at(0.08);
  assert.equal(U.mnSunDay.value, 1, 'morning');
  assert.equal(l.sun.shadow.autoUpdate, true);
  l = at(0.53);
  assert.ok(U.mnSunDay.value > 0.99, `golden hour keeps its shadows, got ${U.mnSunDay.value}`);
  l = at(0.75);
  assert.equal(U.mnSunDay.value, 0, 'midnight');
  assert.equal(l.sun.shadow.autoUpdate, false, 'no shadow pass at night');
  l = at(0.6);
  assert.equal(U.mnSunDay.value, 0, 'gone once the night preset is reached');
  l = at(0.08, true);
  assert.equal(U.mnSunDay.value, 1, 'the Caldera by day keeps its sun shadows');
  l = at(0.75, true);
  assert.equal(U.mnSunDay.value, 0, 'the Caldera at night has no sun either');
});

test('dusk fades the sun term out monotonically and dawn brings it back', () => {
  let prev = 1;
  for (let ph = 0.46; ph <= 0.6001; ph += 0.005) {
    at(ph);
    assert.ok(U.mnSunDay.value <= prev + 1e-9, `dusk does not flicker back at ${ph.toFixed(3)}`);
    prev = U.mnSunDay.value;
  }
  prev = 0;
  for (let ph = 0.9; ph <= 1.0001; ph += 0.005) {
    at(ph % 1);
    assert.ok(U.mnSunDay.value >= prev - 1e-9, `dawn does not flicker back at ${ph.toFixed(3)}`);
    prev = U.mnSunDay.value;
  }
  assert.equal(prev, 1);
});

test('the toon patch fades the sun shadow by mnSunDay and hatches only the sun back side', () => {
  const mat = patchToon(new THREE.MeshToonMaterial());
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
  mat.onBeforeCompile(sh);
  assert.strictEqual(sh.uniforms.mnSunDay, U.mnSunDay);
  const f = sh.fragmentShader;
  assert.match(f, /uniform float mnSunDay;/);
  assert.match(f, /UNROLLED_LOOP_INDEX == 0 \)\s*mnShF = mix\( 1\.0, mnShF, mnSunDay \);\s*#endif\s*mnVis \*= mnShF;/,
    'the sun shadow factor fades before it reaches the band');
  assert.match(f, /float mnDark = \( 1\.0 - smoothstep\( -0\.6, -0\.04, mnSunNdl \) \) \* mnSunDay;/);
  assert.doesNotMatch(f, /mnSunShadow|mnSunLit|mnEdge/, 'no cast-shadow term left in the comic pass');
});
