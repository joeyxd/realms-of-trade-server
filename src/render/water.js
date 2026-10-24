// Stylized water, two variants that share every look parameter:
//
//  SSR (medium/high): drawn after the outline composite. Reads the opaque scene depth, rebuilds the
//    seabed under each pixel, refracts the already-outlined scene (half-res copy) with the wave
//    normals, applies Beer–Lambert absorption along the view ray (sand → turquoise → deep blue),
//    adds seabed caustics, surface light web, sky fresnel, sun sparkles, and foam from the real
//    depth difference: around rocks, posts, the ship hull and wading characters, lace foam in the
//    shallows and wave lines pushing to shore. Manual depth test, so anything above the surface
//    (characters, the dock) occludes it, except the beach under the swash run-up, which it draws.
//  Simple (low): same colors/foam from the terrain heightmap, alpha blended, no refraction; the swash
//    only drains (the terrain depth-tests the plane away above the still level).
//
// All noise comes from two tileable textures (see noiseTex.js): ~10 fetches per pixel; both variants
// read the terrain heightmap once (the swash shore mask).
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_BAND, GLSL_LIGHTS, U } from './toon.js';
import { GLSL_SKY, SKY } from './sky.js';
import { WATERU } from './pipeline.js';
import { getWaveTexture } from './noiseTex.js';
import { WATER_DETAIL_DEFAULTS, WATER_DETAIL_UNIFORMS, CAUSTIC_PARS } from './waterDetail.js';

export const WATER_LOOK = {
  absorb: new THREE.Vector3(1.0, 0.045, 0.1), // per-channel extinction per unit of path (red dies first, clear shelf)
  inscatter: new THREE.Vector3(0.8, 0.38, 1.0), // per-channel in-scatter build-up per unit of path (blue tints the edge aqua)
  scatterShallow: new THREE.Color(0x4e99a9),
  scatterDeep: new THREE.Color(0x0b3f8f),
  foam: new THREE.Color(0xfffbf0),
  caustic: new THREE.Color(0xfff3cf),
};

// Set by the lighting preset every frame (night dims the in-scattered color and the foam).
export const WATER_LIGHT = {
  uWaterLight: { value: new THREE.Color(1, 1, 1) },
  uSparkle: { value: 1 },
  uFoamLight: { value: 1 },
  uGlints: { value: 0.2 }, // how much the sparkles bloom
  uSkyFill: { value: new THREE.Color(0, 0, 0) }, // sky (hemisphere) light on flat ground: lights the foam at night
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
${CAUSTIC_PARS}
uniform float mnFoamContactScale, mnFoamLaceWidth, mnFoamLaceStrength, mnFoamWaveStrength, mnWaterSurfaceLight;
uniform float mnSwashUp, mnSwashDown, mnWaveK;
uniform sampler2D tWave;
uniform vec3 uWaterLight;
uniform float uSparkle;
uniform float uFoamLight;
uniform float uGlints;
uniform vec3 uSkyFill;
uniform vec3 uAbsorb, uInscatter, uScatterShallow, uScatterDeep, uFoam, uCaustic;
uniform float uWaves, uRefract;
#ifdef MN_WATER_SSR
uniform sampler2D tRefract;
uniform sampler2D tSceneDepth;
uniform vec2 uSceneRes;
uniform float uNear, uFar;
#endif
uniform sampler2D uHeight;
uniform float uWorldHalf;
varying vec3 vWorld;
varying float vViewZ;

// Swash: every wave line that reaches the shore runs up the beach, slows, and drains back while the next one rolls in.
// arg is the wave-line phase at the still waterline; q 0 is the crest meeting the drained edge at depth mnSwashDown.
// Returns the edge height over the still level (+ up the sand, - drained); fresh is 1 on the uprush and fades on the
// backwash.
float mnSwash(float arg, out float fresh) {
  float q = fract((arg - 1.5707963 + mnSwashDown * mnWaveK) / 6.2831853);
  float up = 1.0 - (1.0 - q / 0.3) * (1.0 - q / 0.3);  // fast uprush that slows near the top (30 % of the period)
  fresh = smoothstep(0.0, 0.06, q) - smoothstep(0.35, 0.8, q);
  return q < 0.3 ? mix(-mnSwashDown, mnSwashUp, up) : mix(mnSwashUp, -mnSwashDown, smoothstep(0.3, 1.0, q));
}

void main() {
  float t = mnTime;
  vec2 xz = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;

  // Wave slopes (RG) and heights (B): two scrolling layers of the tileable wave texture, read once.
  vec4 w1 = texture2D(tWave, xz * 0.035 + mnWind * t * 0.010);
  vec4 w2 = texture2D(tWave, xz * 0.083 + vec2(-mnWind.y, mnWind.x) * t * 0.018 + 0.37);
  vec2 s1 = w1.rg * 2.0 - 1.0;
  vec2 s2 = w2.rg * 2.0 - 1.0;
  // Distance LOD: calm the normals far away (no moiré on the horizon, cheaper to read).
  float far = smoothstep(45.0, 220.0, camDist);
  vec2 slope = (s1 * 0.65 + s2 * 0.45) * uWaves * (1.0 - far * 0.85);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ---- Swash ------------------------------------------------------------------------------------
  // The moving shore edge, only where the terrain itself is near the surface (posts and hulls at sea keep a still edge).
  vec2 huv = xz / (uWorldHalf * 2.0) + 0.5;
  float th = (huv.x < 0.0 || huv.y < 0.0 || huv.x > 1.0 || huv.y > 1.0) ? -20.0 : texture2D(uHeight, huv).r;
  float shore = smoothstep(-1.8, -0.8, th);
  float nz = texture2D(mnNoiseTex, xz * 0.05 + vec2(t * 0.012, t * 0.009)).b;
  float fresh;
  float swash = mnSwash(t * 1.25 + nz * 7.0, fresh) * shore;

  // ---- What is under the surface ---------------------------------------------------------------
#ifdef MN_WATER_SSR
  vec2 suv = gl_FragCoord.xy / uSceneRes;
  float sceneZ = -perspectiveDepthToViewZ(texture2D(tSceneDepth, suv).r, uNear, uFar);
  bool above = sceneZ < vViewZ - 0.02;               // something opaque is above the still water here
  float tScene = camDist * sceneZ / vViewZ;          // distance along the view ray to the opaque surface
  vec3 bed = cameraPosition - V * tScene;
  float still = vWorld.y - bed.y;                    // vertical depth under the still level (< 0 above it)
  // Dry: above the run-up (everything above the still level away from the shore) and the drained shelf on the backwash.
  if (still + swash < 0.0 && (above || swash < 0.0)) discard;
  float depth = max(still + swash, 0.0);             // vertical water depth under the moving edge
  // Length of the ray inside the water; the run-up sheet over the sand is as deep as the edge is above the sand.
  float path = max(max(tScene - camDist, 0.0) + (swash + min(still, 0.0)) / max(V.y, 0.2), 0.0);
  // Refraction: offset by the wave slope, less at the very edge; never pull in what is above water.
  vec2 ruv = suv + slope * uRefract * clamp(depth * 0.7, 0.0, 1.0) / max(vViewZ * 0.045, 1.0);
  float rz = -perspectiveDepthToViewZ(texture2D(tSceneDepth, ruv).r, uNear, uFar);
  if (rz < vViewZ) ruv = suv;
  vec3 under = texture2D(tRefract, ruv).rgb;
  vec2 bedXZ = bed.xz;
#else
  float still = vWorld.y - th;
  // The terrain depth-tests the run-up sheet away, so the edge only drains here: on the uprush the still waterline keeps
  // its foam instead of reading as water already deep.
  swash = min(swash, 0.0);
  if (still + swash < 0.0 && swash < 0.0) discard;   // the drained shelf on the backwash
  float depth = max(still + swash, 0.0);
  float path = depth / max(V.y, 0.25);
  // No refraction: a sand-toned bed lit like the water stands in for what is under it (see the alpha below).
  vec3 under = vec3(0.58, 0.35, 0.115) * (1.0 - 0.68 * smoothstep(0.5, 7.0, depth)) * uWaterLight;
  vec2 bedXZ = xz;
#endif

  // Sun visibility on the surface (shadows + cloud shadows).
  float vis = getShadowMask() * mnCloudShadow(xz);

  // Seabed caustics (two drifting cell webs), fading with depth and in shadow.
#ifdef MN_WATER_SSR
  if (depth < 4.5) {
    // Warped by the waves so the cells read as wobbly light ribbons, not a polygon grid.
    vec2 warp = (texture2D(tWave, bedXZ * 0.07 + t * 0.01).rg - 0.5) * 0.9;
    vec2 cuv = bedXZ * 0.16 + warp;
    float c1 = texture2D(mnNoiseTex, cuv + vec2(t * 0.013, t * 0.009)).g;
    float c2 = texture2D(mnNoiseTex, cuv * 1.29 - vec2(t * 0.011, -t * 0.014) + 0.41).g;
    float caust = mnCausticMask(c1, c2);
    // The refracted bed takes a stronger web than the terrain's own (low) path, which shares the strength.
    under += uCaustic * uWaterLight * caust * mnCausticStrength * 4.2 * (1.0 - smoothstep(1.0, 3.0, depth)) * smoothstep(0.05, 0.25, depth) * (0.3 + 0.7 * vis);
  }
#endif

  // Beer–Lambert absorption along the path; the in-scatter builds up faster in blue (aqua over the sand at the edge).
  // Past the shelf a murk hides the bed and the color follows the depth, so open water is one deep blue from any angle.
  float murk = 1.0 - 0.98 * smoothstep(5.2, 7.4, depth);
  vec3 T = exp(-path * uAbsorb) * murk;
  vec3 S = 1.0 - exp(-path * uInscatter) * murk;
  vec3 scatter = mix(uScatterShallow, uScatterDeep, smoothstep(1.0, 6.3, depth)) * uWaterLight;
  vec3 col = under * T + scatter * S;

  // Surface light: shared toon bands (subtle on water) and a soft light web.
  float ndl = mix(-1.0, dot(n, sunDir), vis);
  col *= mix(0.82, 1.04, mnBand(ndl));
  // Soft wavy light patches on the surface (from the wave heights, not a cell grid).
  float h1 = w1.b;
  float h2 = w2.b;
  float glow = smoothstep(0.6, 0.7, h1 * 0.55 + h2 * 0.45);
  col += vec3(0.8, 1.0, 1.0) * uWaterLight * glow * mnWaterSurfaceLight * (0.35 + 0.65 * vis) * smoothstep(0.15, 1.0, depth);

  // Sky reflection (fresnel).
  float fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  col = mix(col, skyColor(reflect(-V, n), 0.0), clamp(fr * 0.9, 0.0, 0.6));

#ifdef MN_WATER_SSR
  // Fine ripples (SSR only) break the moon glitter and the light pools into small facets.
  vec2 s3 = texture2D(tWave, xz * 0.21 - mnWind * t * 0.03 + 0.61).rg * 2.0 - 1.0;
  vec3 nr = normalize(vec3(-(slope.x + s3.x * 0.6), 1.0, -(slope.y + s3.y * 0.6)));
#else
  vec3 nr = n;
#endif
  // Sun sparkles: sharp highlight broken into twinkling cells.
  vec3 H = normalize(sunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 140.0) * vis;
  vec4 cell = texture2D(mnNoiseTex, xz * 0.42 + slope * 0.1);
  float twinkle = 0.5 + 0.5 * sin(t * 5.0 + cell.a * 40.0);
  float spark = step(cell.r, 0.1 * clamp(spec * 2.5, 0.0, 1.0)) * step(0.6, twinkle);
  // Moon glitter: under a dim (moon) light, sparse twinkles on the wave facets tilted toward it, away from the
  // shallows; the diorama camera rarely sees the mirror path itself.
  float moonW = 1.0 - smoothstep(0.15, 0.5, max(sunColor.r, max(sunColor.g, sunColor.b)));
  float glit = step(cell.r, 0.35 * smoothstep(0.0, 0.06, dot(nr, sunDir) - sunDir.y)) * step(0.7, cell.a) * step(0.5, twinkle) * moonW * smoothstep(0.8, 2.0, depth);
  // Solid glint patches fade faster than the twinkles (the moon gives a glitter path, not blobs).
  col += sunColor * (uSparkle * (step(0.55, spec) * 0.45 * uSparkle + spark * 1.1) + glit * 2.5) * (1.0 - far); // the moon glitter keeps its own gain (moonW is 0 outside the night)
  // Lanterns, fires and lava reflected in the waves.
  vec3 lw = mnLocalWater(vWorld, nr, V);
  col += lw;
  // Glow mask: light glints and the twinkling sparkles bloom (more at night, see uGlints).
  float glowW = clamp(max(lw.r, max(lw.g, lw.b)) * 0.7 + (spark + glit) * (1.0 - far) * uGlints, 0.0, 1.0);

  // ---- Foam --------------------------------------------------------------------------------------
  float nz2 = texture2D(mnNoiseTex, xz * 0.13 - vec2(t * 0.02, -t * 0.015)).b;
  // Contact foam: around anything that pierces the surface (shore, rocks, posts, legs, hull). On the shore it rides the
  // swash edge: a thick bore on the uprush, a thin line on the backwash.
  float pulse = 0.015 * sin(t * 1.7 + nz * 9.0);
  float edgeW = (0.05 + nz2 * 0.06 + pulse) * mnFoamContactScale * mix(1.0, mix(0.8, 1.6, fresh), shore);
  float contactAA = max(fwidth(depth) * 0.7, 0.008);
  float contact = 1.0 - smoothstep(max(0.0, edgeW - contactAA), edgeW + contactAA, depth);
  contact *= mix(0.55, 1.0, smoothstep(0.28, 0.65, nz2));
  // Lace band behind the waterline: its outer edge (in water depth) laps in and out with the swash.
  float reach = mix(0.5, 1.3, 0.5 + 0.5 * sin(t * 0.9 + nz * 6.0));
  // 0 at the waterline, 1 at the band's outer edge; the run-up sheet over the sand (above the still level) is a thin
  // film that only carries the broken outer threads behind its foam front.
  float band = max(depth / reach, shore * smoothstep(0.0, 0.12, -still) * 0.7);
  // Cell walls of the noise, warped by the wave slopes: thick at the waterline (foam with holes), thinning seaward
  // into broken threads.
  float lace = texture2D(mnNoiseTex, xz * 0.3 + vec2(t * 0.03, t * 0.02) + s1 * 0.14 + s2 * 0.08).g;
#ifdef MN_WATER_SSR
  // A finer second web punches smaller holes and its fbm thins the walls in patches (SSR only: the low path
  // keeps its fetch count).
  vec4 lz = texture2D(mnNoiseTex, xz * 0.71 - vec2(t * 0.04, -t * 0.03) + s2 * 0.1);
  lace = min(lace, lz.g * 1.4 + 0.04);
  float thin = lz.b;
#else
  float thin = nz2 * 0.8; // one web only: thinner, more broken walls
#endif
  float laceW = mnFoamLaceWidth * mix(1.0, 0.22, smoothstep(0.0, 1.0, band)) * mix(0.55, 1.2, smoothstep(0.3, 0.7, thin));
  float laceAA = fwidth(lace) * 0.7 + 0.003;
  float laceFoam = 1.0 - smoothstep(max(0.0, laceW - laceAA), laceW + laceAA, lace);
  laceFoam *= (1.0 - smoothstep(0.75, 1.0, band)) * mix(1.0, 0.55, clamp(band, 0.0, 1.0));
  laceFoam *= 1.0 - smoothstep(0.3, 0.8, band) * (1.0 - smoothstep(0.4, 0.6, thin)); // seaward threads break up
  laceFoam *= smoothstep(0.3, 0.5, nz2 + 0.08); // gaps along the shore, not a uniform band
  laceFoam *= mix(1.0, mix(0.85, 1.0, fresh), shore); // the backwash leaves the lace to thin out
  // Wave lines rolling in toward the shore, broken into threads by the lace; fainter further out. On the shore each
  // line runs into the drained edge as it turns into the uprush (mnSwash), and none rolls on over the swash sheet.
  float wv = sin(still * mnWaveK + t * 1.25 + nz * 7.0);
  float waveAA = fwidth(wv) * 0.7 + 0.001;
  float inner = mix(smoothstep(0.3, 0.55, depth), smoothstep(0.02, 0.15, depth) * smoothstep(mnSwashDown - 0.1, mnSwashDown, still), shore);
  float lines = smoothstep(0.95 - waveAA, 0.985 + waveAA, wv) * (1.0 - smoothstep(2.6, 4.2, depth)) * inner * smoothstep(0.42, 0.62, nz2);
  lines *= (1.0 - 0.8 * smoothstep(0.2, 0.45, lace)) * mix(1.0, 0.5, smoothstep(1.2, 3.0, depth));
  float foam = clamp(max(contact * 0.82, max(laceFoam * mnFoamLaceStrength, lines * mnFoamWaveStrength)), 0.0, 1.0);
  // Foam light: the sun-lit term by day. Under the moon the water light is near black, so the foam takes the sky
  // (hemisphere) light that lights the sand (uSkyFill: the water pass renders without the scene lights), at a
  // sand-like albedo: the shoreline reads about as bright as the moonlit sand. Lights on the water also light the
  // foam, and foam is never darker than the water it floats on.
  vec3 foamLight = max(mix(0.8, 1.02, vis) * uWaterLight * uFoamLight, BRDF_Lambert(vec3(0.65)) * uSkyFill * moonW);
  vec3 foamCol = uFoam * (foamLight + mnLocalLight(vWorld, vec3(0.0, 1.0, 0.0)) * 0.3) + lw * 0.3;
  foamCol *= max(1.0, luminance(col) * 1.25 / max(luminance(foamCol), 1e-4));
  col = mix(col, foamCol, foam);

#ifdef MN_WATER_SSR
  gl_FragColor = vec4(col, 1.0 - glowW * (1.0 - foam));
#else
  // The real seabed shows through near the edge; deeper the water carries the stand-in bed and the SSR colors.
  float a = clamp(0.22 + 0.6 * smoothstep(0.0, 1.6, depth) + 0.15 * smoothstep(3.0, 7.0, depth), 0.22, 0.97);
  gl_FragColor = vec4(col, max(a, foam));
#endif
  #include <colorspace_fragment>
  #include <fog_fragment>
#if defined(MN_WATER_SSR) && defined(USE_FOG)
  gl_FragColor.a = 1.0 - (1.0 - gl_FragColor.a) * (1.0 - fogFactor);
#endif
}`;

function makeMaterial(map, heightTex, ssr) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  Object.assign(uniforms, SKY, {
    mnTime: U.mnTime, mnWind: U.mnWind, mnCloud: U.mnCloud, mnNoiseTex: U.mnNoiseTex,
    mnPlayer: U.mnPlayer, mnOccR: U.mnOccR, mnOccOn: U.mnOccOn, mnNearFade: U.mnNearFade,
    mnLightPos: U.mnLightPos, mnLightCol: U.mnLightCol, mnLightCount: U.mnLightCount, mnLightSoft: U.mnLightSoft, mnLightBounce: U.mnLightBounce,
    ...WATER_LIGHT,
    ...WATER_DETAIL_UNIFORMS,
    tWave: { value: getWaveTexture() },
    uAbsorb: { value: WATER_LOOK.absorb },
    uInscatter: { value: WATER_LOOK.inscatter },
    uScatterShallow: { value: WATER_LOOK.scatterShallow },
    uScatterDeep: { value: WATER_LOOK.scatterDeep },
    uFoam: { value: WATER_LOOK.foam },
    uCaustic: { value: WATER_LOOK.caustic },
    uWaves: { value: 1 },
    uRefract: { value: WATER_DETAIL_DEFAULTS.refraction },
    uHeight: { value: heightTex },
    uWorldHalf: { value: map.size / 2 },
  });
  if (ssr) Object.assign(uniforms, WATERU);
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
  for (const k of ['uWaves', 'uRefract', 'uHeight', 'uWorldHalf']) simple.uniforms[k] = ssr.uniforms[k];
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
