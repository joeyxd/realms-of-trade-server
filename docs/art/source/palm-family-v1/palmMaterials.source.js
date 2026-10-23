// The supplied painted atlas shares UVs with its linear normal map. No terrain samplers are added.
import * as THREE from 'three';
import { toon, normalMatFor, U } from './toon.js';

export const PALM_TEXTURE_IDS = ['tex:palm-albedo-v2', 'tex:palm-normal-v2'];

function windDepth(map, swayUniform, side) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side, map, alphaTest: map ? 0.35 : 0 });
  // Repeat toon.js's vertex motion in the shadow pass, including instanced phase and leaf flutter.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.mnTime = U.mnTime; sh.uniforms.mnSwayAmt = swayUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFlex; uniform float mnTime; uniform float mnSwayAmt;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 o = vec3(0.0);
        #ifdef USE_INSTANCING
          o = instanceMatrix[3].xyz;
        #endif
        float ph = o.x * 0.21 + o.z * 0.17;
        float sw = sin(mnTime * 1.25 + ph) * 0.65 + sin(mnTime * 2.6 + ph * 1.7) * 0.25;
        float sw2 = cos(mnTime * 1.05 + ph * 0.8) * 0.45;
        float flutter = sin(mnTime * 7.0 + ph * 3.0 + position.x * 2.0 + position.z * 2.0) * 0.06 * step(1.5, aFlex);
        float k = min(aFlex, 1.0);
        transformed.x += (sw * mnSwayAmt) * k;
        transformed.z += (sw2 * mnSwayAmt) * k;
        transformed.y += flutter;
      `);
  };
  mat.customProgramCacheKey = () => 'palm-wind-depth-v1-' + !!map; return mat;
}

export function palmMaterials(registry, swayUniform) {
  const color = registry.texture(PALM_TEXTURE_IDS[0]), normal = registry.texture(PALM_TEXTURE_IDS[1]);
  const opts = { sway: true, occluder: true, swayUniform, key: 'palm-atlas-v1' };
  const params = { color: 0xffffff, vertexColors: !color, map: color || null,
    normalMap: color && normal ? normal : null, normalScale: new THREE.Vector2(0.16, 0.16) };
  const trunk = toon(params, opts), fronds = toon({ ...params, side: THREE.DoubleSide, alphaTest: color ? 0.35 : 0 }, { ...opts, key: 'palm-leaves-atlas-v1' });
  const trunkNm = normalMatFor(opts), frondNm = normalMatFor({ ...opts, lineW: 0.25 }, THREE.DoubleSide);
  if (color) {
    // MeshNormalMaterial has no map_fragment/alphatest_fragment in Three r160. Cut its depth explicitly.
    frondNm.map = color; frondNm.alphaTest = 0.35;
    const patch = frondNm.onBeforeCompile, key = frondNm.customProgramCacheKey();
    frondNm.onBeforeCompile = (sh) => {
      patch(sh); sh.uniforms.mnPalmCut = { value: color };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPalmCutUV;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPalmCutUV = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying vec2 vPalmCutUV; uniform sampler2D mnPalmCut;\nvoid main() {')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (texture2D(mnPalmCut, vPalmCutUV).a < 0.35) discard;');
    };
    frondNm.customProgramCacheKey = () => key + '-palm-alpha-cut-v1';
  }
  return { trunk, fronds, trunkNm, frondNm,
    trunkDepth: windDepth(null, swayUniform, THREE.FrontSide), frondDepth: windDepth(color || null, swayUniform, THREE.DoubleSide),
    painted: !!color, normal: !!(color && normal), textures: [color && PALM_TEXTURE_IDS[0], color && normal && PALM_TEXTURE_IDS[1]].filter(Boolean) };
}
