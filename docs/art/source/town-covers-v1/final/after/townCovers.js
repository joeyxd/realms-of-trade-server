// Paint existing roof/awning faces in their own local coordinates, without changing their silhouette.
import * as THREE from 'three';
import { townPart } from './townMaterials.js';
import { RAFT_ATLAS_ID } from './raftMaterials.js';

export function townCoverNeutral(geometry) {
  if (!geometry.hasAttribute('aTownCover')) geometry.setAttribute('aTownCover',
    new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
  return geometry;
}

export function townCoverPart(geometry, color, transform, kind, townOptions = {}) {
  if (!['thatch', 'cloth'].includes(kind)) throw Error('Unknown town cover: ' + kind);
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  source.computeBoundingBox();
  const p = source.attributes.position, uv = source.attributes.uv;
  const b = source.boundingBox, out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    if (kind === 'thatch') {
      // Unwrap four roof faces; the thin horizontal ledges receive the same muted straw paint.
      out[i * 3] = uv.getX(i) * 4; out[i * 3 + 1] = uv.getY(i);
      out[i * 3 + 2] = 1;
    } else {
      out[i * 3] = (p.getX(i) - b.min.x) / Math.max(b.max.x - b.min.x, 1e-8);
      out[i * 3 + 1] = (p.getZ(i) - b.min.z) / Math.max(b.max.z - b.min.z, 1e-8);
      out[i * 3 + 2] = 2;
    }
  }
  source.dispose();
  const result = townPart(geometry, color, transform, townOptions);
  result.setAttribute('aTownCover', new THREE.BufferAttribute(out, 3));
  return result;
}

const COVER_PARS = /* glsl */ `
varying vec3 vTownCover;
#ifdef MN_TOWN_CLOTH
uniform sampler2D mnTownCloth;
#endif
// Fade thin painted marks before they become subpixel; broad paint remains on Low.
float mnCoverLine(float c, float w) {
  float fw = max(fwidth(c), 0.0001);
  float d = min(fract(c), 1.0 - fract(c));
  return (1.0 - smoothstep(w, w + fw, d)) * (1.0 - smoothstep(.2, .7, fw));
}
`;
const COVER_PAINT = /* glsl */ `
if (vTownCover.z > .5 && vTownCover.z < 1.5) {
  vec2 p = vTownCover.xy;
  float bundle = floor(p.x * 18.0);
  float id = mnHash(vec2(bundle, 17.0));
  float rib = mnCoverLine(p.x * 18.0 + sin(p.y * 4.0 + id * 6.0) * .06, .025);
  float fiber = mnCoverLine(p.x * 72.0 + p.y * .3, .04);
  float ends = (1.0 - smoothstep(.0, .18, p.y)) * (.4 + .6 * id);
  // Ochre planes, a sun-bleached crown and broken dark fibers replace the bright flat yellow.
  vec3 straw = mix(vec3(.39, .20, .066), vec3(.64, .42, .17), .45 + .25 * id);
  straw *= .88 + .16 * p.y;
  straw *= 1.0 - .22 * rib - .07 * fiber - .12 * ends;
  diffuseColor.rgb = straw;
} else if (vTownCover.z > 1.5) {
  vec2 p = clamp(vTownCover.xy, 0.0, 1.0);
  float stripe = mod(floor(p.x * 5.0), 2.0);
  vec3 cloth = mix(vec3(.58, .44, .28), vec3(.38, .074, .041), stripe);
  #ifdef MN_TOWN_CLOTH
    // Crop the cream half of the existing cloth swatch, away from its giant central lacing.
    vec3 paint = texture2D(mnTownCloth, vec2(mix(.53, .72, p.x), mix(.035, .465, p.y))).rgb;
    cloth *= clamp(paint / vec3(.68, .56, .38), vec3(.28), vec3(1.2));
  #endif
  float seam = mnCoverLine(p.x * 5.0, .012);
  float hem = 1.0 - smoothstep(.018, .035, min(p.y, 1.0 - p.y));
  float folds = .94 + .06 * cos(p.y * 18.0 + sin(p.x * 12.0));
  diffuseColor.rgb = cloth * folds * (1.0 - .18 * seam - .16 * hem);
}
`;

export function townCoverMaterial(material, clothAtlas) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  const clothUniform = clothAtlas ? { value: clothAtlas } : null;
  if (clothAtlas) material.defines = { ...material.defines, MN_TOWN_CLOTH: 1 };
  material.onBeforeCompile = shader => {
    compile(shader);
    if (clothUniform) shader.uniforms.mnTownCloth = clothUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTownCover;\nvarying vec3 vTownCover;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTownCover = aTownCover;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COVER_PARS)
      .replace('#include <emissivemap_fragment>', COVER_PAINT + '\n#include <emissivemap_fragment>');
  };
  material.customProgramCacheKey = () => key() + '|town-covers-v1|' + (clothAtlas ? 'cloth' : 'native');
  material.userData.townCovers = { family: 'town-covers-v1', clothAtlas: clothAtlas ? RAFT_ATLAS_ID : null };
  material.userData.townCoverUniform = clothUniform;
  return material;
}
