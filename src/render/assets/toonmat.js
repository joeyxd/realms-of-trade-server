// Toon materials for imported models: a glTF PBR material (MeshStandardMaterial) becomes the game's banded toon
// material with the same colour, texture, emission, alpha cut-out and side, so a Meshy / Sketchfab / Blender model
// sits in the world like the procedural ones (same light bands, cloud shadows, local lights, rim, comic ink, bloom
// from bright emission). The entry's `toon` block grades the texture toward the art direction: saturation, value
// and posterize (a few flat colour levels: photo-like textures read painted).
import * as THREE from 'three';
import { toon, normalMatFor, charNormalMat } from '../toon.js';

const glNum = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

// GLSL run on the albedo (map × colour) before lighting. Constants are baked in, so the program key carries them.
function gradeGlsl(t) {
  if (t.sat === 1 && t.bright === 1 && !t.posterize) return '';
  let s = '{\n  vec3 mnC = diffuseColor.rgb;\n';
  if (t.sat !== 1) s += `  float mnL = dot(mnC, vec3(0.2126, 0.7152, 0.0722));\n  mnC = max(mix(vec3(mnL), mnC, ${glNum(t.sat)}), 0.0);\n`;
  if (t.bright !== 1) s += `  mnC *= ${glNum(t.bright)};\n`;
  if (t.posterize > 1) s += `  vec3 mnG = pow(mnC, vec3(0.4545));\n  mnG = floor(mnG * ${glNum(t.posterize)} + 0.5) / ${glNum(t.posterize)};\n  mnC = pow(mnG, vec3(2.2));\n`;
  return s + '  diffuseColor.rgb = mnC;\n}\n';
}
const gradeKey = (t) => `s${t.sat}b${t.bright}p${t.posterize}`;

// The parameters a toon material keeps from a glTF one.
function paramsOf(src, entry, { vertexColors = false } = {}) {
  const p = {
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map || null,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0),
    emissiveMap: src.emissiveMap || null,
    emissiveIntensity: src.emissiveIntensity ?? 1,
    side: src.side ?? THREE.FrontSide,
    vertexColors,
  };
  // Alpha: cut-outs stay cut-outs; blended alpha becomes a cut-out too (the outline and occluder passes are opaque).
  const cut = Math.max(src.alphaTest || 0, entry.toon.alphaTest || 0, src.transparent ? 0.5 : 0);
  if (cut > 0) { p.alphaTest = cut; p.alphaMap = src.alphaMap || null; }
  if (entry.toon.normal && src.normalMap) { p.normalMap = src.normalMap; p.normalScale = src.normalScale ? src.normalScale.clone().multiplyScalar(0.6) : new THREE.Vector2(0.6, 0.6); }
  return p;
}

// A world material (props, ships, buildings): occluder dithering near the player like the procedural props, comic
// hatching unless the entry turns it off. Returns { mat, nm } (nm: the outline pass's paired material).
export function worldToon(src, entry) {
  const t = entry.toon, p = paramsOf(src, entry, { vertexColors: !!src.vertexColors });
  const opts = { occluder: true, comic: t.comic, rim: !!t.rim, key: 'ext-w-' + gradeKey(t) + (p.vertexColors ? 'v' : ''), albedo: gradeGlsl(t) };
  const mat = toon(p, opts);
  mat.flatShading = !!t.flat;
  mat.name = src.name || '';
  const nm = normalMatFor({ occluder: true }, p.side);
  if (p.alphaTest) { nm.alphaTest = p.alphaTest; nm.map = p.map; } // cut-outs cut their outline too
  return { mat, nm };
}

// A character material in the style of characters.js characterMaterial (soft band, strong rim, its own glow and the
// hit flash), sharing the view's glow / flash uniforms so a flash lights every part. The parts never use the
// geometry's vertex colours: those are the texture sampled per vertex, for the death debris and the weapon.
export function charToon(src, entry, shared) {
  const t = entry.toon, p = paramsOf(src, entry);
  const m = toon(p, {
    rim: t.rim, glow: true, softBand: true, comic: t.comic, key: 'ext-c-' + gradeKey(t) + (p.vertexColors ? 'v' : ''),
    uniforms: { mnGlowAmt: shared.glow, mnRimStr: { value: 1.1 }, mnFlash: shared.flash },
    fragPars: 'uniform vec4 mnFlash;\n',
    albedo: gradeGlsl(t),
    post: 'gl_FragColor.rgb = mix(gl_FragColor.rgb, mnFlash.rgb, mnFlash.a);\n',
    glowMask: 'max(smoothstep(0.35, 1.4, max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b)), mnFlash.a * 0.6)',
  });
  m.flatShading = !!t.flat;
  m.name = src.name || '';
  m.userData.glow = shared.glow;
  m.userData.flash = shared.flash;
  m.userData.nm = charNormalMat();
  return m;
}
