// Stylized water, two variants that share every look parameter:
//
//  SSR (medium/high): drawn after the outline composite. Reads the opaque scene depth, rebuilds the
//    seabed under each pixel, refracts the already-outlined scene (half-res copy) with the wave
//    normals, applies Beer–Lambert absorption along the view ray (sand → turquoise → deep blue),
//    adds seabed caustics, surface light web, sky fresnel, sun sparkles, and foam from the real
//    depth difference: around rocks, posts, the ship hull and wading characters, lace foam in the
//    shallows and wave lines pushing to shore. Manual depth test, so anything above the surface
//    (characters, the dock) occludes it.
//  Simple (low): same colors/foam from the terrain heightmap, alpha blended, no refraction.
//
// All noise comes from two tileable textures (see noiseTex.js): ~10 fetches per pixel.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_BAND, GLSL_LIGHTS, U } from './toon.js';
import { GLSL_SKY, SKY } from './sky.js';
import { WATERU } from './pipeline.js';
import { getWaveTexture } from './noiseTex.js';

export const WATER_LOOK = {
  absorb: new THREE.Vector3(0.46, 0.2, 0.15), // per-channel extinction per unit of path (red dies first)
  scatterShallow: new THREE.Color(0x2fd3c8),
  scatterDeep: new THREE.Color(0x0b3f8f),
  foam: new THREE.Color(0xfffbf0),
  caustic: new THREE.Color(0xfff3cf),
};

// Set by the lighting preset every frame (night dims the in-scattered color and the foam).
export const WATER_LIGHT = {
  uWaterLight: { value: new THREE.Color(1, 1, 1) },
  uSparkle: { value: 1 },
  uFoamLight: { value: 1 },
};

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
varying float vViewZ;
void main() {
  vec3 transformed = position;
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorld = worldPosition.xyz;
  vec3 objectNormal = vec3(0.0, 1.0, 0.0);
  vec3 transformedNormal = normalMatrix * objectNormal;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLSL_COMMON}
${GLSL_BAND}
${GLSL_SKY}
${GLSL_LIGHTS}
uniform sampler2D tWave;
uniform vec3 uWaterLight;
uniform float uSparkle;
uniform float uFoamLight;
uniform vec3 uAbsorb, uScatterShallow, uScatterDeep, uFoam, uCaustic;
uniform float uWaves, uRefract;
#ifdef MN_WATER_SSR
uniform sampler2D tRefract;
uniform sampler2D tSceneDepth;
uniform vec2 uSceneRes;
uniform float uNear, uFar;
#else
uniform sampler2D uHeight;
uniform float uWorldHalf;
#endif
varying vec3 vWorld;
varying float vViewZ;

void main() {
  float t = mnTime;
  vec2 xz = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;

  // Wave slopes: two scrolling layers of the tileable wave texture.
  vec2 s1 = texture2D(tWave, xz * 0.035 + mnWind * t * 0.010).rg * 2.0 - 1.0;
  vec2 s2 = texture2D(tWave, xz * 0.083 + vec2(-mnWind.y, mnWind.x) * t * 0.018 + 0.37).rg * 2.0 - 1.0;
  // Distance LOD: calm the normals far away (no moiré on the horizon, cheaper to read).
  float far = smoothstep(45.0, 220.0, camDist);
  vec2 slope = (s1 * 0.65 + s2 * 0.45) * uWaves * (1.0 - far * 0.85);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ---- What is under the surface ---------------------------------------------------------------
#ifdef MN_WATER_SSR
  vec2 suv = gl_FragCoord.xy / uSceneRes;
  float sceneZ = -perspectiveDepthToViewZ(texture2D(tSceneDepth, suv).r, uNear, uFar);
  if (sceneZ < vViewZ - 0.02) discard;              // something opaque is above the water here
  float tScene = camDist * sceneZ / vViewZ;          // distance along the view ray to the opaque surface
  vec3 bed = cameraPosition - V * tScene;
  float depth = max(vWorld.y - bed.y, 0.0);          // vertical water depth
  float path = max(tScene - camDist, 0.0);           // length of the ray inside the water
  // Refraction: offset by the wave slope, less at the very edge; never pull in what is above water.
  vec2 ruv = suv + slope * uRefract * clamp(depth * 0.7, 0.0, 1.0) / max(vViewZ * 0.045, 1.0);
  float rz = -perspectiveDepthToViewZ(texture2D(tSceneDepth, ruv).r, uNear, uFar);
  if (rz < vViewZ) ruv = suv;
  vec3 under = texture2D(tRefract, ruv).rgb;
  vec2 bedXZ = bed.xz;
#else
  vec2 huv = xz / (uWorldHalf * 2.0) + 0.5;
  float th = (huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) ? -20.0 : texture2D(uHeight, huv).r;
  float depth = max(vWorld.y - th, 0.0);
  float path = depth / max(V.y, 0.25);
  vec3 under = vec3(0.0);
  vec2 bedXZ = xz;
#endif

  // Sun visibility on the surface (shadows + cloud shadows).
  float vis = getShadowMask() * mnCloudShadow(xz);

  // Seabed caustics (two drifting cell webs), fading with depth and in shadow.
#ifdef MN_WATER_SSR
  if (depth < 4.5) {
    // Warped by the waves so the cells read as wobbly light ribbons, not a polygon grid.
    vec2 warp = (texture2D(tWave, bedXZ * 0.05 + t * 0.01).rg - 0.5) * 0.9;
    vec2 cuv = bedXZ * 0.11 + warp;
    float c1 = texture2D(mnNoiseTex, cuv + vec2(t * 0.013, t * 0.009)).g;
    float c2 = texture2D(mnNoiseTex, cuv * 1.29 - vec2(t * 0.011, -t * 0.014) + 0.41).g;
    float caust = smoothstep(0.72, 0.95, 1.0 - min(c1, c2));
    under += uCaustic * uWaterLight * caust * 0.26 * (1.0 - smoothstep(0.2, 2.6, depth)) * smoothstep(0.05, 0.3, depth) * (0.3 + 0.7 * vis);
  }
#endif

  // Beer–Lambert absorption along the path + in-scattered water color.
  vec3 T = exp(-path * uAbsorb);
  vec3 scatter = mix(uScatterShallow, uScatterDeep, smoothstep(1.5, 11.0, path)) * uWaterLight;
  vec3 col = under * T + scatter * (1.0 - T);

  // Surface light: shared toon bands (subtle on water) and a soft light web.
  float ndl = mix(-1.0, dot(n, sunDir), vis);
  col *= mix(0.82, 1.04, mnBand(ndl));
  // Soft wavy light patches on the surface (from the wave heights, not a cell grid).
  float h1 = texture2D(tWave, xz * 0.035 + mnWind * t * 0.010).b;
  float h2 = texture2D(tWave, xz * 0.083 + vec2(-mnWind.y, mnWind.x) * t * 0.018 + 0.37).b;
  float glow = smoothstep(0.6, 0.7, h1 * 0.55 + h2 * 0.45);
  col += vec3(0.8, 1.0, 1.0) * uWaterLight * glow * 0.07 * (0.35 + 0.65 * vis) * smoothstep(0.15, 1.0, depth);

  // Sky reflection (fresnel).
  float fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col = mix(col, skyColor(reflect(-V, n), 0.0), clamp(fr * 0.9, 0.0, 0.6));

  // Sun sparkles: sharp highlight broken into twinkling cells.
  vec3 H = normalize(sunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 140.0) * vis;
  vec4 cell = texture2D(mnNoiseTex, xz * 0.42 + slope * 0.1);
  float twinkle = 0.5 + 0.5 * sin(t * 5.0 + cell.a * 40.0);
  float spark = step(cell.r, 0.1 * clamp(spec * 2.5, 0.0, 1.0)) * step(0.6, twinkle);
  // Solid glint patches fade faster than the twinkles (the moon gives a glitter path, not blobs).
  col += sunColor * uSparkle * (step(0.55, spec) * 0.45 * uSparkle + spark * 1.1) * (1.0 - far);
  // Lanterns, fires and lava reflected in the waves.
  col += mnLocalWater(vWorld, n, V);

  // ---- Foam --------------------------------------------------------------------------------------
  float nz = texture2D(mnNoiseTex, xz * 0.05 + vec2(t * 0.012, t * 0.009)).b;
  float nz2 = texture2D(mnNoiseTex, xz * 0.13 - vec2(t * 0.02, -t * 0.015)).b;
  // Contact foam: around anything that pierces the surface (shore, rocks, posts, legs, hull).
  float pulse = 0.015 * sin(t * 1.7 + nz * 9.0);
  float edgeW = 0.05 + nz2 * 0.06 + pulse;
  float contact = 1.0 - smoothstep(edgeW - 0.015, edgeW + 0.015, depth);
  // Lace foam in the shallows: thick cell borders (foam with holes) at the shore, thinning out.
  float lace = texture2D(mnNoiseTex, xz * 0.11 + vec2(t * 0.014, t * 0.01) + slope * 0.04).g;
  float reach = 0.42 + 0.16 * sin(t * 0.85 + nz * 6.0);
  float laceW = mix(0.3, 0.04, smoothstep(0.03, reach, depth));
  float laceFoam = (1.0 - smoothstep(laceW, laceW + 0.06, lace)) * (1.0 - smoothstep(reach * 0.8, reach + 0.15, depth));
  laceFoam *= smoothstep(0.25, 0.45, nz + 0.1); // patchy, not a uniform band
  // Wave lines pushing toward the shore.
  float wv = sin(depth * 5.5 - t * 1.25 + nz * 7.0);
  float lines = smoothstep(0.93, 0.985, wv) * (1.0 - smoothstep(0.6, 1.7, depth)) * step(0.22, depth) * smoothstep(0.42, 0.62, nz2);
  float foam = clamp(max(contact, max(laceFoam * 0.9, lines * 0.85)), 0.0, 1.0);
  col = mix(col, uFoam * (mix(0.8, 1.02, vis) * uWaterLight * uFoamLight + mnLocalLight(vWorld, vec3(0.0, 1.0, 0.0)) * 0.3), foam);

#ifdef MN_WATER_SSR
  gl_FragColor = vec4(col, 1.0);
#else
  float a = clamp(1.0 - dot(T, vec3(0.333)), 0.22, 0.97);
  gl_FragColor = vec4(col, max(a, foam));
#endif
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeMaterial(map, heightTex, ssr) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, SKY, {
    mnTime: U.mnTime, mnWind: U.mnWind, mnCloud: U.mnCloud, mnNoiseTex: U.mnNoiseTex,
    mnPlayer: U.mnPlayer, mnOccR: U.mnOccR, mnOccOn: U.mnOccOn, mnNearFade: U.mnNearFade,
    mnLightPos: U.mnLightPos, mnLightCol: U.mnLightCol, mnLightCount: U.mnLightCount,
    ...WATER_LIGHT,
    tWave: { value: getWaveTexture() },
    uAbsorb: { value: WATER_LOOK.absorb },
    uScatterShallow: { value: WATER_LOOK.scatterShallow },
    uScatterDeep: { value: WATER_LOOK.scatterDeep },
    uFoam: { value: WATER_LOOK.foam },
    uCaustic: { value: WATER_LOOK.caustic },
    uWaves: { value: 1 },
    uRefract: { value: 0.035 },
  });
  if (ssr) Object.assign(uniforms, WATERU);
  else Object.assign(uniforms, { uHeight: { value: heightTex }, uWorldHalf: { value: map.size / 2 } });
  return new THREE.ShaderMaterial({
    uniforms,
    defines: ssr ? { MN_WATER_SSR: '' } : {},
    vertexShader: VERT,
    fragmentShader: FRAG,
    lights: true,
    fog: true,
    transparent: !ssr,
    depthWrite: false,
    depthTest: !ssr,
  });
}

export function createWater(map, heightTex) {
  const ssr = makeMaterial(map, heightTex, true);
  const simple = makeMaterial(map, heightTex, false);
  // Share the tweakable uniforms so quality switches keep the same look.
  for (const k of ['uWaves', 'uRefract']) simple.uniforms[k] = ssr.uniforms[k];
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, ssr);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'water';
  mesh.frustumCulled = false;
  mesh.userData.materials = { ssr, simple };
  mesh.userData.setMode = (useSsr) => { mesh.material = useSsr ? ssr : simple; };
  return mesh;
}
